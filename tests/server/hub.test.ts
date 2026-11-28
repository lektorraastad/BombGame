import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub, MAX_ROOMS, IDLE_MS } from "../../src/server/hub.ts";
import type { Conn, ConnHandle } from "../../src/server/hub.ts";
import { passcodeMatches, AttemptLimiter } from "../../src/server/passcode.ts";
import { createPromptBank } from "../../src/engine/prompts.ts";
import { makeDeps, makeTestChecker, fixturePrompts, fixtureBlocked } from "../engine/helpers.ts";

const PASS = "secret";

function makeHub(...args: [passcode?: string | undefined]) {
  const passcode = args.length > 0 ? args[0] : PASS;
  const { deps, clock } = makeDeps(3);
  const events: string[] = [];
  const hub = new Hub({
    deps,
    words: { checker: makeTestChecker(), bank: createPromptBank(fixturePrompts), blockedNames: fixtureBlocked, rarity: () => 1 },
    passcode,
    log: (e) => events.push(e),
  });
  return { hub, clock, events };
}

type FakeConn = ConnHandle & { msgs: any[]; closedWith?: [number, string]; send(m: object): void; views(): any[]; last(t: string): any; clear(): void };

function connect(hub: Hub): FakeConn {
  const fc = { msgs: [] as any[] } as FakeConn;
  const conn: Conn = {
    send: (text) => fc.msgs.push(JSON.parse(text)),
    close: (code, reason) => { fc.closedWith = [code, reason]; },
  };
  const h = hub.connect(conn);
  fc.message = h.message;
  fc.closed = h.closed;
  fc.send = (m) => h.message(JSON.stringify(m));
  fc.views = () => fc.msgs.filter((m) => m.t === "view").map((m) => m.view);
  fc.last = (t) => fc.msgs.filter((m) => m.t === t).at(-1);
  fc.clear = () => { fc.msgs.length = 0; };
  return fc;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

async function hostRoom(hub: Hub) {
  const host = connect(hub);
  host.send({ t: "create", passcode: PASS, token: "host-tab" });
  await tick();
  const w = host.last("welcome");
  return { host, code: w.code as string, hostToken: w.hostToken as string };
}

async function joinPlayer(hub: Hub, code: string, nickname: string, token = `tok-${nickname}`) {
  const c = connect(hub);
  c.send({ t: "join", code, token, nickname });
  await tick();
  return c;
}

// ---- passcode helpers ----

test("passcodeMatches compares exactly, whatever the lengths", () => {
  assert.equal(passcodeMatches("secret", "secret"), true);
  assert.equal(passcodeMatches("secreT", "secret"), false);
  assert.equal(passcodeMatches("secret-and-more", "secret"), false);
  assert.equal(passcodeMatches("", "secret"), false);
});

test("AttemptLimiter counts only failures: 5 per key and 30 in all per minute", () => {
  const lim = new AttemptLimiter();
  for (let i = 0; i < 4; i++) lim.fail("a", 1000);
  assert.equal(lim.blocked("a", 1000), false);
  lim.fail("a", 1000);
  assert.equal(lim.blocked("a", 1000), true);
  assert.equal(lim.blocked("b", 1000), false);
  assert.equal(lim.blocked("a", 61_000), false);
  lim.forget("a");
  assert.equal(lim.blocked("a", 1000), false);
  const all = new AttemptLimiter();
  for (let i = 0; i < 30; i++) all.fail(`k${i}`, 1000);
  assert.equal(all.blocked("fresh", 1000), true);
  assert.equal(all.blocked("fresh", 61_000), false);
});

// ---- creating a room ----

test("create with wrong passcode is refused, 6th attempt is too-many-attempts", async () => {
  const { hub } = makeHub();
  const c = connect(hub);
  for (let i = 0; i < 5; i++) {
    c.send({ t: "create", passcode: "wrong", token: "t" });
    assert.deepEqual(c.msgs.at(-1), { t: "error", reason: "wrong-passcode" });
  }
  c.send({ t: "create", passcode: "wrong", token: "t" });
  assert.deepEqual(c.msgs.at(-1), { t: "error", reason: "too-many-attempts" });
  c.send({ t: "create", passcode: PASS, token: "t" });
  assert.deepEqual(c.msgs.at(-1), { t: "error", reason: "too-many-attempts" });
  assert.equal(hub.roomCount(), 0);
});

test("a correct passcode after 4 wrong ones on the same connection succeeds", () => {
  const { hub } = makeHub();
  const c = connect(hub);
  for (let i = 0; i < 4; i++) c.send({ t: "create", passcode: "wrong", token: "t" });
  c.send({ t: "create", passcode: PASS, token: "t" });
  assert.equal(c.msgs.at(-1).t, "welcome");
  const ctl = connect(hub);
  for (let i = 0; i < 4; i++) ctl.send({ t: "control", code: c.msgs.at(-1).code, passcode: "wrong", token: "p" });
  ctl.send({ t: "control", code: c.msgs.at(-1).code, passcode: PASS, token: "p" });
  assert.equal(ctl.msgs.at(-1).t, "welcome");
});

test("31 wrong attempts over 7 connections block an 8th connection until 60 s pass", async () => {
  const { hub, clock } = makeHub();
  const conns = Array.from({ length: 7 }, () => connect(hub));
  for (let i = 0; i < 31; i++) conns[i % 7].send({ t: "create", passcode: "wrong", token: "t" });
  const fresh = connect(hub);
  fresh.send({ t: "create", passcode: PASS, token: "t" });
  assert.deepEqual(fresh.msgs.at(-1), { t: "error", reason: "too-many-attempts" });
  fresh.send({ t: "control", code: "ABCD", passcode: PASS, token: "t" });
  assert.deepEqual(fresh.msgs.at(-1), { t: "error", reason: "too-many-attempts" });
  await clock.advance(60_000);
  fresh.send({ t: "create", passcode: PASS, token: "t" });
  assert.equal(fresh.msgs.at(-1).t, "welcome");
});

test("a closed connection's limiter entry is deleted", () => {
  const { hub } = makeHub();
  const limiter = (hub as any).limiter as AttemptLimiter;
  const forgotten: string[] = [];
  const forget = limiter.forget.bind(limiter);
  limiter.forget = (key: string) => { forgotten.push(key); forget(key); };
  const c = connect(hub);
  c.send({ t: "create", passcode: "wrong", token: "t" });
  c.closed();
  assert.equal(forgotten.length, 1);
});

test("create with no passcode configured is refused with no-passcode-set", () => {
  for (const passcode of [undefined, ""]) {
    const { hub } = makeHub(passcode);
    const c = connect(hub);
    c.send({ t: "create", passcode: "", token: "t" });
    assert.deepEqual(c.msgs.at(-1), { t: "error", reason: "no-passcode-set" });
    assert.equal(hub.roomCount(), 0);
  }
});

test("create returns welcome with code and hostToken; projector gets a lobby view", async () => {
  const { hub } = makeHub();
  const host = connect(hub);
  host.send({ t: "create", passcode: PASS, token: "host-tab" });
  const w = host.msgs[0];
  assert.equal(w.t, "welcome");
  assert.equal(w.role, "host");
  assert.match(w.code, /^[A-Z]{4}$/);
  assert.match(w.hostToken, /^[0-9a-f-]{36}$/);
  assert.equal(w.pid, undefined);
  await tick();
  const views = host.views();
  assert.equal(views.length, 1);
  assert.equal(views[0].phase, "lobby");
  assert.equal(views[0].code, w.code);
  assert.equal(hub.roomCount(), 1);
});

// ---- joining and reconnecting ----

test("player joins with code and nickname; host sees them in the next view", async () => {
  const { hub } = makeHub();
  const { host, code } = await hostRoom(hub);
  host.clear();
  const p = connect(hub);
  p.send({ t: "join", code, token: "tok-ola", nickname: "Ola" });
  const w = p.msgs[0];
  assert.equal(w.t, "welcome");
  assert.equal(w.role, "player");
  assert.equal(w.code, code);
  assert.equal(typeof w.pid, "string");
  assert.equal(w.hostToken, undefined);
  await tick();
  assert.deepEqual(host.views().at(-1).players.map((x: any) => x.nickname), ["Ola"]);
  assert.equal(p.views().at(-1).me.nickname, "Ola");
});

test("join errors: unknown room and engine refusals", async () => {
  const { hub } = makeHub();
  const { code } = await hostRoom(hub);
  const p = connect(hub);
  p.send({ t: "join", code: code === "ZZZZ" ? "YYYY" : "ZZZZ", token: "t", nickname: "Ola" });
  assert.deepEqual(p.msgs.at(-1), { t: "error", reason: "no-room" });
  p.send({ t: "join", code, token: "t", nickname: "damn" });
  assert.deepEqual(p.msgs.at(-1), { t: "error", reason: "name-blocked" });
});

test("views are batched: one broadcast per room per tick", async () => {
  const { hub } = makeHub();
  const { host, code } = await hostRoom(hub);
  host.clear();
  const conns = ["Ola", "Kari", "Nora"].map((n) => {
    const c = connect(hub);
    c.send({ t: "join", code, token: `tok-${n}`, nickname: n });
    return c;
  });
  await tick();
  assert.equal(host.views().length, 1);
  assert.equal(host.views()[0].players.length, 3);
  for (const c of conns) assert.equal(c.views().length, 1);
});

test("host reconnects with host token", async () => {
  const { hub } = makeHub();
  const { host, code, hostToken } = await hostRoom(hub);
  await joinPlayer(hub, code, "Ola");
  host.closed();

  const again = connect(hub);
  again.send({ t: "host", code, token: "host-tab", hostToken });
  assert.deepEqual(again.msgs[0], { t: "welcome", role: "host", code });
  await tick();
  assert.deepEqual(again.views().at(-1).players.map((x: any) => x.nickname), ["Ola"]);

  const wrong = connect(hub);
  wrong.send({ t: "host", code, token: "x", hostToken: "not-the-token" });
  assert.deepEqual(wrong.msgs.at(-1), { t: "error", reason: "not-host" });
  await tick();
  assert.equal(wrong.views().length, 0);
});

test("projector reattaches with code and passcode: welcome with hostToken, then the projector view", async () => {
  const { hub } = makeHub();
  const { host, code, hostToken } = await hostRoom(hub);
  await joinPlayer(hub, code, "Ola");
  host.closed(); // the projector tab crashed, and its host token is gone with it

  const again = connect(hub);
  again.send({ t: "host", code, token: "new-tab", passcode: PASS });
  assert.deepEqual(again.msgs[0], { t: "welcome", role: "host", code, hostToken });
  await tick();
  const v = again.views().at(-1);
  assert.equal(v.code, code);
  assert.deepEqual(v.players.map((x: any) => x.nickname), ["Ola"]);
  assert.equal("settingDecls" in v, false); // the projector view, not the control view
  assert.equal(hub.roomCount(), 1);
});

test("projector reattach: wrong passcodes count toward the limits; unknown room after a right one", async () => {
  const { hub } = makeHub();
  const { code } = await hostRoom(hub);
  const c = connect(hub);
  for (let i = 0; i < 5; i++) {
    c.send({ t: "host", code, token: "t", passcode: "wrong" });
    assert.deepEqual(c.msgs.at(-1), { t: "error", reason: "wrong-passcode" });
  }
  c.send({ t: "host", code, token: "t", passcode: PASS });
  assert.deepEqual(c.msgs.at(-1), { t: "error", reason: "too-many-attempts" });
  // The same limiter as create: the blocked connection can't create a room either.
  c.send({ t: "create", passcode: PASS, token: "t" });
  assert.deepEqual(c.msgs.at(-1), { t: "error", reason: "too-many-attempts" });
  await tick();
  assert.equal(c.views().length, 0);

  const other = connect(hub);
  other.send({ t: "host", code: code === "ZZZZ" ? "YYYY" : "ZZZZ", token: "t", passcode: PASS });
  assert.deepEqual(other.msgs.at(-1), { t: "error", reason: "no-room" });
});

test("projector reattach with neither a host token nor a passcode is not-host", async () => {
  const { hub } = makeHub();
  const { code } = await hostRoom(hub);
  const c = connect(hub);
  c.send({ t: "host", code, token: "t" });
  assert.deepEqual(c.msgs.at(-1), { t: "error", reason: "not-host" });
  await tick();
  assert.equal(c.views().length, 0);
});

test("projector reattach with a passcode when none is set is no-passcode-set", async () => {
  const { hub } = makeHub(undefined);
  const c = connect(hub);
  c.send({ t: "host", code: "ABCD", token: "t", passcode: "anything" });
  assert.deepEqual(c.msgs.at(-1), { t: "error", reason: "no-passcode-set" });
});

test("control joins with passcode and receives hostToken", async () => {
  const { hub } = makeHub();
  const { code, hostToken } = await hostRoom(hub);
  const ctl = connect(hub);
  ctl.send({ t: "control", code, passcode: PASS, token: "phone" });
  assert.deepEqual(ctl.msgs[0], { t: "welcome", role: "control", code, hostToken });
  await tick();
  assert.ok(Array.isArray(ctl.views().at(-1).settingDecls));

  // A control window with the host token gets the control role, but is not sent the token again.
  const win = connect(hub);
  win.send({ t: "control", code, hostToken, token: "second-window" });
  assert.deepEqual(win.msgs[0], { t: "welcome", role: "control", code });

  const badPass = connect(hub);
  badPass.send({ t: "control", code, passcode: "nope", token: "x" });
  assert.deepEqual(badPass.msgs.at(-1), { t: "error", reason: "wrong-passcode" });
  const badToken = connect(hub);
  badToken.send({ t: "control", code, hostToken: "nope", token: "x" });
  assert.deepEqual(badToken.msgs.at(-1), { t: "error", reason: "not-host" });
});

test("two connections, one token, one player", async () => {
  const { hub } = makeHub();
  const { host, code } = await hostRoom(hub);
  const a = await joinPlayer(hub, code, "Ola", "same");
  const b = await joinPlayer(hub, code, "Ola", "same");
  assert.equal(a.last("welcome").pid, b.last("welcome").pid);
  assert.equal(host.views().at(-1).players.length, 1);

  a.clear(); b.clear();
  host.send({ t: "cmd", cmd: "lock" });
  await tick();
  assert.equal(a.views().length, 1);
  assert.equal(b.views().length, 1);

  a.closed();
  await tick();
  assert.equal(host.views().at(-1).players[0].connected, true);
  b.closed();
  await tick();
  assert.equal(host.views().at(-1).players[0].connected, false);
});

// ---- privacy ----

test("each role receives its own view", async () => {
  const { hub } = makeHub();
  const { host, code } = await hostRoom(hub);
  const ctl = connect(hub);
  ctl.send({ t: "control", code, passcode: PASS, token: "phone" });
  const p = await joinPlayer(hub, code, "Ola");
  await joinPlayer(hub, code, "Kari");

  const pv = p.views().at(-1);
  assert.equal(pv.me.nickname, "Ola");
  assert.equal(pv.settingDecls, undefined);

  const hv = host.views().at(-1);
  assert.equal(hv.me, undefined);
  assert.equal(hv.settingDecls, undefined);
  for (const pl of hv.players) { assert.equal(pl.score, undefined); assert.equal(pl.ghostPoints, undefined); }

  const cv = ctl.views().at(-1);
  assert.ok(Array.isArray(cv.settingDecls));
  assert.equal(typeof cv.players[0].score, "number");

  for (const c of [host, ctl, p]) {
    const text = JSON.stringify(c.msgs.filter((m) => m.t === "view"));
    assert.ok(!text.includes("tok-Ola") && !text.includes("tok-Kari"), "views never carry tokens");
  }
});

test("control views carry promptCounts for every band and type; other views do not", async () => {
  const { hub } = makeHub();
  const { host, code, hostToken } = await hostRoom(hub);
  const ctl = connect(hub);
  ctl.send({ t: "control", code, hostToken, token: "overlay-tab" });
  const p = await joinPlayer(hub, code, "Ola");

  const bank = createPromptBank(fixturePrompts);
  const expected: Record<string, Record<string, number>> = {};
  for (const band of ["easy", "normal", "rising", "hard"] as const) {
    expected[band] = {};
    for (const type of ["contains", "starts", "ends"] as const) expected[band][type] = bank.size(band, [type]);
  }
  const cv = ctl.views().at(-1);
  assert.deepEqual(cv.promptCounts, expected);
  assert.equal(cv.promptCounts.easy.starts, 2, "'st' (very easy) and 're' (easy) start the Easy group");
  assert.equal(host.views().at(-1).promptCounts, undefined);
  assert.equal(p.views().at(-1).promptCounts, undefined);
});

test("projector views carry lastEvent: word after an accepted word, explosion after the bomb, else null", async () => {
  const { hub, clock } = makeHub();
  const { host, code, hostToken } = await hostRoom(hub);
  const ctl = connect(hub);
  ctl.send({ t: "control", code, hostToken, token: "overlay-tab" });
  const players = [await joinPlayer(hub, code, "Ola"), await joinPlayer(hub, code, "Kari")];
  assert.equal(host.views().at(-1).lastEvent, null, "lobby");
  host.send({ t: "cmd", cmd: "settings", settings: { mode: "classic", timerStyle: "visible", turnTime: 5 } });
  host.send({ t: "cmd", cmd: "start" });
  await tick();
  const started = host.views().at(-1);
  assert.equal(started.phase, "playing");
  assert.equal(started.lastEvent, null, "starting a game is neither");

  const on = players.find((p) => p.last("welcome").pid === started.mode.current)!;
  const fits = ["station", "stone", "ring", "king", "house", "round", "return", "remember", "last", "fast", "found", "repeat", "sing", "out"]
    .find((w) => (started.prompt.type === "starts" ? w.startsWith(started.prompt.text) : started.prompt.type === "ends" ? w.endsWith(started.prompt.text) : w.includes(started.prompt.text)));
  assert.ok(fits);
  on.send({ t: "submit", word: fits });
  assert.equal(on.last("result").ok, true);
  await tick();
  assert.equal(host.views().at(-1).lastEvent, "word");

  host.clear();
  await clock.advance(5_000);
  await tick();
  assert.equal(host.views().length, 1, "one broadcast for the explosion");
  assert.equal(host.views()[0].lastEvent, "explosion");

  host.send({ t: "cmd", cmd: "lock" });
  await tick();
  assert.equal(host.views().at(-1).lastEvent, null, "the next broadcast is not another explosion");

  assert.equal(ctl.views().at(-1).lastEvent, undefined, "projector and players only");
});

test("player views carry the same lastEvent as the projector: explosion, then null", async () => {
  const { hub, clock } = makeHub();
  const { host, code } = await hostRoom(hub);
  const players = [await joinPlayer(hub, code, "Ola"), await joinPlayer(hub, code, "Kari")];
  assert.equal(players[0].views().at(-1).lastEvent, null, "lobby");
  host.send({ t: "cmd", cmd: "settings", settings: { mode: "classic", timerStyle: "visible", turnTime: 5 } });
  host.send({ t: "cmd", cmd: "start" });
  await tick();
  for (const p of players) p.clear();
  host.clear();
  await clock.advance(5_000);
  await tick();
  assert.equal(host.views().at(-1).lastEvent, "explosion");
  for (const p of players) assert.equal(p.views().at(-1).lastEvent, "explosion");
  host.send({ t: "cmd", cmd: "lock" });
  await tick();
  for (const p of players) assert.equal(p.views().at(-1).lastEvent, null, "the next broadcast is not another explosion");
});

// ---- moments and the turn's age ----

const FIXTURE_FITS = ["station", "stone", "street", "ring", "king", "thing", "house", "round", "sound", "return", "remember",
  "repeat", "last", "fast", "best", "found", "ground", "sing", "out", "plant", "about", "count"];

function fitting(prompt: { text: string; type: string }, not: string[] = []): string {
  const w = FIXTURE_FITS.find((x) => !not.includes(x) &&
    (prompt.type === "starts" ? x.startsWith(prompt.text) : prompt.type === "ends" ? x.endsWith(prompt.text) : x.includes(prompt.text)));
  assert.ok(w, `a fixture word fits ${prompt.type}:${prompt.text}`);
  return w;
}

/** A started two-player game; `on` holds the bomb in Classic. */
async function gameWith(hub: Hub, settings: Record<string, unknown>) {
  const { host, code, hostToken } = await hostRoom(hub);
  const players = [await joinPlayer(hub, code, "Ola"), await joinPlayer(hub, code, "Kari")];
  host.send({ t: "cmd", cmd: "settings", settings });
  host.send({ t: "cmd", cmd: "start" });
  assert.deepEqual(host.msgs.at(-1), { t: "result", ok: true });
  await tick();
  const started = host.views().at(-1);
  const pidOf = (c: FakeConn) => c.last("welcome").pid as string;
  const on = players.find((p) => pidOf(p) === started.mode.current) ?? players[0];
  const off = players.find((p) => p !== on)!;
  return { host, code, hostToken, players, started, on, off, pidOf };
}

/** Forces a broadcast without changing the game. */
async function poke(host: FakeConn) {
  host.send({ t: "cmd", cmd: "lock" });
  await tick();
  host.send({ t: "cmd", cmd: "unlock" });
  await tick();
  return host.views().at(-1);
}

const sameSet = (actual: unknown[], expected: unknown[]) =>
  assert.deepEqual(new Set(actual.map((m) => JSON.stringify(m))), new Set(expected.map((m) => JSON.stringify(m))));

test("moments: word, then explosion with hearts", async () => {
  const { hub, clock } = makeHub();
  const { host, started, on, off, pidOf, players } = await gameWith(hub, { mode: "classic", timerStyle: "visible", turnTime: 5 });
  assert.deepEqual(started.moments, [], "starting a game has no moments");
  assert.deepEqual(players[0].views().at(-1).moments, [], "laptops get moments too");
  on.send({ t: "submit", word: fitting(started.prompt) });
  assert.equal(on.last("result").ok, true);
  await tick();
  assert.deepEqual(host.views().at(-1).moments, [{ kind: "word", pid: pidOf(on) }]);
  assert.deepEqual(off.views().at(-1).moments, [{ kind: "word", pid: pidOf(on) }]);
  host.clear();
  await clock.advance(5_000);
  await tick();
  sameSet(host.views().at(-1).moments, [{ kind: "hearts", pids: [pidOf(off)] }, { kind: "explosion" }]);
  const after = await poke(host);
  assert.deepEqual(after.moments, [], "moments are not repeated");
});

test("two moments between broadcasts are both listed", async () => {
  const { hub, clock } = makeHub();
  const { host, on, pidOf } = await gameWith(hub, { mode: "classic", timerStyle: "visible", turnTime: 5 });
  host.clear();
  await clock.advance(5_000);
  await tick();
  assert.equal(host.views().length, 1, "one broadcast for the explosion");
  const ms = host.views()[0].moments;
  assert.equal(ms.length, 2);
  sameSet(ms, [{ kind: "hearts", pids: [pidOf(on)] }, { kind: "explosion" }]);
});

test("refused is broadcast only for the current Classic player and the four reasons", async () => {
  const { hub } = makeHub();
  const { host, on, off, pidOf, started } = await gameWith(hub, { mode: "classic", timerStyle: "visible", turnTime: 30 });
  host.clear();
  on.send({ t: "submit", word: "zzzz" });
  assert.deepEqual(on.last("result"), { t: "result", ok: false, reason: "not-a-word" });
  await tick();
  assert.equal(host.views().length, 1, "a refusal queues a broadcast");
  assert.deepEqual(host.views()[0].moments, [{ kind: "refused", pid: pidOf(on) }]);
  assert.deepEqual(off.views().at(-1).moments, [{ kind: "refused", pid: pidOf(on) }]);
  for (const c of [host, on, off]) assert.ok(!JSON.stringify(c.msgs.filter((m) => m.t === "view")).includes("zzzz"), "the word is never sent");

  const fitsPrompt = (w: string) => { try { return fitting(started.prompt, FIXTURE_FITS.filter((x) => x !== w)) === w; } catch { return false; } };
  const misfit = FIXTURE_FITS.find((w) => !fitsPrompt(w))!;
  for (const [word, reason] of [["damn", "blocked"], [misfit, "doesnt-match"]] as const) {
    host.clear();
    on.send({ t: "submit", word });
    assert.equal(on.last("result").reason, reason);
    await tick();
    assert.deepEqual(host.views().at(-1).moments, [{ kind: "refused", pid: pidOf(on) }], reason);
  }

  host.clear();
  off.send({ t: "submit", word: "zzzz" });
  assert.equal(off.last("result").reason, "not-a-word", "a refused silent answer");
  off.send({ t: "submit", word: misfit });
  assert.equal(off.last("result").reason, "doesnt-match", "another refused silent answer");
  on.send({ t: "submit", word: "   " });
  assert.equal(on.last("result").reason, "empty");
  await tick();
  assert.equal(host.views().length, 0, "neither queues a broadcast");
  assert.deepEqual((await poke(host)).moments, [], "and neither leaves a refused moment");

  // "used": the bomb passes, then the host skips until the new player's prompt fits the word already played.
  const word = fitting(started.prompt);
  on.send({ t: "submit", word });
  assert.equal(on.last("result").ok, true);
  await tick();
  assert.equal(host.views().at(-1).mode.current, pidOf(off));
  for (let i = 0; i < 60 && !fitsNext(host.views().at(-1).prompt, word); i++) {
    host.send({ t: "cmd", cmd: "skip" });
    await tick();
  }
  assert.ok(fitsNext(host.views().at(-1).prompt, word), "a prompt the used word fits came round");
  host.clear();
  off.send({ t: "submit", word });
  assert.equal(off.last("result").reason, "used");
  await tick();
  assert.deepEqual(host.views().at(-1).moments, [{ kind: "refused", pid: pidOf(off) }], "used");
});

const fitsNext = (prompt: { text: string; type: string }, w: string) =>
  prompt.type === "starts" ? w.startsWith(prompt.text) : prompt.type === "ends" ? w.endsWith(prompt.text) : w.includes(prompt.text);

test("a refusal in Everyone at once causes no refused moment", async () => {
  const { hub } = makeHub();
  const { host, on } = await gameWith(hub, { mode: "everyone" });
  host.clear();
  on.send({ t: "submit", word: "zzzz" });
  assert.equal(on.last("result").reason, "not-a-word");
  await tick();
  assert.equal(host.views().length, 0);
  assert.deepEqual((await poke(host)).moments, []);
});

test("all-answered once in Everyone at once", async () => {
  const { hub } = makeHub();
  const { host, players, started, pidOf } = await gameWith(hub, { mode: "everyone" });
  const word = fitting(started.prompt);
  players[0].send({ t: "submit", word });
  assert.equal(players[0].last("result").ok, true);
  await tick();
  assert.deepEqual(host.views().at(-1).moments, [{ kind: "word", pid: pidOf(players[0]) }]);
  players[1].send({ t: "submit", word });
  assert.equal(players[1].last("result").ok, true);
  await tick();
  sameSet(host.views().at(-1).moments, [{ kind: "word", pid: pidOf(players[1]) }, { kind: "all-answered" }]);
  assert.deepEqual((await poke(host)).moments, [], "not again in the same round");
});

test("win when the game ends", async () => {
  const { hub, clock } = makeHub();
  const { host, on, off, pidOf } = await gameWith(hub, { mode: "classic", timerStyle: "visible", turnTime: 5, startLives: 1 });
  host.clear();
  await clock.advance(5_000);
  await tick();
  const v = host.views().at(-1);
  assert.equal(v.phase, "results");
  assert.deepEqual(v.results.winners, [pidOf(off)]);
  sameSet(v.moments, [{ kind: "win", pids: v.results.winners }, { kind: "hearts", pids: [pidOf(on)] }, { kind: "explosion" }]);
  assert.deepEqual((await poke(host)).moments, [], "the win is listed once");
  assert.equal((await poke(host)).turnElapsedMs, undefined, "no turn age on results");
});

test("turn age: present only for a hidden fuse, from the turn's start", async () => {
  const { hub, clock } = makeHub();
  const { started, host } = await gameWith(hub, { mode: "classic", timerStyle: "hidden" });
  assert.equal(started.turnElapsedMs, 0);
  await clock.advance(2000);
  host.send({ t: "cmd", cmd: "lock" });
  await tick();
  assert.equal(host.views().at(-1).turnElapsedMs, 2000);

  const visible = makeHub();
  const g = await gameWith(visible.hub, { mode: "classic", timerStyle: "visible" });
  assert.equal(typeof g.started.bombRemainingMs, "number");
  assert.equal(g.started.turnElapsedMs, undefined);
  assert.equal(g.players[0].views().at(-1).turnElapsedMs, undefined);

  const everyone = makeHub();
  const e = await gameWith(everyone.hub, { mode: "everyone" });
  assert.equal(e.started.turnElapsedMs, undefined, "Everyone at once has no current player");

  const lobby = makeHub();
  const l = await hostRoom(lobby.hub);
  assert.equal(l.host.views().at(-1).turnElapsedMs, undefined, "none in the lobby");
});

test("turn age is measured per turn, never from the fuse: it resets when the bomb passes, and a top-up does not reset it", async () => {
  const { hub, clock } = makeHub();
  const { host, on, off, started, pidOf } = await gameWith(hub, { mode: "classic", timerStyle: "hidden", fuseMin: 3, fuseMax: 3, minTurn: 8 });
  await clock.advance(2000);
  on.send({ t: "submit", word: fitting(started.prompt) });
  assert.equal(on.last("result").ok, true);
  await tick();
  const passed = host.views().at(-1);
  assert.equal(passed.mode.current, pidOf(off), "the bomb passed");
  assert.equal(passed.turnElapsedMs, 0, "a new turn starts at 0");
  // The fuse had at most 3 s left, under minTurn, so the engine re-armed it to 8 s just now.
  await clock.advance(1000);
  host.send({ t: "cmd", cmd: "lock" });
  await tick();
  assert.equal(host.views().at(-1).mode.current, pidOf(off));
  assert.equal(host.views().at(-1).turnElapsedMs, 1000, "it grows with the clock, not reset by the re-arm");
  await clock.advance(1500);
  host.send({ t: "cmd", cmd: "unlock" });
  await tick();
  assert.equal(host.views().at(-1).turnElapsedMs, 2500);
});

test("turn age resets when the bomb passes with no top-up, while the same fuse keeps running", async () => {
  const { hub, clock } = makeHub();
  const { host, on, off, started, pidOf } = await gameWith(hub, { mode: "classic", timerStyle: "hidden", fuseMin: 30, fuseMax: 30, minTurn: 8 });
  await clock.advance(2000);
  on.send({ t: "submit", word: fitting(started.prompt) });
  assert.equal(on.last("result").ok, true);
  await tick();
  // About 28 s are left, more than minTurn, so the engine did not re-arm: the fuse runs on across the pass.
  const passed = host.views().at(-1);
  assert.equal(passed.mode.current, pidOf(off), "the bomb passed");
  assert.equal(passed.turnElapsedMs, 0, "the new turn starts at 0, not at the fuse's 2000");
  assert.equal(off.views().at(-1).turnElapsedMs, 0);
  await clock.advance(3000);
  host.send({ t: "cmd", cmd: "lock" });
  await tick();
  assert.equal(host.views().at(-1).mode.current, pidOf(off));
  assert.equal(host.views().at(-1).turnElapsedMs, 3000, "it grows with the clock from the pass");
});

test("win from a paused game: a kick leaves one player", async () => {
  const { hub } = makeHub();
  const { host, on, off, pidOf } = await gameWith(hub, { mode: "classic", timerStyle: "hidden" });
  host.send({ t: "cmd", cmd: "pause" });
  await tick();
  assert.equal(host.views().at(-1).phase, "paused");
  host.clear();
  host.send({ t: "cmd", cmd: "kick", pid: pidOf(on) });
  assert.deepEqual(host.msgs.at(-1), { t: "result", ok: true });
  await tick();
  const v = host.views().at(-1);
  assert.equal(v.phase, "results");
  assert.deepEqual(v.results.winners, [pidOf(off)]);
  assert.deepEqual(v.moments, [{ kind: "win", pids: [pidOf(off)] }]);
  assert.deepEqual(off.views().at(-1).moments, [{ kind: "win", pids: [pidOf(off)] }]);
  assert.deepEqual((await poke(host)).moments, [], "listed once");
});

test("turn age freezes while paused", async () => {
  const { hub, clock } = makeHub();
  const { host } = await gameWith(hub, { mode: "classic", timerStyle: "hidden", fuseMin: 30, fuseMax: 30 });
  await clock.advance(2000);
  host.send({ t: "cmd", cmd: "pause" });
  await tick();
  assert.equal(host.views().at(-1).phase, "paused");
  assert.equal(host.views().at(-1).turnElapsedMs, 2000);
  await clock.advance(10_000);
  host.send({ t: "cmd", cmd: "lock" });
  await tick();
  assert.equal(host.views().at(-1).turnElapsedMs, 2000, "frozen while paused");
  host.send({ t: "cmd", cmd: "resume" });
  await tick();
  assert.equal(host.views().at(-1).turnElapsedMs, 2000);
  await clock.advance(1000);
  host.send({ t: "cmd", cmd: "unlock" });
  await tick();
  assert.equal(host.views().at(-1).turnElapsedMs, 3000);
});

test("skip resets the turn age", async () => {
  const { hub, clock } = makeHub();
  const { host, started } = await gameWith(hub, { mode: "classic", timerStyle: "hidden", fuseMin: 30, fuseMax: 30 });
  await clock.advance(2000);
  host.send({ t: "cmd", cmd: "skip" });
  await tick();
  const v = host.views().at(-1);
  assert.notEqual(v.prompt.text, started.prompt.text, "a new prompt");
  assert.equal(v.mode.current, started.mode.current, "same player");
  assert.equal(v.turnElapsedMs, 0);
});

test("control views carry no moments and no turn age", async () => {
  const { hub, clock } = makeHub();
  const { host, code, hostToken, on, started } = await gameWith(hub, { mode: "classic", timerStyle: "hidden" });
  const ctl = connect(hub);
  ctl.send({ t: "control", code, hostToken, token: "overlay-tab" });
  await tick();
  await clock.advance(1000);
  on.send({ t: "submit", word: fitting(started.prompt) });
  await tick();
  assert.ok(host.views().at(-1).moments.length > 0);
  assert.ok(ctl.views().length > 0);
  for (const v of ctl.views()) {
    assert.equal(v.moments, undefined);
    assert.equal(v.turnElapsedMs, undefined);
  }
});

test("the projector view still has no score, ghostPoints, token or passcode", async () => {
  const { hub, clock } = makeHub();
  const { host, hostToken, on, off, started } = await gameWith(hub, { mode: "classic", timerStyle: "hidden", fuseMin: 5, fuseMax: 5, startLives: 1 });
  off.send({ t: "submit", word: fitting(started.prompt) }); // a silent answer scores privately
  on.send({ t: "submit", word: "zzzz" });
  await tick();
  await clock.advance(1000);
  on.send({ t: "submit", word: fitting(started.prompt) });
  await tick();
  await clock.advance(30_000);
  await tick();
  assert.equal(host.views().at(-1).phase, "results");
  const keys = new Set<string>();
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); }
  };
  host.views().forEach(walk);
  for (const k of ["score", "ghostPoints", "token", "hostToken", "passcode"]) assert.ok(!keys.has(k), k);
  const text = JSON.stringify(host.views());
  assert.ok(!text.includes(hostToken) && !text.includes(PASS) && !text.includes("tok-Ola") && !text.includes("zzzz"));
});

