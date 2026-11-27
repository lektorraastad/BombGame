// The Wordfire logo: the word "wordfire" in Rubik ExtraBold with a fuse running under it, curling up
// into a flame after the "e". One self-contained file, a pure function returning SVG markup (like bomb.js).
//
// Every number here is from section 4.3 of docs/superpowers/specs/2026-11-27-look-and-moments-design.md,
// measured in Chromium with public/fonts/rubik-latin-800-normal.woff2 (100 units = the font size, the
// baseline at y = 0). They are only valid for this font file, this letter-spacing (-2) and this text.
// If any of them changes, measure again. The flame is the mockup's flame shape, a copy of its own:
// bomb.js and the bomb's flame don't change.
// Colours come only from the theme's named colours (themes.css). The page's Rubik is already loaded.

const FUSE = "M4.9 7.8 C194.36 17.8 454 13.3 456 0";
const FLAME_OUT = "M20 0 C27 13 40 22 37 38 C35 50 27 56 20 56 C12 56 3 50 3 38 C3 25 14 19 20 0Z";
const FLAME_IN = "M20 22 C24 30 30 34 28 43 C27 50 23 52 20 52 C16 52 12 49 12 43 C12 35 18 31 20 22Z";

/**
 * @param {"large" | "small"} size which size class to put on the logo (style.css sizes it)
 * @returns {string}
 */
export function renderLogo(size) {
  return `<svg class="logo logo-${size}" viewBox="0 -76 481 94" role="img" aria-label="Wordfire">
<text x="0" y="0" font-family="Rubik, sans-serif" font-size="100" font-weight="800" letter-spacing="-2" style="fill: var(--names)">wordfire</text>
<path d="${FUSE}" fill="none" stroke-width="5.8" stroke-linecap="round" style="stroke: var(--tile-edge)"/>
<g transform="translate(456 0) scale(1.3214) translate(-20 -56)"><path d="${FLAME_OUT}" style="fill: var(--lives)"/><path d="${FLAME_IN}" style="fill: var(--spark)"/></g>
</svg>`;
}
