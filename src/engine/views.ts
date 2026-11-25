// What each screen is allowed to see. Views only read the room; they never change it.
// Privacy rules: no tokens anywhere. The projector never shows ghost words, silent words, ghost points
// or scores. A student's screen shows only their own score, and a ghost sees only their own ghost
// view (me.activity), never another player's ghost points or words. Otherwise ghost points appear
// only in the control view (the results carry a ranking without points).
import type { LastWord, Phase, Player, PlayerId, Room } from "./room.ts";
import type { PromptType, SettingDecl, Settings } from "./types.ts";
import { settingsFor } from "./registry.ts";
import { maskBlocked } from "./words.ts";

export type ProjectorPlayer = {
  id: PlayerId;
  nickname: string;
  /** Emoji index 0 to 59. */
  avatar: number;
  lives: number;
  alive: boolean;
  connected: boolean;
  spectator: boolean;
  /** Present only when the mode reports who has answered (Everyone at once): a tick, never the word. */
  answered?: boolean;
  /** This player's latest shown word with the prompt it answered; never a silent or ghost word. */
  lastWord?: LastWord;
};

export type Results = {
  winners: PlayerId[];
  /** Players with ghost points, most first (ties in join order). The points themselves are never sent. */
  ghostRanking: { id: PlayerId; nickname: string; avatar: number }[];
  /** The longest real-turn word of the game; the first one wins a tie. */
  longestWord: { nickname: string; avatar: number; word: string } | null;
};

export type ProjectorView = {
  code: string;
  phase: Phase;
  paused: boolean;
  locked: boolean;
  /** The colour theme chosen by the host; changeable at any time. */
  theme: string;
  players: ProjectorPlayer[];
  prompt: { text: string; type: PromptType } | null;
  /** The mode's own view data, or null before the first game. */
  mode: Record<string, unknown> | null;
  /** Milliseconds left on a visible bomb; frozen while paused. Absent for a hidden fuse. */
  bombRemainingMs?: number;
  examples?: string[];
  typing?: string;
  results?: Results;
};

export type PlayerView = ProjectorView & {
  me: {
    id: PlayerId;
    nickname: string;
    avatar: number;
    lives: number;
    alive: boolean;
    score: number;
    isOn: boolean;
    bonusLeft: string[];
    /** Alive, not on, the game is playing and silent answers are on: a typed word scores privately. */
    canAnswerSilently: boolean;
    /** The knockout activity's view for this player, while they are knocked out. */
    activity?: Record<string, unknown>;
  };
};

export type ControlPlayer = ProjectorPlayer & { score: number; ghostPoints: number; role: Player["role"] };

export type ControlView = Omit<ProjectorView, "players"> & {
  players: ControlPlayer[];
  settings: Settings;
  settingDecls: SettingDecl[];
};

const running = (room: Room) => room.phase === "playing" || room.phase === "paused";

export function projectorView(room: Room): ProjectorView {
  const mode = room.modeView();
  const answered = Array.isArray(mode?.answered) ? (mode.answered as PlayerId[]) : null;
  const prompt = room.phase === "lobby" ? null : room.prompt();

  const view: ProjectorView = {
    code: room.code,
    phase: room.phase,
    paused: room.phase === "paused",
    locked: room.locked,
    theme: String(room.settings.theme),
    players: room.players().map((p) => {
      const out: ProjectorPlayer = { id: p.id, nickname: p.nickname, avatar: p.avatar, lives: p.lives, alive: p.alive, connected: p.connected, spectator: p.role === "spectator" };
      if (answered && running(room)) out.answered = answered.includes(p.id);
      const last = room.lastWordOf(p.id);
      if (last) out.lastWord = { word: last.word, prompt: { ...last.prompt } };
      return out;
    }),
    prompt: prompt ? { text: prompt.text, type: prompt.type } : null,
    mode: room.phase === "lobby" ? null : mode,
  };

  if (running(room) && room.bombVisible()) view.bombRemainingMs = room.bombRemaining();
  if (room.phase !== "lobby" && room.examples.length > 0) view.examples = [...room.examples];

  // Live typing: only the one player who is on (the mode's `current`), only while a game runs.
  if (room.settings.liveTyping === true && running(room) && typeof mode?.current === "string") {
    const text = room.typingOf(mode.current);
    if (text) view.typing = maskBlocked(text, (w) => room.checker.isBlocked(w));
  }

  if (room.phase === "results") view.results = results(room);
  return view;
}

export function playerView(room: Room, pid: PlayerId): PlayerView | null {
  const p = room.players().find((x) => x.id === pid);
  if (!p) return null;
  const letters = room.settings.bonusAlphabet === true ? (room.settings.bonusLetters as string[]) : [];
  const me: PlayerView["me"] = {
    id: p.id,
    nickname: p.nickname,
    avatar: p.avatar,
    lives: p.lives,
    alive: p.alive,
    score: p.score,
    isOn: room.isOn(pid),
    bonusLeft: letters.filter((l) => !p.bonusUsed.has(l)),
    canAnswerSilently:
      room.phase === "playing" && p.role === "player" && p.alive && !room.isOn(pid) && room.settings.silentAnswers === true,
  };
  if (room.phase !== "lobby" && p.role === "player" && !p.alive) {
    const activity = room.activityView(pid);
    if (activity) me.activity = activity;
  }
  return { ...projectorView(room), me };
}

export function controlView(room: Room): ControlView {
  const base = projectorView(room);
  const byId = new Map(room.players().map((p) => [p.id, p]));
  return {
    ...base,
    players: base.players.map((v) => {
      const p = byId.get(v.id)!;
      return { ...v, score: p.score, ghostPoints: p.ghostPoints, role: p.role };
    }),
    settings: { ...room.settings },
    settingDecls: settingsFor(String(room.settings.mode), String(room.settings.knockout)),
  };
}

function results(room: Room): Results {
  const players = room.players();
  const byId = new Map(players.map((p) => [p.id, p]));
  const ghostRanking = players
    .filter((p) => p.ghostPoints > 0)
    .sort((a, b) => b.ghostPoints - a.ghostPoints) // stable: ties keep join order
    .map((p) => ({ id: p.id, nickname: p.nickname, avatar: p.avatar }));
  let longestWord: Results["longestWord"] = null;
  for (const { pid, word } of room.acceptedWords) {
    const p = byId.get(pid);
    if (!p) continue; // kicked since
    if (!longestWord || word.length > longestWord.word.length) longestWord = { nickname: p.nickname, avatar: p.avatar, word };
  }
  return { winners: [...room.winners], ghostRanking, longestWord };
}
