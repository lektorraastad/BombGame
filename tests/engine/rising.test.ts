import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../../src/engine/room.ts";
import type { PlayerId } from "../../src/engine/room.ts";
import { classicMode } from "../../src/engine/modes/classic.ts";
import { everyoneMode } from "../../src/engine/modes/everyone.ts";
import { createPromptBank, levelOf } from "../../src/engine/prompts.ts";
import type { PromptBank } from "../../src/engine/prompts.ts";
import { createWordChecker } from "../../src/engine/words.ts";
import type { Prompt } from "../../src/engine/types.ts";
import { projectorView, controlView, playerView } from "../../src/engine/views.ts";
import { makeDeps, fixtureBlocked } from "./helpers.ts";

// Each prompt's first letter names its level: v very easy, e easy, m medium, h hard.
const LEVELLED: Prompt[] = [
  { text: "va", type: "contains", count: 300, common: 30 },
  { text: "vb", type: "contains", count: 300, common: 20 },
  { text: "vc", type: "contains", count: 300, common: 15 },
  { text: "ea", type: "contains", count: 200, common: 14 },
  { text: "eb", type: "contains", count: 200, common: 10 },
  { text: "ec", type: "contains", count: 200, common: 8 },
  { text: "ma", type: "contains", count: 100, common: 7 },
  { text: "mb", type: "contains", count: 100, common: 4 },
  { text: "ha", type: "contains", count: 50, common: 3 },
  { text: "hb", type: "contains", count: 50, common: 0 },
];
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
/** Every prompt text followed by two letters, so each prompt has 676 answers. */
const DICTIONARY = LEVELLED.flatMap((p) => [...LETTERS].flatMap((a) => [...LETTERS].map((b) => p.text + a + b)));

function setup(mode: "classic" | "everyone", n = 4, seed = 3, settings: Record<string, unknown> = {}) {
  const { deps, clock } = makeDeps(seed);
  const real = createPromptBank(LEVELLED);
  const stages: unknown[] = [];
  const dealt: Prompt[] = [];
  const bank: PromptBank = {
    size: (band, types) => real.size(band, types),
    next(opts) {
      stages.push(opts.stage);
      const p = real.next(opts);
      dealt.push(p);
      return p;
    },
  };
  const room = new Room({
    code: "ABCD",
    deps,
    checker: createWordChecker({ dictionary: DICTIONARY, known: [], blocked: fixtureBlocked }),
    bank,
    blockedNames: fixtureBlocked,
    modes: [classicMode, everyoneMode],
  });
  const ids: PlayerId[] = [];
  for (let i = 0; i < n; i++) {
    const j = room.join("tok" + i, "Player" + i);
    assert.ok(j.ok);
    if (j.ok) ids.push(j.playerId);
  }
  room.updateSettings({ mode, band: "rising", startLives: 3, ...settings });
  assert.deepEqual(room.start(), { ok: true });
  const used = new Set<string>();
  /** An unused word for the current prompt. */
  const answer = () => {
    const text = room.context().prompt()!.text;
    const w = DICTIONARY.find((d) => d.startsWith(text) && !used.has(d))!;
    used.add(w);
    return w;
  };
  return { room, clock, ids, stages, dealt, answer };
}

const current = (room: Room) => (room.mode()!.view(room.context()) as { current: PlayerId }).current;
const round = (room: Room) => (room.mode()!.view(room.context()) as { round: number }).round;

/** Classic: the player on submits a valid word, which deals the next prompt. */
function play(s: ReturnType<typeof setup>, words: number) {
  for (let i = 0; i < words; i++) {
    assert.deepEqual(s.room.submit(current(s.room), s.answer()), { ok: true, kind: "turn" });
  }
}

