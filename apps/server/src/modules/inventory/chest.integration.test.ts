import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  BASE_CHEST_SLOTS,
  BASE_INVENTORY_SLOTS,
  CHEST_TIERS,
  ErrorCode,
  VIP_BENEFITS,
  getItem,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * Bag <-> chest transfers.
 *
 * A transfer is the easiest place in the game to accidentally build an item
 * sink: the failure mode "took them out of the bag, could not fit them in the
 * chest" looks like success from the source side. So almost every test here
 * re-counts the TOTAL held across both containers afterwards, and expects it
 * unchanged.
 */

const STACK = getItem('leek')!.stackLimit;

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, playerId));
});

afterAll(closeDb);

async function give(
  itemId: string,
  quantity: number,
  container: 'inventory' | 'chest' = 'inventory',
): Promise<void> {
  const existing = await db
    .select({ slotIndex: schema.inventoryItems.slotIndex })
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.playerId, playerId),
        eq(schema.inventoryItems.container, container),
      ),
    );

  const used = new Set(existing.map((s) => s.slotIndex));
  let slotIndex = 0;
  while (used.has(slotIndex)) slotIndex += 1;

  await db
    .insert(schema.inventoryItems)
    .values({ playerId, container, slotIndex, itemId, quantity });
}

async function held(container?: 'inventory' | 'chest', itemId?: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.playerId, playerId));

  return rows
    .filter((r) => (container ? r.container === container : true))
    .filter((r) => (itemId ? r.itemId === itemId : true))
    .reduce((sum, r) => sum + r.quantity, 0);
}

function move(itemId: string, quantity: number, direction: 'to_chest' | 'to_bag') {
  return client.post('/api/inventory/transfer', {
    itemId,
    quantity,
    direction,
    idempotencyKey: newKey(),
  });
}

