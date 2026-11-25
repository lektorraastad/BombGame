import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderPlayer, reasonText, renderPicker, wordTiles } from "../../public/app/render-player.js";
import { AVATARS, avatarImg, trophyImg } from "../../public/app/avatars.js";
import { tiles, matchedTiles } from "../../public/app/tiles.js";
import { screenAngle } from "../../public/app/circle-geometry.js";

const CSS = readFileSync(new URL("../../public/app/style.css", import.meta.url), "utf8");

const players = [
  { id: "p1", nickname: "Mia", lives: 3, alive: true, connected: true, spectator: false },
  { id: "p2", nickname: "Jon", lives: 2, alive: true, connected: true, spectator: false },
];
function view(over: Record<string, unknown> = {}, me: Record<string, unknown> = {}): any {
  return {
    code: "ABCD", phase: "playing", paused: false, locked: false, players,
    prompt: { text: "an", type: "contains" },
    mode: { seats: ["p1", "p2"], current: "p1", lastWord: null },
    me: { nickname: "Mia", lives: 3, alive: true, score: 0, isOn: true, bonusLeft: [], canAnswerSilently: false, ...me },
    ...over,
  };
}
const ui = (over: Record<string, unknown> = {}): any => ({ countdownMs: 5000, status: "open", ...over });

test("render escapes nicknames and words", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const lobby = renderPlayer(view({ phase: "lobby", prompt: null, mode: null, players: [{ ...players[0], nickname: evil }] }), ui());
  assert.ok(!lobby.includes("<img src=x"), "no raw tag");
  assert.ok(lobby.includes("&lt;img src=x onerror=alert(1)&gt;"));
  const playing = renderPlayer(
    view(
      {
        players: [{ ...players[0], lastWord: { word: evil, prompt: { text: "an", type: "contains" } } }, { ...players[1], nickname: evil }],
        mode: { seats: ["p1", "p2"], current: "p2", lastWord: null },
        typing: evil,
      },
      { isOn: false },
    ),
    ui(),
  );
  assert.ok(!playing.includes("<img src=x"));
  assert.ok(playing.includes("&lt;"));
  // The last word sits under the player's name on the circle, as tiles; the current player's typing too.
  assert.ok(playing.includes(`<span class="last-word">${matchedTiles(evil, { text: "an", type: "contains" })}</span>`));
  assert.ok(playing.includes(`<span class="typing">${tiles(evil)}<span class="caret"></span></span>`));
  assert.ok(playing.includes("&lt;img src=x onerror=alert(1)&gt;'s turn"));
});

test("lobby lists names and credits-free waiting text", () => {
  const html = renderPlayer(view({ phase: "lobby", prompt: null, mode: null }), ui({ countdownMs: null }));
  assert.ok(html.includes("Waiting for the host"));
  assert.ok(html.includes("Mia") && html.includes("Jon"));
});

test("my turn vs waiting vs ghost vs spectator states", () => {
  const mine = renderPlayer(view(), ui());
  assert.ok(mine.includes('<div class="p-ask">CONTAINS</div>'));
  assert.ok(mine.includes(`<div class="p-prompt">${tiles("AN")}</div>`));
  assert.ok(mine.includes("my-turn"));
  assert.ok(mine.includes("❤❤❤") || mine.includes("♥♥♥"));

  const starts = renderPlayer(view({ prompt: { text: "st", type: "starts" } }), ui());
  assert.ok(starts.includes("STARTS WITH"));
  const ends = renderPlayer(view({ prompt: { text: "ing", type: "ends" } }), ui());
  assert.ok(ends.includes("ENDS WITH"));

  const waiting = renderPlayer(view({ mode: { seats: ["p1", "p2"], current: "p2", lastWord: null } }, { isOn: false }), ui());
  assert.ok(!waiting.includes("my-turn"));
  assert.ok(waiting.includes("Wait for your turn"));
  assert.ok(!waiting.includes("Answer silently"));
  const silent = renderPlayer(view({ mode: { seats: ["p1", "p2"], current: "p2", lastWord: null } }, { isOn: false, canAnswerSilently: true }), ui());
  assert.ok(silent.includes("Answer silently for points"));
  assert.ok(!silent.includes("Wait for your turn"));
  assert.ok(waiting.includes("Jon's turn"));

  const ghost = renderPlayer(
    view({}, { alive: false, lives: 0, isOn: false, activity: { ghostPoints: 7, streak: 2, comebackAvailable: true, comebackStreak: 3 } }),
    ui(),
  );
  assert.ok(ghost.includes("YOU'RE OUT — keep playing as a ghost"));
  assert.ok(ghost.includes("Ghost points: 7"));
  assert.ok(ghost.includes("Comeback: 2 of 3"));
  assert.ok(ghost.includes("Mia's turn"));
  assert.ok(!waiting.includes("YOU'RE OUT"));

  const spectator = renderPlayer(
    view({ players: [{ ...players[0], spectator: true }, players[1]] }, { alive: false, isOn: false }),
    ui(),
  );
  assert.ok(spectator.includes("You'll join the next game"));
  assert.ok(!spectator.includes("YOU'RE OUT"));
});

