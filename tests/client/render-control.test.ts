import { test } from "node:test";
import assert from "node:assert/strict";
import { renderControl, kickClick, promptWarnings } from "../../public/app/render-control.js";
import { AVATARS } from "../../public/app/avatars.js";
import { createRoom, settingsFor } from "../../src/engine/registry.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import { controlView } from "../../src/engine/views.ts";
import { makeDeps, makeTestChecker, fixtureBlocked, fixturePrompts } from "../engine/helpers.ts";
import type { SettingDecl } from "../../src/engine/types.ts";

const COUNTS = {
  easy: { contains: 20, starts: 3, ends: 40 },
  normal: { contains: 30, starts: 30, ends: 30 },
  rising: { contains: 12, starts: 2, ends: 20 },
  hard: { contains: 0, starts: 16, ends: 15 },
};

function view(settings: Record<string, unknown> = {}, phase = "lobby"): any {
  const { deps } = makeDeps(2);
  const room = createRoom({ code: "ABCD", deps, checker: makeTestChecker(), bank: createPromptBank(fixturePrompts), blockedNames: fixtureBlocked });
  room.join("t1", "Mia");
  room.join("t2", "Jon");
  room.updateSettings(settings);
  const v: any = { ...controlView(room), promptCounts: COUNTS };
  v.players[0].score = 4242;
  v.players[1].ghostPoints = 7373;
  v.phase = phase;
  v.paused = phase === "paused";
  return v;
}
const ui = (over: Record<string, unknown> = {}): any => ({ overlay: false, ...over });

/** The opening tag of the form control named `key` (the first one, for a group). */
function control(html: string, key: string): string {
  const m = html.match(new RegExp(`<(input|select)[^>]*name="${key}"[^>]*>`));
  assert.ok(m, `an input for ${key}`);
  return m[0];
}

test("control form is generated from settingDecls", () => {
  for (const [mode, knockout] of [["classic", "ghost"], ["everyone", "ghost"]]) {
    const v = view({ mode, knockout });
    const html = renderControl(v, ui());
    const decls: SettingDecl[] = settingsFor(mode, knockout);
    assert.deepEqual(v.settingDecls.map((d: SettingDecl) => d.key), decls.map((d) => d.key));
    for (const d of decls) {
      if (d.key === "preset") continue; // drawn as buttons, see below
      const tag = control(html, d.key);
      if (d.kind === "number") {
        assert.ok(tag.startsWith("<input") && tag.includes(`type="number"`), d.key);
        assert.ok(tag.includes(`min="${d.min}"`) && tag.includes(`max="${d.max}"`) && tag.includes(`step="${d.step}"`), d.key);
        assert.ok(tag.includes(`value="${v.settings[d.key]}"`), d.key);
      } else if (d.kind === "boolean") {
        assert.ok(tag.includes(`type="checkbox"`), d.key);
        assert.equal(tag.includes("checked"), v.settings[d.key] === true, d.key);
      } else if (d.kind === "choice") {
        assert.ok(tag.startsWith("<select"), d.key);
        for (const o of d.options) assert.ok(html.includes(`<option value="${o.value}"`), `${d.key}:${o.value}`);
        assert.ok(html.includes(`<option value="${v.settings[d.key]}" selected>`), d.key);
      } else {
        const boxes = html.match(new RegExp(`<input[^>]*name="${d.key}"[^>]*>`, "g")) ?? [];
        assert.equal(boxes.length, d.options.length, d.key);
        for (const b of boxes) assert.ok(b.includes(`type="checkbox"`), d.key);
        const on = boxes.filter((b) => b.includes("checked")).map((b) => b.match(/value="([^"]*)"/)![1]);
        assert.deepEqual(on, v.settings[d.key], d.key);
      }
    }
    assert.ok(html.includes(`class="lettergrid"`), "bonus letters as a grid");
    assert.ok(!html.includes("<fieldset class=\"settings\" disabled"), "editable in the lobby");
  }
  for (const phase of ["playing", "paused"]) {
    const html = renderControl(view({}, phase), ui());
    assert.ok(html.includes(`<fieldset class="settings" disabled>`), phase);
    assert.ok(html.includes("Settings are locked while a game is running"), phase);
  }
});

