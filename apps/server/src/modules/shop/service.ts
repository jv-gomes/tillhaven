import { eq, sql } from 'drizzle-orm';
import {
  GameError,
  ErrorCode,
  getItem,
  ITEM_IDS,
  ITEMS,
  BACKPACK_TIERS,
  BUILDING_TIERS,
  benefitsFor,
  buildingCap,
  type AnimalBuilding,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Tx } from '../../db/tx.js';
import {
  addItem,
  removeItem,
  capacityFor,
  capacityForPlayer,
  Container,
} from '../inventory/service.js';
import {
  assertAffordable,
  chargeGold,
  costAfter,
  lockForUpgrade,
  nextTier,
} from '../farm/upgrades.js';
import { isVip } from '../player/view.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * The NPC shop (CLAUDE.md §5.6).
 *
 * Prices come from `packages/shared/src/config/items.ts` and are read HERE,
 * server-side. The client has the same config for display, but a price in a
 * request body is never trusted — the only thing a client may send is what item
 * and how many (§4.1).
 *
 * The shop always buys back below player-to-player value, so trading with
 * another player is meaningfully better than vendoring. A test in
 * `config.test.ts` asserts buy/sell round-tripping always loses gold, which
 * stops the shop becoming a gold faucet.
 */

export interface ShopEntry {
  readonly itemId: string;
  readonly name: string;
  readonly category: string;
  readonly buyPrice: number | null;
  readonly sellPrice: number | null;
}

/** The catalogue, for display. Derived from config, never from the database. */
export function shopCatalogue(): ShopEntry[] {
  return ITEM_IDS.map((id) => {
    const item = ITEMS[id]!;
    return {
      itemId: item.id,
      name: item.name,
      category: item.category,
      buyPrice: item.shopBuyPrice,
      sellPrice: item.shopSellPrice,
    };
  }).filter((e) => e.buyPrice !== null || e.sellPrice !== null);
}

export interface TradeResult {
  readonly itemId: string;
  readonly quantity: number;
  /** Gold moved. Positive when the player gained it. */
  readonly goldDelta: number;
  readonly goldAfter: number;
}

/**
 * Locks the player row and returns their current gold.
 *
 * Without the lock, two concurrent purchases could each read the same balance,
 * each decide it is affordable, and both succeed — spending gold that only
 * existed once.
 */
async function lockPlayerGold(tx: Tx, playerId: string): Promise<number> {
  const rows = await tx
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .limit(1)
    .for('update');

  const row = rows[0];
  if (!row) throw new GameError(ErrorCode.NOT_FOUND, 'No such player.');
  return row.gold;
}

/**
 * Buys `quantity` of an item at the configured price.
 *
 * Gold leaves and items arrive in one transaction. If the inventory cannot hold
 * the purchase, `addItem` throws and the gold is never deducted (§4.3).
 */
export async function buy(
  tx: Tx,
  player: AuthedPlayer,
  itemId: string,
  quantity: number,
  now: number,
): Promise<TradeResult> {
  const item = getItem(itemId);
  if (!item) {
    throw new GameError(ErrorCode.UNKNOWN_ITEM, 'No such item.', { itemId });
  }
  if (item.shopBuyPrice === null) {
    throw new GameError(ErrorCode.ITEM_NOT_FOR_SALE, 'The shop does not sell that.', {
      itemId,
    });
  }

  // Integer arithmetic throughout — no floats for gold, ever (§10).
  const cost = item.shopBuyPrice * quantity;

  const gold = await lockPlayerGold(tx, player.id);
  if (gold < cost) {
    throw new GameError(ErrorCode.INSUFFICIENT_GOLD, "You can't afford that.", {
      needed: cost,
      held: gold,
    });
  }

  const capacity = await capacityForPlayer(tx, player, Container.INVENTORY, now);

  // Throws INVENTORY_FULL and rolls back, leaving the gold untouched.
  await addItem(tx, player.id, itemId, quantity, { capacity });

  await tx
    .update(schema.players)
    .set({ gold: sql`${schema.players.gold} - ${cost}` })
    .where(eq(schema.players.id, player.id));

  return {
    itemId,
    quantity,
    goldDelta: -cost,
    goldAfter: gold - cost,
  };
}

/**
 * Sells `quantity` of an item at the configured buy-back price.
 *
 * Items leave and gold arrives in one transaction. If the player does not hold
 * enough, `removeItem` throws and no gold is created (§4.3).
 */
export async function sell(
  tx: Tx,
  player: AuthedPlayer,
  itemId: string,
  quantity: number,
): Promise<TradeResult> {
  const item = getItem(itemId);
  if (!item) {
    throw new GameError(ErrorCode.UNKNOWN_ITEM, 'No such item.', { itemId });
  }
  if (item.shopSellPrice === null) {
    throw new GameError(ErrorCode.ITEM_NOT_SELLABLE, 'The shop does not buy that.', {
      itemId,
    });
  }

  const payout = item.shopSellPrice * quantity;

  // Lock the player row first, in the same order as `buy`, so a buy and a sell
  // racing on one account cannot deadlock against each other.
  const gold = await lockPlayerGold(tx, player.id);

  // Throws INSUFFICIENT_ITEMS and rolls back if they do not have them.
  await removeItem(tx, player.id, itemId, quantity);

  await tx
    .update(schema.players)
    .set({ gold: sql`${schema.players.gold} + ${payout}` })
    .where(eq(schema.players.id, player.id));

  return {
    itemId,
    quantity,
    goldDelta: payout,
    goldAfter: gold + payout,
  };
}

