// Screenshots of every screen for docs/screenshots/, in every theme: `npm run screenshots`.
// Runs the local dev server (passcode "test") with computer players over WebSocket and a few real
// browser pages through Playwright, at deviceScaleFactor 2. Projector shots are 1920×1080, student
// shots 1366×768 (a school laptop). Files are docs/screenshots/<theme>-<nn>-<screen>.png.
//
// The browser pages are served at https://wordfire.netlify.app (the requests are answered by the
// local server), so the projector shows the real address. Nothing is sent to Netlify.
// The names are made up; no real student data.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { THEME_IDS } from "../public/app/theme.js";
import { startDevServer } from "./dev-server.ts";
import { findPlaywright, notFound } from "./playwright-path.ts";

/** Playwright isn't a project dependency: the same global install the end-to-end tests use. */
const PLAYWRIGHT = findPlaywright();
if (!PLAYWRIGHT) {
  console.error(`${notFound()} No screenshots taken.`);
  process.exit(1);
}

delete process.env.HOST_PASSCODE; // the dev server then uses "test"
const PASSCODE = "test";
const SITE = "https://wordfire.netlify.app";
const OUT = new URL("../docs/screenshots/", import.meta.url);
/** Every theme the game has (a new theme in THEME_IDS gets its pictures too). */
const THEMES: readonly string[] = THEME_IDS;
const PROJECTOR = { width: 1920, height: 1080 };
const LAPTOP = { width: 1366, height: 768 };
const PHONE = { width: 390, height: 844 };
const WAIT = 20_000;

// ---------------------------------------------------------------------------------------------
// Words: everyday words first (the NGSL list, most frequent first), then the rest the game knows.

const lines = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
const KNOWN = lines("data/generated/known.txt");
const KNOWN_SET = new Set(KNOWN);
const EVERYDAY = lines("data/raw/ngsl-stats.csv").slice(1).map((l) => l.split(",")[0].toLowerCase()).filter((w) => KNOWN_SET.has(w));
const WORDS = [...new Set([...EVERYDAY, ...KNOWN])];

type Prompt = { text: string; type: "contains" | "starts" | "ends" };
const fits = (p: Prompt, w: string) => {
  const t = p.text.toLowerCase();
  return p.type === "contains" ? w.includes(t) : p.type === "starts" ? w.startsWith(t) : w.endsWith(t);
};

/** An everyday word for the prompt, not used yet in this room, picked from the first few that fit. */
function wordFor(p: Prompt, used: Set<string>, min = 4, max = 9): string {
  const ok = (w: string) => fits(p, w) && !used.has(w);
  const pool = WORDS.filter((w) => ok(w) && w.length >= min && w.length <= max).slice(0, 8);
  const w = pool.length ? pool[Math.floor(Math.random() * pool.length)] : WORDS.find(ok);
  if (!w) throw new Error(`no word for ${p.type} ${p.text}`);
  used.add(w);
  return w;
}

/** A long word for the prompt (for the "Longest word" on the results), or an ordinary one. */
function longWordFor(p: Prompt, used: Set<string>): string {
  const w = KNOWN.filter((x) => fits(p, x) && !used.has(x) && x.length >= 10 && x.length <= 12)[0];
  if (!w) return wordFor(p, used);
  used.add(w);
  return w;
}

// ---------------------------------------------------------------------------------------------
// Small helpers.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, fn: () => T | undefined | null | false, ms = WAIT): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await sleep(25);
  }
}

let server: { url: string; close(): Promise<void> };
const wsUrl = () => server.url.replace(/^http/, "ws") + "/api/ws";
const sockets: WebSocket[] = [];