// ---- playing and commands ----

async function playingRoom(hub: Hub) {
  const r = await hostRoom(hub);
  const ola = await joinPlayer(hub, r.code, "Ola");
  const kari = await joinPlayer(hub, r.code, "Kari");
  r.host.send({ t: "cmd", cmd: "settings", settings: { mode: "everyone" } });
  r.host.send({ t: "cmd", cmd: "start" });
  assert.deepEqual(r.host.msgs.at(-1), { t: "result", ok: true });
  await tick();
  return { ...r, ola, kari };
}

test("submit routes to the room and replies with result", async () => {
  const { hub } = makeHub();
  const { host, ola } = await playingRoom(hub);
  const prompt = host.views().at(-1).prompt;
  assert.ok(prompt);
  ola.send({ t: "submit", word: "qqqq" });
  assert.deepEqual(ola.msgs.at(-1), { t: "result", ok: false, reason: "not-a-word" });

  host.send({ t: "submit", word: "station" });
  assert.deepEqual(host.msgs.at(-1), { t: "result", ok: false, reason: "not-player" });
});

test("submit of a fitting word is accepted with its kind", async () => {
  const { hub } = makeHub();
  const { host, ola } = await playingRoom(hub);
  const prompt = host.views().at(-1).prompt;
  const words = ["station", "stone", "ring", "king", "house", "round", "return", "remember", "last", "fast",
    "found", "ground", "repeat", "sing", "out"];
  const fits = words.find((w) =>
    prompt.type === "starts" ? w.startsWith(prompt.text) : prompt.type === "ends" ? w.endsWith(prompt.text) : w.includes(prompt.text));
  assert.ok(fits, `a fixture word fits ${prompt.type}:${prompt.text}`);
  ola.send({ t: "submit", word: fits });
  const r = ola.last("result");
  assert.equal(r.ok, true);
  assert.equal(typeof r.kind, "string");
});

