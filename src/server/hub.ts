// The hub: rooms, connections and the messages between them, with no network code.
// Adapters (Netlify, the local dev server) call connect() for each socket and pass its text in.
import { randomUUID } from "node:crypto";
import type { Band, EngineDeps, PromptType } from "../engine/types.ts";
import type { WordChecker } from "../engine/words.ts";
import type { PromptBank } from "../engine/prompts.ts";
import type { PlayerId, Room } from "../engine/room.ts";
import { makeRoomCode } from "../engine/room.ts";
import { createRoom } from "../engine/registry.ts";
import { controlView, playerView, projectorView } from "../engine/views.ts";
import { validate } from "./protocol.ts";
import type { ClientMsg, Role, ServerMsg } from "./protocol.ts";
import { AttemptLimiter, passcodeMatches } from "./passcode.ts";

export type Conn = { send(text: string): void; close(code: number, reason: string): void };
export type ConnHandle = { message(text: string): void; closed(): void };

export const MAX_ROOMS = 20;
export const IDLE_MS = 30 * 60_000;
const RATE_WINDOW_MS = 1000;
const MAX_MSGS_PER_WINDOW = 20;
const MAX_TYPING_PER_WINDOW = 10;
export const CLOSE_KICKED = 4003;
export const CLOSE_ROOM_CLOSED = 4004;
const BANDS: Band[] = ["easy", "normal", "rising", "hard"];
const PROMPT_TYPES: PromptType[] = ["contains", "starts", "ends"];

/** How many prompts the shared bank has for each band and single type, for the control panel's warning. */
export type PromptCounts = Record<Band, Record<PromptType, number>>;

function countPrompts(bank: PromptBank): PromptCounts {
  const out = {} as PromptCounts;
  for (const band of BANDS) {
    out[band] = {} as Record<PromptType, number>;
    for (const type of PROMPT_TYPES) out[band][type] = bank.size(band, [type]);
  }
  return out;
}

type Client = {
  id: string;
  conn: Conn;
  room: HubRoom | null;
  role: Role | null;
  pid: PlayerId | null;
  windowStart: number;
  count: number;
  typingCount: number;
};

type HubRoom = {
  room: Room;
  hostToken: string;
  clients: Set<Client>;
  idle: unknown;
  broadcastQueued: boolean;
  /** What the last broadcast showed, to tell an explosion or a word from the one before. */
  seen: Seen | null;
  /** The current Classic player whose word was just refused, for the next broadcast only. Never the word. */
  refused: string | null;
  /** The current turn (who has the bomb, and which prompt), timed from when the hub first saw it. */
  turn: { key: string; startedAt: number; pausedAt: number | null; pausedMs: number } | null;
};

/** The parts of a room that lastEvent and the moments compare between broadcasts. */
type Seen = {
  phase: string;
  lives: Map<string, number>;
  lastWord: string | null;
  lastWordPid: string | null;
  answered: Set<string>;
  /** Classic's current player; null in Everyone at once and the lobby. */
  current: string | null;
  /** Alive players with role "player". */
  alive: Set<string>;
  winners: string[];
  /** The prompt being played, as type:text; "" with none. */
  promptKey: string;
};

export type LastEvent = "explosion" | "word" | null;

/** Something that just happened, for the screens to mark briefly. No moment ever carries a typed word. */
export type Moment =
  | { kind: "word"; pid: string } // Classic: lastWord changed; Everyone: a new id in answered
  | { kind: "hearts"; pids: string[] } // players whose lives went down
  | { kind: "explosion" }
  | { kind: "refused"; pid: string } // only the current Classic player
  | { kind: "all-answered" } // Everyone: every alive player has answered this round
  | { kind: "win"; pids: string[] }; // phase became results with at least one winner

/** The refusal reasons that show a "refused" moment; any other refusal stays private to the sender. */
export const REFUSED_SHOWN: readonly string[] = ["not-a-word", "doesnt-match", "used", "blocked"];

function seenOf(room: Room): Seen {
  const mode = room.phase === "lobby" ? null : room.modeView();
  const lw = mode?.lastWord as { pid: string; word: string } | null | undefined;
  const prompt = room.phase === "lobby" ? null : room.prompt();
  return {
    phase: room.phase,
    lives: new Map(room.players().map((p) => [p.id, p.lives])),
    lastWord: lw ? `${lw.pid}:${lw.word}` : null,
    lastWordPid: lw ? lw.pid : null,
    answered: new Set(Array.isArray(mode?.answered) ? (mode.answered as string[]) : []),
    current: typeof mode?.current === "string" ? mode.current : null,
    alive: new Set(room.players().filter((p) => p.role === "player" && p.alive).map((p) => p.id)),
    winners: [...room.winners],
    promptKey: prompt ? `${prompt.type}:${prompt.text}` : "",
  };
}

