import { describe, it, expect } from 'vitest';
import { ANIMALS, ANIMAL_KINDS, HOUR, DAY, VIP_BENEFITS } from '@tillhaven/shared';
import { productionAt, feedAt, hasProduce, type ProducingAnimal } from './production.js';

/**
 * Production is pure and `now` is a parameter, so every case here is exact
 * rather than approximate — no waiting, no tolerance windows.
 *
 * The assertion that runs through the whole file: **an unfed animal accrues
 * nothing.** Not less, not later — nothing. Feeding must never be a way to
 * cash in a neglected fortnight, and it must never be a way to destroy produce
 * that was legitimately earned before the food ran out.
 */

const T0 = 1_700_000_000_000;

const CHICKEN = ANIMALS.chicken;
const COW = ANIMALS.cow;

function animal(overrides: Partial<ProducingAnimal> = {}): ProducingAnimal {
  return {
    kind: 'chicken',
    maturesAt: T0,
    lastCollectedAt: T0,
    fedUntil: T0 + CHICKEN.feedDurationMs,
    ...overrides,
  };
}

describe('maturity', () => {
  it('a baby produces nothing, however long it has been fed', () => {
    const chick = animal({ maturesAt: T0 + CHICKEN.maturityDurationMs });
    const state = productionAt(chick, T0 + CHICKEN.productionIntervalMs * 5);

    expect(state.isMature).toBe(false);
    expect(state.cyclesOwed).toBe(0);
    expect(state.quantity).toBe(0);
  });

  it('does not pay out for the time it spent as a baby', () => {
    const maturesAt = T0 + CHICKEN.maturityDurationMs;
    const chick = animal({
      maturesAt,
      lastCollectedAt: T0,
      // Fed continuously across growing up and well beyond.
      fedUntil: maturesAt + 10 * DAY,
    });

    // One interval after maturity: exactly one cycle, not one per interval
    // since purchase.
    const state = productionAt(chick, maturesAt + CHICKEN.productionIntervalMs);
    expect(state.cyclesOwed).toBe(1);
  });

  it('becomes mature exactly at its maturity instant, not a millisecond before', () => {
    const maturesAt = T0 + CHICKEN.maturityDurationMs;
    const chick = animal({ maturesAt, fedUntil: maturesAt + DAY });

    expect(productionAt(chick, maturesAt - 1).isMature).toBe(false);
    expect(productionAt(chick, maturesAt).isMature).toBe(true);
  });

  it('a cow is mature on purchase — there is no baby-cow sprite', () => {
    expect(COW.maturityDurationMs).toBe(0);
    const cow = animal({ kind: 'cow', fedUntil: T0 + COW.feedDurationMs });
    expect(productionAt(cow, T0).isMature).toBe(true);
  });
});

