import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWordData, everydayWords } from "../../src/words/load.ts";
import { buildWordData } from "../../src/words/build.ts";
import { readRaw } from "../../scripts/build-words.ts";
import { levelOf } from "../../src/engine/prompts.ts";
import type { Prompt } from "../../src/engine/types.ts";

const root = join(import.meta.dirname, "..", "..");
const gen = (name: string) => readFileSync(join(root, "data", "generated", name), "utf8");
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) <= Math.max(3, expected * 0.1), `${actual} not within 10% of ${expected}`);

test("generated sizes match the supplied lists", () => {
  const { summary } = loadWordData(gen);
  near(summary.counts.known, 12610);
  near(summary.counts.dictionary, 143784);
  const c = summary.prompts.contains;
  assert.ok(c.veryEasy + c.easy >= 150, `Easy option has ${c.veryEasy + c.easy} "contains" prompts (need 150+)`);
  assert.ok(c.veryEasy >= 100, `very easy has ${c.veryEasy} "contains" prompts (need 100+)`);
});

test("levels: STS and CTS are hard, IGH is very easy", () => {
  const prompts = JSON.parse(gen("prompts.json")) as Prompt[];
  const find = (text: string) => prompts.find((p) => p.type === "contains" && p.text === text);
  for (const text of ["sts", "cts"]) {
    const p = find(text);
    if (p) assert.equal(levelOf(p), "hard", `${text} (common ${p.common})`);
  }
  const igh = find("igh");
  assert.ok(igh, "igh is a prompt");
  assert.equal(levelOf(igh), "veryEasy", `igh (common ${igh.common})`);
});

test("beginner.txt has more than 2000 words", () => {
  assert.ok(gen("beginner.txt").split("\n").filter(Boolean).length > 2000);
});

