import type { KnockoutActivity } from "./activity.ts";
import type { ModeContext } from "../modes/mode.ts";
import type { PlayerId } from "../room.ts";

/** Ghost mode's private state, kept in ctx.activityState (reset each game). */
type GhostState = {
  /** Each ghost's own words; never shared with the room. */
  words: Map<PlayerId, Set<string>>;
  /** Ghosts who answered the current prompt. */
  answered: Set<PlayerId>;
  /** Consecutive-prompt streaks (mirrored to Player.ghostStreak). */
  streaks: Map<PlayerId, number>;
};

function st(ctx: ModeContext): GhostState {
  const s = ctx.activityState as Partial<GhostState>;
  s.words ??= new Map();
  s.answered ??= new Set();
  s.streaks ??= new Map();
  return s as GhostState;
}

const MIN_ALIVE_FOR_COMEBACK = 3;

export const ghostActivity: KnockoutActivity = {
  id: "ghost",
  name: "Ghost mode",
  description: "Knocked-out players keep answering privately for ghost points, and can earn a comeback.",
  settings: [
    { key: "comeback", label: "Comebacks", help: "A ghost who answers on several prompts in a row returns with one life.", kind: "boolean", default: true },
    { key: "comebackStreak", label: "Comeback streak", help: "Prompts or rounds in a row a ghost must answer to come back.", kind: "number", default: 3, min: 2, max: 6, step: 1 },
  ],
  onKnockedOut() {},
  onPrompt(ctx) {
    const s = st(ctx);
    for (const [pid, streak] of s.streaks) {
      if (streak > 0 && !s.answered.has(pid)) {
        s.streaks.set(pid, 0);
        const pl = ctx.player(pid);
        if (pl) pl.ghostStreak = 0;
      }
    }
    s.answered.clear();
  },
  onWord(ctx, pid, word) {
    const pl = ctx.player(pid);
    if (!pl) return { ok: false, reason: "not-playing" };
    const s = st(ctx);
    let own = s.words.get(pid);
    if (!own) s.words.set(pid, (own = new Set()));
    if (own.has(word)) return { ok: false, reason: "used" };
    own.add(word);
    pl.ghostPoints += 1;

    if (!s.answered.has(pid)) {
      s.answered.add(pid);
      const streak = (s.streaks.get(pid) ?? 0) + 1;
      s.streaks.set(pid, streak);
      pl.ghostStreak = streak;
      if (
        ctx.settings.comeback === true &&
        !pl.comebackUsed &&
        streak === Number(ctx.settings.comebackStreak) &&
        ctx.alive().length >= MIN_ALIVE_FOR_COMEBACK
      ) {
        pl.comebackUsed = true;
        s.streaks.set(pid, 0);
        pl.ghostStreak = 0;
        ctx.revive(pid, 1);
      }
    }
    return { ok: true, kind: "ghost" };
  },
  privateWords(ctx, pid) {
    return [...(st(ctx).words.get(pid) ?? [])];
  },
  view(ctx, pid) {
    const pl = ctx.player(pid);
    return {
      ghostPoints: pl?.ghostPoints ?? 0,
      streak: pl?.ghostStreak ?? 0,
      comebackStreak: Number(ctx.settings.comebackStreak),
      comebackAvailable: ctx.settings.comeback === true && !!pl && !pl.comebackUsed && ctx.alive().length >= MIN_ALIVE_FOR_COMEBACK,
    };
  },
};
