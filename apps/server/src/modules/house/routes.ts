import type { FastifyInstance } from 'fastify';
import {
  FURNITURE_IDS,
  FURNITURE,
  buyFurnitureSchema,
  moveFurnitureSchema,
  placeFurnitureSchema,
  removeFurnitureSchema,
} from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { db } from '../../db/client.js';
import {
  buyFurniture,
  ensureBedIfMissing,
  interiorView,
  moveFurniture,
  placeFurniture,
  removeFurniture,
} from './service.js';

/**
 * House interior routes. Parse, authorize, call, respond (CLAUDE.md §10).
 *
 * No route takes a player id — the interior a request can touch is the one the
 * session cookie resolves to, and nothing else.
 */
export async function houseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get(
    '/',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      /*
       * Before the view, not after: a bedless room rendered even once is a
       * player who walks up to nothing and cannot recover energy. Short-circuits
       * on one indexed query for everybody who already has one, which is every
       * account registered since `STARTING_FURNITURE` landed.
       */
      await ensureBedIfMissing(player.id, Date.now());
      return interiorView(db, player);
    },
  );

  /**
   * The catalogue, straight from config. Served rather than left to the
   * client's own copy so there is one authority on what a piece costs (§4.4).
   */
  app.get('/catalogue', async () => ({
    furniture: FURNITURE_IDS.map((id) => {
      const def = FURNITURE[id]!;
      return {
        id: def.id,
        name: def.name,
        price: def.price,
        footprint: def.footprint,
        vipOnly: def.vipOnly,
        tradeable: def.tradeable,
      };
    }),
  }));

  app.post(
    '/buy',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = buyFurnitureSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'house.buy', now, (tx) =>
        buyFurniture(tx, player, input.furnitureId, now),
      );
    },
  );

  app.post(
    '/place',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = placeFurnitureSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'house.place', now, (tx) =>
        placeFurniture(tx, player, input.furnitureId, input.x, input.y, now),
      );
    },
  );

  app.post(
    '/move',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = moveFurnitureSchema.parse(request.body);

      return runIdempotent(player.id, input.idempotencyKey, 'house.move', Date.now(), (tx) =>
        moveFurniture(tx, player, input.placementId, input.x, input.y),
      );
    },
  );

  app.post(
    '/remove',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = removeFurnitureSchema.parse(request.body);

      return runIdempotent(player.id, input.idempotencyKey, 'house.remove', Date.now(), (tx) =>
        removeFurniture(tx, player, input.placementId),
      );
    },
  );
}
