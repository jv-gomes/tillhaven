import { and, asc, eq } from 'drizzle-orm';
import {
  GameError,
  ErrorCode,
  getItem,
  BACKPACK_TIERS,
  CHEST_TIERS,
  VIP_BENEFITS,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Queryable, Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { isVip } from '../player/view.js';
import { farmTiers } from '../farm/tiers.js';

/**
 * Slot-based inventory (CLAUDE.md §5.4).
 *
 * Every function that WRITES takes a `Tx` and must be called inside a
 * transaction — granting produce and clearing a plot are one atomic operation,
 * and so is spending gold and receiving an item (§4.3). Read-only helpers take
 * the wider `Queryable` so a route can call them without opening a transaction
 * for a listing.
 *
 * The cardinal rule: an operation that would overflow fails **whole**. It never
 * partially applies and never silently drops the remainder. Items are not
 * destroyed by running out of room.
 */

export const Container = {
  INVENTORY: 'inventory',
  CHEST: 'chest',
} as const;
export type Container = (typeof Container)[keyof typeof Container];

export interface CapacityInput {
  readonly backpackTier: number;
  readonly chestTier: number;
  readonly isVip: boolean;
}

/**
 * Slots available in a container, from its purchased tier plus VIP.
 *
 * **The house no longer adds bag slots** (T-10.03): carrying capacity is the
 * backpack's business and storage is the chest's, so each has exactly one thing
 * that grows it. An unknown tier falls back to tier 0 — the safe direction,
 * since it under-reports rather than handing out slots nobody paid for.
 */
export function capacityFor(container: Container, input: CapacityInput): number {
  if (container === Container.CHEST) {
    const tier =
      CHEST_TIERS.find((t) => t.tier === input.chestTier) ?? CHEST_TIERS[0]!;
    return tier.slots + (input.isVip ? VIP_BENEFITS.bonusChestSlots : 0);
  }

  const backpack =
    BACKPACK_TIERS.find((t) => t.tier === input.backpackTier) ?? BACKPACK_TIERS[0]!;
  return backpack.slots + (input.isVip ? VIP_BENEFITS.bonusInventorySlots : 0);
}

/**
 * A player's capacity, read from their farm tiers and VIP status.
 *
 * Lives here rather than in each caller because three modules need it — farm,
 * shop and the inventory routes — and three copies of "tier + VIP" is three
 * chances for one of them to drift.
 *
 * The bag needs no query at all since T-10.03: its tier is on the player row
 * the session already loaded. Only the chest still reads the farm, and only
 * when the chest is what was asked for.
 */
export async function capacityForPlayer(
  q: Queryable,
  player: AuthedPlayer,
  container: Container,
  now: number,
): Promise<number> {
  // Falling back to tier 0 is the safe direction: it under-reports capacity
  // rather than granting slots nobody paid for.
  const chestTier =
    container === Container.CHEST ? ((await farmTiers(q, player.id))?.chestTier ?? 0) : 0;

  return capacityFor(container, {
    backpackTier: player.backpackTier,
    chestTier,
    isVip: isVip(player, now),
  });
}

export interface SlotRow {
  readonly id: string;
  readonly slotIndex: number;
  readonly itemId: string;
  readonly quantity: number;
}

/**
 * Loads a container's slots and LOCKS them for the rest of the transaction.
 *
 * Without the lock, two concurrent harvests could each read "23 of 24 slots
 * used", each decide there is room, and each insert — overflowing the cap. The
 * lock is what makes the capacity check meaningful.
 */
async function loadSlotsForUpdate(
  tx: Tx,
  playerId: string,
  container: Container,
): Promise<SlotRow[]> {
  return tx
    .select({
      id: schema.inventoryItems.id,
      slotIndex: schema.inventoryItems.slotIndex,
      itemId: schema.inventoryItems.itemId,
      quantity: schema.inventoryItems.quantity,
    })
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.playerId, playerId),
        eq(schema.inventoryItems.container, container),
      ),
    )
    .orderBy(asc(schema.inventoryItems.slotIndex))
    .for('update');
}

/**
 * Locks a player's container for the rest of the transaction, without needing
 * the contents back.
 *
 * Exported for callers that must take the lock **before** any of their own
 * writes — trade execution is the reason this exists: it locks both parties'
 * bags, in a deterministic order, before touching either (§6). `addItem` and
 * `removeItem` still re-lock internally when they run; that is not redundant,
 * it is what makes them safe to call standalone everywhere else.
 */
