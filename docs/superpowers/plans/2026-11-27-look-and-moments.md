# Look and Moments (batch 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Wordfire its approved look (smooth name plates, a soft light, the measured lit-fuse logo) and six short moments with three new projector sounds, without changing any game rule.

**Architecture:** The hub (`src/server/hub.ts`) already compares each broadcast with the one before to send `lastEvent`. It now also sends a list of `moments`, a "refused" moment for the current Classic player, and the hidden-fuse turn's age (`turnElapsedMs`). The browser follows the existing pattern: `motion.js` remembers when each moment arrived, and the pure renderers draw it from elapsed time with negative `animation-delay`. `sound.js` plays the new sounds on the projector only. `src/engine/` rules are untouched.

**Tech Stack:** TypeScript on Node 24 (`tsx --test`), plain ES modules in `public/` with JSDoc types (checked by `tsc`), CSS, Web Audio, Playwright end-to-end tests.

**Spec:** `docs/superpowers/specs/2026-11-27-look-and-moments-design.md` (approved by Roy, 2026-11-27). Read it, `docs/design-principles.md` and `CLAUDE.md` before starting. The mockups are at https://claude.ai/artifact/6PjfAhF8HKd1MjdzEjtYpR (the `.v-cs` stage and the six moments are the visual reference).

## Global Constraints
- No change to game rules, timing, scoring, word checking or settings in `src/engine/`. Only the hub and views change server-side.
- The projector and the ⚙ overlay never show scores, ghost points, tokens or the passcode.
- No moment carries a word a student typed. Refused and silent words never reach a shared screen.
- `turnElapsedMs` is measured from when the current player got the bomb, never from when the fuse was set, and is absent with a visible countdown.
- Moments: under 1 s each (the correct word under 700 ms whatever its length), except the win (about 1.5 s). Never replayed from the first view after a load, refresh or reconnect. With `prefers-reduced-motion: reduce`, each shows its end state without movement.
- Sound plays on the projector only, through the existing level (Normal, Quiet or Off), no louder than today's tick-tock on Normal.
- All player text goes through `esc()`. Renderers stay pure: only `*-page.js` files touch the DOM.
- Every colour comes from a theme token in `public/app/themes.css`. No colour is typed into screen code.
- Logo geometry is exactly section 4.3 of the spec: text `wordfire`, font size 100, letter-spacing −2, Rubik 800. Fuse `M4.9 7.8 C194.36 17.8 454 13.3 456 0`, stroke 5.8, round caps. Flame transform `translate(456 0) scale(1.3214) translate(-20 -56)`. viewBox `0 -76 481 94`.
- Work test-first: watch each test fail before writing the code. Commit after each task. Run `npm test` and `npm run typecheck` before every commit.
- No deploy. Roy tries it on a deploy preview, and never on a lesson day.

## Review Focus
1. **The last explosion ends the game.** One broadcast carries the explosion, the lost heart and the win. The projector and laptops should show the circle for 1.5 s (bomb bursts, heart cracks), then the results with the win burst. The falling note plays about 0.35 s after the boom, and the win tune plays when results appear. Test in Task 4 ("results are held for 1.5 s after a final explosion") and Task 6 ("final explosion orders boom, note, tune").
2. **A reconnect or refresh mid-game.** The first view after a load carries moments. Nothing should replay: no flight, no crack, no chime. Test in Task 4 ("the first view never starts a moment") and Task 6 ("first view plays nothing").
3. **Pause during a hidden-fuse turn.** The turn's age freezes while paused and carries on after resume. The flame must not jump. Test in Task 3 ("turn age freezes while paused").
4. **A host Skip.** The same player gets a new prompt. The turn's age resets, which reveals nothing because the skip gives a fresh fuse. Test in Task 3 ("skip resets the turn age").
5. **30 players with the logo in the corner and two rings.** Nothing overlaps the logo, "Round n" or the ⚙ buttons. Test in Task 7 (e2e "logo and round label clear of seats with 30 players").

