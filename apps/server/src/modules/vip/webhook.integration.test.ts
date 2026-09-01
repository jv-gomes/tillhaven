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
 * T-5.03: fulfilment, driven through the REAL `POST /api/vip/webhook` route
 * — raw body, signature header, all of it — never by calling
 * `handleStripeEvent` directly. `webhookRoutes.ts` exists precisely because
 * routing and body-parsing are where this feature is easiest to get subtly
 * wrong; skipping straight to the service function would test everything
 * except the part most likely to break.
 *
 * Signatures are computed with the REAL Stripe SDK's `generateTestHeaderString`
 * — pure local HMAC, no network call, no real Stripe account — against
 * `STRIPE_WEBHOOK_SECRET` as configured for this test run (vitest.config.ts).
 * `app.stripe.webhooks.constructEvent` is likewise the real SDK method,
 * wired through the mock client; only `checkout.sessions.create` (which
 * WOULD need a network call) is ever a hand-written stub.
 */

const crypto = new Stripe('sk_test_dummy_never_used_for_a_network_call');

let app: FastifyInstance;
let authed: TestClient;
let playerId: string;

function mockStripe(): VipStripeClient {
  return {
    checkout: {
      sessions: {
        create: async () => {
          throw new Error('not used by webhook tests');
        },
      },
    },
    webhooks: {
      constructEvent: (payload, signature, secret) => crypto.webhooks.constructEvent(payload, signature, secret),
    },
  };
}

interface SignedPayload {
  readonly body: string;
  readonly signature: string;
}

function sign(eventLike: Record<string, unknown>): SignedPayload {
  const body = JSON.stringify(eventLike);
  const signature = crypto.webhooks.generateTestHeaderString({ payload: body, secret: env.STRIPE_WEBHOOK_SECRET });
  return { body, signature };
}

let eventSeq = 0;

