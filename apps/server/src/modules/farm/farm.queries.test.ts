import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { SHIPPING_PAYOUT_MS } from '@tillhaven/shared';
import { db, schema, closeDb, countQueries } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, type TestClient } from '../../test/app.js';

/**
 * `GET /api/farm` is the hottest path in the game (CLAUDE.md §11) and the one
 * place an N+1 would hurt most: it is polled, and it grows with the size of the
 * farm.
 *
 * So the query count is **asserted, not eyeballed**. A per-plot or per-animal
 * query passes every behavioural test in the suite and only shows up months
 * later as "the game got slow". This is the guard that fails immediately
 * instead.
 */

let client: TestClient;
let playerId: string;
let farmId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  const [farm] = await db.select().from(schema.farms).where(eq(schema.farms.playerId, playerId));
  farmId = farm!.id;
});

afterAll(closeDb);

/** Adds plots beyond the authored map, purely to grow the row count. */
async function addPlots(count: number): Promise<void> {
  const existing = await db.select().from(schema.plots).where(eq(schema.plots.farmId, farmId));
  const taken = new Set(existing.map((p) => `${p.x},${p.y}`));

  const rows: (typeof schema.plots.$inferInsert)[] = [];
  for (let i = 0; rows.length < count; i++) {
    // Anywhere unused; these exist to be counted, not to be rendered.
    const x = 100 + (i % 50);
    const y = 100 + Math.floor(i / 50);
    if (taken.has(`${x},${y}`)) continue;
    rows.push({ farmId, x, y, unlocked: true });
  }

  if (rows.length > 0) await db.insert(schema.plots).values(rows);
}

async function addAnimals(count: number): Promise<void> {
  const now = Date.now();
  const rows = Array.from({ length: count }, () => ({
    farmId,
    kind: 'chicken',
    variant: 'chicken_red',
    acquiredAt: now,
    maturesAt: now,
    lastCollectedAt: now,
    fedUntil: now + 86_400_000,
  }));

  await db.insert(schema.animals).values(rows);
}

async function queriesForFarmState(): Promise<number> {
  // Warm once: the first request of a session resolves the cookie and may open
  // a pooled connection, neither of which is per-plot work.
  await client.get('/api/farm');

  const { result, queries } = await countQueries(() => client.get('/api/farm'));
  expect(result.status).toBe(200);
  return queries;
}

