// DOM wiring for the host screen: create a room, then show the projector full screen, with the
// control panel as an overlay on demand and a button to open it in its own window.
import { createConnection } from "./net.js";
import { createCountdown, URGENT_MS } from "./countdown.js";
import { createSound, createSoundDriver } from "./sound.js";
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

function draw(again = true) {
  if (!view || !hosting) return;
  const countdownMs = countdown.remainingMs();
  const bomb = motion.bombState(countdownMs, view.phase === "playing" && !view.paused);
  $("projector").innerHTML = renderProjector(view, { countdownMs, credits: CREDITS, site: location.host, bomb, popElapsed: motion.popElapsed, ringAspect });
  // A new screen or window size can change the oval's shape: then draw once more with the real one.
  const box = document.querySelector("#projector .circle")?.getBoundingClientRect();
  if (box && box.width > 0 && box.height > 0 && Math.abs(box.width / box.height - ringAspect) > 0.005) {
    ringAspect = box.width / box.height;
    if (again) draw(false);
  }
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

// Mute is off by default.
$("mutebtn").addEventListener("click", () => {
  const muted = $("mutebtn").getAttribute("aria-pressed") !== "true";
  sound.setMuted(muted);
  $("mutebtn").setAttribute("aria-pressed", String(muted));
  $("mutebtn").textContent = muted ? "Unmute" : "Mute";
  document.body.dataset.muted = String(muted);
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
  if (hosting) sounds.step(ms);
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
