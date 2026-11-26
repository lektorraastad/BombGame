import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScowl, parseScowlAll, parseNgsl, parseBlocked, isGameWord, cleanLine } from "../../src/words/build.ts";
import { buildWordData, generatePrompts, summarize } from "../../src/words/build.ts";
import { createWordChecker } from "../../src/engine/words.ts";
import { WORD_LIST_CREDITS } from "../../src/words/credits.ts";

import { parseCefrj, parseNameList, parsePlaces } from "../../src/words/build.ts";

const sorted = (s: Set<string>) => [...s].sort();

/** Raw input for buildWordData, empty except for the fields a test sets. */
const raw = (over: Partial<Parameters<typeof buildWordData>[0]> = {}): Parameters<typeof buildWordData>[0] => ({
  scowl: "", ngsl: [], cefrj: "", places: "", holidays: "", brands: "",
  knownExtra: [], namesExtra: [], blocked: [], namesOnly: [], ...over,
});

test("parseScowl keeps only lower-case entries (drops proper names and acronyms)", () => {
  const s = parseScowl("Apple\napple\nA's\nParis\nco-op\nrock'n'roll\nÉclair\n");
  assert.deepEqual(sorted(s), ["apple", "co-op", "rock'n'roll"]);
});

test("parseScowlAll lower-cases every entry, for checking NGSL spellings", () => {
  const s = parseScowlAll("Monday\napple\nA's\n");
  assert.deepEqual(sorted(s), ["a's", "apple", "monday"]);
});

test("parseNgsl skips comments and splits forms", () => {
  const s = parseNgsl("## note\nabandon,abandons,abandoned\nMonday,Mondays\n");
  assert.deepEqual(sorted(s), ["abandon", "abandoned", "abandons", "monday", "mondays"]);
});

test("parseNgsl tolerates spaces and trailing commas", () => {
  const s = parseNgsl(" abandon , abandons,\nabout,\n");
  assert.deepEqual(sorted(s), ["abandon", "abandons", "about"]);
  assert.ok(!s.has(""));
});

test("handles CRLF and BOM", () => {
  assert.deepEqual(sorted(parseScowl("﻿first\r\nsecond\r\n")), ["first", "second"]);
  assert.equal(cleanLine("﻿ Hi\r"), "hi");
});

test("parseBlocked splits words, names and drops phrases", () => {
  const b = parseBlocked("ass\nbig tits\nJævla\n🖕\n# comment\n\ng-spot\n");
  assert.deepEqual(sorted(b.words), ["ass", "g-spot"]);
  assert.deepEqual(sorted(b.names), ["ass", "g-spot", "jævla"]);
});

test("isGameWord enforces the engine's answer rule and 30-char limit", () => {
  assert.ok(isGameWord("don't"));
  assert.ok(!isGameWord("a--b"));
  assert.ok(!isGameWord("x".repeat(31)));
  assert.ok(isGameWord("x".repeat(30)));
});

// ---- Task 2: building ----

const lines = (ws: string[]) => ws.join("\n") + "\n";
const prompt = (data: { prompts: { text: string; type: string; count: number }[] }, type: string, text: string) =>
  data.prompts.find((p) => p.type === type && p.text === text);

test("known words must be in SCOWL", () => {
  const d = buildWordData(raw({ scowl: lines(["advertisement"]), ngsl: [lines(["advertisment", "advertisement"])] }));
  assert.deepEqual(d.known, ["advertisement"]);
});

test("blocked words never reach known, dictionary or examples", () => {
  const utt = Array.from({ length: 25 }, (_, i) => "utt" + String.fromCharCode(97 + i)); // utta..utty
  const all = [...utt, "butt"];
  const d = buildWordData(raw({ scowl: lines(all), ngsl: [lines(all)], blocked: [lines(["butt"])] }));
  assert.ok(!d.known.includes("butt"));
  assert.ok(!d.dictionary.includes("butt"));
  assert.equal(prompt(d, "contains", "utt")?.count, 25);
  const checker = createWordChecker({ dictionary: d.dictionary, known: d.known, blocked: d.blockedWords });
  const p = prompt(d, "contains", "utt")!;
  for (let i = 0; i < 50; i++) assert.ok(!checker.examples(p as any, 3, Math.random).includes("butt"));
});

