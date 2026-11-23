// Which colour theme a page shows. The colours themselves live in themes.css, one block per theme;
// the page sets <html data-theme="…"> from each view. A value the client doesn't know (an older
// server, a tampered message) falls back to Workshop and never reaches the page as it came.

/** A copy of the server's THEME_IDS (src/engine/settings.ts); a test checks they match. */
export const THEME_IDS = ["workshop", "enamel", "night-fuse"];

/**
 * @param {any} view any view from the server
 * @returns {string} one of THEME_IDS
 */
export function themeOf(view) {
  const theme = view?.theme;
  return typeof theme === "string" && THEME_IDS.includes(theme) ? theme : "workshop";
}
