import type { Prompt, SettingDecl, Settings } from "../types.ts";
import type { Player, PlayerId } from "../room.ts";

export type SubmitResult =
  | { ok: true; kind: "turn" | "silent" | "ghost" }
  | {
      ok: false;
      reason:
        | "not-playing" | "paused" | "empty" | "too-long" | "bad-characters"
        | "not-a-word" | "doesnt-match" | "used" | "blocked" | "not-your-turn";
    };

/** What the engine hands to modes and activities. */
export interface ModeContext {
  settings: Settings;
  random(): number;
  now(): number;
  /** Alive players with role "player", in seat order. */
  alive(): Player[];
  prompt(): Prompt | null;
  /** From the bank using band/types, avoiding the last 10 prompts. Calls activity.onPrompt. */
  newPrompt(): Prompt;
  /** Replaces any armed bomb; pausable. */
  armBomb(ms: number, visible: boolean): void;
  bombRemaining(): number;
  player(pid: PlayerId): Player | undefined;
  /** Brings a player back: sets alive and lives. Seat order is the mode's business. */
  revive(pid: PlayerId, lives: number): void;
  /** Handles the knockout and calls the activity. */
  loseLife(pid: PlayerId): void;
  /** Marks the word used, adds score +1, applies the bonus alphabet. */
  acceptWord(pid: PlayerId, word: string): void;
  /** Records example answers for views. */
  explodedPrompt(p: Prompt): void;
  endGame(winners: PlayerId[]): void;
  /** The mode's private state, reset each game. */
  state: Record<string, unknown>;
  /** The knockout activity's private state, reset each game, separate from `state`. */
  activityState: Record<string, unknown>;
}

/** A game mode. The engine calls these hooks; the mode never touches timers directly. */
export interface GameMode {
  id: string;
  name: string;
  description: string;
  settings: SettingDecl[];
  /** Deal the first prompt, arm the bomb. */
  start(ctx: ModeContext): void;
  /** The word is already normalised, valid, unused, and from a player who isOn. */
  onWord(ctx: ModeContext, pid: PlayerId, word: string): void;
  /** The bomb timer fired. */
  onExplode(ctx: ModeContext): void;
  /** The player was kicked (already removed from the room). */
  onPlayerGone(ctx: ModeContext, pid: PlayerId): void;
  /** Host pressed "skip prompt": new prompt, same player(s), re-arm by the mode's rule. */
  onSkip(ctx: ModeContext): void;
  /** May this player's words count as real turns now? */
  isOn(ctx: ModeContext, pid: PlayerId): boolean;
  /** No-reuse rule. */
  usedScope: "room" | "player";
  /** Mode-specific public data for views. */
  view(ctx: ModeContext): Record<string, unknown>;
}
