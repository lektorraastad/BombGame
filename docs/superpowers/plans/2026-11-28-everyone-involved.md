# Everyone Involved (batch 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a small spark on a seat when that student's silent answer, or a ghost's answer, is accepted, and make the example words after an explosion always everyday words.

**Architecture:** The hub's moment list (batch 4) gains `silent` and `ghost` moments, carrying who answered and never what. `motion.js` times them, and `render-circle.js` draws the spark on the seat with a negative `animation-delay`, like the other moments. The example picker in `src/engine/words.ts` takes an "everyday" set, which `src/words/load.ts` builds from `ranks.txt` (CEFR-J level and NGSL headword, from batch 5) and `names.txt`.

**Tech Stack:** TypeScript on Node 24 (`tsx --test`), plain ES modules with JSDoc in `public/`, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-28-everyone-involved-design.md` (approved by Roy, 2026-11-28). Read it and `CLAUDE.md`. The spark's look is in the artifact "Wordfire Silent Sparks" (https://claude.ai/artifact/MeakqzPYzJQJSo3YsqhhY4). It is a ring and six star points from the emoji, about 0.7 s, in `--spark`; the ghost's version uses `--muted` and is fainter.

## Global Constraints
- No change to how a game is played, scored or won, or to which answers count.
- A spark never carries or shows a word. No view's JSON may contain a silent or ghost word.
- One spark per accepted answer, at most once per second per seat. Always the same size, never growing or counting. No sound.
- Sparks show on the projector and on every laptop. They never show in the lobby, on results, or from the first view after a load or reconnect.
- Reduced motion: a brief still ring, with no moving star points.
- **Example words:** beginner words first, which may include beginner names like *Norway*. Then everyday words: in `known.txt`, not a name, an empty headword column in `ranks.txt`, and a CEFR-J level of B1 or below, or with no level an NGSL rank of 2000 or less. Then show fewer, never anything else. Blocked words stay out.
- Colours only from theme tokens. Escape all player text. Renderers stay pure.
- Test-first. Run `npm test` and `npm run typecheck` before each commit. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01KMYdrvyCaYv5LC2MgWuaqQ`. Don't deploy.

## Review Focus
1. **A student who answers silently, then gets the bomb.** Their next silent-or-turn state must not leave a stale spark or block the turn moment. Test in Task 3 ("a spark then a word moment on the same seat both draw").
2. **Ghost answers in Everyone at once.** The fainter spark works there too, where the seats show ✓ ticks. Test in Task 2 ("ghost moment in Everyone at once").
3. **A burst of silent answers in one broadcast,** where two students answer within the same microtask. Both moments are listed. Test in Task 2 ("two silent answers in one broadcast are both listed").
4. **An older generated folder** without levels or headwords still loads, and the examples fall back to beginner words only. Test in Task 1 ("old ranks.txt: beginner examples only").
5. **A prompt with no everyday words** shows no example line and nothing breaks. Test in Task 1 ("fewer, or none"), and the renderer already handles empty examples.

---

### Task 1: Everyday example words

**Files:**
- Modify: `src/engine/words.ts` (`createWordChecker` gains an optional `everyday`; `examples()` uses it)
- Modify: `src/words/load.ts` (builds the everyday set from `ranks.txt`, `known.txt` and `names.txt`)
- Test: `tests/engine/words.test.ts`, `tests/words/generated.test.ts`

**Interfaces:**
- Produces:
  - `createWordChecker(opts: { …existing; everyday?: Iterable<string> })`.
  - `examples(p, n, random)` returns, in order:
    1. shuffled beginner words that fit;
    2. then shuffled everyday words that fit and aren't beginner words;
    3. cut to `n`.
    
    There is no other fallback. An absent `everyday` means none.
  - `export function everydayWords(read): Set<string>` in `load.ts`. It applies the spec's rule to `ranks.txt`, with columns word, rank, level and head. An absent level, or an unparseable or missing file, gives an empty set.

- [ ] **Step 1: Write the failing tests:**
  - "examples: beginner first, then everyday, never other known words";
  - "examples: fewer, or none" (a prompt where only a form and a rare word fit returns `[]`);
  - "everydayWords: B1 and below, own headword, not a name, NGSL rank of 2000 or less when there's no level";
  - "old ranks.txt: beginner examples only";
  - generated check: "over every prompt in prompts.json, every example is a beginner or everyday word, and 'paragraphed' never appears" (use a seeded random).
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/engine/words.test.ts tests/words/generated.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Example words: always everyday words".

