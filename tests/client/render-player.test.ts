import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPlayer, reasonText, renderPicker } from "../../public/app/render-player.js";
import { AVATARS } from "../../public/app/avatars.js";

const players = [
  { id: "p1", nickname: "Mia", lives: 3, alive: true, connected: true, spectator: false },
  { id: "p2", nickname: "Jon", lives: 2, alive: true, connected: true, spectator: false },
];
function view(over: Record<string, unknown> = {}, me: Record<string, unknown> = {}): any {
  return {
    code: "ABCD", phase: "playing", paused: false, locked: false, players,
    prompt: { text: "an", type: "contains" },
    mode: { seats: ["p1", "p2"], current: "p1", lastWord: null },
    me: { nickname: "Mia", lives: 3, alive: true, score: 0, isOn: true, bonusLeft: [], canAnswerSilently: false, ...me },
    ...over,
  };
}
const ui = (over: Record<string, unknown> = {}): any => ({ countdownMs: 5000, status: "open", ...over });

test("render escapes nicknames and words", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const lobby = renderPlayer(view({ phase: "lobby", prompt: null, mode: null, players: [{ ...players[0], nickname: evil }] }), ui());
  assert.ok(!lobby.includes("<img src=x"), "no raw tag");
  assert.ok(lobby.includes("&lt;img src=x onerror=alert(1)&gt;"));
  const playing = renderPlayer(
    view({ mode: { seats: ["p1", "p2"], current: "p2", lastWord: { pid: "p2", word: evil } } }, { isOn: false }),
    ui(),
  );
  assert.ok(!playing.includes("<img"));
  assert.ok(playing.includes("&lt;img"));
  assert.ok(playing.includes("Last word"));
});

test("lobby lists names and credits-free waiting text", () => {
  const html = renderPlayer(view({ phase: "lobby", prompt: null, mode: null }), ui({ countdownMs: null }));
  assert.ok(html.includes("Waiting for the host"));
  assert.ok(html.includes("Mia") && html.includes("Jon"));
});

test("my turn vs waiting vs ghost vs spectator states", () => {
  const mine = renderPlayer(view(), ui());
  assert.ok(mine.includes("Type a word that CONTAINS"));
  assert.ok(mine.includes(">AN<"));
  assert.ok(mine.includes("my-turn"));
  assert.ok(mine.includes("❤❤❤") || mine.includes("♥♥♥"));

  const starts = renderPlayer(view({ prompt: { text: "st", type: "starts" } }), ui());
  assert.ok(starts.includes("STARTS WITH"));
  const ends = renderPlayer(view({ prompt: { text: "ing", type: "ends" } }), ui());
  assert.ok(ends.includes("ENDS WITH"));

  const waiting = renderPlayer(view({ mode: { seats: ["p1", "p2"], current: "p2", lastWord: null } }, { isOn: false }), ui());
  assert.ok(!waiting.includes("my-turn"));
  assert.ok(waiting.includes("Wait for your turn"));
  assert.ok(!waiting.includes("Answer silently"));
  const silent = renderPlayer(view({ mode: { seats: ["p1", "p2"], current: "p2", lastWord: null } }, { isOn: false, canAnswerSilently: true }), ui());
  assert.ok(silent.includes("Answer silently for points"));
  assert.ok(!silent.includes("Wait for your turn"));
  assert.ok(waiting.includes("Jon's turn"));

  const ghost = renderPlayer(
    view({}, { alive: false, lives: 0, isOn: false, activity: { ghostPoints: 7, streak: 2, comebackAvailable: true, comebackStreak: 3 } }),
    ui(),
  );
  assert.ok(ghost.includes("YOU'RE OUT — keep playing as a ghost"));
  assert.ok(ghost.includes("Ghost points: 7"));
  assert.ok(ghost.includes("Comeback: 2 of 3"));
  assert.ok(ghost.includes("Mia's turn"));
  assert.ok(!waiting.includes("YOU'RE OUT"));

  const spectator = renderPlayer(
    view({ players: [{ ...players[0], spectator: true }, players[1]] }, { alive: false, isOn: false }),
    ui(),
  );
  assert.ok(spectator.includes("You'll join the next game"));
  assert.ok(!spectator.includes("YOU'RE OUT"));
});

