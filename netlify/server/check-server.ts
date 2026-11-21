// Pure logic for the connection test server. No platform imports here,
// so it can be tested locally; index.ts wires it to Netlify Server.

export const HEARTBEAT_MS = 20_000;

export type ServerSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message" | "close", fn: (ev: any) => void): void;
};

export type CheckServerDeps = {
  instanceId: string;
  startedAt: number;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (h: unknown) => void;
};

export function handlePing(deps: CheckServerDeps): Response {
  return new Response(
    JSON.stringify({ ok: true, instanceId: deps.instanceId, startedAt: deps.startedAt, serverTime: deps.now() }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}

export function attachSocket(socket: ServerSocket, deps: CheckServerDeps): void {
  const send = (msg: object) => {
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      // socket already closing; nothing to do
    }
  };

  send({ type: "hello", instanceId: deps.instanceId, startedAt: deps.startedAt, serverTime: deps.now() });

  const handle = deps.setInterval(() => {
    send({ type: "heartbeat", instanceId: deps.instanceId, serverTime: deps.now() });
  }, HEARTBEAT_MS);

  socket.addEventListener("message", (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg && msg.type === "ping") {
      send({ type: "pong", id: msg.id, instanceId: deps.instanceId, serverTime: deps.now() });
    }
  });

  socket.addEventListener("close", () => deps.clearInterval(handle));
}
