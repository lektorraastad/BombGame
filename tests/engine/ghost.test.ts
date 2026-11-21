import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../../src/engine/room.ts";
import type { PlayerId } from "../../src/engine/room.ts";
import { classicMode } from "../../src/engine/modes/classic.ts";
import { everyoneMode } from "../../src/engine/modes/everyone.ts";
import { ghostActivity } from "../../src/engine/knockout/ghost.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import type { Prompt } from "../../src/engine/types.ts";
import { makeDeps, makeTestChecker, fixtureBlocked } from "./helpers.ts";

const ST: Prompt = { text: "st", type: "contains", count: 480 };
const WORDS = ["station", "stone", "street", "strong", "story", "stand", "start", "stay", "still", "storm", "last", "best", "post", "first", "most", "fast", "west", "just", "rest", "list"];

const clockOf = new WeakMap<Room, { advance(ms: number): Promise<void> }>();

function setup(modeName: "classic" | "everyone", n: number, settings: Record<string, unknown> = {}) {
  const { deps, clock } = makeDeps(11);
  const room = new Room({
    code: "ABCD",
    deps,
    checker: makeTestChecker(),
    bank: createPromptBank([ST]),
    blockedNames: fixtureBlocked,
    modes: [modeName === "classic" ? classicMode : everyoneMode],
    activities: [ghostActivity],
  });
  const ids: PlayerId[] = [];
  for (let i = 0; i < n; i++) {
    const j = room.join("tok" + i, "Player" + i);
    assert.ok(j.ok);
    if (j.ok) ids.push(j.playerId);
  }
  room.updateSettings({ mode: modeName, startLives: 1, timerStyle: "visible", ...settings });
  assert.deepEqual(room.start(), { ok: true });
  clockOf.set(room, clock);
  return { room, ids };
}

const p = (room: Room, id: PlayerId) => room.players().find((x) => x.id === id)!;
const cur = (room: Room) => (room.mode()!.view(room.context()) as { current: PlayerId }).current;
const ghostView = (room: Room, pid: PlayerId) => room.activity()!.view(room.context(), pid);

/** Classic: knocks out a player who is not on turn. */
function knockOut(room: Room, ids: PlayerId[], count = 1): PlayerId[] {
  const out = ids.filter((id) => id !== cur(room)).slice(0, count);
  for (const id of out) room.context().loseLife(id);
  return out;
}

/** Classic: the current player plays a fresh valid word, which deals the next prompt. */
function turn(room: Room, counter: { i: number }) {
  assert.deepEqual(room.submit(cur(room), WORDS[counter.i++]), { ok: true, kind: "turn" });
}

test("ghost activity declares comeback settings", () => {
  assert.equal(ghostActivity.id, "ghost");
  const { room } = setup("classic", 4);
  assert.equal(room.settings.comeback, true);
  assert.equal(room.settings.comebackStreak, 3);
  assert.equal(setup("classic", 4, { comebackStreak: 5 }).room.settings.comebackStreak, 5);
});

test("ghost words score privately and do not use room words", () => {
  const { room, ids } = setup("classic", 4);
  const [g] = knockOut(room, ids);
  assert.deepEqual(room.submit(g, "station"), { ok: true, kind: "ghost" });
  assert.equal(p(room, g).ghostPoints, 1);
  assert.deepEqual(room.submit(g, "station"), { ok: false, reason: "used" });
  assert.equal(p(room, g).ghostPoints, 1);
  assert.deepEqual(room.submit(cur(room), "station"), { ok: true, kind: "turn" });
  assert.equal(p(room, g).score, 0);
});

test("three consecutive prompts bring a ghost back once", () => {
  const { room, ids } = setup("classic", 5);
  const [g] = knockOut(room, ids);
  const c = { i: 0 };
  assert.deepEqual(room.submit(g, "station"), { ok: true, kind: "ghost" });
  turn(room, c);
  assert.deepEqual(room.submit(g, "stone"), { ok: true, kind: "ghost" });
  assert.equal(p(room, g).alive, false);
  assert.equal(p(room, g).ghostStreak, 2);
  turn(room, c);
  assert.deepEqual(ghostView(room, g), { ghostPoints: 2, streak: 2, comebackAvailable: true });
  assert.deepEqual(room.submit(g, "street"), { ok: true, kind: "ghost" });
  const back = p(room, g);
  assert.equal(back.alive, true);
  assert.equal(back.lives, 1);
  assert.equal(back.comebackUsed, true);
  assert.equal(back.ghostStreak, 0);
  assert.equal(back.ghostPoints, 3);
  assert.deepEqual(ghostView(room, g), { ghostPoints: 3, streak: 0, comebackAvailable: false });

  // Knocked out again: a second streak of 3 does not bring them back.
  room.context().loseLife(g);
  assert.equal(p(room, g).alive, false);
  for (const w of ["strong", "story", "stand"]) {
    turn(room, c);
    assert.deepEqual(room.submit(g, w), { ok: true, kind: "ghost" });
  }
  assert.equal(p(room, g).alive, false);
  assert.equal(p(room, g).ghostPoints, 6);
});

