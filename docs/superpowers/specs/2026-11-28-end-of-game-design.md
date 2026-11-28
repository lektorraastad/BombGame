# Bomb game: the end of the game (batch 5)

Status: approved by Roy, 2026-11-28.

Batch 5 of the second round of improvements. It builds on batch 4 (`2026-11-27-look-and-moments-design.md`, whose section 8 recorded the first decisions) and `docs/design-principles.md`. Read those first.

Items marked **(Claude's call)** are proposals Roy hasn't confirmed. Everything else Roy said or chose. The mockups Roy approved are the private artifact "Wordfire End-of-Game Mockups" (https://claude.ai/artifact/DiZ1ZUQKjmcsZKxXkiCFxy).

## 1. Why
Roy wants the game mostly for fun, with a bit of learning. Today a game ends on a plain screen with the winner, the longest word and the best ghosts. Nothing celebrates the rest of the class, and nothing turns the words the class played into something Roy can use later.

**Success:**
- The end of a game feels like a celebration that names several students, never ranks anyone low, and shows the class how many English words they produced together.
- Roy can copy those words with one click for a later lesson.
- Each student sees a short private summary of their own game.

## 2. Goals, non-goals, anti-goals
**Goals**
- A new results screen in two steps: **the winner and the awards** first, then **"Words we played"**, the word wall.
- Up to five positive awards.
- A **Show words** button and a **Copy words** button in the control panel.
- A private **"Your game"** card on each laptop.

**Non-goals**
- No change to how a game is played, scored or won.
- No saving anything between games or lessons. Everything lives in memory and is gone when the room closes.
- No sparks for silent answers and no changes to example words (batch 6).

**Anti-goals**
- Anything that ranks students or shows anyone in last place.
- Any number on the projector that works as a score.
- Silent or ghost words appearing on a shared screen.
- Names attached to the word wall.

## 3. Approaches
| | What it is | Trade-off |
|---|---|---|
| **A. The server works out the awards, the word list and each card; the server holds the step from awards to words (chosen)** | The results view carries the awards (names, emoji and words only) and the wall's words. Each player's view carries only their own card. A server-side step (awards, then words) moves after 10 s or on **Show words**. | "Most words" can count silent answers, which only the server knows. Every screen agrees, and a refreshed projector keeps its place. |
| B. Browsers work out the awards | Each screen builds its own awards from the views. | Silent answers couldn't count, because they never leave the server. |
| C. Only the projector holds the step | The 10 s timer and the button live on the projector page. | The control window and Roy's phone couldn't move it on. |

Roy agreed there is one sensible way (A), on 28 November 2026.

## 4. The design
### 4.1 What the class sees
**Step 1: the winner and the awards (about 10 s).**
- **Winner:** the winner in the middle (their emoji, and their name on tiles), with the existing batch 4 win moment (tile burst and tune).
  - **A shared win:** all the winners are shown together.
  - **No winner:** "No winner this time", as today.
- **Award cards:** up to four, in this order:
  1. **Longest word:** the word on tiles, with the student's emoji and name.
  2. **Rarest word:** the word on tiles, with the student's emoji and name.
  3. **Most words:** the student's emoji and name. **No number.** It counts words played on a turn plus silent answers. Ghost words don't count, because ghosts have their own card **(Claude's call, after review)**.
  4. **Comeback or Best ghost:** "Comeback" when a knocked-out student came back into the game. Otherwise "Best ghost", when anyone scored as a ghost. Otherwise no fourth card.
- **Rules for the cards:**
  - A card with nothing to show is left out. For example, with no words played there's no Longest word card.
  - **When the longest word is also the rarest word** (Roy's choice): one combined card, "Longest and rarest word". The freed place shows "Best ghost" when there was both a comeback and a best ghost. On the wall, that word gets one label, "Longest and rarest".
  - **Awards go to whoever earned them,** even if the same student wins several (Roy's choice). They are never handed to someone else to spread them out.
- **Ties:**
  - **Longest word:** the first one played wins, as today.
  - **Rarest word:** the rarer word wins, then the longer, then the first played.
  - **Most words and Comeback** (Roy's choice): every tied student is named, in join order, in smaller text when there are many, up to 8 names. With more than 8 the card says, for example, "12 students tied", with no names.
  - **Best ghost:** the top ghost, using today's ghost ranking (ties in join order).
- **"Game over"** stays as a small heading. The logo stays at the top left, as in the mockup.
- **No numbers, scores or points** appear anywhere on this screen.

**Step 2: "Words we played" (until the next game starts).**
- **The words:** every word the class **already saw** during the game: words played on a turn, and Everyone-at-once answers. Silent words and ghost words are never included.
- **Layout:**
  - Each word appears once, in alphabetical order, on tiles, with **no names**.
  - The heading reads "Words we played", plus the class total, for example "98 words". That's the whole class's total, not anyone's score. It's the number of different words on the wall, not every answer counted separately **(Claude's call, after review)**.
- **The award words** (longest and rarest) glow in the matched-letter colour, a little bigger, with a small "Longest" or "Rarest" label under them.
- **Size:** the wall shrinks its words to fit one screen (Roy's choice). If a very long game would need tiles smaller than about 18 px tall at 1920×1080, the wall shows the award words plus as many others as fit, in alphabetical order, then "+ 40 more: Copy words in the control panel" **(Claude's call)**.
- **Kicked students:** their words stay on the wall, since the wall has no names. Kicked students never receive an award, as today.

**The step from awards to words:**
- It happens 10 s after the results screen appears. That's after batch 4's 1.5 s hold, so the class first sees the last bomb go off.
- It happens sooner when Roy clicks **Show words**.
- It's held on the server, so the projector, the overlay and Roy's phone all agree, and a refreshed projector shows the right step.
- **Play again** works as today and starts the next game from the lobby.

### 4.2 The control panel
On the results screen, the control panel (window, overlay and phone) gets two buttons:
- **Show words:** moves the projector to the word wall now. It is disabled once the wall shows.
- **Copy words:** copies the wall's words to the clipboard, one per line, alphabetical, each word once, with no names.
  - It copies all of them, including any the wall had no room for.
  - The button briefly says "Copied". If the browser refuses to copy, the words appear in a small box Roy can select and copy by hand.
  - Nothing is stored on the server or in the browser.
  - The words are already public on the projector, so the overlay may show the fallback box.

### 4.3 The "Your game" card (each laptop, private)
Only that student's laptop gets their card, from the start of the results screen. It stays through both steps. It shows:
- **Words:** for example "You played 14 words: 9 on your turns, 5 silently". If the student was a ghost, it adds "and 4 as a ghost". With no words: "No words this time. Next game!" **(Claude's call)**.
- **Your longest:** the longest of all their own words, including silent and ghost words, since the card is private.
- **Your rarest:** the rarest of all their own words, by the rule in 4.4.
- **Award:** any award they won, for example "Most words 🎉". This line is left out otherwise, so there's never a "no award" message.

Next to the card, the laptop shows the winner's emoji and name, as in the mockup. With a shared win it shows "Shared win". With no winner it shows "No winner this time".

### 4.4 What "rarest" means
"Rarest" is worked out from the word lists the game already builds, at build time, into a small generated ranking file **(Claude's call on the format)**:
- **Names never count.** A word counts as a name when it is on a name list (places, nationalities, languages, holidays, brands, Roy's `names-extra.txt`) and **not** also an ordinary word in the NGSL or CEFR-J lists **(Claude's call, after review)**. So "turkey" and "polish" are ordinary words, and "barbados" or "tiktok" are names. ("english" and "china" are names too: neither is in the NGSL or CEFR-J lists.) Names are skipped. If a student only played names, there is no Rarest word for them.
- **Word forms count as their base word (Claude's call, after the final review).** A word that is in the CEFR-J list keeps its own place, so "herd", "shed" and "ward" are never read as "her", "she" and "war". A form in an NGSL word family counts as the family's headword: "hoping" is "hope", "agendas" is "agenda", "biggest" is "big". Any other word counts as its most common base word in the lists, found by stripping -s, -es, -ed, -ing (with the usual spelling changes, such as a doubled consonant or a dropped e). A bare -d is only taken off a word that ends in -ed ("hoped" is "hope"). This stops "apples" counting as rarer than "magnificent".
- **From most common to rarest:**
  1. beginner words (`beginner.txt`);
  2. other known words (`known.txt`);
  3. words only in the big dictionary, which are the rarest.
- **Within the beginner and known groups (Claude's call, after the final review),** words are compared in this order:
  1. **Level:** the word's CEFR-J level, from A1 (most common) to B2 (rarest). A word with no CEFR-J level gets one from its NGSL frequency rank: up to 600 is A1, up to 1150 is A2, up to 1700 is B1, and anything rarer is B2. A word with neither (such as "fourth", or a word in Roy's `known-extra.txt`) counts as A2.
  2. **Length:** the longer word is rarer.
  3. **Frequency:** the less frequent word (higher NGSL rank) is rarer. A word with no NGSL rank counts as rank 3000, just past the end of the NGSL.

  So "hypotheses" (B2, 10 letters) is rarer than "threaten" (B2, 8), then "bracket" (B2, 7), "troop" (B2, 5), "accompany" (B1, 9) and "agendas" (B1, 6), and an easy word with no rank, like "helper" or "teamwork", no longer beats them all.
- **Ties:** the longer word, then the one played first.

### 4.5 What the server adds
- **The results view** (projector and laptops) gains:
  - `awards`: a list of `{ kind, players: [{ id, nickname, avatar }], word? }`, with kind being longest, rarest, mostWords, comeback or bestGhost. Never a count.
  - `words`: the wall's words, alphabetical and unique.
  - `step`: "awards" or "words".
  
  The existing `winners`, `longestWord` and `ghostRanking` stay until the renderers stop needing them.
- **Each player's view** gains `me.summary`: `{ turnWords, silentWords, ghostWords, longest, rarest, award? }`, built from that player's own words only.
  - Turn words come from `room.acceptedWords`.
  - Silent words come from the silent-word sets the room already keeps.
  - Ghost words come from ghost mode's own per-player word sets. They are read through a read-only accessor; the activity still owns them.
- **The control view** gains the full word list for **Copy words** (the same as `words`).
- **A host command `show-words`** sets the step to "words". A room timer does the same 10 s after the results start. Both are ignored outside the results phase. The timer is cleared when a new game or the lobby starts.
- **Privacy:**
  - The projector and the overlay still never show scores, ghost points, tokens or the passcode.
  - No silent or ghost word ever reaches any view except the owner's own `me.summary`.
  - Words and summaries live in memory only and are dropped with the game, as today.
- **Unchanged:** play, turns, lives, word checking and winning stay exactly as they are. Only what the views report at the end of a game, and the step, are added.

### 4.6 Looks
- It uses the batch 4 look: smooth name plates for names, chunky tiles for words, the soft light and the logo. Award cards are quiet panels, so the winner stays the boldest thing on the screen.
- It works in all three themes. Every colour comes from theme tokens, and the contrast tests cover any new colour pair.
- Reduced motion: the win moment already respects it. The step to the wall is a simple swap, or a short fade that reduced motion turns off.

## 5. Checks
- **Engine and server unit tests:**
  - each award's rule, including ties, up to 8 names and the "N students tied" wording above that, the combined Longest and rarest card, a card left out when empty, and a shared win;
  - "Most words" counts silent answers, and no count appears in any projector view;
  - the wall has no silent or ghost words, is alphabetical and unique, and keeps a kicked player's words;
  - the summary counts turn, silent and ghost words, and only its owner receives it;
  - rarest-word ranking: names skipped, the three groups, NGSL rank within a group, and the tie rules;
  - the step moves after 10 s and on `show-words`, is ignored outside results, and is cleared by Play again;
  - the control view carries the full list.
- **Word-list build test:** the generated ranking file exists, skips names and ranks the sample words as expected.
- **Renderer tests:**
  - both steps on the projector, the "Your game" card and the control buttons;
  - all text escaped;
  - the "+ N more" line when the wall overflows.
- **End-to-end checks:**
  - **With 15 and 30 students:** the awards don't overlap and the wall fits the screen at 1920×1080.
  - **Show words** moves the projector, the overlay and a second control window together.
  - **Copy words** puts the expected text on the clipboard.
  - A refreshed projector keeps its step.
  - Each laptop's card shows that student's own numbers.
- **Screenshots** refreshed (`npm run screenshots`), including both steps and the laptop card. Roy approves the result on a deploy preview or chooses to go live directly, never on a lesson day.

## 6. Left to the builder
- Exact sizes, spacing and the fade, within the mockup's look and the overlap checks.
- The generated ranking file's format, and how the server loads it.
- The exact field names, within the shapes in section 4.5.
