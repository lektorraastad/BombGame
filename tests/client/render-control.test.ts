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
  medium: { contains: 30, starts: 30, ends: 30 },
  hard: { contains: 0, starts: 16, ends: 15 },
  mixed: { contains: 50, starts: 49, ends: 85 },
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
  assert.ok(!renderControl(view({ band: "medium", promptTypes: ["starts"] }), ui()).includes(`class="warning"`));
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
