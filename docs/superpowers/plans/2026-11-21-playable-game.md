# Playable Game Implementation Plan (plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the engine (plan 1) and word lists (plan 2) into the game Roy plays in class. He opens the site, types the host passcode and gets a room code on the projector. Students join on their laptops with the code and a nickname, and Roy runs the game from a control panel: in a second window, on his phone, or as a pop-up overlay.

**Architecture:**
- **Hub:** `src/server/hub.ts` is a pure "hub" that owns all rooms and connections.
  - **Connections:** it talks to an abstract `Conn` (`send`, `close`) and never imports Netlify.
  - **Inputs:** it validates every incoming message, applies rate limits, and turns messages into Room calls.
  - **Outputs:** it batches each room's `onChange` into one broadcast per tick, sending each connection the view for its role.
- **Two thin adapters plug the hub into a transport:**
  1. `netlify/server/index.ts` uses `upgradeWebSocket` on Netlify Server and loads the generated word files through `includedFiles`.
  2. `scripts/dev-server.ts` is a local Node server with a minimal WebSocket implementation (no npm installs are possible here). It serves `public/`, so the whole game runs locally for end-to-end tests and the 32-bot load test.
- **Browser:** plain ES modules in `public/` with no build step, as the connection test already uses.
  - **Render functions:** each screen's rendering is a pure function from view to HTML string, unit-tested in Node.
  - **Wiring:** thin modules handle the DOM and the socket.

**Tech Stack:**
- **Server:** TypeScript on Netlify Server (Node 24).
- **Browser:** plain JS modules with JSDoc types.
- **Tests:** `node:test` with `tsx`, plus Playwright (preinstalled at `/opt/npm-tools/node_modules/playwright`) for end-to-end tests. It runs only locally and is never a project dependency.

**Spec:** `docs/superpowers/specs/2026-11-21-bomb-game-design.md`, sections 4.1, 4.7, 4.8, 8 and 9.

**Carried over from earlier plans (ledger items this plan must honour):**
- **onChange batching:** `revive` fires `onChange` in the middle of a submit, so the hub batches broadcasts (queueMicrotask) and never sends half-finished state.
- **Bomb timer:** screens use `bombRemainingMs`, counting down locally from when the view arrived, and **never** `bombEndsAt`, which is in the server's clock.
- **The overlay's privacy:** on a mirrored screen the overlay shows the control panel without scores, ghost points or the passcode.
- **Last word:** Classic's `mode.lastWord` is shown as "Last word", not "Current word".
- **Credits:** `WORD_LIST_CREDITS` is shown in the lobby.
- **Hosting risk:** Roy skipped the school-network lesson-length test. The deploy health check (Task 2) and Roy's first classroom trial are the real proof, and Cloudflare stays the fallback.

## Global Constraints

- **Host passcode:**
  - **Where it lives:** the environment variable `HOST_PASSCODE`, read through `process.env`.
  - **If it's missing or empty:** creating a room is refused with reason `"no-passcode-set"`, and the start page tells Roy to set it in Netlify. It's never logged and never sent to a client.
  - **Checking it:** compared in constant time.
  - **Wrong attempts:** at most 5 per connection per minute, then `"too-many-attempts"`.
- **Rooms:**
  - **Limits:** at most 20 rooms on the server, and at most 32 players per room (the engine already enforces this).
  - **Cleanup:** a room is deleted 30 minutes after its last message from anyone. Its connections are then closed with code 4004, "Room closed".
- **Tokens:**
  - **Created by:** the browser, once per tab, as `crypto.randomUUID()`, stored in `sessionStorage` under `bomb.token`.
  - **Separate tabs:** each tab is a separate player, so Roy can test with tabs.
  - **Host token:** `bomb.hostToken`, also in sessionStorage.
  - **Rule:** tokens are never displayed and never put in URLs.
