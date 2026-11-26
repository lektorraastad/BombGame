import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVEL_MIN, MIN_ANSWERS, NORMAL_MEDIUM_SHARE, createPromptBank, levelOf, promptKey } from "../../src/engine/prompts.ts";
import { fixturePrompts, makeDeps } from "./helpers.ts";
import type { Band, Prompt } from "../../src/engine/types.ts";

test("constants match the spec", () => {
  assert.deepEqual(LEVEL_MIN, { veryEasy: 15, easy: 8, medium: 4 });
  assert.equal(MIN_ANSWERS, 20);
});

test("levelOf edges: 15 very easy, 14 and 8 easy, 7 and 4 medium, 3 and 0 hard", () => {
  const at = (common: number) => levelOf({ text: "ab", type: "contains", count: 100, common });
  assert.deepEqual([15, 14, 8, 7, 4, 3, 0].map(at), ["veryEasy", "easy", "easy", "medium", "medium", "hard", "hard"]);
});

test("drops prompts under 20 answers", () => {
  const bank = createPromptBank(fixturePrompts);
  const all: ("contains" | "starts" | "ends")[] = ["contains", "starts", "ends"];
  assert.equal(bank.size("hard", all), fixturePrompts.length - 1);
  assert.equal(bank.size("hard", ["contains"]), 3);
  const { deps } = makeDeps(3);
  for (let i = 0; i < 300; i++) {
    const p = bank.next({ band: "hard", types: all, random: deps.random, avoid: [] });
    assert.notEqual(p.text, "zz");
    assert.ok(p.count >= 20);
  }
});

test("respects band and types", () => {
  const bank = createPromptBank(fixturePrompts);
  const { deps } = makeDeps(7);
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = bank.next({ band: "easy", types: ["ends"], random: deps.random, avoid: [] });
    assert.equal(p.type, "ends");
    seen.add(p.text);
  }
  assert.deepEqual([...seen].sort(), ["ast", "ing"]);
});

// Every level, with two prompts each, all of one type.
const LEVELLED: Prompt[] = [
  { text: "va", type: "contains", count: 300, common: 30 },
  { text: "vb", type: "contains", count: 300, common: 15 },
  { text: "ea", type: "contains", count: 200, common: 14 },
  { text: "eb", type: "contains", count: 200, common: 8 },
  { text: "ma", type: "contains", count: 100, common: 7 },
  { text: "mb", type: "contains", count: 100, common: 4 },
  { text: "ha", type: "contains", count: 50, common: 3 },
  { text: "hb", type: "contains", count: 20, common: 0 },
];

function levelsDealt(band: Band, draws: number, seed: number, stage?: number) {
  const bank = createPromptBank(LEVELLED);
  const { deps } = makeDeps(seed);
  const counts: Record<string, number> = { veryEasy: 0, easy: 0, medium: 0, hard: 0 };
  for (let i = 0; i < draws; i++) {
    counts[levelOf(bank.next({ band, types: ["contains"], random: deps.random, avoid: [], stage }))]++;
  }
  return counts;
}

test("Normal deals medium 1 in 5", () => {
  assert.equal(NORMAL_MEDIUM_SHARE, 0.2);
});

test("easy deals only very easy and easy", () => {
  const c = levelsDealt("easy", 500, 4);
  assert.equal(c.medium + c.hard, 0);
  assert.ok(c.veryEasy > 0 && c.easy > 0);
});

test("normal deals medium about 1 in 5 and never hard", () => {
  const c = levelsDealt("normal", 2000, 9);
  const share = c.medium / 2000;
  assert.ok(share >= 0.15 && share <= 0.25, `medium share ${share}`);
  assert.equal(c.hard, 0);
  assert.ok(c.veryEasy > 0 && c.easy > 0);
});

test("rising stage 1 deals only very easy; stage 2 adds easy; stage 3 matches normal", () => {
  const one = levelsDealt("rising", 300, 5, 1);
  assert.deepEqual([one.easy, one.medium, one.hard], [0, 0, 0]);
  assert.equal(one.veryEasy, 300);
  assert.deepEqual(levelsDealt("rising", 300, 5), one, "no stage means stage 1");
  const two = levelsDealt("rising", 300, 5, 2);
  assert.equal(two.medium + two.hard, 0);
  assert.ok(two.veryEasy > 0 && two.easy > 0);
  const bank = createPromptBank(LEVELLED);
  for (const stage of [3, 4, 9]) {
    const a = makeDeps(13).deps.random;
    const b = makeDeps(13).deps.random;
    for (let i = 0; i < 200; i++) {
      const r = bank.next({ band: "rising", types: ["contains"], random: a, avoid: [], stage });
      const n = bank.next({ band: "normal", types: ["contains"], random: b, avoid: [] });
      assert.equal(promptKey(r), promptKey(n), `stage ${stage}, draw ${i}`);
    }
  }
});

test("a bad stage counts as stage 1; a fractional stage rounds down", () => {
  const one = levelsDealt("rising", 300, 5, 1);
  for (const stage of [NaN, Infinity, -Infinity, 0, -2, 0.5, "3" as unknown as number]) {
    assert.deepEqual(levelsDealt("rising", 300, 5, stage), one, `stage ${String(stage)}`);
  }
  assert.deepEqual(levelsDealt("rising", 300, 5, 2.9), levelsDealt("rising", 300, 5, 2));
});

