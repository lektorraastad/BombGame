import { test } from "node:test";
import assert from "node:assert/strict";
import { createMotion, POP_MS } from "../../public/app/motion.js";
import { seatPosition, seatedPlayers, arrowAngle } from "../../public/app/circle-geometry.js";
import { ARROW_SWING_MS, EXPLOSION_MS } from "../../public/app/bomb.js";

const player = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, nickname: id.toUpperCase(), lives: 3, alive: true, connected: true, spectator: false, ...over });
const PLAYERS = ["a", "b", "c", "d"].map((id) => player(id));

/** A Classic view with four seats, a at 0°, b at 90°, c at 180°, d at 270°. */
function classicView(current: string | null, over: Record<string, unknown> = {}): any {
  return {
    phase: "playing", paused: false, players: PLAYERS, prompt: { text: "st", type: "contains" },
    mode: { seats: ["a", "b", "c", "d"], current, lastWord: null }, lastEvent: null, ...over,
  };
}
function everyoneView(over: Record<string, unknown> = {}): any {
  return {
    phase: "playing", paused: false, players: PLAYERS, prompt: { text: "st", type: "contains" },
    mode: { round: 1, answered: [] }, lastEvent: null, bombRemainingMs: 15_000, ...over,
  };
}

/** A motion tracker on a clock the test moves by hand. */
function tracker() {
  const clock = { t: 1_000 };
  return { clock, m: createMotion(() => clock.t) };
}

// ---- circle geometry ----

test("seats start straight up and go clockwise on one ring up to 20", () => {
  assert.deepEqual(seatPosition(0, 4), { left: 50, top: 10, angle: 0, ring: 0 });
  const right = seatPosition(1, 4);
  assert.equal(right.angle, 90);
  assert.ok(Math.abs(right.left - 92) < 1e-9 && Math.abs(right.top - 50) < 1e-9);
  const bottom = seatPosition(2, 4);
  assert.ok(Math.abs(bottom.left - 50) < 1e-9 && Math.abs(bottom.top - 90) < 1e-9);
  for (let i = 0; i < 20; i++) assert.equal(seatPosition(i, 20).ring, 0);
});

test("more than 20 seats alternate between the outer and the inner ring", () => {
  const outer = seatPosition(0, 21);
  const inner = seatPosition(1, 21);
  assert.deepEqual([outer.ring, inner.ring], [0, 1]);
  assert.equal(outer.top, 10);
  const down = seatPosition(16, 32); // 180°: straight down, outer ring
  assert.equal(down.ring, 0);
  assert.ok(Math.abs(down.top - 90) < 1e-9);
  const innerDown = seatPosition(15, 30); // 180°, inner ring: 28 % below the middle
  assert.equal(innerDown.ring, 1);
  assert.ok(Math.abs(innerDown.top - 78) < 1e-9);
  const innerRight = seatPosition(7, 28); // 90°, inner ring: 30 % right of the middle
  assert.ok(Math.abs(innerRight.left - 80) < 1e-9);
});

test("seatedPlayers: Classic seats in seat order, otherwise players without spectators", () => {
  const players = [player("a"), player("b"), player("s", { spectator: true }), player("c")];
  const classic = { players, mode: { seats: ["c", "a", "gone"], current: "a" } };
  assert.deepEqual(seatedPlayers(classic).map((p: any) => p.id), ["c", "a"]);
  const everyone = { players, mode: { round: 2, answered: [] } };
  assert.deepEqual(seatedPlayers(everyone).map((p: any) => p.id), ["a", "b", "c"]);
  assert.deepEqual(seatedPlayers({ players, mode: null }).map((p: any) => p.id), ["a", "b", "c"]);
});

test("arrowAngle points at the current seat", () => {
  assert.equal(arrowAngle(classicView("b")), 90);
  assert.equal(arrowAngle(classicView("a")), 0);
  assert.equal(arrowAngle(classicView("d")), 270);
  assert.equal(arrowAngle(classicView(null)), null);
  assert.equal(arrowAngle(classicView("nobody")), null);
  assert.equal(arrowAngle(everyoneView()), null);
  assert.equal(arrowAngle({ players: PLAYERS, mode: null }), null);
});

// ---- the motion tracker ----

test("first view never swings the arrow or explodes", () => {
  const { m } = tracker();
  m.view(classicView("b", { lastEvent: "explosion" }));
  const s = m.bombState(null, true);
  assert.ok(s.arrow);
  assert.equal(s.arrow.from, s.arrow.to);
  assert.equal(s.arrow.to, 90);
  assert.ok(s.arrow.elapsedMs >= ARROW_SWING_MS, "drawn still");
  assert.equal(s.explosion, null);
  assert.equal(m.busy(), false);
});

test("a turn change swings from the old angle to the new", () => {
  const { clock, m } = tracker();
  m.view(classicView("a"));
  clock.t += 5_000;
  m.view(classicView("b"));
  let s = m.bombState(null, true);
  assert.deepEqual(s.arrow, { from: 0, to: 90, elapsedMs: 0 });
  assert.equal(m.busy(), true);
  clock.t += 250;
  s = m.bombState(null, true);
  assert.deepEqual(s.arrow, { from: 0, to: 90, elapsedMs: 250 });
  // A view that doesn't change the turn doesn't restart the swing.
  m.view(classicView("b", { typing: "sta" }));
  assert.equal(m.bombState(null, true).arrow!.elapsedMs, 250);
});

