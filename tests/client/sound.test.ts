import { test } from "node:test";
import assert from "node:assert/strict";
import { createSound, createSoundDriver, nextLevel, readLevel, LEVEL_GAIN } from "../../public/app/sound.js";

/** A fake AudioContext that records which sounds were built and started. */
function fakeAudio() {
  const log: string[] = [];
  let made = 0;
  const gains: any[] = [];
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
      createGain: () => {
        const g = node("gain");
        gains.push(g);
        return g;
      },
      createBiquadFilter: () => node("filter"),
      createBufferSource: () => node("noise"),
      createBuffer: (_ch: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    };
  };
  return { factory: factory as any, log, made: () => made, gains };
}

test("sound does nothing until unlocked and when off", () => {
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

  s.setLevel("off");
  a.log.length = 0;
  s.tick(true);
  s.explode();
  assert.deepEqual([...a.log], [], "silent while off");

  s.setLevel("normal");
  s.tick(true);
  assert.ok(a.log.includes("start:osc"), "on again");
});

test("nextLevel and readLevel fall back to normal", () => {
  assert.equal(nextLevel("normal"), "quiet");
  assert.equal(nextLevel("quiet"), "off");
  assert.equal(nextLevel("off"), "normal");
  assert.equal(nextLevel("x"), "normal");
  assert.equal(readLevel(() => "quiet"), "quiet");
  assert.equal(readLevel(() => "off"), "off");
  assert.equal(readLevel(() => null), "normal");
  assert.equal(readLevel(() => "loud"), "normal");
  assert.equal(readLevel(() => { throw new Error(); }), "normal");
  assert.deepEqual(LEVEL_GAIN, { normal: 1, quiet: 0.33, off: 0 });
});

test('setLevel("off") silences and "quiet" lowers', () => {
  const a = fakeAudio();
  const s = createSound(a.factory);
  s.setLevel("quiet"); // before unlock: applied when the master gain is made
  s.unlock();
  const master = a.gains[0];
  assert.ok(master, "a master gain node is made on unlock");
  assert.equal(master.gain.value, 0.33);
  s.setLevel("off");
  assert.equal(master.gain.value, 0);
  s.setLevel("quiet");
  assert.equal(master.gain.value, 0.33);
  s.setLevel("normal");
  assert.equal(master.gain.value, 1);
});

test("tick uses the given style, and every sound goes through the master gain", () => {
  const a = fakeAudio();
  const calls: { out: unknown; urgent: boolean }[] = [];
  const style = { label: "Fake", play: (_ctx: unknown, out: unknown, urgent: boolean) => { calls.push({ out, urgent }); } };
  const s = createSound(a.factory, style);
  s.unlock();
  const master = a.gains[0];
  s.tick(false);
  s.tick(true);
  assert.deepEqual(calls, [{ out: master, urgent: false }, { out: master, urgent: true }]);
  s.setLevel("off");
  s.tick(true);
  assert.equal(calls.length, 2, "no tick while off");
});

test("the explosion connects to the master gain, not the destination", () => {
  const a = fakeAudio();
  const s = createSound(a.factory);
  s.unlock();
  const master = a.gains[0];
  const targets: unknown[] = [];
  const realPush = a.gains.push.bind(a.gains);
  a.gains.push = (...gs: any[]) => {
    for (const g of gs) g.connect = (t: unknown) => { targets.push(t); };
    return realPush(...gs);
  };
  s.explode();
  assert.equal(targets.length, 2, "the noise and the thump each have a gain");
  assert.ok(targets.every((t) => t === master), "both go to the master gain");
});

/** A fake sound that counts calls. */
function countingSound() {
  const calls = { tick: [] as boolean[], explode: 0 };
  return { calls, sound: { unlock() {}, setLevel() {}, tick: (u: boolean) => calls.tick.push(u), explode: () => { calls.explode++; } } };
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
