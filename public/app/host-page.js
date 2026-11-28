// DOM wiring for the host screen: create a room, then show the projector full screen, with the
// control panel as an overlay on demand and a button to open it in its own window.
import { createConnection } from "./net.js";
import { createCountdown, URGENT_MS } from "./countdown.js";
import { createSound, createSoundDriver, nextLevel, readLevel } from "./sound.js";
import { renderProjector } from "./render-projector.js";
import { reasonText } from "./render-player.js";
import { CREDITS } from "./credits.js";
import { mountPanel } from "./panel-page.js";
import { themeOf } from "./theme.js";
import { BOMB_CSS } from "./bomb.js";
import { createMotion } from "./motion.js";

const HOST_TOKEN = "bomb.hostToken";
const HOST_CODE = "bomb.hostCode";

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** A token kept in sessionStorage for this tab. Never shown and never put in a URL. @param {string} key */
function tabToken(key) {
  let t = sessionStorage.getItem(key);
  if (!t) {
    t = crypto.randomUUID();
    sessionStorage.setItem(key, t);
  }
  return t;
}

const deps = () => ({
  WebSocket,
  url: location.origin.replace(/^http/, "ws") + "/api/ws",
  setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms),
  clearTimeout: (/** @type {any} */ h) => clearTimeout(h),
});

/** @param {string} reason */
function createErrorText(reason) {
  if (reason === "no-passcode-set") {
    return "No host passcode is set. In Netlify, add the environment variable HOST_PASSCODE (Project configuration → Environment variables), then deploy again.";
  }
  return reasonText(reason);
}

/** @type {ReturnType<typeof createConnection> | null} */ let conn = null;
/** @type {any} */ let view = null;
let code = "";
let hosting = false;
const countdown = createCountdown(() => Date.now());
const motion = createMotion(() => Date.now());
const sound = createSound(() => new (window.AudioContext ?? /** @type {any} */ (window).webkitAudioContext)());
const sounds = createSoundDriver(sound, () => Date.now());

/** Which start-page form sent the last hello, so its error shows under it. @type {"create" | "rejoin"} */
let startForm = "create";

/** @param {string} text */
function showStart(text) {
  hosting = false;
  closeOverlay();
  $("start").hidden = false;
  $("projector").hidden = true;
  $("toolbar").hidden = true;
  $("netstatus").hidden = true;
  $("createerror").textContent = startForm === "create" ? text : "";
  $("rejoinerror").textContent = startForm === "rejoin" ? text : "";
  /** @type {HTMLButtonElement} */ ($("createbtn")).disabled = false;
  /** @type {HTMLButtonElement} */ ($("rejoinbtn")).disabled = false;
}

/** Forget the room this tab was hosting. */
function forgetRoom() {
  sessionStorage.removeItem(HOST_TOKEN);
  sessionStorage.removeItem(HOST_CODE);
  conn?.close();
  conn = null;
}

/** @param {object} hello */
function connect(hello) {
  conn?.close();
  conn = createConnection(deps(), onMessage, onStatus);
  conn.setHello(hello);
}

$("createform").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const passcode = /** @type {HTMLInputElement} */ ($("passcode")).value;
  if (!passcode) return;
  startForm = "create";
  $("createerror").textContent = "Connecting…";
  /** @type {HTMLButtonElement} */ ($("createbtn")).disabled = true;
  connect({ t: "create", passcode, token: tabToken("bomb.token") });
});

// A projector tab that was closed or crashed: reattach to the running room with its code and the passcode.
const rejoinCode = /** @type {HTMLInputElement} */ ($("rejoincode"));
rejoinCode.addEventListener("input", () => {
  rejoinCode.value = rejoinCode.value.replace(/[^A-Za-z]/g, "").toUpperCase();
});
$("rejoinform").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const roomCode = rejoinCode.value.trim().toUpperCase();
  const passcode = /** @type {HTMLInputElement} */ ($("rejoinpass")).value;
  startForm = "rejoin";
  if (roomCode.length !== 4) return void ($("rejoinerror").textContent = "The room code has 4 letters");
  if (!passcode) return;
  $("rejoinerror").textContent = "Connecting…";
  /** @type {HTMLButtonElement} */ ($("rejoinbtn")).disabled = true;
  connect({ t: "host", code: roomCode, token: tabToken("bomb.token"), passcode });
});

/** @param {any} msg */
function onMessage(msg) {
  if (msg.t === "welcome") {
    code = msg.code;
    if (msg.hostToken) {
      sessionStorage.setItem(HOST_TOKEN, msg.hostToken);
      sessionStorage.setItem(HOST_CODE, msg.code);
    }
    // From now on a reconnect rejoins this room; it never creates another one.
    conn?.setHello({ t: "host", code, token: tabToken("bomb.token"), hostToken: sessionStorage.getItem(HOST_TOKEN) ?? "" });
    /** @type {HTMLInputElement} */ ($("passcode")).value = "";
    /** @type {HTMLInputElement} */ ($("rejoinpass")).value = "";
    hosting = true;
    $("start").hidden = true;
    $("projector").hidden = false;
    $("toolbar").hidden = false;
  } else if (msg.t === "view") {
    view = msg.view;
    document.documentElement.dataset.theme = themeOf(view);
    countdown.update(view);
    motion.view(view);
    sounds.view(view);
    draw();
  } else if (msg.t === "error") {
    if (hosting && msg.reason !== "no-room" && msg.reason !== "not-host") return;
    forgetRoom();
    if (!hosting && startForm === "rejoin" && msg.reason === "no-room") return showStart("No running room has that code. Check the code, or create a new room.");
    showStart(hosting || msg.reason === "no-room" ? "That room has closed. Create a new one." : createErrorText(msg.reason));
  }
}

