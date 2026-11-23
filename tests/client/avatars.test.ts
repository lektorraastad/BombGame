import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { AVATARS, AVATAR_COUNT, avatarImg, EMOJI_CREDIT } from "../../public/app/avatars.js";

test("exactly 60 avatars, unique files and labels, all files present", () => {
  assert.equal(AVATAR_COUNT, 60);
  assert.equal(AVATARS.length, 60);
  assert.equal(new Set(AVATARS.map((a) => a.file)).size, 60);
  assert.equal(new Set(AVATARS.map((a) => a.label)).size, 60);
  for (const a of AVATARS) {
    assert.ok(a.label.length > 0);
    assert.ok(existsSync(new URL(`../../public/avatars/${a.file}`, import.meta.url)), a.file);
  }
  assert.ok(existsSync(new URL("../../public/avatars/LICENSE.txt", import.meta.url)));
});

test("no skin tones, flags or banned emoji", () => {
  for (const a of AVATARS) {
    assert.match(a.file, /^[0-9a-f]+(-[0-9a-f]+)*\.svg$/);
    assert.ok(!a.file.includes("-1f3f"), a.file);
    const cps = a.file.replace(".svg", "").split("-");
    assert.ok(!cps.some((c) => c >= "1f1e6" && c <= "1f1ff"), `flag ${a.file}`);
    for (const bad of ["1f346", "1f351", "1f4a9", "1f595"]) assert.ok(!cps.includes(bad), a.file);
  }
});

test("avatarImg", () => {
  const html = avatarImg(0, "big");
  assert.match(html, /^<img class="avatar big" src="\/avatars\/[^"]+\.svg" alt="[^"<>"]+" width="64" height="64">$/);
  assert.ok(avatarImg(0).includes('class="avatar"'));
  for (const bad of [60, -1, 1.5, NaN, "3" as unknown as number]) {
    const h = avatarImg(bad);
    assert.ok(!h.includes("<img"), String(bad));
    assert.equal(h, '<span class="avatar"></span>');
  }
  assert.equal(EMOJI_CREDIT, "Emoji: Twemoji (CC BY 4.0)");
});