describe('GET /api/inventory/chest', () => {
  it('is a separate container with its own capacity', async () => {
    await give('leek', 5, 'inventory');
    await give('potato', 3, 'chest');

    const bag = await client.get('/api/inventory');
    const chest = await client.get('/api/inventory/chest');

    expect(bag.body.slots).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 5 }]);
    expect(chest.body.slots).toEqual([{ slotIndex: 0, itemId: 'potato', quantity: 3 }]);

    expect(bag.body.capacity).toBe(BASE_INVENTORY_SLOTS);
    expect(chest.body.capacity).toBe(BASE_CHEST_SLOTS);
  });

  it('reports the capacity a chest upgrade would buy', async () => {
    const tier2 = CHEST_TIERS.find((t) => t.tier === 2)!;
    await db.update(schema.farms).set({ chestTier: 2 }).where(eq(schema.farms.playerId, playerId));

    const chest = await client.get('/api/inventory/chest');
    expect(chest.body.capacity).toBe(tier2.slots);
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    expect((await anonymous.get('/api/inventory/chest')).code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

describe('POST /api/inventory/transfer', () => {
  it('moves items into the chest and out of the bag', async () => {
    await give('leek', 10);

    const res = await move('leek', 4, 'to_chest');

    expect(res.status, res.code).toBe(200);
    expect(await held('inventory', 'leek')).toBe(6);
    expect(await held('chest', 'leek')).toBe(4);
  });

  it('moves items back out again', async () => {
    await give('leek', 10, 'chest');

    await move('leek', 7, 'to_bag');

    expect(await held('chest', 'leek')).toBe(3);
    expect(await held('inventory', 'leek')).toBe(7);
  });

  it('answers with both containers, so the client renders from truth', async () => {
    await give('leek', 5);

    const res = await move('leek', 2, 'to_chest');

    expect(res.body.bag.slots).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 3 }]);
    expect(res.body.chest.slots).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 2 }]);
    expect(res.body.chest.capacity).toBe(BASE_CHEST_SLOTS);
  });

  it('merges into a stack already in the destination', async () => {
    await give('leek', 5, 'inventory');
    await give('leek', 5, 'chest');

    await move('leek', 5, 'to_chest');

    expect(await held('chest', 'leek')).toBe(10);
    expect(await held('inventory', 'leek')).toBe(0);
  });

  /* -------------------------------------------------------------- *
   * The failure paths, which are the point
   * -------------------------------------------------------------- */

  it('fails whole when the destination is full, leaving everything where it was', async () => {
    // Fill every chest slot with something else entirely.
    for (let i = 0; i < BASE_CHEST_SLOTS; i++) await give('potato', STACK, 'chest');
    await give('leek', 5, 'inventory');

    const before = await held();
    const res = await move('leek', 5, 'to_chest');

    expect(res.code).toBe(ErrorCode.INVENTORY_FULL);
    expect(await held('inventory', 'leek')).toBe(5);
    expect(await held('chest', 'leek')).toBe(0);
    expect(await held()).toBe(before);
  });

  it('fails whole when the source does not hold that many', async () => {
    await give('leek', 3);

    const res = await move('leek', 4, 'to_chest');

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await held('inventory', 'leek')).toBe(3);
    expect(await held('chest', 'leek')).toBe(0);
  });

  it('will not move something that is only in the other container', async () => {
    await give('leek', 5, 'chest');

    const res = await move('leek', 1, 'to_chest');

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await held('chest', 'leek')).toBe(5);
  });

  it('rejects a quantity that is not a positive whole number', async () => {
    await give('leek', 5);

    for (const quantity of [0, -1, 2.5]) {
      const res = await client.post('/api/inventory/transfer', {
        itemId: 'leek',
        quantity,
        direction: 'to_chest',
        idempotencyKey: newKey(),
      });
      expect(res.code, String(quantity)).toBe(ErrorCode.VALIDATION_FAILED);
    }
    expect(await held('inventory', 'leek')).toBe(5);
  });

  it('rejects an unknown item and an unknown direction', async () => {
    expect((await move('philosophers_stone', 1, 'to_chest')).code).toBe(ErrorCode.UNKNOWN_ITEM);

    const res = await client.post('/api/inventory/transfer', {
      itemId: 'leek',
      quantity: 1,
      direction: 'to_the_moon',
      idempotencyKey: newKey(),
    });
    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  /* -------------------------------------------------------------- *
   * Duplication
   * -------------------------------------------------------------- */

  /** The whole reason the transfer is one transaction. */
  it('never changes the total held, whatever the outcome', async () => {
    await give('leek', 20);
    await give('potato', 8, 'chest');
    const before = await held();

    await move('leek', 5, 'to_chest');
    await move('potato', 3, 'to_bag');
    await move('leek', 500, 'to_chest'); // refused
    await move('onion', 1, 'to_bag'); // refused
    await move('leek', 15, 'to_chest');

    expect(await held()).toBe(before);
  });

  it('is idempotent: a replayed transfer moves one lot, not two', async () => {
    await give('leek', 10);

    const key = newKey();
    const body = { itemId: 'leek', quantity: 4, direction: 'to_chest', idempotencyKey: key };

    const first = await client.post('/api/inventory/transfer', body);
    const replay = await client.post('/api/inventory/transfer', body);

    expect(replay.body).toEqual(first.body);
    expect(await held('chest', 'leek')).toBe(4);
    expect(await held('inventory', 'leek')).toBe(6);
  });

  it('cannot be raced into duplicating items', async () => {
    await give('leek', 10);

    // Ten simultaneous transfers of 2, against a bag holding exactly 10.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => move('leek', 2, 'to_chest')),
    );

    const succeeded = results.filter((r) => r.status === 200).length;
    expect(succeeded).toBeGreaterThan(0);
    expect(await held()).toBe(10);
    expect(await held('chest', 'leek')).toBe(succeeded * 2);
    expect(await held('inventory', 'leek')).toBe(10 - succeeded * 2);
  });

  /**
   * The lock-order inversion `lockBothContainers` exists to prevent: one
   * direction takes bag-then-chest, the other chest-then-bag. Same player, two
   * tabs. Without a single up-front lock Postgres kills one of them as a
   * deadlock, which surfaces as a 500 rather than a game rule.
   */
  it('survives simultaneous transfers in opposite directions', async () => {
    await give('leek', 50, 'inventory');
    await give('potato', 50, 'chest');

    const results = await Promise.all([
      ...Array.from({ length: 8 }, () => move('leek', 1, 'to_chest')),
      ...Array.from({ length: 8 }, () => move('potato', 1, 'to_bag')),
    ]);

    for (const res of results) {
      expect([200, 409], `unexpected ${res.status}: ${JSON.stringify(res.body)}`).toContain(
        res.status,
      );
      expect(res.status).not.toBe(500);
    }

    expect(await held()).toBe(100);
  });

  it("cannot touch another player's chest", async () => {
    await give('leek', 5, 'chest');

    const other = await createTestClient();
    await registerTestUser(other);

    const res = await other.post('/api/inventory/transfer', {
      itemId: 'leek',
      quantity: 5,
      direction: 'to_bag',
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await held('chest', 'leek')).toBe(5);
    await other.close();
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    const res = await anonymous.post('/api/inventory/transfer', {
      itemId: 'leek',
      quantity: 1,
      direction: 'to_chest',
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

/* ------------------------------------------------------------------ *
 * Upgrades
 * ------------------------------------------------------------------ */

describe('POST /api/inventory/chest/upgrade', () => {
  async function gold(): Promise<number> {
    const [row] = await db
      .select({ gold: schema.players.gold })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));
    return row!.gold;
  }

  async function tier(): Promise<number> {
    const [row] = await db
      .select({ chestTier: schema.farms.chestTier })
      .from(schema.farms)
      .where(eq(schema.farms.playerId, playerId));
    return row!.chestTier;
  }

  async function setGold(amount: number): Promise<void> {
    await db.update(schema.players).set({ gold: amount }).where(eq(schema.players.id, playerId));
  }

  function upgrade() {
    return client.post('/api/inventory/chest/upgrade', { idempotencyKey: newKey() });
  }

  it('charges the configured cost and raises the tier', async () => {
    const tier1 = CHEST_TIERS.find((t) => t.tier === 1)!;
    await setGold(tier1.cost);

    const res = await upgrade();

    expect(res.status, res.code).toBe(200);
    expect(res.body.tier).toBe(1);
    expect(res.body.goldDelta).toBe(-tier1.cost);
    expect(await tier()).toBe(1);
    expect(await gold()).toBe(0);
  });

  it('increases the capacity immediately', async () => {
    const tier1 = CHEST_TIERS.find((t) => t.tier === 1)!;
    await setGold(tier1.cost);

    expect((await client.get('/api/inventory/chest')).body.capacity).toBe(BASE_CHEST_SLOTS);
    const res = await upgrade();
    expect(res.body.capacity).toBe(tier1.slots);
    expect((await client.get('/api/inventory/chest')).body.capacity).toBe(tier1.slots);
  });

  /**
   * Order is enforced by the SHAPE of the endpoint — there is no target tier to
   * send — so this walks the whole track and checks each step costs what its own
   * tier costs, in sequence.
   */
  it('buys tiers strictly in order', async () => {
    await setGold(1_000_000);

    for (const step of CHEST_TIERS.filter((t) => t.tier > 0)) {
      const before = await gold();
      const res = await upgrade();

      expect(res.body.tier, `tier ${step.tier}`).toBe(step.tier);
      expect(before - (await gold()), `cost of tier ${step.tier}`).toBe(step.cost);
    }

    expect(await tier()).toBe(CHEST_TIERS[CHEST_TIERS.length - 1]!.tier);
  });

  it('refuses once there is nothing left to buy', async () => {
    await setGold(1_000_000);
    for (let i = 1; i < CHEST_TIERS.length; i++) await upgrade();

    const before = await gold();
    const res = await upgrade();

    expect(res.code).toBe(ErrorCode.UPGRADE_MAX_TIER);
    expect(await gold()).toBe(before);
  });

  it('refuses without the gold, and does not raise the tier', async () => {
    const tier1 = CHEST_TIERS.find((t) => t.tier === 1)!;
    await setGold(tier1.cost - 1);

    const res = await upgrade();

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_GOLD);
    expect(await tier()).toBe(0);
    expect(await gold()).toBe(tier1.cost - 1);
  });

  it('is idempotent: a replayed upgrade buys one tier, not two', async () => {
    await setGold(1_000_000);
    const key = newKey();

    const first = await client.post('/api/inventory/chest/upgrade', { idempotencyKey: key });
    const replay = await client.post('/api/inventory/chest/upgrade', { idempotencyKey: key });

    expect(replay.body).toEqual(first.body);
    expect(await tier()).toBe(1);
  });

  it('cannot be raced into buying two tiers for one price', async () => {
    const tier1 = CHEST_TIERS.find((t) => t.tier === 1)!;
    await setGold(tier1.cost);

    const results = await Promise.all([upgrade(), upgrade(), upgrade()]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await tier()).toBe(1);
    expect(await gold()).toBe(0);
  });

  it('never orphans what is already stored', async () => {
    await give('leek', 5, 'chest');
    await setGold(1_000_000);

    await upgrade();

    const chest = await client.get('/api/inventory/chest');
    expect(chest.body.slots).toEqual([{ slotIndex: 0, itemId: 'leek', quantity: 5 }]);
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    const res = await anonymous.post('/api/inventory/chest/upgrade', { idempotencyKey: newKey() });
    expect(res.code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

/* ------------------------------------------------------------------ *
 * Capacity that SHRINKS
 * ------------------------------------------------------------------ */

/**
 * An upgrade can only grow a chest, so it cannot orphan anything. **VIP expiry
 * can.** A VIP chest is `tier.slots + bonusChestSlots`; when the VIP lapses the
 * capacity drops, and anything stored in the slots it used to have is suddenly
 * past the end.
 *
 * Those items must not become invisible or unrecoverable. The rule settled on
 * here: capacity limits what you can PUT IN, never what you can see or take
 * out.
 */
describe('items stored beyond a shrunken capacity', () => {
  beforeEach(async () => {
    // A slot only a VIP chest could have reached.
    const beyond = BASE_CHEST_SLOTS + 3;
    expect(VIP_BENEFITS.bonusChestSlots).toBeGreaterThan(3);

    await db.insert(schema.inventoryItems).values({
      playerId,
      container: 'chest',
      slotIndex: beyond,
      itemId: 'leek',
      quantity: 7,
    });
  });

  it('are still listed, so the player can see them', async () => {
    const chest = await client.get('/api/inventory/chest');

    expect(chest.body.capacity).toBe(BASE_CHEST_SLOTS);
    expect(chest.body.slots).toEqual([
      { slotIndex: BASE_CHEST_SLOTS + 3, itemId: 'leek', quantity: 7 },
    ]);
  });

  it('can still be taken out', async () => {
    const res = await move('leek', 7, 'to_bag');

    expect(res.status, res.code).toBe(200);
    expect(await held('inventory', 'leek')).toBe(7);
    expect(await held('chest', 'leek')).toBe(0);
  });

  it('do not let anything NEW be stored past the capacity', async () => {
    // Fill every legitimate slot, then try to add one more.
    for (let i = 0; i < BASE_CHEST_SLOTS; i++) await give('potato', STACK, 'chest');
    await give('onion', 1, 'inventory');

    const res = await move('onion', 1, 'to_chest');

    expect(res.code).toBe(ErrorCode.INVENTORY_FULL);
    expect(await held('chest', 'onion')).toBe(0);
  });
});
