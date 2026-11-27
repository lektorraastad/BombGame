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
 *   word?: WordMoment,                             // motion.word(): the correct Classic word flying to its seat
 *   refused?: RefusedMoment,                       // motion.refused(): the current player's word was refused
 *   hearts?: Map<string, number>,                  // motion.hearts(): player id to ms since they lost a heart
 *   examples?: string[] | null,                    // the example words to show under the bomb, or null
 * }} CircleOptions
 */
/** @typedef {ReturnType<import("./motion.js").createMotion>} Motion */
/** @typedef {ReturnType<Motion["word"]>} WordMoment */
/** @typedef {ReturnType<Motion["refused"]>} RefusedMoment */

/**
 * The moments for the circle, from a page's UI options (the projector's or the laptop's). The
 * examples are only the ones the page says to show now (motion.examplesShown): left out, none.
 * @param {{ word?: WordMoment, refused?: RefusedMoment, hearts?: Map<string, number>, examples?: string[] | null }} ui
 * @returns {Pick<CircleOptions, "word" | "refused" | "hearts" | "examples">}
 */
export function circleMoments(ui) {
  return { word: ui.word ?? null, refused: ui.refused ?? null, hearts: ui.hearts, examples: ui.examples ?? null };
}

/** @param {unknown} n */
const hearts = (n) => "❤".repeat(Math.max(0, Math.min(Math.floor(Number(n)) || 0, 10)));

/** A moment's elapsed time as a whole number of ms, or null when it isn't a usable number. @param {unknown} v */
const msOf = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);
/** The style that starts an animation part-way through. @param {number} ms */
const late = (ms) => `animation-delay:-${ms}ms`;

/** The heart cracking in two: two halves of one heart, drawn only while motion is allowed. @param {number} ms */
const crack = (ms) =>
  `<span class="crack" style="${late(ms)}" aria-hidden="true"><span class="crack-l">❤</span><span class="crack-r">❤</span></span>`;

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
 * `shake` is the refused moment's ms when this seat's typing shakes; `land` the correct word's
 * moment for this seat: it lands from the spotlight ("landing") or just pops in ("pop-in").
 * @param {any} view @param {any} p @param {string | null} spot
 * @param {number | null} shake @param {null | { ms: number, flight: boolean }} land
 */
function word(view, p, spot, shake, land) {
  if (p.id === view.mode?.current && spot !== null) return "";
  if (p.id === view.mode?.current && typeof view.typing === "string") {
    const sh = shake === null ? `<span class="typing">` : `<span class="typing shake" style="${late(shake)}">`;
    return `${sh}${tiles(view.typing)}<span class="caret"></span></span>`;
  }
  const last = p.lastWord;
  if (last && typeof last.word === "string") {
    const open = land === null
      ? `<span class="last-word">`
      : `<span class="last-word ${land.flight ? "landing" : "pop-in"}" style="${late(land.ms)}">`;
    return `${open}${matchedTiles(last.word, last.prompt)}</span>`;
  }
  return "";
}

/**
 * The example words under the bomb, in the spotlight's place, on letter tiles. --n counts their
 * letters and the gaps between them, so a long set gets smaller tiles and stays clear of the seats.
 * @param {string[]} words
 */
