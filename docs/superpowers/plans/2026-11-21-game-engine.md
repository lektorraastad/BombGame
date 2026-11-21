# Game Engine Implementation Plan (plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure TypeScript game engine that runs complete Classic and Everyone-at-once games, with ghost mode, host controls and per-audience views. It is fully unit-tested with a fake clock and has no network code.

**Architecture:**
- **Core:** `src/engine/` holds the room, players, lifecycle, lives, bonus alphabet, word rules and views.
- **Plug-ins:** game modes, knocked-out activities and prompt types are plug-ins in their own folders, listed in `src/engine/registry.ts`.
- **Settings:** each plug-in declares its own settings, and the host panel (plan 3) will be built from these declarations.
- **Isolation:** the engine never touches the network, the real clock or `Math.random`. Everything comes in through `EngineDeps`.

**Tech Stack:** TypeScript (strict), `node:test` run with `tsx`, and no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-21-bomb-game-design.md`

**The three plans:**
1. **This plan:** the engine.
2. **Word lists and prompt generator:** the build-time script, difficulty bands and real dictionary and block lists. This workspace can't download files, so the lists will be fetched during Netlify's build or supplied by Roy.
3. **The playable game:** the server and protocol on Netlify Server, joining, the host passcode, the projector view, the control panel (second window, phone and overlay), the player screen, sound, a load test with 32 bots, and replacing the connection test page.

Plan 3 starts only when plans 1 and 2 are done. Roy chose to continue without the school-network lesson-length test, so note in plan 3 that hosting may still change. The engine is unaffected either way.

## Global Constraints

Values copied from the spec. Every task must respect them.

- **Room code:** 4 letters, no I, L or O. **Max players per room:** 32. **Classic** suits about 2–16 players; there's no hard cap below 32, and the projector simply gets crowded. **Minimum to start:** 2 players.
- **Nicknames:**
  - **Length:** 2–16 characters after trimming.
  - **Duplicates:** a duplicate gets " 2", " 3" and so on, with the suffix counted within the 16-character limit (truncate the base).
  - **Rude names:** names matching the block list are refused. The list covers English and Norwegian.
  - **Host:** the host can rename anyone.
- **Answers:**
  - **Normalising:** trim and lower-case the input. Letters a–z, apostrophes and hyphens only, and anything else makes it invalid.
  - **Validity:** a word must be in the dictionary, match the prompt for its prompt type, and not be on the block list.
- **No reuse:**
  - **Classic:** each word once per game for the whole room.
  - **Everyone at once:** a player can't reuse their own words, and different players may share a word.
  - **Private answers:** ghost and silent answers never use up words for the room.
- **Difficulty bands:** Easy has at least 200 fitting known words, Medium 60–199 and Hard 20–59, and the host can also pick Mixed. **Minimum answers per prompt:** 20 known words. Prompts are 2–3 letter chunks, and the prompt types are `contains`, `starts`, `ends`.
- **Classic timer:**
  - **Original style:** the fuse is hidden and random between the min and max, default 10–30 s. A valid word with less than the minimum turn time left (default 5 s) tops the fuse up to that minimum. Every explosion starts a new random fuse.
  - **Classroom style:** a visible fixed countdown per turn, default 12 s.
- **Everyone-at-once timer:**
  - **Round length:** a visible countdown, default 15 s.
  - **Shrinking rounds:** an optional switch makes each round 1 s shorter, down to a floor of 6 s.
- **Lives:** start with 2 and allow a maximum of 3 (host settings).
- **Bonus alphabet:**
  - **On by default:** the letters A–Z except Q, X and Z, which the host can change.
  - **The bonus:** using every bonus letter across your own valid real-turn words gives +1 life, up to the maximum, and then the set resets.
- **Ghost mode:**
  - **Ghost answers:** valid ghost words earn ghost points. They're private, don't use up room words, and can't affect survivors.
  - **Comeback:** on by default. Three valid ghost words on consecutive prompts (Classic) or rounds (Everyone) bring a ghost back with one life, at most once per player per game.
  - **Comeback cut-off:** comebacks are off once only 2 players are alive.
- **Silent answering (Classic):** on by default. Waiting players answer privately for points. It doesn't use up room words, doesn't count toward the bonus alphabet, and doesn't affect the turn.
- **Example answers:** after each explosion, show 2–3 example words for that prompt (a host switch, on by default).
- **Live typing:** a host switch, off by default. When it's off, the projector view never carries the current player's half-typed text.
- **Everyone at once:** the projector shows ticks, not words, during a round. If everyone left loses their last life in the same round, they share the win.
- **Rules lock:** rules are locked once a game starts and can be changed between games. **Late joiners** become spectators until the next game.
- **Host controls during a game:** pause and resume, skip prompt, kick, rename, lock or unlock the room, and end the game. **Kick** also bans the kicked player's token from rejoining the room.
- **Privacy:** no persistence and no logging of nicknames. The engine holds state in memory only.

## Review Focus

1. **The current Classic player is kicked or leaves during their turn.** The turn must pass at once to the next alive player with a new prompt and a fresh fuse, with no life lost. → Task 6 test `kicking the current player passes the turn`.
2. **Pausing in the middle of a fuse.** Resuming must restore exactly the remaining time, not a new fuse, and submissions while paused are rejected. → Task 5 test `pause freezes remaining time`.
3. **A word arrives right as the bomb explodes.** The engine runs on a single thread, so the explosion is processed first. The late word is then rejected with `not-your-turn` and never accepted. → Task 6 test `submission after explosion is rejected`.
4. **Messy input** such as `"  Elephant!"`, `"ÉLAN"`, `""` or a 60-character string. It must be normalised or rejected with a reason, never thrown or counted as used. → Task 2 test `normalise rejects and cleans input`.
5. **A disconnected player keeps their seat.** In Classic their turn still runs, so they can lose a life. When they reconnect, they get back the same lives, ghost state and score. → Task 4 test `reconnect restores the same player`, Task 6 test `disconnected player's turn still runs`.

