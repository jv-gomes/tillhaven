import {
  CROPS,
  getItem,
  IDLE_ACTION_MS,
  IDLE_MAX_CATCHUP_ACTIONS,
  IdleTask,
  WATER_DURATION_MS,
  type CropId,
} from '@tillhaven/shared';
import { growthAt, plantedCrop, settleGrowth } from './growth.js';
import {
  addToSlots,
  countInSlots,
  removeFromSlots,
  type SlotContents,
} from '../inventory/service.js';

/**
 * The idle simulator (T-13.03a/b/c, CLAUDE.md §5.3).
 *
 * **Pure.** No database, no `Date.now()`, no randomness. Given the same input
 * it returns a deep-equal result forever, which is the property the whole
 * feature rests on: idle work is *derived* from a window of time (§4.2), so
 * the same window must never pay out twice differently. It is also what lets
 * T-13.05 ask "what will the farmer do next?" by running one step forward, and
 * T-13.04 apply the answer inside a transaction without the simulation itself
 * being able to fail halfway.
 *
 * **The virtual clock.** It starts at `from` and an action lands at each
 * multiple of `actionMs` after it — so a window of exactly one `actionMs`
 * yields exactly one action, matching `idleActionsIn` in shared config. That
 * agreement is asserted by a test rather than assumed: the applier watermarks
 * with this module's `processedTo` and sizes its expectations with that one,
 * and if they disagree a farm either loses work or is paid twice.
 *
 * **Growth arithmetic is imported, never reproduced.** `growthAt`,
 * `settleGrowth` and `plantedCrop` come from `growth.ts` — the same functions
 * the live farm reads and `water()` writes through. A second copy of the
 * wet-window maths is how the simulator and the real farm would come to
 * disagree about whether a crop was growing, and the simulator is what pays
 * out.
 *
 * **Inventory arithmetic is imported too** (T-13.03c). `addToSlots` and
 * `removeFromSlots` are the pure halves of `addItem`/`removeItem`, so the
 * simulator answers "does this harvest fit?" with the exact function the
 * applier will then use to write it. A simulator that said yes where the real
 * add says no would pay out a harvest that cannot be stored.
 */

/** A plot as the simulator sees it — exactly the columns it can read or write. */
export interface SimPlot {
  readonly id: string;
  readonly unlocked: boolean;
  readonly tilledAt: number | null;
  readonly cropId: string | null;
  readonly plantedAt: number | null;
  readonly growthDurationMs: number | null;
  readonly wateredAt: number | null;
  readonly grownMs: number;
}

/**
 * The backpack, modelled as SLOTS rather than as counts.
 *
 * Counts would be a lie the moment a harvest had to fit: how much room a bag
 * has depends on how its stacks are packed, and a real bag can be fragmented
 * (two half-stacks of the same item, after a drag-and-drop). A count model
 * would over-report room, the simulator would decide a harvest fits, and the
 * applier's `addItem` would then refuse it — the simulator being wrong about
 * the thing it is paying out. So the sim carries the same shape the inventory
 * does and shares its planning functions (T-13.03c).
 */
export type SimItems = readonly SlotContents[];

export interface SimInput {
  /**
   * The farm's plots, in a STABLE order — the caller's order is the tie-break
   * when several plots are equally workable, so it decides which corner of the
   * field gets worked first. The applier passes them ordered by (y, x), the
   * same order the farm-state read uses.
   */
  readonly plots: readonly SimPlot[];
  readonly items: SimItems;
  /** Backpack slot count, from `capacityFor`. Harvests must fit inside it. */
  readonly capacity: number;
  readonly tasks: readonly IdleTask[];
  /** What to sow. `null` = sow nothing, which is a real setting (T-13.02). */
  readonly cropId: CropId | null;
  /** The window to simulate, in epoch ms. */
  readonly from: number;
  readonly to: number;
  /**
   * The VIP duration multiplier (100 free, 80 for VIP), passed straight to
   * `growthAt`. It decides when a crop is ripe, and therefore when watering it
   * stops being worth an action slot.
   */
  readonly durationPercent?: number;
  /** Overridable only so tests can use round numbers. Defaults to config. */
  readonly actionMs?: number;
  readonly maxActions?: number;
}

