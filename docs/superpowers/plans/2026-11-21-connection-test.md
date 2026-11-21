# Connection Test Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small page Roy opens on a school laptop on the school network. It reports in plain language whether the page loads, whether the game server answers, whether a live connection (WebSocket) works, and whether that connection survives a lesson-length session.

**Architecture:** Netlify serves the static page from `public/`. A Netlify Server entry file handles `/api/*`: `GET /api/ping` returns JSON, and `/api/ws` upgrades to a WebSocket that echoes pings and sends a heartbeat. All logic lives in pure modules with injected dependencies, so it is unit-tested locally without `@netlify/server` installed. Only the entry file imports from `@netlify/server`.

**Tech Stack:**
- **Server:** TypeScript on Netlify Server (Early Access, Node 24).
- **Browser:** plain browser ES modules, with no framework and no build step for the page.
- **Tests:** `node:test`, run with `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-21-bomb-game-design.md`. This plan covers build-order step 1 only. The spec says nothing else is built until this test passes on the school network.

## Global Constraints

- **Node:** Netlify Server requires Node.js 24 or later, so set `NODE_VERSION = "24"` in `netlify.toml`.
- **Server file:** one server per project, at `netlify/server/index.ts`.
- **Routing:** the server handles only `path: "/api/*"`. Static files in `public/` are served by the CDN, and static files always take precedence over the server.
- **Free plan connection limit:** a connection is closed at 30 minutes, the request duration limit on the Free plan. **This is the key finding to test.** A 45-minute lesson will always see at least one reconnect, so the test must show that reconnecting is quick and lands on the **same server instance**, meaning game state held in memory would survive it.
- **Privacy:** no cookies, no analytics, no personal data. The page stores nothing.
- **Language:** page text in plain English. Roy is the reader, and the results must be copyable so he can paste them back into chat.
- **Workspace limits:** this environment can't install npm packages and can't push to GitHub. `@netlify/server` is listed in `package.json` (`"@netlify/server": "latest"`) and installed by Netlify's build. Locally, only the pure modules are type-checked and tested. Roy uploads the files to GitHub himself.

## Review Focus

1. **The connection closes partway through the long test,** at the 30-minute limit or because of school Wi-Fi. The client must reconnect automatically and log it, and the long test must keep running rather than stopping.
2. **A reconnect lands on a different server instance.** The result must say this plainly, because it breaks the in-memory room design.
3. **The WebSocket is blocked while the plain HTTP request works,** a common school-filter pattern. The page must report "page OK, server OK, live connection blocked", not hang.
4. **A step hangs forever,** for example a WebSocket that never opens. Every step needs a timeout of 10 s that turns into a failure message.
5. **The laptop goes to sleep or the tab is closed during the long test.** On returning, the page must show the time gap honestly as "no data from HH:MM to HH:MM", not count it as a disconnect caused by the network.

---

## File Structure

```
package.json                     scripts, type: module, @netlify/server dep
netlify.toml                     publish = "public", NODE_VERSION = "24"
tsconfig.json                    strict, noEmit, module NodeNext
netlify/server/index.ts          entry: wires check-server to @netlify/server (only file importing it)
netlify/server/check-server.ts   pure request/socket logic
public/index.html                the test page (markup + styles)
public/check-client.js           pure client logic (ES module, JSDoc types)
public/check-page.js             DOM wiring: buttons, rendering, copy-results
tests/check-server.test.ts
tests/check-client.test.ts
README.md                        how Roy uploads to GitHub, connects Netlify, runs the test
```

---

### Task 1: Server logic and entry file

**Files:**
- Create: `package.json`, `netlify.toml`, `tsconfig.json`, `netlify/server/check-server.ts`, `netlify/server/index.ts`
- Test: `tests/check-server.test.ts`

**Interfaces:**
- **Produces, in `check-server.ts`:**
  - `type ServerSocket = { send(data: string): void; close(code?: number, reason?: string): void; addEventListener(type: "message" | "close", fn: (ev: any) => void): void }`
  - `type CheckServerDeps = { instanceId: string; startedAt: number; now: () => number; setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (h: unknown) => void }`
  - `function handlePing(deps: CheckServerDeps): Response`. It returns JSON `{ ok: true, instanceId, startedAt, serverTime }` with the header `cache-control: no-store`.
  - `function attachSocket(socket: ServerSocket, deps: CheckServerDeps): void`. It sends `{type:"hello", instanceId, startedAt, serverTime}` at once. On a `{"type":"ping","id":N}` message it replies `{type:"pong", id:N, instanceId, serverTime}`. Every **20 000 ms** it sends `{type:"heartbeat", instanceId, serverTime}`. It clears the interval on close and ignores messages that aren't JSON.
  - `const HEARTBEAT_MS = 20_000`
