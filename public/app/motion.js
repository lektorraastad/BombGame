// Remembers what changed between views, so the bomb's animations can be drawn from elapsed time.
// The pages replace their HTML on every view, so an animation can't live in the DOM: instead each
// draw says how long ago the arrow started swinging, the bomb exploded or a player joined, and the
// bomb file turns that into a negative animation-delay. Pure: the clock is passed in.
import { arrowAngle } from "./circle-geometry.js";
import { ARROW_SWING_MS, EXPLOSION_MS, TENSION_FULL_MS } from "./bomb.js";

/** How long a newly joined player's pop lasts. */
export const POP_MS = 400;
/** How long a correct Classic word takes to light up, hop and fly to its seat. */
export const WORD_MS = 650;
/** How long a refused word's shake lasts. */
export const REFUSED_MS = 450;
/** How long a lost heart takes to swell, crack and fall away. */
export const HEART_MS = 900;
/** How long the winner's moment lasts on the results screen. */
export const WIN_MS = 1500;
/** How long the circle stays up after the last explosion before the results show. */
export const RESULTS_HOLD_MS = 1500;
/** How long the example words show under the bomb after an explosion. */
export const EXAMPLES_MS = 4000;
/** How long a seat's spark lasts, for a silent or a ghost answer. */
export const SPARK_MS = 700;
/** A seat sparks at most once in this long: extra answers inside it are skipped. */
export const SPARK_GAP_MS = 1000;
/** How long a hidden-fuse turn lasts before the flame is at its biggest (bomb.js draws it). */
export { TENSION_FULL_MS };

/** @typedef {import("./bomb.js").BombState} BombState */
/** The hidden fuse's turn (bomb.js draws the flame's growth from it). @typedef {import("./bomb.js").Tension} Tension */

/** @param {any} v */
const isClassic = (v) => Array.isArray(v?.mode?.seats);
/** @param {any} v @returns {any[]} */
const momentsOf = (v) => (Array.isArray(v?.moments) ? v.moments.filter((/** @type {any} */ m) => m && typeof m === "object") : []);
/** @param {unknown} pids @returns {string[]} */
const pidList = (pids) => (Array.isArray(pids) ? pids.filter((p) => typeof p === "string") : []);
/** @param {any} v */
const typed = (v) => typeof v?.typing === "string" && v.typing.length > 0;

/**
 * @param {() => number} now
 */
