# Bomb game: ready-made setups and housekeeping (batch 3)

Status: draft for Roy's approval, 2026-11-27.

Batch 3 of Roy's improvements, agreed in the conversation of 26–27 November 2026. Items marked **(Claude's call)** are proposals Roy hasn't confirmed. Everything else he chose.

## 1. Why
The settings panel shows about 20 settings at once, including ones that don't apply. Roy wants a quick way to set up a lesson, and the details out of the way.

**Success:** Roy picks a mode and a setup in two clicks, and never has to open "More settings" in a normal lesson.

## 2. Goals, non-goals, anti-goals
**Goals**
- Three ready-made setups at the top of the settings: **Gentle**, **Normal** and **Fast**.
- The panel shows which setup is active, or "Custom" if a setting was changed by hand.
- Visible without opening anything: Mode, the three setup buttons and Theme (under "Look", as today).
- Everything else sits under **More settings**, folded, and opens with one click.
- Every new room starts on **Normal**. Nothing is remembered between rooms.

**Housekeeping**
- Pin `@netlify/server` to an exact version instead of `"latest"`.
- The two small fixes in `docs/EXTENDING.md`:
  - say "player words" in the privacy rules, since the dictionary examples are also shown;
  - note that the control screen receives typing but doesn't draw it.
- Find and fix the cause of the end-to-end test that sometimes fails: "two rings for 24 players", which fails about 1 run in 20 with a tiny seat overlap.

**Non-goals**
- New settings.
- Changing what any setting does.
- Remembering setups between lessons.

**Anti-goals**
- A setup silently changing a setting Roy didn't expect, such as the mode or the theme.
- Losing a setup's values when Roy switches mode.
- Settings that can't be reached any more.

## 3. The setups (Roy approved these values)
| | Gentle | Normal (today's defaults) | Fast |
|---|---|---|---|
| Difficulty | Easy | Normal | Normal |
| Starting lives / maximum | 3 / 3 | 2 / 3 | 2 / 3 **(Claude's call: maximum 3)** |
| Hidden fuse | 15–40 s | 10–30 s | 6–20 s |
| Shortest turn | 10 s | 8 s | 5 s |
| Visible countdown, turn time **(Claude's call)** | 18 s | 12 s | 8 s |
| Everyone at once, round time | 25 s | 15 s | 10 s |

**Rules (Claude's call):**
- **What a setup leaves alone:** Mode, Theme, Timer style (hidden or visible), Prompt types, Bonus alphabet, Bonus letters, When knocked out, Example answers, Live typing, Silent answers, Comebacks and Shrinking rounds.
- **Which values count:** a setup sets the timing values of both modes, whichever mode is selected.
- **The active setup:** the one whose values all match the current settings. Otherwise the panel shows "Custom".
- **Switching mode keeps the chosen setup.** Today the game keeps only the current mode's settings, so a switch would reset the other mode's timing to its defaults. The game must remember which setup was chosen and apply its values for the new mode. If Roy had set the values by hand (Custom), today's behaviour stays.
- **While a game runs** the setup buttons are locked, like the other settings. Theme can still change.

## 4. Layout of the settings panel
- **Look:** Theme, as today, always changeable.
- **Settings:**
  - Mode;
  - the three setup buttons, in a row, showing the active one (pressed, and with its name in the help text: "Using: Gentle" or "Using: Custom");
  - a **More settings** section, folded, using the browser's own open and close (`<details>`), holding every other setting in today's order.
- **The "few prompts" warnings** stay visible above "More settings", so a problem is never hidden.
- **The ⚙ overlay** shows the same panel, still without scores **(Claude's call)**.

## 5. Approaches (for the remember-the-setup rule)
| | What it is | Trade-off |
|---|---|---|
| **A. The engine knows the setups (chosen, Claude's call)** | The setup list lives in `src/engine/`. A `preset` value in the room's settings records the chosen setup, and resolving settings applies its values for the current mode. | One source of truth, tested in the engine, and mode switches just work. It's a small engine change, which is fine because this is settings logic, not design work. |
| B. The panel applies the values | The control panel sends all the values when a button is clicked. | No engine change, but a mode switch loses the other mode's values, which is an anti-goal. |

## 6. Checks
- **Unit tests:** each setup's values; "Custom" after a manual change; a mode switch keeps the setup; a new room starts on Normal; a running game locks the setup.
- **Control panel rendering tests:** the buttons, the pressed state, the "More settings" fold, warnings outside the fold, and nothing private in the overlay.
- **One end-to-end check:** click Gentle, start a game and see easy letters and 3 lives.
- **The 24-player test:** passes 30 runs in a row after the fix.
- **All existing tests stay green.** Screenshots of the control panel are refreshed.

## 7. Left to the builder
- Exact wording of the help text.
- How the version of `@netlify/server` is chosen: the version Netlify used for the last live build if it can be read, otherwise the current latest. Either way, test it on the deploy preview.
