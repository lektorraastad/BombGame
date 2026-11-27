import type { Settings } from "./types.ts";

/**
 * Ready-made setups: Gentle, Normal and Fast. Normal equals the declared defaults.
 * A setup only sets the timing, lives and difficulty keys below; everything else is left alone.
 */
export const PRESET_IDS = ["gentle", "normal", "fast"] as const;
export type PresetId = typeof PRESET_IDS[number];

export const PRESETS: Record<PresetId, Record<string, number | string>> = {
  gentle: { band: "easy", startLives: 3, maxLives: 3, fuseMin: 15, fuseMax: 40, minTurn: 10, turnTime: 18, roundTime: 25 },
  normal: { band: "normal", startLives: 2, maxLives: 3, fuseMin: 10, fuseMax: 30, minTurn: 8, turnTime: 12, roundTime: 15 },
  fast: { band: "normal", startLives: 2, maxLives: 3, fuseMin: 6, fuseMax: 20, minTurn: 5, turnTime: 8, roundTime: 10 },
};

/** Every key some setup controls. */
const PRESET_KEYS = new Set(PRESET_IDS.flatMap((id) => Object.keys(PRESETS[id])));

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === "string" && (PRESET_IDS as readonly string[]).includes(v);
}

function matches(settings: Settings, id: PresetId): boolean {
  return Object.entries(PRESETS[id]).every(([k, v]) => !(k in settings) || settings[k] === v);
}

/**
 * The setup whose values all match `settings`, for the keys present in it, else "custom".
 * The recorded `settings.preset` wins a tie.
 */
export function presetOf(settings: Settings): PresetId | "custom" {
  const order = isPresetId(settings.preset)
    ? [settings.preset, ...PRESET_IDS.filter((id) => id !== settings.preset)]
    : PRESET_IDS;
  return order.find((id) => matches(settings, id)) ?? "custom";
}

/**
 * The settings after applying `input` to `current`, with the setup rules:
 * - choosing a setup applies its values, then any other keys in the same message;
 * - a mode change applies the active setup's values again for the new mode's keys (not for Custom);
 * - `{ preset: "custom" }` records Custom and changes nothing else;
 * - a junk preset value is ignored;
 * - after a change to a setup key, a chosen setup or a mode change, `preset` is the setup that matches, else Custom.
 * `resolve` validates and fills the settings for the mode they name; it must be pure.
 */
export function applySettingsInput(
  current: Settings,
  input: Record<string, unknown>,
  resolve: (input: Record<string, unknown>) => Settings,
): Settings {
  const { preset: asked, ...rest } = input;
  const chosen: PresetId | "custom" | undefined = isPresetId(asked) ? asked : asked === "custom" ? "custom" : undefined;
  const active = chosen ?? current.preset;
  const modeChanged = resolve({ ...current, ...rest }).mode !== current.mode;

  const apply = isPresetId(active) && (isPresetId(chosen) || modeChanged);
  const next = resolve({ ...current, ...(apply ? PRESETS[active as PresetId] : {}), ...rest, preset: active });

  const touched = isPresetId(chosen) || modeChanged || Object.keys(rest).some((k) => PRESET_KEYS.has(k));
  if (touched) next.preset = presetOf(next);
  return next;
}
