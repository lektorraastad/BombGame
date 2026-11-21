import { test } from "node:test";
import assert from "node:assert/strict";
import { normalise, isBlockedName } from "../../src/engine/words.ts";
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
  assert.equal(c.matches({ text: "at", type: "contains", count: 0 }, "station"), true);
  assert.equal(c.matches({ text: "st", type: "starts", count: 0 }, "station"), true);
  assert.equal(c.matches({ text: "on", type: "ends", count: 0 }, "station"), true);
  assert.equal(c.matches({ text: "st", type: "ends", count: 0 }, "station"), false);
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
  const p = { text: "st", type: "starts" as const, count: 0 };
  const ex = c.examples(p, 3, Math.random);
  assert.ok(ex.length <= 3 && ex.length > 0);
  for (const w of ex) assert.ok(fixtureWords.includes(w) && w.startsWith("st"));
  assert.equal(new Set(ex).size, ex.length);
  assert.deepEqual(c.examples({ text: "zz", type: "contains", count: 0 }, 3, Math.random), []);
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
