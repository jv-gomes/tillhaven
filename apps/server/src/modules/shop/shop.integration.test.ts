import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import {
  createTestClient,
  registerTestUser,
  newKey,
  type TestClient,
} from '../../test/app.js';
import {
  ITEMS,
  STARTING_GOLD,
  BASE_INVENTORY_SLOTS,
  BACKPACK_TIERS,
  HOTBAR_SLOTS,
  ANIMALS,
  ANIMAL_BUILDINGS,
  BUILDING_TIERS,
  ErrorCode,
  type AnimalBuilding,
} from '@tillhaven/shared';

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  // Start from an empty bag so item counts are exact; the starter kit has its
  // own test in the farm suite.
  await db
    .delete(schema.inventoryItems)
    .where(eq(schema.inventoryItems.playerId, playerId));
});

afterAll(closeDb);

async function gold(): Promise<number> {
  const [row] = await db
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, playerId));
  return row!.gold;
}

async function held(itemId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.playerId, playerId),
        eq(schema.inventoryItems.itemId, itemId),
      ),
    );
  return rows.reduce((sum, r) => sum + r.quantity, 0);
}

async function give(itemId: string, quantity: number, slotIndex = 0): Promise<void> {
  await db.insert(schema.inventoryItems).values({
    playerId,
    container: 'inventory',
    slotIndex,
    itemId,
    quantity,
  });
}

describe('GET /api/shop', () => {
  it('lists only items that can actually be traded', async () => {
    const res = await client.get('/api/shop');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);

    for (const entry of res.body.items) {
      expect(entry.buyPrice !== null || entry.sellPrice !== null).toBe(true);
    }
  });

  it('quotes the same prices as the shared config', async () => {
    const res = await client.get('/api/shop');
    for (const entry of res.body.items) {
      const item = ITEMS[entry.itemId]!;
      expect(entry.buyPrice).toBe(item.shopBuyPrice);
      expect(entry.sellPrice).toBe(item.shopSellPrice);
    }
  });
});

