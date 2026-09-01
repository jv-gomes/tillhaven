import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import {
  ErrorCode,
  MAX_PLOTS,
  PLOT_POSITIONS,
  STARTING_PLOTS,
  VIP_BENEFITS,
  plotUnlockCost,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';
import { plotCapFor, unlockIndexOf } from './expansion.js';

/**
 * Plot expansion: 253,750g to buy out, which makes it the biggest gold sink in
 * the game and the one most worth getting wrong quietly.
 *
 * The price is a function of the plot's place in the authored unlock order, and
 * the client never states it. Most of what follows is checking that the server
 * charges what the config says regardless of what is asked for.
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

/** Plot rows in authored unlock order, so `plots[i]` is the ith to unlock. */
async function plotsInUnlockOrder() {
  const rows = await db
    .select({ id: schema.plots.id, x: schema.plots.x, y: schema.plots.y, unlocked: schema.plots.unlocked })
    .from(schema.plots)
    .innerJoin(schema.farms, eq(schema.plots.farmId, schema.farms.id))
    .where(eq(schema.farms.playerId, playerId))
    .orderBy(asc(schema.plots.id));

  return rows
    .map((r) => ({ ...r, index: unlockIndexOf(r.x, r.y) }))
    .sort((a, b) => a.index - b.index);
}

async function unlockedCount(): Promise<number> {
  const rows = await db
    .select()
    .from(schema.plots)
    .innerJoin(schema.farms, eq(schema.plots.farmId, schema.farms.id))
    .where(and(eq(schema.farms.playerId, playerId), eq(schema.plots.unlocked, true)));
  return rows.length;
}

function unlock(plotId: string) {
  return client.post('/api/farm/unlock', { plotId, idempotencyKey: newKey() });
}

describe('GET /api/farm/expansion', () => {
  it('prices every plot still to buy, cheapest first', async () => {
    const res = await client.get('/api/farm/expansion');

    expect(res.status).toBe(200);
    expect(res.body.plots).toHaveLength(MAX_PLOTS - STARTING_PLOTS);

    const costs = res.body.plots.map((p: { cost: number }) => p.cost);
    expect([...costs].sort((a: number, b: number) => a - b)).toEqual(costs);
    expect(costs[0]).toBe(plotUnlockCost(STARTING_PLOTS));
  });

  it('shrinks as plots are bought', async () => {
    await setGold(1_000_000);
    const plots = await plotsInUnlockOrder();

    await unlock(plots[STARTING_PLOTS]!.id);

    const res = await client.get('/api/farm/expansion');
    expect(res.body.plots).toHaveLength(MAX_PLOTS - STARTING_PLOTS - 1);
  });
});

describe('POST /api/farm/unlock', () => {
  it('charges exactly what the config says for that plot', async () => {
    await setGold(1_000_000);
    const plots = await plotsInUnlockOrder();
    const target = plots[STARTING_PLOTS]!;
    const expected = plotUnlockCost(target.index);

    const before = await gold();
    const res = await unlock(target.id);

    expect(res.status, res.code).toBe(200);
    expect(res.body.cost).toBe(expected);
    expect(before - (await gold())).toBe(expected);
    expect(await unlockedCount()).toBe(STARTING_PLOTS + 1);
  });

  /**
   * The client sends a plot id and nothing else. This asserts the endpoint
   * ignores a price if one is sent anyway (§4.1).
   */
  it('ignores a cost the client tries to supply', async () => {
    await setGold(1_000_000);
    const plots = await plotsInUnlockOrder();
    const target = plots[STARTING_PLOTS]!;

    const before = await gold();
    const res = await client.post('/api/farm/unlock', {
      plotId: target.id,
      cost: 1,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(before - (await gold())).toBe(plotUnlockCost(target.index));
  });

  it('prices each plot by its own place in the unlock order', async () => {
    await setGold(1_000_000);
    const plots = await plotsInUnlockOrder();

    for (const plot of plots.slice(STARTING_PLOTS, STARTING_PLOTS + 4)) {
      const before = await gold();
      const res = await unlock(plot.id);

      expect(res.status, res.code).toBe(200);
      expect(before - (await gold()), `plot ${plot.index}`).toBe(plotUnlockCost(plot.index));
    }
  });

  /**
   * Buying out of order is allowed: the price follows the plot, so there is
   * nothing to gain by it, and a rule with no purpose is a rule to explain
   * later.
   */
  it('allows buying a later plot first, at that plot’s price', async () => {
    await setGold(1_000_000);
    const plots = await plotsInUnlockOrder();
    const last = plots[MAX_PLOTS - 1]!;

    const before = await gold();
    const res = await unlock(last.id);

    expect(res.status, res.code).toBe(200);
    expect(before - (await gold())).toBe(plotUnlockCost(last.index));
    expect(plotUnlockCost(last.index)).toBeGreaterThan(plotUnlockCost(STARTING_PLOTS));
  });

  it('refuses a plot that is already cleared, and takes no gold', async () => {
    await setGold(1_000_000);
    const plots = await plotsInUnlockOrder();

    const before = await gold();
    const res = await unlock(plots[0]!.id);

    expect(res.code).toBe(ErrorCode.PLOT_ALREADY_UNLOCKED);
    expect(await gold()).toBe(before);
    expect(await unlockedCount()).toBe(STARTING_PLOTS);
  });

  it('refuses without the gold, and leaves the plot locked', async () => {
    const plots = await plotsInUnlockOrder();
    const target = plots[STARTING_PLOTS]!;
    await setGold(plotUnlockCost(target.index) - 1);

    const res = await unlock(target.id);

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_GOLD);
    expect(await unlockedCount()).toBe(STARTING_PLOTS);
  });

  it('cannot buy every plot on the map and then one more', async () => {
    await setGold(10_000_000);
    const plots = await plotsInUnlockOrder();

    for (const plot of plots.slice(STARTING_PLOTS)) {
      expect((await unlock(plot.id)).status, `plot ${plot.index}`).toBe(200);
    }

    expect(await unlockedCount()).toBe(MAX_PLOTS);
    // Every plot the farm has is open; there is nothing left to sell.
    expect((await client.get('/api/farm/expansion')).body.plots).toHaveLength(0);
  });

  it('is idempotent: a replayed unlock charges once', async () => {
    await setGold(1_000_000);
    const plots = await plotsInUnlockOrder();
    const target = plots[STARTING_PLOTS]!;

    const key = newKey();
    const before = await gold();
    const first = await client.post('/api/farm/unlock', { plotId: target.id, idempotencyKey: key });
    const replay = await client.post('/api/farm/unlock', { plotId: target.id, idempotencyKey: key });

    expect(replay.body).toEqual(first.body);
    expect(before - (await gold())).toBe(plotUnlockCost(target.index));
  });

  it('cannot be raced into buying one plot twice', async () => {
    await setGold(1_000_000);
    const plots = await plotsInUnlockOrder();
    const target = plots[STARTING_PLOTS]!;

    const before = await gold();
    const results = await Promise.all([unlock(target.id), unlock(target.id), unlock(target.id)]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(before - (await gold())).toBe(plotUnlockCost(target.index));
    expect(await unlockedCount()).toBe(STARTING_PLOTS + 1);
  });

  it("refuses another player's plot without confirming it exists", async () => {
    const plots = await plotsInUnlockOrder();
    const target = plots[STARTING_PLOTS]!;

    const other = await createTestClient();
    await registerTestUser(other);
    await db.update(schema.players).set({ gold: 1_000_000 });

    const res = await other.post('/api/farm/unlock', {
      plotId: target.id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.NOT_FOUND);
    expect(await unlockedCount()).toBe(STARTING_PLOTS);
    await other.close();
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    const res = await anonymous.post('/api/farm/unlock', {
      plotId: '00000000-0000-0000-0000-000000000000',
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

/* ------------------------------------------------------------------ *
 * The cap, and the VIP bonus that has nowhere to stand
 * ------------------------------------------------------------------ */

describe('plotCapFor', () => {
  const free = { id: 'p', flaggedAt: null, vipUntil: null } as never;
  const vip = { id: 'p', flaggedAt: null, vipUntil: Date.now() + 86_400_000 } as never;

  it('is the map’s plot count for a free player', () => {
    expect(plotCapFor(free, Date.now())).toBe(MAX_PLOTS);
  });

  /**
   * **This is the clamp, and it is currently load-bearing.**
   *
   * `VIP_BENEFITS.bonusPlotSlots` grants plots on top of `MAX_PLOTS`, but every
   * plot must stand on a cell someone painted soil under, and the map marks
   * exactly `MAX_PLOTS` of them. So a VIP's bonus plots have nowhere to go and
   * the cap clamps to what the map authorises rather than inventing a
   * coordinate.
   *
   * Nothing is broken today — VIP cannot be bought until Phase 5 — but **T-5.06
   * must author those cells in `apps/mapmaker` and re-run `pnpm plots`**, or the
   * bonus it advertises silently does nothing. When it does, this test starts
   * failing and says so.
   */
  it('clamps a VIP to the number of plots the map actually authorises', () => {
    expect(VIP_BENEFITS.bonusPlotSlots).toBeGreaterThan(0);
    expect(plotCapFor(vip, Date.now())).toBe(Math.min(MAX_PLOTS + VIP_BENEFITS.bonusPlotSlots, PLOT_POSITIONS.length));

    if (PLOT_POSITIONS.length === MAX_PLOTS) {
      expect(
        plotCapFor(vip, Date.now()),
        'the map has gained plot cells — VIP bonus plots can now be authored; ' +
          'see T-5.06 and remove this branch',
      ).toBe(MAX_PLOTS);
    }
  });
});

describe('unlockIndexOf', () => {
  it('finds every authored plot, and nothing else', () => {
    for (const [index, position] of PLOT_POSITIONS.entries()) {
      expect(unlockIndexOf(position.x, position.y)).toBe(index);
    }
    expect(unlockIndexOf(-1, -1)).toBe(-1);
  });
});