test("commands from a player connection are refused with not-host", async () => {
  const { hub } = makeHub();
  const { host, code } = await hostRoom(hub);
  const p = await joinPlayer(hub, code, "Ola");
  await joinPlayer(hub, code, "Kari");
  host.clear();
  p.send({ t: "cmd", cmd: "start" });
  assert.deepEqual(p.msgs.at(-1), { t: "result", ok: false, reason: "not-host" });
  p.send({ t: "cmd", cmd: "lock" });
  assert.deepEqual(p.msgs.at(-1), { t: "result", ok: false, reason: "not-host" });
  const stranger = connect(hub);
  stranger.send({ t: "cmd", cmd: "start" });
  assert.deepEqual(stranger.msgs.at(-1), { t: "result", ok: false, reason: "not-host" });
  await tick();
  assert.equal(host.views().length, 0, "room unchanged");
});

test("host commands reach the engine and reply with a result", async () => {
  const { hub } = makeHub();
  const { host, code } = await hostRoom(hub);
  host.send({ t: "cmd", cmd: "start" });
  assert.deepEqual(host.msgs.at(-1), { t: "result", ok: false, reason: "need-2-players" });
  host.send({ t: "cmd", cmd: "lock" });
  assert.deepEqual(host.msgs.at(-1), { t: "result", ok: true });
  await tick();
  assert.equal(host.views().at(-1).locked, true);
  const late = connect(hub);
  late.send({ t: "join", code, token: "late", nickname: "Late" });
  assert.deepEqual(late.msgs.at(-1), { t: "error", reason: "locked" });
  host.send({ t: "cmd", cmd: "unlock" });
  const p = await joinPlayer(hub, code, "Ola");
  const pid = p.last("welcome").pid;
  host.send({ t: "cmd", cmd: "rename", pid, nickname: "Olav" });
  assert.deepEqual(host.msgs.at(-1), { t: "result", ok: true });
  host.send({ t: "cmd", cmd: "rename", pid: "nobody", nickname: "Olav" });
  assert.deepEqual(host.msgs.at(-1), { t: "result", ok: false, reason: "not-found" });
  host.send({ t: "cmd", cmd: "kick", pid: "nobody" });
  assert.deepEqual(host.msgs.at(-1), { t: "result", ok: false, reason: "not-found" });
  await tick();
  assert.equal(host.views().at(-1).players[0].nickname, "Olav");
});

