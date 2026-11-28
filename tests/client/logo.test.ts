import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLogo } from "../../public/app/logo.js";

test("the logo has the measured geometry", () => {
  const s = renderLogo("large");
  for (const part of [
    "M4.9 7.8 C194.36 17.8 454 13.3 456 0",
    'stroke-width="5.8"',
    "translate(456 0) scale(1.3214) translate(-20 -56)",
    'letter-spacing="-2"',
    'font-size="100"',
    'font-weight="800"',
    'viewBox="0 -76 481 94"',
    "M20 0 C27 13 40 22 37 38 C35 50 27 56 20 56 C12 56 3 50 3 38 C3 25 14 19 20 0Z",
    "M20 22 C24 30 30 34 28 43 C27 50 23 52 20 52 C16 52 12 49 12 43 C12 35 18 31 20 22Z",
  ]) assert.ok(s.includes(part), part);
  assert.ok(s.includes('class="logo logo-large"'));
  assert.ok(renderLogo("small").includes('class="logo logo-small"'));
});

test("the logo uses only theme colours", () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(renderLogo("small")));
  for (const v of ["--names", "--tile-edge", "--lives", "--spark"]) assert.ok(renderLogo("small").includes(`var(${v})`), v);
});

test("the logo is labelled", () => {
  assert.ok(renderLogo("large").includes('aria-label="Wordfire"'));
});
