import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  BACKPACK_TIERS,
  BASE_INVENTORY_SLOTS,
  CHEST_TIERS,
  ErrorCode,
  getItem,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * The endpoints, over the real stack — routing, auth hook, Zod, error handler.
 * The service's own rules are covered in `service.test.ts`; what matters here is
 * that the boundary cannot be talked past: no reading someone else's bag, no
 * inventing a slot index, no replaying a drag twice.
 */

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, playerId));
});

afterAll(closeDb);

async function give(itemId: string, quantity: number, slotIndex: number): Promise<void> {
  await db.insert(schema.inventoryItems).values({
    playerId,
    container: 'inventory',
    slotIndex,
    itemId,
    quantity,
  });
}

async function slots() {
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
        eq(schema.inventoryItems.container, 'inventory'),
      ),
    );
}

describe('GET /api/inventory', () => {
  it('returns the caller’s slots and their capacity', async () => {
    await give('leek', 3, 0);

    const res = await client.get('/api/inventory');

    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 3 }]);
    expect(res.body.capacity).toBe(BASE_INVENTORY_SLOTS);
  });

  it('reports the capacity the backpack tier bought', async () => {
    const tier1 = BACKPACK_TIERS.find((t) => t.tier === 1)!;
    await db
      .update(schema.players)
      .set({ backpackTier: 1 })
      .where(eq(schema.players.id, playerId));

    const res = await client.get('/api/inventory');
    expect(res.body.capacity).toBe(tier1.slots);
  });

  /**
   * The shop quotes this price rather than its own copy of `BACKPACK_TIERS`
   * (T-11.04), so a wrong number here is a shop that lies about what an upgrade
   * costs.
   */
  it('says which backpack tier this is and what the next one costs', async () => {
    const res = await client.get('/api/inventory');

    expect(res.body.tier).toBe(0);
    expect(res.body.nextCost).toBe(BACKPACK_TIERS.find((t) => t.tier === 1)!.cost);

    await db
      .update(schema.players)
      .set({ backpackTier: 1 })
      .where(eq(schema.players.id, playerId));

    const upgraded = await client.get('/api/inventory');
    expect(upgraded.body.tier).toBe(1);
    expect(upgraded.body.nextCost).toBe(BACKPACK_TIERS.find((t) => t.tier === 2)!.cost);
  });

  it('offers nothing more once the backpack is as big as it gets', async () => {
    const top = BACKPACK_TIERS[BACKPACK_TIERS.length - 1]!;
    await db
      .update(schema.players)
      .set({ backpackTier: top.tier })
      .where(eq(schema.players.id, playerId));

    const res = await client.get('/api/inventory');
    expect(res.body.tier).toBe(top.tier);
    expect(res.body.nextCost).toBeNull();
    expect(res.body.capacity).toBe(top.slots);
  });

  /** The house bought bag slots until T-10.03; it must not still be doing so. */
  it('is unaffected by the house tier', async () => {
    await db.update(schema.farms).set({ houseTier: 1 }).where(eq(schema.farms.playerId, playerId));

    const res = await client.get('/api/inventory');
    expect(res.body.capacity).toBe(BASE_INVENTORY_SLOTS);
  });

  /**
   * There is no player id in the request at all, so this is really asserting
   * the shape of the endpoint: the only identity it can use is the cookie's.
   */
  it('never shows another player’s bag', async () => {
    await give('leek', 3, 0);

    const other = await createTestClient();
    await registerTestUser(other);
    await db
      .delete(schema.inventoryItems)
      .where(eq(schema.inventoryItems.itemId, 'onion'));

    const mine = (await client.get('/api/inventory')).body;
    const theirs = (await other.get('/api/inventory')).body;

    expect(mine.slots).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 3 }]);
    expect(theirs.slots.some((s: { itemId: string }) => s.itemId === 'leek')).toBe(false);

    await other.close();
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    const res = await anonymous.get('/api/inventory');

    expect(res.status).toBe(401);
    expect(res.code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

describe('POST /api/inventory/move', () => {
  it('moves a stack and answers with the whole container', async () => {
    await give('leek', 4, 0);

    const res = await client.post('/api/inventory/move', {
      from: { container: 'inventory', slot: 0 },
      to: { container: 'inventory', slot: 5 },
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('moved');
    expect(res.body.bag.slots).toEqual([{ slotIndex: 5, itemId: 'leek', quantity: 4 }]);
    // Both containers come back on every drag, so the panel can redraw the
    // chest half without a second request (T-10.02).
    expect(res.body.chest.slots).toEqual([]);
    expect(res.body.chest.capacity).toBeGreaterThan(0);
  });

  it('swaps two occupied slots', async () => {
    await give('leek', 4, 0);
    await give('onion', 2, 1);

    const res = await client.post('/api/inventory/move', {
      from: { container: 'inventory', slot: 0 },
      to: { container: 'inventory', slot: 1 },
      idempotencyKey: newKey(),
    });

    expect(res.body.kind).toBe('swapped');
    expect(await slots()).toEqual(
      expect.arrayContaining([
        { slotIndex: 0, itemId: 'onion', quantity: 2 },
        { slotIndex: 1, itemId: 'leek', quantity: 4 },
      ]),
    );
  });

  /** The client cannot invent a slot it has not paid for. */
  it('rejects a slot index beyond the capacity the player actually has', async () => {
    await give('leek', 4, 0);

    const res = await client.post('/api/inventory/move', {
      from: { container: 'inventory', slot: 0 },
      to: { container: 'inventory', slot: BASE_INVENTORY_SLOTS },
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(await slots()).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 4 }]);
  });

  it('rejects a malformed index at the schema before it reaches the service', async () => {
    for (const slot of [-1, 1.5, 10_000, 'three']) {
      const res = await client.post('/api/inventory/move', {
        from: { container: 'inventory', slot: 0 },
        to: { container: 'inventory', slot },
        idempotencyKey: newKey(),
      });
      expect(res.code, String(slot)).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  /** The shape itself is part of the contract; half a drag is not a drag. */
  it('rejects a body missing an end of the drag', async () => {
    for (const body of [
      { from: { container: 'inventory', slot: 0 } },
      { to: { container: 'inventory', slot: 1 } },
      { from: { slot: 0 }, to: { container: 'inventory', slot: 1 } },
      { from: { container: 'inventory' }, to: { container: 'inventory', slot: 1 } },
    ]) {
      const res = await client.post('/api/inventory/move', {
        ...body,
        idempotencyKey: newKey(),
      });
      expect(res.code, JSON.stringify(body)).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it('rejects a move out of an empty slot', async () => {
    const res = await client.post('/api/inventory/move', {
      from: { container: 'inventory', slot: 2 },
      to: { container: 'inventory', slot: 3 },
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
  });

  /**
   * A resent drag must not swap twice — that would silently undo the move the
   * player made and look like the game ignored them (§4.5).
   */
  it('replaying the same key does not swap twice', async () => {
    await give('leek', 4, 0);
    await give('onion', 2, 1);

    const key = newKey();
    const drag = {
      from: { container: 'inventory', slot: 0 },
      to: { container: 'inventory', slot: 1 },
      idempotencyKey: key,
    };
    const first = await client.post('/api/inventory/move', drag);
    const replay = await client.post('/api/inventory/move', drag);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await slots()).toEqual(
      expect.arrayContaining([
        { slotIndex: 0, itemId: 'onion', quantity: 2 },
        { slotIndex: 1, itemId: 'leek', quantity: 4 },
      ]),
    );
  });

  it('cannot rearrange another player’s bag', async () => {
    await give('leek', 4, 0);

    const other = await createTestClient();
    await registerTestUser(other);

    // Same slot indices, different session: it can only ever reach its own rows.
    const res = await other.post('/api/inventory/move', {
      from: { container: 'inventory', slot: 0 },
      to: { container: 'inventory', slot: 9 },
      idempotencyKey: newKey(),
    });

    expect(res.body.bag?.slots?.some((s: { itemId: string }) => s.itemId === 'leek')).not.toBe(
      true,
    );
    expect(await slots()).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 4 }]);

    await other.close();
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    const res = await anonymous.post('/api/inventory/move', {
      from: { container: 'inventory', slot: 0 },
      to: { container: 'inventory', slot: 1 },
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

/**
 * The same endpoint, pointed at the chest (T-10.01).
 *
 * Deliberately a mirror of the bag block above rather than a shared loop: the
 * two containers have different capacities and different failure cases, and a
 * parameterised suite would hide exactly the asymmetry these tests exist to
 * pin.
 */
describe('POST /api/inventory/move — the chest', () => {
  async function giveChest(itemId: string, quantity: number, slotIndex: number): Promise<void> {
    await db.insert(schema.inventoryItems).values({
      playerId,
      container: 'chest',
      slotIndex,
      itemId,
      quantity,
    });
  }

  async function chestSlots() {
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
          eq(schema.inventoryItems.container, 'chest'),
        ),
      );
  }

  /** Buys a tier without going through the shop: this suite is about moves. */
  async function setChestTier(tier: number): Promise<void> {
    await db
      .update(schema.farms)
      .set({ chestTier: tier })
      .where(eq(schema.farms.playerId, playerId));
  }

  it('moves a stack inside the chest and answers with the chest', async () => {
    await giveChest('leek', 4, 0);
    await give('onion', 9, 0);

    const res = await client.post('/api/inventory/move', {
      from: { container: 'chest', slot: 0 },
      to: { container: 'chest', slot: 5 },
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('moved');
    // Each grid in its own half of the answer: the two are open side by side in
    // the panel T-10.04 builds, and swapping them would redraw the chest's
    // contents into the bag.
    expect(res.body.chest.slots).toEqual([{ slotIndex: 5, itemId: 'leek', quantity: 4 }]);
    expect(res.body.bag.slots).toEqual([{ slotIndex: 0, itemId: 'onion', quantity: 9 }]);
    expect(await slots()).toEqual([{ slotIndex: 0, itemId: 'onion', quantity: 9 }]);
  });

  it('merges two stacks of the same item, leaving the remainder behind', async () => {
    const stackLimit = getItem('leek')!.stackLimit;
    await giveChest('leek', stackLimit - 1, 0);
    await giveChest('leek', 5, 1);

    const res = await client.post('/api/inventory/move', {
      from: { container: 'chest', slot: 1 },
      to: { container: 'chest', slot: 0 },
      idempotencyKey: newKey(),
    });

    expect(res.body.kind).toBe('merged');
    expect(res.body.moved).toBe(1);
    // Nothing destroyed: the four that did not fit are still in the source.
    expect(await chestSlots()).toEqual(
      expect.arrayContaining([
        { slotIndex: 0, itemId: 'leek', quantity: stackLimit },
        { slotIndex: 1, itemId: 'leek', quantity: 4 },
      ]),
    );
  });

  it('swaps two occupied chest slots', async () => {
    await giveChest('leek', 4, 0);
    await giveChest('onion', 2, 1);

    const res = await client.post('/api/inventory/move', {
      from: { container: 'chest', slot: 0 },
      to: { container: 'chest', slot: 1 },
      idempotencyKey: newKey(),
    });

    expect(res.body.kind).toBe('swapped');
    expect(await chestSlots()).toEqual(
      expect.arrayContaining([
        { slotIndex: 0, itemId: 'onion', quantity: 2 },
        { slotIndex: 1, itemId: 'leek', quantity: 4 },
      ]),
    );
  });

  /**
   * The test the whole task turns on. A tier-1 chest has 48 slots while the bag
   * still has 24, so slot 30 is real storage in one container and imaginary in
   * the other. Checking a chest index against the bag's cap would refuse a slot
   * the player has actually paid for.
   */
  it('checks slot indices against the CHEST capacity, not the bag’s', async () => {
    await setChestTier(1);
    await giveChest('leek', 4, 0);

    const upgraded = await client.get('/api/inventory/chest');
    expect(upgraded.body.capacity).toBeGreaterThan(BASE_INVENTORY_SLOTS);

    const res = await client.post('/api/inventory/move', {
      from: { container: 'chest', slot: 0 },
      to: { container: 'chest', slot: BASE_INVENTORY_SLOTS + 6 },
      idempotencyKey: newKey(),
    });

    expect(res.status, res.code).toBe(200);
    expect(await chestSlots()).toEqual([
      { slotIndex: BASE_INVENTORY_SLOTS + 6, itemId: 'leek', quantity: 4 },
    ]);
  });

  it('still refuses a slot beyond the chest’s own capacity', async () => {
    await giveChest('leek', 4, 0);

    const res = await client.post('/api/inventory/move', {
      from: { container: 'chest', slot: 0 },
      to: { container: 'chest', slot: CHEST_TIERS[0]!.slots },
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(await chestSlots()).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 4 }]);
  });

  it('rejects a move out of an empty chest slot', async () => {
    await give('leek', 4, 2); // the same index, but in the bag
    const res = await client.post('/api/inventory/move', {
      from: { container: 'chest', slot: 2 },
      to: { container: 'chest', slot: 3 },
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    // And the bag row that shares the index was not touched.
    expect(await slots()).toEqual([{ slotIndex: 2, itemId: 'leek', quantity: 4 }]);
  });

  it('leaves the bag alone entirely, index for index', async () => {
    await give('leek', 4, 0);
    await giveChest('onion', 2, 0);

    await client.post('/api/inventory/move', {
      from: { container: 'chest', slot: 0 },
      to: { container: 'chest', slot: 1 },
      idempotencyKey: newKey(),
    });

    expect(await slots()).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 4 }]);
    expect(await chestSlots()).toEqual([{ slotIndex: 1, itemId: 'onion', quantity: 2 }]);
  });

  it('rejects a container that is not one of the two', async () => {
    for (const container of ['bank', '', 'INVENTORY', 1]) {
      const res = await client.post('/api/inventory/move', {
        from: { container, slot: 0 },
        to: { container: 'inventory', slot: 1 },
        idempotencyKey: newKey(),
      });
      expect(res.code, String(container)).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it('cannot rearrange another player’s chest', async () => {
    await giveChest('leek', 4, 0);

    const other = await createTestClient();
    await registerTestUser(other);

    const res = await other.post('/api/inventory/move', {
      from: { container: 'chest', slot: 0 },
      to: { container: 'chest', slot: 9 },
      idempotencyKey: newKey(),
    });

    expect(res.body.chest?.slots?.some((s: { itemId: string }) => s.itemId === 'leek')).not.toBe(
      true,
    );
    expect(await chestSlots()).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 4 }]);

    await other.close();
  });
});

/**
 * Dragging between the two containers (T-10.02).
 *
 * The same three outcomes as a drag inside one container, so the cases mirror
 * those above — but each one also re-counts the TOTAL held across both
 * containers. A cross-container move is the easiest place in the game to build
 * an item sink: "left the bag, never arrived in the chest" looks like success
 * from the source side.
 */
describe('POST /api/inventory/move — across containers', () => {
  async function giveIn(
    container: 'inventory' | 'chest',
    itemId: string,
    quantity: number,
    slotIndex: number,
  ): Promise<void> {
    await db.insert(schema.inventoryItems).values({
      playerId,
      container,
      slotIndex,
      itemId,
      quantity,
    });
  }

  async function rows() {
    return db
      .select({
        container: schema.inventoryItems.container,
        slotIndex: schema.inventoryItems.slotIndex,
        itemId: schema.inventoryItems.itemId,
        quantity: schema.inventoryItems.quantity,
      })
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.playerId, playerId));
  }

  /** Every unit the player owns, wherever it is. */
  async function totalHeld(): Promise<number> {
    return (await rows()).reduce((sum, r) => sum + r.quantity, 0);
  }

  const drag = (
    fromContainer: 'inventory' | 'chest',
    fromSlot: number,
    toContainer: 'inventory' | 'chest',
    toSlot: number,
  ) => ({
    from: { container: fromContainer, slot: fromSlot },
    to: { container: toContainer, slot: toSlot },
    idempotencyKey: newKey(),
  });

  it('moves a stack into an empty chest slot', async () => {
    await giveIn('inventory', 'leek', 4, 0);
    const before = await totalHeld();

    const res = await client.post('/api/inventory/move', drag('inventory', 0, 'chest', 3));

    expect(res.status, res.code).toBe(200);
    expect(res.body.kind).toBe('moved');
    expect(res.body.bag.slots).toEqual([]);
    expect(res.body.chest.slots).toEqual([{ slotIndex: 3, itemId: 'leek', quantity: 4 }]);
    expect(await totalHeld()).toBe(before);
  });

  it('moves back out of the chest into the bag', async () => {
    await giveIn('chest', 'onion', 6, 2);
    const before = await totalHeld();

    const res = await client.post('/api/inventory/move', drag('chest', 2, 'inventory', 0));

    expect(res.body.kind).toBe('moved');
    expect(await rows()).toEqual([
      { container: 'inventory', slotIndex: 0, itemId: 'onion', quantity: 6 },
    ]);
    expect(await totalHeld()).toBe(before);
  });

  it('merges onto a chest stack and leaves the remainder in the bag', async () => {
    const stackLimit = getItem('leek')!.stackLimit;
    await giveIn('inventory', 'leek', 10, 0);
    await giveIn('chest', 'leek', stackLimit - 4, 1);
    const before = await totalHeld();

    const res = await client.post('/api/inventory/move', drag('inventory', 0, 'chest', 1));

    expect(res.body.kind).toBe('merged');
    expect(res.body.moved).toBe(4);
    // The six that did not fit are still in the bag. Nothing evaporated.
    expect(await rows()).toEqual(
      expect.arrayContaining([
        { container: 'inventory', slotIndex: 0, itemId: 'leek', quantity: 6 },
        { container: 'chest', slotIndex: 1, itemId: 'leek', quantity: stackLimit },
      ]),
    );
    expect(await totalHeld()).toBe(before);
  });

  it('empties the source slot when the whole stack fits', async () => {
    await giveIn('inventory', 'leek', 3, 0);
    await giveIn('chest', 'leek', 5, 0);

    const res = await client.post('/api/inventory/move', drag('inventory', 0, 'chest', 0));

    expect(res.body).toMatchObject({ kind: 'merged', moved: 3 });
    expect(await rows()).toEqual([
      { container: 'chest', slotIndex: 0, itemId: 'leek', quantity: 8 },
    ]);
  });

  it('swaps two different items across the containers', async () => {
    await giveIn('inventory', 'leek', 4, 0);
    await giveIn('chest', 'onion', 2, 7);
    const before = await totalHeld();

    const res = await client.post('/api/inventory/move', drag('inventory', 0, 'chest', 7));

    expect(res.body.kind).toBe('swapped');
    expect(await rows()).toEqual(
      expect.arrayContaining([
        { container: 'inventory', slotIndex: 0, itemId: 'onion', quantity: 2 },
        { container: 'chest', slotIndex: 7, itemId: 'leek', quantity: 4 },
      ]),
    );
    expect(await totalHeld()).toBe(before);
  });

  it('swaps rather than merging when the destination stack is already full', async () => {
    const stackLimit = getItem('leek')!.stackLimit;
    await giveIn('inventory', 'leek', 3, 0);
    await giveIn('chest', 'leek', stackLimit, 0);

    const res = await client.post('/api/inventory/move', drag('inventory', 0, 'chest', 0));

    expect(res.body.kind).toBe('swapped');
    expect(await rows()).toEqual(
      expect.arrayContaining([
        { container: 'inventory', slotIndex: 0, itemId: 'leek', quantity: stackLimit },
        { container: 'chest', slotIndex: 0, itemId: 'leek', quantity: 3 },
      ]),
    );
  });

  /**
   * Each end against its own capacity. A tier-1 chest has 48 slots and the bag
   * has 24, so slot 30 is real in one direction and imaginary in the other —
   * one shared cap cannot be right for both.
   */
  it('checks each end against its own container’s capacity', async () => {
    await db
      .update(schema.farms)
      .set({ chestTier: 1 })
      .where(eq(schema.farms.playerId, playerId));

    await giveIn('inventory', 'leek', 4, 0);
    const intoChest = await client.post(
      '/api/inventory/move',
      drag('inventory', 0, 'chest', BASE_INVENTORY_SLOTS + 6),
    );
    expect(intoChest.status, intoChest.code).toBe(200);

    // ...and the same index is still out of bounds coming back the other way.
    const backToBag = await client.post(
      '/api/inventory/move',
      drag('chest', BASE_INVENTORY_SLOTS + 6, 'inventory', BASE_INVENTORY_SLOTS + 6),
    );
    expect(backToBag.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(await rows()).toEqual([
      {
        container: 'chest',
        slotIndex: BASE_INVENTORY_SLOTS + 6,
        itemId: 'leek',
        quantity: 4,
      },
    ]);
  });

  it('rejects a drag out of an empty slot without touching the destination', async () => {
    await giveIn('chest', 'onion', 2, 1);

    const res = await client.post('/api/inventory/move', drag('inventory', 0, 'chest', 1));

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await rows()).toEqual([
      { container: 'chest', slotIndex: 1, itemId: 'onion', quantity: 2 },
    ]);
  });

  it('replaying the same key does not drag twice', async () => {
    await giveIn('inventory', 'leek', 4, 0);
    await giveIn('chest', 'onion', 2, 0);

    const body = drag('inventory', 0, 'chest', 0);
    const first = await client.post('/api/inventory/move', body);
    const replay = await client.post('/api/inventory/move', body);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    // Without idempotency the replay would swap them straight back.
    expect(await rows()).toEqual(
      expect.arrayContaining([
        { container: 'inventory', slotIndex: 0, itemId: 'onion', quantity: 2 },
        { container: 'chest', slotIndex: 0, itemId: 'leek', quantity: 4 },
      ]),
    );
  });

  /**
   * The lock, under fire. Twelve drags of the same two stacks, back and forth,
   * launched together: `lockBothContainers` makes them queue, so whatever order
   * they land in, the units are conserved.
   *
   * Without it the reads are unlocked and a stale one can delete a row another
   * drag has already emptied into — an item sink, not a duplication, which is
   * the direction that would go unnoticed.
   */
  it('conserves every unit when drags collide', async () => {
    await giveIn('inventory', 'leek', 5, 0);
    await giveIn('chest', 'leek', 5, 0);
    const before = await totalHeld();

    await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        client.post(
          '/api/inventory/move',
          i % 2 === 0 ? drag('inventory', 0, 'chest', 0) : drag('chest', 0, 'inventory', 0),
        ),
      ),
    );

    expect(await totalHeld()).toBe(before);
  });

  it('cannot reach another player’s containers', async () => {
    await giveIn('inventory', 'leek', 4, 0);

    const other = await createTestClient();
    const otherPlayer = await registerTestUser(other);
    // Emptied so the drag has nothing of THEIR own to move: if slot 0 could
    // ever resolve across accounts, this would succeed on my leek instead of
    // failing on their empty slot.
    await db
      .delete(schema.inventoryItems)
      .where(eq(schema.inventoryItems.playerId, otherPlayer.id));

    const res = await other.post('/api/inventory/move', drag('inventory', 0, 'chest', 0));

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await rows()).toEqual([
      { container: 'inventory', slotIndex: 0, itemId: 'leek', quantity: 4 },
    ]);
    await other.close();
  });
});
