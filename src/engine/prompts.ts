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

// Temporary: the old band names mapped onto levels. Task 4 replaces bands with the Difficulty setting.
const BAND_LEVELS: Record<Exclude<Band, "mixed">, Level[]> = {
  easy: ["veryEasy", "easy"],
  medium: ["medium"],
  hard: ["hard"],
};

export const MIN_ANSWERS = 20;

export interface PromptBank {
  next(opts: { band: Band; types: PromptType[]; random: () => number; avoid: string[] }): Prompt;
  size(band: Band, types: PromptType[]): number;
}

/** Identifies a prompt in `avoid` lists. */
export const promptKey = (p: Prompt) => `${p.type}:${p.text}`;

export function createPromptBank(prompts: Prompt[]): PromptBank {
  const kept = prompts.filter((p) => p.count >= MIN_ANSWERS);

  function eligible(band: Band, types: PromptType[]): Prompt[] {
    return kept.filter((p) => {
      if (!types.includes(p.type)) return false;
      if (band === "mixed") return true;
      return BAND_LEVELS[band].includes(levelOf(p));
    });
  }

  return {
    size: (band, types) => eligible(band, types).length,
    next({ band, types, random, avoid }) {
      const pool = eligible(band, types);
      if (pool.length === 0) throw new Error("no prompts for band/types");
      const fresh = pool.filter((p) => !avoid.includes(promptKey(p)));
      const from = fresh.length > 0 ? fresh : pool;
      return from[Math.floor(random() * from.length)];
    },
  };
}