---

## File Structure

```
src/engine/
  types.ts            shared types: PlayerId, Prompt, EngineDeps, events, results
  settings.ts         SettingDecl, resolveSettings()
  words.ts            normalise(), WordChecker interface, createWordChecker()
  prompts.ts          PromptBank: band filtering, no immediate repeats, examples
  room.ts             Room: players, joining, kicking, locking, lifecycle, lives, bonus alphabet, timers
  views.ts            projectorView(), playerView(), controlView()
  registry.ts         lists modes, knocked-out activities and prompt types
  modes/README.md     how to add a mode (worked example)
  modes/mode.ts       GameMode and ModeContext interfaces
  modes/classic.ts
  modes/everyone.ts
  knockout/README.md  how to add a knocked-out activity
  knockout/activity.ts KnockoutActivity interface
  knockout/ghost.ts
tests/engine/
  helpers.ts          fake deps (clock, timers, seeded rng), tiny word list, prompt bank, room factory
  settings.test.ts  words.test.ts  prompts.test.ts  room.test.ts
  lifecycle.test.ts classic.test.ts everyone.test.ts ghost.test.ts views.test.ts
docs/EXTENDING.md     guide at the repository root, pointing to the plug-in READMEs
```

The test helper `tests/engine/helpers.ts` reuses the virtual-clock pattern from `tests/fakes.ts`, which is `makeClock()`. Import it, don't copy it.

---

### Task 1: Types and settings

**Files:**
- Create: `src/engine/types.ts`, `src/engine/settings.ts`, `tests/engine/helpers.ts`
- Modify: `tsconfig.json` (add `src` to `include`)
- Test: `tests/engine/settings.test.ts`

**Interfaces (produced):**
- **`EngineDeps`:**
  ```ts
  type EngineDeps = { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; random(): number }
  ```
  `random` returns a number in [0, 1).
- **Prompts:**
  ```ts
  type PromptType = "contains" | "starts" | "ends";
  type Prompt = { text: string; type: PromptType; count: number }
  ```
  `count` is the number of fitting known words.
- **Bands:** `type Band = "easy" | "medium" | "hard" | "mixed"`.
- **Setting declarations:**
  ```ts
  type SettingDecl =
    | { key: string; label: string; help: string; kind: "number"; default: number; min: number; max: number; step: number; unit?: "s" | "lives" }
    | { key: string; label: string; help: string; kind: "boolean"; default: boolean }
    | { key: string; label: string; help: string; kind: "choice"; default: string; options: { value: string; label: string }[] }
    | { key: string; label: string; help: string; kind: "multi"; default: string[]; options: { value: string; label: string }[] }
  ```
