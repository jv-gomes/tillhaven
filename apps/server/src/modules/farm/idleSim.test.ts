import { describe, it, expect } from 'vitest';
import {
  CROPS,
  CROP_IDS,
  DAY,
  ENERGY_BASE,
  ENERGY_COST,
  EnergyAction,
  HOUR,
  SLEEP_DURATION_MS,
  IDLE_ACTION_MS,
  IDLE_MAX_CATCHUP_ACTIONS,
  MINUTE,
  WATER_DURATION_MS,
  TREE_REGROW_MS,
  WOOD_PER_TREE,
  getItem,
  idleActionsIn,
} from '@tillhaven/shared';
import { effectiveGrowthMs, settleGrowth } from './growth.js';
import { addToSlots, countInSlots, type SlotContents } from '../inventory/service.js';
import {
  nextIdleAction,
  simulate,
  type SimInput,
  type SimPlot,
  type SimTree,
} from './idleSim.js';

/**
 * T-13.03a — the pure simulator, till and plant.
 *
 * Everything here is arithmetic on a fake clock; no database, no `Date.now()`.
 * The properties worth defending are that it is DETERMINISTIC (the same window
 * must never pay out twice differently), that it agrees with shared config
 * about how many actions fit in a window, and that it obeys the player's task
 * selection exactly — a farmer told only to till must never touch a seed.
 */

const CROP = CROP_IDS[0]!;
const SEED = CROPS[CROP].seedItemId;
const PRODUCE = CROPS[CROP].produceItemId;
const T0 = 1_700_000_000_000;
/** Bigger than any bag under test, so `bag()` never has to think about limits. */
const ROOMY = 200;

/**
 * A backpack holding these counts, packed the way the real one would be.
 *
 * Built through `addToSlots` rather than by hand so the fixtures obey stack
 * limits — a hand-written slot of 999 seeds is not a bag any player can have,
 * and a test that starts from an impossible state proves nothing.
 */
function bag(counts: Record<string, number>, capacity = ROOMY): SlotContents[] {
  let slots: SlotContents[] = [];
  for (const [itemId, quantity] of Object.entries(counts)) {
    const def = getItem(itemId)!;
    slots = addToSlots(slots, itemId, quantity, def.stackLimit, capacity)!;
  }
  return slots;
}

const held = (items: readonly SlotContents[], itemId: string) => countInSlots(items, itemId);

function plot(id: string, over: Partial<SimPlot> = {}): SimPlot {
  return {
    id,
    unlocked: true,
    tilledAt: null,
    cropId: null,
    plantedAt: null,
    growthDurationMs: null,
    wateredAt: null,
    grownMs: 0,
    ...over,
  };
}

function input(over: Partial<SimInput> = {}): SimInput {
  return {
    plots: [plot('a')],
    items: bag({ [SEED]: 10 }),
    capacity: ROOMY,
    tasks: ['till', 'plant'],
    cropId: CROP,
    from: T0,
    to: T0 + 10 * IDLE_ACTION_MS,
    ...over,
  };
}

/** Just the shape a reader cares about: what happened, in order. */
function log(result: { actions: readonly { kind: string; plotId?: string }[] }) {
  return result.actions.map((a) => `${a.kind}:${a.plotId}`);
}