describe('GET /api/farm query count', () => {
  it('is constant as the plot count grows', async () => {
    const baseline = await queriesForFarmState();

    for (const extra of [14, 20, 40]) {
      await addPlots(extra);
      const plots = await db.select().from(schema.plots).where(eq(schema.plots.farmId, farmId));
      const queries = await queriesForFarmState();

      expect(
        queries,
        `${plots.length} plots issued ${queries} queries, baseline was ${baseline} — ` +
          'something is querying per plot',
      ).toBe(baseline);
    }
  });

  it('is constant as the animal count grows', async () => {
    const baseline = await queriesForFarmState();

    await addAnimals(10);
    expect(await queriesForFarmState()).toBe(baseline);

    await addAnimals(20);
    expect(await queriesForFarmState()).toBe(baseline);
  });

  /**
   * The absolute number, pinned: the session, the player, the farm, its plots,
   * its animals, and one lookup for a shipment that has come due. Six. If this
   * changes it changes deliberately — an extra query on the game's hottest path
   * deserves a moment's thought.
   *
   * The sixth arrived with the shipping box (T-11.02) and is the cheap half of
   * a deliberate split: settling on the farm poll is what makes an offline
   * player's gold arrive while they stand in their field, but a transaction
   * that settles nothing would cost a BEGIN and a COMMIT as well — three round
   * trips on every poll to do nothing. Asking first costs one.
   */
  it('needs exactly six queries', async () => {
    expect(await queriesForFarmState()).toBe(6);
  });

  /**
   * Idle mode is free for anyone who has not switched it on (T-13.04).
   *
   * `idleWorkPending` is answered from the farm row `getFarmState` already
   * reads, so there is no lookup to add. This is pinned rather than assumed
   * because "just one more query to check a flag" on the hottest path in the
   * game is exactly the change that looks free and is not — and because the
   * obvious implementation of the applier *would* have added one.
   */
  it('costs an idle-disabled player nothing at all', async () => {
    const baseline = await queriesForFarmState();

    await db
      .update(schema.farms)
      .set({ idleEnabled: false, idleProcessedAt: Date.now() - 60 * 60 * 1000 })
      .where(eq(schema.farms.id, farmId));

    expect(await queriesForFarmState()).toBe(baseline);
  });

  /**
   * And the applying path, which is the rare one: a transaction is opened only
   * when the farmer actually has a shift to work. Pinned separately so the
   * common case above cannot quietly acquire its cost — the same split the
   * shipping box uses below, for the same reason.
   */
  it('opens a transaction only when idle work is pending', async () => {
    const idle = await queriesForFarmState();

    await db
      .update(schema.farms)
      .set({
        idleEnabled: true,
        idleTasks: JSON.stringify(['till']),
        idleProcessedAt: Date.now() - 60 * 60 * 1000,
      })
      .where(eq(schema.farms.id, farmId));

    const applying = await countQueries(() => client.get('/api/farm'));
    expect(applying.result.status).toBe(200);
    expect(applying.queries).toBeGreaterThan(idle);
  });

  /**
   * A farm whose farmer has nothing left to do must not pay for a transaction
   * on every single poll. The watermark is settled even when zero actions
   * happen, so the window closes and the next poll is back to the cheap path.
   */
  it('settles an empty shift so the next poll is cheap again', async () => {
    await db
      .update(schema.farms)
      .set({
        idleEnabled: true,
        // No tasks at all: the farmer has nothing it is allowed to do.
        idleTasks: '[]',
        idleProcessedAt: Date.now() - 60 * 60 * 1000,
      })
      .where(eq(schema.farms.id, farmId));

    // First poll settles the hour; the second finds a window too short to act.
    await client.get('/api/farm');
    const settled = await countQueries(() => client.get('/api/farm'));

    expect(settled.result.status).toBe(200);
    expect(settled.queries).toBe(6);
  });

  /**
   * The one query a working farmer costs, pinned (T-13.05).
   *
   * Predicting the next action needs the backpack — a plant needs a seed, a
   * harvest needs somewhere to put the produce — and that is the only thing the
   * farm read does not already have in hand. Everything else the lookahead uses
   * is reused: the farm row, and the plot rows the view is built from.
   *
   * Seven, not eight: it is charged **once**, on a steady poll with no shift to
   * apply, and only to a player who has actually switched idle on with at least
   * one chore. The two free cases above stay free.
   */
  it('costs a working farmer exactly one query more', async () => {
    const baseline = await queriesForFarmState();
    expect(baseline).toBe(6);

    await db
      .update(schema.farms)
      .set({
        idleEnabled: true,
        idleTasks: JSON.stringify(['till']),
        // Up to date, so this measures the lookahead alone rather than a shift.
        idleProcessedAt: Date.now(),
      })
      .where(eq(schema.farms.id, farmId));

    expect(await queriesForFarmState()).toBe(7);
  });

  /**
   * And the settling path, which is rare: the transaction is only opened when
   * something is actually due. Pinned separately so the common case above
   * cannot quietly acquire the transaction's cost.
   */
  it('opens a transaction only when a shipment is due', async () => {
    // Counted WITHOUT the usual warm-up read: that read would settle the
    // shipment itself, and the settling poll is exactly what this is measuring.
    const idle = await queriesForFarmState();

    await db.insert(schema.shipments).values({
      playerId,
      itemId: 'leek',
      quantity: 1,
      depositedAt: Date.now() - SHIPPING_PAYOUT_MS - 1_000,
    });

    const settling = await countQueries(() => client.get('/api/farm'));
    expect(settling.result.status).toBe(200);
    // The lookup, a BEGIN, the re-select, the claim, the gold, a COMMIT.
    expect(settling.queries).toBeGreaterThan(idle);

    // Settled now, so the next poll is back to the cheap path.
    expect(await queriesForFarmState()).toBe(idle);
  });

  it('is still constant for a farm with both a lot of plots and a lot of animals', async () => {
    const baseline = await queriesForFarmState();

    await addPlots(40);
    await addAnimals(10);

    expect(await queriesForFarmState()).toBe(baseline);
  });
});
