import { describe, expect, it } from 'vitest';
import { PLOT_POSITIONS } from './plots.generated.js';
import { MAX_PLOTS, STARTING_PLOTS, plotUnlockCost } from './economy.js';
import { FARM_HEIGHT, FARM_WIDTH } from './tilesets.js';

/**
 * Guards on the layout generated from the authored map by `pnpm plots`.
 *
 * The generator checks these too, but it only runs when someone remembers to
 * run it. These assertions fail in CI on a hand-edited or stale generated file,
 * which is the case that would otherwise reach registration and blow up there.
 */
describe('authored plot layout', () => {
  it('has at least the plots a new farm starts with', () => {
    expect(PLOT_POSITIONS.length).toBeGreaterThanOrEqual(STARTING_PLOTS);
  });

  it('is what MAX_PLOTS is derived from', () => {
    // newFarmPlots() indexes PLOT_POSITIONS up to MAX_PLOTS; if the cap ever
    // exceeded the authored positions, registration would throw.
    expect(MAX_PLOTS).toBe(PLOT_POSITIONS.length);
  });

  it('puts every plot inside the farm grid', () => {
    for (const [i, plot] of PLOT_POSITIONS.entries()) {
      expect(Number.isInteger(plot.x), `plot ${i} x`).toBe(true);
      expect(Number.isInteger(plot.y), `plot ${i} y`).toBe(true);
      expect(plot.x, `plot ${i} x`).toBeGreaterThanOrEqual(0);
      expect(plot.y, `plot ${i} y`).toBeGreaterThanOrEqual(0);
      expect(plot.x, `plot ${i} x`).toBeLessThan(FARM_WIDTH);
      expect(plot.y, `plot ${i} y`).toBeLessThan(FARM_HEIGHT);
    }
  });

  it('never puts two plots on the same cell', () => {
    // The DB enforces this with plots_farm_pos_idx, but a duplicate here would
    // fail at registration for every new account rather than at build time.
    const cells = PLOT_POSITIONS.map((p) => `${p.x},${p.y}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('prices the whole authored pool as integers', () => {
    for (let i = 0; i < PLOT_POSITIONS.length; i++) {
      expect(Number.isInteger(plotUnlockCost(i))).toBe(true);
    }
  });

  it('gives away exactly the starting plots and charges for the rest', () => {
    expect(plotUnlockCost(STARTING_PLOTS - 1)).toBe(0);
    if (PLOT_POSITIONS.length > STARTING_PLOTS) {
      expect(plotUnlockCost(STARTING_PLOTS)).toBeGreaterThan(0);
    }
  });
});
