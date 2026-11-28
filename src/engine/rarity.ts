// How rare a word is, for the "Rarest word" award. Higher means rarer; names give null.
// Pure: the word lists come in as arguments.
//
// Beginner and known words are ordered by (group, level, length, rank), packed into one number:
//   group * 1e7 + level * 1e6 + min(length, 99) * 1e4 + min(rank, 9999)
// - group: 1 beginner, 2 known (words only in the big dictionary are DICTIONARY_ONLY, above both);
// - level: the word's CEFR-J level (A1 = 1 ... B2 = 4), or else one estimated from its NGSL rank,
//   or else A2;
// - length: a longer word is rarer;
// - rank: the NGSL frequency rank, with an unranked word counted as UNRANKED_WITHIN.

export type Rarity = (word: string) => number | null;

/** Rank written in ranks.txt for a known word that has no NGSL frequency rank. */
export const UNRANKED = 100000;
/** Where an unranked word sits among ranked ones in the same group, level and length. */
const UNRANKED_WITHIN = 3000;
/** Words only in the big dictionary: rarer than every beginner and known word. */
export const DICTIONARY_ONLY = 3e7;
/** Level used when a word has neither a CEFR-J level nor an NGSL rank (ordinals, known-extra.txt). */
const DEFAULT_LEVEL = 2;

/** A level estimated from an NGSL rank, matching where CEFR-J's levels mostly fall. */
function levelFromRank(rank: number): number {
  return rank <= 600 ? 1 : rank <= 1150 ? 2 : rank <= 1700 ? 3 : 4;
}

/** Possible base words of an inflected form. */
function bases(w: string): string[] {
  const out: string[] = [];
  const add = (s: string) => { if (s.length >= 3 && s !== w) out.push(s); };
  const doubled = (s: string) => /([^aeiou])\1$/.test(s); // stopp -> stop, not agree -> agre
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("s")) add(w.slice(0, -1));
  if (w.endsWith("ied")) add(w.slice(0, -3) + "y");
  if (w.endsWith("ed")) {
    const s = w.slice(0, -2);
    if (!s.endsWith("e")) { add(s); if (doubled(s)) add(s.slice(0, -1)); } // heed is not he + ed
    add(w.slice(0, -1)); // hoped -> hope (a bare -d only after -ed: herd is not her + d)
  }
  if (w.endsWith("ing")) {
    const s = w.slice(0, -3);
    add(s);
    if (doubled(s)) add(s.slice(0, -1));
    add(s + "e");
  }
  return out;
}

export function createRarity(opts: {
  beginner: Iterable<string>;
  known: Iterable<string>;
  /** Word -> NGSL rank (UNRANKED or missing when it has none). */
  ranks: Map<string, number>;
  /** Word -> its own CEFR-J level, A1 = 1 ... B2 = 4. */
  levels?: Map<string, number>;
  /** NGSL family form -> its headword, for a form that is neither a CEFR-J nor an NGSL headword. */
  heads?: Map<string, string>;
  names: Iterable<string>;
  dictionary: Iterable<string>;
}): Rarity {
  const beginner = new Set(opts.beginner);
  const known = new Set(opts.known);
  const names = new Set(opts.names);
  const { ranks } = opts;
  const levels = opts.levels ?? new Map<string, number>();
  const heads = opts.heads ?? new Map<string, string>();
  // The opts.dictionary list is kept in the signature: every accepted word that isn't
  // beginner or known is dictionary-only.

  /** The packed key of a beginner or known word on its own terms, or null. */
  const own = (w: string): number | null => {
    const group = beginner.has(w) ? 1 : known.has(w) ? 2 : 0;
    if (!group) return null;
    const r = ranks.get(w);
    const ranked = r !== undefined && r > 0 && r < UNRANKED;
    const level = levels.get(w) ?? (ranked ? levelFromRank(r) : DEFAULT_LEVEL);
    const within = ranked ? r : UNRANKED_WITHIN;
    return group * 1e7 + Math.min(level, 9) * 1e6 + Math.min(w.length, 99) * 1e4 + Math.min(within, 9999);
  };
  /** A word's key, with an NGSL family form counted as its headword. */
  const score = (w: string): number | null => {
    const head = heads.get(w);
    return (head !== undefined ? own(head) : null) ?? own(w);
  };
  /** Words that stand for themselves: a CEFR-J headword, or a word with an NGSL family rank. */
  const isOwnWord = (w: string): boolean => {
    const r = ranks.get(w);
    return levels.has(w) || heads.has(w) || (r !== undefined && r > 0 && r < UNRANKED);
  };

  return (word) => {
    if (names.has(word)) return null;
    const self = score(word);
    if (self !== null && isOwnWord(word)) return self;
    // Other words count as their most common valid base (cities -> city, hoping -> hope).
    let best = self;
    for (const b of bases(word)) {
      if (names.has(b)) continue;
      const s = score(b);
      if (s !== null && (best === null || s < best)) best = s;
    }
    return best ?? DICTIONARY_ONLY;
  };
}
