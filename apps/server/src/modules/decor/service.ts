import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  ErrorCode,
  GameError,
  canPlaceDecor,
  getDecor,
  reservedFarmTiles,
  type DecorDef,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Queryable, Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { isVip } from '../player/view.js';
import { checkReachable } from './reachability.js';

/**
 * Decoration placed on the farm (T-15.18).
 *
 * **This is the house module's transactional SHAPE, copied deliberately, not
 * shared** (D-11). Buy locks the player row and moves gold; place locks every
 * placement and takes one from storage; remove gives it back. That shape is
 * correct and well-tested, and reusing it by generalising `modules/house` would
 * have meant reworking its `.for('update')` locks to serve a farm it knows
 * nothing about — in code the running game has not reached since T-11.05.
 *
 * The one real difference is `assertPlaceable`, which reads the farm's CURRENT
 * building tiers inside the transaction. The interior has no equivalent: a room
 * is a fixed rectangle, a farm is not.
 */

export interface PlacedDecorRow {
  readonly id: string;
  readonly decorId: string;
  readonly x: number;
  readonly y: number;
}

export interface OwnedDecor {
  readonly decorId: string;
  readonly quantity: number;
}

export interface DecorView {
  readonly placements: readonly PlacedDecorRow[];
  readonly owned: readonly OwnedDecor[];
}

function defOf(decorId: string): DecorDef {
  const def = getDecor(decorId);
  if (!def) {
    throw new GameError(ErrorCode.UNKNOWN_ITEM, 'No such decoration.', { decorId });
  }
  return def;
}

/** The caller's decor. Read-only, so no lock. */
export async function decorView(q: Queryable, player: AuthedPlayer): Promise<DecorView> {
  const placements = await q
    .select({
      id: schema.decorPlacements.id,
      decorId: schema.decorPlacements.decorId,
      x: schema.decorPlacements.x,
      y: schema.decorPlacements.y,
    })
    .from(schema.decorPlacements)
    .where(eq(schema.decorPlacements.playerId, player.id))
    .orderBy(asc(schema.decorPlacements.placedAt));

  const owned = await q
    .select({
      decorId: schema.decorOwned.decorId,
      quantity: schema.decorOwned.quantity,
    })
    .from(schema.decorOwned)
    .where(eq(schema.decorOwned.playerId, player.id));

  return { placements, owned: owned.filter((o) => o.quantity > 0) };
}

/* ------------------------------------------------------------------ *
 * Owning
 * ------------------------------------------------------------------ */

export interface BuyDecorResult {
  readonly decorId: string;
  readonly owned: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
}

/**
 * Buys one piece. Gold leaves and the piece arrives in one transaction.
 *
 * Decoration has no slot and no stack limit, so a full backpack cannot stop you
 * buying a fence — the same reasoning `buyFurniture` gives, and the reason
 * neither lives in `inventory_items`.
 */
