// Turns the generated word files (data/generated/) into what the engine needs.
// `read` returns a generated file's text by name, so the server can load them however
// its host allows (file system, bundled import, ...).
import { createWordChecker, type WordChecker } from "../engine/words.ts";
import { createPromptBank, type PromptBank } from "../engine/prompts.ts";
import type { Prompt } from "../engine/types.ts";
import type { Summary } from "./build.ts";

const list = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

export function loadWordData(read: (name: string) => string): {
  checker: WordChecker;
  bank: PromptBank;
  blockedNames: string[];
  summary: Summary;
} {
  const checker = createWordChecker({
    dictionary: list(read("dictionary.txt")),
    known: list(read("known.txt")),
    blocked: list(read("blocked-words.txt")),
    beginner: list(read("beginner.txt")),
  });
  const bank = createPromptBank(JSON.parse(read("prompts.json")) as Prompt[]);
  return {
    checker,
    bank,
    blockedNames: list(read("blocked-names.txt")),
    summary: JSON.parse(read("summary.json")) as Summary,
  };
}
