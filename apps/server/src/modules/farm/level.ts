import { eq, sql } from 'drizzle-orm';
import {
  ErrorCode,
  GameError,
  levelForXp,
  levelProgress,
  xpForCollect,
  xpForHarvest,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Tx } from '../../db/tx.js';

/**
 * Farm level.
 *
 * The level itself is **not stored**. It is `levelForXp(players.experience)`,
 * computed wherever it is needed, exactly as a crop's growth stage is computed
 * from its planting timestamp rather than ticked into a column (§4.2).
 *
 * That is not tidiness. Farm level gates trading (§6, §14), so a stored level
 * would be a second source of truth that could be written to — by a bug, a
 * migration, or a support script. Deriving it means the only way to raise a
 * level is to have earned the experience, and the only way to earn experience
 * is to have waited for a crop or an animal.
 *
 * **Experience only ever goes up.** Nothing here subtracts, and the SQL below
 * adds rather than assigns, so two concurrent grants cannot lose one another.
 */

export { levelForXp, levelProgress, xpForCollect, xpForHarvest };

/**
 * Adds experience to a player, inside the caller's transaction.
 *
 * `experience + n` in SQL rather than read-modify-write: harvesting two plots at
 * once must credit both, and a lost update here would be a player quietly
 * failing to reach the level that lets them trade.
 *
 * Returns the new total so a caller can report progress without a second read.
 */
export async function grantXp(tx: Tx, playerId: string, amount: number): Promise<number> {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'Experience must be a whole number.');
  }
  if (amount === 0) return currentXp(tx, playerId);

  const rows = await tx
    .update(schema.players)
    .set({ experience: sql`${schema.players.experience} + ${amount}` })
    .where(eq(schema.players.id, playerId))
    .returning({ experience: schema.players.experience });

  const row = rows[0];
  if (!row) throw new GameError(ErrorCode.NOT_FOUND, 'No such player.');
  return row.experience;
}

async function currentXp(tx: Tx, playerId: string): Promise<number> {
  const rows = await tx
    .select({ experience: schema.players.experience })
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .limit(1);

  return rows[0]?.experience ?? 0;
}
