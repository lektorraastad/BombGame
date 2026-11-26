import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../../src/engine/room.ts";
import type { PlayerId } from "../../src/engine/room.ts";
import { classicMode } from "../../src/engine/modes/classic.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import type { Prompt } from "../../src/engine/types.ts";
import { makeDeps, makeTestChecker, fixtureBlocked } from "./helpers.ts";

const ST: Prompt = { text: "st", type: "contains", count: 480, common: 0 };

const clockOf = new WeakMap<Room, { advance(ms: number): Promise<void> }>();
async function advance(room: Room) {
  await clockOf.get(room)!.advance(room.bombRemaining());
}

function setup(n = 3, settings: Record<string, unknown> = {}, seed = 11) {
  const { deps, clock } = makeDeps(seed);
  const room = new Room({
    code: "ABCD",
    deps,
    checker: makeTestChecker(),
    bank: createPromptBank([ST]),
    blockedNames: fixtureBlocked,
    modes: [classicMode],
  });
  const ids: PlayerId[] = [];
  for (let i = 0; i < n; i++) {
    const j = room.join("tok" + i, "Player" + i);
    assert.ok(j.ok);
    if (j.ok) ids.push(j.playerId);
  }
  room.updateSettings(settings);
  assert.deepEqual(room.start(), { ok: true });
  clockOf.set(room, clock);
  return { room, clock, ids };
}

const view = (room: Room) =>
  room.mode()!.view(room.context()) as { seats: PlayerId[]; current: PlayerId; timerStyle: string; bombEndsAt?: number };
const cur = (room: Room) => view(room).current;
const p = (room: Room, id: PlayerId) => room.players().find((x) => x.id === id)!;
const WORDS = ["station", "stone", "street", "strong", "story", "stand", "start", "stay", "still", "storm", "last", "best", "post", "first"];

test("classic declares its settings and room-wide word scope", () => {
  assert.equal(classicMode.id, "classic");
  assert.equal(classicMode.usedScope, "room");
  const { room } = setup(2);
  assert.equal(room.settings.timerStyle, "hidden");
  assert.equal(room.settings.fuseMin, 10);
  assert.equal(room.settings.fuseMax, 30);
  assert.equal(room.settings.minTurn, 8);
  assert.equal(room.settings.turnTime, 12);
  assert.equal(room.settings.silentAnswers, true);
});

test("turn order skips dead players", async () => {
  const { room, ids } = setup(4, { startLives: 1, timerStyle: "visible" });
  const seats = view(room).seats;
  assert.deepEqual([...seats].sort(), [...ids].sort());
  const i = seats.indexOf(cur(room));
  const at = (k: number) => seats[(i + k) % 4];
  await advance(room);
  assert.equal(p(room, at(0)).alive, false);
  const order: PlayerId[] = [cur(room)];
  for (const w of ["station", "stone", "street", "strong"]) {
    assert.deepEqual(room.submit(cur(room), w), { ok: true, kind: "turn" });
    order.push(cur(room));
  }
  assert.deepEqual(order, [at(1), at(2), at(3), at(1), at(2)]);
  assert.ok(!order.includes(at(0)), "dead seat is never current");
});

test("exploded player's next word is silent under the default setting", async () => {
  const { room } = setup(3);
  const first = cur(room);
  await advance(room);
  const now = cur(room);
  assert.notEqual(now, first);
  assert.deepEqual(room.submit(first, "station"), { ok: true, kind: "silent" });
  assert.equal(cur(room), now, "turn not passed");
  assert.equal(p(room, first).lives, 1, "only the one life from the explosion");
  assert.equal(p(room, first).score, 1);
  assert.deepEqual(room.submit(now, "station"), { ok: true, kind: "turn" }, "word not used up for the room");
});

test("hidden fuse is within min and max", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { room } = setup(2, {}, seed);
    const r = room.bombRemaining();
    assert.ok(r >= 10_000 && r <= 30_000, `seed ${seed}: ${r}`);
    assert.equal(room.bombVisible(), false);
  }
});

test("swapped fuseMin/fuseMax are put in order", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { room } = setup(2, { fuseMin: 40, fuseMax: 20 }, seed);
    const r = room.bombRemaining();
    assert.ok(r >= 20_000 && r <= 40_000, `seed ${seed}: ${r}`);
  }
});

test("valid word passes turn and tops up fuse to minTurn", async () => {
  const { room, clock } = setup(3);
  const first = cur(room);
  await clock.advance(room.bombRemaining() - 2_000);
  assert.equal(room.bombRemaining(), 2_000);
  assert.deepEqual(room.submit(first, "station"), { ok: true, kind: "turn" });
  assert.equal(room.bombRemaining(), 8_000);
  assert.notEqual(cur(room), first);
});

test("valid word with plenty of time keeps the remaining fuse", async () => {
  const { room, clock } = setup(3, { fuseMin: 20, fuseMax: 20 });
  await clock.advance(5_000);
  assert.equal(room.bombRemaining(), 15_000);
  room.submit(cur(room), "station");
  assert.equal(room.bombRemaining(), 15_000);
});

test("visible style resets to turnTime each turn", async () => {
  const { room, clock } = setup(3, { timerStyle: "visible" });
  assert.equal(room.bombRemaining(), 12_000);
  assert.equal(room.bombVisible(), true);
  await clock.advance(7_000);
  const first = cur(room);
  room.submit(first, "station");
  assert.equal(room.bombRemaining(), 12_000);
  assert.notEqual(cur(room), first);
  const v = view(room);
  assert.equal(v.timerStyle, "visible");
  assert.equal(v.bombEndsAt, clock.now() + 12_000);
});

