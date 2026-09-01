import Stripe from 'stripe';
import { env } from '../../env.js';

/**
 * The Stripe surface this module actually uses — nothing more. Narrowed
 * deliberately, not `Stripe` itself: a hand-written mock satisfying this
 * interface is what lets checkout (T-5.02) and webhook fulfilment (T-5.03)
 * be tested without a network call or a real API key, the same way `Tx` and
 * `Queryable` let the rest of the codebase test against Postgres logic
 * without mocking the ORM.
 */
export interface VipStripeClient {
  readonly checkout: {
    readonly sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
      ): Promise<Pick<Stripe.Checkout.Session, 'id' | 'url'>>;
    };
  };
  readonly webhooks: {
    /**
     * Throws on a bad signature. Pure local HMAC verification — this makes
     * no network call in the real SDK either, which is what makes it safe
     * to run against a real `Stripe` instance in tests even with no
     * `STRIPE_SECRET_KEY` configured (only `STRIPE_WEBHOOK_SECRET` matters
     * here).
     */
    constructEvent(payload: string | Buffer, signature: string, secret: string): Stripe.Event;
  };
}

let realClient: Stripe | null = null;

/**
 * Lazily constructed, and ONLY from inside a real request — never at import
 * time. `STRIPE_SECRET_KEY` is empty by default in dev and in every test
 * that never exercises this route (which is nearly all of them), and the
 * Stripe SDK throws on construction with no key. Constructing eagerly at
 * module load would crash the whole server, and the whole test suite, over
 * a feature nobody in that request was even touching.
 */
function realStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured.');
  }
  if (!realClient) {
    realClient = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return realClient;
}

/**
 * The client `app.ts` decorates onto every Fastify instance by default.
 * Every method here defers to `realStripe()` at CALL time, not at
 * construction time, so building this object is always safe — the
 * "unconfigured key" error only ever surfaces if a real checkout request or
 * webhook delivery actually arrives without one configured. Tests override
 * the decoration entirely (`buildApp({ stripe: fakeClient })`) and never
 * reach this file at all.
 */
export const defaultVipStripeClient: VipStripeClient = {
  checkout: {
    sessions: {
      create: (params) => realStripe().checkout.sessions.create(params),
    },
  },
  webhooks: {
    constructEvent: (payload, signature, secret) =>
      realStripe().webhooks.constructEvent(payload, signature, secret),
  },
};
