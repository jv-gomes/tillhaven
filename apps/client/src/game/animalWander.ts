import { TILE_SIZE, WANDER, noise, seedFrom, type AnimalKind } from '@tillhaven/shared/config';
import type { AnimalPose } from './animalSprites.js';
import type { Direction } from './entities/movement.js';

/**
 * Where an animal is standing right now, and what it is doing (T-15.12).
 *
 * Pure, and testable without a canvas — the same shape as `plots.ts` and
 * `idleReplay.ts`, and for the same reason: this decides what the player sees
 * dozens of times a second, so it should be provable rather than watchable.
 *
 * **Position is a pure function of absolute time.** There is no accumulated
 * state, no RNG object, no per-frame integration. `wanderPose(kind, seed, home,
 * now)` gives the same answer for the same `now` whenever it is asked, which
 * means a 20-second poll, a backgrounded tab, and a scene waking from sleep all
 * land on exactly the same continuous curve. The alternative — stepping a
 * velocity each frame — drifts apart the moment two clients disagree about how
 * many frames have passed, and teleports on the first frame back from a sleep.
 *
 * **Cosmetic, absolutely.** The server has no coordinates for animals and never
 * will (§4.1); `pasture.ts` explains why. Nothing here is sent anywhere — an
 * animal's position exists only in the browser that drew it.
 *
 * **What targeting hit-tests changed in T-16.06 (D-16).** A chicken still
 * answers on its home slot, because it never leaves it. A roaming cow answers
 * on the tile it is actually standing on (`wanderTile`), because it does — the
 * old rule would have meant walking up to a cow you can see and being told
 * about a tile two rows away. That is only safe because the roam is vertical:
 * cows are spaced 2 tiles apart horizontally and never move sideways by a whole
 * tile, so no two can ever answer on the same tile.
 */

export interface WanderPose {
  /** Feet position in world pixels. */
  readonly x: number;
  readonly y: number;
  readonly facing: Direction;
  readonly pose: AnimalPose;
  /** 0..1 through the current leg. For anything that wants to ease. */
  readonly phase: number;
}

export interface HomePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A stable per-animal seed, from the animal's id.
 *
 * **From the id, never from the slot index.** The index is the animal's
 * position in the server's `acquiredAt` ordering *within its kind*, and that can
 * shift — buy a chicken, and every later chicken's index moves. A seed derived
 * from the index would re-seed those animals, and every one of them would
 * visibly jump to a different point in its drift on the next poll. The id never
 * changes.
 *
 * Re-exported rather than defined here since T-33.06: the implementation moved
 * to `config/rng.ts` when the quest board needed the identical hash, because two
 * copies that drifted by one constant would make the client and the server
 * disagree about what a seed means.
 */
export { seedFrom };

/**
 * Where this animal drifts to on leg `n`, as an offset from home.
 *
 * **Horizontal is symmetric; the sub-tile vertical drift only ever goes UP.**
 * An animal's position is its FEET, and a yard slot puts those feet on the
 * bottom edge of its tile — `pastureSlot` returns `(tileY + 1) * TILE_SIZE`
 * precisely so the sprite stands on the tile rather than floating in it. That
 * means the tile boundary is directly under the animal's feet, and a symmetric
 * vertical drift would put it on the next tile down for half of every leg. (It
 * did: the "never leaves its own tile" test caught it on the first run, at
 * chicken #0.)
 *
 * Drifting upward only keeps the feet inside whichever tile the animal is on by
 * construction, which is what lets `wanderTile` name that tile without having
 * to round.
 *
 * The WHOLE-TILE roam added in T-16.04 is a separate, quantised term on top —
 * see `roamOffsetFor`. It is zero for chickens, so for them this comment still
 * describes the entire vertical story.
 */
function offsetFor(kind: AnimalKind, seed: number, n: number): { x: number; y: number } {
  const tuning = WANDER[kind];
  return {
    x: (noise(seed, n * 2) * 2 - 1) * tuning.radiusX,
    y: -noise(seed, n * 2 + 1) * tuning.radiusY + roamOffsetFor(kind, seed, n) * TILE_SIZE,
  };
}

/**
 * How many WHOLE TILES above or below its home tile this animal is on leg `n`
 * (T-16.04). Zero for anything that does not roam.
 *
 * Quantised to whole tiles rather than a continuous range, and that is the
 * point rather than an implementation shortcut: an animal parked half a tile
 * off the grid has no tile, and `bounds()` (T-16.06) has to name one. Legs
 * interpolate between two whole-tile destinations, so a cow is only ever
 * between tiles while it is visibly walking, and comes to rest on one.
 *
 * The range is inclusive of both ends, so a cow with `roamTilesUp: 1` and
 * `roamTilesDown: 1` picks from {-1, 0, +1}.
 */
function roamOffsetFor(kind: AnimalKind, seed: number, n: number): number {
  const { roamTilesUp, roamTilesDown } = WANDER[kind];
  const span = roamTilesUp + roamTilesDown + 1;
  if (span <= 1) return 0;
  // A third noise stream, so changing the roam does not reshuffle the sub-tile
  // drift an animal already had.
  return Math.floor(noise(seed, n * 2 + 0x5eed) * span) - roamTilesUp;
}

/**
 * Which way an animal that moved by (dx, dy) should be looking.
 *
 * Horizontal wins a tie, matching `step`'s rule for the player — and mattering
 * more here, because the chicken sheet has no up or down pose at all (D-10), so
 * a facing that resolved to vertical too eagerly would just mean a chicken that
 * never appears to turn round.
 */