export async function lockContainer(
  tx: Tx,
  playerId: string,
  container: Container = Container.INVENTORY,
): Promise<void> {
  await loadSlotsForUpdate(tx, playerId, container);
}

/**
 * Locks **every** inventory row this player owns, in both containers, in one
 * statement.
 *
 * This is the deadlock fix, and it is not theoretical. `removeItem` locks the
 * container it takes from and `addItem` locks the one it adds to, so a
 * bag→chest transfer acquires bag-then-chest while a simultaneous chest→bag
 * transfer acquires chest-then-bag. Two players doing that at the same instant
 * on their own accounts is fine; the same player with two tabs open is a
 * classic lock-order inversion, and Postgres resolves it by killing one of
 * them.
 *
 * Taking both in a single statement removes the ordering question entirely —
 * there is no window between the two acquisitions because there are not two
 * acquisitions. The later locks inside `addItem`, `removeItem` and
 * `loadSlotsForUpdate` are then re-entrant no-ops within the same transaction.
 *
 * Lived in `chest.ts` until T-10.02, when the cross-container move became its
 * second caller; it is about inventory rows, so it belongs beside the other
 * lock helper rather than in the module that happened to need it first.
 */
export async function lockBothContainers(tx: Tx, playerId: string): Promise<void> {
  await tx
    .select({ id: schema.inventoryItems.id })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.playerId, playerId))
    .for('update');
}

/** Read-only listing. No lock — for display, not for decisions. */
export async function listSlots(
  tx: Queryable,
  playerId: string,
  container: Container = Container.INVENTORY,
): Promise<SlotRow[]> {
  return tx
    .select({
      id: schema.inventoryItems.id,
      slotIndex: schema.inventoryItems.slotIndex,
      itemId: schema.inventoryItems.itemId,
      quantity: schema.inventoryItems.quantity,
    })
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.playerId, playerId),
        eq(schema.inventoryItems.container, container),
      ),
    )
    .orderBy(asc(schema.inventoryItems.slotIndex));
}

/**
 * What a slot holds, with no database identity attached.
 *
 * `SlotRow` minus its `id`, so the planning below can be reused by anything
 * reasoning about a container it is not reading from the database — which is
 * exactly what the idle simulator does (T-13.03c).
 */
export interface SlotContents {
  readonly slotIndex: number;
  readonly itemId: string;
  readonly quantity: number;
}

/**
 * Plans where `quantity` of `itemId` would go: top up partial stacks first,
 * then take the lowest free slot indices. Returns the touched slots with the
 * quantity each would END UP holding, or null if it does not fit.
 *
 * Pure, so the "would this fit?" question is answerable without writing
 * anything — which is how `addItem` fails whole instead of part-way, and how
 * the idle simulator can decide whether a harvest is possible before deciding
 * to do it. **The simulator must reach the same answer as the real add**, or a
 * harvest it simulated would fail on the way into the database; sharing this
 * one function is what makes that true rather than hoped for.
 */
export function planAddToSlots(
  slots: readonly SlotContents[],
  itemId: string,
  quantity: number,
  stackLimit: number,
  capacity: number,
): SlotContents[] | null {
  let remaining = quantity;
  const touched: SlotContents[] = [];

  for (const slot of slots) {
    if (remaining === 0) break;
    if (slot.itemId !== itemId) continue;

    const room = stackLimit - slot.quantity;
    if (room <= 0) continue;

    const put = Math.min(room, remaining);
    touched.push({ slotIndex: slot.slotIndex, itemId, quantity: slot.quantity + put });
    remaining -= put;
  }

  if (remaining > 0) {
    const used = new Set(slots.map((s) => s.slotIndex));
    for (let i = 0; i < capacity && remaining > 0; i++) {
      if (used.has(i)) continue;
      const put = Math.min(stackLimit, remaining);
      touched.push({ slotIndex: i, itemId, quantity: put });
      remaining -= put;
    }
  }

  // Did not fit. The caller turns this into INVENTORY_FULL; nothing was written.
  if (remaining > 0) return null;
  return touched;
}

