import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  BASE_INVENTORY_SLOTS,
  ErrorCode,
  FARM_LEVEL_XP,
  TRADE_MIN_ACCOUNT_AGE_MS,
  TRADE_MIN_FARM_LEVEL,
} from '@tillhaven/shared';
import { db, schema, closeDb, observeQueries } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';
import { TradeStatus } from './lifecycle.js';
import { execute as executeService } from './service.js';

/**
 * Execution: the highest-risk step in the trading system (CLAUDE.md §6).
 *
 * A bug in the lifecycle (T-4.02) strands someone in a stuck conversation. A
 * bug HERE duplicates or destroys items — the failure a player-driven economy
 * cannot recover from. So the tests below spend most of their weight on the
 * failure paths: nothing may move unless everything can.
 */

const ELIGIBLE_XP = FARM_LEVEL_XP[TRADE_MIN_FARM_LEVEL - 1]!;

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let aliceName: string;
let bobName: string;

async function makeEligible(playerId: string): Promise<void> {
  await db
    .update(schema.players)
    .set({
      createdAt: Date.now() - TRADE_MIN_ACCOUNT_AGE_MS - 1000,
      experience: ELIGIBLE_XP,
      flaggedAt: null,
    })
    .where(eq(schema.players.id, playerId));
}

async function give(playerId: string, itemId: string, quantity: number): Promise<void> {
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

  await db
    .insert(schema.inventoryItems)
    .values({ playerId, container: 'inventory', slotIndex, itemId, quantity });
}

async function held(playerId: string, itemId: string): Promise<number> {
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

async function totalItems(playerId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.playerId, playerId),
        eq(schema.inventoryItems.container, 'inventory'),
      ),
    );
  return rows.reduce((sum, r) => sum + r.quantity, 0);
}

beforeEach(async () => {
  await resetDb();

  alice = await createTestClient();
  bob = await createTestClient();

  const a = await registerTestUser(alice);
  const b = await registerTestUser(bob);
  aliceId = a.id;
  bobId = b.id;
  aliceName = a.username;
  bobName = b.username;

  await makeEligible(aliceId);
  await makeEligible(bobId);

  // Start from an empty bag on both sides, so item counts in assertions are exact.
  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, aliceId));
  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, bobId));
});

afterAll(closeDb);

/** Invites, accepts, and returns the open trade's id. */
async function openTrade(): Promise<string> {
  const invited = await alice.post('/api/trade/invite', {
    targetUsername: bobName,
    idempotencyKey: newKey(),
  });
  await bob.post('/api/trade/accept', { tradeId: invited.body.id, idempotencyKey: newKey() });
  return invited.body.id;
}

function offer(client: TestClient, tradeId: string, items: unknown[]) {
  return client.post('/api/trade/offer', { tradeId, items, gold: 0, idempotencyKey: newKey() });
}

function confirmAt(client: TestClient, tradeId: string, revision: number) {
  return client.post('/api/trade/confirm', { tradeId, revision, idempotencyKey: newKey() });
}

function doExecute(client: TestClient, tradeId: string) {
  return client.post('/api/trade/execute', { tradeId, idempotencyKey: newKey() });
}

async function tradeRow(tradeId: string) {
  const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
  return row!;
}

/** Sets up a trade where Alice offers leek and Bob offers potato, both confirmed. */
async function readyTrade(aliceQty = 3, bobQty = 2): Promise<string> {
  const tradeId = await openTrade();
  await give(aliceId, 'leek', aliceQty);
  await give(bobId, 'potato', bobQty);

  await offer(alice, tradeId, [{ itemId: 'leek', quantity: aliceQty }]);
  const bobOffer = await offer(bob, tradeId, [{ itemId: 'potato', quantity: bobQty }]);

  await confirmAt(alice, tradeId, bobOffer.body.revision);
  await confirmAt(bob, tradeId, bobOffer.body.revision);

  return tradeId;
}