- **Produces, in `index.ts`:** a default handler. `/api/ping` calls `handlePing`. An `/api/ws` request with `upgrade: websocket` calls `upgradeWebSocket(req)`, then `attachSocket`, and returns the response. Anything else returns 404. It exports `config = { path: "/api/*" }` and registers `onShutdown` to close every socket with code 1012. `instanceId = crypto.randomUUID()` and `startedAt = Date.now()` are set once at module load.

- [ ] **Step 1: Write the config files.**
  - `package.json`: `"type": "module"`, `"engines": { "node": ">=24" }`, `"dependencies": { "@netlify/server": "latest" }`, and the scripts `"test": "tsx --test tests/*.test.ts"` and `"typecheck": "tsc -p tsconfig.json"`.
  - `netlify.toml`: `[build] publish = "public"` and `[build.environment] NODE_VERSION = "24"`.
  - `tsconfig.json`: strict, `noEmit`, `module`/`moduleResolution` `NodeNext`, target ES2022, lib `ES2022` and `DOM`. Turn on `allowJs` and `checkJs`. Include `netlify/server/check-server.ts`, `public/check-client.js` and `tests`, and exclude `netlify/server/index.ts`, because its import can't be resolved locally.
- [ ] **Step 2: Write the failing tests** in `tests/check-server.test.ts`. Use a fake socket that records `send` calls and stores listeners, plus a fake clock and fake interval.
  - `handlePing returns ok JSON with instanceId and no-store`: `status === 200`, `body.ok === true`, `body.instanceId === "inst-1"`, `headers.get("cache-control") === "no-store"`.
  - `attachSocket sends hello immediately`: the first sent message parses to `type === "hello"` and `instanceId === "inst-1"`.
  - `ping gets pong with same id`: firing a message `{"type":"ping","id":7}` makes the last sent message `{type:"pong", id:7, instanceId:"inst-1"}`.
  - `heartbeat every 20s`: the fake `setInterval` was called with `ms === 20000`, and running its function sends `type === "heartbeat"`.
  - `close clears heartbeat`: firing `close` calls `clearInterval` with the same handle.
  - `non-JSON message is ignored`: firing `"hello there"` sends nothing new and doesn't throw.
- [ ] **Step 3: Run the tests.** Run `npx tsx --test tests/check-server.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 4: Implement `check-server.ts`** to the interfaces above. Then write `index.ts` as specified. It isn't type-checked locally, so keep it to about 30 lines that only wire things together.
- [ ] **Step 5: Run the tests and the type check.** Run `npx tsx --test tests/check-server.test.ts && npx tsc -p tsconfig.json`. Expected: all pass, with no type errors.
- [ ] **Step 6: Commit** with the message `feat: connection-test server logic`.

### Task 2: Client test logic

**Files:**
- Create: `public/check-client.js`
- Test: `tests/check-client.test.ts`

**Interfaces:**
- **Consumes:** the message shapes from Task 1 (`hello`, `pong`, `heartbeat`), the endpoints `/api/ping` and `/api/ws`, and `HEARTBEAT_MS` = 20000, which is duplicated as a constant in the client.
- **Produces, in `check-client.js` (ES module):**
  - `type StepResult = { step: "http" | "ws-open" | "round-trip"; ok: boolean; ms?: number; detail: string }`
  - `async function runQuickChecks(deps): Promise<StepResult[]>`. The deps are `{ fetch, WebSocket, baseUrl, now, setTimeout, clearTimeout }`. The checks run in order:
    1. `GET /api/ping` with a timeout of **10 000 ms**.
    2. Open the WebSocket at `wss://` or `ws://` from `baseUrl` plus `/api/ws`, waiting for `hello` with a timeout of **10 000 ms**.
    3. Send **10** pings 200 ms apart and wait for the pongs, with an overall timeout of 10 000 ms. `ms` is the median round trip.

    Each step runs even if an earlier one fails, except that step 3 is skipped and marked failed with "skipped, live connection didn't open" if step 2 failed.
  - `function startLongTest(deps, onEvent: (e: LongEvent) => void): { stop(): LongSummary }`.
    - **Event types:** `LongEvent = { t: number; kind: "connected" | "disconnected" | "heartbeat" | "gap"; instanceId?: string; code?: number }`.
    - **Reconnecting:** after a close, it reconnects after **1 000 ms**, or **0 ms** if the code is 1012.
    - **Gaps:** a gap is reported when the time between two consecutive checks of a 5 000 ms watchdog interval is more than **15 000 ms**, which means the laptop slept or the tab was frozen. It is emitted as `kind:"gap"` and doesn't count as a disconnect.
  - `function summarizeLong(events: LongEvent[]): LongSummary`, where `LongSummary = { minutes: number; disconnects: number; longestOutageMs: number; instanceIds: string[]; sameInstance: boolean; gaps: number }`.
  - `function verdict(quick: StepResult[], long?: LongSummary): string`. It returns the plain-English lines Roy reads, exactly as in step 2's tests.
  - `function formatReport(quick, long?, userAgent: string, nowIso: string): string`. It returns the copyable text block that starts with `Bomb game connection test`.