test("pause, resume, skip, end and play again from a control connection", async () => {
  const { hub } = makeHub();
  const { host, code } = await playingRoom(hub);
  const ctl = connect(hub);
  ctl.send({ t: "control", code, passcode: PASS, token: "phone" });
  for (const [cmd, phase] of [["pause", "paused"], ["resume", "playing"], ["skip", "playing"], ["end", "results"], ["playAgain", "lobby"]]) {
    ctl.send({ t: "cmd", cmd });
    assert.deepEqual(ctl.msgs.at(-1), { t: "result", ok: true }, cmd);
    await tick();
    assert.equal(host.views().at(-1).phase, phase, cmd);
  }
});

test("kick sends kicked and closes with 4003, and the token cannot rejoin", async () => {
  const { hub } = makeHub();
  const { host, code } = await hostRoom(hub);
  const a = await joinPlayer(hub, code, "Ola", "ola");
  const b = await joinPlayer(hub, code, "Ola", "ola");
  const pid = a.last("welcome").pid;
  host.send({ t: "cmd", cmd: "kick", pid });
  assert.deepEqual(host.msgs.at(-1), { t: "result", ok: true });
  for (const c of [a, b]) {
    assert.deepEqual(c.msgs.at(-1), { t: "kicked" });
    assert.equal(c.closedWith?.[0], 4003);
  }
  a.closed(); b.closed();
  await tick();
  assert.equal(host.views().at(-1).players.length, 0);
  const back = connect(hub);
  back.send({ t: "join", code, token: "ola", nickname: "Ola" });
  assert.deepEqual(back.msgs.at(-1), { t: "error", reason: "kicked" });
});

