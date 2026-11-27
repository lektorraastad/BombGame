import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../../src/engine/room.ts";
import { classicMode } from "../../src/engine/modes/classic.ts";
import { everyoneMode } from "../../src/engine/modes/everyone.ts";
import { ghostActivity } from "../../src/engine/knockout/ghost.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import { PRESETS, PRESET_IDS, presetOf } from "../../src/engine/presets.ts";
import { CORE_SETTINGS } from "../../src/engine/settings.ts";
import type { Prompt } from "../../src/engine/types.ts";
import { controlView } from "../../src/engine/views.ts";
import { makeDeps, makeTestChecker, fixtureBlocked } from "./helpers.ts";

const ST: Prompt = { text: "st", type: "contains", count: 480, common: 40 };

function makeRoom() {
  const { deps } = makeDeps(3);
  return new Room({
    code: "ABCD",
    deps,
    checker: makeTestChecker(),
    bank: createPromptBank([ST]),
    blockedNames: fixtureBlocked,
    modes: [classicMode, everyoneMode],
    activities: [ghostActivity],
  });
}

const CLASSIC_KEYS = ["band", "startLives", "maxLives", "fuseMin", "fuseMax", "minTurn", "turnTime"];
const pick = (s: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, s[k]]));

test("the setups are Gentle, Normal and Fast with the agreed values", () => {
  assert.deepEqual([...PRESET_IDS], ["gentle", "normal", "fast"]);
  assert.deepEqual(PRESETS.gentle, { band: "easy", startLives: 3, maxLives: 3, fuseMin: 15, fuseMax: 40, minTurn: 10, turnTime: 18, roundTime: 25 });
  assert.deepEqual(PRESETS.normal, { band: "normal", startLives: 2, maxLives: 3, fuseMin: 10, fuseMax: 30, minTurn: 8, turnTime: 12, roundTime: 15 });
  assert.deepEqual(PRESETS.fast, { band: "normal", startLives: 2, maxLives: 3, fuseMin: 6, fuseMax: 20, minTurn: 5, turnTime: 8, roundTime: 10 });
});

test("PRESETS.normal equals today's defaults", () => {
  const classic = makeRoom();
  const everyone = makeRoom();
  everyone.updateSettings({ mode: "everyone" });
  for (const [k, v] of Object.entries(PRESETS.normal)) {
    const got = k in classic.settings ? classic.settings[k] : everyone.settings[k];
    assert.equal(got, v, k);
  }
  // also against a room that never chose anything (Everyone at once defaults)
  assert.equal(everyone.settings.roundTime, 15);
});

test("the preset core setting sits right after mode", () => {
  assert.equal(CORE_SETTINGS[0].key, "mode");
  const d = CORE_SETTINGS[1];
  assert.equal(d.key, "preset");
  assert.equal(d.label, "Setup");
  assert.ok(d.kind === "choice");
  assert.equal(d.default, "normal");
  assert.deepEqual(d.options.map((o) => o.value), ["gentle", "normal", "fast", "custom"]);
});

test("a new room uses Normal", () => {
  const room = makeRoom();
  assert.equal(room.settings.preset, "normal");
  assert.equal(presetOf(room.settings), "normal");
});

test("choosing Gentle sets its values for Classic", () => {
  const room = makeRoom();
  assert.deepEqual(room.updateSettings({ preset: "gentle" }), { ok: true });
  assert.equal(room.settings.preset, "gentle");
  assert.deepEqual(pick(room.settings, CLASSIC_KEYS), pick(PRESETS.gentle, CLASSIC_KEYS));
  assert.equal("roundTime" in room.settings, false);
});

test("choosing Fast, then Normal, gives each one's values", () => {
  const room = makeRoom();
  room.updateSettings({ preset: "fast" });
  assert.deepEqual(pick(room.settings, CLASSIC_KEYS), pick(PRESETS.fast, CLASSIC_KEYS));
  assert.equal(room.settings.preset, "fast");
  room.updateSettings({ preset: "normal" });
  assert.deepEqual(pick(room.settings, CLASSIC_KEYS), pick(PRESETS.normal, CLASSIC_KEYS));
  assert.equal(room.settings.preset, "normal");
});

test("a manual change makes it Custom; changing it back makes it Gentle again", () => {
  const room = makeRoom();
  room.updateSettings({ preset: "gentle" });
  room.updateSettings({ fuseMin: 12 });
  assert.equal(room.settings.preset, "custom");
  assert.equal(room.settings.fuseMin, 12);
  room.updateSettings({ fuseMin: 15 });
  assert.equal(room.settings.preset, "gentle");
});

test("a change to a key a setup leaves alone keeps the setup", () => {
  const room = makeRoom();
  room.updateSettings({ preset: "gentle" });
  room.updateSettings({ liveTyping: false, theme: "enamel", timerStyle: "visible" });
  assert.equal(room.settings.preset, "gentle");
});

