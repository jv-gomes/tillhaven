import { ITEMS, ItemCategory, MINUTE } from '@tillhaven/shared/config';
import type { IdleSummaryView } from '@tillhaven/shared/types';

/**
 * "While you were away…" (T-13.08, CLAUDE.md §5.3).
 *
 * The server reports what the farmer got through on the one read that applied
 * it, and never again — so "show it once" is already true of the protocol, and
 * nothing here has to remember whether it has spoken. All this decides is
 * whether the news is worth interrupting someone about, and how to say it.
 *
 * Pure, so the wording and the threshold can be tested without a canvas: the
 * interesting cases are a farmer that did nothing worth mentioning, a poll gap
 * too short to call an absence, and a bag that filled up.
 */

/**
 * The shortest absence worth announcing.
 *
 * A minute, because the farm poll runs every twenty seconds and the catch-up
 * fires whenever a whole `IDLE_ACTION_MS` has passed — so a player sitting and
 * watching their farmer work generates a summary every single poll. Those are
 * not absences and toasting them would turn the feature into a nag. Anything
 * longer than a minute means they actually went somewhere, even if only to
 * another tab.
 */
export const IDLE_SUMMARY_MIN_GAP_MS = MINUTE;

/** Item names come from config, so the toast and the bag agree (§4.4). */
function itemName(itemId: string): string {
  return ITEMS[itemId as keyof typeof ITEMS]?.name ?? itemId;
}

/**
 * The toast, or null when there is nothing to say.
 *
 * Null on three counts, and they are different: no summary at all (the usual
 * poll), a gap too short to be an absence, and — the one that is easy to
 * forget — a summary whose every count is zero. The applier only sends one when
 * it did something, but "did something" includes a shift that was entirely
 * inventory-blocked, and "While you were away:" followed by nothing is worse
 * than silence.
 */
export function idleSummaryMessage(summary: IdleSummaryView | null): string | null {
  if (!summary) return null;
  if (summary.window.to - summary.window.from < IDLE_SUMMARY_MIN_GAP_MS) return null;

  const parts: string[] = [];
  if (summary.tilled > 0) parts.push(`tilled ${summary.tilled}`);
  if (summary.planted > 0) parts.push(`planted ${summary.planted}`);
  if (summary.watered > 0) parts.push(`watered ${summary.watered}`);

  /*
   * Loot is named, and the rest is not, deliberately. A count of plots watered
   * is progress; a count of things gained is LOOT, and the player wants to know
   * it was four leeks rather than four somethings. Sorted by item id so the
   * sentence reads the same way twice for the same haul.
   *
   * **The verb comes from the item's category** (T-20.06), not from the field
   * name. This loop said "picked" for everything, which was right while
   * everything here was a crop — and became wrong the moment idle chopping put
   * wood in the same map, reporting "picked 15 × Wood". Asking config keeps it
   * right for whatever the next material is, without a second list to maintain.
   */
  for (const [itemId, quantity] of Object.entries(summary.harvested).sort()) {
    if (quantity <= 0) continue;
    const verb = ITEMS[itemId]?.category === ItemCategory.MATERIAL ? 'chopped' : 'picked';
    parts.push(`${verb} ${quantity} × ${itemName(itemId)}`);
  }

  if (parts.length === 0 && !summary.bagWasFull) return null;

  const worked = parts.length > 0 ? `While you were away: ${parts.join(', ')}.` : null;
  // The one line here that is a nudge rather than news, so it is always said —
  // including when a full bag is the only reason there is nothing else to say.
  const full = summary.bagWasFull ? 'Your bag filled up, so a ripe crop is still standing.' : null;

  return [worked, full].filter(Boolean).join(' ');
}
