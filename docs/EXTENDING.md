# Extending the game engine

This guide is for anyone changing the game later: a teacher who is new to code, or an AI assistant helping them. It covers the four usual changes:

1. [Add a game mode](#1-add-a-game-mode)
2. [Add a knockout activity](#2-add-a-knockout-activity)
3. [Add a setting](#3-add-a-setting)
4. [Add a prompt type](#4-add-a-prompt-type)

All the game rules live in `src/engine/`. That code has no network or screen code in it, so it can be tested on its own.

## Map of the engine

| File | What it holds |
|---|---|
| `src/engine/types.ts` | Shared types: `Prompt`, `PromptType`, `SettingDecl`, `Settings`. |
| `src/engine/settings.ts` | `CORE_SETTINGS` (settings every game has) and the code that checks the teacher's choices. |
| `src/engine/words.ts` | Tidying up typed words, checking they are real words and fit the prompt, example answers. |
| `src/engine/prompts.ts` | The prompt bank: picks the next prompt by difficulty and type. |
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
- **The projector** never shows ghost words, silent answers, ghost points or scores.
- **Student screens** never show other players' scores, ghost points or words. Each student sees only their own score, and a ghost sees only their own ghost points and streak (in `me.activity`).
- Otherwise, ghost points appear only in the results' ghost leaderboard and on the teacher's control screen.
- **Live typing** is off by default. When it is on, the projector shows only the text of the one player who is on (Classic's current player), and never during the results. Typed text is cleared every time a new prompt is dealt, so a half-typed (or silent) word never shows for the next turn.
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
4. **The prompts.** The prompt bank (`createPromptBank` in `src/engine/prompts.ts`) only deals prompts from the list it is given. Add prompts with `type: "middle"` to that list. Each one's `count` must be the number of known words that fit it. Difficulty comes from `count` (Easy 200 or more, Medium 60–199, Hard 20–59), and prompts with fewer than 20 are dropped.
5. **Tests.** In `tests/engine/words.test.ts`, check that `matches({ text: "ar", type: "middle", count: 50 }, "part")` is true and that `"art"` and `"car"` are false. In `tests/engine/prompts.test.ts`, check that the bank deals a `middle` prompt when `types` is `["middle"]`.
6. Run the tests and the type check.

The type check helps here: if you miss a place that has to handle every prompt type, `npx tsc -p tsconfig.json` will usually point to it.
