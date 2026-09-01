import { eq } from 'drizzle-orm';
import { CHEST_TIERS, ErrorCode, GameError, getItem } from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Queryable, Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { isVip } from '../player/view.js';
import { farmTiers } from '../farm/tiers.js';
import {
  assertAffordable,
  chargeGold,
  costAfter,
  lockForUpgrade,
  nextTier,
} from '../farm/upgrades.js';
import {
  Container,
  addItem,
  capacityFor,
  capacityForPlayer,
  inventoryView,
  lockBothContainers,
  removeItem,
  type InventoryView,
} from './service.js';

/**
 * The chest: a second container, and moving things between it and the bag
 * (CLAUDE.md §5.4).
 *
 * A transfer is the first operation in the game that touches **two containers
 * at once**, and that is the whole reason it lives in its own file rather than
 * as another branch of `moveItem`. Two containers means two capacities to
 * satisfy and — the part that bites — two sets of rows to lock.
 */

export const Direction = {
  TO_CHEST: 'to_chest',
  TO_BAG: 'to_bag',
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

export interface TransferResult {
  readonly itemId: string;
  readonly quantity: number;
  readonly direction: Direction;
  /** Both containers as they now stand, so the client re-renders from truth. */
  readonly bag: InventoryView;
  readonly chest: InventoryView;
}

export interface UpgradeResult {
  readonly tier: number;
  readonly capacity: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
  /** Cost of the tier after this one, or null once there are no more. */
  readonly nextCost: number | null;
}

/**
 * Buys the next chest tier.
 *
 * **There is no target tier in the request.** The client asks to upgrade, not
 * to upgrade *to* something, so "tiers must be bought in order" is a property of
 * the endpoint's shape rather than a check that could be forgotten — there is
 * simply no way to express skipping one (§4.1).
 *
 * Gold leaves and the tier rises in one transaction. The player row is locked
 * first, in the same order as the shop and the animal purchase, so two upgrades
 * racing on one account cannot both read the old tier and both charge for it.
 */
export async function upgradeChest(
  tx: Tx,
  player: AuthedPlayer,
  now: number,
): Promise<UpgradeResult> {
  const context = await lockForUpgrade(tx, player.id);
  const next = nextTier(CHEST_TIERS, context.chestTier, 'Your chest is already as big as it gets.');

  assertAffordable(context.gold, next.cost);

  await tx
    .update(schema.farms)
    .set({ chestTier: next.tier })
    .where(eq(schema.farms.id, context.farmId));

  await chargeGold(tx, player.id, next.cost);

  return {
    tier: next.tier,
    // Read back through the same function everything else uses, rather than
    // quoting `next.slots`: VIP adds to it, and two ways to say what a chest
    // holds is one too many.
    capacity: capacityFor(Container.CHEST, {
      backpackTier: 0,
      chestTier: next.tier,
      isVip: isVip(player, now),
    }),
    goldDelta: -next.cost,
    goldAfter: context.gold - next.cost,
    nextCost: costAfter(CHEST_TIERS, next.tier),
  };
}

export interface ChestView extends InventoryView {
  readonly tier: number;
  /** Cost of the next tier, or null once there are none left. */
  readonly nextCost: number | null;
}

/**
 * The caller's chest, with its capacity and what the next tier would cost.
 *
 * The price ships with the view rather than being looked up in the client's own
 * copy of `CHEST_TIERS`. Both are the same config, but only one of them is
 * authoritative, and a panel quoting a stale price is a panel that lies (§4.4).
 */
export async function chestView(
  q: Queryable,
  player: AuthedPlayer,
  now: number,
): Promise<ChestView> {
  const [view, tiers] = await Promise.all([
    inventoryView(q, player, now, Container.CHEST),
    farmTiers(q, player.id),
  ]);

  const tier = tiers?.chestTier ?? 0;
  return {
    ...view,
    tier,
    nextCost: costAfter(CHEST_TIERS, tier),
  };
}

/**
 * Moves items between the bag and the chest.
 *
 * Remove-then-add inside one transaction, so the total held is identical before
 * and after whatever happens. If the destination cannot take them, `addItem`
 * throws `INVENTORY_FULL`, the removal rolls back with it, and the items are
 * still exactly where they started — **a transfer never partially applies and
 * never destroys anything** (§5.4).
 *
 * That is the property worth restating: a chest transfer is the easiest place
 * in the game to accidentally build an item sink, because the failure mode
 * "took them out of the bag, could not fit them in the chest" looks like
 * success from the source side.
 */
export async function transfer(
  tx: Tx,
  player: AuthedPlayer,
  itemId: string,
  quantity: number,
  direction: Direction,
  now: number,
): Promise<TransferResult> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'Quantity must be a positive whole number.');
  }
  if (!getItem(itemId)) {
    throw new GameError(ErrorCode.UNKNOWN_ITEM, 'No such item.', { itemId });
  }

  const [from, to] =
    direction === Direction.TO_CHEST
      ? [Container.INVENTORY, Container.CHEST]
      : [Container.CHEST, Container.INVENTORY];

  await lockBothContainers(tx, player.id);

  const capacity = await capacityForPlayer(tx, player, to, now);

  // Throws INSUFFICIENT_ITEMS if they are not there to move.
  await removeItem(tx, player.id, itemId, quantity, from);
  // Throws INVENTORY_FULL, taking the removal down with it.
  await addItem(tx, player.id, itemId, quantity, { capacity, container: to });

  const [bag, chest] = await Promise.all([
    inventoryView(tx, player, now, Container.INVENTORY),
    inventoryView(tx, player, now, Container.CHEST),
  ]);

  return { itemId, quantity, direction, bag, chest };
}
