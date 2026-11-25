// Escaping for every renderer: any text that came from a player (nicknames, words) goes through esc()
// before it is put into HTML. Its own module, so the renderers can share it without import cycles.

/** @param {unknown} s */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
