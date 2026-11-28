// The control panel as an HTML string, plus the small pure rules it needs. Pure: no DOM access, and
// every piece of text that came from a player goes through esc(). In overlay mode (shown on the
// projector, which the class may see) there are no score or ghost-point columns.
import { esc } from "./escape.js";
import { avatarImg } from "./avatars.js";

/** Fewer prompts than this for a band and type, and the panel warns that they will repeat. */
export const FEW_PROMPTS = 15;

/**
 * @typedef {{ overlay: boolean, confirmKick?: string | null, renaming?: string | null, message?: string, moreOpen?: boolean, copied?: boolean, copyFallback?: boolean }} ControlUi
 * @typedef {Record<string, Record<string, number>>} PromptCounts
 */

/** @type {Record<string, string>} */
const TYPE_LABEL = { contains: "Contains", starts: "Starts with", ends: "Ends with" };
/** @type {Record<string, string>} */
const BAND_LABEL = { easy: "Easy", normal: "Normal", rising: "Rising", hard: "Hard" };
/** Settings that change only how the game looks: never locked, shown under "Look". */
const LOOK_KEYS = ["theme"];
/** Shown at the top of "Settings", above the setup buttons; the rest go under "More settings". */
const TOP_KEYS = ["mode"];
/** The setting drawn as the setup buttons. Its "custom" option is never a button. */
const PRESET_KEY = "preset";
/** @type {Record<string, string>} */
const PHASE_LABEL = { lobby: "Lobby", playing: "Playing", paused: "Paused", results: "Game over" };

/**
 * What a click on a player's Kick button does: the first click arms it, a second click on the
 * same player's button kicks. The page disarms it again after 3 seconds.
 * @param {string | null} pending the player whose Kick button is armed
 * @param {string} pid the player whose button was clicked
 * @returns {{ send: boolean, pending: string | null }}
 */
export function kickClick(pending, pid) {
  return pending === pid ? { send: true, pending: null } : { send: false, pending: pid };
}

/**
 * Warnings for each selected prompt type with fewer than FEW_PROMPTS prompts at this band.
 * @param {PromptCounts | undefined} counts @param {string} band @param {string[]} types
 * @returns {string[]}
 */
export function promptWarnings(counts, band, types) {
  const out = [];
  for (const type of types) {
    const n = counts?.[band]?.[type];
    if (typeof n !== "number" || n >= FEW_PROMPTS) continue;
    const what = `"${TYPE_LABEL[type] ?? type}" prompts at ${BAND_LABEL[band] ?? band}`;
    out.push(n === 0 ? `No ${what}` : `Only ${n} ${what}. They will repeat often`);
  }
  return out;
}

/** @param {any} view */
const running = (view) => view.phase === "playing" || view.phase === "paused";

/**
 * @param {string} cmd @param {string} label @param {boolean} enabled
 */
const cmdButton = (cmd, label, enabled) => `<button type="button" data-cmd="${cmd}"${enabled ? "" : " disabled"}>${label}</button>`;

/**
 * @param {any} view a controlView from the server, with the hub's promptCounts
 * @param {ControlUi} ui
 * @returns {string}
 */
export function renderControl(view, ui) {
  const msg = ui.message ? `<p class="ctl-msg" role="alert">${esc(ui.message)}</p>` : "";
  return `<div class="ctl${ui.overlay ? " ctl-overlay" : ""}">
<header class="ctl-head"><span>Room <strong>${esc(view.code)}</strong></span><span>${PHASE_LABEL[view.phase] ?? ""}${view.locked ? " · Locked" : ""}</span></header>
${msg}${buttons(view)}${endButtons(view, ui)}${status(view)}${players(view, ui)}${settings(view, ui)}
</div>`;
}

/** @param {any} view */
function buttons(view) {
  const playing = view.phase === "playing";
  const pause = view.paused ? cmdButton("resume", "Resume", true) : cmdButton("pause", "Pause", playing);
  return `<section class="ctl-buttons">
${cmdButton("start", "Start", view.phase === "lobby")}${pause}${cmdButton("skip", "Skip", playing)}${cmdButton("end", "End", running(view))}${cmdButton("playAgain", "Play again", view.phase === "results")}${view.locked ? cmdButton("unlock", "Unlock", true) : cmdButton("lock", "Lock", true)}
</section>`;
}

