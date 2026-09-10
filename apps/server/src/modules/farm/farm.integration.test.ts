import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import {
  createTestClient,
  registerTestUser,
  newKey,
  type TestClient,
} from '../../test/app.js';
import {
  CROPS,
  CROP_IDS,
  FARM_LEVEL_XP,
  TRADE_MIN_FARM_LEVEL,
  levelForXp,
  xpForHarvest,
  STARTING_PLOTS,
  STARTING_ITEMS,
  HOUR,
  BASE_INVENTORY_SLOTS,
  WATER_DURATION_MS,
  TREES,
  TREE_REGROW_MS,
  WOOD_PER_TREE,
  ENERGY_COST,
  SLEEP_DURATION_MS,
  EnergyAction,
  energyCapForLevel,
} from '@tillhaven/shared';

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  /*
   * Registration grants a starter kit. These tests assert exact item counts, so
   * each one starts from an empty bag and stocks exactly what it needs. The kit
   * itself is covered by its own test below.
   */
  await db
    .delete(schema.inventoryItems)
    .where(eq(schema.inventoryItems.playerId, playerId));
});

afterAll(closeDb);

/* ------------------------------------------------------------------ *
 * Helpers that manipulate state directly, to avoid waiting hours for a
 * crop to grow. They only ever move TIMESTAMPS — never a stage, never a
 * result — so what is under test is still the real growth calculation.
 * ------------------------------------------------------------------ */

async function unlockedPlotIds(): Promise<string[]> {
  const state = await client.get('/api/farm');
  return state.body.plots.filter((p: { unlocked: boolean }) => p.unlocked).map((p: { id: string }) => p.id);
}

/**
 * Puts items in the first FREE slot. Registration grants a starter kit, so the
 * low slot indices are already occupied — hardcoding one collides with the
 * unique index on (player, container, slot).
 */
async function giveItem(itemId: string, quantity: number): Promise<void> {
  // Named `giveSeeds` until T-20.03 needed it for an axe. It was always
  // generic — `itemId`, `quantity` — so the name was the only thing narrow
  // about it, and a second near-identical helper would have been worse.
  const existing = await db
    .select({ slotIndex: schema.inventoryItems.slotIndex })
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.playerId, playerId),
        eq(schema.inventoryItems.container, 'inventory'),
      ),
    );

  const used = new Set(existing.map((s) => s.slotIndex));
  let slotIndex = 0;
  while (used.has(slotIndex)) slotIndex += 1;

  await db.insert(schema.inventoryItems).values({
    playerId,
    container: 'inventory',
    slotIndex,
    itemId,
    quantity,
  });
}

async function heldQuantity(itemId: string): Promise<number> {
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

/**
 * The first unlocked plot, already tilled.
 *
 * Stamps `tilled_at` DIRECTLY, in the same spirit as `backdatePlot` below: it
 * moves a timestamp and nothing else, so a planting test still exercises the
 * real planting rules rather than becoming a test of tilling as well. The till
 * ENDPOINT has its own describe block, which uses the real route throughout.
 */
async function tilledPlotId(): Promise<string> {
  const [plotId] = await unlockedPlotIds();
  await db
    .update(schema.plots)
    .set({ tilledAt: Date.now() })
    .where(eq(schema.plots.id, plotId!));
  return plotId!;
}

/**
 * Gives a plot `byMs` of GROWING time, without waiting for it.
 *
 * Since D-1 a crop only advances while its soil is wet, so elapsed growth is
 * banked into `grown_ms` — the very column the water endpoint writes when it
 * settles a closing window — rather than being implied by `planted_at` alone.
 * `planted_at` still moves back with it so the plot's timeline stays coherent.
 *
 * This is the same trick as before and the same limit on it: only bookkeeping
 * that real waterings would have produced is written, never a stage, a
 * ripeness or a result. Everything under test is still computed from it.
 *
 * Calls accumulate, so repeated ones walk a crop through its stages. Tests
 * that are ABOUT watering use `ageWatering` instead and go through the
 * endpoint.
 */
async function backdatePlot(plotId: string, byMs: number): Promise<void> {
  const [plot] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId));
  await db
    .update(schema.plots)
    .set({ plantedAt: plot!.plantedAt! - byMs, grownMs: plot!.grownMs + byMs })
    .where(eq(schema.plots.id, plotId));
}

/**
 * Moves the open wet window `byMs` into the past — "that watering happened
 * `byMs` ago".
 *
 * The one timestamp shifted is `watered_at`, so how much growth it earned (and
 * whether the window has since lapsed) is left entirely to the real
 * calculation. Shifting it past `WATER_DURATION_MS` is how a test dries a plot
 * out without waiting four hours.
 */
async function ageWatering(plotId: string, byMs: number): Promise<void> {
  const [plot] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId));
  await db
    .update(schema.plots)
    .set({ wateredAt: plot!.wateredAt! - byMs })
    .where(eq(schema.plots.id, plotId));
}

/** The raw row, so assertions can be about stored state rather than a view. */
async function plotRowOf(plotId: string) {
  const [row] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId));
  return row!;
}

/** The plot as the farm-state endpoint reports it. */
async function plotView(plotId: string) {
  const state = await client.get('/api/farm');
  return state.body.plots.find((p: { id: string }) => p.id === plotId);
}

/* ------------------------------------------------------------------ *
 * Farm state
 * ------------------------------------------------------------------ */

describe('the starter kit', () => {
  it('lets a brand-new player plant without visiting a shop', async () => {
    // Checked on a fresh client, since the outer beforeEach empties the bag.
    const fresh = await createTestClient();
    await registerTestUser(fresh);

    const { slots } = (await fresh.get('/api/inventory')).body;
    expect(slots.length).toBe(STARTING_ITEMS.length);

    for (const expected of STARTING_ITEMS) {
      const slot = slots.find((s: { itemId: string }) => s.itemId === expected.itemId);
      expect(slot, expected.itemId).toBeDefined();
      expect(slot.quantity).toBe(expected.quantity);
    }

    /*
     * T-8.06: named explicitly, not just covered by the loop above. A farm
     * cannot be worked without a hoe and a watering can, and neither can be
     * bought — if they ever fall out of STARTING_ITEMS the loop still passes
     * while every new account is permanently unable to till.
     *
     * Slots 0 and 1 specifically: `auth/service.ts` inserts at
     * `slotIndex: index`, and T-8.07 makes the first twelve backpack slots the
     * hotbar, so this is what puts a new player's tools on keys 1 and 2.
     */
    const at = (index: number) =>
      slots.find((s: { slotIndex: number }) => s.slotIndex === index)?.itemId;
    expect(at(0)).toBe('hoe_wood');
    expect(at(1)).toBe('watering_can_wood');

    /*
     * And it is genuinely usable: till and plant immediately, through the real
     * endpoints. Deliberately NOT the `tilledPlotId` shortcut — the claim being
     * made is that a brand-new account can work its farm with what it was
     * given, and a test that stamps `tilled_at` itself would not be making it.
     */
    const state = await fresh.get('/api/farm');
    const plot = state.body.plots.find((p: { unlocked: boolean }) => p.unlocked);

    const tilled = await fresh.post('/api/farm/till', {
      plotId: plot.id,
      idempotencyKey: newKey(),
    });
    expect(tilled.status, tilled.code).toBe(200);

    const res = await fresh.post('/api/farm/plant', {
      plotId: plot.id,
      cropId: 'leek',
      idempotencyKey: newKey(),
    });
    expect(res.status, res.code).toBe(200);
    await fresh.close();
  });
});