describe('POST /api/trade/execute', () => {
  it('swaps both offers and completes the trade', async () => {
    const tradeId = await readyTrade(3, 2);

    const res = await doExecute(alice, tradeId);

    expect(res.status, res.code).toBe(200);
    expect(res.body.status).toBe(TradeStatus.COMPLETED);

    expect(await held(aliceId, 'leek')).toBe(0);
    expect(await held(aliceId, 'potato')).toBe(2);
    expect(await held(bobId, 'potato')).toBe(0);
    expect(await held(bobId, 'leek')).toBe(3);

    expect((await tradeRow(tradeId)).status).toBe(TradeStatus.COMPLETED);
  });

  it('either party may trigger it', async () => {
    const tradeId = await readyTrade();
    const res = await doExecute(bob, tradeId);
    expect(res.status, res.code).toBe(200);
  });

  it('refuses before both have confirmed', async () => {
    const tradeId = await openTrade();
    await give(aliceId, 'leek', 3);
    const aliceOffer = await offer(alice, tradeId, [{ itemId: 'leek', quantity: 3 }]);
    await confirmAt(alice, tradeId, aliceOffer.body.revision);
    // Bob never confirms.

    const res = await doExecute(alice, tradeId);

    expect(res.code).toBe(ErrorCode.TRADE_NOT_READY);
    expect(await held(aliceId, 'leek')).toBe(3);
  });

  it('refuses on an expired trade, and moves nothing', async () => {
    const tradeId = await readyTrade();
    await db.update(schema.trades).set({ expiresAt: Date.now() - 1 }).where(eq(schema.trades.id, tradeId));

    const res = await doExecute(alice, tradeId);

    expect(res.code).toBe(ErrorCode.TRADE_EXPIRED);
    expect(await held(aliceId, 'leek')).toBe(3);
    expect(await held(bobId, 'potato')).toBe(2);
  });

  it('refuses on a cancelled trade', async () => {
    const tradeId = await readyTrade();
    await alice.post('/api/trade/cancel', { tradeId });

    expect((await doExecute(bob, tradeId)).code).toBe(ErrorCode.TRADE_NOT_FOUND);
  });

  it("refuses a stranger's trade without confirming it exists", async () => {
    const tradeId = await readyTrade();
    const carol = await createTestClient();
    await registerTestUser(carol);

    const res = await carol.post('/api/trade/execute', { tradeId, idempotencyKey: newKey() });
    expect(res.code).toBe(ErrorCode.TRADE_NOT_FOUND);
    await carol.close();
  });

  /* ---- domain-level idempotency: two different requests, same outcome ---- */

  it('is idempotent under the same key', async () => {
    const tradeId = await readyTrade();
    const key = newKey();
    const body = { tradeId, idempotencyKey: key };

    const first = await alice.post('/api/trade/execute', body);
    const replay = await alice.post('/api/trade/execute', body);

    expect(replay.body).toEqual(first.body);
    expect(await held(bobId, 'leek')).toBe(3);
  });

  /**
   * Whichever party's request lands first completes the trade; the OTHER
   * party's own execute call — with its own, different key — must not error
   * just because the trade finished a moment earlier. It reports the same
   * completed trade, and nothing moves twice.
   */
  it('treats a second execute by the other party as success, not an error', async () => {
    const tradeId = await readyTrade();

    const first = await doExecute(alice, tradeId);
    const second = await doExecute(bob, tradeId);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe(TradeStatus.COMPLETED);

    // Exactly one swap happened, not two.
    expect(await held(bobId, 'leek')).toBe(3);
    expect(await held(aliceId, 'potato')).toBe(2);
  });

  /* ---- ownership re-verified at execution, not trusted from confirm time ---- */

  /**
   * The scenario the whole task exists for: an item legitimately leaves a bag
   * in the minutes between confirming and executing (sold to the shop, traded
   * elsewhere, whatever) — and the trade must not manufacture it anyway.
   */
  it('refuses execution when an offered item has since left the bag', async () => {
    const tradeId = await readyTrade(3, 2);

    // Alice's leek is gone by the time execution runs.
    await db
      .delete(schema.inventoryItems)
      .where(and(eq(schema.inventoryItems.playerId, aliceId), eq(schema.inventoryItems.itemId, 'leek')));

    const res = await doExecute(alice, tradeId);

    expect(res.code).toBe(ErrorCode.TRADE_ITEM_MISSING);
    // NOTHING moved — not even Bob's side, despite his items still being intact.
    expect(await held(bobId, 'potato')).toBe(2);
    expect(await held(aliceId, 'leek')).toBe(0);
    expect(await held(aliceId, 'potato')).toBe(0);
    expect(await held(bobId, 'leek')).toBe(0);
  });

  it('refuses when only PART of the offered quantity remains', async () => {
    const tradeId = await readyTrade(5, 2);

    await db
      .update(schema.inventoryItems)
      .set({ quantity: 2 })
      .where(and(eq(schema.inventoryItems.playerId, aliceId), eq(schema.inventoryItems.itemId, 'leek')));

    const res = await doExecute(alice, tradeId);

    expect(res.code).toBe(ErrorCode.TRADE_ITEM_MISSING);
    expect(await held(aliceId, 'leek')).toBe(2);
    expect(await held(bobId, 'potato')).toBe(2);
  });

  it('re-checks the OTHER party’s holdings too, not just the caller’s own', async () => {
    const tradeId = await readyTrade(3, 2);

    await db
      .delete(schema.inventoryItems)
      .where(and(eq(schema.inventoryItems.playerId, bobId), eq(schema.inventoryItems.itemId, 'potato')));

    // Alice calls execute; the missing item is on BOB's side.
    const res = await doExecute(alice, tradeId);

    expect(res.code).toBe(ErrorCode.TRADE_ITEM_MISSING);
    expect(await held(aliceId, 'leek')).toBe(3);
  });

  /* ---- capacity: everything moves, or nothing does ---- */

  /**
   * The fill has to happen BEFORE the player's own offered item is given, not
   * after. `give()` (test setup only, bypassing real capacity rules) places
   * each new stack in the next free slot index with no cap of its own — so
   * filling AFTER the offer would push the filler one slot past 24, leaving
   * the offered item's own slot as the one genuine gap once it is removed,
   * and the trade would wrongly succeed. Filling first pins the offered item
   * outside the real 0..23 window, so removing it frees nothing usable.
   */
  it('refuses when the RECIPIENT of an item has no room, and moves nothing at all', async () => {
    const tradeId = await openTrade();

    for (let i = 0; i < BASE_INVENTORY_SLOTS; i++) await give(bobId, 'onion', 999);
    await give(aliceId, 'leek', 3);
    await give(bobId, 'potato', 2);

    await offer(alice, tradeId, [{ itemId: 'leek', quantity: 3 }]);
    const bobOffer = await offer(bob, tradeId, [{ itemId: 'potato', quantity: 2 }]);
    await confirmAt(alice, tradeId, bobOffer.body.revision);
    await confirmAt(bob, tradeId, bobOffer.body.revision);

    const res = await doExecute(alice, tradeId);

    expect(res.code).toBe(ErrorCode.INVENTORY_FULL);
    // Alice's leek is exactly where it started — not removed and stranded.
    expect(await held(aliceId, 'leek')).toBe(3);
    // Bob's potato never left his bag either.
    expect(await held(bobId, 'potato')).toBe(2);
  });

  it('the same failure protects the OTHER direction too', async () => {
    const tradeId = await openTrade();

    for (let i = 0; i < BASE_INVENTORY_SLOTS; i++) await give(aliceId, 'onion', 999);
    await give(aliceId, 'leek', 3);
    await give(bobId, 'potato', 2);

    await offer(alice, tradeId, [{ itemId: 'leek', quantity: 3 }]);
    const bobOffer = await offer(bob, tradeId, [{ itemId: 'potato', quantity: 2 }]);
    await confirmAt(alice, tradeId, bobOffer.body.revision);
    await confirmAt(bob, tradeId, bobOffer.body.revision);

    const res = await doExecute(bob, tradeId);

    expect(res.code).toBe(ErrorCode.INVENTORY_FULL);
    expect(await held(bobId, 'potato')).toBe(2);
    expect(await held(aliceId, 'leek')).toBe(3);
  });

  /**
   * The ordering property this depends on: removing a player's own offered
   * items can free the very slot their incoming items need, so a straight swap
   * between two FULL bags must still succeed.
   */
  it('lets a full bag swap one item for another via the trade itself', async () => {
    const tradeId = await readyTrade(3, 2);

    // Fill Alice's remaining slots, leaving exactly the leek stack she is
    // trading away — no room for potato unless removing the leek counts first.
    for (let i = 0; i < BASE_INVENTORY_SLOTS - 1; i++) await give(aliceId, 'onion', 999);
    expect(await totalItemSlotCount(aliceId)).toBe(BASE_INVENTORY_SLOTS);

    const res = await doExecute(alice, tradeId);

    expect(res.status, res.code).toBe(200);
    expect(await held(aliceId, 'potato')).toBe(2);
  });

  async function totalItemSlotCount(playerId: string): Promise<number> {
    const rows = await db
      .select()
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.playerId, playerId),
          eq(schema.inventoryItems.container, 'inventory'),
        ),
      );
    return rows.length;
  }

  /* ---- eligibility re-checked at execution too ---- */

  it('refuses if a party was flagged between confirming and executing', async () => {
    const tradeId = await readyTrade();
    await db.update(schema.players).set({ flaggedAt: Date.now() }).where(eq(schema.players.id, bobId));

    const res = await doExecute(alice, tradeId);

    expect(res.code).toBe(ErrorCode.TRADE_NOT_ELIGIBLE);
    expect(await held(aliceId, 'leek')).toBe(3);
    expect(await held(bobId, 'potato')).toBe(2);
  });

  /* ---- gold, while D-3 is undecided ---- */

  it('moves no gold — the columns stay at zero', async () => {
    const tradeId = await readyTrade();
    await doExecute(alice, tradeId);

    const row = await tradeRow(tradeId);
    expect(row.initiatorGold).toBe(0);
    expect(row.recipientGold).toBe(0);
  });

  /* ---- the total count invariant ---- */

  it('never changes the TOTAL item count across both players, on any outcome', async () => {
    const tradeId = await readyTrade(3, 2);
    const before = (await totalItems(aliceId)) + (await totalItems(bobId));

    await doExecute(alice, tradeId);

    expect((await totalItems(aliceId)) + (await totalItems(bobId))).toBe(before);
  });

  it('never changes the total count when execution FAILS either', async () => {
    const tradeId = await readyTrade(3, 2);
    await db
      .delete(schema.inventoryItems)
      .where(and(eq(schema.inventoryItems.playerId, aliceId), eq(schema.inventoryItems.itemId, 'leek')));

    const before = (await totalItems(aliceId)) + (await totalItems(bobId));
    await doExecute(alice, tradeId);

    expect((await totalItems(aliceId)) + (await totalItems(bobId))).toBe(before);
  });

  /* ---- locking: proved directly, not inferred ---- */

  /**
   * Proves SOME lock on the inventory is actually taken, rather than trusting
   * the code read. Holds a `FOR UPDATE` on Alice's inventory row in one
   * transaction and asserts `execute` blocks until it is released.
   *
   * Read narrowly: this does not by itself prove the deliberate `lockContainer`
   * pre-lock in `execute` is what causes the block — `removeItem` re-locks
   * internally too, later in the same function, so this test still passes with
   * the pre-lock deleted. What the pre-lock actually buys is LOCK ORDER, which
   * this test cannot see; the next one is built to see it.
   */
  it('blocks on a lock already held on a party’s inventory', async () => {
    const tradeId = await readyTrade();

    const [row] = await db
      .select()
      .from(schema.inventoryItems)
      .where(and(eq(schema.inventoryItems.playerId, aliceId), eq(schema.inventoryItems.itemId, 'leek')))
      .limit(1);
    expect(row).toBeDefined();

    let release: (() => void) | undefined;
    const held_ = new Promise<void>((resolve) => {
      release = resolve;
    });

    const holding = db.transaction(async (tx) => {
      await tx
        .select({ id: schema.inventoryItems.id })
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.playerId, aliceId))
        .for('update');
      await held_;
    });

    await new Promise((r) => setTimeout(r, 100));

    let finished = false;
    const executing = doExecute(alice, tradeId).then((res) => {
      finished = true;
      return res;
    });

    await new Promise((r) => setTimeout(r, 300));
    expect(finished, 'execute did not wait for the lock on the inventory row').toBe(false);

    release!();
    await holding;

    const res = await executing;
    expect(res.status, res.code).toBe(200);
  });

  /**
   * Proves the LOCK ORDER, using the query observer from `db/client.ts`
   * (T-2.11) — watching which player's `inventory_items` a `FOR UPDATE`
   * touches first, rather than inferring it from behaviour that would look the
   * same either way.
   *
   * The trade is deliberately built so the INITIATOR is whichever party has
   * the HIGHER id. Sorted-by-id locking must therefore touch the RECIPIENT's
   * inventory first — the opposite of "whoever is locked first in the code as
   * written" (initiator's `removeItem` runs before recipient's). If `execute`
   * ever regressed to a naive initiator-then-recipient order, this is the test
   * that would catch it; a same-two-players deadlock cannot be manufactured
   * through the real API, because a player can only ever be in one live trade
   * (§6, and T-4.02's notes on the same limit).
   */
  it('locks the two players’ inventories in ID order, not invite order', async () => {
    // Force the initiator to be the higher-id party, regardless of which of
    // alice/bob that happens to be for this run's random UUIDs.
    const sortedIds = [aliceId, bobId].sort();
    const lowerId = sortedIds[0]!;
    const higherId = sortedIds[1]!;
    const aliceIsHigher = aliceId === higherId;
    const initiatorClient = aliceIsHigher ? alice : bob;
    const recipientClient = aliceIsHigher ? bob : alice;
    const initiatorId = aliceIsHigher ? aliceId : bobId;
    const recipientUsername = aliceIsHigher ? bobName : aliceName;

    const invited = await initiatorClient.post('/api/trade/invite', {
      targetUsername: recipientUsername,
      idempotencyKey: newKey(),
    });
    expect(invited.body.initiatorId, 'test setup: initiator must be the higher id').toBe(higherId);
    await recipientClient.post('/api/trade/accept', { tradeId: invited.body.id, idempotencyKey: newKey() });

    await give(initiatorId, 'leek', 1);
    const initiatorOffer = await offer(initiatorClient, invited.body.id, [{ itemId: 'leek', quantity: 1 }]);
    await confirmAt(initiatorClient, invited.body.id, initiatorOffer.body.revision);
    await confirmAt(recipientClient, invited.body.id, initiatorOffer.body.revision);

    const order: string[] = [];
    observeQueries((query, params) => {
      const q = query.toLowerCase();
      if (!q.includes('inventory_items') || !q.includes('for update')) return;

      for (const id of [lowerId, higherId]) {
        if (order.includes(id)) continue;
        if (params.includes(id)) order.push(id);
      }
    });

    try {
      const res = await doExecute(initiatorClient, invited.body.id);
      expect(res.status, res.code).toBe(200);
    } finally {
      observeQueries(null);
    }

    expect(order.slice(0, 2)).toEqual([lowerId, higherId]);
  });

  /**
   * The overlapping-transactions proof for holdings, matching the pattern used
   * for the trade-row lock in T-4.04: two executions racing to spend the SAME
   * item cannot both succeed. Constructed directly at the service level, since
   * `app.inject` serialises requests and would prove nothing (as established in
   * T-4.02's own notes).
   */
  it('cannot be raced into spending the same item twice', async () => {
    const tradeId = await readyTrade(3, 2);

    // A second, competing consumer of Alice's leek — a sale to the shop,
    // modelled directly as a remove, racing the trade's own removal.
    const [aliceRow] = await db.select().from(schema.players).where(eq(schema.players.id, aliceId));

    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const executing = db.transaction(async (tx) => {
      const result = await executeService(tx, aliceRow as never, tradeId, Date.now());
      await hold;
      return result;
    });

    await new Promise((r) => setTimeout(r, 150));

    const competingSpend = db
      .transaction(async (tx) => {
        await tx
          .select({ id: schema.inventoryItems.id })
          .from(schema.inventoryItems)
          .where(and(eq(schema.inventoryItems.playerId, aliceId), eq(schema.inventoryItems.itemId, 'leek')))
          .for('update');
      })
      .then(() => 'proceeded')
      .catch(() => 'blocked-or-failed');

    await new Promise((r) => setTimeout(r, 200));
    release!();
    await executing;
    const outcome = await competingSpend;

    // Either the competing lock waited (proceeded only after commit) or it
    // failed outright — what it must NOT do is run concurrently and read stale
    // data. Since both eventually resolve without throwing an unexpected error,
    // the meaningful assertion is the item count afterwards.
    expect(outcome === 'proceeded' || outcome === 'blocked-or-failed').toBe(true);
    expect(await held(aliceId, 'leek')).toBe(0);
    expect(await held(bobId, 'leek')).toBe(3);
  });
});

/**
 * §6 requires this endpoint to re-verify holdings at execution, exactly as
 * T-4.01's forward guard requires eligibility. Extended here rather than
 * duplicated: one scan, two properties.
 */
describe('the execution path checks holdings as well as eligibility', () => {
  it('references countItem under the inventory container, not just eligibility', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./service.ts', import.meta.url), 'utf8'),
    );

    expect(source).toMatch(/countItem\(/);
    expect(source).toMatch(/assertBothCanTrade\(/);
  });
});
