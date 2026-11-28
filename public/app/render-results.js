// The end of the game as HTML strings: the projector's two steps (the winner and the award cards,
// then "Words we played") and each laptop's private "Your game" card. Pure: no DOM access, and every
// piece of text that came from a player (nicknames, words) goes through esc(), here or in tiles.js.
// No numbers per student anywhere on the projector: the cards carry names and words only, and the
// wall's count is the number of different words on it.
import { esc } from "./escape.js";
import { tiles } from "./tiles.js";
import { renderLogo } from "./logo.js";
import { avatarImg, trophyImg } from "./avatars.js";

/**
 * @typedef {{
 *   win?: import("./render-projector.js").WinMoment, // motion.win(): the winner's moment, on the awards step
 *   maxWords?: number,                                // how many words fit on the wall, measured by host-page.js
 * }} ResultsUi
 */

/** The cards' labels, by award kind. @type {Record<string, string>} */
export const AWARD_LABEL = {
  longest: "Longest word",
  rarest: "Rarest word",
  longestRarest: "Longest and rarest word",
  mostWords: "Most words",
  comeback: "Comeback",
  bestGhost: "Best ghost",
};
/** The small label under an award word on the wall. @type {Record<string, string>} */
const WALL_LABEL = { longest: "Longest", rarest: "Rarest", longestRarest: "Longest and rarest" };
/** More names than this on one card, and they are drawn smaller. */
const MANY = 3;

/** @param {any} view */
const resultsOf = (view) => view?.results ?? {};
/** @param {any} r */
const awardsOf = (r) => (Array.isArray(r.awards) ? r.awards : []).filter((/** @type {any} */ a) => a && typeof a.kind === "string" && AWARD_LABEL[a.kind]);
/** @param {any} r @returns {string[]} */
const wordsOf = (r) => (Array.isArray(r.words) ? r.words : []).filter((/** @type {unknown} */ w) => typeof w === "string");
/** @param {number} n @param {string} one */
const count = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** @param {any} view @param {string} id */
const playerOf = (view, id) => (Array.isArray(view.players) ? view.players : []).find((/** @type {any} */ p) => p.id === id);

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

/** The winners still in the view, in the results' order. @param {any} view @returns {any[]} */
export function winnersOf(view) {
  const r = resultsOf(view);
  return (Array.isArray(r.winners) ? r.winners : [])
    .map((/** @type {string} */ id) => playerOf(view, id))
    .filter((/** @type {any} */ p) => p && typeof p.nickname === "string");
}

/**
 * The winners' podium: the trophy, each winner's emoji and name on tiles, or "No winner this time".
 * While the win moment runs (motion.win()), the winners' emoji pop, their names drop in and the burst
 * plays once. Shared by the projector and the laptops.
 * @param {any} view a projector or player view in the results phase
 * @param {import("./render-projector.js").WinMoment} [win]
 * @returns {string}
 */
export function podium(view, win = null) {
  const winners = winnersOf(view);
  const winMs = win && typeof win.elapsedMs === "number" && Number.isFinite(win.elapsedMs) ? Math.max(0, Math.round(win.elapsedMs)) : null;
  const pids = winMs !== null && Array.isArray(win?.pids) ? win.pids : [];
  /** @param {any} p */
  const winner = (p) => (winMs !== null && pids.includes(p.id)
    ? `<div class="p-winner winning" style="animation-delay:-${winMs}ms">${avatarImg(p.avatar, "big")}${droppingName(p.nickname, winMs)}</div>`
    : `<div class="p-winner">${avatarImg(p.avatar, "big")}${tiles(p.nickname)}</div>`);
  const bursting = winMs !== null && winners.some((/** @type {any} */ p) => pids.includes(p.id));
  return winners.length
    ? `${trophyImg()}<div class="p-winners">${winners.map(winner).join("")}</div>${bursting ? winBurst(winMs ?? 0) : ""}`
    : `<p class="p-nowinner">No winner this time</p>`;
}

/** A student on a card: the emoji beside the name on its plate. @param {any} p */
const who = (p) => `<span class="r-who">${avatarImg(p.avatar)}<span class="r-plate">${esc(p.nickname)}</span></span>`;

/** One award card, a quiet panel. Never a count, except "N students tied" for more than 8. @param {any} a */
function card(a) {
  const players = Array.isArray(a.players) ? a.players.filter((/** @type {any} */ p) => p && typeof p.nickname === "string") : [];
  const label = `<span class="r-lbl">${AWARD_LABEL[a.kind]}</span>`;
  // --n (the word's letters) lets a long word's tiles shrink to the card's width.
  const word = typeof a.word === "string" ? `<div class="r-cword" style="--n:${Array.from(a.word).length}">${tiles(a.word)}</div>` : "";
  let body;
  if (players.length === 0 && Number.isInteger(a.tied)) body = `<p class="r-tied">${esc(a.tied)} students tied</p>`;
  else if (word) body = `${word}<div class="r-names">${players.map(who).join("")}</div>`;
  else if (players.length === 1) body = `${avatarImg(players[0].avatar, "r-big")}<div class="r-names"><span class="r-plate">${esc(players[0].nickname)}</span></div>`;
  else body = `<div class="r-names${players.length > MANY ? " r-many" : ""}">${players.map(who).join("")}</div>`;
  return `<div class="r-card" data-kind="${esc(a.kind)}">${label}${body}</div>`;
}