export interface SimAction {
  /** Virtual time the action completed. */
  readonly at: number;
  readonly kind: IdleTask;
  readonly plotId: string;
  /**
   * The crop this action moved: sown for a plant, picked for a harvest;
   * absent for tilling and watering, which touch no crop in particular.
   *
   * Recorded HERE rather than reconstructed by the applier, because only the
   * simulator knows what was standing in a plot at the instant it acted. Over
   * a long window a plot can be harvested, replanted and harvested again, and
   * an applier reading the plot's final state would price the first harvest
   * as whatever happened to be growing at the end.
   */
  readonly cropId?: CropId;
}

/**
 * Why the simulation stopped.
 *
 * `nothing_to_do`, `inventory_full` and `window_end` all mean the whole window
 * is accounted for; `action_cap` means it is not, and `processedTo` is short of
 * `to` so the next read picks up where this one left off.
 *
 * `inventory_full` is deliberately distinct from `nothing_to_do` even though
 * both settle the window: it is the one stop a player can DO something about,
 * and T-13.08's offline summary needs to be able to say so. It is reported
 * only when a full bag was the thing standing in the way — a farmer that had
 * simply finished everything reports `nothing_to_do`.
 */
export type SimStop = 'window_end' | 'nothing_to_do' | 'action_cap' | 'inventory_full';

export interface SimResult {
  readonly actions: readonly SimAction[];
  readonly plots: readonly SimPlot[];
  readonly items: SimItems;
  /** Virtual time actually reached. Never greater than `to`. */
  readonly processedTo: number;
  readonly stoppedReason: SimStop;
}

/**
 * Priority, descending time-criticality:
 *
 *     harvest > water > plant > till
 *
 * **Harvesting is first** because a ripe crop is finished growing: every slot
 * it sits in the ground is a slot the plot could have spent on the next crop.
 * It is also the only action that turns work into something the player owns.
 *
 * **Watering is second** because it is the only action with a deadline: dry
 * soil is growth that is not happening, and the time lost cannot be recovered
 * later. Tilling one more plot can always wait; a crop that dries out has
 * already cost the player the gap.
 *
 * Planting outranks tilling for the mirror reason. A farmer that tilled the
 * whole field before sowing anything would leave every seed in the bag for an
 * hour on a twenty-plot farm; sowing the ground it just broke gets crops
 * growing sooner, and growing is the only thing that pays.
 */
const PRIORITY: readonly IdleTask[] = [
  IdleTask.HARVEST,
  IdleTask.WATER,
  IdleTask.PLANT,
  IdleTask.TILL,
];

/** Empty means "no crop here", which is not the same as "nothing growing". */
function isEmptyPlot(plot: SimPlot): boolean {
  return plot.cropId === null;
}

/** Mirrors `till()` in service.ts — unlocked, nothing growing, not already hoed. */
function canTill(plot: SimPlot): boolean {
  return plot.unlocked && isEmptyPlot(plot) && plot.tilledAt === null;
}

/** Mirrors `plant()` in service.ts — unlocked, empty, and tilled. */
function canPlant(plot: SimPlot): boolean {
  return plot.unlocked && isEmptyPlot(plot) && plot.tilledAt !== null;
}

/**
 * Whether watering this plot right now would buy anything.
 *
 * **`isPaused` is exactly that question already asked**, so this reuses
 * `growthAt` rather than re-deriving dryness: it is defined as "planted, not
 * ripe, and the soil is dry", which is precisely when a watering can converts
 * an action slot into growth. Re-implementing the wet-window arithmetic here
 * is how the simulator and the real farm would end up disagreeing about
 * whether a crop was growing — and the simulator is what pays out.
 *
 * It also gets two behaviours for free. A **ripe** crop is never watered, so
 * one finished plot cannot soak up every action slot forever waiting for
 * T-13.03c's harvest. And with `WATERING_ENABLED` off (the D-1 revert),
 * `isPaused` is always false, so the farmer simply never waters — no second
 * place reads that flag.
 */
function canWater(plot: SimPlot, at: number, durationPercent: number): boolean {
  return plot.unlocked && growthAt(plot, at, durationPercent).isPaused;
}

