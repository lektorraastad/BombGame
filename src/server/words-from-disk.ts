// Loads the generated word files from a folder, for servers that can read the file system.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWordData } from "../words/load.ts";

export function loadWordsFromDir(dir: string): ReturnType<typeof loadWordData> {
  return loadWordData((name) => readFileSync(join(dir, name), "utf8"));
}
