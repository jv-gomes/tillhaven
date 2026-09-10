import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  ANIMALS,
  BASE_INVENTORY_SLOTS,
  CROPS,
  CROP_IDS,
  ErrorCode,
  HOUR,
  ITEMS,
  ITEM_IDS,
  VIP_BENEFITS,
  type CropId,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * The two VIP bulk actions (T-24.01, T-24.02, D-23).
 *
 * They live in one file although the endpoints live in two modules, because
 * what is under test is one benefit pair with one gate and one partial-failure
 * rule. Splitting them would put the interesting property — *a full bag costs
 * one plot, not the batch* — in two places, written twice, and drifting.
 *
 * The per-plot and per-animal rules are NOT retested here. That is the point of
 * both services looping over the real `harvest` and `collect`: `farm.integration`
 * and `animals.integration` own those rules, and if bulk had its own copy this
 * file would have to own them a second time.
 */

let client: TestClient;
let playerId: string;
let farmId: string;

/** A VIP's bag: the base backpack plus the VIP bonus, at backpack tier 0. */
const VIP_SLOTS = BASE_INVENTORY_SLOTS + VIP_BENEFITS.bonusInventorySlots;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  const [farm] = await db.select().from(schema.farms).where(eq(schema.farms.playerId, playerId));
  farmId = farm!.id;

  // These tests assert exact bag occupancy, so they start from an empty bag
  // and stock precisely what each one needs.
  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, playerId));
  await db.update(schema.players).set({ gold: 1_000_000 }).where(eq(schema.players.id, playerId));
});

afterAll(closeDb);

/* ------------------------------------------------------------------ *
 * Helpers. Every one of them writes only TIMESTAMPS, ownership rows, or
 * the snapshotted duration a real plant would have stored — never a
 * stage, a ripeness, or a result. What is under test stays the real
 * calculation.
 * ------------------------------------------------------------------ */

async function makeVip(): Promise<void> {
  await db
    .update(schema.players)
    .set({ vipUntil: Date.now() + 30 * 24 * HOUR, flaggedAt: null })
    .where(eq(schema.players.id, playerId));
}

async function unlockedPlots(): Promise<{ id: string }[]> {
  const rows = await db
    .select({ id: schema.plots.id, unlocked: schema.plots.unlocked })
    .from(schema.plots)
    .where(eq(schema.plots.farmId, farmId));
  return rows.filter((r) => r.unlocked).map((r) => ({ id: r.id }));
}

/** Puts a fully grown crop in a plot: tilled, planted, watered, banked to ripe. */
async function makeRipe(plotId: string, cropId: CropId): Promise<void> {
  const crop = CROPS[cropId];
  const now = Date.now();
  await db
    .update(schema.plots)
    .set({
      tilledAt: now - crop.growthDurationMs,
      cropId,
      plantedAt: now - crop.growthDurationMs,
      growthDurationMs: crop.growthDurationMs,
      // Banked growth, exactly as a run of closed wet windows would have left it.
      grownMs: crop.growthDurationMs,
      wateredAt: now,
      harvestedAt: null,
      witheredAt: null,
    })
    .where(eq(schema.plots.id, plotId));
}

/** Same, but one millisecond short of ripe — and wet, so it is not merely paused. */
async function makeAlmostRipe(plotId: string, cropId: CropId): Promise<void> {
  const crop = CROPS[cropId];
  const now = Date.now();
  await db
    .update(schema.plots)
    .set({
      tilledAt: now - crop.growthDurationMs,
      cropId,
      plantedAt: now - crop.growthDurationMs,
      growthDurationMs: crop.growthDurationMs,
      grownMs: 0,
      wateredAt: now,
      harvestedAt: null,
      witheredAt: null,
    })
    .where(eq(schema.plots.id, plotId));
}

async function plotRow(plotId: string) {
  const [row] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId));
  return row!;
}

async function held(itemId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.inventoryItems)
    .where(
      and(eq(schema.inventoryItems.playerId, playerId), eq(schema.inventoryItems.itemId, itemId)),
    );
  return rows.reduce((sum, r) => sum + r.quantity, 0);
}

/**
 * Occupies every bag slot but `free`, each slot filled to its item's stack
 * limit.
 *
 * **Full stacks, not one-of-each.** A VIP bag is 24 slots and the game defines
 * only 12 items that are not produce, so "a different item per slot" cannot
 * reach the top of the bag. Filling each slot to `stackLimit` gets there with
 * repeats and is the stronger padding anyway: a partially filled stack is a
 * slot incoming produce could merge into, which would leave the test measuring
 * stacking instead of slots.
 */
