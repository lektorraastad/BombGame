// Where each player sits around the bomb, and which way the arrow points. Pure maths: no DOM.
// Seats start straight up and go clockwise. Up to 20 players sit on one ring; above that, every
// other seat moves to an inner ring so 32 players still fit.

/** More players than this on the circle: two rings. */
export const ONE_RING_MAX = 20;

/** Radius of each ring as a percentage of the circle box: [horizontal, vertical]. */
const RINGS = [
  [42, 40],
  [30, 28],
];

/**
 * @param {number} i the seat's index, from 0
 * @param {number} n how many seats there are
 * @returns {{ left: number, top: number, angle: number, ring: 0 | 1 }} left and top in % of the
 *   circle box; angle in degrees, 0 = straight up, clockwise
 */
export function seatPosition(i, n) {
  const angle = (360 * i) / Math.max(1, n);
  /** @type {0 | 1} */
  const ring = n > ONE_RING_MAX && i % 2 === 1 ? 1 : 0;
  const [rx, ry] = RINGS[ring];
  const rad = (angle * Math.PI) / 180;
  return { left: 50 + rx * Math.sin(rad), top: 50 - ry * Math.cos(rad), angle, ring };
}

/**
 * The players on the circle, in seat order: Classic's seats, otherwise everyone but spectators.
 * @param {any} view a projector or player view
 * @returns {any[]}
 */
export function seatedPlayers(view) {
  const players = Array.isArray(view?.players) ? view.players : [];
  const seats = view?.mode?.seats;
  if (Array.isArray(seats)) {
    return seats.map((/** @type {unknown} */ id) => players.find((/** @type {any} */ p) => p.id === id)).filter(Boolean);
  }
  return players.filter((/** @type {any} */ p) => !p.spectator);
}

/**
 * The angle of the current player's seat, or null when nobody is on (lobby, Everyone at once).
 * @param {any} view
 * @returns {number | null}
 */
export function arrowAngle(view) {
  const current = view?.mode?.current;
  if (typeof current !== "string") return null;
  const seated = seatedPlayers(view);
  const i = seated.findIndex((p) => p.id === current);
  return i < 0 ? null : seatPosition(i, seated.length).angle;
}

/**
 * Where a seat really is on screen, as an arrow angle (0 = straight up, clockwise), when the
 * circle's box is `aspect` times wider than tall: on a wide oval a seat at 45° round the ring sits
 * further out sideways, about 62° on a 16:9 box. Up, right, down and left don't move. The answer
 * stays within half a turn of `angle`, so angles past a full turn (a swing the short way round)
 * keep their turn. A junk aspect counts as a square box.
 * @param {number} angle the seat's angle round the ring, in degrees
 * @param {number} [aspect] the box's width / height
 * @param {0 | 1} [ring]
 * @returns {number} degrees
 */
export function screenAngle(angle, aspect = 1, ring = 0) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const [rx, ry] = RINGS[ring === 1 ? 1 : 0];
  const rad = (angle * Math.PI) / 180;
  const seen = (Math.atan2(rx * a * Math.sin(rad), ry * Math.cos(rad)) * 180) / Math.PI;
  const d = (((seen - angle) % 360) + 540) % 360 - 180; // -180 to 180
  return angle + d;
}
