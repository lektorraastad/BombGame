import { test } from "node:test";
import assert from "node:assert/strict";
import { createRarity } from "../../src/engine/rarity.ts";

const rarity = createRarity({
  beginner: ["apple", "run", "hope", "city", "english", "cat"],
  known: ["apple", "run", "hope", "city", "english", "cat", "magnificent", "zebra", "barbados"],
  ranks: new Map([["apple", 500], ["run", 100], ["hope", 300], ["city", 200], ["cat", 900], ["magnificent", 2500]]),
  names: ["barbados", "tiktok"],
  dictionary: ["apple", "run", "hope", "city", "english", "cat", "magnificent", "zebra", "barbados", "quixotic"],
});

test("names are null", () => assert.equal(rarity("barbados"), null));
test("a word that is a name and an ordinary word is ordinary", () => {
  assert.equal(typeof rarity("english"), "number");
});
test("the three groups in order", () => {
  assert.ok(rarity("cat")! < rarity("magnificent")!);
  assert.ok(rarity("magnificent")! < rarity("quixotic")!);
});
test("lower NGSL frequency is rarer within a group", () => {
  assert.ok(rarity("run")! < rarity("cat")!);
});
test("forms use their base", () => {
  assert.equal(rarity("apples"), rarity("apple"));
  assert.equal(rarity("running"), rarity("run"));
  assert.equal(rarity("hoped"), rarity("hope"));
  assert.equal(rarity("cities"), rarity("city"));
});

// Real data (CEFR-J level, NGSL rank, NGSL headword) for the words the final review named.
const B = ["apologise", "television", "big", "happy", "hope", "her", "she", "war", "he", "four"];
const K = ["bracket", "hypothesis", "hypotheses", "agenda", "agendas", "threaten", "troop", "accompany", "amplify",
  "helper", "teamwork", "fourth", "biggest", "happier", "herd", "shed", "ward", "hop", "hoping"];
const real = createRarity({
  beginner: B,
  known: [...B, ...K],
  ranks: new Map([["apologise", 2301], ["television", 795], ["big", 184], ["biggest", 184], ["happy", 513], ["happier", 513],
    ["hope", 250], ["hoping", 250], ["her", 24], ["she", 24], ["war", 435], ["he", 11], ["hypothesis", 2775],
    ["hypotheses", 2775], ["agenda", 2030], ["agendas", 2030], ["threaten", 1521], ["troop", 1457], ["accompany", 1811],
    ["bracket", 100000], ["amplify", 100000], ["helper", 100000], ["teamwork", 100000], ["fourth", 100000],
    ["herd", 100000], ["shed", 100000], ["ward", 100000], ["hop", 100000], ["four", 100000]]),
  levels: new Map([["apologise", 2], ["television", 1], ["big", 1], ["happy", 1], ["hope", 1], ["her", 1], ["she", 1],
    ["war", 1], ["he", 1], ["four", 1], ["bracket", 4], ["agenda", 3], ["threaten", 4], ["troop", 4], ["accompany", 3],
    ["amplify", 4], ["helper", 4], ["teamwork", 3], ["herd", 3], ["shed", 4], ["ward", 3], ["hop", 3]]),
  heads: new Map([["hypotheses", "hypothesis"], ["agendas", "agenda"], ["biggest", "big"], ["happier", "happy"], ["hoping", "hope"]]),
  names: [],
  dictionary: [...B, ...K, "heed", "quixotic"],
});
const r = (w: string) => real(w)!;

test("the final review's examples are in a sensible order", () => {
  assert.ok(r("hypotheses") > r("threaten"));
  assert.ok(r("threaten") > r("bracket"));
  assert.equal(r("bracket"), r("amplify"));
  assert.ok(r("amplify") > r("troop"));
  assert.ok(r("troop") > r("accompany"));
  assert.ok(r("accompany") > r("agendas"));
  for (const w of ["hypotheses", "threaten", "bracket", "amplify", "troop", "accompany", "agendas"]) assert.ok(r("apologise") < r(w), `apologise below ${w}`);
});
test("an easy unranked word is not rarer than a harder ranked one", () => {
  assert.ok(r("helper") < r("threaten"));
  assert.ok(r("teamwork") < r("threaten"));
  assert.ok(r("fourth") < r("accompany"));
});
test("a family form counts as its NGSL headword", () => {
  assert.equal(r("hypotheses"), r("hypothesis"));
  assert.equal(r("hoping"), r("hope"));
  assert.ok(r("biggest") <= r("television"));
  assert.ok(r("happier") <= r("television"));
});
test("a CEFR-J word keeps its own level and is never cut down to a shorter word", () => {
  assert.ok(r("herd") > r("her"));
  assert.ok(r("shed") > r("she"));
  assert.ok(r("ward") > r("war"));
  assert.equal(r("heed"), r("quixotic")); // dictionary-only, not "he"
});
test("with no CEFR-J level the NGSL rank sets the level; with neither it is A2", () => {
  const est = createRarity({
    beginner: [], known: ["a600", "b601", "c1150", "d1151", "e1700", "f1701", "none", "a2word"],
    ranks: new Map([["a600", 600], ["b601", 601], ["c1150", 1150], ["d1151", 1151], ["e1700", 1700], ["f1701", 1701]]),
    levels: new Map([["a2word", 2]]), names: [], dictionary: [],
  });
  const lvl = (w: string) => Math.floor((est(w)! % 1e7) / 1e6);
  assert.deepEqual(["a600", "b601", "c1150", "d1151", "e1700", "f1701", "none", "a2word"].map(lvl), [1, 2, 2, 3, 3, 4, 2, 2]);
});
test("bases: a bare -d only after -ed, and the most common valid base wins", () => {
  const b = createRarity({
    beginner: ["hope", "her"], known: ["hope", "her", "hop"],
    ranks: new Map([["hope", 250], ["her", 24]]), levels: new Map([["hope", 1], ["her", 1], ["hop", 3]]),
    names: [], dictionary: [],
  });
  assert.equal(b("hoping"), b("hope"));
  assert.equal(b("hoped"), b("hope"));
  assert.equal(b("herd"), 3e7); // dictionary-only here: not "her"
});
test("the key never spills between bands", () => {
  const long = "a".repeat(150);
  const k = createRarity({ beginner: [], known: [long], ranks: new Map([[long, 99999]]), levels: new Map([[long, 4]]), names: [], dictionary: [] });
  assert.equal(k(long), 2e7 + 4e6 + 99 * 1e4 + 9999);
});
