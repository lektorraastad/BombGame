// The player screen as an HTML string. Pure: no DOM access, and every piece of text that came from
// a player (nicknames, words) goes through esc(), here or in tiles.js and render-circle.js.
// While a game runs, the student sees the same circle, bomb and arrow as the projector, smaller, with
// their own text box along the bottom and their own hearts and score in the corner. A student's
// screen shows only their own score.
import { AVATARS, avatarImg } from "./avatars.js";
import { esc } from "./escape.js";
import { renderCircle, circleMoments } from "./render-circle.js";
import { onBomb } from "./render-projector.js";
import { podium, winnersOf, renderSummaryCard } from "./render-results.js";
import { tiles } from "./tiles.js";
import { renderLogo } from "./logo.js";

/**
 * @typedef {{ text: string, type: "contains" | "starts" | "ends" }} PromptInfo
 * @typedef {{ ok: boolean, kind?: string, reason?: string }} ResultInfo
 * @typedef {{
 *   countdownMs: number | null,
 *   lastResult?: ResultInfo,
 *   status: string,
 *   bomb?: import("./bomb.js").BombState,
 *   ringAspect?: number,   // the circle's width / height, measured by the page: the arrow turns to the seat
 *   word?: import("./render-circle.js").CircleOptions["word"],         // the moments from motion.js,
 *   refused?: import("./render-circle.js").CircleOptions["refused"],   // as on the projector
 *   hearts?: Map<string, number>,
 *   sparks?: import("./render-circle.js").CircleOptions["sparks"],  // motion.sparks(): silent and ghost answers
 *   examples?: string[] | null,
 *   win?: import("./render-projector.js").WinMoment,
 * }} PlayerUi
 */

// esc lives in escape.js; it is re-exported here so older imports keep working.
export { esc };

