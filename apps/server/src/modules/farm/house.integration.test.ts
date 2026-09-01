import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  BASE_INVENTORY_SLOTS,
  COOP_TIERS,
  ErrorCode,
  HOUSE_TIERS,
  ANIMALS,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * House upgrades.
 *
 * The purchase mechanics are the chest's, on the same shared spine, so what is
 * worth proving here is the part that is different: that the bonuses a tier
 * buys are **live on the next request**, in both of the places they apply.
 * Nothing caches them, and these tests are what says so.
 */

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;
});

afterAll(closeDb);

async function setGold(amount: number): Promise<void> {
  await db.update(schema.players).set({ gold: amount }).where(eq(schema.players.id, playerId));
}

async function gold(): Promise<number> {
  const [row] = await db
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, playerId));
  return row!.gold;
}

async function houseTier(): Promise<number> {
  const [row] = await db
    .select({ houseTier: schema.farms.houseTier })
    .from(schema.farms)
    .where(eq(schema.farms.playerId, playerId));
  return row!.houseTier;
}

function upgrade() {
  return client.post('/api/farm/house/upgrade', { idempotencyKey: newKey() });
}

describe('GET /api/farm/house', () => {
  it('starts at tier 0 and quotes the next price', async () => {
    const res = await client.get('/api/farm/house');

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe(0);
    expect(res.body.nextCost).toBe(HOUSE_TIERS.find((t) => t.tier === 1)!.cost);
  });

  /**
   * T-12.02 moved the animal cap onto the coop and barn, which was the last
   * mechanical thing the house did. The view must not still be advertising a
   * cap it does not set — a tier that promises something the game does not
   * deliver is worse than a tier that promises nothing, which is exactly the
   * lesson T-10.03 left here about bag slots.
   */
  it('no longer claims to set an animal cap', async () => {
    const res = await client.get('/api/farm/house');

    expect(res.body.animalCap).toBeUndefined();
    expect(res.body.nextAnimalCap).toBeUndefined();
  });

  /**
   * T-10.03 moved bag size onto the backpack. The house view must not still be
   * advertising slots it no longer grants — a tier that promises something the
   * game does not deliver is worse than a tier that promises nothing.
   */
  it('no longer mentions inventory slots at all', async () => {
    const res = await client.get('/api/farm/house');

    expect(res.body.inventorySlots).toBeUndefined();
    expect(res.body.nextInventorySlots).toBeUndefined();
  });

  it('has nothing to offer at the top tier', async () => {
    const top = HOUSE_TIERS[HOUSE_TIERS.length - 1]!;
    await db
      .update(schema.farms)
      .set({ houseTier: top.tier })
      .where(eq(schema.farms.playerId, playerId));

    const res = await client.get('/api/farm/house');
    expect(res.body.nextCost).toBeNull();
  });
});

