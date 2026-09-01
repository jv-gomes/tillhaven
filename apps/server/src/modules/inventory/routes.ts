import type { FastifyInstance } from 'fastify';
import {
  BACKPACK_TIERS,
  inventoryMoveSchema,
  inventoryTransferSchema,
  upgradeSchema,
} from '@tillhaven/shared';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { inventoryView, moveSlots, type SlotRef } from './service.js';
import { chestView, transfer, upgradeChest, type Direction } from './chest.js';
import { costAfter } from '../farm/upgrades.js';
import { db } from '../../db/client.js';

/**
 * Inventory routes. Parse, authorize, call, respond (CLAUDE.md §10).
 *
 * Both routes read the player from the session cookie and nothing else. There
 * is no player id in either payload, so there is nothing to substitute — the
 * shape of the endpoint is what stops one player reading or rearranging
 * another's bag, rather than a check that could be forgotten.
 */
export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * The backpack, with what the next tier would cost.
   *
   * The price ships with the view rather than being looked up in the client's
   * own copy of `BACKPACK_TIERS` — same config, but only one of them is
   * authoritative, and a shop quoting a stale price is a shop that lies (§4.4).
   * Exactly the shape `GET /chest` already has.
   */
  app.get(
    '/',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const view = await inventoryView(db, player, Date.now());

      return {
        ...view,
        tier: player.backpackTier,
        nextCost: costAfter(BACKPACK_TIERS, player.backpackTier),
      };
    },
  );

  app.get(
    '/chest',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      return chestView(db, player, Date.now());
    },
  );

  /**
   * Buys the NEXT chest tier. The body carries no tier — see `upgradeChest`.
   */
  app.post(
    '/chest/upgrade',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = upgradeSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'inventory.chestUpgrade', now, (tx) =>
        upgradeChest(tx, player, now),
      );
    },
  );

  /**
   * Bag to chest and back. Idempotent: a resent transfer must move one lot of
   * items, not two.
   */
  app.post(
    '/transfer',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = inventoryTransferSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'inventory.transfer', now, (tx) =>
        transfer(tx, player, input.itemId, input.quantity, input.direction as Direction, now),
      );
    },
  );

  /**
   * Rearranging the bag, or the chest (T-10.01). Idempotent like every other
   * mutation: a double-sent drag must not swap twice and land the item back
   * where it started.
   *
   * Each end of the drag names its own container (T-10.02), checked by the
   * schema rather than trusted into a query — and whichever they name,
   * ownership still comes from the session, so there is no id here to
   * substitute.
   */
  app.post(
    '/move',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = inventoryMoveSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'inventory.move', now, (tx) =>
        moveSlots(
          tx,
          player,
          input.from as SlotRef,
          input.to as SlotRef,
          now,
        ),
      );
    },
  );
}