// ---- robustness ----

test("malformed and oversized messages are ignored", async () => {
  const { hub } = makeHub();
  const { host, code } = await hostRoom(hub);
  const p = await joinPlayer(hub, code, "Ola");
  host.clear();
  for (const raw of ["nope", "{}", JSON.stringify({ t: "cmd", cmd: "boom" }), JSON.stringify({ t: "submit", word: "x".repeat(3000) })]) {
    p.message(raw);
    assert.deepEqual(p.msgs.at(-1), { t: "error", reason: "bad-message" });
    host.message(raw);
    assert.deepEqual(host.msgs.at(-1), { t: "error", reason: "bad-message" });
  }
  await tick();
  assert.equal(host.views().length, 0, "room unchanged");
});

test("rate limit drops floods", async () => {
  const { hub, clock } = makeHub();
  const { code } = await playingRoom(hub);
  const p = await joinPlayer(hub, code, "Nora");
  p.clear();
  for (let i = 0; i < 100; i++) p.send({ t: "submit", word: "qqqq" });
  const handled = p.msgs.filter((m) => m.t === "result").length;
  assert.ok(handled <= 20 && handled > 0, `handled ${handled}`);

  await clock.advance(1000);
  p.clear();
  for (let i = 0; i < 15; i++) p.send({ t: "typing", text: "st" });
  p.send({ t: "submit", word: "qqqq" });
  assert.equal(p.msgs.filter((m) => m.t === "result").length, 1, "typing beyond 10 is dropped, other messages still pass");
});