describe('GET /api/farm', () => {
  it('returns the caller‘s own farm with growth already resolved', async () => {
    const res = await client.get('/api/farm');

    expect(res.status).toBe(200);
    expect(res.body.farm.playerId).toBe(playerId);
    expect(res.body.plots.filter((p: { unlocked: boolean }) => p.unlocked)).toHaveLength(
      STARTING_PLOTS,
    );
    expect(typeof res.body.serverNow).toBe('number');

    // Empty plots report stage -1, never a crop frame.
    for (const plot of res.body.plots) {
      expect(plot.stage).toBe(-1);
      expect(plot.isRipe).toBe(false);
    }
  });

  /* ---------------------------------------------------------------- *
   * Trees (T-20.01)
   * ---------------------------------------------------------------- */

  it('seeds one tree per authored position at registration', async () => {
    const res = await client.get('/api/farm');

    expect(res.body.trees).toHaveLength(TREES.length);
    // The rows must describe the SAME forest `farm.json` draws, or a player
    // chops a tree that is not where they are standing.
    expect(new Set(res.body.trees.map((t: { x: number; y: number }) => `${t.x},${t.y}`))).toEqual(
      new Set(TREES.map((t) => `${t.x},${t.y}`)),
    );
  });

  it('reports a fresh farm‘s trees as standing', async () => {
    const res = await client.get('/api/farm');

    for (const tree of res.body.trees) {
      expect(tree.isStanding, `${tree.x},${tree.y}`).toBe(true);
      expect(tree.regrowsInMs).toBe(0);
      expect(typeof tree.id).toBe('string');
    }
  });

  /**
   * The §4.2 behaviour, end to end: no job runs, so a stump has to become a
   * tree purely because time passed between two reads. Written against a
   * `chopped_at` set directly because the chop intent is T-20.03 — the state
   * model has to be right before there is anything that writes it.
   */
  it('reports a chopped tree as a stump, then standing once it regrows', async () => {
    const farm = (await client.get('/api/farm')).body.farm;
    const now = Date.now();

    // Chopped just now: a stump with the full wait ahead of it.
    await db.update(schema.trees).set({ choppedAt: now }).where(eq(schema.trees.farmId, farm.id));

    const stumps = (await client.get('/api/farm')).body.trees;
    expect(stumps.every((t: { isStanding: boolean }) => !t.isStanding)).toBe(true);
    for (const t of stumps) {
      // Bounded rather than exact: the server reads its own clock, so this is
      // "nearly the whole wait", not a millisecond promise.
      expect(t.regrowsInMs).toBeGreaterThan(TREE_REGROW_MS - 60_000);
      expect(t.regrowsInMs).toBeLessThanOrEqual(TREE_REGROW_MS);
    }

    // Chopped a full cycle ago: back, with nothing having run in between.
    await db
      .update(schema.trees)
      .set({ choppedAt: now - TREE_REGROW_MS })
      .where(eq(schema.trees.farmId, farm.id));

    const regrown = (await client.get('/api/farm')).body.trees;
    expect(regrown.every((t: { isStanding: boolean }) => t.isStanding)).toBe(true);
    expect(regrown.every((t: { regrowsInMs: number }) => t.regrowsInMs === 0)).toBe(true);
  });

  it('never exposes another player‘s farm', async () => {
    const other = await createTestClient();
    const otherUser = await registerTestUser(other);

    const mine = await client.get('/api/farm');
    expect(mine.body.farm.playerId).toBe(playerId);
    expect(mine.body.farm.playerId).not.toBe(otherUser.id);

    // And nothing in my farm state mentions them at all.
    expect(JSON.stringify(mine.body)).not.toContain(otherUser.id);
    await other.close();
  });

  it('does not leak the password hash or session tokens', async () => {
    const serialised = JSON.stringify((await client.get('/api/farm')).body);
    expect(serialised).not.toContain('argon2');
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('password_hash');
  });

  /**
   * The soil half of the view (T-9.04). The client draws three states from
   * these fields and must never have to work one out from `plantedAt` — since
   * D-1 that is not even possible, because growth is watered time.
   */
  describe('soil state', () => {
    it('starts untilled, dry and unwatered', async () => {
      for (const plot of (await client.get('/api/farm')).body.plots) {
        expect(plot.tilled).toBe(false);
        expect(plot.isWet).toBe(false);
        expect(plot.wetUntil).toBeNull();
        expect(plot.isPaused).toBe(false);
        expect(plot.effectiveDurationMs).toBe(0);
      }
    });

    it('reports tilled soil, and keeps reporting it after a harvest', async () => {
      const [plotId] = await unlockedPlotIds();
      await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });
      expect((await plotView(plotId!)).tilled).toBe(true);

      await giveItem(CROPS.potato.seedItemId, 1);
      await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey() });
      await backdatePlot(plotId!, CROPS.potato.growthDurationMs);
      await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });

      // Harvesting leaves workable soil (§5.2), and the view says so.
      expect((await plotView(plotId!)).tilled).toBe(true);
    });

    it('reports when the soil dries out, without the client computing it', async () => {
      await giveItem(CROPS.onion.seedItemId, 1);
      const plotId = await tilledPlotId();
      await client.post('/api/farm/plant', { plotId, cropId: 'onion', idempotencyKey: newKey() });

      // Dry from the moment it is planted: the first watering starts growth.
      const planted = await plotView(plotId);
      expect(planted.isWet).toBe(false);
      expect(planted.wetUntil).toBeNull();
      expect(planted.isPaused).toBe(true);
      expect(planted.effectiveDurationMs).toBe(CROPS.onion.growthDurationMs);

      const watered = await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
      const wet = await plotView(plotId);
      expect(wet.isWet).toBe(true);
      expect(wet.isPaused).toBe(false);
      // The window's end, so the client can let it lapse on screen between
      // polls rather than being told a boolean 20 seconds late.
      expect(wet.wetUntil).toBe(watered.body.wateredAt + WATER_DURATION_MS);

      await ageWatering(plotId, WATER_DURATION_MS);
      const dry = await plotView(plotId);
      expect(dry.isWet).toBe(false);
      expect(dry.isPaused).toBe(true);
      expect(dry.wetUntil).toBe(wet.wetUntil - WATER_DURATION_MS);
    });

    it('never calls a ripe crop paused, however dry it is', async () => {
      await giveItem(CROPS.potato.seedItemId, 1);
      const plotId = await tilledPlotId();
      await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey() });
      await backdatePlot(plotId, CROPS.potato.growthDurationMs);

      const view = await plotView(plotId);
      expect(view.isRipe).toBe(true);
      expect(view.isWet).toBe(false);
      // A finished crop is done, not stalled — the client draws "READY", not
      // "DRY", and the two must not disagree.
      expect(view.isPaused).toBe(false);
    });

    it('applies the VIP multiplier to the duration it publishes', async () => {
      await db
        .update(schema.players)
        .set({ vipUntil: Date.now() + HOUR, flaggedAt: null })
        .where(eq(schema.players.id, playerId));

      await giveItem(CROPS.leek.seedItemId, 1);
      const plotId = await tilledPlotId();
      await client.post('/api/farm/plant', { plotId, cropId: 'leek', idempotencyKey: newKey() });

      const view = await plotView(plotId);
      // 80% of leek's 45 minutes. The client draws stages against this, so a
      // VIP crop must not be shown against the un-shortened config duration.
      expect(view.effectiveDurationMs).toBe(CROPS.leek.growthDurationMs * 0.8);
      expect(view.readyInMs).toBe(view.effectiveDurationMs);
    });
  });
});

/* ------------------------------------------------------------------ *
 * Till (T-9.02)
 * ------------------------------------------------------------------ */

/**
 * T-20.03 — chopping.
 *
 * The first action in the game gated on **owning a tool**. Till and water check
 * nothing, correctly: everyone is granted a hoe and a can at registration, so
 * there is no state to verify. The axe is not granted, which makes owning one
 * real state and the check a real gate — and makes "chop without an axe" a
 * failure path that has to be tested rather than reasoned about.
 */
