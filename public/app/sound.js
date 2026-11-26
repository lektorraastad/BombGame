// Projector sound, synthesised with WebAudio: no audio files. Pure apart from the AudioContext the
// caller's factory makes, and it makes none until unlock(), because browsers block audio until a
// click. Player laptops never load this module.
import { URGENT_MS } from "./countdown.js";
import { TICK_TOCK } from "./tick-styles.js";

/** @typedef {"normal" | "quiet" | "off"} SoundLevel */

/** The master volume for each level. Quiet is about a third, for ticking and explosion alike. */
export const LEVEL_GAIN = { normal: 1, quiet: 0.33, off: 0 };

/** @type {SoundLevel[]} */
const LEVELS = ["normal", "quiet", "off"];

/** @param {unknown} l @returns {l is SoundLevel} */
const isLevel = (l) => typeof l === "string" && /** @type {string[]} */ (LEVELS).includes(l);

/**
 * The level after this one: normal → quiet → off → normal. Anything else gives "normal".
 * @param {string} l @returns {SoundLevel}
 */
export function nextLevel(l) {
  if (!isLevel(l)) return "normal";
  return LEVELS[(LEVELS.indexOf(l) + 1) % LEVELS.length];
}

/**
 * The saved level, or "normal" when there is none, it is junk, or reading throws (blocked storage).
 * @param {() => string | null} get @returns {SoundLevel}
 */
export function readLevel(get) {
  try {
    const l = get();
    return isLevel(l) ? l : "normal";
  } catch {
    return "normal";
  }
}

/**
 * @typedef {{ unlock(): void, tick(urgent: boolean): void, explode(): void, setLevel(l: SoundLevel): void }} Sound
 */

/**
 * Every sound goes through one master gain node, set from the level.
 * @param {() => any} audioContextFactory makes an AudioContext (or a fake in tests)
 * @param {{ play(ctx: any, out: any, urgent: boolean): void }} [tickStyle] defaults to tick-tock (Roy's choice)
 * @returns {Sound}
 */
export function createSound(audioContextFactory, tickStyle = TICK_TOCK) {
  /** @type {any} */ let ctx = null;
  /** @type {any} */ let master = null;
  /** @type {SoundLevel} */ let level = "normal";
  /** @type {any} */ let noise = null;

  /** @returns {any} the context, or null when sound must stay silent */
  const ready = () => (ctx && master && level !== "off" ? ctx : null);

  return {
    unlock() {
      if (!ctx) {
        try {
          ctx = audioContextFactory();
          master = ctx.createGain();
          master.gain.value = LEVEL_GAIN[level];
          master.connect(ctx.destination);
        } catch {
          ctx = null;
          master = null;
          return;
        }
      }
      if (ctx.state !== "running") ctx.resume?.();
    },
    tick(urgent) {
      const c = ready();
      if (!c) return;
      tickStyle.play(c, master, urgent);
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
      gain.connect(master);
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
      bg.connect(master);
      boom.start(t);
      boom.stop(t + 0.6);
    },
    setLevel(l) {
      level = isLevel(l) ? l : "normal";
      if (master) master.gain.value = LEVEL_GAIN[level];
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
