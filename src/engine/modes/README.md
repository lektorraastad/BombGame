# Game modes

A **game mode** decides how a game is played: who is "on" (whose words count as real turns), when the bomb goes off, who loses a life, and when the game ends. The engine (`src/engine/room.ts`) does everything else: players, checking words, the timer, lives, the bonus alphabet, pausing and the host controls.

The modes that exist today:

| File | id | What it does |
|---|---|---|
| `src/engine/modes/classic.ts` | `classic` | One bomb passed round the class. One player is on at a time. |
| `src/engine/modes/everyone.ts` | `everyone` | Everyone gets the same prompt each round. Anyone who hasn't answered when the bomb goes off loses a life. |

The interface every mode must follow is in `src/engine/modes/mode.ts` (`GameMode` and `ModeContext`).

## How a mode works

A mode is a plain object. It never sets timers or changes players directly. It calls methods on `ctx` (the `ModeContext` the engine hands it), and the engine does the work.

The engine calls the mode's hooks:

| Hook | When the engine calls it | What a mode usually does |
|---|---|---|
| `start(ctx)` | The host presses Start. | Pick who goes first, `ctx.newPrompt()`, `ctx.armBomb(ms, visible)`. |
| `onWord(ctx, pid, word)` | A player who `isOn` sent a valid, unused word. | `ctx.acceptWord(pid, word)` (score, bonus letters), then move on. |
| `onExplode(ctx)` | The bomb timer ran out. | `ctx.explodedPrompt(prompt)` (example answers), `ctx.loseLife(pid)`, end the game or carry on. |
| `onPlayerGone(ctx, pid)` | The host kicked a player. | End the game if one player is left; pass the bomb on if the kicked player had it. |
| `onSkip(ctx)` | The host pressed "Skip prompt". | `ctx.newPrompt()` and re-arm the bomb. |
| `isOn(ctx, pid)` | Every time a word arrives. | Return true if this player's word should count as a real turn. |
| `view(ctx)` | Every time a screen is drawn. | Return public data for the screens (see below). |

Other fields:

- `id`: a short unique id such as `"classic"`. It is the value saved in the `mode` setting.
- `name` and `description`: shown to the teacher in the settings panel.
- `settings`: extra settings only this mode needs (see "Settings" in `docs/EXTENDING.md`). Read them with `ctx.settings.yourKey`.
- `usedScope`: `"room"` means a word can be used once per game by the whole room, and `"player"` means each player can't repeat their own words.

Keep the mode's own data (whose turn it is, round numbers and so on) in `ctx.state`. The engine empties it at the start of every game.

### What `view()` may contain

Whatever `view()` returns is shown on the projector **and** on every student's screen. So:

- Never put words in it that players typed (Everyone at once shows ticks, not words: `answered` is a list of player ids).
- Never put a hidden fuse time in it. Classic only adds `bombEndsAt` when the timer style is "visible".
- If one player is on at a time, put their id in `current`. Live typing (`src/engine/views.ts`) uses `current` to decide whose typing the projector shows. No `current` means live typing is never shown.
- If you have a list of player ids called `answered`, the views turn it into a tick per player.

## Worked example: "Sudden death"

Everyone has one life, and the fuse gets one second shorter every turn (never under 3 seconds). This is an example only. It is **not** registered, so it doesn't appear in the game.

Save it as `src/engine/modes/sudden.ts`:

