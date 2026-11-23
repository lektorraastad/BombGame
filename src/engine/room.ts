import type { Band, EngineDeps, Prompt, PromptType, SettingDecl, Settings } from "./types.ts";
import type { WordChecker } from "./words.ts";
import { isBlockedName, normalise } from "./words.ts";
import type { PromptBank } from "./prompts.ts";
import { promptKey } from "./prompts.ts";
import { CORE_SETTINGS, resolveSettings, withChoices } from "./settings.ts";
import type { GameMode, ModeContext, SubmitResult } from "./modes/mode.ts";
import type { KnockoutActivity } from "./knockout/activity.ts";
import { noopActivity } from "./knockout/activity.ts";
import { AVATAR_COUNT } from "./avatars.ts";

export type PlayerId = string;

export type Player = {
  id: PlayerId;
  token: string;
  nickname: string;
  /** Index 0 to 59 into the emoji list; unique within the room. */
  avatar: number;
  connected: boolean;
  role: "player" | "spectator";
  lives: number;
  alive: boolean;
  score: number;
  ghostPoints: number;
  bonusUsed: Set<string>;
  comebackUsed: boolean;
  ghostStreak: number;
};

export type NameFailure = "name-length" | "name-blocked";
export type JoinResult =
  | { ok: true; playerId: PlayerId }
  | { ok: false; reason: "locked" | "full" | "kicked" | NameFailure };
export type RenameResult = { ok: true; playerId: PlayerId } | { ok: false; reason: NameFailure | "not-found" };

export type AvatarResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "bad-avatar" | "avatar-taken" | "avatar-locked" };

export type Phase = "lobby" | "playing" | "paused" | "results";
export type StartResult =
  | { ok: true }
  | { ok: false; reason: "need-2-players" | "no-prompts" | "already-running" | "unknown-mode" };
export type { SubmitResult };

type Bomb = { handle: unknown; endsAt: number; visible: boolean };
/** One game's record. A context only acts while its record is the room's current, running game. */
/** A player's latest accepted real-turn word and the prompt it answered. */
export type LastWord = { word: string; prompt: { text: string; type: PromptType } };

type Game = {
  mode: GameMode;
  activity: KnockoutActivity;
  ctx: ModeContext;
  prompt: Prompt | null;
  recent: string[];
  usedRoom: Set<string>;
  usedByPlayer: Map<PlayerId, Set<string>>;
  /** Each player's private silent words, so a silent answer can't be repeated for points. */
  silentUsed: Map<PlayerId, Set<string>>;
  typing: Map<PlayerId, string>;
  /** Shown words, one per player. */
  lastWords: Map<PlayerId, LastWord>;
  /** Accepted words not yet shown; they move to lastWords when the next prompt is dealt or the game ends. */
  pendingWords: Map<PlayerId, LastWord>;
  bomb: Bomb | null;
  pausedRemaining: number | null;
};

export const ROOM_CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const MAX_PLAYERS = 32;
const NAME_MIN = 2;
const NAME_MAX = 16;
const MIN_PLAYERS = 2;
const AVOID_RECENT = 10;
const EXAMPLE_COUNT = 3;
const MAX_TYPING = 30;
/** Settings the host may change while a game runs. */
const LIVE_SETTINGS = new Set(["theme"]);

function setFor(map: Map<PlayerId, Set<string>>, pid: PlayerId): Set<string> {
  let s = map.get(pid);
  if (!s) map.set(pid, (s = new Set()));
  return s;
}

export function makeRoomCode(random: () => number, taken: Set<string>): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_LETTERS[Math.floor(random() * ROOM_CODE_LETTERS.length)];
    }
    if (!taken.has(code)) return code;
  }
}

export class Room {
  readonly code: string;
  readonly deps: EngineDeps;
  readonly checker: WordChecker;
  readonly bank: PromptBank;
  phase: Phase = "lobby";
  locked = false;
  settings: Settings;
  /** Set when a game ends; empty when nobody won. */
  winners: PlayerId[] = [];
  /** Real-turn words accepted this game, in order. */
  acceptedWords: { pid: PlayerId; word: string }[] = [];
  /** Example answers for the last exploded prompt (empty if switched off). */
  examples: string[] = [];

  private readonly blockedNames: string[];
  private readonly onChange?: () => void;
  private readonly list: Player[] = [];
  private readonly bannedTokens = new Set<string>();
  private readonly modes: GameMode[];
  private readonly activities: KnockoutActivity[];
  private game: Game | null = null;

