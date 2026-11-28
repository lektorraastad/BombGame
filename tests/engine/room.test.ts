import { test } from "node:test";
import assert from "node:assert/strict";
import { Room, makeRoomCode, ROOM_CODE_LETTERS, WORDS_STEP_MS } from "../../src/engine/room.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import type { GameMode } from "../../src/engine/modes/mode.ts";
import { makeDeps, makeTestChecker, fixturePrompts, fixtureBlocked } from "./helpers.ts";

/** A mode that deals one prompt and does nothing else, so tests can have a game running. */
const idleMode: GameMode = {
  id: "classic", name: "Idle", description: "", settings: [], usedScope: "room",
  start: (ctx) => { ctx.newPrompt(); },
  onWord() {}, onExplode() {}, onPlayerGone() {}, onSkip() {},
  isOn: () => false,
  view: () => ({}),
};

function makeRoom(onChange?: () => void) {
  const { deps } = makeDeps(7);
  return new Room({
    code: "ABCD",
    deps,
    checker: makeTestChecker(),
    bank: createPromptBank(fixturePrompts),
    blockedNames: fixtureBlocked,
    onChange,
    modes: [idleMode],
  });
}
const names = (r: Room) => r.players().map((p) => p.nickname);

test("room code avoids I L O and clashes", () => {
  assert.ok(!/[ILO]/.test(ROOM_CODE_LETTERS));
  const { deps } = makeDeps(3);
  for (let i = 0; i < 200; i++) {
    const code = makeRoomCode(deps.random, new Set());
    assert.match(code, /^[A-HJKM-NP-Z]{4}$/);
    assert.ok(!/[ILO]/.test(code));
  }
  const first = makeRoomCode(makeDeps(5).deps.random, new Set());
  const retry = makeRoomCode(makeDeps(5).deps.random, new Set([first]));
  assert.notEqual(retry, first);
  assert.equal(retry.length, 4);
});

test("join assigns unique nicknames", () => {
  const r = makeRoom();
  for (const t of ["t1", "t2", "t3"]) assert.ok(r.join(t, "Mia").ok);
  assert.deepEqual(names(r), ["Mia", "Mia 2", "Mia 3"]);
  const long = "A".repeat(16);
  r.join("t4", long);
  r.join("t5", long);
  const last = r.players()[4].nickname;
  assert.ok(last.length <= 16);
  assert.equal(last, "A".repeat(14) + " 2");
  assert.equal(new Set(names(r)).size, 5);
});

test("nickname length and block list", () => {
  const r = makeRoom();
  assert.deepEqual(r.join("a", "A"), { ok: false, reason: "name-length" });
  assert.deepEqual(r.join("a", "  B  "), { ok: false, reason: "name-length" });
  assert.deepEqual(r.join("a", "x".repeat(17)), { ok: false, reason: "name-length" });
  assert.deepEqual(r.join("a", "faenboy"), { ok: false, reason: "name-blocked" });
  assert.equal(r.players().length, 0);
});

test("reconnect restores the same player", () => {
  const r = makeRoom();
  const j = r.join("tok", "Mia");
  assert.ok(j.ok);
  if (!j.ok) return;
  const p = r.players()[0];
  p.lives = 1;
  p.score = 7;
  r.disconnect(j.playerId);
  assert.equal(r.players()[0].connected, false);
  const again = r.join("tok", "Other");
  assert.deepEqual(again, { ok: true, playerId: j.playerId });
  const q = r.players()[0];
  assert.equal(r.players().length, 1);
  assert.equal(q.nickname, "Mia");
  assert.equal(q.connected, true);
  assert.equal(q.lives, 1);
  assert.equal(q.score, 7);
  assert.notEqual(j.playerId, "tok");
});

test("kick bans the token", () => {
  const r = makeRoom();
  const j = r.join("bad", "Bob");
  assert.ok(j.ok);
  if (!j.ok) return;
  r.kick(j.playerId);
  assert.equal(r.players().length, 0);
  assert.deepEqual(r.join("bad", "Bob"), { ok: false, reason: "kicked" });
  assert.ok(r.join("good", "Bob").ok);
});

test("lock blocks new tokens but not reconnects", () => {
  const r = makeRoom();
  const j = r.join("a", "Ann");
  assert.ok(j.ok);
  if (!j.ok) return;
  r.disconnect(j.playerId);
  r.setLocked(true);
  assert.deepEqual(r.join("b", "Ben"), { ok: false, reason: "locked" });
  assert.deepEqual(r.join("a", "Ann"), { ok: true, playerId: j.playerId });
  r.setLocked(false);
  assert.ok(r.join("b", "Ben").ok);
});

