// DOM wiring for the join page and the player screen. All logic lives in the other modules.
import { createConnection } from "./net.js";
import { createCountdown, URGENT_MS } from "./countdown.js";
import { renderPlayer, reasonText, wordTiles } from "./render-player.js";
import { themeOf } from "./theme.js";
import { BOMB_CSS } from "./bomb.js";
import { createMotion } from "./motion.js";
import { initialJoin, saveJoin, clearJoin, terminalError, joinStatusText, submitOutcome, rememberKick, wasKicked, KICKED_TEXT } from "./session.js";

const TYPING_GAP_MS = 100; // at most 10 typing messages a second

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const codeBox = /** @type {HTMLInputElement} */ ($("code"));
const nickBox = /** @type {HTMLInputElement} */ ($("nick"));
const joinBtn = /** @type {HTMLButtonElement} */ ($("joinbtn"));

/** A token for this tab, kept in sessionStorage. Never shown and never put in a URL. */
function token() {
  let t = sessionStorage.getItem("bomb.token");
  if (!t) {
    t = crypto.randomUUID();
    sessionStorage.setItem("bomb.token", t);
  }
  return t;
}

const start = initialJoin(sessionStorage, location.search);
codeBox.value = start.code;
nickBox.value = start.nickname;
codeBox.addEventListener("input", () => {
  codeBox.value = codeBox.value.replace(/[^A-Za-z]/g, "").toUpperCase();
});

/** @type {any} */ let view = null;
/** @type {any} */ let lastResult;
let lastPromptText = "";
let status = "connecting";
let joined = false;
/** @type {ReturnType<typeof createConnection> | null} */ let conn = null;
const countdown = createCountdown(() => Date.now());
const motion = createMotion(() => Date.now());

/** @param {string} text */
function joinError(text) {
  $("joinerror").textContent = text;
}

$("joinform").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const code = codeBox.value.trim().toUpperCase();
  const nickname = nickBox.value.trim();
  if (code.length !== 4) return joinError("The room code has 4 letters");
  if (!nickname) return joinError("Type a nickname");
  if (wasKicked(localStorage, code)) return joinError(KICKED_TEXT);
  connect(code, nickname);
});

/** @param {string} code @param {string} nickname */
function connect(code, nickname) {
  joinError("");
  conn?.close();
  joined = false;
  pending = { code, nickname };
  conn = createConnection(
    {
      WebSocket,
      url: location.origin.replace(/^http/, "ws") + "/api/ws",
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h),
    },
    onMessage,
    onStatus,
  );
  conn.setHello({ t: "join", code, token: token(), nickname });
}

/** @type {{ code: string, nickname: string } | null} */ let pending = null;
if (start.auto && wasKicked(localStorage, start.code)) {
  clearJoin(sessionStorage);
  joinError(KICKED_TEXT);
} else if (start.auto) connect(start.code, start.nickname);

/** @param {any} msg */
function onMessage(msg) {
  if (msg.t === "welcome") {
    joined = true;
    if (pending) saveJoin(sessionStorage, pending.code, pending.nickname);
    $("join").hidden = true;
    $("game").hidden = false;
  } else if (msg.t === "view") {
    view = msg.view;
    document.documentElement.dataset.theme = themeOf(view);
    countdown.update(view);
    motion.view(view);
    const text = view.prompt ? view.prompt.text : "";
    if (text !== lastPromptText) lastResult = undefined;
    lastPromptText = text;
    draw();
  } else if (msg.t === "result") {
    lastResult = msg;
    draw();
  } else if (msg.t === "error") {
    const end = terminalError(msg.reason);
    if (end) {
      if (msg.reason === "kicked" && pending) rememberKick(localStorage, pending.code);
      conn?.close();
      conn = null;
      clearJoin(sessionStorage);
      showEnd(end);
    } else if (!joined) {
      conn?.close();
      conn = null;
      clearJoin(sessionStorage);
      joinError(reasonText(msg.reason));
    } else {
      lastResult = { ok: false, reason: msg.reason };
      draw();
    }
  }
}

/** @param {string} s */
function onStatus(s) {
  status = s;
  // A kick is remembered for the whole browser, so a new tab can't rejoin that room.
  if (s === "kicked" && pending) rememberKick(localStorage, pending.code);
  if (s === "kicked" || s === "ended") clearJoin(sessionStorage);
  if (s === "kicked") return showEnd("You were removed from the game");
  if (s === "ended") return showEnd("This game has ended. Ask your teacher for a new code");
  if (joined) draw();
  else joinError(joinStatusText(s));
}

/** @param {string} text */
function showEnd(text) {
  if (joined) {
    $("game").innerHTML = `<main class="watching"><h1>${text}</h1><p><a href="/">Back to the start</a></p></main>`;
  } else {
    joinError(text);
  }
}