- **Resolving settings:** `type Settings = Record<string, number | boolean | string | string[]>` and `resolveSettings(decls: SettingDecl[], input: Record<string, unknown>): Settings`. It fills in defaults and clamps numbers to [min, max], rounding to `step`. Wrong types and unknown choices fall back to the default, and unknown keys are dropped.
- **Core settings:** `CORE_SETTINGS: SettingDecl[]` with these keys:

  | Key | Default |
  |---|---|
  | `mode` | `"classic"` |
  | `band` | `"mixed"` |
  | `promptTypes` | `["contains"]` |
  | `startLives` | 2 (1–5) |
  | `maxLives` | 3 (1–6) |
  | `bonusAlphabet` | `true` |
  | `bonusLetters` | `"abcdefghijklmnoprstuvwy"` |
  | `knockout` | `"ghost"` |
  | `exampleAnswers` | `true` |
  | `liveTyping` | `false` |

  The `mode` and `knockout` options come from the registry at runtime (Task 9). Until then, use these exact values.
- **Test helpers:** `makeDeps(seed = 1)` returns `{ deps: EngineDeps, clock }`, using `makeClock` plus a seeded mulberry32 for `random`. `fixtureWords`, `fixturePrompts` and `makeTestChecker()` are filled in by Task 2.

- [ ] **Step 1: Write the failing tests** in `settings.test.ts`:
  - `defaults fill missing keys`: an empty input gives `startLives === 2` and `promptTypes` deep-equal to `["contains"]`.
  - `numbers are clamped and stepped`: `startLives: 99` gives 5, and `-3` gives 1. For a decl with step 0.5, 2.26 gives 2.5.
  - `wrong types fall back to default`: `liveTyping: "yes"` gives `false`, and `band: "extreme"` gives `"mixed"`.
  - `multi keeps only known options and never empties`: `promptTypes: ["ends","bogus"]` gives `["ends"]`, and `[]` gives the default.
  - `unknown keys are dropped`.
