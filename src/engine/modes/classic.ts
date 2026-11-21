import type { GameMode, ModeContext } from "./mode.ts";
import type { PlayerId } from "../room.ts";

type ClassicState = { seats: PlayerId[]; current: PlayerId; lastWord: { pid: PlayerId; word: string } | null };

const num = (ctx: ModeContext, key: string): number => Number(ctx.settings[key]);
const visible = (ctx: ModeContext): boolean => ctx.settings.timerStyle === "visible";
const st = (ctx: ModeContext): ClassicState => ctx.state as unknown as ClassicState;

/** A fresh fuse for a new turn: random and hidden, or the fixed visible turn time. */
function armFresh(ctx: ModeContext): void {
  if (visible(ctx)) {
    ctx.armBomb(num(ctx, "turnTime") * 1000, true);
    return;
  }
  const lo = Math.min(num(ctx, "fuseMin"), num(ctx, "fuseMax"));
  const hi = Math.max(num(ctx, "fuseMin"), num(ctx, "fuseMax"));
  ctx.armBomb((lo + ctx.random() * (hi - lo)) * 1000, false);
}

/** The next seat after `from` whose player is still alive in the room. */
function nextAlive(ctx: ModeContext, from: PlayerId): PlayerId | undefined {
  const { seats } = st(ctx);
  const start = seats.indexOf(from);
  for (let step = 1; step <= seats.length; step++) {
    const pid = seats[(start + step + seats.length) % seats.length];
    const pl = ctx.player(pid);
    if (pl && pl.role === "player" && pl.alive) return pid;
  }
  return undefined;
}

/** Ends the game if at most one player is left. Returns true when it did. */
function endIfDone(ctx: ModeContext): boolean {
  const left = ctx.alive();
  if (left.length > 1) return false;
  ctx.endGame(left.map((x) => x.id));
  return true;
}

/** Deals a new prompt to the next alive seat after `from` with a fresh fuse. */
function passTo(ctx: ModeContext, from: PlayerId): void {
  const next = nextAlive(ctx, from);
  if (!next) return;
  st(ctx).current = next;
  ctx.newPrompt();
  armFresh(ctx);
}

export const classicMode: GameMode = {
  id: "classic",
  name: "Classic",
  description: "One bomb, passed around. Answer the prompt before it blows.",
  usedScope: "room",
  settings: [
    { key: "timerStyle", label: "Timer", help: "Hidden random fuse, or a visible countdown for each turn.", kind: "choice",
      default: "hidden", options: [{ value: "hidden", label: "Hidden fuse" }, { value: "visible", label: "Visible countdown" }] },
    { key: "fuseMin", label: "Shortest fuse", help: "Hidden fuse: the shortest it can be.", kind: "number", default: 10, min: 3, max: 60, step: 1, unit: "s" },
    { key: "fuseMax", label: "Longest fuse", help: "Hidden fuse: the longest it can be.", kind: "number", default: 30, min: 5, max: 90, step: 1, unit: "s" },
    { key: "minTurn", label: "Minimum turn time", help: "Hidden fuse: a valid word tops the fuse up to at least this.", kind: "number", default: 5, min: 2, max: 15, step: 1, unit: "s" },
    { key: "turnTime", label: "Turn time", help: "Visible countdown: seconds for each turn.", kind: "number", default: 12, min: 5, max: 60, step: 1, unit: "s" },
    { key: "silentAnswers", label: "Silent answers", help: "Waiting players can answer privately for points.", kind: "boolean", default: true },
  ],
  start(ctx) {
    const seats = ctx.alive().map((p) => p.id);
    const s = st(ctx);
    s.seats = seats;
    s.lastWord = null;
    s.current = seats[Math.floor(ctx.random() * seats.length)];
    ctx.newPrompt();
    armFresh(ctx);
  },
  onWord(ctx, pid, word) {
    ctx.acceptWord(pid, word);
    st(ctx).lastWord = { pid, word };
    const next = nextAlive(ctx, pid);
    if (!next) return;
    st(ctx).current = next;
    ctx.newPrompt();
    if (visible(ctx)) ctx.armBomb(num(ctx, "turnTime") * 1000, true);
    else {
      const minTurn = num(ctx, "minTurn") * 1000;
      if (ctx.bombRemaining() < minTurn) ctx.armBomb(minTurn, false);
    }
  },
  onExplode(ctx) {
    const from = st(ctx).current;
    const prompt = ctx.prompt();
    if (prompt) ctx.explodedPrompt(prompt);
    ctx.loseLife(from);
    if (endIfDone(ctx)) return;
    passTo(ctx, from);
  },
  onPlayerGone(ctx, pid) {
    if (endIfDone(ctx)) return;
    if (pid === st(ctx).current) passTo(ctx, pid);
  },
  onSkip(ctx) {
    ctx.newPrompt();
    armFresh(ctx);
  },
  isOn: (ctx, pid) => st(ctx).current === pid,
  view(ctx) {
    const s = st(ctx);
    const v: Record<string, unknown> = { seats: [...s.seats], current: s.current, timerStyle: ctx.settings.timerStyle, lastWord: s.lastWord ? { ...s.lastWord } : null };
    if (visible(ctx)) v.bombEndsAt = ctx.now() + ctx.bombRemaining();
    return v;
  },
};
