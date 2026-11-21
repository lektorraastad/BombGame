# Bomb Game: design

A classroom word game for Roy's 8th grade ESL students (lower secondary school, Norway), modelled on BombParty from jklm.fun.

Status: draft for Roy's approval, 2026-11-21. Nothing is built until Roy approves.

Items marked **(Claude's call)** are proposals Roy hasn't confirmed, and they work as defaults that can be changed later. Everything else is something Roy said or agreed to.

---

## 1. Why

- jklm.fun is blocked on the school network.
- BombParty's prompts vary too much in difficulty. Some have only one or two possible words, which is unfair and teaches nothing.
- Roy wants modes that suit a classroom of 15 or 30, and he wants control of the room: rules, timer, kicking.
- Students who are knocked out shouldn't sit idle.

Success means Roy can open the game in a lesson, put a code on the projector, have every student playing within a minute or two, and keep the whole class typing English words for the full activity.

## 2. Goals, non-goals, anti-goals

**Goals (version 1)**
- Roy hosts a room. Students join with a short room code and a nickname, with no accounts and no login.
- Two modes: **Classic** and **Everyone at once**.
- A host panel for rules, timer and lives; pause, skip and end; kick and rename players.
- Prompts are always fair: each one has at least a minimum number of common answers, and the host chooses a difficulty band.
- Ghost mode for knocked-out players, with an optional comeback.
- A host switch for silent answering while waiting in Classic.
- A structure that makes new modes, knocked-out activities, prompt types, word lists and settings easy to add (section 6).

**Non-goals (version 1; the structure must allow them later)**
- Teams mode and Class vs the bomb mode. Roy wants both later, so they are the test cases for the plug-in structure.
- Uploading custom word lists through the interface. Lists are files in the repository for now.
- Feide login, saving results between sessions, and class statistics.
- Phones and tablets. Students use laptops; phones should work but aren't optimised.
- Public rooms and room lists.
- Chat between students.

**Anti-goals (these would make it a failure even if it technically works)**
- Students sitting idle for long stretches.
- Prompts that only a few students could ever answer.
- Rude text from one student appearing on the projector or on other students' screens.
- Storing any personal data about students.
- Needing IT to install anything, or needing student accounts.

## 3. Constraints

- **Devices:** students use laptops with a keyboard and a normal browser. Roy uses a laptop connected to the projector.
- **Class size:** usually about 15 (split-class lessons), sometimes the full class of 30. Rooms must work smoothly with up to 32 players.
- **Network:** the school filter must not block the site, and live connections (WebSockets) must work through it. This is unverified, so the first thing built is a connection test page (section 9).
- **Hosting:** code on GitHub, deployed automatically to Netlify. Cloudflare is the fallback if Netlify changes its terms (section 8).
- **Privacy (Claude's call; a Norwegian school context):** nicknames only. Rooms live in server memory and are deleted when the game ends or after 30 minutes idle. No database, no analytics, no cookies beyond what reconnecting needs, and no nicknames in server logs.
- **Language:** the interface is in English for immersion **(Claude's call)**.

## 4. How it works

### 4.1 Roles and joining
- **Host (Roy):** opens the site, clicks "Create room" and types the **host passcode**. The passcode is required (Roy's decision). It's stored as a Netlify environment variable that Roy can change, and students never need it. Roy then gets a room code and two views:
  - **Projector view:** safe to show the class. It has no kick, rename or settings controls and no private scores.
  - **Control panel:** settings, kick, rename, lock, pause and skip. Roy sometimes mirrors his screen and sometimes extends it (Roy's answer), so the panel must work in all three of these ways: in a second browser window (extended screen), on another device such as Roy's phone (by opening the site and typing the room code plus the host passcode, so no secret link ever appears on screen), and as a small overlay on the projector view that Roy opens only when needed and that hides itself again (mirrored screen, no second device). On a mirrored screen the overlay is visible to the class, so it never shows the passcode or anything private.
  - **Connections:** the host can therefore have more than one connection at a time. All of them share the same host token.
- **Player (student):** opens the site and types the room code and a nickname.
- **Room code (Claude's call):** 4 letters, avoiding letters that are easy to confuse (I/L/O). It's shown large on the projector together with the site address.
- **Nicknames (Claude's call):** 2–16 characters. A duplicate gets a number added. Nicknames containing a word from the block list are refused. The block list covers **both English and Norwegian** offensive words, since students will try Norwegian first. The host can rename anyone.
- **Kick:** removes the player at once. The same browser can't rejoin that room **(Claude's call: a per-room token kept in the browser)**. A determined student could get around this with a private window, so the host can also **lock the room** so nobody new can join.
- **Reconnecting:** if a laptop drops off the network or a student refreshes, they get back the same player with the same lives and score, using the same browser token. The host can reconnect the same way. Server timers keep running while the host is away **(Claude's call)**.
- **Joining late:** a player who joins after the game has started waits as a spectator and plays from the next game **(Claude's call)**.

### 4.2 Word checking
- **Accepted answers:** any real English word that contains the prompt (or starts or ends with it, depending on the prompt type). British and American spellings are both accepted. Validity is checked against a large, openly licensed English dictionary list.
- **Blocked words:** a list of offensive words is never accepted and never shown, even if they're real words **(Claude's call)**.
- **No reuse:** in Classic, a word can be used once per game across the whole room, as in the original. In Everyone at once, each player can't reuse their own words, but two players may use the same word, since they can't see each other's answers **(Claude's call)**.
- **Case and accents:** letter case doesn't matter. Answers are only the letters a–z, plus apostrophes and hyphens.

### 4.3 Fair prompts
- **How prompts are made:** a build-time script produces them from a **"known words" list**, meaning words a 13–14-year-old ESL learner is likely to know (for example the most frequent few thousand English words with their common forms).
- **What a prompt is:** a 2–3 letter chunk, tagged with how many known words fit it.
- **Minimum answers:** a chunk only becomes a prompt if at least **20** known words fit it **(Claude's call on the number; it's a setting in the generator script)**.
- **Difficulty bands (Claude's call on the thresholds):** Easy has 200 or more fitting words, Medium 60–199 and Hard 20–59. The host picks a band, or Mixed.
- **Prompt types:** contains, starts with and ends with. The host chooses which types are in play. Each type has its own pre-generated prompt list with counts.
- **Example answers:** after a bomb explodes, the projector briefly shows 2–3 example words for that prompt **(Claude's call; a host switch, on by default)**. This is where much of the learning happens.

### 4.4 Mode: Classic (about 2–16 players)
- **Turns:** players sit in a circle. The current player gets a prompt and must type a valid word before the bomb explodes. A valid word passes the bomb to the next player with a new prompt. An explosion costs that player a life and gives the next player a new prompt.
- **Timer, original style:** the fuse is hidden and random. Each round it starts at a random value between a host-set minimum and maximum (default 10–30 s). If a valid word comes in with less than the minimum turn time left (default 5 s), the fuse is topped up to that minimum. After an explosion, a new random fuse starts.
- **Timer, classroom style (Claude's call, offered as an alternative):** the host can switch to a visible fixed countdown per turn (default 12 s), which is gentler for weaker students.
- **Lives:** starting lives and maximum lives are host settings (defaults 2 and 3).
- **Bonus alphabet:** a host switch, on by default. Using every letter of the bonus alphabet across your own valid words gives an extra life, up to the maximum. By default the bonus alphabet leaves out Q, X and Z **(Claude's call)**, and the host can change this.
- **Winning:** the last player alive wins.
- **Live typing (Claude's call):** by default the projector shows only the current player's *submitted* words, so half-typed rude text never appears. A host switch, off by default, shows live typing as the original does.
- **Silent answering:** a host switch, on by default. Players who are waiting can type words for the current prompt on their own screen and earn points. Silent answers are private. They don't use up words for the room, don't count toward the bonus alphabet, and don't affect the turn.

### 4.5 Mode: Everyone at once (about 2–32 players)
- **Rounds:** each round shows one prompt to every player still alive, and everyone has until the bomb explodes to submit a valid word.
- **Timer:** the round length is a host setting (default 15 s, visible). **(Claude's call:** a host switch can make each round about 1 s shorter, down to a floor of 6 s, to build pressure).
- **Lives:** anyone without a valid word when the bomb explodes loses a life. Lives work as in Classic.
- **Bonus alphabet:** works as in Classic.
- **Projector:** the prompt, the bomb, and a grid of player names that each tick green when that player has answered. The words themselves aren't shown during the round **(Claude's call)**, to prevent copying. Afterwards a few answers are shown, as in 4.3.
- **Winning:** the last player alive wins. If everyone left loses their last life in the same round, they share the win **(Claude's call)**.

### 4.6 Knocked-out players: ghost mode (the first knocked-out activity)
- **Playing on:** a knocked-out player becomes a ghost. They see every prompt the survivors get and can type words for it on their own screen.
- **Ghost points:** each valid ghost word earns points on a separate ghost leaderboard. Ghost words are private, don't use up words for the room, and can't affect survivors.
- **Comeback:** a host switch, on by default. Three valid ghost words in a row bring a ghost back with one life, at most once per player per game. Comebacks are disabled once only two players are alive.
- **Fit with each mode:** in Classic, "in a row" means on consecutive prompts. In Everyone at once, it means in consecutive rounds.

### 4.7 Host controls
- **Before the game:** mode, prompt types, difficulty band, timer style and values, lives, bonus alphabet, silent answering, ghost comeback, example answers and live typing. Every setting has a sensible default, so Roy can just press Start.
- **During the game:** pause and resume, skip the prompt, kick, rename, lock or unlock the room, and end the game. Rules are locked once a game starts **(Claude's call)**. They can be changed between games.
- **After the game:** a results screen with the winner, the ghost leaderboard, and fun facts such as the longest word. Then "Play again", which keeps the same room and players.

### 4.8 Screens
- **Host or projector:** large text readable from the back of the room. In the lobby, the room code and site address are shown large.
- **Player:** a big prompt, the bomb, a text box that's always focused, their own lives and score, and whose turn it is. In Classic, the player circle is visible.
- **Sound (Claude's call):** bomb ticking and explosion sounds play on the projector. Students' laptops are muted by default.

## 5. Approaches considered (hosting and architecture)

| Option | Trade-off | Decision |
|---|---|---|
| **A. GitHub → Netlify, with the page and game server in one project (Netlify Server)** | Familiar to Roy, with one place to deploy. Netlify Server is in Early Access, so it's free now but prices aren't set, and an idle server stops after 5 minutes. | **Chosen** by Roy. |
| B. GitHub → Cloudflare Workers + Durable Objects | A finished product with a generous free plan and one isolated object per room. Means a new account and dashboard for Roy. | **Fallback** if Netlify changes its terms or is blocked. |
| C. GitHub → Render | The simplest server hosting. The free plan sleeps after 15 minutes idle and takes about a minute to wake up. | Second fallback. |
| D. Netlify for the page, with Roy's browser running the game | No server needed, but one accidental refresh ends the game for everyone, and it's easy to cheat. | Rejected. |
| E. Vercel | Live connections close when a function reaches its time limit, which adds work for long games. | Rejected. |

**The game logic runs on the server.** All rules, timers and word checks happen there, and browsers only display state and send typed words.

## 6. Code structure built for extension (Roy's request)

Roy wants it to be easy to add modes, knocked-out activities and other tweaks later. The structure has a **core engine** and **plug-ins**:

- **Core engine:** a pure TypeScript part with no network or hosting code. It owns rooms, players, connection status, the clock, lives, word checking and the game lifecycle (lobby → playing → results).
- **Clock:** the engine uses an injected clock, so tests can use a fake one.
- **Plug-in kinds.** Each kind has a small typed interface and lives in its own folder, and one registry lists them:
  1. **Game mode:** decides who is "on" (one player, all players, a team), how prompts are handed out, what happens on a valid word and on an explosion, and when the game ends.
  2. **Knocked-out activity:** what a player does after losing their last life. Ghost mode is the first.
  3. **Prompt type:** contains, starts with and ends with, each with its own pre-generated prompt list.
  4. **Word list:** the known-words list, the validation dictionary and the block list, as plain files.
  5. **Settings:** each mode and activity declares its settings (name, type, default, range, help text). The host panel builds itself from these declarations, so a new tweak is one declaration.
- **Transport adapter:** a thin layer that connects the engine to WebSockets on the host platform. It's the only part that changes when moving from Netlify to Cloudflare.
- **Shared message types:** the browser and server share message and state types from one file.

**What counts as success:** adding Teams mode later should need only a new mode plug-in and maybe a new projector view, with no changes to the engine. The builder should keep Teams and Class vs the bomb in mind while designing the mode interface, without building them.

**Limit on extension (Claude's call):** hooks are built for what versions 1 and 2 need, not for imagined features.

**Who extends it (Claude's call):** most future changes will likely be made by an AI assistant in later sessions, with Roy reviewing. Every plug-in folder therefore gets a short README with a worked example, and the repository root gets a guide on how to add a mode, an activity or a setting.

## 7. Testing

- **Engine tests:** unit tests with a fake clock for both modes, ghost mode with comebacks, lives and the bonus alphabet, reconnecting, kicking and locking.
- **Prompt generator test:** checks that every generated prompt meets the minimum answer count for its band.
- **Load test:** a script with 32 simulated players in one room, all answering at once, checking that the room stays responsive.
- **Manual test:** Roy plays a test game with a few browser tabs before the first real lesson.

## 8. Hosting and operations

- **Repository:** code in a GitHub repository owned by Roy.
- **Deploys:** Netlify deploys automatically on every push to the main branch.
- **No deploys during lessons:** a deploy restarts the server and drops open games. Roy should push changes outside lesson time.
- **Cold start:** the server stops after 5 minutes without traffic. Creating the room wakes it, and open connections keep it running.
- **Moving to Cloudflare:** a short written guide in the repository explains how to switch if needed.
- **When to fall back (Claude's call):** move to Cloudflare if Netlify changes its terms, is blocked by the school filter, or proves technically unsuitable. Unsuitable means it can't keep all players in a room on one server process, or it can't hold connections for a full lesson. The connection test page (section 9) should check both, including a connection held open for at least 45 minutes. The builder tells Roy before switching.

## 9. Build order

1. **Connection test page:** deployed to Netlify. Roy opens it on a school laptop on the school network, and it reports whether the page loads and whether a live connection works. **Nothing else is built until this passes**, or until a fallback host passes.
2. Core engine, Classic mode and tests.
3. Joining, the lobby, the host panel and the projector screen.
4. Everyone at once mode.
5. Ghost mode, comebacks and silent answering.
6. Word lists, the prompt generator and difficulty bands.
7. Load test, polish and a classroom trial.

## 10. Left to the builder

- **Front-end:** the framework and libraries (keep it light, and the student page must load fast on the school network).
- **Word lists:** the exact source lists, chosen with licences that allow use in a public project.
- **Look and feel:** visual design and sound, within the readability requirements in 4.8.
- **Default tuning:** exact defaults may be adjusted after the first classroom trial.
