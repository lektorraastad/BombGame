import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCircle } from "../../public/app/render-circle.js";
import { seatPosition } from "../../public/app/circle-geometry.js";
import { renderBomb, type BombState } from "../../public/app/bomb.js";
import { avatarImg } from "../../public/app/avatars.js";
import { matchedTiles, tiles } from "../../public/app/tiles.js";
import { esc } from "../../public/app/escape.js";
import { POP_MS } from "../../public/app/motion.js";

const CSS = readFileSync(new URL("../../public/app/style.css", import.meta.url), "utf8");
const BOMB: BombState = { lit: true, arrow: { from: 0, to: 90, elapsedMs: 600 }, countdownMs: null, fuse: null, explosion: null };

type P = Record<string, unknown>;
const player = (id: string, over: P = {}): P => ({
  id, nickname: id, lives: 3, alive: true, connected: true, spectator: false, avatar: 0, ...over,
});
/** A Classic view: everyone seated in order, `current` on. */
const classic = (players: P[], current: string | null, over: P = {}): any => ({
  phase: "playing", players, mode: { current, seats: players.map((p) => p.id) }, ...over,
});
/** An Everyone at once view: no seats, no current player. */
const everyone = (players: P[]): any => ({ phase: "playing", players, mode: { round: 1 } });
const draw = (view: any, over: Record<string, unknown> = {}) =>
  renderCircle(view, { compact: false, bomb: BOMB, centre: "", ...over } as any);

/** Each seat's opening tag and inner HTML, in order. Seats hold no nested <div>. */
const seats = (html: string) =>
  [...html.matchAll(/<div class="(seat[^"]*)" style="([^"]*)">(.*?)<\/div>/gs)].map((m) => ({ cls: m[1].split(" "), style: m[2], inner: m[3] }));

test("32 seats stay inside the box, in two separate rings", () => {
  for (let i = 0; i < 32; i++) {
    const s = seatPosition(i, 32);
    assert.ok(s.left >= 5 && s.left <= 95 && s.top >= 5 && s.top <= 95);
  }
  assert.equal(seatPosition(0, 32).ring, 0);
  assert.equal(seatPosition(1, 32).ring, 1);
  assert.equal(seatPosition(1, 20).ring, 0);
});

test("seat shows avatar, escaped 16-char name, hearts, matched last word", () => {
  const name = "<script>æøå😀ÆØÅ!";
  assert.equal(Array.from(name).length, 16);
  const lastWord = { word: "station", prompt: { text: "st", type: "contains" } };
  const html = draw(classic([player("a", { nickname: name, avatar: 7, lives: 2, lastWord }), player("b")], "b"));
  assert.ok(!html.includes("<script>"));
  const [a] = seats(html);
  assert.ok(a.inner.includes(avatarImg(7)));
  assert.ok(a.inner.includes(`<span class="name">${esc(name)}</span>`), "the whole name, escaped");
  assert.ok(a.inner.includes(`<span class="lives">❤❤</span>`));
  assert.ok(a.inner.includes(`<span class="last-word">${matchedTiles("station", lastWord.prompt)}</span>`));
  assert.equal((a.inner.match(/tile matched/g) ?? []).length, 2);
  assert.ok(!a.inner.includes('class="typing"') && !a.inner.includes('class="answered"') && !a.inner.includes('class="away"'));
});

test("last words and prompts from players are escaped", () => {
  const lastWord = { word: "<img src=x onerror=alert(1)>", prompt: { text: "<b>", type: "contains" } };
  const html = draw(classic([player("a", { lastWord, nickname: `"'&` }), player("b")], "b"));
  assert.ok(!html.includes("<img src=x") && !html.includes("<b>"));
  assert.ok(html.includes("&quot;&#39;&amp;"));
});

test("seats sit where circle-geometry puts them, in seat order", () => {
  const ps = [player("a"), player("b"), player("c")];
  const view = classic(ps, "a");
  view.mode.seats = ["c", "a", "b"];
  const s = seats(draw(view));
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((x) => x.inner.match(/class="name">([^<]*)/)![1]), ["c", "a", "b"]);
  s.forEach((x, i) => {
    const p = seatPosition(i, 3);
    assert.equal(x.style, `left:${p.left.toFixed(1)}%;top:${p.top.toFixed(1)}%`);
  });
});

