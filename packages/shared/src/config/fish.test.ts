import { describe, it, expect } from 'vitest';
import { CROPS } from './crops.js';
import { ITEMS } from './items.js';
import { Season, SEASONS } from './season.js';
import {
  FISH,
  FISH_IDS,
  RAREST_MAX_ODDS,
  RAREST_MIN_ODDS,
  expectedValue,
  fishById,
  fishFor,
  oddsOf,
  rollFish,
  totalWeight,
} from './fish.js';

/**
 * T-34.01. The fish table.
 *
 * Two things here can only be checked as numbers rather than argued in a
 * comment: whether the rarest fish is rare enough to be exciting but not so
 * rare it is a lottery, and whether fishing pays enough to be worth doing
 * without paying so much that nobody farms.
 */
describe('every fish', () => {
  const fish = FISH.map((f) => [f.id, f] as const);

  it('has a unique id', () => {
    expect(new Set(FISH_IDS).size).toBe(FISH_IDS.length);
  });

  /**
   * A weight of zero is a fish that exists only in this file. `rollFish` walks
   * cumulative weights, so it would never be reached and nobody would notice.
   */
  it.each(fish)('%s can actually be caught', (_id, f) => {
    expect(f.weight, `${f.id} has no weight`).toBeGreaterThan(0);
  });

  it.each(fish)('%s is worth whole gold', (_id, f) => {
    expect(Number.isInteger(f.sellPrice), `${f.id} has a fractional price`).toBe(true);
    expect(f.sellPrice, f.id).toBeGreaterThan(0);
  });

  it.each(fish)('%s bites in at least one season', (_id, f) => {
    expect(f.seasons.length, `${f.id} bites in no season`).toBeGreaterThan(0);
    for (const s of f.seasons) expect(SEASONS).toContain(s);
  });

  it.each(fish)('%s fights on the 1-5 scale', (_id, f) => {
    expect(f.difficulty).toBeGreaterThanOrEqual(1);
    expect(f.difficulty).toBeLessThanOrEqual(5);
  });

  it.each(fish)('%s unlocks at a real farm level', (_id, f) => {
    expect(Number.isInteger(f.unlockLevel)).toBe(true);
    expect(f.unlockLevel).toBeGreaterThanOrEqual(1);
  });

  /**
   * **Value and rarity must move together.** A common fish worth more than a
   * rare one makes the rare one a disappointment, which is the one thing a
   * rarity system must never produce.
   */
  it('never pays more for a commoner fish than for a rarer one', () => {
    /*
     * **Every cross-band pair, not just adjacent ones.** The first version
     * walked the weight-sorted list and compared neighbours, which only ever
     * checks the pair either side of a band boundary — a common fish priced
     * like a rare one three bands away would sail through. It still caught the
     * Golden Fish inversion, by luck of where that fish sat.
     */
    for (const rarer of FISH) {
      for (const commoner of FISH) {
        if (commoner.weight <= rarer.weight) continue;
        expect(
          rarer.sellPrice,
          `${rarer.id} (weight ${rarer.weight}) pays ${rarer.sellPrice}, but the commoner ` +
            `${commoner.id} (weight ${commoner.weight}) pays ${commoner.sellPrice}`,
        ).toBeGreaterThan(commoner.sellPrice);
      }
    }
  });

  it('makes the rarer fish fight at least as hard', () => {
    const sorted = [...FISH].sort((a, b) => b.weight - a.weight);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.difficulty).toBeGreaterThanOrEqual(sorted[i - 1]!.difficulty);
    }
  });
});

/**
 * **"Genuinely rare without being a slot machine", as a number.**
 *
 * Measured against the FULL table, which is the state a player reaches at the
 * level the rarest fish unlocks — the odds on the way there are better, never
 * worse, because a level gate can only remove competitors.
 */
describe('the rarest fish', () => {
  const table = fishFor(99, Season.SPRING);
  const rarest = [...table].sort((a, b) => a.weight - b.weight)[0]!;

  it('is rare enough to be worth telling somebody about', () => {
    expect(oddsOf(rarest, table)).toBeLessThan(RAREST_MAX_ODDS);
  });

  it('is not so rare that fishing for it is pulling a lever', () => {
    const odds = oddsOf(rarest, table);
    expect(
      odds,
      `${rarest.id} is 1 in ${Math.round(1 / odds)} — past the point where a ` +
        'dedicated session can expect to see one',
    ).toBeGreaterThan(RAREST_MIN_ODDS);
  });

  it('is the most valuable thing in the river', () => {
    expect(rarest.sellPrice).toBe(Math.max(...FISH.map((f) => f.sellPrice)));
  });
});

