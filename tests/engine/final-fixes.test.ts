import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../../src/engine/room.ts";
import type { PlayerId } from "../../src/engine/room.ts";
import { classicMode } from "../../src/engine/modes/classic.ts";
import { everyoneMode } from "../../src/engine/modes/everyone.ts";
import { ghostActivity } from "../../src/engine/knockout/ghost.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import { createWordChecker, isBlockedName } from "../../src/engine/words.ts";
import { projectorView, playerView } from "../../src/engine/views.ts";
import type { Prompt } from "../../src/engine/types.ts";
import { makeDeps, makeTestChecker, fixtureBlocked, fixtureWords } from "./helpers.ts";

const ST: Prompt = { text: "st", type: "contains", count: 480 };

function setup(modeName: "classic" | "everyone", n: number, settings: Record<string, unknown> = {}, onChange?: () => void) {
  const { deps, clock } = makeDeps(11);
  const room = new Room({
    code: "ABCD",
    deps,
    checker: makeTestChecker(),
    bank: createPromptBank([ST]),
    blockedNames: fixtureBlocked,
    modes: [modeName === "classic" ? classicMode : everyoneMode],
    activities: [ghostActivity],
    onChange,
  });
  const ids: PlayerId[] = [];
  for (let i = 0; i < n; i++) {
    const j = room.join("tok" + i, "Player" + i);
    assert.ok(j.ok);
    if (j.ok) ids.push(j.playerId);
  }
  room.updateSettings({ mode: modeName, startLives: 1, timerStyle: "visible", ...settings });
  assert.deepEqual(room.start(), { ok: true });
  return { room, clock, ids };
}
const cur = (room: Room) => (room.modeView() as { current: PlayerId }).current;

test("final 1: classic projector view carries the last turn word; everyone does not", () => {
  const { room } = setup("classic", 3);
  assert.equal((projectorView(room).mode as { lastWord: unknown }).lastWord, null);
  const pid = cur(room);
  assert.deepEqual(room.submit(pid, "station"), { ok: true, kind: "turn" });
  assert.deepEqual((projectorView(room).mode as { lastWord: unknown }).lastWord, { pid, word: "station" });
  const e = setup("everyone", 3);
  assert.deepEqual(e.room.submit(e.ids[0], "station"), { ok: true, kind: "turn" });
  assert.ok(!("lastWord" in (projectorView(e.room).mode as object)));
  assert.ok(!JSON.stringify(projectorView(e.room)).includes("station"));
});

test("final 1: classic lastWord is cleared at the next game start", () => {
  const { room } = setup("classic", 2);
  room.submit(cur(room), "station");
  room.endGame();
  room.playAgain();
  assert.deepEqual(room.start(), { ok: true });
  assert.equal((projectorView(room).mode as { lastWord: unknown }).lastWord, null);
});

test("final 2: submit with a non-string never throws", () => {
  const { room, ids } = setup("classic", 2);
  for (const bad of [undefined, null, 42, {}, ["station"]]) {
    assert.deepEqual(room.submit(ids[0], bad as unknown as string), { ok: false, reason: "bad-characters" });
  }
});

test("final 2: typing ignores non-strings and caps at 30 characters", () => {
  const { room } = setup("classic", 2, { liveTyping: true });
  const pid = cur(room);
  room.typing(pid, "abc");
  room.typing(pid, 5 as unknown as string);
  assert.equal(room.typingOf(pid), "abc");
  room.typing(pid, "x".repeat(100));
  assert.equal(room.typingOf(pid), "x".repeat(30));
});

test("final 2: rename and playerView on an unknown id do not throw", () => {
  const { room } = setup("classic", 2);
  assert.deepEqual(room.rename("nobody", "Newname"), { ok: false, reason: "not-found" });
  assert.equal(playerView(room, "nobody"), null);
});

