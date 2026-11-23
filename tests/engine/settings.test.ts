import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE_SETTINGS, THEME_IDS, resolveSettings, withChoices } from "../../src/engine/settings.ts";
import type { SettingDecl } from "../../src/engine/types.ts";

test("defaults fill missing keys", () => {
  const s = resolveSettings(CORE_SETTINGS, {});
  assert.equal(s.startLives, 2);
  assert.deepEqual(s.promptTypes, ["contains"]);
  assert.equal(s.mode, "classic");
  assert.equal(s.maxLives, 3);
  assert.deepEqual(s.bonusLetters, "abcdefghijklmnoprstuvwy".split(""));
});

test("numbers are clamped and stepped", () => {
  assert.equal(resolveSettings(CORE_SETTINGS, { startLives: 99 }).startLives, 5);
  assert.equal(resolveSettings(CORE_SETTINGS, { startLives: -3 }).startLives, 1);
  const half: SettingDecl[] = [
    { key: "t", label: "T", help: "", kind: "number", default: 1, min: 0, max: 10, step: 0.5 },
  ];
  assert.equal(resolveSettings(half, { t: 2.26 }).t, 2.5);
});

test("wrong types fall back to default", () => {
  assert.equal(resolveSettings(CORE_SETTINGS, { liveTyping: "yes" }).liveTyping, false);
  assert.equal(resolveSettings(CORE_SETTINGS, { band: "extreme" }).band, "mixed");
  assert.equal(resolveSettings(CORE_SETTINGS, { startLives: "3" }).startLives, 2);
  assert.equal(resolveSettings(CORE_SETTINGS, { startLives: NaN }).startLives, 2);
});

test("multi keeps only known options and never empties", () => {
  assert.deepEqual(resolveSettings(CORE_SETTINGS, { promptTypes: ["ends", "bogus"] }).promptTypes, ["ends"]);
  assert.deepEqual(resolveSettings(CORE_SETTINGS, { promptTypes: [] }).promptTypes, ["contains"]);
  assert.deepEqual(resolveSettings(CORE_SETTINGS, { promptTypes: ["bogus"] }).promptTypes, ["contains"]);
});

test("unknown keys are dropped", () => {
  const s = resolveSettings(CORE_SETTINGS, { evil: 1, startLives: 3 });
  assert.equal("evil" in s, false);
  assert.equal(s.startLives, 3);
  assert.deepEqual(Object.keys(s).sort(), CORE_SETTINGS.map((d) => d.key).sort());
});

test("bonusLetters is a multi of a-z the host can change", () => {
  const d = CORE_SETTINGS.find((x) => x.key === "bonusLetters")!;
  assert.equal(d.kind, "multi");
  if (d.kind !== "multi") return;
  assert.equal(d.options.length, 26);
  assert.deepEqual(d.options[0], { value: "a", label: "A" });
  assert.equal(d.default.length, 23);
  assert.deepEqual(resolveSettings(CORE_SETTINGS, { bonusLetters: ["q", "x", "1"] }).bonusLetters, ["q", "x"]);
});

test("mode and knockout options are left for the registry to fill", () => {
  for (const key of ["mode", "knockout"]) {
    const d = CORE_SETTINGS.find((x) => x.key === key)!;
    assert.ok(d.kind === "choice");
    assert.deepEqual(d.options, []);
  }
});

test("withChoices fills mode and knockout options from the lists given", () => {
  const out = withChoices(CORE_SETTINGS, [{ id: "m1", name: "Mode one" }], [{ id: "k1", name: "Knock one" }]);
  const mode = out.find((x) => x.key === "mode")!;
  const knockout = out.find((x) => x.key === "knockout")!;
  assert.ok(mode.kind === "choice" && knockout.kind === "choice");
  assert.deepEqual(mode.options, [{ value: "m1", label: "Mode one" }]);
  assert.deepEqual(knockout.options, [{ value: "k1", label: "Knock one" }]);
  assert.deepEqual(resolveSettings(out, { mode: "m1" }).mode, "m1");
  const core = CORE_SETTINGS.find((x) => x.key === "mode")!;
  assert.ok(core.kind === "choice" && core.options.length === 0, "CORE_SETTINGS is not changed");
});

test("theme setting is a choice over THEME_IDS, default workshop", () => {
  assert.deepEqual([...THEME_IDS], ["workshop", "enamel", "night-fuse"]);
  const d = CORE_SETTINGS.find((x) => x.key === "theme");
  assert.ok(d && d.kind === "choice");
  assert.equal(d.default, "workshop");
  assert.deepEqual(d.options.map((o) => o.value), [...THEME_IDS]);
  assert.equal(resolveSettings(CORE_SETTINGS, { theme: "nope" }).theme, "workshop");
  assert.equal(resolveSettings(CORE_SETTINGS, { theme: "night-fuse" }).theme, "night-fuse");
});
