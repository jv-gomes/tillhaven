import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  BED_FURNITURE_IDS,
  ErrorCode,
  GameError,
  INTERIOR_ROOM,
  STARTING_FURNITURE,
  fitsInRoom,
  getFurniture,
  isBedFurniture,
  overlaps,
  type FurnitureDef,
} from '@tillhaven/shared';
import { checkInteriorReachable, type InteriorPlacement } from './reachability.js';
import { db, schema } from '../../db/client.js';
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
 * The bed every house has
 * ------------------------------------------------------------------ */

/**
 * The starter bed's home, taken from `STARTING_FURNITURE` rather than written
 * out — a new account and a repaired one must land in the same room.
 */
const STARTER_BED = STARTING_FURNITURE.find((p) => isBedFurniture(p.furnitureId));

/**
 * Whether this player has a bed anywhere — placed or in storage.
 *
 * The cheap half of `ensureBed`, deliberately split out and answered with one
 * query so the overwhelmingly common case (they do) costs a single index hit
 * and no transaction. Same shape as `idleWorkPending` guarding `catchUpIdle`.
 */
export async function hasBed(q: Queryable, playerId: string): Promise<boolean> {
  const rows = await q
    .select({ one: sql<number>`1` })
    .from(schema.furniturePlacements)
    .where(
      and(
        eq(schema.furniturePlacements.playerId, playerId),
        inArray(schema.furniturePlacements.furnitureId, [...BED_FURNITURE_IDS]),
      ),
    )
    .limit(1);

  if (rows.length > 0) return true;

  const owned = await q
    .select({ one: sql<number>`1` })
    .from(schema.furnitureOwned)
    .where(
      and(
        eq(schema.furnitureOwned.playerId, playerId),
        inArray(schema.furnitureOwned.furnitureId, [...BED_FURNITURE_IDS]),
        sql`${schema.furnitureOwned.quantity} > 0`,
      ),
    )
    .limit(1);

  return owned.length > 0;
}

/**
 * Gives this player a bed if they have none, and puts it down for them.
 *
 * **Sleeping is the only way to recover energy, and energy gates every action
 * in the game** — so a player without a bed is a player who can work once and
 * then stop, permanently, unless they can find 1,400g. That is not a difficulty
 * curve, it is a dead account, and it is exactly what every account registered
 * before `STARTING_FURNITURE` existed is sitting in today: 103 of them on this
 * database at the time of writing.
 *
 * **A self-healing check rather than a data migration**, and the reason is
 * geometry. Choosing where the bed goes means asking `fitsInRoom`, `overlaps`
 * and `checkInteriorReachable` — three functions that live in shared TypeScript
 * config and encode footprints derived from sprite sizes. Reimplementing that in
 * a SQL migration would be a second authority on where furniture may stand
 * (§4.4), and it would go stale the first time a crop window changed. Asking the
 * real code, on the one read that proves the player is standing in the room,
 * costs one indexed query per house visit and can never disagree with itself.
 *
 * It also covers cases a one-off migration would not: an account restored from a
 * backup, a bed lost to some future bug, a piece removed from the catalogue.
 *
 * **The fallback matters.** If the bed's usual corner is taken, every cell is
 * tried in turn; if the room is genuinely too full, it goes into storage rather
 * than nowhere. Storage needs the decoration tray to get out of, which is worse
 * UX than a placed bed and infinitely better than no bed.
 */
export async function ensureBed(tx: Tx, playerId: string, now: number): Promise<void> {
  if (!STARTER_BED) return;

  // Taken first, before the read the decision rests on — see `lockRoom`. Two
  // house reads racing must not each conclude "no bed" and grant one.
  await lockRoom(tx, playerId);
  if (await hasBed(tx, playerId)) return;

  const def = defOf(STARTER_BED.furnitureId);
  const existing = await lockPlacements(tx, playerId);

  const spot = firstFreeSpot(def, STARTER_BED, existing);

  if (spot === null) {
    await addOwned(tx, playerId, def.id, 1);
    return;
  }

  await tx
    .insert(schema.furniturePlacements)
    .values({ playerId, furnitureId: def.id, x: spot.x, y: spot.y, placedAt: now });
}

