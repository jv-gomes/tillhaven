import { describe, expect, it } from 'vitest';
import { TREES } from './farmLayout.js';
import { HOUR } from './time.js';
import { WATER_DURATION_MS } from './crops.js';
import { TREE_REGROW_MS, WOOD_PER_TREE, treeStateAt } from './trees.js';

/**
 * T-20.01 — trees stop being decoration.
 *
 * The rule under test is the whole of §4.2 in miniature: nothing ticks, a row
 * stores one instant, and "is it back yet" is a subtraction done on read. If
 * this function is wrong, a tree either regrows instantly (a free wood faucet,
 * which §5.8 says is how an idle economy dies) or never (a resource that
 * silently runs out).
 */

const T0 = 1_700_000_000_000;

describe('treeStateAt', () => {
  it('stands when it has never been chopped', () => {
    expect(treeStateAt(null, T0)).toEqual({ isStanding: true, regrowsInMs: 0 });
    // ...and still stands however much later you ask. A null is not a clock.
    expect(treeStateAt(null, T0 + 400 * HOUR)).toEqual({ isStanding: true, regrowsInMs: 0 });
  });

  it('is a stump the instant it is chopped', () => {
    const state = treeStateAt(T0, T0);
    expect(state.isStanding).toBe(false);
    expect(state.regrowsInMs).toBe(TREE_REGROW_MS);
  });

  /**
   * The boundary, both sides. An off-by-one here is a tree that can be chopped
   * twice in the same millisecond it grew back, or one you have to wait an
   * extra tick for — and only one of those costs anyone anything.
   */
  it('grows back exactly at choppedAt + TREE_REGROW_MS, not before', () => {
    const regrowsAt = T0 + TREE_REGROW_MS;

    expect(treeStateAt(T0, regrowsAt - 1).isStanding, 'one ms early').toBe(false);
    expect(treeStateAt(T0, regrowsAt - 1).regrowsInMs).toBe(1);
    expect(treeStateAt(T0, regrowsAt).isStanding, 'on the instant').toBe(true);
    expect(treeStateAt(T0, regrowsAt).regrowsInMs).toBe(0);
  });

  it('counts down monotonically and never reports negative time', () => {
    let previous = Infinity;
    for (const elapsed of [0, HOUR, 4 * HOUR, TREE_REGROW_MS - 1]) {
      const { regrowsInMs } = treeStateAt(T0, T0 + elapsed);
      expect(regrowsInMs).toBeLessThan(previous);
      expect(regrowsInMs).toBeGreaterThan(0);
      previous = regrowsInMs;
    }

    // Long past regrowth it clamps at 0 rather than going negative — a
    // countdown that ran backwards would render as a growing wait.
    expect(treeStateAt(T0, T0 + 1000 * HOUR).regrowsInMs).toBe(0);
  });

  /**
   * Offline progression, which is the entire point of computing on read. A
   * player who closes the tab and comes back the next day must find the tree
   * standing without anything having run while they were gone.
   */
  it('regrows across an offline gap with nothing having ticked', () => {
    expect(treeStateAt(T0, T0 + 24 * HOUR).isStanding).toBe(true);
  });
});

describe('tree economy constants', () => {
  /**
   * Pinned as a RELATION, not a number. The reasoning in `trees.ts` is that a
   * tree is deliberately slower than a watering — the trickle is what stops
   * five trees being a loop you farm in one sitting. Asserting `8 * HOUR` would
   * pass just as happily if someone made watering last a week.
   */
  it('regrows slower than a watering lasts', () => {
    expect(TREE_REGROW_MS).toBeGreaterThan(WATER_DURATION_MS);
  });

  it('drops a whole positive number of wood', () => {
    expect(WOOD_PER_TREE).toBeGreaterThan(0);
    expect(Number.isInteger(WOOD_PER_TREE), 'quantities are integers (§10)').toBe(true);
  });

  /**
   * The faucet, stated out loud (§5.8: "document every source and sink").
   *
   * **This assertion has already earned its place**: the comment on
   * `TREE_REGROW_MS` claimed fifteen a day, this computed forty-five, and the
   * comment was the thing that was wrong. A faucet nobody has multiplied out is
   * a faucet nobody is watching.
   */
  it('opens a wood faucet of exactly 45 a day', () => {
    const perDay = TREES.length * WOOD_PER_TREE * Math.floor((24 * HOUR) / TREE_REGROW_MS);
    expect(perDay).toBe(45);
    // A supplement, not an income: fewer than a single ripe onion's 110g worth
    // of harvests. T-20.02 prices wood against this line.
    expect(perDay).toBeLessThan(100);
  });
});
