import type { SettingDecl, Settings } from "./types.ts";

export function resolveSettings(decls: SettingDecl[], input: Record<string, unknown>): Settings {
  const out: Settings = {};
  for (const d of decls) {
    const v = input[d.key];
    switch (d.kind) {
      case "number": {
        if (typeof v !== "number" || !Number.isFinite(v)) { out[d.key] = d.default; break; }
        const clamped = Math.min(d.max, Math.max(d.min, v));
        const stepped = d.min + Math.round((clamped - d.min) / d.step) * d.step;
        // Rounding to a step can overshoot max; trim float noise too.
        out[d.key] = Math.min(d.max, Number(stepped.toFixed(6)));
        break;
      }
      case "boolean":
        out[d.key] = typeof v === "boolean" ? v : d.default;
        break;
      case "choice":
        out[d.key] = typeof v === "string" && d.options.some((o) => o.value === v) ? v : d.default;
        break;
      case "multi": {
        const known = Array.isArray(v)
          ? d.options.map((o) => o.value).filter((o) => v.includes(o))
          : [];
        out[d.key] = known.length > 0 ? known : [...d.default];
        break;
      }
    }
  }
  return out;
}

const PROMPT_TYPES = [
  { value: "contains", label: "Contains" },
  { value: "starts", label: "Starts with" },
  { value: "ends", label: "Ends with" },
];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("").map((c) => ({ value: c, label: c.toUpperCase() }));

export const CORE_SETTINGS: SettingDecl[] = [
  // Options for "mode" and "knockout" are filled by withChoices (see registry.ts settingsFor).
  { key: "mode", label: "Mode", help: "How the game is played.", kind: "choice", default: "classic", options: [] },
  { key: "band", label: "Difficulty", help: "How many words fit each prompt.", kind: "choice", default: "mixed",
    options: [
      { value: "easy", label: "Easy" }, { value: "medium", label: "Medium" },
      { value: "hard", label: "Hard" }, { value: "mixed", label: "Mixed" },
    ] },
  { key: "promptTypes", label: "Prompt types", help: "Where the letters must appear in the word.", kind: "multi",
    default: ["contains"], options: PROMPT_TYPES },
  { key: "startLives", label: "Starting lives", help: "Lives each player starts with.", kind: "number",
    default: 2, min: 1, max: 5, step: 1, unit: "lives" },
  { key: "maxLives", label: "Maximum lives", help: "Players can never hold more lives than this.", kind: "number",
    default: 3, min: 1, max: 6, step: 1, unit: "lives" },
  { key: "bonusAlphabet", label: "Bonus alphabet", help: "Use every bonus letter to win an extra life.", kind: "boolean", default: true },
  { key: "bonusLetters", label: "Bonus letters", help: "The letters that count towards the bonus.", kind: "multi",
    default: "abcdefghijklmnoprstuvwy".split(""), options: ALPHABET },
  { key: "knockout", label: "When knocked out", help: "What knocked-out players do.", kind: "choice", default: "ghost", options: [] },
  { key: "exampleAnswers", label: "Example answers", help: "Show example words after each explosion.", kind: "boolean", default: true },
  { key: "liveTyping", label: "Live typing", help: "Show the current player's typing on the projector.", kind: "boolean", default: false },
];

type Named = { id: string; name: string };

/**
 * Returns copies of `decls` with the "mode" and "knockout" choices listing the given modes and activities.
 * Takes plain {id, name} lists so this file never imports the modes or the registry.
 */
export function withChoices(decls: SettingDecl[], modes: Named[], activities: Named[]): SettingDecl[] {
  const opts = (list: Named[]) => list.map((x) => ({ value: x.id, label: x.name }));
  return decls.map((d) => {
    if (d.kind !== "choice") return d;
    if (d.key === "mode") return { ...d, options: opts(modes) };
    if (d.key === "knockout") return { ...d, options: opts(activities) };
    return d;
  });
}