test("final 3: a waiting player's keystrokes store nothing and call onChange 0 times", () => {
  let changes = 0;
  const { room, ids } = setup("classic", 3, { liveTyping: true }, () => { changes++; });
  const waiting = ids.find((id) => id !== cur(room))!;
  changes = 0;
  for (let i = 0; i < 10; i++) room.typing(waiting, "st".repeat(i + 1));
  assert.equal(changes, 0);
  assert.equal(room.typingOf(waiting), undefined);
  room.typing(cur(room), "sta");
  assert.equal(changes, 1);
});

test("typing in Everyone at once triggers no change", () => {
  let changes = 0;
  const { room, ids } = setup("everyone", 4, {}, () => { changes++; });
  assert.equal(room.settings.liveTyping, true, "live typing is on by default");
  for (const id of ids) assert.equal(room.isOn(id), true);
  changes = 0;
  for (const id of ids) for (let i = 0; i < 5; i++) room.typing(id, "st".repeat(i + 1));
  assert.equal(changes, 0);
  for (const id of ids) assert.equal(room.typingOf(id), undefined, "nothing stored");
  assert.ok(!("typing" in projectorView(room)));
});

test("final 4: blocked list is case-insensitive and names are NFC-normalised", () => {
  const checker = createWordChecker({ dictionary: ["damn", "fine"], known: ["damn", "fine"], blocked: ["Damn"] });
  assert.equal(checker.isBlocked("damn"), true);
  assert.equal(checker.isWord("damn"), false);
  assert.deepEqual(checker.examples({ text: "a", type: "contains", count: 1 }, 5, () => 0.5), []);
  const mixed = createWordChecker({ dictionary: ["Fine"], known: ["Fine"], blocked: [] });
  assert.equal(mixed.isWord("fine"), true);
  assert.equal(isBlockedName("DAMN", ["Damn"]), true);
  assert.equal(isBlockedName("åss", ["ass"]), false);
  assert.equal(isBlockedName("åss", ["ass"]), false);
});

test("final 5: playAgain gives a neutral lobby view", () => {
  const { room, ids } = setup("classic", 3, { bonusAlphabet: false });
  room.context().loseLife(ids.find((id) => id !== cur(room))!);
  room.submit(cur(room), "station");
  room.endGame();
  room.playAgain();
  for (const p of room.players()) {
    assert.equal(p.lives, 0);
    assert.equal(p.alive, true);
    assert.equal(p.score, 0);
    assert.equal(p.ghostPoints, 0);
    assert.equal(p.bonusUsed.size, 0);
    assert.equal(p.comebackUsed, false);
    assert.equal(p.ghostStreak, 0);
  }
  const v = projectorView(room);
  assert.ok(v.players.every((p) => p.alive && p.lives === 0));
});

test("final 6: projector players carry a spectator flag", () => {
  const { room } = setup("classic", 2);
  const late = room.join("late-token", "Latecomer");
  assert.ok(late.ok);
  const byName = new Map(projectorView(room).players.map((p) => [p.nickname, p.spectator]));
  assert.equal(byName.get("Player0"), false);
  assert.equal(byName.get("Latecomer"), true);
});

test("final 7: everyone skip lets a ghost revived earlier in the round answer", async () => {
  const { room, clock, ids } = setup("everyone", 4, { startLives: 2 });
  const ghost = ids[0];
  room.context().loseLife(ghost);
  room.context().loseLife(ghost); // knocked out in round 1
  for (const id of ids.slice(1)) assert.deepEqual(room.submit(id, "station"), { ok: true, kind: "turn" });
  await clock.advance(room.bombRemaining()); // round 2 starts without the ghost
  assert.equal((room.modeView() as { round: number }).round, 2);
  room.context().revive(ghost, 1); // comes back mid-round
  assert.equal(room.isOn(ghost), false);
  room.skipPrompt();
  assert.equal(room.isOn(ghost), true);
  assert.deepEqual(room.submit(ghost, "station"), { ok: true, kind: "turn" });
});
