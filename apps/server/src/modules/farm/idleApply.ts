import { asc, eq, sql } from 'drizzle-orm';
import {
  CROPS,
  IDLE_ACTION_MS,
  IdleTask,
  WOOD_PER_TREE,
  benefitsFor,
  isCropId,
  xpForHarvest,
  type CropId,
} from '@tillhaven/shared';
import { db, schema } from '../../db/client.js';

/** What a tree drops. Matches `trees.ts` and `idleSim.ts` — one drop, one id. */
const WOOD_ITEM_ID = 'wood';
import type { Queryable, Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import {
  Container,
  addItem,
  capacityForPlayer,
  lockBothContainers,
  listSlots,
  removeItem,
} from '../inventory/service.js';
import { grantXp } from './level.js';
import { parseIdleTasks } from './idle.js';
import { energyOf } from './energy.js';
import {
  simulate,
  type SimPlot,
  type SimResult,
  type SimStop,
  type SimTree,
} from './idleSim.js';

/**
 * Applying the idle simulation (T-13.04, CLAUDE.md §5.3).
 *
 * This is where the pure simulator stops being a projection and becomes the
 * farm. `idleSim.ts` decides WHAT happened between the watermark and now;
 * this module is the only thing that writes it down, and it does so inside one
 * transaction (§4.3) with every row it touches locked first.
 *
 * **It runs before the farm is read and before any manual action**, which is
 * not an optimisation — it is what stops the two kinds of work interleaving.
 * A player who harvests a plot by hand must not then have the simulator decide
 * that same plot was ripe an hour ago; running the catch-up first means the
 * window a simulation covers can never span a manual change.
 */

/** What the farmer got through, for the player to be told about (T-13.08). */
export interface IdleSummary {
  readonly actions: number;
  readonly tilled: number;
  readonly planted: number;
  readonly watered: number;
  readonly harvested: number;
  /** Trees felled (T-20.06). */
  readonly chopped: number;
  /** Produce added, by item id. */
  readonly gained: Readonly<Record<string, number>>;
  /** Seeds used, by item id. */
  readonly spent: Readonly<Record<string, number>>;
  readonly experience: number;
  readonly from: number;
  readonly to: number;
  readonly stoppedReason: SimStop;
  /** Energy the offline farmer used, already charged to the player. */
  readonly energySpent: number;
}

const NOTHING: IdleSummary = {
  actions: 0,
  energySpent: 0,
  chopped: 0,
  tilled: 0,
  planted: 0,
  watered: 0,
  harvested: 0,
  gained: {},
  spent: {},
  experience: 0,
  from: 0,
  to: 0,
  stoppedReason: 'nothing_to_do',
};

/** The `farms` columns this module needs. A row from anywhere will do. */
export interface IdleFarmRow {
  readonly idleEnabled: boolean;
  readonly idleTasks: string;
  readonly idleCropId: string | null;
  readonly idleProcessedAt: number | null;
}

/**
 * Whether running the simulator could possibly change anything — the cheap
 * question, asked before a transaction is opened.
 *
 * Deliberately answered from a farm row the caller already has rather than by
 * a query of its own. `GET /api/farm` reads that row first thing, so an
 * idle-disabled player pays **nothing** for this feature existing — which the
 * query-count test pins, because the hottest path in the game is exactly where
 * a free-looking check turns out not to be (§11).
 *
 * A window shorter than one action cannot produce one, so it is not worth a
 * transaction either.
 */
export function idleWorkPending(farm: IdleFarmRow, now: number): boolean {
  if (!farm.idleEnabled || farm.idleProcessedAt === null) return false;
  return now - farm.idleProcessedAt >= IDLE_ACTION_MS;
}

/**
 * The catch-up as a standalone step: cheap check, then its own transaction.
 *
 * **Deliberately NOT folded into the caller's transaction.** Doing that was
 * the first design, and it produced a state no player should ever see: a
 * manual harvest of a plot the farmer had just picked would fail with
 * `PLOT_EMPTY`, and the failure would roll back the catch-up too — so the
 * error described a plot that, once the dust settled, still had a crop in it.
 * Committing the shift first means the refusal is at least TRUE, and the
 * produce is in the bag to show for it.
 *
 * Nothing is lost by splitting them. The ordering that matters is that the
 * catch-up lands BEFORE the manual action reads anything, and a committed
 * transaction is more firmly before than an uncommitted one. A request that
 * slips in between is fine: the applier is idempotent against its own
 * watermark, and the manual action locks whatever row it touches.
 */
export async function catchUpIdle(
  q: Queryable,
  player: AuthedPlayer,
  now: number,
): Promise<IdleSummary> {
  const rows = await q
    .select({
      idleEnabled: schema.farms.idleEnabled,
      idleTasks: schema.farms.idleTasks,
      idleCropId: schema.farms.idleCropId,
      idleProcessedAt: schema.farms.idleProcessedAt,
    })
    .from(schema.farms)
    .where(eq(schema.farms.playerId, player.id))
    .limit(1);

  const farm = rows[0];
  if (!farm || !idleWorkPending(farm, now)) return NOTHING;

  return db.transaction((tx) => applyIdleWork(tx, player, now));
}

/**
 * Runs the farmer's shift and writes the result.
 *
 * Lock order is **farm → plots → inventory**, the same discipline trade
 * execution follows: every path that touches more than one of them takes them
 * in that order, so two of these cannot deadlock each other, and the farm row
 * being first means a second caller blocks before it has read anything it
 * would have to re-check.
 *
 * The farm and plot locks turn out to be **individually redundant and jointly
 * necessary** — break-tested, not assumed. Drop either and the survivor still
 * serialises two concurrent shifts, so nothing pays out twice; drop both and a
 * ripe crop is harvested twice. Keep both: the redundancy is cheap, and which
 * one is doing the work depends on what the shift happens to touch.
 *
 * Returns what happened. A caller that only wants the side effects can ignore
 * it; T-13.08 reports it.
 */
export async function applyIdleWork(
  tx: Tx,
  player: AuthedPlayer,
  now: number,
): Promise<IdleSummary> {
  // 1. The farm row, locked. Re-read rather than trusted from the caller's
  //    earlier look: between that read and this lock another request may have
  //    already done this work, and its watermark is the one that counts.
  const farmRows = await tx
    .select({
      id: schema.farms.id,
      idleEnabled: schema.farms.idleEnabled,
      idleTasks: schema.farms.idleTasks,
      idleCropId: schema.farms.idleCropId,
      idleProcessedAt: schema.farms.idleProcessedAt,
    })
    .from(schema.farms)
    .where(eq(schema.farms.playerId, player.id))
    .limit(1)
    .for('update');

  const farm = farmRows[0];
  if (!farm || !idleWorkPending(farm, now)) return NOTHING;

  const from = farm.idleProcessedAt!;

  // 2. Plots, locked, in the same order the farm view uses — which is what
  //    makes the simulator's plot-order tie-break mean something stable.
  const plotRows = await tx
    .select()
    .from(schema.plots)
    .where(eq(schema.plots.farmId, farm.id))
    .orderBy(asc(schema.plots.y), asc(schema.plots.x))
    .for('update');

  /*
   * 2b. Trees, locked, in the same (y, x) order the farm read uses — the same
   *     stable-order argument the plots have. Locked because a manual chop
   *     racing this shift must serialise, exactly as `chop()` locks the row it
   *     is about to fell.
   */
  const treeRows = await tx
    .select()
    .from(schema.trees)
    .where(eq(schema.trees.farmId, farm.id))
    .orderBy(asc(schema.trees.y), asc(schema.trees.x))
    .for('update');

  // 3. Inventory, both containers in one statement — see `lockBothContainers`
  //    for why taking them together rather than in sequence is the deadlock
  //    fix, and why the locks inside `addItem`/`removeItem` below are then
  //    re-entrant no-ops.
  await lockBothContainers(tx, player.id);

  const benefits = benefitsFor(player, now);
  const capacity = await capacityForPlayer(tx, player, Container.INVENTORY, now);
  const slots = await listSlots(tx, player.id, Container.INVENTORY);

  const cropId =
    farm.idleCropId !== null && isCropId(farm.idleCropId) ? (farm.idleCropId as CropId) : null;

  const result = simulate({
    plots: plotRows.map(toSimPlot),
    trees: treeRows.map(toSimTree),
    items: slots.map((s) => ({
      slotIndex: s.slotIndex,
      itemId: s.itemId,
      quantity: s.quantity,
    })),
    capacity,
    tasks: parseIdleTasks(farm.idleTasks),
    cropId,
    from,
    to: now,
    durationPercent: benefits.durationPercent,
    /*
     * The farmer works on the player's own energy (MVP re-scope), settled for
     * any sleep in progress. `energyOf` reads the same row every manual action
     * charges against, so idle work and hand work draw on one bar rather than
     * two.
     */
    energy: energyOf(player, now).current,
  });

  const summary = await writeResult(tx, player, farm.id, plotRows, treeRows, result, from, now);
  return summary;
}

/**
 * A plot row as the simulator sees it.
 *
 * Exported because the farm view's next-action lookahead (T-13.05) reads the
 * same rows through the same lens — a second translation would be a second
 * chance to drop a column, and a dropped `grownMs` is a farm that predicts the
 * wrong action.
 */
export function toSimTree(row: typeof schema.trees.$inferSelect): SimTree {
  return { id: row.id, choppedAt: row.choppedAt };
}

export function toSimPlot(row: typeof schema.plots.$inferSelect): SimPlot {
  return {
    id: row.id,
    unlocked: row.unlocked,
    tilledAt: row.tilledAt,
    cropId: row.cropId,
    plantedAt: row.plantedAt,
    growthDurationMs: row.growthDurationMs,
    wateredAt: row.wateredAt,
    grownMs: row.grownMs,
  };
}

/**
 * Writes the simulation down.
 *
 * **Items move through the real `addItem`/`removeItem`, never by writing slot
 * rows from the simulated bag.** The simulator's slot layout is a projection
 * built to answer "does it fit"; replaying it as the truth would make the
 * simulator the authority on inventory, and any disagreement with the live
 * rules would become a dupe. Going through the real functions means the
 * capacity and stack rules are enforced once, by the code that owns them —
 * and because the simulator asked the same `addToSlots` before deciding, they
 * agree.
 *
 * The watermark moves LAST, so a failure anywhere above rolls the whole thing
 * back and the window is simply re-simulated on the next read.
 */
async function writeResult(
  tx: Tx,
  player: AuthedPlayer,
  farmId: string,
  before: readonly (typeof schema.plots.$inferSelect)[],
  treesBefore: readonly (typeof schema.trees.$inferSelect)[],
  result: SimResult,
  from: number,
  now: number,
): Promise<IdleSummary> {
  const counts = { tilled: 0, planted: 0, watered: 0, harvested: 0, chopped: 0 };
  const gained: Record<string, number> = {};
  const spent: Record<string, number> = {};
  /** When each plot was last harvested, for the column the real harvest sets. */
  const harvestedAt = new Map<string, number>();
  let xp = 0;

  /*
   * Item movement is priced from the crop table using the crop each action
   * recorded, never off the simulated bag. What a sowing costs and a harvest
   * yields is config's answer; taking it from the projection would make the
   * projection an authority on how much a player owns.
   */
  for (const action of result.actions) {
    switch (action.kind) {
      case IdleTask.TILL:
        counts.tilled += 1;
        break;

      case IdleTask.WATER:
        counts.watered += 1;
        break;

      case IdleTask.PLANT: {
        counts.planted += 1;
        if (!action.cropId) break;
        const crop = CROPS[action.cropId];
        spent[crop.seedItemId] = (spent[crop.seedItemId] ?? 0) + 1;
        break;
      }

      case IdleTask.CHOP: {
        counts.chopped += 1;
        /*
         * Priced from config, exactly like a harvest: `WOOD_PER_TREE` is what a
         * tree gives, and taking the number off the simulated bag would make
         * the projection an authority on how much the player owns.
         */
        gained[WOOD_ITEM_ID] = (gained[WOOD_ITEM_ID] ?? 0) + WOOD_PER_TREE;
        break;
      }

      case IdleTask.HARVEST: {
        counts.harvested += 1;
        // Every harvest carries a plot; the guard is for the type, not a case.
        if (action.plotId) harvestedAt.set(action.plotId, action.at);
        if (!action.cropId) break;
        const crop = CROPS[action.cropId];
        gained[crop.produceItemId] = (gained[crop.produceItemId] ?? 0) + crop.yieldAmount;
        xp += xpForHarvest(crop.id);
        break;
      }
    }
  }

  // Seeds out before produce in: a bag at its limit can only take a harvest
  // once the seed that made room has actually left it, and this is the order
  // the simulator assumed when it decided the harvest fit.
  for (const [itemId, quantity] of Object.entries(spent)) {
    await removeItem(tx, player.id, itemId, quantity);
  }

  if (Object.keys(gained).length > 0) {
    const capacity = await capacityForPlayer(tx, player, Container.INVENTORY, now);
    for (const [itemId, quantity] of Object.entries(gained)) {
      await addItem(tx, player.id, itemId, quantity, { capacity });
    }
  }

  // Plot rows: only the ones the simulation actually changed.
  const beforeById = new Map(before.map((p) => [p.id, p]));
  for (const plot of result.plots) {
    const original = beforeById.get(plot.id);
    if (!original || !plotChanged(original, plot)) continue;

    await tx
      .update(schema.plots)
      .set({
        tilledAt: plot.tilledAt,
        cropId: plot.cropId,
        plantedAt: plot.plantedAt,
        growthDurationMs: plot.growthDurationMs,
        wateredAt: plot.wateredAt,
        grownMs: plot.grownMs,
        ...(harvestedAt.has(plot.id) ? { harvestedAt: harvestedAt.get(plot.id)! } : {}),
      })
      .where(eq(schema.plots.id, plot.id));
  }

  /*
   * Tree rows: only the ones the simulation felled (T-20.06). `choppedAt` is
   * the single column, and regrowth is never written — it is derived from that
   * instant by `treeStateAt`, on the farm read and in the simulator alike
   * (§4.2).
   */
  const treesBeforeById = new Map(treesBefore.map((t) => [t.id, t]));
  for (const tree of result.trees) {
    const original = treesBeforeById.get(tree.id);
    if (!original || original.choppedAt === tree.choppedAt) continue;

    await tx
      .update(schema.trees)
      .set({ choppedAt: tree.choppedAt })
      .where(eq(schema.trees.id, tree.id));
  }

  const experience = xp > 0 ? await grantXp(tx, player.id, xp) : 0;

  /*
   * The watermark. `processedTo` rather than `now`: a run stopped by the action
   * cap has NOT covered the whole window, and writing `now` would silently
   * throw away the remainder (§5.3). Everything else settles the window in
   * full, including a window in which nothing happened — otherwise every poll
   * would re-simulate the same dead stretch forever.
   */
  await tx
    .update(schema.farms)
    .set({ idleProcessedAt: result.processedTo })
    .where(eq(schema.farms.id, farmId));

  /*
   * Charge what the farmer actually used.
   *
   * Unconditional `+=` rather than the conditional update `spendEnergy` uses:
   * this runs inside the idle applier's own transaction, which already holds
   * the farm row, and the simulator was handed a budget read in the same
   * transaction. There is no second reader to race with.
   */
  if (result.energySpent > 0) {
    await tx
      .update(schema.players)
      .set({ energySpent: sql`${schema.players.energySpent} + ${result.energySpent}` })
      .where(eq(schema.players.id, player.id));
  }

  return {
    actions: result.actions.length,
    ...counts,
    gained,
    spent,
    experience,
    from,
    to: result.processedTo,
    stoppedReason: result.stoppedReason,
    energySpent: result.energySpent,
  };
}

function plotChanged(row: typeof schema.plots.$inferSelect, plot: SimPlot): boolean {
  return (
    row.tilledAt !== plot.tilledAt ||
    row.cropId !== plot.cropId ||
    row.plantedAt !== plot.plantedAt ||
    row.growthDurationMs !== plot.growthDurationMs ||
    row.wateredAt !== plot.wateredAt ||
    row.grownMs !== plot.grownMs
  );
}