---

### Task 1: Name plates, the soft light, and theme tokens

**Files:**
- Modify: `public/app/themes.css` (add 4 tokens to each of the 3 theme blocks and the comment header)
- Modify: `public/app/style.css` (the seat name, the `.seat.on` name, `.seat.out` name, the stage background on projector and laptop)
- Test: `tests/client/themes.test.ts`

**Interfaces:**
- Produces: tokens `--plate`, `--plate-ink`, `--turn-ink`, `--stage-light` in every theme. Later tasks use `--plate` for the logo's corner background (none) and `--names`/`--tile-edge` for the logo.

- [ ] **Step 1: Write the failing tests.** In `tests/client/themes.test.ts`, add the 4 names to `NAMES` (the test title becomes "every theme defines the same 19 colours"). Add to `PAIRS` in "readable in every theme":
  - `["--plate-ink", "--plate", 4.5]`;
  - `["--turn-ink", "--turn", 4.5]`;
  - `["--plate", "--stage", 3]`: the light ring is the turn plate's edge;
  - `["--names", "--stage-light", 4.5]` and `["--muted", "--stage-light", 4.5]`: the soft light never lowers text contrast.

  Add a test "the soft light stays subtle". For each theme, the relative luminance of `--stage-light` is greater than that of `--stage`, and `contrast(--stage-light, --stage)` is at most 1.25.
- [ ] **Step 2: Run it and watch it fail.** Run `npx tsx --test tests/client/themes.test.ts`. Expected: FAIL, with the missing tokens listed.
- [ ] **Step 3: Add the tokens.**
  - Workshop starting values:
    - `--plate: #F3EDE2`
    - `--plate-ink: #2B1D10`
    - `--turn-ink: #FFF4E6`
    - `--stage-light: #2A3846`

    These are the mockup's values. `--turn` stays `#C8243A`.
  - Choose Enamel's and Night fuse's values to pass the tests. Night fuse's `--turn` is yellow, so its `--turn-ink` must be dark.
- [ ] **Step 4: Restyle in `style.css`.**
  - **Names:** `.seat .name` becomes a smooth plate, matching the mockup's `.v-cs .plate`:
    - `--plate` fill and `--plate-ink` text;
    - fully rounded ends (`border-radius: 999px`);
    - no chunky bottom edge and no border;
    - a soft drop shadow.
  - **The turn:** `.seat.on .name` gets the `--turn` fill, `--turn-ink` text and a ring of `--plate` (box-shadow), with no scaling.
  - **Knocked out:** `.seat.out .name` keeps today's faded, dashed look, as a plate.
  - **The soft light:** the projector ring area and the laptop circle get two radial gradients:
    - one of `--stage-light`, centred on the bomb and fading to transparent by about 46% × 56%;
    - one darkening the corners to `color-mix(in srgb, var(--stage) 60%, black)`.
  - **Leave alone:** the letter tiles, the room code, the spotlight and last words.
- [ ] **Step 5: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS. Then run `npm run test:e2e`. Expected: PASS, including the overlap checks.
- [ ] **Step 6: Commit** with the message "Name plates, soft light and four theme tokens".

---

### Task 2: The Wordfire logo and where it goes

**Files:**
- Create: `public/app/logo.js`
- Modify: `public/app/render-projector.js` (lobby, playing screens, results)
- Modify: `public/app/render-player.js` (top bar)
- Modify: `public/app/style.css` (logo sizes and positions)
- Test: `tests/client/logo.test.ts` (new), `tests/client/render-projector.test.ts`, `tests/client/render-player.test.ts`

**Interfaces:**
- Produces:
  - `renderLogo(size: "large" | "small"): string` returns `<svg class="logo logo-<size>" viewBox="0 -76 481 94" role="img" aria-label="Wordfire">…</svg>`.
  - In the SVG, the text uses `fill: var(--names)`, the fuse `stroke: var(--tile-edge)`, the flame's outer path `var(--lives)` and its inner path `var(--spark)`.
  - The text's font is the page's `Rubik`, weight 800.

