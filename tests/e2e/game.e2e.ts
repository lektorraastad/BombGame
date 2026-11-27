// End-to-end tests: the real dev server, driven through Chromium with Playwright.
// Run with `npm run test:e2e`. Fails with a message when Playwright isn't found (scripts/playwright-path.ts).
import { test, before, after, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startDevServer } from "../../scripts/dev-server.ts";
import { findPlaywright, notFound } from "../../scripts/playwright-path.ts";

const PLAYWRIGHT = findPlaywright();
const HAVE_PLAYWRIGHT = PLAYWRIGHT !== null;
// Without Playwright nothing below can run: one failing test says why, so the run never passes empty.
if (!HAVE_PLAYWRIGHT) test("Playwright is installed", () => assert.fail(notFound()));

delete process.env.HOST_PASSCODE; // the dev server then uses "test"
const PASSCODE = "test";
const WAIT = 15_000;

const generated = (f: string) => readFileSync(new URL(`../../data/generated/${f}`, import.meta.url), "utf8").split("\n").filter(Boolean);
const KNOWN = HAVE_PLAYWRIGHT ? generated("known.txt") : [];

type Prompt = { text: string; type: "contains" | "starts" | "ends" };
const TYPE_OF: Record<string, Prompt["type"]> = { CONTAINS: "contains", "STARTS WITH": "starts", "ENDS WITH": "ends" };

/** A known word that fits the prompt, preferring ordinary lengths. */
function wordFor(p: Prompt): string {
  const t = p.text.toLowerCase();
  const fits = (w: string) =>
    p.type === "contains" ? w.includes(t) : p.type === "starts" ? w.startsWith(t) : w.endsWith(t);
  const found = KNOWN.find((w) => w.length >= 4 && w.length <= 9 && fits(w)) ?? KNOWN.find(fits);
  assert.ok(found, `no known word for ${p.type} ${p.text}`);
  return found;
}

/** The longest known word that fits the prompt (for checks on long words). */
function longWordFor(p: Prompt): string {
  const t = p.text.toLowerCase();
  const fits = (w: string) =>
    p.type === "contains" ? w.includes(t) : p.type === "starts" ? w.startsWith(t) : w.endsWith(t);
  const found = KNOWN.filter(fits).reduce((a, w) => (w.length > a.length ? w : a), "");
  assert.ok(found, `no known word for ${p.type} ${p.text}`);
  return found;
}

/** How many rows of tiles each matching element's tiles sit on, measured in one step (screens redraw often). */
async function tileRows(page: any, sel: string): Promise<number[]> {
  return page.evaluate((s: string) =>
    [...document.querySelectorAll(s)].map((el) => new Set([...el.querySelectorAll(".tile")].map((t) => Math.round((t as HTMLElement).offsetTop / 4))).size),
  sel);
}

let pw: any;
let browser: any;
let server: { url: string; close(): Promise<void> };
const contexts: any[] = [];
/** WebSocket players of the current test, closed after it. */
const sockets: WebSocket[] = [];
/** Script errors and console errors from any page; each test checks there were none. */
const pageErrors: string[] = [];

/** Each page gets its own browser context, as if on its own laptop. */
async function newPage(path: string, viewport = { width: 1280, height: 800 }): Promise<any> {
  const ctx = await browser.newContext({ viewport });
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => pageErrors.push(`${path}: ${e.message}`));
  page.on("console", (m: any) => {
    if (m.type() === "error") pageErrors.push(`${path}: ${m.text()}`);
  });
  await page.goto(server.url + path);
  return page;
}

/** Closes every page of the test, then checks no page had a script or console error. */
async function closeContexts(): Promise<void> {
  for (const ws of sockets.splice(0)) ws.close();
  await Promise.all(contexts.splice(0).map((c) => c.close()));
  assert.deepEqual(pageErrors.splice(0), []);
}

/** Opens /host, creates a room and returns the projector page and the room code. */
async function hostRoom(): Promise<{ host: any; code: string }> {
  const host = await newPage("/host");
  await host.fill("#passcode", PASSCODE);
  await host.click("#createbtn");
  const code = (await host.locator(".p-code").textContent({ timeout: WAIT })).trim();
  assert.match(code, /^[A-Z]{4}$/);
  return { host, code };
}

async function joinPlayer(code: string, nickname: string, viewport?: { width: number; height: number }): Promise<any> {
  const page = await newPage("/", viewport);
  await page.fill("#code", code);
  await page.fill("#nick", nickname);
  await page.click("#joinbtn");
  await page.locator("main.lobby").waitFor({ timeout: WAIT });
  return page;
}

/**
 * Changes settings the way the control panel does: a control connection with the projector tab's
 * host token sends {t:"cmd", cmd:"settings"}. Resolves once the server accepts them.
 */
async function settings(host: any, code: string, values: Record<string, unknown>): Promise<void> {
  const res = await host.evaluate(
    ({ code, values }: { code: string; values: Record<string, unknown> }) =>
      new Promise((resolve) => {
        const ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/api/ws");
        const hostToken = sessionStorage.getItem("bomb.hostToken");
        ws.onopen = () => ws.send(JSON.stringify({ t: "control", code, token: crypto.randomUUID(), hostToken }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(String(ev.data));
          if (m.t === "welcome") ws.send(JSON.stringify({ t: "cmd", cmd: "settings", settings: values }));
          else if (m.t === "result" || m.t === "error") {
            ws.close();
            resolve(m);
          }
        };
      }),
    { code, values },
  );
  assert.deepEqual(res, { t: "result", ok: true });
}

/** Opens the ⚙ overlay on the projector and returns its locator. */
async function openOverlay(host: any): Promise<any> {
  await host.click("#overlaybtn");
  const overlay = host.locator("#overlay");
  await overlay.locator(".ctl").waitFor({ timeout: WAIT });
  return overlay;
}

async function startFromOverlay(host: any): Promise<void> {
  const overlay = await openOverlay(host);
  await overlay.locator('button[data-cmd="start"]').click();
  await host.locator(".p-classic, .p-everyone").waitFor({ timeout: WAIT });
  await overlay.locator("#overlayclose").click();
}

/** The prompt the projector shows. */
async function projectorPrompt(host: any): Promise<Prompt> {
  const ask = (await host.locator(".p-ask").textContent({ timeout: WAIT })).trim();
  const text = (await host.locator(".p-prompt").textContent()).trim();
  return { text, type: TYPE_OF[ask] };
}

/** The player whose screen says it's their turn. */
async function playerOnTurn(players: any[]): Promise<any> {
  const deadline = Date.now() + WAIT;
  while (Date.now() < deadline) {
    for (const p of players) if ((await p.locator("main.turn-on").count()) > 0) return p;
    await players[0].waitForTimeout(50);
  }
  throw new Error("nobody's turn");
}

/** A player joined over the WebSocket API, as scripts/load-test.ts does. It keeps its latest view. */
async function wsPlayer(code: string, nickname: string): Promise<{ send(m: object): void; view(): any; close(): void }> {
  const ws = new WebSocket(server.url.replace(/^http/, "ws") + "/api/ws");
  let view: any = null;
  let welcomed: (ok: boolean) => void;
  const joined = new Promise<boolean>((r) => (welcomed = r));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.t === "view") view = m.view;
    else if (m.t === "welcome") welcomed(true);
    else if (m.t === "error") welcomed(false);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error(`${nickname}: could not connect`)));
  });
  ws.send(JSON.stringify({ t: "join", code, token: crypto.randomUUID(), nickname }));
  assert.equal(await joined, true, `${nickname} could not join`);
  sockets.push(ws);
  return { send: (m) => ws.send(JSON.stringify(m)), view: () => view, close: () => ws.close() };
}

