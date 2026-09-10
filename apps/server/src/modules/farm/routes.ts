import type { FastifyInstance } from 'fastify';
import {
  idleSettingsSchema,
  plantSchema,
  harvestSchema,
  harvestAllSchema,
  chopSchema,
  tillSchema,
  unlockPlotSchema,
  upgradeSchema,
  waterSchema,
  type CropId,
  sleepSchema,
} from '@tillhaven/shared';
import { requireAuth, currentPlayer, type AuthedPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { getFarmState, plant, harvest, harvestAll, till, water } from './service.js';
import { chop } from './trees.js';
import { idleSettings, setIdleSettings } from './idle.js';
import { catchUpIdle } from './idleApply.js';

import { expansionPrices, unlockPlot } from './expansion.js';
import { houseView, upgradeHouse } from './house.js';
import { sleep, wake } from './energy.js';
import { db } from '../../db/client.js';
import { hasDueShipments, settleShipments } from '../shipping/service.js';

/**
 * Runs the farmer's pending shift, then the manual action (T-13.04).
 *
 * Every farm mutation goes through this. The catch-up lands FIRST, in its own
 * committed transaction: a player harvesting a plot by hand must not then have
 * the simulator decide that same plot was ripe an hour ago. See `catchUpIdle`
 * for why the two are separate transactions rather than one — the short
 * version is that a manual action which fails should not un-do work the farmer
 * had already done, because the error it reports would then describe a state
 * that got rolled back.
 *
 * Doing it here rather than inside each service keeps the services about their
 * own rules, and makes this one place to check whether an endpoint is covered.
 */
async function afterIdleCatchUp<T>(
  player: AuthedPlayer,
  now: number,
  action: () => Promise<T>,
): Promise<T> {
  await catchUpIdle(db, player, now);
  return action();
}

/**
 * Farm routes. Parse, authorize, call, respond (CLAUDE.md §10).
 *
 * Every mutating route here is idempotent, rate limited, and behind
 * `requireAuth`. Ownership is checked inside the service against the
 * authenticated player id — never against anything in the request body.
 */
export async function farmRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * The hottest path in the game. The client polls it, so it gets a generous
   * limit — but not an unlimited one.
   *
   * It settles the shipping box first (T-11.02). Nothing about shipments is in
   * the response; what this buys is that gold from a box that came due arrives
   * while the player is standing in their field, rather than waiting until they
   * happen to open the box.
   *
   * The **check is separate from the settlement** on purpose. Nothing is due on
   * almost every poll, and a transaction that settles nothing still pays for a
   * BEGIN and a COMMIT — three extra round trips on the hottest path in the
   * game instead of one indexed lookup. `farm.queries.test.ts` pins the count.
   */
  app.get(
    '/',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const now = Date.now();

      const credited = (await hasDueShipments(db, player.id, now))
        ? await db.transaction((tx) => settleShipments(tx, player, now))
        : 0;
      /*
       * Re-read the player when gold moved: `getFarmState` reports the balance
       * from the session's snapshot, which was loaded before this settlement.
       */
      const current = credited > 0 ? { ...player, gold: player.gold + credited } : player;

      return getFarmState(current, now, credited);
    },
  );

  /**
   * What each remaining plot would cost. Prices come from the server so the
   * client never has to work one out (§4.4).
   */
  app.get(
    '/expansion',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      return { plots: await expansionPrices(db, player, Date.now()) };
    },
  );

  app.post(
    '/unlock',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = unlockPlotSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'farm.unlock', now, (tx) =>
        unlockPlot(tx, player, input.plotId, now),
      );
    },
  );

  /** The house, and what the next tier costs. Cosmetic since T-12.02. */
  app.get(
    '/house',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      return houseView(db, player);
    },
  );

  /** Buys the NEXT house tier. The body carries no tier — see `upgradeHouse`. */
  /*
   * Sleeping (MVP re-scope). Two endpoints rather than one toggle: "put me to
   * bed" and "get me up" are different intents, and a toggle would make a
   * retried request flip the state back — exactly what `runIdempotent` exists
   * to prevent, but only if the two are distinguishable in the first place.
   *
   * 20/min. Nobody legitimately gets in and out of bed faster than that, and
   * the endpoint mints energy.
   */
  app.post(
    '/sleep',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = sleepSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'farm.sleep', now, (tx) =>
        sleep(tx, player, now),
      );
    },
  );

  app.post(
    '/wake',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = sleepSchema.parse(request.body);
      const now = Date.now();

      return runIdempotent(player.id, input.idempotencyKey, 'farm.wake', now, (tx) =>
        wake(tx, player, now),
      );
    },
  );

  app.post(
    '/house/upgrade',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = upgradeSchema.parse(request.body);

      return runIdempotent(player.id, input.idempotencyKey, 'farm.houseUpgrade', Date.now(), (tx) =>
        upgradeHouse(tx, player),
      );
    },
  );

  /** The farmer's standing orders (T-13.02). */
  app.get(
    '/idle',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => idleSettings(db, currentPlayer(request)),
  );

  /**
   * Replaces them. A PUT because it replaces the whole resource — an omitted
   * `cropId` means "sow nothing", not "leave it alone" (see the schema).
   *
   * A tighter limit than the farming verbs: changing your mind about what the
   * farmer does is a thing a person does occasionally, not sixty times a
   * minute, and every write settles the watermark.
   */
  app.put(
    '/idle',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = idleSettingsSchema.parse(request.body);

      const now = Date.now();
      return afterIdleCatchUp(player, now, () =>
        runIdempotent(player.id, input.idempotencyKey, 'farm.idle', now, (tx) =>
          setIdleSettings(
            tx,
            player,
            {
              enabled: input.enabled,
              tasks: input.tasks,
              // `undefined` (omitted) and `null` are the same instruction here.
              cropId: (input.cropId ?? null) as CropId | null,
            },
            now,
          ),
        ),
      );
    },
  );

  app.post(
    '/till',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = tillSchema.parse(request.body);

      const now = Date.now();
      return afterIdleCatchUp(player, now, () =>
        runIdempotent(player.id, input.idempotencyKey, 'farm.till', now, (tx) =>
          till(tx, player, input.plotId, now),
        ),
      );
    },
  );

  /**
   * Chopping (T-20.03). Rate limited like the other tool actions.
   *
   * 60/minute is far above what a player can physically do — five trees on an
   * 8h regrow means the honest ceiling is five chops a *shift* — and that is
   * the point: the limit is there to stop a script hammering the endpoint, not
   * to pace the game. The economics are paced by `TREE_REGROW_MS`, which no
   * amount of requesting can hurry (§8: "design so that automation gains
   * little").
   */
  app.post(
    '/chop',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = chopSchema.parse(request.body);

      const now = Date.now();
      return afterIdleCatchUp(player, now, () =>
        runIdempotent(player.id, input.idempotencyKey, 'farm.chop', now, (tx) =>
          chop(tx, player, input.treeId, now),
        ),
      );
    },
  );

  app.post(
    '/plant',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = plantSchema.parse(request.body);

      const now = Date.now();
      return afterIdleCatchUp(player, now, () =>
        runIdempotent(player.id, input.idempotencyKey, 'farm.plant', now, (tx) =>
          plant(tx, player, input.plotId, input.cropId, now),
        ),
      );
    },
  );

  /**
   * The most-repeated action in the game — one call per planted plot, twice a
   * day for a long crop — so it gets the same limit as till and plant rather
   * than a tighter one. Re-watering wet soil is deliberately allowed and
   * wastes nothing (see `water`), so a spamming client only spends its budget.
   */
  app.post(
    '/water',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = waterSchema.parse(request.body);

      const now = Date.now();
      return afterIdleCatchUp(player, now, () =>
        runIdempotent(player.id, input.idempotencyKey, 'farm.water', now, (tx) =>
          water(tx, player, input.plotId, now),
        ),
      );
    },
  );

  app.post(
    '/harvest',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = harvestSchema.parse(request.body);

      const now = Date.now();
      return afterIdleCatchUp(player, now, () =>
        runIdempotent(player.id, input.idempotencyKey, 'farm.harvest', now, (tx) =>
          harvest(tx, player, input.plotId, now),
        ),
      );
    },
  );

  /**
   * Bulk harvest (T-24.01). Tighter limit than `/harvest` on purpose: one call
   * here can do twenty-five plots' worth of work, so keeping the per-action
   * budget would make the batch the cheap way to load the database.
   *
   * The idle catch-up still runs first, exactly as it does for a single
   * harvest — the farmer's shift must land before the player's press, or the
   * simulator gets to decide a plot was ripe an hour after the player cleared
   * it.
   */
  app.post(
    '/harvest-all',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = harvestAllSchema.parse(request.body);

      const now = Date.now();
      return afterIdleCatchUp(player, now, () =>
        runIdempotent(player.id, input.idempotencyKey, 'farm.harvestAll', now, (tx) =>
          harvestAll(tx, player, now),
        ),
      );
    },
  );
}
