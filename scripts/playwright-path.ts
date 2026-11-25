// Where Playwright is. It isn't a project dependency: the end-to-end tests and the screenshot script
// use a global install. PLAYWRIGHT_PATH (the path to Playwright's index.mjs) replaces the usual places.
import { existsSync } from "node:fs";

export const PLAYWRIGHT_PATHS = [
  "/opt/npm-tools/node_modules/playwright/index.mjs",
  "/opt/node-tools/node_modules/playwright/index.mjs",
];

/** The places to look, in order. */
export function playwrightCandidates(env: Record<string, string | undefined> = process.env): string[] {
  return env.PLAYWRIGHT_PATH ? [env.PLAYWRIGHT_PATH] : PLAYWRIGHT_PATHS;
}

/** The first place that exists, or null. */
export function findPlaywright(candidates = playwrightCandidates(), exists: (path: string) => boolean = existsSync): string | null {
  return candidates.find((p) => exists(p)) ?? null;
}

/** What to say when Playwright isn't found. */
export const notFound = (candidates = playwrightCandidates()) =>
  `Playwright not found (looked at ${candidates.join(", ")}). Install it there, or set PLAYWRIGHT_PATH to its index.mjs.`;