test("full at 32", () => {
  const r = makeRoom();
  for (let i = 0; i < 32; i++) assert.ok(r.join("t" + i, "Player" + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? "x" : "")).ok);
  assert.deepEqual(r.join("extra", "Extra"), { ok: false, reason: "full" });
  const first = r.players()[0];
  assert.deepEqual(r.join("t0", "Whatever"), { ok: true, playerId: first.id });
});

test("late joiners become spectators and spectators count toward 32", () => {
  const r = makeRoom();
  assert.equal(r.players().length, 0);
  r.join("a", "Ann");
  r.join("a2", "Amy");
  assert.deepEqual(r.start(), { ok: true });
  const j = r.join("b", "Ben");
  assert.ok(j.ok);
  assert.deepEqual(r.players().map((p) => p.role), ["player", "player", "spectator"]);
  for (let i = 0; i < 29; i++) r.join("s" + i, "Spec" + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? "x" : ""));
  assert.equal(r.players().length, 32);
  assert.deepEqual(r.join("z", "Zed"), { ok: false, reason: "full" });
});

test("rename uses join rules and calls onChange", () => {
  let n = 0;
  const r = makeRoom(() => n++);
  const a = r.join("a", "Ann");
  const b = r.join("b", "Ben");
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  const before = n;
  assert.deepEqual(r.rename(b.playerId, "Ann"), { ok: true, playerId: b.playerId });
  assert.deepEqual(names(r), ["Ann", "Ann 2"]);
  assert.deepEqual(r.rename(a.playerId, "Ann"), { ok: true, playerId: a.playerId });
  assert.equal(names(r)[0], "Ann");
  assert.deepEqual(r.rename(a.playerId, "x"), { ok: false, reason: "name-length" });
  assert.deepEqual(r.rename(a.playerId, "dritt"), { ok: false, reason: "name-blocked" });
  assert.ok(n > before);
});

// ---- avatars ----
const avatarOf = (r: Room, id: string) => r.players().find((p) => p.id === id)!.avatar;
function joinOk(r: Room, token: string, nick: string): string {
  const j = r.join(token, nick);
  assert.ok(j.ok);
  return j.ok ? j.playerId : "";
}

test("each joiner gets a different avatar in 0..59", () => {
  const r = makeRoom();
  for (let i = 0; i < 32; i++) joinOk(r, "t" + i, "Player" + i);
  const av = r.players().map((p) => p.avatar);
  assert.equal(new Set(av).size, 32);
  for (const a of av) assert.ok(Number.isInteger(a) && a >= 0 && a < 60);
});

test("setAvatar: free one in the lobby works; taken one is refused", () => {
  let changes = 0;
  const r = makeRoom(() => changes++);
  const a = joinOk(r, "ta", "Anna");
  const b = joinOk(r, "tb", "Bjorn");
  assert.deepEqual(r.setAvatar(b, avatarOf(r, a)), { ok: false, reason: "avatar-taken" });
  const free = [...Array(60).keys()].find((i) => i !== avatarOf(r, a) && i !== avatarOf(r, b))!;
  const before = changes;
  assert.deepEqual(r.setAvatar(b, free), { ok: true });
  assert.equal(avatarOf(r, b), free);
  assert.ok(changes > before);
  assert.deepEqual(r.setAvatar(b, free), { ok: true }); // own avatar: no-op ok
  assert.deepEqual(r.setAvatar("nobody", 3), { ok: false, reason: "not-found" });
});

test("setAvatar is locked for players during a game, open for spectators", () => {
  const r = makeRoom();
  const a = joinOk(r, "ta", "Anna");
  joinOk(r, "tb", "Bjorn");
  assert.deepEqual(r.start(), { ok: true });
  const mine = avatarOf(r, a);
  const free = [...Array(60).keys()].find((i) => !r.players().some((p) => p.avatar === i))!;
  assert.deepEqual(r.setAvatar(a, free), { ok: false, reason: "avatar-locked" });
  assert.equal(avatarOf(r, a), mine);
  const late = joinOk(r, "tc", "Cara");
  assert.equal(r.players().find((p) => p.id === late)!.role, "spectator");
  assert.deepEqual(r.setAvatar(late, free), { ok: true });
  assert.equal(avatarOf(r, late), free);
});

