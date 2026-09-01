import type { FastifyInstance } from 'fastify';
import { AnimalBuilding, shopBuySchema, shopSellSchema, upgradeSchema } from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { shopCatalogue, buy, sell, upgradeBackpack, upgradeBuilding } from './service.js';

/** Shop routes. Parse, authorize, call, respond (CLAUDE.md §10). */
export async function shopRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * The catalogue is pure config — the same values the client already has —
   * so it is served rather than hardcoded on the client, keeping one source of
   * truth if prices ever move (§4.4).
   */
  app.get('/', async () => ({ items: shopCatalogue() }));

  app.post(
    '/buy',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = shopBuySchema.parse(request.body);

      return runIdempotent(
        player.id,
        input.idempotencyKey,
        'shop.buy',
        Date.now(),
        (tx) => buy(tx, player, input.itemId, input.quantity, Date.now()),
      );
    },
  );

  /**
   * Buys the NEXT backpack tier. The body carries no tier — see
   * `upgradeBackpack`. Rate limited like the other tier purchases: a handful of
   * clicks a minute is generous for something there are three of in the game.
   */
  app.post(
    '/backpack',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = upgradeSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'shop.backpack', now, (tx) =>
        upgradeBackpack(tx, player, now),
      );
    },
  );

  /**
   * Buys the NEXT coop or barn tier (T-12.02).
   *
   * Two routes over one service rather than one route taking a `building`
   * field: the building is part of *what is being bought*, so it belongs in
   * the path where it cannot be a validation case at all — same reasoning as
   * the missing target tier. Rate limited like the other tier purchases.
   */
  for (const building of [AnimalBuilding.COOP, AnimalBuilding.BARN]) {
    app.post(
      `/${building}`,
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (request) => {
        const player = currentPlayer(request);
        const input = upgradeSchema.parse(request.body);
        const now = Date.now();

        return runIdempotent(player.id, input.idempotencyKey, `shop.${building}`, now, (tx) =>
          upgradeBuilding(tx, player, building, now),
        );
      },
    );
  }

  app.post(
    '/sell',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = shopSellSchema.parse(request.body);

      return runIdempotent(
        player.id,
        input.idempotencyKey,
        'shop.sell',
        Date.now(),
        (tx) => sell(tx, player, input.itemId, input.quantity),
      );
    },
  );
}
