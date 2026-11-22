# Bomb game: briefing for Claude

A classroom word game for Roy's 8th grade English (ESL) students at a Norwegian lower secondary school, inspired by BombParty on jklm.fun, which is blocked on the school network. Roy hosts the game on the classroom projector, and students (ages 13–14) join on school laptops with a room code and a nickname. Classes are usually 15 (split lessons) and sometimes 30.

Roy is a teacher, not a developer. Explain things in plain language, keep messages short, and give him exact clicks for anything he has to do himself, such as GitHub, Netlify, or downloading files.

## Where things are
- **Design and plans:**
  - `docs/superpowers/specs/2026-11-21-bomb-game-design.md` is the original design, approved by Roy.
  - `docs/design-principles.md` holds the **visual design principles and the chosen "Workshop" theme**. Read it before any visual work.
  - `docs/superpowers/plans/` has the four implementation plans already built: connection test, engine, word lists and playable game.
  - `docs/EXTENDING.md` explains how to add game modes, knocked-out activities, settings and prompt types.
  - `README.md` is Roy's setup guide and how to run a lesson.
- **Code:**
  - `src/engine/` is the pure game engine (rooms, Classic, Everyone at once, ghost mode, views). It has no network code.
  - `src/words/` and `scripts/build-words.ts` build `data/generated/` from `data/raw/`. That runs on every Netlify build.
  - `src/server/` holds the transport-independent hub, protocol and passcode handling.
  - `netlify/server/index.ts` is the thin Netlify Server adapter. It can't run locally.
  - `scripts/dev-server.ts` is the local server with a minimal WebSocket implementation (`npm run dev`, passcode `test`).
  - `public/` is the browser client: plain ES modules with no build step. The renderers are pure functions returning escaped HTML, and only the `*-page.js` files touch the DOM.
- **Tests:**
  - `npm test` runs the unit tests.
  - `npx tsc -p tsconfig.json` runs the type check.
  - `npm run test:e2e` runs the Playwright end-to-end tests.
  - `npm run load-test` runs 32 bots.

## Hosting
- **Netlify:** GitHub deploys to Netlify. The game server is **Netlify Server** (Early Access) on the free plan, with 1 instance.
- **Connection limit:** WebSocket connections close after 30 minutes, and clients reconnect automatically.
- **Passcode:** `HOST_PASSCODE` is a Netlify environment variable. It's never logged, never sent to clients and never stored in the browser.
- **Health check:** `/api/health` shows word counts. The connection test is at `/check/`.
- **Fallback:** if Netlify Server stops working, the fallback host is Cloudflare. Only the adapter would change.
- **To do:** pin `@netlify/server` to an exact version, since it's still `"latest"`.

## Rules that must not be broken
- **No deploys on lesson days.** A deploy restarts the server and ends every game, so use a branch and a Netlify deploy preview for anything Roy wants to try first.
- **Privacy:** no accounts, no analytics, no cookies, and no logging of nicknames or words. Rooms live in memory only.
- **The projector and the ⚙ overlay never show** scores, ghost points, tokens or the passcode. The overlay may be on a mirrored screen the class can see.
- **Student input is untrusted.** Validate every message, escape all rendered text, and never let one room or one client crash the server.
- **Design work never changes game logic.** Use themes (named colour lists chosen in settings) and the single swappable bomb file, as described in `docs/design-principles.md`.
- **Word lists:**
  - The Norwegian rude-word list blocks nicknames only, because it contains "fan", an English word students may answer with.
  - Roy's own `data/raw/blocked-extra.txt` blocks answers and nicknames.
- **How we've built things so far:** test-first (watch each test fail before writing the code), a written design approved by Roy before any building, then a plan, then implementation with review. Keep that up.

## What's next
1. **The redesign.** Roy has chosen it in `docs/design-principles.md`: the "letter tiles and a lit fuse" identity, the Workshop theme, a theme picker in settings, a bomb with an animated flame and a turn arrow in the middle, emoji avatars (a fixed set of 60), the circle shown on student screens too, live typing with rude-word masking, and two rings for large classes. Next step: write the redesign design doc for Roy to approve, then a plan.

   Roy will download the Lexend and Rubik font files when asked.
2. **Later:**
   - the "Slate and violet" theme;
   - the Teams and Class vs the bomb modes;
   - adjustments after the first classroom trial.

   The game was deployed and tested by Roy at home on 22 November 2026, but hasn't been tried in a real lesson yet.
