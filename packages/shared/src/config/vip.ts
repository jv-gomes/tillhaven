import { DAY } from './time.js';

/**
 * VIP (CLAUDE.md §7).
 *
 * ONE-TIME purchase via Stripe Checkout in `mode: 'payment'`. This is NOT a
 * subscription: do not use Stripe Billing, recurring Prices, or subscription
 * webhooks. Fulfilment happens exclusively in the `checkout.session.completed`
 * webhook after signature verification — never from the browser redirect.
 */

/** How long VIP lasts once granted. */
export const VIP_DURATION_MS = 30 * DAY;

/**
 * Benefits are CONVENIENCE AND COSMETIC ONLY.
 *
 * A VIP account must never be able to produce goods a free account cannot, and
 * must never receive tradeable exclusives or direct gold. With informal
 * real-money trading happening outside the platform, letting paying players
 * mint tradeable value destroys the economy.
 */
export interface VipBenefits {
  /**
   * Applied to crop growth and animal production durations, as a PERCENTAGE.
   * 80 means "takes 80% as long". Integer so all time math stays integer.
   */
  readonly durationPercent: number;
  readonly bonusInventorySlots: number;
  readonly bonusChestSlots: number;
  readonly bonusPlotSlots: number;
  readonly bonusAnimalCap: number;
  /** Quality-of-life: harvest every ripe plot in one intent. */
  readonly bulkHarvest: boolean;
  /** Quality-of-life: collect from every ready animal in one intent. */
  readonly autoCollect: boolean;
  /** Cosmetic decorations and character options. Non-tradeable, always. */
  readonly cosmeticsUnlocked: boolean;
}

export const VIP_BENEFITS: VipBenefits = {
  durationPercent: 80,
  bonusInventorySlots: 12,
  bonusChestSlots: 24,
  bonusPlotSlots: 4,
  bonusAnimalCap: 3,
  bulkHarvest: true,
  autoCollect: true,
  cosmeticsUnlocked: true,
};

export const FREE_BENEFITS: VipBenefits = {
  durationPercent: 100,
  bonusInventorySlots: 0,
  bonusChestSlots: 0,
  bonusPlotSlots: 0,
  bonusAnimalCap: 0,
  bulkHarvest: false,
  autoCollect: false,
  cosmeticsUnlocked: false,
};

/** The two columns that decide VIP status. A structural subset of `AuthedPlayer`. */
export interface VipStatusInput {
  readonly vipUntil: number | null;
  readonly flaggedAt: number | null;
}

/**
 * The ONE definition of "is this account's VIP active right now" (T-5.01).
 *
 * A flagged account (refund or chargeback — CLAUDE.md §7) is never VIP,
 * regardless of what `vipUntil` still says — flagging revokes access
 * immediately, it does not merely stop a future renewal, and there is no
 * such thing as a renewal to stop since this is a one-time purchase anyway.
 *
 * Lives here, in shared config, rather than as a per-caller check so that
 * `benefitsFor` below and every other "is this player VIP" question in the
 * codebase go through the same rule. Two independent implementations of
 * "flagged means no VIP" is exactly the kind of drift CLAUDE.md §4.4 exists
 * to rule out for shared game config, and this is no different in spirit —
 * it was actually happening before this task, as an inline ternary repeated
 * at four call sites instead of a shared function.
 */
export function isVipActive(player: VipStatusInput, now: number): boolean {
  if (player.flaggedAt !== null) return false;
  return player.vipUntil !== null && player.vipUntil > now;
}

/**
 * Takes the player record directly, not a pre-computed `vipUntil` — so a
 * caller cannot forget the flagged check the way four call sites once did.
 * There is no "just pass a timestamp" path left that could skip it.
 */
export function benefitsFor(player: VipStatusInput, now: number): VipBenefits {
  return isVipActive(player, now) ? VIP_BENEFITS : FREE_BENEFITS;
}

/**
 * Apply the VIP speed multiplier to a duration. Integer math throughout;
 * rounds up so a multiplier can never make something instant.
 *
 * The floor of 1ms is not decoration. Callers divide by this — crop stages and
 * animal cycles both do — so a zero would mean an instantly ripe crop, or an
 * animal owing `Infinity` eggs. No configured percentage is 0 today, but "the
 * only caller passes a safe value" is not a property this function can check,
 * and the failure it prevents is item duplication.
 */
export function applyDurationPercent(durationMs: number, percent: number): number {
  if (durationMs <= 0) return 0;
  return Math.max(1, Math.ceil((durationMs * percent) / 100));
}

/**
 * OPEN DECISION (CLAUDE.md §14) — VIP price point.
 *
 * Not set. The Stripe Price is configured in the dashboard and referenced by
 * STRIPE_VIP_PRICE_ID; nothing in this repo should hardcode an amount. The
 * `purchases` row records the amount Stripe actually charged, which is the
 * figure that matters for reconciliation.
 */
