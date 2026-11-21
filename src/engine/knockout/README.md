# Knockout activities

A **knockout activity** decides what students do after they lose their last life, so nobody sits and waits for the next game. The teacher picks one with the "When knocked out" setting.

The activities that exist today:

| File | id | What it does |
|---|---|---|
| `src/engine/knockout/ghost.ts` | `ghost` | Ghosts keep answering privately for ghost points, and can earn one comeback. |
| `src/engine/knockout/activity.ts` (`noopActivity`) | `none` | Used when the setting names no known activity. Knocked-out players just watch. |

The interface every activity must follow is `KnockoutActivity` in `src/engine/knockout/activity.ts`.

## How an activity works

The engine (`src/engine/room.ts`) calls these hooks:

| Hook | When the engine calls it |
|---|---|
| `onKnockedOut(ctx, pid)` | A player just lost their last life. |
| `onPrompt(ctx)` | A new prompt (Classic) or round (Everyone at once) starts. |
| `onWord(ctx, pid, word)` | A knocked-out player sent a word. The engine has already checked that it is a real word, is not blocked, and fits the prompt. Return `{ ok: true, kind: "ghost" }` to accept it, or `{ ok: false, reason: "used" }` (or another reason from `SubmitResult` in `src/engine/modes/mode.ts`) to refuse it. |
| `view(ctx, pid)` | A knocked-out player's screen is drawn. Return what **that player** should see. |

Other fields: `id` (saved in the `knockout` setting), `name` and `description` (shown to the teacher), and `settings` (extra settings for this activity only, read with `ctx.settings.yourKey`).

Rules to keep:

- **Knocked-out players must never change the game for survivors.** Don't call `ctx.acceptWord` (that uses up room words and gives score). Keep the activity's own words in `ctx.activityState`. The engine empties it at the start of every game, and it is separate from the mode's `ctx.state`.
- **Privacy:** `view(ctx, pid)` is only sent to player `pid` (it becomes `me.activity` in `playerView`, see `src/engine/views.ts`). It is never shown on the projector or to other students. Don't put other players' words in it.
- To bring a player back into the game, call `ctx.revive(pid, lives)`. Ghost mode does this for a comeback.

## Worked example: "Cheerleader"

Each knocked-out student cheers for one survivor (picked at random). Every valid word they type sends that survivor a 👏. A word can only be used once by each cheerleader. This is an example only. It is **not** registered, so it doesn't appear in the game.

Save it as `src/engine/knockout/cheerleader.ts`:

```ts
import type { KnockoutActivity } from "./activity.ts";
import type { ModeContext } from "../modes/mode.ts";
import type { PlayerId } from "../room.ts";

type CheerState = {
  /** ghost id -> the survivor they cheer for */
  cheeringFor: Map<PlayerId, PlayerId>;
  /** survivor id -> claps received */
  claps: Map<PlayerId, number>;
  /** each cheerleader's own used words */
  used: Map<PlayerId, Set<string>>;
};

function cheer(ctx: ModeContext): CheerState {
  const s = ctx.activityState as Partial<CheerState>;
  s.cheeringFor ??= new Map();
  s.claps ??= new Map();
  s.used ??= new Map();
  return s as CheerState;
}

/** Picks a random survivor for this ghost to cheer for. */
function pickSurvivor(ctx: ModeContext, ghost: PlayerId): void {
  const alive = ctx.alive();
  if (alive.length === 0) return;
  cheer(ctx).cheeringFor.set(ghost, alive[Math.floor(ctx.random() * alive.length)].id);
}

export const cheerleaderActivity: KnockoutActivity = {
  id: "cheerleader",
  name: "Cheerleader",
  description: "Knocked-out players cheer for a survivor: every valid word sends them a 👏.",
  settings: [],
  onKnockedOut(ctx, pid) {
    pickSurvivor(ctx, pid);
  },
  onPrompt(ctx) {
    // If the survivor a ghost cheers for is out too, pick a new one.
    for (const [ghost, target] of cheer(ctx).cheeringFor) {
      if (!ctx.player(target)?.alive) pickSurvivor(ctx, ghost);
    }
  },
  onWord(ctx, pid, word) {
    const s = cheer(ctx);
    const target = s.cheeringFor.get(pid);
    if (!target) return { ok: false, reason: "not-playing" };
    let mine = s.used.get(pid);
    if (!mine) s.used.set(pid, (mine = new Set()));
    if (mine.has(word)) return { ok: false, reason: "used" };
    mine.add(word);
    s.claps.set(target, (s.claps.get(target) ?? 0) + 1);
    return { ok: true, kind: "ghost" };
  },
  view(ctx, pid) {
    const target = cheer(ctx).cheeringFor.get(pid);
    return { cheeringFor: target ? ctx.player(target)?.nickname ?? null : null, emoji: "👏" };
  },
};
```

Things to notice:

- All the activity's data lives in `ctx.activityState`, set up on first use by `cheer(ctx)`.
- The words are only remembered per cheerleader, so they never use up words for the survivors.
- `view()` tells the cheerleader who they are cheering for. Survivors don't see their claps yet: the views only show an activity's view to the knocked-out player. To show claps on the projector, add a field to `projectorView` in `src/engine/views.ts` (and a read-only getter on `Room` if you need one). Views must only **read** the room.

### Turning it on

1. Open `src/engine/registry.ts`.
2. Import it: `import { cheerleaderActivity } from "./knockout/cheerleader.ts";`
3. Add it to the list: `export const ACTIVITIES: KnockoutActivity[] = [ghostActivity, cheerleaderActivity];`

The "When knocked out" choice in the settings panel now lists "Cheerleader".

### Testing it

Add `tests/engine/cheerleader.test.ts`. Copy `setup()` from `tests/engine/ghost.test.ts` and pass `activities: [cheerleaderActivity]` to `new Room(...)`, then `room.updateSettings({ knockout: "cheerleader" })`. In a test you may knock a player out with `room.context().loseLife(pid)`. Then check that `room.submit(pid, "stone")` returns `{ ok: true, kind: "ghost" }`, that sending the same word again returns `{ ok: false, reason: "used" }`, and that `room.activityView(pid)` names a survivor.

## Running the tests

From the project folder (`/home/claude/bomb-game`):

```sh
npm test                    # every test
npx tsc -p tsconfig.json    # type check
npx tsx --test tests/engine/ghost.test.ts   # one file
```