  constructor(opts: {
    code: string;
    deps: EngineDeps;
    checker: WordChecker;
    bank: PromptBank;
    blockedNames: Iterable<string>;
    onChange?: () => void;
    modes?: GameMode[];
    activities?: KnockoutActivity[];
  }) {
    this.code = opts.code;
    this.deps = opts.deps;
    this.checker = opts.checker;
    this.bank = opts.bank;
    this.blockedNames = [...opts.blockedNames];
    this.onChange = opts.onChange;
    this.modes = opts.modes ?? [];
    this.activities = opts.activities ?? [];
    this.settings = this.resolve({});
  }

  players(): Player[] {
    return [...this.list];
  }

  join(token: string, nickname: string): JoinResult {
    const existing = this.list.find((p) => p.token === token);
    if (existing) {
      existing.connected = true;
      this.changed();
      return { ok: true, playerId: existing.id };
    }
    if (this.bannedTokens.has(token)) return { ok: false, reason: "kicked" };
    if (this.locked) return { ok: false, reason: "locked" };
    if (this.list.length >= MAX_PLAYERS) return { ok: false, reason: "full" };
    const name = this.resolveName(nickname, undefined);
    if (!name.ok) return name;
    const inGame = this.phase !== "lobby";
    const player: Player = {
      id: this.newId(),
      token,
      nickname: name.nickname,
      avatar: this.freeAvatar(),
      connected: true,
      role: inGame ? "spectator" : "player",
      lives: 0,
      alive: false,
      score: 0,
      ghostPoints: 0,
      bonusUsed: new Set(),
      comebackUsed: false,
      ghostStreak: 0,
    };
    this.list.push(player);
    this.changed();
    return { ok: true, playerId: player.id };
  }

  disconnect(playerId: PlayerId): void {
    const p = this.find(playerId);
    if (!p) return;
    p.connected = false;
    this.changed();
  }

  kick(playerId: PlayerId): void {
    const i = this.list.findIndex((p) => p.id === playerId);
    if (i < 0) return;
    const [gone] = this.list.splice(i, 1);
    this.bannedTokens.add(gone.token);
    this.game?.lastWords.delete(gone.id);
    this.game?.pendingWords.delete(gone.id);
    if (this.game && this.running() && gone.role === "player") {
      this.game.mode.onPlayerGone(this.game.ctx, gone.id);
    }
    this.changed();
  }

  rename(playerId: PlayerId, nickname: string): RenameResult {
    const p = this.find(playerId);
    if (!p) return { ok: false, reason: "not-found" };
    const name = this.resolveName(nickname, p);
    if (!name.ok) return name;
    p.nickname = name.nickname;
    this.changed();
    return { ok: true, playerId };
  }

  /** Change a player's emoji: only in the lobby (or for a waiting spectator), and never to one in use. */
  setAvatar(playerId: PlayerId, avatar: number): AvatarResult {
    const p = this.find(playerId);
    if (!p) return { ok: false, reason: "not-found" };
    if (typeof avatar !== "number" || !Number.isInteger(avatar) || avatar < 0 || avatar >= AVATAR_COUNT) {
      return { ok: false, reason: "bad-avatar" };
    }
    if (this.phase !== "lobby" && p.role !== "spectator") return { ok: false, reason: "avatar-locked" };
    if (p.avatar === avatar) return { ok: true };
    if (this.list.some((q) => q.avatar === avatar)) return { ok: false, reason: "avatar-taken" };
    p.avatar = avatar;
    this.changed();
    return { ok: true };
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.changed();
  }

  // ---- host: settings and lifecycle ----

  /**
   * The settings declarations for a mode and activity: core first, then the mode's, then the activity's.
   * The "mode" and "knockout" choices list this room's own modes and activities.
   */
  settingDecls(modeId = String(this.settings.mode), activityId = String(this.settings.knockout)): SettingDecl[] {
    return [
      ...this.coreDecls(),
      ...(this.modes.find((m) => m.id === modeId)?.settings ?? []),
      ...(this.activities.find((a) => a.id === activityId)?.settings ?? []),
    ];
  }

  updateSettings(input: Record<string, unknown>): { ok: boolean; reason?: "game-running" } {
    if (this.running() && !Object.keys(input).every((k) => LIVE_SETTINGS.has(k))) return { ok: false, reason: "game-running" };
    this.settings = this.resolve({ ...this.settings, ...input });
    this.changed();
    return { ok: true };
  }

