import { asc, eq } from 'drizzle-orm';
import {
  GameError,
  ErrorCode,
  CROPS,
  WATER_DURATION_MS,
  treeStateAt,
  isCropId,
  benefitsFor,
  type CropId,
  type FarmState,
  type PlotView,
  type AnimalView,
  type TreeView,
  type Farm,
  type IdleView,
  type IdleSummaryView,
  EnergyAction,
} from '@tillhaven/shared';
import { db, schema } from '../../db/client.js';
import type { Tx } from '../../db/tx.js';
import { growthAt, settleGrowth } from './growth.js';
import { applyIdleWork, idleWorkPending, toSimPlot, type IdleSummary } from './idleApply.js';
import { parseIdleCropId, parseIdleTasks } from './idle.js';
import { nextIdleAction } from './idleSim.js';
import { productionAt } from '../animals/production.js';
import { grantXp, levelForXp, xpForHarvest } from './level.js';
import {
  addItem,
  removeItem,
  capacityForPlayer,
  listSlots,
  Container,
} from '../inventory/service.js';
import { toSelfPlayer } from '../player/view.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { readEnergyRow, spendEnergy } from './energy.js';

/** Anything that can run a query: the pool, or a transaction handle. */
type Queryable = Tx | typeof db;

/**
 * The farm (CLAUDE.md §5.1, §5.2).
 *
 * Ownership is established by joining from the authenticated player id to the
 * farm, never by trusting a farm id from the request. A plot id in a body is
 * only ever used to look up a row that is then *checked* to belong to the
 * caller (§8).
 */

