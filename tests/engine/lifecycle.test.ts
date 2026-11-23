import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../../src/engine/room.ts";
import type { PlayerId } from "../../src/engine/room.ts";
import type { GameMode, ModeContext } from "../../src/engine/modes/mode.ts";
import type { KnockoutActivity } from "../../src/engine/knockout/activity.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import { createWordChecker } from "../../src/engine/words.ts";
import type { Prompt } from "../../src/engine/types.ts";
import { makeDeps, makeTestChecker, fixtureWords, fixtureBlocked } from "./helpers.ts";

/** Fake mode: one shared prompt for every alive player; explodes after settings.testFuseMs. */
function fakeMode(usedScope: "room" | "player" = "room"): GameMode {
  return {
    id: "classic",
    name: "Fake",
    description: "Test mode",
    settings: [
      { key: "testFuseMs", label: "Fuse", help: "", kind: "number", default: 10_000, min: 1_000, max: 120_000, step: 1_000 },
      { key: "silentAnswers", label: "Silent", help: "", kind: "boolean", default: false },
    ],
    usedScope,
    start(ctx) {
      ctx.newPrompt();
      ctx.armBomb(ctx.settings.testFuseMs as number, true);
    },
    onWord(ctx, pid, word) {
      ctx.acceptWord(pid, word);
    },
    onExplode(ctx) {
      const p = ctx.prompt();
      if (p) ctx.explodedPrompt(p);
      for (const pl of ctx.alive()) ctx.loseLife(pl.id);
      const left = ctx.alive();
      if (left.length <= 1) ctx.endGame(left.map((x) => x.id));
      else { ctx.newPrompt(); ctx.armBomb(ctx.settings.testFuseMs as number, true); }
    },
    onPlayerGone() {},
    onSkip(ctx) {
      ctx.newPrompt();
      ctx.armBomb(ctx.settings.testFuseMs as number, true);
    },
    isOn(ctx, pid) {
      return ctx.alive().some((p) => p.id === pid) && ctx.state.offPlayer !== pid;
    },
    view: () => ({}),
  };
}

function recordingActivity() {
  const calls: { knockedOut: PlayerId[]; prompts: number; words: string[] } = { knockedOut: [], prompts: 0, words: [] };
  const activity: KnockoutActivity = {
    id: "ghost",
    name: "Recorder",
    description: "",
    settings: [],
    onKnockedOut: (_ctx, pid) => { calls.knockedOut.push(pid); },
    onPrompt: () => { calls.prompts++; },
    onWord: (_ctx, _pid, word) => { calls.words.push(word); return { ok: true, kind: "ghost" }; },
    view: () => ({}),
  };
  return { activity, calls };
}

const ST: Prompt = { text: "st", type: "contains", count: 480 };

function setup(opts: {
  prompts?: Prompt[];
  words?: string[];
  usedScope?: "room" | "player";
  activities?: KnockoutActivity[];
  modes?: GameMode[];
} = {}) {
  const { deps, clock } = makeDeps(11);
  const checker = opts.words
    ? createWordChecker({ dictionary: [...opts.words, ...fixtureBlocked], known: opts.words, blocked: fixtureBlocked })
    : makeTestChecker();
  const room = new Room({
    code: "ABCD",
    deps,
    checker,
    bank: createPromptBank(opts.prompts ?? [ST]),
    blockedNames: fixtureBlocked,
    modes: opts.modes ?? [fakeMode(opts.usedScope)],
    activities: opts.activities ?? [],
  });
  return { room, clock };
}

function joinAll(room: Room, ...names: string[]): PlayerId[] {
  return names.map((n, i) => {
    const j = room.join("tok" + i, n);
    assert.ok(j.ok);
    return j.ok ? j.playerId : "";
  });
}
const byId = (room: Room, id: PlayerId) => room.players().find((p) => p.id === id)!;

test("cannot start with fewer than 2 players", () => {
  const { room } = setup();
  assert.deepEqual(room.start(), { ok: false, reason: "need-2-players" });
  joinAll(room, "Ann");
  assert.deepEqual(room.start(), { ok: false, reason: "need-2-players" });
  assert.equal(room.phase, "lobby");
  joinAll(room, "Ann", "Ben");
  assert.deepEqual(room.start(), { ok: true });
  assert.equal(room.phase, "playing");
  assert.deepEqual(room.start(), { ok: false, reason: "already-running" });
});