  start(): StartResult {
    if (this.running()) return { ok: false, reason: "already-running" };
    const mode = this.modes.find((m) => m.id === this.settings.mode);
    if (!mode) return { ok: false, reason: "unknown-mode" };
    if (this.list.length < MIN_PLAYERS) return { ok: false, reason: "need-2-players" };
    if (this.bank.size(this.band(), this.promptTypes()) === 0) return { ok: false, reason: "no-prompts" };
    const activity = this.activities.find((a) => a.id === this.settings.knockout) ?? noopActivity;

    const lives = Math.min(Number(this.settings.startLives), Number(this.settings.maxLives));
    for (const p of this.list) {
      p.role = "player";
      p.lives = lives;
      p.alive = true;
      p.score = 0;
      p.ghostPoints = 0;
      p.bonusUsed = new Set();
      p.comebackUsed = false;
      p.ghostStreak = 0;
    }
    this.clearBomb();
    this.winners = [];
    this.acceptedWords = [];
    this.examples = [];
    const g: Game = {
      mode,
      activity,
      ctx: undefined as unknown as ModeContext,
      prompt: null,
      recent: [],
      usedRoom: new Set(),
      usedByPlayer: new Map(),
      silentUsed: new Map(),
      typing: new Map(),
      lastWords: new Map(),
      pendingWords: new Map(),
      bomb: null,
      pausedRemaining: null,
    };
    g.ctx = this.makeContext(g);
    this.game = g;
    this.phase = "playing";
    mode.start(g.ctx);
    this.changed();
    return { ok: true };
  }

  pause(): void {
    const g = this.game;
    if (!g || this.phase !== "playing") return;
    g.pausedRemaining = this.bombRemaining();
    if (g.bomb) this.deps.clearTimeout(g.bomb.handle);
    this.phase = "paused";
    this.changed();
  }

  resume(): void {
    const g = this.game;
    if (!g || this.phase !== "paused") return;
    const remaining = g.pausedRemaining;
    const visible = g.bomb?.visible ?? false;
    const hadBomb = g.bomb !== null;
    g.pausedRemaining = null;
    g.bomb = null;
    this.phase = "playing";
    if (hadBomb && remaining !== null) this.armBomb(g, remaining, visible);
    this.changed();
  }

  skipPrompt(): void {
    if (!this.game || this.phase !== "playing") return;
    this.game.mode.onSkip(this.game.ctx);
    this.changed();
  }

  /** Host ends the game: no winners. */
  endGame(): void {
    if (!this.running()) return;
    this.finish([]);
  }

  /** Back to the lobby from the results, keeping players and settings. */
  playAgain(): void {
    if (this.phase !== "results") return;
    this.clearBomb();
    // Neutral lobby: nobody shows last game's lives, score or knocked-out state; start() sets the real values.
    for (const p of this.list) {
      p.role = "player";
      p.lives = 0;
      p.alive = true;
      p.score = 0;
      p.ghostPoints = 0;
      p.bonusUsed = new Set();
      p.comebackUsed = false;
      p.ghostStreak = 0;
    }
    this.phase = "lobby";
    this.game = null;
    this.changed();
  }

  // ---- players ----

  submit(pid: PlayerId, raw: string): SubmitResult {
    if (typeof raw !== "string") return { ok: false, reason: "bad-characters" };
    const n = normalise(raw);
    if (!n.ok) return n;
    const word = n.word;
    const g = this.game;
    if (!g || this.phase === "lobby" || this.phase === "results") return { ok: false, reason: "not-playing" };
    if (this.phase === "paused") return { ok: false, reason: "paused" };

    const p = this.find(pid);
    if (!p || p.role !== "player") return { ok: false, reason: "not-playing" };
    let kind: "turn" | "silent" | "ghost";
    if (!p.alive) kind = "ghost";
    else if (g.mode.isOn(g.ctx, pid)) kind = "turn";
    else if (this.settings.silentAnswers === true) kind = "silent";
    else return { ok: false, reason: "not-your-turn" };

    if (this.checker.isBlocked(word)) return { ok: false, reason: "blocked" };
    if (!this.checker.isWord(word)) return { ok: false, reason: "not-a-word" };
    if (!g.prompt || !this.checker.matches(g.prompt, word)) return { ok: false, reason: "doesnt-match" };

    let result: SubmitResult;
    if (kind === "turn") {
      if (this.usedSet(g, pid).has(word)) return { ok: false, reason: "used" };
      g.mode.onWord(g.ctx, pid, word);
      result = { ok: true, kind };
    } else if (kind === "silent") {
      const silent = setFor(g.silentUsed, pid);
      if (silent.has(word)) return { ok: false, reason: "used" };
      silent.add(word);
      p.score += 1;
      result = { ok: true, kind };
    } else {
      result = g.activity.onWord(g.ctx, pid, word);
    }
    this.changed();
    return result;
  }

