import type { FastifyInstance } from 'fastify';
import {
  DECOR,
  DECOR_IDS,
  buyDecorSchema,
  moveDecorSchema,
  placeDecorSchema,
  removeDecorSchema,
} from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { db } from '../../db/client.js';
import { buyDecor, decorView, moveDecor, placeDecor, removeDecor } from './service.js';

/**
 * Farm decoration routes. Parse, authorize, call, respond (CLAUDE.md §10).
 *
 * No route takes a player id — the farm a request can decorate is the one the
 * session cookie resolves to, and nothing else. Positions ARE in the payload
 * here, unlike everywhere else in the game: a placement is a coordinate the
 * player chose, not a claim about where their character is standing, and the
 * server validates it against its own copy of the map (§4.1 holds).
 */
export async function decorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get(
    '/',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      return decorView(db, player);
    },
  );

  /**
   * The catalogue, straight from config — served rather than left to the
   * client's own copy so there is one authority on what a piece costs (§4.4).
   *
   * `look` is included because the client has to crop the right window out of a
   * kit to draw it; `solid` because the placement ghost needs to know which
   * rules apply before it sends anything.
   */
  app.get('/catalogue', async () => ({
    decor: DECOR_IDS.map((id) => {
      const def = DECOR[id]!;
      return {
        id: def.id,
        name: def.name,
        sheet: def.sheet,
        look: def.look,
        footprint: def.footprint,
        price: def.price,
        solid: def.solid,
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
      const input = buyDecorSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'decor.buy', now, (tx) =>
        buyDecor(tx, player, input.decorId, now),
      );
    },
  );

  app.post(
    '/place',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = placeDecorSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'decor.place', now, (tx) =>
        placeDecor(tx, player, input.decorId, input.x, input.y, now),
      );
    },
  );

  /**
   * Shipped, and deliberately not called by the client: the placement UI does
   * remove-then-place, which is one fewer interaction to teach. Recorded as a
   * choice rather than an oversight (T-15.20).
   */
  app.post(
    '/move',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = moveDecorSchema.parse(request.body);

      return runIdempotent(player.id, input.idempotencyKey, 'decor.move', Date.now(), (tx) =>
        moveDecor(tx, player, input.placementId, input.x, input.y),
      );
    },
  );

  app.post(
    '/remove',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = removeDecorSchema.parse(request.body);

      return runIdempotent(player.id, input.idempotencyKey, 'decor.remove', Date.now(), (tx) =>
        removeDecor(tx, player, input.placementId),
      );
    },
  );
}
