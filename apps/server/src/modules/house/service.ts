import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  ErrorCode,
  GameError,
  INTERIOR_ROOM,
  fitsInRoom,
  getFurniture,
  overlaps,
  type FurnitureDef,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Queryable, Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { isVip } from '../player/view.js';

/**
 * Furniture placement inside a player's house (CLAUDE.md §5.5).
 *
 * Three rules, all enforced here and none of them taken on trust from the
 * client: the piece must exist, it must fit **inside the room**, and it must not
 * **overlap** anything already placed. Ownership is the fourth, and it comes
 * from the session rather than from anything in the payload (§8).
 *
 * Placement is not free-form pixels. A piece sits on a cell, and its footprint
 * is `ceil(sprite / 16)` from config — so resizing a piece in config changes
 * what it occupies without a migration, and the client and server agree because
 * they compute it from the same place (§4.4).
 */

export interface PlacedFurniture {
  readonly id: string;
  readonly furnitureId: string;
  readonly x: number;
  readonly y: number;
}

export interface OwnedFurniture {
  readonly furnitureId: string;
  /** How many are in storage, i.e. owned but not currently placed. */
  readonly quantity: number;
}

export interface InteriorView {
  readonly room: { readonly width: number; readonly height: number };
  readonly placements: readonly PlacedFurniture[];
  /** What is in storage, ready to put down. */
  readonly owned: readonly OwnedFurniture[];
}

/** Resolves a furniture id, or refuses. */
function defOf(furnitureId: string): FurnitureDef {
  const def = getFurniture(furnitureId);
  if (!def) {
    throw new GameError(ErrorCode.UNKNOWN_ITEM, 'No such furniture.', { furnitureId });
  }
  return def;
}

/** The caller's interior. Read-only, so no lock. */
export async function interiorView(
  q: Queryable,
  player: AuthedPlayer,
): Promise<InteriorView> {
  const rows = await q
    .select({
      id: schema.furniturePlacements.id,
      furnitureId: schema.furniturePlacements.furnitureId,
      x: schema.furniturePlacements.x,
      y: schema.furniturePlacements.y,
    })
    .from(schema.furniturePlacements)
    .where(eq(schema.furniturePlacements.playerId, player.id))
    .orderBy(asc(schema.furniturePlacements.placedAt));

  const owned = await q
    .select({
      furnitureId: schema.furnitureOwned.furnitureId,
      quantity: schema.furnitureOwned.quantity,
    })
    .from(schema.furnitureOwned)
    .where(eq(schema.furnitureOwned.playerId, player.id));

  return {
    room: { width: INTERIOR_ROOM.width, height: INTERIOR_ROOM.height },
    placements: rows,
    owned: owned.filter((o) => o.quantity > 0),
  };
}

/* ------------------------------------------------------------------ *
 * Owning
 * ------------------------------------------------------------------ */

export interface BuyFurnitureResult {
  readonly furnitureId: string;
  readonly owned: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
}

/**
 * Buys one piece of furniture.
 *
 * Gold leaves and the piece arrives in one transaction. Unlike everything in
 * the bag, furniture has no slot and no stack limit, so a full inventory cannot
 * stop you buying a rug — decoration should never be gated on carrying capacity.
 *
 * **A VIP-only piece needs live VIP.** The check is `isVip` at purchase time,
 * which already returns false for a flagged (refunded or charged-back) account,
 * so a refund cannot leave someone shopping the exclusive catalogue.
 */
export async function buyFurniture(
  tx: Tx,
  player: AuthedPlayer,
  furnitureId: string,
  now: number,
): Promise<BuyFurnitureResult> {
  const def = defOf(furnitureId);

  if (def.vipOnly && !isVip(player, now)) {
    throw new GameError(ErrorCode.FORBIDDEN, 'That one is for VIP farms only.', { furnitureId });
  }

  const goldRows = await tx
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, player.id))
    .limit(1)
    .for('update');

  const gold = goldRows[0]?.gold;
  if (gold === undefined) throw new GameError(ErrorCode.NOT_FOUND, 'No such player.');

  if (gold < def.price) {
    throw new GameError(ErrorCode.INSUFFICIENT_GOLD, "You can't afford that.", {
      needed: def.price,
      held: gold,
    });
  }

  await tx
    .update(schema.players)
    .set({ gold: sql`${schema.players.gold} - ${def.price}` })
    .where(eq(schema.players.id, player.id));

  const owned = await addOwned(tx, player.id, furnitureId, 1);

  return { furnitureId, owned, goldDelta: -def.price, goldAfter: gold - def.price };
}

/**
 * Adds to storage, returning the new count.
 *
 * `on conflict do update` with `quantity + n` in SQL: two purchases landing
 * together must both count, and a read-modify-write would lose one.
 */
async function addOwned(
  tx: Tx,
  playerId: string,
  furnitureId: string,
  delta: number,
): Promise<number> {
  const rows = await tx
    .insert(schema.furnitureOwned)
    .values({ playerId, furnitureId, quantity: delta })
    .onConflictDoUpdate({
      target: [schema.furnitureOwned.playerId, schema.furnitureOwned.furnitureId],
      set: { quantity: sql`${schema.furnitureOwned.quantity} + ${delta}` },
    })
    .returning({ quantity: schema.furnitureOwned.quantity });

  return rows[0]?.quantity ?? 0;
}

/**
 * Takes one out of storage, or refuses.
 *
 * Locked and checked in one statement — the `where quantity > 0` is what makes
 * two simultaneous placements of a single owned chair resolve to one.
 */
