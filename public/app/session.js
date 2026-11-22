// Small pure helpers for the join page: what to remember across a refresh, and what to tell the player.

const CODE_KEY = "bomb.code";
const NICK_KEY = "bomb.nickname";
const KICKED_KEY = "bomb.kicked";
const MAX_KICKED = 20;

export const KICKED_TEXT = "You were removed from this game";

/** @typedef {{ getItem(k: string): string | null, setItem(k: string, v: string): void, removeItem(k: string): void }} Store */

/**
 * What the join page starts with. `auto` means both a code and a nickname were stored, so rejoin now.
 * @param {Store} storage @param {string} search location.search
 */
export function initialJoin(storage, search) {
  const storedCode = storage.getItem(CODE_KEY) ?? "";
  const storedNick = storage.getItem(NICK_KEY) ?? "";
  if (storedCode && storedNick) return { code: storedCode, nickname: storedNick, auto: true };
  const link = new URLSearchParams(search).get("code");
  const fromLink = link ? link.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() : "";
  return { code: fromLink || storedCode, nickname: "", auto: false };
}

/** @param {Store} storage @param {string} code @param {string} nickname */
export function saveJoin(storage, code, nickname) {
  storage.setItem(CODE_KEY, code);
  storage.setItem(NICK_KEY, nickname);
}

/** @param {Store} storage */
export function clearJoin(storage) {
  storage.removeItem(CODE_KEY);
  storage.removeItem(NICK_KEY);
}

/**
 * An error that means this game is over for the player: stop reconnecting.
 * @param {string} reason @returns {string | null}
 */
export function terminalError(reason) {
  if (reason === "no-room") return "This game has ended";
  if (reason === "kicked") return "You were removed from the game";
  return null;
}

/** @param {string} status */
export function joinStatusText(status) {
  if (status === "connecting") return "Connecting…";
  if (status === "reconnecting") return "Can't reach the game. Retrying…";
  return "";
}

/** @param {boolean} sent whether the socket accepted the word */
export function submitOutcome(sent) {
  return sent ? { clear: true, message: "" } : { clear: false, message: "Reconnecting… your word wasn't sent" };
}

/** The room codes this browser was kicked from, oldest first. A damaged entry counts as none. @param {Store} storage */
function kickedCodes(storage) {
  try {
    const list = JSON.parse(storage.getItem(KICKED_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((c) => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Remember a kick in localStorage, so other tabs of this browser refuse the code too. Keeps the 20 most recent.
 * @param {Store} storage @param {string} code
 */
export function rememberKick(storage, code) {
  const c = code.toUpperCase();
  const list = kickedCodes(storage).filter((k) => k !== c);
  list.push(c);
  storage.setItem(KICKED_KEY, JSON.stringify(list.slice(-MAX_KICKED)));
}

/** @param {Store} storage @param {string} code */
export function wasKicked(storage, code) {
  return kickedCodes(storage).includes(code.toUpperCase());
}
