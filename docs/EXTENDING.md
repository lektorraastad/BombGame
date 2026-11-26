# Extending the game engine

This guide is for anyone changing the game later: a teacher who is new to code, or an AI assistant helping them. It covers the six usual changes:

1. [Add a game mode](#1-add-a-game-mode)
2. [Add a knockout activity](#2-add-a-knockout-activity)
3. [Add a setting](#3-add-a-setting)
4. [Add a prompt type](#4-add-a-prompt-type)
5. [Add a theme](#5-add-a-theme)
6. [Swap the bomb](#6-swap-the-bomb)

Sections 5 and 6 change only how the game looks. They follow `docs/design-principles.md`, and never touch the game rules.

All the game rules live in `src/engine/`. That code has no network or screen code in it, so it can be tested on its own.

## Map of the engine

| File | What it holds |
|---|---|
| `src/engine/types.ts` | Shared types: `Prompt`, `PromptType`, `SettingDecl`, `Settings`. |
| `src/engine/settings.ts` | `CORE_SETTINGS` (settings every game has) and the code that checks the teacher's choices. |
| `src/engine/words.ts` | Tidying up typed words, checking they are real words and fit the prompt, example answers (beginner words first, then other known words). |
| `src/engine/prompts.ts` | Prompt levels (`LEVEL_MIN`, `levelOf`) and the prompt bank, which picks the next prompt by difficulty, stage and type. |
| `src/engine/room.ts` | The room: players, joining, host controls, starting and ending games, and the rules every mode shares. |
| `src/engine/modes/` | Game modes (`classic.ts`, `everyone.ts`). Guide: `src/engine/modes/README.md`. |
| `src/engine/knockout/` | What knocked-out players do (`ghost.ts`). Guide: `src/engine/knockout/README.md`. |
| `src/engine/registry.ts` | **The list of modes and activities** (`MODES`, `ACTIVITIES`), `settingsFor()` for the settings panel, and `createRoom()`. |
| `src/engine/views.ts` | What the projector, each student and the teacher's control screen may see. |
| `tests/engine/` | The tests. `tests/engine/helpers.ts` has a fake clock, a small word list and test prompts. |

## Running the tests

From the project folder (`/home/claude/bomb-game`):

```sh
npm test                    # every test (about 150, a few seconds)
npx tsc -p tsconfig.json    # type check: catches typos and wrong types
npx tsx --test tests/engine/views.test.ts   # just one file
```

Run both `npm test` and the type check after every change. Both must pass before the change is done.

## Rules that must not break

These come from the game's design. The tests in `tests/engine/views.test.ts` check most of them.

- **Privacy.** Nothing is saved to disk and nicknames are never logged. Screens never get a player's `token` (their secret rejoin key).
- **The projector** never shows ghost words, silent answers, ghost points or scores. The only words it shows are real-turn words (each player's last one, and the longest word in the results) and live typing.
- **Student screens** get the projector's view plus their own `me` data. So they show other players' last real-turn words and the live typing, but never other players' scores, ghost points, silent answers or ghost words. Each student sees only their own score, and a ghost sees only their own ghost points and streak (in `me.activity`).
- Otherwise, ghost points appear only on the teacher's control screen. The results rank the best ghosts without points.
- **Live typing** is on by default. When it is on, every screen (projector, student screens and control screen) shows only the current Classic player's text, with blocked words masked as stars, and only while a game is running: never in Everyone at once and never during the results. The room stores typing only for that one player, so anyone else's keystrokes change nothing and send nothing. Typed text is cleared every time a new prompt is dealt, so a half-typed (or silent) word never shows for the next turn.
- **Views only read.** Code in `src/engine/views.ts` must never change the room. It uses read-only methods on `Room` such as `prompt()`, `modeView()`, `activityView(pid)`, `isOn(pid)`, `bombRemaining()` and `typingOf(pid)`. It must not use `room.context()`, which can change the game. Tests may use `room.context()`.
- **Paused timer.** While paused, screens use `bombRemainingMs` (which stops counting) rather than the mode's `bombEndsAt` (a clock time, which is wrong after a pause). Hidden fuses never send either.

## 1. Add a game mode

A mode decides who is on, when the bomb goes off and when the game ends. Full guide and worked example ("Sudden death"): **`src/engine/modes/README.md`**.

The short version:

1. Write `src/engine/modes/<name>.ts` that exports a `GameMode` object (the interface is in `src/engine/modes/mode.ts`).
2. Add it to `MODES` in `src/engine/registry.ts`.
3. Write `tests/engine/<name>.test.ts` (copy the setup from `tests/engine/classic.test.ts`).
4. Run the tests and the type check.

## 2. Add a knockout activity

An activity decides what students do after losing their last life. Full guide and worked example ("Cheerleader", where ghosts send 👏 to a survivor): **`src/engine/knockout/README.md`**.

The short version:

1. Write `src/engine/knockout/<name>.ts` that exports a `KnockoutActivity` (interface in `src/engine/knockout/activity.ts`).
2. Add it to `ACTIVITIES` in `src/engine/registry.ts`.
3. Write `tests/engine/<name>.test.ts` (copy the setup from `tests/engine/ghost.test.ts`).
4. Run the tests and the type check.

## 3. Add a setting

A setting is something the teacher can change in the settings panel before a game. Each one is described by a `SettingDecl` (in `src/engine/types.ts`). There are four kinds:

| `kind` | Example | Extra fields |
|---|---|---|
| `"number"` | Starting lives | `default`, `min`, `max`, `step`, optional `unit` (`"s"` or `"lives"`) |
| `"boolean"` | Live typing | `default` (true/false) |
| `"choice"` | Difficulty | `default`, `options: [{ value, label }]` |
| `"multi"` | Prompt types | `default` (a list), `options` |

Every setting also has a `key` (the name used in code), a `label` (what the teacher sees) and `help` (one short sentence).

**Where to put it:**

- If **only one mode** needs it, add it to that mode's `settings` list (for example the `settings` array in `src/engine/modes/classic.ts`). It only appears when that mode is picked.
- If **only one activity** needs it, add it to that activity's `settings` list (for example `src/engine/knockout/ghost.ts`).
- If **every game** needs it, add it to `CORE_SETTINGS` in `src/engine/settings.ts`.

You never need to check the teacher's input yourself. The engine fills in missing values with the default, keeps numbers between `min` and `max`, and throws away values that aren't in `options`. Settings can't change while a game is running.

**Read it** in a mode or activity with `ctx.settings.yourKey` (convert with `Number(...)` or compare with `=== true`), or in the room with `this.settings.yourKey`.

**Worked example:** a Classic setting for how many example answers to show.

1. In `src/engine/modes/classic.ts`, add to the `settings` array:

   ```ts
   { key: "exampleCount", label: "Example words", help: "How many example words to show after an explosion.",
     kind: "number", default: 3, min: 2, max: 3, step: 1 },
   ```

2. Use it where the example answers are made: in `src/engine/room.ts`, inside `explodedPrompt`, replace `EXAMPLE_COUNT` with `Number(this.settings.exampleCount ?? EXAMPLE_COUNT)`.
3. Add a test, for example in `tests/engine/classic.test.ts`: `room.updateSettings({ exampleCount: 9 })` and check `room.settings.exampleCount` is 3 (the maximum).
4. Run the tests and the type check.

The settings panel gets every setting from `settingsFor(modeId, activityId)` in `src/engine/registry.ts` (the control view sends it as `settingDecls`), so the new setting shows up without any screen changes.

Don't put the list of modes or activities into `CORE_SETTINGS`. The "Mode" and "When knocked out" choices are left empty there on purpose and filled in from `MODES` and `ACTIVITIES` (by `withChoices` in `src/engine/settings.ts`), so the registry is the only list.

## 4. Add a prompt type

A prompt type says where the letters must appear in a word. Today there are three: `contains`, `starts` and `ends`.

**Worked example:** a `middle` type, where the letters must appear in the word but not at its start or end ("ar" fits "part", not "art" or "car").

1. **The type.** In `src/engine/types.ts`, add it to the list:

   ```ts
   export type PromptType = "contains" | "starts" | "ends" | "middle";
   ```

2. **The rule.** In `src/engine/words.ts`, the `matches` function decides whether a word fits. It is a chain of `? :` checks whose last branch is `ends`, so a new type must get its own check:

   ```ts
   const matches = (p: Prompt, w: string): boolean =>
     p.type === "contains" ? w.includes(p.text)
     : p.type === "starts" ? w.startsWith(p.text)
     : p.type === "middle" ? w.slice(1, -1).includes(p.text)
     : w.endsWith(p.text);
   ```

3. **The setting.** In `src/engine/settings.ts`, add it to `PROMPT_TYPES` so the teacher can pick it: `{ value: "middle", label: "In the middle" }`.
4. **The prompts.** The prompt bank (`createPromptBank` in `src/engine/prompts.ts`) only deals prompts from the list it is given. Add prompts with `type: "middle"` to that list. Each one's `count` must be the number of known words that fit it, and its `common` the number of beginner words that fit it. Prompts with fewer than 20 known answers (`MIN_ANSWERS`) are dropped. The level comes from `common`: see "Prompt levels" below.
5. **Tests.** In `tests/engine/words.test.ts`, check that `matches({ text: "ar", type: "middle", count: 50, common: 10 }, "part")` is true and that `"art"` and `"car"` are false. In `tests/engine/prompts.test.ts`, check that the bank deals a `middle` prompt when `types` is `["middle"]`.
6. Run the tests and the type check.

The type check helps here: if you miss a place that has to handle every prompt type, `npx tsc -p tsconfig.json` will usually point to it.

### Prompt levels

Each prompt has a level, worked out by `levelOf` in `src/engine/prompts.ts` from its `common` count: how many **beginner words** (CEFR-J A1–A2, plus the place and holiday names and Roy's `known-extra.txt` words, all in `data/generated/beginner.txt`) contain it. The build (`src/words/build.ts`) works out `common` for every prompt.

The thresholds are in `LEVEL_MIN`:

```ts
export const LEVEL_MIN = { veryEasy: 15, easy: 8, medium: 4 } as const;
```

| Level | `common` |
|---|---|
| very easy | 15 or more |
| easy | 8–14 |
| medium | 4–7 |
| hard | under 4 (for example "sts" and "cts") |

The Difficulty setting (`band`) decides which levels are dealt:

- **Easy:** very easy and easy.
- **Normal** (default): very easy and easy, with medium for about 1 prompt in 5 (`NORMAL_MEDIUM_SHARE`). Never hard.
- **Rising:** uses the `stage` passed to `bank.next`. Stage 1 is very easy only, stage 2 very easy and easy, and stage 3 onwards is as Normal. Classic moves up a stage each lap (as many prompts as there were alive players when the lap began); Everyone at once moves up each round.
- **Hard:** every level.

If none of a band's levels has a prompt of the chosen types, the bank widens to include harder levels, one at a time, until it finds one. To make the game easier or harder overall, change `LEVEL_MIN` (higher numbers make each level harder to reach), run `npm run build:words` (the level counts in `data/generated/summary.json` are worked out by the build, and a test checks they are up to date), then run `npm test`: `tests/words/generated.test.ts` checks that Easy still has enough prompts and that STS and CTS stay hard.

## 5. Add a theme

A theme is one named list of colours. Every screen uses only those names, so a new theme needs no screen code.

1. **The colours.** In `public/app/themes.css`, copy a whole theme block, such as `:root[data-theme="enamel"] { … }`, and give it a new id, for example `data-theme="harbour"`. Change the colour values. Keep all 15 names: the comment at the top of the file says what each one is for. `themes.css` is the only file allowed to contain colour values.
2. **The id.** Add the id to `THEME_IDS` in **both** `src/engine/settings.ts` and `public/app/theme.js`. Keep one order everywhere: the blocks in `themes.css` must come in the same order as `THEME_IDS` (a test checks this), so put the new block and the new id in the same place, for example both last. A screen that gets an id it doesn't know shows Workshop.
3. **The name in the settings.** In `src/engine/settings.ts`, add `{ value: "harbour", label: "Harbour" }` to the options of the `theme` setting in `CORE_SETTINGS`. That is the name the teacher sees under **Look → Theme**.
4. **Run the tests.** `tests/client/themes.test.ts` checks that every theme has all 15 colours, that the lists on both sides match, and that the theme is readable: text against its background at 4.5:1 (3:1 for large text), and the bomb's rim at 3:1 against the stage. If a pair is too close, the test names it. Change that colour and run the tests again.
5. **Look at it.** Run `npm run screenshots` and open the new theme's pictures in `docs/screenshots/`. To see it on the real projector, pick it under **Look → Theme**. The theme can be changed at any time, even during a game.

## 6. Swap the bomb

The bomb (its drawing, the flame, the fuse, the turn arrow and the explosion) is all in one file: `public/app/bomb.js`. A new bomb design means replacing that file. Nothing else has to change, as long as the new file keeps:

- **`renderBomb(state, inner)`**, which returns the bomb as an HTML string. `state` says whether it is lit, where the arrow points, the countdown, how far the fuse has burnt and whether it is exploding (the `BombState` comment at the top of the file). `inner` is the prompt, already escaped, to put on the bomb's body.
- **`BOMB_CSS`**, every style, `@keyframes` and reduced-motion rule for the bomb, as one string. The pages put it in the page once.
- **`ARROW_SWING_MS`** and **`EXPLOSION_MS`**, how long the arrow's swing and the explosion take. `public/app/motion.js` uses them to know how long each one runs.
- **`data-bomb`** on the bomb's outer element. The pages add the class `urgent` to it in the last 3 seconds.
- **`data-countdown`** on the element with the countdown number. The pages change its text as the time counts down.

Keep to the same rules as the rest of the screens:

- Colours only by their theme names, such as `var(--bomb)` or `var(--spark)`, never a colour value. A test checks this.
- The bomb is the one place for bold animation. Under `prefers-reduced-motion: reduce`, the flame stands still, the arrow jumps, and the explosion is a short still flash.
- Every animation must work when the page redraws in the middle of it. The current file starts each one part-way through, with a negative `animation-delay`.

Then run `npm test` (`tests/client/bomb.test.ts` checks the file) and `npm run test:e2e`. One end-to-end test checks that the countdown number sits inside the dark body of the bomb, using the current drawing's sizes (the body's radius of 34 in a 120 box). Update it if the new bomb is a different shape. Finally, run `npm run screenshots` and look at the bomb in every theme.
