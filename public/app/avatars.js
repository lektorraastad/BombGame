import { esc } from "./escape.js";

// The 60 emoji avatars. Twemoji graphics (CC BY 4.0), stored in /avatars/ (see LICENSE.txt there).
// The index (0-59) is what the server stores for each player. Never reorder: add only at the end.
export const AVATAR_COUNT = 60;
export const EMOJI_CREDIT = "Emoji: Twemoji (CC BY 4.0)";

/** @type {{ file: string, label: string }[]} */
export const AVATARS = [
  { file: "1f98a.svg", label: "Fox" },
  { file: "1f419.svg", label: "Octopus" },
  { file: "1f438.svg", label: "Frog" },
  { file: "1f427.svg", label: "Penguin" },
  { file: "1f981.svg", label: "Lion" },
  { file: "1f42f.svg", label: "Tiger" },
  { file: "1f43c.svg", label: "Panda" },
  { file: "1f428.svg", label: "Koala" },
  { file: "1f435.svg", label: "Monkey" },
  { file: "1f989.svg", label: "Owl" },
  { file: "1f422.svg", label: "Turtle" },
  { file: "1f42c.svg", label: "Dolphin" },
  { file: "1f433.svg", label: "Whale" },
  { file: "1f988.svg", label: "Shark" },
  { file: "1f98b.svg", label: "Butterfly" },
  { file: "1f41d.svg", label: "Bee" },
  { file: "1f41e.svg", label: "Ladybug" },
  { file: "1f40c.svg", label: "Snail" },
  { file: "1f996.svg", label: "Dinosaur" },
  { file: "1f984.svg", label: "Unicorn" },
  { file: "1f993.svg", label: "Zebra" },
  { file: "1f992.svg", label: "Giraffe" },
  { file: "1f418.svg", label: "Elephant" },
  { file: "1f99c.svg", label: "Parrot" },
  { file: "1f9a9.svg", label: "Flamingo" },
  { file: "1f43b.svg", label: "Bear" },
  { file: "1f430.svg", label: "Rabbit" },
  { file: "1f437.svg", label: "Pig" },
  { file: "1f42e.svg", label: "Cow" },
  { file: "1f414.svg", label: "Chicken" },
  { file: "1f40a.svg", label: "Crocodile" },
  { file: "1f994.svg", label: "Hedgehog" },
  { file: "1f9a5.svg", label: "Sloth" },
  { file: "1f980.svg", label: "Crab" },
  { file: "1f420.svg", label: "Fish" },
  { file: "1f34e.svg", label: "Apple" },
  { file: "1f34c.svg", label: "Banana" },
  { file: "1f349.svg", label: "Watermelon" },
  { file: "1f347.svg", label: "Grapes" },
  { file: "1f353.svg", label: "Strawberry" },
  { file: "1f34d.svg", label: "Pineapple" },
  { file: "1f95d.svg", label: "Kiwi" },
  { file: "1f352.svg", label: "Cherries" },
  { file: "1f355.svg", label: "Pizza" },
  { file: "1f354.svg", label: "Burger" },
  { file: "1f36a.svg", label: "Cookie" },
  { file: "1f369.svg", label: "Donut" },
  { file: "1f366.svg", label: "Ice cream" },
  { file: "1f33d.svg", label: "Corn" },
  { file: "26bd.svg", label: "Football" },
  { file: "1f680.svg", label: "Rocket" },
  { file: "1f3b8.svg", label: "Guitar" },
  { file: "1f335.svg", label: "Cactus" },
  { file: "1f33b.svg", label: "Sunflower" },
  { file: "2b50.svg", label: "Star" },
  { file: "1f3b2.svg", label: "Dice" },
  { file: "1f6b2.svg", label: "Bicycle" },
  { file: "1f4a1.svg", label: "Light bulb" },
  { file: "1f3c0.svg", label: "Basketball" },
  { file: "1f9e9.svg", label: "Puzzle" },
];

/**
 * The picture for avatar number `index`. A bad index gives an empty placeholder, never an <img>.
 * @param {number} index
 * @param {string} [cls] extra class name(s)
 */
export function avatarImg(index, cls = "") {
  const a = Number.isInteger(index) ? AVATARS[index] : undefined;
  const c = cls ? `avatar ${esc(cls)}` : "avatar";
  if (!a) return `<span class="${c}"></span>`;
  return `<img class="${c}" src="/avatars/${esc(a.file)}" alt="${esc(a.label)}" width="64" height="64">`;
}

/** The trophy on the results screen. A Twemoji graphic too, kept with the avatars but never one of them. */
export function trophyImg() {
  return `<img class="trophy" src="/avatars/1f3c6.svg" alt="Trophy" width="64" height="64">`;
}