---

### Task 2: The hub's silent and ghost moments

**Files:**
- Modify: `src/server/hub.ts` (`Moment` gains `{ kind: "silent"; pid }` and `{ kind: "ghost"; pid }`; `HubRoom` collects accepted silent and ghost pids for the next broadcast, like `refused`; `submit` records them and queues a broadcast)
- Modify: `public/app/sound.js` (ignores both kinds explicitly, with a test)
- Test: `tests/server/hub.test.ts`, `tests/client/sound.test.ts`

**Interfaces:**
- Produces: moments `{ kind: "silent", pid }` and `{ kind: "ghost", pid }`, one per accepted answer since the last broadcast, in order. They are only added while the phase is playing.

- [ ] **Step 1: Write the failing tests:**
  - "an accepted silent answer adds a silent moment for that student";
  - "an accepted ghost answer adds a ghost moment";
  - "ghost moment in Everyone at once";
  - "refused silent or ghost answers add nothing";
  - "two silent answers in one broadcast are both listed";
  - "no view contains the silent or ghost word" (walk the JSON of every host, player and control view);
  - sound: "silent and ghost moments play nothing".
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/server/hub.test.ts tests/client/sound.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Hub: silent and ghost moments (who, never what)".

---

### Task 3: Drawing the spark, e2e, screenshots and docs

**Files:**
- Modify: `public/app/motion.js`
  - `SPARK_MS = 700` and `SPARK_GAP_MS = 1000`;
  - `sparks(): Map<string, { elapsedMs: number, ghost: boolean }>`;
  - per seat, a new spark starts only if at least `SPARK_GAP_MS` has passed since that seat's last spark;
  - nothing from the first view;
  - `busy()` covers sparks.
- Modify: `public/app/render-circle.js`. `CircleOptions` gains `sparks?: Map<string, { elapsedMs: number, ghost: boolean }>`. A seat with a spark draws `<span class="spark[ ghost]" style="animation-delay:-<ms>ms">` with a ring and six points inside the avatar.
- Modify: `public/app/render-projector.js` and `render-player.js` (they pass `sparks` through), and `host-page.js` and `player-page.js` (they pass `motion.sparks()`)
- Modify: `public/app/style.css`. The spark keyframes go inside `@media (prefers-reduced-motion: no-preference)`; outside it, a still ring shows for the duration.
- Modify: `tests/e2e/game.e2e.ts`, `scripts/screenshots.ts` if a spark is worth a shot, `CLAUDE.md` (batch 6 built on the branch, waiting for Roy; the spec and plan listed), `README.md` (one line on sparks under "Running a lesson"), and `docs/EXTENDING.md` (the two new moment kinds)
- Test: `tests/client/motion.test.ts`, `tests/client/render-circle.test.ts`, e2e

- [ ] **Step 1: Write the failing tests:**
  - motion:
    - "a silent moment sparks that seat for SPARK_MS";
    - "a ghost moment sparks with ghost: true";
    - "a second spark on the same seat within SPARK_GAP_MS is skipped, after it starts again";
    - "first view never sparks";
  - render:
    - "a spark draws a ring and 6 points with a negative delay";
    - "ghost spark has the ghost class";
    - "spark markup has no player text";
    - "a spark then a word moment on the same seat both draw";
    - "reduced-motion CSS: spark keyframes only under no-preference";
  - e2e: "with 15 students, a silent answer sparks that seat on the projector and on another laptop, and the word appears nowhere".
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/client/motion.test.ts tests/client/render-circle.test.ts`, then `npm run test:e2e`.
- [ ] **Step 3: Implement,** following the mockup's look.
- [ ] **Step 4: Run every test.** Run `npm test && npm run typecheck && npm run test:e2e`. Expected: all PASS. Then run `npm run screenshots` and commit them.
- [ ] **Step 5: Update the docs** listed above.
- [ ] **Step 6: Commit** with the message "Sparks for silent and ghost answers, e2e, screenshots and docs".
