// The projector screen as an HTML string. Pure: no DOM access, and every piece of text that came from
// a player (nicknames, words) goes through esc(), here or in tiles.js, render-circle.js and
// render-results.js. The projector view has no scores, ghost points or tokens to show.
import { esc } from "./escape.js";
import { renderCircle, circleMoments } from "./render-circle.js";
import { tiles } from "./tiles.js";
import { ONE_RING_MAX, seatedPlayers } from "./circle-geometry.js";
import { renderLogo } from "./logo.js";
import { EMOJI_CREDIT } from "./avatars.js";
import { renderResults } from "./render-results.js";

/**
 * @typedef {{
 *   countdownMs: number | null,
 *   credits: string,
 *   site?: string,
 *   bomb?: import("./bomb.js").BombState,          // from the motion tracker (host-page.js)
 *   popElapsed?: (pid: string) => number | null,   // ms since a player joined, while their pop runs
 *   ringAspect?: number,                           // the ring box's width / height, measured by the page
 *   word?: import("./render-circle.js").CircleOptions["word"],         // the moments from motion.js,
 *   refused?: import("./render-circle.js").CircleOptions["refused"],   // passed on to the circle
 *   hearts?: Map<string, number>,
 *   sparks?: import("./render-circle.js").CircleOptions["sparks"],  // motion.sparks(): silent and ghost answers
 *   examples?: string[] | null,                    // the example words to show now (motion.examplesShown), else null or left out
 *   win?: WinMoment,                               // motion.win(): the winner's moment on the results
 *   maxWords?: number,                             // how many words fit on the results' word wall (host-page.js measures it)
 * }} ProjectorUi
 */
/** @typedef {ReturnType<ReturnType<import("./motion.js").createMotion>["win"]>} WinMoment */

/** @typedef {import("./bomb.js").BombState} BombState */

/** @type {Record<string, string>} */
const ASK = { contains: "CONTAINS", starts: "STARTS WITH", ends: "ENDS WITH" };

/** The lobby's bomb: the fuse not lit yet, no arrow, nothing counting. @type {BombState} */
const UNLIT = { lit: false, arrow: null, countdownMs: null, fuse: null, explosion: null, tension: null };

/** @param {any} view @param {string} id */
const playerOf = (view, id) => (Array.isArray(view.players) ? view.players : []).find((/** @type {any} */ p) => p.id === id);

/**
 * @param {any} view a projectorView from the server
 * @param {ProjectorUi} ui
 * @returns {string}
 */
export function renderProjector(view, ui) {
  const paused = view.paused ? `<div class="p-paused">Paused</div>` : "";
  return `${paused}${screen(view, ui)}`;
}

/** @param {any} view @param {ProjectorUi} ui */
function screen(view, ui) {
  if (view.phase === "lobby") return lobby(view, ui);
  if (view.phase === "results") return results(view, ui);
  const mode = view.mode ?? {};
  if (Array.isArray(mode.seats)) return classic(view, ui);
  return everyone(view, ui);
}

/**
 * The circle in its own box. On the projector the stylesheet makes it an oval as tall as the space
 * and as wide as the screen allows; ui.ringAspect (its measured shape) turns the arrow to the seat.
 * @param {any} view @param {ProjectorUi} ui @param {BombState} bomb @param {string} centre
 */
function ring(view, ui, bomb, centre) {
  const opts = { compact: false, bomb, centre, popElapsed: ui.popElapsed, aspect: ui.ringAspect, ...circleMoments(ui) };
  return `<div class="p-ring">${renderCircle(view, opts)}</div>`;
}

/** @param {any} view @param {ProjectorUi} ui */
function lobby(view, ui) {
  const site = ui.site ? esc(ui.site) : "this website";
  const n = Array.isArray(view.players) ? view.players.length : 0;
  const locked = view.locked ? `<p class="p-locked">The game is locked: nobody new can join</p>` : "";
  // Nobody has lives until the game starts (the engine has everyone "not alive" in the lobby), so
  // the lobby circle shows everyone as in, with no hearts.
  const players = (Array.isArray(view.players) ? view.players : []).map((/** @type {any} */ p) => ({ ...p, alive: true, lives: 0 }));
  return `<main class="p-lobby">
${renderLogo("large")}
<p class="p-goto">Go to <strong>${site}</strong> and enter the code</p>
<div class="p-code">${tiles(String(view.code ?? ""))}</div>
${ring({ ...view, players }, ui, UNLIT, "")}
<div class="p-foot">${locked}<p class="p-count">${n ? `${n} joined` : "Waiting for players…"}</p></div>
<p class="p-credits">${esc(`${ui.credits} · ${EMOJI_CREDIT}`)}</p>
</main>`;
}

/**
 * The bomb from the motion tracker, or (without one, as in tests) a plain bomb: lit while playing.
 * @param {any} view @param {ProjectorUi} ui
 * @returns {BombState}
 */
function bombOf(view, ui) {
  return ui.bomb ?? { lit: view.phase === "playing" && !view.paused, arrow: null, countdownMs: ui.countdownMs, fuse: null, explosion: null, tension: null };
}

/**
 * What sits on the bomb: the prompt type, then the prompt on tiles. Shared with the student screens.
 * @param {any} view a projector or player view
 * @returns {string}
 */
export function onBomb(view) {
  const p = view.prompt;
  if (!p || typeof p.text !== "string") return "";
  return `<div class="p-ask">${ASK[p.type] ?? ""}</div><div class="p-prompt">${tiles(p.text.toUpperCase())}</div>`;
}

/**
 * The example words' bottom line, only with more than 20 on the circle (with fewer they show under
 * the bomb, render-circle.js), bigger than it was. Kept (empty) when there are none, so the circle
 * doesn't jump. @param {any} view @param {ProjectorUi} ui
 */
function examples(view, ui) {
  if (seatedPlayers(view).length <= ONE_RING_MAX) return "";
  // The view's own words, not the page's: typing under a seat doesn't take this place, so they stay
  // until the next explosion (the page's list is nulled once typing appears).
  const words = view.examples;
  if (!Array.isArray(words) || words.length === 0) return `<div class="p-examples big"></div>`;
  return `<div class="p-examples big">Could have said: ${words.map(esc).join(", ")}</div>`;
}

/** @param {any} view @param {ProjectorUi} ui */
function classic(view, ui) {
  return `<main class="p-classic">
${renderLogo("small")}
${ring(view, ui, bombOf(view, ui), onBomb(view))}
${examples(view, ui)}
</main>`;
}

/** @param {any} view @param {ProjectorUi} ui */
function everyone(view, ui) {
  const mode = view.mode ?? {};
  const round = typeof mode.round === "number" ? `<div class="p-round">Round ${esc(mode.round)}</div>` : "";
  // Nobody is on, so there is never an arrow.
  return `<main class="p-everyone">
${renderLogo("small")}${round}${ring(view, ui, { ...bombOf(view, ui), arrow: null }, onBomb(view))}
${examples(view, ui)}
</main>`;
}

/** The results: the winner and the award cards, then the word wall (render-results.js). @param {any} view @param {ProjectorUi} ui */
function results(view, ui) {
  return renderResults(view, { win: ui.win ?? null, maxWords: ui.maxWords });
}
