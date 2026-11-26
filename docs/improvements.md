# Improvements to make

Roy's notes after testing the redesign at home (25 November 2026), with leads for the builder. Each one needs a short design that Roy approves before any building, as usual.

## 1. A smaller bomb, with bigger names and typing

**Coming in batch 2 (layout).**

**Roy:** "The bomb should be a bit smaller, to allow for the students' names and what they are typing to be bigger."

**Leads:**
- The sizes are in `public/app/style.css`: the bomb, the seat names and the last-word and typing tiles, on the projector and on student screens. They depend on the seat count (up to 10, 11–16, 17–20, and two rings above 20).
- The current minimums are in the redesign plan's Ruling 12, at 1920×1080:
  - prompt tiles at least 110 px;
  - names at least 32 px with 16 or fewer seats and at least 24 px with 30;
  - last-word tiles at least 0.8 × the name.
  
  A smaller bomb frees room to raise the names and typing.
- The prompt letters sit on the bomb, so they must stay readable from the back of the room when the bomb shrinks.
- **Guards:**
  - the e2e tests "two rings for 24 players" and "the countdown number sits clear of the rim", and the student oval arrow check, in `tests/e2e/game.e2e.ts`;
  - the arrow geometry test in `tests/client/bomb.test.ts`. The arrow must not reach the inner ring.
- This is design work, so it must not change game logic. The bomb lives only in `public/app/bomb.js` (see `docs/design-principles.md`).

## 2. More even difficulty for the letters

**Done in batch 1 (2026-11-26).**

**Roy:** "The letters they are given to spell words with are sometimes very hard. We should think of ways to make the difficulty a bit more uniform."

**How it works now:**
- **Prompts:** they are 2–3 letter chunks, generated in `src/words/build.ts` (`generatePrompts`). Each one is counted against the **known** word list (about 8,500 words in `data/generated/`), not the full dictionary. A prompt is kept if at least 20 known words fit (`MIN_ANSWERS` in `src/engine/prompts.ts`).
- **Bands** (`BAND_RANGES` in `src/engine/prompts.ts`):
  - easy: 200 or more words fit;
  - medium: 60–199;
  - hard: 20–59.
- **Default:** the Difficulty setting is **Mixed**, which includes hard prompts with as few as 20 fitting words.
- **Prompt types:** contains, starts and ends. "Starts" and "ends" are likely harder than "contains" with the same count.

**Ideas to explore (not decided):**
- Make the default easier, or make Mixed lean towards easy and medium.
- Raise the floor, for example to 40 or more fitting words.
- Weight the count by how common the words are, since a word on the known list may still be rare for a 13-year-old ESL student.
- Use different thresholds per prompt type.
- Adjust as the game goes: start easy, then get harder.
- Look at real prompts before choosing: list a sample from each band and ask Roy which ones feel too hard.

## 3. A nicer ticking sound

**Done in batch 1 (2026-11-26).** Roy chose the tick-tock sound.

**Roy:** "The sound of the ticking bomb is a bit annoying and should be refined."

**How it works now:**
- `public/app/sound.js` → `tick(urgent)` plays a 50 ms **square wave** at 1180 Hz (1760 Hz when urgent), at gain 0.14 (0.22 when urgent).
- `countdown.js` calls it once a second, and 4 times a second in the last 3 seconds.
- Sound plays on the projector only (`host-page.js`), and there is a mute button.

**Ideas to explore:**
- Use a softer waveform (sine or triangle) and a lower pitch, for a clock-like "tock".
- Lower the volume.
- Tick less often, for example only in the last few seconds, or make the fast ticking quieter.
- Add a "Sound" setting (off, quiet, normal).
- Keep it generated with Web Audio. Avoid audio files unless they're openly licensed.
- Try a few versions and let Roy choose by ear.
