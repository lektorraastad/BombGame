# Bomb game: briefing for Claude

A classroom word game for Roy's 8th grade English (ESL) students at a Norwegian lower secondary school, inspired by BombParty on jklm.fun, which is blocked on the school network. Roy hosts the game on the classroom projector, and students (ages 13–14) join on school laptops with a room code and a nickname. Classes are usually 15 (split lessons) and sometimes 30.

Roy is a teacher, not a developer. Explain things in plain language, keep messages short, and give him exact clicks for anything he has to do himself, such as GitHub, Netlify, or downloading files.

## Where things are
- **Design and plans:**
  - `docs/superpowers/specs/2026-11-21-bomb-game-design.md` is the original design, approved by Roy.
  - `docs/superpowers/specs/2026-11-23-redesign-design.md` is the redesign, approved by Roy, and `docs/superpowers/plans/2026-11-23-redesign.md` is its plan.
  - `docs/design-principles.md` holds the **visual design principles and the chosen "Workshop" theme**. Read it before any visual work.
  - `docs/superpowers/plans/` has the five implementation plans already built: connection test, engine, word lists, playable game and the redesign.
  - `docs/EXTENDING.md` explains how to add game modes, knocked-out activities, settings, prompt types and themes, and how to swap the bomb.
  - `README.md` is Roy's setup guide and how to run a lesson.
  - `docs/improvements.md` lists Roy's requested improvements, with leads into the code.
- **Code:**
  - `src/engine/` is the pure game engine (rooms, Classic, Everyone at once, ghost mode, views). It has no network code.
  - `src/words/` and `scripts/build-words.ts` build `data/generated/` from `data/raw/`. That runs on every Netlify build.
  - `data/raw/` also holds the CEFR-J list (`cefrj-vocabulary-profile-1.5.csv`) and Claude's name lists: `names-places.txt` (sections `# countries`, `# nationalities and languages`, `# cities`), `names-holidays.txt` and `names-brands.txt`. Roy may add two optional files: `known-extra.txt` (accepted, counts as known, makes letters easier and can be an example answer) and `names-extra.txt` (accepted as answers only).
  - `data/generated/beginner.txt` holds the beginner words (CEFR-J A1–A2, known names, `known-extra.txt`). Prompt levels come from them (`LEVEL_MIN` in `src/engine/prompts.ts`), and example answers are picked from them first.
  - `src/server/` holds the transport-independent hub, protocol and passcode handling.
  - `netlify/server/index.ts` is the thin Netlify Server adapter. It can't run locally.
  - `scripts/dev-server.ts` is the local server with a minimal WebSocket implementation (`npm run dev`, passcode `test`).
  - `public/` is the browser client: plain ES modules with no build step. The renderers are pure functions returning escaped HTML, and only the `*-page.js` files touch the DOM.
- **Tests:**
  - `npm test` runs the unit tests.
  - `npx tsc -p tsconfig.json` runs the type check.
  - `npm run test:e2e` runs the Playwright end-to-end tests.
  - `npm run load-test` runs 32 bots.
  - `npm run screenshots` refreshes `docs/screenshots/` (every screen in every theme).
  - Playwright isn't a project dependency: `scripts/playwright-path.ts` finds it in `/opt/npm-tools` or `/opt/node-tools` (or `PLAYWRIGHT_PATH`), and the e2e tests fail if it's missing.

## Hosting
- **Netlify:** GitHub deploys to Netlify. The game server is **Netlify Server** (Early Access) on the free plan, with 1 instance. The Netlify project is called **wordfire** (https://wordfire.netlify.app), with no visitor login, so students can open it.
- **Deploy previews:** a draft pull request gets a preview at `https://deploy-preview-<number>--wordfire.netlify.app`. Previews run their own game server and the host passcode works there, and building a preview doesn't restart the live game (both checked 23 November 2026).
- **Connection limit:** WebSocket connections close after 30 minutes, and clients reconnect automatically.
- **Passcode:** `HOST_PASSCODE` is a Netlify environment variable. It's never logged, never sent to clients and never stored in the browser.
- **Health check:** `/api/health` shows word counts. The connection test is at `/check/`.
- **Fallback:** if Netlify Server stops working, the fallback host is Cloudflare. Only the adapter would change.
- **To do:** pin `@netlify/server` to an exact version, since it's still `"latest"`.

## Rules that must not be broken
- **No deploys on lesson days.** A deploy restarts the server and ends every game, so use a branch and a Netlify deploy preview for anything Roy wants to try first.
- **Privacy:** no accounts, no analytics, no cookies, and no logging of nicknames or words. Rooms live in memory only.
- **The projector and the ⚙ overlay never show** scores, ghost points, tokens or the passcode. Ghosts on the results screen are ranked without points. The overlay may be on a mirrored screen the class can see.
- **Student input is untrusted.** Validate every message, escape all rendered text, and never let one room or one client crash the server.
- **Design work never changes game logic.** Use themes (named colour lists chosen in settings) and the single swappable bomb file, as described in `docs/design-principles.md`.
- **Word lists:**
  - The Norwegian rude-word list blocks nicknames only, because it contains "fan", an English word students may answer with.
  - Roy's own `data/raw/blocked-extra.txt` blocks answers and nicknames.
  - Name lists and `known-extra.txt`: blocked words always win, so a name or known word on an answer block list is never accepted. Claude never adds first names (and leaves out cities and brands that are mainly first names, like Victoria or Alexa); if Roy adds one to `names-extra.txt`, that's his choice.
- **How we've built things so far:** test-first (watch each test fail before writing the code), a written design approved by Roy before any building, then a plan, then implementation with review. Keep that up.

## What's next
1. **The redesign is live** (merged on 25 November 2026 at Roy's request; design: `docs/superpowers/specs/2026-11-23-redesign-design.md`). Screenshots of every screen are in `docs/screenshots/`. Things for Roy to watch in the first lesson: the Night fuse theme's red letters on the projector, and typing with a Norwegian keyboard (letters like é) while live typing is on.
2. **Roy's improvements after testing** (details and code leads in `docs/improvements.md`):
   - a smaller bomb, so names and typing can be bigger;
   - more even difficulty for the letters (some are very hard);
   - a nicer, less annoying ticking sound.

   Each one needs a short design that Roy approves before any building.
3. **Small follow-ups:** in `docs/EXTENDING.md` privacy rules, say "player words" (the dictionary examples are also shown), and note that the control screen receives typing but doesn't draw it.
4. **Later:**
   - the "Slate and violet" theme;
   - the Teams and Class vs the bomb modes;
   - adjustments after the first classroom trial.

   The game was deployed and tested by Roy at home on 22 November 2026, but hasn't been tried in a real lesson yet.