- [ ] **Step 1: Write the failing tests** in `tests/check-client.test.ts`. Use a fake WebSocket class and `fetch` you can script, plus a fake clock and timers.
  - `all quick checks pass`: there are three results, all `ok`, and `round-trip` has `ms` equal to the median of the scripted delays.
  - `http ok but websocket never opens → ws-open fails after 10s, round-trip skipped`: `results[1].ok === false`, `results[1].detail` contains `"didn't open"`, and `results[2].detail` contains `"skipped"`.
  - `http fails but websocket works → reported independently`: `results[0].ok === false` and `results[1].ok === true`.
  - `long test reconnects after close and logs it`: a scripted close with code 1006 leads to a reconnect at +1000 ms, and the events include `disconnected` and then `connected`.
  - `code 1012 reconnects immediately`: the reconnect is scheduled with a delay of 0.
  - `summarizeLong flags different instance`: connected events with `instanceId` values `"a"` and then `"b"` give `sameInstance === false` and `instanceIds` equal to `["a","b"]`.
  - `watchdog gap is not a disconnect`: a jump of 60 s in the fake clock between watchdog checks gives one `gap` and `disconnects === 0`.
  - `verdict wording`. The exact strings:
    - All OK, and the long test is the same instance with an outage under 5 s: contains `"✅ Everything works. The game can run on this network."`
    - The WebSocket failed: contains `"❌ The page and server work, but live connections are blocked on this network. Ask IT to allow WebSockets for this site, or we try the fallback host."`
    - A different instance: contains `"⚠️ The connection reconnected to a different server. Tell Claude: the game needs a change before it can use this host."`
    - The long test wasn't run: contains `"Quick checks done. Run the lesson-length test before deciding."`
- [ ] **Step 2: Run the tests.** Run `npx tsx --test tests/check-client.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `check-client.js`.** Plain JS with JSDoc types, with every timer and constructor injected through `deps` and no DOM access in this file.
- [ ] **Step 4: Run all the tests.** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat: connection-test client logic`.

### Task 3: The page, the README and the final check

**Files:**
- Create: `public/index.html`, `public/check-page.js`, `README.md`

**Interfaces:**
- **Consumes:** `runQuickChecks`, `startLongTest`, `summarizeLong`, `verdict` and `formatReport` from `public/check-client.js`. `check-page.js` passes in the real `fetch`, `WebSocket`, `location.origin`, `Date.now`, `setTimeout` and `clearTimeout`.

- [ ] **Step 1: Build the page.** `index.html` has the heading "Bomb game – connection test", a short line saying what it checks and that nothing is stored, and the item "1. Page loads ✅", which is shown as soon as the script runs.
  - **Quick checks:** they run automatically on load and are shown as items 2–4 with ✅/❌ and the detail.
  - **Lesson-length test:** a button labelled "Start lesson-length test (50 min)". The test shows a live timer and a running log, and stops itself after **50 minutes** or when "Stop" is pressed.
  - **Results:** a verdict box, plus a "Copy results" button that copies `formatReport(...)` to the clipboard, falling back to selecting the text in a `<textarea>`.
  - **Layout:** readable on a laptop, with no external fonts or scripts.
- [ ] **Step 2: Write the README for Roy.** It has numbered steps:
  1. Create a GitHub repository called `bomb-game`.
  2. Upload all the files (Add file → Upload files), keeping the folders.
  3. In Netlify, choose Add new project → Import from GitHub, then pick the repository. Leave the settings alone, because `netlify.toml` sets them.
  4. Wait for "Published".
  5. At school, on a school laptop on the school network (not a phone hotspot), open the site address, wait for the quick checks, then start the lesson-length test and leave the tab open.
  6. Press "Copy results" and paste them into the chat.

  The README also covers what to do if the Netlify build fails: copy the end of the deploy log into the chat.
- [ ] **Step 3: Check the page in a browser.** Serve `public/` locally with `npx tsx` running a tiny static server script, or `python3 -m http.server`, then open it in Playwright with no backend. Expected: "1. Page loads ✅" appears, the HTTP and WebSocket checks fail cleanly within about 10 s with the failure wording, and the verdict box and Copy button render. Take a screenshot and look at it.
- [ ] **Step 4: Run all the checks.** Run `npm test && npx tsc -p tsconfig.json`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat: connection-test page and setup guide`.
