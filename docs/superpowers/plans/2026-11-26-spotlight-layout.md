# Spotlight layout: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a smaller bomb and bigger names, with the current player's live typing shown large in the middle of the circle (the "spotlight"), on the projector and on student laptops.

**Architecture:**
- `public/app/render-circle.js` (a pure function returning escaped HTML) adds a spotlight element inside the circle when there is live typing to show. In that case the seat on its turn shows nothing under its name.
- `public/app/style.css` positions the spotlight under the bomb and changes the sizes.
- The engine, server, views and `bomb.js` don't change.

**Tech Stack:** plain ES modules in the browser (no build step), `node:test` via `tsx`, and the Playwright end-to-end tests in `tests/e2e/game.e2e.ts`.

**Spec:** `docs/superpowers/specs/2026-11-26-spotlight-layout-design.md` (approved by Roy, 2026-11-26). Read it first, and `docs/design-principles.md`.

## Global Constraints
- **When the spotlight shows:** `typeof view.mode?.current === "string"` and `typeof view.typing === "string"` and there are 20 seats or fewer (`ONE_RING_MAX` from `circle-geometry.js`). Otherwise nothing changes from today.
- **What it contains:** the typed text as tiles (`tiles(view.typing)`, which escapes it) followed by `<span class="caret"></span>`, in `<div class="spotlight">`. Nothing else: no name and no score.
- **Position:** horizontally centred on the circle. Its top is about 0.62 × `--bomb-size` below the circle's centre. It must never overlap the bomb, the arrow at any angle (the arrow's tip reaches 0.6 × the bomb's size from the centre), or any seat.
- **Projector sizes, one ring (1920×1080):**
  - bomb about 31% of the circle's height (`cqh`);
  - names about 4.4cqh at 11–16 seats;
  - last words about 0.72 × the name;
  - spotlight about 6.5cqh.
  - Names are never smaller than today at any seat count.
- **Laptop sizes (1366×768):** bomb about 32cqh, names about 3.4cqh (at least 14 px) at 11–20 seats, and spotlight about 6cqh.
- **Prompt letters** on the bomb are at least 60 px at 1920×1080 with 15 seats. The countdown number stays on the bomb's dark body.
- **Two rings (more than 20 seats):** keep today's sizes, unless something fits without overlaps.
- **Design work only:** no change to `src/`, the server, `bomb.js` or the views.
- **Motion:** the spotlight doesn't animate. The bomb and the join pop stay the only movement.
- **Finish every task green:** `npm test`, `npx tsc -p tsconfig.json`, and from Task 2 on, `npm run test:e2e`.
- **No deploys:** work on branch `claude/elegant-newton-cozbue`. A draft pull request gives Roy a preview.

## Review Focus
1. **Typing turns to an empty string after a backspace.** The server then stops sending `typing`, the spotlight disappears and the seat shows its last word again. Nothing breaks. *(Task 1 test: `no spotlight when typing is absent or not a string`.)*
2. **A very long typed word (30 characters).** It stays on one row and stays inside the circle box. It may get smaller, but never overlaps the seats at the bottom. *(Task 2 e2e: the long typed word case.)*
3. **The Everyone at once view carrying a stray `typing`.** No spotlight, because there is no `current`. *(Task 1 test.)*
4. **Rude-word masking (★★★★) and HTML in typing.** Both are shown escaped in the spotlight. *(Task 1 test.)*
5. **The ⚙ overlay opening on the projector.** The circle narrows, and the spotlight stays centred and clear of everything. *(Task 2 e2e, with the overlay open.)*

---

### Task 1: The spotlight in render-circle.js

**Files:**
- Modify: `public/app/render-circle.js`, `public/app/style.css` (only the `.spotlight` rules: position, nowrap, size)
- Test: `tests/client/render-circle.test.ts`

**Interfaces:**
- Produces: `renderCircle(view, opts)` adds `<div class="spotlight">…</div>` as the circle's last child when the rule in the Global Constraints holds.
- Produces: `export function spotlightText(view, seatCount): string | null`, which returns the typing text when the spotlight shows and `null` otherwise. Both `renderCircle` and the tests use it.