test("hidden view has no bombEndsAt", () => {
  const { room } = setup(2);
  assert.equal("bombEndsAt" in view(room), false);
});

test("explosion costs current player a life and records examples", async () => {
  const { room } = setup(3);
  const first = cur(room);
  const prompt = room.prompt();
  await advance(room);
  assert.equal(p(room, first).lives, 1);
  assert.equal(p(room, first).alive, true);
  assert.ok(room.examples.length >= 1);
  assert.ok(room.examples.every((w) => room.checker.matches(prompt!, w)));
  assert.notEqual(cur(room), first);
  assert.ok(room.bombRemaining() >= 10_000);
  assert.equal(room.phase, "playing");
});

test("submission after explosion is rejected", async () => {
  const { room } = setup(3, { silentAnswers: false });
  const first = cur(room);
  await advance(room);
  assert.deepEqual(room.submit(first, "station"), { ok: false, reason: "not-your-turn" });
  assert.equal(p(room, first).lives, 1);
});

test("skip gives a new prompt to the same player without losing a life", async () => {
  const { room, clock } = setup(3, { timerStyle: "visible" });
  const first = cur(room);
  await clock.advance(8_000);
  room.skipPrompt();
  assert.equal(cur(room), first);
  assert.equal(room.bombRemaining(), 12_000);
  for (const pl of room.players()) assert.equal(pl.lives, 2);
});

test("skip in hidden style re-arms a fresh random fuse", () => {
  const { room } = setup(3);
  const first = cur(room);
  room.skipPrompt();
  assert.equal(cur(room), first);
  const r = room.bombRemaining();
  assert.ok(r >= 10_000 && r <= 30_000);
  for (const pl of room.players()) assert.equal(pl.lives, 2);
});

test("waiting player's word is silent: scored, private, not used", () => {
  const { room } = setup(3);
  const first = cur(room);
  const waiting = view(room).seats.find((s) => s !== first)!;
  assert.deepEqual(room.submit(waiting, "station"), { ok: true, kind: "silent" });
  assert.equal(p(room, waiting).score, 1);
  assert.equal(cur(room), first, "turn unchanged");
  assert.equal(p(room, waiting).bonusUsed.size, 0);
  // Not used up for the room: the current player may still play it.
  assert.deepEqual(room.submit(first, "station"), { ok: true, kind: "turn" });
});

test("silentAnswers off → waiting player's word rejected not-your-turn", () => {
  const { room } = setup(3, { silentAnswers: false });
  const waiting = view(room).seats.find((s) => s !== cur(room))!;
  assert.deepEqual(room.submit(waiting, "station"), { ok: false, reason: "not-your-turn" });
});

test("kicking the current player passes the turn", () => {
  const { room } = setup(3, { timerStyle: "visible" });
  const seats = view(room).seats;
  const first = cur(room);
  const next = seats[(seats.indexOf(first) + 1) % 3];
  room.kick(first);
  assert.equal(cur(room), next);
  assert.equal(room.bombRemaining(), 12_000);
  assert.equal(room.phase, "playing");
  assert.ok(room.prompt());
  for (const pl of room.players()) assert.equal(pl.lives, 2);
});

test("kicking the current player in hidden style arms a fresh random fuse", () => {
  const { room } = setup(3);
  room.kick(cur(room));
  const r = room.bombRemaining();
  assert.ok(r >= 10_000 && r <= 30_000);
});

test("kicking a waiting player keeps the turn; kicking down to one ends the game", () => {
  const { room } = setup(3);
  const first = cur(room);
  const others = view(room).seats.filter((s) => s !== first);
  room.kick(others[0]);
  assert.equal(cur(room), first);
  assert.equal(room.phase, "playing");
  room.kick(others[1]);
  assert.equal(room.phase, "results");
  assert.deepEqual(room.winners, [first]);
});

test("disconnected player's turn still runs", async () => {
  const { room } = setup(3);
  const first = cur(room);
  room.disconnect(first);
  assert.equal(cur(room), first);
  await advance(room);
  assert.equal(p(room, first).lives, 1);
  assert.notEqual(cur(room), first);
});

test("last player alive wins", async () => {
  const { room } = setup(2, { startLives: 1 });
  const first = cur(room);
  await advance(room);
  assert.equal(room.phase, "results");
  assert.equal(p(room, first).alive, false);
  const other = view(room).seats.find((s) => s !== first)!;
  assert.deepEqual(room.winners, [other]);
});

test("a revived player re-enters their original seat", async () => {
  const { room } = setup(3, { startLives: 1, timerStyle: "visible" });
  const seats = view(room).seats;
  const first = cur(room);
  await advance(room);
  assert.equal(p(room, first).alive, false);
  room.context().revive(first, 1);
  // Play round to the seat just before `first`; the turn must reach `first` again.
  const before = seats[(seats.indexOf(first) + 2) % 3];
  assert.equal(cur(room), seats[(seats.indexOf(first) + 1) % 3]);
  assert.deepEqual(room.submit(cur(room), WORDS[0]), { ok: true, kind: "turn" });
  assert.equal(cur(room), before);
  assert.deepEqual(room.submit(cur(room), WORDS[1]), { ok: true, kind: "turn" });
  assert.equal(cur(room), first);
});
