import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../../src/engine/room.ts";
import type { PlayerId } from "../../src/engine/room.ts";
import { MODES, ACTIVITIES, settingsFor, createRoom } from "../../src/engine/registry.ts";
import { projectorView, playerView, controlView } from "../../src/engine/views.ts";
import { CORE_SETTINGS } from "../../src/engine/settings.ts";
import { classicMode } from "../../src/engine/modes/classic.ts";
import { everyoneMode } from "../../src/engine/modes/everyone.ts";
import { ghostActivity } from "../../src/engine/knockout/ghost.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import type { Prompt } from "../../src/engine/types.ts";
import { makeDeps, makeTestChecker, fixtureBlocked } from "./helpers.ts";

const ST: Prompt = { text: "st", type: "contains", count: 480 };
const TOKENS = ["secret-tok-a", "secret-tok-b", "secret-tok-c", "secret-tok-d"];

function setup(n: number, settings: Record<string, unknown> = {}) {
  const { deps, clock } = makeDeps(11);
  const room = createRoom({
    code: "ABCD",
    deps,
    checker: makeTestChecker(),
    bank: createPromptBank([ST]),
    blockedNames: fixtureBlocked,
  });
  const ids: PlayerId[] = [];
  for (let i = 0; i < n; i++) {
    const j = room.join(TOKENS[i], "Player" + i);
    assert.ok(j.ok);
    if (j.ok) ids.push(j.playerId);
  }
  room.updateSettings({ startLives: 1, timerStyle: "visible", ...settings });
  assert.deepEqual(room.start(), { ok: true });
  return { room, ids, clock };
}

const current = (room: Room) => (projectorView(room).mode as { current: PlayerId }).current;
const others = (room: Room, ids: PlayerId[]) => ids.filter((id) => id !== current(room));

test("registry lists the modes and activities", () => {
  assert.deepEqual(MODES, [classicMode, everyoneMode]);
  assert.deepEqual(ACTIVITIES, [ghostActivity]);
});

test("projector view hides tokens, ghost words and silent words", () => {
  const { room, ids } = setup(4);
  const [ghost, silent] = others(room, ids);
  room.context().loseLife(ghost); // test-only: knock a waiting player out
  assert.deepEqual(room.submit(ghost, "station"), { ok: true, kind: "ghost" });
  assert.deepEqual(room.submit(silent, "stone"), { ok: true, kind: "silent" });

  const views = [projectorView(room), playerView(room, current(room))!];
  for (const v of views) {
    const json = JSON.stringify(v);
    for (const t of TOKENS) assert.ok(!json.includes(t), `no token ${t}`);
    assert.ok(!json.includes("station"), "no ghost word");
    assert.ok(!json.includes("stone"), "no silent word");
    assert.ok(!json.includes("ghostPoints"), "no ghost points");
    assert.ok(!json.includes("token"));
  }
  const pv = projectorView(room);
  assert.ok(!JSON.stringify(pv).includes("score"), "projector shows no scores");
  assert.deepEqual(pv.prompt, { text: "st", type: "contains" });
  assert.equal(pv.code, "ABCD");
  assert.equal(pv.phase, "playing");
  assert.equal(pv.locked, false);
  assert.equal(pv.players.length, 4);
  assert.deepEqual(Object.keys(pv.players[0]).sort(), ["alive", "connected", "id", "lives", "nickname", "spectator"]);
  assert.equal(pv.players.find((x) => x.id === ghost)!.alive, false);

  // A player's own view carries only their own score.
  const sv = playerView(room, silent)!;
  assert.equal(sv.me.score, 1);
  assert.ok(!JSON.stringify(sv.players).includes("score"));
  // The ghost's own view holds their ghost view, and nobody else's.
  const gv = playerView(room, ghost)!;
  assert.deepEqual(gv.me.activity, { ghostPoints: 1, streak: 1, comebackStreak: 3, comebackAvailable: true });
  assert.equal(sv.me.activity, undefined);

  // The control view has ghost points and scores, but still no tokens.
  const cv = controlView(room);
  const cjson = JSON.stringify(cv);
  for (const t of TOKENS) assert.ok(!cjson.includes(t));
  const cg = cv.players.find((x) => x.id === ghost)!;
  assert.equal(cg.ghostPoints, 1);
  assert.equal(cg.role, "player");
  assert.equal(cv.players.find((x) => x.id === silent)!.score, 1);
  assert.equal(cv.settings.mode, "classic");
  assert.deepEqual(cv.settingDecls, settingsFor("classic", "ghost"));
});