async function farmForPlayer(tx: Queryable, playerId: string) {
  const rows = await tx
    .select()
    .from(schema.farms)
    .where(eq(schema.farms.playerId, playerId))
    .limit(1);

  const farm = rows[0];
  if (!farm) {
    // Registration creates the farm in the same transaction as the player, so
    // this is a data-integrity problem rather than a user error.
    throw new GameError(ErrorCode.NOT_FOUND, 'That farm does not exist.');
  }
  return farm;
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/**
 * The hottest path in the game (CLAUDE.md §11). Three queries regardless of how
 * many plots or animals the farm has — never one per plot.
 */
export async function getFarmState(
  player: AuthedPlayer,
  now: number,
  /** Gold the shipping box just paid, for the client to announce (T-11.03). */
  shippingPaid = 0,
): Promise<FarmState> {
  const farmRow = await farmForPlayer(db, player.id);

  /*
   * The farmer's shift, applied BEFORE the plots are read (T-13.04) — so what
   * comes back is the farm after the catch-up, not a snapshot from before it
   * that the next poll would contradict.
   *
   * `idleWorkPending` is answered from the farm row already in hand, so a
   * player with idle switched off pays nothing at all for this: no extra
   * query, no transaction. `farm.queries.test.ts` pins that.
   */
  /*
   * The watermark AFTER the shift, which is what the lookahead below has to run
   * from — the action slots sit on a grid anchored there (see `simulate`), so
   * predicting off the pre-shift value would put every predicted `at` on the
   * wrong phase.
   */
  let idleProcessedAt = farmRow.idleProcessedAt;
  /*
   * What the shift got through, for the player to be told about (T-13.08).
   *
   * Surfaced from THIS read because this read is what applied it. Every farm
   * mutation also runs the catch-up (`afterIdleCatchUp`), and those summaries
   * are discarded — a player who tills a plot by hand the moment they get back
   * gets no "while you were away", which is the acceptable edge of reporting
   * from one place instead of threading a summary through every endpoint.
   * Coming back and looking at the farm is the case this is for, and that is a
   * farm read.
   */
  let idleSummary: IdleSummaryView | null = null;

  if (idleWorkPending(farmRow, now)) {
    const shift = await db.transaction((tx) => applyIdleWork(tx, player, now));
    /*
     * Reported when the farmer DID something — or when the only reason it did
     * not is a full bag. That second case is not a rounding error: a player who
     * left with one slot free comes back to a shift of zero actions, and
     * "nothing happened" is the least useful thing to tell them. It is the one
     * outcome they can act on, which is exactly why the simulator tells
     * `inventory_full` apart from `nothing_to_do` in the first place.
     */
    if (shift.actions > 0 || shift.stoppedReason === 'inventory_full') {
      idleSummary = toSummaryView(shift);
    }
    /*
     * A shift that ran reports where it left the watermark. A shift that found
     * a concurrent request had already done the work reports nothing at all
     * (`to` 0), and the stale value stands: the plots below are still the
     * post-shift ones, so the predicted action is the right one — only its `at`
     * is off, by less than the race was long, and the next poll corrects it.
     */
    if (shift.to > 0) idleProcessedAt = shift.to;
  }

  const [plotRows, animalRows, treeRows] = await Promise.all([
    db
      .select()
      .from(schema.plots)
      .where(eq(schema.plots.farmId, farmRow.id))
      .orderBy(asc(schema.plots.y), asc(schema.plots.x)),
    db
      .select()
      .from(schema.animals)
      .where(eq(schema.animals.farmId, farmRow.id))
      .orderBy(asc(schema.animals.acquiredAt)),
    db
      .select()
      .from(schema.trees)
      .where(eq(schema.trees.farmId, farmRow.id))
      .orderBy(asc(schema.trees.y), asc(schema.trees.x)),
  ]);

  const benefits = benefitsFor(player, now);

  const farm: Farm = {
    id: farmRow.id,
    playerId: farmRow.playerId,
    houseTier: farmRow.houseTier,
    chestTier: farmRow.chestTier,
    coopTier: farmRow.coopTier,
    barnTier: farmRow.barnTier,
    width: farmRow.width,
    height: farmRow.height,
  };

  const plots: PlotView[] = plotRows.map((p) => {
    const g = growthAt(p, now, benefits.durationPercent);
    /*
     * The soil state the client draws (T-9.04). `wetUntil` is absolute so a
     * plot can dry out on screen between polls without the client having to
     * know how long a watering lasts; `isWet` is the same question answered at
     * `serverNow`, for anything that is not interpolating.
     */
    const wetUntil = p.wateredAt === null ? null : p.wateredAt + WATER_DURATION_MS;
    return {
      id: p.id,
      farmId: p.farmId,
      x: p.x,
      y: p.y,
      unlocked: p.unlocked,
      cropId: (p.cropId !== null && isCropId(p.cropId) ? p.cropId : null) as CropId | null,
      plantedAt: p.plantedAt,
      growthDurationMs: p.growthDurationMs,
      wateredAt: p.wateredAt,
      witheredAt: p.witheredAt,
      harvestedAt: p.harvestedAt,
      tilled: p.tilledAt !== null,
      stage: g.stage,
      isRipe: g.isRipe,
      readyInMs: g.readyInMs,
      isPaused: g.isPaused,
      isWet: wetUntil !== null && now < wetUntil,
      wetUntil,
      effectiveDurationMs: g.effectiveDurationMs,
    };
  });

  /*
   * Resolved through the same pure function the collect intent uses, so what
   * the client is shown and what the server will actually hand over can never
   * disagree (§4.4). Buying and collecting are T-2.05; reading is already
   * correct here.
   */
  const animals: AnimalView[] = animalRows.map((a) => {
    const p = productionAt(a, now, benefits.durationPercent);
    return {
      id: a.id,
      farmId: a.farmId,
      kind: a.kind as AnimalView['kind'],
      variant: a.variant as AnimalView['variant'],
      name: a.name,
      acquiredAt: a.acquiredAt,
      maturesAt: a.maturesAt,
      lastCollectedAt: a.lastCollectedAt,
      fedUntil: a.fedUntil,
      isMature: p.isMature,
      isFed: p.isFed,
      hasProduce: p.cyclesOwed > 0,
      readyInMs: p.readyInMs,
    };
  });

  /*
   * Trees (T-20.01). Regrowth is derived here and nowhere else: the row stores
   * `choppedAt` and the answer is computed on read, so a stump grows back while
   * the tab is closed with no job to run it (§4.2).
   *
   * Through the same pure `treeStateAt` the chop intent will use, for the same
   * reason the animals above go through `productionAt` — what the client is
   * shown and what the server will act on cannot then disagree (§4.4).
   */
  const trees: TreeView[] = treeRows.map((t) => {
    const state = treeStateAt(t.choppedAt, now);
    return { id: t.id, x: t.x, y: t.y, ...state };
  });

  const idle = await idleViewFor(player, farmRow, {
    processedAt: idleProcessedAt,
    plots: plotRows,
    durationPercent: benefits.durationPercent,
    now,
  });

  return {
    farm,
    plots,
    animals,
    trees,
    player: toSelfPlayer(player, now),
    shippingPaid,
    idle,
    idleSummary,
    // The client measures its own clock offset against this rather than
    // trusting its local time (§4.1).
    serverNow: now,
  };
}

/**
 * The applier's own summary, narrowed to what a player is told (T-13.08).
 *
 * `gained` becomes `harvested` because that is what it is from the outside:
 * produce that landed in the bag, priced from the crop table by the applier
 * rather than counted off a projection. Seeds spent, experience and the
 * simulator's stop reason stay behind — the balance and the XP bar are already
 * on this same response, and "why the loop exited" is internal vocabulary.
 */
function toSummaryView(shift: IdleSummary): IdleSummaryView {
  return {
    tilled: shift.tilled,
    planted: shift.planted,
    watered: shift.watered,
    harvested: shift.gained,
    window: { from: shift.from, to: shift.to },
    bagWasFull: shift.stoppedReason === 'inventory_full',
  };
}

interface IdleViewInput {
  /** The watermark AFTER any shift this request applied. */
  readonly processedAt: number | null;
  /** The rows the view was built from — read once, used twice. */
  readonly plots: readonly (typeof schema.plots.$inferSelect)[];
  readonly durationPercent: number;
  readonly now: number;
}

/**
 * Idle mode as the poll reports it: the standing orders, and the next move
 * (T-13.05, §5.3).
 *
 * **The lookahead costs exactly one query, and only for a farmer with orders.**
 * It needs the bag — a plant needs a seed and a harvest needs somewhere to put
 * the produce — and that is the one thing the farm read does not already have.
 * Everything else is reused: the farm row was read to decide whether to run a
 * shift, and the plot rows are the ones the view is already built from.
 *
 * A switched-off farmer, or one given no chores at all, is short-circuited
 * before that query. Those are the two states a player who never touches the
 * feature is in, and this is the hottest path in the game (§11) —
 * `farm.queries.test.ts` pins both the free cases and the one that costs.
 */
async function idleViewFor(
  player: AuthedPlayer,
  farmRow: typeof schema.farms.$inferSelect,
  input: IdleViewInput,
): Promise<IdleView> {
  const tasks = parseIdleTasks(farmRow.idleTasks);
  const cropId = parseIdleCropId(farmRow.idleCropId);
  const orders = { enabled: farmRow.idleEnabled, tasks, cropId };

  /*
   * No watermark means idle has never been switched on, so there is no grid to
   * put an action on. Reported as "nothing next" rather than invented from
   * `now`: the first real enable is what sets the origin (see `setIdleSettings`).
   */
  if (!farmRow.idleEnabled || tasks.length === 0 || input.processedAt === null) {
    return { ...orders, nextAction: null };
  }

  const [capacity, slots] = await Promise.all([
    // Free for the backpack — the tier is on the session's player row.
    capacityForPlayer(db, player, Container.INVENTORY, input.now),
    listSlots(db, player.id, Container.INVENTORY),
  ]);

  const next = nextIdleAction({
    plots: input.plots.map(toSimPlot),
    items: slots.map((s) => ({
      slotIndex: s.slotIndex,
      itemId: s.itemId,
      quantity: s.quantity,
    })),
    capacity,
    tasks,
    cropId,
    from: input.processedAt,
    now: input.now,
    durationPercent: input.durationPercent,
  });

  return {
    ...orders,
    // Narrowed to the three fields the client may have: the simulator also
    // records which crop an action moved, and that is a plan the player has not
    // acted on yet (§4.1).
    nextAction:
      next === null
        ? null
        : {
            kind: next.kind,
            at: next.at,
            // One of the two, never both: chopping addresses a tree, everything
            // else a plot (T-20.06). Spread so the absent one is omitted rather
            // than sent as null — the client walks to whichever it is given.
            ...(next.plotId ? { plotId: next.plotId } : {}),
            ...(next.treeId ? { treeId: next.treeId } : {}),
          },
  };
}

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

/**
 * Loads a plot and LOCKS it, having first proved the caller owns it.
 *
 * The lock is what stops two concurrent harvests of the same plot from each
 * reading "ripe" and each paying out. The second waits, then re-reads a plot
 * that is already empty.
 */
async function lockOwnedPlot(tx: Tx, playerId: string, plotId: string) {
  const rows = await tx
    .select({
      plot: schema.plots,
      farmPlayerId: schema.farms.playerId,
    })
    .from(schema.plots)
    .innerJoin(schema.farms, eq(schema.plots.farmId, schema.farms.id))
    .where(eq(schema.plots.id, plotId))
    .limit(1)
    .for('update', { of: schema.plots });

  const row = rows[0];
  /*
   * A plot belonging to someone else and a plot that does not exist give the
   * same answer. Distinguishing them would confirm that a given id is real.
   */
  if (!row || row.farmPlayerId !== playerId) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That plot is not on your farm.');
  }
  return row.plot;
}

