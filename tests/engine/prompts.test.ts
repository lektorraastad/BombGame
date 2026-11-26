import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVEL_MIN, MIN_ANSWERS, createPromptBank, levelOf } from "../../src/engine/prompts.ts";
import { fixturePrompts, makeDeps } from "./helpers.ts";
import type { Prompt } from "../../src/engine/types.ts";

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
  assert.equal(bank.size("mixed", all), fixturePrompts.length - 1);
  assert.equal(bank.size("hard", ["contains"]), 1);
  const { deps } = makeDeps(3);
  for (let i = 0; i < 300; i++) {
    const p = bank.next({ band: "mixed", types: all, random: deps.random, avoid: [] });
    assert.notEqual(p.text, "zz");
    assert.ok(p.count >= 20);
  }
});

test("respects band and types", () => {
  const bank = createPromptBank(fixturePrompts);
  const { deps } = makeDeps(7);
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = bank.next({ band: "hard", types: ["ends"], random: deps.random, avoid: [] });
    assert.equal(p.type, "ends");
    assert.equal(levelOf(p), "hard");
    seen.add(p.text);
  }
  assert.deepEqual([...seen].sort(), ["ect", "ky"]);
});

// Temporary until Task 4 replaces the bands: easy = very easy + easy, medium = medium, hard = hard.
test("old band names map onto levels by common", () => {
  const edge: Prompt[] = [
    { text: "aa", type: "starts", count: 20, common: 15 },
    { text: "bb", type: "starts", count: 20, common: 8 },
    { text: "cc", type: "starts", count: 500, common: 7 },
    { text: "dd", type: "starts", count: 500, common: 4 },
    { text: "ee", type: "starts", count: 500, common: 3 },
  ];
  const bank = createPromptBank(edge);
  assert.equal(bank.size("easy", ["starts"]), 2);
  assert.equal(bank.size("medium", ["starts"]), 2);
  assert.equal(bank.size("hard", ["starts"]), 1);
  assert.equal(bank.size("mixed", ["starts"]), 5);
  const fx = createPromptBank(fixturePrompts);
  assert.equal(fx.size("easy", ["contains", "starts", "ends"]), 5);
  assert.equal(fx.size("medium", ["contains", "starts", "ends"]), 2);
  assert.equal(fx.size("hard", ["contains", "starts", "ends"]), 3);
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

test("throws when nothing matches", () => {
  const bank = createPromptBank([
    { text: "st", type: "starts", count: 300, common: 20 },
    { text: "zz", type: "ends", count: 19, common: 20 },
  ]);
  const { deps } = makeDeps(1);
  const draw = (band: "easy" | "hard", types: ("starts" | "ends")[]) =>
    bank.next({ band, types, random: deps.random, avoid: [] });
  assert.throws(() => draw("hard", ["starts"]), /^Error: no prompts for band\/types$/);
  assert.throws(() => draw("easy", ["ends"]), /no prompts for band\/types/);
  assert.throws(() => draw("easy", []), /no prompts for band\/types/);
  assert.equal(bank.size("hard", ["starts"]), 0);
  assert.equal(bank.size("easy", []), 0);
});