describe('POST /api/farm/chop', () => {
  async function treeRows() {
    const [farm] = await db.select().from(schema.farms).where(eq(schema.farms.playerId, playerId));
    return db.select().from(schema.trees).where(eq(schema.trees.farmId, farm!.id));
  }

  async function standingTreeId(): Promise<string> {
    return (await treeRows())[0]!.id;
  }

  const giveAxe = () => giveItem('axe_wood', 1);

  it('drops wood and stumps the tree', async () => {
    await giveAxe();
    const treeId = await standingTreeId();
    const before = Date.now();

    const res = await client.post('/api/farm/chop', { treeId, idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.itemId).toBe('wood');
    expect(res.body.quantity).toBe(WOOD_PER_TREE);
    expect(res.body.regrowsInMs).toBe(TREE_REGROW_MS);

    expect(await heldQuantity('wood')).toBe(WOOD_PER_TREE);

    const tree = (await treeRows()).find((t) => t.id === treeId)!;
    expect(tree.choppedAt).not.toBeNull();
    expect(tree.choppedAt).toBeGreaterThanOrEqual(before);
  });

  it('refuses without an axe, and leaves the tree standing', async () => {
    const treeId = await standingTreeId();

    const res = await client.post('/api/farm/chop', { treeId, idempotencyKey: newKey() });

    expect(res.code).toBe('TOOL_REQUIRED');
    expect(res.status).toBe(403);
    // The refusal must not have half-happened.
    expect(await heldQuantity('wood')).toBe(0);
    expect((await treeRows()).find((t) => t.id === treeId)!.choppedAt).toBeNull();
  });

  it('refuses a stump that has not grown back, and says how long is left', async () => {
    await giveAxe();
    const treeId = await standingTreeId();
    await client.post('/api/farm/chop', { treeId, idempotencyKey: newKey() });

    const res = await client.post('/api/farm/chop', { treeId, idempotencyKey: newKey() });

    expect(res.code).toBe('TREE_NOT_READY');
    // One tree chopped once: the second attempt must not have paid out again.
    expect(await heldQuantity('wood')).toBe(WOOD_PER_TREE);
  });

  it('lets a regrown tree be chopped again', async () => {
    await giveAxe();
    const treeId = await standingTreeId();
    await client.post('/api/farm/chop', { treeId, idempotencyKey: newKey() });

    // Wind the stump back a full cycle — nothing runs, so this is the only way
    // time passes in a test (§4.2).
    await db
      .update(schema.trees)
      .set({ choppedAt: Date.now() - TREE_REGROW_MS })
      .where(eq(schema.trees.id, treeId));

    const res = await client.post('/api/farm/chop', { treeId, idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(await heldQuantity('wood')).toBe(WOOD_PER_TREE * 2);
  });

  it('never chops another player‘s tree', async () => {
    await giveAxe();
    const other = await createTestClient();
    await registerTestUser(other);
    const [theirFarm] = await db
      .select()
      .from(schema.farms)
      .where(eq(schema.farms.playerId, (await other.get('/api/farm')).body.farm.playerId));
    const [theirTree] = await db
      .select()
      .from(schema.trees)
      .where(eq(schema.trees.farmId, theirFarm!.id));

    const res = await client.post('/api/farm/chop', {
      treeId: theirTree!.id,
      idempotencyKey: newKey(),
    });

    // The same answer a nonexistent tree gets — telling them apart would
    // confirm the id is real.
    expect(res.code).toBe('NOT_FOUND');
    expect(await heldQuantity('wood')).toBe(0);
    expect((await db.select().from(schema.trees).where(eq(schema.trees.id, theirTree!.id)))[0]!
      .choppedAt).toBeNull();
    await other.close();
  });

  it('gives a tree that does not exist the same answer', async () => {
    await giveAxe();
    const res = await client.post('/api/farm/chop', {
      treeId: '00000000-0000-4000-8000-000000000000',
      idempotencyKey: newKey(),
    });
    expect(res.code).toBe('NOT_FOUND');
  });

  /**
   * The one that would destroy items. A full bag must refuse the whole action —
   * the tree stays standing and the wood is not silently dropped on the floor
   * (§5.5: "never silently deletes items").
   */
  it('refuses on a full bag without destroying the drop or the tree', async () => {
    await giveAxe();
    const treeId = await standingTreeId();

    // Fill every remaining slot with something that cannot stack with wood.
    const used = await db
      .select({ slotIndex: schema.inventoryItems.slotIndex })
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.playerId, playerId),
          eq(schema.inventoryItems.container, 'inventory'),
        ),
      );
    const taken = new Set(used.map((r) => r.slotIndex));
    for (let i = 0; i < BASE_INVENTORY_SLOTS; i++) {
      if (taken.has(i)) continue;
      await db.insert(schema.inventoryItems).values({
        playerId,
        container: 'inventory',
        slotIndex: i,
        itemId: 'hay',
        quantity: 999,
      });
    }

    const res = await client.post('/api/farm/chop', { treeId, idempotencyKey: newKey() });

    expect(res.code).toBe('INVENTORY_FULL');
    expect(await heldQuantity('wood'), 'wood was created anyway').toBe(0);
    expect(
      (await treeRows()).find((t) => t.id === treeId)!.choppedAt,
      'the tree fell but the wood did not arrive',
    ).toBeNull();
  });

  /**
   * §4.5. A flaky connection retrying a chop must not fell two trees‘ worth of
   * wood from one tree.
   */
  it('pays out once for a repeated idempotency key', async () => {
    await giveAxe();
    const treeId = await standingTreeId();
    const key = newKey();

    const first = await client.post('/api/farm/chop', { treeId, idempotencyKey: key });
    const second = await client.post('/api/farm/chop', { treeId, idempotencyKey: key });

    expect(first.status, first.code).toBe(200);
    expect(second.status, second.code).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await heldQuantity('wood')).toBe(WOOD_PER_TREE);
  });

  it('refuses a payload that names a tool, rather than trusting it', async () => {
    await giveAxe();
    const treeId = await standingTreeId();

    // `chopSchema` is strict about shape: the client never says what it holds.
    const res = await client.post('/api/farm/chop', {
      treeId,
      itemId: 'axe_gold',
      quantity: 999,
      idempotencyKey: newKey(),
    });

    // Either rejected outright or the extras ignored — what must NOT happen is
    // the payload changing the drop.
    if (res.status === 200) {
      expect(res.body.quantity).toBe(WOOD_PER_TREE);
      expect(await heldQuantity('wood')).toBe(WOOD_PER_TREE);
    } else {
      expect(res.code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('POST /api/farm/till', () => {
  /** The raw row, so the assertions are about stored state, not a view. */
  async function plotRow(plotId: string) {
    const [row] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId));
    return row!;
  }

  it('stamps tilled_at on an untilled, empty, unlocked plot', async () => {
    const [plotId] = await unlockedPlotIds();
    expect((await plotRow(plotId!)).tilledAt, 'plots start untilled').toBeNull();

    const before = Date.now();
    const res = await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.plotId).toBe(plotId);

    const row = await plotRow(plotId!);
    expect(row.tilledAt).not.toBeNull();
    expect(row.tilledAt).toBeGreaterThanOrEqual(before);
    // Tilling breaks ground and nothing else.
    expect(row.cropId).toBeNull();
    expect(row.grownMs).toBe(0);
  });

  it('refuses to till the same plot twice', async () => {
    const [plotId] = await unlockedPlotIds();
    await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });
    const first = (await plotRow(plotId!)).tilledAt;

    const res = await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });

    expect(res.code).toBe('PLOT_ALREADY_TILLED');
    // And the refusal did not quietly re-stamp the timestamp.
    expect((await plotRow(plotId!)).tilledAt).toBe(first);
  });

  it('refuses to till a plot with something growing in it', async () => {
    await giveItem(CROPS.potato.seedItemId, 1);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey() });

    const res = await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });

    /*
     * PLOT_OCCUPIED, not PLOT_ALREADY_TILLED. Both are true of this plot, and
     * the occupied one is the reason a player actually needs to hear — "already
     * tilled" would read as "nothing to do here" when the answer is "there is a
     * potato in the way".
     */
    expect(res.code).toBe('PLOT_OCCUPIED');
  });

  it('refuses a plot that is not cleared yet', async () => {
    const state = await client.get('/api/farm');
    const locked = state.body.plots.find((p: { unlocked: boolean }) => !p.unlocked);

    const res = await client.post('/api/farm/till', {
      plotId: locked.id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe('PLOT_LOCKED');
    expect((await plotRow(locked.id)).tilledAt).toBeNull();
  });

  it('never tills a plot on someone else‘s farm', async () => {
    const other = await createTestClient();
    await registerTestUser(other);
    const theirs = (await other.get('/api/farm')).body.plots.find(
      (p: { unlocked: boolean }) => p.unlocked,
    );

    const res = await client.post('/api/farm/till', {
      plotId: theirs.id,
      idempotencyKey: newKey(),
    });

    // NOT_FOUND rather than FORBIDDEN: telling them apart confirms the id is
    // real (same reasoning as `lockOwnedPlot`).
    expect(res.code).toBe('NOT_FOUND');
    expect((await plotRow(theirs.id)).tilledAt).toBeNull();
    await other.close();
  });

  it('is idempotent: a replayed key tills once and repeats the answer', async () => {
    const [plotId] = await unlockedPlotIds();
    const key = newKey('till-replay');

    const first = await client.post('/api/farm/till', { plotId, idempotencyKey: key });
    const second = await client.post('/api/farm/till', { plotId, idempotencyKey: key });

    expect(first.status, first.code).toBe(200);
    // Without idempotency the replay would be a second till and fail with
    // PLOT_ALREADY_TILLED; instead it returns the original answer.
    expect(second.status, second.code).toBe(200);
    expect(second.body).toEqual(first.body);
    expect((await plotRow(plotId!)).tilledAt).toBe(first.body.tilledAt);
  });

  it('refuses planting into untilled soil, without consuming the seed', async () => {
    await giveItem(CROPS.potato.seedItemId, 3);
    const [plotId] = await unlockedPlotIds();

    const res = await client.post('/api/farm/plant', {
      plotId,
      cropId: 'potato',
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe('PLOT_NOT_TILLED');
    // The whole point of refusing before `removeItem`: a mistimed plant is free.
    expect(await heldQuantity(CROPS.potato.seedItemId)).toBe(3);
    expect((await plotRow(plotId!)).cropId).toBeNull();
  });

  it('leaves the soil tilled after a harvest, so the next crop needs no hoe', async () => {
    await giveItem(CROPS.potato.seedItemId, 2);
    const [plotId] = await unlockedPlotIds();

    await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });
    await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey() });
    await backdatePlot(plotId!, CROPS.potato.growthDurationMs);
    const harvested = await client.post('/api/farm/harvest', {
      plotId,
      idempotencyKey: newKey(),
    });
    expect(harvested.status, harvested.code).toBe(200);

    // The soil survived the harvest...
    expect((await plotRow(plotId!)).tilledAt).not.toBeNull();
    // ...so the loop from here is plant → harvest, with no hoe in it (§5.2).
    const replant = await client.post('/api/farm/plant', {
      plotId,
      cropId: 'potato',
      idempotencyKey: newKey(),
    });
    expect(replant.status, replant.code).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * Plant
 * ------------------------------------------------------------------ */

describe('POST /api/farm/plant', () => {
  it('consumes a seed and stamps the plot', async () => {
    await giveItem(CROPS.potato.seedItemId, 3);
    const plotId = await tilledPlotId();

    const res = await client.post('/api/farm/plant', {
      plotId,
      cropId: 'potato',
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(res.body.cropId).toBe('potato');
    expect(await heldQuantity(CROPS.potato.seedItemId)).toBe(2);

    const state = await client.get('/api/farm');
    const plot = state.body.plots.find((p: { id: string }) => p.id === plotId);
    expect(plot.cropId).toBe('potato');
    expect(plot.stage).toBe(0);
    expect(plot.isRipe).toBe(false);
  });

  it('snapshots the growth duration onto the plot', async () => {
    await giveItem(CROPS.onion.seedItemId, 1);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId: 'onion', idempotencyKey: newKey() });

    const [plot] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId!));
    // Retuning the crop later must not change one already in the ground.
    expect(plot!.growthDurationMs).toBe(CROPS.onion.growthDurationMs);
  });

  it('rejects planting into an occupied plot and does not consume a second seed', async () => {
    await giveItem(CROPS.potato.seedItemId, 5);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey() });

    const res = await client.post('/api/farm/plant', {
      plotId,
      cropId: 'potato',
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe('PLOT_OCCUPIED');
    expect(await heldQuantity(CROPS.potato.seedItemId)).toBe(4);
  });

  it('rejects planting into a locked plot', async () => {
    await giveItem(CROPS.potato.seedItemId, 1);
    const state = await client.get('/api/farm');
    const locked = state.body.plots.find((p: { unlocked: boolean }) => !p.unlocked);

    const res = await client.post('/api/farm/plant', {
      plotId: locked.id,
      cropId: 'potato',
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(403);
    expect(res.code).toBe('PLOT_LOCKED');
    expect(await heldQuantity(CROPS.potato.seedItemId)).toBe(1);
  });

  it('rejects planting a seed the player does not hold', async () => {
    const plotId = await tilledPlotId();

    const res = await client.post('/api/farm/plant', {
      plotId,
      cropId: 'potato',
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe('INSUFFICIENT_ITEMS');

    // And the plot is untouched — a failed plant leaves nothing behind.
    const [plot] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId!));
    expect(plot!.cropId).toBeNull();
    expect(plot!.plantedAt).toBeNull();
  });

  it('rejects an unknown crop', async () => {
    const plotId = await tilledPlotId();
    const res = await client.post('/api/farm/plant', {
      plotId,
      cropId: 'triffid',
      idempotencyKey: newKey(),
    });
    // Blocked by the Zod enum before it ever reaches the service.
    expect(res.status).toBe(400);
    expect(res.code).toBe('VALIDATION_FAILED');
  });

  /*
   * Ownership. A plot id is a real, valid uuid belonging to someone else —
   * exactly the case where trusting the body instead of the session would
   * hand over another player's farm.
   */
  it("refuses to plant on another player's plot", async () => {
    const other = await createTestClient();
    await registerTestUser(other);
    const otherState = await other.get('/api/farm');
    const victimPlot = otherState.body.plots.find((p: { unlocked: boolean }) => p.unlocked);

    await giveItem(CROPS.potato.seedItemId, 1);
    const res = await client.post('/api/farm/plant', {
      plotId: victimPlot.id,
      cropId: 'potato',
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(404);
    expect(res.code).toBe('NOT_FOUND');
    expect(await heldQuantity(CROPS.potato.seedItemId)).toBe(1);

    const [untouched] = await db
      .select()
      .from(schema.plots)
      .where(eq(schema.plots.id, victimPlot.id));
    expect(untouched!.cropId).toBeNull();
    await other.close();
  });

  it('is idempotent: a replayed key consumes only one seed', async () => {
    await giveItem(CROPS.potato.seedItemId, 5);
    const plotId = await tilledPlotId();
    const key = newKey('replay-plant');

    const first = await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: key });
    const second = await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: key });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await heldQuantity(CROPS.potato.seedItemId)).toBe(4);
  });

  it('lets a failed action be retried with the same key', async () => {
    const plotId = await tilledPlotId();
    const key = newKey('retry');

    // Fails: no seeds.
    const failed = await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: key });
    expect(failed.code).toBe('INSUFFICIENT_ITEMS');

    // The rollback took the key row with it, so the retry genuinely runs.
    await giveItem(CROPS.potato.seedItemId, 1);
    const retried = await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: key });
    expect(retried.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * Water (T-9.03b, D-1)
 * ------------------------------------------------------------------ */

/**
 * The rule these all circle: **a crop grows only while its soil is wet, and a
 * dry one pauses rather than dying** (CLAUDE.md §5.2).
 *
 * Onion is the crop of choice throughout because its 8h duration is longer
 * than the 4h window by construction (a config test pins that), so a single
 * watering can never finish it and "the window lapsed" is a state these tests
 * can actually reach.
 */
describe('POST /api/farm/water', () => {
  /** A tilled plot with an onion in it, freshly planted and dry. */
  async function plantedOnion(): Promise<string> {
    await giveItem(CROPS.onion.seedItemId, 1);
    const plotId = await tilledPlotId();
    const res = await client.post('/api/farm/plant', {
      plotId,
      cropId: 'onion',
      idempotencyKey: newKey(),
    });
    expect(res.status, res.code).toBe(200);
    return plotId;
  }

  it('stamps the plot wet and reports when it dries out', async () => {
    const plotId = await plantedOnion();
    const before = Date.now();

    const res = await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.plotId).toBe(plotId);
    expect(res.body.wateredAt).toBeGreaterThanOrEqual(before);
    // The client is never asked to work the window length out for itself (§4.4).
    expect(res.body.wetUntil).toBe(res.body.wateredAt + WATER_DURATION_MS);
    // Nothing was banked: this is the first window, and it just opened.
    expect(res.body.grownMs).toBe(0);

    const row = await plotRowOf(plotId);
    expect(row.wateredAt).toBe(res.body.wateredAt);
    expect(row.grownMs).toBe(0);
  });

  it('a fresh seed starts dry, and stays at stage 0 however long it waits', async () => {
    const plotId = await plantedOnion();

    const row = await plotRowOf(plotId);
    expect(row.wateredAt, 'planting must not wet the soil').toBeNull();
    expect(row.grownMs).toBe(0);

    // A week of wall-clock time with no watering. Only `planted_at` moves, so
    // this is the real calculation answering, not a stage anyone wrote.
    await db
      .update(schema.plots)
      .set({ plantedAt: row.plantedAt! - 7 * 24 * HOUR })
      .where(eq(schema.plots.id, plotId));

    const view = await plotView(plotId);
    expect(view.isRipe).toBe(false);
    expect(view.stage).toBe(0);
    expect(view.readyInMs).toBe(CROPS.onion.growthDurationMs);
  });

  it('freezes growth once the window lapses, and never kills the crop', async () => {
    const plotId = await plantedOnion();
    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });

    // Exactly one full window earned, then the soil dries.
    await ageWatering(plotId, WATER_DURATION_MS);
    const dried = await plotView(plotId);
    expect(dried.isRipe).toBe(false);
    expect(dried.stage).toBeGreaterThan(0);
    expect(dried.readyInMs).toBe(CROPS.onion.growthDurationMs - WATER_DURATION_MS);

    // Three more days of drought change nothing at all — not the stage, not
    // the countdown, and the crop is still there to be watered.
    await ageWatering(plotId, 3 * 24 * HOUR);
    const later = await plotView(plotId);
    expect(later.stage).toBe(dried.stage);
    expect(later.readyInMs).toBe(dried.readyInMs);
    expect(later.cropId).toBe('onion');
    expect((await plotRowOf(plotId)).witheredAt).toBeNull();
  });

  it('resumes growing when the dried-out plot is watered again', async () => {
    const plotId = await plantedOnion();
    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    await ageWatering(plotId, WATER_DURATION_MS + 2 * 24 * HOUR);

    // The re-water banks the first window — the two dry days contribute
    // nothing, which is the whole point of clamping it.
    const res = await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    expect(res.status, res.code).toBe(200);
    expect(res.body.grownMs).toBe(WATER_DURATION_MS);

    await ageWatering(plotId, HOUR);
    const view = await plotView(plotId);
    // One banked window plus an hour of the reopened one. Exact to within test
    // execution time: the aged `watered_at` is an hour before the *stamp*, and
    // the read happens a few ms after it.
    const expected = CROPS.onion.growthDurationMs - WATER_DURATION_MS - HOUR;
    expect(view.readyInMs).toBeLessThanOrEqual(expected);
    expect(view.readyInMs).toBeGreaterThan(expected - 5_000);
  });

  it('loses nothing when the soil is re-watered while still wet', async () => {
    const plotId = await plantedOnion();
    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    await ageWatering(plotId, HOUR);

    // Settle-then-stamp: the hour already earned is banked before the window
    // is reopened. Without the settle it would be thrown away.
    const res = await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    expect(res.body.grownMs).toBeGreaterThanOrEqual(HOUR);
    expect(res.body.grownMs, 'banked the hour, not the whole window').toBeLessThan(
      HOUR + 5_000,
    );

    await ageWatering(plotId, HOUR);
    const view = await plotView(plotId);
    // Two hours of growing time in total, continuous across the re-water.
    expect(view.readyInMs).toBeLessThanOrEqual(CROPS.onion.growthDurationMs - 2 * HOUR);
    expect(view.readyInMs).toBeGreaterThan(CROPS.onion.growthDurationMs - 2 * HOUR - 5_000);
  });

  it('ripens a long crop across two wet windows, and harvests', async () => {
    const plotId = await plantedOnion();
    expect(CROPS.onion.growthDurationMs).toBe(2 * WATER_DURATION_MS);

    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    await ageWatering(plotId, WATER_DURATION_MS);
    expect((await plotView(plotId)).isRipe, 'one window is not enough').toBe(false);

    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    await ageWatering(plotId, WATER_DURATION_MS);
    expect((await plotView(plotId)).isRipe).toBe(true);

    const harvested = await client.post('/api/farm/harvest', {
      plotId,
      idempotencyKey: newKey(),
    });
    expect(harvested.status, harvested.code).toBe(200);
    expect(await heldQuantity(CROPS.onion.produceItemId)).toBe(CROPS.onion.yieldAmount);
  });

  it('refuses to harvest a crop that has only had one of the two windows', async () => {
    const plotId = await plantedOnion();
    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    await ageWatering(plotId, WATER_DURATION_MS);

    const res = await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });

    expect(res.code).toBe('CROP_NOT_READY');
    // Watered time still needed, not wall-clock time (see growth.ts).
    expect(res.body.error.details.readyInMs).toBe(
      CROPS.onion.growthDurationMs - WATER_DURATION_MS,
    );
    expect((await plotRowOf(plotId)).cropId).toBe('onion');
  });

  it('clears the banked growth on harvest, so the next seed starts from zero', async () => {
    const plotId = await plantedOnion();
    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    await ageWatering(plotId, WATER_DURATION_MS);
    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    await ageWatering(plotId, WATER_DURATION_MS);
    await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });

    expect((await plotRowOf(plotId)).grownMs, 'harvest resets the bank').toBe(0);

    // ...and the replant does not inherit a ripe crop's worth of progress.
    await giveItem(CROPS.onion.seedItemId, 1);
    await client.post('/api/farm/plant', { plotId, cropId: 'onion', idempotencyKey: newKey() });
    const row = await plotRowOf(plotId);
    expect(row.grownMs).toBe(0);
    expect(row.wateredAt).toBeNull();
    expect((await plotView(plotId)).isRipe).toBe(false);
  });

  /**
   * Harvest already zeroes the bank, so this state is not reachable through
   * the endpoints today — which is exactly why the reset in `plant` needs a
   * test of its own. Without one it is an untested branch that a later feature
   * emptying a plot some other way (idle mode clearing a crop, an admin fix)
   * would be silently relying on.
   */
  it('a seed planted into left-over banked growth still starts from zero', async () => {
    const plotId = await tilledPlotId();
    await db
      .update(schema.plots)
      .set({ grownMs: 30 * 24 * HOUR })
      .where(eq(schema.plots.id, plotId));

    await giveItem(CROPS.onion.seedItemId, 1);
    await client.post('/api/farm/plant', { plotId, cropId: 'onion', idempotencyKey: newKey() });

    expect((await plotRowOf(plotId)).grownMs).toBe(0);
    // Otherwise a month of stale bank would make the new seed instantly ripe.
    expect((await plotView(plotId)).isRipe).toBe(false);
  });

  it('leaves a ripe crop ripe when it is watered anyway', async () => {
    await giveItem(CROPS.potato.seedItemId, 1);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey() });
    await backdatePlot(plotId, CROPS.potato.growthDurationMs);

    // Pointless, allowed, and harmless — refusing it would mean a client that
    // waters a whole row has to know which plots are ripe first.
    const res = await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    expect(res.status, res.code).toBe(200);
    expect((await plotView(plotId)).isRipe).toBe(true);
  });

  it('refuses bare soil, without wetting it', async () => {
    const plotId = await tilledPlotId();

    const res = await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });

    expect(res.code).toBe('PLOT_EMPTY');
    // A window opened on an empty plot would be inherited by whatever was
    // planted next — a free head start.
    expect((await plotRowOf(plotId)).wateredAt).toBeNull();
  });

  it('refuses a plot that is not cleared yet', async () => {
    const state = await client.get('/api/farm');
    const locked = state.body.plots.find((p: { unlocked: boolean }) => !p.unlocked);

    const res = await client.post('/api/farm/water', {
      plotId: locked.id,
      idempotencyKey: newKey(),
    });

    // PLOT_LOCKED, not PLOT_EMPTY: a locked plot is empty too, but "not
    // cleared yet" is the reason the player can act on.
    expect(res.code).toBe('PLOT_LOCKED');
  });

  it('never waters a plot on someone else‘s farm', async () => {
    const other = await createTestClient();
    await registerTestUser(other);
    const theirs = (await other.get('/api/farm')).body.plots.find(
      (p: { unlocked: boolean }) => p.unlocked,
    );

    const res = await client.post('/api/farm/water', {
      plotId: theirs.id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe('NOT_FOUND');
    expect((await plotRowOf(theirs.id)).wateredAt).toBeNull();
    await other.close();
  });

  it('is idempotent: a replayed key waters once and repeats the answer', async () => {
    const plotId = await plantedOnion();
    const key = newKey('water-replay');

    const first = await client.post('/api/farm/water', { plotId, idempotencyKey: key });
    await ageWatering(plotId, HOUR);
    const second = await client.post('/api/farm/water', { plotId, idempotencyKey: key });

    expect(second.status, second.code).toBe(200);
    expect(second.body).toEqual(first.body);
    // The replay must not re-open the window: `watered_at` is still the aged
    // one, an hour in the past, not `now`.
    expect((await plotRowOf(plotId)).wateredAt).toBe(first.body.wateredAt - HOUR);
  });

  it('rejects a body without a plot id', async () => {
    const res = await client.post('/api/farm/water', { idempotencyKey: newKey() });
    expect(res.code).toBe('VALIDATION_FAILED');
  });
});