test("everyone mode, paused, results and connection banner", () => {
  const every = renderPlayer(view({ mode: { round: 1, answered: [] } }, { isOn: false }), ui());
  assert.ok(every.includes("Everyone"));
  const paused = renderPlayer(view({ paused: true, phase: "paused" }), ui());
  assert.ok(paused.includes("Paused"));
  const results = renderPlayer(
    view({
      phase: "results", prompt: null,
      results: { winners: ["p2"], ghostRanking: [{ id: "p3", nickname: "Zed", avatar: 3 }, { id: "p1", nickname: "Amy", avatar: 4 }], longestWord: { nickname: "Jon", avatar: 1, word: "banana" } },
    }),
    ui({ countdownMs: null }),
  );
  assert.ok(results.includes("Game over"));
  assert.ok(results.includes(tiles("Jon")) && results.includes(tiles("banana")));
  assert.ok(results.includes("Best ghosts"));
  assert.ok(results.indexOf("Zed") < results.indexOf("Amy"), "ranking order kept");
  assert.ok(!/Zed[^<]*\d|Amy[^<]*\d/.test(results.slice(results.indexOf("Best ghosts"))), "no points after names");
  const lost = renderPlayer(view(), ui({ status: "reconnecting" }));
  assert.ok(lost.includes("Reconnecting"));
  assert.ok(!renderPlayer(view(), ui()).includes("Reconnecting"));
});

test("last result shows plain English", () => {
  assert.ok(renderPlayer(view(), ui({ lastResult: { ok: true, kind: "turn" } })).includes("✓ +1"));
  const bad = renderPlayer(view(), ui({ lastResult: { ok: false, reason: "not-a-word" } }));
  assert.ok(bad.includes("✗ Not a word in our dictionary"));
  const miss = renderPlayer(view(), ui({ lastResult: { ok: false, reason: "doesnt-match" } }));
  assert.ok(miss.includes("Doesn&#39;t contain AN") || miss.includes("Doesn't contain AN"));
});

test("reasons are in plain English", () => {
  const engine = [
    "not-playing", "paused", "empty", "too-long", "bad-characters", "not-a-word",
    "doesnt-match", "used", "blocked", "not-your-turn",
  ];
  const hub = [
    "bad-message", "no-passcode-set", "wrong-passcode", "too-many-attempts", "server-full", "no-room",
    "not-host", "already-joined", "not-player", "locked", "full", "kicked", "name-length", "name-blocked",
    "not-found", "need-2-players", "no-prompts", "already-running", "unknown-mode", "game-running",
    "avatar-taken", "avatar-locked", "bad-avatar",
  ];
  for (const r of [...engine, ...hub, "something-new"]) {
    const t = reasonText(r);
    assert.ok(t.length > 3, r);
    assert.notEqual(t, r);
    assert.ok(!t.includes("-"), `${r} -> ${t} looks like a code`);
  }
  assert.equal(reasonText("not-a-word"), "Not a word in our dictionary");
  assert.equal(reasonText("used"), "Already used");
  assert.equal(reasonText("not-your-turn"), "Not your turn yet");
  assert.equal(reasonText("doesnt-match", { text: "an", type: "contains" }), "Doesn't contain AN");
  assert.equal(reasonText("doesnt-match", { text: "st", type: "starts" }), "Doesn't start with ST");
  assert.equal(reasonText("doesnt-match", { text: "ing", type: "ends" }), "Doesn't end with ING");
});

