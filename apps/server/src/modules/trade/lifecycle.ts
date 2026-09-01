/**
 * What state a trade is *actually* in (CLAUDE.md §6).
 *
 * Pure, and `now` is a parameter — the same discipline as crop growth, for the
 * same reason: **expiry is computed on read, not ticked by a job** (§4.2). A
 * trade whose deadline has passed is expired the instant anyone looks at it,
 * whatever the `status` column still says.
 *
 * That matters more here than it does for a crop. A sweeper job that runs every
 * minute leaves a window where an abandoned trade is still executable, and
 * "the trade completed after I walked away" is exactly the complaint a trading
 * system cannot afford. Deriving it means there is no window at all.
 */

export const TradeStatus = {
  /** Invited; the recipient has not answered yet. */
  PENDING: 'pending',
  /** Accepted. Both parties may set offers and confirm. */
  OPEN: 'open',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  COMPLETED: 'completed',
} as const;
export type TradeStatus = (typeof TradeStatus)[keyof typeof TradeStatus];

/** States a trade can still move on from. */
const LIVE: readonly TradeStatus[] = [TradeStatus.PENDING, TradeStatus.OPEN];

export interface TradeTiming {
  readonly status: string;
  readonly expiresAt: number;
}

export function isLiveStatus(status: string): boolean {
  return LIVE.includes(status as TradeStatus);
}

/**
 * The status to act on.
 *
 * A stored `pending` or `open` past its deadline reads as `expired`; a stored
 * `completed` or `cancelled` is already final and its deadline is irrelevant.
 * Nothing here writes — a later cleanup job may tidy the column, but no
 * decision depends on it having run.
 */
export function effectiveStatus(trade: TradeTiming, now: number): TradeStatus {
  if (!isLiveStatus(trade.status)) return trade.status as TradeStatus;
  return now >= trade.expiresAt ? TradeStatus.EXPIRED : (trade.status as TradeStatus);
}

/** True when the trade can still be acted on. */
export function isLive(trade: TradeTiming, now: number): boolean {
  return isLiveStatus(effectiveStatus(trade, now));
}

/** ms until it expires, or 0 once it has. */
export function expiresInMs(trade: TradeTiming, now: number): number {
  if (!isLive(trade, now)) return 0;
  return Math.max(0, trade.expiresAt - now);
}