- **Messages:**
  - **Format:** JSON text.
  - **Size:** a message over 2,000 bytes is ignored.
  - **Unknown or malformed messages:** answered with `{t:"error", reason:"bad-message"}` and otherwise ignored, never thrown.
  - **Rate limits per connection:** at most 20 messages per second, and `typing` at most 10 per second. Extra messages are dropped silently.
- **Views:**
  - **What each connection receives:** players get `playerView(room, pid)`, the projector gets `projectorView(room)` and the control panel gets `controlView(room)`.
  - **The overlay:** it's a control connection, so it gets `controlView` too, but the overlay UI must not render scores or ghost points.
  - **Broadcasts:** at most one per room per tick, after a state change.
  - **Bomb timer:** the server also sends a fresh view whenever the bomb timer is re-armed, because that's already a state change.
- **Kick:** the kicked player's connections receive `{t:"kicked"}` and are then closed with code 4003. The client shows "You were removed from the game" and doesn't reconnect.
- **Reconnecting (client):** after a close it retries with a delay of 0 ms for code 1012, otherwise 1 s, then 2 s, then 5 s at most. It never reconnects for codes 4003 or 4004. Remember the 30-minute connection limit on Netlify's free plan, so reconnecting has to be seamless.
- **URLs:**
  - **Pages:** `/` (join and start), `/host` (Roy creates a room; projector and overlay), `/control` (control panel in a second window or on a phone), and `/check/` (the old connection test, moved).
  - **API:** `/api/ws` (the game socket) and `/api/health` (word counts and uptime, nothing private).
- **Screens:**
  - **Font sizes:** the projector reads from the back of the room, so the room code and prompt are at least `12vh`. The player screen's prompt is at least 48 px.
  - **Assets:** no external fonts, scripts or images. Everything is self-contained.
  - **Language:** all interface text is in English.
- **Sound:**
  - **Where:** the projector only. Ticking speeds up during the last 3 s of a visible timer, and in hidden-fuse mode it ticks steadily.
  - **Explosion:** a WebAudio-synthesised noise burst.
  - **Muting:** a mute toggle on the host screen, off by default. Player laptops are silent.
  - **Browser rule:** browsers block audio until a click, so the host's "Start game" click unlocks it.
- **Privacy:** no analytics, no cookies, no logging of nicknames or words. Server logs carry only counts and error kinds.

## Review Focus

1. **Roy's laptop sleeps, or the projector tab is refreshed, mid-game.** The host reconnects with `bomb.hostToken` and the game continues. → Task 1 test `host reconnects with host token`, and Task 6 E2E `projector refresh keeps the game`.
2. **The same player opens a second tab with the same sessionStorage**, which happens if a tab is duplicated. Both connections map to the same player, both get views, and the second never creates a duplicate player. → Task 1 test `two connections, one token, one player`.
3. **A student sends garbage, huge or fast messages**, for example from the devtools console. The hub must never throw or slow the room. → Task 1 tests `malformed and oversized messages are ignored` and `rate limit drops floods`.
4. **The room is deleted while players are connected** (idle cleanup). The clients show "This game has ended" and stop reconnecting. → Task 1 test `idle room is cleaned up and connections closed with 4004`, Task 3 test `4004 stops reconnecting`.
5. **The countdown drifts after a pause, or when a view arrives late.** The client always restarts its countdown from `bombRemainingMs` when each view arrives, and freezes it while `paused`. → Task 3 test `countdown follows bombRemainingMs and freezes when paused`.

---

## File Structure

