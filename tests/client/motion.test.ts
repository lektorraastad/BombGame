import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMotion, POP_MS, WORD_MS, REFUSED_MS, HEART_MS, WIN_MS, RESULTS_HOLD_MS, EXAMPLES_MS, TENSION_FULL_MS,
  SPARK_MS, SPARK_GAP_MS,
} from "../../public/app/motion.js";
import { seatPosition, seatedPlayers, arrowAngle, screenAngle } from "../../public/app/circle-geometry.js";
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
  assert.deepEqual(seatPosition(0, 4), { left: 50, top: 7, angle: 0, ring: 0 });
  const right = seatPosition(1, 4);
  assert.equal(right.angle, 90);
  assert.ok(Math.abs(right.left - 92) < 1e-9 && Math.abs(right.top - 50) < 1e-9);
  const bottom = seatPosition(2, 4);
  assert.ok(Math.abs(bottom.left - 50) < 1e-9 && Math.abs(bottom.top - 93) < 1e-9);
  for (let i = 0; i < 20; i++) assert.equal(seatPosition(i, 20).ring, 0);
});

test("more than 20 seats alternate between the outer and the inner ring", () => {
  const outer = seatPosition(0, 21);
  const inner = seatPosition(1, 21);
  assert.deepEqual([outer.ring, inner.ring], [0, 1]);
  assert.equal(outer.top, 7);
  const down = seatPosition(16, 32); // 180°: straight down, outer ring
  assert.equal(down.ring, 0);
  assert.ok(Math.abs(down.top - 93) < 1e-9);
  const innerDown = seatPosition(15, 30); // 180°, inner ring: 29 % below the middle
  assert.equal(innerDown.ring, 1);
  assert.ok(Math.abs(innerDown.top - 79) < 1e-9);
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

/** The on-screen direction (0° up, clockwise) from the middle of a box with this width/height to a seat. */
function seen(i: number, n: number, aspect: number) {
  const s = seatPosition(i, n);
  const deg = (Math.atan2((s.left - 50) * aspect, -(s.top - 50)) * 180) / Math.PI;
  return (deg + 360) % 360;
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs((((a - b) % 360) + 540) % 360 - 180) < eps;

test("screenAngle: on a 16:9 oval the arrow points where the seat really is", () => {
  // A seat at 45° round the ring sits further out sideways on a wide oval: about 60.1° on screen.
  const a = screenAngle(45, 16 / 9);
  assert.ok(Math.abs(a - (Math.atan2(42 * (16 / 9) * Math.SQRT1_2, 43 * Math.SQRT1_2) * 180) / Math.PI) < 1e-9, String(a));
  assert.ok(Math.abs(a - 60.06) < 0.01, String(a));
  // Every seat, either ring, on screens of different shapes.
  for (const aspect of [1, 4 / 3, 16 / 9, 2.1]) {
    for (const n of [3, 8, 16, 30, 32]) {
      for (let i = 0; i < n; i++) {
        const s = seatPosition(i, n);
        assert.ok(near(screenAngle(s.angle, aspect, s.ring), seen(i, n, aspect)), `${aspect} ${i}/${n}`);
      }
    }
  }
});

test("screenAngle: straight up, right, down and left don't move; it stays near the angle it was given", () => {
  for (const d of [0, 90, 180, 270, 360, -90]) assert.ok(Math.abs(screenAngle(d, 16 / 9) - d) < 1e-9, String(d));
  // Angles past a full turn (a swing the short way round) keep their turn, so the swing still goes the short way.
  assert.ok(Math.abs(screenAngle(405, 16 / 9) - (screenAngle(45, 16 / 9) + 360)) < 1e-9);
  assert.ok(Math.abs(screenAngle(-45, 16 / 9) + screenAngle(45, 16 / 9)) < 1e-9);
  // Junk aspect: treated as a square box.
  for (const bad of [0, -2, Number.NaN, Infinity]) assert.equal(screenAngle(45, bad), screenAngle(45, 1));
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
  assert.deepEqual(m.bombState(null, false), { lit: false, arrow: null, countdownMs: null, fuse: null, explosion: null, tension: null });
  assert.equal(m.busy(), false);
});

// ---- moments ----

const WORD = { word: "stone", prompt: { text: "st", type: "contains" } };
/** The players, with b's last word set. */
const withWord = (pid = "b") => PLAYERS.map((p) => (p.id === pid ? { ...p, lastWord: WORD } : p));
const ALL_MOMENTS = [
  { kind: "word", pid: "b" }, { kind: "hearts", pids: ["a"] }, { kind: "explosion" },
  { kind: "refused", pid: "c" }, { kind: "all-answered" }, { kind: "win", pids: ["b"] },
];

test("word moment runs for WORD_MS with the last word and prompt", () => {
  const { clock, m } = tracker();
  m.view(classicView("b", { moments: [] }));
  assert.equal(m.word(), null);
  clock.t += 2_000;
  m.view(classicView("c", { players: withWord("b"), mode: { seats: ["a", "b", "c", "d"], current: "c", lastWord: "stone" }, moments: [{ kind: "word", pid: "b" }] }));
  assert.deepEqual(m.word(), { pid: "b", word: "stone", prompt: { text: "st", type: "contains" }, fromSpotlight: false, elapsedMs: 0 });
  assert.equal(m.busy(), true);
  clock.t += WORD_MS - 1;
  assert.equal(m.word()!.elapsedMs, WORD_MS - 1);
  // A later view without the moment doesn't cut it short.
  m.view(classicView("c", { players: withWord("b"), moments: [] }));
  assert.equal(m.word()!.elapsedMs, WORD_MS - 1);
  clock.t += 1;
  assert.equal(m.word(), null);
  assert.equal(m.busy(), false);
  // A word moment for a player without a last word starts nothing.
  m.view(classicView("a", { moments: [{ kind: "word", pid: "d" }] }));
  assert.equal(m.word(), null);
});

test("fromSpotlight only when the player was typing", () => {
  const { m } = tracker();
  m.view(classicView("b", { typing: "ston" }));
  m.view(classicView("c", { players: withWord("b"), moments: [{ kind: "word", pid: "b" }] }));
  assert.equal(m.word()!.fromSpotlight, true);
  // c's typing was shown, but b answered: not from the spotlight.
  m.view(classicView("c", { typing: "s" }));
  m.view(classicView("d", { players: withWord("b"), moments: [{ kind: "word", pid: "b" }] }));
  assert.equal(m.word()!.fromSpotlight, false);
  // No typing before (live typing off).
  m.view(classicView("b"));
  m.view(classicView("c", { players: withWord("b"), moments: [{ kind: "word", pid: "b" }] }));
  assert.equal(m.word()!.fromSpotlight, false);
});

test("refused, hearts and win time from arrival and end", () => {
  const { clock, m } = tracker();
  m.view(classicView("c"));
  clock.t += 1_000;
  m.view(classicView("c", { moments: [{ kind: "refused", pid: "c" }] }));
  assert.deepEqual(m.refused(), { pid: "c", elapsedMs: 0 });
  clock.t += REFUSED_MS - 1;
  assert.deepEqual(m.refused(), { pid: "c", elapsedMs: REFUSED_MS - 1 });
  assert.equal(m.busy(), true);
  clock.t += 1;
  assert.equal(m.refused(), null);

  m.view(classicView("d", { moments: [{ kind: "hearts", pids: ["c", "a"] }] }));
  assert.deepEqual([...m.hearts()], [["c", 0], ["a", 0]]);
  clock.t += 500;
  m.view(classicView("a", { moments: [{ kind: "hearts", pids: ["d"] }] }));
  assert.deepEqual([...m.hearts()].sort(), [["a", 500], ["c", 500], ["d", 0]]);
  clock.t += HEART_MS - 500;
  assert.deepEqual([...m.hearts()], [["d", HEART_MS - 500]]);
  clock.t += 500;
  assert.equal(m.hearts().size, 0);
  assert.equal(m.busy(), false);

  // A win without an explosion (the host ended it, or a shared win): no hold, it starts at once.
  m.view({ ...classicView(null), phase: "results", moments: [{ kind: "win", pids: ["a", "b"] }] });
  assert.deepEqual(m.win(), { pids: ["a", "b"], elapsedMs: 0 });
  clock.t += WIN_MS - 1;
  assert.deepEqual(m.win(), { pids: ["a", "b"], elapsedMs: WIN_MS - 1 });
  assert.equal(m.busy(), true);
  clock.t += 1;
  assert.equal(m.win(), null);
  assert.equal(m.busy(), false);
});

test("the first view never starts a moment", () => {
  const { m } = tracker();
  m.view(classicView("b", { phase: "results", players: withWord("b"), examples: ["stone"], moments: ALL_MOMENTS }));
  assert.equal(m.word(), null);
  assert.equal(m.refused(), null);
  assert.equal(m.hearts().size, 0);
  assert.equal(m.win(), null);
  assert.equal(m.examplesShown(classicView("b", { examples: ["stone"] })), false);
  const v = { ...classicView("b"), phase: "results", moments: ALL_MOMENTS };
  assert.equal(m.heldView(v), v);
  assert.equal(m.popElapsed("b"), null);
  assert.equal(m.busy(), false);
});

test("results are held for 1.5 s after a final explosion", () => {
  const { clock, m } = tracker();
  const playing = classicView("b", { bombRemainingMs: 3_000, typing: "sto" });
  m.view(playing);
  clock.t += 1_000;
  const losers = PLAYERS.map((p) => (p.id === "b" ? { ...p, lives: 0, alive: false } : p));
  const results = {
    ...classicView(null), phase: "results", players: losers, examples: ["stone"], lastEvent: "explosion",
    results: { winners: ["a"] }, moments: [{ kind: "hearts", pids: ["b"] }, { kind: "explosion" }, { kind: "win", pids: ["a"] }],
  };
  m.view(results);
  const held = m.heldView(results);
  const { typing: _t, bombRemainingMs: _b, ...still } = playing;
  assert.deepEqual(held, { ...still, players: losers, examples: ["stone"], phase: "playing", paused: false, moments: [] });
  assert.equal(held.me, undefined, "no player view here, so no me is invented");
  assert.equal(m.win(), null, "the win waits for the results");
  assert.equal(m.busy(), true);
  clock.t += RESULTS_HOLD_MS - 1;
  assert.equal(m.heldView(results).phase, "playing");
  assert.equal(m.win(), null);
  clock.t += 1;
  assert.equal(m.heldView(results), results);
  assert.deepEqual(m.win(), { pids: ["a"], elapsedMs: 0 });
  clock.t += WIN_MS;
  assert.equal(m.win(), null);
  // Another view (a new lobby) is never held.
  const lobby = { phase: "lobby", paused: false, players: PLAYERS, prompt: null, mode: null, lastEvent: null, moments: [] };
  m.view(lobby);
  assert.equal(m.heldView(lobby), lobby);
});

test("results from a paused game are held too, drawn unpaused", () => {
  const { m } = tracker();
  m.view(classicView("b", { paused: true }));
  const results = { ...classicView(null), phase: "results", moments: [{ kind: "explosion" }, { kind: "win", pids: ["a"] }] };
  m.view(results);
  const held = m.heldView(results);
  assert.equal(held.phase, "playing");
  assert.equal(held.paused, false);
  assert.equal(held.mode.current, "b");
});

test("examples show for 4 s or until the next player types", () => {
  const { clock, m } = tracker();
  m.view(classicView("a"));
  clock.t += 1_000;
  let v = classicView("b", { examples: ["stone", "stand"], lastEvent: "explosion", moments: [{ kind: "explosion" }] });
  m.view(v);
  assert.equal(m.examplesShown(v), true);
  assert.equal(m.busy(), true);
  clock.t += EXAMPLES_MS - 1;
  v = classicView("b", { examples: ["stone", "stand"] });
  m.view(v);
  assert.equal(m.examplesShown(v), true);
  clock.t += 1;
  assert.equal(m.examplesShown(v), false);
  assert.equal(m.busy(), false);

  // The next player types: gone, and they stay gone if the typing is deleted.
  clock.t += 1_000;
  v = classicView("c", { examples: ["stone"], moments: [{ kind: "explosion" }] });
  m.view(v);
  assert.equal(m.examplesShown(v), true);
  clock.t += 100;
  v = classicView("c", { examples: ["stone"], typing: "s" });
  m.view(v);
  assert.equal(m.examplesShown(v), false);
  v = classicView("c", { examples: ["stone"] });
  m.view(v);
  assert.equal(m.examplesShown(v), false);

  // No examples, or junk: never shown.
  clock.t += 1_000;
  m.view(classicView("d", { moments: [{ kind: "explosion" }] }));
  assert.equal(m.examplesShown(classicView("d")), false);
  assert.equal(m.examplesShown(classicView("d", { examples: [] })), false);
  assert.equal(m.examplesShown(classicView("d", { examples: "stone" })), false);
  assert.equal(m.examplesShown(null), false);

  // Everyone at once: 4 s, whatever anyone types.
  const { clock: c2, m: m2 } = tracker();
  m2.view(everyoneView());
  const e = everyoneView({ examples: ["stone"], moments: [{ kind: "explosion" }] });
  m2.view(e);
  c2.t += EXAMPLES_MS - 1;
  assert.equal(m2.examplesShown(e), true);
  c2.t += 1;
  assert.equal(m2.examplesShown(e), false);
});

test("tension grows from turnElapsedMs and freezes while paused", () => {
  const { clock, m } = tracker();
  assert.equal(m.tension(), 0);
  m.view(classicView("a", { turnElapsedMs: 5_000 }));
  assert.equal(m.tension(), 5_000 / TENSION_FULL_MS);
  assert.deepEqual(m.bombState(null, true).tension, { elapsedMs: 5_000, running: true });
  assert.equal(m.busy(), false, "the flame grows in CSS: no redraws for it");
  clock.t += 5_000;
  assert.equal(m.tension(), 10_000 / TENSION_FULL_MS);
  assert.deepEqual(m.bombState(null, true).tension, { elapsedMs: 10_000, running: true });
  // Paused: frozen at the server's age.
  m.view(classicView("a", { paused: true, turnElapsedMs: 10_000 }));
  clock.t += 60_000;
  assert.equal(m.tension(), 10_000 / TENSION_FULL_MS);
  assert.deepEqual(m.bombState(null, false).tension, { elapsedMs: 10_000, running: false });
  assert.equal(m.busy(), false);
  // Running again, then full, and it stays at 1.
  m.view(classicView("a", { turnElapsedMs: 10_000 }));
  clock.t += 60_000;
  assert.equal(m.tension(), 1);
  assert.deepEqual(m.bombState(null, true).tension, { elapsedMs: 70_000, running: true });
  assert.equal(m.busy(), false);
  // The bomb passes: back to the new turn's age.
  m.view(classicView("b", { turnElapsedMs: 0 }));
  assert.equal(m.tension(), 0);
  // Junk is ignored.
  m.view(classicView("b", { turnElapsedMs: "lots" }));
  assert.equal(m.tension(), 0);
  m.view(classicView("b", { turnElapsedMs: -50 }));
  assert.equal(m.tension(), 0);
  assert.equal(m.bombState(null, true).tension, null);
});

test("tension is 0 with a visible countdown", () => {
  const { clock, m } = tracker();
  m.view(classicView("a", { turnElapsedMs: 20_000 }));
  m.view(classicView("a", { bombRemainingMs: 8_000 }));
  clock.t += 5_000;
  assert.equal(m.tension(), 0);
  assert.equal(m.bombState(8_000, true).tension, null);
});

test("an Everyone word moment pops that seat", () => {
  const { clock, m } = tracker();
  m.view(everyoneView());
  clock.t += 1_000;
  m.view(everyoneView({ players: withWord("c"), mode: { round: 1, answered: ["c"] }, moments: [{ kind: "word", pid: "c" }] }));
  assert.equal(m.popElapsed("c"), 0);
  assert.equal(m.word(), null, "no flight in Everyone at once");
  clock.t += POP_MS - 1;
  assert.equal(m.popElapsed("c"), POP_MS - 1);
  clock.t += 1;
  assert.equal(m.popElapsed("c"), null);
  assert.equal(m.busy(), false);
});

test("malformed moments never throw", () => {
  const { m } = tracker();
  m.view(classicView("a"));
  for (const moments of [null, "x", [null, 3, "word", {}, { kind: "word" }, { kind: "hearts", pids: "a" }, { kind: "hearts", pids: [1, null] }, { kind: "refused", pid: 7 }, { kind: "win", pids: null }]]) {
    m.view(classicView("a", { moments, players: [{ id: "a", lastWord: "junk" }, { id: "b", lastWord: { word: 5, prompt: null } }] }));
  }
  m.view(null);
  assert.equal(m.word(), null);
  assert.equal(m.refused(), null);
  assert.equal(m.hearts().size, 0);
  assert.equal(m.win(), null);
  assert.equal(m.heldView(null), null);
  assert.equal(m.tension(), 0);
});

test("the held results show the example words, not the stale typing", () => {
  const { clock, m } = tracker();
  m.view(classicView("b", { typing: "sto", turnElapsedMs: 9_000 }));
  clock.t += 1_000;
  const results = {
    ...classicView(null), phase: "results", examples: ["stone"], lastEvent: "explosion",
    moments: [{ kind: "explosion" }, { kind: "win", pids: ["a"] }],
  };
  m.view(results);
  const held = m.heldView(results);
  assert.equal(held.phase, "playing");
  assert.equal(held.typing, undefined);
  assert.equal(held.bombRemainingMs, undefined);
  assert.equal(held.turnElapsedMs, undefined);
  assert.equal(m.examplesShown(held), true);
  clock.t += RESULTS_HOLD_MS - 1;
  assert.equal(m.examplesShown(m.heldView(results)), true);
});

test("an explosion without example words doesn't keep the page busy", () => {
  const { clock, m } = tracker();
  m.view(classicView("a"));
  m.view(classicView("b", { lastEvent: "explosion", moments: [{ kind: "explosion" }] }));
  clock.t += EXPLOSION_MS;
  assert.equal(m.busy(), false);
});

test("a laptop's held view has the results' hearts and score, and is nobody's turn", () => {
  const { clock, m } = tracker();
  const me = (over: Record<string, unknown>) => ({ id: "b", nickname: "B", lives: 1, score: 2, alive: true, isOn: true, canAnswerSilently: false, bonusLeft: ["x"], activity: null, ...over });
  m.view(classicView("b", { me: me({}) }));
  clock.t += 1_000;
  const results = {
    ...classicView(null), phase: "results", lastEvent: "explosion", me: me({ lives: 0, alive: false, isOn: false, score: 2 }),
    moments: [{ kind: "hearts", pids: ["b"] }, { kind: "explosion" }, { kind: "win", pids: ["a"] }],
  };
  m.view(results);
  const held = m.heldView(results);
  assert.equal(held.phase, "playing");
  assert.equal(held.me.lives, 0, "the last heart is gone");
  assert.equal(held.me.isOn, false, "no live text box turn during the hold");
  assert.equal(held.me.alive, true, "still drawn as the playing circle, not the out screen");
  assert.deepEqual(held.me.bonusLeft, ["x"]);
});

// ---- sparks (batch 6): a silent or ghost answer sparks that seat, never showing the word ----

test("a silent moment sparks that seat for SPARK_MS", () => {
  const { clock, m } = tracker();
  m.view(classicView("a"));
  assert.equal(m.sparks().size, 0);
  m.view(classicView("a", { moments: [{ kind: "silent", pid: "c" }] }));
  assert.deepEqual([...m.sparks()], [["c", { elapsedMs: 0, ghost: false }]]);
  assert.equal(m.busy(), true);
  clock.t += SPARK_MS - 1;
  assert.deepEqual([...m.sparks()], [["c", { elapsedMs: SPARK_MS - 1, ghost: false }]]);
  assert.equal(m.busy(), true);
  clock.t += 1;
  assert.equal(m.sparks().size, 0);
  assert.equal(m.busy(), false);
});

test("a ghost moment sparks with ghost: true", () => {
  const { m } = tracker();
  m.view(everyoneView());
  m.view(everyoneView({ moments: [{ kind: "ghost", pid: "b" }, { kind: "silent", pid: "d" }] }));
  assert.deepEqual([...m.sparks()].sort(), [["b", { elapsedMs: 0, ghost: true }], ["d", { elapsedMs: 0, ghost: false }]]);
});

test("a second spark on the same seat within SPARK_GAP_MS is skipped, after it starts again", () => {
  const { clock, m } = tracker();
  m.view(classicView("a"));
  m.view(classicView("a", { moments: [{ kind: "silent", pid: "c" }, { kind: "silent", pid: "c" }] }));
  assert.deepEqual([...m.sparks()], [["c", { elapsedMs: 0, ghost: false }]]);
  clock.t += 300;
  m.view(classicView("a", { moments: [{ kind: "ghost", pid: "c" }] }));
  assert.deepEqual([...m.sparks()], [["c", { elapsedMs: 300, ghost: false }]], "skipped: not restarted");
  clock.t += SPARK_GAP_MS - 300 - 1;
  assert.equal(m.busy(), false, "nothing to draw while only the gap runs");
  m.view(classicView("a", { moments: [{ kind: "silent", pid: "c" }] }));
  assert.equal(m.sparks().size, 0, "still inside the gap");
  clock.t += 1;
  m.view(classicView("a", { moments: [{ kind: "ghost", pid: "c" }] }));
  assert.deepEqual([...m.sparks()], [["c", { elapsedMs: 0, ghost: true }]]);
});

test("first view never sparks", () => {
  const { m } = tracker();
  m.view(classicView("a", { moments: [{ kind: "silent", pid: "c" }, { kind: "ghost", pid: "d" }] }));
  assert.equal(m.sparks().size, 0);
  assert.equal(m.busy(), false);
});

test("sparks never start in the lobby or on the results, and junk moments are ignored", () => {
  const { m } = tracker();
  m.view(classicView("a"));
  m.view(classicView(null, { phase: "lobby", moments: [{ kind: "silent", pid: "a" }] }));
  m.view(classicView(null, { phase: "results", moments: [{ kind: "ghost", pid: "b" }] }));
  m.view(classicView("a", { moments: [{ kind: "silent" }, { kind: "ghost", pid: 7 }, { kind: "silent", pid: "" }] }));
  assert.equal(m.sparks().size, 0);
});
