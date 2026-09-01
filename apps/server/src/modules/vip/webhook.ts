import { and, eq, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import { VIP_DURATION_MS } from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Tx } from '../../db/tx.js';

/**
 * Webhook fulfilment (T-5.03, T-5.04, CLAUDE.md §7).
 *
 * This is the ONLY place VIP is ever granted, and the ONLY place a refund or
 * chargeback ever flags an account. The success-URL redirect (`service.ts`'s
 * `success_url`) is a page the browser lands on; nothing about landing there
 * touches this database. Everything here runs from an event whose signature
 * the route has already verified (`webhookRoutes.ts`) — never from anything
 * a browser could forge.
 */
export type StripeEventOutcome =
  | { readonly kind: 'vip_granted'; readonly playerId: string }
  | { readonly kind: 'account_flagged'; readonly playerId: string; readonly reason: 'refund' | 'dispute' }
  | { readonly kind: 'noop' };

const NOOP: StripeEventOutcome = { kind: 'noop' };

/**
 * Handles one verified Stripe event.
 *
 * Only `checkout.session.completed`, `charge.refunded`, and
 * `charge.dispute.created` do anything. Every other event type is
 * acknowledged as a no-op rather than rejected, so Stripe never retries an
 * event this handler was never going to act on anyway — rejecting an
 * unhandled type would just be a slow, noisy way of doing nothing.
 */
export async function handleStripeEvent(tx: Tx, event: Stripe.Event, now: number): Promise<StripeEventOutcome> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(tx, event.data.object as Stripe.Checkout.Session, now);
    case 'charge.refunded':
      return handleFlagging(tx, event.data.object as Stripe.Charge, 'refund', now);
    case 'charge.dispute.created':
      return handleFlagging(tx, event.data.object as Stripe.Dispute, 'dispute', now);
    default:
      return NOOP;
  }
}

async function handleCheckoutCompleted(
  tx: Tx,
  session: Stripe.Checkout.Session,
  now: number,
): Promise<StripeEventOutcome> {
  // `completed` can still mean an async payment method has not settled yet.
  // Only an actually-paid session grants anything.
  if (session.payment_status !== 'paid') return NOOP;

  const playerId = session.metadata?.['playerId'];
  if (!playerId) {
    // Not a signature problem — a well-formed, correctly-signed event that
    // simply was not created by our own `createCheckoutSession` (service.ts
    // always sets this). Nothing safe to grant to; acknowledge and move on
    // rather than leave Stripe retrying an event that can never succeed.
    console.error('[tillhaven] checkout.session.completed with no playerId in metadata', {
      sessionId: session.id,
    });
    return NOOP;
  }

  /*
   * Idempotent on `stripeSessionId` via the unique index already on
   * `purchases` — `onConflictDoNothing`, not insert-then-catch. A caught
   * unique-violation error would leave this transaction aborted in Postgres
   * (any error inside a transaction poisons it until rollback), which would
   * make the players UPDATE below fail too. Silently inserting zero rows
   * keeps the transaction healthy, so a duplicate delivery is a clean no-op
   * rather than a failed one.
   */
  const inserted = await tx
    .insert(schema.purchases)
    .values({
      playerId,
      stripeSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
      amount: session.amount_total ?? 0,
      currency: session.currency ?? 'usd',
      status: 'completed',
      createdAt: now,
    })
    .onConflictDoNothing({ target: schema.purchases.stripeSessionId })
    .returning({ id: schema.purchases.id });

  if (inserted.length === 0) {
    // Stripe redelivered an event already fulfilled. VIP is not extended a
    // second time for the one purchase.
    return NOOP;
  }

  await tx
    .update(schema.players)
    .set({ vipUntil: now + VIP_DURATION_MS })
    .where(eq(schema.players.id, playerId));

  return { kind: 'vip_granted', playerId };
}

/**
 * `charge.refunded` and `charge.dispute.created` (T-5.04) both resolve the
 * same way: find the purchase by payment intent, mark it refunded, flag the
 * account. Flagging alone is what revokes VIP — `isVipActive` (T-5.01)
 * already treats any flagged account as never-VIP regardless of `vipUntil`,
 * so there is no separate "clear vipUntil" step, and `flaggedAt` is the
 * same column that already blocks trading (§7) — a refunded or disputed
 * account loses both at once, which is the intended reach of flagging one
 * account, not two independent revocations that could drift apart.
 */
async function handleFlagging(
  tx: Tx,
  chargeOrDispute: Stripe.Charge | Stripe.Dispute,
  reason: 'refund' | 'dispute',
  now: number,
): Promise<StripeEventOutcome> {
  const paymentIntentId =
    typeof chargeOrDispute.payment_intent === 'string'
      ? chargeOrDispute.payment_intent
      : (chargeOrDispute.payment_intent?.id ?? null);

  if (!paymentIntentId) {
    console.error(`[tillhaven] ${reason} event with no payment_intent`, { id: chargeOrDispute.id });
    return NOOP;
  }

  /*
   * Idempotent the same way execution's ownership guards are: the UPDATE's
   * own WHERE clause is the check. `refundedAt IS NULL` means "not already
   * processed" — a redelivered event finds zero matching rows (the first
   * delivery already set it) and this returns NOOP without touching the
   * player a second time. No separate SELECT-then-branch, so there is no
   * window between reading "not yet refunded" and writing it where a second
   * concurrent delivery could slip through.
   */
  const updated = await tx
    .update(schema.purchases)
    .set({ refundedAt: now, status: 'refunded' })
    .where(and(eq(schema.purchases.stripePaymentIntentId, paymentIntentId), isNull(schema.purchases.refundedAt)))
    .returning({ playerId: schema.purchases.playerId });

  if (updated.length === 0) {
    // No matching purchase (an event for something this server never sold),
    // or already flagged from an earlier delivery of this same event —
    // either way, nothing new to do.
    return NOOP;
  }

  const playerId = updated[0]!.playerId;
  await tx.update(schema.players).set({ flaggedAt: now }).where(eq(schema.players.id, playerId));

  return { kind: 'account_flagged', playerId, reason };
}