type Box = { left: number; top: number; right: number; bottom: number };
type Layout = { seats: number; ring1: number; seatBoxes: (Box & { name: string })[]; circle: Box; bomb: Box };

/**
 * Every seat on a circle, measured in one step (screens redraw often). A seat's box covers everything
 * drawn in it (emoji, name, hearts, word, badges), so a part that sticks out counts as the seat.
 */
async function circleLayout(page: any, circleSel: string): Promise<Layout> {
  // No named helper functions in here: tsx's name-keeping wrapper doesn't exist in the page.
  return page.evaluate((sel: string) => {
    const circle = document.querySelector(sel) as HTMLElement;
    const seatEls = [...circle.querySelectorAll(":scope > .seat")];
    const [c, bomb] = [circle, circle.querySelector("[data-bomb]")!].map((el) => el.getBoundingClientRect());
    const seatBoxes = seatEls.map((el) => {
      const r0 = el.getBoundingClientRect();
      const b = { left: r0.left, top: r0.top, right: r0.right, bottom: r0.bottom };
      for (const d of el.querySelectorAll("*")) {
        const r = d.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        b.left = Math.min(b.left, r.left);
        b.top = Math.min(b.top, r.top);
        b.right = Math.max(b.right, r.right);
        b.bottom = Math.max(b.bottom, r.bottom);
      }
      return { ...b, name: el.querySelector(".name")?.textContent ?? "" };
    });
    return {
      seats: seatEls.length,
      ring1: seatEls.filter((el) => el.classList.contains("ring-1")).length,
      seatBoxes,
      circle: { left: c.left, top: c.top, right: c.right, bottom: c.bottom },
      bomb: { left: bomb.left, top: bomb.top, right: bomb.right, bottom: bomb.bottom },
    };
  }, circleSel);
}

/**
 * How the countdown number sits on the bomb: the distance from the bomb's middle to the lower corners
 * of the digits' ink, against the inner edge of the bomb's light rim (bomb.js draws the body with
 * radius 34 and a 4-wide rim in a 120 box, so the rim starts 32 units out). Positive "clear" means
 * the digits end inside the dark body.
 */
async function countdownClearance(page: any, root: string): Promise<{ clear: number; text: string }> {
  return page.evaluate((sel: string) => {
    const count = document.querySelector(`${sel} [data-countdown]`) as HTMLElement;
    const bomb = document.querySelector(`${sel} [data-bomb]`)!.getBoundingClientRect();
    const r = count.getBoundingClientRect();
    const cs = getComputedStyle(count);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText(count.textContent ?? "");
    const k = r.width / m.width; // tabular figures may be wider than the canvas's
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize);
    const baseline = r.top + (lineHeight - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const bottom = baseline + m.actualBoundingBoxDescent;
    const [left, right] = [r.left - m.actualBoundingBoxLeft * k, r.left + m.actualBoundingBoxRight * k];
    const cx = bomb.left + bomb.width / 2, cy = bomb.top + bomb.height / 2;
    const corner = Math.max(Math.hypot(left - cx, bottom - cy), Math.hypot(right - cx, bottom - cy));
    return { clear: (32 / 120) * bomb.width - corner, text: count.textContent ?? "" };
  }, root);
}

/**
 * How far the arrow is off the current seat, in degrees: the direction from the bomb's middle to the
 * arrow's middle against the direction to the middle of the current seat. On the projector, or on a
 * student screen with root "main".
 */
async function arrowError(page: any, root = "#projector"): Promise<number> {
  return page.evaluate((sel: string) => {
    const bomb = document.querySelector(`${sel} [data-bomb]`)!.getBoundingClientRect();
    const arrow = document.querySelector(`${sel} .bomb-arrow polygon`)!.getBoundingClientRect();
    const seat = document.querySelector(`${sel} .seat.on`)!.getBoundingClientRect();
    const [cx, cy] = [bomb.left + bomb.width / 2, bomb.top + bomb.height / 2];
    const a = Math.atan2(arrow.left + arrow.width / 2 - cx, cy - (arrow.top + arrow.height / 2));
    const b = Math.atan2(seat.left + seat.width / 2 - cx, cy - (seat.top + seat.height / 2));
    return Math.abs(((((a - b) * 180) / Math.PI + 540) % 360) - 180);
  }, root);
}

/** Words of seat names (names with a space) that are split across two lines, measured in one step. */
async function splitNameWords(page: any, circleSel: string): Promise<string[]> {
  return page.evaluate((sel: string) => {
    const split: string[] = [];
    for (const el of document.querySelectorAll(`${sel} .seat .name`)) {
      const text = el.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE || !/\s/.test(text.textContent ?? "")) continue;
      for (const m of (text.textContent ?? "").matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, m.index!);
        range.setEnd(text, m.index! + m[0].length);
        const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        if (tops.size > 1) split.push(m[0]);
      }
    }
    return split;
  }, circleSel);
}

/** Overlaps of more than half a pixel each way (sub-pixel rounding is not an overlap). */
const overlaps = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/** How much two boxes overlap, for the failure message. */
const by = (a: Box, b: Box) =>
  `by ${(Math.min(a.right, b.right) - Math.max(a.left, b.left)).toFixed(1)}×${(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)).toFixed(1)} px`;

/** What is wrong with a circle's layout: seats on top of each other or the bomb, or outside the circle. */
function layoutProblems(l: Layout): string[] {
  const out: string[] = [];
  const s = l.seatBoxes;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) if (overlaps(s[i], s[j])) out.push(`${s[i].name} overlaps ${s[j].name} ${by(s[i], s[j])}`);
    if (overlaps(s[i], l.bomb)) out.push(`${s[i].name} overlaps the bomb ${by(s[i], l.bomb)}`);
    const c = l.circle;
    if (s[i].left < c.left - 0.5 || s[i].top < c.top - 0.5 || s[i].right > c.right + 0.5 || s[i].bottom > c.bottom + 0.5) {
      out.push(`${s[i].name} is outside the circle`);
    }
  }
  return out;
}

