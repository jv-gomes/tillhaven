/**
 * Palettes are derived from the shared asset manifest, never hardcoded
 * (CLAUDE.md §9: "Keep a single assets.ts manifest ... so nothing is loaded by
 * magic string"). Adding a sheet to `packages/shared/src/config/assets.ts` makes
 * it appear in the editor with no change here.
 */

import { TILE_SIZE } from '@tillhaven/shared/config';
import { TILESET_RUNS, type TilesetRun } from '@tillhaven/shared/config';

export interface Palette {
  readonly run: TilesetRun;
  /** True when frames are exactly one grid cell, so they can go on a tile layer. */
  readonly paintable: boolean;
}

export const PALETTES: readonly Palette[] = TILESET_RUNS.map((run) => ({
  run,
  paintable: run.tileWidth === TILE_SIZE && run.tileHeight === TILE_SIZE,
}));

/** Sheets that can be painted onto a tile layer: terrain, road, fence, house parts. */
export const TILE_PALETTES: readonly Palette[] = PALETTES.filter((p) => p.paintable);

/**
 * Everything is available as a free-placed object, including the 16x16 sheets —
 * a fence post is sometimes wanted above the grid rather than in it, and crops
 * (16x32) and the maple tree (32x48) have no other way onto the map.
 */
export const OBJECT_PALETTES: readonly Palette[] = PALETTES;

export function paletteByKey(key: string): Palette | undefined {
  return PALETTES.find((p) => p.run.key === key);
}

/** Pixel rect of a frame within its source image. */
export function frameRect(
  run: TilesetRun,
  frame: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const col = frame % run.columns;
  const row = Math.floor(frame / run.columns);
  return {
    sx: col * run.tileWidth,
    sy: row * run.tileHeight,
    sw: run.tileWidth,
    sh: run.tileHeight,
  };
}