test("NGSL words capitalised in SCOWL (Monday) are known and in the dictionary; SCOWL proper names are not", () => {
  const d = buildWordData(raw({ scowl: lines(["Monday", "Paris", "apple"]), ngsl: [lines(["Monday", "apple"])] }));
  assert.deepEqual(d.known, ["apple", "monday"]);
  assert.deepEqual(d.dictionary, ["apple", "monday"]);
});

test("names-only lists block nicknames but not answers", () => {
  const d = buildWordData(raw({ scowl: lines(["fan"]), ngsl: [lines(["fan"])], blocked: [], namesOnly: [lines(["fan", "jævla"])] }));
  assert.ok(d.known.includes("fan"));
  assert.ok(!d.blockedWords.includes("fan"));
  assert.deepEqual(d.blockedNames, ["fan", "jævla"]);
});

test("chunks only count words longer than the chunk", () => {
  const ps = generatePrompts(["an", ...Array.from({ length: 20 }, (_, i) => "an" + "bcdefghijklmnopqrstuv"[i])], []);
  assert.equal(ps.find((p) => p.type === "contains" && p.text === "an")?.count, 20);
});

test("a word counts once per chunk", () => {
  const ws = ["banana", ...Array.from({ length: 19 }, (_, i) => "xan" + "bcdefghijklmnopqrstu"[i])];
  assert.equal(generatePrompts(ws, []).find((p) => p.type === "contains" && p.text === "an")?.count, 20);
});

test("only prompts with at least MIN_ANSWERS are written", () => {
  const nineteen = Array.from({ length: 19 }, (_, i) => "zq" + "abcdefghijklmnopqrs"[i] + "o");
  assert.equal(generatePrompts(nineteen, []).find((p) => p.text === "zq"), undefined);
  assert.equal(generatePrompts([...nineteen, "zqzo"], []).find((p) => p.type === "starts" && p.text === "zq")?.count, 20);
});

test("starts and ends count position-specific; chunks are letters only", () => {
  const ps = generatePrompts(Array(1).fill("stone"), []);
  assert.equal(ps.length, 0); // below minimum, but check counting directly below
  const many = Array.from({ length: 20 }, (_, i) => "st" + "abcdefghijklmnopqrst"[i] + "ne");
  const out = generatePrompts([...many, "don't"], []);
  assert.equal(out.find((p) => p.type === "starts" && p.text === "st")?.count, 20);
  assert.equal(out.find((p) => p.type === "ends" && p.text === "ne")?.count, 20);
  assert.equal(out.find((p) => p.type === "starts" && p.text === "ne"), undefined);
  assert.ok(out.every((p) => /^[a-z]{2,3}$/.test(p.text)));
});

test("prompts are sorted by type, count desc, text", () => {
  const ws = Array.from({ length: 30 }, (_, i) => "ab" + "cdefghijklmnopqrstuvwxyzcdefg"[i] + "x" + i.toString(36));
  const out = generatePrompts(ws, []);
  const order = ["contains", "starts", "ends"];
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    const ta = order.indexOf(a.type), tb = order.indexOf(b.type);
    assert.ok(ta < tb || (ta === tb && (a.count > b.count || (a.count === b.count && a.text <= b.text))), `${JSON.stringify(a)} before ${JSON.stringify(b)}`);
  }
});

