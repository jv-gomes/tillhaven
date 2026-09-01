import { ErrorCode, GOLD_IS_TRADEABLE, GameError, getItem } from '@tillhaven/shared';

/**
 * What an offer may contain (CLAUDE.md §6).
 *
 * Pure: no database, no clock. Whether the player actually *holds* the items is
 * a separate question the service asks — this decides whether the offer is
 * coherent at all, which is worth answering before touching any rows.
 */

export interface OfferItem {
  readonly itemId: string;
  readonly quantity: number;
}

/**
 * Checks and normalises an offer.
 *
 * **Duplicate item ids are rejected rather than summed.** Two entries for the
 * same item is a client bug, and quietly adding them together would mean the
 * offer a player confirms is not the offer they were shown — which is the exact
 * class of confusion this whole system is built to prevent.
 */
export function normaliseOffer(items: readonly OfferItem[], gold: number): OfferItem[] {
  if (!Number.isInteger(gold) || gold < 0) {
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'Gold must be a whole number.');
  }

  /*
   * OPEN DECISION D-3 (§14): gold is not tradeable. The columns and this field
   * exist so flipping it needs no migration, but until it is decided the server
   * refuses any non-zero amount rather than silently dropping it — a player who
   * offered gold and saw it vanish would have every reason to cry scam.
   */
  if (gold > 0 && !GOLD_IS_TRADEABLE) {
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'Gold cannot be traded.');
  }

  const seen = new Set<string>();
  const normalised: OfferItem[] = [];

  for (const entry of items) {
    if (!Number.isInteger(entry.quantity) || entry.quantity <= 0) {
      throw new GameError(ErrorCode.VALIDATION_FAILED, 'Offer a whole number of items.', {
        itemId: entry.itemId,
      });
    }

    const def = getItem(entry.itemId);
    if (!def) {
      throw new GameError(ErrorCode.UNKNOWN_ITEM, 'No such item.', { itemId: entry.itemId });
    }
    if (!def.tradeable) {
      throw new GameError(ErrorCode.VALIDATION_FAILED, `${def.name} cannot be traded.`, {
        itemId: entry.itemId,
      });
    }

    if (seen.has(entry.itemId)) {
      throw new GameError(ErrorCode.VALIDATION_FAILED, 'That item is listed twice.', {
        itemId: entry.itemId,
      });
    }
    seen.add(entry.itemId);

    normalised.push({ itemId: entry.itemId, quantity: entry.quantity });
  }

  // Stable order, so two offers with the same contents serialise identically
  // and a no-op "change" is recognisable as one.
  return normalised.sort((a, b) => a.itemId.localeCompare(b.itemId));
}

/** Serialises for the `text` column. Sorted by `normaliseOffer` already. */
export function encodeOffer(items: readonly OfferItem[]): string {
  return JSON.stringify(items);
}

/**
 * Reads an offer back.
 *
 * Tolerant of nonsense: a malformed column reads as an empty offer rather than
 * throwing, because the alternative is one bad row making a trade impossible to
 * even look at — including impossible to cancel.
 */
export function decodeOffer(raw: string): OfferItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry): OfferItem[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { itemId, quantity } = entry as Partial<OfferItem>;
      if (typeof itemId !== 'string' || typeof quantity !== 'number') return [];
      return [{ itemId, quantity }];
    });
  } catch {
    return [];
  }
}

/** True when two offers are the same, ignoring order. */
export function sameOffer(a: readonly OfferItem[], b: readonly OfferItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, index) => {
    const other = b[index];
    return other?.itemId === entry.itemId && other.quantity === entry.quantity;
  });
}
