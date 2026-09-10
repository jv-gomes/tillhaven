import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { ErrorCode, MILESTONES, getMilestone } from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * The progression endpoints (T-30.08).
 *
 * Driven through `app.inject` rather than the service, because the layers this
 * task adds — Zod, the rate limit, `requireAuth`, `runIdempotent` and the
 * error handler — are exactly the ones a service-level test skips.
 */

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;
});

afterAll(closeDb);

async function tillOne(): Promise<void> {
  const [farm] = await db
    .select({ id: schema.farms.id })
    .from(schema.farms)
    .where(eq(schema.farms.playerId, playerId));
  const [plot] = await db
    .select({ id: schema.plots.id })
    .from(schema.plots)
    .where(eq(schema.plots.farmId, farm!.id))
    .limit(1);
  await db.update(schema.plots).set({ tilledAt: 1 }).where(eq(schema.plots.id, plot!.id));
}

async function seedsHeld(): Promise<number> {
  const rows = await db
    .select({ q: schema.inventoryItems.quantity, i: schema.inventoryItems.itemId })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.playerId, playerId));
  return rows.filter((r) => r.i === 'leek_seeds').reduce((n, r) => n + r.q, 0);
}

describe('GET /api/progression', () => {
  it('returns the whole board, nothing earned on a new farm', async () => {
    const res = await client.get('/api/progression');

    expect(res.status).toBe(200);
    expect(res.body.milestones).toHaveLength(MILESTONES.length);
    expect(res.body.milestones.every((m: { earned: boolean }) => !m.earned)).toBe(true);
    expect(res.body.milestones.every((m: { claimed: boolean }) => !m.claimed)).toBe(true);
  });

  it('carries the hint and the reward, so the panel needs no second source', async () => {
    const res = await client.get('/api/progression');
    const first = res.body.milestones[0];

    expect(first.title.length).toBeGreaterThan(0);
    expect(first.hint.length).toBeGreaterThan(0);
    expect(first.reward).toBeDefined();
    expect(first.target).toBeGreaterThan(0);
  });

  it('flips to earned as the underlying counter moves', async () => {
    await tillOne();
    const res = await client.get('/api/progression');
    const first = res.body.milestones.find((m: { id: string }) => m.id === 'break_ground');

    expect(first.earned).toBe(true);
    expect(first.claimed).toBe(false);
    expect(first.progress).toBe(1);
  });

  it('refuses an anonymous caller', async () => {
    const anon = await createTestClient();
    const res = await anon.get('/api/progression');
    expect(res.status).toBe(401);
    await anon.close();
  });
});

describe('POST /api/progression/claim', () => {
  it('pays an earned milestone', async () => {
    await tillOne();
    const before = await seedsHeld();

    const res = await client.post('/api/progression/claim', {
      milestoneId: 'break_ground',
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(res.body.milestoneId).toBe('break_ground');
    expect(res.body.farmLevel).toBe(1);
    expect(await seedsHeld()).toBe(before + getMilestone('break_ground')!.reward.items[0]!.quantity);
  });

  it('refuses a milestone that has not been earned', async () => {
    const res = await client.post('/api/progression/claim', {
      milestoneId: 'break_ground',
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe(ErrorCode.MILESTONE_NOT_EARNED);
  });

  it('refuses an unknown milestone id', async () => {
    const res = await client.post('/api/progression/claim', {
      milestoneId: 'does_not_exist',
      idempotencyKey: newKey(),
    });
    expect(res.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('rejects a malformed payload before any work happens', async () => {
    for (const body of [
      {},
      { milestoneId: '', idempotencyKey: newKey() },
      { milestoneId: 'break_ground' },
      { milestoneId: 123, idempotencyKey: newKey() },
      { milestoneId: 'x'.repeat(200), idempotencyKey: newKey() },
    ]) {
      const res = await client.post('/api/progression/claim', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('refuses an anonymous caller', async () => {
    const anon = await createTestClient();
    const res = await anon.post('/api/progression/claim', {
      milestoneId: 'break_ground',
      idempotencyKey: newKey(),
    });
    expect(res.status).toBe(401);
    await anon.close();
  });

  /**
   * The two guards cover different failures. A replayed key is a flaky
   * connection and must return the FIRST response rather than a confusing
   * "already claimed"; two distinct requests racing are two open tabs, and the
   * unique index is what stops those double-paying.
   */
  it('returns the first response for a replayed idempotency key, and pays once', async () => {
    await tillOne();
    const key = newKey();
    const before = await seedsHeld();

    const first = await client.post('/api/progression/claim', {
      milestoneId: 'break_ground',
      idempotencyKey: key,
    });
    const replay = await client.post('/api/progression/claim', {
      milestoneId: 'break_ground',
      idempotencyKey: key,
    });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    const reward = getMilestone('break_ground')!.reward.items[0]!.quantity;
    expect(await seedsHeld()).toBe(before + reward);
  });

  it('refuses a second claim under a DIFFERENT key, and pays once', async () => {
    await tillOne();
    const before = await seedsHeld();

    await client.post('/api/progression/claim', {
      milestoneId: 'break_ground',
      idempotencyKey: newKey(),
    });
    const second = await client.post('/api/progression/claim', {
      milestoneId: 'break_ground',
      idempotencyKey: newKey(),
    });

    expect(second.code).toBe(ErrorCode.MILESTONE_ALREADY_CLAIMED);
    expect(await seedsHeld()).toBe(before + getMilestone('break_ground')!.reward.items[0]!.quantity);
  });

  it('pays once when two distinct claims arrive together', async () => {
    await tillOne();
    const before = await seedsHeld();

    const results = await Promise.all([
      client.post('/api/progression/claim', {
        milestoneId: 'break_ground',
        idempotencyKey: newKey(),
      }),
      client.post('/api/progression/claim', {
        milestoneId: 'break_ground',
        idempotencyKey: newKey(),
      }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await seedsHeld()).toBe(before + getMilestone('break_ground')!.reward.items[0]!.quantity);

    const claims = await db
      .select()
      .from(schema.milestoneClaims)
      .where(eq(schema.milestoneClaims.playerId, playerId));
    expect(claims).toHaveLength(1);
  });

  /**
   * There is no player id in the payload, so "another player's claim" is not
   * expressible — but the consequence is worth asserting rather than argued:
   * one account's claim must leave the other's board untouched.
   */
  it('cannot claim on behalf of another player', async () => {
    await tillOne();
    await client.post('/api/progression/claim', {
      milestoneId: 'break_ground',
      idempotencyKey: newKey(),
    });

    const other = await createTestClient();
    const otherId = (await registerTestUser(other)).id;

    const board = await other.get('/api/progression');
    expect(
      board.body.milestones.find((m: { id: string }) => m.id === 'break_ground').claimed,
    ).toBe(false);

    const otherClaims = await db
      .select()
      .from(schema.milestoneClaims)
      .where(eq(schema.milestoneClaims.playerId, otherId));
    expect(otherClaims).toHaveLength(0);

    await other.close();
  });
});
