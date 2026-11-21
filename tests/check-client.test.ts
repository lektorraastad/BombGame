import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeClock, FakeSocket } from "./fakes.ts";
import {
  runQuickChecks, startLongTest, summarizeLong, verdict, formatReport,
} from "../public/check-client.js";

beforeEach(() => FakeSocket.reset());

const okFetch = async () => new Response(JSON.stringify({ ok: true, instanceId: "a" }), { status: 200 });
const failFetch = async () => { throw new TypeError("Failed to fetch"); };

/** A server that opens, says hello, and answers pings after delays[i] ms. */
function healthyServer(clock: ReturnType<typeof makeClock>, delays: number[], instanceId = "a") {
  FakeSocket.onCreate = (s) => {
    clock.setTimeout(() => { s.open(); s.receive({ type: "hello", instanceId, startedAt: 0 }); }, 5);
    const beat = () => { if (s.readyState === 1) { s.receive({ type: "heartbeat", instanceId }); clock.setTimeout(beat, 20_000); } };
    clock.setTimeout(beat, 20_000);
    s.onClientSend = (m, sock) => {
      if (m.type === "ping") {
        const d = delays[m.id] ?? 10;
        clock.setTimeout(() => sock.receive({ type: "pong", id: m.id, instanceId }), d);
      }
    };
  };
}

function deps(clock: ReturnType<typeof makeClock>, fetchImpl: any) {
  return {
    fetch: fetchImpl, WebSocket: FakeSocket as any, baseUrl: "https://example.test",
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  };
}

test("all quick checks pass", async () => {
  const clock = makeClock();
  healthyServer(clock, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  const p = runQuickChecks(deps(clock, okFetch));
  await clock.advance(15_000);
  const r = await p;
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((x: any) => x.step), ["http", "ws-open", "round-trip"]);
  assert.ok(r.every((x: any) => x.ok), JSON.stringify(r));
  assert.equal(r[2].ms, 55);
  assert.equal(FakeSocket.instances[0].url, "wss://example.test/api/ws");
});

