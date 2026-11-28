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
test("unranked known after ranked known", () => {
  assert.ok(rarity("magnificent")! < rarity("zebra")!);
});
test("forms use their base", () => {
  assert.equal(rarity("apples"), rarity("apple"));
  assert.equal(rarity("running"), rarity("run"));
  assert.equal(rarity("hoped"), rarity("hope"));
  assert.equal(rarity("cities"), rarity("city"));
});
