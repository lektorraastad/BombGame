# Bomb game: spotlight layout (batch 2)

Status: approved by Roy, 2026-11-26.

Batch 2 of Roy's improvements (`docs/improvements.md`, item 1). It builds on the redesign (`2026-11-23-redesign-design.md`) and `docs/design-principles.md`. Read those first.

Items marked **(Claude's call)** are proposals Roy hasn't confirmed. Everything else Roy said or chose.

## 1. Why
Roy: "The bomb should be a bit smaller, to allow for the students' names and what they are typing to be bigger."

On today's projector with 15 players:
- the names are 32 px;
- the live typing is 29 px, about the same size as everyone's old words;
- the bomb is 446 px wide;
- the middle of the circle is mostly empty.

When the seats were made bigger in place, long words ran into their neighbours, especially at the bottom of the oval. Prototype pictures were made from the real game with CSS laid over it.

**Success:** the class can read every name and, above all, what the student on the turn is typing, from the back of the room. Nothing overlaps.

## 2. Goals, non-goals, anti-goals
**Goals**
- A smaller bomb.
- Bigger names.
- The current player's live typing shown big in the middle of the circle, just under the bomb (the "spotlight").
- The same on the projector and on student laptops.
- Designed for 15 players, and still readable at 30.

**Non-goals**
- No change to game rules, timing, scoring or what the server sends.
- No new bomb drawing.
- No change to the lobby or results screens. (Their seats follow the same sizes, so they get bigger names too, as long as nothing overlaps.)

**Anti-goals**
- Anything overlapping: a seat on a seat, the spotlight on the arrow, the bomb or a seat, or the countdown off the bomb.
- Prompt letters that can't be read from the back of the room.
- Showing anything new on the projector that it mustn't show, such as scores.

## 3. Approaches (Roy picked B)
| | What it is | Trade-off |
|---|---|---|
| A. Bigger ring | The bomb shrinks to about 350 px. Names and the typing under each seat grow. | Simple, but the typing still sits under the seat. With a long word it runs into the neighbours, especially at the bottom. |
| **B. Spotlight (chosen)** | The bomb shrinks to about 295 px. The current player's typing appears large in the empty middle, under the bomb and below the arrow. | Uses the space everyone already looks at, and nothing collides. The prompt letters on the bomb get a little smaller (about 68 px against 80 px today). |

Roy agreed earlier that the prompt letters may shrink with the bomb, as long as they stay readable. They remain the biggest letters on screen. This replaces the redesign's earlier minimum for prompt tiles (110 px at 1920×1080). The new minimum is a prompt letter size of at least 60 px at 1920×1080 **(Claude's call)**.

## 4. The design
**The spotlight**
- **Contents:** the current player's live typing, shown as the same letter tiles with the cursor. It sits centred under the bomb, below the reach of the turn arrow (about 0.62 × the bomb's size below the centre).
- **Size:** about 6.5% of the circle's height on the projector (about 64 px at 1920×1080) and about 6% on laptops.
- **When it shows:** in Classic with Live typing on, at 20 players or fewer, while someone is on.
  - It appears with the first typed letter. (Changed after approval: the screens only receive the typing once there is some, and they aren't told whether Live typing is on, so an empty cursor first would need a change to what the server sends. Until the first letter, the seat on its turn shows its last word, as today.)
- **When it doesn't show:**
  - **Everyone at once:** there's no single typer.
  - **Live typing off.**
  - **More than 20 players:** the inner ring sits there. With two rings, the typing stays under the player's seat as today **(Claude's call: same size as today, since the design is for 15)**.
- **The seat on its turn:** while the spotlight shows, the seat has its name, emoji and hearts with the turn ring, and nothing under them, since the word is in the spotlight.
- **Masking:** rude words are masked (★★★★) exactly as today. The server already does this, and nothing changes.
- **Same picture everywhere:** every screen shows the same spotlight, including the typing student's own laptop **(Claude's call: one picture for everyone, and the student's own box is at the bottom anyway)**.

**Sizes**
Today's sizes, the target sizes, and the target pixels at 1920×1080 (projector) or 1366×768 (laptop):

| | Today | Target | Target px |
|---|---|---|---|
| Bomb, projector, one ring | 47% of circle height | about 31% | about 295 px |
| Bomb, laptop | 44% | about 32% | about 175 px |
| Names, projector, 11–16 seats | 3.4% | about 4.4% | about 42 px |
| Names, laptop, 11–20 seats | 2.7% | about 3.4% (at least 14 px) | about 18 px |
| Last words | 0.8 × the name | about 0.72 × the name | |
| Spotlight, projector | none | about 6.5% | about 64 px |

**Rules for the builder**
- **Other seat counts:** 2–10 seats and 17–20 seats get proportionally bigger names too, as long as nothing overlaps. Names are never smaller than today at any seat count.
- **Fit:** the prompt letters grow relative to the smaller bomb so they still fit, and may reach past the body at the sides, as today. The countdown number stays on the bomb's dark body.
- **Two rings (more than 20 players):** the bomb and seats keep today's sizes unless the change fits without overlaps. Today's 24-player and 30-player checks must still pass.
- **Long words:** in the prototype, a few long last words (such as "headphone" or "attending") touched the next seat. The builder fixes this with sizes or spacing so nothing overlaps.

**Where it lives (design work only)**
- The spotlight is drawn by `public/app/render-circle.js`. It's a pure function that returns escaped HTML from `view.typing`, which every screen already receives.
- The sizes are in `public/app/style.css`.
- `bomb.js`, the engine, the server and the views don't change.

## 5. Checks
- **New end-to-end checks with 15 players** on the projector (1920×1080) and a laptop (1366×768):
  - no seat overlaps another seat, even with long last words of up to 12 letters;
  - the spotlight doesn't overlap the bomb, the arrow at any angle, or any seat, with a 12-letter typed word;
  - the countdown stays on the bomb;
  - the spotlight's text is the current player's typing.
- **Unit tests:**
  - the spotlight appears only in the cases above;
  - its text is escaped and masked;
  - the seat on its turn shows nothing under the name when the spotlight is on.
- **Existing checks still pass:** the 24-player two-ring check, the countdown-on-the-body check, the arrow checks and the theme contrast tests.
- **Screenshots** are refreshed (`npm run screenshots`). Roy approves the final look on a deploy preview before it goes live, and not on a lesson day.

## 6. Left to the builder
- Exact sizes within the targets above.
- How to stop long words touching, within the no-overlap rule.
- The spotlight's exact gap below the arrow.

## Potential future improvements
- Show the current player's name in the spotlight too, for example "Thea: himse|". Not chosen now, because the arrow and the turn ring already show whose turn it is.
