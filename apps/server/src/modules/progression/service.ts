import { and, eq, sql } from 'drizzle-orm';
import {
  MILESTONES,
  getMilestone,
  isGrantableItem,
  isMilestoneEarned,
  levelForXp,
  requirementProgress,
  requirementTarget,
  type Milestone,
  type MilestoneProgressInput,
  type MilestoneReward,
} from '@tillhaven/shared';
import { ErrorCode, GameError } from '@tillhaven/shared';
import * as schema from '../../db/schema.js';
import type { Queryable, Tx } from '../../db/tx.js';
import { addItem, capacityForPlayer, Container } from '../inventory/service.js';
import { grantXp } from '../farm/level.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * Milestones: what has been earned, and paying for it (T-30.07).
 *
 * **`grantReward` is deliberately the only place a milestone or a quest moves
 * value.** Phase 33's quests use it unchanged. If they grew their own grant,
 * every duplicate would need its own row in `docs/economy.md`'s gold-writer
 * table and its own faucet entry for the same faucet — and one of the two would
 * eventually drift.
 */

/* ------------------------------------------------------------------ *
 * Granting
 * ------------------------------------------------------------------ */

/**
 * Pays a reward, or throws having paid nothing.
 *
 * Runs inside the caller's transaction (§4.3) and **must be allowed to
 * throw**: `addItem` raises `INVENTORY_FULL` after writing nothing, and if the
 * caller swallowed that, the player would be charged a claim for a reward that
 * never arrived.
 *
 * **Items before gold, and the order is load-bearing.** Gold cannot fail —
 * there is no cap — while items can. Crediting gold first would mean a full
 * backpack leaves the gold written and the transaction rolled back only if the
 * caller remembered to let the error out. Doing the failing part first means
 * the throw happens before anything has been minted.
 */
export async function grantReward(
  tx: Tx,
  player: AuthedPlayer,
  reward: MilestoneReward,
  now: number,
): Promise<void> {
  for (const stack of reward.items) {
    if (!isGrantableItem(stack.itemId)) {
      /*
       * Config is tested (`milestones.test.ts`) and cannot currently express
       * this. The check is here anyway because this function is the boundary
       * quests will also come through, and a tool granted by a quest would be
       * a duplicate of something the game treats as unique per player.
       */
      throw new GameError(ErrorCode.VALIDATION_FAILED, 'That reward cannot be granted.', {
        itemId: stack.itemId,
      });
    }
  }

  for (const stack of reward.items) {
    const capacity = await capacityForPlayer(tx, player, Container.INVENTORY, now);
    // Throws INVENTORY_FULL having written nothing; the caller lets it out and
    // the whole claim rolls back.
    await addItem(tx, player.id, stack.itemId, stack.quantity, { capacity });
  }

  if (reward.gold > 0) {
    await tx
      .update(schema.players)
      .set({ gold: sql`${schema.players.gold} + ${reward.gold}` })
      .where(eq(schema.players.id, player.id));
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * The counters every milestone is measured against, derived on read (§4.2).
 *
 * Six aggregate queries rather than six stored counters. Nothing increments
 * when the player acts; the numbers are recomputed whenever the board is
 * looked at, exactly like crop growth.
 */
export async function progressFor(
  tx: Queryable,
  player: AuthedPlayer,
): Promise<MilestoneProgressInput> {
  const [farm] = await tx
    .select({ id: schema.farms.id })
    .from(schema.farms)
    .where(eq(schema.farms.playerId, player.id));

  if (!farm) throw new GameError(ErrorCode.NOT_FOUND, 'No farm for this player.');

  const [tilled] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.plots)
    .where(and(eq(schema.plots.farmId, farm.id), sql`${schema.plots.tilledAt} is not null`));

  const [unlocked] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.plots)
    .where(and(eq(schema.plots.farmId, farm.id), eq(schema.plots.unlocked, true)));

  const [animals] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.animals)
    .where(eq(schema.animals.farmId, farm.id));

  const [shipments] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.shipments)
    .where(eq(schema.shipments.playerId, player.id));

  return {
    plotsTilled: tilled?.n ?? 0,
    plotsUnlocked: unlocked?.n ?? 0,
    animalsOwned: animals?.n ?? 0,
    shipmentsMade: shipments?.n ?? 0,
    experience: player.experience,
    farmLevel: levelForXp(player.experience),
  };
}

