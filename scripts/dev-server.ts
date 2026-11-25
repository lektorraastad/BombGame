// Local server for development and the end-to-end tests: serves public/ and runs the game hub
// over a minimal WebSocket (RFC 6455) of its own, since no npm packages can be installed here.
// Text frames only: no binary frames, no extensions. `npm run dev` starts it on port 8888.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Hub } from "../src/server/hub.ts";
import { health, wordsErrorKind } from "../src/server/health.ts";
import { loadWordsFromDir } from "../src/server/words-from-disk.ts";
import type { EngineDeps } from "../src/engine/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = resolve(ROOT, "public");
const WORDS_DIR = join(ROOT, "data", "generated");
const PAGES: Record<string, string> = { "/host": "/host.html", "/control": "/control.html" };
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// ---- WebSocket framing ----

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Bigger client messages close the socket with 1009; the hub ignores anything over 2,000 bytes anyway. */
const MAX_MESSAGE_BYTES = 1 << 20;
const CLOSE_WAIT_MS = 2000;
const OP = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

/** An unmasked, unfragmented server frame. */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let head: Buffer;
  if (len < 126) {
    head = Buffer.from([0, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

function closePayload(code: number, reason = ""): Buffer {
  const r = Buffer.from(reason, "utf8").subarray(0, 123);
  const p = Buffer.alloc(2 + r.length);
  p.writeUInt16BE(code, 0);
  r.copy(p, 2);
  return p;
}

/** Codes a peer may send in a close frame (RFC 6455 section 7.4). */
const validCloseCode = (c: number) => (c >= 1000 && c <= 1003) || (c >= 1007 && c <= 1014) || (c >= 3000 && c <= 4999);

class WsConnection {
  private state: "open" | "closing" | "closed" = "open";
  private buf: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] | null = null;
  private fragmentBytes = 0;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  constructor(
    private readonly socket: Duplex,
    private readonly onText: (text: string) => void,
    onClosed: () => void,
  ) {
    socket.on("data", (d: Buffer) => this.push(d));
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      this.state = "closed";
      if (this.closeTimer) clearTimeout(this.closeTimer);
      onClosed();
    });
  }

  send(text: string): void {
    if (this.state === "open") this.socket.write(encodeFrame(OP.text, Buffer.from(text, "utf8")));
  }

  /** Starts the closing handshake; the socket ends when the client answers, or after a short wait. */
  close(code: number, reason: string): void {
    if (this.state !== "open") return;
    this.state = "closing";
    this.socket.write(encodeFrame(OP.close, closePayload(code, reason)));
    this.destroySoon();
  }

  /** Destroys the socket if it isn't gone within CLOSE_WAIT_MS, so a peer that never ends its side can't keep it open. */
  private destroySoon(): void {
    if (this.closeTimer) return;
    this.closeTimer = setTimeout(() => this.socket.destroy(), CLOSE_WAIT_MS);
    this.closeTimer.unref();
  }

  /** A method, not a comparison, so TypeScript doesn't narrow the state across frame() calls. */
  private isClosed(): boolean {
    return this.state === "closed";
  }

  /** We are done: half-close now, and destroy shortly after whatever the peer does. */
  private finish(): void {
    this.state = "closed";
    this.socket.end();
    this.destroySoon();
  }

  /** Protocol error: send the close frame and end at once. */
  private fail(code: number): void {
    if (this.state === "closed") return;
    if (this.state === "open") this.socket.write(encodeFrame(OP.close, closePayload(code)));
    this.finish();
  }

  push(data: Buffer): void {
    if (this.isClosed()) return; // anything after the end is dropped, not buffered
    this.buf = this.buf.length ? Buffer.concat([this.buf, data]) : data;
    while (!this.isClosed() && this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      if (b0 & 0x70) return this.fail(1002); // no extensions, so no RSV bits
      if (!(b1 & 0x80)) return this.fail(1002); // client frames must be masked
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) return this.fail(1009);
        len = Number(big);
        off = 10;
      }
      if (len > MAX_MESSAGE_BYTES) return this.fail(1009);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = this.buf[off + 4 + i] ^ mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.frame((b0 & 0x80) !== 0, b0 & 0x0f, payload);
    }
  }

  private frame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode >= 0x8) {
      if (!fin || payload.length > 125) return this.fail(1002);
      if (opcode === OP.close) return this.closeFrame(payload);
      if (opcode === OP.ping) {
        if (this.state === "open") this.socket.write(encodeFrame(OP.pong, payload));
        return;
      }
      if (opcode === OP.pong) return;
      return this.fail(1002);
    }
    if (this.state !== "open") return; // data after our close frame is ignored
    if (opcode === OP.binary) return this.fail(1003);
    if (opcode === OP.text) {
      if (this.fragments) return this.fail(1002);
      if (fin) return this.deliver(payload);
      this.fragments = [payload];
      this.fragmentBytes = payload.length;
      return;
    }
    if (opcode === OP.continuation) {
      if (!this.fragments) return this.fail(1002);
      this.fragments.push(payload);
      this.fragmentBytes += payload.length;
      if (this.fragmentBytes > MAX_MESSAGE_BYTES) return this.fail(1009);
      if (!fin) return;
      const whole = Buffer.concat(this.fragments);
      this.fragments = null;
      return this.deliver(whole);
    }
    this.fail(1002);
  }

  private closeFrame(payload: Buffer): void {
    if (this.state === "closing") {
      // The client answered our close frame.
      return this.finish();
    }
    if (payload.length === 1) return this.fail(1002);
    if (payload.length >= 2 && !validCloseCode(payload.readUInt16BE(0))) return this.fail(1002);
    // Echo the client's code and reason (an empty close frame gets an empty answer).
    this.socket.write(encodeFrame(OP.close, payload));
    this.finish();
  }

  private deliver(payload: Buffer): void {
    let text: string;
    try {
      text = this.decoder.decode(payload);
    } catch {
      return this.fail(1007);
    }
    this.onText(text);
  }

  destroy(): void {
    this.socket.destroy();
  }
}

