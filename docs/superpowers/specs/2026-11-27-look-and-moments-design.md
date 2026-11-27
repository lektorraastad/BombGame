# Bomb game: look and moments (batch 4)

Status: approved by Roy, 2026-11-27.

Batch 4 of the second round of improvements. It builds on the redesign (`2026-11-23-redesign-design.md`), batch 2's spotlight (`2026-11-26-spotlight-layout-design.md`) and `docs/design-principles.md`. Read those first.

Items marked **(Claude's call)** are proposals Roy hasn't confirmed. Everything else Roy said or chose. The mockups Roy reacted to are the private artifact "Wordfire mockups" (https://claude.ai/artifact/6PjfAhF8HKd1MjdzEjtYpR); the measured logo comes from `measure.cjs`, whose numbers are copied into section 4.3.

## 1. Why
Roy wants the game "way more polished" before he shows it to a class. It is mostly for fun, with a bit of learning. Claude's review of every screen found:
- **Everything is the same beige tile:** names, last words, the prompt, the typing and the room code. Nothing tells the eye where to look, and the student whose turn it is only gets a thin red outline.
- **The stage is flat and empty.**
- **The game has no name on screen.**
- **Good and bad moments barely register:** a correct word just appears under the name, a refused word only shows on that student's laptop, and a lost heart just disappears.
- **With a hidden fuse, nothing changes while a turn goes on.**

**Success:** from the back of the room, the class sees at a glance whose turn it is, feels a correct word, a lost heart and a win, and recognises the game as "Wordfire".

### The plan for the whole round (agreed with Roy)
- **Batch 4 (this document):** the look and the moments.
- **Batch 5:** the end of the game: a new results screen, positive-only awards, the word recap with copying from the control panel, and a private summary on each laptop.
- **Batch 6:** everyone involved: sparks for silent answers and ghosts, and better example words.

Roy's other decisions for later batches are recorded in section 8 so they aren't lost.

## 2. Goals, non-goals, anti-goals
**Goals**
- The **"two kinds of tile"** look with a **soft light in the middle**, on the projector and on student laptops.
- The **Wordfire logo** (the lit fuse), placed by measurement.
- **Six moments:** a correct word, a refused word, a lost heart, the explosion's example words, the win, and hidden-fuse tension.
- **Three new sounds** on the projector: a correct-word chime, a falling note for a lost heart, and a short tune for the win. Plus a soft patter and an all-answered chime in Everyone at once.

**Non-goals**
- No change to the game rules, timing, scoring, word checking or settings.
- No new results screen layout (batch 5) and no sparks for silent answers (batch 6).
- No change to the control panel's look, apart from the theme tokens it already follows.

**Anti-goals**
- Anything that tells the class when a hidden fuse will blow.
- Showing a refused or silent word's text on any shared screen.
- Moments that slow the game down or hide the prompt.
- Anything that breaks the readability rules (`design-principles.md` §5) or the projector privacy rule (no scores, ghost points, tokens or passcode).

## 3. Approaches
### How the screens learn about moments (Roy picked A)
| | What it is | Trade-off |
|---|---|---|
| **A. Extend the server's comparison (chosen)** | The hub already compares each broadcast with the one before and sends `lastEvent` ("explosion" or "word"). It learns more moments: whose word was accepted, whose hearts were lost, that the current player's word was refused, when the turn started, and who won. | Builds on what works. Game rules (`src/engine/`) untouched. The server sees refusals as they happen, and every screen hears the same moment at the same time. |
| B. Each browser works out moments itself | Each page compares its last view with the new one. | Fewest server changes, but a refused word can't be seen this way, and a laptop that drops its connection misses moments or plays them twice. |
| C. The game rules report moments | The engine keeps an event log. | Tidy, but opens the game-rules code that design work must not touch, for no gain over A. |

### How the turn stands out (Roy picked C, softened A's light)
| | What it is | Trade-off |
|---|---|---|
| A. Spotlight | A warm pool of light, a beam to the current player, whose name glows red. | Busiest; the beam moves every turn. |
| B. Dim the rest | Others fade, the current player grows and turns yellow. | Clearest, but other names get hard to read from the back. |
| **C. Two kinds of tile (chosen) + a soft light** | Names on smooth cream plates, letters and words on chunky tiles, a red plate for the current player, and a faint warm light around the bomb. | Calmest and fixes "everything is the same tile"; the soft light adds focus without a moving beam. |

### Logo (Roy picked 2, the lit fuse)
Rejected: 1, letter tiles ("WORD" plain, "FIRE" yellow); 3, a bomb badge. Roy asked for the flame's placement to be checked precisely; section 4.3 gives the measured geometry.

## 4. The design
### 4.1 Name plates and the turn
- **Names** sit on **smooth plates**: fully rounded ends, no chunky bottom edge, a soft drop shadow, the name in Rubik on a light fill. Only letters and words keep the chunky tile style (prompt, last words, typing, the text box, the room code).
- **The current player's plate** takes the theme's turn colour, with a light ring around it in `--plate`. It doesn't grow (no scaling, so nothing moves into a neighbour). **(Claude's call, after review)** Workshop's red turn colour is only about 2.6:1 against the stage, so the light ring is the plate's edge, the way the bomb's rim is the bomb's edge. The contrast test checks the ring against the stage (at least 3:1) and the turn plate's text against the turn colour (at least 4.5:1).
- **Knocked-out players** keep today's look (faded with a dashed edge), redrawn as a plate.
- **Each theme gets new colour tokens** in `public/app/themes.css`. Names are the builder's, for example: `--plate` and `--plate-ink` (the name plate), `--turn-ink` (text on the turn plate: Night fuse's turn colour is yellow, so it needs dark text), and `--stage-light` (the soft light in the middle).
- **The theme contrast test** covers every new text pair at 4.5:1 or more, and the turn plate's ring against the stage at 3:1 or more.
- **Laptops:** the same plates and soft light (Roy's decision). Their sizes follow today's seat sizes.

### 4.2 The soft light
- A faint warm radial light behind the bomb, fading out well before the seats, plus a slight darkening towards the screen's corners. It's static (no animation).
- **It must stay subtle:** about 7–8% brighter than the stage at its centre in Workshop. Each theme sets its own `--stage-light`. The mockup's `.v-cs` background is the reference.
- It sits behind everything and never lowers the contrast of any text (the contrast test measures against the stage colour, and the light must not make it worse).

### 4.3 The Wordfire logo
The lit fuse: "wordfire" in Rubik ExtraBold (800, the game's only Rubik file), a fuse running under the word from the left edge of the "w", curving up into a flame that stands after the "e".

**Geometry.** This is final. It was measured in Chromium with `public/fonts/rubik-latin-800-normal.woff2`, in units where 100 = the font size, with the baseline at y = 0:
- **Text:** `wordfire`, x = 0, font size 100, letter-spacing −2.
- **Fuse:** path `M4.9 7.8 C194.36 17.8 454 13.3 456 0`, stroke width 5.8, round caps.
- **Flame:** the bomb's flame shape (outer `M20 0 C27 13 40 22 37 38 C35 50 27 56 20 56 C12 56 3 50 3 38 C3 25 14 19 20 0Z`, inner `M20 22 C24 30 30 34 28 43 C27 50 23 52 20 52 C16 52 12 49 12 43 C12 35 18 31 20 22Z`), transformed by `translate(456 0) scale(1.3214) translate(-20 -56)`.
- **viewBox:** `0 -76 481 94`.

**What the measurements guarantee.** Error is given as a share of the font size:

| Rule | Measured |
|---|---|
| The flame stands on the baseline | exact |
| The flame's tip is level with the top of the "f" | within 0.002 |
| The gap between the "e" and the flame equals the median gap between letters | 0.048 against 0.049 |
| The fuse's rounded end lines up with the "w"'s left edge | exact |
| The fuse's closest point to any letter equals the letter gap | 0.050 against 0.049 |
| The fuse joins the flame with no gap | joined |

These hold only with this font file, this letter-spacing and this text. If any of them changes, run the measurement again.

**Colours, per theme:**
- text: `--names`;
- fuse: `--tile-edge`;
- flame: the bomb's flame colours in that theme (`--lives` outside, `--spark` inside) **(Claude's call, after review)**. The logo has its own copy of the flame *path* given above, which is the mockup's flame. `bomb.js` and the bomb's own flame don't change.

**Where it lives.** It's one self-contained file, `public/app/logo.js`, a pure function returning SVG markup (like `bomb.js`). It uses the page's Rubik font, which is already loaded.

**Placement** (Roy agreed):
- **Lobby (projector):** large at the top, above "Go to … and enter the code".
- **Results (projector):** large at the top.
- **During a game (projector):** small, top-left. In Everyone at once, "Round n" moves under it.
- **Student laptops:** small, in the top bar next to the student's name.
- **Size (Claude's call):**
  - The small logo is never less than 24 px tall at 1920×1080, so the fuse stays at least 1.4 px.
  - The large logo is about 90–110 px tall in the lobby, and never pushes the room code or the seats into overlap.

### 4.4 The moments
These are the rules for every moment:
- They are short, under a second, except the win.
- They use the existing "elapsed time" pattern. The pages redraw their HTML on every view, so each moment is drawn from "how long ago it started" through `public/app/motion.js`, as the arrow swing and the explosion are today.
- A moment is never replayed from the first view after a refresh or reconnect.
- With reduced motion, each moment shows its end state with no movement.
- They play on the projector and on laptops alike. Sound plays only on the projector.

| Moment | When | What the screens show | Sound (projector) |
|---|---|---|---|
| **Correct word** | The current player's word is accepted (Classic). | The matched letters of the spotlight word light up together with a small hop (about 200 ms), then the word shrinks and flies to the player's seat (about 350 ms), and the seat gives a small pop. The whole moment stays under 700 ms whatever the word's length. **It overlaps the new turn (Claude's call, after review):** the server moves the turn the moment a word is accepted, so the arrow swings and the new prompt appears at once, as today. The flying word is drawn on top and never holds the game back. If the next player starts typing during the flight, their typing takes the spotlight and the flying word carries on to its seat. Without a spotlight (live typing off, or more than 20 players) the word just pops in at the seat. | A soft two-note chime (triangle wave, G5 then C6, about 0.3 s). |
| **Refused word** | The current Classic player's word is refused because it's not a word, doesn't fit, was already used, or is blocked. | A gentle sideways shake (about 0.4 s), and the tiles dull for about half a second. It shakes the spotlight, or the typing under the seat when there's no spotlight, or the current player's name plate when live typing is off. There's no text and the word is not sent. | None. |
| **Lost heart** | A player loses a life (Classic explosion, or Everyone at once at the end of a round). | That heart swells, cracks in two and the halves fall away (about 0.9 s), for every player who lost one. | One soft falling note (sine, about 560 to 230 Hz, 0.45 s), once per broadcast however many lost a heart. It starts about 0.35 s after the explosion's boom, so the two don't land together **(Claude's call, after review)**. |
| **Explosion and example words** | Today's explosion, unchanged. | **The example words move from the faint bottom line to under the bomb, in the spotlight's place, much bigger** (Roy's choice, section 7 option a). | Today's explosion sound. |
| **Win** | The game ends with a winner. The projector keeps showing the circle for about 1.5 s after the last explosion, so the class sees the bomb go off and the last heart crack, then switches to results **(Claude's call, after review; display only, the server's phase changes at once as today)**. Laptops do the same. With no single winner (a shared win) the avatars pop together and the burst plays once. | On the results screen, the winner's avatar pops up, their name drops in tile by tile, and a burst of about 16 letter tiles (the letters of "WORDFIRE") flies out and falls (about 1.5 s). Batch 5 redesigns this screen and keeps this moment. | A short rising tune: C5, E5, G5, then C6 (about 1 s). |
| **Hidden-fuse tension** | Classic with a hidden fuse, while a turn goes on. | The flame grows slowly (up to about 1.45× its size) and flickers faster, based only on how long the current turn has lasted. It reaches full size at 25 s **(Claude's call)** and resets when the bomb passes. | The steady tick-tock speeds up slightly, from one every 1000 ms to one every 700 ms over the same 25 s. |

**Everyone at once** (Roy's choice (c)):
- **Answers:** a very short, soft patter tick per answer, never more than about 6 a second, with any extras dropped.
- **All answered:** one chime when every player still in the round has answered. The round keeps running to its countdown, as today.
- **Lost hearts:** at the end of a round, one falling note however many hearts were lost.
- **Correct words** have no flight in Everyone at once (there's no spotlight). The existing ✓ appears with the seat's small pop.

**Volumes:** every new sound goes through the existing Sound setting (Normal, Quiet or Off) and is no louder than today's tick-tock on Normal **(Claude's call)**.

### 4.5 What the server adds (approach A)
This changes the hub (`src/server/hub.ts`) and the views. It doesn't change `src/engine/` rules.
- **A list of moments with each broadcast.** Today's single `lastEvent` can only say "explosion" or "word", and loses one of them when both happen between two broadcasts. The views gain a list (for example `moments`) that names every moment since the last broadcast:
  - a word accepted, by whom;
  - hearts lost, by whom;
  - refused, by whom (only the current Classic player);
  - all answered;
  - the game won, by whom.
  
  `lastEvent` stays as it is, so the existing sound and motion code keeps working until it moves over.
- **Refused.** Today the hub only replies to the student who sent the word. It now also queues a broadcast with a "refused" moment, but only when the sender is the current Classic player and the reason is one of not-a-word, doesn't fit, already used or blocked. **The word itself is never put in the moment.** Refusals of silent answers and ghost words stay private, as today.
- **The turn's age.** In Classic with a hidden fuse, the views carry how long the current turn has lasted (in ms, at the time of the broadcast, like `bombRemainingMs`).
  - It's measured from the moment the current player got the bomb, and resets whenever the bomb passes.
  - **It must never be measured from when the fuse was set.** The engine re-arms the fuse when a correct word tops it up to the minimum turn time, so a value tied to the fuse would jump at that moment and tell the class the fuse was nearly out.
  - It's absent with a visible countdown, where the number already shows the time.
- **Privacy is unchanged:**
  - the projector still never gets scores, ghost points, tokens or the passcode;
  - laptops get the same moment list;
  - no moment carries any word a student typed (accepted words already appear in `lastWord`, as today).

### 4.6 The design principles change
`docs/design-principles.md` §6, "Boldness goes in one place: the bomb", becomes:
> Boldness goes in one place: the bomb. The flame flickers and the arrow swings once per turn. The explosion is the single big animation. A few short moments, each under a second, mark a correct word, a refused word and a lost heart, and the win gets a short celebration. Nothing else moves. Reduced-motion settings are respected: moments show their end state without movement.

Section 6's typefaces, and the "Agreed layout" section, are updated to describe the name plates, the soft light and the logo.

## 5. Checks
- **Unit tests for the server:**
  - each kind of moment appears exactly when it should;
  - two moments between broadcasts are both listed;
  - "refused" only for the current Classic player and only for the four reasons;
  - no moment contains a typed word;
  - the turn's age resets when the bomb passes, doesn't jump when a correct word tops up the fuse, and is absent with a visible countdown;
  - the projector view still contains no scores, ghost points, tokens or passcode.
- **Unit tests for the browser code:**
  - motion: each moment is timed from when it arrived, and nothing replays after a refresh;
  - the sound driver: one falling note per broadcast, the patter capped at about 6 a second, the all-answered chime once, sounds silent on Off, and no sound on laptops;
  - the logo returns the measured geometry and escapes nothing user-supplied (it has no user text);
  - the renderers stay pure and escape all player text.
- **Theme contrast tests** for every new token pair, in all three themes.
- **End-to-end checks:**
  - with 15 and 30 players, the logo in the corner overlaps no seat, the "Round n" label or the ⚙ buttons;
  - with the large logo in the lobby, nothing overlaps;
  - the existing overlap, arrow and countdown checks still pass;
  - each moment's end state is reached with reduced motion on.
- **Screenshots** refreshed (`npm run screenshots`). Roy tries everything on a deploy preview before it goes live, and not on a lesson day.

## 6. Left to the builder
- The exact token names and colour values per theme, within section 4.1's contrast rules.
- Exact durations and easing within the ranges above, matching the mockups.
- The exact shape of the moments list in the views.
- How the flying word is drawn across redraws (for example an overlay drawn from elapsed time).
- The small logo's exact position, within the no-overlap checks.

## 7. Where the example words go (Roy picked a)
**Where the big example words go after an explosion.** The mockup showed them in the bomb's place. But in today's game the next turn starts the instant the bomb explodes, with a new prompt on the bomb, so covering the bomb would hide the new letters. Options:
- **(a) Under the bomb, in the spotlight's place (chosen).** The words show there, big, for about 4 s, or until the next player types their first letter if that comes sooner. That also covers live typing being off and a slow start with a hidden fuse. They don't hide the prompt and need no rule change. In Everyone at once they show under the bomb for the first 4 s of the new round. With more than 20 players, the inner ring sits there, so the words stay on today's bottom line, made bigger.
- **(b) In the bomb's place, with a short pause (about 3 s) before the next turn.** It's closest to the mockup, but it changes the game's timing, which is a rule change.

## 8. Decided for later batches
These were decided with Roy on 27 November 2026 and are recorded here so they aren't lost. Each will get its own short design.
- **Batch 5, end of the game:**
  - **Awards,** at most 5, positive only, never anyone in last place. Every time: Winner, Longest word, Rarest word and Most words (Most words counts silent answers). Also Comeback or Best ghost when one happened. No Fastest answer.
  - **The word recap:** every word played, as a wall of tiles, plus a few chosen "words of the game". Roy can copy the list from the control panel. It's copied in his browser only, and nothing is stored on the server.
  - **A private summary on each laptop,** for example "You played 9 words. Your longest: chocolate".
- **Batch 6, everyone involved:**
  - **Sparks:** a spark on a seat when that student answers silently, and a fainter one for ghosts. The words are never shown.
  - **Example words:** always everyday words, never forms like "paragraphed".