test("setAvatar rejects 60, -1, 2.5 and NaN with bad-avatar", () => {
  const r = makeRoom();
  const a = joinOk(r, "ta", "Anna");
  for (const bad of [60, -1, 2.5, NaN, Infinity, "3" as unknown as number, null as unknown as number]) {
    assert.deepEqual(r.setAvatar(a, bad), { ok: false, reason: "bad-avatar" });
  }
  r.start(); // junk is bad-avatar even when locked
  assert.deepEqual(r.setAvatar(a, 60), { ok: false, reason: "bad-avatar" });
});

test("reconnect keeps the avatar; kick frees it", () => {
  const r = makeRoom();
  const a = joinOk(r, "ta", "Anna");
  const b = joinOk(r, "tb", "Bjorn");
  const av = avatarOf(r, a);
  r.disconnect(a);
  assert.equal(joinOk(r, "ta", "Anna"), a);
  assert.equal(avatarOf(r, a), av);
  r.kick(a);
  assert.deepEqual(r.setAvatar(b, av), { ok: true });
});

// ---- the results step ----

function stepRoom() {
  const { deps, clock } = makeDeps(7);
  let changes = 0;
  const room = new Room({
    code: "ABCD", deps, checker: makeTestChecker(), bank: createPromptBank(fixturePrompts),
    blockedNames: fixtureBlocked, onChange: () => { changes++; }, modes: [idleMode],
  });
  joinOk(room, "ta", "Anna");
  joinOk(room, "tb", "Bjorn");
  return { room, clock, changes: () => changes };
}

test("results start on awards and move to words after WORDS_STEP_MS", async () => {
  const { room, clock, changes } = stepRoom();
  assert.equal(WORDS_STEP_MS, 11_500);
  assert.deepEqual(room.start(), { ok: true });
  assert.equal(room.resultsStep, "awards");
  room.context().endGame([]);
  assert.equal(room.phase, "results");
  assert.equal(room.resultsStep, "awards");
  await clock.advance(WORDS_STEP_MS - 1);
  assert.equal(room.resultsStep, "awards");
  const before = changes();
  await clock.advance(1);
  assert.equal(room.resultsStep, "words");
  assert.equal(changes(), before + 1);
});

test("showWords moves at once and the timer then does nothing", async () => {
  const { room, clock, changes } = stepRoom();
  room.start();
  room.context().endGame([]);
  const before = changes();
  room.showWords();
  assert.equal(room.resultsStep, "words");
  assert.equal(changes(), before + 1);
  await clock.advance(WORDS_STEP_MS * 2);
  assert.equal(changes(), before + 1);
  room.showWords();
  assert.equal(changes(), before + 1);
});

test("showWords outside results is ignored", () => {
  const { room, changes } = stepRoom();
  const c0 = changes();
  room.showWords();
  assert.equal(room.resultsStep, "awards");
  room.start();
  const c1 = changes();
  room.showWords();
  assert.equal(room.resultsStep, "awards");
  assert.equal(changes(), c1);
  assert.ok(c1 > c0);
});

test("End: no winners, the step still moves", async () => {
  const { room, clock } = stepRoom();
  room.start();
  room.endGame();
  assert.equal(room.phase, "results");
  assert.deepEqual(room.winners, []);
  await clock.advance(WORDS_STEP_MS);
  assert.equal(room.resultsStep, "words");
});

test("the step timer is cleared by Play again and by Start", async () => {
  const { room, clock, changes } = stepRoom();
  room.start();
  room.endGame();
  room.playAgain();
  assert.equal(room.resultsStep, "awards");
  assert.equal(clock.timers.size, 0);
  room.start();
  const c = changes();
  await clock.advance(WORDS_STEP_MS * 2);
  assert.equal(room.phase, "playing");
  assert.equal(room.resultsStep, "awards");
  assert.equal(changes(), c);
  // Start straight from results (no Play again) also clears it, and a second game gets its own step.
  room.endGame();
  room.showWords();
  assert.equal(room.resultsStep, "words");
  room.playAgain();
  room.start();
  room.endGame();
  assert.equal(room.resultsStep, "awards");
  room.close();
  assert.equal(clock.timers.size, 0);
  await clock.advance(WORDS_STEP_MS);
  assert.equal(room.resultsStep, "awards");
});
