import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../../src/engine/room.ts";
import type { PlayerId } from "../../src/engine/room.ts";
import { everyoneMode } from "../../src/engine/modes/everyone.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import type { Prompt } from "../../src/engine/types.ts";
import { makeDeps, makeTestChecker, fixtureBlocked } from "./helpers.ts";

const ST: Prompt = { text: "st", type: "contains", count: 480 };
const RE: Prompt = { text: "re", type: "starts", count: 120 };

const clockOf = new WeakMap<Room, { advance(ms: number): Promise<void> }>();
async function advance(room: Room) {
  await clockOf.get(room)!.advance(room.bombRemaining());
}

function setup(n = 3, settings: Record<string, unknown> = {}, prompts: Prompt[] = [ST], seed = 5) {
  const { deps, clock } = makeDeps(seed);
  const room = new Room({
    code: "ABCD",
    deps,
    checker: makeTestChecker(),
    bank: createPromptBank(prompts),
    blockedNames: fixtureBlocked,
    modes: [everyoneMode],
  });
  const ids: PlayerId[] = [];
  for (let i = 0; i < n; i++) {
    const j = room.join("tok" + i, "Player" + i);
    assert.ok(j.ok);
    if (j.ok) ids.push(j.playerId);
  }
  room.updateSettings({ mode: "everyone", ...settings });
  assert.deepEqual(room.start(), { ok: true });
  clockOf.set(room, clock);
  return { room, clock, ids };
}

type V = { round: number; answered: PlayerId[]; bombEndsAt: number };
const view = (room: Room) => room.mode()!.view(room.context()) as V;
const p = (room: Room, id: PlayerId) => room.players().find((x) => x.id === id)!;

test("declares its settings and per-player word scope", () => {
  assert.equal(everyoneMode.id, "everyone");
  assert.equal(everyoneMode.usedScope, "player");
  const { room } = setup(2);
  assert.equal(room.settings.roundTime, 15);
  assert.equal(room.settings.shrinking, false);
});

test("everyone gets the same prompt and answering once marks answered", () => {
  const { room, ids } = setup(3);
  assert.equal(view(room).round, 1);
  assert.deepEqual(room.submit(ids[0], "station"), { ok: true, kind: "turn" });
  assert.deepEqual(view(room).answered, [ids[0]]);
  assert.deepEqual(room.submit(ids[0], "stone"), { ok: false, reason: "not-your-turn" });
  assert.deepEqual(room.submit(ids[1], "stone"), { ok: true, kind: "turn" });
  assert.deepEqual(view(room).answered, [ids[0], ids[1]]);
});

test("skip restarts the round with a new prompt and clears answered", async () => {
  const { room, ids } = setup(3, {}, [ST, RE, { text: "ou", type: "contains", count: 260 }]);
  const before = room.context().prompt()!.text;
  const lives = ids.map((id) => p(room, id).lives);
  const answer = { st: "station", re: "return", ou: "ouch" }[before]!;
  assert.deepEqual(room.submit(ids[0], answer), { ok: true, kind: "turn" });
  await clockOf.get(room)!.advance(5000);
  room.skipPrompt();
  assert.notEqual(room.context().prompt()!.text, before);
  assert.deepEqual(view(room).answered, []);
  assert.equal(view(room).round, 1);
  assert.equal(room.bombRemaining(), 15000);
  assert.deepEqual(ids.map((id) => p(room, id).lives), lives);
});

test("same word by two players is allowed; own reuse across rounds is rejected", async () => {
  const { room, ids } = setup(3);
  assert.deepEqual(room.submit(ids[0], "station"), { ok: true, kind: "turn" });
  assert.deepEqual(room.submit(ids[1], "station"), { ok: true, kind: "turn" });
  await advance(room);
  assert.equal(view(room).round, 2);
  assert.deepEqual(room.submit(ids[0], "station"), { ok: false, reason: "used" });
  assert.deepEqual(room.submit(ids[0], "stone"), { ok: true, kind: "turn" });
});

test("non-answerers lose a life at explosion", async () => {
  const { room, ids } = setup(3);
  room.submit(ids[0], "station");
  await advance(room);
  assert.equal(p(room, ids[0]).lives, 2);
  assert.equal(p(room, ids[1]).lives, 1);
  assert.equal(p(room, ids[2]).lives, 1);
  assert.equal(view(room).round, 2);
  assert.deepEqual(view(room).answered, []);
  assert.equal(room.bombRemaining(), 15000);
});

test("rounds end only at the bomb, even when everyone has answered", async () => {
  const { room, ids } = setup(2);
  room.submit(ids[0], "station");
  room.submit(ids[1], "stone");
  assert.equal(view(room).round, 1);
  assert.equal(room.bombRemaining(), 15000);
  await advance(room);
  assert.equal(view(room).round, 2);
  assert.equal(p(room, ids[0]).lives, 2);
});

test("shrinking rounds floor at 6s", async () => {
  const { room, ids } = setup(2, { shrinking: true, roundTime: 8 });
  const lengths: number[] = [];
  const words = ["station", "stone", "street", "strong"];
  for (let i = 0; i < 4; i++) {
    lengths.push(room.bombRemaining() / 1000);
    for (const id of ids) assert.ok(room.submit(id, words[i]).ok);
    await advance(room);
  }
  assert.deepEqual(lengths, [8, 7, 6, 6]);
});

test("one survivor wins", async () => {
  const { room, ids } = setup(3, { startLives: 1 });
  room.submit(ids[1], "station");
  await advance(room);
  assert.equal(room.phase, "results");
  assert.deepEqual(room.winners, [ids[1]]);
});

