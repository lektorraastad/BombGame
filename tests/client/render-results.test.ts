import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderResults, renderSummaryCard } from "../../public/app/render-results.js";
import { avatarImg } from "../../public/app/avatars.js";
import { tiles } from "../../public/app/tiles.js";

const text = (html: string) => html.replace(/<[^>]+>/g, "");
/** The inner HTML of the first element whose class list starts with `cls` (elements of that tag must not nest deeper than counted). */
function part(html: string, cls: string): string {
  const m = html.match(new RegExp(`<(\\w+) class="${cls}(?: [^"]*)?"[^>]*>`));
  assert.ok(m, `no .${cls}`);
  const tag = m[1];
  let depth = 0;
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "g");
  re.lastIndex = m.index!;
  for (let x; (x = re.exec(html)); ) {
    depth += x[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(m.index! + m[0].length, x.index);
  }
  throw new Error(`unclosed .${cls}`);
}
/** Each award card: its kind and inner HTML, in order (divs inside counted, so nested ones are fine). */
function cards(html: string): { kind: string; html: string }[] {
  const out = [];
  for (const m of html.matchAll(/<div class="r-card" data-kind="(\w+)">/g)) {
    let depth = 0;
    const re = /<div\b[^>]*>|<\/div>/g;
    re.lastIndex = m.index!;
    for (let x; (x = re.exec(html)); ) {
      depth += x[0].startsWith("</") ? -1 : 1;
      if (depth === 0) { out.push({ kind: m[1], html: html.slice(m.index! + m[0].length, x.index) }); break; }
    }
  }
  return out;
}

/** The wall's words in order, each with its glow label (or ""). */
const wallOf = (html: string) =>
  [...part(html, "r-wall").matchAll(/<span class="r-word(?: hl)?"(?: data-award="([^"]*)")?><span class="tiles">((?:<span class="tile">[^<]*<\/span>)*)<\/span>/g)]
    .map((m) => ({ award: m[1] ?? "", word: text(m[2]) }));

const PLAYERS = [
  { id: "p1", nickname: "Mia", avatar: 3, lives: 1, alive: true, connected: true, spectator: false },
  { id: "p2", nickname: "Jon", avatar: 5, lives: 0, alive: false, connected: true, spectator: false },
  { id: "p3", nickname: "Ola", avatar: 7, lives: 0, alive: false, connected: true, spectator: false },
];
const who = (id: string) => {
  const p = PLAYERS.find((x) => x.id === id)!;
  return { id: p.id, nickname: p.nickname, avatar: p.avatar };
};
function view(results: Record<string, unknown> = {}, over: Record<string, unknown> = {}): any {
  return {
    code: "ABCD", phase: "results", paused: false, locked: false, players: PLAYERS, prompt: null, mode: null,
    results: { winners: ["p1"], ghostRanking: [], longestWord: null, awards: [], words: [], step: "awards", ...results },
    ...over,
  };
}
const AWARDS = [
  { kind: "longest", players: [who("p2")], word: "comfortable" },
  { kind: "rarest", players: [who("p3")], word: "marvellous" },
  { kind: "mostWords", players: [who("p1")] },
  { kind: "comeback", players: [who("p2"), who("p3")] },
];

test("the awards step shows the winner and the cards in order", () => {
  const html = renderResults(view({ awards: AWARDS, words: ["comfortable", "marvellous", "milk"] }), {});
  assert.ok(html.includes("Game over"));
  assert.ok(html.includes("logo-small"), "the logo at the top left");
  const podium = part(html, "p-podium");
  assert.ok(podium.includes(`<div class="p-winner">${avatarImg(3, "big")}${tiles("Mia")}</div>`));
  assert.ok(html.indexOf("p-podium") < html.indexOf("r-awards"), "the winner first, then the cards");
  const cs = cards(part(html, "r-awards"));
  assert.deepEqual(cs.map((c) => c.kind), ["longest", "rarest", "mostWords", "comeback"]);
  assert.ok(text(cs[0].html).startsWith("Longest word"));
  assert.ok(cs[0].html.includes(tiles("comfortable")) && text(cs[0].html).includes("Jon"));
  assert.ok(text(cs[1].html).startsWith("Rarest word") && cs[1].html.includes(tiles("marvellous")) && text(cs[1].html).includes("Ola"));
  assert.ok(text(cs[2].html).startsWith("Most words") && text(cs[2].html).includes("Mia"));
  assert.ok(cs[2].html.includes(avatarImg(3, "r-big")), "the student's emoji, big");
  assert.ok(text(cs[3].html).startsWith("Comeback"));
  assert.ok(text(cs[3].html).indexOf("Jon") < text(cs[3].html).indexOf("Ola"), "tied names in the view's order");
  assert.ok(!/\d/.test(text(part(html, "r-awards"))), "no numbers on the cards");
  assert.ok(!html.includes("r-wall"), "the wall waits for its step");
  // Best ghost has its own label.
  const ghost = renderResults(view({ awards: [{ kind: "bestGhost", players: [who("p3")] }] }), {});
  assert.deepEqual(cards(ghost).map((c) => c.kind), ["bestGhost"]);
  assert.ok(text(cards(ghost)[0].html).startsWith("Best ghost"));
});

test("the awards step keeps the win moment", () => {
  const html = renderResults(view({ awards: AWARDS }), { win: { pids: ["p1"], elapsedMs: 300 } });
  assert.ok(html.includes("win-burst") && html.includes("p-winner winning"));
  const none = renderResults(view({ winners: [] }), {});
  assert.equal(text(part(none, "p-podium")), "No winner this time");
});

test("longestRarest shows one card and one wall label", () => {
  const awards = [{ kind: "longestRarest", players: [who("p2")], word: "marvellous" }, { kind: "mostWords", players: [who("p1")] }];
  const html = renderResults(view({ awards }), {});
  const cs = cards(html);
  assert.deepEqual(cs.map((c) => c.kind), ["longestRarest", "mostWords"]);
  assert.ok(text(cs[0].html).startsWith("Longest and rarest word"));
  const wall = renderResults(view({ awards, words: ["apple", "marvellous"], step: "words" }), {});
  const hl = wallOf(wall).filter((w) => w.award).map((w) => w.award);
  assert.deepEqual(hl, ["Longest and rarest"]);
  assert.ok(text(wall).includes("Longest and rarest"));
});

test("8 tied names, then N students tied", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, nickname: `Kid${i}`, avatar: i }));
  const html = renderResults(view({ awards: [{ kind: "mostWords", players: eight }] }), {});
  const card = cards(html)[0].html;
  for (const p of eight) assert.ok(text(card).includes(p.nickname));
  assert.ok(card.includes("r-many"), "many names are smaller");
  const many = renderResults(view({ awards: [{ kind: "comeback", players: [], tied: 12 }] }), {});
  const c = cards(many)[0].html;
  assert.ok(text(c).includes("12 students tied"));
  assert.ok(!c.includes("avatar"), "no names or emoji");
});

