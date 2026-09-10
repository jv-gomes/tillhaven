import { and, eq, isNull } from 'drizzle-orm';
import {
  ErrorCode,
  GameError,
  levelForXp,
  dailyRequestsFor,
  questsForLevel,
  resolveQuest,
  type Quest,
  type MilestoneReward,
} from '@tillhaven/shared';
import * as schema from '../../db/schema.js';
import type { Queryable, Tx } from '../../db/tx.js';
import { removeItem } from '../inventory/service.js';
import { grantReward } from '../progression/service.js';
import { grantXp } from '../farm/level.js';
import { farmLevelOf } from '../player/view.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * Quests: accepting one, and turning one in (T-33.05).
 *
 * **The reward path is `grantReward`, unchanged.** That function is the single
 * place value enters a player, and its own comment anticipated this module by
 * three phases. Quests therefore inherit its tool guard, its items-before-gold
 * ordering and its `INVENTORY_FULL` rollback without restating any of them.
 *
 * **Everything a client sends is an id.** Whether a quest is offered comes from
 * the farm's level, which the server derives; whether the player has the goods
 * is a locked read of their own inventory; whether it is already done is a
 * unique index. Nothing here trusts a number that arrived over the wire (§4.1).
 */

export interface QuestState {
  readonly questId: string;
  readonly acceptedAt: number;
  readonly completedAt: number | null;
}

export interface TurnInResult {
  readonly questId: string;
  readonly reward: MilestoneReward;
  readonly experience: number;
  readonly farmLevel: number;
}

/** Every quest row this player has, accepted or finished. */
export async function questsFor(tx: Queryable, player: AuthedPlayer): Promise<QuestState[]> {
  const rows = await tx
    .select({
      questId: schema.questProgress.questId,
      acceptedAt: schema.questProgress.acceptedAt,
      completedAt: schema.questProgress.completedAt,
    })
    .from(schema.questProgress)
    .where(eq(schema.questProgress.playerId, player.id));

  return rows.map((r) => ({
    questId: r.questId,
    acceptedAt: r.acceptedAt,
    completedAt: r.completedAt ?? null,
  }));
}

/**
 * Looks a request up — authored or derived — or refuses.
 *
 * An id nothing can resolve is `NOT_FOUND` rather than a silent no-op: the
 * client builds its board from the same functions, so an unknown id means the
 * two are out of step and saying so is more useful than pretending.
 *
 * **A derived request resolves only within its own rotation** (T-33.06), because
 * `dailyRequestsFor` is seeded on the rotation index. That is what makes a stale
 * offer refuse itself with no stored history of what used to be on the board.
 */
function requireQuest(
  questId: string,
  player: AuthedPlayer,
  now: number,
): Quest {
  const quest = resolveQuest(questId, player.id, farmLevelOf(player), now);
  if (!quest) throw new GameError(ErrorCode.NOT_FOUND, 'No such request.', { questId });
  return quest;
}

/**
 * Accepts a quest.
 *
 * **The level check is here and not only on the board**, because the board is a
 * suggestion and this is the gate. A client that remembers a quest id from a
 * higher-levelled alt, or simply posts one, is refused by the same arithmetic
 * that decides what the board shows.
 *
 * The insert is `onConflictDoNothing().returning()` for the reason
 * `claimMilestone` uses it: **an empty result means another request won the
 * race**, and that is decidable without a lock or a read-then-write.
 */
export async function acceptQuest(
  tx: Tx,
  player: AuthedPlayer,
  questId: string,
  now: number,
): Promise<QuestState> {
  const quest = requireQuest(questId, player, now);
  /*
   * Derived from the session's experience, never stored and never sent
   * (`modules/farm/level.ts`). The same function `toSelfPlayer` and the trade
   * gate use, so a quest cannot be offered on one definition of "level" and
   * refused on another.
   */
  const farmLevel = farmLevelOf(player);

  /*
   * On offer right now, from both halves of the board. The derived half is
   * already rotation-scoped by `requireQuest`, so reaching it here means it IS
   * this rotation's — but it is listed rather than assumed, so adding a third
   * source of requests cannot quietly bypass the gate.
   */
  const offered = [...questsForLevel(farmLevel), ...dailyRequestsFor(player.id, farmLevel, now)];
  if (!offered.some((q) => q.id === quest.id)) {
    throw new GameError(ErrorCode.QUEST_NOT_AVAILABLE, 'That is not offered to you yet.', {
      questId,
      farmLevel,
      unlockLevel: quest.unlockLevel,
    });
  }

  const inserted = await tx
    .insert(schema.questProgress)
    .values({ playerId: player.id, questId, acceptedAt: now })
    .onConflictDoNothing()
    .returning({ acceptedAt: schema.questProgress.acceptedAt });

  if (inserted.length === 0) {
    throw new GameError(ErrorCode.QUEST_ALREADY_ACCEPTED, 'You already took that on.', {
      questId,
    });
  }

  return { questId, acceptedAt: inserted[0]!.acceptedAt, completedAt: null };
}

