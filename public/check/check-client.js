// Connection test logic. No DOM access here: every timer, the clock,
// fetch and WebSocket are passed in, so this file can be unit-tested.

export const TIMEOUT_MS = 10_000;
export const PING_COUNT = 10;
export const PING_GAP_MS = 200;
export const RECONNECT_MS = 1_000;
export const WATCHDOG_MS = 5_000;
/** Longer than browser background-tab throttling (timers delayed up to ~60 s). */
export const GAP_MS = 90_000;
/** A disconnect this soon after waking from sleep is blamed on the sleep. */
export const AFTER_GAP_GRACE_MS = 30_000;
export const HEARTBEAT_MS = 20_000; // matches netlify/server/check-server.ts
export const SLOW_RECONNECT_MS = 5_000;
/** No message for this long means the socket is dead even if it never closed. */
export const STALE_MS = 50_000;

/**
 * @typedef {{ fetch: (url: string, init?: any) => Promise<Response>,
 *   WebSocket: new (url: string) => any, baseUrl: string, now: () => number,
 *   setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (h: any) => void }} Deps
 * @typedef {{ step: "http" | "ws-open" | "round-trip", ok: boolean, ms?: number, detail: string }} StepResult
 * @typedef {{ t: number, kind: "connected" | "disconnected" | "heartbeat" | "gap",
 *   instanceId?: string, startedAt?: number, code?: number, from?: number }} LongEvent
 * @typedef {{ minutes: number, disconnects: number, longestOutageMs: number,
 *   instanceIds: string[], sameInstance: boolean, gaps: number, restarts: number,
 *   endedDisconnected: boolean, neverConnected: boolean }} LongSummary
 */

/** @param {string} baseUrl */
export function wsUrl(baseUrl) {
  return baseUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/api/check/ws";
}

/**
 * Resolves with the promise's value, or rejects with Error(label) after ms.
 * @template T
 * @param {Deps} deps @param {Promise<T>} promise @param {number} ms @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(deps, promise, ms, label) {
  return new Promise((resolve, reject) => {
    const h = deps.setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => { deps.clearTimeout(h); resolve(v); },
      (e) => { deps.clearTimeout(h); reject(e); },
    );
  });
}

/** @param {number[]} xs */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** @param {unknown} e */
function why(e) {
  return e instanceof Error ? e.message : String(e);
}

/** @param {Deps} deps @returns {Promise<StepResult>} */
async function checkHttp(deps) {
  const t0 = deps.now();
  try {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const { res, body } = await withTimeout(
      deps,
      (async () => {
        const res = await deps.fetch(deps.baseUrl.replace(/\/$/, "") + "/api/check/ping", { cache: "no-store", signal: ctrl?.signal });
        const body = await res.json().catch(() => null);
        return { res, body };
      })(),
      TIMEOUT_MS,
      "no answer within 10 seconds",
    ).catch((e) => { ctrl?.abort(); throw e; });
    if (!res.ok || !body || body.ok !== true) {
      return { step: "http", ok: false, detail: `Server didn't answer properly (status ${res.status}).` };
    }
    const ms = deps.now() - t0;
    return { step: "http", ok: true, ms, detail: `Server answered in ${ms} ms.` };
  } catch (e) {
    return { step: "http", ok: false, detail: `Server didn't answer (${why(e)}).` };
  }
}

/**
 * Opens a socket and waits for the server's hello.
 * @param {Deps} deps @returns {Promise<{ socket: any, instanceId: string }>}
 */
function openSocket(deps) {
  return new Promise((resolve, reject) => {
    let socket;
    try {
      socket = new deps.WebSocket(wsUrl(deps.baseUrl));
    } catch (e) {
      reject(e);
      return;
    }
    const s = socket;
    const h = deps.setTimeout(() => {
      cleanup();
      try { s.close(1000); } catch { /* ignore */ }
      reject(new Error("no answer within 10 seconds"));
    }, TIMEOUT_MS);
    /** @param {any} ev */
    const onMessage = (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m && m.type === "hello") { cleanup(); resolve({ socket: s, instanceId: String(m.instanceId) }); }
    };
    /** @param {any} ev */
    const onClose = (ev) => { cleanup(); reject(new Error(`closed with code ${ev && ev.code}`)); };
    const cleanup = () => {
      deps.clearTimeout(h);
      s.removeEventListener("message", onMessage);
      s.removeEventListener("close", onClose);
    };
    s.addEventListener("message", onMessage);
    s.addEventListener("close", onClose);
  });
}

