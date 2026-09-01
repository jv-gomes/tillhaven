import type { FastifyInstance } from 'fastify';
import {
  ErrorCode,
  TRADE_RATE_LIMIT,
  tradeCancelSchema,
  tradeConfirmSchema,
  tradeExecuteSchema,
  tradeHistorySchema,
  tradeInviteSchema,
  tradeSetOfferSchema,
} from '@tillhaven/shared';
import { z } from 'zod';
import { requireAuth, currentPlayer } from '../../middleware/auth.js';
import { runIdempotent } from '../../lib/idempotency.js';
import { logSecurityEvent } from '../../lib/securityLog.js';
import { assertUnderAccountLimit } from '../../lib/accountRateLimit.js';
import { emitTradeChanged } from '../../realtime/socket.js';
import { db } from '../../db/client.js';
import {
  accept,
  cancel,
  confirm,
  currentTrade,
  execute,
  invite,
  setOffer,
  tradeHistory,
  viewTrade,
  type TradeView,
} from './service.js';

const acceptSchema = z.object({
  tradeId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128),
});

/**
 * Trade routes (CLAUDE.md §6). Parse, authorize, call, respond.
 *
 * Rate limits here are deliberately tighter than elsewhere: invite spam is
 * harassment as much as it is load, and §6 asks for invites to be capped
 * separately from completions. T-4.08 adds the per-account trade limit on top.
 */
export async function tradeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * Pushes T-4.10's "something changed" signal to both parties. Called after
   * every mutation, success only — a failed request changed nothing, so there
   * is nothing to resync. Both parties, not just the one who did not make the
   * call: the caller's own socket (if they have one open in another tab)
   * benefits from the same resync-on-signal path as anyone else's.
   */
  function notify(trade: TradeView): void {
    emitTradeChanged(app, [trade.initiatorId, trade.recipientId]);
  }

  /** The caller's current trade, if any. Polled by the trade UI. */
  app.get(
    '/current',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      return { trade: await currentTrade(db, player, Date.now()) };
    },
  );

  /**
   * The caller's own completed trades (T-4.12, CLAUDE.md §6) — their record
   * of what they traded, and the raw material for a reputation signal later.
   * Registered ahead of `/:tradeId` for readability; Fastify's router already
   * prefers a literal segment over a parametric one regardless of order, so
   * this can never be shadowed by "history" being read as a trade id.
   */
  app.get(
    '/history',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = tradeHistorySchema.parse(request.query);
      return tradeHistory(db, player.id, input.cursor, input.limit);
    },
  );

  app.get(
    '/:tradeId',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const { tradeId } = z.object({ tradeId: z.string().uuid() }).parse(request.params);
      return viewTrade(db, player, tradeId, Date.now());
    },
  );

  app.post(
    '/invite',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = tradeInviteSchema.parse(request.body);
      const now = Date.now();

      const trade = await runIdempotent(player.id, input.idempotencyKey, 'trade.invite', now, (tx) =>
        invite(tx, player, input.targetUsername, now),
      );
      notify(trade);
      return trade;
    },
  );

  app.post(
    '/accept',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = acceptSchema.parse(request.body);
      const now = Date.now();

      const trade = await runIdempotent(player.id, input.idempotencyKey, 'trade.accept', now, (tx) =>
        accept(tx, player, input.tradeId, now),
      );
      notify(trade);
      return trade;
    },
  );

  /**
   * Replaces the caller's side of the offer. Which side that is comes from the
   * session — there is no field for it, so there is nothing to tamper with.
   */
  app.post(
    '/offer',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = tradeSetOfferSchema.parse(request.body);
      const now = Date.now();

      const trade = await runIdempotent(player.id, input.idempotencyKey, 'trade.offer', now, (tx) =>
        setOffer(tx, player, input.tradeId, input.items, input.gold, now),
      );
      notify(trade);
      return trade;
    },
  );

  /**
   * Confirms the caller's side, against the revision they were shown.
   *
   * The revision is required, not optional: a confirmation is agreement to a
   * SPECIFIC offer, and one that just meant "whatever is there now" would be
   * the scam this endpoint exists to prevent.
   */
  app.post(
    '/confirm',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = tradeConfirmSchema.parse(request.body);
      const now = Date.now();

      const trade = await runIdempotent(player.id, input.idempotencyKey, 'trade.confirm', now, (tx) =>
        confirm(tx, player, input.tradeId, input.revision, now),
      );
      notify(trade);
      return trade;
    },
  );

  /**
   * Executes a trade both parties have confirmed (CLAUDE.md §6). The highest-
   * risk endpoint in the game: the whole swap runs in one transaction, with
   * both players' inventories locked in a deterministic order and every
   * offered item re-verified against reality — see `execute` in service.ts.
   *
   * Either party may call it once ready; whichever request arrives first
   * completes the trade; a second is treated as a success too, not an error —
   * the outcome is the same trade either of them agreed to.
   *
   * The `rateLimit` config above is the per-IP backstop, same as every other
   * route here. `TRADE_RATE_LIMIT` (T-4.08) is the OTHER half — per ACCOUNT,
   * backed by Redis, checked inside the idempotency transaction so a replayed
   * key never burns quota twice. It is deliberately just a completions cap:
   * invite spam already has its own, separate limit above, so a bot cannot
   * dodge the 20-a-day cap here by hammering invites instead.
   */
  app.post(
    '/execute',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = tradeExecuteSchema.parse(request.body);
      const now = Date.now();

      const trade = await runIdempotent(player.id, input.idempotencyKey, 'trade.execute', now, async (tx) => {
        await assertUnderAccountLimit(
          'trade.execute',
          player.id,
          TRADE_RATE_LIMIT,
          ErrorCode.TRADE_RATE_LIMITED,
          'Too many trades today. Try again tomorrow.',
        );
        return execute(tx, player, input.tradeId, now);
      });
      notify(trade);

      // Best-effort, off the critical path — same pattern as auth's
      // login_failed/account_created (CLAUDE.md §8). An audit write that
      // cannot complete must not turn a successful trade into a 500.
      await logSecurityEvent({
        playerId: player.id,
        event: 'trade_executed',
        ip: request.ip,
        detail: input.tradeId,
      });

      return trade;
    },
  );

  /**
   * Cancelling is NOT idempotency-keyed. Walking away must always work, and a
   * replayed key returning a stale stored response is precisely the wrong
   * behaviour for "get me out of this".
   */
  app.post(
    '/cancel',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const player = currentPlayer(request);
      const input = tradeCancelSchema.parse(request.body);
      const trade = await db.transaction((tx) => cancel(tx, player, input.tradeId, Date.now()));
      notify(trade);
      return trade;
    },
  );
}
