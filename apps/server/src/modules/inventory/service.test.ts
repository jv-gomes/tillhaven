import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import {
  BACKPACK_TIERS,
  BASE_INVENTORY_SLOTS,
  BASE_CHEST_SLOTS,
  CHEST_TIERS,
  ErrorCode,
  HOUSE_TIERS,
  VIP_BENEFITS,
  getItem,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb, insertTestPlayer } from '../../test/helpers.js';
import {
  Container,
  addItem,
  capacityFor,
  countItem,
  listSlots,
  moveItem,
  removeItem,
} from './service.js';

/**
 * The inventory is where items are created and destroyed, so its failure paths
 * matter more than its happy one. Two rules are asserted over and over here:
 *
 *   1. **An operation that cannot complete writes nothing.** Never a partial
 *      add, never a half-finished remove (CLAUDE.md §5.4).
 *   2. **Nothing vanishes.** Every failure case below re-counts the total held
 *      afterwards. An inventory bug that eats items is an unlogged sink, and
 *      §5.6 is explicit that those kill an idle economy.
 */

const STACK = getItem('leek')!.stackLimit;
const FULL_CAPACITY = { capacity: BASE_INVENTORY_SLOTS };

let playerId: string;

beforeEach(async () => {
  await resetDb();
  playerId = (await insertTestPlayer()).id;
});

afterAll(closeDb);

/** Runs one service call in its own transaction, as a route handler would. */
function inTx<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

async function slots(container: Container = Container.INVENTORY) {
  return db
    .select({
      slotIndex: schema.inventoryItems.slotIndex,
      itemId: schema.inventoryItems.itemId,
      quantity: schema.inventoryItems.quantity,
    })
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.playerId, playerId),
        eq(schema.inventoryItems.container, container),
      ),
    )
    .orderBy(asc(schema.inventoryItems.slotIndex));
}

async function totalHeld(): Promise<number> {
  return (await slots()).reduce((sum, s) => sum + s.quantity, 0);
}

async function give(itemId: string, quantity: number, slotIndex: number): Promise<void> {
  await db.insert(schema.inventoryItems).values({
    playerId,
    container: Container.INVENTORY,
    slotIndex,
    itemId,
    quantity,
  });
}

/** Asserts the thrown error is a GameError with the expected code. */
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

/* ------------------------------------------------------------------ *
 * Capacity
 * ------------------------------------------------------------------ */