/* ------------------------------------------------------------------ *
 * Harvest
 * ------------------------------------------------------------------ */

describe('POST /api/farm/harvest', () => {
  async function plantAndRipen(cropId: keyof typeof CROPS = 'potato'): Promise<string> {
    const crop = CROPS[cropId];
    await giveItem(crop.seedItemId, 1);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId, idempotencyKey: newKey() });
    await backdatePlot(plotId!, crop.growthDurationMs);
    return plotId!;
  }

  it('grants produce and clears the plot', async () => {
    const plotId = await plantAndRipen('potato');

    const res = await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });

    expect(res.status).toBe(200);
    expect(res.body.itemId).toBe(CROPS.potato.produceItemId);
    expect(res.body.quantity).toBe(CROPS.potato.yieldAmount);
    expect(await heldQuantity(CROPS.potato.produceItemId)).toBe(CROPS.potato.yieldAmount);

    const [plot] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId));
    expect(plot!.cropId).toBeNull();
    expect(plot!.plantedAt).toBeNull();
    expect(plot!.harvestedAt).not.toBeNull();
  });

  it('grants the full yield for a multi-yield crop', async () => {
    const plotId = await plantAndRipen('onion');
    await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });
    expect(await heldQuantity(CROPS.onion.produceItemId)).toBe(CROPS.onion.yieldAmount);
    expect(CROPS.onion.yieldAmount).toBeGreaterThan(1);
  });

  it('rejects harvesting a crop that is not ready', async () => {
    await giveItem(CROPS.onion.seedItemId, 1);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId: 'onion', idempotencyKey: newKey() });

    const res = await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });

    expect(res.status).toBe(409);
    expect(res.code).toBe('CROP_NOT_READY');
    expect(res.body.error.details.readyInMs).toBeGreaterThan(0);
    expect(await heldQuantity(CROPS.onion.produceItemId)).toBe(0);
  });

  it('rejects harvesting an empty plot', async () => {
    const plotId = await tilledPlotId();
    const res = await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });
    expect(res.status).toBe(409);
    expect(res.code).toBe('PLOT_EMPTY');
  });

  it("refuses to harvest another player's plot", async () => {
    const other = await createTestClient();
    await registerTestUser(other);
    const otherState = await other.get('/api/farm');
    const victimPlot = otherState.body.plots.find((p: { unlocked: boolean }) => p.unlocked);

    const res = await client.post('/api/farm/harvest', {
      plotId: victimPlot.id,
      idempotencyKey: newKey(),
    });
    expect(res.status).toBe(404);
    await other.close();
  });

  /*
   * The rule from CLAUDE.md §5.4: an operation that would overflow the
   * inventory fails cleanly and NEVER silently destroys items. The crop must
   * still be standing afterwards.
   */
  it('leaves the crop in the ground when the inventory is full', async () => {
    const plotId = await plantAndRipen('potato');

    // Fill every slot with something that cannot absorb the harvest.
    for (let i = 0; i < BASE_INVENTORY_SLOTS; i++) {
      await db.insert(schema.inventoryItems).values({
        playerId,
        container: 'inventory',
        slotIndex: i,
        itemId: 'hay',
        quantity: 999,
      });
    }

    const res = await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });

    expect(res.status).toBe(409);
    expect(res.code).toBe('INVENTORY_FULL');

    // The produce was not created...
    expect(await heldQuantity(CROPS.potato.produceItemId)).toBe(0);
    // ...and, crucially, the crop is still there to harvest later.
    const [plot] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId));
    expect(plot!.cropId).toBe('potato');
    expect(plot!.plantedAt).not.toBeNull();
  });

  it('is idempotent: a replayed key pays out once', async () => {
    const plotId = await plantAndRipen('potato');
    const key = newKey('replay-harvest');

    const first = await client.post('/api/farm/harvest', { plotId, idempotencyKey: key });
    const second = await client.post('/api/farm/harvest', { plotId, idempotencyKey: key });

    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await heldQuantity(CROPS.potato.produceItemId)).toBe(CROPS.potato.yieldAmount);
  });

  /*
   * The duping test. Two harvests of one plot land at the same moment with
   * DIFFERENT keys, so idempotency cannot save us — the row lock has to.
   */
  it('pays out once when two concurrent harvests race the same plot', async () => {
    const plotId = await plantAndRipen('potato');

    const [a, b] = await Promise.all([
      client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey('race-a') }),
      client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey('race-b') }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = a.status === 200 ? b : a;
    expect(loser.code).toBe('PLOT_EMPTY');

    // Exactly one payout, not two.
    expect(await heldQuantity(CROPS.potato.produceItemId)).toBe(CROPS.potato.yieldAmount);
  });

  it('does not duplicate seeds when two plants race the same plot', async () => {
    await giveItem(CROPS.potato.seedItemId, 5);
    const plotId = await tilledPlotId();

    const results = await Promise.all([
      client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey('pa') }),
      client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey('pb') }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    // Exactly one seed consumed.
    expect(await heldQuantity(CROPS.potato.seedItemId)).toBe(4);
  });
});