/**
 * On the results: Show words (moves the projector to the wall; off once it shows) and Copy words
 * (the wall's words, one per line). The box holds the same words for copying by hand, hidden until
 * the clipboard refuses. The words are already public on the projector, so the overlay has them too.
 * @param {any} view @param {ControlUi} ui
 */
function endButtons(view, ui) {
  if (view.phase !== "results") return "";
  const words = (Array.isArray(view.words) ? view.words : []).filter((/** @type {unknown} */ w) => typeof w === "string");
  const onWall = view.results?.step === "words";
  const copy = `<button type="button" data-copy-words${words.length ? "" : " disabled"}>${ui.copied ? "Copied" : "Copy words"}</button>`;
  const box = `<textarea class="ctl-copybox" data-copy-fallback readonly rows="6" aria-label="The words, to copy by hand"${ui.copyFallback ? "" : " hidden"}>${esc(words.join("\n"))}</textarea>`;
  return `<section class="ctl-end">${cmdButton("showWords", "Show words", !onWall)}${copy}${box}</section>`;
}

/** @param {any} view */
function status(view) {
  if (!running(view) || !view.prompt) return "";
  const current = typeof view.mode?.current === "string" ? view.players.find((/** @type {any} */ p) => p.id === view.mode.current) : null;
  const turn = current ? ` · ${esc(current.nickname)}'s turn` : "";
  return `<p class="ctl-status">Prompt: <strong>${esc(view.prompt.text.toUpperCase())}</strong> (${TYPE_LABEL[view.prompt.type] ?? ""})${turn}</p>`;
}

/** @param {any} view @param {ControlUi} ui */
function players(view, ui) {
  const priv = !ui.overlay;
  const head = `<tr><th>Name</th><th>Lives</th>${priv ? "<th>Score</th><th>Ghost points</th>" : ""}<th></th><th></th></tr>`;
  const rows = view.players
    .map((/** @type {any} */ p) => {
      const id = esc(p.id);
      const name = ui.renaming === p.id
        ? `<input class="rename" data-pid="${id}" type="text" maxlength="16" value="${esc(p.nickname)}" aria-label="New nickname"> <button type="button" data-action="rename-save" data-pid="${id}">Save</button> <button type="button" data-action="rename-cancel">Cancel</button>`
        : `${esc(p.nickname)} <button type="button" class="small" data-action="rename" data-pid="${id}">Rename</button>`;
      const state = !p.connected ? "offline" : p.spectator ? "next game" : !p.alive && view.phase !== "lobby" ? "out" : "";
      const armed = ui.confirmKick === p.id;
      const kick = `<button type="button" class="small kick${armed ? " armed" : ""}" data-action="kick" data-pid="${id}">${armed ? "Really kick?" : "Kick"}</button>`;
      const cols = priv ? `<td>${esc(p.score)}</td><td>${esc(p.ghostPoints)}</td>` : "";
      return `<tr><td class="name">${avatarImg(p.avatar)} ${name}</td><td>${esc(p.lives)}</td>${cols}<td class="state">${state}</td><td>${kick}</td></tr>`;
    })
    .join("");
  const list = view.players.length ? `<table>${head}${rows}</table>` : `<p>No players yet.</p>`;
  return `<section class="ctl-players"><h2>Players (${view.players.length})</h2>${list}</section>`;
}