- [ ] **Step 1: Write the failing tests** in `tests/client/logo.test.ts`:
  - "the logo has the measured geometry": the output contains the exact fuse path `M4.9 7.8 C194.36 17.8 454 13.3 456 0`, `stroke-width="5.8"`, the flame transform `translate(456 0) scale(1.3214) translate(-20 -56)`, `letter-spacing="-2"`, `font-size="100"`, `font-weight="800"` and `viewBox="0 -76 481 94"`;
  - "the logo uses only theme colours": no `#` hex colour appears in the output;
  - "the logo is labelled": `aria-label="Wordfire"`.

  In `render-projector.test.ts`:
  - "the lobby shows the large logo above the address line": the index of `logo-large` is less than the index of `p-goto`;
  - "the playing screens show the small logo": in both Classic and Everyone at once;
  - "results show the large logo".

  In `render-player.test.ts`, "the top bar shows the small logo next to the name".
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/client/logo.test.ts tests/client/render-projector.test.ts tests/client/render-player.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `renderLogo` in `logo.js`.** Copy the flame paths from the spec. The file header says where the numbers came from (the spec's section 4.3) and that they are only valid for this font file, this letter-spacing and this text.
- [ ] **Step 4: Place it.**
  - **Lobby:** large, before `.p-goto`. Size it 90–110 px tall at 1920×1080, and shrink the code tiles if needed so nothing overlaps.
  - **Classic and Everyone at once:** small, top-left. In Everyone at once, `.p-round` moves under it.
  - **Results:** large, at the top, replacing nothing else.
  - **Laptop top bar:** small, next to the name.
  - **Size:** the small logo is at least 24 px tall at 1920×1080.
- [ ] **Step 5: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** with the message "The Wordfire lit-fuse logo".

---

### Task 3: The hub sends moments, refusals and the turn's age

**Files:**
- Modify: `src/server/hub.ts` (`Seen`, `seenOf`, a new `momentsBetween`, `submit`, `broadcast`, `HubRoom`)
- Modify: `src/server/protocol.ts` (only if `ServerMsg` types the view; add the types there if so)
- Test: `tests/server/hub.test.ts`

**Interfaces:**
- Produces, exported from `hub.ts`:
  ```ts
  export type Moment =
    | { kind: "word"; pid: string }            // Classic: lastWord changed; Everyone: a new id in answered
    | { kind: "hearts"; pids: string[] }       // players whose lives went down
    | { kind: "explosion" }
    | { kind: "refused"; pid: string }         // only the current Classic player
    | { kind: "all-answered" }                 // Everyone: every alive player has answered this round
    | { kind: "win"; pids: string[] };         // phase became results with at least one winner
  export const REFUSED_SHOWN: readonly string[] = ["not-a-word", "doesnt-match", "used", "blocked"];
  ```
  Host and player broadcasts gain `moments: Moment[]` (always present, maybe empty). They also gain `turnElapsedMs?: number`, present only when the phase is playing or paused, `mode.current` is a string and the view has no `bombRemainingMs`. Control views get neither. `lastEvent` stays exactly as it is.
- Consumes: `projectorView`, `playerView`, `room.modeView()` and `room.phase` as today, and `deps.now()` for time.

- [ ] **Step 1: Write the failing tests** in `hub.test.ts`, reusing `makeHub`, `hostRoom`, `joinPlayer` and `tick`, with the fake `clock`. Pick the fitting word as in the `lastEvent` test.
  - "moments: word, then explosion with hearts": a Classic game with a visible timer and `turnTime: 5`.
    - An accepted word gives `moments` deep-equal to `[{ kind: "word", pid: on }]`.
    - Advancing 5 s gives `[{ kind: "hearts", pids: [on2] }, { kind: "explosion" }]`, in any order (compare as sets).
  - "two moments between broadcasts are both listed": the explosion broadcast lists both "hearts" and "explosion", as above.
  - "refused is broadcast only for the current Classic player and the four reasons":
    - The current player submits `"zzzz"` and gets `not-a-word`. The next host view has `moments` containing `{ kind: "refused", pid }`.
    - The JSON of that view does not contain `"zzzz"`.
    - The waiting player's refused silent answer causes no refused moment.
    - An `empty` submit causes none.
    - In Everyone at once, a refusal causes none.
  - "all-answered once in Everyone at once": both players answer. The broadcast after the second answer contains `{ kind: "all-answered" }`. Later broadcasts in the same round don't.
  - "win when the game ends": two players, `startLives: 1`, a visible timer. After the bomb, the results view's `moments` contain `{ kind: "win", pids: results.winners }`, plus "hearts" and "explosion".
  - "turn age: present only for a hidden fuse, from the turn's start":
    - In Classic with the hidden timer, the start view has `turnElapsedMs === 0`.
    - After `clock.advance(2000)` and a `lock` command, it is 2000.
    - With `timerStyle: "visible"`, `turnElapsedMs` is undefined.
  - "turn age resets when the bomb passes, and not on a top-up":
    - Use `fuseMin: 3`, `fuseMax: 3`, `minTurn: 8`.
    - The first player answers after 2 s. The next view's age is 0, because the turn passed.
    - The engine topped the fuse up, but the age reflects only the new turn. Advance 1 s and lock: the age is 1000, not reset by the re-arm.
  - "turn age freezes while paused": after 2 s, pause and advance 10 s. The age is still 2000. Resume and advance 1 s: the age is 3000.
  - "skip resets the turn age": after 2 s, skip. The age is 0.
  - "control views carry no moments and no turn age".
  - "the projector view still has no score, ghostPoints, token or passcode": walk the JSON keys of every view in a played game.
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/server/hub.test.ts`. Expected: FAIL, because `moments` is undefined.
- [ ] **Step 3: Implement.**
  - **`Seen`:** extend it with `current: string | null`, `alive: Set<string>` (alive players with role "player"), `winners: string[]` and `promptKey: string`.
  - **`momentsBetween(prev: Seen | null, next: Seen, refused: string | null): Moment[]`:** it applies the same "no moments unless prev was playing" guard as `lastEventBetween`, except that "win" is allowed when `prev.phase === "playing"` and `next.phase === "results"`.
  - **`HubRoom`:** add `refused: string | null` and `turn: { key: string; startedAt: number; pausedAt: number | null; pausedMs: number } | null`.
  - **`submit`:** when the result is not ok, `r.reason` is in `REFUSED_SHOWN`, `room.phase === "playing"`, and `room.modeView()?.current === c.pid` with `Array.isArray(modeView.seats)` (Classic), set `hr.refused = c.pid` and `queueBroadcast(hr)`.
  - **The turn key in `broadcast`:** the key is `${current}|${promptKey}`. A new key starts a new turn at `deps.now()`. Track the pause through the phase.
  - **`broadcast`:** clear `hr.refused` after it is used.
- [ ] **Step 4: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS, including every existing `lastEvent` test.
- [ ] **Step 5: Commit** with the message "Hub: moments, refused turns and the hidden turn's age".

---

### Task 4: Motion remembers moments

**Files:**
- Modify: `public/app/motion.js`
- Test: `tests/client/motion.test.ts`

**Interfaces:**
- Consumes: the view's `moments` and `turnElapsedMs` (Task 3).
- Produces:
  - **New exports from `motion.js`:** `WORD_MS = 650`, `REFUSED_MS = 450`, `HEART_MS = 900`, `WIN_MS = 1500`, `RESULTS_HOLD_MS = 1500`, `EXAMPLES_MS = 4000`, `TENSION_FULL_MS = 25000`.
  - **`createMotion(now)`'s returned object gains these:**
    - `word(): null | { pid: string, word: string, prompt: {text: string, type: string}, fromSpotlight: boolean, elapsedMs: number }`. It is present for `WORD_MS` after a "word" moment in Classic. `word` and `prompt` come from that view's `players[pid].lastWord`. `fromSpotlight` is true when the view before had `typing` for that pid.
    - `refused(): null | { pid: string, elapsedMs: number }`, for `REFUSED_MS`.
    - `hearts(): Map<string, number>`: pid to elapsed ms, each for `HEART_MS`.
    - `win(): null | { pids: string[], elapsedMs: number }`, for `WIN_MS`, counted from when the results are shown (after any hold).
    - `heldView(v: any): any`. It returns the view to draw. During `RESULTS_HOLD_MS` after a results view whose moments include "explosion", it returns `{ ...lastPlayingView, players: v.players, examples: v.examples, phase: "playing", paused: false, moments: [] }`. Otherwise it returns `v`.
    - `examplesShown(v: any): boolean`. It is true while `view.examples` is non-empty and less than `EXAMPLES_MS` has passed since the "explosion" moment that brought them, and (in Classic) the current player hasn't typed yet.
    - `tension(): number`, from 0 to 1: `min(1, turnAge / TENSION_FULL_MS)`. `turnAge` is the last `turnElapsedMs`, plus the local time since that view while not paused. It is 0 when absent.
  - In Everyone at once, a "word" moment starts that seat's existing join pop (`popElapsed(pid)`), so the ✓ arrives with a small pop. There's no flight.
  - `bombState(...)` gains `tension: number` (Task 5's `bomb.js` reads it).
  - `busy()` stays true while any of these run.

- [ ] **Step 1: Write the failing tests** in `motion.test.ts`, using `tracker()` and `classicView`/`everyoneView`:
  - "word moment runs for WORD_MS with the last word and prompt";
  - "fromSpotlight only when the player was typing";
  - "refused, hearts and win time from arrival and end";
  - "the first view never starts a moment": the first view fed carries every kind of moment, and all getters are null or empty;
  - "results are held for 1.5 s after a final explosion": `heldView` returns a playing view with the results view's players until 1500 ms, then the results view, and `win()` starts at 1500;
  - "examples show for 4 s or until the next player types";
  - "tension grows from turnElapsedMs and freezes while paused";
  - "tension is 0 with a visible countdown".
  - "an Everyone word moment pops that seat": `popElapsed(pid)` is a number just after, and null after `POP_MS`.
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/client/motion.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `motion.js`, following the existing pattern: remember `now()` when a moment arrives, and never on the first view.
- [ ] **Step 4: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Motion remembers moments, the results hold and the fuse's tension".

---

### Task 5: Drawing the moments

**Files:**
- Modify: `public/app/render-circle.js` (the flying word, the refused shake, the heart crack, examples in the spotlight's place, `CircleOptions`)
- Modify: `public/app/render-projector.js` (passes motion state through; the win burst on results; drops the faint `.p-examples` line except with more than 20 players, where it becomes bigger)
- Modify: `public/app/render-player.js` (the same circle options; the win burst on the laptop's results)
- Modify: `public/app/bomb.js` (the flame grows with `tension`)
- Modify: `public/app/style.css` (keyframes, all under `@media (prefers-reduced-motion: no-preference)`; the end states without it)
- Test: `tests/client/render-circle.test.ts`, `tests/client/render-projector.test.ts`, `tests/client/render-player.test.ts`, `tests/client/bomb.test.ts`

**Interfaces:**
- Consumes: Task 4's getters, passed into the renderers by the pages.
- Produces: `CircleOptions` gains these optional fields:
  - `word?: ReturnType<Motion["word"]>`;
  - `refused?: ReturnType<Motion["refused"]>`;
  - `hearts?: Map<string, number>`;
  - `examples?: string[] | null`: the words to show in the spotlight's place, or null.

  `BombState` gains `tension: number`, from 0 to 1. `ProjectorUi` and the laptop's UI options gain `win?: ReturnType<Motion["win"]>`.

  Elements and classes the e2e tests rely on:
  - `.fly-word`, with `style="animation-delay:-<ms>ms"`;
  - `.seat.refused` and `.spotlight.refused`;
  - `.lives .crack`, the cracking heart;
  - `.spot-examples`;
  - `.win-burst .burst-tile`;
  - `data-tension` on the bomb root, rounded to 2 decimals.

- [ ] **Step 1: Write the failing tests.**
  - **Flying word:** "a word moment draws one .fly-word with the word's tiles and a negative delay of its elapsed time".
  - **Refused shake:** "refused shakes the spotlight, else the seat's typing, else the name". Cover three views: with a spotlight, with two rings and typing under the seat, and with live typing off.
  - **Hearts:** "a lost heart draws one .crack heart after the remaining hearts". A player at 1 life who lost one shows `❤` then `.crack`.
  - **Example words:**
    - "examples show under the bomb in place of the spotlight and never cover the prompt". `.spot-examples` is present, `.spotlight` is absent, and the bomb still contains the prompt.
    - "with more than 20 seats the examples stay on the bottom line, bigger, and not under the bomb".
  - **Escaping:** "all moment text is escaped". Use a nickname and a lastWord containing `<b>`, and check that `&lt;b&gt;` appears and `<b>` doesn't.
  - **Win:**
    - "the win burst has 16 tiles spelling WORDFIRE twice, only while win() runs";
    - "no win burst without a winner".
  - **Tension, in `bomb.test.ts`:** "tension scales the flame up to 1.45 and is absent when 0".
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/client/render-circle.test.ts tests/client/render-projector.test.ts tests/client/render-player.test.ts tests/client/bomb.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The correct word:** the matched letters hop together (about 200 ms), then the word flies to the seat's last-word slot (about 350 ms) and the seat pops. Without a spotlight it only pops in at the seat. Seat positions come from `seatPosition`, so the flight is drawn in percentages of the ring box.
  - **The refused shake:** about 0.4 s, and the tiles dull for about 0.5 s.
  - **The heart crack:** it swells, then the two halves fall (`clip-path` halves), about 0.9 s.
  - **The win:** the avatar pops, the name tiles drop in 80 ms apart, and 16 tiles burst out and fall, about 1.5 s.
  - **Tension:** the flame scales by `1 + 0.45 × tension`, and its flicker duration goes from 0.9 s to 0.45 s.
  - **Reduced motion:** with it on, the end states only: the word sits in the seat, there's no shake, the heart is gone, and the winner is shown.
- [ ] **Step 4: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Draw the moments: flying word, shake, cracked heart, examples, win, tension".

---

### Task 6: The new sounds

**Files:**
- Modify: `public/app/sound.js`
- Test: `tests/client/sound.test.ts`

**Interfaces:**
- Consumes: the view's `moments` (Task 3), and the projector's held results (Task 4: the page tells the driver when results are actually shown).
- Produces:
  - **`Sound` gains** `chime()`, `fall()`, `fanfare()` and `patter()`.
  - **`createSoundDriver(sound, now)`'s `view(view)`** plays sounds from moments:
    - **"word" in Classic:** `chime()`.
    - **"word" in Everyone at once:** `patter()`, at most one per 160 ms, with extras dropped. The time is checked in `view()`.
    - **"all-answered":** `chime()`.
    - **"hearts":** one `fall()` per view, scheduled about 350 ms after an explosion in the same view (by `now()` in `step()`), and immediately otherwise.
  - **The driver gains `resultsShown()`,** which the page calls when held results appear, and which plays `fanfare()` once per game.
  - **The first view after a load plays nothing.**
  - **Hidden-fuse ticks:** the gap goes from 1000 ms to 700 ms with tension. `step(remainingMs, tension = 0)` takes a new parameter.

**Sound values:**
- `chime`: triangle wave, G5 (784 Hz) for 0.16 s, then C6 (1047 Hz) starting 0.09 s later for 0.3 s.
- `fall`: sine wave, 560 Hz gliding exponentially to 230 Hz over 0.45 s.
- `fanfare`: triangle wave, C5, E5 and G5 (523, 659 and 784 Hz) 0.11 s apart, each lasting 0.2 s, then C6 (1047 Hz) at 0.33 s for 0.6 s.
- `patter`: sine wave, 1300 Hz for 0.03 s, at half the chime's gain.
- **Gain:** every peak at or below today's tick gain on Normal, through the existing master gain, so Quiet and Off apply.

- [ ] **Step 1: Write the failing tests** using `fakeAudio()`:
  - "chime, fall, fanfare and patter build oscillators of the right types";
  - "the Off level plays nothing" (all four);
  - "a Classic word moment chimes once";
  - "patter is capped at one per 160 ms";
  - "one fall per view however many hearts";
  - "final explosion orders boom, note, tune": the explosion plays at once, `fall` at 350 ms, and `fanfare` only after `resultsShown()`;
  - "first view plays nothing";
  - "hidden ticks speed up with tension": 1000 ms apart at tension 0, and 700 ms apart at tension 1.
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/client/sound.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `sound.js`, keeping `createSound`'s unlock and level handling.
- [ ] **Step 4: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Chime, falling note, winner's tune and patter".

---

### Task 7: Wire the pages, end-to-end checks, screenshots and docs

**Files:**
- Modify: `public/app/host-page.js`. Draw `motion.heldView(view)`. Pass Task 4's getters into `renderProjector`. Call `sounds.resultsShown()` when a held results view first shows. Pass `motion.tension()` to `sounds.step`.
- Modify: `public/app/player-page.js`. The same drawing and held results, and no sound.
- Modify: `tests/e2e/game.e2e.ts` and `scripts/screenshots.ts`
- Modify: `docs/design-principles.md`. Replace §6's "Boldness goes in one place" bullet with the spec's section 4.6 text word for word. Update "Agreed layout" with the name plates, the soft light and the logo.
- Modify: `CLAUDE.md`. Under "Design and plans", add this spec and plan. Under "What's next", add a batch 4 line: "Batch 4 (look and moments) is built on branch `claude/sharp-fermi-0f6qq4`, waiting for Roy to try it on a deploy preview". Then list batches 5 and 6 as decided in the spec's section 8.
- Modify: `docs/EXTENDING.md`. One paragraph on `moments`: what a new mode should expect, and that moments never carry typed words.

- [ ] **Step 1: Write the failing e2e tests** in `game.e2e.ts`:
  - "logo and round label clear of seats with 30 players": no bounding-box overlap between `.logo-small`, `.p-round`, every `.seat` and the ⚙ buttons;
  - "the lobby logo overlaps nothing": with 15 and 30 players;
  - "a correct word flies to the seat";
  - "a refused word shakes the spotlight": `.spotlight.refused` appears on the projector, and the projector's HTML never contains the refused text;
  - "reduced motion reaches every end state": use `page.emulateMedia({ reducedMotion: "reduce" })`, play a word, lose a heart and end the game. The end states are reached with no running animations (`document.getAnimations().length === 0` after 50 ms).
- [ ] **Step 2: Run them and watch them fail.** Run `npm run test:e2e`. Expected: FAIL on the new tests.
- [ ] **Step 3: Wire both pages.**
- [ ] **Step 4: Run every test.** Run `npm test && npm run typecheck && npm run test:e2e`. Expected: all PASS, including the existing overlap, arrow, countdown and two-ring checks.
- [ ] **Step 5: Refresh the screenshots.** Run `npm run screenshots`. Look at `docs/screenshots/workshop-03`, `-08`, `-11`, `-13` and `-16`, plus one Enamel and one Night fuse screen, and check:
  - the plates, the soft light and the logo match the mockup;
  - nothing overlaps.
- [ ] **Step 6: Update the docs** listed above.
- [ ] **Step 7: Commit** with the message "Batch 4 wired up: pages, e2e checks, screenshots and docs". Push to `claude/sharp-fermi-0f6qq4`.
