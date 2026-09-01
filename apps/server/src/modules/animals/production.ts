import {
  ANIMALS,
  isAnimalKind,
  applyDurationPercent,
  type AnimalDef,
  type AnimalKind,
} from '@tillhaven/shared';

/**
 * Animal production (CLAUDE.md §4.2 and §5.3).
 *
 * Like crop growth, nothing here reads the database or calls `Date.now()` —
 * `now` is always a parameter. Production is not ticked or accumulated: an
 * animal stores when it was last collected and how long it is fed for, and how
 * much it owes is a pure function of those timestamps and the clock.
 *
 * The rule that shapes everything below: **an unfed animal accrues nothing.**
 * It does not quietly bank cycles to hand over when it is fed again. Feeding is
 * the whole sink that makes animals a running cost rather than a one-off
 * purchase, and an animal that paid out for its neglected weeks would remove
 * the point of it.
 *
 * Animals are never killed or lost, however long they go unfed (§5.3).
 */

/** The minimum an animal needs for production to be defined. */
export interface ProducingAnimal {
  readonly kind: string;
  /** Babies produce nothing until this instant. */
  readonly maturesAt: number;
  readonly lastCollectedAt: number;
  /** Null when never fed. Production stops at this instant. */
  readonly fedUntil: number | null;
}

export interface ProductionState {
  readonly isMature: boolean;
  readonly isFed: boolean;
  /** Whole production cycles waiting to be collected. Never negative. */
  readonly cyclesOwed: number;
  /** Units of produce a collection would grant right now. */
  readonly quantity: number;
  /** ms until the next unit is ready under current conditions. 0 when owed. */
  readonly readyInMs: number;
  /** The interval after the VIP multiplier. 0 for an unresolvable animal. */
  readonly effectiveIntervalMs: number;
}

const NOTHING: ProductionState = {
  isMature: false,
  isFed: false,
  cyclesOwed: 0,
  quantity: 0,
  readyInMs: 0,
  effectiveIntervalMs: 0,
};

/**
 * The definition for an animal we can actually resolve.
 *
 * A row whose `kind` is no longer in config is treated as producing nothing
 * rather than crashing the farm-state request — the same call the crop code
 * makes for a retired crop id.
 */
export function animalDef(animal: ProducingAnimal): AnimalDef | null {
  if (!isAnimalKind(animal.kind)) return null;
  return ANIMALS[animal.kind as AnimalKind];
}

/**
 * Resolves what an animal owes at an instant.
 *
 * The productive window runs from the later of "last collected" and "grew up"
 * to the earlier of "now" and "fed until". Both ends matter:
 *
 *   - clipping the START at `maturesAt` is what stops a chick paying out for
 *     the hours it spent as a chick;
 *   - clipping the END at `fedUntil` is what stops an unfed animal accruing.
 *
 * `durationPercent` is the VIP multiplier — 80 meaning "takes 80% as long",
 * exactly as for crops. It shortens the interval, so VIP animals produce more
 * often; it never grants an item a free account cannot get (§7).
 */
export function productionAt(
  animal: ProducingAnimal,
  now: number,
  durationPercent = 100,
): ProductionState {
  const def = animalDef(animal);
  if (!def) return NOTHING;

  const effectiveIntervalMs = applyDurationPercent(def.productionIntervalMs, durationPercent);
  const isMature = now >= animal.maturesAt;
  const isFed = animal.fedUntil !== null && animal.fedUntil > now;

  const base = {
    isMature,
    isFed,
    effectiveIntervalMs,
  };

  const windowStart = Math.max(animal.lastCollectedAt, animal.maturesAt);
  // `fedUntil` may be in the past; that is exactly the lapsed case, and it
  // makes the window end before it starts, which floors to zero cycles.
  const windowEnd = Math.min(now, animal.fedUntil ?? 0);
  const productiveMs = Math.max(0, windowEnd - windowStart);

  const cyclesOwed = Math.floor(productiveMs / effectiveIntervalMs);

  if (cyclesOwed > 0) {
    return {
      ...base,
      cyclesOwed,
      quantity: cyclesOwed * def.yieldAmount,
      readyInMs: 0,
    };
  }

  return {
    ...base,
    cyclesOwed: 0,
    quantity: 0,
    readyInMs: timeToNext(animal, now, effectiveIntervalMs, windowStart, isMature, isFed),
  };
}