async function takeOwned(tx: Tx, playerId: string, furnitureId: string): Promise<void> {
  const rows = await tx
    .update(schema.furnitureOwned)
    .set({ quantity: sql`${schema.furnitureOwned.quantity} - 1` })
    .where(
      and(
        eq(schema.furnitureOwned.playerId, playerId),
        eq(schema.furnitureOwned.furnitureId, furnitureId),
        sql`${schema.furnitureOwned.quantity} > 0`,
      ),
    )
    .returning({ quantity: schema.furnitureOwned.quantity });

  if (rows.length === 0) {
    throw new GameError(ErrorCode.INSUFFICIENT_ITEMS, 'You do not own one of those.', {
      furnitureId,
    });
  }
}

/**
 * Locks every placement this player owns.
 *
 * One statement, so there is no lock ordering to get wrong, and it is what makes
 * the overlap check mean something: without it two simultaneous placements could
 * each read an empty cell and both take it.
 */
async function lockPlacements(tx: Tx, playerId: string, excludeId?: string) {
  const where = excludeId
    ? and(
        eq(schema.furniturePlacements.playerId, playerId),
        ne(schema.furniturePlacements.id, excludeId),
      )
    : eq(schema.furniturePlacements.playerId, playerId);

  return tx
    .select({
      id: schema.furniturePlacements.id,
      furnitureId: schema.furniturePlacements.furnitureId,
      x: schema.furniturePlacements.x,
      y: schema.furniturePlacements.y,
    })
    .from(schema.furniturePlacements)
    .where(where)
    .for('update');
}

/**
 * Checks a candidate against the room and everything already in it.
 *
 * A placement that fails leaves nothing written, because it throws before the
 * insert — the transaction has done no work to undo.
 */
function assertPlaceable(
  def: FurnitureDef,
  x: number,
  y: number,
  existing: readonly { furnitureId: string; x: number; y: number }[],
): void {
  if (!fitsInRoom(def, x, y)) {
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'That does not fit there.', {
      x,
      y,
      roomWidth: INTERIOR_ROOM.width,
      roomHeight: INTERIOR_ROOM.height,
    });
  }

  for (const other of existing) {
    const otherDef = getFurniture(other.furnitureId);
    // A placement whose piece has left the config cannot be reasoned about, so
    // it is treated as occupying nothing rather than blocking the room forever.
    if (!otherDef) continue;

    if (overlaps({ def, x, y }, { def: otherDef, x: other.x, y: other.y })) {
      throw new GameError(ErrorCode.PLOT_OCCUPIED, 'Something is already there.', {
        furnitureId: other.furnitureId,
      });
    }
  }
}

export async function placeFurniture(
  tx: Tx,
  player: AuthedPlayer,
  furnitureId: string,
  x: number,
  y: number,
  now: number,
): Promise<PlacedFurniture> {
  const def = defOf(furnitureId);
  const existing = await lockPlacements(tx, player.id);

  assertPlaceable(def, x, y, existing);

  // Placing consumes one from storage; removing gives it back. Furniture is
  // conserved, so a room cannot be filled with pieces nobody bought.
  await takeOwned(tx, player.id, furnitureId);

  const inserted = await tx
    .insert(schema.furniturePlacements)
    .values({ playerId: player.id, furnitureId, x, y, placedAt: now })
    .returning({ id: schema.furniturePlacements.id });

  return { id: inserted[0]!.id, furnitureId, x, y };
}

/**
 * Moves a placed piece.
 *
 * The piece being moved is excluded from the overlap check, so nudging
 * something one cell does not collide with where it currently is.
 */
export async function moveFurniture(
  tx: Tx,
  player: AuthedPlayer,
  placementId: string,
  x: number,
  y: number,
): Promise<PlacedFurniture> {
  const rows = await tx
    .select({
      id: schema.furniturePlacements.id,
      furnitureId: schema.furniturePlacements.furnitureId,
      playerId: schema.furniturePlacements.playerId,
    })
    .from(schema.furniturePlacements)
    .where(eq(schema.furniturePlacements.id, placementId))
    .limit(1)
    .for('update');

  const row = rows[0];
  // Someone else's furniture and furniture that does not exist look the same.
  if (!row || row.playerId !== player.id) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That is not in your house.');
  }

  const def = defOf(row.furnitureId);
  const others = await lockPlacements(tx, player.id, placementId);

  assertPlaceable(def, x, y, others);

  await tx
    .update(schema.furniturePlacements)
    .set({ x, y })
    .where(eq(schema.furniturePlacements.id, placementId));

  return { id: placementId, furnitureId: row.furnitureId, x, y };
}

/**
 * Takes a piece back out of the room and returns it to storage.
 *
 * Removal is never destruction: the piece goes back to the pile it came from,
 * so redecorating costs nothing and a misplaced fireplace is not 2,500g gone.
 */
export async function removeFurniture(
  tx: Tx,
  player: AuthedPlayer,
  placementId: string,
): Promise<{ id: string }> {
  const rows = await tx
    .select({
      id: schema.furniturePlacements.id,
      furnitureId: schema.furniturePlacements.furnitureId,
      playerId: schema.furniturePlacements.playerId,
    })
    .from(schema.furniturePlacements)
    .where(eq(schema.furniturePlacements.id, placementId))
    .limit(1)
    .for('update');

  const row = rows[0];
  if (!row || row.playerId !== player.id) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That is not in your house.');
  }

  await tx
    .delete(schema.furniturePlacements)
    .where(eq(schema.furniturePlacements.id, placementId));

  await addOwned(tx, player.id, row.furnitureId, 1);

  return { id: placementId };
}