test("cannot start when band/types have no prompts", () => {
  const { room } = setup();
  joinAll(room, "Ann", "Ben");
  room.updateSettings({ promptTypes: ["ends"] });
  assert.deepEqual(room.start(), { ok: false, reason: "no-prompts" });
  assert.equal(room.phase, "lobby");
  room.updateSettings({ promptTypes: ["contains"], band: "medium" });
  assert.deepEqual(room.start(), { ok: false, reason: "no-prompts" });
  room.updateSettings({ band: "easy" });
  assert.deepEqual(room.start(), { ok: true });
});

test("cannot start with an unknown mode", () => {
  const { room } = setup({ modes: [] });
  joinAll(room, "Ann", "Ben");
  assert.deepEqual(room.start(), { ok: false, reason: "unknown-mode" });
  assert.equal(room.phase, "lobby");
});

test("settings locked while playing", () => {
  const { room } = setup();
  joinAll(room, "Ann", "Ben");
  assert.deepEqual(room.updateSettings({ startLives: 3, testFuseMs: 5_000 }), { ok: true });
  assert.equal(room.settings.startLives, 3);
  assert.equal(room.settings.testFuseMs, 5_000, "mode-declared settings resolve too");
  room.start();
  assert.deepEqual(room.updateSettings({ startLives: 1 }), { ok: false, reason: "game-running" });
  room.pause();
  assert.deepEqual(room.updateSettings({ startLives: 1 }), { ok: false, reason: "game-running" });
  assert.equal(room.settings.startLives, 3);
});

test("start gives everyone startLives and makes spectators players", () => {
  const { room } = setup();
  const [a, b] = joinAll(room, "Ann", "Ben");
  room.updateSettings({ startLives: 3, maxLives: 3 });
  room.start();
  const late = room.join("late", "Cat");
  assert.ok(late.ok);
  if (!late.ok) return;
  assert.equal(byId(room, late.playerId).role, "spectator");
  byId(room, a).score = 9;
  byId(room, a).bonusUsed.add("x");
  room.endGame();
  assert.equal(room.phase, "results");
  assert.deepEqual(room.winners, []);
  room.playAgain();
  room.updateSettings({ startLives: 5, maxLives: 4 });
  assert.deepEqual(room.start(), { ok: true });
  for (const id of [a, b, late.playerId]) {
    const p = byId(room, id);
    assert.equal(p.role, "player");
    assert.equal(p.alive, true);
    assert.equal(p.lives, 4, "lives = min(startLives, maxLives)");
    assert.equal(p.score, 0);
    assert.equal(p.bonusUsed.size, 0);
  }
});

test("pause freezes remaining time", async () => {
  const { room, clock } = setup();
  const [a] = joinAll(room, "Ann", "Ben");
  room.updateSettings({ testFuseMs: 10_000 });
  room.start();
  await clock.advance(4_000);
  room.pause();
  assert.equal(room.phase, "paused");
  await clock.advance(60_000);
  assert.equal(room.bombRemaining(), 6_000);
  assert.deepEqual(room.submit(a, "stone"), { ok: false, reason: "paused" });
  room.resume();
  assert.equal(room.phase, "playing");
  assert.equal(room.bombRemaining(), 6_000);
  await clock.advance(5_999);
  assert.equal(byId(room, a).lives, 2);
  await clock.advance(1);
  assert.equal(byId(room, a).lives, 1, "bomb exploded after the remaining 6 000 ms");
});

test("skip prompt deals a new prompt without losing a life", async () => {
  const bank = [ST, { text: "re", type: "contains", count: 480 } as Prompt];
  const { room, clock } = setup({ prompts: bank });
  const [a] = joinAll(room, "Ann", "Ben");
  room.start();
  const first = room.prompt();
  await clock.advance(8_000);
  room.skipPrompt();
  assert.notDeepEqual(room.prompt(), first, "avoids the recent prompt");
  assert.equal(room.bombRemaining(), 10_000);
  assert.equal(byId(room, a).lives, 2);
});

