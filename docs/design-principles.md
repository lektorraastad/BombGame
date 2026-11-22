# Bomb game: design principles

Guiding principles for how the game looks, agreed with Roy on 22 November 2026. They apply to the redesign and to all later visual work. The same document is in the claude.ai project "Bomb game".

## 1. Design is separate from the game
The look of the game (colours, bomb, layout, sounds) never touches the game rules, server or word lists. Changing how it looks should never risk breaking how it plays.

## 2. Themes, chosen in the settings
- Every colour scheme is a **theme**. The host picks the theme in the game settings, and all screens follow it: projector, student laptops and control panel.
- This makes it possible to compare themes on the real projector, in a lit classroom, before deciding.
- **Making a new theme should be easy:** one small, named list of about 12 colours, such as stage, tiles, ink, prompt, whose turn, matched letters, lives and answered. No colour is typed directly into the screen code. Everything refers to the theme's named colours.

## 3. The bomb is one swappable piece
The bomb, its animated flame and the turn arrow are one self-contained drawing in its own file. A new bomb design means replacing that file. The rest of the game doesn't change.

## 4. Cost of later changes
| Change | Cost |
|---|---|
| New colours / new theme | Small: one list of colours |
| New bomb design | Small: one file |
| Layout changes (circle, word placement, Everyone-at-once look) | Medium: screen code only, covered by tests |
| Game rules, server, word lists | Untouched by design work |

## 5. Readability in a lit classroom
- Names, words and the prompt sit on light tiles with a dark outline. The darker background is only the frame around them, so it still works when a projector washes it out.
- Matched prompt letters are shown with colour **and** another cue, never colour alone. In the Workshop theme, matched letters are raised, highlighted tiles inside the word.
- Projector text is sized for the back of the room.

## 6. Identity: "letter tiles and a lit fuse"
- **The game's identity comes from its subject:** words made of letters, and a bomb with a fuse. The prompt, the matched letters and the text box all use the same chunky letter-tile style, like modern game pieces. There's no wood grain or letter points, so it doesn't copy a specific board game.
- **Boldness goes in one place: the bomb.** The flame flickers and the arrow swings once per turn with a small bounce. The explosion is the single big animation, and everything else stays still. Reduced-motion settings are respected.
- **Two typefaces:**
  - **Lexend for reading:** player words, the text box and messages. It's designed for easier reading, which suits second-language readers.
  - **Rubik, in a heavy weight, for display:** letter tiles, names and headings.

  Both are free (OFL) and stored in the project, never loaded from outside. Roy will download the font files.
- **No decoration for its own sake:** no halftone patterns, hard shadows everywhere, or identical boxes for everything.

## Themes
- **Starting theme, chosen by Roy: "Workshop"**

  | Colour | Use | Hex |
  |---|---|---|
  | Stage | Background | `#1F2A36` |
  | Letter tiles | Tiles | `#E8C48C` |
  | Tile edge | Tile shading | `#B48A4E` |
  | Tile ink | Text on tiles | `#2B1D10` |
  | Bomb / whose turn | Dynamite red | `#C8243A` |
  | Bomb shading | Darker bomb red | `#8E1626` |
  | Spark | Matched letters, arrow | `#FFC93C` |
  | Names on stage | Player names | `#F3EDE2` |
  | Muted | Secondary text | `#8D9AA8` |
  | Lives | Hearts | `#FF6B6B` |

- **Saved for later: "Slate and violet".** Roy wants to expand on it later. Sketch colours: background `#2C3442`, ring `#384152`, tiles `#EEF1F6`, ink `#151A23`, prompt `#FFE14D`, whose turn `#7C5CFF`, matched letters `#0F9F6E`, lives `#FF5C7A`.
- **Also sketched (not chosen), both candidates for extra themes:**
  - **"Enamel":** stage `#243244`, tiles `#F3F0E8`, tile ink `#1A2430`, tile edge `#C9C3B4`, bomb `#1A2430`, whose turn `#FF5A4E`, spark `#FFD23F`, names `#EEF2F7`, muted `#93A1B3`.
  - **"Night fuse":** stage `#16202A`, tiles `#DCE6E1`, tile ink `#13201B`, tile edge `#A9BAB2`, bomb `#0E141A`, whose turn `#FFC23D`, spark `#E8364F`, names `#E8EEF0`, muted `#7F8E99`.
- **Rejected:** the BombParty screenshot's brown colours, pixel-art styles, and generic "dark background plus one neon accent" palettes.

## Agreed layout (redesign)
- **The circle:** a bomb in the middle with the prompt on it as letter tiles and an animated lit fuse. In Classic, an arrow rotates to the student whose turn it is.
- **Each player:** their chosen emoji avatar (from a fixed set of 60), name, lives and last word, with the prompt letters highlighted as tiles. Live typing is shown with a cursor (Roy accepts an occasional rude word as a tradeoff), and known rude words from the block list are masked (★★★★) as they're typed.
- **Student screens:** students see the same circle and bomb, with their own tile-style text box along the bottom.
- **Everyone at once:** there's no arrow. The bomb stays in the middle with its fuse burning down for the round, names tick off with ✓ as students answer, and words are shown after the round.
- **Large classes:** names and avatars shrink, and above 20 players they sit in two rings.

## Proposed, not yet confirmed by Roy
- **Joining:** students type their name, then tap one of the 60 emoji in a grid.
- **Lobby:** the room code shown large on letter tiles, with avatars popping into the circle as students join.
- **Results:** the winner's avatar in the middle where the bomb was, with the ghost leaderboard and the longest word around it.