test("current player shows typing with a caret instead of the last word", () => {
  const lastWord = { word: "best", prompt: { text: "st", type: "ends" } };
  const ps = [player("a", { lastWord }), player("b", { lastWord })];
  const [a, b] = seats(draw(classic(ps, "a", { typing: "sta<" })));
  assert.ok(a.cls.includes("on") && !b.cls.includes("on"));
  assert.ok(a.inner.includes(`<span class="typing">${tiles("sta<")}<span class="caret"></span></span>`));
  assert.ok(!a.inner.includes("last-word"), "typing replaces the last word");
  assert.ok(b.inner.includes('class="last-word"') && !b.inner.includes("typing"), "others keep theirs");

  // Nothing typed yet: just the caret.
  const [empty] = seats(draw(classic(ps, "a", { typing: "" })));
  assert.ok(empty.inner.includes(`<span class="typing">${tiles("")}<span class="caret"></span></span>`));

  // Live typing off: the view has no typing, so the last word stays.
  const [off] = seats(draw(classic(ps, "a")));
  assert.ok(off.inner.includes('class="last-word"') && !off.inner.includes("caret"));
});

test("answered players get a tick; out players are marked out", () => {
  const ps = [
    player("a", { answered: true }),
    player("b", { answered: false }),
    player("c", { alive: false, lives: 0 }),
    player("d", { connected: false }),
    player("e", { spectator: true }),
  ];
  const s = seats(draw(everyone(ps)));
  assert.equal(s.length, 4, "spectators aren't on the circle");
  assert.ok(s[0].inner.includes(`<span class="answered" aria-label="answered">✓</span>`));
  assert.ok(!s[1].inner.includes("answered"));
  assert.ok(s[2].cls.includes("out"));
  assert.ok(s[2].inner.includes(`<span class="lives">out</span>`));
  assert.ok(!s[0].cls.includes("out") && !s.some((x) => x.cls.includes("on")), "nobody is on in Everyone at once");
  assert.ok(s[3].inner.includes(`<span class="away">offline</span>`));
});

test("more than 20 seats are small", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => player(`p${i}`));
  const s21 = seats(draw(classic(many(21), "p0")));
  assert.equal(s21.length, 21);
  assert.ok(s21.every((x) => x.cls.includes("small")));
  s21.forEach((x, i) => assert.equal(x.cls.includes("ring-1"), i % 2 === 1, `seat ${i}`));
  const s20 = seats(draw(classic(many(20), "p0")));
  assert.ok(s20.every((x) => !x.cls.includes("small") && !x.cls.includes("ring-1")));
});

test("a new arrival pops in, started part-way through", () => {
  const ps = [player("a"), player("b"), player("c")];
  const popElapsed = (pid: string) => ({ a: 120.4, b: null, c: Number.NaN } as Record<string, number | null>)[pid];
  const [a, b, c] = seats(draw(everyone(ps), { popElapsed }));
  assert.ok(a.cls.includes("pop"));
  assert.match(a.style, /;animation-delay:-120ms$/);
  assert.ok(!b.cls.includes("pop") && !b.style.includes("animation"));
  assert.ok(!c.cls.includes("pop") && !/NaN/.test(c.style), "junk never reaches the markup");
});

test("the circle: square box class, compact, and the bomb with its centre in the middle", () => {
  const view = classic([player("a"), player("b")], "a");
  const html = draw(view, { centre: '<span class="x">ST</span>' });
  assert.match(html, /^<div class="circle">/);
  assert.match(draw(view, { compact: true }), /^<div class="circle compact">/);
  assert.ok(html.includes(`<div class="circle-centre">${renderBomb(BOMB, '<span class="x">ST</span>')}</div>`));
});

test("style.css: the circle box is square, so the arrow's angle is the seat's angle", () => {
  const rule = CSS.match(/(?:^|\n)\.circle \{([^}]*)\}/);
  assert.ok(rule, "a .circle rule");
  assert.match(rule[1], /aspect-ratio:\s*1\s*;/);
});

test("style.css: the pop lasts POP_MS and is off under reduced motion; the caret stops blinking", () => {
  assert.match(CSS, new RegExp(`\\.seat\\.pop \\{[^}]*animation: seat-pop ${POP_MS}ms`));
  assert.match(CSS, /@keyframes seat-pop\b/);
  const reduced = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
  assert.match(reduced, /\.seat\.pop[^{]*\{[^}]*animation: none/);
  assert.match(reduced, /\.caret[^{]*\{[^}]*animation: none/);
});

test("style.css: tiles use the tile colours and Rubik 800; matched tiles are raised and spark", () => {
  const tile = CSS.match(/\n\.tile \{([^}]*)\}/)?.[1] ?? "";
  for (const v of ["var(--tile)", "var(--tile-ink)", "var(--tile-edge)", "var(--font-display)", "font-weight: 800"]) assert.ok(tile.includes(v), v);
  const matched = CSS.match(/\n\.tile\.matched \{([^}]*)\}/)?.[1] ?? "";
  assert.ok(matched.includes("var(--spark)") && /transform: translateY\(-/.test(matched), "spark and raised");
});
