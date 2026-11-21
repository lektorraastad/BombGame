# Word Lists and Prompt Generator Implementation Plan (plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the raw word files Roy supplied into the four data sets the engine needs: the dictionary, the known words, the block list, and fair prompts with counts. This happens in a build script that Netlify runs on every deploy. A word Roy adds to a list on GitHub therefore takes effect at the next deploy.

**Architecture:**
- **Pure functions:** `src/words/build.ts` parses each raw format and builds the data sets. It is fully unit-tested with small fixtures.
- **Build script:** `scripts/build-words.ts` reads `data/raw/`, calls `build.ts`, and writes `data/generated/`.
- **Netlify:** Netlify's build command runs the script before deploying.
- **Loading:** `src/words/load.ts` turns the generated files into the engine's `WordChecker` and `PromptBank`, given a file-reading function. That way plan 3's server can load them however Netlify Server allows.

**Tech Stack:** TypeScript, `node:test` with `tsx`, and no runtime dependencies. `tsx` and `typescript` become devDependencies so Netlify can run the script; this also fixes a deferred minor from plan 1.

**Spec:** `docs/superpowers/specs/2026-11-21-bomb-game-design.md`, section 4.2–4.3.

## Global Constraints

- **Raw files in `data/raw/`:**

  | File | Source | Format |
  |---|---|---|
  | `scowl-words.txt` | SCOWL/ESDB size 70, US + GB-ise, variants 2, diacritics stripped | One word per line, including capitalised names and `'s` forms |
  | `ngsl-lemmatized.csv` | NGSL 1.2, lemmatized for teaching | Lines starting `##` are comments. The rest are comma-separated forms, the headword first |
  | `ngsl-supplementary.csv` | NGSL supplementary words | Same format, with no comments and capitalised month and day names |
  | `ngsl-stats.csv` | NGSL 1.2 with basic statistics | A header row, then `Lemma,SFI Rank,...` (not used in v1, kept for later difficulty work) |
  | `blocked-en.txt` | LDNOOBW `en` | One entry per line. It includes multi-word phrases and an emoji |
  | `blocked-no.txt` | LDNOOBW `no` | **Optional** (not supplied yet), same format |
  | `blocked-extra.txt` | Roy's own list | **Optional**, one word per line, and lines starting `#` are comments |

  A missing optional file counts as empty, and the script prints one line saying it was skipped.
- **Normalising:** trim every word, NFC-normalise it and lower-case it. A **game word** matches `^[a-z]+(['-][a-z]+)*$`, the same rule as `normalise()` in `src/engine/words.ts`, and must be at most 30 characters. Words that don't match are dropped. This drops capitalised names only because they're lower-cased first. "april" survives that way, which is fine.
- **Dictionary:** every game word from SCOWL, plus every known word (see below), minus the block list.
- **Known words:** every game word from the NGSL lemmatized and supplementary files that is **also in SCOWL**. This drops NGSL misspellings like "advertisment". Blocked words are then removed.
- **Block list:**
  - **What goes in:** the single-word entries from every block file, normalised.
  - **Phrases:** multi-word phrases are dropped, because a typed answer can never contain a space.
  - **Other entries:** lines that aren't game words are dropped from the word block list. That includes the emoji. Lines with non-ASCII letters, such as Norwegian æøå, are kept for **name** blocking only.
  - **Two outputs:** `blocked-words` (game words only, for answers) and `blocked-names` (every single-word entry with letters, æøå kept, for nickname checks).
- **Prompts:**
  - **Chunks:** a prompt is a 2–3 letter chunk of `a–z` only.
  - **Matching words:** a known word counts toward a chunk only if it's longer than the chunk.
  - **Counting rules:** `contains` counts the known words that include the chunk anywhere, counting each word once. `starts` counts words that start with it, and `ends` counts words that end with it.
  - **Minimum:** only chunks with a count of at least 20 (`MIN_ANSWERS` from `src/engine/prompts.ts`) are written.
  - **Output:** `Prompt[]` (`{text, type, count}`) sorted by type, then by count descending, then by text.
- **Generated files in `data/generated/`, written by the script:**

  | File | Content |
  |---|---|
  | `dictionary.txt` | One word per line, sorted |
  | `known.txt` | One word per line, sorted |
  | `blocked-words.txt` | One word per line, sorted |
  | `blocked-names.txt` | One word per line, sorted |
  | `prompts.json` | Sorted, written with no extra whitespace |
  | `summary.json` | `{ counts: {dictionary, known, blockedWords, blockedNames}, prompts: { contains: {easy, medium, hard}, starts: {...}, ends: {...} }, skipped: string[] }`, using `BAND_RANGES` from `src/engine/prompts.ts` |

  The generated files are committed, so local tests and plan 3 work without running the script, **and** regenerated on Netlify.
