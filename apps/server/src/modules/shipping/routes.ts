import type { FastifyInstance } from 'fastify';
import { shippingDepositSchema } from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { db } from '../../db/client.js';
import { deposit, settleShipments, shippingView } from './service.js';

/**
 * Shipping box routes. Parse, authorize, call, respond (CLAUDE.md §10).
 *
 * There is no player id in either payload: the only identity these can use is
 * the session cookie's, which is what stops one player emptying another's box.
 */
export async function shippingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * The box, settling whatever has come due on the way past.
   *
   * A read that WRITES, deliberately: settlement has no job behind it (§4.2),
   * so looking is what makes payment happen. The transaction covers the credit
   * and the listing together, so the numbers the player sees are the numbers
   * that were just written.
   */
  app.get(
    '/',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const now = Date.now();

      return db.transaction(async (tx) => {
        const justPaid = await settleShipments(tx, player, now);
        return shippingView(tx, player, now, justPaid);
      });
    },
  );

  /** Drops goods in. Idempotent: a resent deposit must not ship twice. */
  app.post(
    '/deposit',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = shippingDepositSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'shipping.deposit', now, (tx) =>
        deposit(tx, player, input.itemId, input.quantity, now),
      );
    },
  );
}
