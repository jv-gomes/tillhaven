import type { FastifyInstance } from 'fastify';
import { castSchema, reelSchema } from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { castLine, reelIn } from './service.js';

/**
 * Fishing. Parse, authorize, call, respond (CLAUDE.md §10).
 *
 * **The payload carries no position**, and that is deliberate rather than an
 * omission: §5.1 makes standing at water a client-side UX gate, and a server
 * that checked it would be the first place in this game to treat the character's
 * coordinates as authority.
 */
export async function fishingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * Casts.
   *
   * **30/min, and the rate limit is the second line of defence, not the
   * first.** Energy is the real cap — three per cast against a bar of forty —
   * so a bot casting flat out runs out of energy long before it runs out of
   * requests, which is what "gains nothing over a person" requires. The limit is
   * here to stop the requests, not to stop the fishing.
   */
  app.post(
    '/cast',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = castSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'fishing.cast', now, (tx) =>
        castLine(tx, player, now),
      );
    },
  );

  /**
   * Reels in.
   *
   * **The cast id and nothing else.** `reelSchema` is `.strict()`, so a client
   * that sends its own reaction time is refused rather than quietly ignored —
   * the honest answer to "here is how fast I was" is that the server does not
   * accept the field, not a success that leaves the sender thinking it counted.
   *
   * Same 30/min as casting. A reel mints an item, but it cannot mint one without
   * a cast, and casting is already capped by energy.
   */
  app.post(
    '/reel',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = reelSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'fishing.reel', now, (tx) =>
        reelIn(tx, player, input.castId, now),
      );
    },
  );
}
