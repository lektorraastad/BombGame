// Load test: 32 bots play Everyone-at-once on the local dev server for 5 rounds, answering with valid
// words after a random 1–8 s delay. Reports the time from each submit to that bot's next view
// (median, 95th percentile, maximum) and any errors. `npm run load-test`. Exits 1 on any error, on any
// refused word, unless exactly BOTS × ROUNDS answers were accepted, or after OVERALL_TIMEOUT_MS.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { startDevServer } from "./dev-server.ts";

const BOTS = 32;
const ROUNDS = 5;
const ROUND_TIME_S = 10; // longer than the slowest bot (8 s), so nobody should lose a life
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 8000;
const OVERALL_TIMEOUT_MS = 120_000;
const PASSCODE = process.env.HOST_PASSCODE || "test";

type Prompt = { text: string; type: "contains" | "starts" | "ends" };
type Msg = { t: string; [k: string]: any };

const KNOWN = readFileSync(new URL("../data/generated/known.txt", import.meta.url), "utf8").split("\n").filter(Boolean);

const fits = (p: Prompt, w: string) =>
  p.type === "contains" ? w.includes(p.text) : p.type === "starts" ? w.startsWith(p.text) : w.endsWith(p.text);

/** A random known word for the prompt that this bot hasn't used yet. */
function pickWord(p: Prompt, used: Set<string>): string | null {
  const options = KNOWN.filter((w) => fits(p, w) && !used.has(w));
  return options.length ? options[Math.floor(Math.random() * options.length)] : null;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

const errors: string[] = [];
const latencies: number[] = [];
let accepted = 0;
let rejected = 0;
/** Why a bot didn't answer a view it might have answered, by reason. */
const skips = new Map<string, number>();
const skip = (reason: string): void => {
  skips.set(reason, (skips.get(reason) ?? 0) + 1);
};
const timers = new Set<ReturnType<typeof setTimeout>>();
/** Set once the bots are done, so the closes that follow aren't counted as errors. */
let stopping = false;

function open(url: string, onMsg: (m: Msg) => void, name: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let done = false;
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error(`${name}: could not connect`)));
    ws.addEventListener("message", (ev) => onMsg(JSON.parse(String(ev.data))));
    ws.addEventListener("close", (ev) => {
      if (!done && !stopping) errors.push(`${name}: socket closed (${ev.code})`);
      done = true;
    });
  });
}

/** Resolves with the first message the predicate accepts. */
function waitFor(list: Msg[], pred: (m: Msg) => boolean, ms = 5000): Promise<Msg> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const poll = () => {
      const m = list.find(pred);
      if (m) return resolve(m);
      if (Date.now() > deadline) return reject(new Error("timed out waiting for a message"));
      setTimeout(poll, 10);
    };
    poll();
  });
}

class Bot {
  ws!: WebSocket;
  readonly msgs: Msg[] = [];
  private readonly used = new Set<string>();
  private answeredKey = "";
  /** When this bot's word was sent; cleared when it's refused or once its view is measured. */
  private sentAt: number | null = null;
  /** The server accepted the word: the next view showing it applied is measured. */
  private awaitingView = false;
  livesLost = 0;
  private lastLives: number | null = null;

  constructor(readonly name: string) {}

  async connect(url: string, code: string): Promise<void> {
    this.ws = await open(url, (m) => this.onMessage(m), this.name);
    this.ws.send(JSON.stringify({ t: "join", code, token: crypto.randomUUID(), nickname: this.name }));
    await waitFor(this.msgs, (m) => m.t === "welcome" || m.t === "error");
    const err = this.msgs.find((m) => m.t === "error");
    if (err) throw new Error(`${this.name} could not join: ${err.reason}`);
  }

  private onMessage(m: Msg): void {
    if (m.t !== "view") this.msgs.push(m);
    if (m.t === "error") errors.push(`${this.name}: error ${m.reason}`);
    if (m.t === "result") {
      if (m.ok) {
        accepted++;
        this.awaitingView = this.sentAt !== null;
      } else {
        rejected++;
        errors.push(`${this.name}: word refused (${m.reason})`);
        this.sentAt = null;
      }
    }
    if (m.t !== "view") return;

    const v = m.view;
    // The result comes before the broadcast, so the first view after an accepted result is the one
    // the word caused; it must show the answer applied (this bot is no longer on).
    if (this.awaitingView && this.sentAt !== null && !v.me.isOn) {
      latencies.push(performance.now() - this.sentAt);
      this.sentAt = null;
      this.awaitingView = false;
    }
    if (this.lastLives !== null && v.me.lives < this.lastLives && v.phase === "playing") this.livesLost++;
    this.lastLives = v.me.lives;

    if (v.phase !== "playing" || stopping) return;
    if (!v.prompt) return skip("no prompt");
    const round = Number(v.mode?.round);
    if (!Number.isFinite(round)) return skip("no round number");
    if (round > ROUNDS) return; // the round after the last one starts just before the host ends the game
    if (round < 1) return skip("round below 1");
    const key = `${round}:${v.prompt.type}:${v.prompt.text}`;
    if (key === this.answeredKey) return;
    if (!v.me.isOn) return skip("not on for a new prompt");
    this.answeredKey = key;

    const prompt: Prompt = v.prompt;
    const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    const h = setTimeout(() => {
      timers.delete(h);
      if (stopping) return;
      const word = pickWord(prompt, this.used);
      if (!word) {
        skip("no known word");
        return void errors.push(`${this.name}: no known word for ${prompt.type} ${prompt.text}`);
      }
      this.used.add(word);
      this.sentAt = performance.now();
      this.ws.send(JSON.stringify({ t: "submit", word }));
    }, delay);
    timers.add(h);
  }
}

