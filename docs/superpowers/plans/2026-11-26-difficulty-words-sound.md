# Even difficulty, better words, nicer ticking: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prompts are scored by the beginner words that fit, the Difficulty setting becomes Easy / Normal / Rising / Hard, the known-word list gains CEFR-J words and hand-made name lists, examples are beginner words, the shortest turn is 8 s, and the projector gets a nicer tick (chosen by Roy) with a Normal / Quiet / Off sound button.

**Architecture:** The word build (`src/words/build.ts`) gains new raw inputs and produces a `common` score on each prompt plus a `beginner.txt` list. The engine's prompt bank (`src/engine/prompts.ts`) groups prompts into four levels and picks by Difficulty and the game's lap (`stage`). The room counts laps. Sound changes stay in `public/app/`.

**Tech Stack:** TypeScript on Node 24 (run by `tsx`), `node:test`, plain ES modules in the browser, Web Audio.

**Spec:** `docs/superpowers/specs/2026-11-26-difficulty-words-sound-design.md` (approved by Roy, 2026-11-26). Read it first.

## Global Constraints

- **Test-first:** watch each new test fail before writing the code.
- **Finish every task with all of these green:** `npm test` and `npx tsc -p tsconfig.json`. Also run `npm run test:e2e` at the end of Tasks 6 and 9.
- **The engine stays pure:** no I/O in `src/engine/`. Randomness only through the `random()` it's given.
- **Level thresholds** on `common`:
  - very easy: 15 or more;
  - easy: 8–14;
  - medium: 4–7;
  - hard: 0–3.
  - `MIN_ANSWERS` stays 20 (on `count`).
- **The Normal mix:** medium with probability 0.2, otherwise very easy or easy. Normal never deals hard prompts.
- **Rising:** stage 1 is very easy only, stage 2 is very easy and easy, stage 3 and up is the same as Normal.
- **Difficulty setting:** values `easy`, `normal`, `rising`, `hard`; labels "Easy", "Normal", "Rising", "Hard"; default `normal`. Help text: `How hard the letters are. Rising starts easy and gets harder each lap.`
- **Classic `minTurn` default is 8.** The 2–15 range is unchanged.
- **Credits string:**
  - Exact text: `Word lists: New General Service List (Browne, Culligan & Phillips, CC BY-SA 4.0) · SCOWL/ESDB (Kevin Atkinson) · CEFR-J Wordlist Version 1.5 (Yukio Tono, Tokyo University of Foreign Studies)`.
  - Put it in both `src/words/credits.ts` and `public/app/credits.js`.
- **Rules for every name and known-word file:**
  - One entry per line; `#` lines are comments.
  - Entries are lowercased.
  - Anything that isn't a game word (`isGameWord`) is skipped.
  - Blocked words always win.
- **No first names:**
  - Cities and brands that are mainly first names stay out: Victoria, Florence, Sydney, Austin, Alexa and similar.
  - Every country stays in.
- **Brands left out:** alcohol, tobacco, vaping, gambling and adult brands.
- **Privacy:** nothing logs names or words. The sound level in `localStorage` is the only new stored value, under the key `bombgame.sound`.
- **No deploys:** work on branch `claude/elegant-newton-cozbue` only. A draft pull request gives Roy a preview. Never merge to `main` without Roy's go-ahead.

## Review Focus

1. **Few prompts at a level.** "Starts with" alone at Rising stage 1 may have very few prompts. The bank must still deal (falling back to the next group), never throw. *Owned by Task 4:* test `falls back to the nearest level when a group is empty`.
2. **Kicks and knockouts mid-lap in Classic.** Laps keep counting and the stage never goes down. *Owned by Task 5:* test `rising never goes back down when players leave`.
3. **A name that's also a blocked word or a blocked variant** must be rejected. *Owned by Task 2:* test `blocked words beat names and known-extra`.
4. **Roy's files missing or holding junk:** an empty line, "New York", an emoji, a BOM or `\r\n` line endings. The build still works and skips the bad lines. *Owned by Task 2:* test `name files skip junk lines and tolerate BOM and CRLF`.
5. **Sound level from `localStorage` is junk or unreadable.** The projector falls back to Normal and never throws. *Owned by Task 8:* test `nextLevel and readLevel fall back to normal`.

