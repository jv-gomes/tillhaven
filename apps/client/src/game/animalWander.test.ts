import { describe, expect, it } from 'vitest';
import {
  ANIMAL_KINDS,
  TILE_SIZE,
  WANDER,
  ANIMALS,
  maxHerd,
  pastureSlot,
  yardFor,
  type AnimalKind,
} from '@tillhaven/shared/config';
import { seedFrom, stillPose, wanderPose, wanderTile } from './animalWander.js';

/**
 * T-15.12. The wander is cosmetic, and these tests are what keep it that way:
 * an animal that left its tile would be one you could not reliably feed, and a
 * wander that depended on frame history would teleport every time a poll landed
 * or a tab woke up.
 */

const KINDS: AnimalKind[] = [...ANIMAL_KINDS];

/** Tier 0 throughout: the wander is the same routine whatever the building. */
function slotFor(kind: AnimalKind, index: number) {
  return pastureSlot(kind, index, 0);
}

describe('seedFrom', () => {
  it('is stable for the same id', () => {
    expect(seedFrom('abc-123')).toBe(seedFrom('abc-123'));
  });

  it('separates ids that differ by one character', () => {
    // Two animals bought seconds apart get near-identical uuids; if their seeds
    // were near-identical too they would drift in lockstep, which reads as a
    // rendering bug rather than as livestock.
    const a = seedFrom('9f1c0e2a-0000-4000-8000-000000000001');
    const b = seedFrom('9f1c0e2a-0000-4000-8000-000000000002');
    expect(a).not.toBe(b);
    expect(Math.abs(a - b)).toBeGreaterThan(1000);
  });

  it('is a non-negative 32-bit integer', () => {
    expect(Number.isInteger(seedFrom('x'))).toBe(true);
    expect(seedFrom('x')).toBeGreaterThanOrEqual(0);
  });
});

describe('wanderPose', () => {
  const home = { x: 100, y: 100 };

  it('is a pure function of its arguments', () => {
    for (const kind of KINDS) {
      const a = wanderPose(kind, 1234, home, 987_654);
      const b = wanderPose(kind, 1234, home, 987_654);
      expect(a).toEqual(b);
    }
  });

  /*
   * The property that makes a 20-second poll, a slept tab and a scene wake all
   * safe: nothing is accumulated, so asking about a distant instant gives the
   * same answer as walking there frame by frame would have.
   */
  it('does not depend on being asked about every instant in between', () => {
    for (const kind of KINDS) {
      const direct = wanderPose(kind, 77, home, 60_000);
      for (let t = 0; t < 60_000; t += 137) wanderPose(kind, 77, home, t);
      expect(wanderPose(kind, 77, home, 60_000)).toEqual(direct);
    }
  });

  it('is continuous across a leg boundary', () => {
    // A jump here is a visible teleport every few seconds, for every animal.
    for (const kind of KINDS) {
      const { legMs } = WANDER[kind];
      for (const leg of [1, 2, 7, 25]) {
        const before = wanderPose(kind, 4242, home, leg * legMs - 1);
        const after = wanderPose(kind, 4242, home, leg * legMs);
        expect(Math.abs(after.x - before.x), `${kind} leg ${leg} x`).toBeLessThan(1);
        expect(Math.abs(after.y - before.y), `${kind} leg ${leg} y`).toBeLessThan(1);
      }
    }
  });

  it('actually moves — it is a wander, not a very slow nothing', () => {
    for (const kind of KINDS) {
      const { legMs } = WANDER[kind];
      const samples = [];
      for (let leg = 0; leg < 20; leg++) samples.push(wanderPose(kind, 999, home, leg * legMs));
      const xs = new Set(samples.map((s) => Math.round(s.x)));
      expect(xs.size, `${kind} never moved horizontally`).toBeGreaterThan(3);
    }
  });

  it('uses more than one pose, and walks only while moving', () => {
    for (const kind of KINDS) {
      const { legMs, moveFraction } = WANDER[kind];
      const poses = new Set<string>();
      for (let leg = 0; leg < 60; leg++) {
        poses.add(wanderPose(kind, 31337, home, leg * legMs + legMs * 0.9).pose);
        // Mid-move must always be 'walk'.
        expect(wanderPose(kind, 31337, home, leg * legMs + legMs * moveFraction * 0.5).pose).toBe(
          'walk',
        );
      }
      expect(poses.has('walk'), `${kind} rests in a walking pose`).toBe(false);
      expect(poses.size, `${kind} only ever holds one pose`).toBeGreaterThan(1);
    }
  });

  it('reports a phase inside 0..1', () => {
    for (const kind of KINDS) {
      for (const t of [0, 1, 5_000, 123_456]) {
        const { phase } = wanderPose(kind, 5, home, t);
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThan(1);
      }
    }
  });
});

