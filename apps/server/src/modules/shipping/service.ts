import { and, desc, eq, isNull, isNotNull, lte, sql } from 'drizzle-orm';
import {
  ErrorCode,
  GameError,
  SHIPPING_PAYOUT_MS,
  getItem,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Queryable, Tx } from '../../db/tx.js';
import { removeItem } from '../inventory/service.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * The shipping box (CLAUDE.md §5.6).
 *
 * Two ways to sell exist and they are deliberately different trades: the
 * merchant pays immediately, the box pays `SHIPPING_PAYOUT_MS` later at the
 * same price. What the box buys the player is not more gold but less walking —
 * drop a harvest in on the way past and collect it next time.
 *
 * **Settled on read, never by a job** (§4.2). Nothing ticks: a shipment becomes
 * payable at `depositedAt + SHIPPING_PAYOUT_MS`, and the next request that
 * looks at this player's box credits whatever has come due. An offline player's
 * goods are waiting the moment they return, and a player who never returns
 * costs nothing.
 */

export interface PendingShipment {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly depositedAt: number;
  /** What it will fetch at today's price. 0 once prices stop being a thing. */
  readonly payout: number;
  /** ms until it pays out. 0 means "next time anyone looks". */
  readonly paysOutInMs: number;
}

export interface PaidShipment {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly paidAt: number;
  /** What was ACTUALLY credited, from the row — never recomputed. */
  readonly payout: number;
}

export interface ShippingView {
  readonly pending: readonly PendingShipment[];
  readonly paid: readonly PaidShipment[];
  /** Gold credited by the settlement this request just performed. */
  readonly justPaid: number;
  readonly payoutMs: number;
}

/** How many settled shipments the box remembers, for a receipt the player can read. */
const HISTORY_LIMIT = 10;

/**
 * What an item fetches, from config, at the moment of asking.
 *
 * Unsellable items have no price and must never reach a shipment row — the
 * deposit refuses them (see `deposit`), so a null here means config changed
 * under an already-deposited item. Paying 0 is the safe direction: it credits
 * nothing rather than crediting NaN, and the row still settles instead of
 * jamming the box forever.
 */
function priceOf(itemId: string): number {
  return getItem(itemId)?.shopSellPrice ?? 0;
}

export interface DepositResult {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly depositedAt: number;
  readonly payout: number;
  readonly paysOutInMs: number;
}

/**
 * Drops goods into the box.
 *
 * The items leave the backpack and a row appears, in one transaction (§4.3) —
 * there is no state where they are in neither place. Nothing is credited here:
 * a deposit is a promise of gold later, and the gold arrives at settlement.
 */
export async function deposit(
  tx: Tx,
  player: AuthedPlayer,
  itemId: string,
  quantity: number,
  now: number,
): Promise<DepositResult> {
  const item = getItem(itemId);
  if (!item) {
    throw new GameError(ErrorCode.UNKNOWN_ITEM, 'No such item.', { itemId });
  }
  /*
   * The same rule the merchant uses, which is what makes tools undepositable:
   * they have no sell price, so there is no "tools are special" check here to
   * forget — an unsellable item simply has nothing to sell it for.
   */
  if (item.shopSellPrice === null) {
    throw new GameError(ErrorCode.ITEM_NOT_SELLABLE, 'Nobody buys that.', { itemId });
  }

  // Throws INSUFFICIENT_ITEMS and rolls the whole thing back if they are not
  // held — so a failed deposit never loses items and never leaves a row.
  await removeItem(tx, player.id, itemId, quantity);

  const rows = await tx
    .insert(schema.shipments)
    .values({ playerId: player.id, itemId, quantity, depositedAt: now })
    .returning({ id: schema.shipments.id });

  return {
    id: rows[0]!.id,
    itemId,
    quantity,
    depositedAt: now,
    payout: item.shopSellPrice * quantity,
    paysOutInMs: SHIPPING_PAYOUT_MS,
  };
}