```
src/server/protocol.ts       message types (client→server, server→client) + validate()
src/server/hub.ts            Hub: rooms, connections, routing, batching, limits, cleanup
src/server/passcode.ts       constant-time compare + attempt limiter
netlify/server/index.ts      Netlify adapter (replaces the connection-test server)
netlify/server/check-server.ts  kept, now mounted at /api/check/* for the old test page
scripts/dev-server.ts        local HTTP + minimal WebSocket server for e2e/load tests
scripts/load-test.ts         32 bots against the dev server
public/index.html            join page (code + nickname) + "Host a game" link
public/host.html             host: create room, projector view, overlay
public/control.html          control panel page (second window / phone)
public/check/                connection test page (moved from public/)
public/app/net.js            reconnecting socket client (pure core + DOM-free)
public/app/countdown.js      countdown from bombRemainingMs
public/app/render-player.js  playerView → HTML (pure)
public/app/render-projector.js projectorView → HTML (pure)
public/app/render-control.js controlView → HTML (pure; `{ overlay: boolean }` hides private columns)
public/app/sound.js          WebAudio tick/explosion (projector only)
public/app/player-page.js, host-page.js, control-page.js   DOM wiring
public/app/style.css
tests/server/*.test.ts, tests/client/*.test.ts, tests/e2e/*.test.ts
```

`package.json`'s `test` script gets `tests/server/*.test.ts tests/client/*.test.ts`. The E2E tests run separately with `npm run test:e2e`, because they start a server and a browser.

---

### Task 1: Protocol and hub

**Files:**
- Create: `src/server/protocol.ts`, `src/server/passcode.ts`, `src/server/hub.ts`
- Test: `tests/server/hub.test.ts`, `tests/server/protocol.test.ts`

**Interfaces (produced):**
- **Client → server messages (`ClientMsg`):**
  - `{t:"create", passcode, token}`, sent by the host page.
  - `{t:"host", code, token, hostToken}`, used by the host page to reconnect and by the control page to join with the host token.
  - `{t:"control", code, passcode, token}`, used on a phone that doesn't have the host token.
  - `{t:"join", code, token, nickname}`.
  - `{t:"submit", word}` and `{t:"typing", text}`.
  - `{t:"cmd", cmd: "start"|"pause"|"resume"|"skip"|"end"|"playAgain"|"lock"|"unlock"}`.
  - `{t:"cmd", cmd:"kick"|"rename", pid, nickname?}`.
  - `{t:"cmd", cmd:"settings", settings: object}`.
  - `{t:"leave"}`.
- **Server → client messages (`ServerMsg`):**
  - `{t:"welcome", role:"player"|"host"|"control", code, pid?, hostToken?}`. `hostToken` goes only to the creator and to a `control` connection that gave the passcode.
  - `{t:"view", view}`.
  - `{t:"result", ok, reason?, kind?}`, sent after a submit or a command.
  - `{t:"error", reason}`.
  - `{t:"kicked"}`.
- **Validation:** `validate(raw: string): ClientMsg | null`. It checks the size, parses the JSON, then checks every field's type and length (code is 4 letters, nickname at most 40 characters before the engine's own rules, word at most 60, text at most 60, and `settings` must be a plain object).
- **The hub:**
  ```ts
  class Hub {
    constructor(opts: {
      deps: EngineDeps;
      words: { checker: WordChecker; bank: PromptBank; blockedNames: string[] };
      passcode: string | undefined;
      log?: (event: string, n?: number) => void;
    });
    connect(conn: Conn): ConnHandle;
    roomCount(): number;
  }
  ```
  - **Connections:** `type Conn = { send(text: string): void; close(code: number, reason: string): void }` and `type ConnHandle = { message(text: string): void; closed(): void }`.
  - **Building rooms:** the hub creates rooms with `createRoom` from `src/engine/registry.ts`, passing the shared checker, bank and blockedNames.
  - **Host token:** a random UUID per room, never shown, and the only way to reconnect as host.
- **Passcode:** `passcodeMatches(given: string, expected: string): boolean` (constant time, using `crypto.timingSafeEqual` on equal-length buffers) and `class AttemptLimiter { allow(key: string, now: number): boolean }`, which allows 5 per minute.

- [ ] **Step 1: Write the failing tests** in `protocol.test.ts`:
  - `validate accepts every message shape`.
  - `validate rejects oversized, non-JSON, unknown t, wrong field types`, returning null.
