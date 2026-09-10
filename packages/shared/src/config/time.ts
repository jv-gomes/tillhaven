/**
 * Time constants. Every timestamp in Tillhaven is epoch milliseconds in UTC
 * (CLAUDE.md §10). There is no local time anywhere in the data layer.
 */

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Growth and production are DERIVED from timestamps on read, never ticked by a
 * background loop (CLAUDE.md §4.2). This is what gives offline progression for
 * free and keeps the farm-state endpoint stateless.
 *
 * Helper functions live in the server's farm module and take `now` as an
 * argument so they stay pure and deterministically testable.
 */
export const EPOCH_UNIT = 'ms-utc' as const;

/* ------------------------------------------------------------------ *
 * Day and night (MVP re-scope)
 * ------------------------------------------------------------------ */

/**
 * How long one in-game day takes in real time.
 *
 * **Twenty real minutes, not twenty-four real hours.** A cycle tied to the
 * real clock would mean a player who only ever plays after work never sees
 * daylight, and one who plays at lunch never sees a sunset — the cycle would
 * be a fact about their timezone rather than about the game. Twenty minutes
 * means every session sees the whole thing, and it is two sleeps long
 * (`SLEEP_DURATION_MS` is ten), which makes "sleep through the night" a real
 * sentence rather than a coincidence.
 */
export const DAY_LENGTH_MS = 20 * MINUTE;

/**
 * The named parts of the day, in order, with the phase each one starts at.
 *
 * Phase is 0 at the start of morning and wraps at 1. The boundaries are
 * deliberately uneven: day is half the cycle because it is when the farm is
 * legible, and the two twilights are short because they are transitions rather
 * than states.
 */
export const DAY_SEGMENTS = [
  { name: 'morning', from: 0 },
  { name: 'day', from: 0.15 },
  { name: 'dusk', from: 0.65 },
  { name: 'night', from: 0.8 },
] as const;

export type DaySegment = (typeof DAY_SEGMENTS)[number]['name'];

export interface TimeOfDay {
  /** Where in the cycle we are, 0 (start of morning) to 1 (exclusive). */
  readonly phase: number;
  readonly segment: DaySegment;
  /** 0 at the top of the in-game day, 24 at the next one. For the clock hand. */
  readonly hour: number;
}

/**
 * What time it is, from the wall clock alone.
 *
 * **No server state, and deliberately so.** The cycle is a pure function of
 * `Date.now()`, which means the client and the server agree about it without a
 * round trip, without a column, and without anything to keep in sync. The
 * server does not need to know the time of day at all in this MVP — day/night
 * is cosmetic (crops grow and actions work at any hour) — but it can compute
 * the identical answer the moment that stops being true.
 *
 * Anchored to the Unix epoch rather than to a per-player start, so two players
 * standing next to each other see the same sky. A per-farm anchor would have
 * been a stored column for a purely cosmetic effect, and a reason for two
 * screenshots of the same field to disagree.
 */
export function timeOfDayAt(now: number): TimeOfDay {
  if (!Number.isFinite(now)) return { phase: 0, segment: 'morning', hour: 0 };

  // `%` keeps the sign of the dividend, so a pre-epoch timestamp would land on
  // a negative phase and read as `morning` by falling off the front of the
  // segment table. Normalised instead.
  const phase = (((now % DAY_LENGTH_MS) + DAY_LENGTH_MS) % DAY_LENGTH_MS) / DAY_LENGTH_MS;

  let segment: DaySegment = DAY_SEGMENTS[0].name;
  for (const s of DAY_SEGMENTS) {
    if (phase >= s.from) segment = s.name;
  }

  return { phase, segment, hour: phase * 24 };
}

/**
 * How dark the world is at a phase, 0 (full daylight) to 1 (deepest night).
 *
 * **Interpolated, not stepped.** Four discrete tints would visibly snap four
 * times every twenty minutes, which on a pixel-art field reads as a rendering
 * fault rather than as dusk. The curve is a cosine so the two twilights take
 * the same shape and neither has a corner in it.
 *
 * Peaks at phase 0.9 — the middle of night — and bottoms across the middle of
 * the day.
 */
export function darknessAt(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  const wrapped = ((phase % 1) + 1) % 1;

  // Distance from midday (0.4), measured the short way round the circle.
  const fromMidday = Math.abs(((wrapped - 0.4 + 0.5) % 1) - 0.5);
  // 0 at midday, 1 at midnight, smooth at both.
  return (1 - Math.cos(fromMidday * 2 * Math.PI)) / 2;
}