export async function buyDecor(
  tx: Tx,
  player: AuthedPlayer,
  decorId: string,
  now: number,
): Promise<BuyDecorResult> {
  const def = defOf(decorId);

  if (def.vipOnly && !isVip(player, now)) {
    throw new GameError(ErrorCode.FORBIDDEN, 'That one is for VIP farms only.', { decorId });
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

  const owned = await addOwned(tx, player.id, decorId, 1);

  return { decorId, owned, goldDelta: -def.price, goldAfter: gold - def.price };
}

/**
 * Adds to storage, returning the new count.
 *
 * `quantity + n` in SQL rather than read-modify-write: two purchases landing
 * together must both count.
 */
async function addOwned(
  tx: Tx,
  playerId: string,
  decorId: string,
  delta: number,
): Promise<number> {
  const rows = await tx
    .insert(schema.decorOwned)
    .values({ playerId, decorId, quantity: delta })
    .onConflictDoUpdate({
      target: [schema.decorOwned.playerId, schema.decorOwned.decorId],
      set: { quantity: sql`${schema.decorOwned.quantity} + ${delta}` },
    })
    .returning({ quantity: schema.decorOwned.quantity });

  return rows[0]?.quantity ?? 0;
}

/**
 * Takes one out of storage, or refuses.
 *
 * The `where quantity > 0` is what makes two simultaneous placements of a
 * single owned fence resolve to one.
 */
async function takeOwned(tx: Tx, playerId: string, decorId: string): Promise<void> {
  const rows = await tx
    .update(schema.decorOwned)
    .set({ quantity: sql`${schema.decorOwned.quantity} - 1` })
    .where(
      and(
        eq(schema.decorOwned.playerId, playerId),
        eq(schema.decorOwned.decorId, decorId),
        sql`${schema.decorOwned.quantity} > 0`,
      ),
    )
    .returning({ quantity: schema.decorOwned.quantity });

  if (rows.length === 0) {
    throw new GameError(ErrorCode.INSUFFICIENT_ITEMS, 'You do not own one of those.', { decorId });
  }
}

/* ------------------------------------------------------------------ *
 * Placing
 * ------------------------------------------------------------------ */

/** Locks every placement this player owns, so an overlap check means something. */
/**
 * Serialises everything this player does to their own farm's decoration
 * (T-18.28).
 *
 * The same hole `modules/house` had, inherited with the shape this module
 * deliberately copied (D-11): `lockPlacements` locks the rows it RETURNS, so an
 * undecorated farm locks nothing and two concurrent placements both read "that
 * cell is free" and both insert. Locking the PLAYER row gives them something
 * that always exists to queue on — the tool `trade/service.ts`'s `lockPlayers`
 * already uses for two parties, here for one.
 *
 * Fixed alongside the house rather than after it: the bug was found there, and
 * shipping the fix to one of two identical code paths is how the other one gets
 * forgotten.
 */
async function lockFarmDecor(tx: Tx, playerId: string): Promise<void> {
  await tx
    .select({ id: schema.players.id })
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .for('update');
}

async function lockPlacements(tx: Tx, playerId: string, excludeId?: string) {
  const where = excludeId
    ? and(eq(schema.decorPlacements.playerId, playerId), ne(schema.decorPlacements.id, excludeId))
    : eq(schema.decorPlacements.playerId, playerId);

  return tx
    .select({
      id: schema.decorPlacements.id,
      decorId: schema.decorPlacements.decorId,
      x: schema.decorPlacements.x,
      y: schema.decorPlacements.y,
    })
    .from(schema.decorPlacements)
    .where(where)
    .for('update');
}

/**
 * The farm's building tiers, read INSIDE the transaction.
 *
 * The tiers decide how much ground the coop and barn cover, and therefore
 * whether a placement is legal. Reading them outside would leave a window where
 * a Deluxe barn is bought between the check and the insert.
 */
async function farmTiers(tx: Tx, playerId: string): Promise<{ coop: number; barn: number }> {
  const rows = await tx
    .select({ coop: schema.farms.coopTier, barn: schema.farms.barnTier })
    .from(schema.farms)
    .where(eq(schema.farms.playerId, playerId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new GameError(ErrorCode.NOT_FOUND, 'No farm.');
  return { coop: row.coop, barn: row.barn };
}

const REFUSAL: Record<string, { code: ErrorCode; message: string }> = {
  off_map: { code: ErrorCode.VALIDATION_FAILED, message: 'That is off the edge of your farm.' },
  reserved: { code: ErrorCode.DECOR_RESERVED_GROUND, message: 'Nothing can go there.' },
  occupied: { code: ErrorCode.PLOT_OCCUPIED, message: 'Something is already there.' },
  blocks_plot: {
    code: ErrorCode.DECOR_BLOCKS_PLOT,
    message: 'Too close to a crop — you would not be able to reach it.',
  },
};

/**
 * Everything that has to be true before a piece goes down.
 *
 * Throws before any write, so a refusal leaves the transaction with nothing to
 * undo. Two gates, in cost order: the cheap per-tile rules first, then the
 * flood fill — which only runs for a SOLID piece, because a piece you can walk
 * over cannot cut anything off.
 */
async function assertPlaceable(
  tx: Tx,
  playerId: string,
  def: DecorDef,
  x: number,
  y: number,
  existing: readonly { decorId: string; x: number; y: number }[],
): Promise<void> {
  const tiers = await farmTiers(tx, playerId);

  const others = existing.flatMap((row) => {
    const otherDef = getDecor(row.decorId);
    // A placement whose piece has left the config cannot be reasoned about, so
    // it occupies nothing rather than blocking the farm forever.
    return otherDef ? [{ def: otherDef, x: row.x, y: row.y }] : [];
  });

  const result = canPlaceDecor(def, x, y, reservedFarmTiles(tiers), others);
  if (!result.ok) {
    const refusal = REFUSAL[result.reason] ?? {
      code: ErrorCode.VALIDATION_FAILED,
      message: 'That cannot go there.',
    };
    throw new GameError(refusal.code, refusal.message, { decorId: def.id, x, y });
  }

  if (!def.solid) return;

  const reach = checkReachable({ tiers, placements: [...others, { def, x, y }] });
  if (!reach.ok) {
    throw new GameError(
      ErrorCode.DECOR_BLOCKS_PATH,
      'That would close off part of your farm. Leave a way through.',
      // `details` is flat (string | number) and player-visible, so this is a
      // short readable summary rather than the whole list — which for a fence
      // across the field would name all twenty plots.
      { decorId: def.id, x, y, unreachable: reach.unreachable.slice(0, 3).join(', ') },
    );
  }
}

export async function placeDecor(
  tx: Tx,
  player: AuthedPlayer,
  decorId: string,
  x: number,
  y: number,
  now: number,
): Promise<PlacedDecorRow> {
  const def = defOf(decorId);
  // Before the read the decision rests on (T-18.28).
  await lockFarmDecor(tx, player.id);
  const existing = await lockPlacements(tx, player.id);

  await assertPlaceable(tx, player.id, def, x, y, existing);

  // Placing consumes one from storage; removing gives it back. Decoration is
  // conserved, so a farm cannot be covered in pieces nobody bought.
  await takeOwned(tx, player.id, decorId);

  const inserted = await tx
    .insert(schema.decorPlacements)
    .values({ playerId: player.id, decorId, x, y, placedAt: now })
    .returning({ id: schema.decorPlacements.id });

  return { id: inserted[0]!.id, decorId, x, y };
}

/**
 * Moves a placed piece. The piece being moved is excluded from the overlap
 * check, so nudging it one tile does not collide with where it already is.
 *
 * Shipped as an endpoint the client does not currently call — the placement UI
 * does remove-then-place, which is one fewer interaction to teach. Recorded as
 * a choice, not an oversight.
 */
export async function moveDecor(
  tx: Tx,
  player: AuthedPlayer,
  placementId: string,
  x: number,
  y: number,
): Promise<PlacedDecorRow> {
  // A move is a placement (T-18.28): same phantom, same lock, taken first.
  await lockFarmDecor(tx, player.id);

  const rows = await tx
    .select({
      id: schema.decorPlacements.id,
      decorId: schema.decorPlacements.decorId,
      playerId: schema.decorPlacements.playerId,
    })
    .from(schema.decorPlacements)
    .where(eq(schema.decorPlacements.id, placementId))
    .limit(1)
    .for('update');

  const row = rows[0];
  // Someone else's decoration and decoration that does not exist look the same.
  if (!row || row.playerId !== player.id) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That is not on your farm.');
  }

  const def = defOf(row.decorId);
  const others = await lockPlacements(tx, player.id, placementId);

  await assertPlaceable(tx, player.id, def, x, y, others);

  await tx
    .update(schema.decorPlacements)
    .set({ x, y })
    .where(eq(schema.decorPlacements.id, placementId));

  return { id: placementId, decorId: row.decorId, x, y };
}

/**
 * Picks a piece back up and returns it to storage.
 *
 * Removal is never destruction: redecorating costs nothing, and a misplaced
 * 400g statue is not 400g gone.
 */
export async function removeDecor(
  tx: Tx,
  player: AuthedPlayer,
  placementId: string,
): Promise<{ readonly decorId: string; readonly owned: number }> {
  const rows = await tx
    .select({
      id: schema.decorPlacements.id,
      decorId: schema.decorPlacements.decorId,
      playerId: schema.decorPlacements.playerId,
    })
    .from(schema.decorPlacements)
    .where(eq(schema.decorPlacements.id, placementId))
    .limit(1)
    .for('update');

  const row = rows[0];
  if (!row || row.playerId !== player.id) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That is not on your farm.');
  }

  await tx.delete(schema.decorPlacements).where(eq(schema.decorPlacements.id, placementId));
  const owned = await addOwned(tx, player.id, row.decorId, 1);

  return { decorId: row.decorId, owned };
}