  /** Live text from a player's box; stored only when liveTyping is on. */
  typing(pid: PlayerId, text: string): void {
    if (typeof text !== "string" || !this.game || this.settings.liveTyping !== true) return;
    if (!this.isOn(pid)) return;
    this.game.typing.set(pid, text.slice(0, MAX_TYPING));
    this.changed();
  }

  typingOf(pid: PlayerId): string | undefined {
    return this.game?.typing.get(pid);
  }

  // ---- read access for views ----

  prompt(): Prompt | null {
    return this.game?.prompt ?? null;
  }

  bombRemaining(): number {
    const g = this.game;
    if (!g) return 0;
    if (g.pausedRemaining !== null) return g.pausedRemaining;
    return g.bomb ? Math.max(0, g.bomb.endsAt - this.deps.now()) : 0;
  }

  /** Whether the armed bomb's countdown may be shown. */
  bombVisible(): boolean {
    return this.game?.bomb?.visible ?? false;
  }

  /** The mode context of the current (or last) game. Throws in the lobby before any game. */
  context(): ModeContext {
    if (!this.game) throw new Error("no game");
    return this.game.ctx;
  }

  /** The mode's private state for this game. */
  state(): Record<string, unknown> {
    return this.context().state;
  }

  mode(): GameMode | undefined {
    return this.game?.mode;
  }

  activity(): KnockoutActivity | undefined {
    return this.game?.activity;
  }

  /** The mode's public view data for the current (or last) game; null before any game. */
  modeView(): Record<string, unknown> | null {
    const g = this.game;
    return g ? g.mode.view(g.ctx) : null;
  }

  /** The knockout activity's view for one player; null before any game. */
  activityView(pid: PlayerId): Record<string, unknown> | null {
    const g = this.game;
    return g ? g.activity.view(g.ctx, pid) : null;
  }

  /** Whether this player is on (their words count as real turns) in the running game, paused or not. */
  isOn(pid: PlayerId): boolean {
    const g = this.game;
    return !!g && this.running() && g.mode.isOn(g.ctx, pid);
  }

  // ---- internals ----

  private running(): boolean {
    return this.phase === "playing" || this.phase === "paused";
  }

  private resolve(input: Record<string, unknown>): Settings {
    const core = resolveSettings(this.coreDecls(), input);
    return resolveSettings(this.settingDecls(String(core.mode), String(core.knockout)), input);
  }

  private coreDecls(): SettingDecl[] {
    return withChoices(CORE_SETTINGS, this.modes, this.activities);
  }

  private band(): Band {
    return this.settings.band as Band;
  }

  private promptTypes(): PromptType[] {
    return this.settings.promptTypes as PromptType[];
  }

  /** True while `g` is the current game and it is playing or paused. */
  private live(g: Game): boolean {
    return this.game === g && this.running();
  }

  private makeContext(g: Game): ModeContext {
    return {
      settings: this.settings,
      random: () => this.deps.random(),
      now: () => this.deps.now(),
      alive: () => this.list.filter((p) => p.role === "player" && p.alive),
      prompt: () => g.prompt,
      newPrompt: () => this.newPrompt(g),
      armBomb: (ms, visible) => { if (this.live(g)) this.armBomb(g, ms, visible); },
      bombRemaining: () => (this.game === g ? this.bombRemaining() : 0),
      player: (pid) => this.find(pid),
      revive: (pid, lives) => {
        const p = this.find(pid);
        if (!this.live(g) || !p) return;
        p.alive = true;
        p.lives = lives;
        this.changed();
      },
      loseLife: (pid) => { if (this.live(g)) this.loseLife(g, pid); },
      acceptWord: (pid, word) => { if (this.live(g)) this.acceptWord(g, pid, word); },
      explodedPrompt: (p) => {
        if (!this.live(g)) return;
        this.examples = this.settings.exampleAnswers === true
          ? this.checker.examples(p, EXAMPLE_COUNT, () => this.deps.random())
          : [];
      },
      endGame: (winners) => { if (this.live(g)) this.finish(winners); },
      state: {},
      activityState: {},
    };
  }

  /** Outside a running game this deals nothing and returns the last prompt. */
  private newPrompt(g: Game): Prompt {
    if (!this.live(g)) {
      if (!g.prompt) throw new Error("newPrompt outside a running game");
      return g.prompt;
    }
    this.revealWords(g);
    const p = this.bank.next({
      band: this.band(),
      types: this.promptTypes(),
      random: () => this.deps.random(),
      avoid: g.recent,
    });
    g.prompt = p;
    // Old half-typed text (maybe a silent or ghost word) must not show for the new prompt.
    g.typing.clear();
    g.recent.push(promptKey(p));
    if (g.recent.length > AVOID_RECENT) g.recent.shift();
    g.activity.onPrompt(g.ctx);
    return p;
  }