const bomb = (over: Record<string, unknown> = {}): any =>
  ({ lit: true, arrow: null, countdownMs: 5000, fuse: null, explosion: null, ...over });

test("the bomb on the player screen is the circle's bomb, drawn from ui.bomb with the arrow", async () => {
  const html = renderPlayer(view(), ui({ bomb: bomb({ explosion: { elapsedMs: 100 }, arrow: { from: 0, to: 90, elapsedMs: 50 } }) }));
  assert.match(html, /data-bomb/);
  assert.match(html, /data-countdown>5</);
  assert.ok(html.includes("bomb-burst"), "the explosion from the motion tracker");
  assert.ok(html.includes("--from:0deg;--to:90deg;"), "the arrow swings to the current player");
  assert.equal(html.match(/data-bomb/g)?.length, 1, "one bomb, in the middle of the circle");
  const waiting = renderPlayer(view({ mode: { seats: ["p1", "p2"], current: "p2", lastWord: null } }, { isOn: false }), ui({ bomb: bomb() }));
  assert.match(waiting, /class="[^"]*\bflame\b/, "a lit bomb");
  // A hidden fuse: the bomb, but no number. No bomb in the lobby.
  const hidden = renderPlayer(view(), ui({ countdownMs: null, bomb: bomb({ countdownMs: null }) }));
  assert.match(hidden, /data-bomb/);
  assert.ok(!hidden.includes("data-countdown"));
  assert.ok(!renderPlayer(view({ phase: "lobby", prompt: null, mode: null }), ui({ countdownMs: null })).includes("data-bomb"));
  // Without ui.bomb, a still lit bomb with the number.
  const plain = renderPlayer(view(), ui());
  assert.match(plain, /data-bomb/);
  assert.match(plain, /data-countdown>5</);
  // Everyone at once: never an arrow, even if the tracker sends one.
  const every = renderPlayer(view({ mode: { round: 1, answered: [] } }, { isOn: false }), ui({ bomb: bomb({ arrow: { from: 0, to: 90, elapsedMs: 700 } }) }));
  assert.ok(!every.includes("bomb-arrow"));
  const mod: Record<string, unknown> = await import("../../public/app/render-player.js");
  assert.equal("BOMB_SVG" in mod, false, "the old bomb drawing is gone");
});

