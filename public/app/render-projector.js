// The projector screen as an HTML string. Pure: no DOM access, and every piece of text that came from
// a player (nicknames, words) goes through esc(), here or in tiles.js and render-circle.js. The
// projector view has no scores, ghost points or tokens to show: the results' ghost ranking is names
// in order, without points.
import { esc } from "./escape.js";
import { renderCircle } from "./render-circle.js";
import { tiles } from "./tiles.js";
import { avatarImg, trophyImg, EMOJI_CREDIT } from "./avatars.js";

/**
 * @typedef {{
 *   countdownMs: number | null,
 *   credits: string,
 *   site?: string,
 *   bomb?: import("./bomb.js").BombState,          // from the motion tracker (host-page.js)
 *   popElapsed?: (pid: string) => number | null,   // ms since a player joined, while their pop runs
 *   ringAspect?: number,                           // the ring box's width / height, measured by the page
 * }} ProjectorUi
 */

/** @typedef {import("./bomb.js").BombState} BombState */

/** @type {Record<string, string>} */
const ASK = { contains: "CONTAINS", starts: "STARTS WITH", ends: "ENDS WITH" };

/** The lobby's bomb: the fuse not lit yet, no arrow, nothing counting. @type {BombState} */
const UNLIT = { lit: false, arrow: null, countdownMs: null, fuse: null, explosion: null };

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
  if (view.phase === "results") return results(view);
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
  return `<div class="p-ring">${renderCircle(view, { compact: false, bomb, centre, popElapsed: ui.popElapsed, aspect: ui.ringAspect })}</div>`;
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
  return ui.bomb ?? { lit: view.phase === "playing" && !view.paused, arrow: null, countdownMs: ui.countdownMs, fuse: null, explosion: null };
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

/** The examples line, kept (empty) when there are none so the circle doesn't jump. @param {any} view */
function examples(view) {
  if (!Array.isArray(view.examples) || view.examples.length === 0) return `<div class="p-examples"></div>`;
  return `<div class="p-examples">Could have said: ${view.examples.map(esc).join(", ")}</div>`;
}

/** @param {any} view @param {ProjectorUi} ui */
function classic(view, ui) {
  return `<main class="p-classic">
${ring(view, ui, bombOf(view, ui), onBomb(view))}
${examples(view)}
</main>`;
}

/** @param {any} view @param {ProjectorUi} ui */
function everyone(view, ui) {
  const mode = view.mode ?? {};
  const round = typeof mode.round === "number" ? `<div class="p-round">Round ${esc(mode.round)}</div>` : "";
  // Nobody is on, so there is never an arrow.
  return `<main class="p-everyone">
${round}${ring(view, ui, { ...bombOf(view, ui), arrow: null }, onBomb(view))}
${examples(view)}
</main>`;
}

/**
 * The results' parts: the winners' podium, the longest word, and the best ghosts in order without
 * points. Shared with the student screens, which add the student's own score.
 * @param {any} view a projector or player view in the results phase
 * @returns {{ podium: string, longest: string, ghosts: string }}
 */
export function resultParts(view) {
  const r = view.results ?? {};
  const winners = (Array.isArray(r.winners) ? r.winners : [])
    .map((/** @type {string} */ id) => playerOf(view, id))
    .filter((/** @type {any} */ p) => p && typeof p.nickname === "string");
  const podium = winners.length
    ? `${trophyImg()}<div class="p-winners">${winners.map((/** @type {any} */ p) => `<div class="p-winner">${avatarImg(p.avatar, "big")}${tiles(p.nickname)}</div>`).join("")}</div>`
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

/** @param {any} view */
function results(view) {
  const { podium, longest, ghosts } = resultParts(view);
  return `<main class="p-results"><h1>Game over</h1><div class="p-podium">${podium}</div>${longest}${ghosts}</main>`;
}
