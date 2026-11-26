// Ticking styles for the projector, synthesised with WebAudio. Each play(ctx, out, urgent) builds a
// short sound at ctx.currentTime, connects only to `out` (a gain node the caller owns) and stops
// every node it starts, so nothing is left running. Urgent ticks come faster (the caller decides the
// rhythm) and may be a little shorter, but never more than 1.25x the calm gain or 1.2x the calm pitch:
// the ticking should get tense, not shrill.

const SILENT = 0.0001; // exponential ramps cannot reach 0

/**
 * A short enveloped oscillator: fast attack, exponential decay, optional pitch drop.
 * @param {any} ctx @param {any} out
 * @param {{ type: string, from: number, to?: number, gain: number, at?: number, attack?: number, decay: number }} o
 */
function blip(ctx, out, o) {
  const t = ctx.currentTime + (o.at ?? 0);
  const end = t + (o.attack ?? 0.003) + o.decay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, end);
  gain.gain.setValueAtTime(SILENT, t);
  gain.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.003));
  gain.gain.exponentialRampToValueAtTime(SILENT, end);
  osc.connect(gain);
  gain.connect(out);
  osc.start(t);
  osc.stop(end + 0.01);
}

/** One short white-noise buffer per AudioContext, made on first use. */
const noiseBuffers = new WeakMap();
/** @param {any} ctx */
function noiseBuffer(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    const length = Math.floor(ctx.sampleRate * 0.08);
    buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

let tickTockCount = 0;

/** @type {Record<string, { label: string, play(ctx: any, out: any, urgent: boolean): void }>} */
export const TICK_STYLES = {
  "soft-clock": {
    label: "Soft clock",
    // A low wooden "tock": a triangle wave that drops a little in pitch and dies away quickly.
    play(ctx, out, urgent) {
      blip(ctx, out, urgent
        ? { type: "triangle", from: 680, to: 540, gain: 0.2, decay: 0.06 }
        : { type: "triangle", from: 620, to: 500, gain: 0.18, decay: 0.08 });
    },
  },
  "tick-tock": {
    label: "Tick-tock",
    // A wall clock: two close pitches, one after the other.
    play(ctx, out, urgent) {
      const high = tickTockCount++ % 2 === 0;
      const base = high ? 840 : 740;
      blip(ctx, out, { type: "sine", from: base * (urgent ? 1.05 : 1), gain: urgent ? 0.2 : 0.18, decay: urgent ? 0.035 : 0.045 });
    },
  },
  muffled: {
    label: "Muffled tick",
    // A mechanical click: a few milliseconds of noise through a band-pass filter.
    play(ctx, out, urgent) {
      const t = ctx.currentTime;
      const end = t + (urgent ? 0.03 : 0.04);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(urgent ? 1900 : 1700, t);
      filter.Q.setValueAtTime(5, t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(SILENT, t);
      gain.gain.exponentialRampToValueAtTime(urgent ? 0.6 : 0.5, t + 0.002);
      gain.gain.exponentialRampToValueAtTime(SILENT, end);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      src.start(t);
      src.stop(end + 0.01);
    },
  },
  heartbeat: {
    label: "Heartbeat",
    // Two low thumps, "lub-dub", about 120 ms apart (a little closer when urgent, to fit 4 a second).
    play(ctx, out, urgent) {
      const gap = urgent ? 0.1 : 0.12;
      const decay = urgent ? 0.08 : 0.11;
      blip(ctx, out, { type: "sine", from: 110, to: 60, gain: urgent ? 0.65 : 0.6, attack: 0.005, decay });
      blip(ctx, out, { type: "sine", from: 95, to: 55, gain: urgent ? 0.45 : 0.42, attack: 0.005, decay, at: gap });
    },
  },
  "beep-soft": {
    label: "Today's beep, softer",
    // Today's square-wave beep at 0.4x the gain, and urgent only a step higher (not 1760 Hz).
    play(ctx, out, urgent) {
      blip(ctx, out, urgent
        ? { type: "square", from: 1300, gain: 0.064, attack: 0.004, decay: 0.046 }
        : { type: "square", from: 1180, gain: 0.056, attack: 0.004, decay: 0.046 });
    },
  },
};
