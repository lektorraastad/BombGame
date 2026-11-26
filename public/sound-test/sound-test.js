// Throwaway: plays each tick style so Roy can choose one by ear. No game logic and no network.
import { TICK_STYLES } from "/app/tick-styles.js";
import { createSound } from "/app/sound.js";

/** @type {Record<string, string>} */
const NOTES = {
  "soft-clock": "A short, low wooden “tock”. Quiet.",
  "tick-tock": "Two close pitches in turn, like a wall clock.",
  muffled: "A filtered click: the most mechanical one.",
  heartbeat: "A low double thump. The tensest; it may suit the hidden fuse.",
  "beep-soft": "Today’s beep, quieter, for comparison.",
};

/** @type {AudioContext | null} */ let ctx = null;
/** @type {GainNode | null} */ let out = null;
const sound = createSound(() => audio());
/** @type {number[]} */ let timers = [];

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    out = ctx.createGain();
    out.gain.value = 1;
    out.connect(ctx.destination);
  }
  if (ctx.state !== "running") ctx.resume();
  return ctx;
}

const status = /** @type {HTMLElement} */ (document.getElementById("status"));
const list = /** @type {HTMLElement} */ (document.getElementById("styles"));

function stop() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  for (const b of document.querySelectorAll("button[aria-pressed]")) b.setAttribute("aria-pressed", "false");
  status.textContent = "Stopped.";
}

/**
 * @param {string} id @param {string} what
 * @param {{ at: number, urgent?: boolean, bang?: boolean }[]} plan
 * @param {HTMLButtonElement} button
 */
function run(id, what, plan, button) {
  stop();
  audio();
  sound.unlock();
  button.setAttribute("aria-pressed", "true");
  status.textContent = `Playing: ${TICK_STYLES[id].label}, ${what}`;
  const style = TICK_STYLES[id];
  for (const step of plan) {
    timers.push(window.setTimeout(() => {
      if (step.bang) sound.explode();
      else if (ctx && out) style.play(ctx, out, step.urgent === true);
    }, step.at));
  }
  const last = Math.max(...plan.map((s) => s.at)) + (plan.some((s) => s.bang) ? 1300 : 400);
  timers.push(window.setTimeout(() => {
    button.setAttribute("aria-pressed", "false");
    status.textContent = "Done. Click another to compare.";
  }, last));
}

const calm = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ at: from + i * 1000 }));
const urgent = (from = 0) => Array.from({ length: 12 }, (_, i) => ({ at: from + i * 250, urgent: true }));
const PLANS = {
  calm: { label: "Calm", what: "calm (5 ticks)", plan: () => calm(5) },
  urgent: { label: "Urgent", what: "urgent (3 seconds)", plan: () => urgent() },
  bang: { label: "With explosion", what: "10 seconds and the explosion", plan: () => [...calm(7), ...urgent(7000), { at: 10000, bang: true }] },
};

for (const [id, style] of Object.entries(TICK_STYLES)) {
  const section = document.createElement("section");
  section.className = "style";
  const h2 = document.createElement("h2");
  h2.textContent = style.label;
  const p = document.createElement("p");
  p.textContent = NOTES[id] ?? "";
  const row = document.createElement("div");
  row.className = "buttons";
  for (const plan of Object.values(PLANS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = plan.label;
    b.setAttribute("aria-pressed", "false");
    b.dataset.style = id;
    b.addEventListener("click", () => run(id, plan.what, plan.plan(), b));
    row.append(b);
  }
  section.append(h2, p, row);
  list.append(section);
}

document.getElementById("stop")?.addEventListener("click", stop);