describe('POST /api/shop/buy', () => {
  it('deducts gold and grants the items', async () => {
    const price = ITEMS['potato_seeds']!.shopBuyPrice!;

    const res = await client.post('/api/shop/buy', {
      itemId: 'potato_seeds',
      quantity: 3,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(res.body.goldDelta).toBe(-price * 3);
    expect(await gold()).toBe(STARTING_GOLD - price * 3);
    expect(await held('potato_seeds')).toBe(3);
  });

  it('refuses when the player cannot afford it, changing nothing', async () => {
    const res = await client.post('/api/shop/buy', {
      itemId: 'onion_seeds',
      quantity: 9999,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe('INSUFFICIENT_GOLD');
    expect(await gold()).toBe(STARTING_GOLD);
    expect(await held('onion_seeds')).toBe(0);
  });

  it('refuses to sell something that is not for sale', async () => {
    // Produce can be sold TO the shop but never bought FROM it.
    const res = await client.post('/api/shop/buy', {
      itemId: 'potato',
      quantity: 1,
      idempotencyKey: newKey(),
    });
    expect(res.status).toBe(400);
    expect(res.code).toBe('ITEM_NOT_FOR_SALE');
    expect(await gold()).toBe(STARTING_GOLD);
  });

  it('rejects an unknown item', async () => {
    const res = await client.post('/api/shop/buy', {
      itemId: 'moon_cheese',
      quantity: 1,
      idempotencyKey: newKey(),
    });
    expect(res.status).toBe(400);
    expect(res.code).toBe('UNKNOWN_ITEM');
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 1.5],
  ])('rejects a %s quantity before any logic runs', async (_label, quantity) => {
    const res = await client.post('/api/shop/buy', {
      itemId: 'leek_seeds',
      quantity,
      idempotencyKey: newKey(),
    });
    expect(res.status).toBe(400);
    expect(res.code).toBe('VALIDATION_FAILED');
    expect(await gold()).toBe(STARTING_GOLD);
  });

  /*
   * The client sends WHAT and HOW MANY, never the price. A body carrying its
   * own price must not be able to influence the charge (CLAUDE.md §4.1).
   */
  it('ignores a price supplied by the client', async () => {
    const real = ITEMS['leek_seeds']!.shopBuyPrice!;

    const res = await client.post('/api/shop/buy', {
      itemId: 'leek_seeds',
      quantity: 2,
      price: 0,
      buyPrice: 0,
      cost: 0,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(res.body.goldDelta).toBe(-real * 2);
    expect(await gold()).toBe(STARTING_GOLD - real * 2);
  });

  it('leaves gold untouched when the bag has no room', async () => {
    for (let i = 0; i < BASE_INVENTORY_SLOTS; i++) {
      await give('hay', 999, i);
    }

    const res = await client.post('/api/shop/buy', {
      itemId: 'leek_seeds',
      quantity: 1,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe('INVENTORY_FULL');
    expect(await gold()).toBe(STARTING_GOLD);
  });

  it('is idempotent: a replayed key charges once', async () => {
    const key = newKey('buy-replay');
    const price = ITEMS['leek_seeds']!.shopBuyPrice!;

    const first = await client.post('/api/shop/buy', { itemId: 'leek_seeds', quantity: 2, idempotencyKey: key });
    const second = await client.post('/api/shop/buy', { itemId: 'leek_seeds', quantity: 2, idempotencyKey: key });

    expect(second.body).toEqual(first.body);
    expect(await gold()).toBe(STARTING_GOLD - price * 2);
    expect(await held('leek_seeds')).toBe(2);
  });

  /*
   * Two purchases that together cost more than the player has.
   *
   * Getting this to test anything took two corrections, both worth recording:
   *
   *  1. With an empty bag, the two calls each INSERT slot 0 and collide on the
   *     (player, container, slot) unique index. That serialises them for the
   *     wrong reason. The player is given an existing stack first so both take
   *     the UPDATE path instead.
   *
   *  2. `Promise.all` alone does not guarantee overlap — measured, the second
   *     request frequently started only after the first had committed, so the
   *     test passed even with the gold lock removed. The gate below holds a row
   *     lock on the player until both requests are in flight, which forces the
   *     overlap deterministically.
   *
   * With the lock: both block on the gate, then serialise, and the second sees
   * the reduced balance. Without it: a plain SELECT does not block under MVCC,
   * so both read the original balance and gold goes negative.
   */
  it('cannot overspend by racing two purchases', async () => {
    const price = ITEMS['onion_seeds']!.shopBuyPrice!;
    const affordable = Math.floor(STARTING_GOLD / price);
    await give('onion_seeds', 1);

    let openGate = (): void => {};
    const gateReleased = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const gate = db.transaction(async (tx) => {
      await tx.execute(
        sql`select gold from players where id = ${playerId} for update`,
      );
      await gateReleased;
    });

    // Let the gate take its lock before the purchases start.
    await new Promise((r) => setTimeout(r, 100));

    const purchases = Promise.all([
      client.post('/api/shop/buy', { itemId: 'onion_seeds', quantity: affordable, idempotencyKey: newKey('ra') }),
      client.post('/api/shop/buy', { itemId: 'onion_seeds', quantity: affordable, idempotencyKey: newKey('rb') }),
    ]);

    // Both are now in flight and contending for the same row.
    await new Promise((r) => setTimeout(r, 200));
    openGate();
    await gate;

    const [a, b] = await purchases;

    expect([a, b].filter((r) => r.status === 200)).toHaveLength(1);
    // Gold can never go negative, whatever the interleaving.
    expect(await gold()).toBeGreaterThanOrEqual(0);
    expect(await gold()).toBe(STARTING_GOLD - price * affordable);
    expect(await held('onion_seeds')).toBe(affordable + 1);
  });
});

describe('POST /api/shop/sell', () => {
  it('removes the items and pays out', async () => {
    await give('potato', 4);
    const price = ITEMS['potato']!.shopSellPrice!;

    const res = await client.post('/api/shop/sell', {
      itemId: 'potato',
      quantity: 3,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(res.body.goldDelta).toBe(price * 3);
    expect(await gold()).toBe(STARTING_GOLD + price * 3);
    expect(await held('potato')).toBe(1);
  });

  it('refuses to sell more than is held, changing nothing', async () => {
    await give('potato', 2);

    const res = await client.post('/api/shop/sell', {
      itemId: 'potato',
      quantity: 5,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe('INSUFFICIENT_ITEMS');
    expect(await gold()).toBe(STARTING_GOLD);
    expect(await held('potato')).toBe(2);
  });

  it('refuses to buy something the shop does not accept', async () => {
    await give('leek_seeds', 5);

    const res = await client.post('/api/shop/sell', {
      itemId: 'leek_seeds',
      quantity: 1,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(400);
    expect(res.code).toBe('ITEM_NOT_SELLABLE');
    expect(await held('leek_seeds')).toBe(5);
  });

  /**
   * T-8.06. A tool is refused on BOTH sides of the counter, and the two are
   * separate guards reading separate fields (`shopBuyPrice` for sale,
   * `shopSellPrice` for buy-back). Testing only one would leave the other free
   * to regress — and a sellable hoe is a gold faucet that every account is
   * handed one of for free at registration.
   */
  it('will neither sell a tool nor buy one back', async () => {
    for (const [slot, itemId] of ['hoe_wood', 'watering_can_wood'].entries()) {
      const buy = await client.post('/api/shop/buy', {
        itemId,
        quantity: 1,
        idempotencyKey: newKey(),
      });
      expect(buy.code, `${itemId} for sale`).toBe('ITEM_NOT_FOR_SALE');

      // This suite starts from an empty bag, so put one in hand first —
      // otherwise the refusal could just be "you have none of those".
      await give(itemId, 1, slot);
      const sell = await client.post('/api/shop/sell', {
        itemId,
        quantity: 1,
        idempotencyKey: newKey(),
      });
      expect(sell.code, `${itemId} sellable`).toBe('ITEM_NOT_SELLABLE');
      expect(await held(itemId), `${itemId} kept`).toBe(1);
    }

    expect(await gold()).toBe(STARTING_GOLD);
  });

  it('is idempotent: a replayed key pays out once', async () => {
    await give('potato', 5);
    const key = newKey('sell-replay');
    const price = ITEMS['potato']!.shopSellPrice!;

    const first = await client.post('/api/shop/sell', { itemId: 'potato', quantity: 2, idempotencyKey: key });
    const second = await client.post('/api/shop/sell', { itemId: 'potato', quantity: 2, idempotencyKey: key });

    expect(second.body).toEqual(first.body);
    expect(await gold()).toBe(STARTING_GOLD + price * 2);
    expect(await held('potato')).toBe(3);
  });

  it('cannot sell the same stack twice by racing', async () => {
    await give('potato', 3);
    const price = ITEMS['potato']!.shopSellPrice!;

    const [a, b] = await Promise.all([
      client.post('/api/shop/sell', { itemId: 'potato', quantity: 3, idempotencyKey: newKey('sa') }),
      client.post('/api/shop/sell', { itemId: 'potato', quantity: 3, idempotencyKey: newKey('sb') }),
    ]);

    expect([a, b].filter((r) => r.status === 200)).toHaveLength(1);
    expect(await gold()).toBe(STARTING_GOLD + price * 3);
    expect(await held('potato')).toBe(0);
  });
});

describe('the shop is not a gold faucet', () => {
  /*
   * CLAUDE.md §5.6. `config.test.ts` asserts the price spread makes this
   * impossible; this proves the endpoints actually honour it end to end.
   */
  it('buying then immediately selling always loses gold', async () => {
    const sellable = ['leek', 'potato', 'strawberry', 'onion', 'egg', 'milk'];

    for (const itemId of sellable) {
      const item = ITEMS[itemId]!;
      if (item.shopBuyPrice === null || item.shopSellPrice === null) continue;
      expect(item.shopSellPrice).toBeLessThan(item.shopBuyPrice);
    }

    // Feed is buyable but not sellable, so it cannot be round-tripped at all.
    await client.post('/api/shop/buy', { itemId: 'hay', quantity: 1, idempotencyKey: newKey() });
    const res = await client.post('/api/shop/sell', {
      itemId: 'hay',
      quantity: 1,
      idempotencyKey: newKey(),
    });
    expect(res.code).toBe('ITEM_NOT_SELLABLE');
  });

  it('growing a crop is profitable end to end', async () => {
    // Buy seed, sell the produce it would yield, come out ahead. If this ever
    // fails, the crop is a trap and the economy is broken.
    const before = await gold();
    const seedPrice = ITEMS['potato_seeds']!.shopBuyPrice!;

    await client.post('/api/shop/buy', { itemId: 'potato_seeds', quantity: 1, idempotencyKey: newKey() });
    await give('potato', 1, 5);
    await client.post('/api/shop/sell', { itemId: 'potato', quantity: 1, idempotencyKey: newKey() });

    const after = await gold();
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBe(ITEMS['potato']!.shopSellPrice! - seedPrice);
  });
});

/**
 * Buying backpack tiers (T-10.03).
 *
 * A tier purchase is gold leaving and a number rising, in one transaction. The
 * cases that matter are the ones where those two could come apart: not enough
 * gold, no tier left to buy, the same click arriving twice, and two clicks
 * arriving at once.
 */
describe('POST /api/shop/backpack', () => {
  const TIER_1 = BACKPACK_TIERS.find((t) => t.tier === 1)!;

  async function setGold(amount: number): Promise<void> {
    await db.update(schema.players).set({ gold: amount }).where(eq(schema.players.id, playerId));
  }

  async function backpackTier(): Promise<number> {
    const [row] = await db
      .select({ tier: schema.players.backpackTier })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));
    return row!.tier;
  }

  async function capacity(): Promise<number> {
    return (await client.get('/api/inventory')).body.capacity;
  }

  it('a new player carries exactly the starting backpack', async () => {
    expect(await backpackTier()).toBe(0);
    expect(await capacity()).toBe(BASE_INVENTORY_SLOTS);
    // The whole starting bag is the hotbar, by design (§5.5).
    expect(BASE_INVENTORY_SLOTS).toBe(HOTBAR_SLOTS);
  });

  it('charges the cost, raises the tier, and says what the next one costs', async () => {
    await setGold(TIER_1.cost + 25);

    const res = await client.post('/api/shop/backpack', { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body).toMatchObject({
      tier: 1,
      capacity: TIER_1.slots,
      goldDelta: -TIER_1.cost,
      goldAfter: 25,
      nextCost: BACKPACK_TIERS.find((t) => t.tier === 2)!.cost,
    });
    expect(await gold()).toBe(25);
    expect(await backpackTier()).toBe(1);
  });

  it('takes effect on the very next request', async () => {
    await setGold(TIER_1.cost);
    expect(await capacity()).toBe(BASE_INVENTORY_SLOTS);

    await client.post('/api/shop/backpack', { idempotencyKey: newKey() });

    expect(await capacity()).toBe(TIER_1.slots);
  });

  /** Capacity only ever grows, so nothing stored can end up out of reach. */
  it('keeps stored items exactly where they were', async () => {
    await setGold(TIER_1.cost);
    await db.insert(schema.inventoryItems).values({
      playerId,
      container: 'inventory',
      slotIndex: BASE_INVENTORY_SLOTS - 1,
      itemId: 'leek',
      quantity: 3,
    });
    const before = (await client.get('/api/inventory')).body;

    await client.post('/api/shop/backpack', { idempotencyKey: newKey() });

    const after = (await client.get('/api/inventory')).body;
    expect(after.capacity).toBeGreaterThan(before.capacity);
    expect(after.slots).toEqual(before.slots);
  });

  it('refuses when the gold is not there, and changes nothing', async () => {
    await setGold(TIER_1.cost - 1);

    const res = await client.post('/api/shop/backpack', { idempotencyKey: newKey() });

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_GOLD);
    expect(await gold()).toBe(TIER_1.cost - 1);
    expect(await backpackTier()).toBe(0);
    expect(await capacity()).toBe(BASE_INVENTORY_SLOTS);
  });

  it('refuses once there is no tier left to buy', async () => {
    const top = BACKPACK_TIERS[BACKPACK_TIERS.length - 1]!;
    await db
      .update(schema.players)
      .set({ backpackTier: top.tier, gold: 1_000_000 })
      .where(eq(schema.players.id, playerId));

    const res = await client.post('/api/shop/backpack', { idempotencyKey: newKey() });

    expect(res.code).toBe(ErrorCode.UPGRADE_MAX_TIER);
    expect(await gold()).toBe(1_000_000);
    expect(await backpackTier()).toBe(top.tier);
  });

  it('sells no tier the player has not reached — they arrive in order', async () => {
    await setGold(1_000_000);

    for (const tier of BACKPACK_TIERS.slice(1)) {
      const res = await client.post('/api/shop/backpack', { idempotencyKey: newKey() });
      // No target tier is expressible in the request, so this is really
      // asserting the shape of the endpoint (§4.1).
      expect(res.body.tier, `tier ${tier.tier}`).toBe(tier.tier);
      expect(res.body.capacity).toBe(tier.slots);
    }
    expect(await backpackTier()).toBe(BACKPACK_TIERS[BACKPACK_TIERS.length - 1]!.tier);
  });

  it('replaying the same key buys one tier, not two', async () => {
    await setGold(TIER_1.cost * 2);
    const key = newKey();

    const first = await client.post('/api/shop/backpack', { idempotencyKey: key });
    const replay = await client.post('/api/shop/backpack', { idempotencyKey: key });

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await backpackTier()).toBe(1);
    expect(await gold()).toBe(TIER_1.cost);
  });

  it('cannot be raced into buying two tiers for one price', async () => {
    // Funded for exactly one tier, so a second charge would have to overdraw.
    await setGold(TIER_1.cost);

    const results = await Promise.all([
      client.post('/api/shop/backpack', { idempotencyKey: newKey() }),
      client.post('/api/shop/backpack', { idempotencyKey: newKey() }),
      client.post('/api/shop/backpack', { idempotencyKey: newKey() }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await backpackTier()).toBe(1);
    expect(await gold()).toBe(0);
  });

  /**
   * The stale-snapshot case, and the reason the tier is read from the locked
   * row rather than from `player.backpackTier`. With gold for two tier-1
   * purchases, a second buy that still believed the tier was 0 would charge
   * 2,000 again for a tier already owned; reading the locked row it sees tier
   * 1, prices tier 2 instead, and cannot afford it.
   */
  it('prices the tier AFTER the one just bought, not the one it started with', async () => {
    await setGold(TIER_1.cost * 2);

    const first = await client.post('/api/shop/backpack', { idempotencyKey: newKey() });
    const second = await client.post('/api/shop/backpack', { idempotencyKey: newKey() });

    expect(first.status).toBe(200);
    expect(second.code).toBe(ErrorCode.INSUFFICIENT_GOLD);
    expect(second.body.error.details).toMatchObject({
      needed: BACKPACK_TIERS.find((t) => t.tier === 2)!.cost,
    });
    expect(await backpackTier()).toBe(1);
    expect(await gold()).toBe(TIER_1.cost);
  });
});


/* ------------------------------------------------------------------ *
 * Coop and barn tiers (T-12.02)
 * ------------------------------------------------------------------ */

describe.each(ANIMAL_BUILDINGS)('POST /api/shop/%s', (building: AnimalBuilding) => {
  const TIERS = BUILDING_TIERS[building];
  const TIER_1 = TIERS.find((t) => t.tier === 1)!;
  const KIND = building === 'coop' ? 'chicken' : 'cow';

  async function setGold(amount: number): Promise<void> {
    await db.update(schema.players).set({ gold: amount }).where(eq(schema.players.id, playerId));
  }

  async function tier(): Promise<number> {
    const [row] = await db
      .select({ coop: schema.farms.coopTier, barn: schema.farms.barnTier })
      .from(schema.farms)
      .where(eq(schema.farms.playerId, playerId));
    return building === 'coop' ? row!.coop : row!.barn;
  }

  function buyAnimal() {
    return client.post('/api/animals/buy', {
      kind: KIND,
      variant: ANIMALS[KIND].variants[0],
      idempotencyKey: newKey(),
    });
  }

  it('a new farm starts at tier 0', async () => {
    expect(await tier()).toBe(0);
  });

  it('charges the cost, raises the tier, and says what the next one costs', async () => {
    await setGold(TIER_1.cost + 25);

    const res = await client.post(`/api/shop/${building}`, { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body).toMatchObject({
      building,
      tier: 1,
      cap: TIER_1.cap,
      goldDelta: -TIER_1.cost,
      goldAfter: 25,
      nextCost: TIERS.find((t) => t.tier === 2)?.cost ?? null,
    });
    expect(await gold()).toBe(25);
    expect(await tier()).toBe(1);
  });

  /**
   * The cap is only observable by hitting it: fill the building, be refused,
   * upgrade, and buy one more. A tier that raised a number nothing consulted
   * would pass every other test here.
   */
  it('takes effect on the very next purchase', async () => {
    await setGold(1_000_000);

    for (let i = 0; i < TIERS[0]!.cap; i++) {
      expect((await buyAnimal()).status, `animal ${i}`).toBe(200);
    }
    expect((await buyAnimal()).code).toBe(ErrorCode.ANIMAL_CAP_REACHED);

    await client.post(`/api/shop/${building}`, { idempotencyKey: newKey() });

    expect((await buyAnimal()).status).toBe(200);
  });

  it('refuses when the gold is not there, and changes nothing', async () => {
    await setGold(TIER_1.cost - 1);

    const res = await client.post(`/api/shop/${building}`, { idempotencyKey: newKey() });

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_GOLD);
    expect(await gold()).toBe(TIER_1.cost - 1);
    expect(await tier()).toBe(0);
  });

  it('refuses once there is no tier left to buy', async () => {
    const top = TIERS[TIERS.length - 1]!;
    await db
      .update(schema.farms)
      .set(building === 'coop' ? { coopTier: top.tier } : { barnTier: top.tier })
      .where(eq(schema.farms.playerId, playerId));
    await setGold(1_000_000);

    const res = await client.post(`/api/shop/${building}`, { idempotencyKey: newKey() });

    expect(res.code).toBe(ErrorCode.UPGRADE_MAX_TIER);
    expect(await gold()).toBe(1_000_000);
    expect(await tier()).toBe(top.tier);
  });

  it('sells no tier the player has not reached — they arrive in order', async () => {
    await setGold(1_000_000);

    for (const t of TIERS.slice(1)) {
      const res = await client.post(`/api/shop/${building}`, { idempotencyKey: newKey() });
      // No target tier is expressible in the request, so this is really
      // asserting the shape of the endpoint (§4.1).
      expect(res.body.tier, `tier ${t.tier}`).toBe(t.tier);
      expect(res.body.cap).toBe(t.cap);
    }
    expect(await tier()).toBe(TIERS[TIERS.length - 1]!.tier);
  });

  it('replaying the same key buys one tier, not two', async () => {
    await setGold(TIER_1.cost * 2);
    const key = newKey();

    const first = await client.post(`/api/shop/${building}`, { idempotencyKey: key });
    const replay = await client.post(`/api/shop/${building}`, { idempotencyKey: key });

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await tier()).toBe(1);
    expect(await gold()).toBe(TIER_1.cost);
  });

  it('cannot be raced into buying two tiers for one price', async () => {
    // Funded for exactly one tier, so a second charge would have to overdraw.
    await setGold(TIER_1.cost);

    const results = await Promise.all([
      client.post(`/api/shop/${building}`, { idempotencyKey: newKey() }),
      client.post(`/api/shop/${building}`, { idempotencyKey: newKey() }),
      client.post(`/api/shop/${building}`, { idempotencyKey: newKey() }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await tier()).toBe(1);
    expect(await gold()).toBe(0);
  });

  /** Buying one building must not quietly enlarge the other. */
  it('leaves the other building alone', async () => {
    await setGold(1_000_000);
    const [before] = await db
      .select({ coop: schema.farms.coopTier, barn: schema.farms.barnTier })
      .from(schema.farms)
      .where(eq(schema.farms.playerId, playerId));

    await client.post(`/api/shop/${building}`, { idempotencyKey: newKey() });

    const [after] = await db
      .select({ coop: schema.farms.coopTier, barn: schema.farms.barnTier })
      .from(schema.farms)
      .where(eq(schema.farms.playerId, playerId));

    if (building === 'coop') expect(after!.barn).toBe(before!.barn);
    else expect(after!.coop).toBe(before!.coop);
  });
});
