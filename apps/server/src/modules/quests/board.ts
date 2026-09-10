import { QUESTS, dailyRequestsFor, rotationEndsAt, type Quest } from '@tillhaven/shared';
import type { Queryable } from '../../db/tx.js';
import { farmLevelOf } from '../player/view.js';
import { questsFor } from './service.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * What the player may take on, what they are holding, and what they finished
 * (T-33.05; T-33.06 will rotate and enrich it).
 *
 * **Offers are derived from `unlockLevel` and nothing else**, which is only safe
 * because `quests.test.ts` proves every requirement of a quest is obtainable at
 * that level. The board does not re-check obtainability per request; the data
 * carries that guarantee, which is the point of putting it there.
 *
 * **Derived on read (§4.2).** The only stored state is which quests were taken
 * on and which were finished — three rows for a player who has done everything.
 * Everything else is recomputed.
 */

export type QuestStatus = 'available' | 'accepted' | 'completed';

export interface QuestBoard {
  readonly quests: QuestView[];
  /**
   * When the derived half turns over, so the panel can say so without owning a
   * copy of `QUEST_ROTATION_MS`. Epoch ms (§10).
   */
  readonly rotationEndsAt: number;
}

export interface QuestView {
  readonly id: string;
  readonly giver: string;
  readonly title: string;
  readonly summary: string;
  readonly requires: readonly { readonly itemId: string; readonly quantity: number }[];
  readonly reward: Quest['reward'];
  readonly unlockLevel: number;
  readonly status: QuestStatus;
  /** Derived requests expire with the rotation; authored ones never do. */
  readonly rotating: boolean;
}

export async function boardFor(
  tx: Queryable,
  player: AuthedPlayer,
  now: number,
): Promise<QuestBoard> {
  const farmLevel = farmLevelOf(player);
  const rows = await questsFor(tx, player);
  const byId = new Map(rows.map((r) => [r.questId, r]));

  const views: QuestView[] = [];

  /*
   * The derived half first: it expires, so it is the half a player should act on
   * today. The authored quests are still there tomorrow.
   */
  for (const request of dailyRequestsFor(player.id, farmLevel, now)) {
    const row = byId.get(request.id);
    // A completed rotating request drops off its own board rather than sitting
    // there ticked. It cannot be taken again, and the rotation will replace it.
    if (row?.completedAt != null) continue;

    views.push({
      id: request.id,
      giver: request.giver,
      title: request.title,
      summary: request.summary,
      requires: request.requires,
      reward: request.reward,
      unlockLevel: request.unlockLevel,
      status: row ? 'accepted' : 'available',
      rotating: true,
    });
  }

  for (const quest of QUESTS) {
    const row = byId.get(quest.id);

    /*
     * A quest below the player's level that they have not taken on is simply
     * not shown. It is not "locked" — showing a list of things you cannot do
     * yet is how a board teaches a player to stop reading it (T-33.06's rule).
     *
     * A quest they HAVE taken on is always shown, even if the level table later
     * changed underneath them: they are holding it, and a board that hid an
     * accepted quest would leave the goods in their bag with nothing to do.
     */
    if (!row && quest.unlockLevel > farmLevel) continue;

    const status: QuestStatus = !row ? 'available' : row.completedAt !== null ? 'completed' : 'accepted';

    views.push({
      id: quest.id,
      giver: quest.giver,
      title: quest.title,
      summary: quest.summary,
      requires: quest.requires,
      reward: quest.reward,
      unlockLevel: quest.unlockLevel,
      status,
      rotating: false,
    });
  }

  return { quests: views, rotationEndsAt: rotationEndsAt(now) };
}
