// The one list of game modes and knockout activities. Add new ones here (see docs/EXTENDING.md).
import type { SettingDecl } from "./types.ts";
import type { GameMode } from "./modes/mode.ts";
import type { KnockoutActivity } from "./knockout/activity.ts";
import { classicMode } from "./modes/classic.ts";
import { everyoneMode } from "./modes/everyone.ts";
import { ghostActivity } from "./knockout/ghost.ts";
import { CORE_SETTINGS, withChoices } from "./settings.ts";
import { Room } from "./room.ts";

export const MODES: GameMode[] = [classicMode, everyoneMode];
export const ACTIVITIES: KnockoutActivity[] = [ghostActivity];

/** Settings for the host panel: core, then the mode's, then the activity's, with mode/knockout choices from the registry. */
export function settingsFor(modeId: string, activityId: string): SettingDecl[] {
  return withChoices(
    [
      ...CORE_SETTINGS,
      ...(MODES.find((m) => m.id === modeId)?.settings ?? []),
      ...(ACTIVITIES.find((a) => a.id === activityId)?.settings ?? []),
    ],
    MODES,
    ACTIVITIES,
  );
}

export type CreateRoomOptions = Omit<ConstructorParameters<typeof Room>[0], "modes" | "activities">;

/** A room that plays every registered mode and activity. */
export function createRoom(opts: CreateRoomOptions): Room {
  return new Room({ ...opts, modes: MODES, activities: ACTIVITIES });
}
