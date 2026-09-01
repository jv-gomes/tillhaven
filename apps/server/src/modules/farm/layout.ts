import {
  STARTING_PLOTS,
  MAX_PLOTS,
  FARM_WIDTH,
  FARM_HEIGHT,
  PLOT_POSITIONS,
} from '@tillhaven/shared';

/**
 * The shape of a new farm.
 *
 * Every plot position a farm will ever have is created at registration; the
 * `unlocked` flag is what expansion flips. That keeps plot identity stable —
 * a plot's id never changes and expansion is a one-row update rather than an
 * insert that has to invent a position.
 *
 * POSITIONS COME FROM THE AUTHORED MAP, not from a formula here. They are
 * generated into `packages/shared/src/config/plots.generated.ts` by
 * `pnpm plots`, which reads the `plots` object layer of the map drawn in
 * `apps/mapmaker`. That is what keeps a plot standing on soil the artist
 * actually painted instead of on whatever cell an origin-plus-columns loop
 * happened to land on.
 *
 * The server is still the authority on which plots exist — it reads shared
 * config, never the client's map file at runtime.
 */

// Grid size now lives in packages/shared so the client and the authored map
// agree with the server (CLAUDE.md §10). Re-exported so existing importers of
// this module keep working.
export { FARM_WIDTH, FARM_HEIGHT };

export interface PlotPosition {
  readonly x: number;
  readonly y: number;
  readonly unlocked: boolean;
}

/**
 * Positions for every plot on a new farm, in unlock order.
 *
 * The first `STARTING_PLOTS` are unlocked; the rest exist but are locked, up to
 * `MAX_PLOTS` — which is itself the number of plots the map marks.
 */
export function newFarmPlots(): PlotPosition[] {
  const plots: PlotPosition[] = [];

  for (let i = 0; i < MAX_PLOTS; i++) {
    const position = PLOT_POSITIONS[i];
    // MAX_PLOTS is derived from PLOT_POSITIONS.length, so this cannot happen —
    // but noUncheckedIndexedAccess is right to insist, and silently creating a
    // farm with missing plots would be worse than failing at registration.
    if (!position) {
      throw new Error(
        `Plot ${i} has no authored position. Re-run \`pnpm plots\` after editing the map.`,
      );
    }
    plots.push({ x: position.x, y: position.y, unlocked: i < STARTING_PLOTS });
  }

  return plots;
}
