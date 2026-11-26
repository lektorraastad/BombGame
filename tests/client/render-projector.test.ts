import { test } from "node:test";
import assert from "node:assert/strict";
import { renderProjector } from "../../public/app/render-projector.js";
import { WORD_LIST_CREDITS } from "../../src/words/credits.ts";
import { CREDITS } from "../../public/app/credits.js";
import { AVATARS, EMOJI_CREDIT, avatarImg } from "../../public/app/avatars.js";
import { tiles, matchedTiles } from "../../public/app/tiles.js";
import { screenAngle } from "../../public/app/circle-geometry.js";
import { createRoom } from "../../src/engine/registry.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import { projectorView } from "../../src/engine/views.ts";
import type { PlayerId, Room } from "../../src/engine/room.ts";
import { makeDeps, makeTestChecker, fixtureBlocked } from "../engine/helpers.ts";
import type { Prompt } from "../../src/engine/types.ts";

const ST: Prompt = { text: "st", type: "contains", count: 480, common: 0 };
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
  assert.ok(text(lobby).includes("QWER") && lobby.includes("Mia") && lobby.includes("Jon"));
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

/** Text with the tags taken out. */
const text = (html: string) => html.replace(/<[^>]+>/g, "");
/** The inner HTML of the first element with this class (elements of that tag must not nest). */
function part(html: string, cls: string): string {
  const m = html.match(new RegExp(`<(\\w+) class="${cls}"[^>]*>`));
  assert.ok(m, `no .${cls}`);
  const tag = m[1];
  let depth = 0;
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "g");
  re.lastIndex = m.index!;
  for (let x; (x = re.exec(html)); ) {
    depth += x[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(m.index! + m[0].length, x.index);
  }
  throw new Error(`unclosed .${cls}`);
}
/** Each seat's classes and inner HTML, in order. Seats hold no nested <div>. */
const seatsOf = (html: string) =>
  [...html.matchAll(/<div class="(seat[^"]*)" style="[^"]*">(.*?)<\/div>/gs)].map((m) => ({ cls: m[1].split(" "), inner: m[2] }));
const nameOf = (inner: string) => inner.match(/class="name">([^<]*)</)?.[1];
const LIT = { lit: true, arrow: { from: 0, to: 120, elapsedMs: 100 }, countdownMs: 12_000, fuse: { totalMs: 12_000, elapsedMs: 0 }, explosion: null };

test("lobby: the code on tiles, everyone on the circle round an unlit bomb, the count and the credits", () => {
  const { room } = game({});
  assert.ok(room.join("tok-4", "<b>Æsa</b>").ok);
  // Even if the motion tracker had a lit bomb with an arrow, the lobby bomb is unlit with no arrow.
  const html = draw(room, { bomb: LIT });
  assert.ok(text(html).includes("Go to bomb.example and enter the code"));
  const code = part(html, "p-code");
  assert.equal(code, tiles("QWER"), "the code on letter tiles");
  assert.equal(text(code), "QWER", "the code's text is exactly the code");
  assert.ok(!html.includes("p-names"), "the old name list is gone");
  const seats = seatsOf(html);
  assert.deepEqual(seats.map((s) => nameOf(s.inner)), ["Mia", "Jon", "Ola", "&lt;b&gt;Æsa&lt;/b&gt;"]);
  for (const [i, p] of projectorView(room).players.entries()) assert.ok(seats[i].inner.includes(avatarImg(p.avatar)), p.nickname);
  assert.ok(!html.includes("<b>Æsa"), "nicknames are escaped");
  // Nobody has lives before the game starts: no one in the lobby looks knocked out.
  assert.ok(seats.every((s) => !s.cls.includes("out") && !s.inner.includes(">out<")), "nobody is out in the lobby");
  assert.match(html, /class="bomb"[^>]* data-bomb/, "the bomb, not lit");
  assert.ok(!/bomb-flame|bomb-arrow|data-countdown|bomb-burst/.test(html), "no flame, no arrow, no number in the lobby");
  assert.ok(html.indexOf("p-code") < html.indexOf('class="circle"'), "the circle below the code");
  assert.equal(text(part(html, "p-count")), "4 joined");
  assert.ok(!html.includes("p-locked"));
  room.setLocked(true);
  assert.match(draw(room), /class="p-locked">The game is locked: nobody new can join</);
});

test("lobby: a new arrival pops in, from the motion tracker", () => {
  const { room, ids } = game({});
  const html = draw(room, { popElapsed: (pid: string) => (pid === ids[2] ? 150 : null) });
  const seats = seatsOf(html);
  assert.deepEqual(seats.map((s) => s.cls.includes("pop")), [false, false, true]);
  assert.match(html, /class="seat pop" style="[^"]*;animation-delay:-150ms"/);
});

