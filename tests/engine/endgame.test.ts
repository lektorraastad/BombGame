import { test } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../../src/engine/room.ts";
import type { PlayerId } from "../../src/engine/room.ts";
import { classicMode } from "../../src/engine/modes/classic.ts";
import { everyoneMode } from "../../src/engine/modes/everyone.ts";
import { ghostActivity } from "../../src/engine/knockout/ghost.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import type { Prompt } from "../../src/engine/types.ts";
import type { Rarity } from "../../src/engine/rarity.ts";
import { awardsOf, wallWords, summaryOf } from "../../src/engine/endgame.ts";
import { makeDeps, makeTestChecker, fixtureBlocked } from "./helpers.ts";

const ST: Prompt = { text: "st", type: "contains", count: 480, common: 0 };

/** Rarity from a table: listed words get their number (null = a name), others are very common. */
const table = (t: Record<string, number | null>): Rarity => (w) => (w in t ? t[w] : 1);

function setup(n: number, opts: { mode?: "classic" | "everyone"; rarity?: Rarity; settings?: Record<string, unknown> } = {}) {
  const { deps } = makeDeps(11);
  const room = new Room({
    code: "ABCD",
    deps,
    checker: makeTestChecker(),
    bank: createPromptBank([ST]),
    blockedNames: fixtureBlocked,
    modes: [opts.mode === "everyone" ? everyoneMode : classicMode],
    activities: [ghostActivity],
    rarity: opts.rarity,
  });
  const ids: PlayerId[] = [];
  for (let i = 0; i < n; i++) {
    const j = room.join("tok" + i, "Player" + i);
    assert.ok(j.ok);
    if (j.ok) ids.push(j.playerId);
  }
  room.updateSettings({ mode: opts.mode ?? "classic", startLives: 1, timerStyle: "visible", silentAnswers: true, comeback: false, ...opts.settings });
  assert.deepEqual(room.start(), { ok: true });
  return { room, ids };
}

const cur = (room: Room) => (room.modeView() as { current: PlayerId }).current;
const turn = (room: Room, word: string) => {
  const pid = cur(room);
  assert.deepEqual(room.submit(pid, word), { ok: true, kind: "turn" });
  return pid;
};
const silent = (room: Room, pid: PlayerId, word: string) => assert.deepEqual(room.submit(pid, word), { ok: true, kind: "silent" });
const ghost = (room: Room, pid: PlayerId, word: string) => assert.deepEqual(room.submit(pid, word), { ok: true, kind: "ghost" });
const who = (room: Room, id: PlayerId) => {
  const p = room.players().find((x) => x.id === id)!;
  return { id: p.id, nickname: p.nickname, avatar: p.avatar };
};
const kinds = (room: Room) => awardsOf(room).map((a) => a.kind);

test("longest: the first of equal length wins", () => {
  const { room } = setup(3, { rarity: table({ strong: 900 }) });
  const a = turn(room, "street");
  const b = turn(room, "strong");
  room.context().endGame([]);
  const awards = awardsOf(room);
  assert.deepEqual(awards[0], { kind: "longest", players: [who(room, a)], word: "street" });
  assert.deepEqual(awards[1], { kind: "rarest", players: [who(room, b)], word: "strong" });
});

test("rarest skips names and uses rarity, then length, then first played", () => {
  const { room } = setup(3, { rarity: table({ stone: null, stay: 500, stand: 500, start: 500, best: 100 }) });
  turn(room, "stone");
  turn(room, "stay");
  const s = turn(room, "stand");
  turn(room, "start");
  turn(room, "best");
  room.context().endGame([]);
  const rarest = awardsOf(room).find((x) => x.kind === "rarest");
  assert.deepEqual(rarest, { kind: "rarest", players: [who(room, s)], word: "stand" });
  assert.equal(awardsOf(room).find((x) => x.kind === "longest")!.word, "stone", "a name may still be the longest");
});

test("a game of only names has no Rarest card", () => {
  const { room } = setup(3, { rarity: table({ stone: null, stay: null }) });
  turn(room, "stone");
  turn(room, "stay");
  room.context().endGame([]);
  assert.deepEqual(kinds(room), ["longest", "mostWords"]);
});