/** A `checkout.session.completed` event shaped exactly like Stripe's real payload. */
function checkoutCompletedEvent(overrides: {
  sessionId: string;
  playerId?: string | null;
  paymentStatus?: string;
  amountTotal?: number;
  currency?: string;
  paymentIntent?: string | null;
}): Record<string, unknown> {
  eventSeq += 1;
  return {
    id: `evt_test_${eventSeq}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: overrides.sessionId,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: overrides.paymentStatus ?? 'paid',
        amount_total: overrides.amountTotal ?? 1999,
        currency: overrides.currency ?? 'usd',
        payment_intent: overrides.paymentIntent === undefined ? 'pi_test_123' : overrides.paymentIntent,
        metadata: overrides.playerId === null ? {} : { playerId: overrides.playerId ?? playerId },
      },
    },
  };
}

async function postWebhook(signed: SignedPayload) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/vip/webhook',
    payload: signed.body,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signed.signature,
    },
  });
  const parsed: unknown = res.body ? JSON.parse(res.body) : null;
  const code =
    typeof parsed === 'object' && parsed !== null && 'error' in parsed
      ? String((parsed as { error: { code: string } }).error.code)
      : undefined;
  return { status: res.statusCode, body: parsed, code };
}

async function vipUntil(): Promise<number | null> {
  const [row] = await db.select().from(schema.players).where(eq(schema.players.id, playerId));
  return row!.vipUntil;
}

async function purchaseRows() {
  return db.select().from(schema.purchases).where(eq(schema.purchases.playerId, playerId));
}

beforeEach(async () => {
  await resetDb();
  app = await buildApp({ stripe: mockStripe() });
  await app.ready();
  authed = await createTestClient({ stripe: mockStripe() });
  playerId = (await registerTestUser(authed)).id;
});

afterAll(closeDb);

describe('POST /api/vip/webhook', () => {
  it('grants 30 days of VIP on a validly-signed checkout.session.completed', async () => {
    const before = Date.now();
    const signed = sign(checkoutCompletedEvent({ sessionId: 'cs_grant_1' }));

    const res = await postWebhook(signed);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const until = await vipUntil();
    expect(until).not.toBeNull();
    expect(until!).toBeGreaterThan(before);
    expect(until! - before).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  });

  it('writes a purchases row with amount, currency and status', async () => {
    const signed = sign(
      checkoutCompletedEvent({ sessionId: 'cs_grant_2', amountTotal: 2499, currency: 'eur' }),
    );
    await postWebhook(signed);

    const rows = await purchaseRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stripeSessionId).toBe('cs_grant_2');
    expect(rows[0]!.amount).toBe(2499);
    expect(rows[0]!.currency).toBe('eur');
    expect(rows[0]!.status).toBe('completed');
  });

  it('records a security_log vip_granted entry', async () => {
    const signed = sign(checkoutCompletedEvent({ sessionId: 'cs_grant_3' }));
    await postWebhook(signed);

    const rows = await db
      .select()
      .from(schema.securityLog)
      .where(eq(schema.securityLog.event, 'vip_granted'));
    expect(rows.some((r) => r.playerId === playerId)).toBe(true);
  });

  it('refuses an invalid signature and grants nothing', async () => {
    const signed = sign(checkoutCompletedEvent({ sessionId: 'cs_bad_sig' }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/vip/webhook',
      payload: signed.body,
      headers: {
        'content-type': 'application/json',
        // Correctly-formed but for the wrong payload — same class of failure
        // as a forged one, and must be rejected identically.
        'stripe-signature': crypto.webhooks.generateTestHeaderString({
          payload: JSON.stringify({ not: 'the same body' }),
          secret: env.STRIPE_WEBHOOK_SECRET,
        }),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await vipUntil()).toBeNull();
    expect(await purchaseRows()).toHaveLength(0);
  });

  it('refuses a request with no signature header at all', async () => {
    const signed = sign(checkoutCompletedEvent({ sessionId: 'cs_no_sig' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/vip/webhook',
      payload: signed.body,
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('does not extend VIP twice on a redelivered event for the same session', async () => {
    const signed = sign(checkoutCompletedEvent({ sessionId: 'cs_redelivered' }));

    const first = await postWebhook(signed);
    const untilAfterFirst = await vipUntil();
    expect(first.status).toBe(200);

    // Stripe genuinely does this: the exact same body and signature, twice.
    const second = await postWebhook(signed);
    const untilAfterSecond = await vipUntil();

    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(untilAfterSecond).toBe(untilAfterFirst);
    expect(await purchaseRows()).toHaveLength(1);
  });

  it('does not grant VIP for an unpaid session', async () => {
    const signed = sign(checkoutCompletedEvent({ sessionId: 'cs_unpaid', paymentStatus: 'unpaid' }));
    const res = await postWebhook(signed);

    expect(res.status).toBe(200); // acknowledged — Stripe should not retry
    expect(await vipUntil()).toBeNull();
    expect(await purchaseRows()).toHaveLength(0);
  });

  it('does not grant VIP for a session with no playerId in metadata', async () => {
    const signed = sign(checkoutCompletedEvent({ sessionId: 'cs_no_metadata', playerId: null }));
    const res = await postWebhook(signed);

    expect(res.status).toBe(200);
    expect(await purchaseRows()).toHaveLength(0);
  });

  it('acknowledges and ignores an event type it does not act on', async () => {
    const body = JSON.stringify({
      id: 'evt_other_type',
      object: 'event',
      type: 'customer.created',
      data: { object: { id: 'cus_123' } },
    });
    const signature = crypto.webhooks.generateTestHeaderString({ payload: body, secret: env.STRIPE_WEBHOOK_SECRET });

    const res = await app.inject({
      method: 'POST',
      url: '/api/vip/webhook',
      payload: body,
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    });

    expect(res.statusCode).toBe(200);
  });

  it('requires no session cookie at all — Stripe is not a signed-in player', async () => {
    const signed = sign(checkoutCompletedEvent({ sessionId: 'cs_no_cookie' }));
    // `app.inject` here carries no cookie by construction; this is really
    // asserting the route is reachable without one, not just that it works.
    const res = await postWebhook(signed);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('grants nothing from the checkout success-URL redirect — there is no such route', async () => {
    // The success_url the player's browser lands on is a static client page
    // (see service.ts) — nothing server-side ever reads a query string to
    // grant VIP. Confirmed by source scan: `vipUntil` is set in exactly one
    // place in the whole server.
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

    const grantSites: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/\.set\(\s*\{[^}]*vipUntil/s.test(source) || /vipUntil:\s*now/.test(source)) {
        grantSites.push(file);
      }
    }

    expect(grantSites).toHaveLength(1);
    expect(grantSites[0]).toMatch(/vip[/\\]webhook\.ts$/);
  });
});