- **Expected sizes with the files Roy supplied:**

  | Data set | Expected |
  |---|---|
  | Known words | about 8,470 |
  | Dictionary | about 143,000 |
  | Prompts: contains | easy about 90, medium about 240, hard about 540 |
  | Prompts: starts | easy 4, medium about 57, hard about 135 |
  | Prompts: ends | easy about 10, medium about 34, hard about 85 |

  A test asserts these within ±10%, so a broken parser can't silently produce a tiny list.
- **Credit line:** `WORD_LIST_CREDITS` holds the exact string `"Word lists: New General Service List (Browne, Culligan & Phillips, CC BY-SA 4.0) · SCOWL/ESDB (Kevin Atkinson)"`. Plan 3 shows it in the lobby.
- **Netlify:** in `netlify.toml`, set `[build] command = "npm run build:words"`. `package.json` gets the script `"build:words": "tsx scripts/build-words.ts"` and the devDependencies `"tsx": "^4"` and `"typescript": "^5"`.

## Review Focus

1. **A CSV line with spaces, quotes or a trailing comma**, for example `about,` or ` abandon , abandons`. Forms are trimmed, and empty forms are dropped, never kept as `""`. → Task 1 test `parseNgsl tolerates spaces and trailing commas`.
2. **The NGSL headword "a", or very short words.** A one-letter word can't hold a 2-letter chunk and must not be counted. → Task 2 test `chunks only count words longer than the chunk`.
3. **A word repeating a chunk**, for example "banana" with "an" twice. It counts once for that prompt. → Task 2 test `a word counts once per chunk`.
4. **Windows line endings (`\r\n`) and a UTF-8 byte-order mark** in uploaded files. Both are stripped, so no word ends in `\r` and the first word doesn't start with `﻿`. → Task 1 test `handles CRLF and BOM`.
5. **A blocked word that is also a known word**, such as "butt" or "sex". It's removed from the known words, the dictionary and the prompt counts, so example answers can never show it. → Task 2 test `blocked words never reach known, dictionary or examples`.

---

## File Structure

```
data/raw/                       raw files (already committed; see Global Constraints)
data/generated/                 build output (committed, regenerated on Netlify)
src/words/build.ts              pure parsing and building
src/words/load.ts               generated text → WordChecker + PromptBank + blocked-name list
src/words/credits.ts            WORD_LIST_CREDITS
scripts/build-words.ts          CLI: read raw, build, write generated, print summary
tests/words/build.test.ts       unit tests with fixtures
tests/words/generated.test.ts   checks against the real generated files
```

`package.json`'s test script must also pick up `tests/words/*.test.ts`.

### Task 1: Parsers

**Files:**
- Create: `src/words/build.ts` (the parsers)
- Test: `tests/words/build.test.ts`

**Interfaces (produced):**
- **Cleaning one entry:** `cleanLine(s: string): string` trims, strips a BOM and `\r`, NFC-normalises and lower-cases.
- **Game words:** `isGameWord(w: string): boolean` checks the regex and that the word is at most 30 characters.
- **SCOWL:** `parseScowl(text: string): Set<string>` returns the cleaned game words.
- **NGSL:** `parseNgsl(text: string): Set<string>` skips `##` lines and splits on commas. It returns every cleaned game-word form.
- **Block files:** `parseBlocked(text: string): { words: Set<string>; names: Set<string> }`.
  - **Skipped lines:** empty lines and `#` comment lines.
  - **Phrases:** an entry with a space after cleaning is skipped.
  - **`words`:** game words only.
  - **`names`:** entries that contain at least one letter (`\p{L}`), keeping æøå.

- [ ] **Step 1: Write the failing tests:**
  - `parseScowl keeps lower-case game words and lowercases names`: `"Apple\napple\nA's\nco-op\nrock'n'roll\nÉclair\n"` gives exactly `{"apple", "a's", "co-op", "rock'n'roll"}`. `éclair` fails the game-word regex.
  - `parseNgsl skips comments and splits forms`: `"## note\nabandon,abandons,abandoned\nMonday,Mondays\n"` gives `{"abandon", "abandons", "abandoned", "monday", "mondays"}`.
  - `parseNgsl tolerates spaces and trailing commas`: `" abandon , abandons,\nabout,\n"` gives `{"abandon", "abandons", "about"}` and no `""`.
  - `handles CRLF and BOM`: `"﻿first\r\nsecond\r\n"` through `parseScowl` gives `{"first", "second"}`.
  - `parseBlocked splits words, names and drops phrases`: `"ass\nbig tits\nJævla\n🖕\n# comment\n\ng-spot\n"` gives `words = {"ass", "g-spot"}` and `names = {"ass", "jævla", "g-spot"}`.