export interface TillResult {
  readonly plotId: string;
  readonly tilledAt: number;
}

/**
 * Hoes a plot so something can be planted in it (T-9.02, CLAUDE.md §5.2).
 *
 * Nothing in the request says which tool was swung, and nothing here checks
 * one. The equipped hotbar item, the character's position and its facing are
 * all client-side UX (§5.1) — this validates the only things that are actually
 * the server's: that the plot is the caller's, cleared, empty, and not already
 * tilled.
 */
export async function till(
  tx: Tx,
  player: AuthedPlayer,
  plotId: string,
  now: number,
): Promise<TillResult> {
  const plot = await lockOwnedPlot(tx, player.id, plotId);

  if (!plot.unlocked) {
    throw new GameError(ErrorCode.PLOT_LOCKED, 'That plot is not cleared yet.');
  }
  /*
   * Checked before `tilledAt`: a plot with a crop in it is necessarily already
   * tilled, so testing tilled-ness first would answer "already tilled" to
   * someone trying to hoe over a growing crop — true, but not the reason.
   */
  if (plot.cropId !== null) {
    throw new GameError(ErrorCode.PLOT_OCCUPIED, 'Something is already growing there.');
  }
  if (plot.tilledAt !== null) {
    throw new GameError(ErrorCode.PLOT_ALREADY_TILLED, 'That soil is already tilled.');
  }

  /*
   * Energy is charged AFTER the state checks and before the first write.
   * After, so a refused action costs nothing — being told "that plot is
   * already tilled" must not also take two points off the bar. Before, so the
   * charge and the effect are in one transaction and cannot come apart.
   */
  await spendEnergy(tx, player, EnergyAction.TILL, now);

  await tx
    .update(schema.plots)
    .set({ tilledAt: now })
    .where(eq(schema.plots.id, plot.id));

  return { plotId: plot.id, tilledAt: now };
}

