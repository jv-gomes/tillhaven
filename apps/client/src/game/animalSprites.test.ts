import { describe, it, expect } from 'vitest';
import {
  ANIMALS,
  ANIMAL_KINDS,
  ANIMAL_CHICKEN_BABY_HATCH_ROW,
  ANIMAL_CHICKEN_BABY_SHEETS,
  ANIMAL_CHICKEN_IDLE_ROW,
  ANIMAL_CHICKEN_POSE_ROWS,
  ANIMAL_CHICKEN_RED,
  ANIMAL_CHICKEN_SHEETS,
  ANIMAL_COW_FEMALE_BROWN,
  ANIMAL_COW_IDLE_ROW,
  ANIMAL_COW_SHEETS,
  ANIMAL_SHEETS,
  ITEMS,
  type AnimalKind,
  type AnimalVariant,
  type SheetSpec,
} from '@tillhaven/shared/config';
import type { AnimalView } from '@tillhaven/shared/types';
import {
  ANIMAL_FACINGS,
  ANIMAL_POSES,
  BABY_SHEET,
  VARIANT_SHEET,
  animationRowsFor,
  badgeFor,
  idleFrameFor,
  idleRowFor,
  poseRowFor,
  sheetFor,
  type AnimalPose,
} from './animalSprites.js';
import type { Direction } from './entities/movement.js';

/**
 * The two rules T-2.06 is about: a chick becoming an adult, and a player being
 * able to read an animal's state without pointing at it.
 */

/** Every pose `wanderPose` can return. Kept beside `AnimalPose` deliberately. */
const ALL_POSES: readonly AnimalPose[] = [
  'idle',
  'idleAlt',
  'idleAlt2',
  'walk',
  'peck',
  'peckDeep',
  'nest',
  'lying',
];

const T0 = 1_700_000_000_000;

function view(overrides: Partial<AnimalView> = {}): AnimalView {
  return {
    id: 'animal-1',
    farmId: 'farm-1',
    kind: 'chicken',
    variant: 'chicken_red',
    name: null,
    acquiredAt: T0,
    maturesAt: T0,
    lastCollectedAt: T0,
    fedUntil: null,
    isMature: true,
    isFed: true,
    hasProduce: false,
    readyInMs: 0,
    ...overrides,
  };
}

