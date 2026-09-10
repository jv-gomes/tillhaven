/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by `pnpm layout` from apps/client/public/tilemaps/farm.json. To
 * change any of it, move the thing in the map editor (`pnpm dev:mapmaker`),
 * save, and re-run.
 *
 * **The map is the source of truth for the farm's shape.** `farmLayout.ts`
 * used to hold these positions as constants and the map was painted from them;
 * that made a hand-edited map into a farm the server did not believe in — the
 * trap-guard protecting a chest that had moved, registration seeding trees the
 * map no longer drew. This file is the other direction, and it is the third of
 * three bakes: `pnpm plots`, `pnpm collision`, `pnpm layout`.
 *
 * Source map: 30x22 tiles, 1 solid terrain tiles,
 * 9 objects.
 */

export interface GeneratedTile {
  readonly x: number;
  readonly y: number;
}

/** An object on the map's `objects` layer: its art key and the tile it stands on. */
export interface GeneratedObject {
  /** A tileset key from the shared manifest, e.g. `obj-chest`. */
  readonly key: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Ground tiles the terrain art makes impassable.
 *
 * By the same rule the client renders with: an authored mask in
 * `TILE_COLLISION_MASK` wins, otherwise a whole tile blocks if its key draws
 * open water. This is what `waterTiles()` returns.
 */
export const MAP_SOLID_TERRAIN: readonly GeneratedTile[] = [
  { x: 0, y: 0 },
];

/** Every gid-bearing object the map places, anchored to the tile it stands on. */
export const MAP_PLACED_OBJECTS: readonly GeneratedObject[] = [
  { key: "obj-chest", x: 6, y: 9 },
  { key: "obj-mailbox", x: 3, y: 12 },
  { key: "obj-maple-tree", x: 3, y: 2 },
  { key: "obj-maple-tree", x: 16, y: 3 },
  { key: "obj-maple-tree", x: 17, y: 11 },
  { key: "obj-maple-tree", x: 2, y: 17 },
  { key: "obj-maple-tree", x: 17, y: 17 },
  { key: "obj-newsstand", x: 5, y: 12 },
  { key: "obj-shipping-box", x: 14, y: 12 },
];
