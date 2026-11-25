// DOM wiring for the control panel, shared by the control page and the projector's overlay.
// Rendering is renderControl's job; this file only handles clicks, changes and focus.
import { renderControl, kickClick } from "./render-control.js";
import { reasonText } from "./render-player.js";
import { themeOf } from "./theme.js";

const KICK_CONFIRM_MS = 3000;

/**
 * @param {HTMLElement} root
 * @param {{ overlay: boolean, send: (msg: object) => boolean }} opts
 */
export function mountPanel(root, opts) {
  /** @type {any} */ let view = null;
  /** @type {string | null} */ let confirmKick = null;
  /** @type {any} */ let kickTimer = null;
  /** @type {string | null} */ let renaming = null;
  let message = "";

  function draw() {
    if (!view) return;
    // A view can arrive while Roy is typing in a field: keep its text, cursor and focus.
    const active = /** @type {HTMLInputElement | null} */ (document.activeElement);
    const keep = active && root.contains(active) && (active.type === "text" || active.type === "number")
      ? { sel: active.classList.contains("rename") ? "input.rename" : `input[name="${active.name}"]`, value: active.value }
      : null;
    root.innerHTML = renderControl(view, { overlay: opts.overlay, confirmKick, renaming, message });
    if (keep) {
      const box = /** @type {HTMLInputElement | null} */ (root.querySelector(keep.sel));
      if (box && !box.disabled) {
        box.value = keep.value;
        box.focus();
      }
    }
  }

  /** @param {object} msg */
  function send(msg) {
    if (!opts.send(msg)) {
      message = "Not connected. Try again in a moment";
      draw();
    }
  }

  function saveRename() {
    const box = /** @type {HTMLInputElement | null} */ (root.querySelector("input.rename"));
    if (box && renaming) {
      const nickname = box.value.trim();
      if (nickname) send({ t: "cmd", cmd: "rename", pid: renaming, nickname });
    }
    renaming = null;
    draw();
  }

  root.addEventListener("click", (ev) => {
    const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest("button"));
    if (!el || !root.contains(el)) return;
    const cmd = el.dataset.cmd;
    if (cmd) return send({ t: "cmd", cmd });
    const pid = el.dataset.pid ?? "";
    switch (el.dataset.action) {
      case "kick": {
        const r = kickClick(confirmKick, pid);
        if (kickTimer !== null) clearTimeout(kickTimer);
        kickTimer = null;
        confirmKick = r.pending;
        if (r.send) send({ t: "cmd", cmd: "kick", pid });
        if (confirmKick !== null) {
          kickTimer = setTimeout(() => {
            kickTimer = null;
            confirmKick = null;
            draw();
          }, KICK_CONFIRM_MS);
        }
        return draw();
      }
      case "rename": {
        renaming = pid;
        draw();
        const box = /** @type {HTMLInputElement | null} */ (root.querySelector("input.rename"));
        box?.focus();
        box?.select();
        return;
      }
      case "rename-save":
        return saveRename();
      case "rename-cancel":
        renaming = null;
        return draw();
    }
  });

  root.addEventListener("keydown", (ev) => {
    const box = /** @type {HTMLElement} */ (ev.target);
    if (box.classList.contains("rename")) {
      if (ev.key === "Enter") { ev.preventDefault(); saveRename(); }
      if (ev.key === "Escape") { ev.preventDefault(); renaming = null; draw(); }
    } else if (box.tagName === "INPUT" && ev.key === "Enter") {
      ev.preventDefault(); // Enter in a number box sends its change, it doesn't submit the form
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  root.addEventListener("submit", (ev) => ev.preventDefault());

  root.addEventListener("change", (ev) => {
    const el = /** @type {HTMLInputElement | HTMLSelectElement} */ (ev.target);
    if (!view || !el.name || el.classList.contains("rename")) return;
    const decl = (view.settingDecls ?? []).find((/** @type {any} */ d) => d.key === el.name);
    if (!decl) return;
    /** @type {unknown} */ let value;
    if (decl.kind === "number") {
      value = Number(el.value);
      if (el.value === "" || !Number.isFinite(value)) return;
    } else if (decl.kind === "boolean") value = /** @type {HTMLInputElement} */ (el).checked;
    else if (decl.kind === "choice") value = el.value;
    else {
      value = [...root.querySelectorAll(`input[name="${decl.key}"]:checked`)].map((b) => /** @type {HTMLInputElement} */ (b).value);
    }
    send({ t: "cmd", cmd: "settings", settings: { [decl.key]: value } });
  });

  return {
    /** @param {any} v a controlView */
    setView(v) {
      view = v;
      // The control page follows the theme too. On the projector the overlay's view is the same room.
      document.documentElement.dataset.theme = themeOf(v);
      if (renaming && !v.players.some((/** @type {any} */ p) => p.id === renaming)) renaming = null;
      draw();
    },
    /** A result or error from the server. @param {{ ok?: boolean, reason?: string }} msg */
    setResult(msg) {
      message = msg.ok ? "" : reasonText(msg.reason);
      draw();
    },
  };
}
