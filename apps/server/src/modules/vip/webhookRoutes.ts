import type { FastifyInstance } from 'fastify';
import { ErrorCode, GameError } from '@tillhaven/shared';
import { env } from '../../env.js';
import { db } from '../../db/client.js';
import { logSecurityEvent } from '../../lib/securityLog.js';
import { handleStripeEvent } from './webhook.js';

/**
 * The Stripe webhook (T-5.03, T-5.04, CLAUDE.md §7). Deliberately its own
 * plugin, separate from `vipRoutes` — two things about it are unlike every
 * other route in the game:
 *
 * 1. It is NOT behind `requireAuth`. Stripe calls this directly; there is no
 *    session cookie to check, and authenticity comes entirely from the
 *    signature, not from who is signed in.
 * 2. It needs the RAW request body. Signature verification hashes the exact
 *    bytes Stripe sent — a body Fastify has already JSON-parsed and would
 *    re-stringify differently (key order, whitespace) fails verification
 *    for a perfectly legitimate event. The content-type parser override
 *    below is registered inside this plugin's own scope, so it affects only
 *    this route — every other endpoint in the app keeps normal JSON parsing.
 */
export async function vipWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post(
    '/webhook',
    { config: { rateLimit: { max: 100, timeWindow: '1 minute' } } },
    async (request) => {
      const signature = request.headers['stripe-signature'];
      if (typeof signature !== 'string') {
        throw new GameError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'Missing signature.');
      }

      let event;
      try {
        event = app.stripe.webhooks.constructEvent(
          request.body as Buffer,
          signature,
          env.STRIPE_WEBHOOK_SECRET,
        );
      } catch {
        // Wrong secret, tampered payload, or a signature for a different
        // payload entirely — all indistinguishable from here, and all mean
        // the same thing: do not trust this body. Nothing is granted.
        throw new GameError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, 'Invalid signature.');
      }

      const now = Date.now();
      const outcome = await db.transaction((tx) => handleStripeEvent(tx, event, now));

      // Best-effort, off the critical path — same pattern as every other
      // security_log write (CLAUDE.md §8). Only logged when this delivery
      // actually changed something, not on every redelivery of an event
      // already processed (T-5.03's/T-5.04's idempotency guards are what
      // make `outcome.kind` stay `'noop'` for a duplicate).
      if (outcome.kind === 'vip_granted') {
        await logSecurityEvent({ playerId: outcome.playerId, event: 'vip_granted', detail: event.id });
      } else if (outcome.kind === 'account_flagged') {
        await logSecurityEvent({
          playerId: outcome.playerId,
          event: 'account_flagged',
          detail: `${outcome.reason}:${event.id}`,
        });
      }

      // Stripe only cares about the status code — any 2xx means "stop
      // retrying this delivery." The body is for humans reading logs.
      return { received: true };
    },
  );
}