/**
 * Sends PING_COUNT pings PING_GAP_MS apart and measures round trips.
 * @param {Deps} deps @param {any} socket @returns {Promise<StepResult>}
 */
function checkRoundTrip(deps, socket) {
  return new Promise((resolve) => {
    /** @type {Map<number, number>} */
    const sentAt = new Map();
    /** @type {number[]} */
    const rtts = [];
    /** @type {any[]} */
    const timers = [];
    let done = false;
    /** @param {StepResult} r */
    const finish = (r) => {
      if (done) return;
      done = true;
      timers.forEach((t) => deps.clearTimeout(t));
      socket.removeEventListener("message", onMessage);
      resolve(r);
    };
    /** @param {any} ev */
    const onMessage = (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m && m.type === "pong" && sentAt.has(m.id)) {
        rtts.push(deps.now() - /** @type {number} */ (sentAt.get(m.id)));
        sentAt.delete(m.id);
        if (rtts.length === PING_COUNT) {
          const ms = median(rtts);
          finish({ step: "round-trip", ok: true, ms, detail: `${PING_COUNT}/${PING_COUNT} replies, typical delay ${ms} ms.` });
        }
      }
    };
    socket.addEventListener("message", onMessage);
    for (let i = 0; i < PING_COUNT; i++) {
      timers.push(deps.setTimeout(() => {
        sentAt.set(i, deps.now());
        try { socket.send(JSON.stringify({ type: "ping", id: i })); } catch { /* counted as missing */ }
      }, i * PING_GAP_MS));
    }
    timers.push(deps.setTimeout(() => {
      finish({ step: "round-trip", ok: false, detail: `Only ${rtts.length}/${PING_COUNT} replies within 10 seconds.` });
    }, TIMEOUT_MS));
  });
}

/** @param {Deps} deps @returns {Promise<StepResult[]>} */
export async function runQuickChecks(deps) {
  const http = await checkHttp(deps);
  const t0 = deps.now();
  /** @type {StepResult} */
  let open;
  /** @type {StepResult} */
  let rt;
  try {
    const { socket } = await openSocket(deps);
    const ms = deps.now() - t0;
    open = { step: "ws-open", ok: true, ms, detail: `Live connection opened in ${ms} ms.` };
    rt = await checkRoundTrip(deps, socket);
    try { socket.close(1000); } catch { /* ignore */ }
  } catch (e) {
    open = { step: "ws-open", ok: false, detail: `Live connection didn't open (${why(e)}).` };
    rt = { step: "round-trip", ok: false, detail: "skipped, live connection didn't open." };
  }
  return [http, open, rt];
}

/**
 * Keeps a live connection open, reconnecting whenever it drops, and logs events.
 * @param {Deps} deps @param {(e: LongEvent) => void} onEvent
 * @returns {{ stop(): LongSummary }}
 */
