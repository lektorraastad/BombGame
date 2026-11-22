// The /api/health answer, shared by the Netlify adapter and the dev server.
// Word counts, room count and start time only: nothing private.
import type { Summary } from "../words/build.ts";

export type Health = {
  status: number;
  body:
    | { ok: true; words: Summary["counts"]; rooms: number; startedAt: number }
    | { ok: false; error: "words-not-loaded"; kind: string };
};

/** `words` is null when the word files failed to load; `kind` then says why (see wordsErrorKind). */
export function health(words: Summary["counts"] | null, rooms: number, startedAt: number, kind = "unknown"): Health {
  if (!words) return { status: 500, body: { ok: false, error: "words-not-loaded", kind } };
  return { status: 200, body: { ok: true, words, rooms, startedAt } };
}

/**
 * A safe label for why the words failed to load, for logs and the health answer:
 * a file system error code such as "ENOENT", "invalid" for any other error (bad JSON,
 * a check in the loader), or "unknown". Never a message, path or file contents.
 */
export function wordsErrorKind(e: unknown): string {
  if (!(e instanceof Error)) return "unknown";
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" && /^E[A-Z0-9]{2,20}$/.test(code)) return code;
  return "invalid";
}
