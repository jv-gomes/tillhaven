import { isVipActive, levelForXp, type PublicPlayer, type SelfPlayer } from '@tillhaven/shared';
import { canTrade } from '../trade/eligibility.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * The boundary between a database row and what a client is allowed to see
 * (CLAUDE.md §4.1).
 *
 * Everything the client receives about a player goes through one of these two
 * functions. A new column on `players` is invisible until someone deliberately
 * adds it here, which is the right default.
 */

/** What the owning player sees about themselves. */
export function toSelfPlayer(player: AuthedPlayer, now: number): SelfPlayer {
  return {
    id: player.id,
    username: player.username,
    createdAt: player.createdAt,
    farmLevel: farmLevelOf(player),
    isVip: isVip(player, now),
    email: player.email,
    gold: player.gold,
    vipUntil: player.vipUntil,
    canTrade: canTrade(player, now),
    appearance: player.appearance,
  };
}

/**
 * What any *other* player sees. No gold, no email, no exact VIP expiry —
 * knowing precisely when someone's VIP lapses is not their business, and gold
 * totals would let scammers pick targets.
 */
export function toPublicPlayer(player: AuthedPlayer, now: number): PublicPlayer {
  return {
    id: player.id,
    username: player.username,
    createdAt: player.createdAt,
    farmLevel: farmLevelOf(player),
    isVip: isVip(player, now),
  };
}

/**
 * The player's farm level, derived from recorded experience.
 *
 * There is no stored level to read. Every caller goes through here, so there is
 * exactly one definition of what a level is — which matters because it gates
 * trading (§6).
 */
export function farmLevelOf(player: Pick<AuthedPlayer, 'experience'>): number {
  return levelForXp(player.experience);
}

/**
 * Thin re-export, not a reimplementation (T-5.01): `isVipActive` in shared
 * config is the one definition of "flagged means no VIP regardless of
 * expiry," used by both this server-side check and `benefitsFor`.
 */
export function isVip(player: AuthedPlayer, now: number): boolean {
  return isVipActive(player, now);
}

/**
 * Trade eligibility, for display.
 *
 * Delegated to `modules/trade/eligibility.ts` rather than reimplemented: this
 * value only tells the UI whether to offer trading, while the authoritative
 * check runs again at invite and at execution. Two implementations of the same
 * rule would eventually disagree, and the one that disagreed quietly would be
 * this one.
 */
export { canTrade };
