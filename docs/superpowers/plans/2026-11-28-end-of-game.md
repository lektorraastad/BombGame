# The End of the Game (batch 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the results screen with two steps (the winner and up to four positive awards, then the "Words we played" wall), add the **Show words** and **Copy words** buttons, and give each laptop a private "Your game" card, without changing how a game is played.

**Architecture:** The word-list build adds two small generated files: a frequency ranking and a names list. A pure engine module, `src/engine/endgame.ts`, works out the awards, the wall's words and each player's summary from the room. The views carry them: the projector and laptops get the awards, words and step; each player gets only their own summary; the control view gets the full word list. The room holds the step from awards to words, moved by a timer or by a new `showWords` host command. The browser renderers draw both steps, the card and the buttons.

**Tech Stack:** TypeScript on Node 24 (`tsx --test`), plain ES modules in `public/` with JSDoc types (checked by `tsc`), Playwright end-to-end tests.

**Spec:** `docs/superpowers/specs/2026-11-28-end-of-game-design.md` (approved by Roy, 2026-11-28). Read it, `CLAUDE.md` and `docs/design-principles.md` first. The visual reference is the artifact "Wordfire End-of-Game Mockups" (https://claude.ai/artifact/DiZ1ZUQKjmcsZKxXkiCFxy). Its source is a scratch file that may be gone; the spec describes everything that matters.

## Global Constraints
- **No change to play:** how a game is played, scored or won stays the same. Turns, lives, word checking, winners and the moments from batch 4 are untouched.
- **The projector and the ⚙ overlay never show** scores, ghost points, tokens, the passcode or any count per student. "Most words" shows names only. The wall's "N words" is the number of different words on it.
- **Silent and ghost words** never reach any view except their owner's own `me.summary`.
- **The wall:** only words the class saw (turn words and Everyone-at-once answers), each once, alphabetical, with no names. Kicked players' words stay on it.
- **Awards:**
  - The order is Longest, Rarest (or one combined "Longest and rarest" card when the word is the same), Most words, Comeback, Best ghost. The first 4 are shown.
  - Each award goes to whoever earned it. It is never reassigned.
  - Most words and Comeback name every tied student in join order, up to 8; above 8 they show "N students tied" with no names.
  - Most words counts turn words plus silent answers, never ghost words.
- **Rarest:**
  - Names never count. A name is a word on a name list that is not also an ordinary NGSL or CEFR-J word.
  - Word forms count as their base word.
  - From most common to rarest: beginner, then known (ranked within by NGSL frequency; a known word with no rank comes after every ranked known word), then dictionary only.
  - Ties go to the longer word, then the one played first.
- **The step:** the awards show first. The wall comes 10 s after the results appear on screen (that is, 11.5 s after the game ends, counting batch 4's 1.5 s hold), or sooner on **Show words**. A refreshed projector keeps its step.
- **Copy words:** the wall's full word list, one per line, alphabetical, unique, with no names. It is copied in the browser only. If the clipboard refuses, the list shows in a box to select by hand.
- All player text goes through `esc()`. Renderers stay pure, and only the `*-page.js` files touch the DOM.
- Colours come only from theme tokens, and contrast tests cover any new pair. Reduced motion is respected.
- Work test-first. Run `npm test` and `npm run typecheck` before every commit. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01KMYdrvyCaYv5LC2MgWuaqQ`. Don't deploy.

## Review Focus
1. **A game ended by the host's End button** (no winners) shows "No winner this time", the awards and the wall, and the step timer still runs. Test in Task 3 ("End: no winners, the step still moves").
2. **Play again or Start during the awards step** clears the step timer, so it never fires into the next game. Test in Task 3 ("the step timer is cleared by Play again and by Start").
3. **A game with no words at all** (everyone exploded on their first turn): no Longest, Rarest or Most words cards, an empty wall that says "0 words" without breaking, and laptop cards that say "No words this time. Next game!". Test in Task 2 ("no words: no word awards, empty wall") and Task 4 ("an empty game renders").
4. **A nickname or word containing HTML** on the cards, the wall, the laptop card and the copy fallback box is escaped. Test in Task 4 ("all end-of-game text is escaped").
5. **30 students in Everyone at once,** where most survivors tie for Most words: the card shows names (up to 8) or "N students tied", and nothing overlaps at 1920×1080. Test in Task 2 ("more than 8 tied") and Task 5 (e2e "30-player awards fit").

---

### Task 1: The word-list build ranks words and lists names

**Files:**
- Modify: `src/words/build.ts` (`WordData` gains `ranks` and `names`; `buildWordData` fills them)
- Modify: `scripts/build-words.ts` (writes `data/generated/ranks.txt` and `data/generated/names.txt`)
- Modify: `src/words/load.ts` (reads them and returns `rarity`)
- Create: `src/engine/rarity.ts`
- Test: `tests/words/build.test.ts`, `tests/engine/rarity.test.ts` (new), `tests/words/generated.test.ts`

**Interfaces:**
- Produces:
  - **`ranks.txt`:** one `word<TAB>rank` line per known word form. The rank is the NGSL headword's SFI rank, given to every form in that headword's family from `ngsl-lemmatized.csv`. Known words with no NGSL rank are written with rank `100000`.
  - **`names.txt`:** one name-only word per line.
  - **In `src/engine/rarity.ts`:** `export type Rarity = (word: string) => number | null`, and `export function createRarity(opts: { beginner: Iterable<string>; known: Iterable<string>; ranks: Map<string, number>; names: Iterable<string>; dictionary: Iterable<string> }): Rarity`. It returns null for a name, otherwise a number where higher means rarer:
    - beginner: `rank` (from 0 up to 100000);
    - other known: `200000 + rank`;
    - dictionary only: `400000`.
    
    Base forms: if the word itself isn't beginner or known, try stripping -s, -es, -ies→y, -ed, -d, -ied→y, -ing (also with a doubled final consonant removed, or with -e restored), and use the first candidate that is beginner or known.
  - **`loadWordData(read)`** additionally returns `rarity: Rarity`. A missing `ranks.txt` or `names.txt` makes every word dictionary-rare and no word a name, so an old generated folder still loads.

- [ ] **Step 1: Write the failing tests.**
  - `createRarity` with a small fixture:
    - "names are null": `rarity("barbados") === null`.
    - "a word that is a name and an ordinary word is ordinary": "english" is in beginner and not in names, so it gets a number.
    - "the three groups in order": beginner < known < dictionary-only.
    - "lower NGSL frequency is rarer within a group".
    - "unranked known after ranked known".
    - "forms use their base": `rarity("apples") === rarity("apple")`, `rarity("running") === rarity("run")`, `rarity("hoped") === rarity("hope")`, `rarity("cities") === rarity("city")`.
  - `buildWordData`:
    - "ranks give every NGSL family form its headword's rank";
    - "names excludes words also in NGSL or CEFR-J" (for example "turkey" is not in names, but "barbados" is).
  - `generated.test.ts`: "ranks.txt and names.txt exist and are non-empty".
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/engine/rarity.test.ts tests/words/build.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then run `npm run build:words` and commit the regenerated `data/generated/` files.
- [ ] **Step 4: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Word lists: frequency ranks and a names list for the rarest word".

---

### Task 2: The awards, the wall and each player's summary (engine)

**Files:**
- Create: `src/engine/endgame.ts`
- Modify:
  - `src/engine/room.ts`: the read-only accessors below, and an optional `rarity` in the room's options, defaulting to `() => 400000`.
  - `src/engine/knockout/activity.ts` and `src/engine/knockout/ghost.ts`: the optional `privateWords`.
  - `src/engine/registry.ts`: passes `rarity` through.
  - `src/engine/views.ts`: `Results` gains `awards`, `words` and `step`; `PlayerView["me"]` gains `summary`; `ControlView` gains `words`.
- Modify: `src/server/hub.ts` (its `words` option gains `rarity` and passes it to `createRoom`), `scripts/dev-server.ts` and `netlify/server/index.ts` (pass `words.rarity`)
- Test: `tests/engine/endgame.test.ts` (new), `tests/engine/views.test.ts`

**Interfaces:**
- Consumes: Task 1's `Rarity`.
- Produces:
  ```ts
  export type AwardKind = "longest" | "rarest" | "longestRarest" | "mostWords" | "comeback" | "bestGhost";
  export type AwardPlayer = { id: PlayerId; nickname: string; avatar: number };
  /** players is empty and tied is set when more than 8 tie. word is set for longest, rarest and longestRarest. */
  export type Award = { kind: AwardKind; players: AwardPlayer[]; word?: string; tied?: number };
  export type PlayerSummary = { turnWords: number; silentWords: number; ghostWords: number; longest: string | null; rarest: string | null; awards: AwardKind[] };
  export function awardsOf(room: Room): Award[];            // the first 4, in the spec's order
  export function wallWords(room: Room): string[];          // public words, unique, alphabetical
  export function summaryOf(room: Room, pid: PlayerId): PlayerSummary | null;
  ```
  - **New room accessors:**
    - `silentWordsOf(pid): string[]`;
    - `ghostWordsOf(pid): string[]`, which delegates to the activity's `privateWords?(ctx, pid): string[]`, implemented by ghost mode from its own `words` map;
    - `rarityOf(word): number | null`.
  - **Views:**
    - `Results` gains `awards: Award[]`, `words: string[]` and `step: "awards" | "words"`. `step` comes from Task 3; until then it is always `"awards"`.
    - `me.summary` is set only in the results phase, and only for the viewing player.
    - `ControlView.words` is the same list as `Results.words`, set only in the results phase.

- [ ] **Step 1: Write the failing tests** in `endgame.test.ts`. Use the engine test helpers (`tests/engine/helpers.ts`) and play real games with the fake clock.
  - "longest: the first of equal length wins";
  - "rarest skips names and uses rarity, then length, then first played";
  - "longest and rarest the same word gives one longestRarest card";
  - "most words counts turn words and silent answers, not ghost words";
  - "ties name everyone in join order, up to 8";
  - "more than 8 tied: no names, tied = n" (for Most words and Comeback);
  - "comeback before best ghost; at most 4 cards";
  - "no words: no word awards, empty wall";
  - "kicked players get no award, but their words stay on the wall";
  - "wall is unique and alphabetical with no silent or ghost words";
  - "summary counts turn, silent and ghost words and only its owner's words";
  - "summary longest and rarest include the owner's silent and ghost words";
  - "summary awards lists the kinds naming this player".

  In `views.test.ts`:
  - "projector results carry awards, words and step, and no counts". Walk the JSON: no key `score`, `ghostPoints`, `turnWords` or `silentWords`.
  - "a player's summary is in their own view only".
  - "the control view carries the words".
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/engine/endgame.test.ts tests/engine/views.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS, including every existing results test.
- [ ] **Step 5: Commit** with the message "Engine: awards, the word wall and each player's summary".

---

### Task 3: The step from awards to words

**Files:**
- Modify: `src/engine/room.ts` (`resultsStep: "awards" | "words"`, `showWords(): void`, a step timer)
- Modify: `src/engine/views.ts` (`Results.step` comes from `room.resultsStep`)
- Modify: `src/server/protocol.ts` (`COMMANDS` gains `"showWords"`), and `src/server/hub.ts` (`case "showWords": room.showWords()`)
- Test: `tests/engine/room.test.ts`, `tests/server/hub.test.ts`, `tests/server/protocol.test.ts`

**Interfaces:**
- Produces:
  - `export const WORDS_STEP_MS = 11_500`, exported from `room.ts`. It is 10 s on screen after batch 4's 1.5 s results hold.
  - `room.resultsStep` is `"awards"` when results begin and `"words"` after `WORDS_STEP_MS`, or at once on `showWords()`. Every change calls `changed()`.
  - `showWords()` is ignored outside the results phase.
  - The timer uses `deps.setTimeout`, and is cleared by `playAgain()`, `start()` and room close.

- [ ] **Step 1: Write the failing tests:**
  - "results start on awards and move to words after WORDS_STEP_MS";
  - "showWords moves at once and the timer then does nothing";
  - "showWords outside results is ignored";
  - "End: no winners, the step still moves";
  - "the step timer is cleared by Play again and by Start" (advance the clock past `WORDS_STEP_MS` in the next game; nothing changes);
  - hub: "showWords from a control connection moves every view to words; from a player it is not-host";
  - protocol: "showWords is a valid command".
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/engine/room.test.ts tests/server/hub.test.ts tests/server/protocol.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "Results step: awards, then words, after 10 s or on Show words".

---

### Task 4: Drawing the two steps, the laptop card and the buttons

**Files:**
- Create: `public/app/render-results.js`. It is pure: `renderResults(view, ui)` draws the projector's two steps, and `renderSummaryCard(view)` draws the laptop's card.
- Modify:
  - `public/app/render-projector.js`: results go to `renderResults`. The batch 4 win moment (the `win` UI option) stays on the awards step.
  - `public/app/render-player.js`: the laptop results show the winner and the card, as in the mockup.
  - `public/app/render-control.js`: on results, it adds **Show words** (`data-cmd="showWords"`, disabled once `results.step === "words"`) and **Copy words** (`data-copy-words`), plus a hidden fallback box `<textarea data-copy-fallback readonly>`.
  - `public/app/control-page.js` and `public/app/panel-page.js`: the click handlers. **Show words** sends the command. **Copy words** writes `view.words.join("\n")` with `navigator.clipboard.writeText`. The button shows "Copied" for 2 s, or the fallback box shows the text if the clipboard refuses.
  - `public/app/style.css`: the award cards, the wall, the card and the buttons, following the mockup.
- Test: `tests/client/render-results.test.ts` (new), `tests/client/render-projector.test.ts`, `tests/client/render-player.test.ts`, `tests/client/render-control.test.ts`

**Interfaces:**
- Consumes: Task 2's `Award`, `PlayerSummary` and `Results.words`, and Task 3's `Results.step`.
- Produces: the classes the e2e tests use:
  - `.r-awards`, `.r-card[data-kind]`, `.r-wall`, `.r-word.hl[data-award]`, `.r-more`;
  - `.your-game`;
  - `[data-cmd="showWords"]`, `[data-copy-words]` and `[data-copy-fallback]`.

**Copy (word for word):**
- **Card labels:** "Longest word", "Rarest word", "Longest and rarest word", "Most words", "Comeback", "Best ghost".
- **Many tied:** "N students tied".
- **Wall:** the heading "Words we played", "N words", the glow labels "Longest", "Rarest" and "Longest and rarest", and "+ N more: Copy words in the control panel".
- **Laptop card:**
  - the heading "Your game";
  - "You played N words: X on your turns, Y silently", plus ", and Z as a ghost" when Z > 0;
  - "No words this time. Next game!";
  - the labels "Your longest", "Your rarest" and "Award".
- **Laptop winner line:** "Shared win" for a shared win, and "No winner this time" when there is no winner.

- [ ] **Step 1: Write the failing tests.**
  - "the awards step shows the winner and the cards in order";
  - "longestRarest shows one card and one wall label";
  - "8 tied names, then N students tied";
  - "the words step shows the wall alphabetically with the award words glowing";
  - "the wall overflow shows + N more": the renderer takes a `maxWords` from `ui`, which the page measures. In tests pass `maxWords: 10` with 15 words.
  - "an empty game renders": 0 words, no cards, and "No words this time. Next game!";
  - "the laptop card shows only the view's own summary, and its counts";
  - "the control panel shows Show words, disabled on the words step, and Copy words";
  - "all end-of-game text is escaped": `<b>` in nicknames and words appears as `&lt;b&gt;` on the cards, the wall, the laptop card and the fallback box.
- [ ] **Step 2: Run them and watch them fail.** Run `npx tsx --test tests/client/render-results.test.ts tests/client/render-projector.test.ts tests/client/render-player.test.ts tests/client/render-control.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The wall shrinks its tiles to fit (as the mockup's `.words` does). `host-page.js` measures whether all words fit at no less than 18 px tile height at the current size. If they don't, it passes `maxWords`, and the award words always stay in. The step change is a plain swap, or a short fade inside `@media (prefers-reduced-motion: no-preference)`.
- [ ] **Step 4: Run the tests.** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message "End of the game: awards, Words we played, Your game, Show and Copy words".

---

### Task 5: End-to-end checks, screenshots and docs

**Files:**
- Modify: `tests/e2e/game.e2e.ts` and `scripts/screenshots.ts` (add both steps and the laptop card, in all themes)
- Modify:
  - `CLAUDE.md`: add the batch 5 spec and plan under "Where things are". Under "What's next", say batch 5 is built on branch `claude/sharp-fermi-0f6qq4`, waiting for Roy.
  - `README.md`: under "Running a lesson", add the end of the game, **Show words** and **Copy words**.
  - `docs/EXTENDING.md`: a short paragraph on `privateWords` for knockout activities.

- [ ] **Step 1: Write the failing e2e tests:**
  - "30-player awards fit": no overlap between the cards, the winner and the logo at 1920×1080;
  - "the wall fits with 15 and 30 players": no `.r-word` lies outside the screen;
  - "Show words moves the projector, the overlay and a second control window together";
  - "Copy words puts the wall's words on the clipboard" (grant clipboard permissions in Playwright);
  - "a refreshed projector keeps the words step";
  - "each laptop shows its own Your game numbers";
  - "the projector never shows a count per student": the results HTML has no per-student number next to a name.
- [ ] **Step 2: Run them and watch them fail.** Run `npm run test:e2e`. Expected: the new tests FAIL.
- [ ] **Step 3: Fix whatever the e2e tests reveal,** in the files Task 4 owns.
- [ ] **Step 4: Run every test.** Run `npm test && npm run typecheck && npm run test:e2e`. Expected: all PASS.
- [ ] **Step 5: Refresh the screenshots.** Run `npm run screenshots` and look at both results steps and the laptop card in Workshop and Night fuse.
- [ ] **Step 6: Update the docs** listed above.
- [ ] **Step 7: Commit** with the message "Batch 5 wired up: e2e checks, screenshots and docs".
