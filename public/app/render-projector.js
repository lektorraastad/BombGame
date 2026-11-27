// The projector screen as an HTML string. Pure: no DOM access, and every piece of text that came from
// a player (nicknames, words) goes through esc(), here or in tiles.js and render-circle.js. The
// projector view has no scores, ghost points or tokens to show: the results' ghost ranking is names
// in order, without points.
import { esc } from "./escape.js";
import { renderCircle } from "./render-circle.js";
import { tiles } from "./tiles.js";
import { ONE_RING_MAX, seatedPlayers } from "./circle-geometry.js";
import { renderLogo } from "./logo.js";
import { avatarImg, trophyImg, EMOJI_CREDIT } from "./avatars.js";

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
 *   examples?: string[] | null,                    // the examples to show now, or null; left out (no motion tracker): the view's
 *   win?: WinMoment,                               // motion.win(): the winner's moment on the results
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
  const opts = { compact: false, bomb, centre, popElapsed: ui.popElapsed, aspect: ui.ringAspect, ...momentsOf(view, ui) };
  return `<div class="p-ring">${renderCircle(view, opts)}</div>`;
}

/**
 * The moments for the circle, shared with the student screens. The examples are the ones the page
 * says to show now (motion.examplesShown), or without a motion tracker the view's own.
 * @param {any} view
 * @param {{ word?: any, refused?: any, hearts?: Map<string, number>, examples?: string[] | null }} ui
 * @returns {Pick<import("./render-circle.js").CircleOptions, "word" | "refused" | "hearts" | "examples">}
 */
export function momentsOf(view, ui) {
  const examples = ui.examples === undefined ? (Array.isArray(view?.examples) ? view.examples : null) : ui.examples;
  return { word: ui.word ?? null, refused: ui.refused ?? null, hearts: ui.hearts, examples };
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
  const words = momentsOf(view, ui).examples;
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

/** The burst's letters: "WORDFIRE" twice, one tile each. */
const BURST = Array.from("WORDFIREWORDFIRE");
/** When the winner's name starts dropping in, and how far apart its tiles land (at most). */
const NAME_AT_MS = 320;
const NAME_STEP_MS = 80;

/**
 * The winner's name as tiles that drop in one after another: each tile's own delay (positive while
 * it is still to come). Every character goes through esc(), as in tiles.js.
 * @param {string} name @param {number} ms the win moment's elapsed time
 */
function droppingName(name, ms) {
  const chars = Array.from(String(name));
  const step = Math.min(NAME_STEP_MS, 880 / Math.max(1, chars.length - 1)); // the last lands within the moment
  const inner = chars
    .map((c, i) => (/^\s$/u.test(c)
      ? `<span class="gap"></span>`
      : `<span class="tile" style="animation-delay:${Math.round(NAME_AT_MS + i * step - ms)}ms">${esc(c)}</span>`))
    .join("");
  return `<span class="tiles">${inner}</span>`;
}

/**
 * The burst of letter tiles flying out from the winner and falling, all from the same moment.
 * Each tile's direction is fixed by its place, so the burst looks the same on every redraw.
 * @param {number} ms
 */
function winBurst(ms) {
  const parts = BURST.map((c, i) => {
    const a = ((i + 0.5) / BURST.length) * 2 * Math.PI;
    const r = i % 2 ? 4.2 : 5.6; // em, out from the middle
    const x = (Math.cos(a) * r).toFixed(2);
    const y = (Math.sin(a) * r * 0.6).toFixed(2);
    const spin = ((i * 47) % 120) - 60;
    return `<span class="burst-tile" style="animation-delay:-${ms}ms;--bx:${x}em;--by:${y}em;--spin:${spin}deg"><span class="tile">${c}</span></span>`;
  });
  return `<div class="win-burst" aria-hidden="true">${parts.join("")}</div>`;
}

/**
 * The results' parts: the winners' podium, the longest word, and the best ghosts in order without
 * points. Shared with the student screens, which add the student's own score. While the win moment
 * runs (motion.win()), the winners' emoji pop, their names drop in and the burst plays once.
 * @param {any} view a projector or player view in the results phase
 * @param {WinMoment} [win]
 * @returns {{ podium: string, longest: string, ghosts: string }}
 */
export function resultParts(view, win = null) {
  const r = view.results ?? {};
  const winners = (Array.isArray(r.winners) ? r.winners : [])
    .map((/** @type {string} */ id) => playerOf(view, id))
    .filter((/** @type {any} */ p) => p && typeof p.nickname === "string");
  const winMs = win && typeof win.elapsedMs === "number" && Number.isFinite(win.elapsedMs) ? Math.max(0, Math.round(win.elapsedMs)) : null;
  const pids = winMs !== null && Array.isArray(win?.pids) ? win.pids : [];
  /** @param {any} p */
  const winner = (p) => (winMs !== null && pids.includes(p.id)
    ? `<div class="p-winner winning" style="animation-delay:-${winMs}ms">${avatarImg(p.avatar, "big")}${droppingName(p.nickname, winMs)}</div>`
    : `<div class="p-winner">${avatarImg(p.avatar, "big")}${tiles(p.nickname)}</div>`);
  const bursting = winMs !== null && winners.some((/** @type {any} */ p) => pids.includes(p.id));
  const podium = winners.length
    ? `${trophyImg()}<div class="p-winners">${winners.map(winner).join("")}</div>${bursting ? winBurst(winMs ?? 0) : ""}`
    : `<p class="p-nowinner">No winner this time</p>`;
  const lw = r.longestWord;
  const longest = lw && typeof lw.word === "string"
    ? `<p class="p-longest">Longest word: ${tiles(lw.word)} <span class="by">(${esc(lw.nickname)})</span></p>`
    : "";
  const ranking = Array.isArray(r.ghostRanking) ? r.ghostRanking : [];
  const ghosts = ranking.length
    ? `<h2>Best ghosts</h2><ol class="p-ghosts">${ranking
        .map((/** @type {any} */ g, /** @type {number} */ i) => `<li><span class="rank">${i + 1}.</span>${avatarImg(g.avatar)}<span class="who">${esc(g.nickname)}</span></li>`)
        .join("")}</ol>`
    : "";
  return { podium, longest, ghosts };
}

/** @param {any} view @param {ProjectorUi} ui */
function results(view, ui) {
  const { podium, longest, ghosts } = resultParts(view, ui.win ?? null);
  return `<main class="p-results">${renderLogo("large")}<h1>Game over</h1><div class="p-podium">${podium}</div>${longest}${ghosts}</main>`;
}
