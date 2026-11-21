export type EngineDeps = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  /** Returns a number in [0, 1). */
  random(): number;
};

export type PromptType = "contains" | "starts" | "ends";
/** `count` is the number of fitting known words. */
export type Prompt = { text: string; type: PromptType; count: number };

export type Band = "easy" | "medium" | "hard" | "mixed";

type SettingBase = { key: string; label: string; help: string };
type Option = { value: string; label: string };

export type SettingDecl =
  | (SettingBase & { kind: "number"; default: number; min: number; max: number; step: number; unit?: "s" | "lives" })
  | (SettingBase & { kind: "boolean"; default: boolean })
  | (SettingBase & { kind: "choice"; default: string; options: Option[] })
  | (SettingBase & { kind: "multi"; default: string[]; options: Option[] });

export type Settings = Record<string, number | boolean | string | string[]>;