/* ------------------------------------------------------------------ *
 * Offline progression — T-1.13
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Every crop, end to end
 * ------------------------------------------------------------------ */

/**
 * The whole loop for each of the four crops, through the real endpoints.
 *
 * The rest of this file proves the mechanics with one or two crops. This proves
 * they are actually wired up for ALL of them — a crop whose seed item id has a
 * typo, or whose row points at an empty part of the sheet, passes every other
 * test in the suite and then fails the first time a player picks it.
 */
describe('every crop, end to end', () => {
  for (const cropId of CROP_IDS) {
    const crop = CROPS[cropId];

    it(`${crop.name}: plants, grows through every stage, and harvests`, async () => {
      await giveItem(crop.seedItemId, 1);
      const plotId = await tilledPlotId();

      const planted = await client.post('/api/farm/plant', {
        plotId,
        cropId,
        idempotencyKey: newKey(),
      });
      expect(planted.status, planted.code).toBe(200);
      expect(planted.body.cropId).toBe(cropId);

      // Walk the clock through the growth window and collect the stages the
      // server reports. Backdating is the only thing faked; the stage itself is
      // the real calculation every time.
      const stages: number[] = [];
      const steps = crop.stageFrames.length * 3;
      let backdated = 0;

      for (let i = 0; i <= steps; i++) {
        const target = Math.floor((crop.growthDurationMs * i) / steps);
        await backdatePlot(plotId!, target - backdated);
        backdated = target;

        const state = await client.get('/api/farm');
        const plot = state.body.plots.find((p: { id: string }) => p.id === plotId);
        stages.push(plot.stage);

        expect(plot.stage).toBeLessThan(crop.stageFrames.length);
        expect(crop.stageFrames[plot.stage]).toBeDefined();
      }

      // Every stage the sheet has, in order, ending ripe.
      expect([...new Set(stages)]).toEqual([...crop.stageFrames.keys()]);

      const harvested = await client.post('/api/farm/harvest', {
        plotId,
        idempotencyKey: newKey(),
      });

      expect(harvested.status, harvested.code).toBe(200);
      expect(harvested.body.itemId).toBe(crop.produceItemId);
      expect(harvested.body.quantity).toBe(crop.yieldAmount);
      expect(await heldQuantity(crop.produceItemId)).toBe(crop.yieldAmount);

      const [plot] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId!));
      expect(plot!.cropId).toBeNull();
    });
  }

  /**
   * The last growth stage before ripening is the one an off-by-one silently
   * drops. Asserted on its own, for every crop (not hardcoded to a stage
   * count — T-7.08 found all four crops share the same one today, but a
   * future crop with a different count must not go unchecked), so a failure
   * names the cause instead of getting lost in the "every stage in order"
   * walk above.
   */
  for (const cropId of CROP_IDS) {
    const crop = CROPS[cropId];
    const stageCount = crop.stageFrames.length;

    it(`reports ${crop.name} at its last growth stage before it is ripe`, async () => {
      await giveItem(crop.seedItemId, 1);
      const plotId = await tilledPlotId();
      await client.post('/api/farm/plant', { plotId, cropId, idempotencyKey: newKey() });

      // Deep into the last stage's window, but not past the end of it.
      await backdatePlot(
        plotId!,
        Math.floor((crop.growthDurationMs * (stageCount - 0.5)) / stageCount),
      );

      const state = await client.get('/api/farm');
      const plot = state.body.plots.find((p: { id: string }) => p.id === plotId);

      expect(plot.stage).toBe(stageCount - 1);
      expect(plot.isRipe).toBe(false);
    });
  }
});

