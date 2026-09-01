import { eq } from 'drizzle-orm';
import { HOUSE_TIERS } from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Queryable, Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { farmTiers } from './tiers.js';
import {
  assertAffordable,
  chargeGold,
  costAfter,
  lockForUpgrade,
  nextTier,
} from './upgrades.js';

/**
 * House upgrades (CLAUDE.md §5.5).
 *
 * **The house is cosmetic now** (T-12.02). It lost bag slots to the backpack's
 * own purchase in T-10.03 and its `bonusAnimalCap` to `COOP_TIERS`/
 * `BARN_TIERS` here — one farm-wide animal number could not say "the coop is
 * full but the barn is empty", and a house making room for livestock was a
 * strange thing for a house to do in the first place.
 *
 * So a tier buys nothing a player can currently observe: the house renders
 * with one look at every tier (a T-7.11 art gap, recorded there). The
 * endpoints, tiers and tests stay — the sink is declared in
 * `docs/economy.md` — but nothing in the MVP shop offers it, and giving it
 * something to be worth is a Phase 14 job.
 */

export interface HouseView {
  readonly tier: number;
  readonly nextCost: number | null;
}

export interface HouseUpgradeResult extends HouseView {
  readonly goldDelta: number;
  readonly goldAfter: number;
}

function viewAt(tier: number): HouseView {
  return { tier, nextCost: costAfter(HOUSE_TIERS, tier) };
}

/** The caller's house, and what the next tier would cost them. */
export async function houseView(q: Queryable, player: AuthedPlayer): Promise<HouseView> {
  const tiers = await farmTiers(q, player.id);
  return viewAt(tiers?.houseTier ?? 0);
}

/**
 * Buys the next house tier.
 *
 * Like the chest, the payload carries no target tier — "upgrade" means the one
 * after the one you have, so buying out of order is not expressible.
 */
export async function upgradeHouse(
  tx: Tx,
  player: AuthedPlayer,
): Promise<HouseUpgradeResult> {
  const context = await lockForUpgrade(tx, player.id);
  const next = nextTier(HOUSE_TIERS, context.houseTier, 'Your house is already fully built.');

  assertAffordable(context.gold, next.cost);

  await tx
    .update(schema.farms)
    .set({ houseTier: next.tier })
    .where(eq(schema.farms.id, context.farmId));

  await chargeGold(tx, player.id, next.cost);

  return {
    ...viewAt(next.tier),
    goldDelta: -next.cost,
    goldAfter: context.gold - next.cost,
  };
}