/*
 * The load-bearing test of this whole feature.
 *
 * `Animal.bounds()` hit-tests the tile the animal is drawn on, so targeting
 * works only while that tile is one the player can predict and stand beside.
 * Two properties keep it honest, and both are asserted below rather than
 * reasoned about: an animal stays in the band its kind declares, and it never
 * changes COLUMN. The second is what stops two cows answering on one tile once
 * their boxes follow them (T-16.06).
 *
 * Break-tested by widening `WANDER.chicken.radiusX` past a tile, and by giving
 * a chicken a non-zero roam: both must fail.
 */
describe('an animal stays inside the band its kind is allowed', () => {
  function tileOf(x: number, y: number) {
    return { x: Math.floor(x / TILE_SIZE), y: Math.floor((y - 1) / TILE_SIZE) };
  }

  /**
   * T-16.04 split this test in two, because the spec it guarded changed for one
   * kind and not the other.
   *
   * It used to assert that NO animal ever leaves its home tile. That is still
   * exactly right for chickens (D-15 — their sheet has no walk cycle, so they
   * must not translate) and is now wrong for cows, which roam a tile up or
   * down using a walk cycle drawn for it. So the assertion became "inside the
   * band `WANDER` declares for this kind", which is the same statement for a
   * chicken (`roamTiles*` are 0, band height 1) and a looser one for a cow.
   *
   * The COLUMN is asserted unchanged for both, and that is the load-bearing
   * half now: `Animal.bounds()` follows a roaming cow (T-16.06), so two cows
   * sharing a column would be two animals answering on one tile.
   */
  it('holds for every yard slot, sampled across many legs', () => {
    for (const kind of KINDS) {
      const { legMs, roamTilesUp, roamTilesDown } = WANDER[kind];
      const herd = maxHerd(ANIMALS[kind].building);

      for (let index = 0; index < herd; index++) {
        const home = slotFor(kind, index);
        const homeTile = tileOf(home.x, home.y);
        const seed = seedFrom(`${kind}-${index}`);

        // 40 legs x 8 samples each: enough to hit both extremes of the radius.
        for (let leg = 0; leg < 40; leg++) {
          for (let s = 0; s < 8; s++) {
            const now = leg * legMs + (s / 8) * legMs;
            const pose = wanderPose(kind, seed, home, now);
            const tile = tileOf(pose.x, pose.y);
            const where = `${kind} #${index} at t=${now} (${pose.x.toFixed(1)},${pose.y.toFixed(1)})`;

            expect(tile.x, `${where} changed column`).toBe(homeTile.x);
            expect(tile.y, `${where} roamed above its band`).toBeGreaterThanOrEqual(
              homeTile.y - roamTilesUp,
            );
            expect(tile.y, `${where} roamed below its band`).toBeLessThanOrEqual(
              homeTile.y + roamTilesDown,
            );
          }
        }
      }
    }
  });

  /** D-15, as an assertion rather than a comment: chickens do not translate. */
  it('a chicken never leaves its home tile at all', () => {
    const { legMs } = WANDER.chicken;
    for (let index = 0; index < maxHerd(ANIMALS.chicken.building); index++) {
      const home = slotFor('chicken', index);
      const homeTile = tileOf(home.x, home.y);
      const seed = seedFrom(`chicken-${index}`);

      for (let leg = 0; leg < 40; leg++) {
        for (let s = 0; s < 8; s++) {
          const pose = wanderPose('chicken', seed, home, leg * legMs + (s / 8) * legMs);
          expect(tileOf(pose.x, pose.y), `chicken #${index} left its tile`).toEqual(homeTile);
        }
      }
    }
  });

  /**
   * And the other half of D-15: a cow must ACTUALLY roam. A regression that
   * quietly set `roamTilesUp/Down` to zero would pass every bound above while
   * leaving the farm exactly as motionless as it was before T-16.04.
   */
  it('a cow really does visit every row its band allows', () => {
    const { legMs, roamTilesUp, roamTilesDown } = WANDER.cow;
    expect(roamTilesUp + roamTilesDown, 'the cow does not roam at all').toBeGreaterThan(0);

    const home = slotFor('cow', 0);
    const homeTile = tileOf(home.x, home.y);
    const seed = seedFrom('cow-0');

    const rows = new Set<number>();
    for (let leg = 0; leg < 200; leg++) {
      const pose = wanderPose('cow', seed, home, leg * legMs + legMs * 0.9);
      rows.add(tileOf(pose.x, pose.y).y);
    }

    // Read off the config rather than hardcoded, because which way a cow may
    // roam is a map fact and has already changed once: T-16.04 started with one
    // tile each way and `reachability.test.ts` found maple trees above two of
    // the nine cow columns.
    for (let dy = -roamTilesUp; dy <= roamTilesDown; dy++) {
      expect(rows.has(homeTile.y + dy), `never rested on row offset ${dy}`).toBe(true);
    }
  });
});

