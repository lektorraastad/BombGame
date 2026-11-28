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
 * @typedef {{ unlock(): void, tick(urgent: boolean): void, explode(): void, chime(): void, fall(): void,
 *   fanfare(): void, patter(): void, setLevel(l: SoundLevel): void }} Sound
 */

/** The loudest peak of any moment sound: today's tick-tock on Normal (its urgent tick, 0.2). */
const PEAK = 0.18;
const SILENT = 0.0001; // exponential ramps cannot reach 0

/**
 * One enveloped oscillator note into `out`, starting `delay` seconds from now; glides to `to` Hz
 * when given. Stops itself, so nothing is left running.
 * @param {any} ctx @param {any} out
 * @param {{ type: string, from: number, to?: number, gain: number, delay?: number, dur: number }} o
 */
function note(ctx, out, o) {
  const t = ctx.currentTime + (o.delay ?? 0);
  const end = t + o.dur;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, t);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(o.to, end);
  gain.gain.setValueAtTime(SILENT, t);
  gain.gain.exponentialRampToValueAtTime(o.gain, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(SILENT, end);
  osc.connect(gain);
  gain.connect(out);
  osc.start(t);
  osc.stop(end + 0.01);
}

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
    /** A word was accepted: two rising notes. */
    chime() {
      const c = ready();
      if (!c) return;
      note(c, master, { type: "triangle", from: 784, gain: PEAK, dur: 0.16 });
      note(c, master, { type: "triangle", from: 1047, gain: PEAK, delay: 0.09, dur: 0.3 });
    },
    /** A heart was lost: one falling note. */
    fall() {
      const c = ready();
      if (!c) return;
      note(c, master, { type: "sine", from: 560, to: 230, gain: PEAK, dur: 0.45 });
    },
    /** The winner's tune: C, E, G, then a high C. */
    fanfare() {
      const c = ready();
      if (!c) return;
      [523, 659, 784].forEach((f, i) => note(c, master, { type: "triangle", from: f, gain: PEAK, delay: i * 0.11, dur: 0.2 }));
      note(c, master, { type: "triangle", from: 1047, gain: PEAK, delay: 0.33, dur: 0.6 });
    },
    /** A tiny pat for each answer when everyone answers at once. */
    patter() {
      const c = ready();
      if (!c) return;
      note(c, master, { type: "sine", from: 1300, gain: PEAK / 2, dur: 0.03 });
    },
    setLevel(l) {
      level = isLevel(l) ? l : "normal";
      if (master) master.gain.value = LEVEL_GAIN[level];
    },
  };
}


/** The least time between two patters, and how long the falling note waits behind a boom. */
const PATTER_GAP_MS = 160;
const FALL_DELAY_MS = 350;
/** The hidden fuse ticks every 1000 ms, down to 700 ms as the turn's tension rises to 1. */
const HIDDEN_GAP_MS = 1000;
const HIDDEN_GAP_FAST_MS = 700;

/**
 * Decides when to play, on the projector only: explode() for each view whose lastEvent is
 * "explosion"; chime, patter, fall from the view's moments; the winner's fanfare when the page says
 * the held results are showing; and tick() from the countdown loop: once a second, 4 times a second
 * in the last 3 s of a visible timer, and a hidden fuse once a second, quickening to every 700 ms
 * with tension. The first view after a load plays nothing. Ticks are silent outside a running,
 * unpaused game.
 * @param {Sound} sound
 * @param {() => number} now
 */
export function createSoundDriver(sound, now) {
  let running = false;
  let seen = false;
  let fanfared = false;
  /** @type {string | null} */ let lastBucket = null;
  let nextHiddenTick = 0;
  let lastPatter = -Infinity;
  /** @type {number | null} when the pending falling note is due */ let fallAt = null;
  /** @type {string | undefined} */ let lastPhase;

  return {
    /** @param {{ phase?: string, paused?: boolean, lastEvent?: string | null, bombRemainingMs?: number, mode?: any, moments?: any[] }} view a projector view */
    view(view) {
      const was = running;
      running = view.phase === "playing" && view.paused !== true;
      if (running && !was) nextHiddenTick = now() + HIDDEN_GAP_MS;
      if (view.phase === "playing" || view.phase === "lobby") fanfared = false;
      // A new game: a falling note still waiting from the last one's final explosion is dropped.
      if (view.phase === "playing" && lastPhase !== undefined && lastPhase !== "playing") fallAt = null;
      lastPhase = view.phase;
      if (!seen) {
        seen = true;
        return;
      }
      const moments = Array.isArray(view.moments) ? view.moments : [];
      const explosion = view.lastEvent === "explosion";
      if (explosion) {
        sound.explode();
        nextHiddenTick = now() + HIDDEN_GAP_MS;
      }
      const everyone = view.mode && view.mode.round !== undefined && !Array.isArray(view.mode.seats);
      let word = false;
      let hearts = false;
      let all = false;
      for (const m of moments) {
        if (m?.kind === "word") word = true;
        else if (m?.kind === "hearts") hearts = true;
        else if (m?.kind === "all-answered") all = true;
        // "silent" and "ghost" moments are deliberately silent: their sparks have no sound.
      }
      if (word) {
        if (!everyone) sound.chime();
        else if (now() - lastPatter >= PATTER_GAP_MS) {
          lastPatter = now();
          sound.patter();
        }
      }
      if (all) sound.chime();
      if (hearts) {
        if (explosion) fallAt = now() + FALL_DELAY_MS;
        else sound.fall();
      }
    },
    /** The page calls this when held results first appear. The winner's tune, once per game. */
    resultsShown() {
      if (fanfared) return;
      fanfared = true;
      sound.fanfare();
    },
    /**
     * @param {number | null} remainingMs the local countdown, or null for a hidden fuse
     * @param {number} [tension] 0..1, how far a hidden fuse's turn has gone
     */
    step(remainingMs, tension = 0) {
      if (fallAt !== null && now() >= fallAt) {
        fallAt = null;
        sound.fall();
      }
      if (!running) {
        lastBucket = null;
        return;
      }
      if (remainingMs === null) {
        lastBucket = null;
        const t = now();
        if (t >= nextHiddenTick) {
          sound.tick(false);
          const k = Math.min(1, Math.max(0, tension || 0));
          const gap = HIDDEN_GAP_MS - (HIDDEN_GAP_MS - HIDDEN_GAP_FAST_MS) * k;
          nextHiddenTick = Math.max(nextHiddenTick + gap, t + 1);
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