describe('POST /api/farm/house/upgrade', () => {
  it('charges the configured cost and raises the tier', async () => {
    const tier1 = HOUSE_TIERS.find((t) => t.tier === 1)!;
    await setGold(tier1.cost);

    const res = await upgrade();

    expect(res.status, res.code).toBe(200);
    expect(res.body.tier).toBe(1);
    expect(res.body.goldDelta).toBe(-tier1.cost);
    expect(await houseTier()).toBe(1);
    expect(await gold()).toBe(0);
  });

  it('buys tiers strictly in order, each at its own price', async () => {
    await setGold(1_000_000);

    for (const step of HOUSE_TIERS.filter((t) => t.tier > 0)) {
      const before = await gold();
      const res = await upgrade();

      expect(res.body.tier, `tier ${step.tier}`).toBe(step.tier);
      expect(before - (await gold()), `cost of tier ${step.tier}`).toBe(step.cost);
    }

    expect(await houseTier()).toBe(HOUSE_TIERS[HOUSE_TIERS.length - 1]!.tier);
  });

  it('refuses once the house is fully built', async () => {
    await setGold(1_000_000);
    for (let i = 1; i < HOUSE_TIERS.length; i++) await upgrade();

    const before = await gold();
    const res = await upgrade();

    expect(res.code).toBe(ErrorCode.UPGRADE_MAX_TIER);
    expect(await gold()).toBe(before);
  });

  it('refuses without the gold, and does not raise the tier', async () => {
    const tier1 = HOUSE_TIERS.find((t) => t.tier === 1)!;
    await setGold(tier1.cost - 1);

    const res = await upgrade();

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_GOLD);
    expect(await houseTier()).toBe(0);
    expect(await gold()).toBe(tier1.cost - 1);
  });

  it('is idempotent: a replayed upgrade buys one tier', async () => {
    await setGold(1_000_000);
    const key = newKey();

    const first = await client.post('/api/farm/house/upgrade', { idempotencyKey: key });
    const replay = await client.post('/api/farm/house/upgrade', { idempotencyKey: key });

    expect(replay.body).toEqual(first.body);
    expect(await houseTier()).toBe(1);
  });

  it('cannot be raced into buying two tiers for one price', async () => {
    const tier1 = HOUSE_TIERS.find((t) => t.tier === 1)!;
    await setGold(tier1.cost);

    const results = await Promise.all([upgrade(), upgrade(), upgrade()]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await houseTier()).toBe(1);
    expect(await gold()).toBe(0);
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    const res = await anonymous.post('/api/farm/house/upgrade', { idempotencyKey: newKey() });
    expect(res.code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

/* ------------------------------------------------------------------ *
 * The bonuses, live
 * ------------------------------------------------------------------ */

/**
 * A tier that raises a number in a response but not in the rule it is supposed
 * to govern is worse than no tier at all — the player paid for a promise the
 * game does not keep. Both bonuses are checked against the endpoints that
 * actually enforce them, not against the upgrade's own reply.
 */
describe('what a tier actually buys', () => {
  it('does NOT raise inventory capacity any more', async () => {
    // The house bought bag slots until T-10.03. Now the backpack does, and the
    // two must stay independent: the assertion is that the number does not move.
    const tier1 = HOUSE_TIERS.find((t) => t.tier === 1)!;
    await setGold(tier1.cost);

    expect((await client.get('/api/inventory')).body.capacity).toBe(BASE_INVENTORY_SLOTS);

    await upgrade();

    expect((await client.get('/api/inventory')).body.capacity).toBe(BASE_INVENTORY_SLOTS);
  });

  /**
   * The mirror of the old 'raises the animal cap, provably' test, inverted by
   * T-12.02: the house must now leave the cap exactly where it found it. Filling
   * the coop, upgrading the house, and being refused again is the only way to
   * observe that from outside — a house tier that still quietly made room would
   * pass every other test in this file.
   */
  it('does not raise the animal cap any more', async () => {
    await setGold(1_000_000);
    const buyChicken = () =>
      client.post('/api/animals/buy', {
        kind: 'chicken',
        variant: ANIMALS.chicken.variants[0],
        idempotencyKey: newKey(),
      });

    const cap = COOP_TIERS[0]!.cap;
    for (let i = 0; i < cap; i++) {
      expect((await buyChicken()).status, `animal ${i}`).toBe(200);
    }
    expect((await buyChicken()).code).toBe(ErrorCode.ANIMAL_CAP_REACHED);

    await upgrade();

    // Still refused: only the coop can make room for a chicken now.
    expect((await buyChicken()).code).toBe(ErrorCode.ANIMAL_CAP_REACHED);
  });

  /**
   * The bag is no longer the house's business (T-10.03), so what matters here
   * is that an upgrade leaves it completely alone — same capacity, same rows.
   * "Capacity only ever grows" moved to the backpack's own suite, where the
   * purchase that grows it now lives.
   */
  it('leaves the backpack untouched', async () => {
    await setGold(1_000_000);
    const before = (await client.get('/api/inventory')).body;

    await upgrade();

    const after = (await client.get('/api/inventory')).body;
    expect(after.capacity).toBe(before.capacity);
    expect(after.slots).toEqual(before.slots);
  });
});