function seedsHeld(items: SimItems, cropId: CropId): number {
  return countInSlots(items, CROPS[cropId].seedItemId);
}

/**
 * A ripe crop the farmer could pick — if there is room for what comes off it.
 *
 * Returns the slot layout the harvest would produce, so the decision and the
 * write are the same computation: `chooseAction` cannot say "yes, harvest" on
 * a bag that `addToSlots` would then refuse. Null means either nothing ripe or
 * nothing that fits, and the caller distinguishes those.
 */
function harvestInto(
  plot: SimPlot,
  items: SimItems,
  capacity: number,
  at: number,
  durationPercent: number,
): SimItems | null {
  if (!plot.unlocked) return null;

  const crop = plantedCrop(plot);
  if (!crop || !growthAt(plot, at, durationPercent).isRipe) return null;

  const produce = getItem(crop.produceItemId);
  // A crop whose produce is no longer a real item is left in the ground rather
  // than crashing a whole farm's catch-up over one config change.
  if (!produce) return null;

  return addToSlots(items, crop.produceItemId, crop.yieldAmount, produce.stackLimit, capacity);
}

interface Chosen {
  readonly kind: IdleTask;
  readonly index: number;
  /** For a harvest: the bag it produces, already computed. */
  readonly items?: SimItems;
}

/**
 * The single action the farmer takes next, or null if there is nothing to do.
 *
 * Highest-priority task first, then the first plot in the caller's order that
 * can take it — so the choice is total and deterministic with no tie-breaking
 * left to array iteration order elsewhere.
 *
 * **Under contention the earlier plot always wins, and later ones wait.** That
 * is a real consequence and it is deliberate: with the shipped constants one
 * plot needs watering every `WATER_DURATION_MS` (4h) and a slot comes every
 * `IDLE_ACTION_MS` (10s), so a farm would need over a thousand plots before the
 * cadence could not serve them all — and `MAX_PLOTS` is 20. Spreading the loss
 * fairly would be a heuristic written for a state the constants make
 * unreachable; a rule that is simple and total is worth more than a fair one
 * nobody can trigger.
 *
 * The waiting is not permanent, which is the part worth knowing: a plot at the
 * front stops asking once it ripens, and the queue reaches the back. So the
 * later plots finish last rather than never. `idleSim.test.ts` pins the whole
 * sequence, so if the constants ever move this is a decision rather than a
 * surprise.
 */
function chooseAction(
  plots: readonly SimPlot[],
  items: SimItems,
  capacity: number,
  tasks: ReadonlySet<IdleTask>,
  cropId: CropId | null,
  at: number,
  durationPercent: number,
): { chosen: Chosen | null; blockedByBag: boolean } {
  let blockedByBag = false;

  for (const kind of PRIORITY) {
    if (!tasks.has(kind)) continue;

    if (kind === IdleTask.HARVEST) {
      /*
       * Every ripe plot is tried, not just the first: a bag with one slot left
       * may have no room for a stack of onions and plenty for a single potato,
       * and giving up at the first refusal would strand a harvest that fits.
       * A plot that is ripe but does not fit sets `blockedByBag`, which is how
       * `inventory_full` is told apart from "nothing left to do".
       */
      for (const [index, plot] of plots.entries()) {
        const after = harvestInto(plot, items, capacity, at, durationPercent);
        if (after) return { chosen: { kind, index, items: after }, blockedByBag };

        if (growthAt(plot, at, durationPercent).isRipe && plot.unlocked) blockedByBag = true;
      }
      continue;
    }

    if (kind === IdleTask.PLANT) {
      // Sowing nothing is a legitimate setting, and a crop with no seed left
      // is not an error — it is simply not the next thing to do.
      if (cropId === null || seedsHeld(items, cropId) <= 0) continue;
    }

    const index = plots.findIndex((p) =>
      kind === IdleTask.WATER
        ? canWater(p, at, durationPercent)
        : kind === IdleTask.PLANT
          ? canPlant(p)
          : canTill(p),
    );
    if (index >= 0) return { chosen: { kind, index }, blockedByBag };
  }

  return { chosen: null, blockedByBag };
}

