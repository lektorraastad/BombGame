# Bomb game: redesign

Status: draft for Roy's approval, 2026-11-23. Nothing is built until Roy approves.

This builds on `docs/design-principles.md` (the agreed look: "letter tiles and a lit fuse", the Workshop theme, two typefaces, readability rules) and on the original design in `2026-11-21-bomb-game-design.md`. Read both first. This document doesn't repeat them; it says what the redesign changes and decides what they left open.

Items marked **(Claude's call)** are proposals Roy hasn't confirmed; they work as defaults and can be changed later. Everything else is something Roy said or agreed to.

---

## 1. Why

- The game works, but it looks generic. The current "sticker comic" style (indigo stage, halftone dots, hard shadows) is what `design-principles.md` rejects.
- Roy wants the game to have its own identity, taken from its subject: words made of letters, and a bomb with a fuse.
- It must stay readable on a washed-out classroom projector in a lit room, and from the back of the room.
- Big classes (up to 30) need a circle that still fits and that students can find themselves in. Emoji avatars help with that.
- Roy wants to compare colour schemes on the real projector before settling on one.

Success: Roy runs a lesson on the new look and the class can read the prompt, find themselves on the circle, see whose turn it is, and follow live typing, with nothing slower or less reliable than before.

## 2. Goals, non-goals, anti-goals

**Goals**
- A theme system with three themes: **Workshop** (the default), **Enamel** and **Night fuse**. The host picks one in the settings, and the projector, student screens, control panel and ⚙ overlay all follow it.
- The Lexend and Rubik typefaces, stored in the project.
- A new bomb: animated flame, a turn arrow that swings to the current player, and one big explosion animation. All in one swappable file.
- Emoji avatars: a fixed set of 60, one per student, no two students with the same one.
- The circle (bomb in the middle, players around it) on the projector **and** on student screens.
- Live typing for the current player in Classic, on by default, with simple masking of blocked words.
- Two rings when there are more than 20 players.
- New lobby and results screens (section 5).
- Ghosts on the results screen ranked without points.

**Non-goals**
- The "Slate and violet" theme (later).
- Teams and Class vs the bomb modes (later).
- Any change to game rules, timings, scoring, prompts or word lists.
- New sounds. The existing sounds stay as they are.
- The connection test page (`/check/`) keeps its current look.
- Optimising for phones (as in the original design).

**Anti-goals** (these would make it a failure even if it technically works)
- The student page loading noticeably slower on the school network.
- Animation that pulls attention away from the prompt. Boldness belongs to the bomb only.
- Text that becomes hard to read on a washed-out projector.
- A rude nickname getting through. Nickname blocking must stay exactly as strict as now.
- Anything private (scores, ghost points, tokens, passcode) appearing on the projector or the ⚙ overlay.

## 3. Constraints

- Every rule in `CLAUDE.md` still applies: no deploys on lesson days, privacy, untrusted student input, escaping, no crash from one room or client.
- **Design work never changes game logic.** The redesign needs four small server additions (section 7), none of which change how the game is played. Each is built test-first.
- No build step for the browser client: plain ES modules, as now.
- No outside requests from the browser: fonts and emoji pictures are files in the project.
- Reduced-motion settings are respected everywhere.
- Student laptops: typically 13–14" screens around 1366×768. The projector is Roy's laptop at whatever resolution it outputs.
- Up to 32 players in a room.

## 4. Approaches considered

| Option | Trade-off | Decision |
|---|---|---|
| **A. Restyle the existing screens.** Keep the pure renderer functions and one stylesheet; add theme colour lists, one bomb file, a folder of emoji pictures and the fonts. | Keeps every existing test working and extends them. Light for students to load. Fits "no build step". | **Chosen** by Roy. |
| B. Rebuild the screens with a front-end framework (e.g. React, Svelte). | More animation tools, but adds a build step and many packages, and rewrites screens that already work. Nothing in the design needs it. | Rejected. |
| C. Draw the game screens on a canvas, like a video game. | Smoothest animation, but text becomes pictures: harder to read, test and keep escaped. | Rejected. |

**Emoji source (Claude's call):** emoji pictures are stored in the game rather than using each laptop's own emoji font, because Windows, Chromebooks and Macs draw emoji differently and some older systems lack newer ones. The builder chooses one openly licensed set (for example Microsoft Fluent Emoji (MIT), Twemoji, or Noto Emoji (Apache 2.0)), credits it in the lobby credits line, and shows Roy the chosen 60 as one sheet before wiring them in.

**Fonts (Claude's call):** Roy doesn't need to download anything. The builder takes Lexend and Rubik from the Fontsource packages on npm (both OFL-1.1), copies the needed `.woff2` files into the project once, and adds the licence. They must cover Norwegian letters (æ, ø, å), since nicknames use them.

## 5. What each screen shows

### 5.1 Joining and avatars (student)
1. The student types the room code and a nickname, as now, and presses Join.
2. On joining, the server gives them a **random free emoji** straight away **(Claude's call)**, so every player always has one and two quick students can never end up with the same one.
3. The student then sees a grid of all 60 emoji with theirs highlighted. Emoji other students have taken are greyed out. Tapping a free one switches to it. If someone else got it a moment earlier, they see "Taken, pick another".
4. A student can change their emoji any time in the lobby, but not during a game. A late joiner (spectator) can pick while waiting.
5. The emoji stays with the student through reconnects. A kicked student's emoji becomes free again.
6. The 60 are animals, food and objects. No faces with skin tones, no flags, and nothing students would use as a joke (no 🍆, 🍑, 💩, 🖕) **(Claude's call on the exact list; Roy sees the sheet)**.
7. The host can't change a student's emoji (all 60 are harmless). Host rename works as now.

```
  Room code: KPRT    Name: [ Ingrid    ]
  Pick your emoji:
  🦊 🐸 🐙 🦉 ▒▒ 🐢 🍕 🚀 ▒▒ 🌵
  🐝 🦖 🍩 🎸 🐧 ⚽ 🌈 🦄 🐳 🍉 …
  (▒▒ = taken)
```

### 5.2 Lobby (projector)
- The site address, then the room code large on letter tiles.
- The bomb in the middle with its fuse **unlit** (no flame). It lights when the game starts **(Claude's call)**.
- Each student's emoji and name pop into place around the circle as they join. This small pop is the one animation outside the bomb, and it's off under reduced motion.
- "12 joined", the locked notice when locked, and the credits line, as now.

```
        Go to bombgame.netlify.app
        [K][P][R][T]
     🦊 Ingrid      🐸 Ola
   🐙 Aisha    💣     🦉 Jonas
     🍕 Emil       (12 joined)
```

### 5.3 Classic (projector)
- The bomb in the middle, with the prompt on it as letter tiles and the prompt type ("CONTAINS", "STARTS WITH", "ENDS WITH") above. The flame flickers continuously.
- The arrow points from the bomb to the current player and swings to the next player once per turn, with a small bounce.
- Each player: emoji, name, hearts, and their last word with the prompt letters shown as raised highlighted tiles inside the word (colour **and** shape, never colour alone). Knocked-out players are dimmed; offline players are marked as now.
- The current player's live typing appears under their name, with a cursor.
- With the hidden (original-style) fuse there's no number. With the visible countdown, the number sits on the bomb, and the bomb shows urgency in the last seconds as now.
- An explosion plays the one big animation, then "Could have said: …" example words as now.

### 5.4 Everyone at once (projector)
- No arrow. The fuse visibly burns down over the round.
- Players get a ✓ as they answer. No one's typing is shown, to prevent copying **(Claude's call)**. Words appear after the round as now.
- Players sit on the circle (two rings above 20) rather than in a grid.

### 5.5 Student screens
- The same circle and bomb as the projector, smaller, with the student's own tile-style text box along the bottom (letters appear as tiles as they type).
- Their own hearts and score in a corner. Scores stay private: a student sees only their own.
- The existing messages (accepted, refused with reason, "not your turn", silent answer scored, ghost mode and comeback progress) keep their wording and move into the new layout.
- The text box is always focused, as now.

```
     🐸 Ola ❤❤          🦉 Jonas ❤
          ↘    [💣 I N G]
  🦊 Ingrid ❤❤❤ ← arrow
     "sing|"            🍕 Emil ✗
 ┌──────────────────────────────┐
 │ [s][i][n][g]▌                │  ← student's own box
 └──────────────────────────────┘
```

### 5.6 Large classes
Above 20 players on the circle, emoji and names shrink and sit in two rings (alternating inner and outer). This applies on every screen that shows the circle.

### 5.7 Results (projector and student screens)
- The winner's emoji in the middle where the bomb was, with their name on tiles. Shared winners sit side by side.
- The longest word of the game on tiles below, with who played it.
- "Best ghosts": a ranking **without points**, e.g. "1. 🐙 Aisha 2. 🦉 Jonas 3. 🍕 Emil" (Roy's decision). The projector view must not even receive ghost points.
- Student screens show the same ranking without points **(Claude's call, for consistency)**. A student still sees their own score.

```
           🏆  🦊
        [I][N][G][R][I][D]
   Longest word: [E][X][T][R][A][O][R][D]…  (Ola)
   Best ghosts: 1. 🐙 Aisha  2. 🦉 Jonas  3. 🍕 Emil
```

### 5.8 Control panel and ⚙ overlay
- Both follow the chosen theme's colours but keep their current layout **(Claude's call)**.
- The theme picker is a normal setting, "Theme", with Workshop, Enamel and Night fuse.
- The theme can be changed at any time, including during a game, because it changes no rules **(Claude's call)**. All other settings stay locked during a game, as now.
- The full control window keeps its private score and ghost-point columns. The ⚙ overlay still never shows them.

## 6. Themes, fonts and the bomb

### 6.1 Themes
- Each theme is one named list of colours, kept in one file. No colour is typed anywhere else in the client code or stylesheet; everything refers to the named colours.
- The colour names follow `design-principles.md`: stage, tile, tile edge, tile ink, bomb, bomb shade, spark (matched letters, arrow), names on stage, muted, lives, plus the few the screens need that the table doesn't name (at least: answered ✓, refusal/error, and a raised panel colour). The builder fills any gap in Enamel and Night fuse with a colour that fits that theme.
- **Readability check:** a test computes the contrast of every text-on-background pair in every theme and fails below 4.5:1 for normal text or 3:1 for large text. This is what keeps future themes safe too.
- A test checks that no colour value is written outside the theme file.

### 6.2 Fonts
- **Lexend** (regular and semibold) for reading: player words, the text box, messages.
- **Rubik** (a heavy weight) for display: letter tiles, names, headings, the room code.
- Stored in the project and loaded from it. While a font loads, text shows in a system font, never invisible.

### 6.3 The bomb
- One self-contained file holds the bomb drawing, the flame animation, the arrow and the explosion. Replacing that file is all a new bomb design takes.
- The rest of the client gives it only: whether the fuse is lit, the arrow's angle (or no arrow), the countdown number if visible, whether it's urgent, and "explode now".
- The arrow must keep its element between screen updates so it can swing smoothly from the old angle to the new one, rather than jump.
- **Reduced motion:** the flame is still, the arrow jumps to its new angle, and the explosion becomes a brief static flash.

## 7. Server additions (none change the rules)

All four are built test-first, with validation of every message.

1. **Avatars.** Each player gets an avatar number (0–59), assigned at random from the free ones on join. A new client message lets a player change it: a whole number from 0 to 59, accepted only in the lobby (or while a spectator waits), and refused if taken. Avatars appear in every view that lists players. A kick frees the avatar; a reconnect keeps it.
2. **Theme in every view.** The theme setting is sent in the projector and player views (not only the control view), so every screen follows it. It's exempt from the "locked during a game" rule.
3. **Live typing.**
   - The setting defaults to on, and its help text changes to "Show the current player's typing on all screens."
   - Masking is deliberately simple (Roy: seeing a rude word is not critical): if the whole typed text, in lower case, is a word on the blocked-answers list, it's sent as ★★★★ instead. Half-typed words aren't masked.
   - Typing is still only shown for the current player in Classic, never in Everyone at once.
4. **Ghost ranking without points.** The results in the projector and player views carry the ghost ranking as names and avatars in order, without points. The control view keeps the points.

**Nicknames:** blocking stays exactly as now (the English and Norwegian lists, plus Roy's `blocked-extra.txt`). Nothing is loosened.

## 8. Testing

- **Unit tests** for each server addition: avatar assignment, uniqueness, changing (lobby only), kick freeing, reconnect keeping, message validation; theme in views and changeable mid-game; typing masked and default on; no ghost points in projector or player views.
- **Renderer tests:** emoji and names on the circle, two rings above 20, arrow angle for the current player, matched letters as tiles, results ranking, and escaping of every piece of player text in the new markup.
- **Theme tests:** contrast check and "no colour outside the theme file" (section 6.1).
- **End-to-end tests** updated for the new join flow (pick an emoji) and new screens.
- **Load test:** 32 bots still run smoothly, with avatars.
- **Screenshots:** `docs/screenshots/` refreshed so Roy can review each screen in each theme.
- **Roy's check:** each step is tried at home on a Netlify deploy preview (section 9).

## 9. How it reaches the classroom

Built on a branch in steps. Each step gets a Netlify deploy preview Roy can try at home before anything goes live:

1. Themes and fonts (with the theme picker).
2. The bomb (flame, arrow, explosion).
3. Emoji avatars and joining (Roy approves the 60-emoji sheet first).
4. The new circle on all screens, the lobby and the results.
5. Live typing and two rings.

Nothing is merged to the live site until Roy says so, and never on a lesson day.

## 10. Documentation updates

- **`CLAUDE.md`:** the privacy rule becomes "the projector and ⚙ overlay never show scores, ghost points, tokens or the passcode; ghosts on the results screen are ranked without points". Also update "What's next".
- **`design-principles.md`:** move the joining, lobby and results proposals from "Proposed" to agreed, and add Enamel and Night fuse as shipped themes.
- **`docs/EXTENDING.md`:** add how to make a new theme and how to swap the bomb.

## 11. Left to the builder

- Which emoji set, and the exact 60 (Roy sees the sheet before it's wired in).
- Exact sizes, spacing and animation timings, within the readability rules and "boldness only in the bomb".
- The extra colour names and any missing values in Enamel and Night fuse, passing the contrast test.
- How the circle is laid out on the smaller student screen.
- How the page keeps the bomb and arrow elements between updates so animations run smoothly.
- How the step order is split into plan tasks.
