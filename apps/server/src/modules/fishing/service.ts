import { and, eq, isNull } from 'drizzle-orm';
import {
  BITE_MAX_MS,
  BITE_MIN_MS,
  EnergyAction,
  ErrorCode,
  GameError,
  Season,
  castExpired,
  fishFor,
  reelLands,
  noise,
  rollFish,
  seedFrom,
} from '@tillhaven/shared';
import * as schema from '../../db/schema.js';
import type { Tx } from '../../db/tx.js';
import { spendEnergy } from '../farm/energy.js';
import { addItem, capacityForPlayer, Container } from '../inventory/service.js';
import { farmLevelOf } from '../player/view.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * Casting (T-34.02).
 *
 * **The server rolls the outcome and the bite delay at cast time**, stores both,
 * and tells the client only when to animate. That ordering is the whole design:
 * a fish decided at cast time cannot be influenced by when the player clicks,
 * and a fish the client has never been told cannot be filtered for.
 *
 * **Position is not checked and must never be**, per §5.1 and §4.1. Whether the
 * character is standing at water is a client-side UX gate, exactly like facing a
 * plot to till it. This module would be identical if the pond were somewhere
 * else — which is why it could be built before D-27 was settled.
 */

export interface CastView {
  readonly castId: string;
  /**
   * When to play the bite. **The only thing the client learns**, and it learns
   * it because the animation has to run on its own clock — a bite announced by
   * a round trip would arrive late on every connection.
   *
   * Notably absent: the seed, the fish, the rarity table, and the length of the
   * window the reel will be judged against.
   */
  readonly biteAt: number;
}

/**
 * The seed for one cast.
 *
 * From the player id and the cast's own timestamp, so two players casting in the
 * same millisecond get different fish and one player casting twice does too.
 * **Never sent anywhere** — it exists only inside this transaction.
 */
function castSeed(playerId: string, castAt: number): number {
  return seedFrom(`${playerId}:cast:${castAt}`);
}

/** How long this cast takes to bite, drawn from the same seed. */
export function biteDelay(seed: number): number {
  const span = BITE_MAX_MS - BITE_MIN_MS;
  return Math.round(BITE_MIN_MS + noise(seed, 1) * span);
}

/**
 * Puts a line in the water.
 *
 * **Energy first, and it is the anti-bot control.** A rate limit alone leaves a
 * bot casting at the limit all day; `EnergyAction.CAST` costs 3, so a full bar
 * is thirteen casts whether a person or a script is clicking. `spendEnergy`
 * throws `INSUFFICIENT_ENERGY` having written nothing, so a tired player's
 * refused cast costs them nothing.
 *
 * **One line at a time**, enforced by a partial unique index rather than by a
 * read-then-write: two casts arriving together cannot both open, and the loser
 * is told so rather than silently replacing the first.
 */
export async function castLine(
  tx: Tx,
  player: AuthedPlayer,
  now: number,
  season: Season = Season.SPRING,
): Promise<CastView> {
  const open = await tx
    .select({ id: schema.casts.id })
    .from(schema.casts)
    .where(and(eq(schema.casts.playerId, player.id), isNull(schema.casts.reeledAt)))
    .limit(1);

  if (open.length > 0) {
    throw new GameError(ErrorCode.LINE_ALREADY_OUT, 'Your line is already in the water.');
  }

  await spendEnergy(tx, player, EnergyAction.CAST, now);

  /*
   * The roll. `fishFor` narrows the table to what this farm's level can hook —
   * a level gate the CLIENT is never given, so it cannot know what it is not
   * being offered either.
   */
  const table = fishFor(farmLevelOf(player), season);
  const seed = castSeed(player.id, now);
  const fish = rollFish(seed, 0, table);

  if (!fish) {
    // Cannot happen with the shipped table — `fish.test.ts` proves every season
    // holds at least six fish — but an empty river must not become a null id in
    // a NOT NULL column two lines below.
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'Nothing is biting here.');
  }

  const biteAt = now + biteDelay(seed);

  const inserted = await tx
    .insert(schema.casts)
    .values({ playerId: player.id, castAt: now, biteAt, fishId: fish.id })
    .onConflictDoNothing()
    .returning({ id: schema.casts.id });

  // Empty means another cast won the race for the one open slot.
  if (inserted.length === 0) {
    throw new GameError(ErrorCode.LINE_ALREADY_OUT, 'Your line is already in the water.');
  }

  return { castId: inserted[0]!.id, biteAt };
}

