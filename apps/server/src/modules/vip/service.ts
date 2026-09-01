import { ErrorCode, GameError, isVipActive } from '@tillhaven/shared';
import { env } from '../../env.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import type { VipStripeClient } from './stripe.js';

/**
 * VIP checkout (CLAUDE.md §7, T-5.02).
 *
 * ONE-TIME purchase, `mode: 'payment'` — never Stripe Billing, never a
 * recurring Price, never a subscription. The client asks to start checkout
 * and gets back a Stripe-hosted URL; every other decision (price, duration,
 * whether this account is even eligible to buy) is made here, server-side,
 * from data the client never supplies.
 *
 * Fulfilment — actually granting VIP — never happens here. It happens
 * exclusively in the `checkout.session.completed` webhook (T-5.03), after
 * Stripe confirms the payment actually went through. This function only
 * ever produces a URL to send the player to; it cannot itself grant anything.
 */
export async function createCheckoutSession(
  stripe: VipStripeClient,
  player: AuthedPlayer,
  now: number,
): Promise<{ url: string }> {
  // Re-derived from the player record, not trusted from anywhere the client
  // could influence — the same `isVipActive` every other VIP check uses
  // (T-5.01), so this can never disagree with what benefits are actually
  // applied elsewhere.
  if (isVipActive(player, now)) {
    throw new GameError(ErrorCode.VIP_ALREADY_ACTIVE, 'You already have VIP.');
  }

  if (!env.STRIPE_VIP_PRICE_ID) {
    // A deployment misconfiguration, not a player mistake — fail with a
    // clear cause here rather than let a cryptic Stripe API error surface.
    throw new GameError(ErrorCode.INTERNAL, 'VIP purchases are not available right now.');
  }

  // The first configured origin is the one the client is actually served
  // from (dev and prod both run a single origin — see app.ts's CORS setup).
  const origin = env.CORS_ORIGINS[0] ?? 'http://localhost:5173';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: env.STRIPE_VIP_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/play?vip=success`,
    cancel_url: `${origin}/play?vip=cancelled`,
    // Read back by the webhook (T-5.03) to know which account to grant VIP
    // to. Never trust a browser redirect for this — only the webhook, after
    // Stripe's signature verifies the payload actually came from Stripe.
    metadata: { playerId: player.id },
  });

  if (!session.url) {
    throw new GameError(ErrorCode.INTERNAL, 'Could not start checkout.');
  }

  return { url: session.url };
}