test("the student's arrow follows the circle's real shape from ui.ringAspect", () => {
  const three = [...players, { id: "p3", nickname: "Ola", lives: 3, alive: true, connected: true, spectator: false }];
  const v = view({ players: three, mode: { seats: ["p1", "p2", "p3"], current: "p2", lastWord: null } }, { isOn: false });
  const b = bomb({ arrow: { from: 0, to: 120, elapsedMs: 700 } });
  const html = renderPlayer(v, ui({ bomb: b, ringAspect: 1.96 }));
  assert.ok(html.includes(`--to:${Math.round(screenAngle(120, 1.96) * 10) / 10}deg"`), html.match(/--to:[^"]*/)?.[0]);
  assert.ok(renderPlayer(v, ui({ bomb: b })).includes('--to:120deg"'), "no aspect: as given");
  assert.ok(renderPlayer(v, ui({ bomb: b, ringAspect: Number.NaN })).includes('--to:120deg"'), "junk aspect: as given");
});

// ---- the emoji picker ----

const withAvatars = [
  { ...players[0], avatar: 5 },
  { ...players[1], avatar: 7 },
];
const lobbyView = (over: Record<string, unknown> = {}) =>
  view({ phase: "lobby", prompt: null, mode: null, players: withAvatars, ...over }, { id: "p1", avatar: 5 });

/** The opening tag of the picker button for avatar `i`. */
function pickBtn(html: string, i: number): string {
  const m = html.match(new RegExp(`<button[^>]*data-avatar="${i}"[^>]*>`));
  assert.ok(m, `a button for avatar ${i}`);
  return m[0];
}

test("the picker has 60 buttons: mine pressed, others' taken and disabled, the rest free", () => {
  const html = renderPicker(lobbyView());
  assert.equal(html.match(/<button /g)?.length, 60);
  for (let i = 0; i < 60; i++) {
    const b = pickBtn(html, i);
    assert.ok(b.includes('type="button"'), String(i));
    assert.ok(b.includes(`aria-label="${AVATARS[i].label}"`), String(i));
  }
  const mine = pickBtn(html, 5);
  assert.ok(mine.includes('aria-pressed="true"'));
  assert.ok(!mine.includes("disabled") && !mine.includes("taken"));
  const taken = pickBtn(html, 7);
  assert.ok(/\bdisabled\b/.test(taken) && /class="[^"]*\btaken\b/.test(taken));
  assert.ok(taken.includes('aria-pressed="false"'));
  const free = pickBtn(html, 0);
  assert.ok(!/\bdisabled\b/.test(free) && !/\btaken\b/.test(free));
  assert.ok(free.includes('aria-pressed="false"'));
  assert.equal(html.match(/aria-pressed="true"/g)?.length, 1);
  assert.equal(html.match(/\bdisabled\b/g)?.length, 1);
});

test("the picker escapes the avatar label", () => {
  const saved = AVATARS[0].label;
  AVATARS[0].label = `<b onclick="x">'`;
  try {
    const html = renderPicker(lobbyView());
    assert.ok(!html.includes("<b onclick"));
    assert.ok(html.includes("&lt;b onclick=&quot;x&quot;&gt;&#39;"));
  } finally {
    AVATARS[0].label = saved;
  }
});

test("the picker shows in the lobby under You're in! and on the spectator screen, nowhere else", () => {
  const lobby = renderPlayer(lobbyView(), ui({ countdownMs: null }));
  assert.ok(lobby.includes("data-avatar="));
  assert.ok(lobby.indexOf("You're in!") < lobby.indexOf("data-avatar="));
  const spectating = renderPlayer(
    view({ players: [withAvatars[0], { ...withAvatars[1], spectator: true }] }, { id: "p2", nickname: "Jon", avatar: 7, isOn: false }),
    ui(),
  );
  assert.ok(spectating.includes("You'll join the next game"));
  assert.ok(spectating.includes("data-avatar="));
  assert.ok(pickBtn(spectating, 7).includes('aria-pressed="true"'));
  assert.ok(/\bdisabled\b/.test(pickBtn(spectating, 5)));
  const playing = renderPlayer(view({ players: withAvatars }, { id: "p1", avatar: 5 }), ui());
  assert.ok(!playing.includes("data-avatar="));
  const results = renderPlayer(
    view({ phase: "results", prompt: null, players: withAvatars, results: { winners: [], ghostRanking: [], longestWord: null } }, { id: "p1", avatar: 5 }),
    ui({ countdownMs: null }),
  );
  assert.ok(!results.includes("data-avatar="));
});

test("the lobby list shows each player's emoji, and the picker's answer shows in the result line", () => {
  const lobby = renderPlayer(lobbyView(), ui({ countdownMs: null }));
  const names = lobby.match(/<ul class="names">.*?<\/ul>/s)?.[0] ?? "";
  assert.ok(names.includes(`alt="${AVATARS[5].label}"`) && names.includes(`alt="${AVATARS[7].label}"`));
  const taken = renderPlayer(lobbyView(), ui({ countdownMs: null, lastResult: { ok: false, reason: "avatar-taken" } }));
  assert.ok(taken.includes("✗ Taken, pick another"));
  const done = renderPlayer(lobbyView(), ui({ countdownMs: null, lastResult: { ok: true, kind: "avatar" } }));
  assert.ok(!done.includes("+1"), "picking an emoji scores nothing");
  assert.equal(reasonText("avatar-taken"), "Taken, pick another");
  assert.equal(reasonText("avatar-locked"), "You can change your emoji in the lobby");
  assert.equal(reasonText("bad-avatar"), "Something went wrong. Try again");
});

// ---- the student screens: the circle, the tile text box, the corner, the results ----

const withIds = [
  { ...players[0], avatar: 5 },
  { ...players[1], avatar: 7 },
];
const onTurn = () => view({ players: withIds }, { id: "p1", avatar: 5, score: 4 });
const waitingView = (over: Record<string, unknown> = {}, me: Record<string, unknown> = {}) =>
  view({ players: withIds, mode: { seats: ["p1", "p2"], current: "p2", lastWord: null }, ...over }, { id: "p1", avatar: 5, isOn: false, ...me });
const ghostView = () =>
  view(
    { players: [{ ...withIds[0], alive: false, lives: 0 }, withIds[1]], mode: { seats: ["p1", "p2"], current: "p2", lastWord: null } },
    { id: "p1", avatar: 5, alive: false, lives: 0, isOn: false, activity: { ghostPoints: 2, streak: 0, comebackAvailable: false, comebackStreak: 3 } },
  );
const everyoneView = () => view({ players: withIds, mode: { round: 2, answered: [] } }, { id: "p1", avatar: 5, isOn: false });

/** The <main> element's opening tag. */
const mainTag = (html: string) => html.match(/<main class="[^"]*"[^>]*>/)?.[0] ?? "";

test("every playing screen has the compact circle, with the prompt on its bomb", () => {
  const screens: [string, string][] = [
    ["turn-on", renderPlayer(onTurn(), ui())],
    ["waiting", renderPlayer(waitingView(), ui())],
    ["waiting", renderPlayer(everyoneView(), ui())],
    ["ghost", renderPlayer(ghostView(), ui())],
  ];
  for (const [cls, html] of screens) {
    assert.match(mainTag(html), new RegExp(`class="${cls}\\b`), cls);
    assert.equal(html.match(/<div class="circle compact">/g)?.length, 1, cls);
    const face = html.slice(html.indexOf('<div class="bomb-face">'));
    assert.ok(face.indexOf('<div class="p-ask">CONTAINS</div>') >= 0 && face.indexOf(tiles("AN")) >= 0, `${cls}: the prompt on the bomb`);
    // Everyone is seated, with their emoji.
    assert.ok(html.includes(avatarImg(5)) && html.includes(avatarImg(7)), cls);
  }
  // The lobby, the results and the watching screens have no circle.
  assert.ok(!renderPlayer(view({ phase: "lobby", prompt: null, mode: null }), ui({ countdownMs: null })).includes('class="circle'));
  const out = renderPlayer(view({}, { alive: false, lives: 0, isOn: false }), ui());
  assert.match(mainTag(out), /class="watching"/);
  assert.ok(!out.includes('class="circle'));
});

test("the circle comes first, then the status line, the text box, the result line and the letters", () => {
  const html = renderPlayer(view({ players: withIds }, { id: "p1", bonusLeft: ["x", "z"] }), ui({ lastResult: { ok: false, reason: "used" } }));
  const at = (s: string) => {
    const i = html.indexOf(s);
    assert.ok(i >= 0, s);
    return i;
  };
  const order = [at('<div class="circle compact">'), at("Your turn!"), at('id="word-tiles"'), at('id="word"'), at("✗ Already used"), at("Letters left: X Z")];
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(!html.includes("Type a word that"), "the prompt type is on the bomb now");
});

test("the status lines keep their wording", () => {
  assert.match(renderPlayer(onTurn(), ui()), /<div class="yourturn">Your turn!<\/div>/);
  const waiting = renderPlayer(waitingView(), ui());
  assert.match(waiting, /<div class="yourturn">Jon&#39;s turn<\/div>|<div class="yourturn">Jon's turn<\/div>/);
  assert.ok(waiting.includes("Wait for your turn"));
  assert.ok(renderPlayer(waitingView({}, { canAnswerSilently: true }), ui()).includes("Answer silently for points"));
  assert.match(renderPlayer(everyoneView(), ui()), /<div class="yourturn">Everyone answers<\/div>/);
  const ghost = renderPlayer(ghostView(), ui());
  assert.ok(ghost.includes("<h1>YOU'RE OUT — keep playing as a ghost</h1>"));
  assert.ok(ghost.includes("Jon's turn"));
  assert.ok(ghost.includes('<div class="ghostscore">Ghost points: 2'));
  assert.ok(ghost.includes("Comeback: not available"));
});

test("the waiting screen shows the current player's typing on their seat", () => {
  const html = renderPlayer(waitingView({ typing: "ban" }), ui());
  const seat = html.match(/<div class="seat on[^"]*"[^>]*>.*?<\/div>(?=<div class="(?:seat|circle-centre))/s)?.[0] ?? "";
  assert.ok(seat.includes(">Jon<"), "Jon's seat is the current one");
  assert.ok(seat.includes(`<span class="typing">${tiles("ban")}<span class="caret"></span></span>`));
});

test("own hearts and score sit in the corner; nobody else's score is shown", () => {
  const html = renderPlayer(onTurn(), ui());
  const corner = html.match(/<div class="corner">.*?<\/div><\/div>/s)?.[0] ?? "";
  assert.ok(corner.includes('<div class="lives" aria-label="3 lives">❤❤❤</div>'), corner);
  assert.ok(corner.includes('<div class="score">Score: 4</div>'), corner);
  assert.equal(html.match(/Score:/g)?.length, 1);
  // The corner comes before the circle, so it sits at the top.
  assert.ok(html.indexOf('<div class="corner">') < html.indexOf('<div class="circle compact">'));
  const waiting = renderPlayer(waitingView({}, { lives: 2, score: 9 }), ui());
  assert.ok(waiting.includes('<div class="lives" aria-label="2 lives">❤❤</div>') && waiting.includes("Score: 9"));
  // A ghost has no hearts left: the corner keeps the score only.
  const ghost = renderPlayer(ghostView(), ui());
  assert.ok(ghost.includes('<div class="corner"><div class="score">Score: 0</div></div>'));
});

test("the text box is still the same input, with a tile mirror behind it", () => {
  for (const [html, mine] of [[renderPlayer(onTurn(), ui()), true], [renderPlayer(waitingView(), ui()), false], [renderPlayer(ghostView(), ui()), false]] as const) {
    const box = html.match(/<div class="wordbox">.*?<\/div><input[^>]*><\/div>/s)?.[0] ?? "";
    assert.ok(box.startsWith('<div class="wordbox"><div id="word-tiles" class="word-tiles" aria-hidden="true"></div><input id="word"'), box);
    const input = html.match(/<input id="word"[^>]*>/)?.[0] ?? "";
    for (const attr of ['type="text"', 'autocomplete="off"', 'autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"', 'maxlength="40"', 'placeholder="type a word..."', 'aria-label="Your word"']) {
      assert.ok(input.includes(attr), attr);
    }
    assert.equal(/class="word my-turn"/.test(input), mine);
  }
});

test("wordTiles: the typed letters as tiles with the caret where the cursor is, escaped and whole", () => {
  assert.equal(wordTiles("", 0), '<span class="caret"></span>');
  assert.equal(wordTiles("sing", 4), `${tiles("sing")}<span class="caret"></span>`);
  assert.equal(wordTiles("sing", 2), `${tiles("si")}<span class="caret"></span>${tiles("ng")}`);
  // Junk caret positions: at the end.
  for (const bad of [-1, 99, Number.NaN, 1.5]) assert.equal(wordTiles("ab", bad), `${tiles("ab")}<span class="caret"></span>`, String(bad));
  const evil = wordTiles("<b>&", 3);
  assert.ok(!evil.includes("<b>") && evil.includes("&lt;") && evil.includes("&amp;"));
  // The caret index is in UTF-16 units (as an input's selectionStart); a letter is never split.
  const emoji = wordTiles("a😀b", 3);
  assert.equal(emoji, `${tiles("a😀")}<span class="caret"></span>${tiles("b")}`);
  assert.equal(wordTiles("a😀b", 2), `${tiles("a😀")}<span class="caret"></span>${tiles("b")}`, "inside a pair: after it");
  assert.equal(wordTiles("æøå", 1), `${tiles("æ")}<span class="caret"></span>${tiles("øå")}`);
});

test("results on a student screen: the projector's podium, longest word and ghosts, plus my score", () => {
  const r = { winners: ["p2"], ghostRanking: [{ id: "p3", nickname: "<b>Zed</b>", avatar: 3 }, { id: "p1", nickname: "Mia", avatar: 5 }], longestWord: { nickname: "Jon", avatar: 7, word: "banana" } };
  const html = renderPlayer(view({ phase: "results", prompt: null, players: withIds, results: r }, { id: "p1", score: 6 }), ui({ countdownMs: null }));
  assert.match(mainTag(html), /class="results"/);
  assert.ok(html.includes(trophyImg()));
  assert.ok(html.includes(`<div class="p-winner">${avatarImg(7, "big")}${tiles("Jon")}</div>`));
  assert.ok(html.includes(`Longest word: ${tiles("banana")} <span class="by">(Jon)</span>`));
  assert.ok(html.includes("<h2>Best ghosts</h2>"));
  assert.ok(html.includes(`<li><span class="rank">1.</span>${avatarImg(3)}<span class="who">&lt;b&gt;Zed&lt;/b&gt;</span></li>`));
  assert.ok(html.includes(`<li><span class="rank">2.</span>${avatarImg(5)}<span class="who">Mia</span></li>`));
  assert.ok(!/point/i.test(html), "no points in the ranking");
  assert.ok(html.includes("Your score: 6"));
  assert.ok(!html.includes("You won"));
  assert.ok(html.includes("Waiting for the host to play again"));
  assert.ok(!html.includes("data-bomb") && !html.includes('class="circle'));
  const won = renderPlayer(view({ phase: "results", prompt: null, players: withIds, results: r }, { id: "p2", nickname: "Jon" }), ui({ countdownMs: null }));
  assert.ok(won.includes("You won!"));
  const none = renderPlayer(view({ phase: "results", prompt: null, players: withIds, results: { winners: [], ghostRanking: [], longestWord: null } }, { id: "p1" }), ui({ countdownMs: null }));
  assert.ok(none.includes("No winner this time") && !none.includes("Best ghosts"));
});

test("style.css: the student circle is an oval filling the space, sized by its height; the text box text is see-through over its tiles", () => {
  const rule = (sel: string) => CSS.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  assert.match(rule(".arena"), /container-type:\s*size/);
  // As wide as the space allows (up to about 2:1) and as tall, but never taller than wide: the page
  // measures its shape (ui.ringAspect) so the arrow still points at the seat, as on the projector.
  const circle = rule(".arena .circle");
  assert.match(circle, /aspect-ratio:\s*auto/);
  assert.match(circle, /width:\s*min\(100cqw, 210cqh\)/);
  assert.match(circle, /height:\s*min\(100cqh, 100cqw\)/);
  assert.match(circle, /container-type:\s*size/);
  assert.doesNotMatch(circle, /--circle-size/);
  // Inside it, sizes are shares of its height (cqh), so wider never means bigger than it can hold.
  const sizes = [...CSS.matchAll(/\n(\.arena [^{]*|\.circle\.compact[^{]*)\{([^}]*)\}/g)].filter((m) => /--(seat|bomb)-size/.test(m[2]));
  assert.ok(sizes.length >= 3, "student seat and bomb sizes");
  for (const [, sel, body] of sizes) assert.doesNotMatch(body, /--(seat|bomb)-size:[^;]*cqw/, sel);
  assert.match(rule("#word"), /color:\s*transparent/);
  assert.match(rule("#word"), /caret-color:\s*transparent/);
  assert.match(rule(".word-tiles"), /pointer-events:\s*none/);
});

test("style.css: on the student circle a last word or live typing is one row of tiles, never split mid-word", () => {
  const rule = (sel: string) => {
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const m = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((x) => x[1].split(",").map((s) => s.trim()).includes(sel));
    return m.map((x) => x[2]).join(";");
  };
  assert.match(rule(".circle.compact .seat"), /max-width:\s*none/);
  assert.match(rule(".circle.compact .seat .last-word"), /max-width:\s*none/);
  assert.match(rule(".circle.compact .seat .last-word .tiles"), /flex-wrap:\s*nowrap/);
  assert.match(rule(".circle.compact .seat .last-word .tiles"), /max-width:\s*none/);
  // More than 20 seats (two rings) on a laptop: last words are left to the projector, so the seats
  // don't run into each other. Live typing still shows.
  assert.match(rule(".circle.compact .seat.small .last-word"), /display:\s*none/);
  assert.doesNotMatch(CSS, /\.circle\.compact \.seat\.small \.typing[^{]*\{[^}]*display:\s*none/);
  // Live typing, on every circle: the current player's word never splits either.
  assert.match(rule(".circle .seat .typing"), /flex-wrap:\s*nowrap/);
  assert.doesNotMatch(rule(".circle .seat .typing"), /flex-wrap:\s*wrap/);
  assert.match(rule(".circle .seat .typing .tiles"), /flex-wrap:\s*nowrap/);
  assert.match(rule(".circle .seat .typing .tiles"), /max-width:\s*none/);
});
