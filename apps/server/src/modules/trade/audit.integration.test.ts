import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { FARM_LEVEL_XP, TRADE_MIN_ACCOUNT_AGE_MS, TRADE_MIN_FARM_LEVEL } from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * The audit trail (CLAUDE.md §6, T-4.06). `trade_log` is what turns a scam
 * report into something investigable — it exists to survive the report, so
 * these tests check it is written, complete, and never touched again, not
 * just that the swap itself worked (that's execution.integration.test.ts).
 */

const ELIGIBLE_XP = FARM_LEVEL_XP[TRADE_MIN_FARM_LEVEL - 1]!;

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
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
  await db
    .insert(schema.inventoryItems)
    .values({ playerId, container: 'inventory', slotIndex: 0, itemId, quantity });
}

beforeEach(async () => {
  await resetDb();

  alice = await createTestClient();
  bob = await createTestClient();

  const a = await registerTestUser(alice);
  const b = await registerTestUser(bob);
  aliceId = a.id;
  bobId = b.id;
  bobName = b.username;

  await makeEligible(aliceId);
  await makeEligible(bobId);

  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, aliceId));
  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, bobId));
});

afterAll(closeDb);

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

/** Alice offers leek, Bob offers potato, both confirmed, ready to execute. */
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

async function logRowsFor(tradeId: string) {
  return db.select().from(schema.tradeLog).where(eq(schema.tradeLog.tradeId, tradeId));
}

describe('trade_log', () => {
  it('gets exactly one row, written by the execution itself', async () => {
    const tradeId = await readyTrade(3, 2);
    const before = await logRowsFor(tradeId);
    expect(before).toHaveLength(0);

    const res = await doExecute(alice, tradeId);
    expect(res.status, res.code).toBe(200);

    const after = await logRowsFor(tradeId);
    expect(after).toHaveLength(1);
  });

  it('records both player ids, all items, gold, and the completion time', async () => {
    const before = Date.now();
    const tradeId = await readyTrade(3, 2);
    const res = await doExecute(alice, tradeId);
    expect(res.status, res.code).toBe(200);

    const [row] = await logRowsFor(tradeId);
    expect(row).toBeDefined();
    expect(row!.initiatorId).toBe(aliceId);
    expect(row!.recipientId).toBe(bobId);
    expect(JSON.parse(row!.initiatorItems)).toEqual([{ itemId: 'leek', quantity: 3 }]);
    expect(JSON.parse(row!.recipientItems)).toEqual([{ itemId: 'potato', quantity: 2 }]);
    expect(row!.initiatorGold).toBe(0);
    expect(row!.recipientGold).toBe(0);
    expect(row!.completedAt).toBeGreaterThanOrEqual(before);
    expect(row!.completedAt).toBeLessThanOrEqual(Date.now());
  });

  it('is not written when execution fails', async () => {
    // Alice offers more leek than she will actually hold at execution time —
    // the ownership re-check (T-4.05) refuses this, and nothing — including
    // the audit row — should be written for a trade that never happened.
    const tradeId = await openTrade();
    await give(aliceId, 'leek', 3);
    await give(bobId, 'potato', 2);
    await offer(alice, tradeId, [{ itemId: 'leek', quantity: 3 }]);
    const bobOffer = await offer(bob, tradeId, [{ itemId: 'potato', quantity: 2 }]);
    await confirmAt(alice, tradeId, bobOffer.body.revision);
    await confirmAt(bob, tradeId, bobOffer.body.revision);

    // Take the leek away after confirming, before executing.
    await db
      .delete(schema.inventoryItems)
      .where(and(eq(schema.inventoryItems.playerId, aliceId), eq(schema.inventoryItems.itemId, 'leek')));

    const res = await doExecute(alice, tradeId);
    expect(res.status).not.toBe(200);
    expect(await logRowsFor(tradeId)).toHaveLength(0);
  });

  it('does not gain a second row when the other party also calls execute', async () => {
    const tradeId = await readyTrade(3, 2);

    const first = await doExecute(alice, tradeId);
    expect(first.status, first.code).toBe(200);
    const second = await doExecute(bob, tradeId);
    expect(second.status, second.code).toBe(200);

    expect(await logRowsFor(tradeId)).toHaveLength(1);
  });

  it('is never UPDATEd or DELETEd anywhere in the server source', async () => {
    const { readFile, readdir } = await import('node:fs/promises');

    const files: string[] = [];
    async function walk(dirUrl: URL): Promise<void> {
      const entries = await readdir(dirUrl, { withFileTypes: true });
      for (const entry of entries) {
        const childUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          await walk(childUrl);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          files.push(childUrl.pathname);
        }
      }
    }
    await walk(new URL('../../', import.meta.url));

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/\.update\(\s*schema\.tradeLog\b/.test(source) || /\.delete\(\s*schema\.tradeLog\b/.test(source)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('security_log', () => {
  it('gets a trade_executed entry for the party that ran execution', async () => {
    const tradeId = await readyTrade(3, 2);
    const res = await doExecute(alice, tradeId);
    expect(res.status, res.code).toBe(200);

    const rows = await db
      .select()
      .from(schema.securityLog)
      .where(and(eq(schema.securityLog.event, 'trade_executed'), eq(schema.securityLog.playerId, aliceId)));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.detail === tradeId)).toBe(true);
  });
});
