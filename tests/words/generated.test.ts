import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWordData } from "../../src/words/load.ts";
import { buildWordData } from "../../src/words/build.ts";
import { readRaw } from "../../scripts/build-words.ts";

const root = join(import.meta.dirname, "..", "..");
const gen = (name: string) => readFileSync(join(root, "data", "generated", name), "utf8");
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) <= Math.max(3, expected * 0.1), `${actual} not within 10% of ${expected}`);

test("generated sizes match the supplied lists", () => {
  const { summary } = loadWordData(gen);
  near(summary.counts.known, 12610);
  near(summary.counts.dictionary, 143784);
  const e = { contains: [137, 342, 715], starts: [8, 82, 192], ends: [17, 56, 137] } as const;
  for (const t of ["contains", "starts", "ends"] as const) {
    near(summary.prompts[t].easy, e[t][0]);
    near(summary.prompts[t].medium, e[t][1]);
    near(summary.prompts[t].hard, e[t][2]);
  }
});

test("every prompt has at least 20 known answers (recount)", () => {
  const known = gen("known.txt").split("\n").filter(Boolean);
  const prompts = JSON.parse(gen("prompts.json")) as { text: string; type: string; count: number }[];
  for (const type of ["contains", "starts", "ends"]) {
    for (const p of prompts.filter((x) => x.type === type).slice(0, 50)) {
      const n = known.filter((w) => w.length > p.text.length &&
        (type === "contains" ? w.includes(p.text) : type === "starts" ? w.startsWith(p.text) : w.endsWith(p.text))).length;
      assert.equal(n, p.count, `${type}:${p.text}`);
      assert.ok(n >= 20);
    }
  }
});

test("no blocked word is known or in the dictionary", () => {
  const blocked = new Set(gen("blocked-words.txt").split("\n").filter(Boolean));
  for (const f of ["known.txt", "dictionary.txt"]) {
    for (const w of gen(f).split("\n")) assert.ok(!blocked.has(w), `${w} in ${f}`);
  }
});

test("the loader's checker accepts a known word, rejects a blocked word, and the bank can deal every band", () => {
  const { checker, bank, blockedNames } = loadWordData(gen);
  assert.ok(checker.isWord("station"));
  assert.ok(!checker.isWord("fuck"));
  assert.ok(checker.isWord("fan"), "the Norwegian list must not block English answers");
  assert.ok(blockedNames.includes("jævla"));
  for (const band of ["easy", "medium", "hard", "mixed"] as const) {
    assert.ok(bank.size(band, ["contains"]) > 0, band);
    const p = bank.next({ band, types: ["contains"], random: Math.random, avoid: [] });
    assert.ok(checker.examples(p, 3, Math.random).length > 0);
  }
});

test("generated files are up to date with data/raw", () => {
  const { raw } = readRaw(join(root, "data", "raw"));
  const d = buildWordData(raw);
  assert.equal(JSON.stringify(d.prompts), gen("prompts.json"));
  assert.equal(d.known.join("\n") + "\n", gen("known.txt"));
});

test("forms of rude words are rejected, but everyday look-alikes are accepted", () => {
  const { checker } = loadWordData(gen);
  for (const w of ["fucks", "fucked", "fuckers", "motherfucking", "cunts", "niggers", "niggas", "faggots", "shits", "shithead",
    "bullshitter", "dickheads", "whores", "sluts", "wankers", "wanking", "twats", "bitches", "assholes", "rapists", "penises", "cocksuckers"]) {
    assert.ok(!checker.isWord(w), `${w} should be rejected`);
  }
  for (const w of ["butter", "spicy", "spices", "spiced", "cumin", "sucked", "sucking", "saltwater", "wristwatch", "smartwatch",
    "nightwatchman", "swanky", "snigger", "niggle", "monger", "class", "classy", "grass", "station", "cocky", "snatched", "shitake"]) {
    assert.ok(checker.isWord(w), `${w} should be accepted`);
  }
});