  private armBomb(g: Game, ms: number, visible: boolean): void {
    this.clearBomb();
    const bomb: Bomb = { handle: undefined, endsAt: this.deps.now() + ms, visible };
    g.bomb = bomb;
    if (this.phase === "paused") {
      g.pausedRemaining = ms;
      return;
    }
    bomb.handle = this.deps.setTimeout(() => this.explode(g, bomb), ms);
  }

  private clearBomb(): void {
    const g = this.game;
    if (!g?.bomb) return;
    this.deps.clearTimeout(g.bomb.handle);
    g.bomb = null;
    g.pausedRemaining = null;
  }

  private explode(g: Game, bomb: Bomb): void {
    // Only the current game's current bomb may go off.
    if (this.game !== g || g.bomb !== bomb || this.phase !== "playing") return;
    g.bomb = null;
    g.mode.onExplode(g.ctx);
    this.changed();
  }

  private loseLife(g: Game, pid: PlayerId): void {
    const p = this.find(pid);
    if (!p || !p.alive) return;
    p.lives = Math.max(0, p.lives - 1);
    if (p.lives === 0) {
      p.alive = false;
      g.activity.onKnockedOut(g.ctx, pid);
    }
  }

  private acceptWord(g: Game, pid: PlayerId, word: string): void {
    const p = this.find(pid);
    if (!p) return;
    this.usedSet(g, pid).add(word);
    this.acceptedWords.push({ pid, word });
    if (g.prompt) g.pendingWords.set(pid, { word, prompt: { text: g.prompt.text, type: g.prompt.type } });
    p.score += 1;
    if (this.settings.bonusAlphabet !== true) return;
    const letters = this.settings.bonusLetters as string[];
    for (const ch of word) if (letters.includes(ch)) p.bonusUsed.add(ch);
    if (letters.every((l) => p.bonusUsed.has(l))) {
      p.lives = Math.min(Number(this.settings.maxLives), p.lives + 1);
      p.bonusUsed.clear();
    }
  }

  /** The no-reuse set that applies to this player's real-turn words. */
  private usedSet(g: Game, pid: PlayerId): Set<string> {
    return g.mode.usedScope === "room" ? g.usedRoom : setFor(g.usedByPlayer, pid);
  }

  private revealWords(g: Game): void {
    for (const [pid, w] of g.pendingWords) g.lastWords.set(pid, w);
    g.pendingWords.clear();
  }

  /** A player's last shown word this game, if any. Silent and ghost words are never recorded. */
  lastWordOf(pid: PlayerId): LastWord | undefined {
    return this.game?.lastWords.get(pid);
  }

  /** Ends the running game; does nothing if it has already ended. */
  private finish(winners: PlayerId[]): void {
    if (!this.running()) return;
    this.clearBomb();
    if (this.game) {
      this.game.typing.clear();
      this.revealWords(this.game);
    }
    this.winners = winners;
    this.phase = "results";
    this.changed();
  }

  private find(id: PlayerId): Player | undefined {
    return this.list.find((p) => p.id === id);
  }

  /** A random avatar nobody in the room has. MAX_PLAYERS is below AVATAR_COUNT, so one is always free. */
  private freeAvatar(): number {
    const used = new Set(this.list.map((p) => p.avatar));
    const free: number[] = [];
    for (let i = 0; i < AVATAR_COUNT; i++) if (!used.has(i)) free.push(i);
    return free[Math.min(free.length - 1, Math.floor(this.deps.random() * free.length))];
  }

  private newId(): PlayerId {
    for (;;) {
      const id = "p" + Math.floor(this.deps.random() * 2 ** 32).toString(36);
      if (!this.list.some((p) => p.id === id || p.token === id)) return id;
    }
  }

  private resolveName(
    raw: string,
    self: Player | undefined,
  ): { ok: true; nickname: string } | { ok: false; reason: NameFailure } {
    const base = raw.trim();
    if (base.length < NAME_MIN || base.length > NAME_MAX) return { ok: false, reason: "name-length" };
    if (isBlockedName(base, this.blockedNames)) return { ok: false, reason: "name-blocked" };
    const used = new Set(
      this.list.filter((p) => p !== self).map((p) => p.nickname.toLowerCase()),
    );
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      const suffix = ` ${n}`;
      candidate = base.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
    }
    return { ok: true, nickname: candidate };
  }

  private changed(): void {
    this.onChange?.();
  }
}
