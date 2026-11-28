// How rare a word is, for the "Rarest word" award. Higher means rarer; names give null.
// Pure: the word lists come in as arguments.

export type Rarity = (word: string) => number | null;

/** Rank given to a known word that has no NGSL frequency rank. */
export const UNRANKED = 100000;
const KNOWN_BASE = 200000;
const DICTIONARY_ONLY = 400000;

/** Possible base words of an inflected form, most likely first. */
function bases(w: string): string[] {
  const out: string[] = [];
  const add = (s: string) => { if (s.length >= 2 && s !== w) out.push(s); };
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("s")) add(w.slice(0, -1));
  if (w.endsWith("ied")) add(w.slice(0, -3) + "y");
  if (w.endsWith("ed")) { const s = w.slice(0, -2); add(s); if (/(.)\1$/.test(s)) add(s.slice(0, -1)); }
  if (w.endsWith("d")) add(w.slice(0, -1));
  if (w.endsWith("ing")) {
    const s = w.slice(0, -3);
    add(s);
    if (/(.)\1$/.test(s)) add(s.slice(0, -1));
    add(s + "e");
  }
  return out;
}

export function createRarity(opts: {
  beginner: Iterable<string>;
  known: Iterable<string>;
  ranks: Map<string, number>;
  names: Iterable<string>;
  dictionary: Iterable<string>;
}): Rarity {
  const beginner = new Set(opts.beginner);
  const known = new Set(opts.known);
  const names = new Set(opts.names);
  const { ranks } = opts;
  const dictionary = new Set(opts.dictionary);
  const score = (w: string): number | null => {
    const rank = ranks.get(w) ?? UNRANKED;
    if (beginner.has(w)) return rank;
    if (known.has(w)) return KNOWN_BASE + rank;
    return null;
  };
  return (word) => {
    if (names.has(word)) return null;
    const own = score(word);
    // A beginner word is its own word (bed is not "be" plus d).
    if (own !== null && beginner.has(word)) return own;
    // Otherwise a form counts as its base when the base is more common (cities -> city).
    let best = own;
    for (const b of bases(word)) {
      const s = score(b);
      if (s !== null) { if (best === null || s < best) best = s; break; }
    }
    return best ?? DICTIONARY_ONLY;
  };
}