test("every prompt has at least 20 known answers, and common counts the beginner words (recount)", () => {
  const known = gen("known.txt").split("\n").filter(Boolean);
  const beginner = gen("beginner.txt").split("\n").filter(Boolean);
  const prompts = JSON.parse(gen("prompts.json")) as Prompt[];
  for (const type of ["contains", "starts", "ends"]) {
    for (const p of prompts.filter((x) => x.type === type).slice(0, 50)) {
      const fits = (w: string) => w.length > p.text.length &&
        (type === "contains" ? w.includes(p.text) : type === "starts" ? w.startsWith(p.text) : w.endsWith(p.text));
      const n = known.filter(fits).length;
      assert.equal(n, p.count, `${type}:${p.text}`);
      assert.ok(n >= 20);
      assert.equal(beginner.filter(fits).length, p.common, `common ${type}:${p.text}`);
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
  const types = [["contains"], ["starts"], ["ends"]] as const;
  for (const band of ["easy", "normal", "rising", "hard"] as const) {
    for (const t of types) {
      assert.ok(bank.size(band, [...t]) > 0, `${band} ${t}`);
      for (const stage of band === "rising" ? [1, 2, 3] : [1]) {
        const p = bank.next({ band, types: [...t], random: Math.random, avoid: [], stage });
        assert.ok(checker.examples(p, 3, Math.random).length > 0, `${band} ${t} stage ${stage}`);
      }
    }
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

test("places, holidays and brands are words; classmates' first names are not", () => {
  const { checker } = loadWordData(gen);
  for (const w of ["norway", "norwegian", "christmas", "tiktok", "oslo", "jordan", "banana"]) {
    assert.ok(checker.isWord(w), `${w} should be accepted`);
  }
  for (const w of ["emma", "ingrid", "jonas", "thea"]) assert.ok(!checker.isWord(w), `${w} should be rejected`);
  assert.ok(!checker.isWord("fuck"));
  const rawNames = (f: string) => new Set(readFileSync(join(root, "data", "raw", f), "utf8").split("\n")
    .map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")));
  for (const f of ["names-places.txt", "names-brands.txt"]) {
    const names = rawNames(f);
    for (const w of ["victoria", "florence", "sydney", "alexa"]) assert.ok(!names.has(w), `${w} in ${f}`);
  }
});

test("Easy, Normal and Rising never deal STS or CTS, at any stage", () => {
  const { bank } = loadWordData(gen);
  for (const band of ["easy", "normal", "rising"] as const) {
    for (const stage of [1, 2, 3, 4]) {
      for (let i = 0; i < 200; i++) {
        const p = bank.next({ band, types: ["contains"], random: Math.random, avoid: [], stage });
        assert.ok(!(p.type === "contains" && (p.text === "sts" || p.text === "cts")), `${band} stage ${stage}: ${p.text}`);
      }
    }
  }
});

test("ranks.txt and names.txt exist and are non-empty", () => {
  assert.ok(gen("ranks.txt").trim().length > 0);
  assert.ok(gen("names.txt").trim().length > 0);
  const { rarity } = loadWordData(gen);
  assert.equal(rarity("barbados"), null);
  assert.equal(typeof rarity("turkey"), "number"); // also an NGSL word, so not only a name
  assert.equal(rarity("apples"), rarity("apple"));
});

test("an old generated folder without ranks.txt or names.txt still loads", () => {
  const { rarity } = loadWordData((n) => { if (n === "ranks.txt" || n === "names.txt") throw new Error("ENOENT"); return gen(n); });
  assert.notEqual(rarity("barbados"), null);
});

test("ranks.txt has the CEFR-J level and NGSL headword columns", () => {
  const rows = new Map(gen("ranks.txt").trim().split("\n").map((l) => [l.split("\t")[0], l.split("\t")]));
  assert.deepEqual(rows.get("threaten"), ["threaten", "1521", "4", ""]);
  assert.deepEqual(rows.get("hoping"), ["hoping", "250", "", "hope"]);
});

test("the generated lists rank the final review's examples sensibly", () => {
  const { rarity } = loadWordData(gen);
  const r = (w: string) => rarity(w)!;
  const order = ["agendas", "accompany", "troop", "amplify", "threaten", "hypotheses"];
  for (let i = 1; i < order.length; i++) assert.ok(r(order[i - 1]) < r(order[i]), `${order[i - 1]} < ${order[i]}`);
  assert.ok(r("bracket") > r("troop") && r("bracket") < r("threaten"));
  assert.ok(r("helper") < r("threaten"));
  assert.ok(r("apologise") < r("agendas"));
  assert.ok(r("biggest") <= r("television") && r("happier") <= r("television"));
  assert.equal(r("hoping"), r("hope"));
  assert.ok(r("herd") > r("her") && r("shed") > r("she") && r("ward") > r("war") && r("heed") > r("he"));
});

test("an old two-column ranks.txt still loads", () => {
  const old = "apple\t900\nzebra\t100000\n";
  const { rarity } = loadWordData((n) => (n === "ranks.txt" ? old : gen(n)));
  assert.equal(typeof rarity("apple"), "number");
  assert.equal(rarity("barbados"), null);
});

test("everydayWords: B1 and below, own headword, not a name, NGSL rank of 2000 or less when there's no level", () => {
  const rows = [
    "house\t300\t1\t", "bridge\t900\t3\t", "mercy\t1500\t4\t", // B2: out
    "houses\t300\t1\thouse", // a form: out
    "oslo\t100000\t1\t", // a name: out
    "lamp\t1800\t\t", "lamps\t1800\t\tlamp", "ferret\t100000\t\t", "rare\t2500\t\t", // no level
  ].join("\n");
  const known = "house\nbridge\nmercy\nhouses\noslo\nlamp\nlamps\nferret\nrare\n";
  const read = (n: string) => (n === "ranks.txt" ? rows : n === "names.txt" ? "oslo\n" : n === "known.txt" ? known : "");
  assert.deepEqual([...everydayWords(read)].sort(), ["bridge", "house", "lamp"]);
});

test("everydayWords: a two-column ranks.txt contributes nothing, even for low ranks and forms", () => {
  const known = "apple\napples\nlamp\n";
  const read = (n: string) => (n === "ranks.txt" ? "apple\t900\napples\t900\nlamp\t1800\n" : n === "known.txt" ? known : "");
  assert.equal(everydayWords(read).size, 0);
});

test("old ranks.txt: beginner examples only", () => {
  const none = (n: string) => { if (n === "ranks.txt" || n === "names.txt") throw new Error("ENOENT"); return gen(n); };
  assert.equal(everydayWords(none).size, 0);
  const { checker } = loadWordData(none);
  const beginner = new Set(gen("beginner.txt").split("\n").map((l) => l.trim()).filter(Boolean));
  const prompts = JSON.parse(gen("prompts.json")) as Prompt[];
  for (const p of prompts) for (const w of checker.examples(p, 3, Math.random)) assert.ok(beginner.has(w), `${p.text}: ${w}`);
});

test("over every prompt in prompts.json, every example is a beginner or everyday word, and 'paragraphed' never appears", () => {
  const { checker } = loadWordData(gen);
  const beginner = new Set(gen("beginner.txt").split("\n").map((l) => l.trim()).filter(Boolean));
  const everyday = everydayWords(gen);
  let seed = 12345;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const prompts = JSON.parse(gen("prompts.json")) as Prompt[];
  const counts = [0, 0, 0, 0];
  for (const p of prompts) {
    const ex = checker.examples(p, 3, random);
    counts[ex.length]++;
    for (const w of ex) {
      assert.ok(beginner.has(w) || everyday.has(w), `${p.text}: ${w}`);
      assert.notEqual(w, "paragraphed");
    }
  }
  console.log("examples per prompt (0,1,2,3):", counts.join(","));
});
