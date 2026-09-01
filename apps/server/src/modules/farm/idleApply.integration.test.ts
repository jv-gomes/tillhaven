import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';
import {
  BACKPACK_TIERS,
  CROPS,
  HOUR,
  IDLE_ACTION_MS,
  IDLE_MAX_CATCHUP_ACTIONS,
  MINUTE,
  STARTING_PLOTS,
  xpForHarvest,
} from '@tillhaven/shared';
import { applyIdleWork } from './idleApply.js';
import { getFarmState } from './service.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * T-13.04 — the applier, through the real endpoints.
 *
 * The simulator is already tested to death in `idleSim.test.ts`; what is under
 * test here is everything that stands between it and the database. Three
 * things have to hold, and each is the kind that only shows up under a real
 * transaction: the state a player READS is the state after their farmer's
 * shift; two requests arriving together apply that shift ONCE; and a manual
 * action can never interleave with a simulated one.
 */

let client: TestClient;
let playerId: string;
let farmId: string;

const LEEK = 'leek';
const LEEK_SEED = CROPS[LEEK].seedItemId;
const LEEK_PRODUCE = CROPS[LEEK].produceItemId;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  const [farm] = await db.select().from(schema.farms).where(eq(schema.farms.playerId, playerId));
  farmId = farm!.id;

  // These tests count items exactly, so they stock what they need themselves.
  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, playerId));
});

afterAll(closeDb);