/** How a refused word missed the prompt. (The prompt type itself is on the bomb.) @type {Record<string, { no: string }>} */
const PROMPT_WORDING = {
  contains: { no: "Doesn't contain" },
  starts: { no: "Doesn't start with" },
  ends: { no: "Doesn't end with" },
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
 * The circle with the bomb in the middle and the prompt on it, as on the projector: an oval as wide
 * as the space allows, whose measured shape (ui.ringAspect) turns the arrow to the seat. The bomb comes
 * from the motion tracker (player-page.js), or without one (as in tests) a plain bomb, lit while
 * playing. Nobody is on in Everyone at once, so there is never an arrow then.
 * @param {any} view
 * @param {PlayerUi} ui
 */
function arena(view, ui) {
  const bomb = ui.bomb ?? { lit: view.phase === "playing" && !view.paused, arrow: null, countdownMs: ui.countdownMs, fuse: null, explosion: null, tension: null };
  const nobodyOn = typeof view.mode?.current !== "string";
  const opts = { compact: true, bomb: nobodyOn ? { ...bomb, arrow: null } : bomb, centre: onBomb(view), aspect: ui.ringAspect, ...circleMoments(ui) };
  return `<div class="arena">${renderCircle(view, opts)}</div>`;
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

/**
 * The text box: the real input on top, its text see-through, over a mirror the page fills with the
 * typed letters as tiles (wordTiles) on every keystroke.
 * @param {boolean} mine
 */
const wordBox = (mine) =>
  `<div class="wordbox"><div id="word-tiles" class="word-tiles" aria-hidden="true"></div>${WORD_BOX.replace("{cls}", mine ? " my-turn" : "")}</div>`;

/**
 * What the text box shows: the typed letters as tiles, with a steady caret where the cursor is.
 * The cursor position is an input's selectionStart (UTF-16 units); a letter made of two units (an
 * emoji) is never split, and a junk position puts the caret at the end.
 * @param {string} value
 * @param {number} caret
 * @returns {string}
 */
export function wordTiles(value, caret) {
  const chars = Array.from(String(value));
  const units = chars.reduce((n, c) => n + c.length, 0);
  const at = Number.isInteger(caret) && caret >= 0 && caret <= units ? caret : units;
  let split = 0;
  for (let used = 0; split < chars.length && used < at; split++) used += chars[split].length;
  const before = chars.slice(0, split).join("");
  const after = chars.slice(split).join("");
  return `${before ? tiles(before) : ""}<span class="caret"></span>${after ? tiles(after) : ""}`;
}

/**
 * @param {any} view a playerView from the server
 * @param {PlayerUi} ui
 * @returns {string}
 */
export function renderPlayer(view, ui) {
  const banner = ui.status !== "open" && ui.status !== "connecting" ? `<div class="banner">Reconnecting...</div>` : "";
  const body = screen(view, ui);
  return `${banner}<header class="top">${renderLogo("small")}<span class="who">${esc(view.me.nickname)}</span><span class="room">Room ${esc(view.code)}</span></header>${body}`;
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

/**
 * The student's own hearts (when they have any left to show) and score, for the top corner.
 * @param {any} me @param {boolean} withHearts
 */
function corner(me, withHearts) {
  const lives = withHearts ? `<div class="lives" aria-label="${esc(me.lives)} lives">${hearts(me.lives)}</div>` : "";
  return `<div class="corner">${lives}<div class="score">Score: ${esc(me.score)}</div></div>`;
}

/** @param {any} view @param {any} p */
const isMe = (view, p) => (typeof view.me?.id === "string" ? p.id === view.me.id : p.nickname === view.me?.nickname);

/** @param {any} view @param {PlayerUi} ui */
function screen(view, ui) {
  const me = view.me;
  const prompt = view.prompt;
  const mine = view.players.find((/** @type {any} */ p) => isMe(view, p));

  if (view.phase === "lobby") {
    const names = view.players.map(nameChip).join("");
    return `<main class="lobby"><h1>You're in!</h1><p class="big">Waiting for the host to start the game...</p>${renderPicker(view)}${resultLine(ui.lastResult, null)}<ul class="names">${names}</ul></main>`;
  }

  if (view.phase === "results") return results(view, ui);

  const paused = view.paused ? `<div class="banner">Paused by the host</div>` : "";

  if (mine?.spectator) {
    return `<main class="watching">${paused}<h1>You'll join the next game</h1><p>For now, watch the screen at the front.</p>${renderPicker(view)}${resultLine(ui.lastResult, null)}</main>`;
  }

  const letters = me.bonusLeft.length
    ? `<div class="letters">Letters left: ${me.bonusLeft.map((/** @type {string} */ l) => esc(l.toUpperCase())).join(" ")}</div>`
    : "";

  if (me.activity) {
    const a = me.activity;
    const comeback = a.comebackAvailable
      ? `Comeback: ${esc(a.streak)} of ${esc(a.comebackStreak)}`
      : "Comeback: not available";
    return `<main class="ghost">${paused}${corner(me, false)}${arena(view, ui)}`
      + `<div class="status"><h1>YOU'RE OUT — keep playing as a ghost</h1><span class="turn">${whoseTurn(view)}</span></div>`
      + `${wordBox(false)}${resultLine(ui.lastResult, prompt)}`
      + `<div class="ghostscore">Ghost points: ${esc(a.ghostPoints)} <span class="comeback">${comeback}</span></div></main>`;
  }

  if (!me.alive) {
    return `<main class="watching">${paused}<h1>You're out</h1><p>Watch the rest of the game on the screen.</p></main>`;
  }

  if (me.isOn) {
    return `<main class="turn-on">${paused}${corner(me, true)}${arena(view, ui)}`
      + `<div class="status"><div class="yourturn">Your turn!</div></div>`
      + `${wordBox(true)}${resultLine(ui.lastResult, prompt)}${letters}</main>`;
  }
  const hint = me.canAnswerSilently ? "Answer silently for points" : "Wait for your turn";
  return `<main class="waiting">${paused}${corner(me, true)}${arena(view, ui)}`
    + `<div class="status"><div class="yourturn">${whoseTurn(view)}</div><p class="hint">${hint}</p></div>`
    + `${wordBox(false)}${resultLine(ui.lastResult, prompt)}${letters}</main>`;
}

/**
 * The results on a laptop, through both of the projector's steps: the winner (with the win moment)
 * beside the student's own private "Your game" card. The class's cards and wall are the projector's.
 * @param {any} view @param {PlayerUi} ui
 */
function results(view, ui) {
  const winners = winnersOf(view);
  const won = winners.some((/** @type {any} */ p) => isMe(view, p));
  const line = `${winners.length > 1 ? `<p class="r-shared">Shared win</p>` : ""}${won ? `<p class="big youwon">You won!</p>` : ""}`;
  return `<main class="results"><h1>Game over</h1><div class="r-laptop">`
    + `<div class="r-side"><div class="p-podium">${podium(view, ui.win ?? null)}</div>${line}</div>${renderSummaryCard(view)}</div>`
    + `<p class="hint">Waiting for the host to play again...</p></main>`;
}
