// Builds data/generated/ from data/raw/. Netlify runs this on every deploy
// (npm run build:words), so editing a raw list on GitHub takes effect on the next deploy.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWordData, summarize, type WordData, type RawWords } from "../src/words/build.ts";

const OPTIONAL = ["blocked-no.txt", "blocked-extra.txt", "known-extra.txt", "names-extra.txt"];

/** Reads the raw files. Missing optional files are listed in `skipped`. */
export function readRaw(rawDir: string): {
  raw: RawWords;
  skipped: string[];
} {
  const skipped: string[] = [];
  const req = (name: string) => readFileSync(join(rawDir, name), "utf8");
  const opt = (name: string) => {
    const p = join(rawDir, name);
    if (existsSync(p)) return [readFileSync(p, "utf8")];
    skipped.push(name);
    return [];
  };
  const raw: RawWords = {
    scowl: req("scowl-words.txt"),
    ngsl: [req("ngsl-lemmatized.csv"), req("ngsl-supplementary.csv")],
    ngslStats: req("ngsl-stats.csv"),
    cefrj: req("cefrj-vocabulary-profile-1.5.csv"),
    // Countries, nationalities and languages are known words; cities are answers only.
    places: req("names-places.txt"),
    holidays: req("names-holidays.txt"),
    // Brands are answers only.
    brands: req("names-brands.txt"),
    // Roy's own lists: known-extra.txt words count as known, names-extra.txt are answers only.
    knownExtra: opt("known-extra.txt"),
    namesExtra: opt("names-extra.txt"),
    // English + Roy's own list block answers and nicknames.
    blocked: [req("blocked-en.txt"), ...opt("blocked-extra.txt")],
    // The Norwegian list blocks nicknames only ("fan" is an everyday English answer).
    namesOnly: opt("blocked-no.txt"),
  };
  // keep `skipped` in a stable order
  skipped.sort((a, b) => OPTIONAL.indexOf(a) - OPTIONAL.indexOf(b));
  return { raw, skipped };
}

export function writeGenerated(outDir: string, data: WordData, skipped: string[]) {
  mkdirSync(outDir, { recursive: true });
  const txt = (ws: string[]) => ws.join("\n") + "\n";
  writeFileSync(join(outDir, "dictionary.txt"), txt(data.dictionary));
  writeFileSync(join(outDir, "known.txt"), txt(data.known));
  writeFileSync(join(outDir, "beginner.txt"), txt(data.beginner));
  writeFileSync(join(outDir, "blocked-words.txt"), txt(data.blockedWords));
  writeFileSync(join(outDir, "blocked-names.txt"), txt(data.blockedNames));
  // ranks.txt: word, NGSL rank (100000 when none), CEFR-J level (1-4, empty when none),
  // NGSL headword the word counts as (empty when it stands for itself).
  const rankRow = ([w, r]: [string, number]) => `${w}\t${r}\t${data.levels.get(w) ?? ""}\t${data.heads.get(w) ?? ""}`;
  writeFileSync(join(outDir, "ranks.txt"), [...data.ranks].map(rankRow).join("\n") + "\n");
  writeFileSync(join(outDir, "names.txt"), txt(data.names));
  writeFileSync(join(outDir, "prompts.json"), JSON.stringify(data.prompts));
  const summary = summarize(data, skipped);
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

/** Refuse to ship a broken list: returns the problems, empty if fine. */
export function problems(summary: ReturnType<typeof summarize>): string[] {
  const out: string[] = [];
  if (summary.counts.known < 1000) out.push(`only ${summary.counts.known} known words (need 1000+)`);
  if (summary.counts.blockedWords < 200) out.push(`only ${summary.counts.blockedWords} blocked words (need 200+): was blocked-en.txt emptied?`);
  for (const [type, b] of Object.entries(summary.prompts)) {
    const total = b.veryEasy + b.easy + b.medium + b.hard;
    if (total < 10) out.push(`only ${total} "${type}" prompts (need 10+)`);
  }
  // A small Easy option means the CEFR-J file was damaged or removed.
  const easyOption = summary.prompts.contains.veryEasy + summary.prompts.contains.easy;
  if (easyOption < 100) out.push(`Easy option has only ${easyOption} "contains" prompts (need 100+)`);
  return out;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { raw, skipped } = readRaw(join(root, "data", "raw"));
  for (const s of skipped) console.log(`(skipped optional file data/raw/${s}: not found)`);
  const summary = writeGenerated(join(root, "data", "generated"), buildWordData(raw), skipped);
  console.log(JSON.stringify(summary, null, 2));
  const bad = problems(summary);
  if (bad.length) {
    console.error("Word lists look broken, refusing to deploy:\n- " + bad.join("\n- "));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
