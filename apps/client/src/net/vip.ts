import { api, idempotencyKey } from './api.js';

/**
 * The VIP purchase path (CLAUDE.md §7, T-18.20 / BUG-18).
 *
 * `POST /api/vip/checkout` has existed and been correct since T-5.02 — one-time
 * `mode: 'payment'`, webhook-only fulfilment, rate limited, idempotency-keyed —
 * and **had no client caller anywhere**. There was no `net/vip.ts`, no button
 * and no mention of Stripe in `apps/client/src`. The product's only revenue
 * mechanism was unreachable from the product.
 *
 * This module is the whole client half, and it is deliberately tiny. Everything
 * that matters — the price, whether this account may buy, which account gets
 * the grant — is decided server-side from data the client never supplies. The
 * client's entire job is "ask, then go where you are sent".
 */

export interface CheckoutStart {
  /** A Stripe-hosted URL. The client navigates to it and nothing else. */
  readonly url: string;
}

/**
 * Asks the server to open a Stripe Checkout session.
 *
 * **Returns a URL and never a grant.** Nothing this function can be given makes
 * an account VIP: fulfilment happens only in the signature-verified
 * `checkout.session.completed` webhook (§7), after Stripe confirms the money
 * actually moved. That separation is the point, and it is why this file cannot
 * be made to do anything dangerous by changing what it is passed.
 */
export function startVipCheckout(): Promise<CheckoutStart> {
  return api.post<CheckoutStart>('/vip/checkout', { idempotencyKey: idempotencyKey() });
}

/** What Stripe sent the player back with, off the success/cancel URLs. */
export type VipReturn = 'success' | 'cancelled' | null;

/**
 * Reads the `?vip=` the server's `success_url` / `cancel_url` bring back.
 *
 * **`success` here means "Stripe took the money", NOT "this account is VIP".**
 * The two are different events with a webhook between them, and the webhook can
 * land after the redirect. Granting anything from this value would be exactly
 * the spoofable path §7 forbids — anyone can type `?vip=success` into the bar.
 * All the caller may do with it is say something reassuring while the poll
 * catches up.
 *
 * Pure, over a query string rather than `location`, so the parsing is testable
 * in node and the one risky misreading is pinned by a test.
 */
export function vipReturnFrom(search: string): VipReturn {
  const value = new URLSearchParams(search).get('vip');
  return value === 'success' || value === 'cancelled' ? value : null;
}
