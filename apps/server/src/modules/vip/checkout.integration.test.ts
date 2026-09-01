import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';
import type { VipStripeClient } from './stripe.js';

/**
 * T-5.02: the checkout session, tested against a hand-written Stripe mock —
 * never the real SDK, never a network call, never a real API key. `app.ts`'s
 * `stripe` decoration exists specifically so this route can be exercised
 * exactly like every other one, through `app.inject`, auth and validation and
 * all (CLAUDE.md §6's rationale for `TestClient` applies here too).
 */

let client: TestClient;
let playerId: string;
let calls: Stripe.Checkout.SessionCreateParams[];

function mockStripe(): VipStripeClient {
  calls = [];
  return {
    checkout: {
      sessions: {
        create: async (params) => {
          calls.push(params);
          return { id: 'cs_test_123', url: 'https://checkout.stripe.com/test-session' };
        },
      },
    },
    // Not exercised by this file — webhook.integration.test.ts covers it.
    webhooks: {
      constructEvent: () => {
        throw new Error('not used in checkout tests');
      },
    },
  };
}

async function makeVip(until: number | null): Promise<void> {
  await db.update(schema.players).set({ vipUntil: until }).where(eq(schema.players.id, playerId));
}

function checkout(c: TestClient, extra: Record<string, unknown> = {}) {
  return c.post('/api/vip/checkout', { idempotencyKey: newKey(), ...extra });
}

beforeEach(async () => {
  await resetDb();
  client = await createTestClient({ stripe: mockStripe() });
  playerId = (await registerTestUser(client)).id;
});

afterAll(closeDb);

describe('POST /api/vip/checkout', () => {
  it('creates a one-time Checkout session, not a subscription', async () => {
    const res = await checkout(client);

    expect(res.status, res.code).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/test-session');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.mode).toBe('payment');
  });

  it('puts the player id in the session metadata', async () => {
    await checkout(client);
    expect(calls[0]!.metadata).toEqual({ playerId });
  });

  it('ignores any price, amount, or duration the client sends — server config wins', async () => {
    await checkout(client, { price: 'price_evil_free_forever', amount: 0, durationDays: 99999 });

    expect(calls).toHaveLength(1);
    const lineItems = calls[0]!.line_items as { price: string; quantity: number }[];
    expect(lineItems).toEqual([{ price: 'price_test_vip_placeholder', quantity: 1 }]);
  });

  it('refuses to start checkout while VIP is already active', async () => {
    await makeVip(Date.now() + 1000 * 60 * 60);

    const res = await checkout(client);

    expect(res.status).toBe(409);
    expect(res.code).toBe('VIP_ALREADY_ACTIVE');
    // Never even reaches Stripe — no session, no charge attempt, nothing to
    // refund later for a purchase that should not have been offered.
    expect(calls).toHaveLength(0);
  });

  it('lets a flagged account with a future vipUntil still start checkout', async () => {
    // A flagged account is not VIP (T-5.01's isVipActive), so it must be
    // allowed to buy again — refusing here for the wrong reason would trap
    // a flagged player who genuinely wants to pay again.
    await db
      .update(schema.players)
      .set({ vipUntil: Date.now() + 1000 * 60 * 60, flaggedAt: Date.now() - 1 })
      .where(eq(schema.players.id, playerId));

    const res = await checkout(client);
    expect(res.status, res.code).toBe(200);
  });

  it('is idempotent: a replayed key returns the same session without calling Stripe twice', async () => {
    const key = newKey();
    const first = await checkout(client, { idempotencyKey: key });
    const second = await checkout(client, { idempotencyKey: key });

    expect(first.body.url).toBe(second.body.url);
    expect(calls).toHaveLength(1);
  });

  it('never lets the Stripe secret key appear anywhere in a response', async () => {
    const res = await checkout(client);
    expect(JSON.stringify(res.body)).not.toContain('sk_test_must_never_appear_in_a_response');
  });

  it('requires a session', async () => {
    const anon = await createTestClient({ stripe: mockStripe() });
    const res = await anon.post('/api/vip/checkout', { idempotencyKey: newKey() });
    expect(res.status).toBe(401);
    await anon.close();
  });
});