test("rising in classic: first lap very easy, second lap adds easy, then normal", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = setup("classic", 4, seed);
    play(s, 59);
    assert.equal(s.dealt.length, 60);
    assert.deepEqual(s.stages.slice(0, 9), [1, 1, 1, 1, 2, 2, 2, 2, 3]);
    assert.ok(s.stages.slice(8).every((x) => x === 3), "stage stops at 3");
    const levels = s.dealt.map(levelOf);
    assert.ok(levels.slice(0, 4).every((l) => l === "veryEasy"), `seed ${seed}: ${levels.slice(0, 4)}`);
    assert.ok(levels.slice(4, 8).every((l) => l === "veryEasy" || l === "easy"), `seed ${seed}: ${levels.slice(4, 8)}`);
    assert.ok(levels.slice(8).includes("medium"), `seed ${seed}: medium appears from prompt 9`);
    assert.ok(!levels.includes("hard"));
  }
});

test("rising in everyone at once follows the round", async () => {
  const s = setup("everyone", 3, 7);
  assert.equal(round(s.room), 1);
  // Round 1: two prompts by skipping, both stage 1 (skips don't change the round).
  s.room.skipPrompt();
  assert.deepEqual(s.stages, [1, 1]);
  for (const want of [2, 3, 4]) {
    for (const id of s.ids) s.room.submit(id, s.answer());
    await s.clock.advance(s.room.bombRemaining());
    assert.equal(round(s.room), want);
  }
  assert.deepEqual(s.stages, [1, 1, 2, 3, 3]);
  assert.equal(levelOf(s.dealt[0]), "veryEasy");
  assert.equal(levelOf(s.dealt[1]), "veryEasy");
  assert.ok(["veryEasy", "easy"].includes(levelOf(s.dealt[2])));
});

test("rising in everyone at once: medium can appear from round 3", async () => {
  const s = setup("everyone", 2, 11);
  for (let r = 1; r < 40; r++) {
    for (const id of s.ids) s.room.submit(id, s.answer());
    await s.clock.advance(s.room.bombRemaining());
  }
  const levels = s.dealt.map(levelOf);
  assert.ok(levels.slice(0, 2).every((l) => l !== "medium"));
  assert.ok(levels.slice(2).includes("medium"));
});

test("rising never goes back down when players leave", () => {
  const s = setup("classic", 4, 9);
  play(s, 5); // prompts 1-4 are lap 1; prompts 5 and 6 are lap 2
  assert.deepEqual(s.stages, [1, 1, 1, 1, 2, 2]);
  const on = current(s.room);
  const others = s.ids.filter((id) => id !== on);
  s.room.kick(others[0]);
  s.room.kick(others[1]);
  assert.equal(s.stages.length, 6, "kicking players who are not on deals nothing");
  play(s, 6);
  // Lap 2 still ends after its 4 prompts; then laps are 2 prompts long, all at stage 3.
  assert.deepEqual(s.stages, [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
});

test("rising: a smaller room has shorter laps", () => {
  const s = setup("classic", 2, 4);
  play(s, 5);
  assert.deepEqual(s.stages, [1, 1, 2, 2, 3, 3]);
});

test("skips count towards the lap", () => {
  const s = setup("classic", 3, 5);
  s.room.skipPrompt();
  s.room.skipPrompt();
  s.room.skipPrompt();
  assert.deepEqual(s.stages, [1, 1, 1, 2]);
  play(s, 1);
  s.room.skipPrompt();
  s.room.skipPrompt();
  assert.deepEqual(s.stages, [1, 1, 1, 2, 2, 2, 3]);
});

test("a new game starts again at lap 1", () => {
  const s = setup("classic", 2, 6);
  play(s, 4);
  s.room.endGame();
  s.room.playAgain();
  assert.deepEqual(s.room.start(), { ok: true });
  assert.equal(s.stages.at(-1), 1);
});

test("lap and stage stay private: no view shows them", () => {
  const s = setup("classic", 4, 8);
  play(s, 9);
  const views = [projectorView(s.room), controlView(s.room), playerView(s.room, s.ids[0])];
  for (const v of views) {
    const json = JSON.stringify(v);
    assert.ok(!/"lap|"stage|"dealt/i.test(json), json);
  }
});
