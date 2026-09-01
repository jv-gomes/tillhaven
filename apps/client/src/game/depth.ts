/**
 * Draw order for everything in the farm scene.
 *
 * Tile layers sit below everything; anything that STANDS on the ground takes
 * its depth from its bottom edge, so a tree in front of a plot — or a player
 * walking below one — overlaps correctly.
 *
 * Shared between the scene and the entities in it: two files disagreeing about
 * what `world` means is exactly how a character ends up walking under the soil.
 */
export const DEPTH = {
  ground: -2000,
  decor: -1900,
  /** Added to an object's bottom Y so world sprites sort among themselves. */
  world: 0,
  overlay: 5000,
} as const;
