import {
  OBJ_TINY_HOUSE_LOOK,
  COOP_TIER_ART,
  BARN_TIER_ART,
  TILE_SIZE,
  type LookWindow,
} from './assets.js';

/**
 * Where the farm's multi-cell buildings stand.
 *
 * These are **presentational** — the server has no opinion about where a barn
 * is, and a coordinate the client sent would be one more thing to validate for
 * no gameplay gain (§4.1). They live in shared config anyway, for the same
 * reason `FARM_WIDTH` and `PLOT_POSITIONS` do: more than one place has to
 * agree on them. The client draws the buildings here, and
 * `apps/mapmaker/scripts/generate-farm.ts` has to keep paths, trees and map
 * objects out from under them. Two copies of a tile coordinate is one too
 * many — T-12.02b found the house's `(6,6)` written once in `House.ts` and
 * once as a comment in the map generator, which is exactly how they drift.
 *
 * A building is anchored at its **bottom-left tile**, like every map object
 * here: the anchor names the row BELOW the building, so the art grows upward
 * (and rightward) as its tier goes up. That keeps the door in roughly the same
 * place at every tier, which matters because the door is what a player walks
 * to.
 */

/** A rectangle of tiles, inclusive on both ends. */
export interface TileFootprint {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Every tile a bottom-left-anchored look covers, rounded outwards.
 *
 * Outwards, not nearest: a building 129px wide occupies part of a ninth tile,
 * and a ninth tile that is half-covered is still a tile nothing else may
 * stand on.
 */
export function footprintOf(anchor: TilePoint, look: LookWindow): TileFootprint {
  const left = anchor.x * TILE_SIZE;
  const bottom = anchor.y * TILE_SIZE;

  return {
    x0: Math.floor(left / TILE_SIZE),
    y0: Math.floor((bottom - look.height) / TILE_SIZE),
    x1: Math.ceil((left + look.width) / TILE_SIZE) - 1,
    y1: anchor.y - 1,
  };
}

/** True when `tile` is inside `box`. */
export function inFootprint(box: TileFootprint, tile: TilePoint): boolean {
  return tile.x >= box.x0 && tile.x <= box.x1 && tile.y >= box.y0 && tile.y <= box.y1;
}

export function footprintsOverlap(a: TileFootprint, b: TileFootprint): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

/**
 * The farmhouse: above the crop field, clear of both west trees.
 *
 * Nudged down so the roof stays inside the map — `Math.max` rather than a bare
 * multiply means a taller look never silently reintroduces an overhang above
 * the map's top edge.
 */
export const HOUSE_ANCHOR: TilePoint = {
  x: 6,
  y: Math.max(6, Math.ceil(OBJ_TINY_HOUSE_LOOK.height / TILE_SIZE)),
};

/**
 * The coop and the barn stand in the eastern land the farm grew in T-12.02b,
 * one above the other with a lane of grass (x = 20) between them and the rest
 * of the farm.
 *
 * The anchors are chosen for the **Deluxe** look, which is the one that has to
 * fit: the coop's is 9x8 tiles and the barn's 8x8, and every smaller tier
 * lands strictly inside the same box because they share a bottom-left corner.
 */
export const COOP_ANCHOR: TilePoint = { x: 21, y: 12 };
export const BARN_ANCHOR: TilePoint = { x: 21, y: 21 };

/** Footprint of a coop/barn at a given tier, clamped to the tiers that exist. */
export function coopFootprint(tier: number): TileFootprint {
  const art = COOP_TIER_ART[tier] ?? COOP_TIER_ART[0]!;
  return footprintOf(COOP_ANCHOR, art.look);
}

export function barnFootprint(tier: number): TileFootprint {
  const art = BARN_TIER_ART[tier] ?? BARN_TIER_ART[0]!;
  return footprintOf(BARN_ANCHOR, art.look);
}

export const HOUSE_FOOTPRINT: TileFootprint = footprintOf(HOUSE_ANCHOR, OBJ_TINY_HOUSE_LOOK);

/**
 * The ground a building reserves at EVERY tier — its largest footprint.
 *
 * This is what the map may not build on, not the tier a given player happens
 * to have: upgrading must never drop a barn on top of a tree.
 */
export const COOP_FOOTPRINT: TileFootprint = coopFootprint(COOP_TIER_ART.length - 1);
export const BARN_FOOTPRINT: TileFootprint = barnFootprint(BARN_TIER_ART.length - 1);

/** Every tile no path, tree or map object may occupy. */
export const BUILDING_FOOTPRINTS: readonly TileFootprint[] = [
  HOUSE_FOOTPRINT,
  COOP_FOOTPRINT,
  BARN_FOOTPRINT,
];
