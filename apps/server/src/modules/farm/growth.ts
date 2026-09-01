import {
  CROPS,
  WATERING_ENABLED,
  WATER_DURATION_MS,
  isCropId,
  applyDurationPercent,
  type CropId,
  type CropDef,
} from '@tillhaven/shared';

/**
 * Crop growth (CLAUDE.md §4.2).
 *
 * Nothing here reads the database or calls `Date.now()`. `now` is always a
 * parameter, which is what makes offline progression exact AND makes every
 * case below testable without waiting for real time to pass.
 *
 * Time is never ticked or accumulated. A plot stores timestamps; its stage is
 * a pure function of them and the current clock. Skipping a million reads
 * loses nothing, because nothing was being counted.
 *
 * **Growth v2 (D-1: watering required).** A crop advances only while its soil
 * is wet, which stays O(1) and job-free by storing settled progress plus one
 * open window:
 *
 *     effectiveGrowth(now) = grownMs + clamp(now - wateredAt, 0, WATER_DURATION_MS)
 *
 * `grownMs` is growth already BANKED from windows that have closed; the second
 * term is however much of the current window has elapsed, capped at its length.
 * A plot left dry for a week accrues nothing beyond that cap, and re-watering
 * early loses nothing because the service settles `grownMs` before re-stamping
 * `wateredAt` — settling IS `effectiveGrowthMs`, which is why they are one
 * function called from two places rather than two that could disagree.

/** The minimum a plot needs for growth to be defined. */
export interface GrowablePlot {
  readonly cropId: string | null;
  readonly plantedAt: number | null;
  /**
   * Snapshotted at plant time. Deliberately NOT read from config here:
   * retuning a crop must never retroactively change one already in the ground.
   */
  readonly growthDurationMs: number | null;
  /** When the soil was last watered; null = never. Growth v2 only. */
  readonly wateredAt?: number | null;
  /** Growth banked from closed wet windows. Growth v2 only. */
  readonly grownMs?: number | null;
}

export interface GrowthState {
  /** Index into the crop's `stageFrames`. -1 when the plot is empty. */
  readonly stage: number;
  readonly isRipe: boolean;
  /**
   * **Milliseconds of WATERED time still needed**, not wall-clock time.
   *
   * The two were the same thing in v1 and are not any more: a dry crop's
   * countdown is stopped, so "ms from now" has no finite answer. Reporting
   * growth-time keeps this a real number in every state — `Infinity` and
   * `null` both leak into arithmetic and into JSON badly — and pairs with
   * `isPaused` to say whether the number is currently ticking down.
   *
   * 0 once ripe, 0 for an empty plot.
   */
  readonly readyInMs: number;
  /**
   * True when growth is stopped: planted, not ripe, and the soil is dry.
   * Always false while `WATERING_ENABLED` is off, and false for an empty plot.
   */
  readonly isPaused: boolean;
  /** Effective duration after the VIP multiplier. 0 for an empty plot. */
  readonly effectiveDurationMs: number;
}

const EMPTY: GrowthState = {
  stage: -1,
  isRipe: false,
  readyInMs: 0,
  isPaused: false,
  effectiveDurationMs: 0,
};

/**
 * True when the plot holds a crop we can actually resolve. A plot with a
 * `cropId` that is no longer in config is treated as empty rather than
 * crashing the whole farm-state request.
 */
export function plantedCrop(plot: GrowablePlot): CropDef | null {
  if (plot.cropId === null || plot.plantedAt === null) return null;
  if (plot.growthDurationMs === null || plot.growthDurationMs <= 0) return null;
  if (!isCropId(plot.cropId)) return null;
  return CROPS[plot.cropId as CropId];
}

/**
 * How much of the CURRENT wet window has elapsed, capped at its length.
 *
 * Zero when the soil was never watered, and zero again once the window has
 * closed — a plot left dry for a week banks four hours, not a week. Clamped at
 * the bottom too, so a clock that has gone backwards cannot subtract growth.
 */