/* ------------------------------------------------------------------ *
 * VIP growth speed (T-5.01, CLAUDE.md §7)
 * ------------------------------------------------------------------ */

/**
 * `benefitsFor` used to be reachable with a raw `vipUntil`, which meant every
 * caller had to remember, separately, to null it out for a flagged account.
 * This proves the real endpoint — not just the shared config function in
 * isolation — still gets it right now that the signature forces the whole
 * player through.
 */
describe('VIP growth speed and its revocation on a flagged account', () => {
  it('grows a crop faster for an active VIP account', async () => {
    await db
      .update(schema.players)
      .set({ vipUntil: Date.now() + HOUR, flaggedAt: null })
      .where(eq(schema.players.id, playerId));

    await giveItem(CROPS.leek.seedItemId, 1);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId: 'leek', idempotencyKey: newKey() });

    // 80% of leek's 45-minute duration is 36 minutes. 40 minutes elapsed is
    // past that VIP threshold but still short of the free-account one.
    await backdatePlot(plotId!, 40 * 60_000);

    const state = await client.get('/api/farm');
    const plot = state.body.plots.find((p: { id: string }) => p.id === plotId);
    expect(plot.isRipe).toBe(true);
  });

  it('does NOT speed up growth for a flagged account, even with vipUntil far in the future', async () => {
    await db
      .update(schema.players)
      .set({ vipUntil: Date.now() + 30 * 24 * HOUR, flaggedAt: Date.now() - 1 })
      .where(eq(schema.players.id, playerId));

    await giveItem(CROPS.leek.seedItemId, 1);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId: 'leek', idempotencyKey: newKey() });

    // Same 40 minutes that reads as ripe under VIP speed above. A flagged
    // account must see the plain 45-minute duration instead.
    await backdatePlot(plotId!, 40 * 60_000);

    const state = await client.get('/api/farm');
    const plot = state.body.plots.find((p: { id: string }) => p.id === plotId);
    expect(plot.isRipe).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Farm level
 * ------------------------------------------------------------------ */