async function fillBagLeaving(free: number): Promise<void> {
  const toFill = VIP_SLOTS - free;
  const padding = ITEM_IDS.filter((id) => !CROP_IDS.some((c) => CROPS[c].produceItemId === id));

  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, playerId));
  for (let slotIndex = 0; slotIndex < toFill; slotIndex += 1) {
    const itemId = padding[slotIndex % padding.length]!;
    await db.insert(schema.inventoryItems).values({
      playerId,
      container: 'inventory',
      slotIndex,
      itemId,
      quantity: ITEMS[itemId]!.stackLimit,
    });
  }
}

async function buyAnimal(kind: 'chicken' | 'cow'): Promise<string> {
  const res = await client.post('/api/animals/buy', {
    kind,
    variant: ANIMALS[kind].variants[0],
    idempotencyKey: newKey(),
  });
  expect(res.status, res.code).toBe(200);
  return res.body.animalId;
}

/** Mature, fed, and owing exactly `cycles` collections. */
async function makeReady(animalId: string, kind: 'chicken' | 'cow', cycles = 1): Promise<void> {
  const def = ANIMALS[kind];
  const now = Date.now();
  const collectedAt = now - cycles * def.productionIntervalMs;
  await db
    .update(schema.animals)
    .set({ maturesAt: collectedAt, lastCollectedAt: collectedAt, fedUntil: now + def.feedDurationMs })
    .where(eq(schema.animals.id, animalId));
}

async function animalRow(animalId: string) {
  const [row] = await db.select().from(schema.animals).where(eq(schema.animals.id, animalId));
  return row!;
}

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

describe('the VIP gate on both bulk endpoints', () => {
  it('refuses a free account, and changes nothing', async () => {
    const plots = await unlockedPlots();
    await makeRipe(plots[0]!.id, CROP_IDS[0]!);

    const res = await client.post('/api/farm/harvest-all', { idempotencyKey: newKey() });

    expect(res.code).toBe(ErrorCode.FORBIDDEN);
    expect((await plotRow(plots[0]!.id)).cropId).toBe(CROP_IDS[0]);
  });

  it('refuses a free account collecting in bulk, and leaves the produce', async () => {
    const id = await buyAnimal('chicken');
    await makeReady(id, 'chicken');
    const before = (await animalRow(id)).lastCollectedAt;

    const res = await client.post('/api/animals/collect-all', { idempotencyKey: newKey() });

    expect(res.code).toBe(ErrorCode.FORBIDDEN);
    expect((await animalRow(id)).lastCollectedAt).toBe(before);
  });

  /**
   * The flagged-account rule, at the one place a benefit BOOLEAN is read
   * rather than a duration. `isVipActive` is what both go through, and a
   * refunded account that kept its bulk button would be a paid feature
   * surviving its own refund.
   */
  it('refuses a flagged account even with vipUntil far in the future', async () => {
    await db
      .update(schema.players)
      .set({ vipUntil: Date.now() + 30 * 24 * HOUR, flaggedAt: Date.now() - 1 })
      .where(eq(schema.players.id, playerId));

    const plots = await unlockedPlots();
    await makeRipe(plots[0]!.id, CROP_IDS[0]!);

    const res = await client.post('/api/farm/harvest-all', { idempotencyKey: newKey() });
    expect(res.code).toBe(ErrorCode.FORBIDDEN);
  });
});

/* ------------------------------------------------------------------ *
 * POST /api/farm/harvest-all
 * ------------------------------------------------------------------ */

