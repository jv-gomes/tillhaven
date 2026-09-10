import { api, idempotencyKey } from './api.js';

/**
 * Fishing (T-34.02, T-34.03).
 *
 * **The thinnest module in `net/`, and deliberately so.** Everything about a
 * cast is the server's: the fish, the seed, the bite delay and the window a reel
 * is judged against. The client learns `biteAt` so it can animate on its own
 * clock, and learns what it caught only after a reel lands.
 *
 * **`reel` sends no timing value and there is nowhere to put one.** The schema
 * on the other end is `.strict()`; a client that reported its own reaction time
 * would report a perfect one, so the field does not exist rather than being
 * ignored.
 */

export interface CastView {
  readonly castId: string;
  /** When to play the bite. The only thing the server gives away up front. */
  readonly biteAt: number;
}

export interface ReelResult {
  readonly castId: string;
  readonly landed: boolean;
  /** What was on the line — only on a success, and `null` on a miss. */
  readonly fishId: string | null;
}

export function castLine(key = idempotencyKey()): Promise<CastView> {
  return api.post<CastView>('/fishing/cast', { idempotencyKey: key });
}

export function reelIn(castId: string, key = idempotencyKey()): Promise<ReelResult> {
  return api.post<ReelResult>('/fishing/reel', { castId, idempotencyKey: key });
}
