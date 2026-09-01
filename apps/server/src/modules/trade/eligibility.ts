import {
  ErrorCode,
  GameError,
  TRADE_MIN_ACCOUNT_AGE_MS,
  TRADE_MIN_FARM_LEVEL,
  levelForXp,
} from '@tillhaven/shared';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * Who may trade (CLAUDE.md §6, and the decision recorded in §14).
 *
 * A player may not open or accept a trade until their account is **at least 24
 * hours old** and their farm has reached **level 5**, and is not flagged. Both
 * conditions, for both parties.
 *
 * The point is not to gatekeep new players — it is to make throwaway-account
 * scamming expensive to run at any scale. A scammer's cost per disposable
 * account becomes a day of wall-clock time plus several hours of real farming,
 * and neither can be bought: experience comes only from crops and animals that
 * take real time to grow (see `config/level.ts`). One account is an
 * inconvenience; a hundred is a business nobody wants to be in.
 *
 * Everything here is **pure** and takes `now` as a parameter, so both boundaries
 * can be tested exactly rather than approximately.
 */

export const TradeBlock = {
  FLAGGED: 'flagged',
  ACCOUNT_TOO_NEW: 'account_too_new',
  FARM_TOO_LOW: 'farm_too_low',
} as const;
export type TradeBlock = (typeof TradeBlock)[keyof typeof TradeBlock];

export interface TradeEligibility {
  readonly eligible: boolean;
  /** Why not, or null when they may trade. */
  readonly blockedBy: TradeBlock | null;
  /** ms until the account is old enough. 0 once it is. */
  readonly accountAgeRemainingMs: number;
  readonly farmLevel: number;
  readonly requiredFarmLevel: number;
}

/** The minimum a player needs for eligibility to be defined. */
export type TradeCandidate = Pick<
  AuthedPlayer,
  'id' | 'username' | 'createdAt' | 'experience' | 'flaggedAt'
>;

/**
 * Resolves eligibility, and says which condition failed.
 *
 * The reason matters: "come back tomorrow" and "grow four more levels" are
 * different problems, and a UI that can only say "you cannot trade" turns a
 * temporary rule into a mystery. Order is deliberate — a flagged account is
 * told it is flagged rather than being sent off to farm for a level it will
 * never be allowed to use.
 */
export function tradeEligibility(player: TradeCandidate, now: number): TradeEligibility {
  const farmLevel = levelForXp(player.experience);
  const age = now - player.createdAt;
  const accountAgeRemainingMs = Math.max(0, TRADE_MIN_ACCOUNT_AGE_MS - age);

  const base = {
    accountAgeRemainingMs,
    farmLevel,
    requiredFarmLevel: TRADE_MIN_FARM_LEVEL,
  };

  // A refund or chargeback flag outranks everything else.
  if (player.flaggedAt !== null) {
    return { ...base, eligible: false, blockedBy: TradeBlock.FLAGGED };
  }
  if (accountAgeRemainingMs > 0) {
    return { ...base, eligible: false, blockedBy: TradeBlock.ACCOUNT_TOO_NEW };
  }
  if (farmLevel < TRADE_MIN_FARM_LEVEL) {
    return { ...base, eligible: false, blockedBy: TradeBlock.FARM_TOO_LOW };
  }

  return { ...base, eligible: true, blockedBy: null };
}

/** Convenience for the display flag on `SelfPlayer`. */
export function canTrade(player: TradeCandidate, now: number): boolean {
  return tradeEligibility(player, now).eligible;
}

/**
 * Throws unless this player may trade.
 *
 * Called at **invite** and again at **execution** — never once. The gap between
 * the two is exactly where an account can be flagged for a chargeback, and a
 * trade that was authorised an hour ago is not authorised now.
 */
export function assertCanTrade(player: TradeCandidate, now: number): void {
  const result = tradeEligibility(player, now);
  if (result.eligible) return;

  throw new GameError(ErrorCode.TRADE_NOT_ELIGIBLE, blockMessage(result.blockedBy), {
    blockedBy: result.blockedBy ?? 'unknown',
    farmLevel: result.farmLevel,
    requiredFarmLevel: result.requiredFarmLevel,
    accountAgeRemainingMs: result.accountAgeRemainingMs,
  });
}

/**
 * Throws unless **both** parties may trade.
 *
 * Both, always. Checking only the caller would let an eligible player pull an
 * ineligible one into a trade — which is the whole scam the rule exists to
 * stop, run from the other end.
 *
 * The error deliberately does not say *which* of the two failed or why. A
 * partner's account age and farm level are not the caller's business, and
 * leaking them turns this endpoint into a way to probe strangers' accounts.
 */
export function assertBothCanTrade(
  a: TradeCandidate,
  b: TradeCandidate,
  now: number,
): void {
  // The caller's own reason is safe to tell them, so check them first.
  assertCanTrade(a, now);

  if (!tradeEligibility(b, now).eligible) {
    throw new GameError(
      ErrorCode.TRADE_NOT_ELIGIBLE,
      'That farmer cannot trade yet.',
      { blockedBy: 'partner' },
    );
  }
}

function blockMessage(block: TradeBlock | null): string {
  switch (block) {
    case TradeBlock.FLAGGED:
      return 'Trading is unavailable on this account.';
    case TradeBlock.ACCOUNT_TOO_NEW:
      return 'New farms cannot trade for the first day.';
    case TradeBlock.FARM_TOO_LOW:
      return `Your farm must reach level ${TRADE_MIN_FARM_LEVEL} to trade.`;
    default:
      return 'You cannot trade yet.';
  }
}