export function startLongTest(deps, onEvent) {
  /** @type {LongEvent[]} */
  const events = [];
  let stopped = false;
  /** @type {any} */
  let socket = null;
  /** @type {any} */
  let reconnectTimer = null;
  /** @type {any} */
  let watchdogTimer = null;
  let lastTick = deps.now();
  let lastMessageAt = deps.now();
  const startedAt = deps.now();

  /** @param {LongEvent} e */
  const emit = (e) => { events.push(e); onEvent(e); };

  /** @param {number} ms */
  const scheduleReconnect = (ms) => {
    if (stopped || reconnectTimer !== null) return;
    reconnectTimer = deps.setTimeout(() => { reconnectTimer = null; connect(); }, ms);
  };

  const connect = () => {
    if (stopped) return;
    let connected = false;
    let s;
    try {
      s = new deps.WebSocket(wsUrl(deps.baseUrl));
    } catch {
      scheduleReconnect(RECONNECT_MS);
      return;
    }
    socket = s;
    lastMessageAt = deps.now();
    const openTimer = deps.setTimeout(() => {
      if (!connected && socket === s) {
        try { s.close(4000); } catch { /* ignore */ }
      }
    }, TIMEOUT_MS);
    s.addEventListener("message", (/** @type {any} */ ev) => {
      if (socket === s) lastMessageAt = deps.now();
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (!m) return;
      if (m.type === "hello") {
        connected = true;
        deps.clearTimeout(openTimer);
        emit({ t: deps.now(), kind: "connected", instanceId: String(m.instanceId),
          startedAt: typeof m.startedAt === "number" ? m.startedAt : undefined });
      } else if (m.type === "heartbeat") {
        emit({ t: deps.now(), kind: "heartbeat", instanceId: String(m.instanceId) });
      }
    });
    s.addEventListener("close", (/** @type {any} */ ev) => {
      deps.clearTimeout(openTimer);
      if (stopped || socket !== s) return;
      socket = null;
      const code = ev && typeof ev.code === "number" ? ev.code : 1006;
      if (connected) emit({ t: deps.now(), kind: "disconnected", code });
      scheduleReconnect(code === 1012 ? 0 : RECONNECT_MS);
    });
  };

  const watchdog = () => {
    const t = deps.now();
    if (t - lastTick > GAP_MS) emit({ t, kind: "gap", from: lastTick });
    lastTick = t;
    // A socket can die without ever firing "close" (Wi-Fi roam, laptop wake).
    if (socket && t - lastMessageAt > STALE_MS) {
      const dead = socket;
      socket = null;
      emit({ t, kind: "disconnected", code: 4001 });
      scheduleReconnect(0);
      try { dead.close(4001); } catch { /* ignore */ }
    }
    if (!stopped) watchdogTimer = deps.setTimeout(watchdog, WATCHDOG_MS);
  };

  connect();
  watchdogTimer = deps.setTimeout(watchdog, WATCHDOG_MS);

  return {
    stop() {
      // Check for a gap one last time, so a sleep right before Stop is counted.
      if (!stopped) {
        const t = deps.now();
        if (t - lastTick > GAP_MS) emit({ t, kind: "gap", from: lastTick });
      }
      stopped = true;
      if (reconnectTimer !== null) deps.clearTimeout(reconnectTimer);
      if (watchdogTimer !== null) deps.clearTimeout(watchdogTimer);
      if (socket) { try { socket.close(1000); } catch { /* ignore */ } }
      socket = null;
      return summarizeLong(events, startedAt, deps.now());
    },
  };
}

/**
 * @param {LongEvent[]} events
 * @param {number} [start] when the test started (defaults to first event)
 * @param {number} [end] when it stopped (defaults to last event)
 * @returns {LongSummary}
 */
export function summarizeLong(events, start, end) {
  const t0 = start ?? (events[0] ? events[0].t : 0);
  const t1 = end ?? (events.length ? events[events.length - 1].t : t0);
  const gaps = events.filter((e) => e.kind === "gap" && e.t - /** @type {number} */ (e.from) >= GAP_MS);
  /** @param {number} t */
  const causedBySleep = (t) =>
    gaps.some((g) => t >= /** @type {number} */ (g.from) && t <= g.t + AFTER_GAP_GRACE_MS);

  /** @type {string[]} */
  const instanceIds = [];
  /** @type {string[]} */
  const unexplained = [];
  let restarts = 0;
  /** @type {string | null} */
  let current = null;
  /** @type {number | null} */
  let lastDropAt = null;
  let disconnects = 0;
  let longestOutageMs = 0;
  /** @type {number | null} */
  let downSince = null;
  for (const e of events) {
    if (e.kind === "connected") {
      const id = e.instanceId ?? "";
      if (id && !instanceIds.includes(id)) instanceIds.push(id);
      if (current === null) {
        unexplained.push(id);
      } else if (id !== current) {
        // A new instance that started after the drop is a restart of the server;
        // one that was already running means a second server exists.
        if (e.startedAt !== undefined && lastDropAt !== null && e.startedAt >= lastDropAt - 5_000) restarts++;
        else if (!unexplained.includes(id)) unexplained.push(id);
      }
      current = id;
      if (downSince !== null) {
        longestOutageMs = Math.max(longestOutageMs, e.t - downSince);
        downSince = null;
      }
    } else if (e.kind === "disconnected") {
      lastDropAt = e.t;
      if (causedBySleep(e.t)) continue;
      disconnects++;
      downSince = e.t;
    }
  }
  const endedDisconnected = downSince !== null;
  if (downSince !== null) longestOutageMs = Math.max(longestOutageMs, t1 - downSince);
  return {
    minutes: Math.round(((t1 - t0) / 60_000) * 10) / 10,
    disconnects,
    longestOutageMs,
    instanceIds,
    sameInstance: unexplained.length <= 1,
    gaps: gaps.length,
    restarts,
    endedDisconnected,
    neverConnected: instanceIds.length === 0,
  };
}

