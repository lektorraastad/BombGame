# Bomb game: everyone involved (batch 6)

Status: draft for Roy's approval, 2026-11-28 (builder review answered).

Batch 6 of the second round of improvements. It builds on batch 4 (`2026-11-27-look-and-moments-design.md`: moments, the hub's moment list, `motion.js`) and batch 5 (`2026-11-28-end-of-game-design.md`: `ranks.txt` with CEFR-J levels and NGSL headwords). Read those first.

Items marked **(Claude's call)** are proposals Roy hasn't confirmed. Everything else Roy said or chose. The spark mockup Roy approved is the private artifact "Wordfire Silent Sparks" (https://claude.ai/artifact/MeakqzPYzJQJSo3YsqhhY4).

## 1. Why
With 15–30 students in Classic, most of the class is waiting at any moment. They can already answer silently for private points, but nothing on the projector shows it, so the room can't see that everyone is busy. Separately, the example words after an explosion sometimes include odd word forms like "paragraphed", which are poor teaching examples for 13-year-old ESL learners.

**Success:**
- The class can see who is quietly playing along, without seeing any of their words.
- The example words after an explosion are always words a learner could use.

## 2. Goals, non-goals, anti-goals
**Goals**
- A small spark on a seat each time that student's silent answer is accepted, and a fainter grey spark for a ghost's accepted answer.
- Example words that are always everyday words.

**Non-goals**
- No change to how a game is played, scored or won.
- No change to which answers count, or to the private points.
- No sound for sparks.

**Anti-goals**
- Showing any silent or ghost word on a shared screen.
- A spark that grows or adds up like a score.
- Flickering, or anything that pulls attention away from the bomb and the current player.

## 3. Approaches
| | What it is | Trade-off |
|---|---|---|
| **A. Two more moments plus the batch 5 word levels (chosen)** | The hub adds `silent` and `ghost` moments (who answered, never what). The browsers draw a spark through `motion.js` like the other moments. The example picker uses the CEFR-J levels and NGSL headwords already in `ranks.txt`. | Reuses tested machinery and keeps game rules untouched. |
| B. Sparks worked out in the browser | Each laptop or projector guesses from score changes. | The projector never receives scores, so it can't work. |
| C. A new hand-made list of example words | Someone curates the everyday words. | Slow and goes stale. The data the game already has does the job. |

Roy agreed on 28 November 2026 that A is the way.

## 4. The design
### 4.1 The spark
- **When it fires:**
  - **Silent answer:** a waiting student's silent answer is accepted (Classic with silent answers on).
  - **Ghost answer:** a knocked-out student's ghost answer is accepted (any mode with ghost mode).
  - Refused answers never spark.
- **How it looks** (as in the mockup):
  - A ring and six small star points burst from the student's emoji, about 0.7 s.
  - A silent answer uses the theme's spark colour.
  - A ghost's answer uses the theme's muted colour, fainter.
  - It is the same size every time. It never grows or counts.
- **How often:** one spark per accepted answer, but a seat sparks at most once per second. Extra answers within that second are silently skipped by the screens.
- **Where:** on the projector and on every laptop, including the answering student's own. There's no sound.
- **Reduced motion:** the ring shows briefly without moving and the star points are left out **(Claude's call)**.
- **With two rings (more than 20 students):** it works the same, at the smaller seat size.
- **It never shows:** in the lobby, on the results screen, or in the first view after a page load or reconnect.

### 4.2 Everyday example words
After an explosion, the game shows up to three example words that fit the letters. They are picked in this order, at random within each group:
1. **Beginner words** (`beginner.txt`), as today. These include well-known names like *Norway*, *Norwegian* or *American*, which stay allowed because students know them and they are real answers **(Claude's call, after review)**.
2. **Other everyday words**, if fewer than three beginner words fit. A word counts as everyday when:
   - it is in `known.txt`;
   - it is not a name;
   - it is its own headword, not a form of another word (in `ranks.txt`, its headword column is empty);
   - and its CEFR-J level is B1 or below, or, with no level, its NGSL rank is 2000 or less **(Claude's call)**.
3. If even those run out, the game **shows fewer**: two, one or none. With today's word lists that's about 25 of the 1,686 sets of letters with none, and about 40 with one or two. It never fills in with word forms, rare words or names.

This replaces today's fallback to any known word. Blocked words stay out, as today.

### 4.3 What the server adds
- **The hub's moment list** gains `{ kind: "silent"; pid }` and `{ kind: "ghost"; pid }`.
  - The hub adds one when `room.submit` returns `{ ok: true, kind: "silent" }` or `kind: "ghost"`, and queues a broadcast.
  - The moment never carries the word.
  - Batch 4's sounds ignore these two kinds.
- **The word checker** gets the set of everyday words from `loadWordData`, which builds it from `ranks.txt` and `names.txt`. It uses that set in `examples()`.
  - An older generated folder without levels still loads.
  - In that case the examples are beginner words only.

## 5. Checks
- **Hub tests:**
  - an accepted silent answer adds a `silent` moment for that student, and an accepted ghost answer adds a `ghost` moment;
  - refused answers add none;
  - no view's JSON contains the silent or ghost word.
- **Word tests:**
  - examples come from beginner words first;
  - then from everyday words: never forms, rare words or names;
  - fewer than three when none are left;
  - "paragraphed" is never an example.
  - A check over every real prompt in `prompts.json`: every example is either a beginner word or an everyday word as defined in 4.2. A "word form" means a word whose headword column in `ranks.txt` is not empty, so adjectives like *embarrassed* or *amazing* that are their own headwords stay allowed **(Claude's call, after review)**.
- **Motion and renderer tests:**
  - the spark is timed from arrival, and at most one per second per seat;
  - the ghost spark has its own look;
  - nothing replays after a refresh;
  - reduced motion gives the still ring;
  - spark markup has no player text.
- **End-to-end check:** with 15 students, a silent answer makes that seat spark on the projector and on another laptop, and the word appears nowhere.
- **Screenshots** refreshed. Roy tries it on a deploy preview or chooses to go live, never on a lesson day.

## 6. Left to the builder
- The exact keyframes, within the mockup's look.
- How the everyday set is passed to the checker.