function spotExamples(words) {
  const n = words.reduce((sum, w) => sum + Array.from(w).length, 0) + 2 * (words.length - 1);
  // --n sits on the outer box, whose font size reads it (the row and the label inherit the size).
  return `<div class="spot-examples" style="--n:${n}"><div class="spot-examples-row">${words.map((w) => tiles(w)).join("")}</div>`
    + `<span class="spot-examples-label">Could have said</span></div>`;
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
  const oneRing = n <= ONE_RING_MAX;
  // The example words take the spotlight's place under the bomb (one ring only: with two, the inner
  // ring sits there and the projector keeps them on its bottom line). Live typing always wins the
  // spotlight back: the examples show only until the next player starts typing.
  const typing = typeof view?.typing === "string" && view.typing.length > 0;
  const examples = oneRing && !typing && Array.isArray(opts.examples) ? opts.examples.filter((w) => typeof w === "string" && w !== "") : [];
  const spot = examples.length ? null : spotlightText(view, n);

  // The refused shake: the spotlight, else the typing under the seat, else the name plate.
  const refusedMs = opts.refused && typeof opts.refused.pid === "string" ? msOf(opts.refused.elapsedMs) : null;
  const refusedPid = refusedMs === null ? null : opts.refused?.pid;
  const spotShakes = refusedPid !== null && refusedPid === current && spot !== null;

  // The correct word: it flies from the spotlight to its seat, or without a spotlight pops in there.
  const w = opts.word;
  const wordMs = w && typeof w.pid === "string" && typeof w.word === "string" ? msOf(w.elapsedMs) : null;
  const wordAt = wordMs === null ? -1 : seated.findIndex((p) => p.id === w?.pid);
  const flight = wordAt >= 0 && oneRing && w?.fromSpotlight === true;

  const seats = seated
    .map((p, i) => {
      const pos = seatPosition(i, n);
      const popped = opts.popElapsed ? opts.popElapsed(p.id) : null;
      const pop = typeof popped === "number" && Number.isFinite(popped) ? Math.max(0, Math.round(popped)) : null;
      const land = i === wordAt && wordMs !== null ? { ms: wordMs, flight } : null;
      const landing = land !== null && land.flight && pop === null;
      const refused = p.id === refusedPid && !spotShakes && refusedMs !== null;
      const typingShown = p.id === current && spot === null && typeof view.typing === "string";
      const cls = [
        "seat",
        p.id === current ? "on" : "",
        p.alive ? "" : "out",
        pos.ring === 1 ? "ring-1" : "",
        pop !== null ? "pop" : "",
        landing ? "landing" : "",
        refused ? "refused" : "",
        n > ONE_RING_MAX ? "small" : "",
      ].filter(Boolean).join(" ");
      const delay = pop !== null ? `;${late(pop)}` : landing && land ? `;${late(land.ms)}` : "";
      const style = `left:${pos.left.toFixed(1)}%;top:${pos.top.toFixed(1)}%${delay}`;
      const cracking = opts.hearts instanceof Map ? msOf(opts.hearts.get(p.id)) : null;
      const lives = `<span class="lives">${p.alive ? hearts(p.lives) : "out"}${cracking === null ? "" : crack(cracking)}</span>`;
      const away = p.connected ? "" : `<span class="away">offline</span>`;
      const answered = p.answered ? `<span class="answered" aria-label="answered">✓</span>` : "";
      const nameShakes = refused && !typingShown;
      const name = nameShakes && refusedMs !== null
        ? `<span class="name shake" style="${late(refusedMs)}">${esc(p.nickname)}</span>`
        : `<span class="name">${esc(p.nickname)}</span>`;
      const under = word(view, p, spot, refused && typingShown ? refusedMs : null, land);
      return `<div class="${cls}" style="${style}">${avatarImg(p.avatar)}${name}${lives}${away}${answered}${under}</div>`;
    })
    .join("");

  const spotlight = spot === null
    ? ""
    : `<div class="spotlight${spotShakes ? ` refused" style="${late(refusedMs ?? 0)}` : ""}">${tiles(spot)}<span class="caret"></span></div>`;
  const below = examples.length ? spotExamples(examples) : spotlight;

  // The flying word, on top of everything (the next turn draws as normal underneath), in
  // percentages of the ring box: from the spotlight's place to the seat's word.
  let fly = "";
  if (flight && wordMs !== null && w) {
    const to = seatPosition(wordAt, n);
    const len = Array.from(w.word).length;
    fly = `<div class="fly-word" style="${late(wordMs)};--x:${to.left.toFixed(1)}%;--y:${to.top.toFixed(1)}%;--n:${Math.max(12, len)}" aria-hidden="true">${matchedTiles(w.word, w.prompt)}</div>`;
  }
  return `<div class="circle${opts.compact ? " compact" : ""}">${seats}<div class="circle-centre">${renderBomb(onScreen(opts, seated, current), opts.centre)}</div>${below}${fly}</div>`;
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