export interface MilestoneView {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  readonly earned: boolean;
  readonly claimed: boolean;
  /** Progress in the requirement's own units, capped at the target. */
  readonly progress: number;
  readonly target: number;
  readonly reward: MilestoneReward;
}

export async function claimedIds(tx: Queryable, playerId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ milestoneId: schema.milestoneClaims.milestoneId })
    .from(schema.milestoneClaims)
    .where(eq(schema.milestoneClaims.playerId, playerId));

  return new Set(rows.map((r: { milestoneId: string }) => r.milestoneId));
}

/** The whole board, in table order. */
export async function boardFor(tx: Queryable, player: AuthedPlayer): Promise<MilestoneView[]> {
  const input = await progressFor(tx, player);
  const claimed = await claimedIds(tx, player.id);

  return MILESTONES.map((m) => viewOf(m, input, claimed.has(m.id)));
}

function viewOf(
  milestone: Milestone,
  input: MilestoneProgressInput,
  claimed: boolean,
): MilestoneView {
  const target = requirementTarget(milestone.requirement);
  return {
    id: milestone.id,
    title: milestone.title,
    hint: milestone.hint,
    earned: isMilestoneEarned(milestone, input),
    claimed,
    // Capped so a level-30 player does not see "30 / 5" against a level-5 goal.
    progress: Math.min(requirementProgress(milestone.requirement, input), target),
    target,
    reward: milestone.reward,
  };
}

/* ------------------------------------------------------------------ *
 * Claiming
 * ------------------------------------------------------------------ */

export interface ClaimResult {
  readonly milestoneId: string;
  readonly reward: MilestoneReward;
  /** Lifetime experience and level after the claim, for the HUD. */
  readonly experience: number;
  readonly farmLevel: number;
}

/**
 * Claims one earned milestone.
 *
 * **The insert is the guard, not the read.** Two concurrent requests can both
 * see "not claimed" and both proceed; the unique index on
 * `(player_id, milestone_id)` means only one insert survives, and the loser's
 * whole transaction — items and gold included — rolls back with it. Checking
 * first and trusting the check would make double-claiming *unlikely*; this
 * makes it impossible.
 *
 * Insert FIRST, then pay. A conflict must abort before anything is minted.
 */
export async function claimMilestone(
  tx: Tx,
  player: AuthedPlayer,
  milestoneId: string,
  now: number,
): Promise<ClaimResult> {
  const milestone = getMilestone(milestoneId);
  if (!milestone) {
    throw new GameError(ErrorCode.NOT_FOUND, 'No such milestone.', { milestoneId });
  }

  const input = await progressFor(tx, player);
  if (!isMilestoneEarned(milestone, input)) {
    throw new GameError(ErrorCode.MILESTONE_NOT_EARNED, 'You have not earned that yet.', {
      milestoneId,
      progress: requirementProgress(milestone.requirement, input),
      target: requirementTarget(milestone.requirement),
    });
  }

  const inserted = await tx
    .insert(schema.milestoneClaims)
    .values({ playerId: player.id, milestoneId, claimedAt: now })
    .onConflictDoNothing()
    .returning({ id: schema.milestoneClaims.id });

  // Empty means the row already existed — either from an earlier session or
  // from a request that won the race a moment ago.
  if (inserted.length === 0) {
    throw new GameError(ErrorCode.MILESTONE_ALREADY_CLAIMED, 'You already claimed that.', {
      milestoneId,
    });
  }

  await grantReward(tx, player, milestone.reward, now);

  /*
   * Milestones grant no experience today, so this is a read rather than a
   * grant — but the HUD wants the same `{ experience, farmLevel }` pair every
   * other action returns (T-30.02), and going through `grantXp(0)` keeps one
   * definition of "what is this player's XP now" instead of a second query
   * that could disagree.
   */
  const experience = await grantXp(tx, player.id, 0);

  return {
    milestoneId,
    reward: milestone.reward,
    experience,
    farmLevel: levelForXp(experience),
  };
}
