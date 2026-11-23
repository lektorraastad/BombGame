import { test } from "node:test";
import assert from "node:assert/strict";
import { renderProjector } from "../../public/app/render-projector.js";
import { WORD_LIST_CREDITS } from "../../src/words/credits.ts";
import { CREDITS } from "../../public/app/credits.js";
import { AVATARS, EMOJI_CREDIT } from "../../public/app/avatars.js";
import { createRoom } from "../../src/engine/registry.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import { projectorView } from "../../src/engine/views.ts";
import type { PlayerId, Room } from "../../src/engine/room.ts";
import { makeDeps, makeTestChecker, fixtureBlocked } from "../engine/helpers.ts";
import type { Prompt } from "../../src/engine/types.ts";

const ST: Prompt = { text: "st", type: "contains", count: 480 };
const TOKENS = ["tok-secret-mia", "tok-secret-jon", "tok-secret-ola"];
const ui = (over: Record<string, unknown> = {}): any => ({ countdownMs: null, credits: CREDITS, site: "bomb.example", ...over });

function game(settings: Record<string, unknown>) {
  const { deps, clock } = makeDeps(5);
  const room = createRoom({ code: "QWER", deps, checker: makeTestChecker(), bank: createPromptBank([ST]), blockedNames: fixtureBlocked });
  const ids: PlayerId[] = [];
  for (const [i, nick] of ["Mia", "Jon", "Ola"].entries()) {
    const j = room.join(TOKENS[i], nick);
    assert.ok(j.ok);
    if (j.ok) ids.push(j.playerId);
  }
  room.updateSettings({ startLives: 1, ...settings });
  return { room, clock, ids };
}
const current = (room: Room) => (room.modeView() as { current: PlayerId }).current;
const draw = (room: Room, over: Record<string, unknown> = {}) => {
  const v = projectorView(room);
  return renderProjector(v, ui({ countdownMs: v.bombRemainingMs ?? null, ...over }));
};

test("the credits shown on the projector are the word lists' credits", () => {
  assert.equal(CREDITS, WORD_LIST_CREDITS);
});

test("projector never contains scores, ghost points or tokens", async () => {
  const { room, clock, ids } = game({ mode: "classic", timerStyle: "visible", turnTime: 10, startLives: 2, knockout: "ghost" });
  const screens: string[] = [];
  const lobby = draw(room);
  assert.ok(lobby.includes("QWER") && lobby.includes("Mia") && lobby.includes("Jon"));
  assert.ok(lobby.replace(/<[^>]+>/g, "").includes("Go to bomb.example and enter the code"));
  assert.ok(lobby.includes("New General Service List"), "credits in the lobby");
  screens.push(lobby);

  assert.deepEqual(room.start(), { ok: true });
  screens.push(draw(room));
  room.submit(current(room), "station");
  // A silent answer from someone who isn't on earns a score: it must not show.
  const waiting = ids.find((id) => id !== current(room))!;
  room.submit(waiting, "stone");
  screens.push(draw(room));
  // Two explosions knock one player out, so they become a ghost and answer for ghost points.
  const victim = current(room);
  await clock.advance(10_000);
  const words = ["street", "strong", "story", "stand", "start"];
  while (current(room) !== victim) assert.equal(room.submit(current(room), words.shift()!).ok, true);
  await clock.advance(10_000);
  assert.equal(room.players().find((p) => p.id === victim)!.alive, false);
  room.submit(victim, "storm");
  assert.ok(room.players().find((p) => p.id === victim)!.ghostPoints > 0, "the ghost has ghost points");
  const between = draw(room);
  assert.ok(projectorView(room).examples!.length > 0);
  assert.ok(between.includes("Could have said"), "example answers after an explosion");
  screens.push(between);
  room.pause();
  const paused = draw(room);
  assert.ok(paused.includes("Paused"));
  screens.push(paused);
  room.resume();
  room.endGame();
  const results = draw(room);
  screens.push(results);

  for (const html of screens) {
    assert.ok(!/score/i.test(html), "no score");
    for (const t of TOKENS) assert.ok(!html.includes(t), "no tokens");
  }
  for (const html of screens.slice(0, -1)) assert.ok(!/ghost/i.test(html), "no ghost points during a game");
  assert.ok(results.includes("Game over"));
});

