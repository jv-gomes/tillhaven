/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by `pnpm plots` from the `plots` object layer of
 * apps/client/public/tilemaps/farm.json. To change the farm's shape, move the
 * markers in the map editor (`pnpm dev:mapmaker`), save, and re-run `pnpm plots`.
 *
 * ARRAY ORDER IS UNLOCK ORDER: index N is the Nth plot a player unlocks, priced
 * by `plotUnlockCost(N)`. The first STARTING_PLOTS are free.
 *
 * Source map: 30x22 tiles, 20 plots.
 */

export interface PlotPosition {
  readonly x: number;
  readonly y: number;
}

export const PLOT_POSITIONS: readonly PlotPosition[] = [
  { x: 9, y: 9 }, //  0
  { x: 10, y: 9 }, //  1
  { x: 11, y: 9 }, //  2
  { x: 12, y: 9 }, //  3
  { x: 13, y: 9 }, //  4
  { x: 9, y: 10 }, //  5
  { x: 10, y: 10 }, //  6
  { x: 11, y: 10 }, //  7
  { x: 12, y: 10 }, //  8
  { x: 13, y: 10 }, //  9
  { x: 9, y: 11 }, // 10
  { x: 10, y: 11 }, // 11
  { x: 11, y: 11 }, // 12
  { x: 12, y: 11 }, // 13
  { x: 13, y: 11 }, // 14
  { x: 9, y: 12 }, // 15
  { x: 10, y: 12 }, // 16
  { x: 11, y: 12 }, // 17
  { x: 12, y: 12 }, // 18
  { x: 13, y: 12 }, // 19
] as const;
