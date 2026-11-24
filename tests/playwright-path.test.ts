import { test } from "node:test";
import assert from "node:assert/strict";
import { findPlaywright, playwrightCandidates, PLAYWRIGHT_PATHS } from "../scripts/playwright-path.ts";

test("Playwright is looked for at /opt/npm-tools, then /opt/node-tools", () => {
  assert.deepEqual(PLAYWRIGHT_PATHS, [
    "/opt/npm-tools/node_modules/playwright/index.mjs",
    "/opt/node-tools/node_modules/playwright/index.mjs",
  ]);
  assert.deepEqual(playwrightCandidates({}), PLAYWRIGHT_PATHS);
});

test("PLAYWRIGHT_PATH replaces the usual places", () => {
  assert.deepEqual(playwrightCandidates({ PLAYWRIGHT_PATH: "/x/playwright/index.mjs" }), ["/x/playwright/index.mjs"]);
  assert.deepEqual(playwrightCandidates({ PLAYWRIGHT_PATH: "" }), PLAYWRIGHT_PATHS);
});

test("the first place that exists is used", () => {
  const only = (p: string) => (f: string) => f === p;
  assert.equal(findPlaywright(PLAYWRIGHT_PATHS, only(PLAYWRIGHT_PATHS[1])), PLAYWRIGHT_PATHS[1]);
  assert.equal(findPlaywright(PLAYWRIGHT_PATHS, () => true), PLAYWRIGHT_PATHS[0]);
});

test("nowhere: null, so the caller can fail with a message", () => {
  assert.equal(findPlaywright(PLAYWRIGHT_PATHS, () => false), null);
  assert.equal(findPlaywright(["/missing/playwright/index.mjs"]), null);
});
