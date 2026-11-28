import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderBomb, BOMB_CSS, ARROW_SWING_MS, EXPLOSION_MS } from "../../public/app/bomb.js";

type BombState = Parameters<typeof renderBomb>[0];
const still = (over: Partial<BombState> = {}): BombState =>
  ({ lit: true, arrow: null, countdownMs: null, fuse: null, explosion: null, ...over });

test("the timings", () => {
  assert.equal(ARROW_SWING_MS, 600);
  assert.equal(EXPLOSION_MS, 1200);
});

test("unlit bomb has no flame; lit bomb has one", () => {
  const unlit = renderBomb(still({ lit: false }), "");
  const lit = renderBomb(still(), "");
  assert.ok(!/flame/.test(unlit), "no flame in the lobby");
  assert.match(lit, /class="[^"]*\bflame\b/);
  assert.match(lit, /class="bomb[ "]/);
});

test("countdown keeps data-countdown and data-bomb", () => {
  const calm = renderBomb(still({ countdownMs: 7_200 }), "");
  assert.match(calm, /^<div class="bomb[^"]*"[^>]* data-bomb[ >]/, "data-bomb on the root");
  assert.match(calm, /<span class="bomb-count" data-countdown>8<\/span>/);
  assert.ok(!/class="bomb[^"]*\burgent\b/.test(calm));
  const urgent = renderBomb(still({ countdownMs: 2_500 }), "");
  assert.match(urgent, /^<div class="bomb[^"]*\burgent\b/);
  assert.match(urgent, /data-countdown>3</);
  const hidden = renderBomb(still(), "");
  assert.match(hidden, /data-bomb/);
  assert.ok(!hidden.includes("data-countdown"), "no number for a hidden fuse");
});

test("inner is placed on the bomb body", () => {
  const html = renderBomb(still({ countdownMs: 5_000 }), `<span class="tiles">ST</span>`);
  assert.match(html, /class="bomb-face"[^>]*>[^]*<span class="tiles">ST<\/span>[^]*data-countdown/);
});

test("a running swing animates from --from to --to, started elapsedMs ago", () => {
  const html = renderBomb(still({ arrow: { from: -90, to: 0, elapsedMs: 200 } }), "");
  const arrow = html.match(/<g class="bomb-arrow[^"]*"[^>]*>/)?.[0] ?? "";
  assert.match(arrow, /swing/);
  assert.match(arrow, /--from:-90deg/);
  assert.match(arrow, /--to:0deg/);
  assert.match(arrow, /animation-delay:-200ms/);
});

test("finished swing is static at --to", () => {
  for (const elapsedMs of [ARROW_SWING_MS, 5_000]) {
    const html = renderBomb(still({ arrow: { from: 0, to: 90, elapsedMs } }), "");
    const arrow = html.match(/<g class="bomb-arrow[^"]*"[^>]*>/)?.[0] ?? "";
    assert.match(arrow, /--to:90deg/);
    assert.ok(!/swing|--from|animation-delay/.test(arrow), arrow);
  }
  assert.ok(!renderBomb(still(), "").includes("bomb-arrow"), "no arrow when arrow is null");
});

test("an explosion plays from elapsedMs, and only while it's reported", () => {
  const boom = renderBomb(still({ explosion: { elapsedMs: 300 } }), "");
  assert.match(boom, /class="bomb[^"]*\bexploding\b/);
  assert.match(boom, /class="bomb-burst"[^>]*animation-delay:-300ms/);
  assert.ok(!/flame/.test(boom), "the burst takes the flame's place");
  assert.ok(!renderBomb(still(), "").includes("bomb-burst"));
});

test("a lit visible fuse burns over totalMs; an unlit one stays where it was", () => {
  const burning = renderBomb(still({ countdownMs: 6_000, fuse: { totalMs: 10_000, elapsedMs: 4_000 } }), "");
  assert.match(burning, /class="bomb-fuse burning"[^>]*animation-duration:10000ms;animation-delay:-4000ms/);
  const paused = renderBomb(still({ lit: false, countdownMs: 6_000, fuse: { totalMs: 10_000, elapsedMs: 4_000 } }), "");
  assert.ok(!paused.includes("burning"));
  assert.ok(!paused.includes("animation"), "nothing moves on an unlit bomb");
  assert.match(paused, /stroke-dashoffset:\d/);
});

test("numbers in the state can't put text into the markup", () => {
  const html = renderBomb(
    still({ countdownMs: NaN, arrow: { from: Infinity, to: "1deg;}<x" as any, elapsedMs: NaN }, fuse: { totalMs: NaN, elapsedMs: -1 }, explosion: { elapsedMs: "<b>" as any } }),
    "",
  );
  assert.ok(!html.includes("<x") && !html.includes("<b>") && !/NaN|Infinity/.test(html), html);
});

test("BOMB_CSS has a reduced-motion block", () => assert.match(BOMB_CSS, /prefers-reduced-motion:\s*reduce/));

test("BOMB_CSS uses the theme's bomb colours and no colour values", () => {
  for (const name of ["--bomb", "--bomb-shade", "--bomb-rim", "--spark", "--lives"]) {
    assert.ok(BOMB_CSS.includes(`var(${name})`), name);
  }
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(BOMB_CSS));
  assert.ok(!/\b(rgba?|hsla?)\(/.test(BOMB_CSS));
  for (const k of ["bomb-swing", "bomb-flicker", "bomb-burst"]) assert.match(BOMB_CSS, new RegExp(`@keyframes ${k}\\b`));
});