describe('POST /api/farm/harvest-all', () => {
  beforeEach(makeVip);

  it('harvests every ripe plot and leaves the unripe ones growing', async () => {
    const plots = await unlockedPlots();
    expect(plots.length).toBeGreaterThanOrEqual(3);

    const crop = CROPS[CROP_IDS[0]!];
    await makeRipe(plots[0]!.id, CROP_IDS[0]!);
    await makeRipe(plots[1]!.id, CROP_IDS[0]!);
    await makeAlmostRipe(plots[2]!.id, CROP_IDS[0]!);

    const res = await client.post('/api/farm/harvest-all', { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.harvested).toHaveLength(2);
    expect(res.body.stoppedByFullBag).toBe(false);
    expect(await held(crop.produceItemId)).toBe(2 * crop.yieldAmount);

    expect((await plotRow(plots[0]!.id)).cropId).toBeNull();
    expect((await plotRow(plots[1]!.id)).cropId).toBeNull();
    expect((await plotRow(plots[2]!.id)).cropId).toBe(CROP_IDS[0]);
  });

  it('leaves harvested soil tilled, exactly as a single harvest does', async () => {
    const plots = await unlockedPlots();
    await makeRipe(plots[0]!.id, CROP_IDS[0]!);

    await client.post('/api/farm/harvest-all', { idempotencyKey: newKey() });

    const row = await plotRow(plots[0]!.id);
    expect(row.cropId).toBeNull();
    expect(row.tilledAt).not.toBeNull();
    expect(row.grownMs).toBe(0);
  });

  it('grants the same experience as harvesting each plot by hand', async () => {
    const plots = await unlockedPlots();
    await makeRipe(plots[0]!.id, CROP_IDS[0]!);
    await makeRipe(plots[1]!.id, CROP_IDS[0]!);

    const res = await client.post('/api/farm/harvest-all', { idempotencyKey: newKey() });

    // The batch reports the running total after the last plot, so the two
    // entries must be strictly increasing and the result must match the last.
    const [first, second] = res.body.harvested;
    expect(second.experience).toBeGreaterThan(first.experience);
    expect(res.body.experience).toBe(second.experience);
  });

  /**
   * The partial-batch rule. Three ripe plots of three different crops, one free
   * slot: one fits, the next throws INVENTORY_FULL, and the one that fitted
   * stays harvested.
   *
   * **Break-tested, and the first attempt was wrong.** Replacing
   * `tx.transaction((sp) => harvest(...))` with a flat `harvest(tx, ...)`
   * changes nothing — every test here still passes — because `addItem` plans
   * the whole write and throws before issuing any of it, so a failed harvest
   * leaves nothing behind to roll back. What DOES break it is the pair: flat
   * loop plus `harvest` writing its plot update above its `addItem`. Then this
   * assertion drops to one remaining crop instead of two, because a plot was
   * cleared and no produce was added. Putting the savepoint back, with the
   * reorder still in place, makes it pass again.
   *
   * That is what this test guards: not the bag, but the fact that a batch's
   * atomicity must not depend on another module's statement order.
   */
  it('harvests what fits, leaves the rest standing, and says so', async () => {
    expect(CROP_IDS.length).toBeGreaterThanOrEqual(3);
    const plots = await unlockedPlots();

    await makeRipe(plots[0]!.id, CROP_IDS[0]!);
    await makeRipe(plots[1]!.id, CROP_IDS[1]!);
    await makeRipe(plots[2]!.id, CROP_IDS[2]!);
    await fillBagLeaving(1);

    const res = await client.post('/api/farm/harvest-all', { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.harvested).toHaveLength(1);
    expect(res.body.stoppedByFullBag).toBe(true);

    const remaining = await Promise.all(plots.slice(0, 3).map((p) => plotRow(p.id)));
    expect(remaining.filter((p) => p.cropId !== null)).toHaveLength(2);
  });

  it('refuses with INVENTORY_FULL when not one plot fits, and harvests nothing', async () => {
    const plots = await unlockedPlots();
    await makeRipe(plots[0]!.id, CROP_IDS[0]!);
    await makeRipe(plots[1]!.id, CROP_IDS[1]!);
    await fillBagLeaving(0);

    const res = await client.post('/api/farm/harvest-all', { idempotencyKey: newKey() });

    expect(res.code).toBe(ErrorCode.INVENTORY_FULL);
    expect((await plotRow(plots[0]!.id)).cropId).toBe(CROP_IDS[0]);
    expect((await plotRow(plots[1]!.id)).cropId).toBe(CROP_IDS[1]);
  });

  it('refuses with CROP_NOT_READY when nothing is ripe', async () => {
    const plots = await unlockedPlots();
    await makeAlmostRipe(plots[0]!.id, CROP_IDS[0]!);

    const res = await client.post('/api/farm/harvest-all', { idempotencyKey: newKey() });
    expect(res.code).toBe(ErrorCode.CROP_NOT_READY);
  });

  it('does not double-harvest a replayed idempotency key', async () => {
    const plots = await unlockedPlots();
    const crop = CROPS[CROP_IDS[0]!];
    await makeRipe(plots[0]!.id, CROP_IDS[0]!);
    await makeRipe(plots[1]!.id, CROP_IDS[0]!);

    const key = newKey();
    const first = await client.post('/api/farm/harvest-all', { idempotencyKey: key });
    const second = await client.post('/api/farm/harvest-all', { idempotencyKey: key });

    expect(first.status, first.code).toBe(200);
    expect(second.status, second.code).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await held(crop.produceItemId)).toBe(2 * crop.yieldAmount);
  });

  it('never touches another farm‘s ripe plots', async () => {
    const mine = await unlockedPlots();
    await makeRipe(mine[0]!.id, CROP_IDS[0]!);

    // A second player, ripe crops of their own.
    const other = await createTestClient();
    const otherId = (await registerTestUser(other)).id;
    const [otherFarm] = await db
      .select()
      .from(schema.farms)
      .where(eq(schema.farms.playerId, otherId));
    const otherPlots = await db
      .select()
      .from(schema.plots)
      .where(eq(schema.plots.farmId, otherFarm!.id));
    const theirs = otherPlots.find((p) => p.unlocked)!;
    await db
      .update(schema.plots)
      .set({
        cropId: CROP_IDS[0]!,
        plantedAt: Date.now() - HOUR,
        growthDurationMs: CROPS[CROP_IDS[0]!].growthDurationMs,
        grownMs: CROPS[CROP_IDS[0]!].growthDurationMs,
        wateredAt: Date.now(),
      })
      .where(eq(schema.plots.id, theirs.id));

    const res = await client.post('/api/farm/harvest-all', { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.harvested).toHaveLength(1);
    const [after] = await db.select().from(schema.plots).where(eq(schema.plots.id, theirs.id));
    expect(after!.cropId).toBe(CROP_IDS[0]);

    await other.close();
  });
});

/* ------------------------------------------------------------------ *
 * POST /api/animals/collect-all
 * ------------------------------------------------------------------ */

describe('POST /api/animals/collect-all', () => {
  beforeEach(makeVip);

  it('collects from every ready animal in one call', async () => {
    const a = await buyAnimal('chicken');
    const b = await buyAnimal('chicken');
    await makeReady(a, 'chicken');
    await makeReady(b, 'chicken');

    const res = await client.post('/api/animals/collect-all', { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.collected).toHaveLength(2);
    expect(res.body.stoppedByFullBag).toBe(false);
    expect(await held(ANIMALS.chicken.produceItemId)).toBe(2 * ANIMALS.chicken.yieldAmount);
  });

  /**
   * A barn full of unfed cows must not stop the button emptying the coop. This
   * is the difference from `harvestAll`: a plot is ripe or it is not, whereas
   * an animal has three separate ways of having nothing for you, and all three
   * are ordinary rather than exceptional.
   */
  it('skips animals that are unfed or still young, and collects the rest', async () => {
    const ready = await buyAnimal('chicken');
    const unfed = await buyAnimal('chicken');
    await buyAnimal('chicken'); // stays a baby: immature, nothing owed

    await makeReady(ready, 'chicken');
    await makeReady(unfed, 'chicken');
    await db
      .update(schema.animals)
      .set({ fedUntil: Date.now() - HOUR })
      .where(eq(schema.animals.id, unfed));
    // The third animal keeps its purchase-time timestamps.

    const res = await client.post('/api/animals/collect-all', { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.collected).toHaveLength(1);
    expect(res.body.collected[0].animalId).toBe(ready);
  });

  it('collects what fits, leaves the rest with the animals, and says so', async () => {
    const chicken = await buyAnimal('chicken');
    const cow = await buyAnimal('cow');
    await makeReady(chicken, 'chicken');
    await makeReady(cow, 'cow');
    await fillBagLeaving(1);

    const res = await client.post('/api/animals/collect-all', { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.collected).toHaveLength(1);
    expect(res.body.stoppedByFullBag).toBe(true);
  });

  it('refuses with NOTHING_TO_COLLECT when no animal is ready', async () => {
    await buyAnimal('chicken');

    const res = await client.post('/api/animals/collect-all', { idempotencyKey: newKey() });
    expect(res.code).toBe(ErrorCode.NOTHING_TO_COLLECT);
  });

  it('does not double-collect a replayed idempotency key', async () => {
    const id = await buyAnimal('chicken');
    await makeReady(id, 'chicken');

    const key = newKey();
    const first = await client.post('/api/animals/collect-all', { idempotencyKey: key });
    const second = await client.post('/api/animals/collect-all', { idempotencyKey: key });

    expect(first.status, first.code).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await held(ANIMALS.chicken.produceItemId)).toBe(ANIMALS.chicken.yieldAmount);
  });

  it('never collects from another farm‘s animals', async () => {
    const mine = await buyAnimal('chicken');
    await makeReady(mine, 'chicken');

    const other = await createTestClient();
    const otherId = (await registerTestUser(other)).id;
    await db.update(schema.players).set({ gold: 100_000 }).where(eq(schema.players.id, otherId));
    const theirRes = await other.post('/api/animals/buy', {
      kind: 'chicken',
      variant: ANIMALS.chicken.variants[0],
      idempotencyKey: newKey(),
    });
    const theirs = theirRes.body.animalId;
    await db
      .update(schema.animals)
      .set({
        maturesAt: Date.now() - 10 * HOUR,
        lastCollectedAt: Date.now() - 10 * HOUR,
        fedUntil: Date.now() + 10 * HOUR,
      })
      .where(eq(schema.animals.id, theirs));

    const before = (await animalRow(theirs)).lastCollectedAt;
    const res = await client.post('/api/animals/collect-all', { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.collected).toHaveLength(1);
    expect((await animalRow(theirs)).lastCollectedAt).toBe(before);

    await other.close();
  });
});