/** A WebSocket client that keeps its latest view and the server's replies. */
async function socket(first: object, name: string): Promise<{ send(m: object): void; view(): any; next(): Promise<any> }> {
  const ws = new WebSocket(wsUrl());
  sockets.push(ws);
  let view: any = null;
  const replies: any[] = [];
  let welcome: (m: any) => void;
  const welcomed = new Promise<any>((r) => (welcome = r));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.t === "view") view = m.view;
    else if (m.t === "welcome" || m.t === "error") welcome(m);
    else if (m.t === "result") replies.push(m);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error(`${name}: could not connect`)));
  });
  ws.send(JSON.stringify(first));
  const w = await welcomed;
  if (w.t !== "welcome") throw new Error(`${name}: ${w.reason}`);
  await until(`${name}'s first view`, () => view);
  return {
    send: (m) => ws.send(JSON.stringify(m)),
    view: () => view,
    next: () => until(`${name}: a reply`, () => replies.shift(), 5000),
  };
}

type Bot = Awaited<ReturnType<typeof socket>> & { name: string };
const bot = async (code: string, name: string): Promise<Bot> =>
  Object.assign(await socket({ t: "join", code, token: crypto.randomUUID(), nickname: name }, name), { name });

/** The host's control connection (as a phone with the passcode): commands, and the full view. */
async function control(code: string) {
  const s = await socket({ t: "control", code, token: crypto.randomUUID(), passcode: PASSCODE }, "control");
  const cmd = async (m: object) => {
    s.send({ t: "cmd", ...m });
    const r = await s.next();
    if (!r.ok) throw new Error(`command ${JSON.stringify(m)}: ${r.reason}`);
  };
  return { view: s.view, cmd, settings: (settings: object) => cmd({ cmd: "settings", settings }) };
}
type Control = Awaited<ReturnType<typeof control>>;

// ---------------------------------------------------------------------------------------------
// Browser pages, each in its own context (its own laptop), served at SITE by the local server.

let browser: any;
const contexts: any[] = [];

async function newPage(path: string, viewport: { width: number; height: number }): Promise<any> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  contexts.push(ctx);
  await ctx.route(`${SITE}/**`, async (route: any) => {
    const u = new URL(route.request().url());
    const response = await route.fetch({ url: server.url + u.pathname + u.search });
    await route.fulfill({ response });
  });
  await ctx.routeWebSocket(`${SITE.replace(/^https/, "wss")}/api/ws`, (page: any) => {
    const up = new WebSocket(wsUrl());
    const queue: string[] = [];
    up.addEventListener("open", () => queue.splice(0).forEach((m) => up.send(m)));
    up.addEventListener("message", (ev) => {
      try {
        page.send(String(ev.data));
      } catch {
        /* the page has gone */
      }
    });
    up.addEventListener("close", () => page.close().catch(() => {}));
    page.onMessage((m: string | Buffer) => (up.readyState === WebSocket.OPEN ? up.send(String(m)) : queue.push(String(m))));
    page.onClose(() => up.close());
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.warn(`  page error on ${path}: ${e.message}`));
  await page.goto(SITE + path);
  return page;
}

/** Opens /host and creates a room: the projector page, the room code and a control connection. */
async function createRoom(): Promise<{ host: any; code: string; ctl: Control }> {
  const host = await newPage("/host", PROJECTOR);
  await host.fill("#passcode", PASSCODE);
  await host.click("#createbtn");
  const code = (await host.locator(".p-code").textContent({ timeout: WAIT })).replace(/\s/g, "");
  return { host, code, ctl: await control(code) };
}

async function joinStudent(code: string, nickname: string, shotBeforeJoin?: string): Promise<any> {
  const page = await newPage("/", LAPTOP);
  await page.fill("#code", code);
  await page.fill("#nick", nickname);
  if (shotBeforeJoin) await shoot(page, shotBeforeJoin);
  await page.click("#joinbtn");
  await page.locator("main.lobby").waitFor({ timeout: WAIT });
  return page;
}

const written: string[] = [];

/** One screenshot of the page as it is now (or the whole page), once fonts and redraws settle. */
async function shoot(page: any, name: string, fullPage = false): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const path = new URL(`${name}.png`, OUT).pathname;
  await page.screenshot({ path, fullPage });
  shrink(path);
  written.push(`${name}.png`);
  console.log(`  ${name}.png`);
}

