import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClock } from "../fakes.ts";
import { createCountdown } from "../../public/app/countdown.js";

test("countdown follows bombRemainingMs and freezes when paused", async () => {
  const clock = makeClock();
  const c = createCountdown(clock.now);
  assert.equal(c.remainingMs(), null);
  c.update({ bombRemainingMs: 10_000, paused: false } as any);
  assert.equal(c.remainingMs(), 10_000);
  await clock.advance(3_000);
  assert.equal(c.remainingMs(), 7_000);
  // A fresh view restarts from the server's number.
  c.update({ bombRemainingMs: 9_000, paused: false } as any);
  await clock.advance(1_000);
  assert.equal(c.remainingMs(), 8_000);
  // Paused: frozen.
  c.update({ bombRemainingMs: 8_000, paused: true } as any);
  await clock.advance(5_000);
  assert.equal(c.remainingMs(), 8_000);
  // Resumed.
  c.update({ bombRemainingMs: 8_000, paused: false } as any);
  await clock.advance(2_000);
  assert.equal(c.remainingMs(), 6_000);
  // Never negative.
  await clock.advance(60_000);
  assert.equal(c.remainingMs(), 0);
  // No visible bomb (hidden fuse or no game).
  c.update({ paused: false } as any);
  assert.equal(c.remainingMs(), null);
});
