// The player screen as an HTML string. Pure: no DOM access, and every piece of text that came from
// a player (nicknames, words) goes through esc().
import { renderBomb } from "./bomb.js";
import { AVATARS, avatarImg } from "./avatars.js";

/**
 * @typedef {{ text: string, type: "contains" | "starts" | "ends" }} PromptInfo
 * @typedef {{ ok: boolean, kind?: string, reason?: string }} ResultInfo
 * @typedef {{ countdownMs: number | null, lastResult?: ResultInfo, status: string, bomb?: import("./bomb.js").BombState }} PlayerUi
 */

/** @param {unknown} s */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** @type {Record<string, { ask: string, no: string }>} */
const PROMPT_WORDING = {
  contains: { ask: "Type a word that CONTAINS:", no: "Doesn't contain" },
  starts: { ask: "Type a word that STARTS WITH:", no: "Doesn't start with" },
  ends: { ask: "Type a word that ENDS WITH:", no: "Doesn't end with" },
};

/** @type {Record<string, string>} */
const REASONS = {
  // The engine's SubmitResult reasons.
  "not-playing": "The game isn't running right now",
  paused: "The game is paused",
  empty: "Type a word first",
  "too-long": "That word is too long",
  "bad-characters": "Use only letters (A to Z)",
  "not-a-word": "Not a word in our dictionary",
  "doesnt-match": "That word doesn't fit the letters",
  used: "Already used",
  blocked: "Let's keep it friendly. Try another word",
  "not-your-turn": "Not your turn yet",
  // The hub's and the room's reasons.
  "bad-message": "Something went wrong. Try again",
  "no-passcode-set": "The host hasn't set a passcode yet",
  "wrong-passcode": "Wrong passcode",
  "too-many-attempts": "Too many tries. Wait a minute",
  "server-full": "The server is full right now",
  "no-room": "No game with that code",
  "not-host": "Only the host can do that",
  "already-joined": "You are already in a game",
  "not-player": "You are not in this game",
  locked: "The host has locked the game, so nobody can join",
  full: "This game is full",
  kicked: "You were removed from this game",
  "name-length": "Pick a name with 2 to 16 letters",
  "name-blocked": "Please pick a different name",
  "not-found": "That player isn't in the game",
  "need-2-players": "You need at least 2 players",
  "no-prompts": "No letters to play with. Change the settings",
  "already-running": "The game has already started",
  "unknown-mode": "Unknown game mode",
  "not-sent": "Reconnecting… your word wasn't sent",
  "game-running": "You can't change that during a game",
  // The emoji picker's reasons.
  "avatar-taken": "Taken, pick another",
  "avatar-locked": "You can change your emoji in the lobby",
  "bad-avatar": "Something went wrong. Try again",
};

/**
 * Friendly English for any reason the engine or the hub can send.
 * @param {string | undefined} reason
 * @param {PromptInfo | null} [prompt] makes "doesnt-match" say what was missing
 */
export function reasonText(reason, prompt) {
  if (reason === "doesnt-match" && prompt && PROMPT_WORDING[prompt.type]) {
    return `${PROMPT_WORDING[prompt.type].no} ${prompt.text.toUpperCase()}`;
  }
  return (reason && REASONS[reason]) || "Something went wrong. Try again";
}

/** @param {number} n */
const hearts = (n) => "❤".repeat(Math.max(0, Math.min(n, 10)));

/** @param {ResultInfo | undefined} r @param {PromptInfo | null} prompt */
function resultLine(r, prompt) {
  if (!r) return `<div class="result" aria-live="polite"></div>`;
  if (r.ok) {
    // A new emoji shows in the picker itself, so it needs no message.
    if (r.kind === "avatar") return `<div class="result good" aria-live="polite"></div>`;
    const text = r.kind === "ghost" ? "✓ +1 ghost point" : "✓ +1";
    return `<div class="result good" aria-live="polite">${text}</div>`;
  }
  return `<div class="result bad" aria-live="polite">✗ ${esc(reasonText(r.reason, prompt))}</div>`;
}

/**
 * The bomb beside whose turn it is, while a visible timer counts down. No arrow here yet: it comes
 * with the circle on student screens.
 * @param {PlayerUi} ui
 * @param {any} view
 */
function bomb(ui, view) {
  if (ui.countdownMs === null) return "";
  const state = ui.bomb ?? { lit: view.phase === "playing" && !view.paused, arrow: null, countdownMs: ui.countdownMs, fuse: null, explosion: null };
  return renderBomb({ ...state, arrow: null }, "");
}

/** @param {any} view */
function whoseTurn(view) {
  const mode = view.mode ?? {};
  if (typeof mode.current === "string") {
    const p = view.players.find((/** @type {any} */ x) => x.id === mode.current);
    return p ? `${esc(p.nickname)}'s turn` : "";
  }
  return "Everyone answers";
}

const WORD_BOX =
  `<input id="word" class="word{cls}" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40" placeholder="type a word..." aria-label="Your word">`;

/** @param {boolean} mine */
const wordBox = (mine) => WORD_BOX.replace("{cls}", mine ? " my-turn" : "");

/**
 * @param {any} view a playerView from the server
 * @param {PlayerUi} ui
 * @returns {string}
 */
export function renderPlayer(view, ui) {
  const banner = ui.status !== "open" && ui.status !== "connecting" ? `<div class="banner">Reconnecting...</div>` : "";
  const body = screen(view, ui);
  return `${banner}<header class="top"><span class="who">${esc(view.me.nickname)}</span><span class="room">Room ${esc(view.code)}</span></header>${body}`;
}

