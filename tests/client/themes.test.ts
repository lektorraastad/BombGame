import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { THEME_IDS } from "../../src/engine/settings.ts";
import { THEME_IDS as THEME_IDS_CLIENT, themeOf } from "../../public/app/theme.js";
import { BOMB_CSS } from "../../public/app/bomb.js";

const APP = new URL("../../public/app/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, APP), "utf8");

const NAMES = [
  "--stage", "--tile", "--tile-edge", "--tile-ink", "--bomb", "--bomb-shade", "--spark", "--names", "--muted", "--lives",
  "--panel", "--answered", "--refusal", "--turn", "--bomb-rim",
];

/** Each theme's colours from themes.css: { workshop: { "--stage": "#1F2A36", … }, … }. */
function parseThemes(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const m of read("themes.css").matchAll(/:root[^{]*data-theme="([^"]+)"[^{]*\{([^}]*)\}/g)) {
    const colours: Record<string, string> = {};
    for (const [, name, hex] of m[2].matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) colours[name] = hex.toUpperCase();
    out[m[1]] = colours;
  }
  return out;
}

/** WCAG 2 relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("every theme defines the same 15 colours", () => {
  const themes = parseThemes();
  for (const id of THEME_IDS) {
    assert.ok(themes[id], `a block for ${id}`);
    assert.deepEqual(Object.keys(themes[id]).sort(), [...NAMES].sort(), id);
  }
});

test("client theme list matches the server's", () => assert.deepEqual(THEME_IDS_CLIENT, [...THEME_IDS]));

test("css theme blocks match the theme list", () => {
  assert.deepEqual(Object.keys(parseThemes()), [...THEME_IDS]);
  // Workshop is also the colours used before any view has arrived.
  assert.match(read("themes.css"), /:root,\s*:root\[data-theme="workshop"\]\s*\{/);
});

test("readable in every theme", () => {
  // [fg, bg, min]: normal text 4.5, large text and shapes 3
  const PAIRS: [string, string, number][] = [
    ["--tile-ink", "--tile", 4.5], ["--names", "--stage", 4.5], ["--muted", "--stage", 4.5],
    ["--names", "--panel", 4.5], ["--muted", "--panel", 4.5], ["--refusal", "--stage", 4.5],
    ["--tile-ink", "--spark", 3], ["--lives", "--stage", 3], ["--answered", "--stage", 3],
    ["--spark", "--stage", 3], ["--tile", "--stage", 3], ["--bomb-rim", "--stage", 3],
    // The ring round the setup in use, on the settings panel.
    ["--spark", "--panel", 3],
    // Banners and answered ticks put tile ink on these.
    ["--tile-ink", "--refusal", 4.5], ["--tile-ink", "--answered", 4.5],
    // The countdown number on the bomb (large text), calm and urgent.
    ["--names", "--bomb", 3], ["--spark", "--bomb", 3],
  ];
  // Those are the colours the bomb file gives the countdown.
  assert.match(BOMB_CSS, /\.bomb-count \{[^}]*color: var\(--names\)/);
  assert.match(BOMB_CSS, /\.urgent \.bomb-count \{[^}]*color: var\(--spark\)/);
  for (const [theme, c] of Object.entries(parseThemes())) {
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(c[fg], c[bg]);
      assert.ok(ratio >= min, `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}`);
    }
  }
});

test("Workshop keeps Roy's colours", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(parseThemes().workshop).filter(([k]) => !["--panel", "--answered", "--refusal", "--turn", "--bomb-rim"].includes(k))),
    {
      "--stage": "#1F2A36", "--tile": "#E8C48C", "--tile-edge": "#B48A4E", "--tile-ink": "#2B1D10", "--bomb": "#C8243A",
      "--bomb-shade": "#8E1626", "--spark": "#FFC93C", "--names": "#F3EDE2", "--muted": "#8D9AA8", "--lives": "#FF6B6B",
    },
  );
});

test("Enamel and Night fuse keep the sketched colours", () => {
  const t = parseThemes();
  const has = (id: string, given: Record<string, string>) => {
    for (const [k, v] of Object.entries(given)) assert.equal(t[id][k], v, `${id} ${k}`);
  };
  has("enamel", {
    "--stage": "#243244", "--tile": "#F3F0E8", "--tile-ink": "#1A2430", "--tile-edge": "#C9C3B4",
    "--bomb": "#1A2430", "--turn": "#FF5A4E", "--spark": "#FFD23F", "--names": "#EEF2F7", "--muted": "#93A1B3",
  });
  has("night-fuse", {
    "--stage": "#16202A", "--tile": "#DCE6E1", "--tile-ink": "#13201B", "--tile-edge": "#A9BAB2",
    "--bomb": "#0E141A", "--turn": "#FFC23D", "--spark": "#E8364F", "--names": "#E8EEF0", "--muted": "#7F8E99",
  });
});

test("no colour is written outside themes.css", () => {
  const HEX = /#[0-9a-f]{3,8}\b/i;
  const FN = /\b(rgba?|hsla?)\(/;
  const css = read("style.css");
  assert.ok(!HEX.test(css), `style.css has ${css.match(HEX)?.[0]}`);
  assert.ok(!FN.test(css), `style.css has ${css.match(FN)?.[0]}`);
  for (const f of readdirSync(APP).filter((n) => n.endsWith(".js"))) {
    const js = read(f);
    assert.ok(!FN.test(js), `${f} has ${js.match(FN)?.[0]}`);
    for (const m of js.matchAll(/\b\w+_CSS\s*=\s*(`[^`]*`|"[^"]*"|'[^']*')/g)) {
      assert.ok(!HEX.test(m[1]), `${f}: a colour inside ${m[0].slice(0, 30)}`);
    }
  }
});

test("while a game runs, the active setup button still looks pressed", () => {
  // Locked buttons are dashed, see-through and faded; the pressed setup keeps a solid border, full
  // opacity, readable name colour and the spark ring, so Roy can see which setup the game uses.
  const css = read("style.css");
  const rule = css.match(/\.ctl \.presets button\[aria-pressed="true"\]:disabled\s*\{([^}]*)\}/)?.[1];
  assert.ok(rule, "a rule for the pressed setup while locked");
  assert.match(rule, /opacity:\s*1\b/);
  assert.match(rule, /border:\s*3px solid var\(--names\)/);
  assert.match(rule, /color:\s*var\(--names\)/);
  assert.match(rule, /box-shadow:\s*0 0 0 4px var\(--spark\)/);
});

test("themeOf falls back to workshop", () => {
  assert.equal(themeOf({ theme: "enamel" }), "enamel");
  assert.equal(themeOf({ theme: "night-fuse" }), "night-fuse");
  assert.equal(themeOf({ theme: '"><img src=x>' }), "workshop");
  assert.equal(themeOf({ theme: "toString" }), "workshop");
  assert.equal(themeOf({ theme: 3 }), "workshop");
  assert.equal(themeOf({}), "workshop");
  assert.equal(themeOf(null), "workshop");
});

test("pages link themes.css before style.css", () => {
  for (const page of ["index.html", "host.html", "control.html"]) {
    const html = readFileSync(new URL(`../../public/${page}`, import.meta.url), "utf8");
    const themes = html.indexOf(`href="/app/themes.css"`);
    assert.ok(themes >= 0 && themes < html.indexOf(`href="/app/style.css"`), page);
  }
});

test("fonts are local woff2 files with font-display: swap", () => {
  const css = read("style.css");
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(faces.length, 3);
  for (const f of faces) {
    assert.match(f, /font-display:\s*swap/);
    assert.match(f, /src:\s*url\("\/fonts\/[a-z0-9-]+\.woff2"\)\s*format\("woff2"\)/);
    const file = f.match(/\/fonts\/([a-z0-9-]+\.woff2)/)![1];
    assert.ok(readFileSync(new URL(`../../public/fonts/${file}`, import.meta.url)).length > 1000, file);
  }
  assert.ok(!/url\(\s*["']?(https?:)?\/\//.test(css), "nothing loaded from outside the site");
  assert.match(css, /--font-read:/);
  assert.match(css, /--font-display:/);
  assert.ok(!/var\(--font\)/.test(css), "the old --font is gone");
});
