import { MINUTE } from './time.js';
import { CROPS, isCropId, type CropId } from './crops.js';
import { ANIMALS, isAnimalKind, type AnimalKind } from './animals.js';

/**
 * Farm level (CLAUDE.md §5.6, and the gate in §14).
 *
 * Level exists for one load-bearing reason before it is ever a progression
 * flourish: **trade eligibility**. A player may not trade until their farm is
 * level `TRADE_MIN_FARM_LEVEL`, which is what makes throwaway-account scamming
 * expensive to run at scale. That shapes every choice below.
 *
 * Experience is therefore **bought with time, never with gold.** It is granted
 * only for harvesting a crop and collecting from an animal, both of which are
 * gated on real elapsed time and neither of which can be repeated faster by
 * spending. A scammer cannot buy their way to eligibility; they have to wait,
 * which is exactly the cost the rule is trying to impose.
 *
 * There is deliberately no XP for buying, selling or upgrading. A gold-driven
 * source would let one funded account mint eligible alts on demand.
 */

/**
 * The unit XP is measured in: one award per five minutes of the wait that
 * earned it.
 *
 * Tying the award to the duration rather than to the crop keeps every crop
 * worth roughly the same experience per hour, so no crop is the "levelling
 * crop" and nobody has to consult a wiki to progress at a normal rate.
 */
export const XP_PER_UNIT_MS = 5 * MINUTE;

function xpForDuration(durationMs: number): number {
  return Math.max(1, Math.floor(durationMs / XP_PER_UNIT_MS));
}

/** Experience for harvesting one crop. Integer, always at least 1. */
export function xpForHarvest(cropId: string): number {
  if (!isCropId(cropId)) return 0;
  return xpForDuration(CROPS[cropId as CropId].growthDurationMs);
}

/**
 * Experience for collecting from an animal.
 *
 * Scaled by the number of production cycles handed over, not by the units of
 * produce: a crop that yields three of something is not three times the wait.
 */
export function xpForCollect(kind: string, cycles: number): number {
  if (!isAnimalKind(kind) || cycles <= 0) return 0;
  return xpForDuration(ANIMALS[kind as AnimalKind].productionIntervalMs) * cycles;
}

/* ------------------------------------------------------------------ *
 * The curve
 * ------------------------------------------------------------------ */

export const MAX_FARM_LEVEL = 30;

/** XP for the second level. Every later step grows from this one. */
const FIRST_STEP = 80;

/**
 * Growth per level, as a fraction so the whole curve stays integer.
 * 13/10 is a 30% step: steep enough that late levels are an achievement,
 * shallow enough that level 5 is a day of ordinary play rather than a wall.
 */
const STEP_NUMERATOR = 13;
const STEP_DENOMINATOR = 10;

/**
 * Total experience needed to REACH each level. Index 0 is level 1, at zero.
 *
 * Generated from the recurrence rather than typed out so the two can never
 * disagree, but frozen at module load so it is a table like any other config —
 * `config.test.ts` pins the first few values, including the one that matters.
 */
export const FARM_LEVEL_XP: readonly number[] = (() => {
  const thresholds = [0];
  let step = FIRST_STEP;

  for (let level = 2; level <= MAX_FARM_LEVEL; level++) {
    thresholds.push(thresholds[thresholds.length - 1]! + step);
    step = Math.floor((step * STEP_NUMERATOR) / STEP_DENOMINATOR);
  }

  return Object.freeze(thresholds);
})();

/**
 * The level a given amount of experience earns.
 *
 * Monotonic by construction: more experience never means a lower level, and
 * experience itself only ever goes up. Level 1 is the floor — a brand-new farm
 * is level 1, not level 0.
 */
export function levelForXp(experience: number): number {
  if (!Number.isFinite(experience) || experience <= 0) return 1;

  // Walking the table beats arithmetic here: it cannot disagree with the table
  // the rest of the game displays.
  let level = 1;
  for (let i = 1; i < FARM_LEVEL_XP.length; i++) {
    if (experience < FARM_LEVEL_XP[i]!) break;
    level = i + 1;
  }
  return level;
}

export interface LevelProgress {
  readonly level: number;
  readonly experience: number;
  /** XP at which this level began. */
  readonly levelStartXp: number;
  /** XP needed for the next level, or null at the cap. */
  readonly nextLevelXp: number | null;
  /** XP still to go, or 0 at the cap. */
  readonly toNextLevel: number;
}

/** Everything a progress bar needs, derived from one number. */
export function levelProgress(experience: number): LevelProgress {
  const xp = Number.isFinite(experience) && experience > 0 ? Math.floor(experience) : 0;
  const level = levelForXp(xp);

  const levelStartXp = FARM_LEVEL_XP[level - 1] ?? 0;
  const nextLevelXp = level < MAX_FARM_LEVEL ? (FARM_LEVEL_XP[level] ?? null) : null;

  return {
    level,
    experience: xp,
    levelStartXp,
    nextLevelXp,
    toNextLevel: nextLevelXp === null ? 0 : nextLevelXp - xp,
  };
}