describe('fishFor', () => {
  it('gives a brand-new farm something to catch', () => {
    const table = fishFor(1, Season.SPRING);
    expect(table.length).toBeGreaterThan(0);
    expect(totalWeight(table)).toBeGreaterThan(0);
  });

  it('never offers a fish above the farm level', () => {
    for (const level of [1, 3, 5, 9, 40]) {
      for (const f of fishFor(level, Season.SPRING)) {
        expect(f.unlockLevel).toBeLessThanOrEqual(level);
      }
    }
  });

  it('opens up rather than closing down as the farm grows', () => {
    let previous = 0;
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const n = fishFor(level, Season.SPRING).length;
      expect(n).toBeGreaterThanOrEqual(previous);
      previous = n;
    }
  });

  /**
   * **No season may be a dead pond.** The field is unenforced today, so an
   * empty season would surface only when Phase 35 turned it on — by which point
   * the table would have drifted for a phase or two with nobody able to see it.
   */
  it.each(SEASONS)('leaves %s worth fishing in', (season) => {
    const table = fishFor(99, season);
    expect(table.length, `${season} has ${table.length} fish`).toBeGreaterThanOrEqual(6);
  });

  it('gives a new farm fish in every season, not only spring', () => {
    for (const season of SEASONS) {
      expect(fishFor(1, season).length, `a level-1 farm cannot fish in ${season}`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe('rollFish', () => {
  it('always returns something from the table it was given', () => {
    const table = fishFor(99, Season.SPRING);
    for (let n = 0; n < 500; n++) {
      const caught = rollFish(12345, n, table);
      expect(caught).toBeDefined();
      expect(table).toContain(caught);
    }
  });

  it('returns nothing from an empty river rather than throwing', () => {
    expect(rollFish(1, 0, [])).toBeUndefined();
  });

  it('is deterministic — the same seed and counter catch the same fish', () => {
    const table = fishFor(99, Season.SPRING);
    expect(rollFish(999, 7, table)).toBe(rollFish(999, 7, table));
  });

  /**
   * **Weighted, not uniform.** The failure this guards is `rollFish` reaching
   * for `pick` — which is uniform over a count — and making the Golden Fish as
   * likely as a Carp. Over ten thousand rolls the commonest fish must come up
   * far more often than the rarest.
   */
  it('respects the weights rather than drawing uniformly', () => {
    const table = fishFor(99, Season.SPRING);
    const counts = new Map<string, number>();
    for (let n = 0; n < 10_000; n++) {
      const f = rollFish(4242, n, table)!;
      counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
    }

    const commonest = [...table].sort((a, b) => b.weight - a.weight)[0]!;
    const rarest = [...table].sort((a, b) => a.weight - b.weight)[0]!;

    expect(counts.get(commonest.id) ?? 0).toBeGreaterThan((counts.get(rarest.id) ?? 0) * 5);

    // And the observed frequency should be near the declared weight — within a
    // wide band, since this is a sample and not a proof.
    const observed = (counts.get(commonest.id) ?? 0) / 10_000;
    const declared = oddsOf(commonest, table);
    expect(Math.abs(observed - declared)).toBeLessThan(0.03);
  });
});

/**
 * **Sell prices sit inside the economy band**, which is the task's third
 * requirement and the one that needs a definition before it can be checked.
 *
 * The band is the crops', because that is what a player is choosing between:
 * the cheapest crop sells for 9g and the dearest for 566g. A fish outside that
 * range is either not worth the walk or is the whole game.
 */
describe('fish prices against the crop economy', () => {
  const cropPrices = Object.values(CROPS).map(
    (c) => ITEMS[c.produceItemId]?.shopSellPrice ?? 0,
  );
  const floor = Math.min(...cropPrices);
  const ceiling = Math.max(...cropPrices);

  it.each(FISH.map((f) => [f.id, f] as const))('%s is priced inside the crop band', (_id, f) => {
    expect(f.sellPrice, `${f.id} is cheaper than the cheapest crop`).toBeGreaterThanOrEqual(floor);
    expect(f.sellPrice, `${f.id} is dearer than the dearest crop`).toBeLessThanOrEqual(ceiling);
  });

  /**
   * **What one cast is worth.** Fishing is active play, so it should pay better
   * than a single idle plot and worse than a whole farm — otherwise it is
   * either not worth the attention or it replaces the game it is attached to.
   * T-34.09 balances this properly against a real cast duration; this is the
   * guard that stops a price edit from moving it by an order of magnitude in
   * the meantime.
   */
  it('pays a sane amount per cast at every level', () => {
    for (const level of [1, 3, 5, 7, 9, 40]) {
      const ev = expectedValue(fishFor(level, Season.SPRING));
      expect(ev, `level ${level} expects ${ev.toFixed(1)}g a cast`).toBeGreaterThan(20);
      expect(ev, `level ${level} expects ${ev.toFixed(1)}g a cast`).toBeLessThan(150);
    }
  });

  /**
   * Fishing should get better as the farm does, or a levelled player has no
   * reason to pick the rod up again.
   */
  it('is worth more per cast as the farm levels', () => {
    let previous = 0;
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const ev = expectedValue(fishFor(level, Season.SPRING));
      expect(ev, `level ${level} pays less than level ${level - 1}`).toBeGreaterThanOrEqual(
        previous,
      );
      previous = ev;
    }
  });
});

describe('fishById', () => {
  it('finds every fish it lists', () => {
    for (const id of FISH_IDS) expect(fishById(id)?.id).toBe(id);
  });

  it('refuses an id it does not know', () => {
    expect(fishById('kraken')).toBeUndefined();
  });
});