test("everyone mode, paused, results and connection banner", () => {
  const every = renderPlayer(view({ mode: { round: 1, answered: [] } }, { isOn: false }), ui());
  assert.ok(every.includes("Everyone"));
  const paused = renderPlayer(view({ paused: true, phase: "paused" }), ui());
  assert.ok(paused.includes("Paused"));
  const results = renderPlayer(
    view({
      phase: "results", prompt: null,
      results: { winners: ["p2"], ghostBoard: [], longestWord: { nickname: "Jon", word: "banana" } },
    }),
    ui({ countdownMs: null }),
  );
  assert.ok(results.includes("Game over"));
  assert.ok(results.includes("Jon") && results.includes("banana"));
  const lost = renderPlayer(view(), ui({ status: "reconnecting" }));
  assert.ok(lost.includes("Reconnecting"));
  assert.ok(!renderPlayer(view(), ui()).includes("Reconnecting"));
});

test("last result shows plain English", () => {
  assert.ok(renderPlayer(view(), ui({ lastResult: { ok: true, kind: "turn" } })).includes("✓ +1"));
  const bad = renderPlayer(view(), ui({ lastResult: { ok: false, reason: "not-a-word" } }));
  assert.ok(bad.includes("✗ Not a word in our dictionary"));
  const miss = renderPlayer(view(), ui({ lastResult: { ok: false, reason: "doesnt-match" } }));
  assert.ok(miss.includes("Doesn&#39;t contain AN") || miss.includes("Doesn't contain AN"));
});

test("reasons are in plain English", () => {
  const engine = [
    "not-playing", "paused", "empty", "too-long", "bad-characters", "not-a-word",
    "doesnt-match", "used", "blocked", "not-your-turn",
  ];
  const hub = [
    "bad-message", "no-passcode-set", "wrong-passcode", "too-many-attempts", "server-full", "no-room",
    "not-host", "already-joined", "not-player", "locked", "full", "kicked", "name-length", "name-blocked",
    "not-found", "need-2-players", "no-prompts", "already-running", "unknown-mode", "game-running",
    "avatar-taken", "avatar-locked", "bad-avatar",
  ];
  for (const r of [...engine, ...hub, "something-new"]) {
    const t = reasonText(r);
    assert.ok(t.length > 3, r);
    assert.notEqual(t, r);
    assert.ok(!t.includes("-"), `${r} -> ${t} looks like a code`);
  }
  assert.equal(reasonText("not-a-word"), "Not a word in our dictionary");
  assert.equal(reasonText("used"), "Already used");
  assert.equal(reasonText("not-your-turn"), "Not your turn yet");
  assert.equal(reasonText("doesnt-match", { text: "an", type: "contains" }), "Doesn't contain AN");
  assert.equal(reasonText("doesnt-match", { text: "st", type: "starts" }), "Doesn't start with ST");
  assert.equal(reasonText("doesnt-match", { text: "ing", type: "ends" }), "Doesn't end with ING");
});

const bomb = (over: Record<string, unknown> = {}): any =>
  ({ lit: true, arrow: null, countdownMs: 5000, fuse: null, explosion: null, ...over });

test("the bomb on the player screen is drawn from ui.bomb, without an arrow for now", async () => {
  const html = renderPlayer(view(), ui({ bomb: bomb({ explosion: { elapsedMs: 100 }, arrow: { from: 0, to: 90, elapsedMs: 50 } }) }));
  assert.match(html, /data-bomb/);
  assert.match(html, /data-countdown>5</);
  assert.ok(html.includes("bomb-burst"), "the explosion from the motion tracker");
  assert.ok(!html.includes("bomb-arrow"), "no arrow on student screens yet");
  const waiting = renderPlayer(view({ mode: { seats: ["p1", "p2"], current: "p2", lastWord: null } }, { isOn: false }), ui({ bomb: bomb() }));
  assert.match(waiting, /class="[^"]*\bflame\b/, "a lit bomb");
  // As before: no bomb without a visible timer, and none in the lobby.
  assert.ok(!renderPlayer(view(), ui({ countdownMs: null, bomb: bomb({ countdownMs: null }) })).includes("data-bomb"));
  assert.ok(!renderPlayer(view({ phase: "lobby", prompt: null, mode: null }), ui({ countdownMs: null })).includes("data-bomb"));
  // Without ui.bomb, a still lit bomb with the number.
  const plain = renderPlayer(view(), ui());
  assert.match(plain, /data-bomb/);
  assert.match(plain, /data-countdown>5</);
  const mod: Record<string, unknown> = await import("../../public/app/render-player.js");
  assert.equal("BOMB_SVG" in mod, false, "the old bomb drawing is gone");
});

// ---- the emoji picker ----

