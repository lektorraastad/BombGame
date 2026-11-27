// The circle: every player's seat around the bomb, shared by the projector and the student screens.
// Pure: returns an HTML string, and every piece of player text goes through esc() (here or in
// tiles.js). Sizes come from style.css (--seat-size on .circle), so the same markup works on the
// projector and, with "compact", on a laptop.
import { esc } from "./escape.js";
import { renderBomb } from "./bomb.js";
import { avatarImg } from "./avatars.js";
import { seatPosition, seatedPlayers, screenAngle, ONE_RING_MAX } from "./circle-geometry.js";
import { tiles, matchedTiles } from "./tiles.js";

/**
 * @typedef {{
 *   compact: boolean,                              // the smaller student-screen circle
 *   bomb: import("./bomb.js").BombState,
 *   centre: string,                                // trusted HTML on the bomb (the caller escapes its text)
 *   popElapsed?: (pid: string) => number | null,   // ms since this player joined, while their pop runs
 *   aspect?: number,                               // the box's width / height, measured by the page (the oval on both screens)
 * }} CircleOptions
 */

/** @param {unknown} n */
const hearts = (n) => "❤".repeat(Math.max(0, Math.min(Math.floor(Number(n)) || 0, 10)));

/**
 * The spotlight: the current player's live typing, large under the bomb. It shows in Classic (someone
 * is on) while there is typing, with one ring of seats; with two rings the inner ring sits there, so
 * the typing stays under the seat.
 * @param {any} view @param {number} seatCount
 * @returns {string | null} the typed text, or null when there is no spotlight
 */
export function spotlightText(view, seatCount) {
  if (typeof view?.mode?.current !== "string" || typeof view.typing !== "string") return null;
  return seatCount <= ONE_RING_MAX ? view.typing : null;
}

/**
 * The word under a player's name: their live typing during their own turn (unless the spotlight
 * shows it, then nothing), otherwise the last word they played, with the prompt's letters raised.
 * @param {any} view @param {any} p @param {string | null} spot
 */
function word(view, p, spot) {
  if (p.id === view.mode?.current && spot !== null) return "";
  if (p.id === view.mode?.current && typeof view.typing === "string") {
    return `<span class="typing">${tiles(view.typing)}<span class="caret"></span></span>`;
  }
  const last = p.lastWord;
  if (last && typeof last.word === "string") return `<span class="last-word">${matchedTiles(last.word, last.prompt)}</span>`;
  return "";
}

/**
 * @param {any} view a projector or player view
 * @param {CircleOptions} opts
 * @returns {string}
 */
export function renderCircle(view, opts) {
  const seated = seatedPlayers(view);
  const n = seated.length;
  const current = view?.mode?.current;
  const spot = spotlightText(view, n);
  const seats = seated
    .map((p, i) => {
      const pos = seatPosition(i, n);
      const popped = opts.popElapsed ? opts.popElapsed(p.id) : null;
      const pop = typeof popped === "number" && Number.isFinite(popped) ? Math.max(0, Math.round(popped)) : null;
      const cls = [
        "seat",
        p.id === current ? "on" : "",
        p.alive ? "" : "out",
        pos.ring === 1 ? "ring-1" : "",
        pop !== null ? "pop" : "",
        n > ONE_RING_MAX ? "small" : "",
      ].filter(Boolean).join(" ");
      const style = `left:${pos.left.toFixed(1)}%;top:${pos.top.toFixed(1)}%${pop !== null ? `;animation-delay:-${pop}ms` : ""}`;
      const lives = `<span class="lives">${p.alive ? hearts(p.lives) : "out"}</span>`;
      const away = p.connected ? "" : `<span class="away">offline</span>`;
      const answered = p.answered ? `<span class="answered" aria-label="answered">✓</span>` : "";
      return `<div class="${cls}" style="${style}">${avatarImg(p.avatar)}<span class="name">${esc(p.nickname)}</span>${lives}${away}${answered}${word(view, p, spot)}</div>`;
    })
    .join("");
  const spotlight = spot === null ? "" : `<div class="spotlight">${tiles(spot)}<span class="caret"></span></div>`;
  return `<div class="circle${opts.compact ? " compact" : ""}">${seats}<div class="circle-centre">${renderBomb(onScreen(opts, seated, current), opts.centre)}</div>${spotlight}</div>`;
}

/**
 * The motion tracker's arrow angles are angles round the ring. On an oval box they are turned to
 * where the seats really are on screen: the target by the current seat's ring, the start by the
 * outer ring. Without an aspect (as in tests) the bomb is passed on as it is.
 * @param {CircleOptions} opts @param {any[]} seated @param {unknown} current
 * @returns {import("./bomb.js").BombState}
 */
function onScreen(opts, seated, current) {
  const { bomb, aspect } = opts;
  if (!bomb?.arrow || typeof aspect !== "number" || !Number.isFinite(aspect) || aspect <= 0) return bomb;
  const i = seated.findIndex((p) => p.id === current);
  const ring = i < 0 ? 0 : seatPosition(i, seated.length).ring;
  const to = screenAngle(bomb.arrow.to, aspect, ring);
  // The start stays within half a turn of the target, so the swing still goes the short way round.
  const from = to + (((screenAngle(bomb.arrow.from, aspect, 0) - to) % 360) + 540) % 360 - 180;
  return { ...bomb, arrow: { ...bomb.arrow, from, to } };
}
