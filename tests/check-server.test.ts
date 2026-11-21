import { test } from "node:test";
import assert from "node:assert/strict";
import { handlePing, attachSocket, type ServerSocket, type CheckServerDeps } from "../netlify/server/check-server.ts";

function makeDeps() {
  const intervals: { fn: () => void; ms: number; handle: object }[] = [];
  const cleared: unknown[] = [];
  const deps: CheckServerDeps = {
    instanceId: "inst-1",
    startedAt: 1000,
    now: () => 5000,
    setInterval: (fn, ms) => { const handle = {}; intervals.push({ fn, ms, handle }); return handle; },
    clearInterval: (h) => { cleared.push(h); },
  };
  return { deps, intervals, cleared };
}

function makeSocket() {
  const sent: string[] = [];
  const listeners: Record<string, ((ev: any) => void)[]> = {};
  const socket: ServerSocket = {
    send: (d) => { sent.push(d); },
    close: () => {},
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
  };
  const fire = (type: string, ev: any) => (listeners[type] ?? []).forEach((fn) => fn(ev));
  const last = () => JSON.parse(sent[sent.length - 1]);
  return { socket, sent, fire, last };
}

test("handlePing returns ok JSON with instanceId and no-store", async () => {
  const { deps } = makeDeps();
  const res = handlePing(deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.instanceId, "inst-1");
  assert.equal(body.startedAt, 1000);
  assert.equal(body.serverTime, 5000);
});

test("attachSocket sends hello immediately", () => {
  const { deps } = makeDeps();
  const s = makeSocket();
  attachSocket(s.socket, deps);
  const first = JSON.parse(s.sent[0]);
  assert.equal(first.type, "hello");
  assert.equal(first.instanceId, "inst-1");
});

test("ping gets pong with same id", () => {
  const { deps } = makeDeps();
  const s = makeSocket();
  attachSocket(s.socket, deps);
  s.fire("message", { data: JSON.stringify({ type: "ping", id: 7 }) });
  const m = s.last();
  assert.equal(m.type, "pong");
  assert.equal(m.id, 7);
  assert.equal(m.instanceId, "inst-1");
});

test("heartbeat every 20s", () => {
  const { deps, intervals } = makeDeps();
  const s = makeSocket();
  attachSocket(s.socket, deps);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 20000);
  intervals[0].fn();
  assert.equal(s.last().type, "heartbeat");
});

test("close clears heartbeat", () => {
  const { deps, intervals, cleared } = makeDeps();
  const s = makeSocket();
  attachSocket(s.socket, deps);
  s.fire("close", { code: 1000 });
  assert.deepEqual(cleared, [intervals[0].handle]);
});

test("non-JSON message is ignored", () => {
  const { deps } = makeDeps();
  const s = makeSocket();
  attachSocket(s.socket, deps);
  const before = s.sent.length;
  assert.doesNotThrow(() => s.fire("message", { data: "hello there" }));
  assert.equal(s.sent.length, before);
});