test("projector shows Last word in classic and no words in everyone during a round", () => {
  const c = game({ mode: "classic", timerStyle: "hidden" });
  assert.deepEqual(c.room.start(), { ok: true });
  const on = current(c.room);
  const onName = c.room.players().find((p) => p.id === on)!.nickname;
  const before = draw(c.room);
  assert.ok(before.includes("ST"), "the prompt");
  assert.ok(new RegExp(`class="seat on"[^>]*><span class="name">${onName}<`).test(before), "current seat highlighted");
  assert.equal(before.match(/class="seat on"/g)?.length, 1);
  assert.ok(!before.includes("data-countdown"), "no countdown for a hidden fuse");
  c.room.submit(on, "station");
  const after = draw(c.room);
  assert.ok(after.includes("Last word"));
  assert.ok(!after.includes("Current word"));
  assert.ok(after.includes("station"));

  const v = game({ mode: "classic", timerStyle: "visible", turnTime: 12 });
  assert.deepEqual(v.room.start(), { ok: true });
  assert.ok(draw(v.room).includes("data-countdown"), "visible countdown");

  const e = game({ mode: "everyone", roundTime: 15, exampleAnswers: false });
  assert.deepEqual(e.room.start(), { ok: true });
  e.room.submit(e.ids[0], "station");
  const round = draw(e.room);
  assert.ok(!round.includes("station"), "no answer words");
  assert.ok(!round.includes("Last word"));
  assert.ok(round.includes("data-countdown"));
  assert.ok(/class="tick answered"[^>]*>[^<]*Mia/.test(round), "Mia ticks green");
  assert.ok(/class="tick"[^>]*>[^<]*Jon/.test(round), "Jon has not answered");
});

test("results map winners to nicknames and show the ghost board and longest word", () => {
  const players = [
    { id: "p1", nickname: "Mia", lives: 1, alive: true, connected: true, spectator: false },
    { id: "p2", nickname: "<b>Jon</b>", lives: 0, alive: false, connected: true, spectator: false },
  ];
  const html = renderProjector({
    code: "ABCD", phase: "results", paused: false, locked: false, players, prompt: null, mode: null,
    results: { winners: ["p1"], ghostBoard: [{ id: "p2", nickname: "<b>Jon</b>", ghostPoints: 4 }], longestWord: { nickname: "Mia", word: "remember" } },
  }, ui());
  assert.ok(html.includes("Mia"));
  assert.ok(!html.includes("p1"), "ids are not shown");
  assert.ok(html.includes("remember"));
  assert.ok(html.includes("&lt;b&gt;Jon&lt;/b&gt;") && !html.includes("<b>Jon"));
});

test("the projector bomb is drawn from ui.bomb, without an arrow for now", () => {
  const c = game({ mode: "classic", timerStyle: "visible", turnTime: 12 });
  assert.ok(!draw(c.room).includes("data-bomb"), "no bomb in the lobby yet");
  assert.deepEqual(c.room.start(), { ok: true });
  const bomb = { lit: true, arrow: { from: 0, to: 120, elapsedMs: 100 }, countdownMs: 12_000, fuse: { totalMs: 12_000, elapsedMs: 0 }, explosion: { elapsedMs: 200 } };
  const html = draw(c.room, { countdownMs: 12_000, bomb });
  assert.match(html, /class="bomb[^"]*"[^>]* data-bomb/);
  assert.match(html, /data-countdown>12</);
  assert.ok(html.includes("bomb-burst"), "the explosion from the motion tracker");
  assert.ok(html.includes("bomb-fuse burning"), "the fuse burns");
  assert.ok(!html.includes("bomb-arrow"), "the arrow comes with the new circle");
  // Without ui.bomb: a lit bomb while playing, unlit while paused.
  assert.match(draw(c.room), /class="[^"]*\bflame\b/);
  c.room.pause();
  assert.ok(!/flame/.test(draw(c.room)));
});

test("the lobby shows each player's emoji beside their name, and credits the emoji", () => {
  const { room } = game({});
  const v = projectorView(room);
  const html = draw(room);
  const names = html.match(/<ul class="p-names">.*?<\/ul>/s)?.[0] ?? "";
  for (const p of v.players) {
    assert.ok(names.includes(`alt="${AVATARS[p.avatar].label}"`), p.nickname);
  }
  assert.deepEqual(names.replace(/<[^>]+>/g, "|").split("|").filter(Boolean), ["Mia", "Jon", "Ola"]);
  const credits = html.match(/<p class="p-credits">(.*?)<\/p>/s)?.[1] ?? "";
  assert.equal(credits, `${CREDITS} · ${EMOJI_CREDIT}`.replace(/&/g, "&amp;"));
});