/**
 * The next instant at which time alone makes something newly possible, or null.
 *
 * There are two: soil dries `WATER_DURATION_MS` after it was wetted, and a
 * growing crop ripens once it has banked enough watered time. Tilling and
 * planting are not on any clock — they become possible because of an *action*,
 * never because of the passage of time — which is why T-13.03a could stop dead
 * instead of waiting.
 *
 * Strictly after `at`, which is what makes the loop terminate: each jump either
 * finds work or retires the plot whose deadline it jumped to, so the set of
 * candidates shrinks. A crop that ripens before its soil dries reports its
 * dry-time anyway and is simply not chosen when the clock gets there — cheaper
 * than re-deriving the ripening instant, and bounded by the plot count.
 *
 * T-13.03c adds the other one: a growing crop becomes ripe at a computable
 * time, and that is a harvest opportunity.
 */
function nextOpportunity(
  plots: readonly SimPlot[],
  at: number,
  tasks: ReadonlySet<IdleTask>,
  durationPercent: number,
): number | null {
  let soonest: number | null = null;
  const offer = (t: number) => {
    if (t > at && (soonest === null || t < soonest)) soonest = t;
  };

  for (const plot of plots) {
    if (!plot.unlocked || plot.wateredAt === null) continue;

    const growth = growthAt(plot, at, durationPercent);
    // Nothing growing here, or nothing left to grow.
    if (!plantedCrop(plot) || growth.isRipe) continue;

    const driesAt = plot.wateredAt + WATER_DURATION_MS;
    if (tasks.has(IdleTask.WATER)) offer(driesAt);

    /*
     * A crop that is currently WET is on a clock of its own: `readyInMs` is
     * how much more *watered* time it needs, so while the soil stays wet it
     * ripens exactly that far from now. Taken from `growthAt` rather than
     * re-derived from `grownMs` and the duration — same rule as everywhere
     * else in this file.
     *
     * Only offered when it lands inside the current wet window. Past that the
     * soil is dry and the crop is not accruing anything, so the real next
     * event is the watering, which the branch above already offers.
     */
    if (tasks.has(IdleTask.HARVEST)) {
      const ripeAt = at + growth.readyInMs;
      if (ripeAt <= driesAt) offer(ripeAt);
    }
  }

  return soonest;
}

/**
 * Runs the farmer's standing orders over a window of time.
 *
 * Nothing here throws: a simulation is a projection, and the caller
 * (T-13.04) runs it inside a transaction it is about to commit. Impossible
 * settings — no tasks, no seeds, a locked farm — produce zero actions, not an
 * error.
 */