/** @param {any} view @param {ControlUi} ui */
function settings(view, ui) {
  const locked = running(view);
  const s = view.settings ?? {};
  const types = Array.isArray(s.promptTypes) ? s.promptTypes : [];
  const warnings = promptWarnings(view.promptCounts, String(s.band), types)
    .map((w) => `<p class="warning">⚠ ${esc(w)}</p>`)
    .join("");
  const note = locked ? `<p class="note">Settings are locked while a game is running. End the game to change them.</p>` : "";
  const decls = view.settingDecls ?? [];
  // The look can change at any time, so it sits outside the fieldset that a running game disables.
  const isLook = (/** @type {any} */ d) => LOOK_KEYS.includes(d.key);
  const draw = (/** @type {any[]} */ list) => list.map((d) => field(d, s[d.key])).join("");
  const look = draw(decls.filter(isLook));
  const top = draw(decls.filter((/** @type {any} */ d) => TOP_KEYS.includes(d.key)));
  const presetDecl = decls.find((/** @type {any} */ d) => d.key === PRESET_KEY);
  const setup = presetDecl ? presetButtons(presetDecl, s[PRESET_KEY], locked) : "";
  const rest = draw(decls.filter((/** @type {any} */ d) => !isLook(d) && !TOP_KEYS.includes(d.key) && d.key !== PRESET_KEY));
  const more = `<details class="more"${ui.moreOpen ? " open" : ""}><summary>More settings</summary>${rest}</details>`;
  const lookSet = look ? `<fieldset class="look"><legend>Look</legend>${look}</fieldset>` : "";
  return `<form class="ctl-form" autocomplete="off">${lookSet}<fieldset class="settings"${locked ? " disabled" : ""}><legend>Settings</legend>${note}${top}${setup}${warnings}${more}</fieldset></form>`;
}

/**
 * The setup buttons (every option but Custom), the pressed one matching `value`, and a "Using:" line.
 * @param {any} d the preset SettingDecl @param {any} value @param {boolean} locked
 */
function presetButtons(d, value, locked) {
  const opts = d.options ?? [];
  const btns = opts
    .filter((/** @type {any} */ o) => o.value !== "custom")
    .map((/** @type {any} */ o) => `<button type="button" data-preset="${esc(o.value)}" aria-pressed="${o.value === value}"${locked ? " disabled" : ""}>${esc(o.label)}</button>`)
    .join("");
  const using = opts.find((/** @type {any} */ o) => o.value === value)?.label ?? "Custom";
  const help = d.help ? `<small class="help">${esc(d.help)}</small>` : "";
  return `<div class="field presets" role="group" aria-label="${esc(d.label)}"><span>${esc(d.label)}</span><div class="preset-buttons">${btns}</div><small class="using">Using: ${esc(using)}</small>${help}</div>`;
}

/** @param {any} d a SettingDecl @param {any} value */
function field(d, value) {
  const key = esc(d.key);
  const help = d.help ? `<small class="help">${esc(d.help)}</small>` : "";
  const unit = d.unit === "s" ? " (seconds)" : "";
  switch (d.kind) {
    case "number":
      return `<label class="field"><span>${esc(d.label)}${unit}</span><input type="number" name="${key}" min="${esc(d.min)}" max="${esc(d.max)}" step="${esc(d.step)}" value="${esc(value)}">${help}</label>`;
    case "boolean":
      return `<label class="field check"><input type="checkbox" name="${key}"${value === true ? " checked" : ""}> <span>${esc(d.label)}</span>${help}</label>`;
    case "choice": {
      const opts = d.options
        .map((/** @type {any} */ o) => `<option value="${esc(o.value)}"${o.value === value ? " selected" : ""}>${esc(o.label)}</option>`)
        .join("");
      return `<label class="field"><span>${esc(d.label)}</span><select name="${key}">${opts}</select>${help}</label>`;
    }
    case "multi": {
      const on = Array.isArray(value) ? value : [];
      const boxes = d.options
        .map((/** @type {any} */ o) => `<label><input type="checkbox" name="${key}" value="${esc(o.value)}"${on.includes(o.value) ? " checked" : ""}> ${esc(o.label)}</label>`)
        .join("");
      const cls = d.key === "bonusLetters" ? "lettergrid" : "choices";
      return `<fieldset class="field multi"><legend>${esc(d.label)}</legend><div class="${cls}">${boxes}</div>${help}</fieldset>`;
    }
    default:
      return "";
  }
}