export interface PlantResult {
  readonly plotId: string;
  readonly cropId: CropId;
  readonly plantedAt: number;
  readonly readyAt: number;
}

/**
 * Plants a seed. Consumes it from the inventory and stamps the plot, in one
 * transaction (§4.3).
 */
export async function plant(
  tx: Tx,
  player: AuthedPlayer,
  plotId: string,
  cropId: string,
  now: number,
): Promise<PlantResult> {
  if (!isCropId(cropId)) {
    throw new GameError(ErrorCode.UNKNOWN_CROP, 'No such crop.', { cropId });
  }
  const crop = CROPS[cropId as CropId];

  const plot = await lockOwnedPlot(tx, player.id, plotId);

  if (!plot.unlocked) {
    throw new GameError(ErrorCode.PLOT_LOCKED, 'That plot is not cleared yet.');
  }
  if (plot.cropId !== null) {
    throw new GameError(ErrorCode.PLOT_OCCUPIED, 'Something is already growing there.');
  }
  // Till → plant is the order of the loop (§5.2). Refused BEFORE the seed is
  // taken, so a mistimed plant costs nothing.
  if (plot.tilledAt === null) {
    throw new GameError(ErrorCode.PLOT_NOT_TILLED, 'That soil needs tilling first.');
  }

  await spendEnergy(tx, player, EnergyAction.PLANT, now);

  // Throws INSUFFICIENT_ITEMS and rolls the whole thing back if the seed is
  // not held — so a failed plant never consumes anything.
  await removeItem(tx, player.id, crop.seedItemId, 1);

  /*
   * The growth duration is SNAPSHOTTED onto the plot. Retuning a crop in config
   * later must not retroactively lengthen or shorten one already in the ground
   * (see growth.ts).
   */
  await tx
    .update(schema.plots)
    .set({
      cropId,
      plantedAt: now,
      growthDurationMs: crop.growthDurationMs,
      harvestedAt: null,
      /*
       * A fresh seed starts DRY with nothing banked (D-1, §5.2): the first
       * watering is what starts it growing. Resetting both here rather than
       * only on harvest means a plot can never inherit the previous crop's
       * progress, however it came to be empty.
       */
      wateredAt: null,
      grownMs: 0,
      witheredAt: null,
    })
    .where(eq(schema.plots.id, plot.id));

  return {
    plotId: plot.id,
    cropId: cropId as CropId,
    plantedAt: now,
    readyAt: now + crop.growthDurationMs,
  };
}

