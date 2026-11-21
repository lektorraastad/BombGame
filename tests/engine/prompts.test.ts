import { test } from "node:test";
import assert from "node:assert/strict";
import { BAND_RANGES, MIN_ANSWERS, createPromptBank } from "../../src/engine/prompts.ts";
import { fixturePrompts, makeDeps } from "./helpers.ts";
import type { Prompt } from "../../src/engine/types.ts";

test("constants match the spec", () => {
  assert.deepEqual(BAND_RANGES, { easy: [200, Infinity], medium: [60, 199], hard: [20, 59] });
  assert.equal(MIN_ANSWERS, 20);
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
    assert.ok(p.count >= 20 && p.count <= 59);
    seen.add(p.text);
  }
  assert.deepEqual([...seen].sort(), ["ect", "ky"]);
});

test("band edges: 200 easy, 199 medium, 60 medium, 59 hard, 20 hard", () => {
  const edge: Prompt[] = [
    { text: "aa", type: "starts", count: 200 },
    { text: "bb", type: "starts", count: 199 },
    { text: "cc", type: "starts", count: 60 },
    { text: "dd", type: "starts", count: 59 },
    { text: "ee", type: "starts", count: 20 },
  ];
  const bank = createPromptBank(edge);
  assert.equal(bank.size("easy", ["starts"]), 1);
  assert.equal(bank.size("medium", ["starts"]), 2);
  assert.equal(bank.size("hard", ["starts"]), 2);
  assert.equal(bank.size("mixed", ["starts"]), 5);
});

test("avoid prevents immediate repeats", () => {
  const two: Prompt[] = [
    { text: "st", type: "starts", count: 300 },
    { text: "re", type: "starts", count: 250 },
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
    { text: "st", type: "starts", count: 300 },
    { text: "st", type: "ends", count: 250 },
  ];
  const bank = createPromptBank(two);
  const { deps } = makeDeps(5);
  for (let i = 0; i < 50; i++) {
    const p = bank.next({ band: "easy", types: ["starts", "ends"], random: deps.random, avoid: ["starts:st"] });
    assert.equal(p.type, "ends");
  }
});

test("avoid is ignored when it would leave nothing", () => {
  const one: Prompt[] = [{ text: "st", type: "starts", count: 300 }];
  const bank = createPromptBank(one);
  const { deps } = makeDeps(2);
  const p = bank.next({ band: "easy", types: ["starts"], random: deps.random, avoid: ["starts:st"] });
  assert.equal(p.text, "st");
});

test("throws when nothing matches", () => {
  const bank = createPromptBank([
    { text: "st", type: "starts", count: 300 },
    { text: "zz", type: "ends", count: 19 },
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
