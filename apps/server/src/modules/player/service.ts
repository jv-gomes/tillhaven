import { eq } from 'drizzle-orm';
import { type Appearance, type SelfPlayer } from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { toSelfPlayer } from './view.js';

/**
 * Sets the player's cosmetic character appearance (T-8.01, CLAUDE.md §5.1).
 *
 * Appearance never affects gameplay — no adjacency, tool, or growth check
 * anywhere reads it — so this is a plain single-row write. It still runs
 * through `runIdempotent` (whose transaction this `tx` belongs to) so a
 * flaky-connection retry cannot be told apart from the first attempt by the
 * client, per §4.5.
 */
export async function setAppearance(
  tx: Tx,
  player: AuthedPlayer,
  appearance: Appearance,
  now: number,
): Promise<{ player: SelfPlayer }> {
  await tx
    .update(schema.players)
    .set({ appearance: JSON.stringify(appearance) })
    .where(eq(schema.players.id, player.id));

  return { player: toSelfPlayer({ ...player, appearance }, now) };
}