describe('feeding', () => {
  it('a mature but unfed animal owes nothing', () => {
    const hungry = animal({ fedUntil: null });
    const state = productionAt(hungry, T0 + 5 * DAY);

    expect(state.isMature).toBe(true);
    expect(state.isFed).toBe(false);
    expect(state.cyclesOwed).toBe(0);
  });

  it('stops accruing the moment the food runs out', () => {
    const fedUntil = T0 + 3 * CHICKEN.productionIntervalMs;
    const lapsed = animal({ fedUntil });

    // Three cycles fit inside the fed window, and no more are added later.
    expect(productionAt(lapsed, fedUntil).cyclesOwed).toBe(3);
    expect(productionAt(lapsed, fedUntil + 100 * DAY).cyclesOwed).toBe(3);
  });

  /**
   * The one that matters most. An animal left unfed for a fortnight and then
   * fed must not pay for the fortnight — the productive window is bounded by
   * `fedUntil`, so extending it without care would sweep the neglected days
   * back inside.
   */
  it('does not bank cycles across an unfed gap when fed again', () => {
    const fedUntil = T0 + 2 * CHICKEN.productionIntervalMs;
    const lapsed = animal({ fedUntil });

    const owedAtLapse = productionAt(lapsed, fedUntil).cyclesOwed;
    expect(owedAtLapse).toBe(2);

    // Two weeks of neglect, then a feeding.
    const fedAgainAt = fedUntil + 14 * DAY;
    const result = feedAt(lapsed, fedAgainAt);
    const revived = animal({ ...lapsed, ...result });

    // Still exactly what it had earned before the food ran out.
    expect(productionAt(revived, fedAgainAt).cyclesOwed).toBe(owedAtLapse);

    // And it resumes from the feeding, not from the lapse.
    expect(productionAt(revived, fedAgainAt + CHICKEN.productionIntervalMs).cyclesOwed).toBe(
      owedAtLapse + 1,
    );
  });

  it('feeding never destroys produce already owed', () => {
    for (const owed of [0, 1, 5]) {
      const fedUntil = T0 + owed * CHICKEN.productionIntervalMs;
      const lapsed = animal({ fedUntil });
      const before = productionAt(lapsed, fedUntil).cyclesOwed;

      const at = fedUntil + 3 * DAY;
      const revived = animal({ ...lapsed, ...feedAt(lapsed, at) });

      expect(productionAt(revived, at).cyclesOwed, `owed ${owed}`).toBe(before);
    }
  });

  it('extends from the existing expiry, so feeding early wastes nothing', () => {
    const fedUntil = T0 + 10 * HOUR;
    const fed = animal({ fedUntil });

    const result = feedAt(fed, T0 + HOUR);
    expect(result.fedUntil).toBe(fedUntil + CHICKEN.feedDurationMs);
    // Nothing lapsed, so the production clock is untouched.
    expect(result.lastCollectedAt).toBe(fed.lastCollectedAt);
  });

  it('feeding a lapsed animal starts its cover from now, not from the old expiry', () => {
    const fedUntil = T0 + HOUR;
    const lapsed = animal({ fedUntil });

    const at = fedUntil + 5 * DAY;
    expect(feedAt(lapsed, at).fedUntil).toBe(at + CHICKEN.feedDurationMs);
  });

  it('a never-fed animal can be fed', () => {
    const fresh = animal({ fedUntil: null });
    expect(feedAt(fresh, T0).fedUntil).toBe(T0 + CHICKEN.feedDurationMs);
  });

  it('is fed right up to its expiry instant and not past it', () => {
    const fedUntil = T0 + DAY;
    const a = animal({ fedUntil });

    expect(productionAt(a, fedUntil - 1).isFed).toBe(true);
    expect(productionAt(a, fedUntil).isFed).toBe(false);
  });
});