test("shared win when everyone dies in the same round", async () => {
  const { room, ids } = setup(3, { startLives: 1 });
  await advance(room);
  assert.equal(room.phase, "results");
  assert.deepEqual([...room.winners].sort(), [...ids].sort());
});

test("kick: round ends early without lives lost when all remaining have answered", () => {
  const { room, ids } = setup(3);
  room.submit(ids[0], "station");
  room.submit(ids[1], "stone");
  room.kick(ids[2]);
  assert.equal(view(room).round, 2);
  assert.deepEqual(view(room).answered, []);
  assert.equal(p(room, ids[0]).lives, 2);
  assert.equal(p(room, ids[1]).lives, 2);
});

test("kick: round carries on while someone alive has not answered; last one standing wins", () => {
  const { room, ids } = setup(3);
  room.submit(ids[0], "station");
  room.kick(ids[2]);
  assert.equal(view(room).round, 1);
  assert.deepEqual(view(room).answered, [ids[0]]);
  room.kick(ids[1]);
  assert.equal(room.phase, "results");
  assert.deepEqual(room.winners, [ids[0]]);
});

test("view never contains words", () => {
  const { room, ids } = setup(3);
  room.submit(ids[0], "station");
  const json = JSON.stringify(view(room));
  assert.ok(!json.includes("station"));
  assert.deepEqual(Object.keys(view(room)).sort(), ["answered", "bombEndsAt", "round"]);
});

// ---- review round 1 ----

test("kicking a ghost while all alive players have answered does not end the round", async () => {
  const { room, ids } = setup(4, { startLives: 1 });
  room.submit(ids[0], "station");
  room.submit(ids[1], "stone");
  room.submit(ids[2], "street");
  await advance(room); // ids[3] dies in round 1
  assert.equal(p(room, ids[3]).alive, false);
  assert.equal(view(room).round, 2);
  for (const [i, w] of [[0, "strong"], [1, "story"], [2, "stand"]] as const) room.submit(ids[i], w);
  room.kick(ids[3]);
  assert.equal(view(room).round, 2);
  assert.deepEqual(view(room).answered, [ids[0], ids[1], ids[2]]);
  assert.ok(room.bombRemaining() > 0 && room.phase === "playing");
});

test("kicking an already-answered player while another has not answered does not end the round", () => {
  const { room, ids } = setup(3);
  room.submit(ids[0], "station");
  room.kick(ids[0]);
  assert.equal(view(room).round, 1);
  assert.deepEqual(view(room).answered, []);
  assert.equal(p(room, ids[1]).lives, 2);
  assert.equal(room.phase, "playing");
});

test("shared win excludes a player who died in an earlier round", async () => {
  const { room, ids } = setup(3, { startLives: 1 });
  room.submit(ids[0], "station");
  room.submit(ids[1], "stone");
  await advance(room); // ids[2] dies
  assert.equal(room.phase, "playing");
  await advance(room); // ids[0] and ids[1] die together
  assert.equal(room.phase, "results");
  assert.deepEqual([...room.winners].sort(), [ids[0], ids[1]].sort());
});

test("a starter kicked mid-round is not among the shared winners", async () => {
  const { room, ids } = setup(3, { startLives: 1 });
  room.kick(ids[2]);
  await advance(room);
  assert.equal(room.phase, "results");
  assert.deepEqual([...room.winners].sort(), [ids[0], ids[1]].sort());
});

test("a player revived mid-round joins from the next round", async () => {
  const { room, ids } = setup(4, { startLives: 1 });
  room.submit(ids[0], "station");
  room.submit(ids[1], "stone");
  await advance(room); // ids[2], ids[3] die
  assert.equal(p(room, ids[2]).alive, false);
  room.context().revive(ids[2], 1);
  assert.equal(p(room, ids[2]).alive, true);
  assert.deepEqual(room.submit(ids[2], "street"), { ok: false, reason: "not-your-turn" });
  room.submit(ids[0], "street");
  room.submit(ids[1], "strong");
  await advance(room);
  assert.equal(p(room, ids[2]).alive, true, "no life lost at the round they came back in");
  assert.equal(view(room).round, 3);
  assert.deepEqual(room.submit(ids[2], "street"), { ok: true, kind: "turn" });
});

test("examples belong to the exploded prompt", async () => {
  const { room } = setup(3, { exampleAnswers: true }, [ST, RE]);
  const exploded = room.context().prompt()!;
  await advance(room);
  assert.ok(room.examples.length >= 1);
  assert.ok(room.examples.every((w) => room.checker.matches(exploded, w)));
});

test("skip in round 3 with shrinking re-arms that round's length", async () => {
  const { room, ids } = setup(2, { shrinking: true, roundTime: 10 });
  const words = ["station", "stone"];
  for (let i = 0; i < 2; i++) {
    for (const id of ids) room.submit(id, words[i]);
    await advance(room);
  }
  assert.equal(view(room).round, 3);
  assert.equal(room.bombRemaining(), 8000);
  await clockOf.get(room)!.advance(3000);
  room.skipPrompt();
  assert.equal(view(room).round, 3);
  assert.equal(room.bombRemaining(), 8000);
});

test("kicking an answered player after everyone answered does not end the round", () => {
  const { room, ids } = setup(3);
  room.submit(ids[0], "station");
  room.submit(ids[1], "stone");
  room.submit(ids[2], "street");
  room.kick(ids[0]);
  assert.equal(view(room).round, 1);
  assert.deepEqual(view(room).answered, [ids[1], ids[2]]);
  assert.equal(room.phase, "playing");
});
