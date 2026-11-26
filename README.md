# Bomb game

A classroom word game for ESL students, inspired by BombParty. You show the game on the projector, and students play on their own laptops. Each turn there is a group of letters, such as **ING**, and players have to type a real English word that contains those letters before the bomb goes off.

The site has four pages:

- **`/`**, the start page, where students type the room code and a nickname.
- **`/host`**, the projector screen, for you.
- **`/control`**, the control panel, for a second window on your laptop or for your phone.
- **`/check/`**, the connection test for the school network.

Steps 1–4 are done once. After that, go straight to [Running a lesson](#running-a-lesson).

## Step 1: Put the files on GitHub

1. Sign in at [github.com](https://github.com) and click **New** (the green button) to create a repository.
2. Name it `bomb-game`. Leave everything else as it is and click **Create repository**.
3. On the new page, click the link **uploading an existing file**.
4. Unzip the folder you got from Claude. Open it so you can see the files and folders inside (`public`, `netlify`, `src`, `data`, `scripts`, `tests`, `docs`, `package.json` and so on).
5. GitHub takes at most 100 files per upload, and the game has about 115, so upload in two batches:
   - **First batch:** select only the `docs` and `tests` folders, drag them into the GitHub page, and click **Commit changes**.
   - **Second batch:** click **Add file → Upload files**, select everything else (`public`, `netlify`, `src`, `data`, `scripts`, `package.json`, `netlify.toml`, `tsconfig.json` and `README.md`), drag them in, and click **Commit changes**.
   - Drag the *contents* of the folder, not the folder itself.
   - Check that the folders came along. After the second batch you should see `public/`, `netlify/`, `src/`, `data/`, `docs/` and `tests/` in the list.
   - If you'd rather not split it up, the free [GitHub Desktop](https://desktop.github.com) app has no file limit.

### Updating your existing repository

If you already put an earlier version on GitHub, you don't need a new repository:

1. Open your `bomb-game` repository and upload the new files the same way, in the same two batches. Files with the same name are replaced.
2. The connection test has moved to `public/check/`, so clean up the old copy. Open the `public` folder on GitHub:
   - If `check-page.js` or `check-client.js` are there *directly* in `public/` (not inside `check/`), delete them: open the file, click the **…** menu (or the bin icon), choose **Delete file**, and click **Commit changes**.
   - The old `public/index.html` was the connection test. The new `public/index.html` is the students' start page and replaces it when you upload. After the deploy, open your site address: you should see boxes for the room code and a nickname. If you still see the connection test, delete `public/index.html` on GitHub the same way, then upload the new `public/index.html` from Claude's folder again.
3. Netlify deploys the new version by itself. Wait for **Published** before the lesson.

## Step 2: Connect Netlify

1. Sign in at [app.netlify.com](https://app.netlify.com).
2. Click **Add new project**, then **Import an existing project**, then **GitHub**, and pick `bomb-game`.
3. Don't change any settings, because the file `netlify.toml` already contains them. Click **Deploy**.
4. Wait until the deploy says **Published** (about 1–2 minutes). The site address looks like `https://something.netlify.app`. You can change the name under **Project configuration → Change project name**.

**If the deploy fails:** open the failed deploy, scroll to the bottom of the log, copy the last 30 or so lines, and paste them into the chat with Claude.

## Step 3: Set the host passcode (`HOST_PASSCODE`)

The host passcode stops students from creating rooms or taking over the control panel. The game won't start a room until you set it.

1. In Netlify, open your project and go to **Project configuration → Environment variables**.
2. Click **Add a variable** (choose **Add a single variable** if it asks).
3. For **Key**, type `HOST_PASSCODE` exactly like that, in capital letters.
4. For **Value**, type your passcode.
5. Under **Scopes**, make sure **Functions** is included. "All scopes" is fine.
6. Save the variable (the button is called something like **Create variable**).
7. Redeploy, because the game only reads the passcode when it starts: go to **Deploys**, click **Trigger deploy**, and pick the plain deploy option (**Deploy project** or **Deploy site**). Wait for **Published**.

**Pick a long passcode, more than a single word.** Four or five ordinary words with spaces between them are easy for you to type and very hard to guess. Don't use a name, a class name or a single word. The game blocks anyone who guesses wrong too many times, but it only slows guessing down. A short passcode can still be guessed by a student with time and patience.

Keep the passcode to yourself. The passcode box shows dots, but avoid typing it while students can see your keyboard. To change it later, edit the variable in the same place and redeploy.

## Step 4: Check the deploy

Open your site address with `/api/health` at the end, for example `https://your-site.netlify.app/api/health`. You should see a short line of text that starts with `{"ok":true` and lists the word counts, something like this:

```
{"ok":true,"words":{"dictionary":143007,"known":8510,"blockedWords":499,"blockedNames":312},"rooms":0,"startedAt":…}
```

The exact numbers can change if you edit the word lists. If it says `"ok":false` instead, the word lists didn't load. See [Troubleshooting](#troubleshooting).

Then try the game once yourself: open `/host` in one tab and `/` in two other tabs, and join as two players. Each tab counts as a separate player.

## Running a lesson

1. **Open `/host`** on the laptop connected to the projector, for example `https://your-site.netlify.app/host`.
2. **Type the passcode** and click **Create room**.
3. **Put the code on the projector.** The screen shows the site address and a four-letter room code in big letters, and each name appears round the bomb, with its emoji, as a student joins.
4. **Students go to the site** (the address without `/host`), type the code and a nickname, and click **Join**. Each student gets an emoji and can tap another one while they wait for the game to start.
5. **Use ⚙ for the overlay, or open the control window on your laptop or phone.** The buttons are at the bottom right of the projector screen. They are faint until you move the mouse over them.
   - **⚙ Control (overlay)** opens the control panel on top of the projector screen. The class can see it, so it doesn't show scores or ghost points. Close it with **Close** or the Esc key.
   - **Open control window** opens the control panel in a separate window. Drag it to your own laptop screen if the projector shows a second screen and not a copy of yours.
   - **On your phone**, go to the site address with `/control` at the end, then type the room code and the passcode.

In the control panel you can:

- **Change the settings** before a game: the mode (**Classic**, where the bomb is passed around, or **Everyone at once**), the difficulty, the timer, the number of lives, and what knocked-out players do. Settings are locked while a game is running, except the **Theme** (the colours for every screen), which you can change at any time.
- **Difficulty** decides how hard the letters are:
  - **Easy:** only letters that lots of everyday words contain.
  - **Normal** (the default): mostly easy letters, with a slightly harder one about every fifth turn.
  - **Rising:** starts with the easiest letters and gets harder each time the bomb has gone round the class, until it reaches Normal.
  - **Hard:** any letters at all, including very hard ones like "sts".
- **Minimum turn time** (Classic, hidden fuse) is 8 seconds: after a correct word, the next player always has at least this long.
- **Live typing** is on by default: in Classic, everyone can watch the current player's letters appear on the projector and on the laptops (rude words show as stars). To switch it off, untick **Live typing** in the settings.
- **Start**, **Pause** and **Resume**, **Skip** a prompt nobody can answer, and **End** the game early.
- **Play again** after a game. The same players stay in the room.
- **Lock** the room so nobody new can join.
- **Rename** a player with an unsuitable nickname, or **Kick** a player (click **Kick**, then **Really kick?**). A kicked student can't join that room again from the same browser, even in a new tab. A determined student could still get back in from a private window as a new player, so if you kick someone, **Lock** the room straight after.

Sound plays only on the projector. The **Sound** button at the bottom of the projector screen switches between **Normal**, **Quiet** and **Off**. The projector browser remembers your choice for the next lesson.

Things that are fine during a lesson:

- **A student refreshes the page or loses the connection for a moment.** They come back as the same player automatically.
- **You refresh the projector.** The game carries on where it was.
- **The projector tab closes or crashes.** Open `/host` again. Under **Reconnect to a running room**, type the room code (it's also on the students' screens if you've forgotten it) and the passcode, and click **Reconnect**. The game carries on where it was.
- **A student joins after the game has started.** They watch and join the next game.

A room closes by itself after 30 minutes with no activity. Create a new one if that happens.

**Don't change or redeploy the site during a lesson.** A deploy restarts the server and ends every game. That includes editing a word list on GitHub, because Netlify then redeploys by itself. Make changes after school.

The game was tested with 32 computer players answering at the same time on one test computer, and the screens updated within 10 milliseconds. That test ran the game and the computer players on the same machine, with no real network in between, so it's a best case and not a measurement of Netlify or the school network. Your first lesson with the class is the real test: watch whether answers show up on the projector straight away.

## The connection test

The connection test page now lives at **`/check/`**, for example `https://your-site.netlify.app/check/`. It checks whether the school network lets the game through.

1. Use a **school laptop** on the **school network**, not a phone hotspot. A student account is even better, because students may have stricter filters than teachers.
2. Open the site address with `/check/` at the end. The four quick checks run by themselves in a few seconds.
3. If you want to be sure that a whole lesson works, click **Start lesson-length test** and leave the tab open for up to 50 minutes. Stopping after 35 minutes or more is fine.
4. Click **Copy results** and paste them into the chat with Claude if something is red.

## Troubleshooting

**Students can't connect, or their screen keeps saying "Can't reach the game. Retrying…"**
- Check that they typed the address without `/host` at the end, and the right code.
- Open `/check/` on a school laptop (a student account if you can). If a check is red, the school network or filter is blocking the game. Copy the results and paste them into the chat with Claude, or ask IT to allow your `netlify.app` address.
- If only one or two laptops have trouble, try refreshing the page on those laptops.

**The host page says "No host passcode is set."**
`HOST_PASSCODE` is missing, or the site hasn't been deployed again since you added it. Do [Step 3](#step-3-set-the-host-passcode-host_passcode) again, check the spelling of `HOST_PASSCODE` and that the scopes include **Functions**, and remember to **Trigger deploy** at the end.

**"Wrong passcode" or "Too many tries. Wait a minute."**
Check the passcode for typos and capital letters. After a few wrong tries the game makes you wait a minute before trying again.

**The deploy failed while building the word lists, or `/api/health` says `"ok":false`.**
A file in `data/raw/` was probably damaged, emptied or deleted. The deploy log might say "Word lists look broken" or "no such file". Undo your last change to `data/raw/` on GitHub, or paste the last 30 or so lines of the deploy log into the chat with Claude.

If `/api/health` says `"ok":false`, copy **the whole line** and paste it into the chat with Claude. If the line mentions `ENOENT` on your very first deploy, it usually means the server couldn't find the word files, and Claude can fix that.

**`/api/health` shows Netlify's own "Page not found" page.**
The game server isn't running at all. Open the latest deploy in Netlify and check its log for errors (paste the last 30 or so lines into the chat with Claude). Also check that Netlify Server is available on your Netlify account: it's a new Netlify feature, and the game needs it.

**The projector says "That room has closed."**
The room was closed after 30 minutes without activity, or the server restarted. Create a new room and give the class the new code.

## Word lists

The game's words come from the files in `data/raw/`. Every time Netlify deploys the site, it rebuilds the lists in `data/generated/` from them. Once the game itself is online, a change you make on GitHub takes effect with the next deploy.

**Don't change or redeploy the site during a lesson: a deploy restarts the server and ends every game.** Edit the word lists after school.

**Block a word yourself:**
1. On GitHub, open the `data/raw` folder.
2. If there's no `blocked-extra.txt` yet, click **Add file → Create new file** and name it `blocked-extra.txt`. Otherwise open it and click the pencil icon.
3. Write one word per line. Notes go on their own line, starting with `#`. Don't put a note after a word on the same line, or that line is ignored.
4. Click **Commit changes**. Netlify redeploys by itself after a minute or two.

Words in `blocked-extra.txt` can't be used as answers or in nicknames. Common forms are blocked automatically: the word plus -s, -es, -ed or -ing. Add unusual forms, such as a different spelling, on their own line. The Norwegian list (`blocked-no.txt`) only blocks **nicknames**, because some of its words, like "fan", are ordinary English words students should be able to answer with.

**Adding words and names**

Students can already answer with countries, nationalities and languages (Norway, Norwegian), well-known cities (Oslo, Bergen), holidays (Christmas, Eid) and brands and apps (TikTok, Lego). If a word or name your class uses is refused, you can add it yourself. There are two files for this, and you only need to create them if you want them:

- **`known-extra.txt`** is for everyday English words your students know. They're accepted as answers. They also make the game easier, because the game picks easier letters when many known words contain them, and they can be shown as example answers after an explosion.
- **`names-extra.txt`** is for names you want accepted as answers, such as a local place, a band or a football club. They're only accepted as answers. They don't change which letters come up and are never shown as example answers.

To add words or names:
1. On GitHub, open the `data/raw` folder.
2. If the file isn't there yet, click **Add file → Create new file** and name it `known-extra.txt` or `names-extra.txt`. Otherwise open it and click the pencil icon.
3. Write one word or name per line, spelled normally ("TikTok" is fine, students can type "tiktok"). Notes go on their own line, starting with `#`.
4. Click **Commit changes**. Netlify redeploys by itself after a minute or two.

A few things to know:
- Only single words with the letters a to z work. Entries with spaces, numbers, other symbols or Norwegian letters (æ, ø, å) are skipped, so write "Tromsø" as `tromso`.
- A word on a block list (`blocked-en.txt` or your `blocked-extra.txt`) is never accepted, even if you add it here.
- The game never adds students' first names by itself, so names like Emma or Jonas aren't accepted. If you add one to `names-extra.txt`, that's your choice. A student could then use a classmate's name as an answer.

**If a deploy fails** while building the word lists, a file in `data/raw/` was probably damaged, emptied or deleted. You might see "Word lists look broken" or a "no such file" error. Undo your last change on GitHub, or paste the end of the deploy log into the chat with Claude.

Word lists: New General Service List (Browne, Culligan & Phillips, CC BY-SA 4.0), SCOWL/ESDB (Kevin Atkinson) and CEFR-J Wordlist Version 1.5 (Yukio Tono, Tokyo University of Foreign Studies). See `data/raw/SCOWL-LICENSE.txt` and `data/raw/CEFRJ-TERMS.txt`.

## For developers

- **Run the tests:** `npm install`, then `npm test`. Rebuild the word lists locally with `npm run build:words`. Run `npm run typecheck` for the type check.
- **End-to-end tests:** `npm run test:e2e` starts the dev server on a free port and drives Chromium with Playwright, loaded from `/opt/npm-tools/node_modules/playwright/index.mjs`. If Playwright isn't there, the tests are skipped with a message.
- **Load test:** `npm run load-test` starts the dev server, and 32 bots play 5 rounds of Everyone at once, each answering with a valid word after 1–8 s. It reports the time from a bot's accepted submit to the first view that shows its answer applied. It exits with 1 on any error or refused word, if fewer or more than 32 × 5 answers were accepted, if nothing was measured, or after 120 s. Two local runs: 160 of 160 answers accepted, 0 refused, median 1.7 / 1.7 ms, 95th percentile 3.2 / 3.0 ms, maximum 4.3 / 8.3 ms, 0 errors. The dev server and the bots share one Node process with no network in between, so these figures are optimistic and say nothing about Netlify.
- **Run it locally:** `npm run dev` starts a local server on port 8888 (host passcode `test` unless `HOST_PASSCODE` is set). The local server doesn't serve `/api/check/*`, so the connection test's server checks only work on Netlify.
- **Pin `@netlify/server`:** `package.json` asks for `"latest"` because Netlify Server is Early Access. After the first successful deploy, look up the version that deploy installed (the deploy log, or `npm ls @netlify/server`) and change `"latest"` to that exact version, with no `^` or `~`, so a breaking release can't end a lesson.
- **Server:** `netlify/server/index.ts` is the Netlify Server entry. It's the only file that imports `@netlify/server`, and it only wires sockets to the game hub in `src/server/` and the connection test in `check-server.ts`. `/api/health` shows the word counts and room count.
- **Browser:** the pages are plain ES modules in `public/`, with no build step. The connection test is in `public/check/`: the logic is in `check-client.js`, and the DOM code is in `check-page.js`.