/** @param {string} s */
function onStatus(s) {
  if (s === "ended") {
    forgetRoom();
    return showStart("The room closed after 30 minutes without activity. Create a new one.");
  }
  if (!hosting) return;
  $("netstatus").hidden = s === "open";
  $("netstatus").textContent = s === "open" ? "" : "Reconnecting…";
}

/** The circle's shape on screen (width / height), measured after each draw, so the arrow points at the seat. */
let ringAspect = 1;

/** Whether the results were already on screen at the last draw: the winner's tune plays once as they appear. */
let resultsDrawn = false;

function draw(again = true) {
  if (!view || !hosting) return;
  // For a moment after the last explosion the circle stays up (motion.heldView), then the results show.
  const shown = motion.heldView(view);
  const countdownMs = countdown.remainingMs();
  const bomb = motion.bombState(countdownMs, shown.phase === "playing" && !shown.paused);
  const ui = {
    countdownMs, credits: CREDITS, site: location.host, bomb, popElapsed: motion.popElapsed, ringAspect,
    word: motion.word(), refused: motion.refused(), hearts: motion.hearts(), sparks: motion.sparks(), win: motion.win(),
    examples: motion.examplesShown(shown) ? shown.examples : null,
  };
  /** @param {number | undefined} maxWords */
  const paint = (maxWords) => void ($("projector").innerHTML = renderProjector(shown, { ...ui, maxWords }));
  paint(wallFit.maxWords);
  if (shown.phase === "results" && shown.results?.step === "words") fitWall(paint, Array.isArray(shown.results.words) ? shown.results.words : []);
  // The winner's tune, as the results appear after a win (never after a refresh: then there is no win moment).
  const onResults = shown.phase === "results";
  if (onResults && !resultsDrawn && motion.win()) sounds.resultsShown();
  resultsDrawn = onResults;
  // A new screen or window size can change the oval's shape: then draw once more with the real one.
  const box = document.querySelector("#projector .circle")?.getBoundingClientRect();
  if (box && box.width > 0 && box.height > 0 && Math.abs(box.width / box.height - ringAspect) > 0.005) {
    ringAspect = box.width / box.height;
    if (again) draw(false);
  }
}
// ---- the word wall: its tiles shrink to fit the screen, and never below MIN_TILE_PX tall ----

/** The smallest a tile on the wall may be, in px: below it, the wall shows fewer words and "+ N more". */
const MIN_TILE_PX = 18;
/** Worked out once per word list and projector size: the wall's font size, and how many words fit. */
let wallFit = { key: "", px: 0, maxWords: /** @type {number | undefined} */ (undefined) };

const wallEl = () => /** @type {HTMLElement | null} */ (document.querySelector("#projector .r-wall"));

/** Whether the wall's words all fit in its box at this font size (it sets the size). @param {number} px */
function wallFits(px) {
  const wall = wallEl();
  if (!wall) return true;
  wall.style.fontSize = `${px}px`;
  return wall.scrollHeight <= wall.clientHeight + 1 && wall.scrollWidth <= wall.clientWidth + 1;
}

/**
 * The biggest font size at which every word fits, down to tiles MIN_TILE_PX tall; below that, the
 * most words that fit at that size (the award words always stay: render-results.js keeps them).
 * @param {(maxWords: number | undefined) => void} paint draws the projector with a word limit
 * @param {number} n how many words the wall has
 */
function measureWall(paint, n) {
  paint(undefined);
  const hi = Math.max(16, $("projector").clientHeight * 0.06);
  const fitsAll = wallFits(hi);
  // A tile's height for each px of font size, measured on a plain word (award words are bigger).
  const tile = document.querySelector("#projector .r-word:not(.hl) .tile") ?? document.querySelector("#projector .r-wall .tile");
  const ratio = tile ? tile.getBoundingClientRect().height / hi : 1.42;
  if (fitsAll) return { px: hi, maxWords: undefined };
  const lo = Math.min(hi, MIN_TILE_PX / (ratio > 0 ? ratio : 1.42));
  if (wallFits(lo)) {
    let a = lo, b = hi; // a fits, b doesn't
    for (let i = 0; i < 10 && b - a > 0.25; i++) {
      const m = (a + b) / 2;
      if (wallFits(m)) a = m; else b = m;
    }
    return { px: a, maxWords: undefined };
  }
  let a = 0, b = n; // a words fit, b don't
  while (b - a > 1) {
    const m = Math.floor((a + b) / 2);
    paint(m);
    if (wallFits(lo)) a = m; else b = m;
  }
  return { px: lo, maxWords: a };
}

