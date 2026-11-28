import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, MAX_MESSAGE_BYTES } from "../../src/server/protocol.ts";

const ok = (m: object) => assert.deepEqual(validate(JSON.stringify(m)), m, JSON.stringify(m));
const bad = (raw: string) => assert.equal(validate(raw), null, raw);

test("validate accepts every message shape", () => {
  ok({ t: "create", passcode: "secret", token: "tok-1" });
  ok({ t: "host", code: "ABCD", token: "tok-1", hostToken: "ht-1" });
  ok({ t: "host", code: "ABCD", token: "tok-1", passcode: "secret" });
  ok({ t: "control", code: "ABCD", passcode: "secret", token: "tok-2" });
  ok({ t: "control", code: "ABCD", hostToken: "ht-1", token: "tok-2" });
  ok({ t: "join", code: "ABCD", token: "tok-3", nickname: "Ola" });
  ok({ t: "submit", word: "station" });
  ok({ t: "typing", text: "sta" });
  for (const cmd of ["start", "pause", "resume", "skip", "end", "playAgain", "showWords", "lock", "unlock"]) ok({ t: "cmd", cmd });
  ok({ t: "cmd", cmd: "kick", pid: "p1" });
  ok({ t: "cmd", cmd: "rename", pid: "p1", nickname: "Kari" });
  ok({ t: "cmd", cmd: "settings", settings: { startLives: 3, mode: "classic" } });
  ok({ t: "leave" });
  // A lower-case code is upper-cased; unknown extra fields are dropped.
  assert.deepEqual(validate(JSON.stringify({ t: "join", code: "abcd", token: "t", nickname: "Ola", extra: 1 })),
    { t: "join", code: "ABCD", token: "t", nickname: "Ola" });
});

test("validate rejects oversized, non-JSON, unknown t, wrong field types", () => {
  bad(JSON.stringify({ t: "typing", text: "a".repeat(MAX_MESSAGE_BYTES) }));
  bad(JSON.stringify({ t: "join", code: "ABCD", token: "t", nickname: "Ø".repeat(1000) })); // over 2000 bytes, not characters
  bad("not json");
  bad("{");
  bad("null");
  bad("[]");
  bad("42");
  bad(JSON.stringify({ t: "explode" }));
  bad(JSON.stringify({ word: "x" }));
  bad(JSON.stringify({ t: "submit", word: 5 }));
  bad(JSON.stringify({ t: "submit", word: "a".repeat(61) }));
  bad(JSON.stringify({ t: "typing", text: "a".repeat(61) }));
  bad(JSON.stringify({ t: "typing" }));
  bad(JSON.stringify({ t: "join", code: "ABC", token: "t", nickname: "Ola" }));
  bad(JSON.stringify({ t: "join", code: "AB1D", token: "t", nickname: "Ola" }));
  bad(JSON.stringify({ t: "join", code: "ABCD", token: "t", nickname: "a".repeat(41) }));
  bad(JSON.stringify({ t: "join", code: "ABCD", token: "", nickname: "Ola" }));
  bad(JSON.stringify({ t: "join", code: "ABCD", nickname: "Ola" }));
  bad(JSON.stringify({ t: "create", passcode: 1234, token: "t" }));
  bad(JSON.stringify({ t: "host", code: "ABC", token: "t", passcode: "secret" }));
  bad(JSON.stringify({ t: "host", code: "ABCD", passcode: "secret" }));
  bad(JSON.stringify({ t: "control", code: "ABCD", token: "t" }));
  bad(JSON.stringify({ t: "cmd", cmd: "explode" }));
  bad(JSON.stringify({ t: "cmd", cmd: "kick" }));
  bad(JSON.stringify({ t: "cmd", cmd: "rename", pid: "p1" }));
  bad(JSON.stringify({ t: "cmd", cmd: "rename", pid: "p1", nickname: "a".repeat(41) }));
  bad(JSON.stringify({ t: "cmd", cmd: "settings" }));
  bad(JSON.stringify({ t: "cmd", cmd: "settings", settings: [1, 2] }));
  bad(JSON.stringify({ t: "cmd", cmd: "settings", settings: null }));
  bad(JSON.stringify({ t: "cmd", cmd: "settings", settings: "x" }));
  bad(JSON.stringify({ t: "cmd", cmd: "toString" }));
});

test("a host hello with neither a host token nor a passcode is valid, so the hub can answer not-host", () => {
  assert.deepEqual(validate(JSON.stringify({ t: "host", code: "abcd", token: "t" })), { t: "host", code: "ABCD", token: "t" });
  // An empty host token counts as missing; a host token wins over a passcode.
  assert.deepEqual(validate(JSON.stringify({ t: "host", code: "ABCD", token: "t", hostToken: "" })), { t: "host", code: "ABCD", token: "t" });
  assert.deepEqual(validate(JSON.stringify({ t: "host", code: "ABCD", token: "t", hostToken: "ht", passcode: "p" })),
    { t: "host", code: "ABCD", token: "t", hostToken: "ht" });
  assert.equal(validate(JSON.stringify({ t: "host", code: "ABCD", token: "t", passcode: "a".repeat(201) })), null);
});

test("the avatar message takes a whole number from 0 to 59, nothing else", () => {
  ok({ t: "avatar", avatar: 3 });
  ok({ t: "avatar", avatar: 0 });
  ok({ t: "avatar", avatar: 59 });
  for (const avatar of ["3", -1, 60, 2.5, null, true, [3], { n: 3 }]) bad(JSON.stringify({ t: "avatar", avatar }));
  bad(JSON.stringify({ t: "avatar" }));
  // NaN and Infinity become null in JSON; a raw NaN isn't JSON at all.
  bad('{"t":"avatar","avatar":NaN}');
  bad('{"t":"avatar","avatar":1e400}');
});