test("overlay hides private columns", () => {
  const full = renderControl(view(), ui());
  assert.ok(/score/i.test(full) && full.includes("4242"));
  assert.ok(/ghost points/i.test(full) && full.includes("7373"));
  const overlay = renderControl(view(), ui({ overlay: true }));
  assert.ok(!/score/i.test(overlay), "no score column");
  assert.ok(!/ghost points/i.test(overlay), "no ghost points column");
  assert.ok(!overlay.includes("4242") && !overlay.includes("7373"));
  assert.ok(!/passcode/i.test(overlay));
  assert.ok(overlay.includes("Mia") && overlay.includes("Jon"), "players are still listed");
});

test("few-prompts warning appears for starts/easy", () => {
  const easyStarts = renderControl(view({ band: "easy", promptTypes: ["contains", "starts"] }), ui());
  assert.ok(easyStarts.includes(`class="warning"`));
  assert.ok(easyStarts.includes("Only 3 &quot;Starts with&quot; prompts at Easy"));
  assert.ok(!easyStarts.includes("Contains&quot; prompts"), "contains/easy has 20");
  assert.ok(!renderControl(view({ band: "normal", promptTypes: ["starts"] }), ui()).includes(`class="warning"`));
  assert.deepEqual(promptWarnings(COUNTS, "rising", ["starts"]), [
    `Only 2 "Starts with" prompts at Rising. They will repeat often`,
  ]);
  assert.deepEqual(promptWarnings(COUNTS, "hard", ["contains", "ends"]), [
    `No "Contains" prompts at Hard`,
  ]);
  assert.deepEqual(promptWarnings(COUNTS, "hard", ["starts", "ends"]), []);
  assert.deepEqual(promptWarnings(undefined, "easy", ["starts"]), []);
});

test("kick needs a second click", () => {
  const first = kickClick(null, "p1");
  assert.deepEqual(first, { send: false, pending: "p1" });
  assert.deepEqual(kickClick(first.pending, "p1"), { send: true, pending: null });
  assert.deepEqual(kickClick("p1", "p2"), { send: false, pending: "p2" }, "another player's button starts over");
  const v = view();
  const id = v.players[0].id;
  const idle = renderControl(v, ui());
  assert.ok(idle.includes(`data-action="kick" data-pid="${id}">Kick</button>`));
  assert.ok(!idle.includes("Really kick?"));
  const armed = renderControl(v, ui({ confirmKick: id }));
  assert.ok(armed.includes(`data-action="kick" data-pid="${id}">Really kick?</button>`));
  assert.equal(armed.match(/Really kick\?/g)?.length, 1);
});

test("rename is an inline field, and names are escaped", () => {
  const v = view();
  v.players[1].nickname = `<img src=x>`;
  const id = v.players[0].id;
  const html = renderControl(v, ui({ renaming: id }));
  assert.ok(html.includes(`<input class="rename" data-pid="${id}"`));
  assert.ok(html.includes(`value="Mia"`));
  assert.ok(!html.includes("<img src=x") && html.includes("&lt;img src=x&gt;"));
});

test("game buttons follow the phase", () => {
  const btn = (html: string, cmd: string) => html.match(new RegExp(`<button[^>]*data-cmd="${cmd}"[^>]*>([^<]*)<`));
  const lobby = renderControl(view(), ui());
  for (const cmd of ["start", "pause", "skip", "end", "playAgain", "lock"]) assert.ok(btn(lobby, cmd), cmd);
  assert.ok(!btn(lobby, "start")![0].includes("disabled"));
  assert.ok(btn(lobby, "skip")![0].includes("disabled"));
  const paused = renderControl(view({}, "paused"), ui());
  assert.equal(btn(paused, "resume")![1], "Resume");
  assert.ok(btn(paused, "start")![0].includes("disabled"));
  const results = renderControl(view({}, "results"), ui());
  assert.ok(!btn(results, "playAgain")![0].includes("disabled"));
  const locked = view();
  locked.locked = true;
  assert.equal(btn(renderControl(locked, ui()), "unlock")![1], "Unlock");
});

