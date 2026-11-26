import type { Band, Prompt, PromptType } from "./types.ts";

/** How hard a prompt is, from how many beginner words fit it (`common`). */
export type Level = "veryEasy" | "easy" | "medium" | "hard";

/** The lowest `common` for each level; anything under `medium` is hard. */
export const LEVEL_MIN = { veryEasy: 15, easy: 8, medium: 4 } as const;

export function levelOf(p: Prompt): Level {
  if (p.common >= LEVEL_MIN.veryEasy) return "veryEasy";
  if (p.common >= LEVEL_MIN.easy) return "easy";
  if (p.common >= LEVEL_MIN.medium) return "medium";
  return "hard";
}

/** Under Normal (and Rising from stage 3), the share of prompts dealt from medium. */
export const NORMAL_MEDIUM_SHARE = 0.2;

/** Easiest first: the order the bank widens in when a band's levels have nothing to deal. */
const LEVELS: Level[] = ["veryEasy", "easy", "medium", "hard"];

type Group = { levels: Level[]; weight: number };

/** The level groups a band deals from, with the chance of each. Rising grows by stage (lap). */
function groupsFor(band: Band, stage: number): Group[] {
  const simple: Group = { levels: ["veryEasy", "easy"], weight: 1 };
  const normal: Group[] = [
    { levels: ["veryEasy", "easy"], weight: 1 - NORMAL_MEDIUM_SHARE },
    { levels: ["medium"], weight: NORMAL_MEDIUM_SHARE },
  ];
  switch (band) {
    case "easy": return [simple];
    case "normal": return normal;
    case "rising":
      if (stage <= 1) return [{ levels: ["veryEasy"], weight: 1 }];
      if (stage === 2) return [simple];
      return normal;
    case "hard": return [{ levels: [...LEVELS], weight: 1 }];
  }
}

export const MIN_ANSWERS = 20;

/** A missing, non-finite or below-1 stage is stage 1; a fractional one rounds down. */
function cleanStage(stage: unknown): number {
  if (typeof stage !== "number" || !Number.isFinite(stage) || stage < 1) return 1;
  return Math.floor(stage);
}

export interface PromptBank {
  next(opts: { band: Band; types: PromptType[]; random: () => number; avoid: string[]; stage?: number }): Prompt;
  /** How many distinct prompts the band can deal at stage 1. */
  size(band: Band, types: PromptType[]): number;
}

/** Identifies a prompt in `avoid` lists. */
export const promptKey = (p: Prompt) => `${p.type}:${p.text}`;

export function createPromptBank(prompts: Prompt[]): PromptBank {
  const kept = prompts.filter((p) => p.count >= MIN_ANSWERS);
  const ofTypes = (types: PromptType[]) => kept.filter((p) => types.includes(p.type));
  const inLevels = (pool: Prompt[], levels: Level[]) => pool.filter((p) => levels.includes(levelOf(p)));

  /**
   * The groups to deal from. If none of the band's levels has a prompt of these types, it widens
   * towards harder levels, one at a time, until something exists. Empty only if `pool` is.
   */
  function dealable(band: Band, stage: number, pool: Prompt[]): { groups: Group[]; pools: Prompt[][] } {
    const groups = groupsFor(band, stage);
    const pools = groups.map((g) => inLevels(pool, g.levels));
    if (pools.some((p) => p.length > 0)) return { groups, pools };
    const used = new Set(groups.flatMap((g) => g.levels));
    for (let n = 1; n <= LEVELS.length; n++) {
      const levels = LEVELS.slice(0, n);
      if (levels.every((l) => used.has(l))) continue;
      const wider = inLevels(pool, levels);
      if (wider.length > 0) return { groups: [{ levels, weight: 1 }], pools: [wider] };
    }
    return { groups: [], pools: [] };
  }

  function pickGroup(groups: Group[], r: number): number {
    const total = groups.reduce((sum, g) => sum + g.weight, 0);
    let x = r * total;
    for (let i = 0; i < groups.length; i++) {
      x -= groups[i].weight;
      if (x < 0) return i;
    }
    return groups.length - 1;
  }

  return {
    size: (band, types) => new Set(dealable(band, 1, ofTypes(types)).pools.flat()).size,
    next({ band, types, random, avoid, stage }) {
      const { groups, pools } = dealable(band, cleanStage(stage), ofTypes(types));
      if (groups.length === 0) throw new Error("no prompts for band/types");
      const chosen = pickGroup(groups, random());
      const fresh = (pool: Prompt[]) => pool.filter((p) => !avoid.includes(promptKey(p)));
      const order = [chosen, ...pools.keys()].filter((i, at, all) => all.indexOf(i) === at);
      let from: Prompt[] = [];
      for (const i of order) {
        from = fresh(pools[i]);
        if (from.length > 0) break;
      }
      // Nothing fresh anywhere: repeat from the chosen group, or any group with prompts.
      if (from.length === 0) from = pools[chosen].length > 0 ? pools[chosen] : pools.find((p) => p.length > 0)!;
      return from[Math.floor(random() * from.length)];
    },
  };
}
