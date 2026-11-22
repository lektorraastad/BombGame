// Netlify Server entry. Only this file imports from @netlify/server, and it stays a thin adapter:
// the game logic is in src/server/ (tested locally through scripts/dev-server.ts).
import { join } from "node:path";
import { upgradeWebSocket, getWebSockets, onShutdown } from "@netlify/server";
import type { Config } from "@netlify/server";
import { handlePing, attachSocket, type CheckServerDeps } from "./check-server.ts";
import { Hub } from "../../src/server/hub.ts";
import { health, wordsErrorKind } from "../../src/server/health.ts";
import { loadWordsFromDir } from "../../src/server/words-from-disk.ts";

const startedAt = Date.now();

/** Counts and error kinds only: never nicknames, words or the passcode. */
const log = (event: string, n?: number) => console.log(n === undefined ? `bomb: ${event}` : `bomb: ${event} ${n}`);

let words: ReturnType<typeof loadWordsFromDir> | null = null;
let wordsError = "unknown";
try {
  words = loadWordsFromDir(join(import.meta.dirname, "../../data/generated"));
} catch (e) {
  wordsError = wordsErrorKind(e);
  log(`words-not-loaded:${wordsError}`);
}

const hub = words
  ? new Hub({
      deps: { now: Date.now, setTimeout, clearTimeout, random: Math.random },
      words,
      passcode: process.env.HOST_PASSCODE,
      log,
    })
  : null;

// The old connection test, now under /api/check/.
const checkDeps: CheckServerDeps = {
  instanceId: crypto.randomUUID(),
  startedAt,
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

onShutdown(() => {
  for (const socket of getWebSockets()) socket.close(1012, "Server restarting");
});

const isUpgrade = (req: Request) => req.headers.get("upgrade")?.toLowerCase() === "websocket";

export default async (req: Request) => {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/health") {
    const h = health(words?.summary.counts ?? null, hub?.roomCount() ?? 0, startedAt, wordsError);
    return Response.json(h.body, { status: h.status, headers: { "cache-control": "no-store" } });
  }

  if (pathname === "/api/ws") {
    if (!isUpgrade(req)) return new Response("Expected a WebSocket", { status: 426 });
    if (!hub) return new Response("Words not loaded", { status: 503 });
    const { socket, response } = upgradeWebSocket(req);
    const handle = hub.connect({
      send: (text) => socket.send(text),
      close: (code, reason) => socket.close(code, reason),
    });
    socket.onmessage = (event) => handle.message(String(event.data));
    socket.onclose = () => handle.closed();
    return response;
  }

  if (pathname === "/api/check/ping") return handlePing(checkDeps);

  if (pathname === "/api/check/ws" && isUpgrade(req)) {
    const { socket, response } = upgradeWebSocket(req);
    attachSocket(socket, checkDeps);
    return response;
  }

  return new Response("Not found", { status: 404 });
};

export const config: Config = { path: "/api/*", includedFiles: ["../../data/generated/**"] };
