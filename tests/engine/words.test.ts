import { test } from "node:test";
import assert from "node:assert/strict";
import { normalise, isBlockedName, maskBlocked, createWordChecker } from "../../src/engine/words.ts";
import { makeTestChecker, fixtureWords, fixtureBlocked } from "./helpers.ts";

test("normalise rejects and cleans input", () => {
  assert.deepEqual(normalise("  Elephant!"), { ok: true, word: "elephant" });
  assert.deepEqual(normalise("ÉLAN"), { ok: false, reason: "bad-characters" });
  assert.deepEqual(normalise(""), { ok: false, reason: "empty" });
  assert.deepEqual(normalise("   "), { ok: false, reason: "empty" });
  assert.deepEqual(normalise("a".repeat(31)), { ok: false, reason: "too-long" });
  assert.deepEqual(normalise("don't"), { ok: true, word: "don't" });
  assert.deepEqual(normalise("well-known"), { ok: true, word: "well-known" });
  assert.deepEqual(normalise("a--b"), { ok: false, reason: "bad-characters" });
});

test("matches by prompt type", () => {
  const c = makeTestChecker();
  assert.equal(c.matches({ text: "at", type: "contains", count: 0, common: 0 }, "station"), true);
  assert.equal(c.matches({ text: "st", type: "starts", count: 0, common: 0 }, "station"), true);
  assert.equal(c.matches({ text: "on", type: "ends", count: 0, common: 0 }, "station"), true);
  assert.equal(c.matches({ text: "st", type: "ends", count: 0, common: 0 }, "station"), false);
});

test("blocked words are not valid even if in dictionary", () => {
  const c = makeTestChecker();
  assert.equal(c.isBlocked("damn"), true);
  assert.equal(c.isWord("damn"), false);
  assert.equal(c.isWord("station"), true);
  assert.equal(c.isWord("zzzz"), false);
});

test("examples come from known words only and respect n", () => {
  const c = makeTestChecker();
  const p = { text: "st", type: "starts" as const, count: 0, common: 0 };
  const ex = c.examples(p, 3, Math.random);
  assert.ok(ex.length <= 3 && ex.length > 0);
  for (const w of ex) assert.ok(fixtureWords.includes(w) && w.startsWith("st"));
  assert.equal(new Set(ex).size, ex.length);
  assert.deepEqual(c.examples({ text: "zz", type: "contains", count: 0, common: 0 }, 3, Math.random), []);
});

test("examples prefer beginner words", () => {
  const known = ["stab", "stack", "staff", "stage", "stain", "stair", "stake", "stall", "stamp", "stand", "other"];
  const beginner = ["stage", "stamp", "stand", "other"];
  const c = createWordChecker({ dictionary: known, known, blocked: [], beginner });
  const p = { text: "sta", type: "starts" as const, count: 0, common: 0 };
  for (let i = 0; i < 20; i++) {
    assert.deepEqual([...c.examples(p, 3, Math.random)].sort(), ["stage", "stamp", "stand"]);
  }
});

test("examples: beginner first, then everyday, never other known words", () => {
  const known = ["stab", "stack", "staff", "stage", "stain", "stalk", "stare"];
  const c = createWordChecker({
    dictionary: known, known, blocked: ["stain"], beginner: ["stage", "stare"], everyday: ["stab", "stack", "stage", "stain"],
  });
  const p = { text: "sta", type: "starts" as const, count: 0, common: 0 };
  for (let i = 0; i < 20; i++) {
    const ex = c.examples(p, 3, Math.random);
    assert.equal(ex.length, 3);
    assert.deepEqual(ex.slice(0, 2).sort(), ["stage", "stare"]);
    assert.ok(["stab", "stack"].includes(ex[2]), ex[2]);
    assert.ok(!ex.includes("staff") && !ex.includes("stalk") && !ex.includes("stain"));
  }
});

test("examples: fewer, or none", () => {
  const known = ["stabs", "staffed", "stag"];
  const c = createWordChecker({ dictionary: known, known, blocked: [], beginner: [], everyday: ["stag"] });
  const p = { text: "sta", type: "starts" as const, count: 0, common: 0 };
  assert.deepEqual(c.examples(p, 3, Math.random), ["stag"]);
  assert.deepEqual(c.examples({ ...p, text: "staf" }, 3, Math.random), []);
  const none = createWordChecker({ dictionary: known, known, blocked: [] });
  assert.deepEqual(none.examples(p, 3, Math.random), []);
});

test("isBlockedName catches embedded words and Norwegian", () => {
  assert.equal(isBlockedName("FaenLol", fixtureBlocked), true);
  assert.equal(isBlockedName("d.r.i.t.t", fixtureBlocked), true);
  assert.equal(isBlockedName("Hassan", fixtureBlocked), false);
  assert.equal(isBlockedName("Ass", fixtureBlocked), true);
});

test("isBlockedName keeps Norwegian letters", () => {
  const list = [...fixtureBlocked, "jævla"];
  assert.equal(isBlockedName("Jævla123", list), true);
  assert.equal(isBlockedName("Åse", list), false);
  assert.equal(isBlockedName("aæss", list), false);
});

test("maskBlocked masks a whole blocked word only", () => {
  const isBlocked = (w: string) => w === "ass";
  assert.equal(maskBlocked("ASS ", isBlocked), "★★★★");
  assert.equal(maskBlocked("as", isBlocked), "as");
  assert.equal(maskBlocked("class", isBlocked), "class");
  assert.equal(maskBlocked("  ", isBlocked), "  ");
});