/**
 * Fit the wall to the projector, measuring again only when the words or the screen size change.
 * @param {(maxWords: number | undefined) => void} paint @param {string[]} words
 */
function fitWall(paint, words) {
  const proj = $("projector");
  const key = `${proj.clientWidth}x${proj.clientHeight}|${words.join("\n")}`;
  if (key !== wallFit.key) {
    wallFit = { key, ...measureWall(paint, words.length) };
    paint(wallFit.maxWords);
  }
  const wall = wallEl();
  if (wall) wall.style.fontSize = `${wallFit.px}px`;
}

// Redraw whenever the projector's size changes: the window is resized, or the ⚙ overlay opens or
// closes and the game moves into the space beside it. No new view comes then, but the oval's shape
// changes, and the arrow must turn with it.
new ResizeObserver(() => draw()).observe($("projector"));

// ---- the overlay: a control connection of its own, open only while the overlay shows ----

/** @type {ReturnType<typeof createConnection> | null} */ let overlayConn = null;
const panel = mountPanel($("overlaybody"), { overlay: true, send: (m) => overlayConn?.send(m) ?? false });

function openOverlay() {
  const hostToken = sessionStorage.getItem(HOST_TOKEN);
  if (!code || !hostToken || overlayConn) return;
  $("overlay").hidden = false;
  document.body.classList.add("overlay-open");
  overlayConn = createConnection(
    deps(),
    (msg) => {
      if (msg.t === "view") panel.setView(msg.view);
      else if (msg.t === "result" || msg.t === "error") panel.setResult(msg);
    },
    () => {},
  );
  overlayConn.setHello({ t: "control", code, token: tabToken("bomb.controlToken"), hostToken });
}

function closeOverlay() {
  overlayConn?.close();
  overlayConn = null;
  $("overlay").hidden = true;
  document.body.classList.remove("overlay-open");
  $("overlaybody").innerHTML = "<p>Connecting…</p>";
}

$("overlaybtn").addEventListener("click", () => (overlayConn ? closeOverlay() : openOverlay()));
$("overlayclose").addEventListener("click", closeOverlay);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && overlayConn) closeOverlay();
});

$("windowbtn").addEventListener("click", () => {
  // The new window gets a copy of this tab's sessionStorage, so it finds the host token there.
  if (code) window.open(`/control?code=${encodeURIComponent(code)}`);
});

// Browsers allow audio only after a click on this page. The overlay's Start game click counts, and
// so does any other click here (Create room, the toolbar), for when Roy starts from another window.
document.addEventListener("pointerdown", () => sound.unlock());
document.addEventListener("keydown", () => sound.unlock());

// Sound: Normal → Quiet → Off. A projector control, remembered in this browser; it stores only the level.
const SOUND_KEY = "bombgame.sound";
/** @type {Record<string, string>} */
const SOUND_TEXT = { normal: "Sound: Normal", quiet: "Sound: Quiet", off: "Sound: Off" };
/** @param {import("./sound.js").SoundLevel} l */
function showLevel(l) {
  sound.setLevel(l);
  $("soundbtn").textContent = SOUND_TEXT[l];
  $("soundbtn").dataset.level = l;
}
showLevel(readLevel(() => localStorage.getItem(SOUND_KEY)));
$("soundbtn").addEventListener("click", () => {
  const l = nextLevel($("soundbtn").dataset.level ?? "normal");
  showLevel(l);
  try {
    localStorage.setItem(SOUND_KEY, l);
  } catch {
    // Storage blocked: the level still applies until the page is closed.
  }
});

// A refresh rejoins the room this tab is hosting.
{
  const storedCode = sessionStorage.getItem(HOST_CODE);
  const storedToken = sessionStorage.getItem(HOST_TOKEN);
  if (storedCode && storedToken) {
    code = storedCode;
    $("createerror").textContent = "Reconnecting to your room…";
    connect({ t: "host", code: storedCode, token: tabToken("bomb.token"), hostToken: storedToken });
  }
}

// Count the bomb down locally between views, and tick. 50 ms, so the last 3 s can tick 4 times a second.
setInterval(() => {
  const ms = countdown.remainingMs();
  // Every loop while hosting, results included: a falling note after the final explosion is due from here.
  if (hosting) sounds.step(ms, motion.tension());
  if (ms === null) return;
  for (const el of document.querySelectorAll("#projector [data-countdown]")) el.textContent = String(Math.ceil(ms / 1000));
  for (const el of document.querySelectorAll("#projector [data-bomb]")) el.classList.toggle("urgent", ms <= URGENT_MS);
}, 50);

// The bomb's styles, once. They live in bomb.js so a new bomb design is one file.
{
  const style = document.createElement("style");
  style.textContent = BOMB_CSS;
  document.head.append(style);
}

// While the arrow swings, the bomb explodes or a player pops in, redraw about every 100 ms (each
// draw picks the animation up where it is), and once more when it has finished.
let animating = false;
setInterval(() => {
  const busy = motion.busy();
  if (busy || animating) draw();
  animating = busy;
}, 100);
