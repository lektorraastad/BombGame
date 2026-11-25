// Letter tiles: any text drawn as a row of chunky tiles, one per character. Pure: returns HTML
// strings, and every character goes through esc(). Text is split with Array.from, so an emoji or
// a letter like å is one whole tile, never half of one.
import { esc } from "./escape.js";

/** @typedef {{ text: string, type: string }} PromptInfo */

/**
 * One tile per character. Whitespace leaves a gap, never an empty tile.
 * @param {string[]} chars the text's code points
 * @param {[number, number] | null} matched [from, to) code-point indexes drawn raised, or null
 * @param {string} cls extra class name(s) for the row
 */
function row(chars, matched, cls) {
  const inner = chars
    .map((c, i) => {
      if (/^\s$/u.test(c)) return `<span class="gap"></span>`;
      const on = matched !== null && i >= matched[0] && i < matched[1];
      return `<span class="${on ? "tile matched" : "tile"}">${esc(c)}</span>`;
    })
    .join("");
  return `<span class="${cls ? `tiles ${esc(cls)}` : "tiles"}">${inner}</span>`;
}

/**
 * Text as letter tiles.
 * @param {string} text
 * @param {string} [cls] extra class name(s) for the row
 * @returns {string}
 */
export function tiles(text, cls = "") {
  return row(Array.from(String(text)), null, cls);
}

/**
 * Where the prompt sits in a word, in code-point indexes [from, to), compared case-insensitively:
 * the first occurrence for "contains", the beginning for "starts", the end for "ends".
 * @param {string} word
 * @param {PromptInfo | null | undefined} prompt
 * @returns {[number, number] | null} null when the word doesn't fit the prompt
 */
export function matchRange(word, prompt) {
  if (!prompt || typeof prompt.text !== "string" || prompt.text === "") return null;
  // Lower-cased one character at a time, so the indexes still match the word's tiles.
  const w = Array.from(String(word), (c) => c.toLowerCase());
  const p = Array.from(prompt.text, (c) => c.toLowerCase());
  if (p.length > w.length) return null;
  /** @param {number} at */
  const fitsAt = (at) => p.every((c, k) => w[at + k] === c);
  if (prompt.type === "starts") return fitsAt(0) ? [0, p.length] : null;
  if (prompt.type === "ends") return fitsAt(w.length - p.length) ? [w.length - p.length, w.length] : null;
  if (prompt.type === "contains") {
    for (let at = 0; at + p.length <= w.length; at++) if (fitsAt(at)) return [at, at + p.length];
  }
  return null;
}

/**
 * A word as letter tiles, with the letters that answered the prompt raised and highlighted
 * (class "tile matched"), so the match shows by shape as well as colour.
 * @param {string} word
 * @param {PromptInfo | null | undefined} prompt
 * @returns {string}
 */
export function matchedTiles(word, prompt) {
  return row(Array.from(String(word)), matchRange(word, prompt), "");
}
