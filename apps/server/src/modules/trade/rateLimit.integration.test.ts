import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  ErrorCode,
  FARM_LEVEL_XP,
  TRADE_MIN_ACCOUNT_AGE_MS,
  TRADE_MIN_FARM_LEVEL,
  TRADE_RATE_LIMIT,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { redis, closeRedis } from '../../db/redis.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * T-4.08: the per-ACCOUNT half of rate limiting (CLAUDE.md §8), on top of the
 * per-IP `@fastify/rate-limit` config every route already has. Only
 * `/execute` carries it — invites get their own, separate cap (see below).
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

/** Clears this test's own rate-limit keys, so a re-run starts from zero. */
async function clearLimit(playerId: string): Promise<void> {
  await redis.del(`ratelimit:trade.execute:${playerId}`);
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

  await clearLimit(aliceId);
  await clearLimit(bobId);
});

afterAll(async () => {
  await closeDb();
  await closeRedis();
});

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

function doExecute(client: TestClient, tradeId: string, idempotencyKey = newKey()) {
  return client.post('/api/trade/execute', { tradeId, idempotencyKey });
}

async function readyTrade(): Promise<string> {
  const tradeId = await openTrade();
  await give(aliceId, 'leek', 3);
  await give(bobId, 'potato', 2);

  await offer(alice, tradeId, [{ itemId: 'leek', quantity: 3 }]);
  const bobOffer = await offer(bob, tradeId, [{ itemId: 'potato', quantity: 2 }]);

  await confirmAt(alice, tradeId, bobOffer.body.revision);
  await confirmAt(bob, tradeId, bobOffer.body.revision);

  return tradeId;
}

describe('POST /api/trade/execute rate limiting', () => {
  it(`refuses the ${TRADE_RATE_LIMIT.max + 1}th execution attempt in a day`, async () => {
    // One real trade, executed once for real, then re-called on the same
    // (now completed) trade — T-4.05's domain-level idempotency means each
    // of those still succeeds, and each is still a genuine, distinctly-keyed
    // call to this endpoint, so it still has to pass the account limiter.
    const tradeId = await readyTrade();

    for (let i = 0; i < TRADE_RATE_LIMIT.max; i++) {
      const res = await doExecute(alice, tradeId);
      expect(res.status, `attempt ${i + 1}: ${res.code}`).toBe(200);
    }

    const over = await doExecute(alice, tradeId);
    expect(over.status).toBe(429);
    expect(over.code).toBe(ErrorCode.TRADE_RATE_LIMITED);
  });

  it('does not charge quota for a replayed idempotency key', async () => {
    const tradeId = await readyTrade();
    const key = newKey();

    for (let i = 0; i < TRADE_RATE_LIMIT.max + 5; i++) {
      const res = await doExecute(alice, tradeId, key);
      expect(res.status, `replay ${i + 1}: ${res.code}`).toBe(200);
    }

    // The limiter was never even reached — every one of those was the exact
    // same stored response coming back.
    const count = await redis.get(`ratelimit:trade.execute:${aliceId}`);
    expect(count === null || Number(count)).toBeLessThanOrEqual(1);
  });

  it('is per account, not shared across players', async () => {
    const tradeId = await readyTrade();

    for (let i = 0; i < TRADE_RATE_LIMIT.max; i++) {
      const res = await doExecute(alice, tradeId);
      expect(res.status, `alice attempt ${i + 1}: ${res.code}`).toBe(200);
    }
    expect((await doExecute(alice, tradeId)).status).toBe(429);

    // Bob has made zero execute calls of his own — his quota is untouched.
    const bobRes = await doExecute(bob, tradeId);
    expect(bobRes.status, bobRes.code).toBe(200);
  });

  it('invite spam is capped separately and does not touch the execute limit', async () => {
    // /invite has its own tighter per-IP limit (10/min, see routes.ts) — this
    // loop stays under that so what's actually under test, the Redis
    // account limiter, isn't muddied by tripping a different one.
    const rounds = 5;
    for (let i = 0; i < rounds; i++) {
      const invited = await alice.post('/api/trade/invite', {
        targetUsername: bobName,
        idempotencyKey: newKey(),
      });
      expect(invited.status, invited.code).toBe(200);
      await alice.post('/api/trade/cancel', { tradeId: invited.body.id });
    }

    const count = await redis.get(`ratelimit:trade.execute:${aliceId}`);
    expect(count).toBeNull();

    // And execute's own quota is still fully available afterward.
    const tradeId = await readyTrade();
    const res = await doExecute(alice, tradeId);
    expect(res.status, res.code).toBe(200);
  });
});