export interface WaterResult {
  readonly plotId: string;
  readonly wateredAt: number;
  /** When the soil dries out again, so the client never computes it. */
  readonly wetUntil: number;
  /** Growth banked by this watering — what the closing window had earned. */
  readonly grownMs: number;
}

/**
 * Waters a planted plot (T-9.03b, D-1).
 *
 * Settle, then stamp — in that order, and that is the whole design. Settling
 * banks whatever the currently-open window has earned before `wateredAt` is
 * overwritten, so watering early costs nothing and watering late loses only
 * the dry gap, which is exactly the rule §5.2 describes.
 *
 * Nothing here checks that the caller holds a watering can, or stands next to
 * the plot: the equipped item and the character's position are client-side UX
 * (§5.1). What is genuinely the server's — the plot is the caller's, it is
 * cleared, and something is actually growing in it — is checked.
 */
export async function water(
  tx: Tx,
  player: AuthedPlayer,
  plotId: string,
  now: number,
): Promise<WaterResult> {
  const plot = await lockOwnedPlot(tx, player.id, plotId);

  if (!plot.unlocked) {
    throw new GameError(ErrorCode.PLOT_LOCKED, 'That plot is not cleared yet.');
  }
  // Watering bare soil is a no-op the player would have to undo nothing to
  // recover from, but it would still overwrite `wateredAt` with a window that
  // no crop is there to use — and then planting would silently inherit it.
  if (plot.cropId === null || plot.plantedAt === null) {
    throw new GameError(ErrorCode.PLOT_EMPTY, 'There is nothing growing there.');
  }

  await spendEnergy(tx, player, EnergyAction.WATER, now);

  const grownMs = settleGrowth(plot, now);

  await tx
    .update(schema.plots)
    .set({ grownMs, wateredAt: now })
    .where(eq(schema.plots.id, plot.id));

  return {
    plotId: plot.id,
    wateredAt: now,
    wetUntil: now + WATER_DURATION_MS,
    grownMs,
  };
}

export interface HarvestResult {
  readonly plotId: string;
  readonly itemId: string;
  readonly quantity: number;
  /** Lifetime experience after this harvest, and the level it derives to. */
  readonly experience: number;
  readonly farmLevel: number;
}

/**
 * Harvests a ripe plot: produce into the inventory, plot back to empty, one
 * transaction.
 *
 * If the inventory is full, `addItem` throws and the rollback leaves the crop
 * standing in its plot. Produce is never silently destroyed (§5.4).
 */