- [ ] **Step 2: Write the failing tests** in `hub.test.ts`. Use fake `Conn`s that record sent messages, `makeDeps`, and the small test words (`makeTestChecker`, `fixturePrompts`).
  - **Creating a room:**
    - `create with wrong passcode is refused, 6th attempt is too-many-attempts`.
    - `create with no passcode configured is refused with no-passcode-set`.
    - `create returns welcome with code and hostToken; projector gets a lobby view`.
  - **Joining and reconnecting:**
    - `player joins with code and nickname; host sees them in the next view`.
    - `views are batched: one broadcast per room per tick` (3 joins in one tick give 1 view per connection).
    - `host reconnects with host token`: close the host connection, then send `{t:"host", code, token, hostToken}`. It gets the role host and the current view. A wrong hostToken gives `not-host`.
    - `control joins with passcode and receives hostToken`.
    - `two connections, one token, one player`.
  - **Privacy:** `each role receives its own view` (the player view has `me`, the projector view has no scores, and the control view has `settingDecls`).
  - **Playing and commands:**
    - `submit routes to the room and replies with result`.
    - `commands from a player connection are refused with not-host`.
    - `kick sends kicked and closes with 4003, and the token cannot rejoin`.
  - **Robustness:**
    - `malformed and oversized messages are ignored` (the reply is `bad-message`, and the room is unchanged).
    - `rate limit drops floods` (100 submits in one tick handle at most 20).
    - `idle room is cleaned up and connections closed with 4004` (advance 30 minutes with no messages).
    - `room limit: 21st room is refused with server-full`.