/**
 * How long until the next unit, under conditions as they stand.
 *
 * Split out because "not ready yet" has three different reasons and a single
 * subtraction would report a misleading number for two of them — worst of all
 * for an unfed animal, whose productive clock stopped in the past and would
 * otherwise read as "ready now".
 */
function timeToNext(
  animal: ProducingAnimal,
  now: number,
  intervalMs: number,
  windowStart: number,
  isMature: boolean,
  isFed: boolean,
): number {
  // Still a baby: it has to grow up first, then run a full cycle.
  if (!isMature) return animal.maturesAt - now + intervalMs;

  /*
   * Unfed: a full interval from whenever it is fed again, because feeding
   * re-bases the productive clock to that moment (see `feedAt`). Reporting the
   * remainder of a cycle that stopped advancing would promise produce that is
   * never coming.
   */
  if (!isFed) return intervalMs;

  return Math.max(0, windowStart + intervalMs - now);
}

/** Convenience for the collect intent, which only cares whether there is any. */
export function hasProduce(
  animal: ProducingAnimal,
  now: number,
  durationPercent = 100,
): boolean {
  return productionAt(animal, now, durationPercent).cyclesOwed > 0;
}

export interface CollectResult {
  readonly cyclesOwed: number;
  readonly quantity: number;
  /** New `last_collected_at`, advanced by exactly what was handed over. */
  readonly lastCollectedAt: number;
}

/**
 * The timestamps a collection writes.
 *
 * `lastCollectedAt` advances by exactly `cyclesOwed × interval` from where the
 * productive window began — **not** to `now`. Setting it to `now` would throw
 * away however far the animal had got toward its next cycle, so a player who
 * collected slightly too often would produce measurably less than one who
 * waited. Time already earned is never lost to the act of collecting.
 *
 * Returns null when there is nothing to hand over, so the caller does not have
 * to decide what a zero-cycle collection means.
 */
export function collectAt(
  animal: ProducingAnimal,
  now: number,
  durationPercent = 100,
): CollectResult | null {
  const def = animalDef(animal);
  if (!def) return null;

  const { cyclesOwed, quantity, effectiveIntervalMs } = productionAt(animal, now, durationPercent);
  if (cyclesOwed === 0) return null;

  const windowStart = Math.max(animal.lastCollectedAt, animal.maturesAt);

  return {
    cyclesOwed,
    quantity,
    lastCollectedAt: windowStart + cyclesOwed * effectiveIntervalMs,
  };
}

export interface FeedResult {
  /** New `fed_until`, extended rather than reset. */
  readonly fedUntil: number;
  /**
   * New `last_collected_at`. Usually unchanged — it moves only to close an
   * unfed gap, and never far enough to discard produce already owed.
   */
  readonly lastCollectedAt: number;
}

/**
 * The timestamps a feeding writes.
 *
 * Two things happen here, and the second is the one that matters.
 *
 * **Feeding extends rather than resets.** `fedUntil` grows from
 * `max(now, fedUntil)`, so feeding a still-fed animal banks the remainder
 * instead of throwing it away — a player should never be punished for topping
 * up early.
 *
 * **Feeding closes the unfed gap.** Without this, an animal left unfed for a
 * week and then fed would pay out for the whole week: the productive window is
 * bounded by `fedUntil`, and moving `fedUntil` into the future retroactively
 * sweeps the neglected days back inside it. So a feeding that revives a lapsed
 * animal re-bases `lastCollectedAt` to now — minus exactly the cycles already
 * owed, so nothing legitimately earned before the lapse is lost. Feeding is
 * never a way to destroy produce, and never a way to conjure it.
 */
export function feedAt(
  animal: ProducingAnimal,
  now: number,
  durationPercent = 100,
): FeedResult {
  const def = animalDef(animal);
  if (!def) {
    return { fedUntil: now, lastCollectedAt: animal.lastCollectedAt };
  }

  const from = Math.max(now, animal.fedUntil ?? 0);
  const fedUntil = from + def.feedDurationMs;

  const lapsed = animal.fedUntil === null || animal.fedUntil <= now;
  if (!lapsed) {
    return { fedUntil, lastCollectedAt: animal.lastCollectedAt };
  }

  const { cyclesOwed, effectiveIntervalMs } = productionAt(animal, now, durationPercent);

  return {
    fedUntil,
    // Preserves what is owed; discards only the part-finished cycle that
    // stopped advancing when the food ran out.
    lastCollectedAt: now - cyclesOwed * effectiveIntervalMs,
  };
}
