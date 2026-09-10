import { MAX_FARM_LEVEL, type LevelProgress } from '@tillhaven/shared/config';

/**
 * What the HUD's level bar shows, as arithmetic (T-30.02).
 *
 * A pure module beside the DOM rather than five lines inside `hud.ts`, for the
 * same reason `effects.ts` holds `BURSTS` and not the scene: the interesting
 * failures here are *numeric* — a divide-by-zero at the cap, a percentage that
 * leaves the track, a label that claims a level that does not exist — and none
 * of them are reachable by a test that has to build a HUD first.
 *
 * Everything is derived from `LevelProgress`, which the server computes and
 * sends (T-30.01). Nothing here re-implements the curve.
 */

/**
 * How full the bar is, 0-100.
 *
 * **At the cap the bar is full, not empty.** `nextLevelXp` is null at level
 * `MAX_FARM_LEVEL`, so there is no denominator and any percentage is a
 * fiction — but 0 reads as "no progress" to a player who has just finished the
 * game, which is the worse of the two lies. The label carries the truth.
 */
export function levelBarPercent(progress: LevelProgress): number {
  if (progress.nextLevelXp === null) return 100;

  const span = progress.nextLevelXp - progress.levelStartXp;
  // Defensive: a malformed curve with a zero-width level would divide by zero
  // and render NaN as a CSS width, which fails silently and invisibly.
  if (span <= 0) return 100;

  const into = progress.experience - progress.levelStartXp;
  return Math.max(0, Math.min(100, Math.round((into / span) * 100)));
}

/** The pip beside the bar. */
export function levelBarLabel(progress: LevelProgress): string {
  return progress.nextLevelXp === null
    ? `Lv ${progress.level} · max`
    : `Lv ${progress.level}`;
}

/**
 * What a screen reader is told.
 *
 * Spells out the remaining experience rather than repeating the percentage the
 * `aria-valuenow` already carries — a percentage is what the bar looks like,
 * and the number of harvests to go is what the player actually wants.
 */
export function levelBarAriaLabel(progress: LevelProgress): string {
  if (progress.nextLevelXp === null) {
    return `Farm level ${progress.level}, the highest`;
  }
  return `Farm level ${progress.level}, ${progress.toNextLevel} experience to level ${
    progress.level + 1
  }`;
}

/** True once there is no next level to work toward. */
export function isMaxLevel(progress: LevelProgress): boolean {
  return progress.level >= MAX_FARM_LEVEL || progress.nextLevelXp === null;
}

/**
 * How much experience an action just granted (T-30.04).
 *
 * Harvest and collect return **lifetime** experience, not a delta — that is
 * the right thing for them to return, because a lifetime total is idempotent
 * and a delta is not: replay the same response twice and a delta double-counts
 * while a total stays correct (§4.5).
 *
 * A float wants the delta, so it is computed here against the last known
 * total. Clamped at zero: if the two are ever out of order — a response
 * arriving after a poll that already included it, which the 20-second poll
 * makes perfectly possible — the honest answer is "nothing new to report",
 * never a negative float claiming the player lost experience they cannot lose.
 */
export function xpGained(lifetimeNow: number, lifetimeBefore: number): number {
  if (!Number.isFinite(lifetimeNow) || !Number.isFinite(lifetimeBefore)) return 0;
  return Math.max(0, Math.trunc(lifetimeNow) - Math.trunc(lifetimeBefore));
}