test("summary counts bands with BAND_RANGES", () => {
  const data = {
    dictionary: ["a", "b"], known: ["a"], beginner: [], blockedWords: [], blockedNames: ["x"],
    prompts: [
      { text: "aa", type: "contains" as const, count: 250, common: 0 },
      { text: "ab", type: "contains" as const, count: 199, common: 0 },
      { text: "ac", type: "contains" as const, count: 60, common: 0 },
      { text: "ad", type: "contains" as const, count: 59, common: 0 },
      { text: "ae", type: "ends" as const, count: 20, common: 0 },
    ],
  };
  const s = summarize(data, ["blocked-extra.txt"]);
  assert.deepEqual(s.counts, { dictionary: 2, known: 1, blockedWords: 0, blockedNames: 1 });
  assert.deepEqual(s.prompts.contains, { easy: 1, medium: 2, hard: 1 });
  assert.deepEqual(s.prompts.ends, { easy: 0, medium: 0, hard: 1 });
  assert.deepEqual(s.prompts.starts, { easy: 0, medium: 0, hard: 0 });
  assert.deepEqual(s.skipped, ["blocked-extra.txt"]);
});

test("credit line is exact", () => {
  assert.equal(WORD_LIST_CREDITS, "Word lists: New General Service List (Browne, Culligan & Phillips, CC BY-SA 4.0) · SCOWL/ESDB (Kevin Atkinson)");
});

// ---- Final review fixes ----
import { blockedVariants } from "../../src/words/build.ts";
import { problems } from "../../scripts/build-words.ts";

test("inflected and compound forms of blocked words are blocked as answers", () => {
  const scowl = lines(["fuck", "fucks", "fucked", "fucker", "motherfucking", "cunt", "cunts", "nigger", "niggers",
    "shit", "shithead", "dick", "dickheads", "whore", "whores", "butt", "butter", "spic", "spicy", "suck", "sucked", "station"]);
  const ngsl = lines(["butter", "spicy", "sucked", "station"]);
  const blocked = lines(["fuck", "cunt", "nigger", "shit", "dick", "whore", "butt", "spic", "suck"]);
  const d = buildWordData(raw({ scowl, ngsl: [ngsl], blocked: [blocked] }));
  for (const w of ["fucks", "fucked", "fucker", "motherfucking", "cunts", "niggers", "shithead", "dickheads", "whores"]) {
    assert.ok(!d.dictionary.includes(w), `${w} should not be accepted`);
    assert.ok(d.blockedWords.includes(w), `${w} should be in blockedWords`);
  }
  for (const w of ["butter", "spicy", "sucked", "station"]) assert.ok(d.dictionary.includes(w), `${w} should be accepted`);
});

test("blockedVariants: suffix forms unless the word is a known word; strong stems anywhere", () => {
  const v = blockedVariants(["fucks", "fucking", "butter", "spicy", "sluttish", "classy", "asses"], new Set(["butter", "spicy"]), new Set(["fuck", "butt", "spic", "ass", "slut"]));
  assert.deepEqual([...v].sort(), ["asses", "fucking", "fucks", "sluttish"]);
});

test("problems() refuses tiny known lists, missing prompt types and an emptied block list", () => {
  const ok = { counts: { dictionary: 100000, known: 8000, blockedWords: 300, blockedNames: 300 },
    prompts: { contains: { easy: 50, medium: 50, hard: 50 }, starts: { easy: 4, medium: 50, hard: 50 }, ends: { easy: 5, medium: 5, hard: 5 } }, skipped: [] };
  assert.deepEqual(problems(ok), []);
  assert.equal(problems({ ...ok, counts: { ...ok.counts, known: 999 } }).length, 1);
  assert.equal(problems({ ...ok, counts: { ...ok.counts, blockedWords: 199 } }).length, 1);
  assert.equal(problems({ ...ok, prompts: { ...ok.prompts, ends: { easy: 3, medium: 3, hard: 3 } } }).length, 1);
});

// ---- Batch 1, Task 2: CEFR-J, name lists, beginner words, common ----


const PLACES = "# Place names\n# notes before the first header\nIgnored\n\n# countries\nNorway\nNew Zealand\n# continents\nEurope\n" +
  "# nationalities and languages\nNorwegian\n# spoken tongues\nSwahili\n# cities\n# Norway\nOslo\n# Europe\nParis\n";

