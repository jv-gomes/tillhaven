import type { FastifyInstance } from 'fastify';
import { setAppearanceSchema } from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { setAppearance } from './service.js';

/**
 * Player-level routes that are not farm/inventory/trade specific.
 *
 * Route handlers parse, authorize, call a service, and respond — no business
 * logic (CLAUDE.md §10).
 */
export async function playerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * Set (or replace) the caller's cosmetic character appearance (T-8.01).
   * Runs once from the first-login character creator (T-8.02), but nothing
   * here refuses a later call — re-customizing is not this task's concern to
   * block, and blocking it would just be a second, undocumented rule.
   */
  app.put(
    '/appearance',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = setAppearanceSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(
        player.id,
        input.idempotencyKey,
        'player.setAppearance',
        now,
        (tx) => setAppearance(tx, player, input.appearance, now),
      );
    },
  );
}