/* ------------------------------------------------------------------ *
 * Reeling (T-34.03)
 * ------------------------------------------------------------------ */

export interface ReelResult {
  readonly castId: string;
  /** Whether the fish was landed. */
  readonly landed: boolean;
  /**
   * What was on the line — revealed **only now**, and only on a success.
   *
   * `null` on a miss, deliberately: telling a player what they just lost turns
   * every miss into a specific regret, and telling a SCRIPT what it lost tells
   * it whether that cast was worth retrying. The one thing a miss must not do
   * is teach the client anything about the roll.
   */
  readonly fishId: string | null;
}

/**
 * Reels in, and the server's clock is the only judge.
 *
 * **`now - biteAt`, computed here, against a window the client is never told.**
 * The payload carries a cast id and an idempotency key; the schema is `.strict()`
 * so a client that helpfully sends its own `reactionMs` gets a 400 rather than a
 * silent success. A client that reports its own reaction time reports a perfect
 * one — this is the one measurement in the game that a player is directly
 * rewarded for lying about.
 *
 * **A miss consumes the cast.** Reeling early is striking at nothing, and if it
 * left the line in the water then hammering the button would be strictly better
 * than watching for the bite — the minigame would be a formality attached to a
 * lottery, which is exactly what T-34.01's difficulty ratings exist to avoid.
 *
 * **The claim is a conditional update**, the same guard shipping and quests use:
 * `WHERE reeled_at IS NULL RETURNING` either wins or returns nothing, so two
 * reels racing cannot both land the same fish.
 */
export async function reelIn(
  tx: Tx,
  player: AuthedPlayer,
  castId: string,
  now: number,
): Promise<ReelResult> {
  const [cast] = await tx
    .select({
      id: schema.casts.id,
      castAt: schema.casts.castAt,
      biteAt: schema.casts.biteAt,
      fishId: schema.casts.fishId,
      reeledAt: schema.casts.reeledAt,
    })
    .from(schema.casts)
    .where(and(eq(schema.casts.id, castId), eq(schema.casts.playerId, player.id)));

  /*
   * One message for "no such cast" and "not yours". A distinct 404 for a cast
   * that exists but belongs to somebody else would confirm the id is real,
   * which is a small oracle nobody needs.
   */
  if (!cast || cast.reeledAt !== null) {
    throw new GameError(ErrorCode.NO_LINE_OUT, 'You have no line in the water.', { castId });
  }

  const landed = reelLands(cast.biteAt, now) && !castExpired(cast.castAt, now);

  const claimed = await tx
    .update(schema.casts)
    .set({ reeledAt: now, landed })
    .where(and(eq(schema.casts.id, cast.id), isNull(schema.casts.reeledAt)))
    .returning({ id: schema.casts.id });

  // Empty means another reel got there first.
  if (claimed.length === 0) {
    throw new GameError(ErrorCode.NO_LINE_OUT, 'You have no line in the water.', { castId });
  }

  if (!landed) return { castId: cast.id, landed: false, fishId: null };

  /*
   * The fish lands in the bag, and `addItem` may refuse. That throw rolls the
   * whole transaction back INCLUDING the reel claim — so a player whose bag is
   * full has not silently lost the fish, they still have a line in the water and
   * a clear `INVENTORY_FULL` to act on. The alternative (claim, then fail to
   * grant) is the one failure this project must never have (§5.5).
   */
  const capacity = await capacityForPlayer(tx, player, Container.INVENTORY, now);
  await addItem(tx, player.id, cast.fishId, 1, { capacity });

  return { castId: cast.id, landed: true, fishId: cast.fishId };
}
