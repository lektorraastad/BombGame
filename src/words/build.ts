// Turns the raw word files in data/raw/ into the data sets the engine needs.
// Pure functions only: the build script (scripts/build-words.ts) does the file I/O.

import type { Prompt, PromptType } from "../engine/types.ts";
import { MIN_ANSWERS, BAND_RANGES } from "../engine/prompts.ts";

const GAME_WORD = /^[a-z]+(['-][a-z]+)*$/;
const MAX_WORD_LENGTH = 30;

/** Trim, strip BOM and \r, NFC-normalise and lower-case one entry. */
export function cleanLine(s: string): string {
  return s.replace(/﻿/g, "").replace(/\r/g, "").trim().normalize("NFC").toLowerCase();
}

/** Same rule as the engine's normalise(): letters a–z with inner ' or -, at most 30 characters. */
export function isGameWord(w: string): boolean {
  return w.length <= MAX_WORD_LENGTH && GAME_WORD.test(w);
}

function lines(text: string): string[] {
  return text.split("\n").map(cleanLine);
}

/**
 * SCOWL/ESDB word list: one word per line. Returns the entries that are written in
 * lower case and are game words. Capitalised entries (Paris, John, NATO) are proper
 * names or acronyms, which are not accepted as answers.
 */
export function parseScowl(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    const original = raw.replace(/\uFEFF/g, "").replace(/\r/g, "").trim().normalize("NFC");
    if (original !== original.toLowerCase()) continue;
    if (isGameWord(original)) out.add(original);
  }
  return out;
}

/** Every SCOWL entry lower-cased: used only to check NGSL spellings (Monday, April). */
export function parseScowlAll(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of lines(text)) if (isGameWord(w)) out.add(w);
  return out;
}

/** NGSL CSV files: "##" comment lines, then comma-separated forms per line. */
export function parseNgsl(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    if (raw.replace(/^﻿/, "").trimStart().startsWith("##")) continue;
    for (const form of raw.split(",")) {
      const w = cleanLine(form);
      if (isGameWord(w)) out.add(w);
    }
  }
  return out;
}

/**
 * Block-list files: one entry per line, "#" comments allowed.
 * `words` are single game words (used to block answers);
 * `names` are single entries with at least one letter, æøå kept (used to block nicknames).
 * Multi-word phrases are dropped: a typed answer or nickname check never sees spaces.
 */
export function parseBlocked(text: string): { words: Set<string>; names: Set<string> } {
  const words = new Set<string>();
  const names = new Set<string>();
  for (const w of lines(text)) {
    if (w === "" || w.startsWith("#") || /\s/.test(w)) continue;
    if (isGameWord(w)) words.add(w);
    if (/\p{L}/u.test(w)) names.add(w);
  }
  return { words, names };
}

// ---- Building the data sets ----


export type WordData = {
  dictionary: string[];
  known: string[];
  blockedWords: string[];
  blockedNames: string[];
  prompts: Prompt[];
};

export type BandCounts = { easy: number; medium: number; hard: number };

export type Summary = {
  counts: { dictionary: number; known: number; blockedWords: number; blockedNames: number };
  prompts: Record<PromptType, BandCounts>;
  skipped: string[];
};

const TYPES: PromptType[] = ["contains", "starts", "ends"];
const CHUNK = /^[a-z]{2,3}$/;

const sortedArray = (s: Iterable<string>) => [...s].sort();

/** Endings that turn a blocked word into another form of it (asses, rapes, dickheads). */
const BLOCK_SUFFIXES = ["s", "es", "'s", "ed", "ing", "ings", "head", "heads", "hole", "holes", "face", "faces"];

/** The worst swears: any word containing one of these is blocked (motherfucking, bullshitter). */
const STRONG_ANYWHERE = ["fuck", "cunt", "shit", "cocksuck", "motherf", "whore", "dickhead", "bitch"];

/**
 * Swears and slurs blocked when a word starts with them. Not "anywhere", because they hide
 * inside everyday words: saltwater (twat), swanky (wank), snigger (nigger).
 */
const STRONG_PREFIX = ["nigger", "nigga", "fagg", "slut", "wank", "twat"];

/** Everyday words that the rules above would otherwise catch. */
const ALLOWED = new Set(["spiced", "spices", "spicing", "sucked", "sucking", "cocked", "cocking", "butted", "butting",
  "snatched", "snatches", "snatching", "escorted", "escorting", "escorts", "shitake", "shitakes", "mishit", "mishits", "mishitting"]);

