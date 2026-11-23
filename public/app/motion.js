// Remembers what changed between views, so the bomb's animations can be drawn from elapsed time.
// The pages replace their HTML on every view, so an animation can't live in the DOM: instead each
// draw says how long ago the arrow started swinging, the bomb exploded or a player joined, and the
// bomb file turns that into a negative animation-delay. Pure: the clock is passed in.
import { arrowAngle } from "./circle-geometry.js";
import { ARROW_SWING_MS, EXPLOSION_MS } from "./bomb.js";

/** How long a newly joined player's pop lasts. */
export const POP_MS = 400;

/** @typedef {import("./bomb.js").BombState} BombState */

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

  const swinging = () => to !== null && now() - swingAt < ARROW_SWING_MS;
  const exploding = () => now() - explodedAt < EXPLOSION_MS;

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
      };
    },

    /** How long ago this player joined, while their pop runs; null otherwise. @param {string} pid */
    popElapsed(pid) {
      const at = joinedAt.get(pid);
      if (at === undefined) return null;
      const elapsed = now() - at;
      return elapsed < POP_MS ? elapsed : null;
    },

    /** True while a swing, an explosion or a pop is still running, so the page keeps redrawing. */
    busy() {
      const t = now();
      let popping = false;
      for (const [pid, at] of joinedAt) {
        if (t - at < POP_MS) popping = true;
        else joinedAt.delete(pid); // finished: forget it
      }
      return popping || swinging() || exploding();
    },
  };
}