test("bonus alphabet gives a life and resets", () => {
  const { room } = setup({ prompts: [{ text: "ab", type: "contains", count: 300 }], words: ["ab", "cab", "tab"] });
  const [a] = joinAll(room, "Ann", "Ben");
  room.updateSettings({ bonusLetters: ["a", "b", "c"], startLives: 2, maxLives: 3 });
  room.start();
  const p = byId(room, a);
  assert.deepEqual(room.submit(a, "ab"), { ok: true, kind: "turn" });
  assert.deepEqual([...p.bonusUsed].sort(), ["a", "b"]);
  assert.equal(p.lives, 2);
  assert.deepEqual(room.submit(a, "cab"), { ok: true, kind: "turn" });
  assert.equal(p.lives, 3);
  assert.equal(p.bonusUsed.size, 0);
  assert.equal(p.score, 2);
  assert.deepEqual(room.acceptedWords, [{ pid: a, word: "ab" }, { pid: a, word: "cab" }]);
  // At max lives the set still resets but lives stay at 3.
  room.endGame();
  room.playAgain();
  room.updateSettings({ startLives: 3 });
  room.start();
  room.submit(a, "ab");
  room.submit(a, "cab");
  assert.equal(p.lives, 3);
  assert.equal(p.bonusUsed.size, 0);
});

test("loseLife to zero knocks out and calls activity", async () => {
  const { activity, calls } = recordingActivity();
  const { room, clock } = setup({ activities: [activity] });
  const [a, b, c] = joinAll(room, "Ann", "Ben", "Cat");
  room.updateSettings({ startLives: 1 });
  room.start();
  assert.equal(calls.prompts, 1, "onPrompt called for the first prompt");
  // The fake mode costs every alive player a life when the bomb goes off.
  await clock.advance(10_000);
  assert.deepEqual(calls.knockedOut, [a, b, c]);
  for (const id of [a, b, c]) {
    assert.equal(byId(room, id).alive, false);
    assert.equal(byId(room, id).lives, 0);
  }
  assert.equal(room.phase, "results");
  assert.deepEqual(room.winners, []);
  assert.ok(room.examples.length >= 2 && room.examples.length <= 3, "example answers recorded");
});

test("dead players' words go to the activity, a no-op activity refuses them", async () => {
  const { activity, calls } = recordingActivity();
  for (const acts of [[activity], []]) {
    const { room } = setup({ activities: acts });
    const [a, b] = joinAll(room, "Ann", "Ben", "Cat");
    room.updateSettings({ startLives: 1 });
    room.start();
    // Knock out only Ann by hand through the context.
    room.context().loseLife(a);
    assert.equal(byId(room, a).alive, false);
    const r = room.submit(a, "stone");
    if (acts.length) {
      assert.deepEqual(r, { ok: true, kind: "ghost" });
      assert.deepEqual(calls.words, ["stone"]);
      assert.deepEqual(room.submit(b, "stone"), { ok: true, kind: "turn" }, "ghost word not used up");
    } else {
      assert.deepEqual(r, { ok: false, reason: "not-playing" });
    }
  }
});

test("silent answers score privately when silentAnswers is on", () => {
  const { room } = setup();
  const [a, b] = joinAll(room, "Ann", "Ben");
  room.start();
  room.state().offPlayer = b;
  assert.deepEqual(room.submit(b, "stone"), { ok: false, reason: "not-your-turn" });
  room.endGame();
  room.playAgain();
  room.updateSettings({ silentAnswers: true });
  room.start();
  room.state().offPlayer = b;
  assert.deepEqual(room.submit(b, "stone"), { ok: true, kind: "silent" });
  assert.equal(byId(room, b).score, 1);
  assert.equal(byId(room, b).bonusUsed.size, 0);
  assert.deepEqual(room.acceptedWords, []);
  assert.deepEqual(room.submit(a, "stone"), { ok: true, kind: "turn" }, "silent word not used up");
});

test("room-scope reuse is rejected", () => {
  const { room } = setup({ usedScope: "room" });
  const [a, b] = joinAll(room, "Ann", "Ben");
  room.start();
  assert.deepEqual(room.submit(a, "Stone"), { ok: true, kind: "turn" });
  assert.deepEqual(room.submit(b, "stone"), { ok: false, reason: "used" });
});

test("player-scope reuse only blocks your own words", () => {
  const { room } = setup({ usedScope: "player" });
  const [a, b] = joinAll(room, "Ann", "Ben");
  room.start();
  assert.deepEqual(room.submit(a, "stone"), { ok: true, kind: "turn" });
  assert.deepEqual(room.submit(b, "stone"), { ok: true, kind: "turn" });
  assert.deepEqual(room.submit(a, "stone"), { ok: false, reason: "used" });
});