describe('sheetFor', () => {
  it('draws a chick from the baby sheet and an adult from its variant', () => {
    expect(sheetFor(view({ isMature: false })).key).toBe('animal-chicken-baby-red');
    expect(sheetFor(view({ isMature: true })).key).toBe(VARIANT_SHEET.chicken_red.key);
  });

  /**
   * A chick is the colour of the hen it grows into (T-12.01). Before that, one
   * yellow chick stood in for every variant, which was fine with two of them
   * and would be a visible lie with thirteen — buy a black hen, watch a yellow
   * chick, get a black hen back.
   */
  it('hatches each variant into a chick of its own body colour', () => {
    expect(sheetFor(view({ variant: 'chicken_black', isMature: false })).key).toBe(
      'animal-chicken-baby-black',
    );
    expect(sheetFor(view({ variant: 'chicken_green', isMature: false })).key).toBe(
      'animal-chicken-baby-green',
    );
    // Two-word slugs are body-then-accent, so the WING colour is not what the
    // chick inherits: a black-and-white hen hatches black, not white.
    expect(sheetFor(view({ variant: 'chicken_black_white', isMature: false })).key).toBe(
      'animal-chicken-baby-black',
    );
    expect(sheetFor(view({ variant: 'chicken_brown_white', isMature: false })).key).toBe(
      'animal-chicken-baby-brown',
    );
  });

  /**
   * The whole point of T-12.01: every colour in the pack is buyable, and each
   * one draws from its own sheet rather than sharing a fallback.
   */
  it('registers every colour the pack ships, one sheet each', () => {
    expect(ANIMALS.chicken.variants).toHaveLength(ANIMAL_CHICKEN_SHEETS.length);
    expect(ANIMALS.cow.variants).toHaveLength(ANIMAL_COW_SHEETS.length);

    const all = [...ANIMALS.chicken.variants, ...ANIMALS.cow.variants];
    expect(new Set(all.map((v) => VARIANT_SHEET[v].key)).size).toBe(all.length);
  });

  /** Maturing IS this function changing its answer. */
  it('switches sheets at maturity and nowhere else', () => {
    const baby = view({ isMature: false, variant: 'chicken_blonde' });
    const adult = view({ isMature: true, variant: 'chicken_blonde' });

    expect(sheetFor(baby).key).not.toBe(sheetFor(adult).key);
    expect(sheetFor(adult).key).toBe(VARIANT_SHEET.chicken_blonde.key);
  });

  it('has no baby phase for a variant with no baby art', () => {
    for (const variant of ANIMALS.cow.variants) {
      expect(BABY_SHEET[variant], variant).toBeUndefined();
    }
    const calf = view({ kind: 'cow', variant: 'cow_brown_female', isMature: false });
    expect(sheetFor(calf).key).toBe(VARIANT_SHEET.cow_brown_female.key);
  });

  /**
   * A variant with no sheet renders as a missing sprite, which looks like a
   * broken game rather than a config gap.
   */
  it('has a sheet for every variant of every kind', () => {
    for (const kind of ANIMAL_KINDS) {
      for (const variant of ANIMALS[kind].variants) {
        expect(VARIANT_SHEET[variant], `${kind}/${variant}`).toBeDefined();
      }
    }
  });

  it('draws every animal from a real row within its own sheet', () => {
    for (const sheet of ANIMAL_SHEETS) {
      const row = idleRowFor(sheet);
      expect(sheet.rows, sheet.key).toBeGreaterThan(row);
      expect(sheet.cols, sheet.key).toBeGreaterThanOrEqual(2);
      expect(idleFrameFor(sheet), sheet.key).toBe(row * sheet.cols);
    }
  });

  /**
   * The actual T-7.10 measurement, pinned as a LITERAL rather than compared
   * against the constants under test — `toBe(ANIMAL_COW_IDLE_ROW)` would
   * pass trivially no matter what either constant is edited to, since both
   * sides of the comparison read the same value. Both happen to measure out
   * to row 0 (a real coincidence: chicken's row 0 is an upright idle bob,
   * cow's row 0 is a walking-in-place cycle — see the manifest doc comments
   * for the full per-row breakdown), so this is the only assertion that
   * actually catches one of them drifting to a wrong-but-plausible row.
   */
  it('measures both animal families’ idle row as 0', () => {
    expect(ANIMAL_CHICKEN_IDLE_ROW).toBe(0);
    expect(ANIMAL_COW_IDLE_ROW).toBe(0);
  });

  /**
   * `idleRowFor` reads the row from the shared manifest rather than
   * hardcoding a number itself — this pins that wiring for cow sheets
   * (by key, see `COW_SHEET_KEYS`) and for every other sheet.
   */
  it('picks the cow idle row for cow sheets and the chicken idle row for chicken sheets', () => {
    for (const sheet of ANIMAL_COW_SHEETS) {
      expect(idleRowFor(sheet), sheet.key).toBe(ANIMAL_COW_IDLE_ROW);
    }
    for (const sheet of [...ANIMAL_CHICKEN_SHEETS, ...ANIMAL_CHICKEN_BABY_SHEETS]) {
      expect(idleRowFor(sheet), sheet.key).toBe(ANIMAL_CHICKEN_IDLE_ROW);
    }
  });

  /**
   * A sheet that is not one of the two registered cow keys always falls back
   * to the chicken row, regardless of its own dimensions — `idleRowFor`
   * dispatches on identity (which sheet is this?), not on shape.
   */
  it('falls back to the chicken idle row for anything that is not a registered cow sheet', () => {
    const impostor: SheetSpec = { ...ANIMAL_COW_FEMALE_BROWN, key: 'not-a-real-cow-sheet' };
    expect(idleRowFor(impostor)).toBe(ANIMAL_CHICKEN_IDLE_ROW);
  });

  /**
   * The egg-hatch row is measured and recorded (T-7.10) but deliberately not
   * wired into `idleRowFor` — the game has no incubating-egg state to play it
   * from (CLAUDE.md §5.4: chicks are bought immature, not hatched). This test
   * exists so a future task that wires it can see the constant is still where
   * this task left it, and so nobody "helpfully" points idleRowFor at it.
   */
  it('never uses the egg-hatch row for the ordinary idle loop', () => {
    for (const sheet of ANIMAL_CHICKEN_BABY_SHEETS) {
      expect(idleRowFor(sheet), sheet.key).not.toBe(ANIMAL_CHICKEN_BABY_HATCH_ROW);
    }
  });

  /**
   * §5.3: colour is decoration. The two variants of a kind must differ in the
   * sheet they draw and in nothing else the player can measure.
   */
  it('makes variants differ in art alone', () => {
    for (const kind of ANIMAL_KINDS) {
      const def = ANIMALS[kind];
      const sheets = def.variants.map((v: AnimalVariant) => VARIANT_SHEET[v].key);

      // Different pictures...
      expect(new Set(sheets).size, kind).toBe(def.variants.length);

      // ...identical everything else. Production is defined per KIND, so there
      // is no per-variant field that could diverge — asserted so that adding
      // one is a deliberate act rather than an accident.
      for (const variant of def.variants) {
        expect(badgeFor(view({ kind, variant, hasProduce: true }))?.frame).toBe(
          ITEMS[def.produceItemId]!.icon.frame,
        );
      }
    }
  });
});