async function giveItem(itemId: string, quantity: number, slotIndex = 0): Promise<void> {
  await db.insert(schema.inventoryItems).values({
    playerId,
    container: 'inventory',
    slotIndex,
    itemId,
    quantity,
  });
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

/** The player as the services see them — the session's snapshot, from the row. */
async function currentPlayerRow(id: string): Promise<AuthedPlayer> {
  const [row] = await db.select().from(schema.players).where(eq(schema.players.id, id));
  return row! as AuthedPlayer;
}

async function farmRow() {
  const [row] = await db.select().from(schema.farms).where(eq(schema.farms.id, farmId));
  return row!;
}

async function plots() {
  return db
    .select()
    .from(schema.plots)
    .where(eq(schema.plots.farmId, farmId))
    .orderBy(asc(schema.plots.y), asc(schema.plots.x));
}

/**
 * The plots the farmer can actually work, in the order the applier sees them.
 *
 * Ordered on purpose: an unordered `select` hands back whichever rows Postgres
 * feels like, which during this task meant tests silently operating on LOCKED
 * plots — ones the simulator correctly ignores. A fixture that picks a plot at
 * random is a fixture that tests something different every run.
 */
async function workablePlots() {
  return (await plots()).filter((p) => p.unlocked);
}

/** Puts a fully-grown crop in the first workable plot. */
async function ripenFirstPlot(): Promise<string> {
  const [plot] = await workablePlots();
  await db
    .update(schema.plots)
    .set({
      cropId: LEEK,
      plantedAt: Date.now() - 2 * HOUR,
      growthDurationMs: CROPS[LEEK].growthDurationMs,
      grownMs: CROPS[LEEK].growthDurationMs,
      wateredAt: Date.now() - 2 * HOUR,
      tilledAt: Date.now() - 3 * HOUR,
    })
    .where(eq(schema.plots.id, plot!.id));
  return plot!.id;
}

/** Switches idle on through the real endpoint, then backdates the watermark. */
async function idleSince(msAgo: number, tasks: string[], cropId?: string): Promise<void> {
  const res = await client.put('/api/farm/idle', {
    enabled: true,
    tasks,
    ...(cropId ? { cropId } : {}),
    idempotencyKey: newKey(),
  });
  expect(res.status).toBe(200);

  await db
    .update(schema.farms)
    .set({ idleProcessedAt: Date.now() - msAgo })
    .where(eq(schema.farms.id, farmId));
}

describe('the farm read applies the pending shift first', () => {
  it('shows the plots the farmer worked, not the ones it found', async () => {
    await giveItem(LEEK_SEED, 5);
    await idleSince(10 * MINUTE, ['till', 'plant', 'water'], LEEK);

    const before = await plots();
    expect(before.every((p) => p.tilledAt === null)).toBe(true);

    const state = await client.get('/api/farm');
    expect(state.status).toBe(200);

    // The response itself reflects the work — not merely the database after it.
    const worked = state.body.plots.filter((p: { cropId: string | null }) => p.cropId !== null);
    expect(worked.length).toBeGreaterThan(0);
    expect(await held(LEEK_SEED)).toBeLessThan(5);
  });

  it('moves the watermark forward so the same window is never paid twice', async () => {
    await giveItem(LEEK_SEED, 5);
    await idleSince(10 * MINUTE, ['till', 'plant', 'water'], LEEK);

    await client.get('/api/farm');
    const first = await farmRow();
    const seedsAfterFirst = await held(LEEK_SEED);

    await client.get('/api/farm');
    const second = await farmRow();

    expect(first.idleProcessedAt).not.toBeNull();
    // The second poll covers only the sliver since the first, so it cannot
    // have re-run the same work.
    expect(await held(LEEK_SEED)).toBe(seedsAfterFirst);
    expect(second.idleProcessedAt!).toBeGreaterThanOrEqual(first.idleProcessedAt!);
  });

  it('does nothing at all when idle is switched off', async () => {
    await giveItem(LEEK_SEED, 5);
    await db
      .update(schema.farms)
      .set({ idleEnabled: false, idleProcessedAt: Date.now() - HOUR })
      .where(eq(schema.farms.id, farmId));

    await client.get('/api/farm');

    expect(await held(LEEK_SEED)).toBe(5);
    expect((await plots()).every((p) => p.tilledAt === null)).toBe(true);
  });

  it('does nothing for a window too short to contain one action', async () => {
    await giveItem(LEEK_SEED, 5);
    await idleSince(IDLE_ACTION_MS - 1_000, ['till'], LEEK);

    const before = await farmRow();
    await client.get('/api/farm');

    expect(await held(LEEK_SEED)).toBe(5);
    // The watermark did not move either — there was nothing to settle.
    expect((await farmRow()).idleProcessedAt).toBe(before.idleProcessedAt);
  });
});

describe('a full offline shift', () => {
  /**
   * The feature, end to end: hours of absence turn into crops, produce and
   * experience, in the exact amounts the crop table prices them at.
   */
  it('turns four hours away into harvested produce and experience', async () => {
    const seeds = 3;
    await giveItem(LEEK_SEED, seeds);
    const before = await currentPlayerRow(playerId);

    await idleSince(4 * HOUR, ['till', 'plant', 'water', 'harvest'], LEEK);
    await client.get('/api/farm');

    // Every seed sown, and every crop that ripened picked.
    expect(await held(LEEK_SEED)).toBe(0);
    const produce = await held(LEEK_PRODUCE);
    expect(produce).toBeGreaterThan(0);
    expect(produce % CROPS[LEEK].yieldAmount).toBe(0);

    const harvests = produce / CROPS[LEEK].yieldAmount;
    const after = await currentPlayerRow(playerId);
    expect(after.experience - before.experience).toBe(harvests * xpForHarvest(LEEK));
  });

  it('leaves harvested soil tilled and stamps when it was picked', async () => {
    await giveItem(LEEK_SEED, 2);
    await idleSince(4 * HOUR, ['till', 'plant', 'water', 'harvest'], LEEK);
    await client.get('/api/farm');

    const picked = (await plots()).filter((p) => p.harvestedAt !== null);
    expect(picked.length).toBeGreaterThan(0);
    for (const plot of picked) {
      expect(plot.tilledAt, 'harvesting leaves workable soil (§5.2)').not.toBeNull();
    }
  });

  /**
   * Produce has to go somewhere. When it cannot, the crop stays in the ground
   * rather than evaporating — and the simulator has to have reached the same
   * conclusion the real `addItem` would, or this would throw instead.
   */
  it('leaves a ripe crop standing when the bag is full', async () => {
    // Fill every backpack slot with something that cannot stack with produce.
    const capacity = 12;
    for (let i = 0; i < capacity; i++) {
      // One item is enough to occupy a slot, and seeds never merge with
      // produce — so this is a bag with nowhere for a harvest to go.
      await giveItem(LEEK_SEED, 1, i);
    }

    const [plot] = await workablePlots();
    await db
      .update(schema.plots)
      .set({
        cropId: LEEK,
        plantedAt: Date.now() - 2 * HOUR,
        growthDurationMs: CROPS[LEEK].growthDurationMs,
        grownMs: CROPS[LEEK].growthDurationMs,
        wateredAt: Date.now() - 2 * HOUR,
        tilledAt: Date.now() - 3 * HOUR,
      })
      .where(eq(schema.plots.id, plot!.id));

    await idleSince(HOUR, ['harvest'], LEEK);
    const res = await client.get('/api/farm');

    expect(res.status).toBe(200);
    const [after] = await db.select().from(schema.plots).where(eq(schema.plots.id, plot!.id));
    expect(after!.cropId).toBe(LEEK);
    expect(await held(LEEK_PRODUCE)).toBe(0);
  });
});

describe('concurrency', () => {
  /**
   * Two polls landing together must apply the shift ONCE. The farm row is
   * locked first and the watermark re-read inside that lock, so the loser of
   * the race finds the work already done rather than doing it again.
   *
   * This is the test that would catch a dupe, so it asserts the item count
   * rather than merely that nothing crashed.
   */
  it('harvests a ripe crop exactly once when two reads arrive together', async () => {
    /*
     * A ripe crop and harvest-only orders, because this is the assertion a
     * double-apply actually breaks. An earlier version of this test counted
     * seeds against plots sown, which balances whether the shift ran once or
     * twice — a tautology dressed as a concurrency test. One crop can only
     * yield one crop's worth.
     */
    await ripenFirstPlot();
    await idleSince(HOUR, ['harvest'], LEEK);

    const [a, b] = await Promise.all([client.get('/api/farm'), client.get('/api/farm')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    expect(await held(LEEK_PRODUCE)).toBe(CROPS[LEEK].yieldAmount);
    const after = await currentPlayerRow(playerId);
    expect(after.experience).toBe(xpForHarvest(LEEK));
  });

  it('applies one shift when a read and a manual action arrive together', async () => {
    await giveItem(LEEK_SEED, 10);
    await idleSince(30 * MINUTE, ['till', 'plant', 'water'], LEEK);

    const [plot] = await workablePlots();
    const [read, manual] = await Promise.all([
      client.get('/api/farm'),
      client.post('/api/farm/till', { plotId: plot!.id, idempotencyKey: newKey() }),
    ]);

    expect(read.status).toBe(200);
    // The till either succeeded or was refused because the farmer got there
    // first — both are consistent; what must not happen is a double payout.
    expect([200, 409]).toContain(manual.status);

    const sown = (await plots()).filter((p) => p.cropId !== null).length;
    expect(await held(LEEK_SEED)).toBe(10 - sown);
  });

  /**
   * Two appliers running in genuinely overlapping transactions.
   *
   * This is the test that actually exercises the locking, and it exists
   * because the HTTP-level ones did not: breaking either `FOR UPDATE` left
   * every request-driven test passing, because two `inject`ed polls do not
   * reliably overlap inside the critical section. Driving `applyIdleWork` from
   * two `db.transaction` calls guarantees they do — two connections, both
   * inside the window at once.
   *
   * What it pins, measured rather than assumed: the farm-row lock and the
   * plot lock are **individually redundant and jointly necessary**. Removing
   * either one alone leaves every test here passing — the survivor serialises
   * the two transactions on its own, and the loser re-reads a farm whose
   * watermark has moved or a plot whose crop is gone. Removing BOTH fails four
   * tests, including this one, with the crop paid out twice.
   *
   * That is worth writing down precisely, because "this lock has no test
   * covering it" is exactly the observation that gets one deleted.
   */
  it('pays out once when two transactions run the shift at the same time', async () => {
    await ripenFirstPlot();
    await idleSince(HOUR, ['harvest'], LEEK);

    const player = await currentPlayerRow(playerId);
    const now = Date.now();

    const [a, b] = await Promise.all([
      db.transaction((tx) => applyIdleWork(tx, player, now)),
      db.transaction((tx) => applyIdleWork(tx, player, now)),
    ]);

    expect(a.harvested + b.harvested).toBe(1);
    expect(await held(LEEK_PRODUCE)).toBe(CROPS[LEEK].yieldAmount);
    expect((await currentPlayerRow(playerId)).experience).toBe(xpForHarvest(LEEK));
  });

  /**
   * Six concurrent polls, one ripe crop. Belt to the above's braces: the same
   * property through the real endpoint, where the race is likelier than
   * guaranteed.
   */
  it('survives a stampede without paying twice', async () => {
    await ripenFirstPlot();
    await idleSince(HOUR, ['harvest'], LEEK);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => client.get('/api/farm')),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);

    expect(await held(LEEK_PRODUCE)).toBe(CROPS[LEEK].yieldAmount);
  });
});

describe('manual work and the farmer never interleave', () => {
  /**
   * The window a simulation covers can never span a manual change, because
   * every mutation runs the catch-up first in the same transaction. Without
   * that, harvesting by hand would let the farmer decide the same plot had
   * been ripe an hour earlier.
   */
  it('catches up before a manual harvest, so the crop is only picked once', async () => {
    const plotId = await ripenFirstPlot();
    await idleSince(HOUR, ['harvest'], LEEK);

    const res = await client.post('/api/farm/harvest', {
      plotId,
      idempotencyKey: newKey(),
    });

    /*
     * The farmer picked it during the catch-up, so the manual harvest finds an
     * empty plot — and because the catch-up committed in its own transaction,
     * the refusal describes a plot that really is empty and the produce really
     * is in the bag. One crop, one payout.
     */
    expect(res.code).toBe('PLOT_EMPTY');
    expect(await held(LEEK_PRODUCE)).toBe(CROPS[LEEK].yieldAmount);
    const [after] = await db.select().from(schema.plots).where(eq(schema.plots.id, plotId));
    expect(after!.cropId).toBeNull();
  });

  it('advances the watermark on a manual action, so nothing is replayed', async () => {
    await giveItem(LEEK_SEED, 5);
    await idleSince(30 * MINUTE, ['till'], LEEK);

    const [plot] = await workablePlots();
    await client.post('/api/farm/till', { plotId: plot!.id, idempotencyKey: newKey() });

    const after = await farmRow();
    expect(Date.now() - after.idleProcessedAt!).toBeLessThan(5 * MINUTE);
  });
});

describe('applyIdleWork directly', () => {
  it('reports what the farmer got through', async () => {
    await giveItem(LEEK_SEED, 2);
    await idleSince(4 * HOUR, ['till', 'plant', 'water', 'harvest'], LEEK);

    const player = await currentPlayerRow(playerId);
    const summary = await db.transaction((tx) => applyIdleWork(tx, player, Date.now()));

    expect(summary.actions).toBeGreaterThan(0);
    // Every unlocked plot is hoed; only two can be sown, because that is how
    // many seeds there were.
    expect(summary.tilled).toBe(STARTING_PLOTS);
    expect(summary.planted).toBe(2);
    expect(summary.harvested).toBeGreaterThan(0);
    expect(summary.spent[LEEK_SEED]).toBe(2);
    expect(summary.gained[LEEK_PRODUCE]).toBe(summary.harvested * CROPS[LEEK].yieldAmount);
    expect(summary.experience).toBeGreaterThan(0);
  });

  /**
   * A month away is more work than one request should do. The cap stops the
   * simulation short and the watermark records exactly how far it got, so the
   * remainder is picked up by the next read rather than lost — which is the
   * whole reason `processedTo` exists rather than just writing `now`.
   */
  it('stops at the action cap and watermarks short of now', async () => {
    /*
     * Watering, not sowing: seeds run out and the cap needs work that does
     * not. Every plot holds a crop with an absurd snapshotted duration, so it
     * never ripens and keeps needing a drink every wet window — which over
     * three months is far more actions than one request may do.
     */
    await db
      .update(schema.plots)
      .set({
        unlocked: true,
        cropId: LEEK,
        plantedAt: Date.now() - 90 * 24 * HOUR,
        growthDurationMs: 365 * 24 * HOUR,
        grownMs: 0,
        wateredAt: null,
        tilledAt: Date.now() - 90 * 24 * HOUR,
      })
      .where(eq(schema.plots.farmId, farmId));

    await idleSince(90 * 24 * HOUR, ['water'], LEEK);

    const player = await currentPlayerRow(playerId);
    const now = Date.now();
    const summary = await db.transaction((tx) => applyIdleWork(tx, player, now));

    expect(summary.stoppedReason).toBe('action_cap');
    expect(summary.actions).toBe(IDLE_MAX_CATCHUP_ACTIONS);
    expect(summary.to).toBeLessThan(now);
    expect((await farmRow()).idleProcessedAt).toBe(summary.to);

    // And the next read carries on from there rather than starting over.
    const second = await db.transaction((tx) => applyIdleWork(tx, player, now));
    expect(second.from).toBe(summary.to);
    expect(second.actions).toBeGreaterThan(0);
  });

  it('reports nothing, and writes nothing, when idle is off', async () => {
    const player = await currentPlayerRow(playerId);
    const before = await farmRow();

    const summary = await db.transaction((tx) => applyIdleWork(tx, player, Date.now()));

    expect(summary.actions).toBe(0);
    expect(await farmRow()).toEqual(before);
  });
});

/**
 * T-13.05 — the farm view says what the farmer will do next.
 *
 * The claim is exact, and only an integration test can check it: the lookahead
 * runs over rows read outside any transaction, and the applier runs over rows
 * read and locked inside one. If those two ever see a different farm — a column
 * dropped in translation, a watermark read before the shift instead of after —
 * the client walks to the wrong tile and swings at nothing.
 *
 * So each case below asks the view what is next, advances the clock to exactly
 * the instant it named, and checks that the applier did that one thing to that
 * one plot.
 */
describe('the farm view predicts the next action (T-13.05)', () => {
  /** How `IdleSummary` counts each kind of action. */
  const COUNTED: Record<string, (s: { tilled: number; planted: number; watered: number; harvested: number }) => number> =
    {
      till: (s) => s.tilled,
      plant: (s) => s.planted,
      water: (s) => s.watered,
      harvest: (s) => s.harvested,
    };

  /** Every column an idle action can move, so "which plot changed" is exact. */
  function fingerprint(p: Awaited<ReturnType<typeof plots>>[number]): string {
    return JSON.stringify([
      p.tilledAt,
      p.cropId,
      p.plantedAt,
      p.growthDurationMs,
      p.wateredAt,
      p.grownMs,
      p.harvestedAt,
    ]);
  }

  async function idleView(now: number) {
    return (await getFarmState(await currentPlayerRow(playerId), now)).idle;
  }

  /**
   * Switches idle on through the real endpoint and pins the watermark, which
   * is the grid every predicted instant sits on.
   */
  async function armIdle(tasks: string[]): Promise<number> {
    const res = await client.put('/api/farm/idle', {
      enabled: true,
      tasks,
      cropId: LEEK,
      idempotencyKey: newKey(),
    });
    expect(res.status).toBe(200);

    const at = Date.now();
    await db.update(schema.farms).set({ idleProcessedAt: at }).where(eq(schema.farms.id, farmId));
    return at;
  }

  /** A crop that is growing but has run dry — the one thing watering fixes. */
  async function thirstyFirstPlot(): Promise<void> {
    const [plot] = await workablePlots();
    const now = Date.now();
    await db
      .update(schema.plots)
      .set({
        cropId: LEEK,
        plantedAt: now - 5 * HOUR,
        // A snapshot far longer than any wet window, so the crop cannot ripen
        // and the only thing left to want is a drink.
        growthDurationMs: 40 * HOUR,
        grownMs: 0,
        wateredAt: now - 5 * HOUR,
        tilledAt: now - 6 * HOUR,
      })
      .where(eq(schema.plots.id, plot!.id));
  }

  /** Broken ground and a seed to put in it. */
  async function tilledFirstPlot(): Promise<void> {
    const [plot] = await workablePlots();
    await giveItem(LEEK_SEED, 3);
    await db
      .update(schema.plots)
      .set({ tilledAt: Date.now() - HOUR })
      .where(eq(schema.plots.id, plot!.id));
  }

  const CASES: readonly { kind: string; tasks: string[]; setUp: () => Promise<unknown> }[] = [
    { kind: 'till', tasks: ['till'], setUp: async () => {} },
    { kind: 'plant', tasks: ['plant'], setUp: tilledFirstPlot },
    { kind: 'water', tasks: ['water'], setUp: thirstyFirstPlot },
    { kind: 'harvest', tasks: ['harvest'], setUp: ripenFirstPlot },
  ];

  for (const { kind, tasks, setUp } of CASES) {
    it(`names the ${kind} the next shift actually performs`, async () => {
      await setUp();
      await armIdle(tasks);

      const { nextAction } = await idleView(Date.now());
      expect(nextAction).not.toBeNull();
      expect(nextAction!.kind).toBe(kind);

      const before = new Map((await plots()).map((p) => [p.id, fingerprint(p)]));

      // Advance the clock to exactly the instant that was promised.
      const player = await currentPlayerRow(playerId);
      const summary = await db.transaction((tx) => applyIdleWork(tx, player, nextAction!.at));

      expect(summary.actions).toBe(1);
      expect(COUNTED[kind]!(summary)).toBe(1);

      const moved = (await plots()).filter((p) => fingerprint(p) !== before.get(p.id));
      expect(moved.map((p) => p.id)).toEqual([nextAction!.plotId]);
    });
  }

  /**
   * The prediction runs off the watermark the shift LEFT, not the one the
   * request found — the action slots sit on a grid anchored there, so reading
   * it before the catch-up would put every predicted instant on the wrong
   * phase.
   */
  it('predicts on the grid left by the shift the same read just applied', async () => {
    await armIdle(['till']);
    // Backdate far enough that the read has a real shift to apply first, but
    // not so far that the farmer hoes the whole field and has nothing next.
    await db
      .update(schema.farms)
      .set({ idleProcessedAt: Date.now() - 3 * IDLE_ACTION_MS })
      .where(eq(schema.farms.id, farmId));

    const { nextAction } = await idleView(Date.now());
    const watermark = (await farmRow()).idleProcessedAt!;

    expect(nextAction).not.toBeNull();
    expect((nextAction!.at - watermark) % IDLE_ACTION_MS).toBe(0);
    expect(nextAction!.at).toBe(watermark + IDLE_ACTION_MS);
  });

  it('has nothing next for a farmer that was never switched on', async () => {
    const idle = await idleView(Date.now());

    expect(idle).toEqual({ enabled: false, tasks: [], cropId: null, nextAction: null });
  });

  it('has nothing next for a farmer given no chores', async () => {
    await armIdle([]);

    const idle = await idleView(Date.now());
    expect(idle.enabled).toBe(true);
    expect(idle.nextAction).toBeNull();
  });

  /**
   * The bag is part of the answer, not decoration: a farmer told to sow with an
   * empty seed pouch has nothing to do, and saying otherwise would have the
   * client animate a planting the applier then refuses.
   */
  it('has nothing next when the bag cannot supply the chore', async () => {
    await tilledFirstPlot();
    await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, playerId));
    await armIdle(['plant']);

    expect((await idleView(Date.now())).nextAction).toBeNull();
  });

  /**
   * Through the real endpoint, not `getFarmState` directly: the plan is only
   * useful if it survives serialisation onto the poll every client makes.
   */
  it('reports the standing orders alongside the plan, over the wire', async () => {
    await armIdle(['harvest', 'till']);

    const res = await client.get('/api/farm');

    expect(res.status).toBe(200);
    expect(res.body.idle.enabled).toBe(true);
    expect(res.body.idle.cropId).toBe(LEEK);
    // Config order, not request order — the same canonical set the endpoint
    // stored (T-13.02).
    expect(res.body.idle.tasks).toEqual(['till', 'harvest']);
    expect(res.body.idle.nextAction).toMatchObject({ kind: 'till', plotId: expect.any(String) });
    // Only the three fields the client is promised — the simulator also knows
    // which crop an action moves, and that is a plan, not a fact (§4.1).
    expect(Object.keys(res.body.idle.nextAction).sort()).toEqual(['at', 'kind', 'plotId']);
  });
});

