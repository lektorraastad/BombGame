// The end of a game: the award cards, the word wall and each player's private summary.
// Pure: reads the room, never changes it. Privacy: awards and the wall use only words the
// class already saw (room.acceptedWords) and never carry a count; silent and ghost words
// appear only in their owner's summary.
import type { Player, PlayerId, Room } from "./room.ts";

export type AwardKind = "longest" | "rarest" | "longestRarest" | "mostWords" | "comeback" | "bestGhost";
export type AwardPlayer = { id: PlayerId; nickname: string; avatar: number };
/** players is empty and tied is set when more than 8 tie. word is set for longest, rarest and longestRarest. */
export type Award = { kind: AwardKind; players: AwardPlayer[]; word?: string; tied?: number };
export type PlayerSummary = {
  turnWords: number;
  silentWords: number;
  ghostWords: number;
  longest: string | null;
  rarest: string | null;
  awards: AwardKind[];
};

/** Cards shown, and names shown on one card before it says "N students tied". */
const MAX_AWARDS = 4;
const MAX_NAMES = 8;

const who = (p: Player): AwardPlayer => ({ id: p.id, nickname: p.nickname, avatar: p.avatar });

/** The first of the longest words; ties go to the one played first. */
function longestOf(words: string[]): number {
  let best = -1;
  words.forEach((w, i) => { if (best < 0 || w.length > words[best].length) best = i; });
  return best;
}

/** The rarest word that is not a name: rarer, then longer, then played first. -1 when none. */
function rarestOf(words: string[], rarity: (w: string) => number | null): number {
  let best = -1;
  let bestScore = 0;
  words.forEach((w, i) => {
    const r = rarity(w);
    if (r === null) return;
    if (best < 0 || r > bestScore || (r === bestScore && w.length > words[best].length)) {
      best = i;
      bestScore = r;
    }
  });
  return best;
}

/** An award with everyone who earned it. `ids` is internal: it never leaves this module. */
type Earned = { award: Award; ids: PlayerId[] };

const single = (kind: AwardKind, p: Player, word?: string): Earned =>
  ({ award: word === undefined ? { kind, players: [who(p)] } : { kind, players: [who(p)], word }, ids: [p.id] });

/** A card naming every player in `group` (join order), or "N tied" with no names above 8; ids keeps them all. */
function groupAward(kind: AwardKind, group: Player[]): Earned {
  const award: Award = group.length > MAX_NAMES ? { kind, players: [], tied: group.length } : { kind, players: group.map(who) };
  return { award, ids: group.map((p) => p.id) };
}

/** Every award earned, in the spec's order; kicked players' words count for nobody. */
function allAwards(room: Room): Earned[] {
  const players = room.players();
  const byId = new Map(players.map((p) => [p.id, p]));
  const played = room.acceptedWords.filter((w) => byId.has(w.pid));
  const words = played.map((w) => w.word);
  const out: Earned[] = [];

  const li = longestOf(words);
  const ri = rarestOf(words, (w) => room.rarityOf(w));
  if (li >= 0 && ri >= 0 && words[li] === words[ri]) {
    out.push(single("longestRarest", byId.get(played[li].pid)!, words[li]));
  } else {
    if (li >= 0) out.push(single("longest", byId.get(played[li].pid)!, words[li]));
    if (ri >= 0) out.push(single("rarest", byId.get(played[ri].pid)!, words[ri]));
  }

  // Most words: words on a turn plus silent answers. Ghost words have their own card.
  const count = (p: Player) => played.filter((w) => w.pid === p.id).length + room.silentWordsOf(p.id).length;
  const most = Math.max(0, ...players.map(count));
  if (most > 0) out.push(groupAward("mostWords", players.filter((p) => count(p) === most)));

  const back = players.filter((p) => p.comebackUsed);
  if (back.length > 0) out.push(groupAward("comeback", back));

  // Today's ghost ranking: most ghost points first, ties in join order.
  let ghost: Player | undefined;
  for (const p of players) if (p.ghostPoints > 0 && (!ghost || p.ghostPoints > ghost.ghostPoints)) ghost = p;
  if (ghost) out.push(single("bestGhost", ghost));
  return out;
}

/** The award cards shown: at most 4, in order Longest, Rarest (or both in one), Most words, Comeback, Best ghost. */
export function awardsOf(room: Room): Award[] {
  // Simply the first 4 in order: Best ghost shows beside Comeback whenever fewer than 4 cards come before it.
  return allAwards(room).slice(0, MAX_AWARDS).map((e) => e.award);
}

/** The wall: every word the class saw (kicked players' too), each once, alphabetical. */
export function wallWords(room: Room): string[] {
  return [...new Set(room.acceptedWords.map((w) => w.word))].sort((a, b) => a.localeCompare(b, "en"));
}

/** One player's own game, for their laptop only. null for a player who is not in the room. */
export function summaryOf(room: Room, pid: PlayerId): PlayerSummary | null {
  if (!room.players().some((p) => p.id === pid)) return null;
  const turn = room.acceptedWords.filter((w) => w.pid === pid).map((w) => w.word);
  const silent = room.silentWordsOf(pid);
  const ghost = room.ghostWordsOf(pid);
  const all = [...turn, ...silent, ...ghost];
  const li = longestOf(all);
  const ri = rarestOf(all, (w) => room.rarityOf(w));
  return {
    turnWords: turn.length,
    silentWords: silent.length,
    ghostWords: ghost.length,
    longest: li >= 0 ? all[li] : null,
    rarest: ri >= 0 ? all[ri] : null,
    // Every award this player earned: also one in a tie above 8, or one the 4-card limit leaves off the screen.
    awards: allAwards(room).filter((e) => e.ids.includes(pid)).map((e) => e.award.kind),
  };
}