test("theme picker sits outside the locked settings, in overlay mode too", () => {
  for (const phase of ["lobby", "playing", "paused"]) {
    for (const overlay of [false, true]) {
      const html = renderControl(view({ theme: "enamel" }, phase), ui({ overlay }));
      const look = html.match(/<fieldset class="look"><legend>Look<\/legend>([\s\S]*?)<\/fieldset>/);
      assert.ok(look, `${phase} overlay=${overlay}: a Look fieldset`);
      assert.ok(look[1].includes(`<select name="theme">`), "the theme select is in it");
      assert.ok(look[1].includes(`<option value="enamel" selected>Enamel</option>`));
      const locked = html.match(/<fieldset class="settings"[^>]*>[\s\S]*?<\/fieldset><\/form>|<fieldset class="settings"[^>]*>[\s\S]*$/)![0];
      assert.ok(!locked.includes(`name="theme"`), "not in the settings fieldset");
      assert.equal(html.match(/name="theme"/g)?.length, 1, "only once");
      assert.ok(!/<fieldset class="look"[^>]*disabled/.test(html), "never disabled");
    }
  }
});

test("each player row shows the player's emoji, in overlay mode too", () => {
  for (const overlay of [false, true]) {
    const v = view();
    const html = renderControl(v, ui({ overlay }));
    for (const p of v.players) {
      const row = html.split("<tr>").find((r) => r.includes(`data-pid="${p.id}"`)) ?? "";
      assert.ok(row.includes(`<img class="avatar`) && row.includes(`alt="${AVATARS[p.avatar].label}"`), `${p.nickname} overlay=${overlay}`);
    }
  }
});

/** The Settings fieldset's inner HTML. */
const settingsSet = (html: string) => html.match(/<fieldset class="settings"[^>]*>([\s\S]*)<\/fieldset><\/form>/)![1];
const presetBtn = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-preset="${id}"[^>]*>([^<]*)</button>`));

test("settings: Mode, the setup buttons, Using, the warnings, then More settings holding the rest", () => {
  for (const mode of ["classic", "everyone"]) {
    const v = view({ mode, band: "easy", promptTypes: ["contains", "starts"] });
    const html = renderControl(v, ui());
    const set = settingsSet(html);
    const at = (s: string) => {
      const i = set.indexOf(s);
      assert.ok(i >= 0, `${mode}: ${s}`);
      return i;
    };
    const order = [at(`<select name="mode">`), at(`data-preset="gentle"`), at(`data-preset="normal"`), at(`data-preset="fast"`),
      at("Using: "), at(`class="warning"`), at(`<details class="more"><summary>More settings</summary>`)];
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${mode}: in order`);
    const more = set.slice(set.indexOf(`<details class="more">`));
    assert.ok(more.endsWith("</details>"), "the fold closes the fieldset");
    const keys = v.settingDecls.map((d: SettingDecl) => d.key).filter((k: string) => !["mode", "preset", "theme"].includes(k));
    const inMore = [...more.matchAll(/<(?:input|select)[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(inMore)], keys, `${mode}: every other setting, in today's order`);
    assert.ok(!more.includes(`class="warning"`), "warnings are never folded away");
    assert.ok(!set.includes(`name="theme"`), "theme stays under Look");
  }
});