const withAvatars = [
  { ...players[0], avatar: 5 },
  { ...players[1], avatar: 7 },
];
const lobbyView = (over: Record<string, unknown> = {}) =>
  view({ phase: "lobby", prompt: null, mode: null, players: withAvatars, ...over }, { id: "p1", avatar: 5 });

/** The opening tag of the picker button for avatar `i`. */
function pickBtn(html: string, i: number): string {
  const m = html.match(new RegExp(`<button[^>]*data-avatar="${i}"[^>]*>`));
  assert.ok(m, `a button for avatar ${i}`);
  return m[0];
}

test("the picker has 60 buttons: mine pressed, others' taken and disabled, the rest free", () => {
  const html = renderPicker(lobbyView());
  assert.equal(html.match(/<button /g)?.length, 60);
  for (let i = 0; i < 60; i++) {
    const b = pickBtn(html, i);
    assert.ok(b.includes('type="button"'), String(i));
    assert.ok(b.includes(`aria-label="${AVATARS[i].label}"`), String(i));
  }
  const mine = pickBtn(html, 5);
  assert.ok(mine.includes('aria-pressed="true"'));
  assert.ok(!mine.includes("disabled") && !mine.includes("taken"));
  const taken = pickBtn(html, 7);
  assert.ok(/\bdisabled\b/.test(taken) && /class="[^"]*\btaken\b/.test(taken));
  assert.ok(taken.includes('aria-pressed="false"'));
  const free = pickBtn(html, 0);
  assert.ok(!/\bdisabled\b/.test(free) && !/\btaken\b/.test(free));
  assert.ok(free.includes('aria-pressed="false"'));
  assert.equal(html.match(/aria-pressed="true"/g)?.length, 1);
  assert.equal(html.match(/\bdisabled\b/g)?.length, 1);
});

test("the picker escapes the avatar label", () => {
  const saved = AVATARS[0].label;
  AVATARS[0].label = `<b onclick="x">'`;
  try {
    const html = renderPicker(lobbyView());
    assert.ok(!html.includes("<b onclick"));
    assert.ok(html.includes("&lt;b onclick=&quot;x&quot;&gt;&#39;"));
  } finally {
    AVATARS[0].label = saved;
  }
});

test("the picker shows in the lobby under You're in! and on the spectator screen, nowhere else", () => {
  const lobby = renderPlayer(lobbyView(), ui({ countdownMs: null }));
  assert.ok(lobby.includes("data-avatar="));
  assert.ok(lobby.indexOf("You're in!") < lobby.indexOf("data-avatar="));
  const spectating = renderPlayer(
    view({ players: [withAvatars[0], { ...withAvatars[1], spectator: true }] }, { id: "p2", nickname: "Jon", avatar: 7, isOn: false }),
    ui(),
  );
  assert.ok(spectating.includes("You'll join the next game"));
  assert.ok(spectating.includes("data-avatar="));
  assert.ok(pickBtn(spectating, 7).includes('aria-pressed="true"'));
  assert.ok(/\bdisabled\b/.test(pickBtn(spectating, 5)));
  const playing = renderPlayer(view({ players: withAvatars }, { id: "p1", avatar: 5 }), ui());
  assert.ok(!playing.includes("data-avatar="));
  const results = renderPlayer(
    view({ phase: "results", prompt: null, players: withAvatars, results: { winners: [], ghostBoard: [], longestWord: null } }, { id: "p1", avatar: 5 }),
    ui({ countdownMs: null }),
  );
  assert.ok(!results.includes("data-avatar="));
});

test("the lobby list shows each player's emoji, and the picker's answer shows in the result line", () => {
  const lobby = renderPlayer(lobbyView(), ui({ countdownMs: null }));
  const names = lobby.match(/<ul class="names">.*?<\/ul>/s)?.[0] ?? "";
  assert.ok(names.includes(`alt="${AVATARS[5].label}"`) && names.includes(`alt="${AVATARS[7].label}"`));
  const taken = renderPlayer(lobbyView(), ui({ countdownMs: null, lastResult: { ok: false, reason: "avatar-taken" } }));
  assert.ok(taken.includes("✗ Taken, pick another"));
  const done = renderPlayer(lobbyView(), ui({ countdownMs: null, lastResult: { ok: true, kind: "avatar" } }));
  assert.ok(!done.includes("+1"), "picking an emoji scores nothing");
  assert.equal(reasonText("avatar-taken"), "Taken, pick another");
  assert.equal(reasonText("avatar-locked"), "You can change your emoji in the lobby");
  assert.equal(reasonText("bad-avatar"), "Something went wrong. Try again");
});
