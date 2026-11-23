// DOM wiring for the join page and the player screen. All logic lives in the other modules.
import { createConnection } from "./net.js";
import { createCountdown, URGENT_MS } from "./countdown.js";
import { renderPlayer, reasonText } from "./render-player.js";
import { themeOf } from "./theme.js";
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

function draw() {
  if (!view || status === "kicked" || status === "ended") return;
  const root = $("game");
  const old = /** @type {HTMLInputElement | null} */ (root.querySelector("#word"));
  const text = old ? old.value : "";
  root.innerHTML = renderPlayer(view, { countdownMs: countdown.remainingMs(), lastResult, status });
  const box = /** @type {HTMLInputElement | null} */ (root.querySelector("#word"));
  if (box) {
    box.value = text;
    box.focus();
    box.setSelectionRange(text.length, text.length);
  }
}

// The text box is replaced on every view, so listen on the container.
let lastTypingAt = 0;
/** @type {any} */ let typingTimer = null;
$("game").addEventListener("input", (ev) => {
  const box = /** @type {HTMLInputElement} */ (ev.target);
  if (box.id !== "word") return;
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
  if (out.clear) box.value = "";
  else {
    lastResult = { ok: false, reason: "not-sent" };
    draw();
  }
});

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