test("invalid words return reasons in order", () => {
  const { room } = setup();
  const [a] = joinAll(room, "Ann", "Ben");
  assert.deepEqual(room.submit(a, "stone"), { ok: false, reason: "not-playing" });
  room.start();
  assert.deepEqual(room.submit(a, "   "), { ok: false, reason: "empty" });
  assert.deepEqual(room.submit(a, "st0ne"), { ok: false, reason: "bad-characters" });
  assert.deepEqual(room.submit(a, "s".repeat(31)), { ok: false, reason: "too-long" });
  assert.deepEqual(room.submit(a, "zzzzq"), { ok: false, reason: "not-a-word" });
  assert.deepEqual(room.submit(a, "damn"), { ok: false, reason: "blocked" });
  assert.ok(fixtureWords.includes("house"));
  assert.deepEqual(room.submit(a, "house"), { ok: false, reason: "doesnt-match" });
  assert.deepEqual(room.submit("nobody", "stone"), { ok: false, reason: "not-playing" });
});

test("playAgain returns to lobby with same players", () => {
  const { room } = setup();
  const ids = joinAll(room, "Ann", "Ben");
  room.updateSettings({ startLives: 3 });
  room.start();
  room.endGame();
  room.playAgain();
  assert.equal(room.phase, "lobby");
  assert.equal(room.prompt(), null);
  assert.deepEqual(room.players().map((p) => p.id), ids);
  assert.equal(room.settings.startLives, 3);
  assert.deepEqual(room.updateSettings({ startLives: 2 }), { ok: true });
});

test("typing ignored unless liveTyping", () => {
  const { room } = setup();
  room.updateSettings({ liveTyping: false });
  const [a] = joinAll(room, "Ann", "Ben");
  room.start();
  room.typing(a, "sto");
  assert.equal(room.typingOf(a), undefined);
  room.endGame();
  room.playAgain();
  room.updateSettings({ liveTyping: true });
  room.start();
  room.typing(a, "sto");
  assert.equal(room.typingOf(a), "sto");
});

test("kicking a player mid-game tells the mode", () => {
  const gone: PlayerId[] = [];
  const mode = { ...fakeMode(), onPlayerGone: (_ctx: ModeContext, pid: PlayerId) => { gone.push(pid); } };
  const { room } = setup({ modes: [mode] });
  const [, b] = joinAll(room, "Ann", "Ben", "Cat");
  room.start();
  room.kick(b);
  assert.deepEqual(gone, [b]);
  assert.ok(!room.context().alive().some((p) => p.id === b));
});

// ---- fix round 1 ----

test("a mode that ends the game and re-arms leaves no stale bomb for the next game", async () => {
  let explodes = 0;
  const base = fakeMode();
  const mode: GameMode = {
    ...base,
    onWord(ctx, pid, word) {
      ctx.acceptWord(pid, word);
      ctx.endGame([]);
      ctx.armBomb(5_000, true);
    },
    onExplode(ctx) { explodes++; base.onExplode(ctx); },
  };
  const { room, clock } = setup({ modes: [mode] });
  const [a] = joinAll(room, "Ann", "Ben");
  room.start();
  room.submit(a, "stone");
  assert.equal(room.phase, "results");
  assert.equal(clock.timers.size, 0, "armBomb after endGame arms nothing");
  room.playAgain();
  room.start();
  await clock.advance(5_000);
  assert.equal(explodes, 0);
  assert.equal(room.bombRemaining(), 5_000, "the new game's bomb is untouched");
  await clock.advance(5_000);
  assert.equal(explodes, 1);
});

test("armBomb and newPrompt do nothing once the game is over", () => {
  const { activity, calls } = recordingActivity();
  const { room, clock } = setup({ activities: [activity] });
  joinAll(room, "Ann", "Ben");
  room.start();
  const ctx = room.context();
  const before = room.prompt();
  room.endGame();
  const prompts = calls.prompts;
  ctx.armBomb(5_000, true);
  ctx.newPrompt();
  assert.equal(clock.timers.size, 0);
  assert.equal(room.bombRemaining(), 0);
  assert.equal(room.prompt(), before);
  assert.equal(calls.prompts, prompts, "no onPrompt after the game ended");
});

