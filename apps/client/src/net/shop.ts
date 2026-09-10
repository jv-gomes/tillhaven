import type { AnimalBuilding } from '@tillhaven/shared/config';
import { api, idempotencyKey } from './api.js';

/**
 * Shop API wrapper.
 *
 * The client sends what item and how many. It never sends a price — the server
 * reads that from config (CLAUDE.md §4.1). Gold in the response is
 * authoritative and replaces whatever the HUD was showing.
 */

export interface ShopEntry {
  readonly itemId: string;
  readonly name: string;
  readonly category: string;
  readonly buyPrice: number | null;
  readonly sellPrice: number | null;
  /**
   * Farm level needed to buy this, or `null` when nothing gates it (T-31.06).
   *
   * **The fourth time this repo has had to add a field the server was already
   * sending** — `SelfPlayer` (T-30.01), `HarvestResult` (T-30.02),
   * `CollectResult` (T-30.04) and now this. The wire has never been the
   * problem; the client's own declarations were. Worth naming as a pattern:
   * when a server view gains a field, the matching interface in `net/` is the
   * thing that quietly drops it, and nothing fails until something tries to
   * read it.
   */
  readonly unlockLevel: number | null;
}

export interface TradeResult {
  readonly itemId: string;
  readonly quantity: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
}

export function fetchShop(): Promise<{ items: ShopEntry[] }> {
  return api.get<{ items: ShopEntry[] }>('/shop');
}

export function buyItem(
  itemId: string,
  quantity: number,
  key = idempotencyKey(),
): Promise<TradeResult> {
  return api.post<TradeResult>('/shop/buy', { itemId, quantity, idempotencyKey: key });
}

export function sellItem(
  itemId: string,
  quantity: number,
  key = idempotencyKey(),
): Promise<TradeResult> {
  return api.post<TradeResult>('/shop/sell', { itemId, quantity, idempotencyKey: key });
}

export interface BackpackUpgradeResult {
  readonly tier: number;
  /** Slots after the purchase, VIP included — never added up here. */
  readonly capacity: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
  /** Cost of the tier after this one, or null once there are none left. */
  readonly nextCost: number | null;
}

/**
 * Buys the NEXT backpack tier. There is no tier in the payload — "upgrade"
 * means the one after the one you have, so skipping is not expressible (§4.1).
 */
export function upgradeBackpack(key = idempotencyKey()): Promise<BackpackUpgradeResult> {
  return api.post<BackpackUpgradeResult>('/shop/backpack', { idempotencyKey: key });
}

export interface BuildingUpgradeResult {
  readonly building: AnimalBuilding;
  readonly tier: number;
  /** Animals it now holds, VIP included — never added up here. */
  readonly cap: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
  readonly nextCost: number | null;
}

/**
 * Buys the NEXT coop or barn tier (T-12.02). Like every other upgrade, the
 * payload carries no target tier — the building is in the path instead, so it
 * is not a value anything has to validate.
 */
export function upgradeBuilding(
  building: AnimalBuilding,
  key = idempotencyKey(),
): Promise<BuildingUpgradeResult> {
  return api.post<BuildingUpgradeResult>(`/shop/${building}`, { idempotencyKey: key });
}