export interface BackpackUpgradeResult {
  readonly tier: number;
  /** Slots after the purchase, VIP included — the client never adds it up. */
  readonly capacity: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
  /** Cost of the tier after this one, or null once there are no more. */
  readonly nextCost: number | null;
}

/**
 * Buys the NEXT backpack tier (T-10.03, CLAUDE.md §5.5).
 *
 * **There is no target tier in the request**, exactly as with the chest and the
 * house: the client asks to upgrade, not to upgrade *to* something, so "tiers
 * are bought in order" is a property of the endpoint's shape rather than a
 * check that could be forgotten (§4.1).
 *
 * `lockForUpgrade` takes the player row first — the same order every purchase
 * in the game uses, so two of them cannot deadlock on one account, and gold is
 * serialised so two concurrent clicks cannot both pass the affordability check
 * and buy one tier twice.
 *
 * The bag never shrinks, so a tier bought while slots are occupied needs no
 * relocation pass. That is only true in this direction — see `is-over-capacity`
 * in the client for what a VIP lapse looks like from the other side.
 */
export async function upgradeBackpack(
  tx: Tx,
  player: AuthedPlayer,
  now: number,
): Promise<BackpackUpgradeResult> {
  /*
   * The tier comes back from the LOCKED player row, alongside the gold — never
   * from `player.backpackTier`, which is the session's snapshot from before
   * this transaction began. A concurrent purchase can have moved it since, and
   * the stale read buys the same tier twice at full price.
   */
  const context = await lockForUpgrade(tx, player.id);
  const next = nextTier(
    BACKPACK_TIERS,
    context.backpackTier,
    'Your backpack is already as big as it gets.',
  );
  assertAffordable(context.gold, next.cost);

  await tx
    .update(schema.players)
    .set({ backpackTier: next.tier })
    .where(eq(schema.players.id, player.id));

  await chargeGold(tx, player.id, next.cost);

  return {
    tier: next.tier,
    // Read back through the same function everything else uses, rather than
    // quoting `next.slots`: VIP adds to it, and two ways to say how much a
    // player can carry is one too many (§4.4).
    capacity: capacityFor(Container.INVENTORY, {
      backpackTier: next.tier,
      chestTier: 0,
      isVip: isVip(player, now),
    }),
    goldDelta: -next.cost,
    goldAfter: context.gold - next.cost,
    nextCost: costAfter(BACKPACK_TIERS, next.tier),
  };
}

export interface BuildingUpgradeResult {
  readonly building: AnimalBuilding;
  readonly tier: number;
  /** Animals it now holds, VIP included — the client never adds it up. */
  readonly cap: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
  /** Cost of the tier after this one, or null once there are no more. */
  readonly nextCost: number | null;
}

const AT_MAX = {
  coop: 'Your coop is already as big as it gets.',
  barn: 'Your barn is already as big as it gets.',
} as const;

/**
 * Buys the NEXT tier of the coop or the barn (T-12.02, CLAUDE.md §5.4).
 *
 * **The request carries no target tier**, exactly as with the backpack, chest
 * and house: the client asks to upgrade, not to upgrade *to* something, so
 * "tiers are bought in order" is a property of the endpoint's shape rather
 * than a check that could be forgotten (§4.1).
 *
 * `lockForUpgrade` takes the player row before the farm row — the same order
 * every purchase in the game uses, so two of them cannot deadlock on one
 * account, and gold is serialised so two concurrent clicks cannot both pass
 * the affordability check and buy one tier twice.
 *
 * The tier comes back from the LOCKED farm row, never from a snapshot loaded
 * before the transaction began: a concurrent purchase can have moved it since,
 * and the stale read buys the same tier twice at full price.
 *
 * A building never shrinks, so nothing has to be relocated when it grows —
 * unlike a VIP lapse, which is the only direction a cap moves down.
 */
export async function upgradeBuilding(
  tx: Tx,
  player: AuthedPlayer,
  building: AnimalBuilding,
  now: number,
): Promise<BuildingUpgradeResult> {
  const context = await lockForUpgrade(tx, player.id);
  const current = building === 'coop' ? context.coopTier : context.barnTier;

  const next = nextTier(BUILDING_TIERS[building], current, AT_MAX[building]);
  assertAffordable(context.gold, next.cost);

  // Two columns rather than one `(building, tier)` table: there are exactly
  // two of them and they are read on the hottest path in the game alongside
  // the farm's other tiers. Branching on the literal keeps the update
  // type-checked against the schema, which a computed key would not be.
  await tx
    .update(schema.farms)
    .set(building === 'coop' ? { coopTier: next.tier } : { barnTier: next.tier })
    .where(eq(schema.farms.id, context.farmId));

  await chargeGold(tx, player.id, next.cost);

  return {
    building,
    tier: next.tier,
    // Read back through the same function the purchase check uses rather than
    // quoting `next.cap`: VIP adds to it, and two ways to say how many animals
    // fit is one too many (§4.4).
    cap: buildingCap(building, next.tier, benefitsFor(player, now).bonusAnimalCap),
    goldDelta: -next.cost,
    goldAfter: context.gold - next.cost,
    nextCost: costAfter(BUILDING_TIERS[building], next.tier),
  };
}
