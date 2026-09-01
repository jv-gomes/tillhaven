import { eq, sql } from 'drizzle-orm';
import { ErrorCode, GameError } from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Tx } from '../../db/tx.js';

/**
 * The shared spine of every "buy the next tier" purchase — chest, house, and
 * whatever comes after.
 *
 * Three small pieces rather than one clever generic. A single
 * `buyNextTier(track)` would have to be handed a Drizzle column to write and a
 * tier table to read, and the plumbing to do that generically is harder to
 * follow than the twenty lines it saves. These are the parts that are actually
 * identical: take the locks, pick the tier, check the price.
 */

export interface Tier {
  readonly tier: number;
  readonly cost: number;
}

export interface UpgradeContext {
  readonly gold: number;
  /**
   * The backpack's tier, read from the same LOCKED player row as the gold.
   *
   * It lives on `players` rather than `farms`, so it comes back from the first
   * lock rather than the second. Returning it here is what stops a caller
   * reaching for the session's copy of the player instead: that snapshot was
   * loaded before the transaction began, and a concurrent purchase can have
   * moved the tier since — buying the same tier twice at full price.
   */
  readonly backpackTier: number;
  readonly farmId: string;
  readonly houseTier: number;
  readonly chestTier: number;
  readonly coopTier: number;
  readonly barnTier: number;
}

/**
 * Locks the player row and then the farm row, in that order.
 *
 * **The order matters and is the same everywhere.** The shop, animal purchases,
 * plot unlocks and both upgrade tracks all take the player row first, so no two
 * of them can deadlock against each other on one account. Locking gold first
 * also serialises purchases, which is what makes a tier check meaningful rather
 * than a suggestion two concurrent clicks step past.
 */
export async function lockForUpgrade(tx: Tx, playerId: string): Promise<UpgradeContext> {
  const playerRows = await tx
    .select({ gold: schema.players.gold, backpackTier: schema.players.backpackTier })
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .limit(1)
    .for('update');

  const playerRow = playerRows[0];
  if (!playerRow) throw new GameError(ErrorCode.NOT_FOUND, 'No such player.');
  const { gold, backpackTier } = playerRow;

  const farmRows = await tx
    .select({
      id: schema.farms.id,
      houseTier: schema.farms.houseTier,
      chestTier: schema.farms.chestTier,
      coopTier: schema.farms.coopTier,
      barnTier: schema.farms.barnTier,
    })
    .from(schema.farms)
    .where(eq(schema.farms.playerId, playerId))
    .limit(1)
    .for('update');

  const farm = farmRows[0];
  if (!farm) throw new GameError(ErrorCode.NOT_FOUND, 'That farm does not exist.');

  return {
    gold,
    backpackTier,
    farmId: farm.id,
    houseTier: farm.houseTier,
    chestTier: farm.chestTier,
    coopTier: farm.coopTier,
    barnTier: farm.barnTier,
  };
}

/**
 * The tier after the one held, or `UPGRADE_MAX_TIER`.
 *
 * Always `current + 1`. Skipping a tier is not something a caller can ask for,
 * which is why no endpoint accepts a target tier (§4.1).
 */
export function nextTier<T extends Tier>(tiers: readonly T[], current: number, atMax: string): T {
  const next = tiers.find((t) => t.tier === current + 1);
  if (!next) {
    throw new GameError(ErrorCode.UPGRADE_MAX_TIER, atMax, { tier: current });
  }
  return next;
}

export function assertAffordable(gold: number, cost: number): void {
  if (gold < cost) {
    throw new GameError(ErrorCode.INSUFFICIENT_GOLD, "You can't afford that.", {
      needed: cost,
      held: gold,
    });
  }
}

/** Deducts the price. Integer arithmetic, in SQL, inside the caller's transaction. */
export async function chargeGold(tx: Tx, playerId: string, cost: number): Promise<void> {
  await tx
    .update(schema.players)
    .set({ gold: sql`${schema.players.gold} - ${cost}` })
    .where(eq(schema.players.id, playerId));
}

/** Cost of the tier after this one, for the UI. Null once there are none left. */
export function costAfter(tiers: readonly Tier[], tier: number): number | null {
  return tiers.find((t) => t.tier === tier + 1)?.cost ?? null;
}