/**
 * Level is derived from recorded activity — there is no level column and no
 * request that can set one. These go through the endpoints for that reason: the
 * only way experience appears is by having actually grown something.
 */
describe('farm level', () => {
  async function experience(): Promise<number> {
    const [row] = await db
      .select({ experience: schema.players.experience })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));
    return row!.experience;
  }

  it('starts at level 1 with nothing recorded', async () => {
    expect(await experience()).toBe(0);
    const state = await client.get('/api/farm');
    expect(state.body.player.farmLevel).toBe(1);
  });

  it('grants experience for the wait a harvest represents', async () => {
    const crop = CROPS.potato;
    await giveItem(crop.seedItemId, 1);
    const plotId = await tilledPlotId();

    await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey() });
    await backdatePlot(plotId!, crop.growthDurationMs);

    const res = await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });

    expect(res.body.experience).toBe(xpForHarvest('potato'));
    expect(await experience()).toBe(xpForHarvest('potato'));
  });

  it('grants nothing for planting — only a crop that actually grew pays out', async () => {
    await giveItem(CROPS.leek.seedItemId, 1);
    const plotId = await tilledPlotId();

    await client.post('/api/farm/plant', { plotId, cropId: 'leek', idempotencyKey: newKey() });
    expect(await experience()).toBe(0);
  });

  it('reports a level the client never supplied, derived from the total', async () => {
    // Enough recorded activity to cross into the trade-eligible level.
    await db
      .update(schema.players)
      .set({ experience: FARM_LEVEL_XP[TRADE_MIN_FARM_LEVEL - 1]! })
      .where(eq(schema.players.id, playerId));

    const state = await client.get('/api/farm');
    expect(state.body.player.farmLevel).toBe(TRADE_MIN_FARM_LEVEL);
    expect(levelForXp(await experience())).toBe(TRADE_MIN_FARM_LEVEL);
  });

  /** A replayed harvest must not pay experience twice, like everything else. */
  it('is idempotent with the harvest that earned it', async () => {
    const crop = CROPS.potato;
    await giveItem(crop.seedItemId, 1);
    const plotId = await tilledPlotId();

    await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey() });
    await backdatePlot(plotId!, crop.growthDurationMs);

    const key = newKey();
    await client.post('/api/farm/harvest', { plotId, idempotencyKey: key });
    await client.post('/api/farm/harvest', { plotId, idempotencyKey: key });

    expect(await experience()).toBe(xpForHarvest('potato'));
  });

  it('accumulates across harvests and never goes down', async () => {
    let previous = 0;

    for (const cropId of ['leek', 'potato', 'onion'] as const) {
      const crop = CROPS[cropId];
      await giveItem(crop.seedItemId, 1);
      const plotId = await tilledPlotId();

      await client.post('/api/farm/plant', { plotId, cropId, idempotencyKey: newKey() });
      await backdatePlot(plotId!, crop.growthDurationMs);
      const res = await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });

      expect(res.body.experience).toBeGreaterThan(previous);
      expect(res.body.farmLevel).toBeGreaterThanOrEqual(levelForXp(previous));
      previous = res.body.experience;
    }
  });

  /**
   * The client cannot state its own level. There is no field for it in any
   * schema — this asserts the endpoint ignores one if it is sent anyway.
   */
  it('ignores a level or experience a client tries to send', async () => {
    const crop = CROPS.leek;
    await giveItem(crop.seedItemId, 1);
    const plotId = await tilledPlotId();

    await client.post('/api/farm/plant', {
      plotId,
      cropId: 'leek',
      idempotencyKey: newKey(),
      farmLevel: 99,
      experience: 999_999,
    });
    await backdatePlot(plotId!, crop.growthDurationMs);
    await client.post('/api/farm/harvest', {
      plotId,
      idempotencyKey: newKey(),
      experience: 999_999,
    });

    expect(await experience()).toBe(xpForHarvest('leek'));
  });
});

/**
 * Since D-1 an absence only pays off while the soil is still wet, so these go
 * through the real water endpoint: what is offline is the POLLING, not the
 * watering. Everything else is unchanged — no job, no tick, arithmetic on a
 * timestamp (§4.2).
 */
describe('offline progression', () => {
  it('a watered crop ripens with no requests in between', async () => {
    await giveItem(CROPS.potato.seedItemId, 1);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey() });
    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });

    // Potato ripens in 2h, inside a single 4h window — water it and close the
    // tab. No polling, no background job, no scheduled task.
    expect(CROPS.potato.growthDurationMs).toBeLessThan(WATER_DURATION_MS);
    await ageWatering(plotId, CROPS.potato.growthDurationMs);

    const res = await client.post('/api/farm/harvest', { plotId, idempotencyKey: newKey() });
    expect(res.status, res.code).toBe(200);
    expect(await heldQuantity(CROPS.potato.produceItemId)).toBe(CROPS.potato.yieldAmount);
  });

  it('reports partial progress accurately after a partial absence', async () => {
    await giveItem(CROPS.onion.seedItemId, 1);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId: 'onion', idempotencyKey: newKey() });
    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });

    // Onion takes 8 hours. Away for 4 — which is also exactly one window, so
    // the far side of this absence is a paused, half-grown crop.
    expect(CROPS.onion.growthDurationMs).toBe(8 * HOUR);
    await ageWatering(plotId, 4 * HOUR);

    const plot = await plotView(plotId);

    expect(plot.isRipe).toBe(false);
    // Half-grown, within a second of tolerance for test execution time.
    expect(plot.readyInMs).toBeGreaterThan(4 * HOUR - 5_000);
    expect(plot.readyInMs).toBeLessThanOrEqual(4 * HOUR);
    expect(plot.stage).toBeGreaterThan(0);
  });

  it('needs no scheduled job: reading the state does not change it', async () => {
    await giveItem(CROPS.potato.seedItemId, 1);
    const plotId = await tilledPlotId();
    await client.post('/api/farm/plant', { plotId, cropId: 'potato', idempotencyKey: newKey() });
    await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() });
    // Read it with the window OPEN and again once it has LAPSED: the tempting
    // bug is a read that "helpfully" settles `grown_ms` on the way past.
    await ageWatering(plotId, HOUR);

    const [before] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId!));
    for (let i = 0; i < 5; i++) await client.get('/api/farm');
    await ageWatering(plotId, WATER_DURATION_MS);
    const [mid] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId!));
    for (let i = 0; i < 5; i++) await client.get('/api/farm');
    const [after] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId!));

    // Growth is computed on read, never written back.
    expect(mid!.grownMs).toBe(0);
    expect(after).toEqual(mid);
    expect({ ...after!, wateredAt: null }).toEqual({ ...before!, wateredAt: null });
  });
});

/* ------------------------------------------------------------------ *
 * Energy (MVP re-scope)
 * ------------------------------------------------------------------ */