test("typing in Everyone at once sends nothing to anyone", async () => {
  const { hub } = makeHub();
  const { host, code, ola, kari } = await playingRoom(hub);
  const nora = await joinPlayer(hub, code, "Nora"); // joins mid-game as a watcher; still a connection
  await tick();
  const all = [host, ola, kari, nora];
  for (const c of all) c.clear();
  for (let i = 1; i <= 5; i++) {
    ola.send({ t: "typing", text: "st".repeat(i) });
    kari.send({ t: "typing", text: "a".repeat(i) });
  }
  await tick();
  for (const c of all) assert.equal(c.msgs.length, 0, "no view is broadcast for Everyone-at-once typing");
});

test("idle room is cleaned up and connections closed with 4004", async () => {
  const { hub, clock } = makeHub();
  const { host, code } = await hostRoom(hub);
  const p = await joinPlayer(hub, code, "Ola");
  await clock.advance(IDLE_MS - 60_000);
  p.send({ t: "typing", text: "a" }); // any valid message resets the idle timer
  await clock.advance(IDLE_MS - 1000);
  assert.equal(hub.roomCount(), 1);
  assert.equal(host.closedWith, undefined);
  await clock.advance(1000);
  assert.equal(hub.roomCount(), 0);
  assert.deepEqual(host.closedWith, [4004, "Room closed"]);
  assert.deepEqual(p.closedWith, [4004, "Room closed"]);
  const late = connect(hub);
  late.send({ t: "join", code, token: "x", nickname: "Kari" });
  assert.deepEqual(late.msgs.at(-1), { t: "error", reason: "no-room" });
});

