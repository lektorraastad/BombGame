// The host passcode check and the limit on how often it may be tried.
import { createHash, timingSafeEqual } from "node:crypto";

/** Constant time: both sides are hashed first, so the buffers always have equal length. */
export function passcodeMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

const WINDOW_MS = 60_000;
const MAX_PER_KEY = 5;
const MAX_IN_ALL = 30;

/**
 * Counts wrong passcode attempts only: at most 5 per key (connection) and 30 across the server in any one minute.
 * Check blocked() before an attempt, call fail() after a wrong one, and forget() when the connection closes.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();
  private all: number[] = [];

  blocked(key: string, now: number): boolean {
    this.prune(now);
    return this.all.length >= MAX_IN_ALL || (this.failures.get(key)?.length ?? 0) >= MAX_PER_KEY;
  }

  fail(key: string, now: number): void {
    this.prune(now);
    this.all.push(now);
    const times = this.failures.get(key) ?? [];
    times.push(now);
    this.failures.set(key, times);
  }

  forget(key: string): void {
    this.failures.delete(key);
  }

  private prune(now: number): void {
    const recent = (t: number) => now - t < WINDOW_MS;
    this.all = this.all.filter(recent);
    for (const [k, times] of this.failures) {
      const kept = times.filter(recent);
      if (kept.length === 0) this.failures.delete(k);
      else this.failures.set(k, kept);
    }
  }
}