test("the setup is three buttons, never a select, pressed to match the view", () => {
  for (const id of ["gentle", "normal", "fast"]) {
    const html = renderControl(view({ preset: id }), ui());
    assert.ok(!html.includes(`name="preset"`), "no form control for preset");
    for (const [other, label] of [["gentle", "Gentle"], ["normal", "Normal"], ["fast", "Fast"]]) {
      const b = presetBtn(html, other);
      assert.ok(b, other);
      assert.ok(b[0].startsWith(`<button type="button" data-preset="${other}" aria-pressed="${other === id}"`), b[0]);
      assert.equal(b[1], label);
    }
    assert.ok(!html.includes(`data-preset="custom"`), "Custom is never a button");
    assert.ok(html.includes(`Using: ${id[0].toUpperCase()}${id.slice(1)}`));
  }
  const custom = renderControl(view({ preset: "gentle", fuseMin: 20 }), ui());
  assert.ok(custom.includes("Using: Custom"));
  assert.ok(!custom.includes(`aria-pressed="true"`), "nothing pressed under Custom");
});

test("while a game runs the setup buttons are disabled and the locked note shows", () => {
  for (const phase of ["playing", "paused"]) {
    const html = renderControl(view({}, phase), ui());
    for (const id of ["gentle", "normal", "fast"]) assert.ok(presetBtn(html, id)![0].includes(" disabled"), `${phase} ${id}`);
    assert.ok(html.includes("Settings are locked while a game is running"));
  }
  for (const id of ["gentle", "normal", "fast"]) assert.ok(!presetBtn(renderControl(view(), ui()), id)![0].includes("disabled"));
});

test("More settings is folded unless the page says it is open, in overlay mode too", () => {
  for (const overlay of [false, true]) {
    assert.ok(renderControl(view(), ui({ overlay })).includes(`<details class="more"><summary>`));
    assert.ok(renderControl(view(), ui({ overlay, moreOpen: true })).includes(`<details class="more" open><summary>`));
  }
});

test("the control panel shows Show words, disabled on the words step, and Copy words", () => {
  const btn = (html: string, cmd: string) => html.match(new RegExp(`<button[^>]*data-cmd="${cmd}"[^>]*>([^<]*)<`));
  const copy = (html: string) => html.match(/<button[^>]*data-copy-words[^>]*>([^<]*)</);
  const fallback = (html: string) => html.match(/<textarea[^>]*data-copy-fallback[^>]*>([^<]*)<\/textarea>/);
  const results = (step: string, words = ["apple", "milk"]) => ({ ...view({}, "results"), results: { winners: [], awards: [], words, step }, words });
  for (const overlay of [false, true]) {
    const html = renderControl(results("awards"), ui({ overlay }));
    assert.equal(btn(html, "showWords")![1], "Show words");
    assert.ok(!btn(html, "showWords")![0].includes("disabled"));
    assert.equal(copy(html)![1], "Copy words");
    assert.ok(!copy(html)![0].includes("disabled"));
    const box = fallback(html);
    assert.ok(box && box[0].includes("readonly") && box[0].includes("hidden"), "the fallback box waits, hidden");
    assert.equal(box[1], "apple\nmilk");
  }
  const wall = renderControl(results("words"), ui());
  assert.ok(btn(wall, "showWords")![0].includes("disabled"));
  assert.ok(!copy(wall)![0].includes("disabled"), "Copy words works on the wall too");
  assert.equal(copy(renderControl(results("words"), ui({ copied: true })))![1], "Copied");
  const shown = fallback(renderControl(results("words"), ui({ copyFallback: true })));
  assert.ok(shown && !shown[0].includes("hidden"), "the box shows when the clipboard refuses");
  assert.ok(copy(renderControl(results("words", []), ui()))![0].includes("disabled"), "nothing to copy");
  for (const phase of ["lobby", "playing", "paused"]) {
    const html = renderControl(view({}, phase), ui());
    assert.ok(!btn(html, "showWords") && !copy(html) && !fallback(html), phase);
  }
});

test("the copy fallback box escapes the words", () => {
  const v = { ...view({}, "results"), results: { winners: [], awards: [], words: ["<b>x</b>"], step: "words" }, words: ["<b>x</b>"] };
  const html = renderControl(v, ui({ copyFallback: true }));
  assert.ok(!html.includes("<b>x"));
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
});