/**
 * Plain-English result for Roy.
 * @param {StepResult[]} quick @param {LongSummary} [long] @returns {string}
 */
export function verdict(quick, long) {
  const ok = (/** @type {string} */ step) => quick.some((r) => r.step === step && r.ok);
  const http = ok("http");
  const ws = ok("ws-open");
  const rt = ok("round-trip");

  if (!http && !ws) {
    return "❌ The page loads, but the game server can't be reached from this network. Ask IT to allow this site, or we try the fallback host.";
  }
  if (!ws) {
    return "❌ The page and server work, but live connections are blocked on this network. Ask IT to allow WebSockets for this site, or we try the fallback host.";
  }
  if (!rt) {
    return "⚠️ Live connections open, but messages don't get through reliably. Copy the results and paste them to Claude.";
  }
  /** @type {string[]} */
  const lines = [];
  if (!http) lines.push("⚠️ Live connections work, but the plain server check failed. Copy the results and paste them to Claude.");
  if (!long) {
    lines.push("Quick checks done. Run the lesson-length test before deciding.");
    return lines.join("\n");
  }
  if (long.neverConnected) {
    lines.push("❌ The lesson-length test never managed to connect. Copy the results and paste them to Claude.");
  } else if (long.endedDisconnected) {
    lines.push("❌ The live connection dropped and didn't come back before the test ended. Copy the results and paste them to Claude.");
  } else if (!long.sameInstance) {
    lines.push("⚠️ The connection reconnected to a different server. Tell Claude: the game needs a change before it can use this host.");
  } else if (long.longestOutageMs >= SLOW_RECONNECT_MS) {
    lines.push(`⚠️ Live connections work, but reconnecting once took ${Math.round(long.longestOutageMs / 1000)} seconds. Copy the results and paste them to Claude.`);
  } else if (http && long.restarts === 0) {
    lines.push("✅ Everything works. The game can run on this network.");
  }
  if (long.restarts > 0 && !long.neverConnected) {
    lines.push("⚠️ The server restarted during the test. If you didn't update the site during the test, tell Claude.");
  }
  if (long.minutes < 35) {
    lines.push(`Note: the lesson-length test only ran for ${long.minutes} min. A full lesson needs at least 35 min to be sure.`);
  }
  return lines.join("\n");
}

/**
 * Copyable text block for pasting into chat.
 * @param {StepResult[]} quick @param {LongSummary | undefined} long
 * @param {string} userAgent @param {string} nowIso @returns {string}
 */
export function formatReport(quick, long, userAgent, nowIso) {
  const lines = ["Bomb game connection test", `Time: ${nowIso}`, `Browser: ${userAgent}`, ""];
  for (const r of quick) lines.push(`${r.ok ? "OK  " : "FAIL"} ${r.step}: ${r.detail}`);
  lines.push("");
  if (long) {
    lines.push(
      `Lesson-length test: ${long.minutes} min, ${long.disconnects} reconnect(s), longest pause ${Math.round(long.longestOutageMs / 100) / 10} s, ` +
        `server(s): ${long.instanceIds.length} (${long.sameInstance ? "same server throughout" : "CHANGED"}), restarts: ${long.restarts}, ` +
        `sleep gaps: ${long.gaps}${long.neverConnected ? ", NEVER CONNECTED" : long.endedDisconnected ? ", ENDED DISCONNECTED" : ""}`,
    );
  } else {
    lines.push("Lesson-length test: not run");
  }
  lines.push("", verdict(quick, long));
  return lines.join("\n");
}