/**
 * Applies `planAddToSlots` to a plain slot list, returning a new one.
 *
 * The simulator's counterpart to `addItem`'s writes. Null when it does not fit,
 * for the same reason and by the same rule.
 */
export function addToSlots(
  slots: readonly SlotContents[],
  itemId: string,
  quantity: number,
  stackLimit: number,
  capacity: number,
): SlotContents[] | null {
  const touched = planAddToSlots(slots, itemId, quantity, stackLimit, capacity);
  if (!touched) return null;

  const byIndex = new Map(slots.map((s) => [s.slotIndex, s]));
  for (const t of touched) byIndex.set(t.slotIndex, t);

  return [...byIndex.values()].sort((a, b) => a.slotIndex - b.slotIndex);
}

/**
 * The simulator's counterpart to `removeItem`: drains the lowest slot indices
 * first and DROPS emptied slots, exactly as the real removal deletes their
 * rows. Dropping matters — a spent seed stack frees a slot that the next
 * harvest can use, and a simulator that kept the empty row would under-report
 * the room the real farm has.
 *
 * Null when the container does not hold enough, mirroring `INSUFFICIENT_ITEMS`.
 */
export function removeFromSlots(
  slots: readonly SlotContents[],
  itemId: string,
  quantity: number,
): SlotContents[] | null {
  const held = slots.reduce((sum, s) => (s.itemId === itemId ? sum + s.quantity : sum), 0);
  if (held < quantity) return null;

  let remaining = quantity;
  const out: SlotContents[] = [];

  for (const slot of [...slots].sort((a, b) => a.slotIndex - b.slotIndex)) {
    if (remaining === 0 || slot.itemId !== itemId) {
      out.push(slot);
      continue;
    }

    const take = Math.min(slot.quantity, remaining);
    remaining -= take;
    if (take < slot.quantity) out.push({ ...slot, quantity: slot.quantity - take });
  }

  return out;
}

/** How many of `itemId` a plain slot list holds. */
export function countInSlots(slots: readonly SlotContents[], itemId: string): number {
  return slots.reduce((sum, s) => (s.itemId === itemId ? sum + s.quantity : sum), 0);
}

/**
 * `planAddToSlots` mapped back onto database rows — the same plan, addressed by
 * row id instead of slot index.
 */
function planAdd(
  slots: readonly SlotRow[],
  itemId: string,
  quantity: number,
  stackLimit: number,
  capacity: number,
): { updates: { id: string; quantity: number }[]; inserts: { slotIndex: number; quantity: number }[] } | null {
  const touched = planAddToSlots(slots, itemId, quantity, stackLimit, capacity);
  if (!touched) return null;

  const byIndex = new Map(slots.map((s) => [s.slotIndex, s]));
  const updates: { id: string; quantity: number }[] = [];
  const inserts: { slotIndex: number; quantity: number }[] = [];

  for (const t of touched) {
    const existing = byIndex.get(t.slotIndex);
    if (existing) updates.push({ id: existing.id, quantity: t.quantity });
    else inserts.push({ slotIndex: t.slotIndex, quantity: t.quantity });
  }

  return { updates, inserts };
}

export interface AddOptions {
  readonly container?: Container;
  readonly capacity: number;
}

/**
 * Adds items, or throws `INVENTORY_FULL` having written nothing.
 *
 * Callers must let the throw propagate so the surrounding transaction rolls
 * back — that is what keeps a harvested crop in its plot when there is no room
 * for it (§5.4).
 */
export async function addItem(
  tx: Tx,
  playerId: string,
  itemId: string,
  quantity: number,
  opts: AddOptions,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'Quantity must be a positive whole number.');
  }

  const def = getItem(itemId);
  if (!def) {
    throw new GameError(ErrorCode.UNKNOWN_ITEM, 'No such item.', { itemId });
  }

  const container = opts.container ?? Container.INVENTORY;
  const slots = await loadSlotsForUpdate(tx, playerId, container);

  const plan = planAdd(slots, itemId, quantity, def.stackLimit, opts.capacity);
  if (!plan) {
    throw new GameError(
      ErrorCode.INVENTORY_FULL,
      'There is no room for that.',
      { itemId, quantity },
    );
  }

  for (const u of plan.updates) {
    await tx
      .update(schema.inventoryItems)
      .set({ quantity: u.quantity })
      .where(eq(schema.inventoryItems.id, u.id));
  }

  if (plan.inserts.length > 0) {
    await tx.insert(schema.inventoryItems).values(
      plan.inserts.map((i) => ({
        playerId,
        container,
        slotIndex: i.slotIndex,
        itemId,
        quantity: i.quantity,
      })),
    );
  }
}

