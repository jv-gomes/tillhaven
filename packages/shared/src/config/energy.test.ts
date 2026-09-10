import { describe, expect, it } from 'vitest';
import {
  ENERGY_BASE,
  ENERGY_COST,
  ENERGY_LEVELS_PER_STEP,
  ENERGY_PER_STEP,
  EnergyAction,
  SLEEP_DURATION_MS,
  energyCapForLevel,
  energyRecovered,
  energySpentAfterSleep,
  energyStateAt,
} from './energy.js';
import { MAX_FARM_LEVEL } from './level.js';
import { STARTING_PLOTS } from './economy.js';
import { MINUTE } from './time.js';

/**
 * Energy (MVP re-scope).
 *
 * Everything here is arithmetic over two stored numbers, so it is all
 * testable without a database — which is the point of computing it on read
 * rather than ticking it.
 */

const awake = (spent: number) => ({ energySpent: spent, sleepingSince: null });

describe('the energy cap', () => {
  it('starts at the base and rises a step every ten levels', () => {
    expect(energyCapForLevel(1)).toBe(ENERGY_BASE);
    expect(energyCapForLevel(10)).toBe(ENERGY_BASE);
    expect(energyCapForLevel(11)).toBe(ENERGY_BASE + ENERGY_PER_STEP);
    expect(energyCapForLevel(20)).toBe(ENERGY_BASE + ENERGY_PER_STEP);
    expect(energyCapForLevel(21)).toBe(ENERGY_BASE + ENERGY_PER_STEP * 2);
  });

  /**
   * The exact boundary, because "every ten levels" has two readings and only
   * one of them makes level 11 the first raise.
   */
  it('raises the cap on the eleventh level, not the tenth', () => {
    expect(energyCapForLevel(ENERGY_LEVELS_PER_STEP)).toBe(ENERGY_BASE);
    expect(energyCapForLevel(ENERGY_LEVELS_PER_STEP + 1)).toBeGreaterThan(ENERGY_BASE);
  });

  it('never falls as the level rises', () => {
    for (let level = 1; level < MAX_FARM_LEVEL; level++) {
      expect(energyCapForLevel(level + 1), `level ${level + 1}`).toBeGreaterThanOrEqual(
        energyCapForLevel(level),
      );
    }
  });

  it('is an integer at every level', () => {
    for (let level = 1; level <= MAX_FARM_LEVEL; level++) {
      expect(Number.isInteger(energyCapForLevel(level)), `level ${level}`).toBe(true);
    }
  });

  /**
   * **A limit that dissolves as you level is not a limit.** At the level cap
   * the bar must still be the same order of magnitude as at level 1 — the
   * thing that makes a big farm big is plot expansion, not stamina.
   */
  it('does not grow into irrelevance by the level cap', () => {
    expect(energyCapForLevel(MAX_FARM_LEVEL)).toBeLessThanOrEqual(ENERGY_BASE * 2);
  });

  it('treats nonsense as level 1 rather than throwing', () => {
    for (const level of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(energyCapForLevel(level), String(level)).toBe(ENERGY_BASE);
    }
  });
});

describe('what the opening costs', () => {
  /**
   * **The number the base cap was chosen against.** Tilling, planting and
   * watering all six starting plots is one full pass over a new farm, and it
   * has to fit — the brief asks that a new player *"cannot do very much"*, not
   * that they cannot finish what the tutorial line tells them to do.
   */
  it('lets a new farmer work every starting plot exactly once', () => {
    const pass =
      STARTING_PLOTS *
      (ENERGY_COST[EnergyAction.TILL] +
        ENERGY_COST[EnergyAction.PLANT] +
        ENERGY_COST[EnergyAction.WATER]);

    expect(pass, `a full pass costs ${pass}`).toBeLessThanOrEqual(energyCapForLevel(1));
  });

  /** ...and not much more than once. A limit has to bind somewhere. */
  it('does not let them do it twice', () => {
    const pass =
      STARTING_PLOTS *
      (ENERGY_COST[EnergyAction.TILL] +
        ENERGY_COST[EnergyAction.PLANT] +
        ENERGY_COST[EnergyAction.WATER]);

    expect(pass * 2).toBeGreaterThan(energyCapForLevel(1));
  });

  it('prices every action as a positive integer', () => {
    for (const [action, cost] of Object.entries(ENERGY_COST)) {
      expect(Number.isInteger(cost), action).toBe(true);
      expect(cost, action).toBeGreaterThan(0);
    }
  });

  /**
   * Collecting on work already done must not cost more than starting it.
   * A player who cannot afford to pick a ripe crop is being punished for
   * having farmed well.
   */
  it('never charges more to finish work than to start it', () => {
    for (const reward of [EnergyAction.HARVEST, EnergyAction.COLLECT]) {
      for (const labour of [EnergyAction.TILL, EnergyAction.PLANT, EnergyAction.WATER]) {
        expect(ENERGY_COST[reward], `${reward} vs ${labour}`).toBeLessThanOrEqual(
          ENERGY_COST[labour],
        );
      }
    }
  });
});

