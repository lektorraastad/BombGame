import type { Band, Prompt, PromptType } from "./types.ts";

export const BAND_RANGES = {
  easy: [200, Infinity],
  medium: [60, 199],
  hard: [20, 59],
} as const;

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
      const [lo, hi] = BAND_RANGES[band];
      return p.count >= lo && p.count <= hi;
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