test("longest and rarest the same word gives one longestRarest card", () => {
  const { room } = setup(3, { rarity: table({ station: 900, stay: 10 }) });
  const a = turn(room, "station");
  turn(room, "stay");
  room.context().endGame([]);
  const awards = awardsOf(room);
  assert.deepEqual(awards[0], { kind: "longestRarest", players: [who(room, a)], word: "station" });
  assert.ok(!awards.some((x) => x.kind === "longest" || x.kind === "rarest"));
});

test("most words counts turn words and silent answers, not ghost words", () => {
  const { room, ids } = setup(4);
  const a = cur(room);
  const [b, c] = ids.filter((id) => id !== a);
  silent(room, b, "stone");
  silent(room, b, "stand");
  room.context().loseLife(c);
  ghost(room, c, "street");
  ghost(room, c, "strong");
  ghost(room, c, "story");
  turn(room, "station");
  room.context().endGame([a]);
  assert.deepEqual(awardsOf(room).find((x) => x.kind === "mostWords"), { kind: "mostWords", players: [who(room, b)] });
});

test("ties name everyone in join order, up to 8", () => {
  const { room, ids } = setup(9);
  const tied = ids.filter((id) => id !== cur(room));
  assert.equal(tied.length, 8);
  for (const id of [...tied].reverse()) silent(room, id, "stone");
  room.context().endGame([]);
  assert.deepEqual(awardsOf(room).find((x) => x.kind === "mostWords"), { kind: "mostWords", players: tied.map((id) => who(room, id)) });
});

test("more than 8 tied: no names, tied = n (Most words)", () => {
  const { room, ids } = setup(10);
  for (const id of ids.filter((x) => x !== cur(room))) silent(room, id, "stone");
  turn(room, "street");
  room.context().endGame([]);
  assert.deepEqual(awardsOf(room).find((x) => x.kind === "mostWords"), { kind: "mostWords", players: [], tied: 10 });
});

test("more than 8 tied: no names, tied = n (Comeback)", () => {
  const { room, ids } = setup(12, { settings: { comeback: true, comebackStreak: 2 } });
  const ghosts = ids.filter((id) => id !== cur(room)).slice(0, 9);
  for (const g of ghosts) room.context().loseLife(g);
  for (const g of ghosts) ghost(room, g, "station");
  turn(room, "street");
  for (const g of ghosts) ghost(room, g, "stone");
  assert.ok(ghosts.every((g) => room.players().find((p) => p.id === g)!.comebackUsed));
  room.context().endGame([]);
  assert.deepEqual(awardsOf(room).find((x) => x.kind === "comeback"), { kind: "comeback", players: [], tied: 9 });
});

/** Two ghosts; g1 comes back. Public words: street, then strong. */
function comebackGame(rarity: Rarity) {
  const { room, ids } = setup(5, { rarity, settings: { comeback: true, comebackStreak: 2 } });
  const [g1, g2] = ids.filter((id) => id !== cur(room));
  room.context().loseLife(g1);
  room.context().loseLife(g2);
  ghost(room, g1, "station");
  ghost(room, g2, "stone");
  turn(room, "street");
  ghost(room, g1, "stand");
  assert.equal(room.players().find((p) => p.id === g1)!.comebackUsed, true);
  turn(room, "strong");
  room.context().endGame([]);
  return { room, g1, g2 };
}

test("comeback before best ghost; at most 4 cards", () => {
  let { room, g1 } = comebackGame(table({ strong: 900 }));
  assert.deepEqual(kinds(room), ["longest", "rarest", "mostWords", "comeback"]);
  assert.deepEqual(awardsOf(room)[3], { kind: "comeback", players: [who(room, g1)] });

  // A combined card frees a place: Best ghost shows too.
  ({ room, g1 } = comebackGame(table({ street: 900 })));
  assert.deepEqual(kinds(room), ["longestRarest", "mostWords", "comeback", "bestGhost"]);
  assert.deepEqual(awardsOf(room)[3], { kind: "bestGhost", players: [who(room, g1)] });
});

test("best ghost is the top of the ghost ranking, ties in join order", () => {
  const { room, ids } = setup(4);
  const [a, b] = ids.filter((id) => id !== cur(room));
  room.context().loseLife(a);
  room.context().loseLife(b);
  ghost(room, b, "stone");
  ghost(room, a, "stand");
  room.context().endGame([]);
  assert.deepEqual(awardsOf(room), [{ kind: "bestGhost", players: [who(room, a)] }]);
});