type SpotLayout = Layout & {
  spot: Box | null; spotText: string; arrow: Box | null; bombCx: number; bombCy: number; bombSize: number;
  minName: number; prompt: number; parts: { name: string; boxes: Box[] }[];
  /** The whole screen's box (#projector or the student's main), and the example answers' line. */
  screen: Box; examples: Box | null;
};

/**
 * A circle with its spotlight, measured in one step: the seats, the bomb, the spotlight's box and
 * text, the arrow's box, the smallest name's font size (the seat on its turn is a little bigger, so
 * every seat counts) and the prompt letters' font size.
 */
async function spotlightLayout(page: any, root: string): Promise<SpotLayout> {
  const l = await circleLayout(page, `${root} .circle`);
  const rest = await page.evaluate((sel: string) => {
    const spot = document.querySelector(`${sel} .circle > .spotlight`);
    const arrow = document.querySelector(`${sel} .bomb-arrow polygon`);
    const bomb = document.querySelector(`${sel} [data-bomb]`)!.getBoundingClientRect();
    const [s, a, screen, examples] = [spot, arrow, document.querySelector(sel), document.querySelector(`${sel} .p-examples`)].map((el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    // Each drawn part of each seat (emoji, name, hearts, word, badges), with anything inside it.
    const parts = [...document.querySelectorAll(`${sel} .circle > .seat`)].map((seat) => ({
      name: seat.querySelector(".name")?.textContent ?? "",
      boxes: [...seat.children].map((part) => {
        const r0 = part.getBoundingClientRect();
        const b = { left: r0.left, top: r0.top, right: r0.right, bottom: r0.bottom };
        for (const d of part.querySelectorAll("*")) {
          const r = d.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          b.left = Math.min(b.left, r.left);
          b.top = Math.min(b.top, r.top);
          b.right = Math.max(b.right, r.right);
          b.bottom = Math.max(b.bottom, r.bottom);
        }
        return b;
      }).filter((b) => b.right > b.left && b.bottom > b.top),
    }));
    const names = [...document.querySelectorAll(`${sel} .circle > .seat .name`)].map((el) => parseFloat(getComputedStyle(el).fontSize));
    const prompt = document.querySelector(`${sel} .p-prompt`);
    return {
      parts, spot: s, arrow: a, screen: screen!, examples, spotText: spot?.textContent ?? "",
      bombCx: bomb.left + bomb.width / 2, bombCy: bomb.top + bomb.height / 2, bombSize: bomb.width,
      minName: Math.min(...names), prompt: prompt ? parseFloat(getComputedStyle(prompt).fontSize) : 0,
    };
  }, root);
  return { ...l, ...rest };
}

/**
 * What is wrong with the seats, part by part: a drawn part of one seat (emoji, name, hearts, word)
 * on a part of another seat, on the bomb or on the example answers' line, or outside `within` (the
 * circle, or for a narrow oval the whole screen: then a long name may reach a little past the
 * circle at the side, but never off the screen or under the ⚙ overlay). Unlike layoutProblems, two
 * seats' boxes may meet at their empty corners (a long word under one seat, beside the next seat's
 * hearts), as long as nothing drawn is covered.
 */
function seatPartProblems(l: SpotLayout, within: "circle" | "screen" = "circle"): string[] {
  const out: string[] = [];
  const p = l.parts;
  const c = within === "circle" ? l.circle : l.screen;
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      for (const a of p[i].boxes) for (const b of p[j].boxes) if (overlaps(a, b)) out.push(`${p[i].name} overlaps ${p[j].name} ${by(a, b)}`);
    }
    for (const a of p[i].boxes) {
      if (overlaps(a, l.bomb)) out.push(`${p[i].name} overlaps the bomb ${by(a, l.bomb)}`);
      const past = Math.max(c.left - a.left, c.top - a.top, a.right - c.right, a.bottom - c.bottom);
      if (past > 0.5) out.push(`${p[i].name} is ${past.toFixed(1)} px outside the ${within}`);
      if (l.examples && overlaps(a, l.examples)) out.push(`${p[i].name} overlaps the example answers ${by(a, l.examples)}`);
    }
  }
  return [...new Set(out)];
}

/**
 * What is wrong with the spotlight: missing, on a seat, the bomb or the arrow, within the arrow's
 * reach at any angle (its tip is 0.6 x the bomb's size from the middle), or outside the circle.
 */
function spotlightProblems(l: SpotLayout): string[] {
  const s = l.spot;
  if (!s) return ["no spotlight"];
  const out: string[] = [];
  for (const seat of l.parts) for (const b of seat.boxes) if (overlaps(s, b)) out.push(`the spotlight overlaps ${seat.name} ${by(s, b)}`);
  if (overlaps(s, l.bomb)) out.push(`the spotlight overlaps the bomb ${by(s, l.bomb)}`);
  if (l.arrow && overlaps(s, l.arrow)) out.push(`the spotlight overlaps the arrow ${by(s, l.arrow)}`);
  const reach = l.bombCy + 0.6 * l.bombSize;
  if (s.top < reach) out.push(`the spotlight's top is ${(reach - s.top).toFixed(1)} px within the arrow's reach`);
  const c = l.circle;
  if (s.left < c.left - 0.5 || s.top < c.top - 0.5 || s.right > c.right + 0.5 || s.bottom > c.bottom + 0.5) out.push("the spotlight is outside the circle");
  return out;
}

/** A class of 15 for the spotlight checks: 14 players over the WebSocket API and one on a laptop (the last). */
const SPOT_NAMES = ["Ingrid", "Ola", "Jonas", "Kristian Johnsen", "Emil", "Aisha", "Mats", "Nora", "Filip", "Ella", "Oskar", "Maja", "Henrik", "Leah", "Sander"];
const LAPTOP_VIEWPORT = { width: 1366, height: 768 };

/**
 * Classic with `names` (the class of 15 unless given) and live typing. One lap, so every seat holds
 * a last word: every third seat, from the second (a top corner), a long one of 10 to 12 letters, the
 * others 7 to 9 letters. Then a player over the API (so the laptop student is waiting) is on and has
 * typed `typed`.
 */