test("a stale context from the last game cannot touch the new game", async () => {
  const { room, clock } = setup();
  const [a] = joinAll(room, "Ann", "Ben");
  room.start();
  const old = room.context();
  room.endGame();
  room.playAgain();
  assert.equal(clock.timers.size, 0, "playAgain leaves no timer");
  room.start();
  old.armBomb(1_000, true);
  old.loseLife(a);
  old.endGame([a]);
  assert.equal(room.phase, "playing");
  assert.equal(byId(room, a).lives, 2);
  assert.equal(room.bombRemaining(), 10_000);
  await clock.advance(1_000);
  assert.equal(byId(room, a).lives, 2);
});

test("endGame is idempotent", () => {
  let changes = 0;
  const { deps } = makeDeps(11);
  const room = new Room({
    code: "ABCD", deps, checker: makeTestChecker(), bank: createPromptBank([ST]),
    blockedNames: fixtureBlocked, modes: [fakeMode()], onChange: () => changes++,
  });
  const [a, b] = joinAll(room, "Ann", "Ben");
  room.start();
  const ctx = room.context();
  ctx.endGame([a]);
  const after = changes;
  ctx.endGame([b]);
  room.endGame();
  assert.deepEqual(room.winners, [a]);
  assert.equal(changes, after);
});

test("an activity can revive a player and keep its own state across prompts", () => {
  const activity: KnockoutActivity = {
    id: "ghost", name: "Reviver", description: "", settings: [],
    onKnockedOut(ctx) { ctx.activityState.knocked = ((ctx.activityState.knocked as number) ?? 0) + 1; },
    onPrompt(ctx) { ctx.activityState.prompts = ((ctx.activityState.prompts as number) ?? 0) + 1; },
    onWord(ctx, pid) {
      const p = ctx.player(pid)!;
      p.ghostPoints += 1;
      p.ghostStreak += 1;
      if ((ctx.activityState.prompts as number) >= 2) {
        p.comebackUsed = true;
        ctx.revive(pid, 1);
      }
      return { ok: true, kind: "ghost" };
    },
    view: () => ({}),
  };
  let changes = 0;
  const { deps } = makeDeps(11);
  const room = new Room({
    code: "ABCD", deps, checker: makeTestChecker(),
    bank: createPromptBank([ST, { text: "re", type: "contains", count: 480 }]),
    blockedNames: fixtureBlocked, modes: [fakeMode()], activities: [activity], onChange: () => changes++,
  });
  const [a, b, c] = joinAll(room, "Ann", "Ben", "Cat");
  room.updateSettings({ startLives: 1 });
  room.start();
  const ctx = room.context();
  ctx.state.mine = "mode";
  ctx.loseLife(b);
  // "store" and "street" contain both "st" and "re", whichever prompt is dealt.
  assert.deepEqual(room.submit(b, "store"), { ok: true, kind: "ghost" });
  assert.equal(byId(room, b).alive, false, "one prompt so far: no revive");
  room.skipPrompt();
  assert.equal(ctx.activityState.prompts, 2, "state kept across prompts");
  const before = changes;
  ctx.revive(c, 1); // reviving an alive player only sets lives
  assert.deepEqual(room.submit(b, "street"), { ok: true, kind: "ghost" });
  const p = byId(room, b);
  assert.equal(p.alive, true);
  assert.equal(p.lives, 1);
  assert.equal(p.ghostPoints, 2);
  assert.equal(p.comebackUsed, true);
  assert.ok(changes > before);
  assert.deepEqual(ctx.alive().map((x) => x.id), [a, b, c], "seat order unchanged");
  assert.equal(ctx.player("nobody"), undefined);
  assert.equal(ctx.activityState.mine, undefined, "separate from the mode's state");
  room.endGame();
  room.playAgain();
  room.start();
  assert.deepEqual(room.context().activityState, { prompts: 1 }, "reset each game");
  assert.deepEqual(room.context().state, {});
});

test("silent answers cannot repeat a player's own silent word", () => {
  const { room } = setup();
  const [a, b] = joinAll(room, "Ann", "Ben");
  room.updateSettings({ silentAnswers: true });
  room.start();
  room.state().offPlayer = b;
  assert.deepEqual(room.submit(b, "stone"), { ok: true, kind: "silent" });
  assert.deepEqual(room.submit(b, "stone"), { ok: false, reason: "used" });
  assert.equal(byId(room, b).score, 1);
  assert.equal(byId(room, b).bonusUsed.size, 0);
  assert.deepEqual(room.submit(a, "stone"), { ok: true, kind: "turn" }, "room words untouched");
});
