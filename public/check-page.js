// DOM wiring for the connection test page. All logic lives in check-client.js.
import { runQuickChecks, startLongTest, verdict, formatReport } from "./check-client.js";

const LONG_TEST_MS = 50 * 60_000;

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const deps = {
  fetch: (/** @type {string} */ url, /** @type {any} */ init) => fetch(url, init),
  WebSocket: WebSocket,
  baseUrl: location.origin,
  now: () => Date.now(),
  setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms),
  clearTimeout: (/** @type {any} */ h) => clearTimeout(h),
};

/** @type {import("./check-client.js").StepResult[]} */
let quick = [];
/** @type {import("./check-client.js").LongSummary | undefined} */
let long;
/** @type {{ stop(): import("./check-client.js").LongSummary } | null} */
let running = null;
/** @type {any} */
let tick = null;
/** @type {any} */
let autoStop = null;

/** @param {number} t */
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** @param {string} line */
function log(line) {
  const el = $("log");
  el.textContent += line + "\n";
  el.scrollTop = el.scrollHeight;
}

function renderVerdict() {
  $("verdict").textContent = verdict(quick, long);
  $("copy").removeAttribute("disabled");
}

async function quickChecks() {
  quick = await runQuickChecks(deps);
  for (const r of quick) {
    const li = $("step-" + r.step);
    /** @type {HTMLElement} */ (li.querySelector(".mark")).textContent = r.ok ? "✅" : "❌";
    /** @type {HTMLElement} */ (li.querySelector(".detail")).textContent = r.detail;
  }
  renderVerdict();
  if (quick.some((r) => r.step === "ws-open" && r.ok)) $("start").removeAttribute("disabled");
}

function startLong() {
  $("start").setAttribute("disabled", "");
  $("stop").removeAttribute("disabled");
  $("log").textContent = "";
  long = undefined;
  const startedAt = Date.now();
  log(`${clock(startedAt)}  Test started`);
  running = startLongTest(deps, (e) => {
    if (e.kind === "connected") log(`${clock(e.t)}  Connected (server ${String(e.instanceId).slice(0, 8)})`);
    else if (e.kind === "disconnected") log(`${clock(e.t)}  Connection dropped (code ${e.code}), reconnecting…`);
    else if (e.kind === "gap") log(`${clock(e.t)}  No data from ${clock(/** @type {number} */ (e.from))} to ${clock(e.t)} (laptop asleep or tab paused)`);
  });
  tick = setInterval(() => {
    const ms = Date.now() - startedAt;
    const m = Math.floor(ms / 60_000), s = Math.floor((ms % 60_000) / 1000);
    $("timer").textContent = `${m}:${String(s).padStart(2, "0")} of 50:00`;
  }, 1000);
  autoStop = setTimeout(stopLong, LONG_TEST_MS);
  $("verdict").textContent = "Lesson-length test running… Leave this tab open.";
}

function stopLong() {
  if (!running) return;
  long = running.stop();
  running = null;
  clearInterval(tick);
  clearTimeout(autoStop);
  log(`${clock(Date.now())}  Test finished`);
  $("stop").setAttribute("disabled", "");
  $("start").removeAttribute("disabled");
  $("start").textContent = "Run lesson-length test again";
  renderVerdict();
}

async function copyResults() {
  const text = formatReport(quick, long, navigator.userAgent, new Date().toISOString());
  const area = /** @type {HTMLTextAreaElement} */ ($("report"));
  area.value = text;
  try {
    await navigator.clipboard.writeText(text);
    $("copied").textContent = "Copied! Paste it into the chat with Claude.";
  } catch {
    area.style.display = "block";
    area.focus();
    area.select();
    $("copied").textContent = "Press Ctrl+C (or ⌘C) to copy the selected text.";
  }
}

$("start").addEventListener("click", startLong);
$("stop").addEventListener("click", stopLong);
$("copy").addEventListener("click", copyResults);
window.addEventListener("beforeunload", (e) => { if (running) e.preventDefault(); });
quickChecks();