/**
 * Removes items, or throws `INSUFFICIENT_ITEMS` having written nothing.
 *
 * Drains the lowest slot indices first, so partial stacks consolidate rather
 * than fragmenting further.
 */
export async function removeItem(
  tx: Tx,
  playerId: string,
  itemId: string,
  quantity: number,
  container: Container = Container.INVENTORY,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'Quantity must be a positive whole number.');
  }

  const slots = await loadSlotsForUpdate(tx, playerId, container);
  const matching = slots.filter((s) => s.itemId === itemId);
  const held = matching.reduce((sum, s) => sum + s.quantity, 0);

  if (held < quantity) {
    throw new GameError(
      ErrorCode.INSUFFICIENT_ITEMS,
      "You don't have enough of that.",
      { itemId, needed: quantity, held },
    );
  }

  let remaining = quantity;
  for (const slot of matching) {
    if (remaining === 0) break;
    const take = Math.min(slot.quantity, remaining);
    remaining -= take;

    if (take === slot.quantity) {
      await tx
        .delete(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, slot.id));
    } else {
      await tx
        .update(schema.inventoryItems)
        .set({ quantity: slot.quantity - take })
        .where(eq(schema.inventoryItems.id, slot.id));
    }
  }
}

export interface MoveResult {
  /** What actually happened, so a caller can report it without re-deriving it. */
  readonly kind: 'moved' | 'merged' | 'swapped';
  /** For a merge: how many units ended up in the destination stack. */
  readonly moved: number;
}

/** One end of a drag, as the schema states it (T-10.02). */
export interface SlotRef {
  readonly container: Container;
  readonly slot: number;
}

/**
 * WHAT a drag does, decided from the two slots alone.
 *
 * Pure, and shared by the same-container and cross-container writers. The two
 * write different columns — one moves a slot index, the other moves a
 * container as well — but they must never disagree about whether a drop merges
 * or swaps, and a rule stated once cannot drift.
 */
function planMove(source: SlotRow, destination: SlotRow | undefined): MoveResult {
  if (!destination) return { kind: 'moved', moved: source.quantity };

  if (destination.itemId === source.itemId) {
    const stackLimit = getItem(source.itemId)?.stackLimit ?? 1;
    const room = stackLimit - destination.quantity;
    if (room > 0) return { kind: 'merged', moved: Math.min(room, source.quantity) };
    // A full destination stack of the same item falls through to a swap, which
    // is a no-op the player can see rather than a silently ignored drag.
  }

  return { kind: 'swapped', moved: source.quantity };
}

/**
 * Refuses a slot index the player does not own.
 *
 * An index is a client-supplied number like any other (§4.1): one past the cap
 * would be storage nobody paid for, and a negative one is where a swap parks a
 * row mid-transaction — reachable from outside, that is a way to hide items in
 * a slot no panel draws.
 */
function assertSlotExists(label: 'from' | 'to', index: number, capacity: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= capacity) {
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'That slot does not exist.', {
      slot: label,
      index: Number.isFinite(index) ? index : -1,
      capacity,
    });
  }
}

/**
 * Moves the contents of one slot onto another within a container.
 *
 * Three outcomes, decided by what is already in the destination:
 *   - empty            → the stack moves
 *   - the same item    → merge as much as the stack limit allows; any remainder
 *                        stays behind in the source slot
 *   - a different item → the two slots swap
 *
 * Nothing is ever destroyed and the total held is identical before and after —
 * that is the invariant worth remembering, because a "move" that silently ate
 * the destination stack would be an item sink the economy never accounted for.
 *
 * Slot indices are validated against the container's real capacity here rather
 * than trusted: an index is a client-supplied number like any other (§4.1), and
 * a slot beyond the cap would be storage the player has not paid for.
 *
 * **Within one container only.** Bag-to-chest transfer is T-3.01 and is a
 * different operation — it has two capacities to satisfy, not one.
 */