/**
 * Turns a quest in: consumes the goods and pays, in one transaction (§4.3).
 *
 * **The completion is claimed BEFORE anything is consumed, and that ordering is
 * the whole anti-double-pay.** The `UPDATE ... WHERE completed_at IS NULL
 * RETURNING` either wins or returns nothing, exactly the guard
 * `modules/shipping/service.ts` uses — so of two concurrent turn-ins only one
 * proceeds past this line, and the loser has consumed nothing because it never
 * reached the consume.
 *
 * Doing it the other way round — consume, then mark done — means two requests
 * can both pass the "do you have the items" read, both consume, and one then
 * discovers the quest is already complete. Its rollback saves it, but only
 * because the whole thing is one transaction; relying on that is relying on the
 * rollback rather than on the design.
 *
 * **Then `removeItem` per requirement, before `grantReward`.** `removeItem`
 * takes `FOR UPDATE` on the player's slots and throws `INSUFFICIENT_ITEMS`
 * having written nothing, so a player who is one carrot short loses nothing.
 *
 * **That ordering is about playability, not safety, and it is worth being
 * precise about which.** Break-testing the reverse order — grant, then consume —
 * passed every other test in this module, because the whole thing is one
 * transaction and a failure at either end unwinds both. What it broke was a
 * turn-in from a FULL backpack: the four leeks the quest wants are vacating the
 * exact slot the reward needs, so consuming first makes room that granting first
 * never sees, and the player is told their bag is full while holding the goods
 * that would empty it. `routes.integration.test.ts` has the test that says so.
 */
export async function turnInQuest(
  tx: Tx,
  player: AuthedPlayer,
  questId: string,
  now: number,
): Promise<TurnInResult> {
  const quest = requireQuest(questId, player, now);

  /*
   * Read the row first, so "you never took this on" and "you already finished
   * it" are different messages. The read is not the guard — the conditional
   * update below is — it only decides which refusal the player sees.
   */
  const [existing] = await tx
    .select({ completedAt: schema.questProgress.completedAt })
    .from(schema.questProgress)
    .where(
      and(
        eq(schema.questProgress.playerId, player.id),
        eq(schema.questProgress.questId, questId),
      ),
    );

  if (!existing) {
    throw new GameError(ErrorCode.QUEST_NOT_ACCEPTED, 'You have not taken that on.', { questId });
  }
  if (existing.completedAt !== null) {
    throw new GameError(ErrorCode.QUEST_ALREADY_COMPLETED, 'You already handed that in.', {
      questId,
    });
  }

  // The guard. An empty result means another request completed it first.
  const claimed = await tx
    .update(schema.questProgress)
    .set({ completedAt: now })
    .where(
      and(
        eq(schema.questProgress.playerId, player.id),
        eq(schema.questProgress.questId, questId),
        isNull(schema.questProgress.completedAt),
      ),
    )
    .returning({ id: schema.questProgress.id });

  if (claimed.length === 0) {
    throw new GameError(ErrorCode.QUEST_ALREADY_COMPLETED, 'You already handed that in.', {
      questId,
    });
  }

  for (const need of quest.requires) {
    // Throws INSUFFICIENT_ITEMS having written nothing; the whole turn-in rolls
    // back, including the completion claimed above.
    await removeItem(tx, player.id, need.itemId, need.quantity);
  }

  await grantReward(tx, player, quest.reward, now);

  /*
   * Quests grant no experience today, so this is a read rather than a grant —
   * but every other paying action returns the same `{ experience, farmLevel }`
   * pair (T-30.02), and going through `grantXp(0)` keeps one definition of
   * "what is this player's XP now" rather than a second query that could
   * disagree. Exactly what `claimMilestone` does, for the same reason.
   */
  const experience = await grantXp(tx, player.id, 0);

  return {
    questId,
    reward: quest.reward,
    experience,
    farmLevel: levelForXp(experience),
  };
}