/**
 * T-13.08 — "while you were away", on the read that earned it.
 *
 * Two claims, and the second is the one that needs a database to check: the
 * numbers are EXACT for a farm whose starting state is known, and the summary
 * appears on precisely one poll. The second falls out of the watermark rather
 * than out of a flag — the read that applies the shift settles the window, so
 * the next read has nothing pending and nothing to say — which is worth
 * asserting because it is a property of two pieces of code agreeing, not of
 * one remembering.
 */
describe('the farm read reports what the farmer did while away (T-13.08)', () => {
  async function readState(now = Date.now()) {
    return getFarmState(await currentPlayerRow(playerId), now);
  }

  it('is exact against a seeded scenario', async () => {
    // Six unlocked plots, nothing hoed, two seeds in the bag. Four hours is
    // comfortably past a leek's growth time, so the whole loop runs out: hoe
    // everything, sow what there are seeds for, water it, pick it.
    await giveItem(LEEK_SEED, 2);
    await idleSince(4 * HOUR, ['till', 'plant', 'water', 'harvest'], LEEK);

    const summary = (await readState()).idleSummary!;

    expect(summary).not.toBeNull();
    // Every unlocked plot hoed; only two sown, because that is how many seeds
    // there were; both of those watered and picked.
    expect(summary.tilled).toBe(STARTING_PLOTS);
    expect(summary.planted).toBe(2);
    expect(summary.harvested).toEqual({ [LEEK_PRODUCE]: 2 * CROPS[LEEK].yieldAmount });
    expect(summary.watered).toBeGreaterThan(0);
    expect(summary.bagWasFull).toBe(false);
    // The window is the stretch the watermark actually moved across.
    expect(summary.window.to - summary.window.from).toBeGreaterThan(3 * HOUR);
    expect(summary.window.to).toBe((await farmRow()).idleProcessedAt);
  });

  it('agrees with the plots and the bag it is describing', async () => {
    await giveItem(LEEK_SEED, 2);
    await idleSince(4 * HOUR, ['till', 'plant', 'water', 'harvest'], LEEK);

    const state = await readState();
    const summary = state.idleSummary!;

    expect(state.plots.filter((p) => p.tilled)).toHaveLength(summary.tilled);
    expect(await held(LEEK_PRODUCE)).toBe(summary.harvested[LEEK_PRODUCE]);
    // Seeds are not in the summary, but they are what paid for the planting.
    expect(await held(LEEK_SEED)).toBe(2 - summary.planted);
  });

  /**
   * Once. The watermark the shift settled is what makes the second read cheap
   * AND silent — there is no "already shown" flag anywhere, on either side.
   */
  it('is reported on one read and not the next', async () => {
    await giveItem(LEEK_SEED, 2);
    await idleSince(4 * HOUR, ['till', 'plant', 'water', 'harvest'], LEEK);

    expect((await readState()).idleSummary).not.toBeNull();
    expect((await readState()).idleSummary).toBeNull();
    expect((await readState()).idleSummary).toBeNull();
  });

  it('is null for a farm that is not idling at all', async () => {
    expect((await readState()).idleSummary).toBeNull();
  });

  /**
   * A settled window with nothing in it is not news. The applier still runs —
   * it has to, to move the watermark — but a shift of zero actions has nothing
   * to report, and a "while you were away" saying nothing happened would be
   * worse than silence.
   */
  it('is null when the shift did nothing', async () => {
    // Enabled, but told to do nothing at all.
    await idleSince(4 * HOUR, []);

    expect((await readState()).idleSummary).toBeNull();
  });

  /**
   * The one outcome a player can act on, and the reason the simulator tells
   * `inventory_full` apart from `nothing_to_do` in the first place.
   */
  it('says when a full bag left a ripe crop standing', async () => {
    await ripenFirstPlot();

    // Every backpack slot occupied by something produce will not stack into,
    // so the ripe crop has nowhere to go and the shift does NOTHING at all.
    await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, playerId));
    for (let slot = 0; slot < BACKPACK_TIERS[0]!.slots; slot++) {
      await giveItem(LEEK_SEED, 1, slot);
    }

    await idleSince(4 * HOUR, ['harvest'], LEEK);

    const summary = (await readState()).idleSummary;

    // Zero actions, and still worth saying: this is the case that would be
    // silent under a plain `actions > 0` gate.
    expect(summary?.bagWasFull).toBe(true);
    expect(summary?.harvested).toEqual({});
    expect(summary?.tilled).toBe(0);
  });
});