/** Step 1: "Game over", the winner in the middle, then the award cards. @param {any} view @param {ResultsUi} ui */
function awardsStep(view, ui) {
  const awards = awardsOf(resultsOf(view));
  const cards = awards.length ? `<div class="r-awards">${awards.map(card).join("")}</div>` : "";
  return `<main class="p-results step-awards">${renderLogo("small")}<h1>Game over</h1><div class="p-podium">${podium(view, ui.win ?? null)}</div>${cards}</main>`;
}

/**
 * The words the wall shows: all of them, or with a usable maxWords the award words plus as many
 * others as fit, in alphabetical order.
 * @param {string[]} words @param {Set<string>} keep the award words @param {unknown} maxWords
 */
export function wallShown(words, keep, maxWords) {
  if (typeof maxWords !== "number" || !Number.isInteger(maxWords) || maxWords < 0 || words.length <= maxWords) return words;
  let room = Math.max(0, maxWords - words.filter((w) => keep.has(w)).length);
  return words.filter((w) => {
    if (keep.has(w)) return true;
    if (room <= 0) return false;
    room--;
    return true;
  });
}

/** Step 2: "Words we played", every word once, alphabetical, no names; the award words glow. @param {any} view @param {ResultsUi} ui */
function wordsStep(view, ui) {
  const r = resultsOf(view);
  const words = wordsOf(r);
  /** @type {Map<string, string>} the award word and its label */
  const glow = new Map();
  for (const a of awardsOf(r)) if (typeof a.word === "string" && WALL_LABEL[a.kind] && !glow.has(a.word)) glow.set(a.word, WALL_LABEL[a.kind]);
  const shown = wallShown(words, new Set(glow.keys()), ui.maxWords);
  const tilesOf = shown.map((w) => {
    const label = glow.get(w);
    return label
      ? `<span class="r-word hl" data-award="${esc(label)}">${tiles(w)}<span class="r-wlbl">${esc(label)}</span></span>`
      : `<span class="r-word">${tiles(w)}</span>`;
  });
  const more = words.length > shown.length
    ? `<p class="r-more">+ ${words.length - shown.length} more: Copy words in the control panel</p>`
    : "";
  return `<main class="p-results step-words">${renderLogo("small")}`
    + `<div class="r-wallhead"><h1>Words we played</h1><span class="r-count">${count(words.length, "word")}</span></div>`
    + `<div class="r-wall">${tilesOf.join("")}</div>${more}</main>`;
}

/**
 * The projector's results: the awards step, or the word wall once results.step is "words".
 * @param {any} view a projectorView in the results phase
 * @param {ResultsUi} ui
 * @returns {string}
 */
export function renderResults(view, ui) {
  return resultsOf(view).step === "words" ? wordsStep(view, ui ?? {}) : awardsStep(view, ui ?? {});
}

/** @param {string} label @param {string} value */
const row = (label, value) => `<div class="yg-row"><span class="yg-k">${label}</span><span class="yg-v">${value}</span></div>`;
/** A word on the card as one row of tiles; --n (its letters) lets a long word shrink to fit. @param {string} w */
const cardWord = (w) => `<span class="yg-word" style="--n:${Array.from(w).length}">${tiles(w)}</span>`;
/** @param {unknown} n */
const num = (n) => (typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0);

/**
 * The laptop's private "Your game" card, from the view's own me.summary only. Empty without one.
 * @param {any} view a playerView in the results phase
 * @returns {string}
 */
export function renderSummaryCard(view) {
  const s = view?.me?.summary;
  if (!s || typeof s !== "object") return "";
  const turn = num(s.turnWords);
  const silent = num(s.silentWords);
  const ghost = num(s.ghostWords);
  const total = turn + silent + ghost;
  const head = `<h2>Your game</h2>`;
  if (total === 0) return `<section class="your-game">${head}<p class="yg-none">No words this time. Next game!</p></section>`;
  const played = `You played ${count(total, "word")}: ${turn} on your turns, ${silent} silently${ghost > 0 ? `, and ${ghost} as a ghost` : ""}`;
  const awards = (Array.isArray(s.awards) ? s.awards : []).filter((/** @type {any} */ k) => typeof k === "string" && AWARD_LABEL[k]);
  return `<section class="your-game">${head}<p class="yg-played">${played}</p>`
    + `${typeof s.longest === "string" ? row("Your longest", cardWord(s.longest)) : ""}`
    + `${typeof s.rarest === "string" ? row("Your rarest", cardWord(s.rarest)) : ""}`
    + `${awards.length ? row("Award", awards.map((/** @type {string} */ k) => `<span class="yg-award">${AWARD_LABEL[k]} 🎉</span>`).join("")) : ""}`
    + `</section>`;
}
