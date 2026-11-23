// The bomb: its drawing, the flickering flame, the burning fuse, the turn arrow and the explosion,
// all in this one file. A new bomb design means replacing this file, keeping renderBomb, BOMB_CSS,
// ARROW_SWING_MS, EXPLOSION_MS, data-bomb on the root and data-countdown on the number.
//
// Pure: renderBomb returns an HTML string. The pages replace their HTML on every view, so every
// animation is started part-way through with a negative animation-delay of the time already gone.
// Colours come only from the theme's named colours (themes.css).
import { URGENT_MS } from "./countdown.js";

/** How long the arrow takes to swing to the next player, with a small bounce at the end. */
export const ARROW_SWING_MS = 600;
/** How long the explosion plays. */
export const EXPLOSION_MS = 1200;

/** @typedef {{
 *   lit: boolean,                                            // false: no flame, fuse unlit (lobby)
 *   arrow: null | { from: number, to: number, elapsedMs: number },  // degrees; null = no arrow (lobby, Everyone)
 *   countdownMs: number | null,                              // visible timer → number on the bomb with data-countdown
 *   fuse: null | { totalMs: number, elapsedMs: number },     // visible timer → fuse burns down over totalMs
 *   explosion: null | { elapsedMs: number },                 // within EXPLOSION_MS of an explosion
 * }} BombState */

// ---- The drawing, in a 120 × 120 box. The body is in the middle, so the arrow turns about it. ----

const R_BODY = 34;
/** The fuse is an arc of a circle: it leaves the cap going up, then curls over to the right. */
const FUSE_R = 18;
const FUSE_START = { x: 60 + 42 * Math.SQRT1_2, y: 60 - 42 * Math.SQRT1_2 }; // the top of the cap
const FUSE_C = { x: FUSE_START.x + FUSE_R, y: FUSE_START.y };
const FUSE_FROM_DEG = 180; // where the fuse leaves the cap, on the arc's circle
const FUSE_TO_DEG = 285; // the fuse's tip
const FUSE_STUB_DEG = 195; // how far it burns down: a short stub is left at the end
/** How far the flame travels back along the arc as the fuse burns, and how much fuse goes. */
const TRAVEL_DEG = FUSE_TO_DEG - FUSE_STUB_DEG;
const BURNT = (100 * TRAVEL_DEG) / (FUSE_TO_DEG - FUSE_FROM_DEG); // in pathLength units of 100

/** @param {number} deg */
const onFuse = (deg) => ({
  x: FUSE_C.x + FUSE_R * Math.cos((deg * Math.PI) / 180),
  y: FUSE_C.y + FUSE_R * Math.sin((deg * Math.PI) / 180),
});
const TIP = onFuse(FUSE_TO_DEG);

/** @param {number} v */
const f1 = (v) => v.toFixed(1);
const px = (/** @type {{ x: number, y: number }} */ p) => `${f1(p.x)}px ${f1(p.y)}px`;

/** A star's points around (60, 60). @param {number} n @param {number} outer @param {number} inner @param {number} turn */
function star(n, outer, inner, turn) {
  return Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((i * 180) / n + turn) * (Math.PI / 180);
    return `${f1(60 + r * Math.sin(a))},${f1(60 - r * Math.cos(a))}`;
  }).join(" ");
}

const FUSE_D = `M${f1(FUSE_START.x)} ${f1(FUSE_START.y)} A${FUSE_R} ${FUSE_R} 0 0 1 ${f1(TIP.x)} ${f1(TIP.y)}`;

const BODY = `<circle class="bomb-shell" cx="60" cy="60" r="${R_BODY}"/>
<path class="bomb-shade" d="M89.6 51.2 A31 31 0 0 1 41.8 85.9 A36 36 0 0 0 89.6 51.2 Z"/>
<path class="bomb-shine" d="M39 55 A22 22 0 0 1 54 39"/>
<rect class="bomb-cap" x="${f1(60 + 36 * Math.SQRT1_2 - 9)}" y="${f1(60 - 36 * Math.SQRT1_2 - 6)}" width="18" height="12" rx="3" transform="rotate(45 ${f1(60 + 36 * Math.SQRT1_2)} ${f1(60 - 36 * Math.SQRT1_2)})"/>`;