test("the words step shows the wall alphabetically with the award words glowing", () => {
  const words = ["apple", "comfortable", "marvellous", "milk", "zebra"];
  const html = renderResults(view({ awards: AWARDS, words, step: "words" }), {});
  assert.ok(text(html).includes("Words we played"));
  assert.equal(text(part(html, "r-count")), "5 words");
  assert.ok(!html.includes("r-awards") && !html.includes("p-winner"), "the awards are gone");
  const wall = part(html, "r-wall");
  assert.deepEqual(wallOf(html).map((w) => w.word), words);
  const hl = wallOf(html).filter((w) => w.award).map((w) => [w.word, w.award]);
  assert.deepEqual(hl, [["comfortable", "Longest"], ["marvellous", "Rarest"]]);
  assert.ok(text(wall).includes("Longest") && text(wall).includes("Rarest"), "a small label under each");
  assert.ok(!/Mia|Jon|Ola/.test(text(html)), "no names on the wall");
  assert.ok(!html.includes("r-more"), "everything fits");
  assert.equal(text(part(renderResults(view({ words: ["solo"], step: "words" }), {}), "r-count")), "1 word");
});

test("the wall overflow shows + N more", () => {
  const words = Array.from({ length: 15 }, (_, i) => `w${String(i).padStart(2, "0")}`);
  const awards = [{ kind: "longest", players: [who("p1")], word: "w13" }, { kind: "rarest", players: [who("p2")], word: "w14" }];
  const html = renderResults(view({ awards, words, step: "words" }), { maxWords: 10 });
  const shown = wallOf(html).map((w) => w.word);
  assert.equal(shown.length, 10);
  assert.deepEqual(shown, [...words.slice(0, 8), "w13", "w14"], "the award words stay, the rest alphabetically");
  assert.equal(text(part(html, "r-more")), "+ 5 more: Copy words in the control panel");
  assert.equal(text(part(html, "r-count")), "15 words", "the count is the whole wall");
  // A junk maxWords shows them all.
  for (const maxWords of [Number.NaN, -1, 1.5, "9"]) {
    assert.ok(!renderResults(view({ awards, words, step: "words" }), { maxWords } as any).includes("r-more"), String(maxWords));
  }
});

test("an empty game renders", () => {
  const empty = view({ winners: [], awards: [], words: [] });
  const html = renderResults(empty, {});
  assert.equal(cards(html).length, 0);
  assert.ok(text(html).includes("No winner this time"));
  const wall = renderResults({ ...empty, results: { ...empty.results, step: "words" } }, {});
  assert.equal(text(part(wall, "r-count")), "0 words");
  const me = { id: "p1", nickname: "Mia", summary: { turnWords: 0, silentWords: 0, ghostWords: 0, longest: null, rarest: null, awards: [] } };
  const card = renderSummaryCard({ ...empty, me });
  assert.ok(card.includes('class="your-game"'));
  assert.ok(text(card).includes("Your game"));
  assert.ok(text(card).includes("No words this time. Next game!"));
  assert.ok(!/Your longest|Your rarest|Award/.test(text(card)));
  // A view from before this batch (no awards, words or step) still draws.
  assert.ok(renderResults({ code: "QWER", phase: "results", players: [], results: { winners: [] } }, {}).includes("Game over"));
  assert.equal(renderSummaryCard({ me: {} }), "", "no summary, no card");
});