/**
 * Where the bed can stand: its usual corner, else the first cell that works.
 *
 * Scanned in row-major order so the answer is deterministic — a repair that
 * picked a different corner on each attempt would make the room untestable.
 * `assertPlaceable` is reused as the predicate rather than its three checks
 * being re-asked here, so a bed this grants is one the player could have placed
 * themselves, reachability included.
 */
function firstFreeSpot(
  def: FurnitureDef,
  preferred: { readonly x: number; readonly y: number },
  existing: readonly { furnitureId: string; x: number; y: number }[],
): { x: number; y: number } | null {
  const candidates = [
    preferred,
    ...Array.from({ length: INTERIOR_ROOM.height }, (_, y) =>
      Array.from({ length: INTERIOR_ROOM.width }, (_, x) => ({ x, y })),
    ).flat(),
  ];

  for (const at of candidates) {
    try {
      assertPlaceable(def, at.x, at.y, existing);
      return at;
    } catch {
      // Not here. `assertPlaceable` throws before writing anything, so trying
      // the next cell costs nothing but the arithmetic.
    }
  }

  return null;
}

/**
 * The cheap check, then its own transaction — the shape `catchUpIdle` uses.
 *
 * Exported for the route to call before `interiorView`, so the view it returns
 * already contains the bed and the client never renders a bedless room even
 * once.
 */
export async function ensureBedIfMissing(playerId: string, now: number): Promise<void> {
  if (await hasBed(db, playerId)) return;
  await db.transaction((tx) => ensureBed(tx, playerId, now));
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
/**
 * Serialises everything this player does to their own room (T-18.28).
 *
 * **`lockPlacements` below cannot do this, and that is the bug it fixes.**
 * `SELECT … FOR UPDATE` locks the rows it RETURNS — so an empty room, or a room
 * whose pieces are all elsewhere, returns nothing and locks nothing. Two
 * concurrent placements then both read "that cell is free", both pass
 * `assertPlaceable`, and both insert: two pieces on one cell, which every other
 * part of this module is written on the assumption cannot happen. A phantom
 * read, not a lost update, which is why row locks on the placements were never
 * going to be enough.
 *
 * `house.integration.test.ts`'s own "cannot be raced" test caught it —
 * intermittently, with BOTH requests returning 200 — and being intermittent is
 * what let it read as a flake for as long as it did.
 *
 * Locking the PLAYER row is the same tool `trade/service.ts` uses to serialise
 * two parties (`lockPlayers`), applied to one. It is the standard answer to a
 * phantom: lock a row that always exists, so there is always something to
 * queue on.
 *
 * Taken FIRST in every mutating path, before any read the decision depends on.
 * A lock taken after the read it is meant to protect protects nothing.
 */
async function lockRoom(tx: Tx, playerId: string): Promise<void> {
  await tx
    .select({ id: schema.players.id })
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .for('update');
}

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

  /*
   * Last, because it is the only check that has to look at the whole room
   * (T-18.08). Furniture became SOLID, so a placement can now wall the player
   * away from the door or wall a piece away from the player — and the only way
   * to remove a piece is to walk up to it. Skipped entirely for a flat piece: a
   * rug you walk over cannot cut anything off.
   */
  if (def.flat) return;

  const room: InteriorPlacement[] = [{ def, x, y, label: def.name }];
  for (const other of existing) {
    const otherDef = getFurniture(other.furnitureId);
    if (!otherDef) continue;
    room.push({ def: otherDef, x: other.x, y: other.y, label: otherDef.name });
  }

  const reach = checkInteriorReachable(room);
  if (!reach.ok) {
    throw new GameError(
      ErrorCode.FURNITURE_BLOCKS_ROOM,
      'That would box something in. Leave a way around it.',
      // Joined rather than an array: the details bag is flat scalars, and
      // the client shows this as one sentence anyway.
      { unreachable: reach.unreachable.join(', ') },
    );
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
  // Before the read the decision rests on (T-18.28).
  await lockRoom(tx, player.id);
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
  // A move is a placement (T-18.28): same phantom, same lock, taken first.
  await lockRoom(tx, player.id);

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
