import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeClock, FakeSocket } from "../fakes.ts";
import { createConnection } from "../../public/app/net.js";

beforeEach(() => FakeSocket.reset());

function setup() {
  const clock = makeClock();
  const statuses: string[] = [];
  const messages: any[] = [];
  const conn = createConnection(
    { WebSocket: FakeSocket as any, url: "ws://x/api/ws", setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    (m: any) => messages.push(m),
    (s: string) => statuses.push(s),
  );
  return { clock, statuses, messages, conn };
}
const last = () => FakeSocket.instances[FakeSocket.instances.length - 1];
const hello = { t: "join", code: "ABCD", token: "tok", nickname: "Mia" };

test("reconnects with backoff and re-sends hello", async () => {
  const { clock, statuses, conn, messages } = setup();
  conn.setHello(hello);
  assert.equal(FakeSocket.instances.length, 1);
  assert.deepEqual(statuses, ["connecting"]);
  last().open();
  assert.deepEqual(last().sent, [hello]);
  assert.equal(statuses.at(-1), "open");
  last().receive({ t: "welcome", role: "player", code: "ABCD" });
  assert.equal(messages[0].t, "welcome");

  last().serverClose(1006);
  assert.equal(statuses.at(-1), "reconnecting");
  assert.equal(FakeSocket.instances.length, 1, "waits before retrying");
  await clock.advance(999);
  assert.equal(FakeSocket.instances.length, 1);
  await clock.advance(1);
  assert.equal(FakeSocket.instances.length, 2);

  // Fails without opening: next delay is 2 s, then 5 s, then 5 s.
  last().serverClose(1006);
  await clock.advance(1999);
  assert.equal(FakeSocket.instances.length, 2);
  await clock.advance(1);
  assert.equal(FakeSocket.instances.length, 3);
  last().serverClose(1006);
  await clock.advance(5000);
  assert.equal(FakeSocket.instances.length, 4);
  last().serverClose(1006);
  await clock.advance(4999);
  assert.equal(FakeSocket.instances.length, 4);
  await clock.advance(1);
  assert.equal(FakeSocket.instances.length, 5);

  last().open();
  assert.deepEqual(last().sent, [hello], "hello re-sent on every open");
  // A successful open resets the backoff.
  last().serverClose(1006);
  await clock.advance(1000);
  assert.equal(FakeSocket.instances.length, 6);
});

test("send is dropped while not open, delivered when open", () => {
  const { conn } = setup();
  conn.send({ t: "typing", text: "a" });
  last().open();
  conn.send({ t: "typing", text: "ab" });
  assert.deepEqual(last().sent, [{ t: "typing", text: "ab" }]);
});

test("1012 reconnects immediately", async () => {
  const { clock, conn } = setup();
  conn.setHello(hello);
  last().open();
  last().serverClose(1012);
  await clock.advance(0);
  assert.equal(FakeSocket.instances.length, 2);
});

test("4003 → kicked, no reconnect", async () => {
  const { clock, statuses } = setup();
  last().open();
  last().receive({ t: "kicked" });
  assert.equal(statuses.at(-1), "kicked");
  last().serverClose(4003);
  await clock.advance(60_000);
  assert.equal(FakeSocket.instances.length, 1);
  assert.equal(statuses.at(-1), "kicked");
});

test("4004 stops reconnecting", async () => {
  const { clock, statuses } = setup();
  last().open();
  last().serverClose(4004);
  assert.equal(statuses.at(-1), "ended");
  await clock.advance(60_000);
  assert.equal(FakeSocket.instances.length, 1);
});

test("close() stops everything and does not reconnect", async () => {
  const { clock, conn } = setup();
  last().open();
  conn.close();
  await clock.advance(60_000);
  assert.equal(FakeSocket.instances.length, 1);
});
