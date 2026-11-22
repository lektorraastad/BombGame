import { test } from "node:test";
import assert from "node:assert/strict";
import { createSound, createSoundDriver } from "../../public/app/sound.js";

/** A fake AudioContext that records which sounds were built and started. */
function fakeAudio() {
  const log: string[] = [];
  let made = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (kind: string) => ({
    kind,
    frequency: param(),
    gain: param(),
    type: "",
    buffer: null as unknown,
    connect() {},
    start() { log.push(`start:${kind}`); },
    stop() {},
  });
  const factory = () => {
    made++;
    return {
      currentTime: 0,
      sampleRate: 8000,
      state: "suspended",
      destination: {},
      resume() { log.push("resume"); return Promise.resolve(); },
      createOscillator: () => node("osc"),
      createGain: () => node("gain"),
      createBiquadFilter: () => node("filter"),
      createBufferSource: () => node("noise"),
      createBuffer: (_ch: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    };
  };
  return { factory: factory as any, log, made: () => made };
}

test("sound does nothing until unlocked and when muted", () => {
  const a = fakeAudio();
  const s = createSound(a.factory);
  s.tick(false);
  s.tick(true);
  s.explode();
  assert.equal(a.made(), 0, "no AudioContext before unlock");
  assert.deepEqual([...a.log], []);

  s.unlock();
  assert.equal(a.made(), 1);
  assert.deepEqual([...a.log], ["resume"]);
  s.unlock();
  assert.equal(a.made(), 1, "one AudioContext only");

  s.tick(false);
  assert.ok(a.log.includes("start:osc"), "a tick plays");
  s.explode();
  assert.ok(a.log.includes("start:noise"), "an explosion plays a noise burst");

  s.setMuted(true);
  a.log.length = 0;
  s.tick(true);
  s.explode();
  assert.deepEqual([...a.log], [], "silent while muted");

  s.setMuted(false);
  s.tick(true);
  assert.ok(a.log.includes("start:osc"), "unmuted again");
});

/** A fake sound that counts calls. */
function countingSound() {
  const calls = { tick: [] as boolean[], explode: 0 };
  return { calls, sound: { unlock() {}, setMuted() {}, tick: (u: boolean) => calls.tick.push(u), explode: () => { calls.explode++; } } };
}

test("explode fires once per explosion event", () => {
  const { calls, sound } = countingSound();
  const d = createSoundDriver(sound, () => 0);
  const v = (lastEvent: string | null) => ({ phase: "playing", paused: false, lastEvent, bombRemainingMs: 9000 });
  d.view(v(null));
  d.view(v("word"));
  assert.equal(calls.explode, 0);
  d.view(v("explosion"));
  assert.equal(calls.explode, 1);
  d.view(v(null)); // a later broadcast, e.g. typing, is not another explosion
  assert.equal(calls.explode, 1);
  d.view(v("explosion"));
  assert.equal(calls.explode, 2);
});

test("ticks once a second, 4 times a second in the last 3 s, and steadily for a hidden fuse", () => {
  const { calls, sound } = countingSound();
  let now = 0;
  const d = createSoundDriver(sound, () => now);
  d.view({ phase: "playing", paused: false, lastEvent: null, bombRemainingMs: 6000 });
  // Visible timer: the loop runs every 50 ms.
  for (let ms = 6000; ms > 0; ms -= 50) d.step(ms);
  d.step(0);
  const slow = calls.tick.filter((u) => !u).length;
  const fast = calls.tick.filter((u) => u).length;
  assert.equal(slow, 3, "6, 5 and 4 seconds left");
  assert.equal(fast, 12, "4 a second for the last 3 s");

  // Paused: no ticks.
  calls.tick.length = 0;
  d.view({ phase: "paused", paused: true, lastEvent: null, bombRemainingMs: 5000 });
  for (let i = 0; i < 20; i++) d.step(5000);
  assert.equal(calls.tick.length, 0);

  // Hidden fuse: no remaining time, ticks once a second by the clock.
  d.view({ phase: "playing", paused: false, lastEvent: null });
  for (now = 0; now <= 5000; now += 50) d.step(null);
  assert.deepEqual(calls.tick, [false, false, false, false, false]);

  // Lobby and results: silent.
  calls.tick.length = 0;
  d.view({ phase: "results", paused: false, lastEvent: null });
  for (; now < 9000; now += 50) d.step(null);
  assert.equal(calls.tick.length, 0);
});
