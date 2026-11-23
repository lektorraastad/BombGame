// End-to-end tests: the real dev server, driven through Chromium with Playwright.
// Run with `npm run test:e2e`. Skips with a message when Playwright isn't installed.
import { test, before, after, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { startDevServer } from "../../scripts/dev-server.ts";

const PLAYWRIGHT = "/opt/npm-tools/node_modules/playwright/index.mjs";
const HAVE_PLAYWRIGHT = existsSync(PLAYWRIGHT);
if (!HAVE_PLAYWRIGHT) console.log(`Skipping the end-to-end tests: Playwright not found at ${PLAYWRIGHT}`);

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

let pw: any;
let browser: any;
let server: { url: string; close(): Promise<void> };
const contexts: any[] = [];
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

async function joinPlayer(code: string, nickname: string): Promise<any> {
  const page = await newPage("/");
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

describe("bomb game end to end", { skip: HAVE_PLAYWRIGHT ? false : "Playwright is not installed" }, () => {
  before(async () => {
    pw = await import(PLAYWRIGHT);
    browser = await pw.chromium.launch();
    server = await startDevServer(0);
  });
  // Runs even when a test throws, so one failure doesn't leave pages open for the next test.
  afterEach(async () => {
    await closeContexts();
  });
  after(async () => {
    await browser?.close();
    await server?.close();
  });

  test("host creates a room and three players join", async () => {
    const { host, code } = await hostRoom();
    for (const name of ["Ann", "Ben", "Cat"]) await joinPlayer(code, name);
    const names = host.locator(".p-names li");
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
    await host.locator(".p-names li", { hasText: "Ben" }).locator(`img[alt="${label}"]`).waitFor({ timeout: WAIT });
    // And Ann's picker now shows Ben's new emoji as taken.
    await ann.locator(`.picker button[data-avatar="${freeAvatar}"][disabled]`).waitFor({ timeout: WAIT });
    assert.deepEqual(await host.locator(".p-names li").allTextContents(), ["Ann", "Ben"]);
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

    await host.locator(".p-last", { hasText: `Last word: ${word}` }).waitFor({ timeout: WAIT });
    await other.locator("main.turn-on").waitFor({ timeout: WAIT });
    await on.locator("main.waiting").waitFor({ timeout: WAIT });
    assert.match(await on.locator(".last").textContent(), new RegExp(`Last word: ${word}`));
  });

  test("explosion costs a life and shows example answers", async () => {
    const { host, code } = await hostRoom();
    const players = [await joinPlayer(code, "Ann"), await joinPlayer(code, "Ben")];
    await settings(host, code, { mode: "classic", timerStyle: "visible", turnTime: 5, startLives: 2, exampleAnswers: true });
    await startFromOverlay(host);

    const on = await playerOnTurn(players);
    assert.equal(await on.locator(".lives").textContent(), "❤❤");
    // Nobody answers: the 5 s bomb goes off.
    await host.locator(".p-examples", { hasText: "Could have said:" }).waitFor({ timeout: WAIT });
    await on.locator(".lives", { hasText: /^❤$/ }).waitFor({ timeout: WAIT });
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
    assert.deepEqual(await host.locator(".p-names li").allTextContents(), ["Ann"]);

    // A new tab in the same browser has a new token, but the kick is remembered in localStorage.
    const tab = await ben.context().newPage();
    await tab.goto(server.url + "/");
    await tab.fill("#code", code);
    await tab.fill("#nick", "Ben2");
    await tab.click("#joinbtn");
    await tab.locator("#joinerror", { hasText: "You were removed from this game" }).waitFor({ timeout: WAIT });
    assert.equal(await tab.locator("#game").isHidden(), true);
    await host.waitForTimeout(300);
    assert.deepEqual(await host.locator(".p-names li").allTextContents(), ["Ann"]);
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
    await host.locator(".p-last", { hasText: `Last word: ${word}` }).waitFor({ timeout: WAIT });
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
    await again.locator(".p-last", { hasText: `Last word: ${word}` }).waitFor({ timeout: WAIT });
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
});
