import { api, idempotencyKey } from './api.js';

/**
 * Trade API wrapper (CLAUDE.md §6).
 *
 * Every mutating call here sends an INTENT — an item id and quantity, a
 * revision being confirmed, a trade id — never a computed outcome. The
 * server's response is the only state this module ever trusts; nothing here
 * predicts what a call will do before the response says so.
 */

/**
 * The wire contract, imported rather than redeclared (T-18.21, BUG-17).
 *
 * These four were written out by hand here AND in
 * `apps/server/src/modules/trade/service.ts`, and the copies had **drifted**:
 * this file said `'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'`
 * where the server sends `'pending' | 'open' | …`. `tradePanel.ts` compares
 * `status === 'ACTIVE'`, so every status branch in the panel was dead code that
 * could never be reached. Nothing imports the panel, so nothing ran and nothing
 * noticed — the exact failure BUG-17 predicted.
 *
 * §10: shared types are defined once in `packages/shared` and imported by both
 * sides. Now they are, and the next divergence is a compile error.
 */
export type {
  TradeOfferItem,
  TradeSide,
  TradeStatus,
  TradeView,
} from '@tillhaven/shared';
import type { TradeOfferItem, TradeView } from '@tillhaven/shared';

export function fetchCurrentTrade(): Promise<{ trade: TradeView | null }> {
  return api.get<{ trade: TradeView | null }>('/trade/current');
}

export function fetchTrade(tradeId: string): Promise<TradeView> {
  return api.get<TradeView>(`/trade/${tradeId}`);
}

export function inviteTrade(targetUsername: string, key = idempotencyKey()): Promise<TradeView> {
  return api.post<TradeView>('/trade/invite', { targetUsername, idempotencyKey: key });
}

export function acceptTrade(tradeId: string, key = idempotencyKey()): Promise<TradeView> {
  return api.post<TradeView>('/trade/accept', { tradeId, idempotencyKey: key });
}

/**
 * Replaces the caller's own side. Which side that is comes from the session
 * on the server — there is no field for it here, so there is nothing to send
 * that could put an offer on the wrong side of the table.
 *
 * `gold` is always sent as 0: GOLD_IS_TRADEABLE is false (D-3, still open in
 * ROADMAP.md), and the server rejects anything else outright.
 */
export function setTradeOffer(
  tradeId: string,
  items: readonly TradeOfferItem[],
  key = idempotencyKey(),
): Promise<TradeView> {
  return api.post<TradeView>('/trade/offer', { tradeId, items, gold: 0, idempotencyKey: key });
}

/**
 * Confirms against a SPECIFIC revision — the one the player was just shown.
 * There is no "confirm whatever is current" call; that would be the exact
 * scam this system exists to prevent (CLAUDE.md §6).
 */
export function confirmTrade(
  tradeId: string,
  revision: number,
  key = idempotencyKey(),
): Promise<TradeView> {
  return api.post<TradeView>('/trade/confirm', { tradeId, revision, idempotencyKey: key });
}

export function executeTrade(tradeId: string, key = idempotencyKey()): Promise<TradeView> {
  return api.post<TradeView>('/trade/execute', { tradeId, idempotencyKey: key });
}

/** Not idempotency-keyed on the server — walking away must always work. */
export function cancelTrade(tradeId: string): Promise<TradeView> {
  return api.post<TradeView>('/trade/cancel', { tradeId });
}

export interface TradeHistoryEntry {
  readonly tradeId: string;
  readonly counterpartyId: string;
  readonly counterpartyName: string;
  readonly youWereInitiator: boolean;
  readonly yourItems: readonly TradeOfferItem[];
  readonly theirItems: readonly TradeOfferItem[];
  readonly yourGold: number;
  readonly theirGold: number;
  readonly completedAt: number;
}

export interface TradeHistoryPage {
  readonly entries: readonly TradeHistoryEntry[];
  /** Opaque — pass back verbatim for the next page. Null once there is no more (T-4.12). */
  readonly nextCursor: string | null;
}

export function fetchTradeHistory(cursor: string | null = null, limit = 20): Promise<TradeHistoryPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return api.get<TradeHistoryPage>(`/trade/history?${params.toString()}`);
}
