import { api, idempotencyKey } from './api.js';

/**
 * Inventory API wrapper.
 *
 * Slot indices go up, nothing else. The client never sends a quantity, an item
 * id, or a capacity — the server knows all three, and a move that tried to
 * state them would be a way to invent items (CLAUDE.md §4.1).
 */

export interface InventorySlot {
  readonly slotIndex: number;
  readonly itemId: string;
  readonly quantity: number;
}

export interface InventoryView {
  readonly slots: InventorySlot[];
  /** Total slots the player has, including house-tier and VIP bonuses. */
  readonly capacity: number;
}

/** One end of a drag: which container, and which slot in it. */
export interface SlotRef {
  readonly container: 'inventory' | 'chest';
  readonly slot: number;
}

export interface MoveResult {
  readonly kind: 'moved' | 'merged' | 'swapped';
  readonly moved: number;
  /** Both containers as they now stand — render these, do not replay the move. */
  readonly bag: InventoryView;
  readonly chest: InventoryView;
}

export type TransferDirection = 'to_chest' | 'to_bag';

export interface TransferResult {
  readonly itemId: string;
  readonly quantity: number;
  readonly direction: TransferDirection;
  /** Both containers as they now stand — render these, do not replay the move. */
  readonly bag: InventoryView;
  readonly chest: InventoryView;
}

/** The backpack, plus what the next tier costs (T-11.04). Mirrors `ChestView`. */
export interface BagView extends InventoryView {
  readonly tier: number;
  /** Cost of the next backpack tier, or null once there are none left. */
  readonly nextCost: number | null;
}

export function fetchInventory(): Promise<BagView> {
  return api.get<BagView>('/inventory');
}

export interface ChestView extends InventoryView {
  readonly tier: number;
  /** Cost of the next tier, or null once there are none left. */
  readonly nextCost: number | null;
}

export interface ChestUpgradeResult {
  readonly tier: number;
  readonly capacity: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
  readonly nextCost: number | null;
}

export function fetchChest(): Promise<ChestView> {
  return api.get<ChestView>('/inventory/chest');
}

/**
 * Buys the NEXT chest tier. There is no tier in the payload — "upgrade" means
 * the one after the one you have, so skipping is not expressible.
 */
export function upgradeChest(key = idempotencyKey()): Promise<ChestUpgradeResult> {
  return api.post<ChestUpgradeResult>('/inventory/chest/upgrade', { idempotencyKey: key });
}

/**
 * Moves a whole quantity between the bag and the chest.
 *
 * The client says what and how many, never where it lands: slot placement is
 * the server's business (CLAUDE.md §4.1).
 */
export function transferItem(
  itemId: string,
  quantity: number,
  direction: TransferDirection,
  key = idempotencyKey(),
): Promise<TransferResult> {
  return api.post<TransferResult>('/inventory/transfer', {
    itemId,
    quantity,
    direction,
    idempotencyKey: key,
  });
}

/**
 * Drags one slot onto another, within a container or across the two.
 *
 * One key per drag, reused if that drag is retried (CLAUDE.md §4.5). Both ends
 * name their container, so bag→bag and bag→chest are the same call — the server
 * checks each index against that container's own capacity.
 */
export function moveSlot(
  from: SlotRef,
  to: SlotRef,
  key = idempotencyKey(),
): Promise<MoveResult> {
  return api.post<MoveResult>('/inventory/move', { from, to, idempotencyKey: key });
}
