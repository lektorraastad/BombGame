import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect as tcpConnect, type Socket } from "node:net";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { startDevServer } from "../../scripts/dev-server.ts";
import { health, wordsErrorKind } from "../../src/server/health.ts";

delete process.env.HOST_PASSCODE; // the dev server then uses "test"

let server: { url: string; close(): Promise<void> };
before(async () => {
  server = await startDevServer(0);
});
after(async () => {
  await server.close();
});

const wsBase = () => server.url.replace(/^http/, "ws") + "/api/ws";

type Client = {
  ws: WebSocket;
  msgs: any[];
  send(m: object | string): void;
  next(pred: (m: any) => boolean, ms?: number): Promise<any>;
  closed: Promise<{ code: number; reason: string }>;
};

function open(): Promise<Client> {
  const ws = new WebSocket(wsBase());
  const msgs: any[] = [];
  const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    msgs.push(m);
    for (const w of [...waiters]) {
      if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener("close", (ev) => resolve({ code: ev.code, reason: ev.reason })),
  );
  const client: Client = {
    ws,
    msgs,
    closed,
    send: (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m)),
    next: (pred, ms = 3000) => {
      const seen = msgs.find(pred);
      if (seen) {
        msgs.splice(msgs.indexOf(seen), 1);
        return Promise.resolve(seen);
      }
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no matching message")), ms);
        waiters.push({ pred, resolve: (m) => { clearTimeout(t); msgs.splice(msgs.indexOf(m), 1); resolve(m); } });
      });
    },
  };
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(client));
    ws.addEventListener("error", () => reject(new Error("websocket error")));
  });
}

const isT = (t: string) => (m: any) => m.t === t;

async function hostRoom() {
  const host = await open();
  host.send({ t: "create", passcode: "test", token: "host-tab" });
  const w = await host.next(isT("welcome"));
  return { host, code: w.code as string };
}

// ---- pages ----

test("serves the join page and the check page", async () => {
  const root = await fetch(server.url + "/");
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type") ?? "", /^text\/html/);
  // Students would hammer the passcode, so the join page doesn't link to /host. Roy finds it in the README.
  const joinPage = await root.text();
  assert.doesNotMatch(joinPage, /href="\/host"/);
  assert.doesNotMatch(joinPage, /Host a game/);

  const check = await fetch(server.url + "/check/");
  assert.equal(check.status, 200);
  assert.match(await check.text(), /check-page\.js/);

  const js = await fetch(server.url + "/check/check-client.js");
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type") ?? "", /^text\/javascript/);
  assert.match(await js.text(), /\/api\/check\/ws/);

  const missing = await fetch(server.url + "/nope.html");
  assert.equal(missing.status, 404);
  await missing.text();
  const outside = await fetch(server.url + "/check/%2e%2e%2f%2e%2e%2fpackage.json");
  assert.equal(outside.status, 404);
  await outside.text();
});

// ---- health ----