- [ ] **Step 3: Run the tests.** Run `npx tsx --test tests/server/*.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 4: Implement** `protocol.ts`, `passcode.ts` and `hub.ts`.
- [ ] **Step 5: Run all the tests and the type check.** Run `npm test && npx tsc -p tsconfig.json`. Expected: all pass.
- [ ] **Step 6: Commit** with the message `feat(server): protocol and hub`.

### Task 2: Netlify adapter, dev server and health check

**Files:**
- Modify: `netlify/server/index.ts`, `netlify.toml` (if needed), `tsconfig.json` (include `netlify/server/index.ts` only if `@netlify/server` types resolve; they don't locally, so keep it excluded)
- Create: `scripts/dev-server.ts`, `src/server/words-from-disk.ts`
- Move: `public/index.html`, `public/check-page.js` and `public/check-client.js` to `public/check/`. Update the imports in `tests/check-client.test.ts`.
- Test: `tests/server/dev-server.test.ts`

**Interfaces:**
- **Loading the words:** `loadWordsFromDir(dir: string)` returns the `loadWordData` result, reading each file with `readFileSync(join(dir, name), "utf8")`.
- **The Netlify adapter, `netlify/server/index.ts`:**
  - **At module load:** it loads the words from `join(import.meta.dirname, "../../data/generated")` and creates one `Hub` with `passcode = process.env.HOST_PASSCODE`.
  - **Routes:** `/api/ws` upgrades the connection and wires it to `hub.connect`, setting `socket.onmessage` and `socket.onclose`, as the Netlify docs show. `/api/health` returns `{ok:true, words: summary.counts, rooms: hub.roomCount(), startedAt}`. `/api/check/*` keeps the old ping and ws test endpoints by delegating to `check-server.ts`, with the paths renamed.
  - **Shutdown:** `onShutdown` closes every socket with 1012.
  - **Config:** `export const config = { path: "/api/*", includedFiles: ["../../data/generated/**"] }`. Patterns in the entry file are relative to the entry file.
  - **If the words fail to load:** `/api/health` returns `{ok:false, error:"words-not-loaded"}` with status 500, and `/api/ws` refuses with 503. That way the deploy's health check shows the problem plainly.
- **The dev server:** `scripts/dev-server.ts` exports `startDevServer(port: number): Promise<{ url: string; close(): Promise<void> }>`.
  - **Pages:** it uses `node:http` to serve `public/` statically, mapping `/host` to `host.html` and `/control` to `control.html`.
  - **Socket:** it handles `/api/ws` with a minimal RFC 6455 implementation: the handshake, masked text frames from the client, unmasked text frames to the client, close frames with a code, and ping/pong. No binary frames and no extensions.
  - **Health:** `/api/health` works the same way.
  - **Passcode:** `process.env.HOST_PASSCODE ?? "test"`.
  - **Running it:** `npm run dev` starts it on port 8888.

- [ ] **Step 1: Write the failing tests** in `dev-server.test.ts`. They start the dev server on port 0 and use Node 22's global `WebSocket` client.
  - `serves the join page and the check page`.
  - `health reports word counts`.
  - `websocket: create, join, receive views` (a full round trip through the real framing).
  - `client close codes and server close codes arrive intact` (4003 after a kick).
  - `long messages over 125 bytes and over 65535 bytes frame correctly` (they test the length encoding; the hub then ignores anything over 2,000 bytes).
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** `words-from-disk.ts`, the dev server and the Netlify adapter, and move the check page. Add `"dev"` and `"test:e2e"` scripts to `package.json`.
- [ ] **Step 4: Run all the tests and the type check.** Expected: all pass, including the moved check-page tests.
- [ ] **Step 5: Commit** with the message `feat(server): Netlify adapter, dev server, health check`.

### Task 3: Socket client, countdown and player screen

**Files:**
- Create: `public/app/net.js`, `public/app/countdown.js`, `public/app/render-player.js`, `public/app/player-page.js`, `public/app/style.css`, `public/index.html`
- Test: `tests/client/net.test.ts`, `tests/client/countdown.test.ts`, `tests/client/render-player.test.ts`

**Interfaces:**
- **Socket client:** `createConnection(deps, onMessage, onStatus)` returns `{ send(msg), close() }`.
  - **Dependencies:** `deps = { WebSocket, url, setTimeout, clearTimeout }`.
  - **Status:** `onStatus` receives `"connecting" | "open" | "reconnecting" | "ended" | "kicked"`.
  - **On every open:** it re-sends the last "hello" message (`join`, `host` or `control`), set with `setHello(msg)`.
  - **Reconnecting:** delays follow Global Constraints, and it stops for 4003 (kicked) and 4004 (ended).
- **Countdown:** `createCountdown(now: () => number)` returns `{ update(view): void; remainingMs(): number }`. It restarts from `view.bombRemainingMs` whenever a view arrives and freezes while `view.paused`. It returns `null` when there's no visible bomb.
- **Rendering the player screen:** `renderPlayer(view, ui: { countdownMs: number | null; lastResult?: SubmitResult; status: string }): string`. It's pure, and every piece of user text is escaped. It covers:
  - **States:** lobby (waiting, with the list of names), spectator ("You'll join the next game"), playing (prompt with its type wording, "Contains / Starts with / Ends with"), my turn (the text box is highlighted), waiting (silent answering is on: "Answer silently for points"), ghost (the panel from the spec mock-up: "YOU'RE OUT — keep playing as a ghost", ghost points and comeback progress), and results.
  - **Lives:** shown as hearts.
  - **Bonus letters:** the letters still to use.
  - **Last result:** "✓ +1" / "✗ not a word" and so on, with plain-English reasons.
- **The join page:** `index.html` has a code box (4 letters, upper-cased automatically), a nickname box, a Join button and a "Host a game" link. Once joined, the page swaps to the player screen in place. A `?code=ABCD` link pre-fills the code.

- [ ] **Step 1: Write the failing tests:**
  - **Socket client:**
    - `reconnects with backoff and re-sends hello`.
    - `1012 reconnects immediately`.
    - `4003 → kicked, no reconnect`.
    - `4004 stops reconnecting` (status `ended`).
  - **Countdown:** `countdown follows bombRemainingMs and freezes when paused`.
  - **Player screen:**
    - `render escapes nicknames and words` (`<img onerror>` appears escaped).
    - `my turn vs waiting vs ghost vs spectator states`.
    - `reasons are in plain English` (all 12 reasons map to text, and none shows the raw code).
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** the modules, page and styles.
  - **Text box:** it's focused at all times; Enter submits it and clears it.
  - **Typing:** keystrokes are sent as `typing`, throttled to 10 per second.
- [ ] **Step 4: Run all the tests and the type check.** Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(client): socket client, countdown, player screen`.

### Task 4: Host screen, projector, control panel and overlay

**Files:**
- Create: `public/host.html`, `public/control.html`, `public/app/render-projector.js`, `public/app/render-control.js`, `public/app/host-page.js`, `public/app/control-page.js`
- Test: `tests/client/render-projector.test.ts`, `tests/client/render-control.test.ts`

**Interfaces:**
- **Rendering the projector:** `renderProjector(view, ui: {countdownMs, credits}): string` covers these screens:
  - **Lobby:** the huge room code, "Go to <site> and enter the code", the joined names, and the credits line.
  - **Classic:** a circle of seats with the current player highlighted, lives, the huge prompt, the bomb with a countdown (visible style only), and "Last word: …".
  - **Everyone at once:** a grid of names that tick green, and the countdown.
  - **Between turns:** example answers after an explosion.
  - **Results:** the winner(s) by nickname, the ghost leaderboard and the longest word.
  - **Pause:** a "Paused" banner.
- **Rendering the control panel:** `renderControl(view, ui: {overlay: boolean}): string`.
  - **Settings form:** built from `view.settingDecls`. Number decls become number inputs with min, max and step. Booleans become checkboxes, choices become selects, and multi decls become checkbox groups (the bonus letters as a compact A–Z grid). It's disabled while a game is running, with a note saying why.
  - **Player list:** each player has rename and kick buttons. Kick asks for confirmation inside the page, never with a browser `confirm()` dialog.
  - **Game buttons:** Start, Pause/Resume, Skip, End, Play again, Lock/Unlock.
  - **Prompt warning:** if a band and type combination has fewer than 15 prompts, show a warning. This needs `bank.size`, so the hub adds `promptCounts: Record<band, Record<type, number>>` to the control view as a hub-level field (a ruling).
  - **Overlay mode:** with `overlay: true`, it renders no score or ghost-point columns and no passcode.
- **Host page flow:**
  - **Creating:** `host.html` asks for the passcode and sends `create`, then stores `bomb.hostToken`.
  - **The projector:** it renders full screen, with buttons for "⚙ Control (overlay)", "Open control window" (`window.open('/control?code=…')`; the control page uses the host token from sessionStorage shared with the opener, or asks for the passcode) and "Mute".
  - **Sound:** handled in Task 5.
- **The control page:** `control.html` works on a phone. It asks for the code and passcode, or reuses the host token in the same browser.

- [ ] **Step 1: Write the failing tests:**
  - **Projector:**
    - `projector never contains scores, ghost points or tokens` (render from a real game played with the engine).
    - `projector shows Last word in classic and no words in everyone during a round`.
  - **Control panel:**
    - `control form is generated from settingDecls` (every key has an input with the right type and range).
    - `overlay hides private columns` (no "score" or "ghost" text when `overlay: true`).
    - `few-prompts warning appears for starts/easy`.
    - `kick needs a second click`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** the renderers, the pages and the hub's `promptCounts` field (with a hub test).
- [ ] **Step 4: Run all the tests and the type check.** Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(client): host screen, projector, control panel and overlay`.

### Task 5: Sound and visual design pass

**Files:**
- Create: `public/app/sound.js`
- Modify: `public/app/style.css`, the render modules (markup tweaks only)

**Interfaces:**
- **Sound:** `createSound(audioContextFactory)` returns `{ unlock(); tick(urgent: boolean); explode(); setMuted(b) }`. The host page calls `tick` from its countdown loop: once a second, and 4 times a second during the last 3 s. In hidden-fuse mode it ticks steadily once a second. It calls `explode` when a view shows the bomb changed hands through an explosion; the hub adds `lastEvent: "explosion" | "word" | null` to the projector view as a hub-level field, which is a ruling.
- **Visual pass:** use the `frontend-design` skill. One look shared by all screens, readable from the back of a classroom, with high contrast and no external assets. Projector text sizes follow Global Constraints.

- [ ] **Step 1: Write the failing tests:**
  - `sound does nothing until unlocked and when muted` (fake AudioContext).
  - `explode fires once per explosion event`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** the sound and the design pass.
- [ ] **Step 4: Check the screens visually.** Run the dev server and take Playwright screenshots of the join page, player screen (my turn, waiting, ghost), projector (lobby, Classic, Everyone, results) and control panel (full and overlay) at 1280×800, with the phone control at 390×844. Look at each one, and fix anything clipped, overlapping or unreadable.
- [ ] **Step 5: Run all the tests and the type check.** Expected: all pass.
- [ ] **Step 6: Commit** with the message `feat(client): sound and visual design`. Save the screenshots in `docs/screenshots/`, so Roy can see them before deploying.

### Task 6: End-to-end tests, load test and setup guide

**Files:**
- Create: `tests/e2e/game.e2e.ts`, `scripts/load-test.ts`
- Modify: `README.md`

**Interfaces:**
- **E2E tests:** `npm run test:e2e` runs `tsx --test tests/e2e/*.e2e.ts`. It starts the dev server on port 0 and drives Chromium with Playwright, imported from `/opt/npm-tools/node_modules/playwright/index.mjs`. If that's missing, it skips with a clear message.
- **Load test:** `scripts/load-test.ts` (`npm run load-test`) starts the dev server and creates a room. It connects 32 bots that join and play Everyone-at-once for 5 rounds, each answering with a valid word from the known list after a random 1–8 s delay. It then reports the time between a submit and the room's next view: median, 95th percentile and maximum. It also reports any errors.

- [ ] **Step 1: Write the E2E tests** (each fails until the full flow works):
  - **Joining:** `host creates a room and three players join` (the projector lists three names).
  - **Classic:** `classic: valid word passes the turn and shows Last word`, and `explosion costs a life and shows example answers` (use short timer settings).
  - **Ghosts:** `ghost: knocked-out player sees the ghost panel`.
  - **Kicking:** `kick: kicked player sees the removed message and cannot rejoin`.
  - **Host reconnect:** `projector refresh keeps the game`.
  - **Phone control:** `control on a second page (phone size) can pause and resume`.
- [ ] **Step 2: Run the E2E tests.** Run `npm run test:e2e`. Expected: all pass. Fix any failures in the modules from Tasks 1–5 using test-first fixes, and ledger each one.
- [ ] **Step 3: Run the load test.** Run `npm run load-test`. Expected: 0 errors, a 95th percentile under 250 ms and a maximum under 1,000 ms locally. Record the numbers in the README.
- [ ] **Step 4: Update the README** with:
  - **Setting `HOST_PASSCODE` in Netlify:** Project configuration → Environment variables → Add a variable, with scope Functions included, then redeploy.
  - **Checking the deploy:** visit `/api/health`, which should show the word counts.
  - **How to run a lesson:**
    1. Open `/host`.
    2. Type the passcode.
    3. Put the code on the projector.
    4. Students go to the site and type the code and a name.
    5. Use ⚙ for the overlay, or open the control window on your laptop or phone.
  - **The connection test:** it now lives at `/check/`.
  - **Troubleshooting:** students can't connect (try `/check/` on a school laptop), "no passcode set", and a deploy that failed on word lists.
- [ ] **Step 5: Run all the tests, the type check and the E2E tests.** Run `npm test && npx tsc -p tsconfig.json && npm run test:e2e`. Expected: all pass.
- [ ] **Step 6: Commit** with the message `test: end-to-end, load test; docs: how to run a lesson`.
