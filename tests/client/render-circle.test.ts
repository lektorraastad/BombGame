import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCircle, spotlightText, circleMoments } from "../../public/app/render-circle.js";
import { seatPosition, screenAngle } from "../../public/app/circle-geometry.js";
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

test("two rings: the current player shows typing with a caret instead of the last word", () => {
  const lastWord = { word: "best", prompt: { text: "st", type: "ends" } };
  const ps = [player("a", { lastWord }), player("b", { lastWord }), ...Array.from({ length: 22 }, (_, i) => player(`x${i}`))];
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

test("style.css: the pop lasts POP_MS and is off under reduced motion", () => {
  assert.match(CSS, new RegExp(`\\.seat\\.pop \\{[^}]*animation: seat-pop ${POP_MS}ms`));
  assert.match(CSS, /@keyframes seat-pop\b/);
  const reduced = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
  assert.match(reduced, /\.seat\.pop[^{]*\{[^}]*animation: none/);
});

test("style.css: the caret is steady; outside the bomb only the pop and the moments animate", () => {
  assert.ok(!/caret-blink/.test(CSS), "no caret keyframes");
  const caret = [...CSS.matchAll(/([^{}]*\.caret[^{}]*)\{([^}]*)\}/g)];
  assert.ok(caret.length > 0, "a .caret rule");
  for (const m of caret) assert.ok(!/animation/.test(m[2]), m[1]);
  const moments = CSS.indexOf("/* ---- The moments");
  assert.deepEqual([...CSS.slice(0, moments).matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]), ["seat-pop"]);
});

test("style.css: seat names are never cut short", () => {
  const rules = [...CSS.matchAll(/([^{}]*\.seat[^{}]*\.name[^{}]*)\{([^}]*)\}/g)].filter((m) => m[1].includes(".circle"));
  assert.ok(rules.length > 0, "a .circle .seat .name rule");
  for (const [, sel, body] of rules) {
    assert.ok(!/text-overflow|overflow:\s*hidden|white-space:\s*nowrap/.test(body), sel);
  }
  const name = rules.find((m) => /\.circle \.seat \.name\s*$/.test(m[1].trim()) || m[1].trim() === ".circle .seat .name")!;
  // break-word, not anywhere: a name wraps at its spaces, and only a single word too long for the
  // label breaks. ("anywhere" lets the seat's grid squeeze a name and split words that would fit.)
  assert.match(name[2], /overflow-wrap:\s*break-word/, "long single words break instead of spilling out");
  assert.doesNotMatch(name[2], /anywhere|word-break:\s*break-all/);
});

test("style.css: tiles use the tile colours and Rubik 800; matched tiles are raised and spark", () => {
  const tile = CSS.match(/\n\.tile \{([^}]*)\}/)?.[1] ?? "";
  for (const v of ["var(--tile)", "var(--tile-ink)", "var(--tile-edge)", "var(--font-display)", "font-weight: 800"]) assert.ok(tile.includes(v), v);
  const matched = CSS.match(/\n\.tile\.matched \{([^}]*)\}/)?.[1] ?? "";
  assert.ok(matched.includes("var(--spark)") && /transform: translateY\(-/.test(matched), "spark and raised");
});

