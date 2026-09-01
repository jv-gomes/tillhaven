import { GameError, type ErrorCode } from '@tillhaven/shared';
import { redis } from '../db/redis.js';

/**
 * Per-ACCOUNT rate limiting, backed by Redis (CLAUDE.md §2, §8).
 *
 * `@fastify/rate-limit` (see `app.ts`) already caps every mutating endpoint
 * by IP, in memory, per process. That is a different, complementary defence:
 * a bot farming many accounts from one IP still hits the per-IP limiter, but
 * a bot spreading one account's traffic across many IPs (a proxy pool) sails
 * straight through it. This is the other half — keyed by player id, not
 * address, so it holds regardless of where the requests come from — and it
 * lives in Redis rather than memory because it has to survive across the
 * server's process boundary, not just within one.
 *
 * Fixed window, not sliding: a burst can land two windows' worth of requests
 * right at the boundary, which is an acceptable imprecision for an anti-bot
 * backstop and far simpler than a sorted-set sliding window. `INCR` on a
 * fresh key returns 1, which is what triggers setting the expiry — every
 * later `INCR` in the same window just bumps the count.
 */
export interface AccountLimit {
  readonly max: number;
  readonly windowMs: number;
}

/**
 * Throws `errorCode` once `scope:playerId` has been called more than
 * `limit.max` times inside the current window. Counts the call whether or
 * not the caller's own work later succeeds — same as `@fastify/rate-limit`
 * counting requests rather than outcomes.
 */
export async function assertUnderAccountLimit(
  scope: string,
  playerId: string,
  limit: AccountLimit,
  errorCode: ErrorCode,
  message: string,
): Promise<void> {
  const key = `ratelimit:${scope}:${playerId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.pexpire(key, limit.windowMs);
  }
  if (count > limit.max) {
    throw new GameError(errorCode, message);
  }
}