describe('capacityFor', () => {
  it('is the base for a tier-0, non-VIP player', () => {
    expect(capacityFor(Container.INVENTORY, { backpackTier: 0, chestTier: 0, isVip: false })).toBe(
      BASE_INVENTORY_SLOTS,
    );
    expect(capacityFor(Container.CHEST, { backpackTier: 0, chestTier: 0, isVip: false })).toBe(
      BASE_CHEST_SLOTS,
    );
  });

  it('recomputes when the backpack tier changes', () => {
    for (const tier of BACKPACK_TIERS) {
      expect(
        capacityFor(Container.INVENTORY, {
          backpackTier: tier.tier,
          chestTier: 0,
          isVip: false,
        }),
        `tier ${tier.tier}`,
      ).toBe(tier.slots);
    }
  });

  it('recomputes when the chest tier changes', () => {
    const tier2 = CHEST_TIERS.find((t) => t.tier === 2)!;
    expect(capacityFor(Container.CHEST, { backpackTier: 0, chestTier: 2, isVip: false })).toBe(
      tier2.slots,
    );
  });

  it('adds the VIP bonus on top of whatever the tiers gave', () => {
    const base = capacityFor(Container.INVENTORY, { backpackTier: 1, chestTier: 0, isVip: false });
    const vip = capacityFor(Container.INVENTORY, { backpackTier: 1, chestTier: 0, isVip: true });
    expect(vip - base).toBe(VIP_BENEFITS.bonusInventorySlots);
  });

  /**
   * T-10.03 moved bag size off the house. The two are independent now, and the
   * only way to notice a house bonus creeping back is to say so.
   */
  it('ignores the house entirely', () => {
    const slots = (chestTier: number) =>
      capacityFor(Container.INVENTORY, { backpackTier: 0, chestTier, isVip: false });
    // The chest's tier is the only other thing in the input, and it must not
    // touch the bag either.
    expect(slots(0)).toBe(BASE_INVENTORY_SLOTS);
    expect(slots(3)).toBe(BASE_INVENTORY_SLOTS);
    expect(Object.keys(HOUSE_TIERS[1]!)).not.toContain('bonusInventorySlots');
  });

  /** An unknown tier must not read as "unlimited" — it falls back to tier 0. */
  it('falls back to tier 0 for a tier that does not exist', () => {
    expect(capacityFor(Container.CHEST, { backpackTier: 0, chestTier: 99, isVip: false })).toBe(
      BASE_CHEST_SLOTS,
    );
    expect(capacityFor(Container.INVENTORY, { backpackTier: 99, chestTier: 0, isVip: false })).toBe(
      BASE_INVENTORY_SLOTS,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Adding
 * ------------------------------------------------------------------ */

describe('addItem', () => {
  it('opens the lowest free slot', async () => {
    await inTx((tx) => addItem(tx, playerId, 'leek', 3, FULL_CAPACITY));
    expect(await slots()).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 3 }]);
  });

  it('tops up an existing partial stack before opening a new slot', async () => {
    await give('leek', STACK - 2, 0);
    await inTx((tx) => addItem(tx, playerId, 'leek', 2, FULL_CAPACITY));

    expect(await slots()).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: STACK }]);
  });

  it('respects the stack limit and spills the remainder into a new slot', async () => {
    await inTx((tx) => addItem(tx, playerId, 'leek', STACK + 5, FULL_CAPACITY));

    expect(await slots()).toEqual([
      { slotIndex: 0, itemId: 'leek', quantity: STACK },
      { slotIndex: 1, itemId: 'leek', quantity: 5 },
    ]);
  });

  it('fills a hole left by an earlier removal rather than appending', async () => {
    await give('leek', 1, 0);
    await give('onion', 1, 2);

    await inTx((tx) => addItem(tx, playerId, 'potato', 1, FULL_CAPACITY));

    expect((await slots()).find((s) => s.itemId === 'potato')?.slotIndex).toBe(1);
  });

  /**
   * The rule that keeps a harvest in its plot when the bag is full: the add
   * must fail whole, so the surrounding transaction can roll back with the crop
   * still in the ground.
   */
  it('fails whole when only part of the quantity would fit', async () => {
    const capacity = 2;
    await give('leek', STACK, 0);
    await give('leek', STACK, 1);

    const before = await totalHeld();
    await expectCode(
      inTx((tx) => addItem(tx, playerId, 'leek', 1, { capacity })),
      ErrorCode.INVENTORY_FULL,
    );

    expect(await totalHeld()).toBe(before);
    expect(await slots()).toHaveLength(2);
  });

  it('writes nothing when the spill would need a slot past the capacity', async () => {
    const capacity = 1;
    const before = await slots();

    await expectCode(
      inTx((tx) => addItem(tx, playerId, 'leek', STACK + 1, { capacity })),
      ErrorCode.INVENTORY_FULL,
    );

    // Not even the first, fitting, stack was written.
    expect(await slots()).toEqual(before);
  });

  it('rejects a quantity that is not a positive whole number', async () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      await expectCode(
        inTx((tx) => addItem(tx, playerId, 'leek', quantity, FULL_CAPACITY)),
        ErrorCode.VALIDATION_FAILED,
      );
    }
    expect(await slots()).toHaveLength(0);
  });

  it('rejects an item that is not in the config', async () => {
    await expectCode(
      inTx((tx) => addItem(tx, playerId, 'philosophers_stone', 1, FULL_CAPACITY)),
      ErrorCode.UNKNOWN_ITEM,
    );
  });

  it('keeps containers separate', async () => {
    await inTx((tx) => addItem(tx, playerId, 'leek', 1, FULL_CAPACITY));
    await inTx((tx) =>
      addItem(tx, playerId, 'leek', 1, { capacity: BASE_CHEST_SLOTS, container: Container.CHEST }),
    );

    expect(await slots(Container.INVENTORY)).toHaveLength(1);
    expect(await slots(Container.CHEST)).toHaveLength(1);
    expect(await inTx((tx) => countItem(tx, playerId, 'leek'))).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Removing
 * ------------------------------------------------------------------ */

describe('removeItem', () => {
  it('deletes a slot it empties', async () => {
    await give('leek', 2, 0);
    await inTx((tx) => removeItem(tx, playerId, 'leek', 2));

    expect(await slots()).toHaveLength(0);
  });

  it('drains across several stacks, lowest slot first', async () => {
    await give('leek', 3, 0);
    await give('leek', 5, 1);

    await inTx((tx) => removeItem(tx, playerId, 'leek', 4));

    expect(await slots()).toEqual([{ slotIndex: 1, itemId: 'leek', quantity: 4 }]);
  });

  it('removing more than held mutates nothing', async () => {
    await give('leek', 3, 0);
    await give('leek', 2, 1);

    await expectCode(
      inTx((tx) => removeItem(tx, playerId, 'leek', 6)),
      ErrorCode.INSUFFICIENT_ITEMS,
    );

    expect(await slots()).toEqual([
      { slotIndex: 0, itemId: 'leek', quantity: 3 },
      { slotIndex: 1, itemId: 'leek', quantity: 2 },
    ]);
  });

  it('removing something not held at all is INSUFFICIENT_ITEMS', async () => {
    await expectCode(
      inTx((tx) => removeItem(tx, playerId, 'leek', 1)),
      ErrorCode.INSUFFICIENT_ITEMS,
    );
  });

  it('does not count another container towards what is held', async () => {
    await inTx((tx) =>
      addItem(tx, playerId, 'leek', 5, { capacity: BASE_CHEST_SLOTS, container: Container.CHEST }),
    );

    await expectCode(
      inTx((tx) => removeItem(tx, playerId, 'leek', 1)),
      ErrorCode.INSUFFICIENT_ITEMS,
    );

    expect(await inTx((tx) => countItem(tx, playerId, 'leek', Container.CHEST))).toBe(5);
  });

  it('rejects a quantity that is not a positive whole number', async () => {
    await give('leek', 5, 0);
    for (const quantity of [0, -1, 2.5]) {
      await expectCode(
        inTx((tx) => removeItem(tx, playerId, 'leek', quantity)),
        ErrorCode.VALIDATION_FAILED,
      );
    }
    expect(await totalHeld()).toBe(5);
  });
});

/* ------------------------------------------------------------------ *
 * Moving
 * ------------------------------------------------------------------ */

describe('moveItem', () => {
  it('moves a stack into an empty slot', async () => {
    await give('leek', 4, 0);

    const result = await inTx((tx) => moveItem(tx, playerId, 0, 7, FULL_CAPACITY));

    expect(result.kind).toBe('moved');
    expect(await slots()).toEqual([{ slotIndex: 7, itemId: 'leek', quantity: 4 }]);
  });

  it('swaps two different items', async () => {
    await give('leek', 4, 0);
    await give('onion', 9, 1);

    const result = await inTx((tx) => moveItem(tx, playerId, 0, 1, FULL_CAPACITY));

    expect(result.kind).toBe('swapped');
    expect(await slots()).toEqual([
      { slotIndex: 0, itemId: 'onion', quantity: 9 },
      { slotIndex: 1, itemId: 'leek', quantity: 4 },
    ]);
  });

  it('merges two stacks of the same item', async () => {
    await give('leek', 4, 0);
    await give('leek', 5, 1);

    const result = await inTx((tx) => moveItem(tx, playerId, 0, 1, FULL_CAPACITY));

    expect(result).toEqual({ kind: 'merged', moved: 4 });
    expect(await slots()).toEqual([{ slotIndex: 1, itemId: 'leek', quantity: 9 }]);
  });

  it('merges only up to the stack limit and leaves the remainder behind', async () => {
    await give('leek', 10, 0);
    await give('leek', STACK - 4, 1);

    const result = await inTx((tx) => moveItem(tx, playerId, 0, 1, FULL_CAPACITY));

    expect(result).toEqual({ kind: 'merged', moved: 4 });
    expect(await slots()).toEqual([
      { slotIndex: 0, itemId: 'leek', quantity: 6 },
      { slotIndex: 1, itemId: 'leek', quantity: STACK },
    ]);
  });

  it('swaps rather than merging when the destination stack is already full', async () => {
    await give('leek', 3, 0);
    await give('leek', STACK, 1);

    const result = await inTx((tx) => moveItem(tx, playerId, 0, 1, FULL_CAPACITY));

    expect(result.kind).toBe('swapped');
    expect(await slots()).toEqual([
      { slotIndex: 0, itemId: 'leek', quantity: STACK },
      { slotIndex: 1, itemId: 'leek', quantity: 3 },
    ]);
  });

  /** The invariant that matters most: a move is never a sink. */
  it('never changes the total held, whichever outcome it takes', async () => {
    await give('leek', 10, 0);
    await give('leek', STACK - 4, 1);
    await give('onion', 7, 2);

    const before = await totalHeld();

    await inTx((tx) => moveItem(tx, playerId, 0, 1, FULL_CAPACITY)); // merge, partial
    await inTx((tx) => moveItem(tx, playerId, 2, 5, FULL_CAPACITY)); // move
    await inTx((tx) => moveItem(tx, playerId, 1, 5, FULL_CAPACITY)); // swap

    expect(await totalHeld()).toBe(before);
  });

  it('moving a slot onto itself changes nothing', async () => {
    await give('leek', 4, 0);

    const result = await inTx((tx) => moveItem(tx, playerId, 0, 0, FULL_CAPACITY));

    expect(result.moved).toBe(0);
    expect(await slots()).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 4 }]);
  });

  /**
   * A slot index is a client-supplied number. One past the capacity would be
   * storage the player has not paid for; a negative one is where the swap parks
   * a row mid-transaction, and must not be reachable from outside.
   */
  it('rejects a slot index outside the capacity', async () => {
    await give('leek', 4, 0);

    for (const [from, to] of [
      [0, BASE_INVENTORY_SLOTS],
      [0, -1],
      [BASE_INVENTORY_SLOTS + 10, 0],
      [0, 1.5],
    ] as const) {
      await expectCode(
        inTx((tx) => moveItem(tx, playerId, from, to, FULL_CAPACITY)),
        ErrorCode.VALIDATION_FAILED,
      );
    }

    expect(await slots()).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 4 }]);
  });

  it('rejects a move out of an empty slot', async () => {
    await expectCode(
      inTx((tx) => moveItem(tx, playerId, 3, 4, FULL_CAPACITY)),
      ErrorCode.INSUFFICIENT_ITEMS,
    );
  });

  it('only sees the container it was asked about', async () => {
    await give('leek', 4, 0);
    await inTx((tx) =>
      addItem(tx, playerId, 'onion', 2, { capacity: BASE_CHEST_SLOTS, container: Container.CHEST }),
    );

    // Slot 0 of the chest holds the onion; slot 0 of the bag holds the leek.
    await inTx((tx) =>
      moveItem(tx, playerId, 0, 3, { capacity: BASE_CHEST_SLOTS, container: Container.CHEST }),
    );

    expect(await slots(Container.INVENTORY)).toEqual([
      { slotIndex: 0, itemId: 'leek', quantity: 4 },
    ]);
    expect(await slots(Container.CHEST)).toEqual([
      { slotIndex: 3, itemId: 'onion', quantity: 2 },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Composability (CLAUDE.md §4.3)
 * ------------------------------------------------------------------ */

describe('inside a larger transaction', () => {
  /**
   * The reason every function here takes a `Tx`. A caller that spends gold and
   * then cannot fit the item must end up having spent nothing — this is the
   * shop and the harvest path in miniature.
   */
  it('a failed add rolls back everything its caller already wrote', async () => {
    await db.update(schema.players).set({ gold: 100 }).where(eq(schema.players.id, playerId));
    await give('leek', STACK, 0);

    const attempt = db.transaction(async (tx) => {
      await tx.update(schema.players).set({ gold: 40 }).where(eq(schema.players.id, playerId));
      await addItem(tx, playerId, 'leek', 1, { capacity: 1 });
    });

    await expect(attempt).rejects.toMatchObject({ code: ErrorCode.INVENTORY_FULL });

    const [player] = await db
      .select({ gold: schema.players.gold })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));

    expect(player!.gold).toBe(100);
    expect(await totalHeld()).toBe(STACK);
  });

  it('several mutations in one transaction commit together', async () => {
    await db.transaction(async (tx) => {
      await addItem(tx, playerId, 'leek', 5, FULL_CAPACITY);
      await addItem(tx, playerId, 'onion', 3, FULL_CAPACITY);
      await removeItem(tx, playerId, 'leek', 2);
      await moveItem(tx, playerId, 1, 4, FULL_CAPACITY);
    });

    expect(await slots()).toEqual([
      { slotIndex: 0, itemId: 'leek', quantity: 3 },
      { slotIndex: 4, itemId: 'onion', quantity: 3 },
    ]);
  });

  it('listSlots returns a container in slot order', async () => {
    await give('onion', 1, 5);
    await give('leek', 1, 2);

    const rows = await inTx((tx) => listSlots(tx, playerId));
    expect(rows.map((r) => r.slotIndex)).toEqual([2, 5]);
  });
});
