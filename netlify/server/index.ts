// Netlify Server entry. Only this file imports from @netlify/server.
import { upgradeWebSocket, getWebSockets, onShutdown } from "@netlify/server";
import type { Config } from "@netlify/server";
import { handlePing, attachSocket, type CheckServerDeps } from "./check-server.ts";

const deps: CheckServerDeps = {
  instanceId: crypto.randomUUID(),
  startedAt: Date.now(),
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

onShutdown(() => {
  for (const socket of getWebSockets()) socket.close(1012, "Server restarting");
});

export default async (req: Request) => {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/ping") return handlePing(deps);

  if (pathname === "/api/ws" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const { socket, response } = upgradeWebSocket(req);
    attachSocket(socket, deps);
    return response;
  }

  return new Response("Not found", { status: 404 });
};

export const config: Config = { path: "/api/*" };
