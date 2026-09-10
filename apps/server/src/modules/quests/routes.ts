import type { FastifyInstance } from 'fastify';
import { acceptQuestSchema, turnInQuestSchema } from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { db } from '../../db/client.js';
import { acceptQuest, questsFor, turnInQuest } from './service.js';
import { boardFor } from './board.js';

/**
 * Quests. Parse, authorize, call, respond (CLAUDE.md §10).
 *
 * **No payload carries a player id.** The only identity available is the
 * session cookie's, which is what makes "accept somebody else's quest" and
 * "turn in somebody else's quest" unexpressible rather than merely refused —
 * the same property `progressionRoutes` relies on.
 */
export async function questRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * What is on offer and what is in hand.
   *
   * A pure read, derived from the farm's level and the player's own rows (§4.2).
   * 120/min to match the farm poll and the goal board it sits beside — a limit
   * lower than the thing it accompanies would throttle the pair.
   */
  app.get('/', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    const player = currentPlayer(request);
    return boardFor(db, player, Date.now());
  });

  /**
   * Takes a quest on.
   *
   * Mints nothing, so the limit is about automation rather than value: there
   * are six quests, and no human accepts them faster than this.
   */
  app.post(
    '/accept',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = acceptQuestSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'quests.accept', now, (tx) =>
        acceptQuest(tx, player, input.questId, now),
      );
    },
  );

  /**
   * Hands one in: consumes the goods and pays, in one transaction.
   *
   * Idempotent (§4.5) **and** guarded by a conditional update, for the reason
   * `claimMilestone` needs both. `runIdempotent` makes a retried request return
   * the first response rather than a confusing `QUEST_ALREADY_COMPLETED`; the
   * `WHERE completed_at IS NULL` makes two *distinct* requests racing each other
   * impossible to double-pay. A flaky connection is the first case; two open
   * tabs are the second.
   *
   * 30/min — this endpoint mints value, and six one-time quests cannot
   * legitimately be handed in faster.
   */
  app.post(
    '/turn-in',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = turnInQuestSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'quests.turn-in', now, (tx) =>
        turnInQuest(tx, player, input.questId, now),
      );
    },
  );
}

export { questsFor };
