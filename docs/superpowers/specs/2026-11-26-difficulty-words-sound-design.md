# Bomb game: even difficulty, better words, nicer ticking (batch 1)

Status: approved by Roy, 2026-11-26.

This is the first of three batches of improvements Roy asked for after testing the redesign at home (`docs/improvements.md`). It builds on the original design (`2026-11-21-bomb-game-design.md`) and the redesign (`2026-11-23-redesign-design.md`). Read those first; this document says only what changes.

Items marked **(Claude's call)** are proposals Roy hasn't confirmed. They are sensible defaults and can be changed later. Everything else is something Roy said or agreed to in the conversation of 25–26 November 2026.

---

## 1. Why

Roy played on the default settings (Classic, hidden fuse, Difficulty "Mixed") and, for many prompts, **couldn't think of any word**. He named STS and ONF. The cause, found by analysing `data/generated/prompts.json`:

- **"Mixed" is mostly hard.** It picks evenly from all prompts. Of 869 "contains" prompts, 540 (62%) are in the hard band and only 88 (10%) are easy.
- **The counts are inflated by word forms.** A prompt is scored by how many *known words* fit, and "face, faced, faces, facing" counts as four. A "hard" prompt with 20 fitting words may have only 6–8 real ones.
- **About half the hard prompts need a grammar ending.** STS, CTS, KS and HED fit almost only plurals and past tenses ("lists", "facts").
- **The known-word list is adult vocabulary.** It comes from the New General Service List, built from adult texts. It has "conference" and "opportunity" but not banana, monkey, tiger, pizza, pencil, homework or sandwich, so prompts are judged by words 13-year-olds don't think of.
- **Time adds to it.** With the hidden fuse, a student can receive the bomb with only 5 seconds left.

Roy also found the ticking "a bit annoying": a 50 ms square-wave beep at 1180 Hz, once a second for the whole game. With the hidden fuse it never changes, so it carries no information.

Separately, students will answer with names (Norway, Christmas, TikTok). Today only some are accepted ("English", "Monday", "Google") and others aren't ("Norwegian", "Christmas", "TV"), which feels random.

**Success:** in a real lesson on the default settings, almost every student can find a word for almost every prompt, the class is never stuck on prompts like STS, sensible names are accepted, and nobody complains about the ticking.

## 2. Goals, non-goals, anti-goals

**Goals**
- A fairer measure of how hard a prompt is, based on the beginner-level words that fit it.
- The Difficulty setting becomes **Easy / Normal / Rising / Hard**, with **Normal** as the default.
- Prompts that need a grammar ending (STS, CTS) appear only in Hard.
- Everyday words students know (from the CEFR-J word list) are added to the known-word list.
- Names from hand-written lists are accepted as answers: countries, nationalities, languages, big cities, holidays, and about 300 brands and apps.
- Two files Roy can edit on GitHub: one for extra known words and one for extra names.
- Example answers after an explosion are common words.
- The shortest turn with the hidden fuse goes from 5 to 8 seconds.
- A nicer ticking sound, chosen by Roy by ear from a try-out page, and a way to make the sound quieter.

**Non-goals (this batch)**
- Layout changes such as the bomb size and bigger names and typing. That's batch 2.
- Settings presets (Gentle / Normal / Fast) and housekeeping. That's batch 3.
- Textbook glossaries or "this unit's words".
- Accepting first names.
- Any change to how answers are checked beyond the new names. "play", "plays" and "played" still count as three different answers.

**Anti-goals (a failure even if it technically works)**
- Easy or Normal still deals prompts that a typical 8th grader can't answer.
- A rude word gets through as a "name" or "known word". The block lists still apply to everything.
- First names of classmates count as answers.
- The ticking becomes so quiet or rare that the bomb loses its tension.
- A lesson-day deploy. As always, everything goes to a deploy preview first.

## 3. Constraints

- The engine stays pure and network-free (`src/engine/`). Prompt choice depends only on settings, game progress and `random()`.
- `data/generated/` is still built from `data/raw/` on every Netlify build. Roy's own files are optional: missing files are skipped, as with `blocked-extra.txt`.
- New word data must be openly licensed and credited. The CEFR-J terms allow free research and commercial use with a citation. Copyright stays with Tono Laboratory at TUFS.
- Sound stays generated with Web Audio, with no audio files, and plays on the projector only.
- Privacy is unchanged: no logging of words or names.
- The projector and the ⚙ overlay still never show scores or the passcode.
- Test-first, as before.

## 4. Approaches considered (difficulty measure)

| Approach | Trade-off |
|---|---|
| **A. Count beginner words (CEFR-J A1–A2 headwords) that fit. Chosen by Roy.** | Matches what an 8th grader learns. Base forms only, so word forms can't inflate the count. The same list also fills the gaps in the known words. |
| B. Count the 1,000 most frequent NGSL words that fit | Works reasonably, but it's adult frequency: "conference" counts while "banana" doesn't. |
| C. Roy rates the prompts by hand | Most accurate, but there are about 1,000 prompts to rate. |

The other parts each had one sensible way:
- Rising goes up by lap, as Roy agreed.
- Names come from hand-written lists plus Roy's own file, as Roy agreed.
- The ticking is chosen by ear on a try-out page, as Roy agreed.

## 5. The design

### 5.1 The beginner score

- Every prompt gets a new number, **`common`**: how many distinct CEFR-J **A1 or A2 headwords** fit it.
- A word only counts if it's longer than the prompt and in the answer dictionary.
- Headwords like `a.m./A.M./am/AM` are split on `/`, and only entries in game-word form (a–z, with inner `'` or `-`) are used.
- The existing `count` (known words that fit) stays as it is, so a prompt is still only made when at least 20 known words fit (`MIN_ANSWERS`).
- Names that count as known words (5.4) also count towards `common`. They're everyday words for these students.

Measured on today's prompts, before the new known words are added:

| Letters | `common` | Some of the words |
|---|---|---|
| STS | 0 | (only plurals) |
| CTS | 0 | (only plurals) |
| ONF | 3 | confident, confuse, confused |
| OND | 8 | beyond, Monday, second, wonder |
| IGH | 31 | bright, eight, fight, flight |
| OO | 64 | balloon, bedroom, book |
| EA | 134 | beach, bean, beautiful |

### 5.2 Levels

| Level | `common` | "contains" prompts today | Examples |
|---|---|---|---|
| Very easy | 15 or more | 341 | IN, CE, SH, MAN, IGH |
| Easy | 8–14 | 287 | TEN, GRE, LIT, ISH, OND |
| Medium | 4–7 | 347 | JO, EXC, LOO, SHA, TW |
| Hard | 0–3 | 219 | TED, KED, ALS, FAC, STS |

The prompt counts were measured after the CEFR-J words were added (26 November 2026, `data/generated/summary.json`).

The thresholds (15, 8, 4) are **(Claude's call)**. The builder may adjust them by a step or two after the new word list is in. The guard is on the **Easy option** (the very easy and easy levels together, about 628 "contains" prompts today): it must keep at least 150 "contains" prompts. Rising's first lap uses the very easy level alone, so that level must keep at least 100 "contains" prompts. The final numbers go in the plan.

### 5.3 The Difficulty setting

The setting keeps its key (`band`) and label (Difficulty), with new options:

| Option | What it deals |
|---|---|
| **Easy** | Very easy and easy prompts only. |
| **Normal** (default) | Mostly very easy and easy, with about 1 prompt in 5 from medium **(Claude's call: 1 in 5)**. Never hard. |
| **Rising** | Lap 1: very easy. Lap 2: very easy and easy. Lap 3 onwards: as Normal. Never hard. |
| **Hard** | Every prompt, as "Mixed" does today. |

- The old values `medium` and `mixed` disappear. Rooms live in memory only, so nothing stored needs converting, and an unknown value falls back to the default as it does now.
- **What counts as a lap:**
  - **In Classic,** a lap ends when as many prompts have been dealt as there were alive players when the lap began. Skipped prompts count. This is a rule of thumb that needs no seat tracking **(Claude's call)**.
  - **In Everyone at once,** a lap is a round.
- **Normal's mix:** for each prompt, pick "medium" with probability 1 in 5, otherwise "very easy or easy". If the chosen group has no fresh prompt for the selected types, fall back to the other group. The usual "avoid the last 10 prompts" rule still applies.
- **Prompt types:** the same levels apply to "starts with" and "ends with". Those types have fewer prompts, so the control panel's existing "they will repeat often" warning stays and is worked out for the new options. For Rising, it uses the smallest stage (very easy).
- **The setting's help text** becomes: "How hard the letters are. Rising starts easy and gets harder each lap." **(Claude's call)**

### 5.4 Words and names

New files in `data/raw/`:

| File | Who writes it | Accepted as an answer | Counts as a known word (prompts, examples, beginner score) |
|---|---|---|---|
| `cefrj-vocabulary-profile-1.5.csv` | downloaded, unchanged | yes (if not already) | A1–B2 headwords: known. A1–A2 also give the beginner score. |
| `names-places.txt` | Claude | yes | countries, nationalities and languages: yes. Cities: no. |
| `names-holidays.txt` | Claude | yes | yes |
| `names-brands.txt` | Claude, about 300 entries | yes | no |
| `known-extra.txt` | Roy, optional | yes | yes |
| `names-extra.txt` | Roy, optional | yes | no **(Claude's call)** |

**The lists Claude writes:**
- **Places:** all countries; their nationality and language words (Norwegian, Spanish, Swahili); and about 100 well-known cities, including Norwegian ones (Oslo, Bergen, Trondheim, Tromsø written as "tromso"). The places file has sections so the build can tell cities from the rest: `# countries`, `# nationalities and languages` and `# cities`.
- **Holidays:** Christmas, Easter, Halloween, Ramadan, Eid, Diwali, Hanukkah, Thanksgiving and similar.
- **Brands and apps:** about 300 that teenagers know: apps and games, tech, sport, food and drink, shops, cars, film and TV. It **leaves out** alcohol, tobacco, vaping, gambling and adult brands **(Claude's call)**.
- **Spelling rule:** one entry per line, written the way it's spelled ("iPhone", "Coca-Cola"). The build lowercases everything, so students type "iphone".

**Rules for every name and known-word file:**
- Same format as `blocked-extra.txt`: one entry per line, with notes on their own line starting `#`.
- Entries that aren't game words are skipped: anything with spaces, digits or other symbols, so "New York" and "7-Eleven" are left out **(Claude's call)**.
- Blocked words win: a name or known word on any answer block list is never accepted. The automatic blocked-variant rules (`blockedVariants`) apply to the new words too.
- First names are never added by Claude. If Roy adds one to `names-extra.txt`, that's his choice.
- **Places and brands that are also first names (decided by Roy):** every real country is accepted, even when it is also a first name (Jordan, Chad, Georgia, Kenya). Cities and brands that are mainly first names to a 13-year-old are left out (Victoria, Florence, Sydney, Austin, Alexa). Cities that are mainly places stay (Paris, London).
- Nothing else about the dictionary changes. Capitalised SCOWL entries stay excluded unless one of these lists names them.

**Credits:**
- The lobby credits line (`public/app/credits.js` and `src/words/credits.ts`) and the README add: "CEFR-J Wordlist Version 1.5 (Yukio Tono, Tokyo University of Foreign Studies)".
- The hand-written name lists are original work and need no credit.

### 5.5 Example answers

- After an explosion, the three examples are picked at random from the **beginner words** that fit (CEFR-J A1–A2, plus the names and Roy's words that count as known).
- If there are fewer than three, the rest are filled from the other known words.
- They're still random, so they vary from game to game **(Claude's call)**.

### 5.6 Shortest turn

- Classic's "Minimum turn time" default goes from 5 to **8 seconds**. The range (2–15) is unchanged.
- The fuse range defaults (10–30 seconds) stay.

### 5.7 Ticking sound

**Try-out page:** a throwaway page in the deploy preview, at `/sound-test/`, with no game logic. It offers 4–5 ticking styles side by side, each with three buttons:
- **calm:** ticking as at the start of a turn;
- **urgent:** the fast ticking of the last 3 seconds with the visible countdown;
- **with explosion:** a 10-second run ending in the explosion.

The styles to try **(Claude's call)**:
1. **Soft clock:** a short, low wooden "tock" (sine or triangle, roughly 500–800 Hz), quiet.
2. **Tick-tock:** alternating two close pitches, like a wall clock.
3. **Muffled tick:** filtered noise click, the most "mechanical".
4. **Heartbeat:** a low double thump. It's the tensest, and may suit the hidden fuse.
5. **Today's beep, softer:** for comparison.

On every style, the urgent ticking gets faster but **not louder or higher-pitched than calm by much**.

**After Roy picks:** that style replaces `tick()` in `public/app/sound.js`. The try-out page is then removed, and the rhythm stays as it is (once a second, 4 a second in the last 3 seconds of a visible timer).

**Quieter sound:** the projector's **Mute** button becomes a **Sound** button that cycles **Normal → Quiet → Off** **(Claude's call)**.
- Quiet is about a third of the volume, for both ticking and explosion.
- It's a projector control, not a game setting, so the host can change it mid-game without touching the engine.
- It's remembered for the next lesson in the projector browser's `localStorage`. That stores only the sound level, nothing about students.

## 6. What the builder needs to know

- **Data flow:**
  - `scripts/build-words.ts` reads the new raw files.
  - `src/words/build.ts` builds the known set, the dictionary additions and the beginner set.
  - `generatePrompts` adds `common` to each prompt.
  - `prompts.json` carries it.
  - `src/engine/prompts.ts` picks by level.
- **Engine changes:**
  - `PromptBank.next` needs the game's progress for Rising. Pass a `stage` (1, 2, 3+) from the room, which works out laps from prompts dealt.
  - Prompt choice stays testable with a fake `random`.
- **Health and summary:**
  - `summary.json`, `/api/health` and `problems()` report the new levels.
  - `problems()` must also refuse a build where the Easy option has fewer than 100 "contains" prompts. That would mean the CEFR-J file was damaged or removed.
- **Order of delivery (Claude's call):** everything in this batch goes to one draft pull request and one deploy preview, together with the try-out page. Roy tries the new difficulty and picks a ticking style on the same preview. The chosen style is then built in and the try-out page removed on the same branch, before anything goes live.
- **Control panel:** the hub's `promptCounts` and `BAND_LABEL` in `render-control.js` use the new options.
- **Docs:**
  - README: how Roy adds words and names, in the same click-by-click style as `blocked-extra.txt`.
  - `docs/EXTENDING.md`: prompt levels.
  - `CLAUDE.md`: the new files.
- **Tests to keep green:**
  - all existing unit, e2e and load tests;
  - `tests/words/generated.test.ts` should check that STS and CTS are never dealt in Easy, Normal or Rising;
  - also check that "norway", "christmas", "tiktok" and "jordan" are accepted and "john" and "victoria" are not.

## 7. Left to the builder

- The exact levels' thresholds, within the guard in 5.2.
- Exact sound parameters for each style on the try-out page.
- How the places file marks its sections, as long as Roy can read it.
- Which 300 brands, within the rules in 5.4.

---

## The whole improvement programme (for reference)

1. **Batch 1 (this document):** difficulty, words and names, ticking sound.
2. **Batch 2: layout.**
   - A smaller bomb, with its prompt letters shrinking with it but staying readable from the back of the room.
   - The current player's live typing becomes the biggest thing in the ring, names come second, and old words stay smallest.
   - Bigger sizes on the projector and student laptops.
   - It's designed for 15 players and kept readable at 30.
   - Roy chooses from 2–3 layout pictures before anything is built.
3. **Batch 3: settings and housekeeping.**
   - Presets at the top of the settings, with the details under "More settings". "Gentle" means easy letters, a longer fuse and 3 lives. "Normal" is the defaults, and "Fast" is a shorter fuse with 2 lives **(Claude's call for Normal and Fast)**.
   - Pin `@netlify/server` to an exact version.
   - The two small `docs/EXTENDING.md` fixes.

Each batch gets its own short design, approved by Roy, then a plan, then a deploy preview. Nothing goes live without Roy's go-ahead, and never on a lesson day.

## Potential future improvements

- **Word review after the game:** a "Let's look at these" screen, opened by a button from the results, showing the prompts the class missed with common example answers. It has no student names.
- **Copy list:** a button on the control screen that copies that review (prompts and example words only) to take away after the lesson. Nothing is stored on the server.
- **This unit's words:** an option that makes the game favour letter groups from vocabulary Roy is teaching that week, using his own word file.
- **Textbook glossaries** as an extra known-word source.
