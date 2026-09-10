import { eq, sql } from 'drizzle-orm';
import {
  ErrorCode,
  GameError,
  energyCostOf,
  energySpentAfterSleep,
  energyStateAt,
  levelForXp,
  type EnergyAction,
  type EnergyState,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * Spending energy (MVP re-scope).
 *
 * **One function, and every mutating farm action goes through it.** Till,
 * plant, water, harvest, chop, collect and feed each charge here inside their
 * own transaction, so an action that cannot be paid for writes nothing at all
 * (§4.3) and a partial spend is not expressible.
 *
 * **Nothing the client sends is consulted.** The cost comes from shared config
 * and the balance from the player's own row — the same shape as the farm-level
 * shop gate, and for a stronger reason: energy is the only thing standing
 * between a script and unlimited farming.
 */

/** The player's energy right now, settling any sleep on the way past. */
export function energyOf(player: AuthedPlayer, now: number): EnergyState {
  return energyStateAt(
    { energySpent: player.energySpent, sleepingSince: player.sleepingSince },
    levelForXp(player.experience),
    now,
  );
}

/**
 * Charges one action, or throws having written nothing.
 *
 * **A sleeping farmer cannot work.** Refused before the balance is even
 * looked at: the alternative is a player who lies in bed while their
 * character tills, which is both nonsense and a way to farm during the one
 * period the game is giving energy back.
 *
 * **The UPDATE is conditional, and that is the whole concurrency story.**
 * `where energy_spent = <what we read>` means two requests that both saw the
 * same balance cannot both succeed: the second matches no row and is refused.
 * Without it, two tabs pressing the action key together would each pay once
 * for two actions. A row lock would work too and would serialise every action
 * on the farm behind one mutex; this costs a `WHERE` clause.
 */
export async function spendEnergy(
  tx: Tx,
  player: AuthedPlayer,
  action: EnergyAction,
  now: number,
): Promise<void> {
  if (player.sleepingSince !== null) {
    throw new GameError(ErrorCode.ASLEEP, 'You are asleep.', { action });
  }

  const cost = energyCostOf(action);
  const state = energyOf(player, now);

  if (state.current < cost) {
    throw new GameError(ErrorCode.INSUFFICIENT_ENERGY, 'You are too tired.', {
      action,
      cost,
      energy: state.current,
      max: state.max,
    });
  }

  const updated = await tx
    .update(schema.players)
    .set({ energySpent: sql`${schema.players.energySpent} + ${cost}` })
    .where(
      sql`${schema.players.id} = ${player.id} and ${schema.players.energySpent} = ${player.energySpent}`,
    )
    .returning({ id: schema.players.id });

  if (updated.length === 0) {
    /*
     * Someone else spent from this balance between the read and the write.
     * Refusing is right: the caller's own checks were made against a balance
     * that no longer exists, and retrying is the client's decision.
     */
    throw new GameError(ErrorCode.INSUFFICIENT_ENERGY, 'You are too tired.', {
      action,
      cost,
      energy: state.current,
      max: state.max,
      // `details` is `Record<string, string | number>`; a flag reads as 1.
      raced: 1,
    });
  }
}

/**
 * Re-reads the player's energy columns.
 *
 * **This is what makes the batch actions work.** `harvestAll` and `collectAll`
 * call the single-item service once per plot or animal, and each of those
 * charges with a conditional `where energy_spent = <what it read>` — so the
 * `AuthedPlayer` handed to the second iteration is stale and would look like a
 * race against ourselves. They re-read here between iterations instead.
 *
 * An earlier version charged the whole batch up front with a `spendEnergyUpTo`
 * helper. That was deleted: it duplicated the affordability rule in a second
 * place, and letting each item pay for itself means a batch that stops halfway
 * has charged for exactly what it did.
 */
export async function readEnergyRow(
  tx: Tx,
  playerId: string,
): Promise<{ energySpent: number; sleepingSince: number | null }> {
  const [row] = await tx
    .select({
      energySpent: schema.players.energySpent,
      sleepingSince: schema.players.sleepingSince,
    })
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .limit(1);

  if (!row) throw new GameError(ErrorCode.NOT_FOUND, 'No such player.');
  return row;
}

/* ------------------------------------------------------------------ *
 * Sleep
 * ------------------------------------------------------------------ */

export interface SleepResult {
  readonly sleepingSince: number;
  readonly energy: EnergyState;
}

export interface WakeResult {
  readonly sleptForMs: number;
  readonly recovered: number;
  readonly energy: EnergyState;
}

/**
 * Lies down.
 *
 * **Nothing is scheduled.** Going to bed writes one timestamp; how much energy
 * the player has from then on is `now - sleepingSince` measured against
 * `SLEEP_DURATION_MS`, computed by whoever asks (§4.2). There is no wake-up
 * job, and a player who closes the tab mid-sleep still wakes rested.
 *
 * **Sleeping while asleep is not an error.** It returns the existing
 * `sleepingSince` rather than restarting the clock — restarting it would mean
 * a double-click cost the player everything they had slept for, which is the
 * worst possible reading of a harmless second press.
 */
export async function sleep(
  tx: Tx,
  player: AuthedPlayer,
  now: number,
): Promise<SleepResult> {
  if (player.sleepingSince !== null) {
    return { sleepingSince: player.sleepingSince, energy: energyOf(player, now) };
  }

  await tx
    .update(schema.players)
    .set({ sleepingSince: now })
    .where(eq(schema.players.id, player.id));

  return {
    sleepingSince: now,
    energy: energyStateAt(
      { energySpent: player.energySpent, sleepingSince: now },
      levelForXp(player.experience),
      now,
    ),
  };
}

/**
 * Gets up, banking whatever the sleep was worth.
 *
 * **The recovery is banked into `energySpent`, not recomputed.** Clearing
 * `sleepingSince` without settling would throw away the whole rest; settling
 * first turns however long they lay there into a permanent number. Waking
 * early is therefore worth exactly its fraction — see `energyRecovered`.
 *
 * Waking while awake is a no-op that reports the current bar, for the same
 * reason sleeping while asleep is: a stray second press must not be an error
 * the player has to understand.
 */
export async function wake(tx: Tx, player: AuthedPlayer, now: number): Promise<WakeResult> {
  const before = energyOf(player, now);

  if (player.sleepingSince === null) {
    return { sleptForMs: 0, recovered: 0, energy: before };
  }

  const level = levelForXp(player.experience);
  const row = { energySpent: player.energySpent, sleepingSince: player.sleepingSince };
  const spentAfter = energySpentAfterSleep(row, level, now);

  await tx
    .update(schema.players)
    .set({ energySpent: spentAfter, sleepingSince: null })
    .where(eq(schema.players.id, player.id));

  return {
    sleptForMs: Math.max(0, now - player.sleepingSince),
    recovered: player.energySpent - spentAfter,
    energy: energyStateAt({ energySpent: spentAfter, sleepingSince: null }, level, now),
  };
}
