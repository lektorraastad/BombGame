// The game socket's messages, and the one function that checks what a client sent.
// Nothing here throws: anything that isn't exactly a known message becomes null.
import { AVATAR_COUNT } from "../engine/avatars.ts";

export const MAX_MESSAGE_BYTES = 2000;

export const COMMANDS = ["start", "pause", "resume", "skip", "end", "playAgain", "lock", "unlock"] as const;
export type SimpleCommand = (typeof COMMANDS)[number];

export type ClientMsg =
  | { t: "create"; passcode: string; token: string }
  /** A projector that refreshed has the host token; one in a new tab reattaches with the passcode. */
  | { t: "host"; code: string; token: string; hostToken: string }
  | { t: "host"; code: string; token: string; passcode: string }
  /** Neither: valid, so the hub can answer not-host. */
  | { t: "host"; code: string; token: string }
  /** From a phone with the passcode, or from a control window or overlay that has the host token. */
  | { t: "control"; code: string; token: string; passcode: string }
  | { t: "control"; code: string; token: string; hostToken: string }
  | { t: "join"; code: string; token: string; nickname: string }
  | { t: "submit"; word: string }
  | { t: "typing"; text: string }
  /** A student picks their emoji: a whole number from 0 to AVATAR_COUNT - 1. */
  | { t: "avatar"; avatar: number }
  | { t: "cmd"; cmd: SimpleCommand }
  | { t: "cmd"; cmd: "kick"; pid: string }
  | { t: "cmd"; cmd: "rename"; pid: string; nickname: string }
  | { t: "cmd"; cmd: "settings"; settings: Record<string, unknown> }
  | { t: "leave" };

export type Role = "player" | "host" | "control";

export type ServerMsg =
  | { t: "welcome"; role: Role; code: string; pid?: string; hostToken?: string }
  | { t: "view"; view: unknown }
  | { t: "result"; ok: boolean; reason?: string; kind?: string }
  | { t: "error"; reason: string }
  | { t: "kicked" };

const NICKNAME_MAX = 40;
const WORD_MAX = 60;
const TEXT_MAX = 60;
const TOKEN_MAX = 100;
const PASSCODE_MAX = 200;
const PID_MAX = 40;

type Obj = Record<string, unknown>;

const str = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max;
const token = (v: unknown): v is string => str(v, TOKEN_MAX, 1);
const code = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z]{4}$/.test(v) ? v.toUpperCase() : null;
const plainObject = (v: unknown): v is Obj => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export function validate(raw: string): ClientMsg | null {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!plainObject(m)) return null;
  return check(m);
}

function check(m: Obj): ClientMsg | null {
  switch (m.t) {
    case "create":
      return str(m.passcode, PASSCODE_MAX) && token(m.token) ? { t: "create", passcode: m.passcode, token: m.token } : null;
    case "host": {
      const c = code(m.code);
      if (!c || !token(m.token)) return null;
      if (token(m.hostToken)) return { t: "host", code: c, token: m.token, hostToken: m.hostToken };
      if (m.passcode !== undefined) return str(m.passcode, PASSCODE_MAX) ? { t: "host", code: c, token: m.token, passcode: m.passcode } : null;
      return { t: "host", code: c, token: m.token };
    }
    case "control": {
      const c = code(m.code);
      if (!c || !token(m.token)) return null;
      if (str(m.passcode, PASSCODE_MAX)) return { t: "control", code: c, token: m.token, passcode: m.passcode };
      if (token(m.hostToken)) return { t: "control", code: c, token: m.token, hostToken: m.hostToken };
      return null;
    }
    case "join": {
      const c = code(m.code);
      return c && token(m.token) && str(m.nickname, NICKNAME_MAX)
        ? { t: "join", code: c, token: m.token, nickname: m.nickname }
        : null;
    }
    case "submit":
      return str(m.word, WORD_MAX) ? { t: "submit", word: m.word } : null;
    case "typing":
      return str(m.text, TEXT_MAX) ? { t: "typing", text: m.text } : null;
    case "avatar": {
      const a = m.avatar;
      return typeof a === "number" && Number.isInteger(a) && a >= 0 && a < AVATAR_COUNT ? { t: "avatar", avatar: a } : null;
    }
    case "leave":
      return { t: "leave" };
    case "cmd":
      return checkCmd(m);
    default:
      return null;
  }
}

function checkCmd(m: Obj): ClientMsg | null {
  const cmd = m.cmd;
  if ((COMMANDS as readonly unknown[]).includes(cmd)) return { t: "cmd", cmd: cmd as SimpleCommand };
  if (cmd === "kick") return str(m.pid, PID_MAX, 1) ? { t: "cmd", cmd, pid: m.pid } : null;
  if (cmd === "rename") {
    return str(m.pid, PID_MAX, 1) && str(m.nickname, NICKNAME_MAX) ? { t: "cmd", cmd, pid: m.pid, nickname: m.nickname } : null;
  }
  if (cmd === "settings") return plainObject(m.settings) ? { t: "cmd", cmd, settings: m.settings } : null;
  return null;
}
