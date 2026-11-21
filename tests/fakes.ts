// Test-only fakes: a virtual clock with timers, a scriptable WebSocket and fetch.

export function makeClock(start = 1_000_000) {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const flush = () => new Promise<void>((r) => setImmediate(r));
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (id: unknown) => { timers.delete(id as number); },
    delays: [] as number[],
    timers,
    /** Advance virtual time, firing due timers in order and letting promises settle. */
    async advance(ms: number) {
      const end = now + ms;
      await flush();
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | undefined;
        for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
        if (!next) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].at);
        next[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
    /** Jump the clock without firing timers in between (laptop asleep). */
    jump(ms: number) { now += ms; },
  };
}

type Listener = (ev: any) => void;

export class FakeSocket {
  static instances: FakeSocket[] = [];
  /** Script run on construct; receives the socket to drive. */
  static onCreate: (s: FakeSocket) => void = () => {};
  /** Called when the client sends; lets the "server" reply. */
  onClientSend: (data: any, s: FakeSocket) => void = () => {};
  url: string;
  readyState = 0;
  sent: any[] = [];
  closedByClient: number | undefined;
  private listeners: Record<string, Listener[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    FakeSocket.onCreate(this);
  }
  addEventListener(type: string, fn: Listener) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  send(data: string) { const m = JSON.parse(data); this.sent.push(m); this.onClientSend(m, this); }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.closedByClient = code;
    this.readyState = 3;
    this.emit("close", { code, wasClean: true });
  }
  // server-side helpers
  emit(type: string, ev: any) { for (const fn of [...(this.listeners[type] ?? [])]) fn(ev); }
  open() { this.readyState = 1; this.emit("open", {}); }
  receive(msg: object) { this.emit("message", { data: JSON.stringify(msg) }); }
  serverClose(code: number) { this.readyState = 3; this.emit("close", { code, wasClean: false }); }
  static reset() { FakeSocket.instances = []; FakeSocket.onCreate = () => {}; }
}
