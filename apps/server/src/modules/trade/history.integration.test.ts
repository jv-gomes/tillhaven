import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { FARM_LEVEL_XP, TRADE_MIN_ACCOUNT_AGE_MS, TRADE_MIN_FARM_LEVEL } from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * T-4.12: a player's own completed-trade history, read from `trade_log`
 * (T-4.06). The audit row's CONTENTS are already covered by
 * audit.integration.test.ts — this file is about who gets to read it, in
 * what order, and how pagination behaves, not what gets written.
 */

let alice: TestClient;
let bob: TestClient;
let carol: TestClient;
let aliceId: string;
let bobId: string;
let carolId: string;
let bobName: string;
let carolName: string;

async function makeEligible(playerId: string): Promise<void> {
  await db
    .update(schema.players)
    .set({
      createdAt: Date.now() - TRADE_MIN_ACCOUNT_AGE_MS - 1000,
      experience: FARM_LEVEL_XP[TRADE_MIN_FARM_LEVEL - 1]!,
      flaggedAt: null,
    })
    .where(eq(schema.players.id, playerId));
}

async function give(playerId: string, itemId: string, quantity: number): Promise<void> {
  const existing = await db
    .select({ slotIndex: schema.inventoryItems.slotIndex })
    .from(schema.inventoryItems)
    .where(
      and(eq(schema.inventoryItems.playerId, playerId), eq(schema.inventoryItems.container, 'inventory')),
    );
  const used = new Set(existing.map((s) => s.slotIndex));
  let slotIndex = 0;
  while (used.has(slotIndex)) slotIndex += 1;
  await db.insert(schema.inventoryItems).values({ playerId, container: 'inventory', slotIndex, itemId, quantity });
}

beforeEach(async () => {
  await resetDb();

  alice = await createTestClient();
  bob = await createTestClient();
  carol = await createTestClient();

  const a = await registerTestUser(alice);
  const b = await registerTestUser(bob);
  const c = await registerTestUser(carol);
  aliceId = a.id;
  bobId = b.id;
  carolId = c.id;
  bobName = b.username;
  carolName = c.username;

  await makeEligible(aliceId);
  await makeEligible(bobId);
  await makeEligible(carolId);

  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, aliceId));
  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, bobId));
  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, carolId));
});

afterAll(closeDb);

/** Completes one trade between `a` (initiator) and `b` (recipient), leek-for-potato. */
async function completeTrade(a: TestClient, aId: string, b: TestClient, bTargetName: string): Promise<string> {
  await give(aId, 'leek', 1);
  const invited = await a.post('/api/trade/invite', { targetUsername: bTargetName, idempotencyKey: newKey() });
  const tradeId = invited.body.id as string;
  await b.post('/api/trade/accept', { tradeId, idempotencyKey: newKey() });
  await a.post('/api/trade/offer', { tradeId, items: [{ itemId: 'leek', quantity: 1 }], gold: 0, idempotencyKey: newKey() });
  const bOffer = await b.post('/api/trade/offer', { tradeId, items: [], gold: 0, idempotencyKey: newKey() });
  await a.post('/api/trade/confirm', { tradeId, revision: bOffer.body.revision, idempotencyKey: newKey() });
  await b.post('/api/trade/confirm', { tradeId, revision: bOffer.body.revision, idempotencyKey: newKey() });
  const executed = await a.post('/api/trade/execute', { tradeId, idempotencyKey: newKey() });
  expect(executed.status, executed.code).toBe(200);
  return tradeId;
}

function history(client: TestClient, query = ''): Promise<{ status: number; body: any; code: string | undefined }> {
  return client.get(`/api/trade/history${query}`);
}