```ts
import type { GameMode, ModeContext } from "./mode.ts";
import type { PlayerId } from "../room.ts";

type SuddenState = { seats: PlayerId[]; current: PlayerId; fuseMs: number };
const st = (ctx: ModeContext) => ctx.state as unknown as SuddenState;

/** The next alive player after `from`, going round the seats. */
function nextAlive(ctx: ModeContext, from: PlayerId): PlayerId | undefined {
  const { seats } = st(ctx);
  const start = seats.indexOf(from);
  for (let step = 1; step <= seats.length; step++) {
    const pid = seats[(start + step) % seats.length];
    if (ctx.player(pid)?.alive) return pid;
  }
  return undefined;
}

/** Hands the bomb on with a new prompt and a fuse one second shorter (never under 3 s). */
function passOn(ctx: ModeContext, from: PlayerId): void {
  const next = nextAlive(ctx, from);
  if (!next) return;
  const s = st(ctx);
  s.current = next;
  s.fuseMs = Math.max(3000, s.fuseMs - 1000);
  ctx.newPrompt();
  ctx.armBomb(s.fuseMs, true);
}

function endIfDone(ctx: ModeContext): boolean {
  const left = ctx.alive();
  if (left.length > 1) return false;
  ctx.endGame(left.map((p) => p.id));
  return true;
}

export const suddenDeathMode: GameMode = {
  id: "sudden",
  name: "Sudden death",
  description: "One life each. The fuse gets one second shorter every turn.",
  usedScope: "room",
  settings: [
    { key: "firstFuse", label: "First fuse", help: "Seconds on the very first turn.", kind: "number",
      default: 12, min: 5, max: 30, step: 1, unit: "s" },
  ],
  start(ctx) {
    for (const p of ctx.alive()) ctx.revive(p.id, 1); // everyone gets exactly one life
    const s = st(ctx);
    s.seats = ctx.alive().map((p) => p.id);
    s.current = s.seats[0];
    s.fuseMs = Number(ctx.settings.firstFuse) * 1000;
    ctx.newPrompt();
    ctx.armBomb(s.fuseMs, true);
  },
  onWord(ctx, pid, word) {
    ctx.acceptWord(pid, word);
    passOn(ctx, pid);
  },
  onExplode(ctx) {
    const s = st(ctx);
    const prompt = ctx.prompt();
    if (prompt) ctx.explodedPrompt(prompt);
    ctx.loseLife(s.current);
    if (!endIfDone(ctx)) passOn(ctx, s.current);
  },
  onPlayerGone(ctx, pid) {
    if (endIfDone(ctx)) return;
    if (pid === st(ctx).current) passOn(ctx, pid);
  },
  onSkip(ctx) {
    ctx.newPrompt();
    ctx.armBomb(st(ctx).fuseMs, true);
  },
  isOn: (ctx, pid) => st(ctx).current === pid,
  view(ctx) {
    const s = st(ctx);
    return { seats: [...s.seats], current: s.current, bombEndsAt: ctx.now() + ctx.bombRemaining() };
  },
};
```

Things to notice:

- `ctx.revive(p.id, 1)` is used here to set everyone's lives to 1 at the start. (The engine first gives everyone the "Starting lives" setting.)
- "One life each" only holds with the **Bonus alphabet** setting switched off: using every bonus letter earns an extra life (up to "Max lives"). Tell the teacher to turn it off for this mode, or the example is not really sudden death.
- The bomb is visible (`armBomb(ms, true)`), so `view()` may include `bombEndsAt`.
- `current` is in `view()`, so live typing works for this mode.

### Turning it on

1. Open `src/engine/registry.ts`.
2. Import it: `import { suddenDeathMode } from "./modes/sudden.ts";`
3. Add it to the list: `export const MODES: GameMode[] = [classicMode, everyoneMode, suddenDeathMode];`

That's all. The "Mode" choice in the settings panel now lists "Sudden death", and its "First fuse" setting appears when it is picked. `createRoom()` in `registry.ts` hands the list to every room.

### Testing it

Add `tests/engine/sudden.test.ts`. Copy the `setup()` function from `tests/engine/classic.test.ts`, and pass `modes: [suddenDeathMode]` to `new Room(...)`. Use the fake clock (`clock.advance(ms)`) to make the bomb go off without waiting. For example: start a game with `startLives: 3`, check every player has 1 life, play a word, and check `room.bombRemaining()` is 11000.

## Running the tests

From the project folder (`/home/claude/bomb-game`):

```sh
npm test                    # every test
npx tsc -p tsconfig.json    # type check
npx tsx --test tests/engine/classic.test.ts   # one file
```
