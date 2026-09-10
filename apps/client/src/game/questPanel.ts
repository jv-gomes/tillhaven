import { ITEMS } from '@tillhaven/shared/config';
import type { QuestView } from '../net/quests.js';

/**
 * The quest log's rows (T-33.07).
 *
 * **The pure half, split out for the reason `milestonePanel.ts` split
 * `goalRows`**: what a row SAYS is decided here and tested in node, and the
 * panel only turns rows into elements. The interesting failures — a request
 * showing as ready when the bag is one carrot short, a rotating request sorted
 * below a permanent one on the last day of its rotation — are all decidable
 * without a browser.
 *
 * It lives in its own file rather than in `milestonePanel.ts` because the two
 * lists have nothing in common but the panel that holds them: a goal is a
 * counter the server derives, a request is a shopping list the player fills.
 */

export interface QuestRow {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** `2 / 4 Leek`, one line per required item. */
  readonly needs: readonly string[];
  /** 0–100 across every requirement, for the bar. Integer, like `goalPercent`. */
  readonly percent: number;
  readonly rewardText: string;
  readonly status: QuestView['status'];
  /** Accepted, and every requirement is in the bag. */
  readonly turnInReady: boolean;
  /** Not yet taken on. */
  readonly acceptable: boolean;
  /** Expires with the rotation, so it is worth marking. */
  readonly rotating: boolean;
}

/** How many of an item the player is holding. */
export type HeldCount = (itemId: string) => number;

function itemName(itemId: string): string {
  return ITEMS[itemId]?.name ?? itemId;
}

/**
 * How far along a request is, across every item it asks for.
 *
 * **Capped per requirement before summing**, which is the whole subtlety: a
 * player holding thirty carrots and no potatoes is not 80% done with a request
 * for six carrots and three potatoes. Without the cap the surplus of one item
 * fills the bar for the other, and the row would say "nearly there" to somebody
 * who cannot finish at all.
 */
export function questPercent(quest: QuestView, held: HeldCount): number {
  const total = quest.requires.reduce((sum, need) => sum + need.quantity, 0);
  if (total <= 0) return 0;

  const have = quest.requires.reduce(
    (sum, need) => sum + Math.min(need.quantity, Math.max(0, held(need.itemId))),
    0,
  );
  return Math.max(0, Math.min(100, Math.round((have / total) * 100)));
}

/** Whether every requirement is met. Not a percentage test — rounding lies at 99.5%. */
export function canTurnIn(quest: QuestView, held: HeldCount): boolean {
  return quest.requires.every((need) => held(need.itemId) >= need.quantity);
}

/** What the request pays, named rather than counted. */
export function questRewardText(quest: QuestView): string {
  const parts: string[] = [];
  if (quest.reward.gold > 0) parts.push(`${quest.reward.gold.toLocaleString()}g`);
  for (const stack of quest.reward.items) {
    parts.push(`${stack.quantity} × ${itemName(stack.itemId)}`);
  }
  return parts.length > 0 ? parts.join(' and ') : 'nothing';
}

/**
 * The rows, in the order the log shows them.
 *
 * **Ready-to-hand-in first, then rotating, then the rest.** The same principle
 * `nextGoals` uses: a reward waiting to be collected is the most useful thing a
 * panel can point at, and after that the thing with a deadline. Completed
 * requests drop out entirely rather than accumulating as a wall of ticks — the
 * board is for what to do next, and a log of everything ever done is a different
 * feature nobody asked for.
 */
export function questRows(quests: readonly QuestView[], held: HeldCount): QuestRow[] {
  const rows = quests
    .filter((q) => q.status !== 'completed')
    .map((quest): QuestRow => {
      const ready = quest.status === 'accepted' && canTurnIn(quest, held);
      return {
        id: quest.id,
        title: quest.title,
        summary: quest.summary,
        needs: quest.requires.map(
          (need) =>
            `${Math.min(need.quantity, Math.max(0, held(need.itemId)))} / ${need.quantity} ` +
            itemName(need.itemId),
        ),
        percent: questPercent(quest, held),
        rewardText: questRewardText(quest),
        status: quest.status,
        turnInReady: ready,
        acceptable: quest.status === 'available',
        rotating: quest.rotating,
      };
    });

  const rank = (row: QuestRow): number => (row.turnInReady ? 0 : row.rotating ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b));
}

export const NO_REQUESTS = 'Nobody needs anything right now. Check back later.';
