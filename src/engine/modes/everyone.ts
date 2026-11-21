import type { GameMode, ModeContext } from "./mode.ts";
import type { PlayerId } from "../room.ts";

type EveryoneState = { round: number; answered: PlayerId[]; starters: PlayerId[] };

const st = (ctx: ModeContext): EveryoneState => ctx.state as unknown as EveryoneState;

/** Seconds for round n: a fixed roundTime, or 1 s shorter each round down to a floor of 6. */
function roundMs(ctx: ModeContext, round: number): number {
  const base = Number(ctx.settings.roundTime);
  const secs = ctx.settings.shrinking === true ? Math.max(6, base - (round - 1)) : base;
  return secs * 1000;
}

/** Deals one prompt to everyone alive and arms the round's visible countdown. */
function startRound(ctx: ModeContext, round: number): void {
  const s = st(ctx);
  s.round = round;
  s.answered = [];
  s.starters = ctx.alive().map((p) => p.id);
  ctx.newPrompt();
  ctx.armBomb(roundMs(ctx, round), true);
}

/** After a round: one survivor wins, nobody left shares the win among the round's starters, else go on. */
function finishRound(ctx: ModeContext): void {
  const s = st(ctx);
  const left = ctx.alive();
  if (left.length === 1) {
    ctx.endGame([left[0].id]);
  } else if (left.length === 0) {
    ctx.endGame(s.starters.filter((pid) => ctx.player(pid) !== undefined));
  } else {
    startRound(ctx, s.round + 1);
  }
}

export const everyoneMode: GameMode = {
  id: "everyone",
  name: "Everyone at once",
  description: "Everyone gets the same prompt. Answer before the bomb goes off or lose a life.",
  usedScope: "player",
  settings: [
    { key: "roundTime", label: "Round time", help: "Seconds for each round.", kind: "number", default: 15, min: 6, max: 60, step: 1, unit: "s" },
    { key: "shrinking", label: "Shrinking rounds", help: "Each round is 1 second shorter, down to 6 seconds.", kind: "boolean", default: false },
  ],
  start(ctx) {
    startRound(ctx, 1);
  },
  onWord(ctx, pid, word) {
    ctx.acceptWord(pid, word);
    st(ctx).answered.push(pid);
  },
  onExplode(ctx) {
    const s = st(ctx);
    const prompt = ctx.prompt();
    if (prompt) ctx.explodedPrompt(prompt);
    const slow = s.starters.filter((pid) => !s.answered.includes(pid));
    for (const pid of slow) ctx.loseLife(pid);
    finishRound(ctx);
  },
  onPlayerGone(ctx, pid) {
    const s = st(ctx);
    const left = ctx.alive();
    if (left.length <= 1) return finishRound(ctx);
    // Only a starter who still owed an answer can complete the round by leaving.
    if (!s.starters.includes(pid) || s.answered.includes(pid)) return;
    const waiting = left.filter((p) => s.starters.includes(p.id) && !s.answered.includes(p.id));
    if (waiting.length === 0) finishRound(ctx);
  },
  onSkip(ctx) {
    const s = st(ctx);
    s.answered = [];
    s.starters = ctx.alive().map((p) => p.id);
    ctx.newPrompt();
    ctx.armBomb(roundMs(ctx, s.round), true);
  },
  isOn(ctx, pid) {
    const s = st(ctx);
    const pl = ctx.player(pid);
    return !!pl && pl.alive && s.starters.includes(pid) && !s.answered.includes(pid);
  },
  view(ctx) {
    const s = st(ctx);
    return {
      round: s.round,
      answered: s.answered.filter((pid) => ctx.player(pid) !== undefined),
      bombEndsAt: ctx.now() + ctx.bombRemaining(),
    };
  },
};