// ---- exceptions never escape the hub ----

function catchUncaught() {
  const errors: unknown[] = [];
  const onErr = (e: unknown) => errors.push(e);
  process.on("uncaughtException", onErr);
  return { errors, stop: () => process.off("uncaughtException", onErr) };
}

test("a connection whose send throws does not stop the broadcast", async () => {
  const { hub, events } = makeHub();
  const { host, code } = await hostRoom(hub);
  const thrower = connect(hub);
  thrower.send({ t: "join", code, token: "bad", nickname: "Bad" });
  const brokenConn = (hub as any).rooms.get(code).clients;
  for (const k of brokenConn) if (k.pid === thrower.last("welcome").pid) k.conn = { send() { throw new Error("socket gone"); }, close() {} };
  const p = await joinPlayer(hub, code, "Ola");
  host.clear(); p.clear();
  const caught = catchUncaught();
  try {
    host.send({ t: "cmd", cmd: "lock" });
    await tick();
  } finally { caught.stop(); }
  assert.deepEqual(caught.errors, []);
  assert.equal(host.views().length, 1);
  assert.equal(p.views().length, 1);
  assert.ok(events.includes("broadcast-error"));
});

test("idle cleanup still deletes the room when a close throws", async () => {
  const { hub, clock, events } = makeHub();
  const { host, code } = await hostRoom(hub);
  const bad = connect(hub);
  bad.send({ t: "join", code, token: "bad", nickname: "Bad" });
  for (const k of (hub as any).rooms.get(code).clients) if (k.role === "player") k.conn = { send() {}, close() { throw new Error("already closed"); } };
  await clock.advance(IDLE_MS);
  assert.equal(hub.roomCount(), 0);
  assert.deepEqual(host.closedWith, [4004, "Room closed"]);
  assert.ok(events.includes("close-error"));
});

test("room limit: 21st room is refused with server-full", () => {
  const { hub } = makeHub();
  for (let i = 0; i < MAX_ROOMS; i++) {
    const c = connect(hub);
    c.send({ t: "create", passcode: PASS, token: `h${i}` });
    assert.equal(c.msgs.at(-1).t, "welcome");
  }
  const c = connect(hub);
  c.send({ t: "create", passcode: PASS, token: "h21" });
  assert.deepEqual(c.msgs.at(-1), { t: "error", reason: "server-full" });
  assert.equal(hub.roomCount(), MAX_ROOMS);
});

// ---- avatars ----

test("avatar: a free one is taken, another player's is refused as avatar-taken", async () => {
  const { hub } = makeHub();
  const { host, code } = await hostRoom(hub);
  const a = await joinPlayer(hub, code, "Ola");
  const b = await joinPlayer(hub, code, "Kari");
  await tick();
  const players = host.views().at(-1).players;
  const avA = players[0].avatar;
  const avB = players[1].avatar;
  b.send({ t: "avatar", avatar: avA });
  assert.deepEqual(b.msgs.at(-1), { t: "result", ok: false, reason: "avatar-taken" });
  const free = [...Array(60).keys()].find((i) => i !== avA && i !== avB)!;
  b.send({ t: "avatar", avatar: free });
  assert.deepEqual(b.msgs.at(-1), { t: "result", ok: true, kind: "avatar" });
  await tick();
  assert.equal(host.views().at(-1).players[1].avatar, free);
  assert.equal(a.views().at(-1).players[1].avatar, free, "the other player sees it too");
  assert.equal(b.views().at(-1).me.avatar, free);
});

test("avatar: changing during a game is avatar-locked; junk is a bad message; a host is not-player", async () => {
  const { hub } = makeHub();
  const { host, code, ola } = await playingRoom(hub);
  const before = host.views().at(-1).players.map((p: any) => p.avatar);
  const free = [...Array(60).keys()].find((i) => !before.includes(i))!;
  ola.send({ t: "avatar", avatar: free });
  assert.deepEqual(ola.msgs.at(-1), { t: "result", ok: false, reason: "avatar-locked" });
  for (const avatar of ["3", -1, 60, 2.5, null]) {
    ola.send({ t: "avatar", avatar });
    assert.deepEqual(ola.msgs.at(-1), { t: "error", reason: "bad-message" }, String(avatar));
  }
  host.send({ t: "avatar", avatar: free });
  assert.deepEqual(host.msgs.at(-1), { t: "result", ok: false, reason: "not-player" });
  const ctl = connect(hub);
  ctl.send({ t: "control", code, passcode: PASS, token: "phone" });
  ctl.send({ t: "avatar", avatar: free });
  assert.deepEqual(ctl.msgs.at(-1), { t: "result", ok: false, reason: "not-player" });
  const stranger = connect(hub);
  stranger.send({ t: "avatar", avatar: free });
  assert.deepEqual(stranger.msgs.at(-1), { t: "result", ok: false, reason: "not-player" });
  await tick();
  assert.deepEqual(host.views().at(-1).players.map((p: any) => p.avatar), before, "nobody's avatar changed");
});

test("showWords from a control connection moves every view to words; from a player it is not-host", async () => {
  const { hub } = makeHub();
  const { host, code, ola } = await playingRoom(hub);
  host.send({ t: "cmd", cmd: "end" });
  await tick();
  assert.equal(host.views().at(-1).results.step, "awards");
  assert.equal(ola.views().at(-1).results.step, "awards");
  ola.send({ t: "cmd", cmd: "showWords" });
  assert.deepEqual(ola.msgs.at(-1), { t: "result", ok: false, reason: "not-host" });
  await tick();
  assert.equal(host.views().at(-1).results.step, "awards");
  const ctl = connect(hub);
  ctl.send({ t: "control", code, passcode: PASS, token: "phone" });
  ctl.send({ t: "cmd", cmd: "showWords" });
  assert.deepEqual(ctl.msgs.at(-1), { t: "result", ok: true });
  await tick();
  assert.equal(host.views().at(-1).results.step, "words");
  assert.equal(ola.views().at(-1).results.step, "words");
});

