import type { FastifyInstance } from 'fastify';
import { claimMilestoneSchema } from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { db } from '../../db/client.js';
import { boardFor, claimMilestone } from './service.js';

/**
 * The goal board. Parse, authorize, call, respond (CLAUDE.md §10).
 *
 * **Neither payload carries a player id.** The only identity available is the
 * session cookie's, which is what makes "another player's board" and "another
 * player's claim" unexpressible rather than merely refused.
 */
export async function progressionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * The board, derived on read.
   *
   * A pure read — unlike shipping's `GET`, nothing settles on the way past.
   * Every "earned" flag is recomputed from counters that already exist
   * (§4.2); the only stored state is which milestones have been claimed.
   *
   * 120/min, matching the farm poll: the board is refreshed alongside it and
   * a limit lower than the thing it accompanies would throttle the pair.
   */
  app.get(
    '/',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      return { milestones: await boardFor(db, player) };
    },
  );

  /**
   * Claims one earned milestone.
   *
   * Idempotent (§4.5) **and** guarded by a unique index. The two cover
   * different failures and neither replaces the other: `runIdempotent` makes a
   * retried request return the first response instead of a confusing
   * `MILESTONE_ALREADY_CLAIMED`, while the index makes two *distinct* requests
   * racing each other impossible to double-pay. A flaky connection is the
   * first case; two open tabs are the second.
   *
   * 30/min — a board of ten one-time goals cannot legitimately be claimed
   * faster than that, and the endpoint mints value.
   */
  app.post(
    '/claim',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = claimMilestoneSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'progression.claim', now, (tx) =>
        claimMilestone(tx, player, input.milestoneId, now),
      );
    },
  );
}
