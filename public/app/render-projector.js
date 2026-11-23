// The projector screen as an HTML string. Pure: no DOM access, and every piece of text that came from
// a player (nicknames, words) goes through esc(). The projector view has no scores, ghost points or
// tokens to show; the results' ghost leaderboard is the one place ghost points appear.
import { esc } from "./escape.js";
import { renderBomb } from "./bomb.js";
import { seatedPlayers } from "./circle-geometry.js";
import { avatarImg, EMOJI_CREDIT } from "./avatars.js";

/**
 * @typedef {{ countdownMs: number | null, credits: string, site?: string, bomb?: import("./bomb.js").BombState }} ProjectorUi
 */

/** @type {Record<string, string>} */
const ASK = { contains: "CONTAINS", starts: "STARTS WITH", ends: "ENDS WITH" };

/** @param {number} n */
const hearts = (n) => "❤".repeat(Math.max(0, Math.min(n, 10)));

/** @param {any} view @param {string} id */
const nick = (view, id) => view.players.find((/** @type {any} */ p) => p.id === id)?.nickname;

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

/** @param {any} view @param {ProjectorUi} ui */
function lobby(view, ui) {
  const site = ui.site ? esc(ui.site) : "this website";
  const names = view.players.length
    ? `<ul class="p-names">${view.players.map((/** @type {any} */ p) => `<li>${avatarImg(p.avatar)}<span>${esc(p.nickname)}</span></li>`).join("")}</ul>`
    : `<p class="p-wait">Waiting for players…</p>`;
  const locked = view.locked ? `<p class="p-locked">The game is locked: nobody new can join</p>` : "";
  return `<main class="p-lobby">
<p class="p-goto">Go to <strong>${site}</strong> and enter the code</p>
<div class="p-code">${esc(view.code)}</div>
${locked}<p class="p-count">${view.players.length} joined</p>
${names}
<p class="p-credits">${esc(`${ui.credits} · ${EMOJI_CREDIT}`)}</p>
</main>`;
}

/** @param {any} view @param {ProjectorUi} ui */
function promptBlock(view, ui) {
  const p = view.prompt;
  const ask = p ? `<div class="p-word"><div class="p-ask">${ASK[p.type] ?? ""}</div><div class="p-prompt">${esc(p.text.toUpperCase())}</div></div>` : "";
  // No arrow yet: it comes with the new circle centre.
  const state = ui.bomb ?? { lit: view.phase === "playing" && !view.paused, arrow: null, countdownMs: ui.countdownMs, fuse: null, explosion: null };
  return `<div class="p-fuse-row">${renderBomb({ ...state, arrow: null }, "")}${ask}</div>`;
}

/** @param {any} view */
function examples(view) {
  if (!Array.isArray(view.examples) || view.examples.length === 0) return "";
  return `<div class="p-examples">Could have said: ${view.examples.map(esc).join(", ")}</div>`;
}

/** @param {any} view @param {ProjectorUi} ui */
function classic(view, ui) {
  const mode = view.mode;
  const seated = seatedPlayers(view);
  const n = seated.length;
  const seats = seated
    .map((p, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
      const left = (50 + 42 * Math.cos(angle)).toFixed(1);
      const top = (50 + 40 * Math.sin(angle)).toFixed(1);
      const cls = p.id === mode.current ? "seat on" : p.alive ? "seat" : "seat out";
      const away = p.connected ? "" : `<span class="away">offline</span>`;
      return `<div class="${cls}" style="left:${left}%;top:${top}%"><span class="name">${esc(p.nickname)}</span><span class="lives">${p.alive ? hearts(p.lives) : "out"}</span>${away}</div>`;
    })
    .join("");
  const typing = typeof view.typing === "string" ? `<div class="p-typing">${esc(view.typing)}</div>` : "";
  const last = mode.lastWord
    ? `<div class="p-last">Last word: <strong>${esc(mode.lastWord.word)}</strong>${nick(view, mode.lastWord.pid) ? ` (${esc(nick(view, mode.lastWord.pid))})` : ""}</div>`
    : `<div class="p-last"></div>`;
  return `<main class="p-classic">
<div class="p-circle">${seats}<div class="p-center">${promptBlock(view, ui)}${typing}</div></div>
${last}${examples(view)}
</main>`;
}

/** @param {any} view @param {ProjectorUi} ui */
function everyone(view, ui) {
  const mode = view.mode ?? {};
  const grid = view.players
    .filter((/** @type {any} */ p) => !p.spectator)
    .map((/** @type {any} */ p) => {
      if (!p.alive) return `<li class="tick out">${esc(p.nickname)} <span class="lives">out</span></li>`;
      if (p.answered) return `<li class="tick answered">✓ ${esc(p.nickname)} <span class="lives">${hearts(p.lives)}</span></li>`;
      return `<li class="tick">${esc(p.nickname)} <span class="lives">${hearts(p.lives)}</span></li>`;
    })
    .join("");
  const round = typeof mode.round === "number" ? `<div class="p-round">Round ${esc(mode.round)}</div>` : "";
  return `<main class="p-everyone">
${round}<div class="p-center">${promptBlock(view, ui)}</div>
<ul class="p-grid">${grid}</ul>
${examples(view)}
</main>`;
}

/** @param {any} view */
function results(view) {
  const r = view.results ?? { winners: [], ghostRanking: [], longestWord: null };
  const names = r.winners.map((/** @type {string} */ id) => nick(view, id)).filter((/** @type {unknown} */ n) => typeof n === "string");
  const winners = names.length
    ? `<div class="p-winner">${names.length > 1 ? "Winners" : "Winner"}: ${names.map(esc).join(", ")}</div>`
    : `<div class="p-winner">No winner this time</div>`;
  const longest = r.longestWord
    ? `<p class="p-longest">Longest word: <strong>${esc(r.longestWord.word)}</strong> by ${esc(r.longestWord.nickname)}</p>`
    : "";
  const ghosts = r.ghostRanking.length
    ? `<h2>Best ghosts</h2><ol class="p-ghosts">${r.ghostRanking
        .map((/** @type {any} */ g) => `<li>${esc(g.nickname)}</li>`)
        .join("")}</ol>`
    : "";
  return `<main class="p-results"><h1>Game over</h1>${winners}${longest}${ghosts}</main>`;
}
