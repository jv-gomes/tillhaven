import type { FastifyInstance } from 'fastify';
import { vipCheckoutSchema } from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { createCheckoutSession } from './service.js';

/**
 * VIP routes (CLAUDE.md §7). Parse, authorize, call, respond.
 */
export async function vipRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * Starts a one-time Stripe Checkout session. Idempotency-keyed like every
   * other state-changing endpoint (§4.5) — not because this writes to our
   * own database (it does not; fulfilment is T-5.03's webhook), but because
   * a flaky-connection retry should not hand the player two separate
   * checkout links for the price of one click.
   */
  app.post(
    '/checkout',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = vipCheckoutSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'vip.checkout', now, () =>
        createCheckoutSession(app.stripe, player, now),
      );
    },
  );
}