describe('cycles owed', () => {
  it('owes nothing before the first interval is complete', () => {
    const state = productionAt(animal(), T0 + CHICKEN.productionIntervalMs - 1);
    expect(state.cyclesOwed).toBe(0);
    expect(state.readyInMs).toBe(1);
  });

  it('owes exactly one at the interval boundary', () => {
    const state = productionAt(animal(), T0 + CHICKEN.productionIntervalMs);
    expect(state.cyclesOwed).toBe(1);
    expect(state.readyInMs).toBe(0);
  });

  it('accumulates over a long absence, bounded by how long the food lasted', () => {
    const state = productionAt(animal(), T0 + 30 * DAY);

    // A day of food at 90 minutes a cycle: sixteen eggs, and no more however
    // long the player stays away. Feeding is the sink that keeps it that way.
    const expected = Math.floor(CHICKEN.feedDurationMs / CHICKEN.productionIntervalMs);
    expect(state.cyclesOwed).toBe(expected);
    expect(expected).toBe(16);
  });

  it('multiplies the yield rather than reporting cycles as items', () => {
    const state = productionAt(animal(), T0 + 3 * CHICKEN.productionIntervalMs);
    expect(state.quantity).toBe(state.cyclesOwed * CHICKEN.yieldAmount);
  });

  it('counts from the last collection, not from acquisition', () => {
    const collected = T0 + 5 * HOUR;
    const a = animal({ lastCollectedAt: collected, fedUntil: T0 + 10 * DAY });

    expect(productionAt(a, collected + CHICKEN.productionIntervalMs - 1).cyclesOwed).toBe(0);
    expect(productionAt(a, collected + CHICKEN.productionIntervalMs).cyclesOwed).toBe(1);
  });

  it('never returns a negative or fractional count, for any animal at any time', () => {
    const offsets = [-100 * DAY, -1, 0, 1, HOUR, DAY, 365 * DAY];

    for (const kind of ANIMAL_KINDS) {
      const def = ANIMALS[kind];
      for (const fedUntil of [null, T0 - DAY, T0, T0 + def.feedDurationMs]) {
        for (const offset of offsets) {
          const a = animal({
            kind,
            maturesAt: T0 + def.maturityDurationMs,
            fedUntil,
          });
          const { cyclesOwed, quantity, readyInMs } = productionAt(a, T0 + offset);

          expect(Number.isInteger(cyclesOwed), `${kind} ${fedUntil} ${offset}`).toBe(true);
          expect(cyclesOwed).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(quantity)).toBe(true);
          expect(quantity).toBeGreaterThanOrEqual(0);
          expect(readyInMs).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('clamps a clock that has gone backwards', () => {
    const state = productionAt(animal(), T0 - DAY);
    expect(state.cyclesOwed).toBe(0);
  });

  it('treats an animal kind that is no longer in config as producing nothing', () => {
    const state = productionAt(animal({ kind: 'griffin' }), T0 + 10 * DAY);
    expect(state.cyclesOwed).toBe(0);
    expect(state.quantity).toBe(0);
    expect(state.effectiveIntervalMs).toBe(0);
  });
});

describe('readyInMs', () => {
  it('counts down to the next cycle while fed', () => {
    const a = animal();
    expect(productionAt(a, T0).readyInMs).toBe(CHICKEN.productionIntervalMs);
    expect(productionAt(a, T0 + HOUR).readyInMs).toBe(CHICKEN.productionIntervalMs - HOUR);
  });

  /**
   * An unfed animal's productive clock stopped in the past. Subtracting from it
   * would report "ready now" for produce that is never coming.
   */
  it('reports a full interval for an unfed animal rather than a stale countdown', () => {
    const lapsed = animal({ fedUntil: T0 + 1 });
    const state = productionAt(lapsed, T0 + 10 * DAY);

    expect(state.isFed).toBe(false);
    expect(state.readyInMs).toBe(CHICKEN.productionIntervalMs);
  });

  it('includes the wait to grow up for a baby', () => {
    const maturesAt = T0 + CHICKEN.maturityDurationMs;
    const chick = animal({ maturesAt, fedUntil: maturesAt + DAY });

    expect(productionAt(chick, T0).readyInMs).toBe(
      CHICKEN.maturityDurationMs + CHICKEN.productionIntervalMs,
    );
  });
});

describe('VIP multiplier', () => {
  const VIP = VIP_BENEFITS.durationPercent;

  it('shortens the interval', () => {
    const state = productionAt(animal(), T0, VIP);
    expect(state.effectiveIntervalMs).toBeLessThan(CHICKEN.productionIntervalMs);
    expect(state.effectiveIntervalMs).toBe(
      Math.ceil((CHICKEN.productionIntervalMs * VIP) / 100),
    );
  });

  it('produces sooner than a free account', () => {
    const at = T0 + Math.ceil((CHICKEN.productionIntervalMs * VIP) / 100);

    expect(productionAt(animal(), at, VIP).cyclesOwed).toBe(1);
    expect(productionAt(animal(), at, 100).cyclesOwed).toBe(0);
  });

  it('is identical to a free account at 100', () => {
    const at = T0 + 3 * CHICKEN.productionIntervalMs;
    expect(productionAt(animal(), at, 100)).toEqual(productionAt(animal(), at));
  });

  /**
   * §7: VIP is convenience, never a different class of goods. More eggs per
   * day is fine; an egg a free account cannot obtain is not.
   */
  it('grants the same item, only more often', () => {
    const at = T0 + 10 * CHICKEN.productionIntervalMs;
    const free = productionAt(animal(), at, 100);
    const vip = productionAt(animal(), at, VIP);

    expect(vip.cyclesOwed).toBeGreaterThan(free.cyclesOwed);
    expect(vip.quantity % CHICKEN.yieldAmount).toBe(0);
  });

  it('never makes production instant', () => {
    for (const percent of [0, 1, 50]) {
      const state = productionAt(animal(), T0, percent);
      expect(state.effectiveIntervalMs, `percent ${percent}`).toBeGreaterThan(0);
    }
  });
});

describe('hasProduce', () => {
  it('agrees with cyclesOwed', () => {
    for (const offset of [0, CHICKEN.productionIntervalMs - 1, CHICKEN.productionIntervalMs]) {
      const at = T0 + offset;
      expect(hasProduce(animal(), at)).toBe(productionAt(animal(), at).cyclesOwed > 0);
    }
  });

  it('is false for an unfed animal that has been waiting for weeks', () => {
    expect(hasProduce(animal({ fedUntil: null }), T0 + 30 * DAY)).toBe(false);
  });
});

describe('reading production does not change it', () => {
  it('gives the same answer however many times it is asked', () => {
    const a = animal();
    const at = T0 + 4 * CHICKEN.productionIntervalMs;
    const first = productionAt(a, at);

    for (let i = 0; i < 5; i++) expect(productionAt(a, at)).toEqual(first);
  });
});