export function simulate(input: SimInput): SimResult {
  const actionMs = input.actionMs ?? IDLE_ACTION_MS;
  const maxActions = input.maxActions ?? IDLE_MAX_CATCHUP_ACTIONS;

  const plots = input.plots.map((p) => ({ ...p }));
  let items: SimItems = [...input.items];
  const tasks = new Set(input.tasks);
  const actions: SimAction[] = [];

  // A window that has not happened yields nothing rather than running
  // backwards — the same rule `idleActionsIn` applies, for the same reason.
  if (!(actionMs > 0) || !Number.isFinite(input.from) || !Number.isFinite(input.to)) {
    return {
      actions,
      plots,
      items,
      processedTo: input.from,
      stoppedReason: 'nothing_to_do',
    };
  }

  const durationPercent = input.durationPercent ?? 100;

  /*
   * Action slots sit on a fixed grid — `from + slot * actionMs` — rather than
   * being chained off the previous action. That is what makes an idle stretch
   * cost nothing to skip AND keeps the cadence honest across one: a farmer
   * that waits four hours for soil to dry resumes on the grid, not on a clock
   * restarted by the wait.
   */
  let slot = 1;
  let stoppedReason: SimStop = 'window_end';
  let clock = input.from;

  for (;;) {
    if (actions.length >= maxActions) {
      stoppedReason = 'action_cap';
      break;
    }

    // An action that has not finished has not happened, so the first one lands
    // one whole `actionMs` into the window.
    const at = input.from + slot * actionMs;
    if (at > input.to) {
      stoppedReason = 'window_end';
      break;
    }

    const { chosen, blockedByBag } = chooseAction(
      plots,
      items,
      input.capacity,
      tasks,
      input.cropId,
      at,
      durationPercent,
    );
    if (!chosen) {
      /*
       * Nothing to do at this slot. Watering is the only thing time alone can
       * make possible, so either a plot is about to dry out — jump to the first
       * slot at or after that moment — or the window is genuinely finished.
       */
      const next = nextOpportunity(plots, at, tasks, durationPercent);
      if (next === null || next > input.to) {
        /*
         * A full bag is the one stop the player can act on, so it is reported
         * as itself rather than folded into "nothing to do" — but only when a
         * ripe crop was actually left standing because of it.
         */
        stoppedReason = blockedByBag ? 'inventory_full' : 'nothing_to_do';
        break;
      }

      /*
       * "The first action slot at-or-after expiry": growth pauses only for the
       * remainder of the slot the cadence forces, which is the honest cost of
       * one action per `IDLE_ACTION_MS` and not a penalty invented here.
       *
       * **`Math.ceil` is intent and efficiency, not the guard** — a
       * break-test replacing it with `floor` changed no output at all. What
       * actually keeps this correct is that landing early is harmless: the
       * plot is still wet, `chooseAction` returns null again, and the next
       * jump lands on the right slot. `Math.max(slot + 1, …)` is the part that
       * must not be removed, because it is what guarantees forward progress
       * and therefore that this loop terminates.
       */
      slot = Math.max(slot + 1, Math.ceil((next - input.from) / actionMs));
      continue;
    }

    const plotId = plots[chosen.index]!.id;
    const touched = cropTouchedBy(plots[chosen.index]!, chosen.kind, input.cropId);
    items = apply(plots, items, chosen, input.cropId, at);
    actions.push({ at, kind: chosen.kind, plotId, ...(touched ? { cropId: touched } : {}) });
    clock = at;
    slot += 1;
  }

  return {
    actions,
    plots,
    items,
    /*
     * A cap means the window is NOT fully accounted for, so the watermark
     * stops at the last action and the next read continues from there. Any
     * other stop means nothing more would have happened before `to`, so the
     * whole window is settled — otherwise an idle farm with nothing to do
     * would re-simulate the same empty stretch on every single poll.
     *
     * Never before `from`: a window that runs backwards (`to < from`, which a
     * clock adjustment can produce) settles nothing rather than handing the
     * applier a watermark that would move the farm into the past.
     */
    processedTo:
      stoppedReason === 'action_cap' ? clock : Math.max(input.from, input.to),
    stoppedReason,
  };
}

/**
 * How far ahead `nextIdleAction` looks.
 *
 * A horizon is required rather than chosen: `simulate` refuses a non-finite
 * `to`, because a window that never ends is a loop that never ends. This one
 * is picked so it cannot hide anything an unbounded look would have found.
 *
 * Every event *time alone* can produce is inside one wet window.
 * `nextOpportunity` offers exactly two things — soil drying
 * `WATER_DURATION_MS` after it was wetted, and a crop ripening, and the latter
 * only when it lands before the former. No action is taken along the way (the
 * first one ends the search), so no plot's `wateredAt` moves and the whole set
 * of candidate instants is fixed at the start. Add one `IDLE_ACTION_MS` for
 * the slot the cadence rounds up to and the window provably contains the
 * answer.
 */
const LOOKAHEAD_MS = WATER_DURATION_MS + IDLE_ACTION_MS;

export interface NextActionInput extends Omit<SimInput, 'to' | 'maxActions'> {
  /**
   * The server's clock, which is NOT `from`.
   *
   * `from` is the watermark — the grid the action slots sit on, and the thing
   * that makes a predicted `at` line up with the instant the next catch-up will
   * actually stamp. The lookahead window, though, has to start at the present:
   * a farm with a long backlog has a watermark days behind, and measuring four
   * hours from *there* would look at a stretch of time that has already
   * happened and report nothing.
   */
  readonly now: number;
}

