// Turns the generated word files (data/generated/) into what the engine needs.
// `read` returns a generated file's text by name, so the server can load them however
// its host allows (file system, bundled import, ...).
import { createWordChecker, type WordChecker } from "../engine/words.ts";
import { createPromptBank, type PromptBank } from "../engine/prompts.ts";
import { createRarity, type Rarity } from "../engine/rarity.ts";
import type { Prompt } from "../engine/types.ts";
import type { Summary } from "./build.ts";

const list = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

const readOptional = (read: (name: string) => string, name: string): string => { try { return read(name); } catch { return ""; } };

/** Everyday words for example answers: known, not a name, their own headword, CEFR-J B1 or below
 *  (or, with no level, an NGSL rank of 2000 or less; 100000 means no rank). Empty without a usable ranks.txt. */
export function everydayWords(read: (name: string) => string): Set<string> {
  const names = new Set(list(readOptional(read, "names.txt")));
  const known = new Set(list(readOptional(read, "known.txt")));
  const out = new Set<string>();
  for (const l of readOptional(read, "ranks.txt").split("\n")) {
    const [w, r, level, head] = l.replace(/\r$/, "").split("\t").map((c) => c.trim());
    if (!w || head || names.has(w) || !known.has(w)) continue;
    const lvl = level && Number.isInteger(Number(level)) ? Number(level) : null;
    const rank = r && Number.isFinite(Number(r)) ? Number(r) : null;
    if (lvl !== null ? lvl <= 3 : rank !== null && rank <= 2000) out.add(w);
  }
  return out;
}

export function loadWordData(read: (name: string) => string): {
  checker: WordChecker;
  bank: PromptBank;
  blockedNames: string[];
  summary: Summary;
  rarity: Rarity;
} {
  const dictionary = list(read("dictionary.txt"));
  const known = list(read("known.txt"));
  const beginner = list(read("beginner.txt"));
  const checker = createWordChecker({ dictionary, known, blocked: list(read("blocked-words.txt")), beginner, everyday: everydayWords(read) });
  // ranks.txt and names.txt are newer than the other files: an old folder without them still loads.
  const optional = (name: string): string => { try { return read(name); } catch { return ""; } };
  // ranks.txt rows: word, rank, level, headword. An older file has only word and rank.
  const ranks = new Map<string, number>();
  const levels = new Map<string, number>();
  const heads = new Map<string, string>();
  for (const l of optional("ranks.txt").split("\n")) {
    const [w, r, level, head] = l.replace(/\r$/, "").split("\t").map((c) => c.trim());
    if (!w) continue;
    if (r && Number.isFinite(Number(r))) ranks.set(w, Number(r));
    if (level && Number.isInteger(Number(level))) levels.set(w, Number(level));
    if (head) heads.set(w, head);
  }
  const rarity = createRarity({ beginner, known, ranks, levels, heads, names: list(optional("names.txt")), dictionary });
  const bank = createPromptBank(JSON.parse(read("prompts.json")) as Prompt[]);
  return {
    checker,
    bank,
    blockedNames: list(read("blocked-names.txt")),
    summary: JSON.parse(read("summary.json")) as Summary,
    rarity,
  };
}