test("on an oval (aspect given), the arrow is turned to where the current seat really is", () => {
  const ps = Array.from({ length: 8 }, (_, i) => player(`p${i}`));
  const deg = (v: number) => `${Math.round(v * 10) / 10}deg`;
  const bomb: BombState = { ...BOMB, arrow: { from: 0, to: 45, elapsedMs: 100 } };
  const html = draw(classic(ps, "p1"), { bomb, aspect: 16 / 9 });
  assert.ok(html.includes(`--from:${deg(screenAngle(0, 16 / 9))};--to:${deg(screenAngle(45, 16 / 9))};`), html.match(/--from[^"]*/)?.[0]);
  // Two rings: the current seat's own ring.
  const many = Array.from({ length: 30 }, (_, i) => player(`p${i}`));
  const inner = seatPosition(1, 30);
  const two = draw(classic(many, "p1"), { bomb: { ...BOMB, arrow: { from: inner.angle, to: inner.angle, elapsedMs: 600 } }, aspect: 16 / 9 });
  assert.ok(two.includes(`--to:${deg(screenAngle(inner.angle, 16 / 9, 1))}"`));
  // No aspect (not measured yet, or a test): the arrow as the tracker gave it.
  assert.ok(draw(classic(ps, "p1"), { bomb }).includes("--from:0deg;--to:45deg;"));
  for (const bad of [Number.NaN, -1, 0, "2"]) assert.ok(draw(classic(ps, "p1"), { bomb, aspect: bad }).includes("--from:0deg;--to:45deg;"), String(bad));
});

test("style.css: on the projector a last word is one row of tiles, never split", () => {
  const rule = (sel: string) => CSS.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  assert.match(rule(".p-ring .seat .last-word .tiles"), /flex-wrap:\s*nowrap/);
  assert.match(rule(".p-ring .seat .last-word .tiles"), /max-width:\s*none/);
  assert.match(rule(".p-ring .seat .last-word"), /max-width:\s*none/);
  assert.match(rule(".p-ring .circle .seat"), /max-width:\s*none/);
});

const fifteen = (over: P = {}) => Array.from({ length: 15 }, (_, i) => player(`p${i}`, { lastWord: { word: `word${i}`, prompt: { text: "or", type: "contains" } }, ...over }));
/** The spotlight elements: each one's inner HTML. The spotlight holds no nested <div>. */
const spotlights = (html: string) => [...html.matchAll(/<div class="spotlight">(.*?)<\/div>/gs)].map((m) => m[1]);

test("the spotlight shows the current player's typing with a caret, and the seat shows nothing under the name", () => {
  const view = classic(fifteen(), "p3", { typing: "himse" });
  const html = draw(view);
  const spots = spotlights(html);
  assert.equal(spots.length, 1);
  assert.equal(spots[0], `${tiles("himse")}<span class="caret"></span>`);
  assert.deepEqual([...spots[0].matchAll(/class="tile">([^<]*)</g)].map((m) => m[1]), ["h", "i", "m", "s", "e"]);
  assert.match(html, /<div class="spotlight">.*<\/div><\/div>$/s, "the circle's last child");
  assert.equal(spotlightText(view, 15), "himse");
  const s = seats(html);
  assert.ok(s[3].cls.includes("on"));
  assert.ok(!s[3].inner.includes('class="typing"') && !s[3].inner.includes('class="last-word"'), s[3].inner);
  assert.ok(s[4].inner.includes('class="last-word"'), "the others keep their last words");
});

test("no spotlight when typing is absent or not a string", () => {
  for (const over of [{}, { typing: 42 }]) {
    const view = classic(fifteen(), "p3", over);
    const html = draw(view);
    assert.equal(spotlights(html).length, 0, JSON.stringify(over));
    assert.ok(!html.includes("spotlight"));
    assert.equal(spotlightText(view, 15), null);
    const s = seats(html);
    assert.ok(s[3].inner.includes(`<span class="last-word">${matchedTiles("word3", { text: "or", type: "contains" })}</span>`));
    assert.ok(!s[3].inner.includes("caret"));
  }
});

test("no spotlight in Everyone at once", () => {
  const view = { ...everyone(fifteen()), typing: "abc" };
  const html = draw(view);
  assert.ok(!html.includes("spotlight") && !html.includes("caret"));
  assert.equal(spotlightText(view, 15), null);
});

test("no spotlight with more than 20 seats; the typing stays under the seat", () => {
  const ps = Array.from({ length: 24 }, (_, i) => player(`p${i}`));
  const view = classic(ps, "p3", { typing: "abc" });
  const html = draw(view);
  assert.ok(!html.includes("spotlight"));
  assert.equal(spotlightText(view, 24), null);
  assert.equal(spotlightText(view, 20), "abc", "20 seats is still one ring");
  assert.ok(seats(html)[3].inner.includes(`<span class="typing">${tiles("abc")}<span class="caret"></span></span>`));
  // 20 seats: one ring, so the spotlight.
  assert.equal(spotlights(draw(classic(ps.slice(0, 20), "p3", { typing: "abc" }))).length, 1);
});

test("spotlight text is escaped", () => {
  const html = draw(classic(fifteen(), "p3", { typing: "<b>&" }));
  assert.ok(!html.includes("<b>"));
  assert.equal(spotlights(html)[0], `${tiles("<b>&")}<span class="caret"></span>`);
  assert.ok(spotlights(html)[0].includes("&lt;") && spotlights(html)[0].includes("&amp;"));
  const masked = spotlights(draw(classic(fifteen(), "p3", { typing: "★★★★" })))[0];
  assert.equal((masked.match(/<span class="tile">★<\/span>/g) ?? []).length, 4);
});

test("style.css: the spotlight never animates (but for the refused shake) and never wraps", () => {
  const rules = [...CSS.matchAll(/([^{}]*\.spotlight[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length > 0, "a .spotlight rule");
  for (const m of rules) if (!m[1].includes(".spotlight.refused")) assert.ok(!/animation/.test(m[2]), m[1]);
  assert.ok(rules.some((m) => /white-space:\s*nowrap|flex-wrap:\s*nowrap/.test(m[2])), "nowrap");
  const base = rules.find((m) => /(^|\n|\*\/)\s*\.spotlight\s*$/.test(m[1]))?.[2] ?? "";
  assert.match(base, /position:\s*absolute/);
  assert.match(base, /left:\s*50%/);
  assert.match(base, /top:\s*calc\(50% \+ var\(--bomb-size\) \* 0\.62\)/);
  assert.match(base, /transform:\s*translateX\(-50%\)/);
  // In cqh of the circle, and no wider than a share of it (a long word gets smaller tiles).
  assert.match(base, /font-size:\s*min\([\d.]+cqh,\s*calc\([\d.]+cqw/);
  assert.match(base, /z-index:\s*3/);
});

// ---- the moments (motion.js's word, refused, hearts and examples, passed in by the pages) ----

const ST_PROMPT = { text: "st", type: "contains" };
/** Ann just played "station" and the turn moved to Ben. */
const afterWord = (over: P = {}) =>
  classic([player("a", { lastWord: { word: "station", prompt: ST_PROMPT } }), player("b"), player("c")], "b", over);
const flying = (over: Record<string, unknown> = {}) =>
  ({ pid: "a", word: "station", prompt: ST_PROMPT, fromSpotlight: true, elapsedMs: 120, ...over });

test("a word moment draws one .fly-word with the word's tiles and a negative delay of its elapsed time", () => {
  const html = draw(afterWord(), { word: flying() });
  const fly = [...html.matchAll(/<div class="fly-word" style="([^"]*)" aria-hidden="true">(.*?)<\/div>/gs)];
  assert.equal(fly.length, 1);
  const [, style, inner] = fly[0];
  assert.equal(inner, matchedTiles("station", ST_PROMPT));
  assert.match(style, /^animation-delay:-120ms;/);
  // It flies to Ann's seat, in percentages of the ring box.
  const pos = seatPosition(0, 3);
  assert.ok(style.includes(`--x:${pos.left.toFixed(1)}%`) && style.includes(`--y:${pos.top.toFixed(1)}%`), style);
  // Ann's seat pops when it lands, and her last word appears there; the next turn draws as normal.
  const [a, b] = seats(html);
  assert.ok(a.cls.includes("landing") && a.style.endsWith(";animation-delay:-120ms"));
  assert.ok(a.inner.includes(`<span class="last-word landing" style="animation-delay:-120ms">${matchedTiles("station", ST_PROMPT)}</span>`));
  assert.ok(b.cls.includes("on"));
  // Ben's typing still takes the spotlight while the word flies.
  const typing = draw(afterWord({ typing: "ro" }), { word: flying() });
  assert.ok(typing.includes(`<div class="spotlight">${tiles("ro")}<span class="caret"></span></div>`));
  assert.equal((typing.match(/class="fly-word"/g) ?? []).length, 1);
  // Nothing extra without a moment.
  assert.ok(!draw(afterWord()).includes("fly-word") && !draw(afterWord()).includes("landing"));
});

test("without a spotlight the correct word only pops in at the seat", () => {
  // Live typing off: the word didn't come from the spotlight.
  const off = draw(afterWord(), { word: flying({ fromSpotlight: false, elapsedMs: 50 }) });
  assert.ok(!off.includes("fly-word"));
  const [a] = seats(off);
  assert.ok(!a.cls.includes("landing"));
  assert.ok(a.inner.includes(`<span class="last-word pop-in" style="animation-delay:-50ms">`));
  // More than 20 on the circle: no spotlight, so no flight either.
  const many = [player("a", { lastWord: { word: "station", prompt: ST_PROMPT } }), ...Array.from({ length: 22 }, (_, i) => player(`x${i}`))];
  const two = draw(classic(many, "x0"), { word: flying() });
  assert.ok(!two.includes("fly-word"));
  assert.ok(seats(two)[0].inner.includes(`class="last-word pop-in"`));
});

test("refused shakes the spotlight, else the seat's typing, else the name", () => {
  const refused = { pid: "b", elapsedMs: 200 };
  // A spotlight: it shakes, and no seat does.
  const spot = draw(afterWord({ typing: "xq" }), { refused });
  assert.ok(spot.includes(`<div class="spotlight refused" style="animation-delay:-200ms">${tiles("xq")}<span class="caret"></span></div>`));
  assert.ok(!spot.includes("shake") && seats(spot).every((s) => !s.cls.includes("refused")));
  // Two rings: the typing under Ben's seat shakes.
  const many = [player("a"), player("b"), ...Array.from({ length: 22 }, (_, i) => player(`x${i}`))];
  const two = draw(classic(many, "b", { typing: "xq" }), { refused });
  const b2 = seats(two)[1];
  assert.ok(b2.cls.includes("refused"));
  assert.ok(b2.inner.includes(`<span class="typing shake" style="animation-delay:-200ms">${tiles("xq")}<span class="caret"></span></span>`));
  assert.ok(!two.includes("spotlight"));
  // Live typing off: Ben's name plate shakes.
  const off = draw(afterWord(), { refused });
  const b3 = seats(off)[1];
  assert.ok(b3.cls.includes("refused"));
  assert.ok(b3.inner.includes(`<span class="name shake" style="animation-delay:-200ms">b</span>`));
  // Without a moment, nothing shakes.
  assert.ok(!draw(afterWord({ typing: "xq" })).includes("refused"));
});

test("a lost heart draws one .crack heart after the remaining hearts", () => {
  const view = classic([player("a", { lives: 1 }), player("b", { lives: 0, alive: false }), player("c")], "c");
  const html = draw(view, { hearts: new Map([["a", 300], ["b", 300]]) });
  const [a, b, c] = seats(html);
  const crack = `<span class="crack" style="animation-delay:-300ms" aria-hidden="true"><span class="crack-l">❤</span><span class="crack-r">❤</span></span>`;
  assert.ok(a.inner.includes(`<span class="lives">❤${crack}</span>`), a.inner);
  assert.equal((a.inner.match(/class="crack"/g) ?? []).length, 1);
  // Knocked out by it: "out", then the last heart cracking.
  assert.ok(b.inner.includes(`<span class="lives">out${crack}</span>`));
  assert.ok(c.inner.includes(`<span class="lives">❤❤❤</span>`));
  assert.ok(!draw(view).includes("crack"));
});

test("examples show under the bomb in place of the spotlight and never cover the prompt", () => {
  const centre = `<div class="p-prompt">${tiles("ST")}</div>`;
  const html = draw(afterWord(), { examples: ["stone", "<b>"], centre });
  assert.ok(html.includes(`<div class="spot-examples" style="--n:10"><span class="spot-examples-label">Could have said</span><div class="spot-examples-row">${tiles("stone")}${tiles("<b>")}</div></div>`), html);
  assert.ok(!html.includes('class="spotlight'));
  // The bomb still holds the prompt, and the examples sit outside the bomb, after it.
  const bomb = html.slice(html.indexOf('<div class="circle-centre">'), html.indexOf('<div class="spot-examples" '));
  assert.ok(bomb.includes(centre));
  // Live typing takes the place back (the page stops passing examples then), and without examples
  // nothing extra is drawn.
  assert.ok(!draw(afterWord({ typing: "s" })).includes("spot-examples"));
  assert.ok(!draw(afterWord(), { examples: null }).includes("spot-examples"));
  assert.ok(!draw(afterWord(), { examples: [] }).includes("spot-examples"));
  // Everyone at once has no spotlight, but the examples still show there.
  assert.ok(draw(everyone([player("a"), player("b")]), { examples: ["stone"] }).includes('<div class="spot-examples" '));
});

test("live typing always wins the spotlight, even when examples are passed", () => {
  const html = draw(afterWord({ typing: "ro" }), { examples: ["stone"] });
  assert.ok(html.includes(`<div class="spotlight">${tiles("ro")}<span class="caret"></span></div>`));
  assert.ok(!html.includes("spot-examples"));
});

test("circleMoments passes the moments on, and examples left out mean none", () => {
  const view = afterWord({ examples: ["stone"] });
  assert.equal(circleMoments({}).examples, null);
  assert.deepEqual(circleMoments({ examples: ["card"] }).examples, ["card"]);
  assert.ok(!draw(view, circleMoments({})).includes("spot-examples"), "the view's own examples are never used");
});

// ---- sparks (batch 6) ----

const sparkOf = (inner: string) => inner.match(/<span class="spark[^"]*"[^>]*>.*?<\/span>(?:<i [^>]*><\/i>)*<\/span>/s)?.[0] ?? null;

test("a spark draws a ring and 6 points with a negative delay", () => {
  const view = classic([player("a"), player("b"), player("c")], "a");
  const [a, b] = seats(draw(view, { sparks: new Map([["b", { elapsedMs: 240.4, ghost: false }]]) }));
  assert.equal(sparkOf(a.inner), null);
  const s = sparkOf(b.inner)!;
  assert.ok(s, b.inner);
  assert.match(s, /^<span class="spark" style="animation-delay:-240ms" aria-hidden="true">/);
  assert.equal((s.match(/<span class="ring"><\/span>/g) ?? []).length, 1);
  const points = [...s.matchAll(/<i style="--a:(\d+)deg"><\/i>/g)].map((m) => Number(m[1]));
  assert.deepEqual(points, [0, 60, 120, 180, 240, 300]);
  assert.ok(b.inner.startsWith(avatarImg(0) + s), "right after the emoji, in its place");
  assert.ok(!draw(view).includes("spark"), "no spark without one");
});

test("ghost spark has the ghost class", () => {
  const view = everyone([player("a", { alive: false }), player("b")]);
  const [a, b] = seats(draw(view, { sparks: new Map([["a", { elapsedMs: 100, ghost: true }], ["b", { elapsedMs: 5, ghost: false }]]) }));
  assert.match(a.inner, /<span class="spark ghost" style="animation-delay:-100ms"/);
  assert.match(b.inner, /<span class="spark" style="animation-delay:-5ms"/);
});

test("spark markup has no player text", () => {
  const evil = "<b>secretword</b>";
  const view = classic([player("a", { nickname: evil }), player("b")], "b");
  const html = draw(view, { sparks: new Map([["a", { elapsedMs: 10, ghost: false, word: evil } as any]]) });
  const s = sparkOf(seats(html)[0].inner)!;
  assert.ok(s);
  assert.ok(!/secretword|&lt;|\bb\b/.test(s), s);
  // Junk times draw nothing.
  for (const junk of [NaN, Infinity, "10", null, { elapsedMs: "x" }]) {
    assert.ok(!draw(view, { sparks: new Map([["a", junk as any]]) }).includes("spark"), String(junk));
  }
  assert.ok(!draw(view, { sparks: "a" as any }).includes("spark"));
});

test("a spark then a word moment on the same seat both draw", () => {
  const view = classic([player("a", { lastWord: { word: "stone", prompt: { text: "st", type: "contains" } } }), player("b")], "b");
  const html = draw(view, {
    sparks: new Map([["a", { elapsedMs: 200, ghost: false }]]),
    word: { pid: "a", word: "stone", prompt: { text: "st", type: "contains" }, fromSpotlight: false, elapsedMs: 50 },
    hearts: new Map([["a", 30]]),
  });
  const a = seats(html)[0];
  assert.ok(sparkOf(a.inner), "spark");
  assert.ok(a.inner.includes(`last-word pop-in" style="animation-delay:-50ms"`), "word");
  assert.ok(a.inner.includes(`class="crack"`), "heart");
});

test("circleMoments passes the sparks on", () => {
  const sparks = new Map([["a", { elapsedMs: 1, ghost: false }]]);
  assert.equal(circleMoments({ sparks }).sparks, sparks);
  assert.equal(circleMoments({}).sparks, undefined);
});

test("with more than 20 seats the examples are not drawn under the bomb", () => {
  const many = Array.from({ length: 24 }, (_, i) => player(`x${i}`));
  assert.ok(!draw(classic(many, "x0"), { examples: ["stone"] }).includes("spot-examples"));
});

test("all moment text is escaped", () => {
  const evil = "<b>x</b>";
  const view = classic([player("a", { nickname: evil, lastWord: { word: evil, prompt: { text: "<b>", type: "contains" } } }), player("b")], "a");
  const html = draw(view, {
    word: { pid: "a", word: evil, prompt: { text: "<b>", type: "contains" }, fromSpotlight: true, elapsedMs: 10 },
    refused: { pid: "a", elapsedMs: 10 },
    hearts: new Map([["a", 10]]),
    examples: [evil],
  });
  assert.ok(html.includes("&lt;b&gt;"));
  assert.ok(!html.includes("<b>"));
});

test("every moment's keyframes and animations are inside the no-preference media query", () => {
  const start = CSS.indexOf("/* ---- The moments");
  assert.ok(start >= 0, "a moments section");
  const section = CSS.slice(start).replace(/\/\*[^]*?\*\//g, "");
  // Walk the braces: note which blocks are "@media (prefers-reduced-motion: no-preference)".
  const stack: boolean[] = [];
  let found = 0;
  // The one exception: the reduced-motion spark ring's opacity-only "spark-hold" (no movement), which
  // ends it invisible without a redraw. Tested below in the spark test.
  const hold = (i: number) => /^(@keyframes spark-hold(-faint)?\b|animation\s*:\s*spark-hold\b)/.test(section.slice(i));
  const re = /@keyframes [\w-]+|animation\s*:|\{|\}/g;
  let lastHead = 0;
  for (let m; (m = re.exec(section)); ) {
    if (m[0] === "{") {
      stack.push(section.slice(lastHead, m.index).includes("@media (prefers-reduced-motion: no-preference)"));
      lastHead = m.index + 1;
    } else if (m[0] === "}") {
      stack.pop();
      lastHead = m.index + 1;
    } else {
      if (hold(m.index)) continue;
      found++;
      assert.ok(stack.some(Boolean), `${m[0]} at ${m.index} is outside the no-preference media query`);
    }
  }
  assert.ok(found >= 20, "the moments' keyframes and animations were found");
  // Without it, the end states: no flying word, no cracking heart, no burst.
  assert.match(section, /\.fly-word \{[^}]*display: none/);
  assert.match(section, /\.crack \{[^}]*display: none/);
  assert.match(section, /\.win-burst \{[^}]*display: none/);
});

test("reduced-motion CSS: spark keyframes only under no-preference", () => {
  const start = CSS.indexOf("/* ---- The moments");
  const section = CSS.slice(start).replace(/\/\*[^]*?\*\//g, "");
  const open = section.indexOf("@media (prefers-reduced-motion: no-preference)");
  assert.ok(open >= 0);
  const before = section.slice(0, open);
  const inside = section.slice(open);
  for (const k of ["spark-ring", "spark-fly", "spark-ring-faint", "spark-fly-faint"]) {
    assert.ok(new RegExp(`@keyframes ${k} `).test(inside), `${k} under no-preference`);
    assert.ok(!before.includes(`@keyframes ${k}`), `${k} not outside`);
  }
  // Without motion: a still ring for the spark's time, and no star points. Only its opacity animates,
  // ending invisible by itself (no redraw is needed after SPARK_MS).
  assert.match(before, /\.spark \.ring \{[^}]*opacity: 0\.\d/);
  assert.match(before, /\.spark \.ring \{[^}]*animation: spark-hold 700ms[^;]*forwards/);
  assert.match(before, /@keyframes spark-hold \{[^}]*(?:\{[^}]*\}[^}]*)*\}/);
  assert.ok(!/@keyframes spark-hold[^]*?(transform|translate|scale|rotate)/.test(before.slice(before.indexOf("@keyframes spark-hold"), before.indexOf("@keyframes spark-hold") + 200)), "motionless");
  assert.match(before, /\.spark i \{[^}]*display: none/);
  // The colours come from the theme: the spark colour, and muted for a ghost.
  assert.match(CSS, /\.spark \.ring \{[^}]*var\(--spark\)/);
  assert.match(CSS, /\.spark\.ghost \.ring \{[^}]*var\(--muted\)/);
});
