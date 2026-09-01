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