function facingFor(dx: number, dy: number, previous: Direction): Direction {
  const EPSILON = 0.05;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return previous;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/**
 * The chicken's routine (T-16.05, D-15).
 *
 * A chicken cannot walk — its sheet has no walk cycle (T-15.10) — so this is
 * what it gets instead, and it is built from the rows that sheet *does* have
 * and that nothing had ever played: two alternate idles, two depths of peck, a
 * nesting pose and a settling-down. Seven rows measured in T-7.10, three
 * reachable before this.
 *
 * **Weighted, not uniform**, and the weights are the design:
 *
 *   - Pecking dominates (45%). It is the most legible "this is a live bird"
 *     read at 16 pixels, and it is what chickens visibly do.
 *   - The three idles share 35% between them. Splitting one idle into three
 *     look-angles is most of what stops a row of chickens looking stamped from
 *     the same die — they are near-identical, which is exactly why having all
 *     three in rotation works.
 *   - Settling down is rare (10%). A yard where a third of the birds are lying
 *     down at any moment looks asleep, not alive.
 *
 * Cows never reach this: they get `cowRestingPose` below.
 */
function chickenRestingPose(seed: number, leg: number): AnimalPose {
  const roll = noise(seed, leg ^ 0x9e37);
  if (roll < 0.3) return 'peck';
  if (roll < 0.45) return 'peckDeep';
  if (roll < 0.58) return 'idle';
  if (roll < 0.7) return 'idleAlt';
  if (roll < 0.8) return 'idleAlt2';
  if (roll < 0.9) return 'nest';
  return 'lying';
}

/**
 * What a cow does when it stops walking.
 *
 * Only two states, because only two exist on the sheet: standing (a held frame
 * of the walk row — there is no standing row, see `PosePlayback`) and lying.
 * Asking a cow to peck would silently resolve to the walk row and look like
 * standing, so it is not asked.
 */
function cowRestingPose(seed: number, leg: number): AnimalPose {
  return noise(seed, leg ^ 0x9e37) < 0.75 ? 'idle' : 'lying';
}

function restingPose(kind: AnimalKind, seed: number, leg: number): AnimalPose {
  return kind === 'cow' ? cowRestingPose(seed, leg) : chickenRestingPose(seed, leg);
}

/**
 * The animal's position and pose at `now`.
 *
 * A leg is `legMs` long. The first `moveFraction` of it interpolates from the
 * previous leg's destination to this one's; the rest is spent standing there in
 * a pose. Because both endpoints come from `offsetFor`, which depends only on
 * the seed and the leg index, the curve is continuous across a leg boundary
 * without anything having to remember where the animal was.
 */
export function wanderPose(
  kind: AnimalKind,
  seed: number,
  home: HomePoint,
  now: number,
): WanderPose {
  const tuning = WANDER[kind];
  const leg = Math.floor(now / tuning.legMs);
  const phase = (now - leg * tuning.legMs) / tuning.legMs;

  const from = offsetFor(kind, seed, leg - 1);
  const to = offsetFor(kind, seed, leg);

  const moving = phase < tuning.moveFraction;
  // Eased so the animal does not start and stop dead. `t` is clamped at 1 for
  // the resting part of the leg, which is what holds it at its destination.
  const t = moving ? phase / tuning.moveFraction : 1;
  const eased = t * t * (3 - 2 * t);

  const offsetX = from.x + (to.x - from.x) * eased;
  const offsetY = from.y + (to.y - from.y) * eased;

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  return {
    x: home.x + offsetX,
    y: home.y + offsetY,
    // Facing is taken from the LEG's direction, not the frame's: it must not
    // flicker while the animal eases to a stop, and it must stay put while it
    // is standing still.
    facing: facingFor(dx, dy, 'left'),
    pose: moving ? 'walk' : restingPose(kind, seed, leg),
    phase,
  };
}

/**
 * The pose an animal holds when the player has asked for reduced motion
 * (T-15.29).
 *
 * **Its home slot, not wherever the wander happened to leave it.** Freezing an
 * animal at `wanderPose(..., now)` would park it mid-leg, half a tile off the
 * grid, for the rest of the session — and `wanderTile` would then have to name
 * a tile for a body that is visibly between two. The slot is the one position
 * that is always exactly on a tile, so it is the one worth stopping on.
 *
 * `idle` is the pose because it is the only one every sheet resolves to
 * something motionless: a cow has no standing row and `poseRowFor` answers with
 * a HELD frame of the walk row (`play: 'hold'`), and a chicken's idle row is a
 * bird standing still. Asking for `peck` would be a chicken pecking forever,
 * which is the animation this function exists to stop.
 *
 * The caller still has to force `play: 'hold'` — a chicken's idle row is a
 * two-frame loop, motionless only in the sense that the bird does not travel.
 */
export function stillPose(home: HomePoint): WanderPose {
  return { x: home.x, y: home.y, facing: 'left', pose: 'idle', phase: 0 };
}

/**
 * The tile an animal is standing on right now — what targeting answers about
 * (T-16.06).
 *
 * The `y - 1` is `standingTile`'s rule, and for the same reason: feet sit on a
 * tile's BOTTOM edge, so feet at y=304 stand on row 18, not row 19. Getting it
 * wrong puts every animal's target one row below the animal.
 */
export function wanderTile(pose: WanderPose): { readonly tileX: number; readonly tileY: number } {
  return {
    tileX: Math.floor(pose.x / TILE_SIZE),
    tileY: Math.floor((pose.y - 1) / TILE_SIZE),
  };
}