- [ ] **Step 2: Run the tests.** Run `npx tsx --test tests/words/build.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement the parsers** in `src/words/build.ts`, and add `tests/words/*.test.ts` to the `npm test` script.
- [ ] **Step 4: Run all the tests and the type check.** Run `npm test && npx tsc -p tsconfig.json`. Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(words): parsers for raw word files`.

### Task 2: Building the word data and prompts

**Files:**
- Modify: `src/words/build.ts`
- Create: `src/words/credits.ts`
- Test: `tests/words/build.test.ts`

**Interfaces:**
- **Consumes:** Task 1's parsers, plus `Prompt`, `PromptType`, `MIN_ANSWERS` and `BAND_RANGES` from the engine.
- **Produces:**
  - **Building everything:** `buildWordData(raw: { scowl: string; ngsl: string[]; blocked: string[] }): WordData`, where
    ```ts
    type WordData = { dictionary: string[]; known: string[]; blockedWords: string[]; blockedNames: string[]; prompts: Prompt[] }
    ```
    All the arrays are sorted, and the rules are in Global Constraints.
  - **Generating prompts:** `generatePrompts(known: Iterable<string>): Prompt[]`.
  - **Summarising:** `summarize(data: WordData, skipped: string[]): Summary`, with the shape from Global Constraints.
  - **Credits:** `WORD_LIST_CREDITS` in `credits.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `known words must be in SCOWL`: if NGSL has "advertisment" and SCOWL doesn't, it isn't known.
  - `blocked words never reach known, dictionary or examples`: with "butt" in all three inputs, it's in none of `dictionary`, `known`, or any prompt's word count.
    - **Prompt check:** a fixture of 25 words containing "utt" plus "butt" gives the "utt" contains-prompt a count of 25, not 26.
    - **Checker check:** `createWordChecker` built from the output gives `examples()` that never return "butt".
  - `chunks only count words longer than the chunk`: "an" (the word) doesn't count toward the prompt "an".
  - `a word counts once per chunk`: "banana" adds 1 to contains "an".
  - `only prompts with at least MIN_ANSWERS are written`: with 19 words containing "zq" (made-up fixture words, also put in the fixture SCOWL), there's no "zq" prompt. A 20th word adds it with count 20.
  - `starts and ends count position-specific`: "stone" counts for starts "st" and ends "ne", but not starts "ne".
  - `prompts are sorted by type, count desc, text`.
  - `summary counts bands with BAND_RANGES`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** `buildWordData`, `generatePrompts`, `summarize` and `credits.ts`.
- [ ] **Step 4: Run all the tests and the type check.** Expected: all pass.
- [ ] **Step 5: Commit** with the message `feat(words): build dictionary, known words, block lists and prompts`.

### Task 3: Build script, Netlify hook and loader

**Files:**
- Create: `scripts/build-words.ts`, `src/words/load.ts`, `data/generated/*` (by running the script)
- Modify: `package.json`, `netlify.toml`, `tsconfig.json` (include `scripts`), `README.md` (a "Word lists" section explaining how Roy edits `blocked-extra.txt` on GitHub, and that changes go live on the next deploy)
- Test: `tests/words/generated.test.ts`

**Interfaces:**
- **The script:** `scripts/build-words.ts`.
  - **Input:** it reads `data/raw/` from the repository root (resolved from the script's own location). Optional files that are missing are listed in `skipped`.
  - **Output:** it writes the six generated files and prints the summary as indented JSON on stdout.
  - **Exit code:** it exits non-zero if any prompt type has fewer than 10 prompts in total, or if known words number under 1,000. That way a broken list fails the Netlify deploy instead of shipping an empty game.
- **The loader, `src/words/load.ts`:**
  ```ts
  loadWordData(read: (name: string) => string): { checker: WordChecker; bank: PromptBank; blockedNames: string[]; summary: Summary }
  ```
  `read` gets a file name such as `"dictionary.txt"` and returns its text. Plan 3 decides how to read the files on Netlify Server.

- [ ] **Step 1: Write the failing tests** in `tests/words/generated.test.ts`. They read `data/generated/` with `fs.readFileSync` through `loadWordData`:
  - `generated sizes match the supplied lists`: each count is within ±10% of the expected sizes in Global Constraints.
  - `every prompt has at least 20 known answers`: a recount from `known.txt` matches each prompt's `count` exactly (for the first 50 prompts of each type).
  - `no blocked word is known or in the dictionary`.
  - `the loader's checker accepts a known word, rejects a blocked word, and the bank can deal every band for contains`.
  - `generated files are up to date`: running `buildWordData` on `data/raw/` gives exactly the committed `prompts.json` and `known.txt`. This catches someone editing the raw files without regenerating locally.
- [ ] **Step 2: Run the tests.** Expected: FAIL (there's no generated data yet).
- [ ] **Step 3: Implement** the script and loader, add `"build:words"` and the devDependencies to `package.json`, set the build command in `netlify.toml`, then run `npx tsx scripts/build-words.ts`. Check that the printed summary falls within the expected ranges.
- [ ] **Step 4: Run all the tests and the type check.** Run `npm test && npx tsc -p tsconfig.json`. Expected: all pass.
- [ ] **Step 5: Update the README** with the "Word lists" section.
- [ ] **Step 6: Commit** with the message `feat(words): build script, Netlify build hook, loader and generated data`, including `data/raw/` and `data/generated/`.