export function createMotion(now) {
  let seenFirst = false;
  /** The arrow's last target, in degrees, or null when there was no arrow. @type {number | null} */
  let to = null;
  let from = 0;
  let swingAt = -Infinity;
  let explodedAt = -Infinity;
  /** The prompt the fuse belongs to, and the time it had when first seen. */
  let fuseKey = "";
  let fuseTotal = 0;
  /** @type {Set<string>} */
  const known = new Set();
  /** @type {Map<string, number>} */
  const joinedAt = new Map();

  /** The previous view, and the last one with the game playing (held over the results). @type {any} */
  let prev = null;
  /** @type {any} */
  let lastPlaying = null;
  /** @type {null | { pid: string, word: string, prompt: { text: string, type: string }, fromSpotlight: boolean }} */
  let wordInfo = null;
  let wordAt = -Infinity;
  /** @type {string | null} */
  let refusedPid = null;
  let refusedAt = -Infinity;
  /** @type {Map<string, number>} */
  const heartAt = new Map();
  /** @type {string[]} */
  let winPids = [];
  let winAt = -Infinity;
  /** The held results: the playing view drawn instead, until holdUntil. @type {any} */
  let holdBase = null;
  let holdUntil = -Infinity;
  /** The explosion that brought the example words, and whether the next player has typed since. */
  let examplesAt = -Infinity;
  let typedSince = false;
  /** The hidden turn's age from the last view that had one, and when that view came. @type {number | null} */
  let turnBase = null;
  let turnSeenAt = 0;
  let turnRunning = false;
  /** Whether the latest view had example words. */
  let hasExamples = false;
  /** Each seat's last spark: when it started, and whether it was a ghost's. Kept through the gap. @type {Map<string, { at: number, ghost: boolean }>} */
  const sparkAt = new Map();

  const swinging = () => to !== null && now() - swingAt < ARROW_SWING_MS;
  const exploding = () => now() - explodedAt < EXPLOSION_MS;
  const holding = () => now() < holdUntil;
  const showingWord = () => wordInfo !== null && now() - wordAt < WORD_MS;
  const showingRefused = () => refusedPid !== null && now() - refusedAt < REFUSED_MS;
  const showingWin = () => winPids.length > 0 && now() - winAt < WIN_MS; // includes the wait through a hold
  const showingExamples = () => now() - examplesAt < EXAMPLES_MS && !typedSince;
  /** The hidden turn's age: the last turnElapsedMs, plus the local time since while it runs. */
  const turnAge = () => (turnBase === null ? null : turnBase + (turnRunning ? Math.max(0, now() - turnSeenAt) : 0));
  const tension = () => {
    const age = turnAge();
    return age === null ? 0 : Math.min(1, Math.max(0, age / TENSION_FULL_MS));
  };

  return {
    /** Feed every view from the server, in order. @param {any} v */
    view(v) {
      const first = !seenFirst;
      seenFirst = true;

      // The arrow. The first view after a load or refresh never swings, and neither does one after
      // a stretch without an arrow; otherwise it swings from the old angle the short way round.
      const angle = arrowAngle(v);
      if (angle === null) {
        to = null;
      } else if (to === null || first) {
        to = angle;
        from = angle;
        swingAt = -Infinity;
      } else if (angle !== to) {
        const d = (((angle - to) % 360) + 360) % 360; // 0 to 359.9…, clockwise
        const turn = d > 180 ? d - 360 : d; // -179.9… to 180: half a turn goes clockwise
        from = angle - turn;
        to = angle;
        swingAt = now();
      }

      // The explosion: never replayed from the view that arrives after a refresh.
      if (!first && v?.lastEvent === "explosion") explodedAt = now();

      // The fuse: the time first seen for this prompt, in this round.
      if (typeof v?.bombRemainingMs === "number" && v.prompt) {
        const key = JSON.stringify([v.prompt.text, v.prompt.type, v.mode?.round ?? null]);
        if (key !== fuseKey) {
          fuseKey = key;
          fuseTotal = v.bombRemainingMs;
        } else if (v.bombRemainingMs > fuseTotal) {
          fuseTotal = v.bombRemainingMs; // the timer was reset or given more time
        }
      }

      // Joins: everyone in the first view was already there.
      for (const p of Array.isArray(v?.players) ? v.players : []) {
        if (typeof p?.id !== "string" || known.has(p.id)) continue;
        known.add(p.id);
        if (!first) joinedAt.set(p.id, now());
      }

      // The hidden fuse's tension: the turn's age is a state, not a moment, so the first view uses it too.
      if (typeof v?.turnElapsedMs === "number" && Number.isFinite(v.turnElapsedMs) && v.turnElapsedMs >= 0) {
        turnBase = v.turnElapsedMs;
        turnSeenAt = now();
        turnRunning = v.phase === "playing" && v.paused !== true;
      } else {
        turnBase = null;
      }

      // The moments: never started from the first view after a load or refresh.
      const moments = first ? [] : momentsOf(v);
      const t = now();
      const exploded = moments.some((m) => m.kind === "explosion");
      if (exploded) {
        examplesAt = t;
        typedSince = false;
      }
      if (isClassic(v) && typed(v)) typedSince = true;

      // The results wait while the class sees the last explosion, and the win starts after.
      const toResults = v?.phase === "results" && prev?.phase !== "results";
      if (toResults && exploded && lastPlaying) {
        holdBase = lastPlaying;
        holdUntil = t + RESULTS_HOLD_MS;
      }

      for (const m of moments) {
        if (m.kind === "word" && typeof m.pid === "string") {
          if (isClassic(v)) {
            const p = (Array.isArray(v.players) ? v.players : []).find((/** @type {any} */ p) => p?.id === m.pid);
            const lw = p?.lastWord;
            if (typeof lw?.word === "string" && typeof lw.prompt?.text === "string" && typeof lw.prompt?.type === "string") {
              const fromSpotlight = typed(prev) && prev?.mode?.current === m.pid;
              wordInfo = { pid: m.pid, word: lw.word, prompt: { text: lw.prompt.text, type: lw.prompt.type }, fromSpotlight };
              wordAt = t;
            }
          } else {
            joinedAt.set(m.pid, t); // Everyone at once: the ✓ arrives with the seat's pop
          }
        } else if (m.kind === "refused" && typeof m.pid === "string") {
          refusedPid = m.pid;
          refusedAt = t;
        } else if (m.kind === "hearts") {
          for (const pid of pidList(m.pids)) heartAt.set(pid, t);
        } else if ((m.kind === "silent" || m.kind === "ghost") && typeof m.pid === "string" && m.pid !== "" && v?.phase === "playing") {
          // One spark per answer, but a seat sparks at most once per SPARK_GAP_MS. The moment never carries the word.
          const last = sparkAt.get(m.pid);
          if (!last || t - last.at >= SPARK_GAP_MS) sparkAt.set(m.pid, { at: t, ghost: m.kind === "ghost" });
        } else if (m.kind === "win") {
          winPids = pidList(m.pids);
          winAt = holding() ? holdUntil : t;
        }
      }

      hasExamples = Array.isArray(v?.examples) && v.examples.length > 0;
      if (v?.phase === "playing") lastPlaying = v;
      prev = v;
    },

    /**
     * @param {number | null} countdownMs the local countdown, or null for a hidden fuse
     * @param {boolean} lit false in the lobby and while paused: no flame, nothing burns
     * @returns {BombState}
     */
    bombState(countdownMs, lit) {
      const t = now();
      return {
        lit,
        arrow: to === null ? null : { from, to, elapsedMs: swingAt === -Infinity ? ARROW_SWING_MS : t - swingAt },
        countdownMs,
        fuse: countdownMs === null || fuseKey === "" ? null : { totalMs: fuseTotal, elapsedMs: Math.max(0, fuseTotal - countdownMs) },
        explosion: exploding() ? { elapsedMs: t - explodedAt } : null,
        tension: (() => {
          const age = turnAge();
          return age === null ? null : { elapsedMs: age, running: turnRunning };
        })(),
      };
    },

    /** The correct Classic word flying to its seat, for WORD_MS; null otherwise. */
    word() {
      return showingWord() && wordInfo ? { ...wordInfo, prompt: { ...wordInfo.prompt }, elapsedMs: now() - wordAt } : null;
    },

    /** The refused word's shake, for REFUSED_MS; null otherwise. */
    refused() {
      return showingRefused() && refusedPid !== null ? { pid: refusedPid, elapsedMs: now() - refusedAt } : null;
    },

    /** Each lost heart still cracking: player id to elapsed ms, each for HEART_MS. */
    hearts() {
      const t = now();
      /** @type {Map<string, number>} */
      const out = new Map();
      for (const [pid, at] of heartAt) if (t - at < HEART_MS) out.set(pid, t - at);
      return out;
    },

    /** Each seat still sparking: player id to its elapsed ms and whether it is a ghost's, each for SPARK_MS. */
    sparks() {
      const t = now();
      /** @type {Map<string, { elapsedMs: number, ghost: boolean }>} */
      const out = new Map();
      for (const [pid, s] of sparkAt) {
        if (t - s.at < SPARK_MS) out.set(pid, { elapsedMs: t - s.at, ghost: s.ghost });
        else if (t - s.at >= SPARK_GAP_MS) sparkAt.delete(pid); // the gap is over too: forget it
      }
      return out;
    },

    /** The winner's moment, for WIN_MS from when the results show (after any hold); null otherwise. */
    win() {
      const elapsed = now() - winAt;
      return winPids.length > 0 && elapsed >= 0 && elapsed < WIN_MS ? { pids: [...winPids], elapsedMs: elapsed } : null;
    },

    /**
     * The view to draw: for RESULTS_HOLD_MS after the last explosion, the circle as it was while
     * playing, with the results' players and own hearts (so the last heart cracks) and example words, and without
     * the old typing, timer or turn age; otherwise the view itself. Display only: the server's phase
     * has already changed. @param {any} v
     */
    heldView(v) {
      if (v?.phase !== "results" || !holding() || !holdBase) return v;
      const { typing: _t, bombRemainingMs: _b, turnElapsedMs: _e, ...base } = holdBase;
      const held = { ...base, players: v.players, examples: v.examples, phase: "playing", paused: false, moments: [] };
      // A laptop's own view: the results' hearts and score, but still the playing circle (not the
      // out screen) and nobody's turn, so the text box isn't live. Enter then does nothing harmful:
      // the server refuses a word outside a game.
      if (base.me && v.me) held.me = { ...base.me, lives: v.me.lives, score: v.me.score, isOn: false, canAnswerSilently: false };
      return held;
    },

    /**
     * Whether to show the example words under the bomb: for EXAMPLES_MS after the explosion that
     * brought them, and in Classic only until the next player starts typing. @param {any} v
     */
    examplesShown(v) {
      if (!Array.isArray(v?.examples) || v.examples.length === 0) return false;
      if (isClassic(v) && typed(v)) return false;
      return showingExamples();
    },

    /** How far the hidden fuse's turn has gone, from 0 to 1 at TENSION_FULL_MS; 0 without one (for the sound). */
    tension,

    /** How long ago this player joined, while their pop runs; null otherwise. @param {string} pid */
    popElapsed(pid) {
      const at = joinedAt.get(pid);
      if (at === undefined) return null;
      const elapsed = now() - at;
      return elapsed < POP_MS ? elapsed : null;
    },

    /**
     * True while a swing, an explosion, a pop, a moment, the results hold or the example words are
     * still running, so the page keeps redrawing. The hidden fuse's flame grows in CSS: not here.
     */
    busy() {
      const t = now();
      let popping = false;
      for (const [pid, at] of joinedAt) {
        if (t - at < POP_MS) popping = true;
        else joinedAt.delete(pid); // finished: forget it
      }
      let cracking = false;
      for (const [pid, at] of heartAt) {
        if (t - at < HEART_MS) cracking = true;
        else heartAt.delete(pid);
      }
      // Sparks never keep the page busy: one starts on the redraw that follows its view and CSS ends it
      // (forwards, invisible). sparks() forgets a finished one.
      return popping || cracking || swinging() || exploding() || holding() || showingWord() || showingRefused()
        || showingWin() || (hasExamples && showingExamples());
    },
  };
}
