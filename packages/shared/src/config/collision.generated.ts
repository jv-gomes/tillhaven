/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by `pnpm collision` from the `collision` object layer of
 * apps/client/public/tilemaps/farm.json. To change it, paint with the collision
 * brush in the map editor (`pnpm dev:mapmaker`), save, and re-run.
 *
 * **Additive to the art's own collision, never a replacement.** Building
 * silhouettes and terrain masks live in `collision.ts` because they are
 * properties of the ART — a shoreline tile is the same shape everywhere it is
 * stamped. This is for the shapes the art cannot express.
 *
 * One mask per tile, 3x3 cells row-major, `#` solid.
 *
 * Source map: 30x22 tiles, 0 tiles, 0 solid cells.
 */

export interface AuthoredCollisionTile {
  readonly x: number;
  readonly y: number;
  readonly mask: string;
}

export const AUTHORED_COLLISION: readonly AuthoredCollisionTile[] = [

];
