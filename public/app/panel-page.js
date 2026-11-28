// DOM wiring for the control panel, shared by the control page and the projector's overlay.
// Rendering is renderControl's job; this file only handles clicks, changes and focus.
import { renderControl, kickClick } from "./render-control.js";
import { reasonText } from "./render-player.js";
import { themeOf } from "./theme.js";

const KICK_CONFIRM_MS = 3000;
/** How long Copy words says "Copied". */
const COPIED_MS = 2000;

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
  // Whether "More settings" is open. The panel redraws on every view, so the fold's state lives here.
  let moreOpen = false;
  // Copy words: "Copied" for a moment, or the words in a box when the clipboard refuses.
  let copied = false;
  /** @type {any} */ let copiedTimer = null;
  let copyFallback = false;

  function draw() {
    if (!view) return;
    // A view can arrive while Roy is typing in a field: keep its text, cursor and focus.
    const active = /** @type {HTMLInputElement | null} */ (document.activeElement);
    const keep = active && root.contains(active) && (active.type === "text" || active.type === "number")
      ? { sel: active.classList.contains("rename") ? "input.rename" : `input[name="${active.name}"]`, value: active.value }
      : null;
    // After a click on a setup button or "More settings", the redraw would drop keyboard focus to the page.
    const act = /** @type {HTMLElement | null} */ (document.activeElement);
    const keepBtn = act && root.contains(act)
      ? act.dataset.preset ? `button[data-preset="${act.dataset.preset}"]` : act.matches("details.more > summary") ? "details.more > summary" : null
      : null;
    // Roy opens and closes the fold with the browser's own <details>: read it before it is replaced.
    const fold = /** @type {HTMLDetailsElement | null} */ (root.querySelector("details.more"));
    if (fold) moreOpen = fold.open;
    const keepBox = act && root.contains(act) && act.matches("[data-copy-fallback]");
    root.innerHTML = renderControl(view, { overlay: opts.overlay, confirmKick, renaming, message, moreOpen, copied, copyFallback });
    if (keepBox) selectFallback();
    if (keepBtn) /** @type {HTMLElement | null} */ (root.querySelector(keepBtn))?.focus();
    if (keep) {
      const box = /** @type {HTMLInputElement | null} */ (root.querySelector(keep.sel));
      if (box && !box.disabled) {
        box.value = keep.value;
        box.focus();
      }
    }
  }

  /** Focus the fallback box with all its words selected, ready to copy by hand. */
  function selectFallback() {
    const box = /** @type {HTMLTextAreaElement | null} */ (root.querySelector("[data-copy-fallback]"));
    if (!box || box.hidden) return;
    box.focus();
    box.select();
  }

  /** Copy the wall's words, one per line, in this browser only. Nothing is stored. */
  function copyWords() {
    const words = Array.isArray(view?.words) ? view.words.filter((/** @type {unknown} */ w) => typeof w === "string") : [];
    const refused = () => {
      copyFallback = true;
      draw();
      selectFallback();
    };
    const clip = navigator.clipboard;
    if (!clip || typeof clip.writeText !== "function") return refused();
    clip.writeText(words.join("\n")).then(() => {
      copied = true;
      copyFallback = false;
      if (copiedTimer !== null) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copiedTimer = null;
        copied = false;
        draw();
      }, COPIED_MS);
      draw();
    }, refused);
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
    if (el.hasAttribute("data-copy-words")) return copyWords();
    const preset = el.dataset.preset;
    if (preset) return send({ t: "cmd", cmd: "settings", settings: { preset } });
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
      // A new game: the copy box from the last one goes.
      if (v.phase !== "results") {
        copyFallback = false;
        copied = false;
      }
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