/**
 * Every moment since the last broadcast. Like lastEvent, nothing counts unless the game was playing,
 * and nothing on the way back to the lobby. A refusal is passed in, as the room keeps no record of it.
 */
function momentsBetween(prev: Seen | null, next: Seen, refused: string | null): Moment[] {
  if (!prev || prev.phase !== "playing" || next.phase === "lobby") return [];
  const out: Moment[] = [];
  const words = new Set<string>();
  if (next.lastWord !== null && next.lastWord !== prev.lastWord && next.lastWordPid) words.add(next.lastWordPid);
  // A new prompt (a new round) starts a fresh answered list, so every id in it is new.
  const before = next.promptKey === prev.promptKey ? prev.answered : new Set<string>();
  const fresh = [...next.answered].filter((id) => !before.has(id));
  for (const id of fresh) words.add(id);
  for (const pid of words) out.push({ kind: "word", pid });

  const hearts: string[] = [];
  for (const [id, lives] of next.lives) {
    const was = prev.lives.get(id);
    if (was !== undefined && lives < was) hearts.push(id);
  }
  if (hearts.length > 0) out.push({ kind: "hearts", pids: hearts }, { kind: "explosion" });

  if (refused !== null && next.phase === "playing") out.push({ kind: "refused", pid: refused });

  if (fresh.length > 0 && next.alive.size > 0 && [...next.alive].every((id) => next.answered.has(id))) {
    out.push({ kind: "all-answered" });
  }

  if (next.phase === "results" && next.winners.length > 0) out.push({ kind: "win", pids: [...next.winners] });
  return out;
}

/**
 * Explosion: a player lost a life while the game was playing. Word: Classic's last word changed, or
 * someone answered in Everyone mode. An explosion wins if both happened since the last broadcast.
 */
function lastEventBetween(prev: Seen | null, next: Seen): LastEvent {
  if (!prev || prev.phase !== "playing" || next.phase === "lobby") return null;
  for (const [id, lives] of next.lives) {
    const before = prev.lives.get(id);
    if (before !== undefined && lives < before) return "explosion";
  }
  if (next.lastWord !== null && next.lastWord !== prev.lastWord) return "word";
  for (const id of next.answered) if (!prev.answered.has(id)) return "word";
  return null;
}

export class Hub {
  private readonly deps: EngineDeps;
  private readonly words: { checker: WordChecker; bank: PromptBank; blockedNames: string[] };
  private readonly passcode: string | undefined;
  private readonly log: (event: string, n?: number) => void;
  private readonly rooms = new Map<string, HubRoom>();
  private readonly limiter = new AttemptLimiter();
  private readonly promptCounts: PromptCounts;
  private nextClient = 1;

