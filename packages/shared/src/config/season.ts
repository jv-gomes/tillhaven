/**
 * Seasons (T-31.03).
 *
 * **Nothing reads this yet, and that is the point.** Phase 35 is the task that
 * makes a season mean something — which crops the merchant stocks, which
 * tileset the farm draws, whether planting an out-of-season seed is refused.
 * The type and the per-crop field ship *now*, one phase early, because adding
 * a required field to a twenty-entry crop table later means re-touching every
 * crop config and every crop test, re-deciding each crop's season
 * retroactively, and answering an awkward question about seeds players already
 * hold. One line per crop now; a migration-shaped problem later.
 *
 * So this file deliberately contains no rule. There is no `isInSeason`, no
 * `currentSeason`, no clock. A helper written now would be written against a
 * calendar that does not exist, and Phase 35 would rewrite it. What ships is
 * the vocabulary and the data.
 *
 * **The MVP is Spring only, and three of the four seasons have no crops.**
 * `assets/Crops/` ships Spring, Summer and Fall art (never winter — the pack
 * has winter *tilesets* and props, which is what the VIP decor set uses, but
 * no winter crop), and the re-scope cut the game to spring alone. So every
 * crop is `[Season.SPRING]` and the other three members of the type exist
 * without content behind them.
 *
 * That is deliberate rather than an oversight: the field is here so that
 * adding a season later is one line per crop instead of a migration-shaped
 * problem, and whoever adds one has to decide what the season IS before any
 * crop can claim it.
 */

export const Season = {
  SPRING: 'spring',
  SUMMER: 'summer',
  FALL: 'fall',
  WINTER: 'winter',
} as const;
export type Season = (typeof Season)[keyof typeof Season];

/**
 * The seasons in calendar order.
 *
 * Order is meaningful and load-bearing for Phase 35 — "the season after this
 * one" is a lookup into this array — so it is declared once here rather than
 * being re-derived from `Object.values` at a call site, where a future
 * alphabetical sort would silently make fall follow spring.
 */
export const SEASONS: readonly Season[] = Object.freeze([
  Season.SPRING,
  Season.SUMMER,
  Season.FALL,
  Season.WINTER,
]);

export function isSeason(value: string): value is Season {
  return (SEASONS as readonly string[]).includes(value);
}
