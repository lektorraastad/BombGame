// The ticking sound for the projector, synthesised with WebAudio: a wall clock, "tick-tock" (Roy's
// choice). play(ctx, out, urgent) builds a short sound at ctx.currentTime, connects only to `out`
// (a gain node the caller owns) and stops every node it starts, so nothing is left running. Urgent
// ticks come faster (the caller decides the rhythm) and may be a little shorter, but never more than
// 1.25x the calm gain or 1.2x the calm pitch: the ticking should get tense, not shrill.

const SILENT = 0.0001; // exponential ramps cannot reach 0

/**
 * A short enveloped oscillator: fast attack, exponential decay.
 * @param {any} ctx @param {any} out
 * @param {{ type: string, from: number, gain: number, attack?: number, decay: number }} o
 */
function blip(ctx, out, o) {
  const t = ctx.currentTime;
  const end = t + (o.attack ?? 0.003) + o.decay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, t);
  gain.gain.setValueAtTime(SILENT, t);
  gain.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.003));
  gain.gain.exponentialRampToValueAtTime(SILENT, end);
  osc.connect(gain);
  gain.connect(out);
  osc.start(t);
  osc.stop(end + 0.01);
}

let tickTockCount = 0;

/** @type {{ label: string, play(ctx: any, out: any, urgent: boolean): void }} */
export const TICK_TOCK = {
  label: "Tick-tock",
  // A wall clock: two close pitches, one after the other.
  play(ctx, out, urgent) {
    const high = tickTockCount++ % 2 === 0;
    const base = high ? 840 : 740;
    blip(ctx, out, { type: "sine", from: base * (urgent ? 1.05 : 1), gain: urgent ? 0.2 : 0.18, decay: urgent ? 0.035 : 0.045 });
  },
};
