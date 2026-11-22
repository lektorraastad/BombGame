// DOM wiring for the control page: a second window on Roy's laptop (it finds the host token in the
// sessionStorage copied from the projector tab) or his phone (it asks for the code and passcode).
import { createConnection } from "./net.js";
import { reasonText } from "./render-player.js";
import { mountPanel } from "./panel-page.js";

const HOST_TOKEN = "bomb.hostToken";
const HOST_CODE = "bomb.hostCode";

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const codeBox = /** @type {HTMLInputElement} */ ($("code"));
const passBox = /** @type {HTMLInputElement} */ ($("passcode"));

/** A token kept in sessionStorage for this tab. Never shown and never put in a URL. */
function tabToken() {
  let t = sessionStorage.getItem("bomb.controlToken");
  if (!t) {
    t = crypto.randomUUID();
    sessionStorage.setItem("bomb.controlToken", t);
  }
  return t;
}

/** @param {string} s */
const cleanCode = (s) => s.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();

/** @type {ReturnType<typeof createConnection> | null} */ let conn = null;
let inRoom = false;
const panel = mountPanel($("panel"), { overlay: false, send: (m) => conn?.send(m) ?? false });

/** @param {string} text */
function showStart(text) {
  inRoom = false;
  conn?.close();
  conn = null;
  $("start").hidden = false;
  $("panel").hidden = true;
  $("netstatus").hidden = true;
  $("controlerror").textContent = text;
}

/** @param {string} code @param {{ passcode: string } | { hostToken: string }} secret */
function connect(code, secret) {
  conn?.close();
  $("controlerror").textContent = "Connecting…";
  conn = createConnection(
    {
      WebSocket,
      url: location.origin.replace(/^http/, "ws") + "/api/ws",
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h),
    },
    (msg) => onMessage(msg, code),
    onStatus,
  );
  conn.setHello({ t: "control", code, token: tabToken(), ...secret });
}

/** @param {any} msg @param {string} code */
function onMessage(msg, code) {
  if (msg.t === "welcome") {
    if (msg.hostToken) {
      sessionStorage.setItem(HOST_TOKEN, msg.hostToken);
      sessionStorage.setItem(HOST_CODE, code);
    }
    // Reconnects use the host token, so the passcode is sent only once.
    const hostToken = sessionStorage.getItem(HOST_TOKEN);
    if (hostToken) conn?.setHello({ t: "control", code, token: tabToken(), hostToken });
    passBox.value = "";
    inRoom = true;
    $("start").hidden = true;
    $("panel").hidden = false;
  } else if (msg.t === "view") {
    panel.setView(msg.view);
  } else if (msg.t === "result") {
    panel.setResult(msg);
  } else if (msg.t === "error") {
    if (inRoom && msg.reason !== "no-room" && msg.reason !== "not-host") return panel.setResult(msg);
    if (msg.reason === "no-room" || msg.reason === "not-host") {
      sessionStorage.removeItem(HOST_TOKEN);
      sessionStorage.removeItem(HOST_CODE);
    }
    showStart(msg.reason === "not-host" ? "Type the host passcode" : reasonText(msg.reason));
  }
}

/** @param {string} s */
function onStatus(s) {
  if (s === "ended") {
    sessionStorage.removeItem(HOST_TOKEN);
    sessionStorage.removeItem(HOST_CODE);
    return showStart("This room has closed");
  }
  if (!inRoom) return;
  $("netstatus").hidden = s === "open";
  $("netstatus").textContent = s === "open" ? "" : "Reconnecting…";
}

codeBox.addEventListener("input", () => {
  codeBox.value = cleanCode(codeBox.value);
});

$("controlform").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const code = cleanCode(codeBox.value);
  if (code.length !== 4) return void ($("controlerror").textContent = "The room code has 4 letters");
  if (!passBox.value) return;
  connect(code, { passcode: passBox.value });
});

// Opened from the projector (or refreshed): use the host token when it belongs to this room.
{
  const fromLink = cleanCode(new URLSearchParams(location.search).get("code") ?? "");
  const storedCode = sessionStorage.getItem(HOST_CODE) ?? "";
  const hostToken = sessionStorage.getItem(HOST_TOKEN);
  const code = fromLink || storedCode;
  codeBox.value = code;
  if (code && hostToken && storedCode === code) connect(code, { hostToken });
}
