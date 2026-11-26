import { test } from "node:test";
import assert from "node:assert/strict";
import { TICK_TOCK } from "../../public/app/tick-styles.js";

/** A fake AudioContext that records nodes, starts, stops, connections, gains and pitches. */
function fakeAudio() {
  const started: string[] = [];
  const stopped: string[] = [];
  const gains: number[] = [];
  const pitches: number[] = [];
  const connections: unknown[] = [];
  const destination = { kind: "destination" };
  const out = { kind: "out" };
  const param = (record?: number[]) => ({
    value: 0,
    setValueAtTime(v: number) { record?.push(v); },
    linearRampToValueAtTime(v: number) { record?.push(v); },
    exponentialRampToValueAtTime(v: number) { record?.push(v); },
    setTargetAtTime(v: number) { record?.push(v); },
  });
  const built: any[] = [];
  const node = (kind: string) => {
    const n: any = {
      kind,
      type: "",
      buffer: null as unknown,
      Q: param(),
      connect(to: unknown) { connections.push(to); n.connectedTo.push(to); return to; },
      connectedTo: [] as unknown[],
      start() { started.push(kind); },
      stop() { stopped.push(kind); },
    };
    n.gain = param(kind === "gain" ? gains : undefined);
    n.frequency = param(kind === "osc" ? pitches : undefined);
    built.push(n);
    return n;
  };
  const ctx = {
    currentTime: 2,
    sampleRate: 8000,
    destination,
    createOscillator: () => node("osc"),
    createGain: () => node("gain"),
    createBiquadFilter: () => node("filter"),
    createBufferSource: () => node("noise"),
    createBuffer: (_ch: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
  };
  return { ctx, out, destination, started, stopped, gains, pitches, connections, built };
}

test("the tick-tock style builds nodes, starts them and connects only to out", () => {
  const style = TICK_TOCK;
  const id = "tick-tock";
  {
    assert.ok(style.label.length > 0, `${id} has a label`);
    const peak: Record<string, number> = {};
    const pitch: Record<string, number> = {};
    for (const urgent of [false, true]) {
      const a = fakeAudio();
      // Two calls, so both pitches show.
      style.play(a.ctx, a.out, urgent);
      style.play(a.ctx, a.out, urgent);
      assert.ok(a.started.length > 0, `${id} ${urgent ? "urgent" : "calm"} starts a node`);
      assert.equal(a.stopped.length, a.started.length, `${id} stops every node it starts`);
      assert.ok(!a.connections.includes(a.destination), `${id} never connects to the speakers directly`);
      assert.ok(a.connections.includes(a.out), `${id} connects to out`);
      for (const to of a.connections) assert.ok(to === a.out || a.built.includes(to), `${id} connects only inside its graph`);
      assert.ok(a.gains.length > 0, `${id} sets a gain`);
      peak[String(urgent)] = Math.max(...a.gains);
      pitch[String(urgent)] = a.pitches.length ? Math.max(...a.pitches) : 0;
    }
    assert.ok(peak.true <= peak.false * 1.25 + 1e-9, `${id}: urgent gain ${peak.true} is at most 1.25x calm ${peak.false}`);
    assert.ok(pitch.true <= pitch.false * 1.2 + 1e-9, `${id}: urgent pitch ${pitch.true} is at most 1.2x calm ${pitch.false}`);
  }
});

test("tick-tock alternates two close pitches", () => {
  const a = fakeAudio();
  TICK_TOCK.play(a.ctx, a.out, false);
  const first = a.pitches[0];
  a.pitches.length = 0;
  TICK_TOCK.play(a.ctx, a.out, false);
  const second = a.pitches[0];
  assert.notEqual(first, second);
  assert.ok(Math.max(first, second) / Math.min(first, second) < 1.3, "close pitches");
});