test("everyone mode: projector shows ticks, not words", () => {
  const { room, ids } = setup(3, { mode: "everyone" });
  assert.deepEqual(room.submit(ids[0], "station"), { ok: true, kind: "turn" });
  const v = projectorView(room);
  assert.ok(!JSON.stringify(v).includes("station"));
  assert.deepEqual(v.players.map((x) => x.answered), [true, false, false]);
});

test("typing appears only when liveTyping is on", () => {
  const off = setup(3);
  off.room.typing(current(off.room), "sta");
  assert.equal("typing" in projectorView(off.room), false);

  const { room, ids } = setup(3, { liveTyping: true });
  const on = current(room);
  const [other] = others(room, ids);
  room.typing(other, "stor");
  assert.equal("typing" in projectorView(room), false, "never another player's text");
  room.typing(on, "sta");
  assert.equal(projectorView(room).typing, "sta");
  assert.equal(playerView(room, other)!.typing, "sta");
  room.endGame();
  room.typing(on, "stat");
  assert.equal("typing" in projectorView(room), false, "never during results");
});

test("a silent answer never reaches the projector through live typing", () => {
  const { room } = setup(3, { liveTyping: true });
  const { seats, current: on } = projectorView(room).mode as { seats: PlayerId[]; current: PlayerId };
  const next = seats[(seats.indexOf(on) + 1) % seats.length];
  room.typing(next, "stone");
  assert.deepEqual(room.submit(next, "stone"), { ok: true, kind: "silent" });
  assert.deepEqual(room.submit(on, "station"), { ok: true, kind: "turn" });
  assert.equal(current(room), next, "the bomb passed to the silent answerer");
  assert.equal(projectorView(room).typing, undefined);
  assert.ok(!JSON.stringify(projectorView(room)).includes("stone"));
});

test("other players never see a ghost's ghost points", () => {
  const { room, ids } = setup(3);
  const [ghost, other] = others(room, ids);
  room.context().loseLife(ghost);
  assert.deepEqual(room.submit(ghost, "station"), { ok: true, kind: "ghost" });
  assert.equal((playerView(room, ghost)!.me.activity as { ghostPoints: number }).ghostPoints, 1, "a ghost sees their own");
  for (const pid of [other, current(room)]) {
    const json = JSON.stringify(playerView(room, pid)!);
    assert.ok(!json.includes("ghostPoints"), `no ghostPoints in ${pid}'s view`);
    assert.ok(!json.includes("station"));
  }
});

test("settingsFor includes mode and activity settings with registry options", () => {
  const keys = (m: string, a: string) => settingsFor(m, a).map((d) => d.key);
  const classic = keys("classic", "ghost");
  for (const k of ["mode", "band", "liveTyping", "timerStyle", "silentAnswers", "comeback", "comebackStreak"]) {
    assert.ok(classic.includes(k), k);
  }
  assert.ok(!classic.includes("roundTime"));
  const everyone = keys("everyone", "ghost");
  assert.ok(everyone.includes("roundTime") && everyone.includes("shrinking"));
  assert.ok(!everyone.includes("timerStyle"));
  assert.ok(!keys("everyone", "none").includes("comeback"));

  const decls = settingsFor("classic", "ghost");
  const mode = decls.find((d) => d.key === "mode")!;
  const knockout = decls.find((d) => d.key === "knockout")!;
  assert.ok(mode.kind === "choice" && knockout.kind === "choice");
  assert.deepEqual(mode.options, [{ value: "classic", label: "Classic" }, { value: "everyone", label: "Everyone at once" }]);
  assert.deepEqual(knockout.options, [{ value: "ghost", label: "Ghost mode" }]);
  assert.deepEqual(
    decls.filter((d) => d.key !== "mode" && d.key !== "knockout").slice(0, CORE_SETTINGS.length - 2).map((d) => d.key),
    CORE_SETTINGS.filter((d) => d.key !== "mode" && d.key !== "knockout").map((d) => d.key),
    "core settings come first",
  );
});

test("createRoom uses the registry; the plain constructor still takes its own lists", () => {
  const { room } = setup(2, { mode: "everyone" });
  assert.equal(room.settings.mode, "everyone");
  assert.equal(room.mode()?.id, "everyone");
  assert.equal(room.activity()?.id, "ghost");

  const bare = new Room({
    code: "ABCD", deps: makeDeps(1).deps, checker: makeTestChecker(),
    bank: createPromptBank([ST]), blockedNames: fixtureBlocked, modes: [classicMode],
  });
  bare.updateSettings({ mode: "everyone" });
  assert.equal(bare.settings.mode, "classic", "only the room's own modes are choices");
});