// ---- the server ----

function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const notFound = () => {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }
  let rel: string;
  try {
    rel = decodeURIComponent(PAGES[pathname] ?? pathname);
  } catch {
    return notFound();
  }
  let file = resolve(PUBLIC, "." + rel);
  if (rel.includes("\0") || (file !== PUBLIC && !file.startsWith(PUBLIC + sep))) return notFound();
  try {
    if ((await stat(file)).isDirectory()) {
      if (!pathname.endsWith("/")) {
        res.writeHead(301, { location: pathname + "/" });
        res.end();
        return;
      }
      file = join(file, "index.html");
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    notFound();
  }
}

export function startDevServer(
  port: number,
  log: (event: string, n?: number) => void = () => {},
): Promise<{ url: string; close(): Promise<void> }> {
  const startedAt = Date.now();
  let words: ReturnType<typeof loadWordsFromDir> | null = null;
  let wordsError = "unknown";
  try {
    words = loadWordsFromDir(WORDS_DIR);
  } catch (e) {
    wordsError = wordsErrorKind(e);
    log(`words-not-loaded:${wordsError}`);
  }

  // Production timers, tracked so close() can clear them (otherwise a room's idle timer keeps Node alive).
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const deps: EngineDeps = {
    now: Date.now,
    setTimeout: (fn, ms) => {
      const h = setTimeout(() => {
        timers.delete(h);
        fn();
      }, ms);
      timers.add(h);
      return h;
    },
    clearTimeout: (h) => {
      timers.delete(h as ReturnType<typeof setTimeout>);
      clearTimeout(h as ReturnType<typeof setTimeout>);
    },
    random: Math.random,
  };
  const hub = words ? new Hub({ deps, words, passcode: process.env.HOST_PASSCODE ?? "test", log }) : null;
  const sockets = new Set<WsConnection>();

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/api/health") {
      const h = health(words?.summary.counts ?? null, hub?.roomCount() ?? 0, startedAt, wordsError);
      return sendJson(res, h.status, h.body);
    }
    if (pathname === "/api/ws") {
      res.writeHead(426, { "content-type": "text/plain; charset=utf-8" });
      res.end("Expected a WebSocket");
      return;
    }
    if (pathname.startsWith("/api/")) return sendJson(res, 404, { ok: false, error: "not-found" });
    serveStatic(req, res, pathname).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== "/api/ws") return refuse(socket, 404, "Not Found");
    const key = req.headers["sec-websocket-key"];
    if (
      req.method !== "GET" ||
      req.headers.upgrade?.toLowerCase() !== "websocket" ||
      req.headers["sec-websocket-version"] !== "13" ||
      typeof key !== "string" ||
      Buffer.from(key, "base64").length !== 16
    ) {
      return refuse(socket, 400, "Bad Request");
    }
    if (!hub) return refuse(socket, 503, "Service Unavailable");

    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let handle: { message(text: string): void; closed(): void } | null = null;
    const ws = new WsConnection(
      socket,
      (text) => handle?.message(text),
      () => {
        sockets.delete(ws);
        handle?.closed();
      },
    );
    sockets.add(ws);
    handle = hub.connect({ send: (text) => ws.send(text), close: (code, reason) => ws.close(code, reason) });
    if (head.length) ws.push(head);
  });

  return new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolveStart({
        url: `http://127.0.0.1:${actual}`,
        close: () =>
          new Promise<void>((done) => {
            for (const ws of sockets) {
              ws.close(1001, "Server closing");
              ws.destroy();
            }
            for (const h of timers) clearTimeout(h);
            timers.clear();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8888);
  startDevServer(port, (event, n) => console.log(n === undefined ? `hub: ${event}` : `hub: ${event} ${n}`)).then(
    ({ url }) => console.log(`Bomb game dev server: ${url} (host passcode: HOST_PASSCODE or "test")`),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