export async function harvest(
  tx: Tx,
  player: AuthedPlayer,
  plotId: string,
  now: number,
): Promise<HarvestResult> {
  const plot = await lockOwnedPlot(tx, player.id, plotId);

  if (plot.cropId === null || plot.plantedAt === null) {
    throw new GameError(ErrorCode.PLOT_EMPTY, 'There is nothing growing there.');
  }
  if (!isCropId(plot.cropId)) {
    throw new GameError(ErrorCode.UNKNOWN_CROP, 'That crop no longer exists.');
  }

  const crop = CROPS[plot.cropId as CropId];
  const benefits = benefitsFor(player, now);

  const growth = growthAt(plot, now, benefits.durationPercent);
  if (!growth.isRipe) {
    throw new GameError(ErrorCode.CROP_NOT_READY, 'That is not ready yet.', {
      readyInMs: growth.readyInMs,
    });
  }

  await spendEnergy(tx, player, EnergyAction.HARVEST, now);

  const capacity = await capacityForPlayer(tx, player, Container.INVENTORY, now);

  // Throws INVENTORY_FULL and rolls back, leaving the crop where it is.
  await addItem(tx, player.id, crop.produceItemId, crop.yieldAmount, { capacity });

  /*
   * `tilledAt` is deliberately NOT cleared. Harvesting leaves workable soil, so
   * an established plot loops plant → water → harvest and the hoe is only for
   * ground that has never been broken (§5.2).
   */
  await tx
    .update(schema.plots)
    .set({
      cropId: null,
      plantedAt: null,
      growthDurationMs: null,
      // Both halves of the growth state go back to zero with the crop —
      // leaving `grownMs` behind would hand the next seed a head start.
      wateredAt: null,
      grownMs: 0,
      witheredAt: null,
      harvestedAt: now,
    })
    .where(eq(schema.plots.id, plot.id));

  /*
   * Experience for the wait, not for the crop. Granted here rather than at
   * planting so it cannot be farmed by planting and immediately clearing —
   * only a crop that actually grew pays out (see modules/farm/level.ts).
   */
  const experience = await grantXp(tx, player.id, xpForHarvest(crop.id));

  return {
    plotId: plot.id,
    itemId: crop.produceItemId,
    quantity: crop.yieldAmount,
    experience,
    farmLevel: levelForXp(experience),
  };
}

export interface HarvestAllResult {
  readonly harvested: readonly HarvestResult[];
  /**
   * True when the bag filled and ripe crops were left standing. The client
   * needs to tell "I cleared your farm" from "I cleared what fitted" — they
   * are different sentences and only one of them asks the player to do
   * something.
   */
  readonly stoppedByFullBag: boolean;
  /** True when the batch stopped because the farmer ran out of energy. */
  readonly stoppedByEnergy: boolean;
  /** Lifetime experience and level after the whole batch, for the HUD. */
  readonly experience: number;
  readonly farmLevel: number;
}

/**
 * Harvests every ripe plot in one intent — `VIP_BENEFITS.bulkHarvest`
 * (T-24.01, D-23).
 *
 * **It calls `harvest` in a loop rather than reimplementing it.** Bulk harvest
 * must mean exactly N harvests, or it becomes a second set of rules for what a
 * harvest does to soil, to `grownMs`, to XP — and the day one of them changes,
 * the paid path is the one that silently keeps the old behaviour. The cost is
 * one lock and one update per plot, which is bounded by `MAX_PLOTS` (21) plus
 * the VIP bonus and only reachable by a VIP.
 *
 * **Each plot runs in its own savepoint** (`tx.transaction` nests as
 * `SAVEPOINT`), so a plot that fails rolls back alone and the ones that
 * succeeded stay harvested.
 *
 * A flat loop passes every test in this file today, and the reason is worth
 * writing down because it is not a property of this function: `addItem` calls
 * `planAdd` and throws INVENTORY_FULL **before it writes anything**, so today
 * a failed `harvest` leaves no partial row behind and there is nothing for a
 * savepoint to undo. That is an invariant of `inventory/service.ts`, held by
 * the order of two statements in a different module, and nothing pins it.
 * Measured what happens without it (T-24.01): moving `harvest`'s plot update
 * above its `addItem` and dropping the savepoint clears a plot and adds no
 * produce — silent item destruction, on the paid path only. Restoring the
 * savepoint alone fixes it with the reorder still in place.
 *
 * So the savepoint is not decoration and it is not for the bag: it makes this
 * batch's atomicity depend on the transaction rather than on another module's
 * statement order.
 *
 * Plots are taken in `id` order so two concurrent batches lock in the same
 * sequence and cannot deadlock each other.
 */