function openWindowMs(plot: GrowablePlot, now: number): number {
  const wateredAt = plot.wateredAt ?? null;
  if (wateredAt === null) return 0;
  return Math.min(WATER_DURATION_MS, Math.max(0, now - wateredAt));
}

/**
 * Total growing time a crop has accumulated, in ms.
 *
 * **The one place `WATERING_ENABLED` is read.** With the flag off this is
 * exactly v1 — time since planting, always advancing — so nothing else in the
 * module has two modes and T-9.03b's flip is genuinely one constant.
 */
export function effectiveGrowthMs(plot: GrowablePlot, now: number): number {
  if (plot.plantedAt === null) return 0;

  if (!WATERING_ENABLED) {
    return Math.max(0, now - plot.plantedAt);
  }
  return Math.max(0, plot.grownMs ?? 0) + openWindowMs(plot, now);
}

/**
 * The `grownMs` to store when closing the current window.
 *
 * Identical to `effectiveGrowthMs` by construction, and deliberately so: to
 * settle is to bank exactly what has been earned so far. Called before
 * re-stamping `wateredAt`, which is what makes re-watering early cost nothing —
 * the elapsed part of the old window is banked rather than thrown away.
 */
export function settleGrowth(plot: GrowablePlot, now: number): number {
  return effectiveGrowthMs(plot, now);
}

/** True when the soil is dry, so growth is not advancing. */
function isDry(plot: GrowablePlot, now: number): boolean {
  if (!WATERING_ENABLED) return false;
  const wateredAt = plot.wateredAt ?? null;
  return wateredAt === null || now - wateredAt >= WATER_DURATION_MS;
}

/**
 * Resolves a plot's growth at an instant.
 *
 * `durationPercent` is the VIP multiplier: 100 for a free account, 80 for VIP
 * (meaning everything takes 80% as long). Applied to the snapshotted duration,
 * so gaining or losing VIP changes how long a crop already in the ground has
 * left — which is the intended, generous behaviour.
 */
export function growthAt(
  plot: GrowablePlot,
  now: number,
  durationPercent = 100,
): GrowthState {
  const crop = plantedCrop(plot);
  if (!crop) return EMPTY;

  const effectiveDurationMs = applyDurationPercent(
    plot.growthDurationMs!,
    durationPercent,
  );

  const grown = effectiveGrowthMs(plot, now);
  const stageCount = crop.stageFrames.length;
  const lastStage = stageCount - 1;

  if (grown >= effectiveDurationMs) {
    // Ripe is ripe: a crop that finished growing does not un-ripen when its
    // soil dries out, so `isPaused` is false here regardless of wetness.
    return {
      stage: lastStage,
      isRipe: true,
      readyInMs: 0,
      isPaused: false,
      effectiveDurationMs,
    };
  }

  /*
   * Stages divide the growth window into `stageCount` equal slices, with the
   * last slice ending exactly at ripeness. `Math.floor` on a value strictly
   * below 1 can never reach `stageCount`, but the clamp stays as a guard: an
   * out-of-range index would be a frame that does not exist in the sheet.
   */
  const progressed = Math.floor((grown * stageCount) / effectiveDurationMs);
  const stage = Math.min(lastStage, Math.max(0, progressed));

  return {
    stage,
    isRipe: false,
    readyInMs: effectiveDurationMs - grown,
    isPaused: isDry(plot, now),
    effectiveDurationMs,
  };
}

/** Convenience wrapper — the check plant/harvest actually cares about. */
export function isRipe(
  plot: GrowablePlot,
  now: number,
  durationPercent = 100,
): boolean {
  return growthAt(plot, now, durationPercent).isRipe;
}

export function isEmpty(plot: GrowablePlot): boolean {
  return plot.cropId === null && plot.plantedAt === null;
}