- [ ] **Step 2: Run the tests.** Run `npx tsx --test tests/engine/settings.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `types.ts` and `settings.ts`, add `src` to the tsconfig `include`, and write `helpers.ts` (deps only for now).
- [ ] **Step 4: Run the tests and the type check.** Run `npm test && npx tsc -p tsconfig.json`. Expected: all pass, including the 31 existing tests.
- [ ] **Step 5: Commit** with the message `feat(engine): types and settings`.

### Task 2: Word rules

**Files:**
- Create: `src/engine/words.ts`
- Test: `tests/engine/words.test.ts`, and extend `helpers.ts`

**Interfaces (produced):**
- **Normalising:** `normalise(raw: string): { ok: true; word: string } | { ok: false; reason: "empty" | "too-long" | "bad-characters" }`.
  - **Steps:** trim, lower-case, then strip one trailing `.`, `!` or `?`.
  - **Allowed characters:** `^[a-z]+(['-][a-z]+)*$`.
  - **Length:** at most 30 characters, otherwise `too-long`.
- **The checker:**
  ```ts
  interface WordChecker { isWord(w: string): boolean; isBlocked(w: string): boolean; matches(p: Prompt, w: string): boolean; examples(p: Prompt, n: number, random: () => number): string[] }
  ```
- **Building one:** `createWordChecker(opts: { dictionary: Iterable<string>; known: Iterable<string>; blocked: Iterable<string> }): WordChecker`. `examples` picks from the **known** words that match and aren't blocked.
- **Matching:** `contains` uses `includes`, `starts` uses `startsWith`, and `ends` uses `endsWith`, all on the normalised word.
- **Name check:** `isBlockedName(name: string, blocked: Iterable<string>): boolean`. The name is lower-cased and has spaces, digits and punctuation removed. It's blocked if it contains any blocked word that is 4 or more letters long, or if it equals any blocked word of any length.
- **Fixtures:** `helpers.ts` gets `fixtureWords` (about 80 common words that cover the prompts "an", "ing", "re", "st", "ou"), `fixtureBlocked = ["damn", "faen", "dritt"]` and `makeTestChecker()`.

- [ ] **Step 1: Write the failing tests** in `words.test.ts`:
  - `normalise rejects and cleans input`:
    - `"  Elephant!"` gives `{ok:true, word:"elephant"}`.
    - `"ÉLAN"` gives `bad-characters`.
    - `""` and `"   "` give `empty`.
    - 31 letters give `too-long`.
    - `"don't"` and `"well-known"` are accepted.
    - `"a--b"` gives `bad-characters`.
  - `matches by prompt type`: "station" matches contains "at", starts "st" and ends "on", but not ends "st".
  - `blocked words are not valid even if in dictionary`.
  - `examples come from known words only and respect n`: they come back as a subset of the known words that match, with length ≤ n.
  - `isBlockedName catches embedded words and Norwegian`: `"FaenLol"` and `"d.r.i.t.t"` are blocked, and `"Hassan"` is not, even though it contains "ass" (fewer than 4 letters and not an equal match).
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `words.ts`.**
- [ ] **Step 4: Run all the tests.** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(engine): word rules`.

### Task 3: Prompt bank

**Files:**
- Create: `src/engine/prompts.ts`
- Test: `tests/engine/prompts.test.ts`, and extend `helpers.ts` with `fixturePrompts: Prompt[]`

**Interfaces (produced):**
- **Bands:** `BAND_RANGES = { easy: [200, Infinity], medium: [60, 199], hard: [20, 59] }` and `MIN_ANSWERS = 20`.
- **Creating a bank:** `createPromptBank(prompts: Prompt[]): PromptBank`. Prompts with `count < MIN_ANSWERS` are dropped when the bank is built.
- **The bank:**
  ```ts
  interface PromptBank { next(opts: { band: Band; types: PromptType[]; random: () => number; avoid: string[] }): Prompt; size(band: Band, types: PromptType[]): number }
  ```
  - **Choosing a prompt:** `next` picks at random from prompts of an allowed type within the band. `mixed` means any prompt with `count ≥ 20`.
  - **Avoiding repeats:** it skips any prompt whose `type:text` is in `avoid`, and falls back to ignoring `avoid` if that would leave nothing.
  - **Empty selection:** if the band and types together have no prompts, it throws `Error("no prompts for band/types")`. The room (Task 5) checks `size` before starting and refuses with a reason, so this never throws mid-game.

- [ ] **Step 1: Write the failing tests:**
  - `drops prompts under 20 answers`: a prompt with count 19 is never returned, and `size` excludes it.
  - `respects band and types`: 200 draws with band `hard` and types `["ends"]` all have `type === "ends"` and a count from 20 to 59.
  - `avoid prevents immediate repeats`: with two eligible prompts and `avoid` containing one, the other is always returned.
  - `avoid is ignored when it would leave nothing`.
  - `throws when nothing matches`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `prompts.ts`.**
- [ ] **Step 4: Run all the tests.** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(engine): prompt bank`.

### Task 4: Room, players and joining

**Files:**
- Create: `src/engine/room.ts` (the lifecycle part comes in Task 5)
- Test: `tests/engine/room.test.ts`

**Interfaces (produced):**
- **Players:** `type PlayerId = string` (an opaque id from the engine, never shown).
  ```ts
  type Player = { id: PlayerId; token: string; nickname: string; connected: boolean; role: "player" | "spectator"; lives: number; alive: boolean; score: number; ghostPoints: number; bonusUsed: Set<string>; comebackUsed: boolean; ghostStreak: number; lastWord?: string }
  ```
- **Room codes:** `ROOM_CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ"` (no I, L or O) and `makeRoomCode(random: () => number, taken: Set<string>): string` (4 letters, retrying on a clash).
- **Creating a room:** `class Room { constructor(opts: { code: string; deps: EngineDeps; checker: WordChecker; bank: PromptBank; blockedNames: Iterable<string>; onChange?: () => void }) }`.
- **Joining:** `join(token: string, nickname: string): { ok: true; playerId: PlayerId } | { ok: false; reason: "locked" | "full" | "kicked" | "name-length" | "name-blocked" }`.
  - **Known token:** a token already in the room counts as a **reconnect**. The player's nickname and state are kept and `connected` is set to true.
  - **Nickname rules:** see Global Constraints.
  - **During a game:** a new player who joins mid-game gets `role: "spectator"`.
  - **Room limit:** 32 is counted over non-spectators plus spectators together.
- **Other player actions:**
  - `disconnect(playerId)` sets `connected = false` and keeps everything else.
  - `kick(playerId)` removes the player and adds their token to the banned set.
  - `rename(playerId, nickname)` uses the same rules as joining and returns the same result shape.
  - `setLocked(locked: boolean)` locks or unlocks the room.
- **Reading state:** the `players(): Player[]` getter returns players in join order. `onChange` is called after every state change.

- [ ] **Step 1: Write the failing tests:**
  - `room code avoids I L O and clashes`: a code has 4 letters with none of I, L or O, and a forced clash retries.
  - `join assigns unique nicknames`: "Mia" joining three times gives `["Mia", "Mia 2", "Mia 3"]`. A 16-character name joining twice truncates the base so the result is at most 16 characters.
  - `nickname length and block list`: `"A"` gives `name-length`, and `"faenboy"` gives `name-blocked`.
  - `reconnect restores the same player`: join, disconnect, then join with the same token gives the same `playerId` and nickname with `connected` true. Lives and score are unchanged after setting `lives = 1; score = 7` directly.
  - `kick bans the token`: after a kick, joining with the same token gives `kicked`, while a new token can still join.
  - `lock blocks new tokens but not reconnects`.
  - `full at 32`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** the player-management part of `room.ts`.
- [ ] **Step 4: Run all the tests.** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(engine): room and players`.

### Task 5: Mode interface and game lifecycle

**Files:**
- Create: `src/engine/modes/mode.ts`, `src/engine/knockout/activity.ts`
- Modify: `src/engine/room.ts`
- Test: `tests/engine/lifecycle.test.ts`. It uses a **fake mode** defined in the test file, which deals one prompt to every alive player and explodes after `settings.testFuseMs`.

**Interfaces (produced):**
- **`GameMode`:** the engine calls these hooks, and the mode never touches timers directly.
  ```ts
  interface GameMode {
    id: string; name: string; description: string; settings: SettingDecl[];
    start(ctx: ModeContext): void;                         // deal first prompt, arm bomb
    onWord(ctx: ModeContext, pid: PlayerId, word: string): void;   // word already normalised, valid, and from a player who isOn
    onExplode(ctx: ModeContext): void;                     // bomb timer fired
    onPlayerGone(ctx: ModeContext, pid: PlayerId): void;   // kicked
    onSkip(ctx: ModeContext): void;                        // host pressed "skip prompt": new prompt, same player(s), re-arm by the mode's rule
    isOn(ctx: ModeContext, pid: PlayerId): boolean;        // may this player's words count as real turns now?
    usedScope: "room" | "player";                          // no-reuse rule
    view(ctx: ModeContext): Record<string, unknown>;       // mode-specific public data for views
  }
  ```
- **`ModeContext`:** what the engine hands to modes.
  ```ts
  interface ModeContext {
    settings: Settings; random(): number; now(): number;
    alive(): Player[];                  // alive players with role "player", in seat order
    prompt(): Prompt | null;
    newPrompt(): Prompt;                // from the bank using band/types and avoid = the last 10 prompts
    armBomb(ms: number, visible: boolean): void; // replaces any armed bomb; pausable
    bombRemaining(): number;
    loseLife(pid: PlayerId): void;      // handles the knockout and calls the activity
    acceptWord(pid: PlayerId, word: string): void; // marks the word used, adds score +1, applies the bonus alphabet
    explodedPrompt(p: Prompt): void;    // records example answers for views
    endGame(winners: PlayerId[]): void;
    state: Record<string, unknown>;     // the mode's private state, reset each game
  }
  ```
- **`KnockoutActivity`:**
  ```ts
  interface KnockoutActivity { id: string; name: string; description: string; settings: SettingDecl[];
    onKnockedOut(ctx: ModeContext, pid: PlayerId): void; onPrompt(ctx: ModeContext): void;
    onWord(ctx: ModeContext, pid: PlayerId, word: string): SubmitResult; view(ctx: ModeContext, pid: PlayerId): Record<string, unknown> }
  ```
  `onPrompt` is called whenever a new prompt or round starts. Ghost mode uses it to break streaks.
- **Room methods for the host:**
  - **`updateSettings(input): { ok: boolean; reason?: "game-running" }`:** it resolves the settings against `CORE_SETTINGS` plus the chosen mode and activity declarations.
  - **`start(): { ok: true } | { ok: false; reason: "need-2-players" | "no-prompts" | "already-running" }`:**
    - **Players:** spectators become players.
    - **Lives and state:** every player gets `startLives` and has their game state cleared.
    - **Prompts:** if the bank has no prompts for the band and types, the game refuses to start with `no-prompts`.
  - **`pause()` and `resume()`:** pausing freezes the bomb timer at its remaining time.
  - **`skipPrompt()`:** calls `mode.onSkip(ctx)`. Nobody loses a life.
  - **`endGame()`:** ends the game with no winners.
  - **`playAgain()`:** goes back to the lobby, keeping players and settings.
- **Room methods for players:**
  - **`submit(pid, raw): SubmitResult`**, where
    ```ts
    type SubmitResult = { ok: true; kind: "turn" | "silent" | "ghost" } | { ok: false; reason: "not-playing" | "paused" | "empty" | "too-long" | "bad-characters" | "not-a-word" | "doesnt-match" | "used" | "blocked" | "not-your-turn" }
    ```
  - **How a submission is routed:** first the word is normalised, then the checker runs.
    - A player who is alive and `isOn` goes to `mode.onWord`.
    - A player who is alive, not on, and in Classic with `silentAnswers` switched on gets silent points (+1 `score`, private, nothing marked used).
    - A dead player goes to `activity.onWord`.
  - **`typing(pid, text)`:** stores the live text only when `liveTyping` is on, otherwise it's ignored.
- **Phases:** `phase: "lobby" | "playing" | "paused" | "results"`. Results hold `winners: PlayerId[]`, plus the ghost leaderboard and longest word, both computed in views.
- **Lives and the bonus alphabet:** both live inside `acceptWord` and `loseLife`, in the room.
  - **Bonus letters:** they come from the `bonusLetters` setting.
  - **Completing the set:** a completed set gives +1 life (capped at `maxLives`) and then clears `bonusUsed`.

- [ ] **Step 1: Write the failing tests:**
  - `cannot start with fewer than 2 players`.
  - `cannot start when band/types have no prompts`.
  - `settings locked while playing`: `updateSettings` returns `game-running`.
  - `start gives everyone startLives and makes spectators players`.
  - `pause freezes remaining time`: arm 10 000 ms, advance 4 000 ms, pause, advance 60 000 ms, resume, and `bombRemaining()` is 6 000. A `submit` while paused gives `paused`.
  - `bonus alphabet gives a life and resets`: with `bonusLetters: "abc"` and `maxLives: 3`, starting at 2 lives, the accepted words "ab" and then "cab" give 3 lives and an empty `bonusUsed`. At max lives the set still resets but lives stay at 3.
  - `loseLife to zero knocks out and calls activity`.
  - `room-scope reuse is rejected`: in the fake mode with `usedScope: "room"`, a second player's same word gives `used`.
  - `invalid words return reasons in order`: an empty string gives `empty`, "zzzzq" gives `not-a-word`, and a word that is real but doesn't match gives `doesnt-match`.
  - `playAgain returns to lobby with same players`.
  - `typing ignored unless liveTyping`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** `mode.ts`, `activity.ts` and the lifecycle in `room.ts`, using a **no-op knocked-out activity** as the default until Task 8.
- [ ] **Step 4: Run all the tests.** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(engine): mode interface and lifecycle`.

### Task 6: Classic mode

**Files:**
- Create: `src/engine/modes/classic.ts`
- Test: `tests/engine/classic.test.ts`

**Interfaces:**
- **Consumes:** `GameMode` and `ModeContext` (Task 5).
- **Produces:** `classicMode: GameMode` with `id: "classic"` and `usedScope: "room"`. Its settings:

  | Key | Default |
  |---|---|
  | `timerStyle` | `"hidden"` (or `"visible"`) |
  | `fuseMin` | 10 s (3–60) |
  | `fuseMax` | 30 s (5–90) |
  | `minTurn` | 5 s (2–15) |
  | `turnTime` | 12 s (5–60) |
  | `silentAnswers` | `true` |

  If `fuseMax < fuseMin`, the two are swapped.
- **The view:** `view()` returns `{ seats: PlayerId[]; current: PlayerId; timerStyle; bombEndsAt?: number }`. `bombEndsAt` is present only when the timer is visible.

**Behaviour:**
- **Start:** a random seat starts.
- **Hidden fuse:** the fuse is `fuseMin + random*(fuseMax-fuseMin)`.
- **A valid word:** `acceptWord`, then a new prompt and the next alive seat. In hidden mode the fuse keeps running, topped up to `minTurn` if it's lower. In visible mode it re-arms at `turnTime`.
- **An explosion:** `explodedPrompt`, then `loseLife(current)`, then a new prompt for the next alive seat and a new fuse (random for hidden, `turnTime` for visible). The game ends with a winner when one player is left alive.

- [ ] **Step 1: Write the failing tests:**
  - `turn order skips dead players`.
  - `hidden fuse is within min and max`: over 50 seeds, it's between 10 000 and 30 000 ms.
  - `valid word passes turn and tops up fuse to minTurn`: with 2 000 ms left, a valid word makes `bombRemaining` 5 000.
  - `valid word with plenty of time keeps the remaining fuse`.
  - `visible style resets to turnTime each turn`.
  - `explosion costs current player a life and records examples`.
  - `submission after explosion is rejected`: advance exactly to the explosion, then submit a word for the old prompt from the exploded player. The result is `{ok:false, reason:"not-your-turn"}`, and their lives went down by exactly 1.
  - `skip gives a new prompt to the same player without losing a life`.
  - `waiting player's word is silent: scored, private, not used`.
  - `silentAnswers off → waiting player's word rejected not-your-turn`.
  - `kicking the current player passes the turn`: the next alive player is on with a new prompt and a fresh fuse, and nobody lost a life.
  - `disconnected player's turn still runs`.
  - `last player alive wins`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `classic.ts`.** Make whatever small adjustments `room.ts` needs (for example `onPlayerGone` wiring), and ledger each one.
- [ ] **Step 4: Run all the tests.** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(engine): classic mode`.

### Task 7: Everyone-at-once mode

**Files:**
- Create: `src/engine/modes/everyone.ts`
- Test: `tests/engine/everyone.test.ts`

**Interfaces:**
- **Produces:** `everyoneMode: GameMode` with `id: "everyone"` and `usedScope: "player"`. Its settings:

  | Key | Default |
  |---|---|
  | `roundTime` | 15 s (6–60) |
  | `shrinking` | `false` |

  `isOn` means the player is alive and hasn't answered this round.
- **The view:** `view()` returns `{ round: number; answered: PlayerId[]; bombEndsAt: number }`. It never contains words.

**Behaviour:**
- **A round:** each round deals one prompt to every alive player.
- **Shrinking:** when shrinking is on, round n lasts `max(6, roundTime − (n−1))` seconds.
- **An explosion:** everyone alive who hasn't answered loses a life, all at once. Then `explodedPrompt` runs.
- **The end:**
  - **One survivor:** if exactly one player is alive, they win.
  - **Nobody left:** if no one is alive, the players who were alive at the start of that round share the win.
  - **Otherwise:** the next round starts.

- [ ] **Step 1: Write the failing tests:**
  - `everyone gets the same prompt and answering once marks answered`, and a second word in the same round gives `not-your-turn`.
  - `skip restarts the round with a new prompt and clears answered`.
  - `same word by two players is allowed; own reuse across rounds is rejected`.
  - `non-answerers lose a life at explosion`.
  - `shrinking rounds floor at 6s`: with `roundTime` 8, rounds 1–4 last 8, 7, 6 and 6 s.
  - `shared win when everyone dies in the same round`.
  - `view never contains words`: `JSON.stringify(view)` doesn't include the submitted word.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `everyone.ts`.**
- [ ] **Step 4: Run all the tests.** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(engine): everyone-at-once mode`.

### Task 8: Ghost mode

**Files:**
- Create: `src/engine/knockout/ghost.ts`
- Test: `tests/engine/ghost.test.ts`

**Interfaces:**
- **Produces:** `ghostActivity: KnockoutActivity` with `id: "ghost"`. Its settings are `comeback` (default `true`) and `comebackStreak` (default 3, range 2–6).
- **The view:** `view(ctx, pid)` returns `{ ghostPoints; streak; comebackAvailable: boolean }`.

**Behaviour:**
- **Answering:** a valid word that matches the current prompt gives +1 `ghostPoints`. Words are checked against the player's own ghost words, so a ghost can't reuse their own words but never uses up room words.
- **Streaks:** answering counts once per prompt or round, and further words on the same prompt score points without adding to the streak. `onPrompt` resets the streak to 0 for ghosts who didn't answer the previous prompt.
- **Comebacks:** when `streak === comebackStreak` and the comeback is still available, the ghost returns with `alive = true` and `lives = 1`. This happens only if `comeback` is on, `comebackUsed` is false and at least 3 players are alive before the return. Then `comebackUsed` is set to true and the streak to 0.
- **Classic seating:** a returning player re-enters their original seat.

- [ ] **Step 1: Write the failing tests:**
  - `ghost words score privately and do not use room words`: a survivor can still play the same word afterwards.
  - `three consecutive prompts bring a ghost back once`: a second streak of 3 doesn't bring them back again.
  - `missing a prompt resets the streak`.
  - `several words on one prompt count one streak step`.
  - `no comeback when only 2 players alive`.
  - `comeback off → never returns`.
  - `works in everyone mode across rounds`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `ghost.ts`** and make it the default activity.
- [ ] **Step 4: Run all the tests.** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(engine): ghost mode`.

### Task 9: Registry, views and extension guides

**Files:**
- Create: `src/engine/registry.ts`, `src/engine/views.ts`, `src/engine/modes/README.md`, `src/engine/knockout/README.md`, `docs/EXTENDING.md`
- Test: `tests/engine/views.test.ts`

**Interfaces (produced):**
- **Registry:** `MODES: GameMode[] = [classicMode, everyoneMode]` and `ACTIVITIES: KnockoutActivity[] = [ghostActivity]`.
- **Settings for the panel:** `settingsFor(modeId, activityId): SettingDecl[]` returns the core settings plus the mode's plus the activity's. The `mode` and `knockout` choices are filled in from the registry.
- **`projectorView(room)`:** returns `{ code, phase, locked, players: {id, nickname, lives, alive, connected, answered?}[], prompt: {text, type} | null, mode: mode.view(), examples?: string[], typing?: string, results? }`. It **never** includes tokens, ghost points, ghost or silent words, or the `typing` field unless `liveTyping` is on.
- **`playerView(room, pid)`:** the projector view, plus `me: { nickname, lives, alive, score, isOn, bonusLeft: string[], activity?: activity.view() }`.
- **`controlView(room)`:** the projector view, plus `settings`, `settingDecls: settingsFor(...)` and `players[].{score, ghostPoints, role}`. It still contains no tokens.
- **Results:** `winners`, `ghostBoard` (sorted by ghost points), and `longestWord: {nickname, word}` taken from accepted real-turn words.

- [ ] **Step 1: Write the failing tests:**
  - `projector view hides tokens, ghost words and silent words`: play a game where a ghost and a silent player submit "ghostword"-style fixture words. `JSON.stringify(projectorView)` contains no tokens and none of those words.
  - `typing appears only when liveTyping is on`.
  - `settingsFor includes mode and activity settings with registry options`.
  - `results include ghost leaderboard and longest word`.
  - `player view shows remaining bonus letters`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** `registry.ts` and `views.ts`.
- [ ] **Step 4: Write the guides.**
  - **`modes/README.md`:** a worked example that adds a toy "Sudden death" mode (one life, one-second-shorter fuse), shown as code in the README rather than registered.
  - **`knockout/README.md`:** a worked example of a "Cheerleader" activity, where ghosts send 👏 to a survivor.
  - **`docs/EXTENDING.md`:** how to add a mode, an activity, a setting or a prompt type, written for an AI assistant or a non-expert.
- [ ] **Step 5: Run all the tests and the type check.** Run `npm test && npx tsc -p tsconfig.json`. Expected: all pass.
- [ ] **Step 6: Commit** with the message `feat(engine): registry, views, extension guides`.
