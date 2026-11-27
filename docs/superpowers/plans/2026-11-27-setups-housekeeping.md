# Ready-made setups and housekeeping: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Gentle, Normal and Fast setups at the top of the settings panel, with "Custom" after a manual change and every other setting folded under "More settings".
- Housekeeping: pin `@netlify/server`, two small doc fixes, and the root cause of the flaky 24-player e2e test.

**Architecture:**
- The setups live in the engine: a new `src/engine/presets.ts`, plus a `preset` core setting.
- `Room.updateSettings` applies a chosen setup's values. When the mode changes, it applies them again for the new mode's settings.
- Changing any setup-controlled key by hand sets `preset` to `"custom"`.
- The control panel (`public/app/render-control.js`, `public/app/panel-page.js`) shows Mode, the setup buttons and the "More settings" `<details>`.

**Tech Stack:**
- TypeScript engine with `node:test` via `tsx`.
- The browser client is plain ES modules.
- End-to-end tests run in Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-setups-housekeeping-design.md` (approved by Roy 2026-11-27).

## Global Constraints
- **Setup values, exact:**

  | Key | gentle | normal | fast |
  |---|---|---|---|
  | `band` | easy | normal | normal |
  | `startLives` | 3 | 2 | 2 |
  | `maxLives` | 3 | 3 | 3 |
  | `fuseMin` | 15 | 10 | 6 |
  | `fuseMax` | 40 | 30 | 20 |
  | `minTurn` | 10 | 8 | 5 |
  | `turnTime` | 18 | 12 | 8 |
  | `roundTime` | 25 | 15 | 10 |

- **Normal** equals today's defaults exactly. A new room starts with `preset: "normal"`.
- **The `preset` setting:** key `preset`, label "Setup", values `gentle`, `normal`, `fast` and `custom`, default `normal`.
  - The control panel offers only the three buttons. `custom` is never chosen directly.
  - Sending `{ preset: "custom" }` is accepted and changes nothing else.
- **What a setup never touches:** mode, theme, timerStyle, promptTypes, bonusAlphabet, bonusLetters, knockout, exampleAnswers, liveTyping, silentAnswers, comeback, comebackStreak and shrinking.
- **The rules:**
  - Choosing a setup applies its values for the keys the current mode has.
  - A manual change to any setup key sets `preset` to `"custom"`, unless the change puts the value back to the active setup's own value.
  - A mode change applies the active setup's values for the new mode's keys. If it is `custom`, nothing is reapplied.
  - While a game runs, `preset` is locked like the other settings. The theme stays live.
- **The panel:**
  - Order inside "Settings": Mode, the setup buttons, the "few prompts" warnings, then `<details class="more"><summary>More settings</summary>` holding every other setting in today's order.
  - The buttons are `<button type="button" data-preset="gentle|normal|fast" aria-pressed="true|false">`, labelled Gentle, Normal and Fast.
  - A line under the buttons reads `Using: Gentle`, `Using: Normal`, `Using: Fast` or `Using: Custom`.
  - The ⚙ overlay shows the same panel, without scores, as today.
- **No privacy change.** The projector shows nothing new.
- **Finish every task green:** `npm test` and `npx tsc -p tsconfig.json`, plus `npm run test:e2e` where the task touches the client.

## Review Focus
1. **Junk preset value:** `{ preset: "extreme" }` resolves to the current one (or the default), and nothing crashes. *(Task 1 test.)*
2. **A setup chosen and a key changed in the same message:** `{ preset: "gentle", fuseMin: 20 }` gives Gentle's values with fuseMin 20, and preset `custom`. *(Task 1 test.)*
3. **Switch mode to Everyone at once and back to Classic under Gentle:** fuseMin, fuseMax and minTurn are Gentle's again, not the defaults. *(Task 1 test.)*
4. **The "more settings" fold:** it must not close by itself on every view update while Roy is editing inside it. Today the panel re-renders on every update, so the open state has to survive a re-render. *(Task 2 test, in render or e2e.)*
5. **A setup click during a running game:** it is refused, and the panel shows the existing "locked" note. *(Task 2 test.)*

---

### Task 1: Setups in the engine

**Files:**
- Create: `src/engine/presets.ts`
- Modify: `src/engine/settings.ts`, `src/engine/room.ts`
- Test: `tests/engine/presets.test.ts`, and `tests/engine/settings.test.ts` where the core list changed

**Interfaces:**
- Produces:
  - `export const PRESET_IDS = ["gentle","normal","fast"] as const`
  - `export type PresetId = typeof PRESET_IDS[number]`
  - `export const PRESETS: Record<PresetId, Record<string, number | string>>`, holding the values table
  - `export function presetOf(settings: Settings): PresetId | "custom"`, the setup whose values (for the keys present in `settings`) all match, else `"custom"`
- Produces: the core setting `{ key: "preset", label: "Setup", kind: "choice", default: "normal", options: gentle, normal, fast, custom }`, placed right after `mode` in `CORE_SETTINGS`.
- Produces: `Room.updateSettings(input)` follows the rules in Global Constraints. The view's `settings.preset` reports the active setup.

- [ ] **Step 1: Write the failing tests.**
  - `PRESETS.normal equals today's defaults`, compared against the resolved defaults of a fresh room for every key in the table.
  - `a new room uses Normal`.
  - `choosing Gentle sets its values for Classic`.
  - `a manual change makes it Custom; changing it back makes it Gentle again`.
  - `{ preset: "gentle", fuseMin: 20 } gives Gentle with fuseMin 20 and preset custom`.
  - `switching mode keeps Gentle's values` (Classic → Everyone at once gives roundTime 25; → Classic gives fuseMin 15, fuseMax 40, minTurn 10, turnTime 18).
  - `Custom is not reapplied on a mode switch`.
  - `a junk preset is ignored`.
  - `a running game refuses a preset change`.
  - `a setup never changes mode, theme, timerStyle or the other untouched keys`.
