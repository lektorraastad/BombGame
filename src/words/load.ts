// Turns the generated word files (data/generated/) into what the engine needs.
// `read` returns a generated file's text by name, so the server can load them however
// its host allows (file system, bundled import, ...).
import { createWordChecker, type WordChecker } from "../engine/words.ts";
import { createPromptBank, type PromptBank } from "../engine/prompts.ts";
import { createRarity, type Rarity } from "../engine/rarity.ts";
import type { Prompt } from "../engine/types.ts";
import type { Summary } from "./build.ts";

const list = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

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
  const checker = createWordChecker({ dictionary, known, blocked: list(read("blocked-words.txt")), beginner });
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