/**
 * Whether anything is waiting to be paid — one indexed lookup, no transaction.
 *
 * The farm poll asks this before opening a transaction to settle. Almost every
 * poll finds nothing due, and a transaction that settles nothing still costs a
 * BEGIN and a COMMIT on the game's hottest path (§11); asking first turns three
 * round trips into one.
 *
 * Racing is harmless in both directions: a false negative pays out on the next
 * poll a few seconds later, and a false positive opens a transaction that
 * settles nothing. The settlement itself re-checks and is guarded on its own.
 */
export async function hasDueShipments(
  q: Queryable,
  playerId: string,
  now: number,
): Promise<boolean> {
  const rows = await q
    .select({ id: schema.shipments.id })
    .from(schema.shipments)
    .where(
      and(
        eq(schema.shipments.playerId, playerId),
        isNull(schema.shipments.paidAt),
        lte(schema.shipments.depositedAt, now - SHIPPING_PAYOUT_MS),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Credits every shipment that has come due, and returns what was paid.
 *
 * **The UPDATE's own WHERE clause is the idempotency guard.** Each row is
 * claimed with `WHERE id = ? AND paid_at IS NULL`, and only rows that come back
 * from `RETURNING` were actually claimed by THIS transaction. Two concurrent
 * reads therefore cannot both credit the same shipment: the second one matches
 * nothing and returns nothing, so it adds nothing to the gold. There is no
 * separate "was this already paid?" check to forget, and no lock to hold.
 *
 * Gold moves in the same transaction as the rows that earned it, so there is no
 * instant where a shipment is marked paid and the gold has not arrived (§4.3).
 */
export async function settleShipments(
  tx: Tx,
  player: AuthedPlayer,
  now: number,
): Promise<number> {
  const due = await tx
    .select({
      id: schema.shipments.id,
      itemId: schema.shipments.itemId,
      quantity: schema.shipments.quantity,
    })
    .from(schema.shipments)
    .where(
      and(
        eq(schema.shipments.playerId, player.id),
        isNull(schema.shipments.paidAt),
        lte(schema.shipments.depositedAt, now - SHIPPING_PAYOUT_MS),
      ),
    );

  if (due.length === 0) return 0;

  let credited = 0;
  for (const row of due) {
    const payout = priceOf(row.itemId) * row.quantity;

    const claimed = await tx
      .update(schema.shipments)
      .set({ paidAt: now, payout })
      .where(and(eq(schema.shipments.id, row.id), isNull(schema.shipments.paidAt)))
      .returning({ id: schema.shipments.id });

    // Empty means another request settled it between the select and here.
    if (claimed.length > 0) credited += payout;
  }

  if (credited > 0) {
    await tx
      .update(schema.players)
      .set({ gold: sql`${schema.players.gold} + ${credited}` })
      .where(eq(schema.players.id, player.id));
  }

  return credited;
}

/** The box as the player sees it: what is waiting, and what it has paid. */
export async function shippingView(
  q: Queryable,
  player: AuthedPlayer,
  now: number,
  justPaid = 0,
): Promise<ShippingView> {
  const [pendingRows, paidRows] = await Promise.all([
    q
      .select()
      .from(schema.shipments)
      .where(and(eq(schema.shipments.playerId, player.id), isNull(schema.shipments.paidAt)))
      .orderBy(schema.shipments.depositedAt),
    q
      .select()
      .from(schema.shipments)
      .where(and(eq(schema.shipments.playerId, player.id), isNotNull(schema.shipments.paidAt)))
      .orderBy(desc(schema.shipments.paidAt))
      .limit(HISTORY_LIMIT),
  ]);

  return {
    pending: pendingRows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      quantity: r.quantity,
      depositedAt: r.depositedAt,
      // Today's price for something not yet sold; the row records the real
      // figure only once it is paid.
      payout: priceOf(r.itemId) * r.quantity,
      // Never negative: a row that is due but not yet settled reads as 0,
      // which is exactly what it is — it pays the next time anyone looks.
      paysOutInMs: Math.max(0, r.depositedAt + SHIPPING_PAYOUT_MS - now),
    })),
    paid: paidRows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      quantity: r.quantity,
      paidAt: r.paidAt!,
      payout: r.payout ?? 0,
    })),
    justPaid,
    payoutMs: SHIPPING_PAYOUT_MS,
  };
}