---

### Task 1: Raw files (CEFR-J and the name lists)

**Files:**
- Create: `data/raw/cefrj-vocabulary-profile-1.5.csv`, downloaded unchanged from `https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv`.
- Create: `data/raw/CEFRJ-TERMS.txt`. It holds the terms-of-use paragraph and reference from that repository's README, quoted, plus the retrieval date.
- Create: `data/raw/names-places.txt` with three sections, each starting with an exact header line:
  - `# countries`: every UN member and observer state, plus well-known ones such as Taiwan and Kosovo, in their usual English short names.
  - `# nationalities and languages`: nationality adjectives and major languages, such as Norwegian, Swahili and Hindi.
  - `# cities`: about 100 well-known world cities, including at least 15 Norwegian ones, with `ø` written as `o` and `å` as `aa`. Apply the first-name rule.
- Create: `data/raw/names-holidays.txt`, with 20 or more holidays and festivals.
- Create: `data/raw/names-brands.txt`, with 280–320 brands and apps teenagers know. Group them under `#` headings (apps and games, tech, sport, food and drink, shops, cars, film and TV). Apply the exclusion and first-name rules. Write entries as spelled ("iPhone", "Coca-Cola").
- Each file starts with a short `#` comment saying what it's for and that Roy may add lines.

- [ ] **Step 1:** Download the CSV.
  - Run `head -2` on it. Expect `headword,pos,CEFR,...` and the line `a,determiner,A1,,,`.
  - Run `wc -l`. Expect 7799.
- [ ] **Step 2:** Write the four text files.
  - Check that `norway`, `jordan`, `christmas`, `tiktok` and `oslo` are present.
  - Check that `victoria`, `florence`, `sydney` and `alexa` are absent.
  - Use case-insensitive `grep -ix`.
- [ ] **Step 3:** Commit with the message `Raw word data: CEFR-J list and hand-made name lists`.

### Task 2: Word build (known, beginner, dictionary, prompts with `common`)

**Files:**
- Modify: `src/words/build.ts`, `scripts/build-words.ts`, `src/engine/types.ts`
- Test: `tests/words/build.test.ts`

**Interfaces:**
- Produces: in `src/engine/types.ts`, `Prompt` becomes `{ text: string; type: PromptType; count: number; common: number }`.
- Produces, in `src/words/build.ts`:
  - `parseCefrj(text: string): { all: Set<string>; beginner: Set<string> }`
    - Splits headwords on `/`, lowercases them, and keeps game words only.
    - `beginner` holds the A1 and A2 headwords.
  - `parseNameList(text: string): Set<string>`
  - `parsePlaces(text: string): { known: Set<string>; answerOnly: Set<string> }`
    - `known` holds the countries, nationalities and languages.
    - `answerOnly` holds the cities.
    - It reads the section headers exactly as written in Task 1.
  - `buildWordData(raw)`, where `raw` is:
    `{ scowl: string; ngsl: string[]; cefrj: string; places: string; holidays: string; brands: string; knownExtra: string[]; namesExtra: string[]; blocked: string[]; namesOnly: string[] }`.
    The `knownExtra` and `namesExtra` arrays are empty when Roy's file is missing.
  - `WordData` gains `beginner: string[]`.
  - `generatePrompts(known: Iterable<string>, beginner: Iterable<string>): Prompt[]`. `common` counts distinct beginner words longer than the chunk that fit it.
- Produces, in `scripts/build-words.ts`:
  - `readRaw` reads the new files.
  - `known-extra.txt` and `names-extra.txt` are optional, added to `OPTIONAL` in that order after the existing two.
  - `writeGenerated` also writes `beginner.txt`.