test("{ preset: gentle, fuseMin: 20 } gives Gentle with fuseMin 20 and preset custom", () => {
  const room = makeRoom();
  room.updateSettings({ preset: "gentle", fuseMin: 20 });
  assert.equal(room.settings.fuseMin, 20);
  assert.equal(room.settings.fuseMax, 40);
  assert.equal(room.settings.minTurn, 10);
  assert.equal(room.settings.turnTime, 18);
  assert.equal(room.settings.band, "easy");
  assert.equal(room.settings.startLives, 3);
  assert.equal(room.settings.preset, "custom");
});

test("switching mode keeps Gentle's values", () => {
  const room = makeRoom();
  room.updateSettings({ preset: "gentle" });
  room.updateSettings({ mode: "everyone" });
  assert.equal(room.settings.roundTime, 25);
  assert.equal(room.settings.band, "easy");
  assert.equal(room.settings.startLives, 3);
  assert.equal(room.settings.preset, "gentle");
  room.updateSettings({ mode: "classic" });
  assert.equal(room.settings.fuseMin, 15);
  assert.equal(room.settings.fuseMax, 40);
  assert.equal(room.settings.minTurn, 10);
  assert.equal(room.settings.turnTime, 18);
  assert.equal(room.settings.preset, "gentle");
});

test("Custom is not reapplied on a mode switch", () => {
  const room = makeRoom();
  room.updateSettings({ preset: "gentle", fuseMin: 20 });
  assert.equal(room.settings.preset, "custom");
  room.updateSettings({ mode: "everyone" });
  assert.equal(room.settings.roundTime, 15, "today's behaviour: the new mode's own defaults");
  assert.equal(room.settings.band, "easy", "core values stay as they were");
  assert.equal(room.settings.preset, "custom");
});

test("{ preset: custom } is accepted and changes nothing else", () => {
  const room = makeRoom();
  room.updateSettings({ preset: "gentle" });
  const before = { ...room.settings };
  assert.deepEqual(room.updateSettings({ preset: "custom" }), { ok: true });
  assert.deepEqual({ ...room.settings, preset: before.preset }, before);
  assert.equal(room.settings.preset, "custom");
});

test("a junk preset is ignored", () => {
  const room = makeRoom();
  room.updateSettings({ preset: "gentle" });
  const before = { ...room.settings };
  for (const junk of ["extreme", 3, null, ["gentle"], { gentle: 1 }, "", "__proto__"]) {
    assert.deepEqual(room.updateSettings({ preset: junk }), { ok: true });
    assert.deepEqual(room.settings, before);
  }
  const fresh = makeRoom();
  fresh.updateSettings({ preset: "extreme" });
  assert.equal(fresh.settings.preset, "normal");
});

test("a running game refuses a preset change", () => {
  const room = makeRoom();
  for (let i = 0; i < 2; i++) assert.ok(room.join("tok" + i, "Player" + i).ok);
  assert.deepEqual(room.start(), { ok: true });
  const before = { ...room.settings };
  assert.deepEqual(room.updateSettings({ preset: "fast" }), { ok: false, reason: "game-running" });
  assert.deepEqual(room.settings, before);
  assert.deepEqual(room.updateSettings({ theme: "enamel" }), { ok: true });
  assert.equal(room.settings.preset, "normal");
});

test("a setup never changes mode, theme, timerStyle or the other untouched keys", () => {
  const room = makeRoom();
  const untouched = {
    theme: "night-fuse", timerStyle: "visible", promptTypes: ["starts", "ends"], bonusAlphabet: false,
    bonusLetters: ["a", "b"], exampleAnswers: false, liveTyping: false, silentAnswers: false,
    comeback: false, comebackStreak: 5,
  };
  room.updateSettings(untouched);
  for (const id of PRESET_IDS) {
    room.updateSettings({ preset: id });
    assert.equal(room.settings.mode, "classic");
    assert.equal(room.settings.knockout, "ghost");
    assert.deepEqual(pick(room.settings, Object.keys(untouched)), untouched, id);
  }
  room.updateSettings({ mode: "everyone", shrinking: true });
  for (const id of PRESET_IDS) {
    room.updateSettings({ preset: id });
    assert.equal(room.settings.mode, "everyone");
    assert.equal(room.settings.shrinking, true, id);
  }
});

test("presetOf looks only at the keys present", () => {
  assert.equal(presetOf({ band: "easy", startLives: 3, maxLives: 3, roundTime: 25 }), "gentle");
  assert.equal(presetOf({ band: "normal", startLives: 2, maxLives: 3, roundTime: 10 }), "fast");
  assert.equal(presetOf({ band: "normal", startLives: 2, maxLives: 3, roundTime: 11 }), "custom");
  assert.equal(presetOf({ ...PRESETS.normal, fuseMin: 11 }), "custom");
});

test("the control view reports the active setup", () => {
  const room = makeRoom();
  assert.equal(controlView(room).settings.preset, "normal");
  room.updateSettings({ preset: "fast" });
  assert.equal(controlView(room).settings.preset, "fast");
});