async function main(): Promise<void> {
  const server = await startDevServer(0);
  const url = server.url.replace(/^http/, "ws") + "/api/ws";
  const started = performance.now();
  try {
    // The host: creates the room, changes settings, starts and ends the game.
    const hostMsgs: Msg[] = [];
    let round = 0;
    let finished!: () => void;
    const fiveRounds = new Promise<void>((r) => (finished = r));
    const host = await open(
      url,
      (m) => {
        if (m.t !== "view") hostMsgs.push(m);
        else {
          const r = Number(m.view.mode?.round ?? 0);
          if (m.view.phase === "playing" && r > round) {
            round = r;
            console.log(`round ${r}`);
          }
          if (m.view.phase === "results" || r > ROUNDS) finished();
        }
      },
      "host",
    );
    host.send(JSON.stringify({ t: "create", passcode: PASSCODE, token: crypto.randomUUID() }));
    const welcome = await waitFor(hostMsgs, (m) => m.t === "welcome" || m.t === "error");
    if (welcome.t !== "welcome") throw new Error(`could not create a room: ${welcome.reason}`);
    const code: string = welcome.code;

    const bots = Array.from({ length: BOTS }, (_, i) => new Bot(`Bot ${String(i + 1).padStart(2, "0")}`));
    await Promise.all(bots.map((b) => b.connect(url, code)));
    console.log(`${BOTS} bots joined room ${code}`);

    const cmd = (msg: object) => {
      hostMsgs.length = 0;
      host.send(JSON.stringify({ t: "cmd", ...msg }));
      return waitFor(hostMsgs, (m) => m.t === "result");
    };
    const set = await cmd({ cmd: "settings", settings: { mode: "everyone", roundTime: ROUND_TIME_S, shrinking: false, startLives: 3 } });
    if (!set.ok) throw new Error(`settings refused: ${set.reason}`);
    const start = await cmd({ cmd: "start" });
    if (!start.ok) throw new Error(`start refused: ${start.reason}`);

    let overall: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      overall = setTimeout(() => reject(new Error(`timed out after ${OVERALL_TIMEOUT_MS / 1000} s`)), OVERALL_TIMEOUT_MS);
    });
    try {
      await Promise.race([fiveRounds, timedOut]);
    } finally {
      clearTimeout(overall);
    }
    stopping = true;
    for (const h of timers) clearTimeout(h);
    await cmd({ cmd: "end" });

    const livesLost = bots.reduce((n, b) => n + b.livesLost, 0);
    if (livesLost > 0) errors.push(`${livesLost} lives lost (a bot's answer did not count in time)`);
    for (const b of bots) b.ws.close(1000);
    host.close(1000);
  } finally {
    stopping = true;
    await server.close();
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const ms = (n: number) => `${n.toFixed(1)} ms`;
  console.log("");
  console.log(`Load test: ${BOTS} bots, Everyone at once, ${ROUNDS} rounds, ${((performance.now() - started) / 1000).toFixed(0)} s`);
  console.log(`Answers accepted: ${accepted} of ${BOTS * ROUNDS} expected, refused: ${rejected}, latencies measured: ${sorted.length}`);
  if (skips.size) console.log(`Skipped answers: ${[...skips].map(([r, n]) => `${r} ${n}`).join(", ")}`);
  console.log(`Submit to next view: median ${ms(percentile(sorted, 0.5))}, 95th percentile ${ms(percentile(sorted, 0.95))}, max ${ms(sorted[sorted.length - 1] ?? NaN)}`);
  console.log(`Errors: ${errors.length}`);
  for (const e of errors.slice(0, 20)) console.log(`  ${e}`);
  if (errors.length > 20) console.log(`  … and ${errors.length - 20} more`);
  const failures = [...errors];
  if (accepted !== BOTS * ROUNDS) failures.push(`accepted ${accepted} answers, expected ${BOTS * ROUNDS}`);
  if (rejected > 0) failures.push(`${rejected} words refused`);
  if (sorted.length === 0) failures.push("no latencies measured");
  if (failures.length > errors.length) for (const f of failures.slice(errors.length)) console.log(`FAIL: ${f}`);
  process.exitCode = failures.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