describe('GET /api/trade/history', () => {
  it("shows a player's own completed trade, from their point of view", async () => {
    const tradeId = await completeTrade(alice, aliceId, bob, bobName);

    const res = await history(alice);
    expect(res.status, res.code).toBe(200);
    expect(res.body.entries).toHaveLength(1);

    const entry = res.body.entries[0];
    expect(entry.tradeId).toBe(tradeId);
    expect(entry.counterpartyName).toBe(bobName);
    expect(entry.youWereInitiator).toBe(true);
    expect(entry.yourItems).toEqual([{ itemId: 'leek', quantity: 1 }]);
    expect(entry.theirItems).toEqual([]);
    expect(entry.yourGold).toBe(0);
    expect(entry.theirGold).toBe(0);
    expect(typeof entry.completedAt).toBe('number');
  });

  it('mirrors the SAME trade from the other party’s point of view', async () => {
    await completeTrade(alice, aliceId, bob, bobName);

    const res = await history(bob);
    expect(res.status, res.code).toBe(200);
    const entry = res.body.entries[0];
    expect(entry.counterpartyName).toBe((await db.select().from(schema.players).where(eq(schema.players.id, aliceId)))[0]!.username);
    expect(entry.youWereInitiator).toBe(false);
    expect(entry.yourItems).toEqual([]);
    expect(entry.theirItems).toEqual([{ itemId: 'leek', quantity: 1 }]);
  });

  it('never shows a trade to someone who was not party to it', async () => {
    await completeTrade(alice, aliceId, bob, bobName);

    const res = await history(carol);
    expect(res.status, res.code).toBe(200);
    expect(res.body.entries).toEqual([]);
  });

  it('does not include a trade that was only cancelled, never completed', async () => {
    await give(aliceId, 'leek', 1);
    const invited = await alice.post('/api/trade/invite', { targetUsername: bobName, idempotencyKey: newKey() });
    await bob.post('/api/trade/accept', { tradeId: invited.body.id, idempotencyKey: newKey() });
    await alice.post('/api/trade/cancel', { tradeId: invited.body.id });

    const res = await history(alice);
    expect(res.body.entries).toEqual([]);
  });

  it('orders most recent first', async () => {
    const first = await completeTrade(alice, aliceId, bob, bobName);
    // A fresh accept is needed each time — only one live trade per player.
    const second = await completeTrade(alice, aliceId, carol, carolName);

    const res = await history(alice);
    expect(res.body.entries.map((e: any) => e.tradeId)).toEqual([second, first]);
  });

  it('paginates with a cursor, covering every trade exactly once', async () => {
    const ids: string[] = [];
    ids.push(await completeTrade(alice, aliceId, bob, bobName));
    ids.push(await completeTrade(alice, aliceId, carol, carolName));
    ids.push(await completeTrade(bob, bobId, alice, (await db.select().from(schema.players).where(eq(schema.players.id, aliceId)))[0]!.username));

    const page1 = await history(alice, '?limit=2');
    expect(page1.body.entries).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await history(alice, `?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    expect(page2.body.entries).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    const seen = [...page1.body.entries, ...page2.body.entries].map((e: any) => e.tradeId);
    // All three of alice's trades, each exactly once, newest first overall.
    expect(new Set(seen).size).toBe(3);
    expect(seen).toEqual([...ids].reverse());
  });

  it('does not skip or repeat a row when two trades share one millisecond', async () => {
    // Real trade completions rarely land on the identical millisecond, so
    // this forces the collision directly rather than hoping for one — the
    // `id` tie-breaker in the cursor exists precisely for this case.
    const sameMoment = Date.now();
    const rows = [1, 2, 3].map((n) => ({
      tradeId: crypto.randomUUID(),
      initiatorId: aliceId,
      recipientId: bobId,
      initiatorItems: '[]',
      recipientItems: '[]',
      initiatorGold: 0,
      recipientGold: 0,
      completedAt: sameMoment,
      // Deterministic ids so the expected DESC order is known ahead of time.
      id: `00000000-0000-0000-0000-00000000000${n}`,
    }));
    await db.insert(schema.tradeLog).values(rows);

    const page1 = await history(alice, '?limit=2');
    expect(page1.body.entries).toHaveLength(2);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await history(alice, `?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    expect(page2.body.entries).toHaveLength(1);

    const seenIds = [...page1.body.entries, ...page2.body.entries].map((e: any) => e.tradeId);
    const expectedIds = rows.map((r) => r.tradeId).reverse(); // id DESC, since completedAt ties
    expect(seenIds).toEqual(expectedIds);
  });

  it('treats a garbled cursor as page one rather than an error', async () => {
    await completeTrade(alice, aliceId, bob, bobName);

    const res = await history(alice, '?cursor=not-a-real-cursor');
    expect(res.status, res.code).toBe(200);
    expect(res.body.entries).toHaveLength(1);
  });

  it('rejects a limit outside the allowed range', async () => {
    const tooMany = await history(alice, '?limit=1000');
    expect(tooMany.status).toBe(400);
  });
});