test("health reports word counts", async () => {
  const res = await fetch(server.url + "/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  const summary = JSON.parse(readFileSync(new URL("../../data/generated/summary.json", import.meta.url), "utf8"));
  assert.equal(body.ok, true);
  assert.deepEqual(body.words, summary.counts);
  assert.equal(typeof body.rooms, "number");
  assert.equal(typeof body.startedAt, "number");
  assert.ok(body.startedAt <= Date.now());
});

test("health without words is a 500 with words-not-loaded and the error kind", () => {
  assert.deepEqual(health(null, 3, 1000, "ENOENT"), { status: 500, body: { ok: false, error: "words-not-loaded", kind: "ENOENT" } });
  assert.deepEqual(health(null, 3, 1000), { status: 500, body: { ok: false, error: "words-not-loaded", kind: "unknown" } });
  const counts = { dictionary: 1, known: 2, beginner: 5, blockedWords: 3, blockedNames: 4 };
  assert.deepEqual(health(counts, 3, 1000), { status: 200, body: { ok: true, words: counts, rooms: 3, startedAt: 1000 } });
});

test("wordsErrorKind names the kind of failure, never a path or file contents", () => {
  const missing = Object.assign(new Error("ENOENT: no such file or directory, open '/var/task/data/generated/known.txt'"), { code: "ENOENT" });
  assert.equal(wordsErrorKind(missing), "ENOENT");
  assert.equal(wordsErrorKind(Object.assign(new Error("denied"), { code: "EACCES" })), "EACCES");
  let parseError: unknown;
  try { JSON.parse("{secret word list"); } catch (e) { parseError = e; }
  assert.equal(wordsErrorKind(parseError), "invalid");
  assert.equal(wordsErrorKind(new Error("block list is empty")), "invalid");
  assert.equal(wordsErrorKind(Object.assign(new Error("x"), { code: "/etc/passwd" })), "invalid");
  assert.equal(wordsErrorKind("a string"), "unknown");
  assert.equal(wordsErrorKind(null), "unknown");
});

// ---- the game socket ----

test("websocket: create, join, receive views", async () => {
  const { host, code } = await hostRoom();
  const lobby = await host.next((m) => m.t === "view");
  assert.equal(lobby.view.phase, "lobby");
  assert.equal(lobby.view.code, code);

  const rooms = (await (await fetch(server.url + "/api/health")).json()).rooms;
  assert.ok(rooms >= 1);

  const p = await open();
  p.send({ t: "join", code, token: "tok-ola", nickname: "Ola" });
  const w = await p.next(isT("welcome"));
  assert.equal(w.role, "player");
  const pv = await p.next((m) => m.t === "view");
  assert.equal(pv.view.me.nickname, "Ola");
  const hv = await host.next((m) => m.t === "view" && m.view.players.length === 1);
  assert.equal(hv.view.players[0].nickname, "Ola");

  host.ws.close();
  p.ws.close();
  await Promise.all([host.closed, p.closed]);
});

test("client close codes and server close codes arrive intact", async () => {
  const c = await open();
  c.ws.close(4000, "bye");
  assert.deepEqual(await c.closed, { code: 4000, reason: "bye" });

  const { host, code } = await hostRoom();
  const p = await open();
  p.send({ t: "join", code, token: "tok-kick", nickname: "Kari" });
  const { pid } = await p.next(isT("welcome"));
  host.send({ t: "cmd", cmd: "kick", pid });
  assert.deepEqual(await p.next(isT("kicked")), { t: "kicked" });
  assert.deepEqual(await p.closed, { code: 4003, reason: "Removed" });

  host.ws.close();
  await host.closed;
});

test("long messages over 125 bytes and over 65535 bytes frame correctly", async () => {
  const c = await open();
  // 16-bit length: a real message, parsed intact (the passcode is wrong, so it's refused).
  const medium = JSON.stringify({ t: "create", passcode: "x".repeat(180), token: "tab" });
  assert.ok(medium.length > 125 && medium.length < 65536);
  c.send(medium);
  assert.deepEqual(await c.next(isT("error")), { t: "error", reason: "wrong-passcode" });

  // 64-bit length: the hub ignores anything over 2,000 bytes as a bad message.
  const huge = JSON.stringify({ t: "create", passcode: "y".repeat(70_000), token: "tab" });
  assert.ok(huge.length > 65535);
  c.send(huge);
  assert.deepEqual(await c.next(isT("error")), { t: "error", reason: "bad-message" });

  // The stream is still in step afterwards, and server frames over 125 bytes arrive.
  c.send({ t: "create", passcode: "test", token: "tab" });
  const { code } = await c.next(isT("welcome"));
  const p = await open();
  p.send({ t: "join", code, token: "tok-long", nickname: "Kari Nordmann" });
  const view = await c.next((m) => m.t === "view" && m.view.players.length === 1);
  assert.ok(JSON.stringify(view).length > 125);
  c.ws.close();
  p.ws.close();
  await Promise.all([c.closed, p.closed]);
});

// ---- raw framing (things Node's WebSocket client can't send) ----

type Frame = { fin: boolean; opcode: number; payload: Buffer };

function clientFrame(opcode: number, payload: Buffer, { fin = true, mask = true } = {}): Buffer {
  const len = payload.length;
  const head = len < 126 ? [len] : len < 65536 ? [126, len >> 8, len & 255] : null;
  if (!head) throw new Error("test frames stay small");
  const first = Buffer.from([(fin ? 0x80 : 0) | opcode, (mask ? 0x80 : 0) | head[0], ...head.slice(1)]);
  if (!mask) return Buffer.concat([first, payload]);
  const key = randomBytes(4);
  const body = Buffer.from(payload.map((b, i) => b ^ key[i % 4]));
  return Buffer.concat([first, key, body]);
}

async function rawOpen(key = randomBytes(16).toString("base64"), { allowHalfOpen = false } = {}) {
  const { port } = new URL(server.url);
  const sock: Socket = tcpConnect({ port: Number(port), host: "127.0.0.1", allowHalfOpen });
  let buf: Buffer = Buffer.alloc(0);
  let headers = "";
  const frames: Frame[] = [];
  let ended = false;
  let wake: () => void = () => {};
  sock.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    if (!headers) {
      const i = buf.indexOf("\r\n\r\n");
      if (i < 0) return;
      headers = buf.subarray(0, i).toString();
      buf = buf.subarray(i + 4);
    }
    for (;;) {
      if (buf.length < 2) break;
      assert.equal(buf[1] & 0x80, 0, "server frames are unmasked");
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
      if (buf.length < off + len) break;
      frames.push({ fin: (buf[0] & 0x80) !== 0, opcode: buf[0] & 0x0f, payload: buf.subarray(off, off + len) });
      buf = buf.subarray(off + len);
    }
    wake();
  });
  sock.on("error", () => {}); // writes after the server's destroy may fail; "close" follows
  sock.on("close", () => { ended = true; wake(); });
  sock.write(
    "GET /api/ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  const until = (ok: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out")), 3000);
      const check = () => { if (ok()) { clearTimeout(t); resolve(); } };
      wake = check;
      check();
    });
  await until(() => headers !== "");
  return {
    sock,
    headers: () => headers,
    frames,
    isEnded: () => ended,
    until,
    write: (b: Buffer) => sock.write(b),
  };
}

