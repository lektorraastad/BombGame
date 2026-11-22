import { test } from "node:test";
import assert from "node:assert/strict";
import { initialJoin, saveJoin, clearJoin, terminalError } from "../../public/app/session.js";

const mem = (init: Record<string, string> = {}) => {
  const d = new Map(Object.entries(init));
  return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k), d };
};

test("initialJoin rejoins from stored code and nickname", () => {
  const s = mem({ "bomb.code": "ABCD", "bomb.nickname": "Mia" });
  assert.deepEqual(initialJoin(s, ""), { code: "ABCD", nickname: "Mia", auto: true });
});

test("initialJoin: a ?code= link prefills without joining; stored needs both", () => {
  assert.deepEqual(initialJoin(mem(), "?code=wxyz"), { code: "WXYZ", nickname: "", auto: false });
  assert.deepEqual(initialJoin(mem({ "bomb.code": "ABCD" }), ""), { code: "ABCD", nickname: "", auto: false });
  assert.deepEqual(initialJoin(mem(), ""), { code: "", nickname: "", auto: false });
});

test("saveJoin and clearJoin", () => {
  const s = mem();
  saveJoin(s, "ABCD", "Mia");
  assert.equal(s.d.get("bomb.code"), "ABCD");
  assert.equal(s.d.get("bomb.nickname"), "Mia");
  clearJoin(s);
  assert.equal(s.d.size, 0);
});

test("terminalError: no-room and kicked end the game, others do not", () => {
  assert.equal(terminalError("no-room"), "This game has ended");
  assert.equal(terminalError("kicked"), "You were removed from the game");
  assert.equal(terminalError("name-blocked"), null);
});

import { joinStatusText, submitOutcome } from "../../public/app/session.js";

test("join page status text", () => {
  assert.equal(joinStatusText("connecting"), "Connecting…");
  assert.equal(joinStatusText("reconnecting"), "Can't reach the game. Retrying…");
  assert.equal(joinStatusText("open"), "");
});

test("submitOutcome keeps the word when it was not sent", () => {
  assert.deepEqual(submitOutcome(true), { clear: true, message: "" });
  assert.deepEqual(submitOutcome(false), { clear: false, message: "Reconnecting… your word wasn't sent" });
});

import { rememberKick, wasKicked, KICKED_TEXT } from "../../public/app/session.js";

test("rememberKick stores the code under bomb.kicked; wasKicked refuses it, case-insensitively", () => {
  const s = mem();
  assert.equal(wasKicked(s, "ABCD"), false);
  rememberKick(s, "ABCD");
  assert.deepEqual(JSON.parse(s.d.get("bomb.kicked")!), ["ABCD"]);
  assert.equal(wasKicked(s, "ABCD"), true);
  assert.equal(wasKicked(s, "abcd"), true);
  assert.equal(wasKicked(s, "WXYZ"), false);
  rememberKick(s, "ABCD"); // no duplicates
  assert.deepEqual(JSON.parse(s.d.get("bomb.kicked")!), ["ABCD"]);
  assert.equal(KICKED_TEXT, "You were removed from this game");
});

test("bomb.kicked keeps at most the 20 most recent codes", () => {
  const s = mem();
  const codes = Array.from({ length: 22 }, (_, i) => "AAA" + String.fromCharCode(65 + i));
  for (const c of codes) rememberKick(s, c);
  const kept = JSON.parse(s.d.get("bomb.kicked")!);
  assert.equal(kept.length, 20);
  assert.deepEqual(kept, codes.slice(2));
  assert.equal(wasKicked(s, codes[0]), false);
  assert.equal(wasKicked(s, codes[21]), true);
});

test("a damaged bomb.kicked is treated as empty, never thrown", () => {
  for (const junk of ["not json", "{}", "42", '[1, "ABCD"]']) {
    const s = mem({ "bomb.kicked": junk });
    assert.doesNotThrow(() => wasKicked(s, "WXYZ"));
    rememberKick(s, "WXYZ");
    assert.equal(wasKicked(s, "WXYZ"), true);
  }
});