test("a pending step timer is cleared when the room closes", async () => {
  const { hub, clock, events } = makeHub();
  const { host } = await playingRoom(hub);
  host.send({ t: "cmd", cmd: "end" });
  await tick();
  await clock.advance(IDLE_MS + 1);
  assert.equal(hub.roomCount(), 0);
  assert.ok(!events.includes("close-error"));
  assert.equal(clock.timers.size, 0);
});

// ---- silent and ghost sparks: who, never what ----

/** Three players with silent answers on. The host's window and a control window watch. */
async function sparkGame(mode: "classic" | "everyone") {
  const { hub, clock } = makeHub();
  const { host, code, hostToken } = await hostRoom(hub);
  const control = connect(hub);
  control.send({ t: "control", code, hostToken, token: "ctl-window" });
  const players = [await joinPlayer(hub, code, "Ola"), await joinPlayer(hub, code, "Kari"), await joinPlayer(hub, code, "Per")];
  host.send({ t: "cmd", cmd: "settings", settings: { mode, timerStyle: "visible", turnTime: 5, startLives: 1, maxLives: 1, silentAnswers: true } });
  host.send({ t: "cmd", cmd: "start" });
  await tick();
  const pids = new Map(players.map((p) => [p, p.last("welcome").pid as string]));
  const pidOf = (c: FakeConn) => pids.get(c)!;
  return { hub, clock, host, control, players, pidOf, mode };
}

/** Lets the clock run until one student is knocked out, and returns that student. */
async function makeGhost(g: Awaited<ReturnType<typeof sparkGame>>): Promise<FakeConn> {
  const used: string[] = [];
  for (let i = 0; i < 12; i++) {
    if (g.mode === "everyone") {
      // The first two answer every round, so only the third loses their life.
      const prompt = g.host.views().at(-1).prompt;
      const word = fitting(prompt, used);
      used.push(word);
      for (const p of g.players.slice(0, 2)) p.send({ t: "submit", word });
      await tick();
    }
    await g.clock.advance(5_000);
    await tick();
    const dead = g.host.views().at(-1).players?.find((p: any) => !p.alive);
    if (dead) return g.players.find((p) => g.pidOf(p) === dead.id)!;
  }
  throw new Error("nobody became a ghost");
}

test("an accepted silent answer adds a silent moment for that student", async () => {
  const { host, players, pidOf } = await sparkGame("classic");
  const v = host.views().at(-1);
  const off = players.find((p) => pidOf(p) !== v.mode.current)!;
  host.clear();
  off.send({ t: "submit", word: fitting(v.prompt) });
  assert.deepEqual(off.last("result"), { t: "result", ok: true, kind: "silent" });
  await tick();
  assert.equal(host.views().length, 1, "an accepted silent answer queues a broadcast");
  assert.deepEqual(host.views()[0].moments, [{ kind: "silent", pid: pidOf(off) }]);
  assert.deepEqual(players[0].views().at(-1).moments, [{ kind: "silent", pid: pidOf(off) }], "laptops too");
  assert.deepEqual((await poke(host)).moments, [], "not repeated");
});

test("an accepted ghost answer adds a ghost moment", async () => {
  const g = await sparkGame("classic");
  const ghost = await makeGhost(g);
  const v = await poke(g.host);
  g.host.clear();
  ghost.send({ t: "submit", word: fitting(v.prompt) });
  assert.deepEqual(ghost.last("result"), { t: "result", ok: true, kind: "ghost" });
  await tick();
  assert.deepEqual(g.host.views().at(-1).moments, [{ kind: "ghost", pid: g.pidOf(ghost) }]);
});

test("ghost moment in Everyone at once", async () => {
  const g = await sparkGame("everyone");
  const ghost = await makeGhost(g);
  const v = await poke(g.host);
  g.host.clear();
  ghost.send({ t: "submit", word: fitting(v.prompt) });
  assert.equal(ghost.last("result").kind, "ghost");
  await tick();
  assert.deepEqual(g.host.views().at(-1).moments, [{ kind: "ghost", pid: g.pidOf(ghost) }]);
});

test("refused silent or ghost answers add nothing", async () => {
  const g = await sparkGame("classic");
  const v = g.host.views().at(-1);
  const off = g.players.find((p) => g.pidOf(p) !== v.mode.current)!;
  g.host.clear();
  off.send({ t: "submit", word: "zzzz" });
  assert.equal(off.last("result").ok, false);
  await tick();
  assert.equal(g.host.views().length, 0, "no broadcast");
  const ghost = await makeGhost(g);
  g.host.clear();
  ghost.send({ t: "submit", word: "zzzz" });
  assert.equal(ghost.last("result").ok, false);
  await tick();
  assert.equal(g.host.views().length, 0, "no broadcast for a refused ghost word");
  assert.deepEqual((await poke(g.host)).moments, []);
});

test("two silent answers in one broadcast are both listed", async () => {
  const { host, players, pidOf } = await sparkGame("classic");
  const v = host.views().at(-1);
  const offs = players.filter((p) => pidOf(p) !== v.mode.current);
  assert.equal(offs.length, 2);
  host.clear();
  const [a, b] = offs;
  a.send({ t: "submit", word: fitting(v.prompt) });
  b.send({ t: "submit", word: fitting(v.prompt) });
  await tick();
  assert.equal(host.views().length, 1, "one broadcast");
  assert.deepEqual(host.views()[0].moments, [{ kind: "silent", pid: pidOf(a) }, { kind: "silent", pid: pidOf(b) }]);
});

test("no view contains the silent or ghost word", async () => {
  const g = await sparkGame("classic");
  const v = g.host.views().at(-1);
  const off = g.players.find((p) => g.pidOf(p) !== v.mode.current)!;
  const silentWord = fitting(v.prompt);
  const everyoneElse = (sender: FakeConn) => [g.host, g.control, ...g.players.filter((p) => p !== sender)];
  for (const c of [g.host, g.control, ...g.players]) c.clear();
  off.send({ t: "submit", word: silentWord });
  await tick();
  assert.equal(off.last("result").kind, "silent");
  for (const c of everyoneElse(off)) {
    const json = JSON.stringify(c.msgs.filter((m) => m.t === "view"));
    if (c !== g.control) assert.ok(json.includes('"silent"'), "the spark arrived (the control view carries no moments)");
    assert.ok(!json.includes(`"${silentWord}"`), "the silent word is in no other view");
  }
  // A ghost's word, seen by the host, the control window and the other laptops.
  const ghost = await makeGhost(g);
  const v2 = await poke(g.host);
  const ghostWord = fitting(v2.prompt);
  for (const c of [g.host, g.control, ...g.players]) c.clear();
  ghost.send({ t: "submit", word: ghostWord });
  await tick();
  assert.equal(ghost.last("result").kind, "ghost");
  for (const c of everyoneElse(ghost)) {
    const json = JSON.stringify(c.msgs.filter((m) => m.t === "view"));
    assert.ok(!json.includes(`"${ghostWord}"`), "the ghost word is in no other view");
  }
});