/**
 * With ImageMagick installed, a screenshot is saved with 256 colours: it looks the same and is about
 * a third of the size, which keeps the folder small in git. Without it, the full-colour file stays.
 */
const MAGICK = ["magick", "convert"].find((cmd) => {
  try {
    return execFileSync(cmd, ["-version"], { encoding: "utf8" }).includes("ImageMagick");
  } catch {
    return false;
  }
});
function shrink(path: string): void {
  if (MAGICK) execFileSync(MAGICK, [path, "-strip", "-colors", "256", `PNG8:${path}`]);
}

/**
 * The same moment in every theme: the host changes the theme (it can change at any time, even
 * during a game), every page follows it, and each page is shot under its name.
 */
async function everyTheme(ctl: Control, shots: [page: any, name: string][]): Promise<void> {
  for (const theme of THEMES) await inTheme(ctl, theme, shots);
  await ctl.settings({ theme: "workshop" });
}

async function inTheme(ctl: Control, theme: string, shots: [page: any, name: string][]): Promise<void> {
  await ctl.settings({ theme });
  for (const [page, name] of shots) {
    await page.waitForFunction((t: string) => document.documentElement.dataset.theme === t, theme, { timeout: WAIT });
    await shoot(page, `${theme}-${name}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Playing Classic: whoever is on plays a word, until a condition holds.

type Players = { bots: Bot[]; pages: Map<string, any> };
const nameOf = (view: any, id: string) => view.players.find((p: any) => p.id === id)?.nickname as string;

/** The player on, as seen by the control view, with the prompt. */
function turn(ctl: Control): { id: string; name: string; prompt: Prompt; key: string } | null {
  const v = ctl.view();
  if (v?.phase !== "playing" || typeof v.mode?.current !== "string" || !v.prompt) return null;
  const id = v.mode.current as string;
  return { id, name: nameOf(v, id), prompt: v.prompt, key: `${id} ${v.prompt.type} ${v.prompt.text}` };
}

async function play(ctl: Control, who: Players, used: Set<string>, word: string): Promise<void> {
  const t = (await until("someone's turn", () => turn(ctl)))!;
  const b = who.bots.find((x) => x.name === t.name);
  if (b) b.send({ t: "submit", word });
  else {
    const page = who.pages.get(t.name);
    await page.fill("#word", word);
    await page.press("#word", "Enter");
  }
  // The turn moves on (a refused word would leave it: then try another).
  const moved = await until("the turn to move on", () => turn(ctl)?.key !== t.key, 3000).catch(() => false);
  if (!moved) await play(ctl, who, used, wordFor(t.prompt, used));
}

async function playUntil(ctl: Control, who: Players, used: Set<string>, done: () => boolean, long = 0): Promise<void> {
  let longLeft = long;
  for (let i = 0; i < 200 && !done(); i++) {
    const t = (await until("someone's turn", () => turn(ctl)))!;
    const word = longLeft-- > 0 ? longWordFor(t.prompt, used) : wordFor(t.prompt, used);
    await play(ctl, who, used, word);
  }
  if (!done()) throw new Error("the game didn't reach the wanted state");
}

const everyoneHasAWord = (ctl: Control) => ctl.view().players.every((p: any) => p.lastWord);

/** A word for the player on, and its first letters, as if they are halfway through typing it. */
function halfTyped(p: Prompt, used: Set<string>): { word: string; typed: string } {
  const word = wordFor(p, used, 7, 9);
  return { word, typed: word.slice(0, Math.max(word.indexOf(p.text.toLowerCase()) + p.text.length, word.length - 2)) };
}

// ---------------------------------------------------------------------------------------------
// The names: ordinary first names, a few long ones (16 characters is the most allowed).

const CLASS_OF_30 = [
  "Ingrid", "Ola", "Jonas", "Kristian Johnsen", "Emil", "Aisha", "Mats", "Nora", "Filip", "Ella",
  "Oskar", "Maja", "Henrik", "Leah", "Sander", "Emma", "Aleksandra Berg", "Sofie", "Lukas", "Kari",
  "Per", "Ida", "Jakob", "Thea", "Noah", "Amalie", "Elias", "Hedda", "Tobias", "Selma",
];

/** Room 1: three players in the lobby; then a short game with ghosts to its results. */
async function smallRoom(): Promise<void> {
  console.log("Lobby with 3, ghost, results");
  const { host, code, ctl } = await createRoom();
  const aisha = await joinStudent(code, "Aisha", "workshop-01-student-join");
  const jonas = await joinStudent(code, "Jonas");
  const bots = [await bot(code, "Ingrid")];
  await host.locator(".seat").nth(2).waitFor({ timeout: WAIT });
  await sleep(1000); // the join pops are over
  await everyTheme(ctl, [[aisha, "02-student-lobby"], [host, "03-projector-lobby"]]);

  // The ⚙ overlay over the lobby (Workshop only).
  await host.click("#overlaybtn");
  await host.locator("#overlay .ctl").waitFor({ timeout: WAIT });
  await shoot(host, "workshop-18-projector-overlay");
  await host.click("#overlayclose");

  // Four more join, then a quick game: one life, 10-second turns, ghosts, no comebacks.
  for (const name of ["Emil", "Nora", "Oskar", "Sofie"]) bots.push(await bot(code, name));
  await ctl.settings({
    mode: "classic", timerStyle: "visible", turnTime: 10, startLives: 1, maxLives: 1, knockout: "ghost",
    comeback: false, promptTypes: ["contains"], band: "easy", liveTyping: true, exampleAnswers: true,
  });
  await ctl.cmd({ cmd: "start" });

  // Ingrid always answers, and wins. Jonas answers until Aisha's ghost screen is taken. The others
  // let the bomb go off; once out, the computer players answer each prompt as ghosts.
  const used = new Set<string>();
  const ghostAnswered = new Map<string, string>();
  let jonasPlays = true;
  let lastKey = "";
  let longWords = 1;
  let ghostShotDone = false;
  const deadline = Date.now() + 180_000;
  while (ctl.view().phase !== "results") {
    if (Date.now() > deadline) throw new Error("the small game didn't end");
    const t = turn(ctl);
    if (!t || t.key === lastKey) {
      await sleep(50);
      continue;
    }
    lastKey = t.key;
    for (const b of bots) {
      const me = b.view()?.me;
      if (me?.activity && ghostAnswered.get(b.name) !== t.key) {
        ghostAnswered.set(b.name, t.key);
        b.send({ t: "submit", word: wordFor(t.prompt, used) });
      }
    }
    // Aisha's ghost screen, once she is out: she answers as a ghost early in someone else's turn.
    if (!ghostShotDone && (await aisha.locator("main.ghost").count()) > 0) {
      await sleep(1500); // a turn can start with an explosion: let it finish
      if (turn(ctl)?.key !== t.key) continue;
      await aisha.fill("#word", wordFor(t.prompt, used));
      await aisha.press("#word", "Enter");
      await aisha.locator(".result.good").waitFor({ timeout: WAIT });
      await everyTheme(ctl, [[aisha, "12-student-ghost"]]);
      ghostShotDone = true;
      jonasPlays = false;
    }
    if (t.name === "Ingrid" || (t.name === "Jonas" && jonasPlays)) {
      await sleep(900); // the arrow's swing, so the turns don't fly past
      if (turn(ctl)?.key !== t.key) continue;
      const word = longWords-- > 0 ? longWordFor(t.prompt, used) : wordFor(t.prompt, used);
      if (t.name === "Ingrid") bots[0].send({ t: "submit", word });
      else {
        await jonas.fill("#word", word);
        await jonas.press("#word", "Enter");
      }
    }
  }
  if (!ghostShotDone) console.warn("  Aisha was never a ghost during the game: no ghost screenshot");
  await host.locator(".p-results").waitFor({ timeout: WAIT });
  await sleep(500);
  await everyTheme(ctl, [[host, "13-projector-results"], [jonas, "14-student-results"]]);
}

/** Room 2: the usual class of 15, playing Classic. Then the Workshop-only extras. */
async function classOf15(): Promise<void> {
  console.log("Classic with 15");
  const { host, code, ctl } = await createRoom();
  const names = CLASS_OF_30.filter((n) => n !== "Thea" && n !== "Kristian Johnsen").slice(0, 13);
  const bots: Bot[] = [];
  for (const n of names.slice(0, 7)) bots.push(await bot(code, n));
  const thea = await joinStudent(code, "Thea");
  for (const n of names.slice(7)) bots.push(await bot(code, n));
  const kristian = await joinStudent(code, "Kristian Johnsen");
  await host.locator(".seat").nth(14).waitFor({ timeout: WAIT });
  await ctl.settings({ mode: "classic", timerStyle: "visible", turnTime: 60, startLives: 3, maxLives: 3, promptTypes: ["contains"], band: "hard", liveTyping: true });
  await ctl.cmd({ cmd: "start" });

  // One lap, so every seat has a last word; then it's Thea's turn and she is typing.
  const who: Players = { bots, pages: new Map([["Thea", thea], ["Kristian Johnsen", kristian]]) };
  const used = new Set<string>();
  await playUntil(ctl, who, used, () => everyoneHasAWord(ctl) && turn(ctl)?.name === "Thea", 1);
  const t = turn(ctl)!;
  const { word: theasWord, typed } = halfTyped(t.prompt, used);
  await thea.locator("main.turn-on").waitFor({ timeout: WAIT });
  await thea.locator("#word").pressSequentially(typed, { delay: 40 });
  await host.locator(".spotlight").waitFor({ timeout: WAIT });
  await sleep(800);
  await everyTheme(ctl, [[thea, "06-student-classic-turn"], [kristian, "07-student-classic-waiting"], [host, "08-projector-classic"]]);

  // Workshop only: the control panel on a laptop and on a phone, while the game runs.
  const panel = await newPage("/control", LAPTOP);
  await panel.fill("#code", code);
  await panel.fill("#passcode", PASSCODE);
  await panel.click("#controlbtn");
  await panel.locator("#panel .ctl").waitFor({ timeout: WAIT });
  await shoot(panel, "workshop-19-control-laptop", true);
  const phone = await newPage("/control", PHONE);
  await phone.fill("#code", code);
  await phone.fill("#passcode", PASSCODE);
  await phone.click("#controlbtn");
  await phone.locator("#panel .ctl").waitFor({ timeout: WAIT });
  await shoot(phone, "workshop-20-control-phone", true);

  // Paused.
  await ctl.cmd({ cmd: "pause" });
  await host.locator(".p-paused").waitFor({ timeout: WAIT });
  await shoot(host, "workshop-17-projector-paused");
  await ctl.cmd({ cmd: "resume" });
  await host.locator(".p-paused").waitFor({ state: "detached", timeout: WAIT });

  // Thea plays her word; the next player lets the bomb run down: the last seconds, then the explosion.
  await play(ctl, who, used, theasWord);
  const next = (await until("the next turn", () => turn(ctl)))!;
  const endsAt = Date.now() + Number(ctl.view().bombRemainingMs ?? 60_000);
  if (who.pages.has(next.name)) console.warn(`  ${next.name} is a browser student; the countdown runs down anyway`);
  await sleep(Math.max(0, endsAt - Date.now() - 2300));
  await shoot(host, "workshop-15-projector-urgent");
  await until("the explosion", () => turn(ctl)?.key !== next.key || ctl.view().examples?.length, 10_000);
  await sleep(150);
  await shoot(host, "workshop-16-projector-explosion");
}

/** Room 3: a class of 30. The lobby, Classic on two rings, then Everyone at once. */
async function classOf30(): Promise<void> {
  console.log("Lobby, Classic and Everyone at once with 30");
  const { host, code, ctl } = await createRoom();
  const bots: Bot[] = [];
  for (const n of CLASS_OF_30.slice(0, 29)) bots.push(await bot(code, n));
  const selma = await joinStudent(code, "Selma");
  await host.locator(".seat").nth(29).waitFor({ timeout: WAIT });
  await sleep(1000);
  const scroll = await selma.evaluate(() => {
    const grid = document.querySelector(".picker-grid")!.getBoundingClientRect();
    return { page: document.documentElement.scrollHeight, window: innerHeight, pickerBottom: Math.round(grid.bottom) };
  });
  console.log(`  student lobby with 30 at 1366×768: page ${scroll.page}px tall in a ${scroll.window}px window; picker ends at ${scroll.pickerBottom}px`);
  await everyTheme(ctl, [[host, "04-projector-lobby-30"], [selma, "05-student-lobby-30"]]);

  // Classic: one lap, so every seat has a word, then someone is typing.
  await ctl.settings({ mode: "classic", timerStyle: "visible", turnTime: 60, startLives: 3, maxLives: 3, promptTypes: ["contains"], band: "hard", liveTyping: true });
  await ctl.cmd({ cmd: "start" });
  const who: Players = { bots, pages: new Map([["Selma", selma]]) };
  const used = new Set<string>();
  await playUntil(ctl, who, used, () => everyoneHasAWord(ctl) && turn(ctl)?.name !== "Selma", 2);
  const t = turn(ctl)!;
  bots.find((b) => b.name === t.name)!.send({ t: "typing", text: halfTyped(t.prompt, used).typed });
  await host.locator(".seat.on .typing").waitFor({ timeout: WAIT });
  await sleep(800);
  await everyTheme(ctl, [[host, "09-projector-classic-30"], [selma, "10-student-classic-30"]]);

  // Everyone at once: a new game; two thirds of the class have answered.
  await ctl.cmd({ cmd: "end" });
  await ctl.cmd({ cmd: "playAgain" });
  await ctl.settings({ mode: "everyone" });
  await ctl.settings({ roundTime: 45 });
  await ctl.cmd({ cmd: "start" });
  const prompt = await until("the first round", () => ctl.view().phase === "playing" && ctl.view().prompt);
  const everyoneUsed = new Set<string>();
  for (const b of bots.slice(0, 20)) {
    b.send({ t: "submit", word: wordFor(prompt, everyoneUsed) });
    await sleep(60);
  }
  await until("20 ticks", () => ctl.view().players.filter((p: any) => p.answered).length >= 20, 5000).catch(() => {});
  await sleep(500);
  await everyTheme(ctl, [[host, "11-projector-everyone-30"]]);
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const pw = await import(PLAYWRIGHT!);
  try {
    // Inside the try, so a failed start still closes whatever did start.
    browser = await pw.chromium.launch();
    server = await startDevServer(0);
    await smallRoom();
    await classOf15();
    await classOf30();
  } finally {
    for (const ws of sockets) ws.close();
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    await browser?.close();
    await server?.close();
  }
  // A screenshot this script wrote on an earlier run under a name it no longer uses is removed.
  // Other files in the folder are left alone.
  const keep = new Set(written);
  const ownName = new RegExp(`^(${THEMES.join("|")})-\\d\\d-[a-z0-9-]+\\.png$`);
  for (const f of readdirSync(OUT)) if (ownName.test(f) && !keep.has(f)) rmSync(new URL(f, OUT));
  console.log(`${written.length} screenshots in docs/screenshots/${MAGICK ? "" : " (full colour: ImageMagick isn't installed)"}`);
}

await main();
process.exit(0);
