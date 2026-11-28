import type { SettingDecl } from "../types.ts";
import type { PlayerId } from "../room.ts";
import type { ModeContext, SubmitResult } from "../modes/mode.ts";

/** What knocked-out players do. */
export interface KnockoutActivity {
  id: string;
  name: string;
  description: string;
  settings: SettingDecl[];
  onKnockedOut(ctx: ModeContext, pid: PlayerId): void;
  /** Called whenever a new prompt or round starts. */
  onPrompt(ctx: ModeContext): void;
  /** The word is already normalised, a real word, and matches the current prompt. */
  onWord(ctx: ModeContext, pid: PlayerId, word: string): SubmitResult;
  view(ctx: ModeContext, pid: PlayerId): Record<string, unknown>;
  /** This player's own words from the activity, for their private end-of-game summary only. */
  privateWords?(ctx: ModeContext, pid: PlayerId): string[];
}

/** Used when the knockout setting names no known activity: knocked-out players just watch. */
export const noopActivity: KnockoutActivity = {
  id: "none",
  name: "Watch",
  description: "Knocked-out players watch the rest of the game.",
  settings: [],
  onKnockedOut() {},
  onPrompt() {},
  onWord: () => ({ ok: false, reason: "not-playing" }),
  view: () => ({}),
};