export async function moveItem(
  tx: Tx,
  playerId: string,
  fromSlot: number,
  toSlot: number,
  opts: AddOptions,
): Promise<MoveResult> {
  const container = opts.container ?? Container.INVENTORY;

  assertSlotExists('from', fromSlot, opts.capacity);
  assertSlotExists('to', toSlot, opts.capacity);

  const slots = await loadSlotsForUpdate(tx, playerId, container);
  const source = slots.find((s) => s.slotIndex === fromSlot);
  if (!source) {
    throw new GameError(ErrorCode.INSUFFICIENT_ITEMS, 'There is nothing in that slot.', {
      slot: fromSlot,
    });
  }

  if (fromSlot === toSlot) return { kind: 'moved', moved: 0 };

  const destination = slots.find((s) => s.slotIndex === toSlot);
  const plan = planMove(source, destination);

  // An empty destination is the only case `planMove` calls 'moved', and it is
  // also the only shape in which `destination` is absent — checking it here
  // rather than the plan's kind is what lets the swap below see a real row.
  if (!destination) {
    await tx
      .update(schema.inventoryItems)
      .set({ slotIndex: toSlot })
      .where(eq(schema.inventoryItems.id, source.id));
    return plan;
  }

  if (plan.kind === 'merged') {
    await mergeInto(tx, source, destination, plan.moved);
    return plan;
  }

  /*
   * Swap. `(player, container, slot_index)` is unique, so the two rows cannot
   * hold the same index even for an instant — the source parks on a negative
   * index first. It is only ever observable inside this transaction, and the
   * rows are already locked.
   */
  const PARKED = -1;
  await tx
    .update(schema.inventoryItems)
    .set({ slotIndex: PARKED })
    .where(eq(schema.inventoryItems.id, source.id));
  await tx
    .update(schema.inventoryItems)
    .set({ slotIndex: fromSlot })
    .where(eq(schema.inventoryItems.id, destination.id));
  await tx
    .update(schema.inventoryItems)
    .set({ slotIndex: toSlot })
    .where(eq(schema.inventoryItems.id, source.id));

  return plan;
}

/**
 * Moves one slot onto another **across** containers (T-10.02).
 *
 * The same three outcomes as within a container — move, merge with the
 * remainder staying behind, or swap — because a drag means the same thing
 * wherever it lands. `planMove` decides which, so the two writers cannot
 * disagree about it; all that differs here is that the rows change `container`
 * as well as `slot_index`.
 *
 * **Both containers are locked in one statement before anything is read.**
 * Locking them one at a time is the lock-order inversion `lockBothContainers`
 * exists to prevent: a bag→chest drag in one tab and a chest→bag drag in
 * another would take the two locks in opposite orders.
 *
 * Each index is checked against ITS OWN container's capacity. A chest slot is
 * not a bag slot, and one shared cap would either refuse storage the player
 * bought or hand out storage they did not.
 */
export async function moveAcross(
  tx: Tx,
  playerId: string,
  from: SlotRef,
  to: SlotRef,
  capacities: { readonly from: number; readonly to: number },
): Promise<MoveResult> {
  assertSlotExists('from', from.slot, capacities.from);
  assertSlotExists('to', to.slot, capacities.to);

  await lockBothContainers(tx, playerId);

  const [fromSlots, toSlots] = await Promise.all([
    listSlots(tx, playerId, from.container),
    listSlots(tx, playerId, to.container),
  ]);

  const source = fromSlots.find((s) => s.slotIndex === from.slot);
  if (!source) {
    throw new GameError(ErrorCode.INSUFFICIENT_ITEMS, 'There is nothing in that slot.', {
      slot: from.slot,
    });
  }

  const destination = toSlots.find((s) => s.slotIndex === to.slot);
  const plan = planMove(source, destination);

  if (!destination) {
    await tx
      .update(schema.inventoryItems)
      .set({ container: to.container, slotIndex: to.slot })
      .where(eq(schema.inventoryItems.id, source.id));
    return plan;
  }

  if (plan.kind === 'merged') {
    await mergeInto(tx, source, destination, plan.moved);
    return plan;
  }

  /*
   * Swap, in three writes for the same reason the single-container one takes
   * three: `(player, container, slot_index)` is unique, so the source parks on
   * a negative index in its OWN container first, freeing its slot for the
   * destination to land in. Transient, locked, and never observable outside
   * this transaction.
   */
  const PARKED = -1;
  await tx
    .update(schema.inventoryItems)
    .set({ slotIndex: PARKED })
    .where(eq(schema.inventoryItems.id, source.id));
  await tx
    .update(schema.inventoryItems)
    .set({ container: from.container, slotIndex: from.slot })
    .where(eq(schema.inventoryItems.id, destination.id));
  await tx
    .update(schema.inventoryItems)
    .set({ container: to.container, slotIndex: to.slot })
    .where(eq(schema.inventoryItems.id, source.id));

  return plan;
}