test("lobby with nobody yet: the circle's bomb, and a waiting line", () => {
  const { deps } = makeDeps(5);
  const room = createRoom({ code: "ZXCV", deps, checker: makeTestChecker(), bank: createPromptBank([ST]), blockedNames: fixtureBlocked });
  const html = draw(room);
  assert.equal(seatsOf(html).length, 0);
  assert.ok(html.includes("data-bomb"));
  assert.equal(text(part(html, "p-count")), "Waiting for players…");
});

test("classic: the circle, a lit bomb with the arrow, and the prompt on the bomb in tiles", () => {
  const c = game({ mode: "classic", timerStyle: "hidden" });
  assert.deepEqual(c.room.start(), { ok: true });
  const on = current(c.room);
  const html = draw(c.room, { bomb: { ...LIT, countdownMs: null, fuse: null } });
  const face = part(html, "bomb-face");
  assert.equal(text(part(face, "p-ask")), "CONTAINS");
  assert.equal(part(face, "p-prompt"), tiles("ST"), "the prompt in upper case on tiles, on the bomb");
  assert.match(html, /class="bomb lit"/);
  assert.ok(html.includes("bomb-flame"), "a lit flame");
  assert.match(html, /class="bomb-arrow swing" style="--from:0deg;--to:120deg;/, "the arrow from the motion tracker");
  const seats = seatsOf(html);
  assert.equal(seats.length, 3);
  const onSeats = seats.filter((s) => s.cls.includes("on"));
  assert.equal(onSeats.length, 1);
  assert.equal(nameOf(onSeats[0].inner), c.room.players().find((p) => p.id === on)!.nickname);
  assert.ok(!html.includes("data-countdown"), "no countdown for a hidden fuse");
  assert.ok(!html.includes("Last word"), "last words sit on the seats now");

  c.room.submit(on, "station");
  const after = draw(c.room);
  const mine = seatsOf(after).find((s) => s.inner.includes("last-word") && nameOf(s.inner) === c.room.players().find((p) => p.id === on)!.nickname);
  assert.ok(mine, "the word under the player who played it");
  assert.ok(mine.inner.includes(`<span class="last-word">${matchedTiles("station", { text: "st", type: "contains" })}</span>`));
  assert.ok(!after.includes("p-last") && !after.includes("p-typing"));

  const v = game({ mode: "classic", timerStyle: "visible", turnTime: 12 });
  assert.deepEqual(v.room.start(), { ok: true });
  assert.ok(draw(v.room).includes("data-countdown"), "visible countdown on the bomb");
});

test("classic: example answers after an explosion, below the circle", async () => {
  const c = game({ mode: "classic", timerStyle: "visible", turnTime: 5, startLives: 2, exampleAnswers: true });
  assert.deepEqual(c.room.start(), { ok: true });
  await c.clock.advance(5_000);
  const html = draw(c.room);
  assert.ok(projectorView(c.room).examples!.length > 0);
  assert.match(html, /<div class="p-examples">Could have said: [^<]+<\/div>/);
  assert.ok(html.includes('<div class="circle">') && html.lastIndexOf('class="circle"') < html.indexOf("p-examples"));
});

test("everyone at once: no arrow, the fuse burns, ticks on seats, the round, and no words during it", () => {
  const e = game({ mode: "everyone", roundTime: 15, exampleAnswers: false });
  assert.deepEqual(e.room.start(), { ok: true });
  e.room.submit(e.ids[0], "station");
  const html = draw(e.room, { bomb: LIT });
  assert.ok(!html.includes("bomb-arrow"), "no arrow, whatever the tracker says");
  assert.ok(html.includes("bomb-fuse burning"), "the fuse burns down");
  assert.ok(html.includes("bomb-flame"));
  assert.ok(html.includes("data-countdown"));
  assert.equal(part(part(html, "bomb-face"), "p-prompt"), tiles("ST"));
  assert.equal(text(part(html, "p-round")), "Round 1");
  const seats = seatsOf(html);
  assert.deepEqual(seats.map((s) => nameOf(s.inner)), ["Mia", "Jon", "Ola"]);
  assert.deepEqual(seats.map((s) => s.inner.includes(">✓<")), [true, false, false], "Mia has a tick");
  assert.ok(!html.includes("station"), "nobody's word shows during the round");
  assert.ok(!seats.some((s) => s.cls.includes("on")));
});

test("the bomb without ui.bomb: lit while playing, unlit while paused", () => {
  const c = game({ mode: "classic", timerStyle: "visible", turnTime: 12 });
  assert.deepEqual(c.room.start(), { ok: true });
  assert.ok(draw(c.room).includes("bomb-flame"));
  c.room.pause();
  const paused = draw(c.room);
  assert.ok(!paused.includes("bomb-flame"));
  assert.match(paused, /^<div class="p-paused">Paused<\/div>/);
});

const RESULT_PLAYERS = [
  { id: "p1", nickname: "Mia", avatar: 3, lives: 1, alive: true, connected: true, spectator: false },
  { id: "p2", nickname: "<b>Jon</b>", avatar: 5, lives: 0, alive: false, connected: true, spectator: false },
  { id: "p3", nickname: "Åse 😀", avatar: 7, lives: 1, alive: true, connected: true, spectator: false },
];
const resultsView = (results: Record<string, unknown>) => ({
  code: "ABCD", phase: "results", paused: false, locked: false, players: RESULT_PLAYERS, prompt: null, mode: null,
  results: { winners: [], ghostRanking: [], longestWord: null, ...results },
});

test("results: a trophy, the winner's emoji and name on tiles, no bomb", () => {
  const html = renderProjector(resultsView({ winners: ["p1"] }), ui({ bomb: LIT }));
  assert.ok(html.includes("Game over"));
  assert.ok(!html.includes("data-bomb") && !html.includes('class="circle"'), "no bomb on the results");
  const podium = part(html, "p-podium");
  assert.match(podium, /class="trophy"/);
  const winners = [...podium.matchAll(/<div class="p-winner">(.*?)<\/div>/gs)].map((m) => m[1]);
  assert.equal(winners.length, 1);
  assert.equal(winners[0], `${avatarImg(3, "big")}${tiles("Mia")}`);
  assert.ok(!html.includes("p1"), "ids are not shown");
});

test("results: shared winners side by side, escaped; no winner says so", () => {
  const html = renderProjector(resultsView({ winners: ["p2", "p3", "gone"] }), ui());
  const winners = [...part(html, "p-podium").matchAll(/<div class="p-winner">(.*?)<\/div>/gs)].map((m) => m[1]);
  assert.deepEqual(winners, [`${avatarImg(5, "big")}${tiles("<b>Jon</b>")}`, `${avatarImg(7, "big")}${tiles("Åse 😀")}`]);
  assert.ok(!html.includes("<b>Jon") && html.includes("&lt;"));
  assert.ok(html.includes('<span class="tile">😀</span>'), "an emoji is one whole tile");

  const none = renderProjector(resultsView({}), ui());
  assert.ok(!none.includes("p-winner\""));
  assert.equal(text(part(none, "p-podium")), "No winner this time");
});

test("results: the longest word on tiles with who played it, and the best ghosts numbered with emoji, no points", () => {
  const html = renderProjector(
    resultsView({
      winners: ["p1"],
      longestWord: { nickname: "<b>Jon</b>", avatar: 5, word: "remember" },
      ghostRanking: [{ id: "p2", nickname: "<b>Jon</b>", avatar: 5 }, { id: "p3", nickname: "Åse 😀", avatar: 7 }],
    }),
    ui(),
  );
  const longest = part(html, "p-longest");
  assert.equal(longest, `Longest word: ${tiles("remember")} <span class="by">(&lt;b&gt;Jon&lt;/b&gt;)</span>`);
  assert.ok(html.includes("Best ghosts"));
  const ghosts = part(html, "p-ghosts");
  const items = [...ghosts.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => m[1]);
  assert.deepEqual(items, [
    `<span class="rank">1.</span>${avatarImg(5)}<span class="who">&lt;b&gt;Jon&lt;/b&gt;</span>`,
    `<span class="rank">2.</span>${avatarImg(7)}<span class="who">Åse 😀</span>`,
  ]);
  assert.ok(!/points?/i.test(html), "no ghost points");

  const plain = renderProjector(resultsView({ winners: ["p1"] }), ui());
  assert.ok(!plain.includes("Best ghosts") && !plain.includes("p-longest"), "nothing to show, nothing shown");
});

test("the lobby credits the word lists and the emoji", () => {
  const { room } = game({});
  const credits = draw(room).match(/<p class="p-credits">(.*?)<\/p>/s)?.[1] ?? "";
  assert.equal(credits, `${CREDITS} · ${EMOJI_CREDIT}`.replace(/&/g, "&amp;"));
});

test("classic: the arrow follows the ring's real shape from ui.ringAspect", () => {
  const c = game({ mode: "classic", timerStyle: "hidden" });
  assert.deepEqual(c.room.start(), { ok: true });
  const bomb = { ...LIT, countdownMs: null, fuse: null, arrow: { from: 120, to: 240, elapsedMs: 700 } };
  const html = draw(c.room, { bomb, ringAspect: 1.75 });
  assert.ok(html.includes(`--to:${Math.round(screenAngle(240, 1.75) * 10) / 10}deg"`), html.match(/--to:[^"]*/)?.[0]);
  assert.ok(draw(c.room, { bomb }).includes('--to:240deg"'), "no aspect: as given");
  assert.ok(draw(c.room, { bomb, ringAspect: Number.NaN }).includes('--to:240deg"'), "junk aspect: as given");
});