test("no words: no word awards, empty wall", () => {
  const { room, ids } = setup(3);
  room.context().endGame([]);
  assert.deepEqual(awardsOf(room), []);
  assert.deepEqual(wallWords(room), []);
  assert.deepEqual(summaryOf(room, ids[0]), { turnWords: 0, silentWords: 0, ghostWords: 0, longest: null, rarest: null, awards: [] });
});

test("kicked players get no award, but their words stay on the wall", () => {
  const { room } = setup(3, { rarity: table({ station: 900 }) });
  const a = turn(room, "station");
  const b = turn(room, "stone");
  room.context().endGame([]);
  room.kick(a);
  const awards = awardsOf(room);
  assert.ok(awards.every((x) => x.players.every((p) => p.id !== a)));
  assert.deepEqual(awards[0], { kind: "longestRarest", players: [who(room, b)], word: "stone" });
  assert.deepEqual(wallWords(room), ["station", "stone"]);
  assert.equal(summaryOf(room, a), null);
});

test("wall is unique and alphabetical with no silent or ghost words", () => {
  // Everyone at once: two players may answer with the same word.
  {
    const { room, ids } = setup(4, { mode: "everyone" });
    const [a, b, c, d] = ids;
    room.context().loseLife(d);
    ghost(room, d, "strong");
    assert.deepEqual(room.submit(a, "stone"), { ok: true, kind: "turn" });
    assert.deepEqual(room.submit(b, "station"), { ok: true, kind: "turn" });
    assert.deepEqual(room.submit(c, "stone"), { ok: true, kind: "turn" });
    room.context().endGame([]);
    assert.deepEqual(wallWords(room), ["station", "stone"]);
  }
  // Classic: silent and ghost answers stay off the wall.
  {
    const { room, ids } = setup(4);
    const [s, g] = ids.filter((id) => id !== cur(room));
    silent(room, s, "story");
    room.context().loseLife(g);
    ghost(room, g, "stand");
    turn(room, "street");
    turn(room, "best");
    room.context().endGame([]);
    assert.deepEqual(wallWords(room), ["best", "street"]);
  }
});

/** a plays stone; b plays stay and answers station and stand silently; c is a ghost with three words. */
function summaryGame() {
  const { room, ids } = setup(4, { rarity: table({ stand: 900, start: 800 }) });
  const a = turn(room, "stone");
  const b = turn(room, "stay");
  silent(room, b, "station");
  silent(room, b, "stand");
  const c = ids.find((id) => id !== a && id !== b && id !== cur(room))!;
  room.context().loseLife(c);
  ghost(room, c, "strong");
  ghost(room, c, "story");
  ghost(room, c, "start");
  const d = ids.find((id) => id !== a && id !== b && id !== c)!;
  room.context().endGame([]);
  return { room, a, b, c, d };
}

test("summary counts turn, silent and ghost words and only its owner's words", () => {
  const { room, a, c, d } = summaryGame();
  assert.deepEqual(summaryOf(room, a), { turnWords: 1, silentWords: 0, ghostWords: 0, longest: "stone", rarest: "stone", awards: ["longestRarest"] });
  assert.deepEqual(summaryOf(room, c), { turnWords: 0, silentWords: 0, ghostWords: 3, longest: "strong", rarest: "start", awards: ["bestGhost"] });
  assert.deepEqual(summaryOf(room, d), { turnWords: 0, silentWords: 0, ghostWords: 0, longest: null, rarest: null, awards: [] });
  assert.equal(summaryOf(room, "nobody"), null);
});

test("summary longest and rarest include the owner's silent and ghost words", () => {
  const { room, b } = summaryGame();
  const s = summaryOf(room, b)!;
  assert.equal(s.turnWords, 1);
  assert.equal(s.silentWords, 2);
  assert.equal(s.longest, "station");
  assert.equal(s.rarest, "stand");
});

test("summary awards lists the kinds naming this player", () => {
  const { room, a, b, c, d } = summaryGame();
  assert.deepEqual(kinds(room), ["longestRarest", "mostWords", "bestGhost"]);
  assert.deepEqual(summaryOf(room, a)!.awards, ["longestRarest"]);
  assert.deepEqual(summaryOf(room, b)!.awards, ["mostWords"]);
  assert.deepEqual(summaryOf(room, c)!.awards, ["bestGhost"]);
  assert.deepEqual(summaryOf(room, d)!.awards, []);
});