test("the laptop card shows only the view's own summary, and its counts", () => {
  const me = { id: "p2", nickname: "Jon", summary: { turnWords: 9, silentWords: 5, ghostWords: 0, longest: "organized", rarest: "earthquake", awards: ["mostWords"] } };
  const card = renderSummaryCard(view({ awards: AWARDS }, { me }));
  const t = text(card);
  assert.ok(t.includes("Your game"));
  assert.ok(t.includes("You played 14 words: 9 on your turns, 5 silently"));
  assert.ok(!t.includes("as a ghost"));
  assert.ok(card.includes(tiles("organized")) && t.includes("Your longest"));
  assert.ok(card.includes(tiles("earthquake")) && t.includes("Your rarest"));
  assert.ok(t.includes("Award") && t.includes("Most words 🎉"));
  // Only this summary: the projector's cards are not on it.
  assert.ok(!card.includes("comfortable") && !card.includes("marvellous"));
  const ghost = { id: "p3", summary: { turnWords: 2, silentWords: 0, ghostWords: 4, longest: "rope", rarest: null, awards: [] } };
  const g = text(renderSummaryCard(view({}, { me: ghost })));
  assert.ok(g.includes("You played 6 words: 2 on your turns, 0 silently, and 4 as a ghost"));
  assert.ok(g.includes("Your longest") && !g.includes("Your rarest") && !g.includes("Award"), "nothing to show, nothing shown");
  const two = { id: "p1", summary: { turnWords: 1, silentWords: 0, ghostWords: 0, longest: "a", rarest: "a", awards: ["longestRarest", "mostWords"] } };
  const tt = text(renderSummaryCard(view({}, { me: two })));
  assert.ok(tt.includes("You played 1 word: 1 on your turns, 0 silently"));
  assert.ok(tt.includes("Longest and rarest word 🎉") && tt.includes("Most words 🎉"));
});

test("all end-of-game text is escaped", () => {
  const evil = "<b>x</b>";
  const p = { id: "e1", nickname: evil, avatar: 1 };
  const players = [{ ...PLAYERS[0], id: "e1", nickname: evil }];
  const awards = [
    { kind: "longest", players: [p], word: evil },
    { kind: "rarest", players: [p], word: `${evil}y` },
    { kind: "mostWords", players: [p] },
    { kind: "bestGhost", players: [p] },
  ];
  const v = view({ winners: ["e1"], awards, words: [evil, `${evil}y`] }, { players });
  const me = { id: "e1", nickname: evil, summary: { turnWords: 1, silentWords: 0, ghostWords: 0, longest: evil, rarest: evil, awards: ["mostWords"] } };
  for (const html of [
    renderResults(v, {}),
    renderResults({ ...v, results: { ...v.results, step: "words" } }, {}),
    renderResults({ ...v, results: { ...v.results, step: "words" } }, { maxWords: 1 }),
    renderSummaryCard({ ...v, me }),
  ]) {
    assert.ok(!html.includes("<b>"), html);
    assert.ok(html.includes("&lt;"), html);
  }
});

test("style.css: spark labels are large bold text (spark on the panel is 3:1), the wall's labels use --names", () => {
  const css = readFileSync(new URL("../../public/app/style.css", import.meta.url), "utf8");
  const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  assert.match(rule(".r-lbl"), /font-size: max\(2vh, 19px\)/);
  assert.match(rule(".r-lbl"), /font-weight: 800/);
  assert.match(rule(".yg-k"), /font-size: 19px/);
  assert.match(rule(".r-wlbl"), /color: var\(--names\)/);
  assert.match(rule(".r-word.hl .tile"), /background: var\(--spark\)/);
  assert.match(rule(".r-wall"), /overflow: hidden/);
});

test("an award kind that is an Object property (constructor, toString, __proto__) never renders", () => {
  const odd = ["constructor", "toString", "__proto__", "hasOwnProperty"];
  const awards = [...odd.map((kind) => ({ kind, players: [who("p1")], word: "apple" })), { kind: "mostWords", players: [who("p1")] }];
  assert.deepEqual(cards(renderResults(view({ awards }), {})).map((c) => c.kind), ["mostWords"]);
  const wall = renderResults(view({ awards, words: ["apple"], step: "words" }), {});
  assert.deepEqual(wallOf(wall), [{ award: "", word: "apple" }]);
  const me = { id: "p1", summary: { turnWords: 1, silentWords: 0, ghostWords: 0, longest: "a", rarest: "a", awards: [...odd, "mostWords"] } };
  const t = text(renderSummaryCard(view({}, { me })));
  assert.ok(t.includes("Most words 🎉"));
  assert.ok(!/function|\[object|undefined/.test(t), t);
  assert.equal((t.match(/🎉/g) ?? []).length, 1);
});