/**
 * Draws the typed letters as tiles under the see-through text box, with the caret where the cursor
 * is, and keeps the caret in view when the word is longer than the box.
 */
function paintWord() {
  const box = document.getElementById("word");
  const mirror = document.getElementById("word-tiles");
  if (!(box instanceof HTMLInputElement) || !mirror) return;
  mirror.innerHTML = wordTiles(box.value, box.selectionStart ?? box.value.length);
  const caret = /** @type {HTMLElement | null} */ (mirror.querySelector(".caret"));
  mirror.scrollLeft = caret ? Math.max(0, caret.offsetLeft - mirror.clientWidth + 40) : 0;
}

function draw() {
  if (!view || status === "kicked" || status === "ended") return;
  const root = $("game");
  const old = /** @type {HTMLInputElement | null} */ (root.querySelector("#word"));
  const text = old ? old.value : "";
  const selStart = old?.selectionStart ?? text.length;
  const selEnd = old?.selectionEnd ?? text.length;
  // A keyboard user moving around the emoji picker keeps their place when the screen is redrawn.
  const active = document.activeElement;
  const pickFocus = active instanceof HTMLElement && root.contains(active) ? active.dataset.avatar : undefined;
  const countdownMs = countdown.remainingMs();
  const bomb = motion.bombState(countdownMs, view.phase === "playing" && !view.paused);
  root.innerHTML = renderPlayer(view, { countdownMs, lastResult, status, bomb });
  const box = /** @type {HTMLInputElement | null} */ (root.querySelector("#word"));
  if (box) {
    box.value = text;
    box.focus();
    // Where the cursor was (a redraw keeps it), and the typed letters on their tiles straight away.
    box.setSelectionRange(Math.min(selStart, text.length), Math.min(selEnd, text.length));
    paintWord();
  } else if (pickFocus !== undefined) {
    /** @type {HTMLElement | null} */ (root.querySelector(`button[data-avatar="${Number(pickFocus)}"]`))?.focus();
  }
}

// The emoji picker is replaced on every view too. If a redraw lands between the press and the
// release of a click, the button under the pointer is the new one.
$("game").addEventListener("click", (ev) => {
  const at = ev.detail > 0 ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
  const hit = ev.target instanceof Element ? ev.target.closest("button[data-avatar]") : null;
  const btn = /** @type {HTMLButtonElement | null} */ (hit ?? at?.closest("button[data-avatar]") ?? null);
  if (!btn || btn.disabled || !$("game").contains(btn)) return;
  conn?.send({ t: "avatar", avatar: Number(btn.dataset.avatar) });
});

// The text box is replaced on every view, so listen on the container.
let lastTypingAt = 0;
/** @type {any} */ let typingTimer = null;
$("game").addEventListener("input", (ev) => {
  const box = /** @type {HTMLInputElement} */ (ev.target);
  if (box.id !== "word") return;
  paintWord();
  const wait = lastTypingAt + TYPING_GAP_MS - Date.now();
  const send = () => {
    typingTimer = null;
    lastTypingAt = Date.now();
    const cur = /** @type {HTMLInputElement | null} */ (document.getElementById("word"));
    conn?.send({ t: "typing", text: (cur ? cur.value : "").slice(0, 60) });
  };
  if (wait <= 0) send();
  else if (typingTimer === null) typingTimer = setTimeout(send, wait);
});
$("game").addEventListener("keydown", (ev) => {
  const box = /** @type {HTMLInputElement} */ (ev.target);
  if (box.id !== "word" || ev.key !== "Enter") return;
  ev.preventDefault();
  const word = box.value.trim();
  if (!word) return;
  const out = submitOutcome(conn ? conn.send({ t: "submit", word }) : false);
  if (out.clear) {
    box.value = "";
    paintWord();
  } else {
    lastResult = { ok: false, reason: "not-sent" };
    draw();
  }
});

// The cursor moved without typing (arrow keys, Home, End, a click in the box): move the tile caret.
for (const type of ["keyup", "select", "pointerup", "focusin"]) {
  $("game").addEventListener(type, (ev) => {
    if (ev.target instanceof HTMLInputElement && ev.target.id === "word") paintWord();
  });
}

// Keep the box focused, even after a click elsewhere.
document.addEventListener("click", () => {
  const box = document.getElementById("word");
  if (box && window.getSelection()?.isCollapsed !== false) box.focus();
});

// Count the bomb down locally between views.
setInterval(() => {
  const ms = countdown.remainingMs();
  if (ms === null) return;
  for (const el of document.querySelectorAll("[data-countdown]")) el.textContent = String(Math.ceil(ms / 1000));
  for (const el of document.querySelectorAll("[data-bomb]")) el.classList.toggle("urgent", ms <= URGENT_MS);
}, 200);

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