export async function harvestAll(
  tx: Tx,
  player: AuthedPlayer,
  now: number,
): Promise<HarvestAllResult> {
  const benefits = benefitsFor(player, now);
  if (!benefits.bulkHarvest) {
    throw new GameError(ErrorCode.FORBIDDEN, 'Harvesting everything at once is a VIP perk.');
  }

  /*
   * Unlocked read: every candidate is re-checked under its own row lock inside
   * `harvest`, which is the check that counts. This scan only decides what to
   * try, and a plot that stopped being ripe in between is handled below.
   */
  const rows = await tx
    .select({ plot: schema.plots })
    .from(schema.plots)
    .innerJoin(schema.farms, eq(schema.plots.farmId, schema.farms.id))
    .where(eq(schema.farms.playerId, player.id))
    .orderBy(asc(schema.plots.id));

  const ripe = rows
    .map((r) => r.plot)
    .filter(
      (plot) =>
        plot.unlocked &&
        plot.cropId !== null &&
        isCropId(plot.cropId) &&
        growthAt(plot, now, benefits.durationPercent).isRipe,
    );

  if (ripe.length === 0) {
    throw new GameError(ErrorCode.CROP_NOT_READY, 'Nothing is ready to harvest yet.');
  }

  const harvested: HarvestResult[] = [];
  let stoppedByFullBag = false;
  let stoppedByEnergy = false;

  for (const plot of ripe) {
    try {
      /*
       * **The player's energy is re-read every iteration**, because `harvest`
       * charges with a conditional `where energy_spent = <what we read>` and
       * the session copy is stale the moment the first plot is picked. Without
       * this the second plot would fail as a "race" against ourselves.
       */
      const energy = await readEnergyRow(tx, player.id);
      const current: AuthedPlayer = { ...player, ...energy };

      // Nested = SAVEPOINT. One plot's failure is one plot's rollback.
      const result = await tx.transaction((sp) => harvest(sp as Tx, current, plot.id, now));
      harvested.push(result);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      if (err.code === ErrorCode.INVENTORY_FULL) {
        stoppedByFullBag = true;
        break;
      }
      /*
       * Out of energy partway through. Stopping cleanly beats failing the
       * whole batch: the player pressed one button meaning "clear the farm",
       * and clearing what they could afford is the useful answer. The result
       * says how far it got.
       */
      if (err.code === ErrorCode.INSUFFICIENT_ENERGY) {
        stoppedByEnergy = true;
        break;
      }
      /*
       * The plot stopped being ripe between the scan and its lock — the idle
       * farmer got there first, or a second tab did. Skip it; it is not an
       * error, it is the thing already being done.
       */
      if (err.code === ErrorCode.CROP_NOT_READY || err.code === ErrorCode.PLOT_EMPTY) continue;
      throw err;
    }
  }

  /*
   * Everything ripe was already gone by the time we held its lock, and the bag
   * never filled. Refusing with the same code as "nothing is ready" is honest:
   * from the player's side nothing was there to take.
   */
  if (harvested.length === 0 && stoppedByEnergy) {
    throw new GameError(ErrorCode.INSUFFICIENT_ENERGY, 'You are too tired.');
  }
  if (harvested.length === 0 && !stoppedByFullBag) {
    throw new GameError(ErrorCode.CROP_NOT_READY, 'Nothing is ready to harvest yet.');
  }
  if (harvested.length === 0) {
    throw new GameError(ErrorCode.INVENTORY_FULL, 'Your bag is full.');
  }

  const last = harvested[harvested.length - 1]!;
  return {
    harvested,
    stoppedByFullBag,
    stoppedByEnergy,
    experience: last.experience,
    farmLevel: last.farmLevel,
  };
}