test("results include ghost leaderboard and longest word", () => {
  const { room, ids } = setup(4, { comeback: false });
  const [g1, g2] = others(room, ids);
  room.context().loseLife(g1);
  room.context().loseLife(g2);
  const first = current(room);
  assert.deepEqual(room.submit(first, "station"), { ok: true, kind: "turn" });
  assert.deepEqual(room.submit(current(room), "st"), { ok: false, reason: "not-a-word" });
  assert.deepEqual(room.submit(current(room), "stone"), { ok: true, kind: "turn" });
  room.submit(g1, "street");
  room.submit(g2, "strong");
  room.submit(g2, "story");
  assert.equal("results" in projectorView(room), false, "no results mid-game");
  room.context().endGame([first]);

  const v = projectorView(room);
  assert.equal(v.phase, "results");
  const nick = (id: PlayerId) => room.players().find((x) => x.id === id)!.nickname;
  assert.deepEqual(v.results, {
    winners: [first],
    ghostBoard: [
      { id: g2, nickname: nick(g2), ghostPoints: 2 },
      { id: g1, nickname: nick(g1), ghostPoints: 1 },
    ],
    longestWord: { nickname: nick(first), word: "station" },
  });
  assert.ok(!JSON.stringify(v).includes("strong"), "ghost words stay private after the game too");
});

test("player view shows remaining bonus letters", () => {
  const { room } = setup(3);
  const on = current(room);
  const all = "abcdefghijklmnoprstuvwy".split("");
  assert.deepEqual(playerView(room, on)!.me.bonusLeft, all);
  assert.equal(playerView(room, on)!.me.isOn, true);
  assert.deepEqual(room.submit(on, "station"), { ok: true, kind: "turn" });
  const me = playerView(room, on)!.me;
  assert.deepEqual(me.bonusLeft, all.filter((c) => !"station".includes(c)));
  assert.equal(me.isOn, false);
  assert.equal(me.score, 1);
  assert.equal(me.alive, true);
  assert.equal(me.lives, 1);

  const off = setup(3, { bonusAlphabet: false });
  assert.deepEqual(playerView(off.room, current(off.room))!.me.bonusLeft, []);
});

test("paused views carry the remaining bomb time; a hidden fuse carries none", async () => {
  const { room, clock } = setup(3);
  await clock.advance(2_000);
  room.pause();
  const a = projectorView(room);
  assert.equal(a.paused, true);
  assert.equal(a.bombRemainingMs, 10_000);
  await clock.advance(5_000);
  assert.equal(projectorView(room).bombRemainingMs, 10_000, "frozen while paused");
  room.resume();
  assert.equal(projectorView(room).paused, false);

  const hidden = setup(3, { timerStyle: "hidden" });
  assert.equal("bombRemainingMs" in projectorView(hidden.room), false);
});

test("lobby view has no prompt or mode", () => {
  const room = createRoom({
    code: "WXYZ", deps: makeDeps(1).deps, checker: makeTestChecker(),
    bank: createPromptBank([ST]), blockedNames: fixtureBlocked,
  });
  const j = room.join("secret-tok-a", "Ann");
  assert.ok(j.ok);
  const v = projectorView(room);
  assert.equal(v.phase, "lobby");
  assert.equal(v.prompt, null);
  assert.equal(v.mode, null);
  assert.equal(v.paused, false);
  if (j.ok) assert.equal(playerView(room, j.playerId)!.me.isOn, false);
});

test("me.canAnswerSilently: alive, not on, playing, and silentAnswers on", () => {
  const { room, ids } = setup(3, { silentAnswers: true });
  const on = current(room);
  const other = ids.find((p) => p !== on)!;
  assert.equal(playerView(room, on)!.me.canAnswerSilently, false, "the player whose turn it is");
  assert.equal(playerView(room, other)!.me.canAnswerSilently, true);
  room.pause();
  assert.equal(playerView(room, other)!.me.canAnswerSilently, false, "paused");
  room.resume();
  const off = setup(3, { silentAnswers: false });
  const waiting = off.ids.find((p) => p !== current(off.room))!;
  assert.equal(playerView(off.room, waiting)!.me.canAnswerSilently, false, "setting off");
});