/**
 * Words that are forms of a blocked word, so they must be blocked too:
 * - any word containing a STRONG_ANYWHERE stem or starting with a STRONG_PREFIX stem;
 * - a blocked word plus a common ending (asses, rapes, dickheads), unless it is a known
 *   word or in ALLOWED.
 */
export function blockedVariants(words: Iterable<string>, known: Set<string>, stems: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const w of words) {
    if (ALLOWED.has(w)) continue;
    if (STRONG_ANYWHERE.some((s) => w.includes(s)) || STRONG_PREFIX.some((s) => w.startsWith(s))) { out.add(w); continue; }
    if (known.has(w)) continue;
    for (const suffix of BLOCK_SUFFIXES) {
      if (w.length > suffix.length && w.endsWith(suffix) && stems.has(w.slice(0, -suffix.length))) { out.add(w); break; }
    }
  }
  return out;
}

/**
 * raw.blocked: block files that apply to answers AND nicknames (English, Roy's extra list).
 * raw.namesOnly: block files that apply to nicknames only (Norwegian: it contains "fan",
 * which is an everyday English answer).
 */
export function buildWordData(raw: { scowl: string; ngsl: string[]; blocked: string[]; namesOnly: string[] }): WordData {
  const scowl = parseScowl(raw.scowl);
  const spelled = parseScowlAll(raw.scowl);

  const blockedWords = new Set<string>();
  const blockedNames = new Set<string>();
  for (const text of raw.blocked) {
    const b = parseBlocked(text);
    b.words.forEach((w) => blockedWords.add(w));
    b.names.forEach((w) => blockedNames.add(w));
  }
  for (const text of raw.namesOnly) parseBlocked(text).names.forEach((w) => blockedNames.add(w));

  const known = new Set<string>();
  for (const text of raw.ngsl) {
    for (const w of parseNgsl(text)) if (spelled.has(w) && !blockedWords.has(w)) known.add(w);
  }
  for (const w of blockedVariants([...scowl, ...known], known, new Set(blockedWords))) {
    blockedWords.add(w);
    known.delete(w);
  }

  const dictionary = new Set<string>();
  for (const w of scowl) if (!blockedWords.has(w)) dictionary.add(w);
  for (const w of known) dictionary.add(w);

  return {
    dictionary: sortedArray(dictionary),
    known: sortedArray(known),
    blockedWords: sortedArray(blockedWords),
    blockedNames: sortedArray(blockedNames),
    prompts: generatePrompts(known),
  };
}

/** 2–3 letter a–z chunks with at least MIN_ANSWERS known words longer than the chunk. */
export function generatePrompts(known: Iterable<string>): Prompt[] {
  const counts: Record<PromptType, Map<string, number>> = { contains: new Map(), starts: new Map(), ends: new Map() };
  const bump = (type: PromptType, chunk: string) => {
    if (CHUNK.test(chunk)) counts[type].set(chunk, (counts[type].get(chunk) ?? 0) + 1);
  };
  for (const w of new Set(known)) {
    for (const n of [2, 3]) {
      if (w.length <= n) continue;
      const inside = new Set<string>();
      for (let i = 0; i + n <= w.length; i++) inside.add(w.slice(i, i + n));
      inside.forEach((c) => bump("contains", c));
      bump("starts", w.slice(0, n));
      bump("ends", w.slice(-n));
    }
  }
  const out: Prompt[] = [];
  for (const type of TYPES) {
    const ps: Prompt[] = [];
    for (const [text, count] of counts[type]) if (count >= MIN_ANSWERS) ps.push({ text, type, count });
    ps.sort((a, b) => b.count - a.count || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
    out.push(...ps);
  }
  return out;
}

export function summarize(data: WordData, skipped: string[]): Summary {
  const empty = (): BandCounts => ({ easy: 0, medium: 0, hard: 0 });
  const prompts: Record<PromptType, BandCounts> = { contains: empty(), starts: empty(), ends: empty() };
  for (const p of data.prompts) {
    for (const band of ["easy", "medium", "hard"] as const) {
      const [lo, hi] = BAND_RANGES[band];
      if (p.count >= lo && p.count <= hi) prompts[p.type][band]++;
    }
  }
  return {
    counts: {
      dictionary: data.dictionary.length,
      known: data.known.length,
      blockedWords: data.blockedWords.length,
      blockedNames: data.blockedNames.length,
    },
    prompts,
    skipped: [...skipped],
  };
}