test("http ok but websocket never opens → ws-open fails after 10s, round-trip skipped", async () => {
  const clock = makeClock();
  FakeSocket.onCreate = () => {}; // never opens
  const p = runQuickChecks(deps(clock, okFetch));
  await clock.advance(25_000);
  const r = await p;
  assert.equal(r[0].ok, true);
  assert.equal(r[1].ok, false);
  assert.match(r[1].detail, /didn't open/);
  assert.equal(r[2].ok, false);
  assert.match(r[2].detail, /skipped/);
});

test("http fails but websocket works → reported independently", async () => {
  const clock = makeClock();
  healthyServer(clock, []);
  const p = runQuickChecks(deps(clock, failFetch));
  await clock.advance(15_000);
  const r = await p;
  assert.equal(r[0].ok, false);
  assert.equal(r[1].ok, true);
});

test("http that never answers times out after 10s", async () => {
  const clock = makeClock();
  healthyServer(clock, []);
  const p = runQuickChecks(deps(clock, () => new Promise(() => {})));
  await clock.advance(15_000);
  const r = await p;
  assert.equal(r[0].ok, false);
  assert.match(r[0].detail, /didn't answer/);
});

test("long test reconnects after close and logs it", async () => {
  const clock = makeClock();
  healthyServer(clock, []);
  const events: any[] = [];
  const t = startLongTest(deps(clock, okFetch), (e: any) => events.push(e));
  await clock.advance(100);
  FakeSocket.instances[0].serverClose(1006);
  await clock.advance(999 - 0);
  assert.equal(FakeSocket.instances.length, 1, "no reconnect before 1000 ms");
  await clock.advance(200);
  assert.equal(FakeSocket.instances.length, 2);
  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds, ["connected", "disconnected", "connected"]);
  assert.equal(events[1].code, 1006);
  t.stop();
});

test("code 1012 reconnects immediately", async () => {
  const clock = makeClock();
  healthyServer(clock, []);
  const t = startLongTest(deps(clock, okFetch), () => {});
  await clock.advance(100);
  FakeSocket.instances[0].serverClose(1012);
  await clock.advance(1);
  assert.equal(FakeSocket.instances.length, 2);
  t.stop();
});

test("long test keeps retrying while the server is unreachable", async () => {
  const clock = makeClock();
  FakeSocket.onCreate = (s) => clock.setTimeout(() => s.serverClose(1006), 50);
  const t = startLongTest(deps(clock, okFetch), () => {});
  await clock.advance(10_000);
  assert.ok(FakeSocket.instances.length >= 5, `only ${FakeSocket.instances.length} attempts`);
  t.stop();
});

test("a connection that never opens is abandoned after 10s and retried", async () => {
  const clock = makeClock();
  FakeSocket.onCreate = () => {};
  const t = startLongTest(deps(clock, okFetch), () => {});
  await clock.advance(12_000);
  assert.ok(FakeSocket.instances.length >= 2);
  t.stop();
});

test("stop closes the socket and returns a summary", async () => {
  const clock = makeClock();
  healthyServer(clock, []);
  const t = startLongTest(deps(clock, okFetch), () => {});
  await clock.advance(120_000);
  const sum = t.stop();
  assert.equal(FakeSocket.instances[0].closedByClient, 1000);
  assert.equal(sum.disconnects, 0);
  assert.deepEqual(sum.instanceIds, ["a"]);
  assert.ok(sum.minutes >= 1.9, `minutes ${sum.minutes}`);
  const before = FakeSocket.instances.length;
  await clock.advance(5_000);
  assert.equal(FakeSocket.instances.length, before, "no reconnect after stop");
});

test("summarizeLong flags different instance", () => {
  const s = summarizeLong([
    { t: 0, kind: "connected", instanceId: "a" },
    { t: 1000, kind: "disconnected", code: 1006 },
    { t: 3000, kind: "connected", instanceId: "b" },
  ]);
  assert.equal(s.sameInstance, false);
  assert.deepEqual(s.instanceIds, ["a", "b"]);
  assert.equal(s.disconnects, 1);
  assert.equal(s.longestOutageMs, 2000);
});

test("watchdog gap is not a disconnect", async () => {
  const clock = makeClock();
  healthyServer(clock, []);
  const events: any[] = [];
  const t = startLongTest(deps(clock, okFetch), (e: any) => events.push(e));
  await clock.advance(6_000);
  clock.jump(120_000); // laptop asleep
  FakeSocket.instances[0].serverClose(1006); // sleep killed the connection
  await clock.advance(6_000);
  const sum = t.stop();
  assert.equal(events.filter((e) => e.kind === "gap").length, 1);
  assert.equal(sum.gaps, 1);
  assert.equal(sum.disconnects, 0);
});

const allOk = [
  { step: "http", ok: true, ms: 40, detail: "x" },
  { step: "ws-open", ok: true, ms: 50, detail: "x" },
  { step: "round-trip", ok: true, ms: 30, detail: "x" },
];
const goodLong = { minutes: 50, disconnects: 1, longestOutageMs: 1200, instanceIds: ["a"], sameInstance: true, gaps: 0,
  restarts: 0, endedDisconnected: false, neverConnected: false };

test("verdict: everything works", () => {
  assert.ok(verdict(allOk as any, goodLong).includes("✅ Everything works. The game can run on this network."));
});

test("verdict: websocket blocked", () => {
  const q = [allOk[0], { ...allOk[1], ok: false }, { ...allOk[2], ok: false }];
  assert.ok(verdict(q as any).includes(
    "❌ The page and server work, but live connections are blocked on this network. Ask IT to allow WebSockets for this site, or we try the fallback host.",
  ));
});

test("verdict: different instance", () => {
  const v = verdict(allOk as any, { ...goodLong, instanceIds: ["a", "b"], sameInstance: false });
  assert.ok(v.includes("⚠️ The connection reconnected to a different server. Tell Claude: the game needs a change before it can use this host."));
  assert.ok(!v.includes("✅"));
});

test("verdict: long test not run", () => {
  assert.ok(verdict(allOk as any).includes("Quick checks done. Run the lesson-length test before deciding."));
});

test("formatReport starts with title and includes steps and verdict", () => {
  const r = formatReport(allOk as any, goodLong, "TestBrowser/1.0", "2026-11-21T10:00:00.000Z");
  assert.ok(r.startsWith("Bomb game connection test"));
  assert.match(r, /TestBrowser\/1\.0/);
  assert.match(r, /round-trip/);
  assert.match(r, /50 min/);
  assert.ok(r.includes("✅ Everything works."));
});

test("verdict: page loads but server and live connection both fail", () => {
  const q = [{ ...allOk[0], ok: false }, { ...allOk[1], ok: false }, { ...allOk[2], ok: false }];
  assert.equal(verdict(q as any),
    "❌ The page loads, but the game server can't be reached from this network. Ask IT to allow this site, or we try the fallback host.");
});

// ---- final-review fixes ----

test("C1: connection drops and never returns → outage counted to the end and verdict fails", () => {
  const s = summarizeLong([
    { t: 0, kind: "connected", instanceId: "a" },
    { t: 60_000, kind: "disconnected", code: 1006 },
  ], 0, 600_000);
  assert.equal(s.endedDisconnected, true);
  assert.equal(s.longestOutageMs, 540_000);
  const v = verdict(allOk as any, s);
  assert.ok(!v.includes("✅"));
  assert.ok(v.includes("❌ The live connection dropped and didn't come back before the test ended."));
});

test("C2: long test that never connects → verdict fails", () => {
  const s = summarizeLong([], 0, 600_000);
  assert.equal(s.neverConnected, true);
  const v = verdict(allOk as any, s);
  assert.ok(!v.includes("✅"));
  assert.ok(v.includes("❌ The lesson-length test never managed to connect."));
});

test("I1: silent dead socket is detected and replaced after ~50s without messages", async () => {
  const clock = makeClock();
  // server says hello but never sends heartbeats and never closes
  FakeSocket.onCreate = (s) => clock.setTimeout(() => { s.open(); s.receive({ type: "hello", instanceId: "a", startedAt: 1 }); }, 5);
  const events: any[] = [];
  const t = startLongTest(deps(clock, okFetch), (e: any) => events.push(e));
  await clock.advance(70_000);
  assert.ok(events.some((e) => e.kind === "disconnected" && e.code === 4001), JSON.stringify(events));
  assert.ok(FakeSocket.instances.length >= 2);
  assert.equal(FakeSocket.instances[0].closedByClient, 4001);
  t.stop();
});

test("I1: regular heartbeats keep the socket alive", async () => {
  const clock = makeClock();
  healthyServer(clock, []);
  const events: any[] = [];
  const t = startLongTest(deps(clock, okFetch), (e: any) => events.push(e));
  await clock.advance(300_000);
  assert.equal(events.filter((e) => e.kind === "disconnected").length, 0);
  t.stop();
});

test("I2: background-tab throttling (watchdog firing once a minute) is not a gap", async () => {
  const clock = makeClock();
  healthyServer(clock, []);
  const events: any[] = [];
  // a throttled browser delays every timer to the next full minute
  const throttled = { ...deps(clock, okFetch), setTimeout: (fn: () => void, ms: number) => clock.setTimeout(fn, Math.max(ms, 60_000)) };
  const t = startLongTest(throttled, (e: any) => events.push(e));
  await clock.advance(10 * 60_000);
  assert.equal(events.filter((e) => e.kind === "gap").length, 0);
  t.stop();
});

test("I2: a short gap does not hide a real disconnect", () => {
  const s = summarizeLong([
    { t: 0, kind: "connected", instanceId: "a" },
    { t: 70_000, kind: "gap", from: 10_000 },
    { t: 80_000, kind: "disconnected", code: 1006 },
    { t: 82_000, kind: "connected", instanceId: "a" },
  ], 0, 600_000);
  assert.equal(s.disconnects, 1);
});

test("I3: http body that stalls times out", async () => {
  const clock = makeClock();
  healthyServer(clock, []);
  const stallBody = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) });
  const p = runQuickChecks(deps(clock, stallBody));
  await clock.advance(25_000);
  const r = await p;
  assert.equal(r[0].ok, false);
  assert.match(r[0].detail, /didn't answer/);
});

test("M1: a server restart is reported as a restart, not as a second server", () => {
  const s = summarizeLong([
    { t: 0, kind: "connected", instanceId: "a", startedAt: -5000 },
    { t: 60_000, kind: "disconnected", code: 1012 },
    { t: 61_000, kind: "connected", instanceId: "b", startedAt: 60_500 },
  ], 0, 600_000);
  assert.equal(s.restarts, 1);
  assert.equal(s.sameInstance, true);
  const v = verdict(allOk as any, s);
  assert.ok(v.includes("⚠️ The server restarted during the test."));
  assert.ok(!v.includes("different server"));
});