**The sets, built in this order:**
- **known:**
  - NGSL (spelled, as now);
  - CEFR-J `all`;
  - places `known`;
  - holidays;
  - `knownExtra`.
  - Then blocked words and blocked variants are removed, as now. The blocked-variant check runs over every new word.
- **beginner:**
  - CEFR-J `beginner`;
  - places `known`;
  - holidays;
  - `knownExtra`.
  - Only words that are also in `known` are kept.
- **dictionary:**
  - SCOWL lowercase;
  - `known`;
  - places `answerOnly`;
  - brands;
  - `namesExtra`.
  - Minus blocked words.

- [ ] **Step 1: Write the failing tests** in `tests/words/build.test.ts`. Use small inline fixtures:
  - `parseCefrj splits slashes and separates A1-A2`: input `"headword,pos,CEFR\na.m./A.M./am/AM,adverb,A1\nbanana,noun,A1\nabandon,verb,B1\n"`.
    - `beginner` is `{am, banana}`.
    - `all` is `{am, banana, abandon}`. ("a.m." isn't a game word.)
  - `parsePlaces sorts sections`: countries and nationalities go to `known`, and cities go to `answerOnly`.
  - `name files skip junk lines and tolerate BOM and CRLF`: input `"﻿# note\r\nNew York\r\niPhone\r\n🙂\r\n\r\nCoca-Cola\r\n"`. Result is `{iphone, coca-cola}`.
  - `names are answers; only some are known`: build with fixtures.
    - `norway` is in `dictionary`, `known` and `beginner`.
    - `oslo` and `tiktok` are in `dictionary` only.
  - `blocked words beat names and known-extra`: put a word in both `brands` and `blocked`, and another in `knownExtra` and `blocked`. Neither appears in `dictionary` or `known`.
  - `prompts carry common = beginner words that fit`: known `["banana","bandana","band","bands","abandon", ...]` padded to at least 20 for "an", and beginner `["banana","band"]`. The "an" contains prompt has `common === 2`.
- [ ] **Step 2:** Run `npx tsx --test tests/words/build.test.ts`. Expect the new tests to fail, with missing exports or a wrong signature.
- [ ] **Step 3:** Implement the interfaces above. Then update the existing `buildWordData` and `readRaw` callers in the tests to pass the new raw fields. Use empty strings or arrays where they don't matter.
- [ ] **Step 4:** Run `npm test`. Expect `tests/words/build.test.ts` to pass. `tests/words/generated.test.ts` will fail until Task 3. Note that, and move on only if nothing else fails.
- [ ] **Step 5:** Commit with the message `Word build: CEFR-J, name lists, beginner words and a common score`.

### Task 3: Levels, summary, build guard and regenerated data

**Files:**
- Modify: `src/engine/prompts.ts`, `src/words/build.ts` (`summarize`, `BandCounts`), `scripts/build-words.ts` (`problems`), `src/words/load.ts`, `src/words/credits.ts`, `public/app/credits.js`
- Regenerate: `data/generated/*` with `npm run build:words`.
- Test: `tests/engine/prompts.test.ts` (levels only), `tests/words/build.test.ts`, `tests/words/generated.test.ts`, `tests/client/render-projector.test.ts` (credits match)

**Interfaces:**
- Produces, in `src/engine/prompts.ts`:
  - `export type Level = "veryEasy" | "easy" | "medium" | "hard"`
  - `export const LEVEL_MIN = { veryEasy: 15, easy: 8, medium: 4 } as const`
  - `export function levelOf(p: Prompt): Level`
  - `BAND_RANGES` is removed.
- Produces: `BandCounts = Record<Level, number>`. `Summary.counts` gains `beginner`.
- Produces: `problems()` returns `Easy option has only N "contains" prompts (need 100+)` when `veryEasy + easy < 100` for contains. The existing per-type check sums all four levels.
- Produces: `loadWordData` passes `beginner: list(read("beginner.txt"))` to `createWordChecker`. The checker accepts and ignores it until Task 6.

- [ ] **Step 1: Write the failing tests.**
  - `levelOf edges`: `common` values 15, 14, 8, 7, 4, 3 and 0 map to very easy, easy, easy, medium, medium, hard and hard.
  - Summary test: replace the old band assertions with per-level counts on a fixture.
  - `problems` test: a summary with `contains: { veryEasy: 40, easy: 40, medium: 50, hard: 50 }` gives exactly one problem mentioning "Easy option".
  - In `tests/words/generated.test.ts`:
    - Replace the old band sizes with: contains very easy + easy ≥ 150, and very easy ≥ 100.
    - Prompts `contains:sts` and `contains:cts`, where present, are at the hard level.
    - `contains:igh` is very easy.
    - `beginner.txt` has more than 2000 lines.
    - The recount test also recomputes `common` for the first 50 prompts of each type.
  - Credits test: expect the new string in both files.
- [ ] **Step 2:** Run `npm test`. Expect those tests to fail.
- [ ] **Step 3:** Implement. Then run `npm run build:words`.
  - If the very easy + easy guard or the very easy ≥ 100 guard fails, adjust `LEVEL_MIN` by one step at a time, as the spec allows.
  - Write the final thresholds back into this plan's Global Constraints and into the spec's 5.2 table.
- [ ] **Step 4:** Run `npm test` and `npx tsc -p tsconfig.json`.
  - The only failures left should be about the old band names in `prompts.test.ts`, `hub.test.ts`, `lifecycle.test.ts`, `settings.test.ts` and `render-control.test.ts`. Tasks 4–5 rewrite those.
  - Mark those tests `todo` with a comment pointing to Task 4. Don't delete them.
- [ ] **Step 5:** Commit with the message `Prompt levels by beginner words; regenerated word data; CEFR-J credit`.

### Task 4: Prompt bank picks by Difficulty and stage

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/prompts.ts`, `src/engine/settings.ts`
- Test: `tests/engine/prompts.test.ts`, `tests/engine/settings.test.ts`

**Interfaces:**
- Produces: `Band = "easy" | "normal" | "rising" | "hard"`.
- Produces:
  - `PromptBank.next(opts: { band: Band; types: PromptType[]; random: () => number; avoid: string[]; stage?: number }): Prompt`. A missing `stage` means 1.
  - `PromptBank.size(band: Band, types: PromptType[]): number`. This is the number of distinct prompts the band can deal at stage 1. For Normal that's very easy + easy + medium.
- Produces: `export const NORMAL_MEDIUM_SHARE = 0.2`.

**Algorithm for `next`** (not fixed by the signature):
1. Work out the groups as `[levels, weight][]`:
   - easy: `[[VE,E],1]`;
   - normal, or rising at stage 3 and up: `[[VE,E],0.8]` and `[[M],0.2]`;
   - rising at stage 1: `[[VE],1]`;
   - rising at stage 2: `[[VE,E],1]`;
   - hard: `[[VE,E,M,H],1]`.
2. Draw one `random()` to choose a group by weight.
3. Within the chosen group, take prompts of the selected types that aren't in `avoid`. If none, try the other groups in order. If still none, use the chosen group ignoring `avoid`.
4. **If the band's levels have no prompt at all for these types:** widen one level at a time towards harder (VE → +E → +M → +H) until something exists. Throw only when the bank has no prompt of these types at all.
5. Draw a second `random()` to pick within the pool.

- [ ] **Step 1: Write the failing tests.**
  - In `prompts.test.ts`, build a fixture with prompts at every level, with `common` set and `count ≥ 20`.
  - `easy deals only very easy and easy`.
  - `normal deals medium about 1 in 5 and never hard`: 2000 draws with seeded random; medium share between 0.15 and 0.25; no hard prompts.
  - `rising stage 1 deals only very easy; stage 2 adds easy; stage 3 matches normal`.
  - `hard deals every level`.
  - `falls back to the nearest level when a group is empty`: a types filter with no very easy prompts at Rising stage 1 still deals, and it deals an easy prompt.
  - `size: normal counts VE+E+M, rising counts VE`.
  - Un-`todo` the old tests and rewrite them for levels. `drops prompts under 20 answers` keeps its meaning.
  - In `settings.test.ts`:
    - an unknown band resolves to `normal`;
    - the decl's options are `easy, normal, rising, hard`;
    - the help text is the exact string from the Global Constraints.
- [ ] **Step 2:** Run `npx tsx --test tests/engine/prompts.test.ts tests/engine/settings.test.ts`. Expect failures.
- [ ] **Step 3:** Implement the bank and the settings decl.
- [ ] **Step 4:** Run `npm test`. Expect those files to pass, with the hub, control and lifecycle tests still failing on band names.
- [ ] **Step 5:** Commit with the message `Difficulty: Easy, Normal, Rising, Hard`.

### Task 5: The room counts laps, and the hub, control panel and old tests use the new bands

**Files:**
- Modify: `src/engine/room.ts`, `src/engine/modes/mode.ts`, `src/engine/modes/everyone.ts`, `src/server/hub.ts`, `public/app/render-control.js`, `scripts/screenshots.ts` (`band: "mixed"` becomes `"hard"`, to keep the screenshots the same)
- Test: `tests/engine/rising.test.ts` (new), `tests/engine/lifecycle.test.ts`, `tests/server/hub.test.ts`, `tests/client/render-control.test.ts`, `tests/words/generated.test.ts` (the band loop)

**Interfaces:**
- Produces: an optional `lap?(ctx: ModeContext): number` on `GameMode`. Everyone at once implements it as `st(ctx).round`.
- Produces, in `Room`:
  - The private `Game` gains `{ dealt: number; lap: number; lapStart: number; lapSize: number }`.
  - Each `newPrompt` (including skips) runs this rule *before* dealing:

    ```ts
    if (mode.lap) lap = mode.lap(ctx);
    else if (dealt - lapStart >= lapSize) { lap++; lapStart = dealt; lapSize = Math.max(1, alive().length); }
    ```

  - At game start `lap = 1`, `lapStart = 0` and `lapSize` is the alive count.
  - `stage = Math.min(3, lap)` is passed to `bank.next`, then `dealt++`.
  - `stage` and `lap` stay private: no view shows them.
- Produces: the hub's `BANDS = ["easy","normal","rising","hard"]`. `BAND_LABEL` in `render-control.js` has the same four values.

- [ ] **Step 1: Write the failing tests** in `tests/engine/rising.test.ts`. Use a bank fixture where each level's prompt text names its level, such as `ve1` and `e1`:
  - `rising in classic: first lap very easy, second lap adds easy, then normal`: 4 players. Submit valid words so prompts are dealt. Prompts 1–4 are very easy, prompts 5–8 are very easy or easy, and from prompt 9 medium can appear.
  - `rising in everyone at once follows the round`: round 1 is very easy, round 2 adds easy, and round 3 can be medium.
  - `rising never goes back down when players leave`: kick 2 of 4 players mid-lap 2. The next prompts are never stage-1 only, and lap 3 starts after 2 more prompts.
  - `skips count towards the lap`.
  - Rewrite the hub's `promptCounts` test and the render-control fixture for the four new bands.
  - Rewrite the `lifecycle.test.ts` "medium" setting to "easy".
- [ ] **Step 2:** Run the new and changed tests. Expect failures.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and `npx tsc -p tsconfig.json`. Expect everything to pass, with no `todo` left.
- [ ] **Step 5:** Commit with the message `Rising difficulty follows laps and rounds; hub and panel use the new options`.

### Task 6: Beginner example answers, an 8-second minimum turn, and Roy's docs

**Files:**
- Modify: `src/engine/words.ts`, `src/engine/modes/classic.ts`, `README.md`, `docs/EXTENDING.md`, `CLAUDE.md`
- Test: `tests/engine/words.test.ts`, `tests/engine/classic.test.ts`, `tests/words/generated.test.ts`

**Interfaces:**
- Consumes: `beginner` from Task 3's loader.
- Produces: `createWordChecker(opts: { dictionary; known; blocked; beginner?: Iterable<string> })`. `examples(p, n, random)` first takes a shuffled pick from the beginner words that fit, then fills up from the other known words, never from blocked ones. Without `beginner` it works as today.

- [ ] **Step 1: Write the failing tests.**
  - `examples prefer beginner words`: known has 10 fitting words and beginner has 3 of them. Over 20 calls with `n=3`, the result is always exactly those 3, in any order.
  - `examples fill from known when beginner is short`: beginner has 1 fitting word and n=3. The result is that word plus 2 known words.
  - `classic minTurn defaults to 8`: change the existing `assert.equal(room.settings.minTurn, 5)` to 8.
  - In `generated.test.ts`:
    - `norway`, `norwegian`, `christmas`, `tiktok`, `oslo`, `jordan` and `banana` are words;
    - `john` and `victoria` aren't;
    - `fuck` still isn't.
  - Also in `generated.test.ts`: 200 draws each in easy, normal and rising, at every stage, never give `contains:sts` or `contains:cts`.
- [ ] **Step 2:** Run the tests. Expect failures.
- [ ] **Step 3: Implement**, then write the docs.
  - **README:** a section "Adding words and names" in the same click-by-click style as the `blocked-extra.txt` section. It covers `known-extra.txt` (everyday words students know; they also make letters easier) and `names-extra.txt` (names to accept as answers).
  - **README:** the new Difficulty options, explained in one sentence each.
  - **README:** add the CEFR-J credit line.
  - **`docs/EXTENDING.md`:** prompt levels and `LEVEL_MIN`.
  - **`CLAUDE.md`:** the new raw files, and the Word lists rule for name files.
- [ ] **Step 4:** Run `npm test`, `npx tsc -p tsconfig.json` and `npm run test:e2e`. Expect all to pass.
- [ ] **Step 5:** Commit with the message `Beginner example answers, 8 s minimum turn, docs for Roy's word files`.

### Task 7: Tick styles and the sound try-out page (throwaway)

**Files:**
- Create: `public/app/tick-styles.js`
- Create: `public/sound-test/index.html` and `public/sound-test/sound-test.js` (throwaway; removed in Task 9)
- Test: `tests/client/tick-styles.test.ts`

**Interfaces:**
- Produces: `export const TICK_STYLES: Record<string, { label: string; play(ctx: any, out: any, urgent: boolean): void }>` with these keys:
  - `soft-clock`: a sine or triangle wave at about 500–800 Hz, short "tock";
  - `tick-tock`: alternates two close pitches on successive calls;
  - `muffled`: band-passed noise click;
  - `heartbeat`: two low thumps about 120 ms apart;
  - `beep-soft`: today's square wave, at about 0.4× today's gain.
- `out` is a gain node to connect to. Urgent ticks may be shorter but no more than 1.25× the calm gain, and no more than 1.2× the calm pitch.

**The try-out page:**
- It shows one row per style with three buttons: **Calm** (five ticks one second apart), **Urgent** (three seconds at four ticks a second) and **With explosion** (seven calm ticks, then three urgent seconds, then the existing explosion from `createSound`).
- It looks like the rest of the game: the Workshop theme tokens and the Lexend font.
- It has no game logic and no network.

- [ ] **Step 1: Write the failing test** `every style builds nodes, starts them and connects only to out`. Use the fake AudioContext pattern from `tests/client/sound.test.ts`. For each style, in both calm and urgent, at least one node is started. Record the gain values set and check the urgent ≤ 1.25× calm rule.
- [ ] **Step 2:** Run `npx tsx --test tests/client/tick-styles.test.ts`. Expect it to fail.
- [ ] **Step 3:** Implement the styles and the page.
- [ ] **Step 4:** Run `npm test`. Then serve `public/` with `npm run dev`, open `/sound-test/` in Playwright, click each button and check there are no console errors.
- [ ] **Step 5:** Commit with the message `Throwaway sound try-out page with five tick styles`.

### Task 8: A Sound button (Normal, Quiet, Off) on the projector

**Files:**
- Modify: `public/app/sound.js`, `public/app/host-page.js`, `public/host.html` (button id `soundbtn` replaces `mutebtn`), `README.md` (the Mute mention, if any)
- Test: `tests/client/sound.test.ts`, `tests/e2e/game.e2e.ts` (any `mutebtn` use)

**Interfaces:**
- Produces, in `sound.js`:
  - `export type SoundLevel = "normal" | "quiet" | "off"`, as JSDoc.
  - `export const LEVEL_GAIN = { normal: 1, quiet: 0.33, off: 0 }`.
  - `export function nextLevel(l: string): SoundLevel`, which cycles normal → quiet → off → normal. Junk gives `"normal"`.
  - `export function readLevel(get: () => string | null): SoundLevel`. It catches a throwing `get` and falls back to `"normal"`.
  - `createSound(factory, tickStyle = TICK_STYLES["beep-soft"])`.
  - The returned object gains `setLevel(l: SoundLevel)` in place of `setMuted`. Every sound goes through one master gain node set to `LEVEL_GAIN[l]`.
  - `tick(urgent)` calls `tickStyle.play(ctx, master, urgent)`.
  - The default `beep-soft` is a placeholder until Roy chooses.
- **The host page:**
  - The button reads `Sound: Normal`, `Sound: Quiet` or `Sound: Off`.
  - A click cycles the level and saves it with `localStorage.setItem("bombgame.sound", l)` inside try/catch.
  - On load, the page uses `readLevel(() => localStorage.getItem("bombgame.sound"))`.

- [ ] **Step 1: Write the failing tests.**
  - `nextLevel and readLevel fall back to normal`: `nextLevel("x")` gives `"normal"`, and `readLevel(() => { throw new Error() })` gives `"normal"`.
  - `setLevel("off") silences and "quiet" lowers`: the master gain value is set to 0 and 0.33 respectively.
  - `tick uses the given style`: a fake style records its calls.
  - Update the old `setMuted` tests to `setLevel`.
- [ ] **Step 2:** Run `npx tsx --test tests/client/sound.test.ts`. Expect it to fail.
- [ ] **Step 3:** Implement. Rename `mutebtn` everywhere, including the e2e tests and `body[data-muted]` if the CSS uses it.
- [ ] **Step 4:** Run `npm test`, `npx tsc -p tsconfig.json` and `npm run test:e2e`. Expect all to pass.
- [ ] **Step 5:** Commit with the message `Projector Sound button: Normal, Quiet, Off, remembered`.

**Stop here.**
- Push the branch and open a **draft** pull request so Netlify builds a preview.
- Send Roy:
  - the preview link to `/sound-test/`;
  - a short "what to try" note for the new difficulty: try Normal, Rising and Easy with 2–3 browser tabs as players;
  - the question of which tick style he wants.
- Wait for his answer before Task 9.

### Task 9: Build in Roy's tick and remove the try-out page

**Files:**
- Modify: `public/app/tick-styles.js` (keep only Roy's style, or Roy's style with the changes he asked for), `public/app/sound.js` (the default style), `tests/client/tick-styles.test.ts`
- Delete: `public/sound-test/`
- Modify: `CLAUDE.md` ("What's next": batch 1 done, batch 2 next), `docs/improvements.md` (mark items 2 and 3 done)

- [ ] **Step 1:** Update the tests so that only the chosen style exists and `createSound`'s default is that style. Run them and watch them fail.
- [ ] **Step 2:** Make the change and delete the try-out page.
- [ ] **Step 3:** Run `npm test`, `npx tsc -p tsconfig.json`, `npm run test:e2e`, `npm run load-test` and `npm run screenshots`. Expect all to pass, and the screenshots to look unchanged apart from the Sound button.
- [ ] **Step 4:** Commit, push, and ask Roy to check the preview once more. Merge only on his go-ahead, and not on a lesson day.
