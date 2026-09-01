import { describe, it, expect } from 'vitest';
import { CROP_IDS, CROPS } from './crops.js';
import {
  IDLE_ACTION_MS,
  IDLE_MAX_CATCHUP_ACTIONS,
  IDLE_MAX_CATCHUP_MS,
  IDLE_TASK_TYPES,
  IdleTask,
  idleActionsIn,
  isIdleTask,
} from './idle.js';
import { HOUR, MINUTE, SECOND } from './time.js';

/**
 * T-13.01. Nothing simulates yet — these pin the shape the simulator (T-13.03)
 * and the settings endpoint (T-13.02) are about to be written against, and the
 * two properties of the time model that a wrong number would break silently.
 */
describe('idle task types', () => {
  it('is exactly the four verbs of the farming loop, in dependency order', () => {
    expect(IDLE_TASK_TYPES).toEqual(['till', 'plant', 'water', 'harvest']);
  });

  it('lists every member of IdleTask exactly once', () => {
    expect(new Set(IDLE_TASK_TYPES).size).toBe(IDLE_TASK_TYPES.length);
    expect([...IDLE_TASK_TYPES].sort()).toEqual(Object.values(IdleTask).sort());
  });

  /**
   * The narrowing the endpoint's Zod schema will lean on. A guard that says yes
   * to anything is worse than no guard, because it looks like one.
   */
  it('accepts only the listed tasks', () => {
    for (const task of IDLE_TASK_TYPES) expect(isIdleTask(task)).toBe(true);

    for (const bogus of ['chop', 'mine', 'TILL', '', 'till ', 'sell']) {
      expect(isIdleTask(bogus), bogus).toBe(false);
    }
  });

  /**
   * The order is not decoration: the simulator works down it, and you cannot
   * plant ground you have not tilled or water a seed you have not planted.
   */
  it('puts till before plant, and plant before water', () => {
    const at = (task: IdleTask) => IDLE_TASK_TYPES.indexOf(task);
    expect(at('till')).toBeLessThan(at('plant'));
    expect(at('plant')).toBeLessThan(at('water'));
    expect(at('water')).toBeLessThan(at('harvest'));
  });
});

describe('idle timing', () => {
  it('is a whole number of milliseconds, and slower than doing it yourself', () => {
    expect(Number.isInteger(IDLE_ACTION_MS)).toBe(true);
    expect(IDLE_ACTION_MS).toBe(10 * SECOND);
    // A present player acts about once a second, so idling has to cost
    // something — this is the entire balance lever for the feature.
    expect(IDLE_ACTION_MS).toBeGreaterThanOrEqual(5 * SECOND);
  });

  /**
   * The cap exists so one read cannot ask the simulator for a year of steps
   * inside an open transaction, on the hottest path in the game. It still has
   * to cover the absence the feature is for: a night's sleep.
   */
  it('caps catch-up at a bounded number of actions, but at least a night of them', () => {
    expect(Number.isInteger(IDLE_MAX_CATCHUP_ACTIONS)).toBe(true);
    expect(IDLE_MAX_CATCHUP_MS).toBe(IDLE_MAX_CATCHUP_ACTIONS * IDLE_ACTION_MS);
    expect(IDLE_MAX_CATCHUP_MS).toBeGreaterThan(8 * HOUR);
    expect(IDLE_MAX_CATCHUP_MS).toBeLessThan(48 * HOUR);
  });
});

describe('idleActionsIn', () => {
  it('counts only actions that finished', () => {
    expect(idleActionsIn(0)).toBe(0);
    expect(idleActionsIn(IDLE_ACTION_MS - 1)).toBe(0);
    expect(idleActionsIn(IDLE_ACTION_MS)).toBe(1);
    expect(idleActionsIn(IDLE_ACTION_MS * 2.9)).toBe(2);
    expect(idleActionsIn(MINUTE)).toBe(MINUTE / IDLE_ACTION_MS);
  });

  /**
   * A watermark ahead of `now` is not hypothetical — a server clock adjustment
   * produces one — and a negative count would run the simulator backwards.
   */
  it('is zero for a window that has not happened', () => {
    expect(idleActionsIn(-1)).toBe(0);
    expect(idleActionsIn(-HOUR)).toBe(0);
    expect(idleActionsIn(Number.NaN)).toBe(0);
    expect(idleActionsIn(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('clamps a long absence to the catch-up cap rather than growing without bound', () => {
    expect(idleActionsIn(IDLE_MAX_CATCHUP_MS)).toBe(IDLE_MAX_CATCHUP_ACTIONS);
    expect(idleActionsIn(IDLE_MAX_CATCHUP_MS * 1000)).toBe(IDLE_MAX_CATCHUP_ACTIONS);
    expect(idleActionsIn(365 * 24 * HOUR)).toBe(IDLE_MAX_CATCHUP_ACTIONS);
  });
});

/**
 * `farms.idle_crop_id` holds a crop id and is not a foreign key — crops live in
 * config, not in a table — so the only thing that can keep it honest is the
 * endpoint validating against this list.
 */
describe('idle crop selection', () => {
  it('has a non-empty set of crops to choose from', () => {
    expect(CROP_IDS.length).toBeGreaterThan(0);
    for (const id of CROP_IDS) expect(CROPS[id]).toBeDefined();
  });
});
