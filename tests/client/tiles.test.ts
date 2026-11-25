import { test } from "node:test";
import assert from "node:assert/strict";
import { tiles, matchRange, matchedTiles } from "../../public/app/tiles.js";
import { esc } from "../../public/app/escape.js";
import { esc as escFromPlayer } from "../../public/app/render-player.js";

/** The text of each tile, in order, still escaped. */
const tileTexts = (html: string) => [...html.matchAll(/<span class="tile(?: matched)?">([^<]*)<\/span>/g)].map((m) => m[1]);

test("tiles split by code point and escape", () => {
  const html = tiles("Åse😀<b>");
  assert.equal((html.match(/class="tile"/g) ?? []).length, 7); // Å s e 😀 < b >
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes("&lt;"));
  assert.deepEqual(tileTexts(html), ["Å", "s", "e", "😀", "&lt;", "b", "&gt;"]);
});

test("tiles are wrapped in one tiles span, with the extra class", () => {
  assert.match(tiles("ab"), /^<span class="tiles"><span class="tile">a<\/span><span class="tile">b<\/span><\/span>$/);
  assert.match(tiles("ab", "big"), /^<span class="tiles big">/);
  assert.ok(!tiles("ab", '"><script>').includes("<script>"), "the class is escaped too");
});

test("whitespace becomes a gap, never an empty tile", () => {
  const html = tiles("Ola  Nordmann\t");
  assert.equal(tileTexts(html).length, 11);
  assert.ok(tileTexts(html).every((t) => t.trim() !== ""), "no empty tile");
  assert.equal((html.match(/<span class="gap"><\/span>/g) ?? []).length, 3);
  assert.equal(tiles(""), '<span class="tiles"></span>');
});

test("a 16-character name with æøå, emoji and markup stays whole", () => {
  const name = "<script>æøå😀ÆØÅ";
  assert.equal(Array.from(name).length, 15);
  const html = tiles(name + "!");
  assert.ok(!html.includes("<script>"));
  assert.deepEqual(tileTexts(html), Array.from(name + "!").map((c) => esc(c)));
});

test("matchRange per prompt type", () => {
  assert.deepEqual(matchRange("singing", { text: "ing", type: "contains" }), [1, 4]);
  assert.deepEqual(matchRange("singing", { text: "ing", type: "ends" }), [4, 7]);
  assert.deepEqual(matchRange("STATION", { text: "st", type: "starts" }), [0, 2]);
  assert.equal(matchRange("cat", { text: "dog", type: "contains" }), null);
});

test("matchRange: no match, odd input, and code-point indexes", () => {
  assert.equal(matchRange("station", { text: "st", type: "ends" }), null);
  assert.equal(matchRange("best", { text: "st", type: "starts" }), null);
  assert.equal(matchRange("cat", { text: "", type: "contains" }), null);
  assert.equal(matchRange("cat", { text: "at", type: "sideways" }), null);
  assert.equal(matchRange("cat", null as any), null);
  // 😀 is two UTF-16 units but one code point (one tile).
  assert.deepEqual(matchRange("😀sting", { text: "st", type: "contains" }), [1, 3]);
  assert.deepEqual(matchRange("blåbær", { text: "BÆR", type: "ends" }), [3, 6]);
});

test("matchedTiles raises the matched letters only", () => {
  const html = matchedTiles("singing", { text: "ing", type: "contains" });
  const all = [...html.matchAll(/<span class="(tile(?: matched)?)">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(all, [
    ["tile", "s"], ["tile matched", "i"], ["tile matched", "n"], ["tile matched", "g"],
    ["tile", "i"], ["tile", "n"], ["tile", "g"],
  ]);
  assert.ok(html.startsWith('<span class="tiles">'));
});

test("matchedTiles with no match is plain tiles, and escapes", () => {
  assert.equal(matchedTiles("cat", { text: "dog", type: "contains" }), tiles("cat"));
  const html = matchedTiles("<b>st", { text: "st", type: "ends" });
  assert.ok(!html.includes("<b>"));
  assert.equal((html.match(/tile matched/g) ?? []).length, 2);
});

test("esc moved to escape.js; render-player still exports the same function", () => {
  assert.equal(escFromPlayer, esc);
  assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
