import type { FastifyInstance } from 'fastify';
import { buyAnimalSchema, collectAnimalSchema, feedAnimalSchema } from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { buyAnimal, collect, feed } from './service.js';

/**
 * Animal routes. Parse, authorize, call, respond (CLAUDE.md §10).
 *
 * Every one is idempotent: a double-tapped "collect" on a flaky connection must
 * hand over one lot of eggs, not two (§4.5). Ownership is checked inside the
 * service against the authenticated player id, never against anything in the
 * body.
 */
export async function animalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post(
    '/buy',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = buyAnimalSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'animals.buy', now, (tx) =>
        buyAnimal(tx, player, input.kind, input.variant, now),
      );
    },
  );

  app.post(
    '/collect',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = collectAnimalSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'animals.collect', now, (tx) =>
        collect(tx, player, input.animalId, now),
      );
    },
  );

  app.post(
    '/feed',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = feedAnimalSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'animals.feed', now, (tx) =>
        feed(tx, player, input.animalId, now),
      );
    },
  );
}
