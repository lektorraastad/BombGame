// Projector sound, synthesised with WebAudio: no audio files. Pure apart from the AudioContext the
// caller's factory makes, and it makes none until unlock(), because browsers block audio until a
// click. Player laptops never load this module.
import { URGENT_MS } from "./countdown.js";

/**
 * @typedef {{ unlock(): void, tick(urgent: boolean): void, explode(): void, setMuted(b: boolean): void }} Sound
 */

/**
 * @param {() => any} audioContextFactory makes an AudioContext (or a fake in tests)
 * @returns {Sound}
 */
export function createSound(audioContextFactory) {
  /** @type {any} */ let ctx = null;
  let muted = false;
  /** @type {any} */ let noise = null;

  /** @returns {any} the context, or null when sound must stay silent */
  const ready = () => (ctx && !muted ? ctx : null);

  return {
    unlock() {
      if (!ctx) {
        try {
          ctx = audioContextFactory();
        } catch {
          ctx = null;
          return;
        }
      }
      if (ctx.state !== "running") ctx.resume?.();
    },
    tick(urgent) {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(urgent ? 1760 : 1180, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(urgent ? 0.22 : 0.14, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    },
    explode() {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      const seconds = 1.2;
      if (!noise) {
        const length = Math.floor(c.sampleRate * seconds);
        noise = c.createBuffer(1, length, c.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      const src = c.createBufferSource();
      src.buffer = noise;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(3200, t);
      filter.frequency.exponentialRampToValueAtTime(120, t + seconds);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.9, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(c.destination);
      src.start(t);
      src.stop(t + seconds);
      // A low thump under the noise.
      const boom = c.createOscillator();
      const bg = c.createGain();
      boom.type = "sine";
      boom.frequency.setValueAtTime(110, t);
      boom.frequency.exponentialRampToValueAtTime(35, t + 0.5);
      bg.gain.setValueAtTime(0.8, t);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      boom.connect(bg);
      bg.connect(c.destination);
      boom.start(t);
      boom.stop(t + 0.6);
    },
    setMuted(b) {
      muted = b;
    },
  };
}


/**
 * Decides when to play: explode() for each projector view whose lastEvent is "explosion", and
 * tick() from the countdown loop: once a second, 4 times a second in the last 3 s of a visible
 * timer, and steadily once a second for a hidden fuse. Silent outside a running, unpaused game.
 * @param {Sound} sound
 * @param {() => number} now
 */
export function createSoundDriver(sound, now) {
  let running = false;
  /** @type {string | null} */ let lastBucket = null;
  let nextHiddenTick = 0;

  return {
    /** @param {{ phase?: string, paused?: boolean, lastEvent?: string | null, bombRemainingMs?: number }} view a projector view */
    view(view) {
      const was = running;
      running = view.phase === "playing" && view.paused !== true;
      if (running && !was) nextHiddenTick = now() + 1000;
      if (view.lastEvent === "explosion") {
        sound.explode();
        nextHiddenTick = now() + 1000;
      }
    },
    /** @param {number | null} remainingMs the local countdown, or null for a hidden fuse */
    step(remainingMs) {
      if (!running) {
        lastBucket = null;
        return;
      }
      if (remainingMs === null) {
        lastBucket = null;
        const t = now();
        if (t >= nextHiddenTick) {
          sound.tick(false);
          nextHiddenTick = Math.max(nextHiddenTick + 1000, t + 1);
        }
        return;
      }
      if (remainingMs <= 0) return;
      const urgent = remainingMs <= URGENT_MS;
      const bucket = urgent ? `u${Math.ceil(remainingMs / 250)}` : `s${Math.ceil(remainingMs / 1000)}`;
      if (bucket === lastBucket) return;
      lastBucket = bucket;
      sound.tick(urgent);
    },
  };
}
