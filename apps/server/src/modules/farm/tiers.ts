import { eq } from 'drizzle-orm';
import { schema } from '../../db/client.js';
import type { Queryable } from '../../db/tx.js';

/**
 * A farm's identity and upgrade tiers.
 *
 * One query, in one place, because three modules need it — inventory for slot
 * capacity, animals for the animal cap, and the farm itself. Each had grown its
 * own copy of this select, which is three chances for one of them to read a
 * different column or forget a fallback.
 */

export interface FarmTiers {
  readonly farmId: string;
  readonly houseTier: number;
  readonly chestTier: number;
  /** Caps chickens (T-12.02). */
  readonly coopTier: number;
  /** Caps cows. */
  readonly barnTier: number;
}

/**
 * Registration creates the farm in the same transaction as the player, so a
 * missing row is a data-integrity problem rather than a user error. Callers
 * that only need the tiers get tier 0 — under-reporting capacity is the safe
 * direction, since the alternative is granting slots nobody paid for.
 */
export async function farmTiers(q: Queryable, playerId: string): Promise<FarmTiers | null> {
  const rows = await q
    .select({
      farmId: schema.farms.id,
      houseTier: schema.farms.houseTier,
      chestTier: schema.farms.chestTier,
      coopTier: schema.farms.coopTier,
      barnTier: schema.farms.barnTier,
    })
    .from(schema.farms)
    .where(eq(schema.farms.playerId, playerId))
    .limit(1);

  return rows[0] ?? null;
}