describe('badgeFor', () => {
  it('shows nothing for a fed animal with nothing ready', () => {
    expect(badgeFor(view({ isFed: true, hasProduce: false }))).toBeNull();
  });

  it('shows the produce when there is some to collect', () => {
    const badge = badgeFor(view({ hasProduce: true }));
    expect(badge?.reason).toBe('produce');
    expect(badge?.frame).toBe(ITEMS[ANIMALS.chicken.produceItemId]!.icon.frame);
  });

  it('shows the feed item when the animal is hungry', () => {
    const badge = badgeFor(view({ isFed: false, hasProduce: false }));
    expect(badge?.reason).toBe('feed');
    expect(badge?.frame).toBe(ITEMS[ANIMALS.chicken.feedItemId]!.icon.frame);
  });

  /**
   * Both states at once is a real case — an animal that earned produce before
   * its food ran out. Produce wins the icon because it is actionable now; the
   * unfed state is still shown, through the sprite's tint rather than the badge.
   */
  it('prefers produce over feed when both apply', () => {
    expect(badgeFor(view({ isFed: false, hasProduce: true }))?.reason).toBe('produce');
  });

  it('names the right item for each kind', () => {
    for (const kind of ANIMAL_KINDS) {
      const def = ANIMALS[kind];
      const variant = def.variants[0]!;

      expect(badgeFor(view({ kind, variant, hasProduce: true }))?.frame).toBe(
        ITEMS[def.produceItemId]!.icon.frame,
      );
      expect(badgeFor(view({ kind, variant, isFed: false }))?.frame).toBe(
        ITEMS[def.feedItemId]!.icon.frame,
      );
    }
  });

  it('shows a hungry chick its feed, even though it cannot produce yet', () => {
    const chick = view({ isMature: false, isFed: false });
    expect(badgeFor(chick)?.reason).toBe('feed');
  });

  it('returns null rather than throwing for a kind that is no longer in config', () => {
    expect(badgeFor(view({ kind: 'griffin' as AnimalKind }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * poseRowFor (T-15.11)
 * ------------------------------------------------------------------ */

describe('poseRowFor', () => {
  const cow = ANIMAL_COW_FEMALE_BROWN;
  const hen = ANIMAL_CHICKEN_RED;
  const facings: Direction[] = ['down', 'up', 'left', 'right'];
  // Every pose the wander can produce (T-16.05 widened this from four).
  const poses: AnimalPose[] = [...ALL_POSES];

  it('never names a row outside its own sheet', () => {
    // The cheapest guard there is, and the one that catches a typo'd constant
    // before it becomes an invisible sprite.
    for (const sheet of [cow, hen]) {
      for (const pose of poses) {
        for (const facing of facings) {
          const { row } = poseRowFor(sheet, pose, facing);
          expect(row, `${sheet.key} ${pose} ${facing}`).toBeGreaterThanOrEqual(0);
          expect(row, `${sheet.key} ${pose} ${facing}`).toBeLessThan(sheet.rows);
        }
      }
    }
  });

  /*
   * D-10, in the one place it changes behaviour.
   *
   * The chicken sheet has no front or back view — measured in T-15.10 — so a
   * chicken facing up must not get a different row from one facing down. If a
   * future change wires `ANIMAL_CHICKEN_FACING_ROWS` to something real, this is
   * the test that says so.
   */
  it('gives a chicken the same row whichever way it faces', () => {
    const rows = facings.map((f) => poseRowFor(hen, 'idle', f).row);
    expect(new Set(rows).size).toBe(1);
  });

  it('flips a chicken to face right, and only right', () => {
    expect(poseRowFor(hen, 'idle', 'right').flipX).toBe(true);
    expect(poseRowFor(hen, 'idle', 'left').flipX).toBe(false);
    expect(poseRowFor(hen, 'idle', 'up').flipX).toBe(false);
    expect(poseRowFor(hen, 'idle', 'down').flipX).toBe(false);
  });

  it('gives a cow a genuinely different row per facing', () => {
    // Unlike the chicken: the cow sheet's rows 1 and 2 measured 13px wide
    // against row 0's 22px, which is what a head-on and a tail-on view look
    // like next to a side view.
    const side = poseRowFor(cow, 'walk', 'left').row;
    const front = poseRowFor(cow, 'walk', 'down').row;
    const back = poseRowFor(cow, 'walk', 'up').row;
    expect(new Set([side, front, back]).size).toBe(3);
  });

  it('never flips a cow that is facing the camera or away from it', () => {
    // Front and back views are their own rows, so flipping one mirrors a cow
    // that has no left or right to mirror.
    expect(poseRowFor(cow, 'walk', 'down').flipX).toBe(false);
    expect(poseRowFor(cow, 'walk', 'up').flipX).toBe(false);
    expect(poseRowFor(cow, 'walk', 'right').flipX).toBe(true);
  });

  it('draws a lying animal from a different row than a standing one', () => {
    for (const sheet of [cow, hen]) {
      expect(poseRowFor(sheet, 'lying', 'left').row).not.toBe(
        poseRowFor(sheet, 'idle', 'left').row,
      );
    }
  });

  it('gives a chicken a pecking row but a cow none of its own', () => {
    // The cow sheet has no peck pose; asking for one falls back to its walk
    // row rather than to an arbitrary lying pose.
    expect(poseRowFor(hen, 'peck', 'left').row).not.toBe(poseRowFor(hen, 'idle', 'left').row);
    expect(poseRowFor(cow, 'peck', 'left').row).toBe(poseRowFor(cow, 'walk', 'left').row);
  });

  it('is what idleRowFor now answers with', () => {
    for (const sheet of [cow, hen]) {
      expect(idleRowFor(sheet)).toBe(poseRowFor(sheet, 'idle', 'left').row);
    }
  });

  /**
   * T-16.05, found in a browser and not by any test that existed.
   *
   * A chick sheet has the adult's 4x7 GEOMETRY and different row SEMANTICS:
   * `ANIMAL_CHICKEN_POSE_ROWS.peckDeep` is row 4, and row 4 of a chick sheet is
   * `ANIMAL_CHICKEN_BABY_HATCH_ROW` — an egg. The first version of the chicken
   * routine drove the chick sheet through the adult's rows, so every baby
   * chicken in the coop periodically turned back into an egg. Nothing caught it
   * because every geometric invariant still held: row 4 exists, it is in range,
   * and it animates.
   *
   * Only row 4 of the chick sheet was ever measured, so every other row is a
   * guess and chicks hold their idle row instead.
   */
  it('never draws a chick as anything but its idle row', () => {
    for (const sheet of ANIMAL_CHICKEN_BABY_SHEETS) {
      for (const pose of ALL_POSES) {
        for (const facing of ['down', 'up', 'left', 'right'] as const) {
          const { row } = poseRowFor(sheet, pose, facing);
          expect(row, `chick ${sheet.key} drew row ${row} for ${pose}`).toBe(
            ANIMAL_CHICKEN_POSE_ROWS.idle,
          );
          expect(row, 'a chick must never be drawn as an egg').not.toBe(
            ANIMAL_CHICKEN_BABY_HATCH_ROW,
          );
        }
      }
    }
  });

  /** The adult sheet is the one with a routine, and it must reach every row. */
  it('an adult hen can reach every measured row of its sheet', () => {
    const reached = new Set<number>();
    for (const pose of ALL_POSES) reached.add(poseRowFor(hen, pose, 'left').row);

    for (const [name, row] of Object.entries(ANIMAL_CHICKEN_POSE_ROWS)) {
      // `walk` has no row of its own (D-15), so idleAlt/idleAlt2 etc. are the
      // ones that must be reachable — all seven measured rows are named here.
      expect(reached.has(row), `nothing ever selects the ${name} row`).toBe(true);
    }
  });
});

/**
 * The set of animations `registerAnimalAnimations` creates (T-15.29).
 *
 * Lifted out of `Animal.ts` precisely so it could be asserted: the scene needs
 * Phaser and Phaser needs a DOM, so nothing inside it is reachable from these
 * tests. The failure being guarded is silent — `anims.play` on a key that was
 * never created does not throw, it simply leaves the sprite on whatever frame
 * it was already showing.
 */
describe('animationRowsFor', () => {
  it('covers every (row, playback) the wander can ask for', () => {
    for (const sheet of ANIMAL_SHEETS) {
      const registered = new Set(
        animationRowsFor(sheet).map(({ row, play }) => `${row}:${play}`),
      );
      for (const pose of ANIMAL_POSES) {
        for (const facing of ANIMAL_FACINGS) {
          const { row, play } = poseRowFor(sheet, pose, facing);
          expect(
            registered.has(`${row}:${play}`),
            `${sheet.key}: ${pose}/${facing} wants row ${row} as ${play}, never registered`,
          ).toBe(true);
        }
      }
    }
  });

  /**
   * Reduced motion forces `hold` onto whichever row `idle` resolves to,
   * regardless of the playback that pose normally asks for — a chicken's idle
   * row is only ever requested as a `loop`. Without this, the preference would
   * freeze exactly the players who set it onto a single stale frame, and only
   * them.
   */
  it('registers a held variant of every row, whether or not a pose asks for one', () => {
    for (const sheet of ANIMAL_SHEETS) {
      const rows = animationRowsFor(sheet);
      const held = new Set(rows.filter((r) => r.play === 'hold').map((r) => r.row));
      for (const { row } of rows) {
        expect(held.has(row), `${sheet.key}: row ${row} has no held variant`).toBe(true);
      }
    }
  });

  it('deduplicates rows several poses collapse onto', () => {
    for (const sheet of ANIMAL_SHEETS) {
      const rows = animationRowsFor(sheet);
      const keys = rows.map(({ row, play }) => `${row}:${play}`);
      expect(new Set(keys).size, `${sheet.key} has duplicate animation keys`).toBe(keys.length);
    }
  });
});
