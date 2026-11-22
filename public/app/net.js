// The game socket, with automatic reconnecting. No DOM access: the WebSocket constructor and the
// timers are passed in, so tests can drive it with fakes.

/** Delay before each reconnect try after the first: 1 s, 2 s, then 5 s at most. */
export const BACKOFF_MS = [1000, 2000, 5000];
export const CLOSE_RESTART = 1012;
export const CLOSE_KICKED = 4003;
export const CLOSE_ENDED = 4004;

/**
 * @typedef {"connecting" | "open" | "reconnecting" | "ended" | "kicked"} Status
 * @typedef {{ WebSocket: new (url: string) => any, url: string,
 *   setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (h: any) => void }} NetDeps
 */

/**
 * @param {NetDeps} deps
 * @param {(msg: any) => void} onMessage
 * @param {(status: Status) => void} onStatus
 * @returns {{ send(msg: object): boolean, setHello(msg: object | null): void, close(): void }}
 */
export function createConnection(deps, onMessage, onStatus) {
  /** @type {any} */ let ws = null;
  /** @type {any} */ let timer = null;
  /** @type {object | null} */ let hello = null;
  let failures = 0;
  let stopped = false;

  /** @param {Status} s */
  function status(s) {
    onStatus(s);
  }

  /** @param {Status} final */
  function stop(final) {
    stopped = true;
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
    status(final);
  }

  function connect() {
    timer = null;
    const sock = new deps.WebSocket(deps.url);
    ws = sock;
    sock.addEventListener("open", () => {
      if (ws !== sock || stopped) return;
      failures = 0;
      if (hello) sock.send(JSON.stringify(hello));
      status("open");
    });
    sock.addEventListener("message", (/** @type {{ data: unknown }} */ ev) => {
      if (ws !== sock || stopped) return;
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg && msg.t === "kicked") stop("kicked");
      onMessage(msg);
    });
    sock.addEventListener("close", (/** @type {{ code?: number }} */ ev) => {
      if (ws !== sock || stopped) return;
      ws = null;
      if (ev.code === CLOSE_KICKED) return stop("kicked");
      if (ev.code === CLOSE_ENDED) return stop("ended");
      status("reconnecting");
      const delay = ev.code === CLOSE_RESTART ? 0 : BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
      if (ev.code !== CLOSE_RESTART) failures++;
      timer = deps.setTimeout(connect, delay);
    });
  }

  status("connecting");
  connect();

  return {
    /** Dropped (returns false) when the socket isn't open. */
    send(msg) {
      if (!ws || ws.readyState !== 1) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    /** The message (join, host or control) re-sent on every open. */
    setHello(msg) {
      hello = msg;
    },
    close() {
      stopped = true;
      if (timer !== null) deps.clearTimeout(timer);
      timer = null;
      const sock = ws;
      ws = null;
      if (sock) sock.close(1000);
    },
  };
}