- [ ] **Step 1: Write the failing tests:**
  - `the spotlight shows the current player's typing with a caret, and the seat shows nothing under the name`: 15 seats, current is p3, and `typing: "himse"`. Expect one `.spotlight` holding tiles for h, i, m, s, e and a `.caret`. Seat p3 has no `.typing` and no `.last-word`.
  - `no spotlight when typing is absent or not a string`: `typing` missing, `""` missing from the view, or `42`. Expect no `.spotlight`, and seat p3 shows its last word as today.
  - `no spotlight in Everyone at once`: no `mode.current`, and a stray `typing: "abc"`. Expect no `.spotlight`.
  - `no spotlight with more than 20 seats; the typing stays under the seat`: 24 seats. The seat has `.typing` as today and there is no `.spotlight`.
  - `spotlight text is escaped`: `typing: "<b>&"` gives no raw `<b>`. Also check that `"★★★★"` renders as tiles.
  - `style.css: the spotlight never animates and never wraps`: the `.spotlight` rules have no `animation` and contain `white-space: nowrap` or `flex-wrap: nowrap`.
- [ ] **Step 2:** Run `npx tsx --test tests/client/render-circle.test.ts`. Expect the new tests to fail.
- [ ] **Step 3:** Implement `spotlightText`, change `word()` so the seat shows nothing when the spotlight shows, and add the basic `.spotlight` CSS:
  - absolute, `left: 50%`;
  - `top: calc(50% + var(--bomb-size) * 0.62)` (read from the circle-centre's custom property, or put `--bomb-size` on `.circle` so both use it);
  - `transform: translateX(-50%)`;
  - `font-size` in `cqh`, `z-index: 3`.
- [ ] **Step 4:** Run `npm test` and `npx tsc -p tsconfig.json`. Expect both to pass.
- [ ] **Step 5:** Commit with the message `Spotlight: the current player's typing, large under the bomb`.

### Task 2: Sizes, and end-to-end checks that nothing overlaps

**Files:**
- Modify: `public/app/style.css` (the projector `.p-ring` and laptop `.arena` sizes: bomb, seats, last words, prompt letters on the smaller bomb, and spotlight size)
- Test: `tests/e2e/game.e2e.ts`

- [ ] **Step 1: Write the failing e2e tests** with 15 players in Classic, live typing on, every seat holding a last word including some of 10–12 letters, and the current player typing a 12-letter word:
  - `spotlight layout, projector 1920×1080: names ≥ 40px, prompt letters ≥ 60px, no seat overlaps a seat, the spotlight overlaps no seat and sits below the arrow's reach, and the countdown is on the bomb`;
  - the same on a laptop at 1366×768, with names ≥ 17px;
  - the same on the projector with the ⚙ overlay open;
  - a 30-character typed word: the spotlight stays inside the circle box and overlaps no seat.
  - Measure with bounding boxes, as the existing "two rings for 24 players" test does.
  - Watch them fail on today's sizes.
- [ ] **Step 2:** Change the CSS sizes to the Global Constraints targets and fix any overlaps, for example the long last words at the top corners, with sizes or spacing. Re-run until green. Keep "two rings for 24 players", "the countdown number sits clear of the rim" and the arrow tests green.
- [ ] **Step 3:** Run `npm test`, `npx tsc -p tsconfig.json` and `npm run test:e2e`. Expect all to pass.
- [ ] **Step 4:** Commit with the message `Spotlight layout: smaller bomb, bigger names, checked for overlaps`.

### Task 3: Screenshots and docs

**Files:**
- Modify: `docs/screenshots/*` (with `npm run screenshots`), `docs/design-principles.md` ("Agreed layout": the spotlight), `docs/improvements.md` (item 1 done in batch 2), `CLAUDE.md` (batch 2 status and the spec and plan paths), `docs/EXTENDING.md` (if it describes what sits on the circle)

- [ ] **Step 1:** Run `npm run screenshots`. Look at the projector 08/09/11/15, laptop 06/07/10 and lobby 03/04 shots in Workshop. Check that nothing overlaps, that the 30-player shots look as before (with typing under the seat), and that the lobby still looks right.
- [ ] **Step 2:** Update the docs listed above in their own plain style.
- [ ] **Step 3:** Run `npm test`, `npx tsc -p tsconfig.json`, `npm run test:e2e` and `npm run load-test`. Expect all to pass.
- [ ] **Step 4:** Commit with the message `Spotlight layout: screenshots and docs`.