  constructor(opts: {
    deps: EngineDeps;
    words: { checker: WordChecker; bank: PromptBank; blockedNames: string[] };
    passcode: string | undefined;
    log?: (event: string, n?: number) => void;
  }) {
    this.deps = opts.deps;
    this.words = opts.words;
    this.passcode = opts.passcode === "" ? undefined : opts.passcode;
    this.log = opts.log ?? (() => {});
    this.promptCounts = countPrompts(opts.words.bank);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  connect(conn: Conn): ConnHandle {
    const c: Client = {
      id: String(this.nextClient++),
      conn,
      room: null,
      role: null,
      pid: null,
      windowStart: this.deps.now(),
      count: 0,
      typingCount: 0,
    };
    return {
      message: (text) => {
        try {
          this.onMessage(c, text);
        } catch {
          // A bug in one message must never take the server down.
          this.log("message-error");
        }
      },
      closed: () => {
        try {
          this.limiter.forget(c.id);
          this.unbind(c);
        } catch {
          this.log("close-error");
        }
      },
    };
  }

  // ---- messages ----

  private onMessage(c: Client, text: string): void {
    const now = this.deps.now();
    if (now - c.windowStart >= RATE_WINDOW_MS) {
      c.windowStart = now;
      c.count = 0;
      c.typingCount = 0;
    }
    if (++c.count > MAX_MSGS_PER_WINDOW) return;
    const msg = validate(text);
    if (!msg) {
      this.log("bad-message");
      this.send(c, { t: "error", reason: "bad-message" });
      return;
    }
    if (msg.t === "typing" && ++c.typingCount > MAX_TYPING_PER_WINDOW) return;
    if (c.room) this.touch(c.room);

    switch (msg.t) {
      case "create": return this.create(c, msg);
      case "host": return this.host(c, msg);
      case "control": return this.control(c, msg);
      case "join": return this.join(c, msg);
      case "submit": return this.submit(c, msg.word);
      case "typing": return this.typing(c, msg.text);
      case "avatar": return this.avatar(c, msg.avatar);
      case "cmd": return this.command(c, msg);
      case "leave": return this.unbind(c);
    }
  }

  private create(c: Client, msg: Extract<ClientMsg, { t: "create" }>): void {
    if (c.room) return this.send(c, { t: "error", reason: "already-joined" });
    if (!this.passcodeOk(c, msg.passcode)) return;
    if (this.rooms.size >= MAX_ROOMS) return this.send(c, { t: "error", reason: "server-full" });

    const code = makeRoomCode(this.deps.random, new Set(this.rooms.keys()));
    const hr: HubRoom = { room: undefined as unknown as Room, hostToken: randomUUID(), clients: new Set(), idle: null, broadcastQueued: false, seen: null, refused: null, turn: null };
    hr.room = createRoom({
      code,
      deps: this.deps,
      checker: this.words.checker,
      bank: this.words.bank,
      blockedNames: this.words.blockedNames,
      onChange: () => this.queueBroadcast(hr),
    });
    this.rooms.set(code, hr);
    this.log("room-created", this.rooms.size);
    this.touch(hr);
    this.bind(c, hr, "host", null, { hostToken: hr.hostToken });
  }

  private host(c: Client, msg: Extract<ClientMsg, { t: "host" }>): void {
    if (c.room) return this.send(c, { t: "error", reason: "already-joined" });
    if ("passcode" in msg) {
      // A projector tab that crashed or was closed: reattach with the passcode, through the same limiter as create.
      if (!this.passcodeOk(c, msg.passcode)) return;
      const hr = this.rooms.get(msg.code);
      if (!hr) return this.send(c, { t: "error", reason: "no-room" });
      this.touch(hr);
      this.bind(c, hr, "host", null, { hostToken: hr.hostToken });
      return;
    }
    const hr = this.rooms.get(msg.code);
    if (!hr) return this.send(c, { t: "error", reason: "no-room" });
    if (!("hostToken" in msg) || !passcodeMatches(msg.hostToken, hr.hostToken)) return this.send(c, { t: "error", reason: "not-host" });
    this.touch(hr);
    this.bind(c, hr, "host", null, {});
  }

  private control(c: Client, msg: Extract<ClientMsg, { t: "control" }>): void {
    if (c.room) return this.send(c, { t: "error", reason: "already-joined" });
    if ("passcode" in msg) {
      if (!this.passcodeOk(c, msg.passcode)) return;
      const hr = this.rooms.get(msg.code);
      if (!hr) return this.send(c, { t: "error", reason: "no-room" });
      this.touch(hr);
      this.bind(c, hr, "control", null, { hostToken: hr.hostToken });
      return;
    }
    const hr = this.rooms.get(msg.code);
    if (!hr) return this.send(c, { t: "error", reason: "no-room" });
    if (!passcodeMatches(msg.hostToken, hr.hostToken)) return this.send(c, { t: "error", reason: "not-host" });
    this.touch(hr);
    this.bind(c, hr, "control", null, {});
  }

  private join(c: Client, msg: Extract<ClientMsg, { t: "join" }>): void {
    if (c.room) return this.send(c, { t: "error", reason: "already-joined" });
    const hr = this.rooms.get(msg.code);
    if (!hr) return this.send(c, { t: "error", reason: "no-room" });
    this.touch(hr);
    const r = hr.room.join(msg.token, msg.nickname);
    if (!r.ok) return this.send(c, { t: "error", reason: r.reason });
    this.bind(c, hr, "player", r.playerId, { pid: r.playerId });
  }

  private submit(c: Client, word: string): void {
    if (!c.room || c.role !== "player" || !c.pid) return this.send(c, { t: "result", ok: false, reason: "not-player" });
    const hr = c.room;
    const r = hr.room.submit(c.pid, word);
    this.send(c, r.ok ? { t: "result", ok: true, kind: r.kind } : { t: "result", ok: false, reason: r.reason });
    // The class sees that the player on turn was refused, never what they typed. Silent and ghost words stay private.
    if (!r.ok && REFUSED_SHOWN.includes(r.reason) && hr.room.phase === "playing") {
      const mode = hr.room.modeView();
      if (mode?.current === c.pid && Array.isArray(mode.seats)) {
        hr.refused = c.pid;
        this.queueBroadcast(hr);
      }
    }
  }

  private typing(c: Client, text: string): void {
    if (!c.room || c.role !== "player" || !c.pid) return;
    c.room.room.typing(c.pid, text);
  }

  private avatar(c: Client, avatar: number): void {
    if (!c.room || c.role !== "player" || !c.pid) return this.send(c, { t: "result", ok: false, reason: "not-player" });
    const r = c.room.room.setAvatar(c.pid, avatar);
    this.send(c, r.ok ? { t: "result", ok: true, kind: "avatar" } : { t: "result", ok: false, reason: r.reason });
  }

  private command(c: Client, msg: Extract<ClientMsg, { t: "cmd" }>): void {
    const hr = c.room;
    if (!hr || (c.role !== "host" && c.role !== "control")) {
      return this.send(c, { t: "result", ok: false, reason: "not-host" });
    }
    const room = hr.room;
    let res: { ok: boolean; reason?: string } = { ok: true };
    switch (msg.cmd) {
      case "start": res = room.start(); break;
      case "pause": room.pause(); break;
      case "resume": room.resume(); break;
      case "skip": room.skipPrompt(); break;
      case "end": room.endGame(); break;
      case "playAgain": room.playAgain(); break;
      case "lock": room.setLocked(true); break;
      case "unlock": room.setLocked(false); break;
      case "settings": res = room.updateSettings(msg.settings); break;
      case "rename": res = room.rename(msg.pid, msg.nickname); break;
      case "kick": res = this.kick(hr, msg.pid); break;
    }
    this.send(c, res.ok ? { t: "result", ok: true } : { t: "result", ok: false, reason: res.reason });
  }

  private kick(hr: HubRoom, pid: PlayerId): { ok: boolean; reason?: string } {
    if (!hr.room.players().some((p) => p.id === pid)) return { ok: false, reason: "not-found" };
    hr.room.kick(pid);
    for (const k of [...hr.clients]) {
      if (k.role !== "player" || k.pid !== pid) continue;
      this.detach(k);
      try {
        this.send(k, { t: "kicked" });
      } catch {
        this.log("close-error");
      }
      this.safeClose(k, CLOSE_KICKED, "Removed");
    }
    return { ok: true };
  }

  // ---- helpers ----

  /** Checks the passcode, sending the error itself. Only wrong attempts count towards the limits. */
  private passcodeOk(c: Client, given: string): boolean {
    if (this.passcode === undefined) {
      this.send(c, { t: "error", reason: "no-passcode-set" });
      return false;
    }
    if (this.limiter.blocked(c.id, this.deps.now())) {
      this.send(c, { t: "error", reason: "too-many-attempts" });
      return false;
    }
    if (!passcodeMatches(given, this.passcode)) {
      this.limiter.fail(c.id, this.deps.now());
      this.log("wrong-passcode");
      this.send(c, { t: "error", reason: "wrong-passcode" });
      return false;
    }
    return true;
  }

  private bind(c: Client, hr: HubRoom, role: Role, pid: PlayerId | null, extra: { pid?: string; hostToken?: string }): void {
    c.room = hr;
    c.role = role;
    c.pid = pid;
    hr.clients.add(c);
    this.send(c, { t: "welcome", role, code: hr.room.code, ...extra });
    // The new connection's first view comes with the next broadcast, so a tick never sends it twice.
    this.queueBroadcast(hr);
  }

  /** Removes a connection from its room without telling the engine. */
  private detach(c: Client): void {
    c.room?.clients.delete(c);
    c.room = null;
    c.role = null;
    c.pid = null;
  }

  /** A connection closed or left: the player is disconnected once their last connection goes. */
  private unbind(c: Client): void {
    const hr = c.room;
    const pid = c.role === "player" ? c.pid : null;
    this.detach(c);
    if (!hr || !pid) return;
    const stillHere = [...hr.clients].some((k) => k.role === "player" && k.pid === pid);
    if (!stillHere) hr.room.disconnect(pid);
  }

  private queueBroadcast(hr: HubRoom): void {
    if (hr.broadcastQueued) return;
    hr.broadcastQueued = true;
    queueMicrotask(() => {
      hr.broadcastQueued = false;
      if (this.rooms.get(hr.room.code) !== hr) return;
      this.broadcast(hr);
    });
  }

  /** Runs from a microtask, so nothing may throw out of it: each role's view and each send is guarded. */
  private broadcast(hr: HubRoom): void {
    const room = hr.room;
    const shared = new Map<Role, string | null>();
    let lastEvent: LastEvent = null;
    let moments: Moment[] = [];
    let turnElapsedMs: number | undefined;
    try {
      const seen = seenOf(room);
      lastEvent = lastEventBetween(hr.seen, seen);
      moments = momentsBetween(hr.seen, seen, hr.refused);
      hr.seen = seen;
      turnElapsedMs = this.turnAge(hr, seen);
    } catch {
      this.log("broadcast-error");
    }
    hr.refused = null;
    // Only a hidden fuse gets the turn's age: a visible countdown already shows the time.
    const withMoments = <V extends object>(v: V): V & { lastEvent: LastEvent; moments: Moment[]; turnElapsedMs?: number } =>
      turnElapsedMs !== undefined && !("bombRemainingMs" in v) ? { ...v, lastEvent, moments, turnElapsedMs } : { ...v, lastEvent, moments };
    const viewText = (make: () => unknown): string | null => {
      try {
        const view = make();
        return view ? JSON.stringify({ t: "view", view } satisfies ServerMsg) : null;
      } catch {
        this.log("broadcast-error");
        return null;
      }
    };
    for (const c of hr.clients) {
      let text: string | null = null;
      if (c.role === "host" || c.role === "control") {
        const role = c.role;
        if (!shared.has(role)) shared.set(role, viewText(() => (role === "host" ? withMoments(projectorView(room)) : { ...controlView(room), promptCounts: this.promptCounts })));
        text = shared.get(role)!;
      } else if (c.role === "player" && c.pid) {
        const pid = c.pid;
        text = viewText(() => {
          const v = playerView(room, pid);
          return v ? withMoments(v) : null;
        });
      }
      if (text === null) continue;
      try {
        c.conn.send(text);
      } catch {
        this.log("broadcast-error");
      }
    }
  }

  /**
   * How long the current Classic turn has lasted, paused time left out. A turn is one player with one
   * prompt; it starts when a broadcast first sees it. It is measured from the turn, never from the fuse,
   * so a fuse topped up to the minimum turn time changes nothing here and tells the class nothing.
   */
  private turnAge(hr: HubRoom, seen: Seen): number | undefined {
    const running = seen.phase === "playing" || seen.phase === "paused";
    if (!running || seen.current === null) {
      hr.turn = null;
      return undefined;
    }
    const now = this.deps.now();
    const key = `${seen.current}|${seen.promptKey}`;
    if (!hr.turn || hr.turn.key !== key) hr.turn = { key, startedAt: now, pausedAt: null, pausedMs: 0 };
    const t = hr.turn;
    if (seen.phase === "paused" && t.pausedAt === null) t.pausedAt = now;
    if (seen.phase === "playing" && t.pausedAt !== null) {
      t.pausedMs += now - t.pausedAt;
      t.pausedAt = null;
    }
    return Math.max(0, (t.pausedAt ?? now) - t.startedAt - t.pausedMs);
  }

  /** Restarts the room's idle timer. */
  private touch(hr: HubRoom): void {
    if (hr.idle !== null) this.deps.clearTimeout(hr.idle);
    hr.idle = this.deps.setTimeout(() => {
      try {
        this.closeRoom(hr);
      } catch {
        this.log("close-error");
      }
    }, IDLE_MS);
  }

  private closeRoom(hr: HubRoom): void {
    if (this.rooms.get(hr.room.code) !== hr) return;
    this.rooms.delete(hr.room.code);
    hr.idle = null;
    for (const c of [...hr.clients]) {
      this.detach(c);
      this.safeClose(c, CLOSE_ROOM_CLOSED, "Room closed");
    }
    hr.room.endGame(); // stops the bomb timer of a running game
    this.log("room-closed", this.rooms.size);
  }

  private safeClose(c: Client, code: number, reason: string): void {
    try {
      c.conn.close(code, reason);
    } catch {
      this.log("close-error");
    }
  }

  private send(c: Client, msg: ServerMsg): void {
    c.conn.send(JSON.stringify(msg));
  }
}