- [ ] **Step 2:** Run `npx tsx --test tests/engine/presets.test.ts`. Expect failures.
- [ ] **Step 3:** Implement. Keep `resolveSettings` pure. Put the setup logic in `presets.ts`, and call it from `Room.updateSettings`.
- [ ] **Step 4:** Run `npm test` and `npx tsc -p tsconfig.json`. Expect both to pass.
- [ ] **Step 5:** Commit with the message `Setups: Gentle, Normal and Fast in the engine`.

### Task 2: The settings panel

**Files:**
- Modify: `public/app/render-control.js`, `public/app/panel-page.js`, `public/app/style.css` (the buttons and the fold, using theme tokens only)
- Test: `tests/client/render-control.test.ts`, and `tests/e2e/game.e2e.ts` (one check)

- [ ] **Step 1: Write the failing tests.**
  - Render: Mode, then three setup buttons with `aria-pressed` matching `settings.preset`, then `Using: …`, then the warnings, then `<details class="more">` containing every other field. Theme stays under "Look".
  - Render: the `preset` declaration is not drawn as a `<select>`.
  - Render: the overlay has no score columns (the existing check still passes).
  - Render: while a game runs, the buttons are disabled.
  - Open state: a render option (for example `ui.moreOpen`) puts `open` on the `<details>`. The page keeps that state across re-renders.
  - E2e: click Gentle in the control panel and start a Classic game. Expect 3 hearts per player and `Using: Gentle`. Then open "More settings", change "Shortest fuse", and expect `Using: Custom` and the fold still open.
- [ ] **Step 2:** Run the tests. Expect failures.
- [ ] **Step 3:** Implement. A click on a setup button sends `{ t: "cmd", cmd: "settings", settings: { preset: id } }`, through the same path as today's field changes.
- [ ] **Step 4:** Run `npm test`, `npx tsc -p tsconfig.json` and `npm run test:e2e`. Expect all to pass.
- [ ] **Step 5:** Commit with the message `Settings panel: setup buttons and More settings`.

### Task 3: Housekeeping

**Files:**
- Modify: `package.json` (pin `@netlify/server`), `docs/EXTENDING.md`, `tests/e2e/game.e2e.ts` (the 24-player test, root cause only), `CLAUDE.md`, `README.md` (how to use the setups, in Roy's click-by-click style), `docs/screenshots/*` (`npm run screenshots`, the control panel shots)

- [ ] **Step 1: Pin `@netlify/server`.** Pin it to the exact version currently installed (`node_modules/@netlify/server/package.json`; it is 0.1.6 as of 2026-11-27). If `npm view @netlify/server version` is newer, still pin the installed one, which is what was tested, and note the newer version in CLAUDE.md. Remove the CLAUDE.md "To do" line.
- [ ] **Step 2: Fix `docs/EXTENDING.md`.**
  - Say "player words" in the privacy rules.
  - Note that the control screen receives typing but doesn't draw it.
  - Also note the new setups: where the values live, and that a new setup-controlled key must be added to `PRESETS`.
- [ ] **Step 3: Find the root cause of the flaky "two rings for 24 players" test.** Use superpowers:systematic-debugging. Reproduce the test first (it fails about 1 run in 20: two seats' boxes touch by a few px with certain random words). Fix the cause, not the symptom: for example, the test's long-word picks, the box comparison (compare drawn parts as the spotlight tests do), or a real layout overlap in the CSS. Show it passing 30 runs in a row.
- [ ] **Step 4: Update the docs.**
  - README: "Before a lesson: pick Classic or Everyone at once, then Gentle, Normal or Fast. Other settings are under More settings."
  - CLAUDE.md: add the batch 3 spec and plan paths, raise the plan count to eight, and update "What's next" (batch 3 built on branch `claude/elegant-newton-cozbue`, waiting for Roy's go-ahead; remove the small follow-ups item, which is now done).
  - Refresh the screenshots.
- [ ] **Step 5:** Run `npm test`, `npx tsc -p tsconfig.json`, `npm run test:e2e` and `npm run load-test`. Expect all to pass.
- [ ] **Step 6:** Commit with the message `Housekeeping: pin Netlify server, docs, steady 24-player test, screenshots`.