test("every bomb style lives in the bomb file, none in style.css", () => {
  const css = readFileSync(new URL("../../public/app/style.css", import.meta.url), "utf8");
  // style.css may hold the seat pop's keyframes (the one animation outside the bomb), never the bomb's.
  assert.ok(!/@keyframes bomb-|\.bomb-svg|\.bomb\b/.test(css), "no bomb rules in style.css");
});

test("the countdown number leaves room on the bomb for the prompt above it", () => {
  // The prompt type and the prompt's tiles share the bomb's face with the number, so the number is
  // no more than a fifth of the bomb across, even when urgent.
  const size = (sel: string) => Number(BOMB_CSS.match(new RegExp(`\\n${sel} \\{[^}]*font-size: ([\\d.]+)cqw`))?.[1]);
  assert.ok(size("\\.bomb-count") <= 20, `calm ${size("\\.bomb-count")}`);
  assert.ok(size("\\.urgent \\.bomb-count") <= 22, `urgent ${size("\\.urgent \\.bomb-count")}`);
  assert.ok(size("\\.urgent \\.bomb-count") > size("\\.bomb-count"), "bigger when urgent");
});

test("the arrow starts outside the prompt's tiles, stays short of the inner ring, and is drawn above the flame", () => {
  const html = renderBomb(still({ arrow: { from: 0, to: 90, elapsedMs: 5_000 }, fuse: { totalMs: 10_000, elapsedMs: 2_000 } }), "");
  const points = (html.match(/<g class="bomb-arrow[^>]*><polygon points="([^"]+)"/)?.[1] ?? "")
    .split(" ")
    .map((p) => p.split(",").map(Number));
  assert.ok(points.length >= 3, html);
  // Distance from the bomb's middle (60, 60 in its 120 box) to the nearest point of each edge.
  const toEdge = ([ax, ay]: number[], [bx, by]: number[]) => {
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.max(0, Math.min(1, ((60 - ax) * dx + (60 - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(ax + t * dx - 60, ay + t * dy - 60);
  };
  const nearest = Math.min(...points.map((p, i) => toEdge(p, points[(i + 1) % points.length])));
  const furthest = Math.max(...points.map(([x, y]) => Math.hypot(x - 60, y - 60)));
  // Three prompt tiles on the two-ring bomb reach about 46 units out sideways (the label less far
  // up), and the tiles sit above the drawing: an arrow that starts nearer is partly hidden.
  assert.ok(nearest >= 50, `the arrow starts ${nearest.toFixed(1)} units from the middle`);
  // The tip may poke out past the bomb's box, but not so far that it reaches the inner ring's seats.
  assert.ok(furthest <= 72, `the tip is ${furthest.toFixed(1)} units from the middle`);
  // Where it crosses the fuse and the flame (pointing up and to the right), the arrow is on top.
  assert.ok(html.indexOf('class="bomb-arrow') > html.indexOf('class="bomb-flame"'), "arrow after the flame");
  assert.ok(html.indexOf('class="bomb-arrow') > html.indexOf('class="bomb-fuse'), "arrow after the fuse");
});

test("tension grows the flame in one CSS animation from the turn's age, up to 1.45; absent when null", () => {
  const html = renderBomb(still({ tension: { elapsedMs: 12_345.6, running: true } }), "");
  assert.match(html, /^<div class="bomb[^"]*" data-bomb data-tension-ms="12346">/);
  const grow = html.match(/<g class="bomb-grow" style="([^"]*)">/);
  assert.ok(grow, "the flame sits in a growing group");
  assert.match(grow[1], /animation-delay:-12346ms/);
  assert.ok(!grow[1].includes("paused"));
  // Paused (or the game paused): held where it is.
  const held = renderBomb(still({ tension: { elapsedMs: 3000, running: false } }), "");
  assert.match(held, /<g class="bomb-grow" style="[^"]*animation-play-state:paused/);
  // The flicker speeds up from 0.9 s towards 0.45 s, in steps, as the turn goes on.
  assert.match(renderBomb(still({ tension: { elapsedMs: 0, running: true } }), ""), /class="bomb-flame" style="[^"]*animation-duration:0\.9s/);
  assert.match(renderBomb(still({ tension: { elapsedMs: 25_000, running: true } }), ""), /class="bomb-flame" style="[^"]*animation-duration:0\.45s/);
  assert.match(renderBomb(still({ tension: { elapsedMs: 60_000, running: true } }), ""), /class="bomb-flame" style="[^"]*animation-duration:0\.45s/);
  // The CSS: one animation over TENSION_FULL_MS, ease-in, forwards, to 1.45; only with motion allowed.
  assert.match(BOMB_CSS, /@keyframes bomb-grow \{ from \{ transform: scale\(1\); \} to \{ transform: scale\(1\.45\); \} \}/);
  assert.match(BOMB_CSS, /\.bomb-grow \{[^}]*animation: bomb-grow 25000ms ease-in forwards/);
  const noPref = BOMB_CSS.slice(BOMB_CSS.indexOf("@media (prefers-reduced-motion: no-preference)"));
  assert.ok(noPref.includes("animation: bomb-grow"), "the growth only with motion allowed");
  // Without tension: no attribute, no growth.
  for (const t of [null, undefined]) {
    const plain = renderBomb(still({ tension: t }), "");
    assert.ok(!plain.includes("data-tension-ms") && !plain.includes("bomb-grow"));
  }
});