/**
 * What the farmer does next, or null if it has nothing to do soon (T-13.05).
 *
 * **The same function the applier runs**, capped at one action — not a
 * re-derivation of "what looks doable". Anything else would be a second
 * opinion about the farm, and the client would animate a tool swing the server
 * then declined to make (§4.4, and the reason `simulate` was written pure in
 * the first place).
 *
 * Pure, like everything else in this file: the caller supplies the plots, the
 * bag and the clock.
 */
export function nextIdleAction(input: NextActionInput): SimAction | null {
  const { now, ...sim } = input;

  return (
    simulate({
      ...sim,
      to: Math.max(sim.from, now) + LOOKAHEAD_MS,
      // One step forward. The cap is what makes this cheap enough for the
      // hottest path in the game: the loop stops at the first action instead
      // of playing out the whole window.
      maxActions: 1,
    }).actions[0] ?? null
  );
}

/**
 * The crop an action moves — read BEFORE it is performed, which is the only
 * moment a harvest's crop is still in the plot.
 */
function cropTouchedBy(
  plot: SimPlot,
  kind: IdleTask,
  sowing: CropId | null,
): CropId | undefined {
  if (kind === IdleTask.PLANT) return sowing ?? undefined;
  if (kind === IdleTask.HARVEST) {
    return plot.cropId !== null && plot.cropId in CROPS ? (plot.cropId as CropId) : undefined;
  }
  return undefined;
}

/**
 * Performs the chosen action, returning the bag it leaves behind.
 *
 * Plots are mutated in place (the array is already this function's own copy);
 * the bag is returned because slot lists are replaced wholesale rather than
 * edited — a spent stack disappears, and a caller holding the old array would
 * be holding a bag that no longer exists.
 */
function apply(
  plots: SimPlot[],
  items: SimItems,
  chosen: Chosen,
  cropId: CropId | null,
  at: number,
): SimItems {
  const plot = plots[chosen.index]!;

  if (chosen.kind === IdleTask.TILL) {
    plots[chosen.index] = { ...plot, tilledAt: at };
    return items;
  }

  if (chosen.kind === IdleTask.WATER) {
    /*
     * The same two writes `water()` makes, in the same order and with the same
     * function: BANK what the closing window earned, then open a new one. The
     * banking is `settleGrowth`, imported rather than reproduced — it is
     * `effectiveGrowthMs` under another name, and the reason those are one
     * function in `growth.ts` is precisely so two callers cannot disagree
     * about what a wet window was worth. Re-watering early therefore costs
     * nothing here for exactly the reason it costs nothing there.
     *
     * No VIP multiplier enters here: what is banked is real elapsed wet time,
     * and VIP shortens the target duration rather than speeding the clock (see
     * `growthAt`). That is why `settleGrowth` takes no `durationPercent`.
     */
    plots[chosen.index] = { ...plot, grownMs: settleGrowth(plot, at), wateredAt: at };
    return items;
  }

  if (chosen.kind === IdleTask.HARVEST) {
    /*
     * The same fields `harvest()` clears, and the same rule about soil:
     * **harvesting leaves the plot tilled** (§5.2), so the loop after the
     * first harvest is plant → water → harvest with no second hoeing.
     * `chosen.items` is the bag `chooseAction` already computed and found
     * room for — recomputing it here would be a second chance to disagree
     * with the decision that was made.
     */
    plots[chosen.index] = {
      ...plot,
      cropId: null,
      plantedAt: null,
      growthDurationMs: null,
      wateredAt: null,
      grownMs: 0,
    };
    return chosen.items!;
  }

  // PLANT. `chooseAction` already established there is a crop and a seed.
  const crop = CROPS[cropId!];

  /*
   * The same fields `plant()` writes, including the resets. `growthDurationMs`
   * is SNAPSHOTTED from config exactly as the service snapshots it, so a crop
   * sown by the farmer and one sown by hand are the same crop. A fresh seed
   * starts dry with nothing banked (D-1) — the first watering is what starts
   * it growing.
   */
  plots[chosen.index] = {
    ...plot,
    cropId: cropId!,
    plantedAt: at,
    growthDurationMs: crop.growthDurationMs,
    wateredAt: null,
    grownMs: 0,
  };

  // Non-null by construction: `seedsHeld` said there was at least one.
  return removeFromSlots(items, crop.seedItemId, 1)!;
}