describe('simulate — the action loop', () => {
  it('tills a plot and then sows it', () => {
    const result = simulate(input({ to: T0 + 2 * IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['till:a', 'plant:a']);
    expect(result.plots[0]!.cropId).toBe(CROP);
    expect(result.plots[0]!.plantedAt).toBe(T0 + 2 * IDLE_ACTION_MS);
    expect(held(result.items, SEED)).toBe(9);
  });

  /**
   * An action that has not finished has not happened. The first one lands one
   * whole cadence into the window, which is what makes the count agree with
   * `idleActionsIn` — the number the applier will size its watermark by.
   */
  it('lands the first action one full cadence in, not at `from`', () => {
    const result = simulate(input({ to: T0 + IDLE_ACTION_MS }));

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.at).toBe(T0 + IDLE_ACTION_MS);
  });

  it('does nothing in a window too short for one action', () => {
    const result = simulate(input({ to: T0 + IDLE_ACTION_MS - 1 }));

    expect(result.actions).toEqual([]);
    expect(result.stoppedReason).toBe('window_end');
  });

  it('does nothing in an empty window', () => {
    expect(simulate(input({ to: T0 })).actions).toEqual([]);
  });

  /**
   * The sim and shared config must agree about how many actions fit in a
   * window: the applier watermarks with one and sizes expectations with the
   * other, and a disagreement is either lost work or work paid twice.
   */
  it('never fits more actions in a window than `idleActionsIn` says', () => {
    const plots = Array.from({ length: 40 }, (_, i) => plot(`p${i}`));

    for (const minutes of [0, 1, 7, 60, 600]) {
      const to = T0 + minutes * MINUTE;
      const result = simulate(input({ plots, to, items: bag({ [SEED]: 999 }) }));

      expect(result.actions.length, `${minutes}m`).toBeLessThanOrEqual(
        idleActionsIn(to - T0),
      );
    }
  });

  it('spaces every action exactly one cadence apart', () => {
    const plots = Array.from({ length: 6 }, (_, i) => plot(`p${i}`));
    const result = simulate(input({ plots, to: T0 + 12 * IDLE_ACTION_MS }));

    result.actions.forEach((action, i) => {
      expect(action.at).toBe(T0 + (i + 1) * IDLE_ACTION_MS);
    });
  });

  it('leaves the caller’s input untouched', () => {
    const plots = [plot('a')];
    const items = bag({ [SEED]: 3 });
    const before = structuredClone({ plots, items });

    simulate(input({ plots, items }));

    expect({ plots, items }).toEqual(before);
  });
});

describe('simulate — priority', () => {
  /**
   * Planting outranks tilling: a farmer that broke the whole field before
   * sowing anything would leave every seed in the bag for an hour on a
   * twenty-plot farm, and only growing crops pay.
   */
  it('sows the ground it just broke before breaking more', () => {
    const result = simulate(input({ plots: [plot('a'), plot('b')], to: T0 + 4 * IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['till:a', 'plant:a', 'till:b', 'plant:b']);
  });

  it('works plots in the order it was given them', () => {
    const plots = [plot('c'), plot('a'), plot('b')];
    const result = simulate(input({ plots, to: T0 + 6 * IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['till:c', 'plant:c', 'till:a', 'plant:a', 'till:b', 'plant:b']);
  });

  it('plants an already-tilled plot before tilling a fresh one', () => {
    const plots = [plot('fresh'), plot('ready', { tilledAt: T0 - MINUTE })];
    const result = simulate(input({ plots, to: T0 + IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['plant:ready']);
  });
});

describe('simulate — the task selection is obeyed exactly', () => {
  it('never plants when told only to till', () => {
    const result = simulate(input({ tasks: ['till'], to: T0 + 6 * IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['till:a']);
    expect(held(result.items, SEED)).toBe(10);
    expect(result.plots[0]!.cropId).toBeNull();
    expect(result.stoppedReason).toBe('nothing_to_do');
  });

  it('never tills when told only to plant', () => {
    const result = simulate(input({ tasks: ['plant'], to: T0 + 6 * IDLE_ACTION_MS }));

    expect(result.actions).toEqual([]);
    expect(result.plots[0]!.tilledAt).toBeNull();
  });

  it('plants but does not till, when the ground is already tilled', () => {
    const plots = [plot('a', { tilledAt: T0 - MINUTE }), plot('b')];
    const result = simulate(input({ plots, tasks: ['plant'], to: T0 + 6 * IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['plant:a']);
    expect(result.plots[1]!.tilledAt).toBeNull();
  });

  it('does nothing at all when no task is chosen', () => {
    const result = simulate(input({ tasks: [] }));

    expect(result.actions).toEqual([]);
    expect(result.stoppedReason).toBe('nothing_to_do');
  });
});

describe('simulate — running out of things to work with', () => {
  it('stops sowing when the seeds run out, and keeps tilling', () => {
    const plots = [plot('a'), plot('b'), plot('c')];
    const result = simulate(input({ plots, items: bag({ [SEED]: 1 }), to: T0 + 20 * IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['till:a', 'plant:a', 'till:b', 'till:c']);
    expect(held(result.items, SEED)).toBe(0);
    expect(result.stoppedReason).toBe('nothing_to_do');
  });

  it('never sows a seed it does not hold', () => {
    const result = simulate(input({ items: bag({}), to: T0 + 20 * IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['till:a']);
    expect(held(result.items, SEED)).toBe(0);
  });

  it('sows nothing when no crop is chosen — a real setting, not an error', () => {
    const result = simulate(input({ cropId: null, to: T0 + 20 * IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['till:a']);
    expect(held(result.items, SEED)).toBe(10);
  });

  it('ignores locked plots entirely', () => {
    const plots = [plot('locked', { unlocked: false }), plot('mine')];
    const result = simulate(input({ plots, to: T0 + 20 * IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['till:mine', 'plant:mine']);
    expect(result.plots[0]!.tilledAt).toBeNull();
  });

  it('leaves a plot that already has something growing alone', () => {
    const busy = plot('busy', {
      tilledAt: T0 - MINUTE,
      cropId: CROP,
      plantedAt: T0 - MINUTE,
      growthDurationMs: CROPS[CROP].growthDurationMs,
    });
    const result = simulate(input({ plots: [busy], to: T0 + 20 * IDLE_ACTION_MS }));

    expect(result.actions).toEqual([]);
    expect(result.plots[0]).toEqual(busy);
  });
});

describe('simulate — the watermark it hands back', () => {
  it('settles the whole window when there was nothing left to do', () => {
    const to = T0 + 100 * IDLE_ACTION_MS;
    const result = simulate(input({ to }));

    expect(result.stoppedReason).toBe('nothing_to_do');
    // The empty stretch is accounted for, or every poll would re-simulate it.
    expect(result.processedTo).toBe(to);
  });

  it('stops short at the last action when it hits the action cap', () => {
    const plots = Array.from({ length: 50 }, (_, i) => plot(`p${i}`));
    const to = T0 + 1000 * IDLE_ACTION_MS;
    const result = simulate(input({ plots, to, items: bag({ [SEED]: 999 }), maxActions: 5 }));

    expect(result.actions).toHaveLength(5);
    expect(result.stoppedReason).toBe('action_cap');
    expect(result.processedTo).toBe(T0 + 5 * IDLE_ACTION_MS);
    expect(result.processedTo).toBeLessThan(to);
  });

  it('defaults the cap to the shared config constant', () => {
    expect(IDLE_MAX_CATCHUP_ACTIONS).toBeGreaterThan(0);
    const plots = Array.from({ length: 4 }, (_, i) => plot(`p${i}`));
    // Far more time than actions available, so the cap is not what stops it.
    const result = simulate(input({ plots, to: T0 + 1e9 }));

    expect(result.actions.length).toBeLessThan(IDLE_MAX_CATCHUP_ACTIONS);
    expect(result.stoppedReason).toBe('nothing_to_do');
  });

  /**
   * A window that runs backwards is what a clock adjustment produces. It must
   * settle nothing rather than hand the applier a watermark pointing into the
   * past — that would reopen a stretch already paid for.
   */
  it('never moves the watermark before where it started', () => {
    for (const to of [T0 - 1, T0 - MINUTE, T0 - 365 * 24 * 60 * MINUTE]) {
      const result = simulate(input({ to }));

      expect(result.actions).toEqual([]);
      expect(result.processedTo).toBe(T0);
    }
  });
});

describe('simulate — determinism', () => {
  it('returns a deep-equal result for the same input, twice', () => {
    const plots = Array.from({ length: 12 }, (_, i) =>
      plot(`p${i}`, i % 3 === 0 ? { tilledAt: T0 - MINUTE } : {}),
    );
    const args = input({ plots, items: bag({ [SEED]: 7 }), to: T0 + 3 * 60 * MINUTE });

    expect(simulate(args)).toEqual(simulate(args));
  });

  /**
   * Determinism across a long gap is the case that actually matters: the whole
   * point of the feature is a farm simulated after days offline.
   */
  it('is deterministic across a three-day window', () => {
    const plots = Array.from({ length: 20 }, (_, i) => plot(`p${i}`));
    const args = input({
      plots,
      items: bag({ [SEED]: 20 }),
      to: T0 + 3 * 24 * 60 * MINUTE,
    });

    const a = simulate(args);
    const b = simulate(args);

    expect(a).toEqual(b);
    expect(a.actions).toHaveLength(40);
  });

  it('does not depend on how the item record was built', () => {
    const a = simulate(input({ items: bag({ [SEED]: 2, [PRODUCE]: 5 }) }));
    const b = simulate(input({ items: bag({ [PRODUCE]: 5, [SEED]: 2 }) }));

    expect(a.actions).toEqual(b.actions);
    expect(a.plots).toEqual(b.plots);
  });
});

/* ------------------------------------------------------------------ *
 * T-13.03b — watering
 * ------------------------------------------------------------------ */

const ONION = 'onion';
const ONION_MS = CROPS[ONION].growthDurationMs; // 8h — needs two wet windows.

/** A plot with something already growing in it, dry unless told otherwise. */
function growing(id: string, over: Partial<SimPlot> = {}): SimPlot {
  return plot(id, {
    tilledAt: T0 - MINUTE,
    cropId: ONION,
    plantedAt: T0,
    growthDurationMs: ONION_MS,
    ...over,
  });
}

describe('simulate — watering', () => {
  it('waters a dry crop and banks nothing, because nothing had been earned', () => {
    const result = simulate(
      input({ plots: [growing('a')], tasks: ['water'], to: T0 + IDLE_ACTION_MS }),
    );

    expect(log(result)).toEqual(['water:a']);
    expect(result.plots[0]!.wateredAt).toBe(T0 + IDLE_ACTION_MS);
    expect(result.plots[0]!.grownMs).toBe(0);
  });

  /**
   * The headline property: one crop stays wet for a whole window, and the only
   * growth lost is the cadence gap before the first watering. Asserted with
   * exact arithmetic through `effectiveGrowthMs` — the same function the live
   * farm reads — rather than against a number typed in here.
   */
  it('keeps one crop wet across a long window, losing exactly the cadence gap', () => {
    const to = T0 + ONION_MS;
    const result = simulate(input({ plots: [growing('a')], tasks: ['water'], to }));

    // Dry at T0, watered at the first slot, then re-watered the instant each
    // 4h window expires — which is itself on the grid, so nothing more is lost.
    expect(result.actions.map((a) => a.at)).toEqual([
      T0 + IDLE_ACTION_MS,
      T0 + IDLE_ACTION_MS + WATER_DURATION_MS,
    ]);
    expect(effectiveGrowthMs(result.plots[0]!, to)).toBe(to - T0 - IDLE_ACTION_MS);
  });

  it('re-waters on the first slot at or after the soil dries, not before', () => {
    const wet = growing('a', { wateredAt: T0 });
    const result = simulate(
      input({ plots: [wet], tasks: ['water'], to: T0 + WATER_DURATION_MS + IDLE_ACTION_MS }),
    );

    // Nothing at all until the window expires — watering wet soil buys nothing.
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.at).toBe(T0 + WATER_DURATION_MS);
  });

  /**
   * The pause is only ever the remainder of the slot the cadence forces. With a
   * cadence that does not divide the wet window, expiry falls between slots and
   * the crop is dry for the rest of that slot — the honest cost of one action
   * per `IDLE_ACTION_MS`, not a penalty invented by the simulator.
   */
  it('loses only the part of a slot that expiry falls inside', () => {
    const actionMs = 7 * MINUTE; // does not divide the 4h wet window
    const to = T0 + 2 * WATER_DURATION_MS;
    const result = simulate(
      input({ plots: [growing('a')], tasks: ['water'], actionMs, to }),
    );

    const wateredAt = result.actions.map((a) => a.at);
    expect(wateredAt[0]).toBe(T0 + actionMs);
    // Second watering: the first slot at or after the first window expires.
    const expiry = wateredAt[0]! + WATER_DURATION_MS;
    expect(wateredAt[1]).toBe(T0 + Math.ceil((expiry - T0) / actionMs) * actionMs);
    expect(wateredAt[1]! - expiry).toBeLessThan(actionMs);
  });

  it('settles what the closing window earned rather than throwing it away', () => {
    // Watered half a window ago, so 2h is banked when it is watered again.
    const half = WATER_DURATION_MS / 2;
    const wet = growing('a', { wateredAt: T0 - half, grownMs: 0 });
    // Forced re-water: another plot is dry, so the slot order is deterministic.
    const result = simulate(
      input({ plots: [wet], tasks: ['water'], to: T0 + WATER_DURATION_MS }),
    );

    const banked = result.plots[0]!.grownMs;
    expect(banked).toBe(WATER_DURATION_MS);
    expect(banked).toBe(settleGrowth(wet, (wet.wateredAt ?? 0) + WATER_DURATION_MS));
  });

  it('never waters a ripe crop — one finished plot cannot eat every slot', () => {
    const ripe = growing('a', { grownMs: ONION_MS, wateredAt: T0 - WATER_DURATION_MS });
    const result = simulate(
      input({ plots: [ripe], tasks: ['water'], to: T0 + 100 * IDLE_ACTION_MS }),
    );

    expect(result.actions).toEqual([]);
    expect(result.stoppedReason).toBe('nothing_to_do');
  });

  it('never waters an empty plot', () => {
    const result = simulate(
      input({ plots: [plot('bare', { tilledAt: T0 })], tasks: ['water'], to: T0 + 50 * IDLE_ACTION_MS }),
    );

    expect(result.actions).toEqual([]);
  });

  it('never plants or tills when told only to water', () => {
    const plots = [plot('empty'), growing('growing')];
    const result = simulate(input({ plots, tasks: ['water'], to: T0 + 20 * IDLE_ACTION_MS }));

    expect(log(result)).toEqual(['water:growing']);
    expect(result.plots[0]!.tilledAt).toBeNull();
    expect(held(result.items, SEED)).toBe(10);
  });

  it('waters before it plants or tills — dry soil is the only deadline', () => {
    const plots = [plot('fresh'), plot('tilled', { tilledAt: T0 }), growing('thirsty')];
    const result = simulate(
      input({ plots, tasks: ['till', 'plant', 'water'], to: T0 + IDLE_ACTION_MS }),
    );

    expect(log(result)).toEqual(['water:thirsty']);
  });

  /**
   * A VIP crop ripens sooner, so it stops being worth an action slot sooner.
   * The multiplier is read through `growthAt` and never applied to banked time.
   */
  it('stops watering a crop that VIP has already ripened', () => {
    // 80% of 8h is 6h24m, so 7h of banked growth is ripe for VIP and not for
    // free. Dry, so the only thing separating the two cases is ripeness.
    const nearlyDone = growing('a', { grownMs: 7 * HOUR, wateredAt: null });
    const window = { to: T0 + 20 * IDLE_ACTION_MS };

    expect(simulate(input({ plots: [nearlyDone], tasks: ['water'], ...window })).actions)
      .toHaveLength(1);
    expect(
      simulate(
        input({ plots: [nearlyDone], tasks: ['water'], durationPercent: 80, ...window }),
      ).actions,
    ).toEqual([]);
  });
});

describe('simulate — watering under contention', () => {
  /**
   * More plots than the cadence can serve. This cannot happen with the shipped
   * constants — 4h windows against a 10s cadence would need over a thousand
   * plots, and `MAX_PLOTS` is 20 — so the cadence is forced here to make the
   * state reachable at all. What is pinned is that the loss is DETERMINISTIC
   * and falls on the later plots: earlier ones win every contested slot.
   */
  const SLOW = HOUR; // one action per hour: 4 slots per 4h wet window

  /**
   * The loss falls on the LATER plots, and it is temporary rather than
   * permanent — which is worth pinning precisely, because it is not what you
   * would guess. The first four plots take every contested slot until they
   * ripen; only then do p4 and p5 get a drop. So "starvation" here means
   * finishing last, not never finishing.
   */
  it('serves the earlier plots first and the later ones only once those ripen', () => {
    const to = T0 + 12 * HOUR;
    const plots = Array.from({ length: 6 }, (_, i) => growing(`p${i}`));
    const result = simulate(input({ plots, tasks: ['water'], actionMs: SLOW, to }));

    expect(result.actions.map((a) => `+${(a.at - T0) / HOUR}h ${a.plotId}`)).toEqual([
      '+1h p0', '+2h p1', '+3h p2', '+4h p3',
      // Each of the four comes due again exactly one wet window later, and
      // wins the slot over the two that have never been watered.
      '+5h p0', '+6h p1', '+7h p2', '+8h p3',
      // p0..p3 are ripe now (two full 4h windows = onion's 8h), so they stop
      // asking, and the queue finally reaches the back. Both stay wet past the
      // end of the window, so neither needs a second drink inside it.
      '+9h p4', '+10h p5',
    ]);

    // The four in front finished; the two behind are still only half grown.
    for (const i of [0, 1, 2, 3]) {
      expect(effectiveGrowthMs(result.plots[i]!, to), `p${i}`).toBe(ONION_MS);
    }
    for (const i of [4, 5]) {
      expect(effectiveGrowthMs(result.plots[i]!, to), `p${i}`).toBeLessThan(ONION_MS);
    }
  });

  it('gives the same answer twice under contention', () => {
    const plots = Array.from({ length: 9 }, (_, i) => growing(`p${i}`));
    const args = input({ plots, tasks: ['water'], actionMs: SLOW, to: T0 + 3 * 24 * HOUR });

    expect(simulate(args)).toEqual(simulate(args));
  });

  it('serves exactly as many plots as the cadence has room for', () => {
    const plots = Array.from({ length: 4 }, (_, i) => growing(`p${i}`));
    const result = simulate(
      input({ plots, tasks: ['water'], actionMs: SLOW, to: T0 + 8 * HOUR }),
    );

    // Four plots, four slots per window: every one stays alive.
    for (const p of result.plots) {
      expect(effectiveGrowthMs(p, T0 + 8 * HOUR)).toBeGreaterThan(0);
    }
  });
});

describe('simulate — idling until the soil dries', () => {
  /**
   * The branch T-13.03a deliberately left out. A farmer with a wet crop and
   * nothing else to do skips the intervening slots entirely rather than
   * walking the clock forward one cadence at a time — the same window, at a
   * fraction of the work.
   */
  it('jumps straight to the expiry slot instead of stepping through the wait', () => {
    // A 20h snapshot rather than onion's 8h: the point here is the jump, and
    // an 8h crop would ripen at the second expiry and stop needing water.
    const wet = growing('a', { wateredAt: T0, growthDurationMs: 20 * HOUR });
    const result = simulate(
      input({ plots: [wet], tasks: ['water'], to: T0 + 2 * WATER_DURATION_MS }),
    );

    expect(result.actions.map((a) => a.at)).toEqual([
      T0 + WATER_DURATION_MS,
      T0 + 2 * WATER_DURATION_MS,
    ]);
  });

  it('stops when the next opportunity falls outside the window', () => {
    const wet = growing('a', { wateredAt: T0 });
    const result = simulate(
      input({ plots: [wet], tasks: ['water'], to: T0 + WATER_DURATION_MS - 1 }),
    );

    expect(result.actions).toEqual([]);
    expect(result.stoppedReason).toBe('nothing_to_do');
    // The idle stretch is still fully accounted for, or every poll re-runs it.
    expect(result.processedTo).toBe(T0 + WATER_DURATION_MS - 1);
  });

  it('terminates on a farm where nothing will ever become possible again', () => {
    const ripe = growing('a', { grownMs: ONION_MS, wateredAt: T0 });
    const result = simulate(
      input({ plots: [ripe], tasks: ['water'], to: T0 + 365 * 24 * HOUR }),
    );

    expect(result.actions).toEqual([]);
    expect(result.stoppedReason).toBe('nothing_to_do');
  });
});

describe('simulate — till, plant and water together', () => {
  it('breaks ground, sows it, then keeps it wet', () => {
    const to = T0 + 3 * IDLE_ACTION_MS;
    const result = simulate(
      input({ plots: [plot('a')], tasks: ['till', 'plant', 'water'], to }),
    );

    expect(log(result)).toEqual(['till:a', 'plant:a', 'water:a']);
    expect(result.plots[0]!.wateredAt).toBe(T0 + 3 * IDLE_ACTION_MS);
    // Sown at slot 2, watered at slot 3: one slot of the crop's life was dry.
    expect(effectiveGrowthMs(result.plots[0]!, to)).toBe(0);
  });

  it('is deterministic over a three-day window with every task enabled', () => {
    const plots = Array.from({ length: 20 }, (_, i) => plot(`p${i}`));
    const args = input({
      plots,
      tasks: ['till', 'plant', 'water'],
      items: bag({ [SEED]: 20 }),
      to: T0 + 3 * 24 * HOUR,
    });

    expect(simulate(args)).toEqual(simulate(args));
  });
});

/* ------------------------------------------------------------------ *
 * T-13.03c — harvest, a full bag, and the action cap
 * ------------------------------------------------------------------ */

/** A plot with a ripe crop in it: fully grown, so nothing depends on wetness. */
function ripe(id: string, crop = CROP, over: Partial<SimPlot> = {}): SimPlot {
  return plot(id, {
    tilledAt: T0 - MINUTE,
    cropId: crop,
    plantedAt: T0 - CROPS[crop].growthDurationMs,
    growthDurationMs: CROPS[crop].growthDurationMs,
    grownMs: CROPS[crop].growthDurationMs,
    ...over,
  });
}

describe('simulate — harvesting', () => {
  it('picks a ripe crop into the bag and empties the plot', () => {
    const result = simulate(
      input({ plots: [ripe('a')], tasks: ['harvest'], to: T0 + IDLE_ACTION_MS }),
    );

    expect(log(result)).toEqual(['harvest:a']);
    expect(held(result.items, PRODUCE)).toBe(CROPS[CROP].yieldAmount);

    const picked = result.plots[0]!;
    expect(picked.cropId).toBeNull();
    expect(picked.plantedAt).toBeNull();
    expect(picked.grownMs).toBe(0);
  });

  /** §5.2: harvesting leaves soil tilled, so the next loop skips the hoe. */
  it('leaves the soil tilled, so the plot is ready to sow again', () => {
    const result = simulate(
      input({ plots: [ripe('a')], tasks: ['harvest'], to: T0 + IDLE_ACTION_MS }),
    );

    expect(result.plots[0]!.tilledAt).toBe(T0 - MINUTE);
  });

  it('never picks a crop that is not ripe yet', () => {
    const half = growing('a', { grownMs: ONION_MS / 2, wateredAt: T0 });
    const result = simulate(
      input({ plots: [half], tasks: ['harvest'], to: T0 + 50 * IDLE_ACTION_MS }),
    );

    expect(result.actions).toEqual([]);
    expect(result.plots[0]!.cropId).toBe(ONION);
  });

  it('harvests before it waters, plants or tills', () => {
    const plots = [plot('fresh'), plot('tilled', { tilledAt: T0 }), growing('thirsty'), ripe('done')];
    const result = simulate(
      input({ plots, tasks: ['till', 'plant', 'water', 'harvest'], to: T0 + IDLE_ACTION_MS }),
    );

    expect(log(result)).toEqual(['harvest:done']);
  });

  it('never harvests when the task is not chosen', () => {
    const result = simulate(
      input({ plots: [ripe('a')], tasks: ['water', 'till'], to: T0 + 20 * IDLE_ACTION_MS }),
    );

    expect(result.actions).toEqual([]);
    expect(result.plots[0]!.cropId).toBe(CROP);
  });

  it('ignores a ripe crop on a locked plot', () => {
    const result = simulate(
      input({ plots: [ripe('locked', CROP, { unlocked: false })], tasks: ['harvest'], to: T0 + 20 * IDLE_ACTION_MS }),
    );

    expect(result.actions).toEqual([]);
  });
});

describe('simulate — a bag with no room', () => {
  /**
   * The bag is the reason a harvest can be refused, and the simulator has to
   * reach the SAME answer `addItem` would — it shares `addToSlots` with it
   * precisely so that a harvest it paid out cannot fail on the way into the
   * database.
   */
  it('leaves the crop standing when there is nowhere to put it', () => {
    // One slot, already holding a full stack of something else.
    const full = bag({ [SEED]: getItem(SEED)!.stackLimit }, 1);
    const result = simulate(
      input({
        plots: [ripe('a')],
        tasks: ['harvest'],
        items: full,
        capacity: 1,
        to: T0 + 20 * IDLE_ACTION_MS,
      }),
    );

    expect(result.actions).toEqual([]);
    expect(result.plots[0]!.cropId).toBe(CROP);
    expect(result.stoppedReason).toBe('inventory_full');
  });

  /**
   * A full bag is a different message from an empty field, because it is the
   * one the player can act on. Told apart, not merged.
   */
  it('says nothing_to_do when the field is simply finished', () => {
    const result = simulate(
      input({ plots: [plot('a', { tilledAt: T0 })], tasks: ['harvest'], to: T0 + 20 * IDLE_ACTION_MS }),
    );

    expect(result.stoppedReason).toBe('nothing_to_do');
  });

  /**
   * One slot free and two ripe crops of different kinds: the one that fits is
   * taken even though an earlier plot did not. Giving up at the first refusal
   * would strand a harvest that had room.
   */
  it('takes a harvest that fits even when an earlier one does not', () => {
    const bulky = 'onion';
    const small = CROP;
    // Bag holds a partial stack of the SMALL crop's produce and nothing else,
    // with no free slot — so only that crop's produce can be topped up.
    const partial = bag({ [CROPS[small].produceItemId]: 1 }, 1);

    const result = simulate(
      input({
        plots: [ripe('bulky', bulky), ripe('small', small)],
        tasks: ['harvest'],
        items: partial,
        capacity: 1,
        to: T0 + IDLE_ACTION_MS,
      }),
    );

    expect(log(result)).toEqual(['harvest:small']);
  });

  it('carries on with other work when only the harvest is blocked', () => {
    const full = bag({ [SEED]: getItem(SEED)!.stackLimit }, 1);
    const plots = [ripe('done'), plot('fresh')];
    const result = simulate(
      input({
        plots,
        tasks: ['harvest', 'till'],
        items: full,
        capacity: 1,
        to: T0 + 20 * IDLE_ACTION_MS,
      }),
    );

    expect(log(result)).toEqual(['till:fresh']);
    expect(result.stoppedReason).toBe('inventory_full');
  });
});

describe('simulate — the action cap', () => {
  it('stops at the cap and watermarks short so the next read continues', () => {
    const plots = Array.from({ length: 50 }, (_, i) => plot(`p${i}`));
    const to = T0 + 5000 * IDLE_ACTION_MS;
    const result = simulate(
      input({ plots, items: bag({ [SEED]: 50 }), maxActions: 12, to }),
    );

    expect(result.actions).toHaveLength(12);
    expect(result.stoppedReason).toBe('action_cap');
    expect(result.processedTo).toBe(T0 + 12 * IDLE_ACTION_MS);
    expect(result.processedTo).toBeLessThan(to);
  });

  /**
   * Continuing from a capped run must reach the same place as one long run —
   * that is the property that makes watermarking short safe.
   */
  it('resuming from a short watermark lands where one long run would have', () => {
    const plots = Array.from({ length: 8 }, (_, i) => plot(`p${i}`));
    const args = input({
      plots,
      items: bag({ [SEED]: 8 }),
      tasks: ['till', 'plant', 'water', 'harvest'],
      to: T0 + 6 * HOUR,
    });

    const whole = simulate(args);
    const first = simulate({ ...args, maxActions: 5 });
    const second = simulate({
      ...args,
      plots: first.plots,
      items: first.items,
      from: first.processedTo,
    });

    expect([...first.actions, ...second.actions]).toEqual(whole.actions);
    expect(second.plots).toEqual(whole.plots);
    expect(second.items).toEqual(whole.items);
  });
});

describe('simulate — the full cycle', () => {
  /**
   * The whole feature in one test: break ground, sow, keep it wet, pick it,
   * sow again. Leek is the 45-minute crop, so several cycles fit in a window
   * short enough to reason about exactly.
   */
  it('runs till → plant → water → harvest → replant and lands on exact counts', () => {
    const LEEK = 'leek';
    const leekMs = CROPS[LEEK].growthDurationMs; // 45m
    const to = T0 + 4 * HOUR;

    const result = simulate(
      input({
        plots: [plot('a')],
        cropId: LEEK,
        items: bag({ [CROPS[LEEK].seedItemId]: 3 }),
        tasks: ['till', 'plant', 'water', 'harvest'],
        to,
      }),
    );

    const kinds = result.actions.map((a) => a.kind);
    // Hoed exactly once — harvesting leaves the soil tilled (§5.2).
    expect(kinds.filter((k) => k === 'till')).toHaveLength(1);
    // Three seeds, so three sowings and — the window is long enough — three
    // harvests: 45m of growth plus a cadence slot each, well inside 4h.
    expect(kinds.filter((k) => k === 'plant')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'harvest')).toHaveLength(3);

    expect(held(result.items, CROPS[LEEK].seedItemId)).toBe(0);
    expect(held(result.items, CROPS[LEEK].produceItemId)).toBe(3 * CROPS[LEEK].yieldAmount);

    // Out of seed, so the last plot is picked clean and left hoed.
    expect(result.plots[0]!.cropId).toBeNull();
    expect(result.plots[0]!.tilledAt).not.toBeNull();
    expect(result.stoppedReason).toBe('nothing_to_do');

    // Each crop needed one watering: 45m is well inside a 4h wet window.
    expect(kinds.filter((k) => k === 'water')).toHaveLength(3);
    expect(leekMs).toBeLessThan(WATER_DURATION_MS);
  });

  it('is deterministic across a three-day window with a 45-minute crop', () => {
    const LEEK = 'leek';
    const plots = Array.from({ length: 6 }, (_, i) => plot(`p${i}`));
    const args = input({
      plots,
      cropId: LEEK,
      items: bag({ [CROPS[LEEK].seedItemId]: 60 }),
      tasks: ['till', 'plant', 'water', 'harvest'],
      to: T0 + 3 * 24 * HOUR,
    });

    const a = simulate(args);
    const b = simulate(args);

    expect(a).toEqual(b);
    expect(a.actions.length).toBeGreaterThan(50);
  });
});

describe('simulate — a sown plot matches what plant() would have written', () => {
  it('snapshots the duration from config and starts dry with nothing banked', () => {
    const stale = plot('a', { tilledAt: T0 - MINUTE, wateredAt: T0 - MINUTE, grownMs: 999 });
    const result = simulate(input({ plots: [stale], to: T0 + IDLE_ACTION_MS }));

    const sown = result.plots[0]!;
    expect(sown.growthDurationMs).toBe(CROPS[CROP].growthDurationMs);
    // A fresh seed inherits nothing from whatever was there before (D-1).
    expect(sown.wateredAt).toBeNull();
    expect(sown.grownMs).toBe(0);
    // Harvesting leaves soil tilled, and so does sowing — the plot stays hoed.
    expect(sown.tilledAt).toBe(T0 - MINUTE);
  });
});

/**
 * T-13.05 — one step forward.
 *
 * The property that matters is not "returns something plausible": it is that
 * the answer is the FIRST action a full `simulate` over the same farm would
 * take, at the same instant. The view promises the client an action it can walk
 * to and swing a tool at (T-13.07), and the applier is what will actually stamp
 * it — a lookahead that disagreed would animate work the server then declined.
 */
describe('nextIdleAction', () => {
  it('is the first action a full simulation would take, at the same instant', () => {
    const args = input({
      plots: [plot('a'), plot('b')],
      to: T0 + 50 * IDLE_ACTION_MS,
    });

    const next = nextIdleAction({ ...args, now: T0 });

    expect(next).toEqual(simulate(args).actions[0]);
  });

  it('sits on the watermark grid, not on the clock', () => {
    // Mid-slot `now`: the action still lands on a multiple of the cadence
    // measured from `from`, because that is the grid the applier will use.
    const next = nextIdleAction({ ...input(), now: T0 + IDLE_ACTION_MS / 2 });

    expect(next!.at).toBe(T0 + IDLE_ACTION_MS);
  });

  it('reports a backlog action in the past rather than pretending it is due now', () => {
    // A watermark left a day behind: the next catch-up starts working through
    // the backlog from there, so the first action is a day old.
    const next = nextIdleAction({ ...input({ from: T0 - 24 * HOUR }), now: T0 });

    expect(next!.at).toBe(T0 - 24 * HOUR + IDLE_ACTION_MS);
  });

  it('is null when the farmer has nothing to do', () => {
    // Told only to plant, holding no seed.
    const next = nextIdleAction({
      ...input({ tasks: ['plant'], items: bag({}) }),
      now: T0,
    });

    expect(next).toBeNull();
  });

  it('is null when every task is switched off', () => {
    expect(nextIdleAction({ ...input({ tasks: [] }), now: T0 })).toBeNull();
  });

  /**
   * The whole reason the lookahead spans a wet window rather than a single
   * slot: a farm where everything is planted and watered has nothing to do for
   * hours, and a client told "nothing next" would have nothing to show for the
   * feature the player switched on.
   */
  it('looks past a long wait to the watering that ends it', () => {
    const wet = plot('a', {
      tilledAt: T0 - HOUR,
      cropId: CROP,
      plantedAt: T0 - HOUR,
      growthDurationMs: 10 * WATER_DURATION_MS,
      wateredAt: T0 - HOUR,
    });

    const next = nextIdleAction({
      ...input({ plots: [wet], tasks: ['water'] }),
      now: T0,
    });

    // Dry three hours from now, and the farmer gets there on the first slot
    // at or after that — here the deadline is on the grid, so exactly then.
    expect(next).toMatchObject({ kind: 'water', plotId: 'a' });
    expect(next!.at).toBe(T0 - HOUR + WATER_DURATION_MS);
  });

  /**
   * The horizon runs from `now`, not from the watermark. A farm with a long
   * backlog has a watermark days behind; measuring the lookahead from there
   * would spend the whole window on time that has already happened and report
   * nothing at all.
   */
  it('measures its horizon from now, not from a watermark left behind', () => {
    const wet = plot('a', {
      tilledAt: T0,
      cropId: CROP,
      plantedAt: T0,
      growthDurationMs: 10 * WATER_DURATION_MS,
      wateredAt: T0,
    });

    const next = nextIdleAction({
      ...input({ plots: [wet], tasks: ['water'], from: T0 - 3 * 24 * HOUR }),
      now: T0,
    });

    // Four hours out — well past a horizon measured from three days ago, and
    // still found because the horizon is measured from `now`.
    expect(next).toMatchObject({ kind: 'water', plotId: 'a' });
    expect(next!.at).toBe(T0 + WATER_DURATION_MS);
  });

  /**
   * Nothing time alone can produce lands further out than one wet window plus
   * the slot the cadence rounds up to, which is exactly what `LOOKAHEAD_MS` is.
   * Pinned so the constant cannot be trimmed into hiding a real answer.
   */
  it('finds the last action inside its horizon, and nothing beyond it', () => {
    const wateredAt = T0 - MINUTE;
    const wet = plot('a', {
      tilledAt: wateredAt,
      cropId: CROP,
      plantedAt: wateredAt,
      growthDurationMs: 10 * WATER_DURATION_MS,
      wateredAt,
    });
    const args = { ...input({ plots: [wet], tasks: ['water'] }), now: T0 };

    const next = nextIdleAction(args)!;
    expect(next.at).toBeLessThanOrEqual(T0 + WATER_DURATION_MS + IDLE_ACTION_MS);

    // And it is genuinely the action a full simulation over that span finds.
    expect(simulate({ ...args, to: next.at }).actions).toEqual([next]);
  });
});

/**
 * T-20.06 — the farmer chops.
 *
 * The first idle task that does not address a plot, which is why these are
 * worth writing at length: the simulator's whole vocabulary was plots, and a
 * chop that quietly indexed `plots` with a tree's index would name a random
 * plot in the action log and fell nothing.
 */
describe('simulate — chopping', () => {
  const tree = (id: string, choppedAt: number | null = null): SimTree => ({ id, choppedAt });
  const AXE = 'axe_wood';

  /** A farm with nothing to farm, so only chopping can happen. */
  function chopInput(over: Partial<SimInput> = {}): SimInput {
    return input({
      plots: [],
      trees: [tree('t1')],
      items: bag({ [AXE]: 1 }),
      tasks: ['chop'],
      cropId: null,
      ...over,
    });
  }

  it('fells a standing tree and banks the wood', () => {
    const result = simulate(chopInput());

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.kind).toBe('chop');
    expect(result.actions[0]!.treeId, 'names the tree, not a plot').toBe('t1');
    expect(result.actions[0]!.plotId).toBeUndefined();
    expect(held(result.items, 'wood')).toBe(WOOD_PER_TREE);
    expect(result.trees[0]!.choppedAt).toBe(result.actions[0]!.at);
  });

  /**
   * The axe check, which is the simulator agreeing with the endpoint rather
   * than duplicating it. A farmer told to chop with no axe must SKIP the chore,
   * not fail the shift — the same way an empty seed bag is not an error.
   */
  it('skips chopping entirely without an axe', () => {
    const result = simulate(chopInput({ items: bag({}) }));

    expect(result.actions).toHaveLength(0);
    expect(result.stoppedReason).toBe('nothing_to_do');
    expect(result.trees[0]!.choppedAt, 'the tree is untouched').toBeNull();
  });

  it('does not chop a stump that has not regrown', () => {
    const result = simulate(chopInput({ trees: [tree('t1', T0)] }));

    expect(result.actions).toHaveLength(0);
    expect(result.stoppedReason).toBe('nothing_to_do');
  });

  /**
   * Regrowth is the third thing time alone makes possible, and the reason
   * `LOOKAHEAD_MS` had to grow past one wet window. A farmer whose only pending
   * work is a stump must WAIT for it rather than reporting "nothing to do".
   */
  it('waits for a stump to regrow and then fells it again', () => {
    const result = simulate(
      chopInput({
        trees: [tree('t1', T0 - TREE_REGROW_MS + 5 * IDLE_ACTION_MS)],
        to: T0 + 20 * IDLE_ACTION_MS,
      }),
    );

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.at, 'not before it grew back').toBeGreaterThanOrEqual(
      T0 + 5 * IDLE_ACTION_MS,
    );
  });

  it('works down every tree, in the caller‘s order', () => {
    const result = simulate(
      chopInput({ trees: [tree('a'), tree('b'), tree('c')], to: T0 + 10 * IDLE_ACTION_MS }),
    );

    expect(result.actions.map((a) => a.treeId)).toEqual(['a', 'b', 'c']);
    expect(held(result.items, 'wood')).toBe(3 * WOOD_PER_TREE);
    // ...and then stops, rather than chopping stumps.
    expect(result.stoppedReason).toBe('nothing_to_do');
  });

  /**
   * Chopping is LAST in `PRIORITY`, and the reason is time-criticality: a
   * standing tree loses nothing by waiting, a drying crop does. This is what
   * makes that ordering observable.
   */
  it('never spends a slot on wood while a crop needs water', () => {
    /*
     * Dry AND unfinished — both matter. The first fixture used the crop's own
     * duration, which for `CROP_IDS[0]` is exactly `WATER_DURATION_MS`, so one
     * full wet window ripened it; a ripe crop is correctly never watered
     * (`canWater` -> `isPaused`), and the test failed for the right reason
     * about the wrong thing. Three windows' worth of growth cannot finish in
     * one.
     */
    const thirsty = plot('p', {
      tilledAt: T0 - HOUR,
      cropId: CROP,
      plantedAt: T0 - 3 * WATER_DURATION_MS,
      growthDurationMs: 3 * WATER_DURATION_MS,
      wateredAt: T0 - WATER_DURATION_MS,
      grownMs: 0,
    });

    const result = simulate(
      chopInput({ plots: [thirsty], trees: [tree('t1')], tasks: ['water', 'chop'] }),
    );

    expect(result.actions[0]!.kind, 'the crop comes first').toBe('water');
  });

  /**
   * A full bag stops a chop the way it stops a harvest, and reports the same
   * reason — the one stop a player can actually act on.
   */
  it('reports inventory_full when the wood will not fit', () => {
    // Every slot occupied by something wood cannot stack with.
    const capacity = 2;
    const full = bag({ [AXE]: 1, [SEED]: 1 }, capacity);

    const result = simulate(chopInput({ items: full, capacity }));

    expect(result.actions).toHaveLength(0);
    expect(result.stoppedReason).toBe('inventory_full');
    expect(result.trees[0]!.choppedAt, 'the tree is still standing').toBeNull();
  });

  /**
   * **The guard for `LOOKAHEAD_MS`, and it was missing.** Every test above calls
   * `simulate` with an explicit `to`, so none of them touch the horizon — a
   * break-test reverting it to `WATER_DURATION_MS + IDLE_ACTION_MS` passed all
   * of them. `nextIdleAction` is the only caller, and a stump regrows after 8h
   * against watering's 4h, so with the old horizon the farm view would report
   * "nothing next" to a farmer whose sole pending job was a tree.
   */
  it('looks far enough ahead to see a regrowing tree (LOOKAHEAD_MS)', () => {
    /*
     * Chopped ONE hour ago, so it regrows at +7h — beyond the old 4h horizon
     * and inside the new 8h one. The first version of this used six hours ago,
     * which regrows at +2h and sits comfortably inside BOTH, so it passed with
     * the horizon reverted and proved nothing.
     */
    const choppedAt = T0 - HOUR;
    const next = nextIdleAction({
      plots: [],
      trees: [tree('t1', choppedAt)],
      items: bag({ [AXE]: 1 }),
      capacity: ROOMY,
      tasks: ['chop'],
      cropId: null,
      from: T0,
      now: T0,
    });

    expect(next, 'the horizon does not reach the regrowth').not.toBeNull();
    expect(next!.kind).toBe('chop');
    expect(next!.treeId).toBe('t1');
    expect(next!.at).toBeGreaterThanOrEqual(choppedAt + TREE_REGROW_MS);
    // ...and the whole point: that instant is past one wet window.
    expect(choppedAt + TREE_REGROW_MS - T0).toBeGreaterThan(WATER_DURATION_MS);
  });

  it('is inert for a farm with no trees at all', () => {
    // Accounts predating the T-20.01 migration have none, and must not break.
    // `trees` omitted entirely rather than passed as undefined, which is what
    // `applyIdleWork` does for a farm whose rows do not exist.
    const { trees: _omitted, ...noTrees } = chopInput();
    const result = simulate(noTrees);

    expect(result.actions).toHaveLength(0);
    expect(result.trees).toEqual([]);
  });
});

/**
 * Energy, and the farmer putting itself to bed (auto-sleep).
 *
 * `energy` alone is the old wall: spend it and the shift ends. `energyMax`
 * turns it into a throttle — the farmer sleeps `SLEEP_DURATION_MS`, refills,
 * and carries on. The pair is tested together because the interesting
 * properties are all about the relationship: that sleep is not free, that the
 * loop still terminates, and that a window simulated twice is worth the same
 * both times.
 */
describe('simulate — energy and auto-sleep', () => {
  /** An inexhaustible supply of 2-energy work: plots to till, then sow. */
  function chores(count: number, over: Partial<SimInput> = {}): SimInput {
    return input({
      plots: Array.from({ length: count }, (_, i) => plot(`p${i}`)),
      items: bag({ [SEED]: count }),
      tasks: ['till', 'plant'],
      to: T0 + 10 * DAY,
      ...over,
    });
  }

  const TILL_COST = ENERGY_COST[EnergyAction.TILL];
  /** Actions one full bar pays for, when every action costs the same. */
  const PER_BAR = ENERGY_BASE / TILL_COST;

  it('stops at the wall when no bar is supplied', () => {
    const result = simulate(chores(50, { energy: 3 * TILL_COST }));

    expect(result.stoppedReason).toBe('out_of_energy');
    expect(result.actions).toHaveLength(3);
    expect(result.sleeps).toBe(0);
    expect(result.energyRecovered).toBe(0);
  });

  it('sleeps instead, once a bar is supplied, and keeps working', () => {
    const result = simulate(chores(50, { energy: 3 * TILL_COST, energyMax: ENERGY_BASE }));

    expect(result.sleeps).toBeGreaterThan(0);
    expect(result.actions.length).toBeGreaterThan(3);
    expect(result.energySpent).toBe(result.actions.length * TILL_COST);
  });

  /**
   * **The nap costs real time**, which is the entire justification for
   * auto-sleep being safe to ship. If it did not, energy would stop being a
   * limit the moment idle mode was switched on — the exact failure the original
   * `out_of_energy` wall was written to prevent.
   *
   * Sized as one bar of work plus one nap plus one bar: the farmer must fit at
   * most two bars into it, not the ~130 actions the cadence alone would allow.
   */
  it('pays SLEEP_DURATION_MS for every nap, so the bar still paces the farm', () => {
    const window = PER_BAR * IDLE_ACTION_MS + SLEEP_DURATION_MS + PER_BAR * IDLE_ACTION_MS;
    const result = simulate(
      chores(200, { energy: ENERGY_BASE, energyMax: ENERGY_BASE, to: T0 + window }),
    );

    expect(result.sleeps).toBe(1);
    expect(result.actions.length).toBeGreaterThan(PER_BAR);
    expect(result.actions.length).toBeLessThanOrEqual(2 * PER_BAR);
  });

  /**
   * A nap that runs past the end of the window is DECLINED, not truncated.
   *
   * Truncating would double-pay: `processedTo` stops at the last action either
   * way, so the next read re-simulates this stretch and would credit the same
   * partial rest again. Declining keeps the simulator's one non-negotiable
   * property — that a window is worth the same however many times it is run.
   */
  it('declines a nap that does not fit in the window', () => {
    const result = simulate(
      chores(50, {
        energy: TILL_COST,
        energyMax: ENERGY_BASE,
        // One action, then a nap that cannot possibly complete.
        to: T0 + 2 * IDLE_ACTION_MS,
      }),
    );

    expect(result.actions).toHaveLength(1);
    expect(result.sleeps).toBe(0);
    expect(result.energyRecovered).toBe(0);
    expect(result.stoppedReason).toBe('out_of_energy');
    // The watermark stops at the action, so the next read covers a window long
    // enough for the nap to fit — which is how the rest is deferred, not lost.
    expect(result.processedTo).toBe(T0 + IDLE_ACTION_MS);
  });

  /**
   * A bar too small to pay for the cheapest available action would refill to a
   * bar that still cannot pay for it — a farmer lying down forever at the same
   * slot. This is the guard that makes the loop provably terminate.
   */
  it('does not loop forever on a bar smaller than the action it needs', () => {
    const result = simulate(chores(50, { energy: 0, energyMax: TILL_COST - 1 }));

    expect(result.stoppedReason).toBe('out_of_energy');
    expect(result.actions).toHaveLength(0);
    expect(result.sleeps).toBe(0);
  });

  /** Determinism survives sleeping — the property the whole feature rests on. */
  it('is deterministic across naps', () => {
    const args = chores(100, { energy: 5, energyMax: ENERGY_BASE, to: T0 + DAY });

    expect(simulate(args)).toEqual(simulate(args));
  });

  it('leaves unlimited-energy callers exactly as they were', () => {
    // `energyMax` without `energy` is not auto-sleep territory: an unlimited
    // budget never runs out, so the farmer never has cause to lie down.
    const result = simulate(chores(4, { energyMax: ENERGY_BASE }));

    expect(result.sleeps).toBe(0);
    expect(result.actions).toHaveLength(8);
    // Still COUNTED, just never checked against a budget — so a caller that
    // later gains one gets an honest bill rather than a blank one.
    expect(result.energySpent).toBe(8 * TILL_COST);
  });
});