/**
 * The emoji picker: one button per avatar. The player's own is pressed; ones other players have are
 * disabled and marked taken.
 * @param {any} view a playerView from the server
 * @returns {string}
 */
export function renderPicker(view) {
  const me = view.me ?? {};
  const taken = new Set(
    (Array.isArray(view.players) ? view.players : [])
      .filter((/** @type {any} */ p) => p.id !== me.id)
      .map((/** @type {any} */ p) => p.avatar),
  );
  const buttons = AVATARS.map((a, i) => {
    const mine = me.avatar === i;
    const off = !mine && taken.has(i);
    return `<button type="button" class="pick${off ? " taken" : ""}" data-avatar="${i}" aria-label="${esc(a.label)}" aria-pressed="${mine}"${off ? " disabled" : ""}>${avatarImg(i)}</button>`;
  }).join("");
  return `<section class="picker" aria-labelledby="pickhead"><h2 id="pickhead">Pick your emoji</h2><div class="picker-grid">${buttons}</div></section>`;
}

/** A player's emoji and nickname, for the lobby list. @param {any} p */
const nameChip = (p) => `<li>${avatarImg(p.avatar)}<span>${esc(p.nickname)}</span></li>`;

/** @param {any} view @param {PlayerUi} ui */
function screen(view, ui) {
  const me = view.me;
  const prompt = view.prompt;
  const mine = view.players.find((/** @type {any} */ p) => p.nickname === me.nickname);

  if (view.phase === "lobby") {
    const names = view.players.map(nameChip).join("");
    return `<main class="lobby"><h1>You're in!</h1><p class="big">Waiting for the host to start the game...</p>${renderPicker(view)}${resultLine(ui.lastResult, null)}<ul class="names">${names}</ul></main>`;
  }

  if (view.phase === "results") return results(view);

  const paused = view.paused ? `<div class="banner">Paused by the host</div>` : "";

  if (mine?.spectator) {
    return `<main class="watching">${paused}<h1>You'll join the next game</h1><p>For now, watch the screen at the front.</p>${renderPicker(view)}${resultLine(ui.lastResult, null)}</main>`;
  }

  const hearts_ = `<div class="lives" aria-label="${me.lives} lives">${hearts(me.lives)}</div>`;
  const letters = me.bonusLeft.length
    ? `<div class="letters">Letters left: ${me.bonusLeft.map((/** @type {string} */ l) => esc(l.toUpperCase())).join(" ")}</div>`
    : "";

  if (me.activity) {
    const a = me.activity;
    const comeback = a.comebackAvailable
      ? `Comeback: ${esc(a.streak)} of ${esc(a.comebackStreak)}`
      : "Comeback: not available";
    return `<main class="ghost">${paused}<h1>YOU'RE OUT — keep playing as a ghost</h1>
<div class="promptrow"><span class="label">Prompt:</span> <span class="prompt">${prompt ? esc(prompt.text.toUpperCase()) : ""}</span> <span class="turn">${whoseTurn(view)} ${bomb(ui, view)}</span></div>
${wordBox(false)}
${resultLine(ui.lastResult, prompt)}
<div class="ghostscore">Ghost points: ${esc(a.ghostPoints)} <span class="comeback">${comeback}</span></div></main>`;
  }

  if (!me.alive) {
    return `<main class="watching">${paused}<h1>You're out</h1><p>Watch the rest of the game on the screen.</p></main>`;
  }

  const wording = prompt ? PROMPT_WORDING[prompt.type] : null;
  const promptBlock = prompt && wording
    ? `<div class="ask">${wording.ask}</div><div class="prompt">${esc(prompt.text.toUpperCase())}</div>`
    : "";
  const last = view.mode?.lastWord
    ? `<div class="last">Last word: ${esc(view.mode.lastWord.word)}</div>`
    : "";

  if (me.isOn) {
    return `<main class="turn-on">${paused}${hearts_}<div class="yourturn">Your turn! ${bomb(ui, view)}</div>${promptBlock}${wordBox(true)}${resultLine(ui.lastResult, prompt)}${letters}${last}</main>`;
  }
  return `<main class="waiting">${paused}${hearts_}<div class="yourturn">${whoseTurn(view)} ${bomb(ui, view)}</div>${promptBlock}<p class="hint">${me.canAnswerSilently ? "Answer silently for points" : "Wait for your turn"}</p>${wordBox(false)}${resultLine(ui.lastResult, prompt)}${letters}${last}</main>`;
}

/** @param {any} view */
function results(view) {
  const r = view.results ?? { winners: [], ghostBoard: [], longestWord: null };
  const names = r.winners
    .map((/** @type {string} */ id) => view.players.find((/** @type {any} */ p) => p.id === id)?.nickname)
    .filter((/** @type {unknown} */ n) => typeof n === "string");
  const won = names.includes(view.me.nickname);
  const winners = names.length ? `<p class="big">${won ? "You won! " : ""}Winner: ${names.map(esc).join(", ")}</p>` : "";
  const longest = r.longestWord
    ? `<p>Longest word: <strong>${esc(r.longestWord.word)}</strong> by ${esc(r.longestWord.nickname)}</p>`
    : "";
  const ghosts = r.ghostBoard.length
    ? `<h2>Ghost points</h2><ol>${r.ghostBoard.slice(0, 3).map((/** @type {any} */ g) => `<li>${esc(g.nickname)}: ${esc(g.ghostPoints)}</li>`).join("")}</ol>`
    : "";
  return `<main class="results"><h1>Game over</h1>${winners}<p>Your score: ${esc(view.me.score)}</p>${longest}${ghosts}<p class="hint">Waiting for the host to play again...</p></main>`;
}
