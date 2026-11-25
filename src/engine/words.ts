import type { Prompt } from "./types.ts";

export type NormaliseResult =
  | { ok: true; word: string }
  | { ok: false; reason: "empty" | "too-long" | "bad-characters" };

const MAX_LENGTH = 30;
const ALLOWED = /^[a-z]+(['-][a-z]+)*$/;

export function normalise(raw: string): NormaliseResult {
  let w = raw.trim().toLowerCase();
  if (w === "") return { ok: false, reason: "empty" };
  w = w.replace(/[.!?]$/, "");
  if (w === "") return { ok: false, reason: "bad-characters" };
  if (w.length > MAX_LENGTH) return { ok: false, reason: "too-long" };
  if (!ALLOWED.test(w)) return { ok: false, reason: "bad-characters" };
  return { ok: true, word: w };
}

export interface WordChecker {
  isWord(w: string): boolean;
  isBlocked(w: string): boolean;
  matches(p: Prompt, w: string): boolean;
  examples(p: Prompt, n: number, random: () => number): string[];
}

export function createWordChecker(opts: {
  dictionary: Iterable<string>;
  known: Iterable<string>;
  blocked: Iterable<string>;
}): WordChecker {
  const lower = (items: Iterable<string>) => [...items].map((w) => w.toLowerCase());
  const dictionary = new Set(lower(opts.dictionary));
  const known = [...new Set(lower(opts.known))];
  const blocked = new Set(lower(opts.blocked));

  const matches = (p: Prompt, w: string): boolean =>
    p.type === "contains" ? w.includes(p.text) : p.type === "starts" ? w.startsWith(p.text) : w.endsWith(p.text);

  return {
    isWord: (w) => dictionary.has(w) && !blocked.has(w),
    isBlocked: (w) => blocked.has(w),
    matches,
    examples(p, n, random) {
      const pool = known.filter((w) => !blocked.has(w) && matches(p, w));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, Math.max(0, n));
    },
  };
}

export function isBlockedName(name: string, blocked: Iterable<string>): boolean {
  const flat = name.normalize("NFC").toLowerCase().replace(/[^\p{L}]/gu, "");
  if (flat === "") return false;
  for (const entry of blocked) {
    const b = entry.toLowerCase();
    if (flat === b || (b.length >= 4 && flat.includes(b))) return true;
  }
  return false;
}

/** Live typing: a whole typed word that is on the blocked-answers list shows as stars. Half-typed words are left alone. */
export function maskBlocked(text: string, isBlocked: (w: string) => boolean): string {
  const w = text.trim().toLowerCase();
  return w !== "" && isBlocked(w) ? "★★★★" : text;
}