test("missing a prompt resets the streak", () => {
  const { room, ids } = setup("classic", 5);
  const [g] = knockOut(room, ids);
  const c = { i: 0 };
  room.submit(g, "station"); // prompt 1
  turn(room, c);
  room.submit(g, "stone"); // prompt 2
  assert.equal(p(room, g).ghostStreak, 2);
  turn(room, c); // prompt 3 dealt, g answered prompt 2: streak kept
  assert.equal(p(room, g).ghostStreak, 2);
  turn(room, c); // prompt 4 dealt, g missed prompt 3: reset
  assert.equal(p(room, g).ghostStreak, 0);
  room.submit(g, "street"); // prompt 4
  assert.equal(p(room, g).ghostStreak, 1);
  turn(room, c);
  room.submit(g, "strong"); // prompt 5
  assert.equal(p(room, g).ghostStreak, 2);
  assert.equal(p(room, g).alive, false);
});

test("several words on one prompt count one streak step", () => {
  const { room, ids } = setup("classic", 5);
  const [g] = knockOut(room, ids);
  for (const w of ["station", "stone", "street", "strong"]) {
    assert.deepEqual(room.submit(g, w), { ok: true, kind: "ghost" });
  }
  assert.equal(p(room, g).ghostPoints, 4);
  assert.equal(p(room, g).ghostStreak, 1);
  assert.equal(p(room, g).alive, false);
});

test("no comeback when only 2 players alive", () => {
  const { room, ids } = setup("classic", 4);
  const [g] = knockOut(room, ids, 2);
  assert.equal(room.context().alive().length, 2);
  const c = { i: 0 };
  for (const w of ["station", "stone", "street", "strong"]) {
    assert.deepEqual(room.submit(g, w), { ok: true, kind: "ghost" });
    turn(room, c);
  }
  assert.equal(p(room, g).alive, false);
  assert.equal(p(room, g).comebackUsed, false);
  assert.equal((ghostView(room, g) as { comebackAvailable: boolean }).comebackAvailable, false);
});

test("comeback off: never returns", () => {
  const { room, ids } = setup("classic", 5, { comeback: false });
  const [g] = knockOut(room, ids);
  const c = { i: 0 };
  for (const w of ["station", "stone", "street", "strong", "story"]) {
    assert.deepEqual(room.submit(g, w), { ok: true, kind: "ghost" });
    turn(room, c);
  }
  assert.equal(p(room, g).alive, false);
  assert.equal(p(room, g).ghostPoints, 5);
  assert.equal((ghostView(room, g) as { comebackAvailable: boolean }).comebackAvailable, false);
});

test("a returning ghost re-enters their original seat in classic", () => {
  const { room, ids } = setup("classic", 5);
  const seats = (room.mode()!.view(room.context()) as { seats: PlayerId[] }).seats;
  const [g] = knockOut(room, ids);
  const c = { i: 0 };
  for (const w of ["station", "stone", "street"]) {
    room.submit(g, w);
    if (w !== "street") turn(room, c);
  }
  assert.equal(p(room, g).alive, true);
  // Play round the table: the turn reaches g again.
  const seen: PlayerId[] = [];
  for (let k = 0; k < 5; k++) {
    seen.push(cur(room));
    turn(room, c);
  }
  const start = seats.indexOf(seen[0]);
  assert.deepEqual(seen, seats.map((_, k) => seats[(start + k) % 5]), "full cycle in seat order, g included");
});

test("works in everyone mode across rounds", async () => {
  const { room, ids } = setup("everyone", 4);
  const g = ids[3];
  room.context().loseLife(g);
  assert.equal(p(room, g).alive, false);
  const words = ["station", "stone", "street"];
  for (let round = 0; round < 3; round++) {
    assert.deepEqual(room.submit(g, words[round]), { ok: true, kind: "ghost" });
    for (const id of ids.slice(0, 3)) assert.deepEqual(room.submit(id, words[round]), { ok: true, kind: "turn" });
    if (round < 2) {
      assert.equal(p(room, g).alive, false);
      await clockOf.get(room)!.advance(room.bombRemaining());
    }
  }
  assert.equal(p(room, g).alive, true);
  assert.equal(p(room, g).lives, 1);
  assert.equal(p(room, g).comebackUsed, true);
  assert.equal(p(room, g).ghostPoints, 3);
  // Revived mid-round: joins from the next round.
  assert.deepEqual(room.submit(g, "stand"), { ok: false, reason: "not-your-turn" });
  await clockOf.get(room)!.advance(room.bombRemaining());
  assert.deepEqual(room.submit(g, "stand"), { ok: true, kind: "turn" });
});