describe('energy', () => {
  async function energyRow() {
    const [row] = await db
      .select({
        energySpent: schema.players.energySpent,
        sleepingSince: schema.players.sleepingSince,
      })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));
    return row!;
  }

  /** Empties the bar without doing anything else to the farm. */
  async function exhaust(): Promise<void> {
    await db
      .update(schema.players)
      .set({ energySpent: energyCapForLevel(1) })
      .where(eq(schema.players.id, playerId));
  }

  it('charges the configured cost for a successful action', async () => {
    const [plotId] = await unlockedPlotIds();
    expect((await energyRow()).energySpent, 'a new farmer is rested').toBe(0);

    const res = await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect((await energyRow()).energySpent).toBe(ENERGY_COST[EnergyAction.TILL]);
  });

  /**
   * **A refused action must cost nothing.** Being told "that soil is already
   * tilled" and ALSO losing two points would be the game charging for its own
   * refusal — and it is the reason the charge sits after the state checks
   * rather than at the top of the function.
   */
  it('charges nothing when the action is refused on its own terms', async () => {
    const [plotId] = await unlockedPlotIds();
    await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });
    const after = (await energyRow()).energySpent;

    const again = await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });

    expect(again.status).toBe(409);
    expect(again.code).toBe('PLOT_ALREADY_TILLED');
    expect((await energyRow()).energySpent, 'the refusal was free').toBe(after);
  });

  it('refuses the action, and changes nothing, when the bar is empty', async () => {
    const [plotId] = await unlockedPlotIds();
    await exhaust();

    const res = await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });

    expect(res.status).toBe(409);
    expect(res.code).toBe('INSUFFICIENT_ENERGY');
    expect(res.body.error.details).toMatchObject({
      action: 'till',
      cost: ENERGY_COST[EnergyAction.TILL],
      energy: 0,
    });

    const [row] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId!));
    expect(row!.tilledAt, 'the plot was not tilled').toBeNull();
  });

  /**
   * The exact boundary. One point short must be refused, and exactly enough
   * must succeed — an off-by-one here is the difference between a limit and a
   * suggestion.
   */
  it('spends the last point but not one more', async () => {
    const plots = await unlockedPlotIds();
    const cost = ENERGY_COST[EnergyAction.TILL];

    await db
      .update(schema.players)
      .set({ energySpent: energyCapForLevel(1) - cost })
      .where(eq(schema.players.id, playerId));

    const ok = await client.post('/api/farm/till', { plotId: plots[0], idempotencyKey: newKey() });
    expect(ok.status, ok.code).toBe(200);

    const broke = await client.post('/api/farm/till', {
      plotId: plots[1],
      idempotencyKey: newKey(),
    });
    expect(broke.code).toBe('INSUFFICIENT_ENERGY');
  });

  /**
   * **Two tabs must not spend the same point twice.**
   *
   * `spendEnergy` updates `where energy_spent = <what it read>`, so of two
   * requests that both saw the same balance only one can match a row. Without
   * it a player could act twice for the price of once by pressing the key in
   * two tabs — the same class of bug the gold lock exists for, and cheaper to
   * fix here because energy has no other reader to serialise against.
   */
  it('cannot be spent twice by racing two requests', async () => {
    const plots = await unlockedPlotIds();
    const cost = ENERGY_COST[EnergyAction.TILL];
    const cap = energyCapForLevel(1);

    // Exactly ONE action's worth left. This is what makes the race decidable:
    // with an unconditional update both requests would succeed and the bar
    // would go past empty.
    await db
      .update(schema.players)
      .set({ energySpent: cap - cost })
      .where(eq(schema.players.id, playerId));

    const [a, b] = await Promise.all([
      client.post('/api/farm/till', { plotId: plots[0], idempotencyKey: newKey('ea') }),
      client.post('/api/farm/till', { plotId: plots[1], idempotencyKey: newKey('eb') }),
    ]);

    const ok = [a, b].filter((r) => r.status === 200);
    expect(ok, 'one action was affordable, so exactly one may succeed').toHaveLength(1);

    const spent = (await energyRow()).energySpent;
    expect(spent, 'the bar must never go past empty').toBeLessThanOrEqual(cap);
    expect(spent).toBe(cap);

    // ...and only one plot was actually worked.
    const rows = await db
      .select()
      .from(schema.plots)
      .where(eq(schema.plots.farmId, (await db
        .select({ id: schema.farms.id })
        .from(schema.farms)
        .where(eq(schema.farms.playerId, playerId)))[0]!.id));
    expect(rows.filter((r) => r.tilledAt !== null)).toHaveLength(1);
  });

  it('reports the bar on the player, settled on read', async () => {
    const before = await client.get('/api/farm');
    expect(before.body.player.energy).toMatchObject({
      current: energyCapForLevel(1),
      max: energyCapForLevel(1),
      isSleeping: false,
      fullInMs: 0,
    });

    const [plotId] = await unlockedPlotIds();
    await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });

    const after = await client.get('/api/farm');
    expect(after.body.player.energy.current).toBe(
      energyCapForLevel(1) - ENERGY_COST[EnergyAction.TILL],
    );
  });

  /**
   * A whole opening pass has to fit, or the tutorial line tells a new player
   * to do something the game will refuse partway through. This walks it
   * through the real endpoints rather than trusting the arithmetic in
   * `energy.test.ts`.
   */
  it('lets a new farmer till, plant and water every starting plot', async () => {
    const plots = await unlockedPlotIds();
    await giveItem(CROPS.leek.seedItemId, plots.length);

    for (const plotId of plots) {
      expect((await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() })).status).toBe(200);
      expect(
        (await client.post('/api/farm/plant', { plotId, cropId: 'leek', idempotencyKey: newKey() }))
          .status,
      ).toBe(200);
      expect((await client.post('/api/farm/water', { plotId, idempotencyKey: newKey() })).status).toBe(200);
    }

    const state = await client.get('/api/farm');
    expect(state.body.player.energy.current, 'and there is a little left over')
      .toBeGreaterThanOrEqual(0);
  });
});

describe('POST /api/farm/sleep and /wake', () => {
  async function playerRow() {
    const [row] = await db
      .select({
        energySpent: schema.players.energySpent,
        sleepingSince: schema.players.sleepingSince,
      })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));
    return row!;
  }

  /** Empties the bar and backdates the moment they lay down. */
  async function asleepFor(ms: number): Promise<void> {
    await db
      .update(schema.players)
      .set({ energySpent: energyCapForLevel(1), sleepingSince: Date.now() - ms })
      .where(eq(schema.players.id, playerId));
  }

  it('lies down, recording the moment and nothing else', async () => {
    const before = Date.now();
    const res = await client.post('/api/farm/sleep', { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    const row = await playerRow();
    expect(row.sleepingSince).toBeGreaterThanOrEqual(before);
    expect(row.energySpent, 'sleeping does not itself change the bar').toBe(0);
  });

  /**
   * A second press must not restart the clock. Restarting would mean a
   * double-click threw away everything the player had slept for — the worst
   * possible reading of a harmless second press.
   */
  it('does not restart the clock when already asleep', async () => {
    await asleepFor(4 * 60_000);
    const { sleepingSince } = await playerRow();

    const res = await client.post('/api/farm/sleep', { idempotencyKey: newKey() });

    expect(res.status).toBe(200);
    expect((await playerRow()).sleepingSince).toBe(sleepingSince);
  });

  it('restores the whole bar after a full night', async () => {
    await asleepFor(SLEEP_DURATION_MS);

    const res = await client.post('/api/farm/wake', { idempotencyKey: newKey() });

    expect(res.status, res.code).toBe(200);
    expect(res.body.energy.current).toBe(energyCapForLevel(1));
    const row = await playerRow();
    expect(row.energySpent).toBe(0);
    expect(row.sleepingSince, 'and they are awake again').toBeNull();
  });

  /**
   * Waking early keeps the fraction. An all-or-nothing rule would punish a
   * player for coming back, and "you slept but gained nothing" is the kind of
   * rule people remember as a bug.
   */
  it('keeps the fraction when woken early', async () => {
    await asleepFor(SLEEP_DURATION_MS / 2);

    const res = await client.post('/api/farm/wake', { idempotencyKey: newKey() });

    expect(res.body.energy.current).toBe(energyCapForLevel(1) / 2);
    expect(res.body.recovered).toBe(energyCapForLevel(1) / 2);
    expect((await playerRow()).energySpent).toBe(energyCapForLevel(1) / 2);
  });

  it('is a harmless no-op when they were not asleep', async () => {
    const res = await client.post('/api/farm/wake', { idempotencyKey: newKey() });

    expect(res.status).toBe(200);
    expect(res.body.sleptForMs).toBe(0);
    expect(res.body.recovered).toBe(0);
    expect((await playerRow()).sleepingSince).toBeNull();
  });

  /**
   * **A sleeping farmer cannot work.** Otherwise a player would lie in bed
   * and till at the same time — nonsense, and a way to farm through the one
   * period the game is giving energy back.
   */
  it('refuses farm actions while asleep', async () => {
    const [plotId] = await unlockedPlotIds();
    await client.post('/api/farm/sleep', { idempotencyKey: newKey() });

    const res = await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });

    expect(res.status).toBe(409);
    expect(res.code).toBe('ASLEEP');
  });

  it('lets them work again the moment they get up', async () => {
    const [plotId] = await unlockedPlotIds();
    await client.post('/api/farm/sleep', { idempotencyKey: newKey() });
    await client.post('/api/farm/wake', { idempotencyKey: newKey() });

    const res = await client.post('/api/farm/till', { plotId, idempotencyKey: newKey() });
    expect(res.status, res.code).toBe(200);
  });

  /**
   * The bar fills between polls with nothing having run server-side, which is
   * the whole point of computing it on read — the client can interpolate from
   * `fullInMs` instead of polling for a number that only a job could move.
   */
  it('reports a filling bar on the player view while asleep', async () => {
    await asleepFor(SLEEP_DURATION_MS / 4);

    const state = await client.get('/api/farm');

    expect(state.body.player.energy.isSleeping).toBe(true);
    expect(state.body.player.energy.current).toBe(Math.floor(energyCapForLevel(1) / 4));
    expect(state.body.player.energy.fullInMs).toBeGreaterThan(0);
  });

  it('replays a retried sleep without moving the clock', async () => {
    const key = newKey();
    const first = await client.post('/api/farm/sleep', { idempotencyKey: key });
    const again = await client.post('/api/farm/sleep', { idempotencyKey: key });

    expect(again.status).toBe(200);
    expect(again.body.sleepingSince).toBe(first.body.sleepingSince);
  });
});