async function spotlightRoom(typed: string, names = SPOT_NAMES): Promise<{ host: any; student: any }> {
  const { host, code } = await hostRoom();
  const bots: Awaited<ReturnType<typeof wsPlayer>>[] = [];
  for (const name of names.slice(0, -1)) bots.push(await wsPlayer(code, name));
  const studentName = names[names.length - 1];
  const student = await joinPlayer(code, studentName, LAPTOP_VIEWPORT);
  await host.locator(".seat").nth(names.length - 1).waitFor({ timeout: WAIT });
  await host.setViewportSize({ width: 1920, height: 1080 });
  await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 60, promptTypes: ["contains"], liveTyping: true });
  await startFromOverlay(host);
  const order = await host.locator("#projector .seat .name").allTextContents();
  const long = new Set(order.filter((_: string, i: number) => i % 3 === 1));

  const used = new Set<string>();
  const pick = (p: Prompt, wantLong: boolean) => {
    const t = p.text.toLowerCase();
    const fits = (w: string) => w.includes(t) && !used.has(w);
    const longWord = wantLong ? KNOWN.filter((x) => x.length >= 10 && x.length <= 12 && fits(x)).sort((a, b) => b.length - a.length)[0] : undefined;
    const w = longWord ?? KNOWN.find((x) => x.length >= 7 && x.length <= 9 && fits(x)) ?? KNOWN.find((x) => x.length >= 4 && x.length <= 10 && fits(x)) ?? KNOWN.find(fits);
    assert.ok(w, `no word for ${t}`);
    used.add(w);
    return w;
  };
  const play = async (bot: Awaited<ReturnType<typeof wsPlayer>> | null, name: string) => {
    const word = pick(await projectorPrompt(host), long.has(name));
    if (bot) bot.send({ t: "submit", word });
    else {
      await student.fill("#word", word);
      await student.press("#word", "Enter");
    }
    // The whole word: an earlier word may start with this one ("actually", then "actual").
    await host.locator(".seat .last-word", { hasText: new RegExp(`^${word}$`) }).waitFor({ timeout: WAIT });
  };
  /** Who is on: a bot that hasn't played yet (bots' views can lag a moment behind), or the student. */
  const played = new Set<string>();
  const whoIsOn = async (fresh: boolean) => {
    const deadline = Date.now() + WAIT;
    while (Date.now() < deadline) {
      const bot = bots.find((b) => b.view()?.me?.isOn && (!fresh || !played.has(b.view().me.nickname)));
      if (bot) return { bot, name: bot.view().me.nickname as string };
      if ((!fresh || !played.has(studentName)) && (await student.locator("main.turn-on").count()) > 0) return { bot: null, name: studentName };
      await host.waitForTimeout(50);
    }
    throw new Error("nobody's turn");
  };
  for (let k = 0; k < names.length; k++) {
    const { bot, name } = await whoIsOn(true);
    played.add(name);
    await play(bot, name);
  }
  let on = await whoIsOn(false);
  if (!on.bot) {
    await play(null, studentName);
    on = await whoIsOn(false);
  }
  on.bot!.send({ t: "typing", text: typed });
  for (const page of [host, student]) await page.locator(".circle > .spotlight", { hasText: typed }).waitFor({ timeout: WAIT });
  await host.waitForTimeout(800); // the arrow's swing and any redraws settle
  return { host, student };
}

/** The checks every spotlight layout must pass. */
async function checkSpotlight(
  page: any, root: string, typed: string, where: string, { seats = 15, within = "circle" as "circle" | "screen" } = {},
): Promise<SpotLayout> {
  const l = await spotlightLayout(page, root);
  assert.equal(l.seats, seats, where);
  assert.deepEqual(seatPartProblems(l, within), [], where);
  assert.deepEqual(spotlightProblems(l), [], where);
  assert.equal(l.spotText, typed, `${where}: the spotlight shows the typing`);
  assert.equal(await page.locator(`${root} .seat.on .last-word, ${root} .seat.on .typing`).count(), 0, `${where}: nothing under the name on its turn`);
  const c = await countdownClearance(page, root);
  assert.ok(c.clear >= 1, `${where}: "${c.text}" is ${(-c.clear).toFixed(1)} px over the rim`);
  return l;
}

