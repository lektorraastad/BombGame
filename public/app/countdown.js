// A local countdown for the bomb. The server sends how many milliseconds are left each time the
// state changes; between views we count down with our own clock. We never use the server's clock.

/**
 * @param {() => number} now
 * @returns {{ update(view: { bombRemainingMs?: number, paused?: boolean }): void, remainingMs(): number | null }}
 */
export function createCountdown(now) {
  /** @type {number | null} */ let base = null;
  let at = 0;
  let paused = false;
  return {
    update(view) {
      if (typeof view.bombRemainingMs !== "number") {
        base = null;
        return;
      }
      base = view.bombRemainingMs;
      at = now();
      paused = view.paused === true;
    },
    /** Milliseconds left, or null when no bomb is visible. */
    remainingMs() {
      if (base === null) return null;
      return paused ? base : Math.max(0, base - (now() - at));
    },
  };
}

/** The last 3 s of a visible timer: the bomb shakes and the ticking speeds up. */
export const URGENT_MS = 3000;