describe('sleep', () => {
  it('gives back nothing before any time has passed', () => {
    expect(energyRecovered(0, 40)).toBe(0);
    expect(energyRecovered(-1000, 40)).toBe(0);
  });

  it('gives back the whole bar after the full duration', () => {
    expect(energyRecovered(SLEEP_DURATION_MS, 40)).toBe(40);
  });

  it('gives back proportionally in between, rounded down', () => {
    expect(energyRecovered(SLEEP_DURATION_MS / 2, 40)).toBe(20);
    // 40 * (1/3) = 13.33 -> 13. Never round up: a player must not gain a point
    // they have not fully slept for.
    expect(energyRecovered(SLEEP_DURATION_MS / 3, 40)).toBe(13);
  });

  it('never gives back more than the bar, however long they lie there', () => {
    expect(energyRecovered(SLEEP_DURATION_MS * 100, 40)).toBe(40);
  });
});

describe('energyStateAt', () => {
  it('reports a full bar for a rested farmer', () => {
    expect(energyStateAt(awake(0), 1, 0)).toEqual({
      current: ENERGY_BASE,
      max: ENERGY_BASE,
      isSleeping: false,
      fullInMs: 0,
    });
  });

  it('subtracts what has been spent', () => {
    expect(energyStateAt(awake(15), 1, 0).current).toBe(ENERGY_BASE - 15);
  });

  /**
   * A cap that FALLS is not reachable today — the cap only rises with level
   * and level only rises — but clamping costs one `Math.min` and the
   * alternative is a negative energy bar if it ever does.
   */
  it('never reports negative energy, even if spending outran the cap', () => {
    expect(energyStateAt(awake(9999), 1, 0).current).toBe(0);
  });

  it('fills the bar while asleep, without anything having run', () => {
    const row = { energySpent: ENERGY_BASE, sleepingSince: 0 };

    expect(energyStateAt(row, 1, 0).current).toBe(0);
    expect(energyStateAt(row, 1, SLEEP_DURATION_MS / 2).current).toBe(ENERGY_BASE / 2);
    expect(energyStateAt(row, 1, SLEEP_DURATION_MS).current).toBe(ENERGY_BASE);
  });

  it('counts down to a full bar, and stops at zero once full', () => {
    const row = { energySpent: ENERGY_BASE, sleepingSince: 0 };

    expect(energyStateAt(row, 1, 0).fullInMs).toBe(SLEEP_DURATION_MS);
    expect(energyStateAt(row, 1, 4 * MINUTE).fullInMs).toBe(SLEEP_DURATION_MS - 4 * MINUTE);
    expect(energyStateAt(row, 1, SLEEP_DURATION_MS).fullInMs).toBe(0);
  });

  /**
   * Sleeping with a nearly-full bar reaches full early, and the countdown must
   * say so rather than promising ten more minutes of nothing.
   */
  it('reports full immediately when there was nothing to recover', () => {
    const state = energyStateAt({ energySpent: 0, sleepingSince: 0 }, 1, 1000);

    expect(state.current).toBe(ENERGY_BASE);
    expect(state.fullInMs).toBe(0);
  });

  it('never exceeds the cap while asleep', () => {
    const row = { energySpent: 5, sleepingSince: 0 };
    expect(energyStateAt(row, 1, SLEEP_DURATION_MS * 10).current).toBe(ENERGY_BASE);
  });

  it('uses the level to size the bar', () => {
    expect(energyStateAt(awake(0), 21, 0).max).toBe(energyCapForLevel(21));
  });
});

describe('energySpentAfterSleep', () => {
  /**
   * Waking BANKS the recovery. Without this the row would keep a
   * `sleepingSince` that is about to be cleared, and clearing it would throw
   * away everything the player slept for.
   */
  it('banks a full night as nothing spent', () => {
    const row = { energySpent: ENERGY_BASE, sleepingSince: 0 };
    expect(energySpentAfterSleep(row, 1, SLEEP_DURATION_MS)).toBe(0);
  });

  it('banks a partial night proportionally', () => {
    const row = { energySpent: ENERGY_BASE, sleepingSince: 0 };
    expect(energySpentAfterSleep(row, 1, SLEEP_DURATION_MS / 2)).toBe(ENERGY_BASE / 2);
  });

  it('is a no-op for someone who was not asleep', () => {
    expect(energySpentAfterSleep(awake(12), 1, 99_999)).toBe(12);
  });
});