describe("bomb game end to end", { skip: HAVE_PLAYWRIGHT ? false : "Playwright is not installed" }, () => {
  before(async () => {
    pw = await import(PLAYWRIGHT!);
    browser = await pw.chromium.launch();
  });
  // A fresh server for each test: rooms stay in memory for 30 minutes, and one server holds at most
  // MAX_ROOMS (20), which this suite has more tests than.
  beforeEach(async () => {
    server = await startDevServer(0);
  });
  // Runs even when a test throws, so one failure doesn't leave pages open for the next test.
  afterEach(async () => {
    try {
      await closeContexts();
    } finally {
      await server?.close();
    }
  });
  after(async () => {
    await browser?.close();
  });

  test("host creates a room and three players join", async () => {
    const { host, code } = await hostRoom();
    for (const name of ["Ann", "Ben", "Cat"]) await joinPlayer(code, name);
    const names = host.locator(".seat .name");
    await assert.doesNotReject(names.nth(2).waitFor({ timeout: WAIT }));
    assert.deepEqual(await names.allTextContents(), ["Ann", "Ben", "Cat"]);
    assert.match(await host.locator(".p-count").textContent(), /3 joined/);
  });

  test("emoji picker: another student's emoji is taken, a free one shows on the projector", async () => {
    const { host, code } = await hostRoom();
    const ann = await joinPlayer(code, "Ann");
    const ben = await joinPlayer(code, "Ben");
    const annsPick = ann.locator('.picker button[aria-pressed="true"]');
    await annsPick.waitFor({ timeout: WAIT });
    const annAvatar = await annsPick.getAttribute("data-avatar");
    assert.ok(annAvatar !== null);

    // Ben's picker shows Ann's emoji as taken.
    const taken = ben.locator(`.picker button[data-avatar="${annAvatar}"]`);
    await taken.waitFor({ timeout: WAIT });
    assert.equal(await taken.isDisabled(), true);
    assert.match((await taken.getAttribute("class")) ?? "", /\btaken\b/);
    assert.equal(await ben.locator(".picker button[disabled]").count(), 1);

    // Ben picks a free one: his picker and the projector's lobby show it.
    const free = ben.locator('.picker button:not([disabled])[aria-pressed="false"]').first();
    const freeAvatar = await free.getAttribute("data-avatar");
    const label = await free.getAttribute("aria-label");
    await free.click();
    await ben.locator(`.picker button[data-avatar="${freeAvatar}"][aria-pressed="true"]`).waitFor({ timeout: WAIT });
    await host.locator(".seat", { hasText: "Ben" }).locator(`img[alt="${label}"]`).waitFor({ timeout: WAIT });
    // And Ann's picker now shows Ben's new emoji as taken.
    await ann.locator(`.picker button[data-avatar="${freeAvatar}"][disabled]`).waitFor({ timeout: WAIT });
    assert.deepEqual(await host.locator(".seat .name").allTextContents(), ["Ann", "Ben"]);
  });

  test("classic: valid word passes the turn and shows Last word", async () => {
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann"), await joinPlayer(code, "Ben")];
    await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 60, promptTypes: ["contains"] });
    await startFromOverlay(host);

    const on = await playerOnTurn(players);
    const other = players.find((p) => p !== on);
    const word = wordFor(await projectorPrompt(host));
    await on.fill("#word", word);
    await on.press("#word", "Enter");

    await host.locator(".seat .last-word", { hasText: word }).waitFor({ timeout: WAIT });
    await other.locator("main.turn-on").waitFor({ timeout: WAIT });
    await on.locator("main.waiting").waitFor({ timeout: WAIT });
    // The last word sits under the player's name on their own circle too.
    await on.locator(".seat .last-word", { hasText: word }).waitFor({ timeout: WAIT });
  });

  test("explosion costs a life and shows example answers", async () => {
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann"), await joinPlayer(code, "Ben")];
    await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 5, startLives: 2, exampleAnswers: true });
    await startFromOverlay(host);

    const on = await playerOnTurn(players);
    // Their own hearts, in the corner (the seats on the circle have hearts too).
    assert.equal(await on.locator(".corner .lives").textContent(), "❤❤");
    // Nobody answers: the 5 s bomb goes off.
    await host.locator(".p-examples", { hasText: "Could have said:" }).waitFor({ timeout: WAIT });
    await on.locator(".corner .lives", { hasText: /^❤$/ }).waitFor({ timeout: WAIT });
  });

  test("ghost: knocked-out player sees the ghost panel", async () => {
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann"), await joinPlayer(code, "Ben"), await joinPlayer(code, "Cat")];
    await settings(host, code, {
      mode: "classic",
      timerStyle: "visible",
      turnTime: 5,
      startLives: 1,
      knockout: "ghost",
      promptTypes: ["contains"],
    });
    await startFromOverlay(host);

    const out = await playerOnTurn(players);
    const ghost = out.locator("main.ghost");
    await ghost.waitFor({ timeout: WAIT });
    assert.match(await ghost.locator("h1").textContent(), /YOU'RE OUT/);
    assert.match(await ghost.locator(".ghostscore").textContent(), /Ghost points: 0/);

    // A ghost's word scores a private ghost point.
    const word = wordFor(await projectorPrompt(host));
    await out.fill("#word", word);
    await out.press("#word", "Enter");
    await out.locator(".result.good", { hasText: "+1 ghost point" }).waitFor({ timeout: WAIT });
    await out.locator(".ghostscore", { hasText: "Ghost points: 1" }).waitFor({ timeout: WAIT });
  });

  test("student laptop (1366×768): the picker in view in the lobby; the circle and the text box without scrolling", async () => {
    const LAPTOP = { width: 1366, height: 768 };
    /**
     * The element is wholly inside the window, and the page isn't scrolled. Found and measured in one
     * step: the screen is redrawn often (each view, and while a player's pop runs), so an element
     * found earlier may already have been replaced.
     */
    const inView = (page: any, sel: string) =>
      page.evaluate((s: string) => {
        const el = document.querySelector(s);
        const r = el?.getBoundingClientRect();
        return !!r && r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && scrollY === 0;
      }, sel);
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann", LAPTOP), await joinPlayer(code, "Ben", LAPTOP), await joinPlayer(code, "Cat", LAPTOP)];
    for (const p of players) {
      assert.equal(await inView(p, "main.lobby h1"), true, "You're in!");
      assert.equal(await inView(p, ".picker-grid"), true, "the whole picker");
    }
    // Easy "contains" prompts only: each has a known word of 11 letters or more, for the long-word
    // check below. (Some harder prompts, or "starts"/"ends" ones, have none longer than 9 or 10.)
    await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 60, liveTyping: true, band: "easy", promptTypes: ["contains"] });
    await startFromOverlay(host);

    const on = await playerOnTurn(players);
    for (const p of players) {
      await p.locator("main .circle.compact .seat").nth(2).waitFor({ timeout: WAIT });
      assert.equal(await inView(p, "#word"), true, "the text box");
      assert.equal(await inView(p, ".circle.compact"), true, "the circle");
      assert.equal(await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, "nothing to scroll");
    }

    // Typed letters show as tiles in the box, which keeps the focus, and on the others' circles.
    await on.locator("#word").pressSequentially("qz");
    await on.locator("#word-tiles .tile").nth(1).waitFor({ timeout: WAIT });
    assert.equal(await on.locator("#word-tiles").textContent(), "qz");
    assert.equal(await on.evaluate(() => document.activeElement?.id), "word");
    const other = players.find((p) => p !== on);
    await other.locator(".circle .spotlight", { hasText: "qz" }).waitFor({ timeout: WAIT });
    // After the views that typing brings (each one redraws the screen), the box still shows the letters.
    await on.waitForTimeout(300);
    assert.equal(await on.locator("#word").inputValue(), "qz");
    assert.equal(await on.locator("#word-tiles").textContent(), "qz");

    // A long word being typed stays one row of tiles on the others' circles.
    await on.locator("#word").pressSequentially("qzqzqzqzqzqz");
    const long = "qz".repeat(7);
    await other.locator(".circle .spotlight", { hasText: long }).waitFor({ timeout: WAIT });
    assert.deepEqual(await tileRows(other, ".circle .spotlight"), [1]);

    // A long last word stays one row of tiles on every student's circle.
    await on.fill("#word", "");
    const word = longWordFor(await projectorPrompt(host));
    assert.ok(word.length >= 11, word);
    await on.fill("#word", word);
    await on.press("#word", "Enter");
    for (const p of players) {
      await p.locator(".seat .last-word", { hasText: word }).waitFor({ timeout: WAIT });
      const rows = await tileRows(p, ".circle.compact .seat .last-word");
      assert.ok(rows.length > 0 && rows.every((r) => r === 1), `${word}: ${rows}`);
    }
  });

  test("kick: kicked player sees the removed message and cannot rejoin", async () => {
    const { host, code } = await hostRoom();
    await joinPlayer(code, "Ann");
    const ben = await joinPlayer(code, "Ben");
    const overlay = await openOverlay(host);
    const row = overlay.locator("tr", { hasText: "Ben" });
    await row.locator("button.kick").click();
    await row.locator("button.kick", { hasText: "Really kick?" }).click();

    await ben.locator("h1", { hasText: "You were removed from the game" }).waitFor({ timeout: WAIT });
    await overlay.locator("#overlayclose").click();
    await host.locator(".p-count", { hasText: "1 joined" }).waitFor({ timeout: WAIT });

    // Same tab (same token) tries again.
    await ben.goto(server.url + "/");
    await ben.fill("#code", code);
    await ben.fill("#nick", "Ben");
    await ben.click("#joinbtn");
    await ben.locator("#joinerror", { hasText: /removed/ }).waitFor({ timeout: WAIT });
    assert.equal(await ben.locator("#game").isHidden(), true);
    assert.deepEqual(await host.locator(".seat .name").allTextContents(), ["Ann"]);

    // A new tab in the same browser has a new token, but the kick is remembered in localStorage.
    const tab = await ben.context().newPage();
    await tab.goto(server.url + "/");
    await tab.fill("#code", code);
    await tab.fill("#nick", "Ben2");
    await tab.click("#joinbtn");
    await tab.locator("#joinerror", { hasText: "You were removed from this game" }).waitFor({ timeout: WAIT });
    assert.equal(await tab.locator("#game").isHidden(), true);
    await host.waitForTimeout(300);
    assert.deepEqual(await host.locator(".seat .name").allTextContents(), ["Ann"]);
  });

  test("the student join page has no link to /host", async () => {
    const page = await newPage("/");
    assert.equal(await page.locator('a[href="/host"]').count(), 0);
  });

  test("projector refresh keeps the game", async () => {
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann"), await joinPlayer(code, "Ben")];
    await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 60 });
    await startFromOverlay(host);
    const before = await projectorPrompt(host);

    await host.reload();
    await host.locator(".p-classic").waitFor({ timeout: WAIT });
    assert.deepEqual(await projectorPrompt(host), before);
    assert.equal((await host.locator(".seat .name").allTextContents()).sort().join(), "Ann,Ben");
    assert.equal(await host.locator("#start").isHidden(), true);

    // The game still plays after the refresh.
    const on = await playerOnTurn(players);
    const word = wordFor(before);
    await on.fill("#word", word);
    await on.press("#word", "Enter");
    await host.locator(".seat .last-word", { hasText: word }).waitFor({ timeout: WAIT });
  });

  test("a closed projector tab is reattached in a new browser with code and passcode", async () => {
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann"), await joinPlayer(code, "Ben")];
    await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 60 });
    await startFromOverlay(host);
    const before = await projectorPrompt(host);
    await host.context().close(); // the projector tab crashed: its host token is gone

    const again = await newPage("/host");
    // A wrong passcode is refused and leaves the form usable.
    await again.fill("#rejoincode", code.toLowerCase());
    await again.fill("#rejoinpass", "wrong");
    await again.click("#rejoinbtn");
    await again.locator("#rejoinerror", { hasText: /passcode/i }).waitFor({ timeout: WAIT });
    await again.fill("#rejoinpass", PASSCODE);
    await again.click("#rejoinbtn");
    await again.locator(".p-classic").waitFor({ timeout: WAIT });
    assert.deepEqual(await projectorPrompt(again), before);
    assert.equal((await again.locator(".seat .name").allTextContents()).sort().join(), "Ann,Ben");
    assert.equal(await again.locator("#start").isHidden(), true);
    assert.equal(await again.locator("#rejoinpass").inputValue(), "");

    // The game still plays, and the new tab can open the overlay with the host token it was given.
    const on = await playerOnTurn(players);
    const word = wordFor(before);
    await on.fill("#word", word);
    await on.press("#word", "Enter");
    await again.locator(".seat .last-word", { hasText: word }).waitFor({ timeout: WAIT });
    await openOverlay(again);
  });

  test("no passcode set: the host page says where to set it in Netlify", async () => {
    process.env.HOST_PASSCODE = "";
    const bare = await startDevServer(0);
    delete process.env.HOST_PASSCODE;
    try {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const host = await ctx.newPage();
      await host.goto(bare.url + "/host");
      await host.fill("#passcode", "anything");
      await host.click("#createbtn");
      const msg = host.locator("#createerror", { hasText: "HOST_PASSCODE" });
      await msg.waitFor({ timeout: WAIT });
      assert.match(await msg.textContent(), /Project configuration → Environment variables/);
    } finally {
      await Promise.all(contexts.splice(0).map((c) => c.close()));
      await bare.close();
    }
  });

  test("control on a second page (phone size) can pause and resume", async () => {
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann"), await joinPlayer(code, "Ben")];
    const phone = await newPage("/control", { width: 390, height: 844 });
    await phone.fill("#code", code);
    await phone.fill("#passcode", PASSCODE);
    await phone.click("#controlbtn");
    await phone.locator("#panel .ctl").waitFor({ timeout: WAIT });
    assert.equal(await phone.locator("#passcode").inputValue(), "");

    await phone.click('button[data-cmd="start"]');
    await host.locator(".p-classic").waitFor({ timeout: WAIT });

    await phone.click('button[data-cmd="pause"]');
    await host.locator(".p-paused").waitFor({ timeout: WAIT });
    await players[0].locator(".banner", { hasText: "Paused by the host" }).waitFor({ timeout: WAIT });

    await phone.click('button[data-cmd="resume"]');
    await host.locator(".p-paused").waitFor({ state: "detached", timeout: WAIT });
    await phone.locator('button[data-cmd="pause"]').waitFor({ timeout: WAIT });
  });
  test("control panel: Gentle gives 3 hearts; a change under More settings makes it Custom and the fold stays open", async () => {
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann"), await joinPlayer(code, "Ben")];
    const ctl = await newPage("/control", { width: 1366, height: 768 });
    await ctl.fill("#code", code);
    await ctl.fill("#passcode", PASSCODE);
    await ctl.click("#controlbtn");
    await ctl.locator("#panel .ctl").waitFor({ timeout: WAIT });
    await ctl.locator(".ctl", { hasText: "Using: Normal" }).waitFor({ timeout: WAIT });
    assert.equal(await ctl.locator('select[name="mode"]').inputValue(), "classic");

    await ctl.click('button[data-preset="gentle"]');
    await ctl.locator('button[data-preset="gentle"][aria-pressed="true"]').waitFor({ timeout: WAIT });
    await ctl.locator(".ctl", { hasText: "Using: Gentle" }).waitFor({ timeout: WAIT });
    await ctl.click('button[data-cmd="start"]');
    await host.locator(".p-classic").waitFor({ timeout: WAIT });
    for (const p of players) await p.locator(".corner .lives", { hasText: /^❤❤❤$/ }).waitFor({ timeout: WAIT });
    assert.ok(await ctl.locator('button[data-preset="fast"]').isDisabled(), "locked while the game runs");

    await ctl.click('button[data-cmd="end"]');
    await ctl.locator('button[data-cmd="playAgain"]:not([disabled])').waitFor({ timeout: WAIT });
    const more = ctl.locator("details.more");
    assert.equal(await more.getAttribute("open"), null, "folded at first");
    await ctl.click("details.more > summary");
    await ctl.locator("details.more[open]").waitFor({ timeout: WAIT });
    const fuse = ctl.getByLabel("Shortest fuse");
    await fuse.fill("12");
    await fuse.press("Enter");
    await ctl.locator(".ctl", { hasText: "Using: Custom" }).waitFor({ timeout: WAIT });
    assert.equal(await ctl.locator('input[name="fuseMin"]').inputValue(), "12");
    assert.notEqual(await ctl.locator("details.more").getAttribute("open"), null, "still open after the panel redraws");
  });

  test("two rings for 24 players: seats clear of each other and the bomb, inside the circle, on the projector and a laptop", async () => {
    const LAPTOP = { width: 1366, height: 768 };
    // A realistic class: ordinary names, two of the longest allowed (16 characters), one with a space.
    const NAMES = [
      "Ingrid", "Ola", "Jonas", "Kristian Johnsen", "Emil", "Aisha", "Mats", "Nora", "Filip", "Ella", "Oskar", "Maja",
      "Henrik", "Leah", "Sander", "Emma", "Christoffersenno", "Sofie", "Lukas", "Kari", "Per", "Ida", "Jakob", "Selma",
    ];
    const { host, code } = await hostRoom();
    const bots: Awaited<ReturnType<typeof wsPlayer>>[] = [];
    for (const name of NAMES.slice(0, 23)) bots.push(await wsPlayer(code, name));
    const student = await joinPlayer(code, NAMES[23], LAPTOP);
    await host.locator(".seat").nth(23).waitFor({ timeout: WAIT });
    await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 60, promptTypes: ["contains"], liveTyping: true });
    await startFromOverlay(host);

    // One lap: everyone plays a word, so every seat carries one. Most are 4 to 10 letters; the first
    // two players whose prompt allows it play a long word, of 12 or 13 letters. Not 14: with two
    // 14-letter words, two seats' boxes can touch at their empty corners (nothing drawn is covered),
    // which this box check would count as an overlap.
    const used = new Set<string>();
    let longLeft = 2;
    const pick = (p: Prompt) => {
      const t = p.text.toLowerCase();
      const fits = (w: string) => w.includes(t) && !used.has(w);
      const long = longLeft > 0 ? KNOWN.filter((x) => x.length >= 12 && x.length <= 13 && fits(x)).sort((a, b) => b.length - a.length)[0] : undefined;
      if (long) longLeft--;
      const w = long ?? KNOWN.find((x) => x.length >= 4 && x.length <= 10 && fits(x)) ?? KNOWN.find(fits);
      assert.ok(w, `no word for ${t}`);
      used.add(w);
      return w;
    };
    const played = new Set<string>();
    /** Who is on: a bot that hasn't played yet (bots' views can lag a moment behind), or the student. */
    const whoIsOn = async () => {
      const deadline = Date.now() + WAIT;
      while (Date.now() < deadline) {
        const bot = bots.find((b) => b.view()?.me?.isOn && !played.has(b.view().me.nickname));
        if (bot) return { bot, name: bot.view().me.nickname as string };
        if (!played.has(NAMES[23]) && (await student.locator("main.turn-on").count()) > 0) return { bot: null, name: NAMES[23] };
        await host.waitForTimeout(50);
      }
      throw new Error("nobody's turn");
    };
    for (let k = 0; k < NAMES.length; k++) {
      const { bot, name } = await whoIsOn();
      const word = pick(await projectorPrompt(host));
      played.add(name);
      if (bot) bot.send({ t: "submit", word });
      else {
        await student.fill("#word", word);
        await student.press("#word", "Enter");
      }
      // The whole word: an earlier word may start with this one ("actually", then "actual").
      await host.locator(".seat .last-word", { hasText: new RegExp(`^${word}$`) }).waitFor({ timeout: WAIT });
    }
    assert.equal(longLeft, 0, "two long words were played");
    // The next player, the first again, is typing an ordinary word.
    const first = [...played][0];
    const typer = bots.find((b) => b.view()?.me?.nickname === first);
    if (typer) typer.send({ t: "typing", text: "strength" });
    else await student.locator("#word").pressSequentially("strength");
    await host.locator(".seat.on .typing", { hasText: "strength" }).waitFor({ timeout: WAIT });
    await host.waitForTimeout(800); // the arrow's swing and any redraws settle

    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      await host.setViewportSize(viewport);
      await host.waitForTimeout(300);
      const l = await circleLayout(host, "#projector .circle");
      assert.equal(l.seats, 24);
      assert.equal(l.ring1, 12);
      assert.equal(await host.locator("#projector .seat .last-word").count(), 23, "every seat but the typing one shows a word");
      assert.deepEqual(layoutProblems(l), [], `projector ${viewport.width}×${viewport.height}`);
      assert.deepEqual(await splitNameWords(host, "#projector"), [], "a long name wraps at its space");
      const c = await countdownClearance(host, "#projector");
      assert.ok(c.clear >= 1, `projector ${viewport.width}: "${c.text}" is ${(-c.clear).toFixed(1)} px over the rim`);
    }

    await student.locator(".seat.on .typing", { hasText: "strength" }).waitFor({ timeout: WAIT });
    const l = await circleLayout(student, "main .circle.compact");
    assert.equal(l.seats, 24);
    assert.equal(l.ring1, 12);
    assert.deepEqual(layoutProblems(l), [], "student 1366×768");
    assert.deepEqual(await splitNameWords(student, "main .circle"), [], "a long name wraps at its space");
    const c = await countdownClearance(student, "main .circle");
    assert.ok(c.clear >= 1, `student: "${c.text}" is ${(-c.clear).toFixed(1)} px over the rim`);
  });
  test("spotlight layout, projector 1920×1080: names ≥ 40px, prompt letters ≥ 60px, no seat overlaps a seat, the spotlight overlaps no seat and sits below the arrow's reach, and the countdown is on the bomb", async () => {
    const typed = "championship";
    const { host } = await spotlightRoom(typed);
    assert.equal(await host.locator("#projector .seat .last-word").count(), 14, "every seat but the typing one shows a word");
    const l = await checkSpotlight(host, "#projector", typed, "projector 1920×1080");
    assert.ok(l.minName >= 40, `names are ${l.minName.toFixed(1)} px`);
    assert.ok(l.prompt >= 60, `prompt letters are ${l.prompt.toFixed(1)} px`);
  });

  test("spotlight layout, laptop 1366×768: names ≥ 17px, no seat overlaps a seat, the spotlight overlaps no seat and sits below the arrow's reach, and the countdown is on the bomb", async () => {
    const typed = "championship";
    const { student } = await spotlightRoom(typed);
    assert.equal(await student.locator("main .seat .last-word").count(), 14, "every seat but the typing one shows a word");
    const l = await checkSpotlight(student, "main", typed, "laptop 1366×768");
    assert.ok(l.minName >= 17, `names are ${l.minName.toFixed(1)} px`);
  });

  // With the overlay open the oval is about 1320 px wide instead of 1800, so the names follow its
  // width (32 px, as big as before the spotlight layout) and a long name at a side seat may reach a
  // little past the oval, but stays on the screen, clear of the overlay.
  test("spotlight layout, projector 1920×1080 with the ⚙ overlay open: names ≥ 32px, prompt letters ≥ 60px, nothing overlaps, the spotlight is centred, and the countdown is on the bomb", async () => {
    const typed = "championship";
    const { host } = await spotlightRoom(typed);
    await openOverlay(host);
    await host.waitForTimeout(300);
    const l = await checkSpotlight(host, "#projector", typed, "projector with the overlay", { within: "screen" });
    assert.ok(l.minName >= 32, `names are ${l.minName.toFixed(1)} px`);
    assert.ok(l.prompt >= 60, `prompt letters are ${l.prompt.toFixed(1)} px`);
    assert.ok(Math.abs((l.spot!.left + l.spot!.right) / 2 - (l.circle.left + l.circle.right) / 2) < 1, "the spotlight is centred");
  });

  // Before the spotlight layout the projector's names were 4.2% of the circle's height up to 10 seats
  // and 3.4% at 11 to 16: 39.8 px and 32.2 px at 1920×1080, whether or not the ⚙ overlay was open
  // (it narrows the oval, not its height). They may never be smaller there. With 6 players the
  // two-line name sits at the bottom seat, just above the example answers.
  test("projector 1920×1080: names are never smaller than before (6 seats ≥ 39.8px, 15 seats ≥ 32.2px), with and without the ⚙ overlay, and nothing overlaps", async () => {
    const typed = "championship";
    for (const [names, before] of [[SPOT_NAMES.slice(0, 6), 39.8], [SPOT_NAMES, 32.2]] as const) {
      const { host } = await spotlightRoom(typed, [...names]);
      for (const overlay of [false, true]) {
        if (overlay) await openOverlay(host);
        await host.waitForTimeout(300);
        const where = `${names.length} seats${overlay ? ", overlay open" : ""}`;
        // 6 seats with the overlay closed: a two-line name at the bottom seat ("Kristian Johnsen") pokes about 17 px out of the circle box but stays on screen, so this run checks against the screen.
        const l = await checkSpotlight(host, "#projector", typed, where, { seats: names.length, within: overlay || names.length === 6 ? "screen" : "circle" });
        assert.ok(l.minName >= before, `${where}: names are ${l.minName.toFixed(1)} px, before ${before} px`);
      }
      await closeContexts();
    }
  });

  test("spotlight: a 30-character typed word stays on one row, inside the circle, clear of every seat", async () => {
    const typed = "abcdefghijklmnopqrstuvwxyzabcd";
    assert.equal(typed.length, 30);
    const { host, student } = await spotlightRoom(typed);
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      await host.setViewportSize(viewport);
      await host.waitForTimeout(300);
      await checkSpotlight(host, "#projector", typed, `projector ${viewport.width}×${viewport.height}`);
      assert.deepEqual(await tileRows(host, "#projector .spotlight"), [1], "one row");
    }
    await checkSpotlight(student, "main", typed, "laptop 1366×768");
    assert.deepEqual(await tileRows(student, "main .spotlight"), [1], "one row");
  });
  test("the countdown number sits on the bomb's dark body, clear of its light rim", async () => {
    const LAPTOP = { width: 1366, height: 768 };
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann", LAPTOP), await joinPlayer(code, "Ben", LAPTOP), await joinPlayer(code, "Cat", LAPTOP)];
    await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 60, promptTypes: ["contains"] });
    await startFromOverlay(host);
    await host.locator("#projector [data-countdown]", { hasText: /^\d\d$/ }).waitFor({ timeout: WAIT });
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      await host.setViewportSize(viewport);
      await host.waitForTimeout(200);
      const c = await countdownClearance(host, "#projector");
      assert.ok(c.clear >= 1, `projector ${viewport.width}: "${c.text}" is ${(-c.clear).toFixed(1)} px over the rim`);
    }
    await players[0].locator("main .circle [data-countdown]").waitFor({ timeout: WAIT });
    const c = await countdownClearance(players[0], "main .circle");
    assert.ok(c.clear >= 1, `student: "${c.text}" is ${(-c.clear).toFixed(1)} px over the rim`);
  });
  test("projector: the arrow still points at the current seat when the ⚙ overlay opens and closes", async () => {
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann"), await joinPlayer(code, "Ben"), await joinPlayer(code, "Cat")];
    await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 60, promptTypes: ["contains"] });
    await startFromOverlay(host);
    // The seats at the top and the bottom don't move when the oval changes shape: make it a side seat's turn.
    let on = await playerOnTurn(players);
    if (await host.locator("#projector .seat").first().evaluate((el: Element) => el.classList.contains("on"))) {
      const word = wordFor(await projectorPrompt(host));
      await on.fill("#word", word);
      await on.press("#word", "Enter");
      await host.locator(".seat .last-word", { hasText: word }).waitFor({ timeout: WAIT });
      on = await playerOnTurn(players);
    }
    await host.waitForTimeout(800); // the arrow's swing is over
    assert.ok((await arrowError(host)) < 3, `before: ${await arrowError(host)}`);
    // Opening the overlay makes the projector narrower, so the oval changes shape. No new view comes.
    await host.click("#overlaybtn");
    await host.locator("#overlay .ctl").waitFor({ timeout: WAIT });
    await host.waitForTimeout(300);
    assert.ok((await arrowError(host)) < 3, `with the overlay open: ${await arrowError(host)}`);
    await host.click("#overlayclose");
    await host.waitForTimeout(300);
    assert.ok((await arrowError(host)) < 3, `after closing it: ${await arrowError(host)}`);
  });

  test("student laptop (1366×768): the circle is a wide oval, and the arrow points at the current seat, also after a resize", async () => {
    const LAPTOP = { width: 1366, height: 768 };
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann", LAPTOP), await joinPlayer(code, "Ben", LAPTOP), await joinPlayer(code, "Cat", LAPTOP)];
    await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 60, promptTypes: ["contains"] });
    await startFromOverlay(host);
    // The seats at the top and the bottom don't move when the circle is an oval: make it a side seat's turn.
    let on = await playerOnTurn(players);
    if (await host.locator("#projector .seat").first().evaluate((el: Element) => el.classList.contains("on"))) {
      const word = wordFor(await projectorPrompt(host));
      await on.fill("#word", word);
      await on.press("#word", "Enter");
      await host.locator(".seat .last-word", { hasText: word }).waitFor({ timeout: WAIT });
      on = await playerOnTurn(players);
    }
    for (const p of players) await p.locator("main .seat.on").waitFor({ timeout: WAIT });
    await host.waitForTimeout(800); // the arrow's swing is over
    for (const [i, p] of players.entries()) {
      const box = await p.locator("main .circle.compact").boundingBox();
      assert.ok(box.width / box.height > 1.5, `student ${i}: the circle is ${box.width}×${box.height}`);
      const err = await arrowError(p, "main");
      assert.ok(err < 3, `student ${i}: the arrow is ${err.toFixed(1)}° off the seat`);
    }
    // The window snapped to half the screen: the oval is much rounder, with no new view. The arrow
    // turns with it (a side seat moves about 9° round the bomb).
    await players[0].setViewportSize({ width: 683, height: 768 });
    await players[0].waitForTimeout(300);
    const err = await arrowError(players[0], "main");
    assert.ok(err < 3, `after the resize: the arrow is ${err.toFixed(1)}° off the seat`);
  });
});