const FLAME = `<path class="bomb-flame-out" transform="translate(${f1(TIP.x)} ${f1(TIP.y)})" d="M0 3C-7 3-9-4-6-10C-4-14-1-16-1-24C4-19 9-13 8-5C7 0 4 3 0 3Z"/>
<path class="bomb-flame-in" transform="translate(${f1(TIP.x)} ${f1(TIP.y)})" d="M0 2C-4 2-5-3-3-7C-2-10 0-11 0-15C3-11 5-7 4-3C4 0 2 2 0 2Z"/>`;

/** The turn arrow, pointing up before it is turned. It starts 50 units out, clear of the prompt's
 * tiles and label (they sit above the drawing and would hide its base when it points sideways), and
 * its tip stops 72 units out, short of the inner ring's seats. It is drawn after the fuse and the
 * flame, so it stays on top where it crosses them. */
const ARROW = `<polygon points="60,-12 77,10 60,4 43,10"/>`;

/** Bits flying out of the explosion, every 30°. */
const DEBRIS_ANGLES = Array.from({ length: 12 }, (_, i) => i * 30 + 15);

/** A whole number of ms (or tenth of a degree) for a style value; anything odd becomes 0. */
const num = (/** @type {unknown} */ v, digits = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

/**
 * The bomb as an HTML string.
 * @param {BombState} state
 * @param {string} inner trusted HTML placed on the bomb's body (the renderers escape their own text)
 * @returns {string}
 */
export function renderBomb(state, inner) {
  const ms = typeof state.countdownMs === "number" && Number.isFinite(state.countdownMs) ? Math.max(0, state.countdownMs) : null;
  const boom = state.explosion ? num(state.explosion.elapsedMs) : null;
  const lit = state.lit === true;
  const cls = `bomb${lit ? " lit" : ""}${ms !== null && ms <= URGENT_MS ? " urgent" : ""}${boom !== null ? " exploding" : ""}`;

  // The fuse: burning down while lit with a visible timer, held where it was while unlit.
  const fuse = state.fuse;
  const total = fuse ? Math.max(1, num(fuse.totalMs)) : 1;
  const gone = fuse ? Math.max(0, num(fuse.elapsedMs)) : 0;
  const burning = lit && fuse !== null;
  const burnStyle = `animation-duration:${total}ms;animation-delay:-${gone}ms`;
  const fuseOpen = burning
    ? `<g class="bomb-fuse burning" style="${burnStyle}">`
    : fuse
      ? `<g class="bomb-fuse" style="stroke-dashoffset:${f1((BURNT * Math.min(gone, total)) / total)}">`
      : `<g class="bomb-fuse">`;
  const fusePaths = `${fuseOpen}<path class="bomb-fuse-edge" pathLength="100" d="${FUSE_D}"/><path class="bomb-fuse-core" pathLength="100" d="${FUSE_D}"/></g>`;

  // The flame rides the tip of the fuse and flickers; the burst takes its place in an explosion.
  // The flicker starts from a clock that keeps running between redraws, so it never restarts.
  const flickerAt = num(fuse ? fuse.elapsedMs : state.arrow ? state.arrow.elapsedMs : 0);
  const flameInner = `<g class="bomb-flame" style="animation-delay:-${flickerAt}ms">${FLAME}</g>`;
  const flame = !lit || boom !== null
    ? ""
    : burning
      ? `<g class="bomb-travel" style="${burnStyle}"><g class="bomb-upright" style="${burnStyle}">${flameInner}</g></g>`
      : flameInner;

  // The arrow: swinging for ARROW_SWING_MS, then still at --to.
  let arrow = "";
  if (state.arrow) {
    const to = num(state.arrow.to, 1);
    const elapsed = num(state.arrow.elapsedMs);
    arrow = elapsed >= ARROW_SWING_MS
      ? `<g class="bomb-arrow" style="--to:${to}deg">${ARROW}</g>`
      : `<g class="bomb-arrow swing" style="--from:${num(state.arrow.from, 1)}deg;--to:${to}deg;animation-delay:-${Math.max(0, elapsed)}ms">${ARROW}</g>`;
  }

  const delay = boom === null ? "" : ` style="animation-delay:-${boom}ms"`;
  const explosion = boom === null
    ? ""
    : `<svg class="bomb-boom" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
<circle class="bomb-shock" cx="60" cy="60" r="46"${delay}/>
${DEBRIS_ANGLES.map((a, i) => `<circle class="bomb-debris${i % 2 ? " alt" : ""}" cx="60" cy="60" r="${i % 3 ? 4 : 6}" style="--a:${a}deg;animation-delay:-${boom}ms"/>`).join("")}
<polygon class="bomb-burst" points="${star(12, 62, 34, 0)}"${delay}/>
<polygon class="bomb-burst-core" points="${star(9, 38, 20, 20)}"${delay}/>
</svg>`;

  const count = ms === null ? "" : `<span class="bomb-count" data-countdown>${Math.ceil(ms / 1000)}</span>`;
  return `<div class="${cls}" data-bomb><svg class="bomb-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
${fusePaths}
<g class="bomb-body"${delay}>${BODY}</g>
${flame}${arrow}
</svg><div class="bomb-face">${inner}${count}</div>${explosion}</div>`;
}

/** Every bomb style, keyframe and reduced-motion rule. The page puts it in a <style> once. */
export const BOMB_CSS = `
.bomb {
  position: relative; display: inline-block; flex: none; vertical-align: middle; line-height: 1;
  width: var(--bomb-size, 8em); aspect-ratio: 1; container-type: inline-size;
}
.bomb-svg, .bomb-boom { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: visible; pointer-events: none; }
.bomb-svg *, .bomb-boom * { transform-box: view-box; }

.bomb-shell { fill: var(--bomb); stroke: var(--bomb-rim); stroke-width: 4; }
.bomb-shade { fill: var(--bomb-shade); }
.bomb-shine { fill: none; stroke: var(--bomb-rim); stroke-opacity: 0.55; stroke-width: 5; stroke-linecap: round; }
.bomb-cap { fill: var(--bomb-shade); stroke: var(--bomb-rim); stroke-width: 3; }
.bomb-body { transform-origin: 60px 60px; }

.bomb-fuse { stroke-dasharray: 100 200; stroke-dashoffset: 0; }
.bomb-fuse path { fill: none; stroke-linecap: round; }
.bomb-fuse-edge { stroke: var(--tile-edge); stroke-width: 8; }
.bomb-fuse-core { stroke: var(--tile); stroke-width: 4.5; }
.bomb-fuse.burning { animation: bomb-burn linear both; }
.bomb-travel { transform-origin: ${px(FUSE_C)}; animation: bomb-travel linear both; }
.bomb-upright { transform-origin: ${px(TIP)}; animation: bomb-upright linear both; }

.bomb-flame { transform-origin: ${px(TIP)}; animation: bomb-flicker 0.5s ease-in-out infinite; }
.bomb-flame-out { fill: var(--lives); stroke: var(--spark); stroke-width: 1.5; stroke-linejoin: round; }
.bomb-flame-in { fill: var(--spark); }
.urgent .bomb-flame { animation-duration: 0.22s; }

.bomb-arrow { transform-origin: 60px 60px; transform: rotate(var(--to)); }
.bomb-arrow polygon { fill: var(--spark); stroke: var(--tile-ink); stroke-width: 2.5; stroke-linejoin: round; }
.bomb-arrow.swing { animation: bomb-swing ${ARROW_SWING_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }

.bomb-face {
  position: absolute; left: 50%; top: 50%; width: ${f1((200 * R_BODY) / 120)}%; height: ${f1((200 * R_BODY) / 120)}%;
  transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2cqw;
}
.bomb-count {
  font-family: var(--font-display, sans-serif); font-weight: 800; font-size: 18cqw; line-height: 1;
  font-variant-numeric: tabular-nums; color: var(--names);
}
/* The number shares the face with the prompt type and the prompt's tiles above it, so it stays
   smaller than the tiles. On the bomb itself: spark is at least 3:1 on every bomb (Workshop red
   included), lives is not. */
.urgent .bomb-count { color: var(--spark); font-size: 21cqw; }
.urgent .bomb-body { animation: bomb-shake 0.25s linear infinite; }

.bomb.exploding .bomb-body { animation: bomb-jolt ${EXPLOSION_MS}ms ease-out both; }
.bomb-boom * { transform-origin: 60px 60px; }
.bomb-burst { fill: var(--spark); stroke: var(--lives); stroke-width: 4; stroke-linejoin: round; animation: bomb-burst ${EXPLOSION_MS}ms ease-out both; }
.bomb-burst-core { fill: var(--lives); animation: bomb-burst-core ${EXPLOSION_MS}ms ease-out both; }
.bomb-shock { fill: none; stroke: var(--spark); stroke-width: 5; animation: bomb-shock ${EXPLOSION_MS}ms ease-out both; }
.bomb-debris { fill: var(--spark); animation: bomb-debris ${EXPLOSION_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1) both; }
.bomb-debris.alt { fill: var(--lives); }

@keyframes bomb-burn { from { stroke-dashoffset: 0; } to { stroke-dashoffset: ${f1(BURNT)}; } }
@keyframes bomb-travel { from { transform: rotate(0deg); } to { transform: rotate(-${TRAVEL_DEG}deg); } }
@keyframes bomb-upright { from { transform: rotate(0deg); } to { transform: rotate(${TRAVEL_DEG}deg); } }
@keyframes bomb-flicker {
  0%, 100% { transform: scale(1, 1) rotate(0deg); }
  20% { transform: scale(0.9, 1.14) rotate(-5deg); }
  45% { transform: scale(1.08, 0.88) rotate(3deg); }
  70% { transform: scale(0.94, 1.1) rotate(-2deg); }
  85% { transform: scale(1.04, 0.95) rotate(4deg); }
}
@keyframes bomb-swing { from { transform: rotate(var(--from)); } to { transform: rotate(var(--to)); } }
@keyframes bomb-shake {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  25% { transform: translate(-2px, 1px) rotate(-4deg); }
  50% { transform: translate(2px, -1px) rotate(3deg); }
  75% { transform: translate(-1px, 2px) rotate(-2deg); }
}
@keyframes bomb-jolt {
  0% { transform: scale(1); }
  8% { transform: scale(1.16); }
  18% { transform: scale(0.9); }
  32%, 100% { transform: scale(1); }
}
@keyframes bomb-burst {
  0% { transform: scale(0.2) rotate(0deg); opacity: 1; }
  22% { transform: scale(1.05) rotate(8deg); opacity: 1; }
  60% { transform: scale(1.18) rotate(12deg); opacity: 0.9; }
  100% { transform: scale(1.35) rotate(16deg); opacity: 0; }
}
@keyframes bomb-burst-core {
  0% { transform: scale(0.1); opacity: 1; }
  18% { transform: scale(1.1); opacity: 1; }
  55% { transform: scale(0.95); opacity: 0.8; }
  100% { transform: scale(0.6); opacity: 0; }
}
@keyframes bomb-shock {
  0% { transform: scale(0.5); opacity: 1; stroke-width: 8; }
  60%, 100% { transform: scale(2.3); opacity: 0; stroke-width: 1; }
}
@keyframes bomb-debris {
  0% { transform: rotate(var(--a)) translateY(-20px) scale(1); opacity: 1; }
  75% { opacity: 1; }
  100% { transform: rotate(var(--a)) translateY(-100px) scale(0.4); opacity: 0; }
}
@keyframes bomb-flash { from { opacity: 1; } to { opacity: 0; } }

/* Reduced motion: the flame is still, the arrow jumps, the fuse moves only when the screen is
   redrawn, and the explosion is a brief still flash. */
@media (prefers-reduced-motion: reduce) {
  .bomb-flame, .bomb-arrow.swing, .urgent .bomb-body, .bomb.exploding .bomb-body { animation: none; }
  .bomb-fuse.burning, .bomb-travel, .bomb-upright { animation-play-state: paused; }
  .bomb-shock, .bomb-debris { display: none; }
  .bomb-burst, .bomb-burst-core { transform: none; animation: bomb-flash 500ms step-end both; }
}
`;
