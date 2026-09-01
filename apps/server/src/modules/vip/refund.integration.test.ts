import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { buildApp } from '../../app.js';
import { db, schema, closeDb } from '../../db/client.js';
import { env } from '../../env.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, type TestClient } from '../../test/app.js';
import type { VipStripeClient } from './stripe.js';

/**
 * T-5.04: refunds and chargebacks, driven through the same real
 * `POST /api/vip/webhook` route as T-5.03's fulfilment tests — see that
 * file's doc comment for why routing (not the service function) is what
 * gets exercised.
 */

const crypto = new Stripe('sk_test_dummy_never_used_for_a_network_call');
const PAYMENT_INTENT = 'pi_test_refundable_1';

let app: FastifyInstance;
let authed: TestClient;
let playerId: string;

function mockStripe(): VipStripeClient {
  return {
    checkout: {
      sessions: {
        create: async () => {
          throw new Error('not used by refund tests');
        },
      },
    },
    webhooks: {
      constructEvent: (payload, signature, secret) => crypto.webhooks.constructEvent(payload, signature, secret),
    },
  };
}

function sign(eventLike: Record<string, unknown>): { body: string; signature: string } {
  const body = JSON.stringify(eventLike);
  const signature = crypto.webhooks.generateTestHeaderString({ payload: body, secret: env.STRIPE_WEBHOOK_SECRET });
  return { body, signature };
}

let eventSeq = 0;

function checkoutCompletedEvent(): Record<string, unknown> {
  eventSeq += 1;
  return {
    id: `evt_checkout_${eventSeq}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_refund_setup_${eventSeq}`,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        amount_total: 1999,
        currency: 'usd',
        payment_intent: PAYMENT_INTENT,
        metadata: { playerId },
      },
    },
  };
}

function chargeRefundedEvent(paymentIntent: string | null = PAYMENT_INTENT): Record<string, unknown> {
  eventSeq += 1;
  return {
    id: `evt_refund_${eventSeq}`,
    object: 'event',
    type: 'charge.refunded',
    data: {
      object: {
        id: `ch_test_${eventSeq}`,
        object: 'charge',
        payment_intent: paymentIntent,
        refunded: true,
      },
    },
  };
}

function disputeCreatedEvent(paymentIntent: string | null = PAYMENT_INTENT): Record<string, unknown> {
  eventSeq += 1;
  return {
    id: `evt_dispute_${eventSeq}`,
    object: 'event',
    type: 'charge.dispute.created',
    data: {
      object: {
        id: `dp_test_${eventSeq}`,
        object: 'dispute',
        payment_intent: paymentIntent,
        status: 'warning_needs_response',
      },
    },
  };
}

async function post(signed: { body: string; signature: string }) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/vip/webhook',
    payload: signed.body,
    headers: { 'content-type': 'application/json', 'stripe-signature': signed.signature },
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function playerRow() {
  const [row] = await db.select().from(schema.players).where(eq(schema.players.id, playerId));
  return row!;
}

async function purchaseRow() {
  const [row] = await db
    .select()
    .from(schema.purchases)
    .where(eq(schema.purchases.stripePaymentIntentId, PAYMENT_INTENT));
  return row;
}

/** Grants VIP via a real checkout.session.completed delivery, for tests that refund it after. */
async function grantVip(): Promise<void> {
  const res = await post(sign(checkoutCompletedEvent()));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeEach(async () => {
  await resetDb();
  app = await buildApp({ stripe: mockStripe() });
  await app.ready();
  authed = await createTestClient({ stripe: mockStripe() });
  playerId = (await registerTestUser(authed)).id;
  await grantVip();
});

afterAll(closeDb);

describe('POST /api/vip/webhook — refunds and chargebacks', () => {
  it('flags the account and revokes VIP on charge.refunded', async () => {
    expect((await playerRow()).flaggedAt).toBeNull();

    const res = await post(sign(chargeRefundedEvent()));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const player = await playerRow();
    expect(player.flaggedAt).not.toBeNull();
    // vipUntil itself is untouched — isVipActive (T-5.01) is what makes a
    // flagged account stop counting as VIP regardless of this value.
    expect(player.vipUntil).not.toBeNull();
  });

  it('flags the account and revokes VIP on charge.dispute.created', async () => {
    const res = await post(sign(disputeCreatedEvent()));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const player = await playerRow();
    expect(player.flaggedAt).not.toBeNull();
  });

  it('records refundedAt on the purchase', async () => {
    const before = Date.now();
    await post(sign(chargeRefundedEvent()));

    const purchase = await purchaseRow();
    expect(purchase).toBeDefined();
    expect(purchase!.refundedAt).not.toBeNull();
    expect(purchase!.refundedAt!).toBeGreaterThanOrEqual(before);
    expect(purchase!.status).toBe('refunded');
  });

  it('is idempotent: a redelivered charge.refunded does not re-flag or re-timestamp', async () => {
    const signed = sign(chargeRefundedEvent());
    await post(signed);
    const purchaseAfterFirst = await purchaseRow();
    const flaggedAtAfterFirst = (await playerRow()).flaggedAt;

    const second = await post(signed);
    expect(second.status, JSON.stringify(second.body)).toBe(200);

    const purchaseAfterSecond = await purchaseRow();
    expect(purchaseAfterSecond!.refundedAt).toBe(purchaseAfterFirst!.refundedAt);
    expect((await playerRow()).flaggedAt).toBe(flaggedAtAfterFirst);
  });

  it('records a security_log account_flagged entry', async () => {
    await post(sign(chargeRefundedEvent()));

    const rows = await db
      .select()
      .from(schema.securityLog)
      .where(eq(schema.securityLog.event, 'account_flagged'));
    expect(rows.some((r) => r.playerId === playerId)).toBe(true);
  });

  it('does nothing for a refund event with no matching purchase', async () => {
    const res = await post(sign(chargeRefundedEvent('pi_never_sold_anything')));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await playerRow()).flaggedAt).toBeNull();
  });

  it('flagging blocks trading, not just VIP — the same column both already read', async () => {
    await post(sign(chargeRefundedEvent()));

    // Not re-testing eligibility.ts's own logic (that belongs to T-4.01's
    // suite) — just confirming this task flags the SAME column that gate
    // already reads, so the two can never disagree.
    const player = await playerRow();
    expect(player.flaggedAt).not.toBeNull();
  });
});