const closeCode = (f: Frame) => f.payload.readUInt16BE(0);

test("handshake answers with the RFC 6455 accept value", async () => {
  const r = await rawOpen("dGhlIHNhbXBsZSBub25jZQ==");
  assert.match(r.headers(), /^HTTP\/1\.1 101/);
  assert.ok(r.headers().includes("\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="), r.headers());
  r.sock.destroy();
});

test("a ping is answered with a pong carrying the same payload", async () => {
  const r = await rawOpen();
  r.write(clientFrame(0x9, Buffer.from("are you there")));
  await r.until(() => r.frames.some((f) => f.opcode === 0xa));
  const pong = r.frames.find((f) => f.opcode === 0xa)!;
  assert.equal(pong.payload.toString(), "are you there");
  r.sock.destroy();
});

test("a fragmented text message, with a ping in between, arrives as one message", async () => {
  const r = await rawOpen();
  const text = JSON.stringify({ t: "create", passcode: "wrong", token: "tab" });
  r.write(clientFrame(0x1, Buffer.from(text.slice(0, 10)), { fin: false }));
  r.write(clientFrame(0x9, Buffer.from("p")));
  r.write(clientFrame(0x0, Buffer.from(text.slice(10, 20)), { fin: false }));
  r.write(clientFrame(0x0, Buffer.from(text.slice(20))));
  await r.until(() => r.frames.some((f) => f.opcode === 0x1));
  const reply = JSON.parse(r.frames.find((f) => f.opcode === 0x1)!.payload.toString());
  assert.deepEqual(reply, { t: "error", reason: "wrong-passcode" });
  assert.ok(r.frames.some((f) => f.opcode === 0xa));
  r.sock.destroy();
});

test("a close frame from the client is answered with the same code, then the socket ends", async () => {
  const r = await rawOpen();
  const payload = Buffer.alloc(2 + 3);
  payload.writeUInt16BE(4321, 0);
  payload.write("bye", 2);
  r.write(clientFrame(0x8, payload));
  await r.until(() => r.isEnded());
  const close = r.frames.find((f) => f.opcode === 0x8)!;
  assert.equal(closeCode(close), 4321);
});

test("an unmasked client frame closes the connection with 1002", async () => {
  const r = await rawOpen();
  r.write(clientFrame(0x1, Buffer.from("{}"), { mask: false }));
  await r.until(() => r.isEnded());
  assert.equal(closeCode(r.frames.find((f) => f.opcode === 0x8)!), 1002);
});

test("after a protocol error the server destroys the socket even if the client keeps writing", async () => {
  const { host, code } = await hostRoom();
  const r = await rawOpen(undefined, { allowHalfOpen: true });
  r.write(clientFrame(0x1, Buffer.from(JSON.stringify({ t: "join", code, token: "tok-half", nickname: "Half" }))));
  await host.next((m) => m.t === "view" && m.view.players.some((p: any) => p.nickname === "Half" && p.connected));
  r.write(clientFrame(0x1, Buffer.from("{}"), { mask: false }));
  const junk = setInterval(() => { if (!r.isEnded()) r.write(randomBytes(4096)); }, 20);
  try {
    await r.until(() => r.isEnded()); // the client never ends its side, so only a server destroy gets here
  } finally {
    clearInterval(junk);
  }
  assert.equal(closeCode(r.frames.find((f) => f.opcode === 0x8)!), 1002);
  // The hub heard about the close: the player shows as disconnected.
  await host.next((m) => m.t === "view" && m.view.players.some((p: any) => p.nickname === "Half" && !p.connected));
  host.ws.close();
  await host.closed;
});

test("a binary frame closes the connection with 1003", async () => {
  const r = await rawOpen();
  r.write(clientFrame(0x2, Buffer.from([1, 2, 3])));
  await r.until(() => r.isEnded());
  assert.equal(closeCode(r.frames.find((f) => f.opcode === 0x8)!), 1003);
});

test("an upgrade to any other path is refused", async () => {
  const res = await new Promise<string>((resolve) => {
    const { port } = new URL(server.url);
    const s = tcpConnect(Number(port), "127.0.0.1");
    let out = "";
    s.on("data", (d) => (out += d));
    s.on("close", () => resolve(out));
    s.write(
      "GET /api/other HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
  });
  assert.match(res, /^HTTP\/1\.1 404/);
});