test("the arrow takes the short way round, so to stays the seat's angle", () => {
  const { m } = tracker();
  m.view(classicView("d")); // 270°
  m.view(classicView("a")); // 0°: a quarter turn clockwise, not three quarters back
  const s = m.bombState(null, true);
  assert.equal(s.arrow!.to, 0);
  assert.equal(s.arrow!.from, -90);
});

test("no arrow without a current player, and none after a gap", () => {
  const { m } = tracker();
  m.view(classicView("a"));
  m.view(everyoneView());
  assert.equal(m.bombState(15_000, true).arrow, null);
  // Back to Classic after Everyone: no old angle to swing from.
  m.view(classicView("c"));
  const s = m.bombState(null, true);
  assert.equal(s.arrow!.from, s.arrow!.to);
  assert.equal(m.busy(), false);
});

test("an explosion is reported for EXPLOSION_MS, then null", () => {
  const { clock, m } = tracker();
  m.view(classicView("a"));
  clock.t += 3_000;
  m.view(classicView("a", { lastEvent: "explosion" }));
  assert.deepEqual(m.bombState(null, true).explosion, { elapsedMs: 0 });
  clock.t += EXPLOSION_MS - 1;
  assert.deepEqual(m.bombState(null, true).explosion, { elapsedMs: EXPLOSION_MS - 1 });
  // A later view without the event doesn't cut it short or restart it.
  m.view(classicView("a"));
  assert.deepEqual(m.bombState(null, true).explosion, { elapsedMs: EXPLOSION_MS - 1 });
  clock.t += 1;
  assert.equal(m.bombState(null, true).explosion, null);
  // "word" is not an explosion.
  m.view(classicView("a", { lastEvent: "word" }));
  assert.equal(m.bombState(null, true).explosion, null);
});

test("busy() is false once every animation has finished", () => {
  const { clock, m } = tracker();
  m.view(classicView("a"));
  assert.equal(m.busy(), false);
  m.view(classicView("b", { lastEvent: "explosion" }));
  assert.equal(m.busy(), true);
  clock.t += ARROW_SWING_MS;
  assert.equal(m.busy(), true, "the explosion still runs");
  clock.t += EXPLOSION_MS - ARROW_SWING_MS;
  assert.equal(m.busy(), false);
  assert.equal(m.bombState(null, true).arrow!.elapsedMs >= ARROW_SWING_MS, true);
});

test("players joining after the first view pop; earlier ones don't", () => {
  const { clock, m } = tracker();
  const lobby = (ids: string[]) => ({ phase: "lobby", paused: false, players: ids.map((id) => player(id)), prompt: null, mode: null, lastEvent: null });
  m.view(lobby(["a", "b"]));
  assert.equal(m.popElapsed("a"), null);
  assert.equal(m.popElapsed("b"), null);
  assert.equal(m.busy(), false);
  clock.t += 1_000;
  m.view(lobby(["a", "b", "c"]));
  assert.equal(m.popElapsed("c"), 0);
  assert.equal(m.popElapsed("a"), null);
  assert.equal(m.busy(), true);
  clock.t += 100;
  m.view(lobby(["a", "b", "c"]));
  assert.equal(m.popElapsed("c"), 100, "seen again: still the first time");
  clock.t += POP_MS;
  assert.equal(m.popElapsed("c"), null);
  assert.equal(m.busy(), false);
  assert.equal(m.popElapsed("never-seen"), null);
});

test("the fuse burns over the time first seen for a prompt", () => {
  const { clock, m } = tracker();
  m.view(everyoneView({ bombRemainingMs: 15_000 }));
  assert.deepEqual(m.bombState(15_000, true).fuse, { totalMs: 15_000, elapsedMs: 0 });
  clock.t += 4_000;
  // Someone answered: same prompt and round, less time left. The total stays.
  m.view(everyoneView({ bombRemainingMs: 11_000, lastEvent: "word" }));
  assert.deepEqual(m.bombState(10_500, true).fuse, { totalMs: 15_000, elapsedMs: 4_500 });
  // The next round, even with the same letters, starts a new fuse.
  m.view(everyoneView({ bombRemainingMs: 12_000, mode: { round: 2, answered: [] } }));
  assert.deepEqual(m.bombState(12_000, true).fuse, { totalMs: 12_000, elapsedMs: 0 });
  // A new prompt too.
  m.view(everyoneView({ bombRemainingMs: 9_000, prompt: { text: "an", type: "ends" }, mode: { round: 2, answered: [] } }));
  assert.deepEqual(m.bombState(9_000, true).fuse, { totalMs: 9_000, elapsedMs: 0 });
  // No visible timer: no fuse.
  assert.equal(m.bombState(null, true).fuse, null);
});

test("bombState passes the countdown and lit through", () => {
  const { m } = tracker();
  m.view(classicView("a", { bombRemainingMs: 8_000 }));
  const s = m.bombState(7_500, false);
  assert.equal(s.lit, false);
  assert.equal(s.countdownMs, 7_500);
  assert.equal(m.bombState(null, true).countdownMs, null);
});

test("bombState before any view is a still, unlit-safe bomb", () => {
  const { m } = tracker();
  assert.deepEqual(m.bombState(null, false), { lit: false, arrow: null, countdownMs: null, fuse: null, explosion: null });
  assert.equal(m.busy(), false);
});
