import { makeClock } from "../fakes.ts";
import type { EngineDeps } from "../../src/engine/types.ts";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDeps(seed = 1) {
  const clock = makeClock();
  const rand = mulberry32(seed);
  const deps: EngineDeps = {
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    random: rand,
  };
  return { deps, clock };
}

import { createWordChecker } from "../../src/engine/words.ts";

export const fixtureWords: string[] = [
  "station", "stone", "street", "strong", "story", "stand", "start", "stay", "still", "storm",
  "last", "best", "post", "first", "most", "fast", "west", "just", "rest", "list",
  "ring", "sing", "king", "thing", "morning", "evening", "building", "walking", "playing", "reading",
  "read", "real", "return", "remember", "repeat", "reply", "rescue", "result", "before", "care",
  "there", "where", "here", "more", "store", "were", "pure", "shore", "ahead", "agree",
  "an", "and", "answer", "angry", "animal", "ant", "banana", "plant", "dance", "chance",
  "ouch", "out", "our", "outside", "house", "mouse", "round", "sound", "found", "ground",
  "south", "mouth", "count", "about", "cloud", "loud", "proud", "ounce", "you", "four",
];
export const fixtureBlocked: string[] = ["damn", "faen", "dritt", "ass"];

export function makeTestChecker() {
  return createWordChecker({
    dictionary: [...fixtureWords, ...fixtureBlocked],
    known: fixtureWords,
    everyday: fixtureWords,
    blocked: fixtureBlocked,
  });
}

import type { Prompt } from "../../src/engine/types.ts";

// `common` gives every level: st/ing/ou very easy, re/ast easy, oun/pl medium, ect/gh/ky hard.
export const fixturePrompts: Prompt[] = [
  { text: "st", type: "starts", count: 480, common: 40 },
  { text: "ing", type: "ends", count: 350, common: 30 },
  { text: "ou", type: "contains", count: 260, common: 20 },
  { text: "re", type: "starts", count: 120, common: 12 },
  { text: "ast", type: "ends", count: 90, common: 9 },
  { text: "oun", type: "contains", count: 64, common: 6 },
  { text: "pl", type: "starts", count: 55, common: 5 },
  { text: "ect", type: "ends", count: 38, common: 2 },
  { text: "gh", type: "contains", count: 24, common: 3 },
  { text: "ky", type: "ends", count: 31, common: 1 },
  { text: "zz", type: "contains", count: 19, common: 0 },
];
