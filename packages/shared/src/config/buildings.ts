import {
  OBJ_FARMHOUSE_LOOK,
  HOUSE_TIER_ART,
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
 * (The old note here promised a `Math.max` guarding against overhang. There is
 * no `Math.max` in this expression and there never was — what actually keeps
 * the house on the map is the test `never leaves the map, at any tier` in
 * `collision.test.ts`, which checks every tier's footprint against the map
 * bounds. A comment describing code that is not there is worse than none.)
 */
export const HOUSE_ANCHOR: TilePoint = {
  x: 6,
  /*
   * One row further down than the TIER-0 art strictly needs (T-15.29).
   *
   * The tier-0 farmhouse is 87px tall — six tiles — so
   * `ceil(height / TILE_SIZE)` alone would anchor it at y=6 and put its roof on
   * row 0, flush against the map's own fringed border. `+ 1` leaves that border
   * row visible above the roof, which is what makes the farm read as a bounded
   * patch of land rather than a wall of house.
   *
   * **Tier 2 takes that row back, and that is the decision, not an oversight**
   * (D-20, T-17.06). `8.png` is 109px — seven tiles — so at this anchor it
   * reaches row 0 and the border disappears behind the roof. The alternatives
   * were a shorter house for tier 2 (killing the only size step in the ladder)
   * or growing the map a row at the top, which renumbers every Y coordinate and
   * so moves every plot on every existing farm — the landmine T-15.00 found.
   *
   * Keeping the anchor where it is costs the border row **only at the top
   * tier**, and leaves every plot coordinate, every existing farm and the map
   * size untouched. The farm still reads as bounded land for as long as the
   * player has not bought the biggest house there is.
   */
  y: Math.ceil(OBJ_FARMHOUSE_LOOK.height / TILE_SIZE) + 1,
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

/**
 * Footprint of the house at a given tier, clamped to the tiers that exist.
 *
 * Tier-aware since T-17.06 for the same reason the coop and barn already were:
 * tier 2 is a row taller than tiers 0 and 1, so one constant cannot describe
 * all three. A player with a tier-0 house must be able to walk across the row
 * a tier-2 house would one day cover.
 */
export function houseFootprint(tier: number): TileFootprint {
  const art = HOUSE_TIER_ART[tier] ?? HOUSE_TIER_ART[0]!;
  return footprintOf(HOUSE_ANCHOR, art.look);
}

export const HOUSE_FOOTPRINT: TileFootprint = houseFootprint(HOUSE_TIER_ART.length - 1);

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

/**
 * The same three boxes, but each one able to say its own name.
 *
 * **For anything that has to TELL somebody about them, which turned out to be
 * the missing half** (M6). These buildings are drawn from the anchors above
 * rather than from the map's object layer, because their art depends on a tier
 * the player owns — so the map editor renders their ground as empty grass. A
 * field was authored on top of the farmhouse and the editor showed nothing
 * wrong with it; the failure surfaced two bakes later as
 * `plot (8,2): expected true to be false`, which does not mention the house.
 *
 * A bare `TileFootprint` cannot be reported, only failed on. This list is what
 * the editor's reserved-ground overlay labels and what the footprint tests name
 * in their failure messages, so the same three boxes are described the same way
 * in the place that prevents the mistake and the place that catches it.
 */
export const RESERVED_GROUND: readonly { readonly name: string; readonly box: TileFootprint }[] = [
  { name: 'house', box: HOUSE_FOOTPRINT },
  { name: 'coop', box: COOP_FOOTPRINT },
  { name: 'barn', box: BARN_FOOTPRINT },
];

/** The building whose largest footprint covers this tile, if any. */
export function reservedBy(tile: TilePoint): string | null {
  return RESERVED_GROUND.find((r) => inFootprint(r.box, tile))?.name ?? null;
}