describe('wander tuning fits the yards it runs in', () => {
  /*
   * Two animals standing inside each other is the other way this goes wrong,
   * and it is spacing-dependent: chickens are packed one per tile, cows two.
   * Pinned here rather than judged by eye, so a future retune of `WANDER` that
   * looks harmless in isolation fails against the yard it has to live in.
   */
  it('cannot drift two neighbours into each other', () => {
    for (const kind of KINDS) {
      const yard = yardFor(ANIMALS[kind].building, 0);
      // Absolute: since T-18.04 the spacing is SIGNED, because a yard fills
      // away from its building — a cow row walks west, so `spacing.x` is -2.
      // The distance between neighbours is what matters here, not the heading.
      const gapPx = Math.abs(yard.spacing.x) * TILE_SIZE;
      // Worst case: neighbours drift fully toward each other.
      expect(WANDER[kind].radiusX * 2, `${kind} horizontal drift vs spacing`).toBeLessThan(gapPx);
    }
  });

  it('stays inside a tile by construction, not by luck', () => {
    for (const kind of KINDS) {
      expect(WANDER[kind].radiusX, `${kind} radiusX`).toBeLessThan(TILE_SIZE / 2);
      expect(WANDER[kind].radiusY, `${kind} radiusY`).toBeLessThan(TILE_SIZE / 2);
    }
  });

  it('spends part of each leg resting', () => {
    for (const kind of KINDS) {
      expect(WANDER[kind].moveFraction).toBeGreaterThan(0);
      expect(WANDER[kind].moveFraction).toBeLessThan(1);
    }
  });
});

/**
 * What an animal does when the player has asked for reduced motion (T-15.29).
 *
 * The wander is the single longest-running animation in the game — it never
 * stops, it is everywhere in the periphery, and it is exactly the category the
 * preference exists to switch off.
 */
describe('stillPose', () => {
  it('parks the animal on its slot, not wherever the drift left it', () => {
    for (const kind of ANIMAL_KINDS) {
      const home = slotFor(kind, 0);
      const still = stillPose(home);
      expect(still.x, `${kind} x`).toBe(home.x);
      expect(still.y, `${kind} y`).toBe(home.y);
    }
  });

  /**
   * The reason it is the slot and not a frozen `wanderPose`: a slot is always
   * exactly on a tile, so `wanderTile` can name one without rounding a body
   * that is visibly halfway between two. Freezing mid-leg would leave some
   * animals permanently straddling a boundary.
   */
  it('leaves the animal on the same tile a moving one would answer about', () => {
    for (const kind of ANIMAL_KINDS) {
      for (let index = 0; index < 4; index++) {
        const home = slotFor(kind, index);
        expect(wanderTile(stillPose(home)), `${kind} #${index}`).toEqual(
          wanderTile({ x: home.x, y: home.y, facing: 'left', pose: 'idle', phase: 0 }),
        );
      }
    }
  });

  /**
   * `idle` specifically, because it is the only pose every sheet resolves to
   * something motionless — a cow has no standing row and `poseRowFor` answers
   * with a held frame of the walk row. Asking for `peck` would be a chicken
   * pecking forever, which is the animation being switched off.
   */
  it('holds an idle, never a walk or a peck', () => {
    const still = stillPose({ x: 0, y: 0 });
    expect(still.pose).toBe('idle');
    expect(still.phase).toBe(0);
  });

  /** No clock in it at all: same answer forever, which is the point. */
  it('does not depend on time', () => {
    const home = slotFor('cow', 0);
    expect(stillPose(home)).toEqual(stillPose(home));
  });
});
