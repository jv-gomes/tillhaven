import { eq } from 'drizzle-orm';
import {
  GameError,
  ErrorCode,
  ItemCategory,
  ToolKind,
  ITEMS,
  ITEM_IDS,
  WOOD_PER_TREE,
  treeStateAt,
  EnergyAction,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Tx } from '../../db/tx.js';
import {
  addItem,
  capacityForPlayer,
  countInSlots,
  listSlots,
  Container,
} from '../inventory/service.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { spendEnergy } from './energy.js';

/**
 * Chopping (T-20.03, Phase 20).
 *
 * The mechanic that makes a tree a resource instead of scenery. One tree, one
 * transaction: the row is marked chopped and the wood lands in the backpack, or
 * neither happens (§4.3).
 */

/**
 * Every item id that counts as an axe.
 *
 * Derived from `ToolKind.AXE` rather than written as `'axe_wood'`, because D-4
 * will add eight more tiers and a hardcoded id would leave a player holding an
 * iron axe unable to chop. This is the same argument `ToolKind` itself is
 * documented with — decide by what a tool DOES, never by parsing its name.
 */
const AXE_ITEM_IDS: readonly string[] = ITEM_IDS.filter((id) => {
  const item = ITEMS[id]!;
  return item.category === ItemCategory.TOOL && item.toolKind === ToolKind.AXE;
});

/**
 * Locks a tree and proves the caller owns it.
 *
 * Mirrors `lockOwnedPlot` exactly, including the part that matters: a tree
 * belonging to someone else and a tree that does not exist give the **same**
 * answer, because distinguishing them would confirm that a given id is real.
 *
 * `FOR UPDATE` on the tree row is what serialises two concurrent chops of the
 * same tree. The row always exists here (unlike the phantom T-18.28 found),
 * so locking it is enough — there is nothing to insert.
 */
async function lockOwnedTree(tx: Tx, playerId: string, treeId: string) {
  const rows = await tx
    .select({ tree: schema.trees, farmPlayerId: schema.farms.playerId })
    .from(schema.trees)
    .innerJoin(schema.farms, eq(schema.trees.farmId, schema.farms.id))
    .where(eq(schema.trees.id, treeId))
    .limit(1)
    .for('update', { of: schema.trees });

  const row = rows[0];
  if (!row || row.farmPlayerId !== playerId) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That tree is not on your farm.');
  }
  return row.tree;
}

export interface ChopResult {
  readonly treeId: string;
  readonly itemId: string;
  readonly quantity: number;
  /** When it will be back, so the client can start the countdown immediately. */
  readonly regrowsInMs: number;
}

/**
 * Chops a standing tree: wood into the backpack, tree to a stump, one
 * transaction.
 *
 * **The axe is checked against the database, not against the request.** Every
 * other tool action — till, water — checks nothing, and that is correct there:
 * the hoe and the can are granted to every account at registration, so there is
 * no state to verify and a payload naming a tool would only be the client
 * asserting what it owns (§4.1, and see `tillSchema`'s comment).
 *
 * The axe is different: **it is not granted**, so owning one is real state and
 * a real gate. `chopSchema` still carries no tool field — the server looks the
 * axe up itself, which is the only version of this check worth having.
 *
 * Order of failures is deliberate. Ownership first (it decides whether the id
 * even resolves), then the axe, then whether the tree is standing, then
 * capacity last — because capacity is the only one that depends on how much
 * wood a tree drops, and reporting "your bag is full" to someone chopping a
 * stump would be true and useless.
 */
export async function chop(
  tx: Tx,
  player: AuthedPlayer,
  treeId: string,
  now: number,
): Promise<ChopResult> {
  const tree = await lockOwnedTree(tx, player.id, treeId);

  const slots = await listSlots(tx, player.id, Container.INVENTORY);
  const hasAxe = AXE_ITEM_IDS.some((id) => countInSlots(slots, id) > 0);
  if (!hasAxe) {
    throw new GameError(ErrorCode.TOOL_REQUIRED, 'You need an axe to chop that.');
  }

  const state = treeStateAt(tree.choppedAt, now);
  if (!state.isStanding) {
    throw new GameError(ErrorCode.TREE_NOT_READY, 'That tree is still growing back.', {
      regrowsInMs: state.regrowsInMs,
    });
  }

  await spendEnergy(tx, player, EnergyAction.CHOP, now);

  const capacity = await capacityForPlayer(tx, player, Container.INVENTORY, now);

  /*
   * Throws INVENTORY_FULL and rolls back, leaving the tree standing (§4.3).
   *
   * **The TRANSACTION is what makes that true, not the order of these two
   * statements.** An earlier version of this comment claimed the credit had to
   * come first so the tree could never fall without paying out; swapping them
   * and re-running the suite left all 82 tests green, because a throw after the
   * update rolls the update back too. The ordering below is readability only —
   * if it ever starts to matter, something has escaped the transaction.
   */
  await addItem(tx, player.id, WOOD_ITEM_ID, WOOD_PER_TREE, { capacity });

  await tx.update(schema.trees).set({ choppedAt: now }).where(eq(schema.trees.id, tree.id));

  return {
    treeId: tree.id,
    itemId: WOOD_ITEM_ID,
    quantity: WOOD_PER_TREE,
    // Computed from the same instant just written, so the client's countdown
    // and the server's regrowth cannot start from different clocks.
    regrowsInMs: treeStateAt(now, now).regrowsInMs,
  };
}

/** What a tree drops. One place, so the drop and the catalogue cannot drift. */
const WOOD_ITEM_ID = 'wood';