test("hard deals every level", () => {
  const c = levelsDealt("hard", 800, 6);
  assert.ok(c.veryEasy > 0 && c.easy > 0 && c.medium > 0 && c.hard > 0, JSON.stringify(c));
});

test("falls back to the nearest level when a group is empty", () => {
  const bank = createPromptBank([
    ...LEVELLED,
    { text: "se", type: "starts", count: 100, common: 10 },
    { text: "sm", type: "starts", count: 100, common: 5 },
    { text: "eh", type: "ends", count: 100, common: 1 },
    { text: "em", type: "ends", count: 100, common: 6 },
  ]);
  const { deps } = makeDeps(8);
  for (let i = 0; i < 100; i++) {
    const p = bank.next({ band: "rising", types: ["starts"], random: deps.random, avoid: [], stage: 1 });
    assert.equal(p.text, "se", "very easy is empty, so easy is next");
    // Normal with no very easy or easy "ends" prompts still deals medium, never hard.
    assert.equal(bank.next({ band: "normal", types: ["ends"], random: deps.random, avoid: [] }).text, "em");
    // Easy never reaches past its levels when they have prompts: "sm" (medium) is never dealt.
    assert.equal(bank.next({ band: "easy", types: ["starts"], random: deps.random, avoid: [] }).text, "se");
  }
  const hardOnly = createPromptBank([{ text: "zq", type: "ends", count: 40, common: 0 }]);
  assert.equal(hardOnly.next({ band: "easy", types: ["ends"], random: deps.random, avoid: [] }).text, "zq");
  assert.equal(hardOnly.size("easy", ["ends"]), 1, "size counts what the band would really deal");
});

test("normal falls back to the other group when the chosen one has no fresh prompt", () => {
  const bank = createPromptBank(LEVELLED);
  const { deps } = makeDeps(21);
  const avoid = ["contains:va", "contains:vb", "contains:ea", "contains:eb"];
  for (let i = 0; i < 50; i++) {
    const p = bank.next({ band: "normal", types: ["contains"], random: deps.random, avoid });
    assert.equal(levelOf(p), "medium");
  }
  const allAvoided = LEVELLED.map(promptKey);
  for (let i = 0; i < 50; i++) {
    const p = bank.next({ band: "normal", types: ["contains"], random: deps.random, avoid: allAvoided });
    assert.notEqual(levelOf(p), "hard");
  }
});

test("size: normal counts VE+E+M, rising counts VE", () => {
  const bank = createPromptBank(LEVELLED);
  assert.equal(bank.size("easy", ["contains"]), 4);
  assert.equal(bank.size("normal", ["contains"]), 6);
  assert.equal(bank.size("rising", ["contains"]), 2);
  assert.equal(bank.size("hard", ["contains"]), 8);
  const fx = createPromptBank(fixturePrompts);
  const all: ("contains" | "starts" | "ends")[] = ["contains", "starts", "ends"];
  assert.equal(fx.size("easy", all), 5);
  assert.equal(fx.size("normal", all), 7);
  assert.equal(fx.size("rising", all), 3);
  assert.equal(fx.size("hard", all), 10);
});

test("avoid prevents immediate repeats", () => {
  const two: Prompt[] = [
    { text: "st", type: "starts", count: 300, common: 20 },
    { text: "re", type: "starts", count: 250, common: 20 },
  ];
  const bank = createPromptBank(two);
  const { deps } = makeDeps(11);
  for (let i = 0; i < 100; i++) {
    const p = bank.next({ band: "easy", types: ["starts"], random: deps.random, avoid: ["starts:st"] });
    assert.equal(p.text, "re");
  }
});

test("avoid is keyed on type and text together", () => {
  const two: Prompt[] = [
    { text: "st", type: "starts", count: 300, common: 20 },
    { text: "st", type: "ends", count: 250, common: 20 },
  ];
  const bank = createPromptBank(two);
  const { deps } = makeDeps(5);
  for (let i = 0; i < 50; i++) {
    const p = bank.next({ band: "easy", types: ["starts", "ends"], random: deps.random, avoid: ["starts:st"] });
    assert.equal(p.type, "ends");
  }
});

test("avoid is ignored when it would leave nothing", () => {
  const one: Prompt[] = [{ text: "st", type: "starts", count: 300, common: 20 }];
  const bank = createPromptBank(one);
  const { deps } = makeDeps(2);
  const p = bank.next({ band: "easy", types: ["starts"], random: deps.random, avoid: ["starts:st"] });
  assert.equal(p.text, "st");
});

test("throws only when the bank has no prompt of these types", () => {
  const bank = createPromptBank([
    { text: "st", type: "starts", count: 300, common: 0 },
    { text: "zz", type: "ends", count: 19, common: 20 },
  ]);
  const { deps } = makeDeps(1);
  const draw = (band: Band, types: ("starts" | "ends")[]) =>
    bank.next({ band, types, random: deps.random, avoid: [] });
  assert.equal(draw("easy", ["starts"]).text, "st");
  assert.throws(() => draw("hard", ["ends"]), /^Error: no prompts for band\/types$/);
  assert.throws(() => draw("easy", ["ends"]), /no prompts for band\/types/);
  assert.throws(() => draw("easy", []), /no prompts for band\/types/);
  assert.equal(bank.size("hard", ["ends"]), 0);
  assert.equal(bank.size("easy", []), 0);
});
