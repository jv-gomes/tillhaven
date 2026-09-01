import { describe, it, expect } from 'vitest';
import {
  ANIMALS,
  ANIMAL_KINDS,
  ANIMAL_CHICKEN_BABY_HATCH_ROW,
  ANIMAL_CHICKEN_BABY_SHEETS,
  ANIMAL_CHICKEN_IDLE_ROW,
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
  BABY_SHEET,
  VARIANT_SHEET,
  badgeFor,
  idleFrameFor,
  idleRowFor,
  sheetFor,
} from './animalSprites.js';

/**
 * The two rules T-2.06 is about: a chick becoming an adult, and a player being
 * able to read an animal's state without pointing at it.
 */

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