test("parseCefrj splits slashes and separates A1-A2", () => {
  const c = parseCefrj("headword,pos,CEFR\na.m./A.M./am/AM,adverb,A1\nbanana,noun,A1\nabandon,verb,B1\n");
  assert.deepEqual(sorted(c.beginner), ["am", "banana"]);
  assert.deepEqual(sorted(c.all), ["abandon", "am", "banana"]);
});

test("parsePlaces sorts sections", () => {
  const p = parsePlaces(PLACES);
  assert.deepEqual(sorted(p.known), ["europe", "norway", "norwegian", "swahili"]);
  assert.deepEqual(sorted(p.answerOnly), ["oslo", "paris"]);
});

test("name files skip junk lines and tolerate BOM and CRLF", () => {
  assert.deepEqual(sorted(parseNameList("﻿# note\r\nNew York\r\niPhone\r\n🙂\r\n\r\nCoca-Cola\r\n")), ["coca-cola", "iphone"]);
});

test("names are answers; only some are known", () => {
  const d = buildWordData(raw({ scowl: lines(["apple"]), places: PLACES, brands: lines(["TikTok"]) }));
  for (const w of ["norway"]) {
    assert.ok(d.dictionary.includes(w) && d.known.includes(w) && d.beginner.includes(w), w);
  }
  for (const w of ["oslo", "tiktok"]) {
    assert.ok(d.dictionary.includes(w), w);
    assert.ok(!d.known.includes(w) && !d.beginner.includes(w), w);
  }
});

test("beginner words come from CEFR-J A1-A2, known names and known-extra, and must be known", () => {
  const d = buildWordData(raw({
    cefrj: "headword,pos,CEFR\nbanana,noun,A1\nabandon,verb,B1\nbutt,noun,A2\n",
    holidays: lines(["Christmas"]), knownExtra: [lines(["Skiing"])], namesExtra: [lines(["Hagrid"])],
    blocked: [lines(["butt"])],
  }));
  assert.deepEqual(d.beginner, ["banana", "christmas", "skiing"]);
  assert.deepEqual(d.known, ["abandon", "banana", "christmas", "skiing"]);
  assert.ok(d.dictionary.includes("hagrid") && !d.known.includes("hagrid"));
});

test("blocked words beat names and known-extra", () => {
  const d = buildWordData(raw({ brands: lines(["Badbrand"]), knownExtra: [lines(["Badword"])], blocked: [lines(["badbrand", "badword"])] }));
  for (const w of ["badbrand", "badword"]) {
    assert.ok(!d.dictionary.includes(w) && !d.known.includes(w) && !d.beginner.includes(w), w);
  }
});

test("blocked variants run over the new words too", () => {
  const d = buildWordData(raw({ brands: lines(["Fuckapp", "Asses"]), namesExtra: [lines(["Shitville"])], blocked: [lines(["fuck", "ass"])] }));
  for (const w of ["fuckapp", "asses", "shitville"]) assert.ok(!d.dictionary.includes(w), w);
});

test("Niger, Nigeria and Nigerian are accepted, while the slur stays blocked", () => {
  const d = buildWordData(raw({
    scowl: lines(["nigger", "niggers"]),
    places: "# countries\nNiger\nNigeria\n# nationalities and languages\nNigerian\n",
    blocked: [lines(["nigger"])],
  }));
  for (const w of ["niger", "nigeria", "nigerian"]) assert.ok(d.dictionary.includes(w) && d.known.includes(w), w);
  for (const w of ["nigger", "niggers"]) assert.ok(!d.dictionary.includes(w) && d.blockedWords.includes(w), w);
});

test("prompts carry common = beginner words that fit", () => {
  const pad = Array.from({ length: 20 }, (_, i) => "an" + "bcdefghijklmnopqrstuv"[i] + "x");
  const ps = generatePrompts(["banana", "bandana", "band", "bands", "abandon", ...pad], ["banana", "band", "an"]);
  const an = ps.find((p) => p.type === "contains" && p.text === "an")!;
  assert.equal(an.common, 2);
  assert.ok(ps.every((p) => typeof p.common === "number"));
});