/**
 * The merge write, shared by both movers: top the destination up, and either
 * drain or delete the source.
 *
 * The remainder staying behind is the whole reason a merge is not just "move
 * and add" — a stack that does not fit is not a stack that disappears.
 */
async function mergeInto(tx: Tx, source: SlotRow, destination: SlotRow, put: number): Promise<void> {
  await tx
    .update(schema.inventoryItems)
    .set({ quantity: destination.quantity + put })
    .where(eq(schema.inventoryItems.id, destination.id));

  if (put === source.quantity) {
    await tx.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, source.id));
  } else {
    await tx
      .update(schema.inventoryItems)
      .set({ quantity: source.quantity - put })
      .where(eq(schema.inventoryItems.id, source.id));
  }
}

export interface InventoryView {
  readonly slots: readonly { slotIndex: number; itemId: string; quantity: number }[];
  /** Total slots, so the client can draw the empty ones it is allowed to use. */
  readonly capacity: number;
}

/**
 * The caller's own container, with its capacity.
 *
 * Takes the authenticated player rather than an id, so there is no signature
 * here that could be handed someone else's — reading another player's bag is
 * exactly the sort of thing §4.1 rules out.
 */
export async function inventoryView(
  q: Queryable,
  player: AuthedPlayer,
  now: number,
  container: Container = Container.INVENTORY,
): Promise<InventoryView> {
  const [slots, capacity] = await Promise.all([
    listSlots(q, player.id, container),
    capacityForPlayer(q, player, container, now),
  ]);

  return {
    slots: slots.map((s) => ({ slotIndex: s.slotIndex, itemId: s.itemId, quantity: s.quantity })),
    capacity,
  };
}

/**
 * Route-level move: resolves the real capacities, performs the drag, and
 * returns BOTH containers as they now stand.
 *
 * Both, always, even for a bag→bag drag: the panel T-10.04 builds shows the
 * chest above the backpack, so a response that covered only one grid would
 * leave the other to be re-fetched or — worse — replayed locally. Rendering the
 * server's answer instead of replaying the move is what keeps the two agreeing
 * (§4.1).
 *
 * Same-container drags take exactly the path they did before T-10.02, down to
 * the same function; only cross-container ones reach `moveAcross`.
 */
export async function moveSlots(
  tx: Tx,
  player: AuthedPlayer,
  from: SlotRef,
  to: SlotRef,
  now: number,
): Promise<MoveResult & { bag: InventoryView; chest: InventoryView }> {
  const [bagCapacity, chestCapacity] = await Promise.all([
    capacityForPlayer(tx, player, Container.INVENTORY, now),
    capacityForPlayer(tx, player, Container.CHEST, now),
  ]);
  const capacityOf = (container: Container): number =>
    container === Container.CHEST ? chestCapacity : bagCapacity;

  const result =
    from.container === to.container
      ? await moveItem(tx, player.id, from.slot, to.slot, {
          capacity: capacityOf(from.container),
          container: from.container,
        })
      : await moveAcross(tx, player.id, from, to, {
          from: capacityOf(from.container),
          to: capacityOf(to.container),
        });

  const [bag, chest] = await Promise.all([
    inventoryView(tx, player, now, Container.INVENTORY),
    inventoryView(tx, player, now, Container.CHEST),
  ]);

  return { ...result, bag, chest };
}

/** How many of an item the player holds, across every slot in a container. */
export async function countItem(
  tx: Queryable,
  playerId: string,
  itemId: string,
  container: Container = Container.INVENTORY,
): Promise<number> {
  const slots = await listSlots(tx, playerId, container);
  return slots
    .filter((s) => s.itemId === itemId)
    .reduce((sum, s) => sum + s.quantity, 0);
}
