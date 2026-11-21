# Bomb game

A classroom word game for ESL students, inspired by BombParty. Right now this repository has one part: a **connection test page** that checks whether the game can run on the school network. The design is in `docs/superpowers/specs/`.

## Step 1: Put the files on GitHub

1. Sign in at [github.com](https://github.com) and click **New** (the green button) to create a repository.
2. Name it `bomb-game`. Leave everything else as it is and click **Create repository**.
3. On the new page, click the link **uploading an existing file**.
4. Unzip the folder you got from Claude. Open it so you can see the files and folders inside (`public`, `netlify`, `tests`, `docs`, `package.json` and so on). Select **all of them** and drag them into the GitHub page.
   - Drag the *contents* of the folder, not the folder itself.
   - Check that the folders came along. After the upload you should see `public/` and `netlify/` in the list.
5. Click **Commit changes**.

## Step 2: Connect Netlify

1. Sign in at [app.netlify.com](https://app.netlify.com).
2. Click **Add new project**, then **Import an existing project**, then **GitHub**, and pick `bomb-game`.
3. Don't change any settings, because the file `netlify.toml` already contains them. Click **Deploy**.
4. Wait until the deploy says **Published** (about 1–2 minutes). The site address looks like `https://something.netlify.app`. You can change the name under **Project configuration → Change project name**.

**If the deploy fails:** open the failed deploy, scroll to the bottom of the log, copy the last 30 or so lines, and paste them into the chat with Claude.

## Step 3: Run the test at school

1. Use a **school laptop** on the **school network**, not a phone hotspot. A student account is even better, because students may have stricter filters than teachers.
2. Open the site address. The four quick checks run by themselves in a few seconds.
3. Click **Start lesson-length test** and leave the tab open for up to 50 minutes. You can use other tabs or teach in the meantime. Stopping after 35 minutes or more is fine.
4. Click **Copy results** and paste them into the chat with Claude.

## Word lists

The game's words come from the files in `data/raw/`. Every time Netlify deploys the site, it rebuilds the lists in `data/generated/` from them. Once the game itself is online, a change you make on GitHub takes effect with the next deploy.

**Block a word yourself:**
1. On GitHub, open the `data/raw` folder.
2. If there's no `blocked-extra.txt` yet, click **Add file → Create new file** and name it `blocked-extra.txt`. Otherwise open it and click the pencil icon.
3. Write one word per line. Notes go on their own line, starting with `#`. Don't put a note after a word on the same line, or that line is ignored.
4. Click **Commit changes**. Netlify redeploys by itself after a minute or two.

Words in `blocked-extra.txt` can't be used as answers or in nicknames. Common forms are blocked automatically: the word plus -s, -es, -ed or -ing. Add unusual forms, such as a different spelling, on their own line. The Norwegian list (`blocked-no.txt`) only blocks **nicknames**, because some of its words, like "fan", are ordinary English words students should be able to answer with.

**If a deploy fails** while building the word lists, a file in `data/raw/` was probably damaged, emptied or deleted. You might see "Word lists look broken" or a "no such file" error. Undo your last change on GitHub, or paste the end of the deploy log into the chat with Claude.

Word lists: New General Service List (Browne, Culligan & Phillips, CC BY-SA 4.0) and SCOWL/ESDB (Kevin Atkinson). See `data/raw/SCOWL-LICENSE.txt`.

## For developers

- **Run the tests:** `npm install`, then `npm test`. Rebuild the word lists locally with `npm run build:words`. Run `npm run typecheck` for the type check.
- **Server:** `netlify/server/index.ts` is the Netlify Server entry. It's the only file that imports `@netlify/server`, and all the logic is in `check-server.ts`.
- **Browser:** the page is plain ES modules in `public/`, with no build step. The logic is in `check-client.js`, and the DOM code is in `check-page.js`.
