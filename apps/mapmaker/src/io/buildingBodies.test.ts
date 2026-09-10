import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILDING_BODY_MASK,
  maskResolution,
  maskTileSize,
  buildingBodyTiles,
  HOUSE_ANCHOR,
  COOP_ANCHOR,
  BARN_ANCHOR,
  HOUSE_TIER_ART,
  COOP_TIER_ART,
  BARN_TIER_ART,
  houseFootprint,
  coopFootprint,
  barnFootprint,
  TILE_SIZE,
  type BuildingLook,
  type TileFootprint,
  type TilePoint,
} from '@tillhaven/shared/config';
// @ts-expect-error -- plain .mjs tooling module, shared with the measure scripts.
import { decodePng, alphaAt } from '../../../../scripts/lib/png.mjs';

/**
 * T-23.03 — a solid building tile must have a building on it.
 *
 * **The bug this exists to prevent, stated plainly:** `footprintOf` makes every
 * tile the art's bounding box touches solid, and for a building drawn in
 * near-front elevation that includes the roof. Measured before the fix, the
 * tier-0 farmhouse blocked **six tiles containing no drawn pixels at all** —
 * its top row was 10.6% covered, a 20px chimney cap walling off eight tiles of
 * visible grass. Nothing caught it because nothing had ever compared the
 * collision to the art.
 *
 * This lives in the mapmaker for the same reason `farmMap.test.ts` does: it is
 * the package allowed to hold the manifest and the real files in its head at
 * once. `packages/shared` cannot read a PNG, and arithmetic over the config
 * alone could never have found this — the fault was in the pixels.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ASSETS = resolve(ROOT, 'apps/client/public/assets');

const images = new Map<string, ReturnType<typeof decodePng>>();
function art(key: string) {
  if (!images.has(key)) images.set(key, decodePng(readFileSync(resolve(ASSETS, `${key}.png`))));
  return images.get(key)!;
}

/** Fraction of a tile covered by drawn pixels, for a bottom-anchored look. */
function coverage(look: BuildingLook, anchor: TilePoint, tx: number, ty: number): number {
  const img = art(look.sheet.key);
  const { x: cx, y: cy, width, height } = look.look;

  // Where this tile sits inside the crop window. The art's bottom edge rests on
  // the anchor row's bottom edge, so pixel row 0 of the tile below the anchor is
  // the LAST row of the art.
  const left = (tx - anchor.x) * TILE_SIZE;
  const bottom = height - (anchor.y - 1 - ty) * TILE_SIZE;
  const top = bottom - TILE_SIZE;

  let opaque = 0;
  let total = 0;
  for (let y = Math.max(0, top); y < Math.min(height, bottom); y++) {
    for (let x = Math.max(0, left); x < Math.min(width, left + TILE_SIZE); x++) {
      total += 1;
      if (alphaAt(img, cx + x, cy + y) > 0) opaque += 1;
    }
  }
  return total === 0 ? 0 : opaque / total;
}

const BUILDINGS: readonly [string, TilePoint, readonly BuildingLook[]][] = [
  ['house', HOUSE_ANCHOR, HOUSE_TIER_ART],
  ['coop', COOP_ANCHOR, COOP_TIER_ART],
  ['barn', BARN_ANCHOR, BARN_TIER_ART],
];

describe('building collision follows the building', () => {
  /**
   * The headline guard. Every tile that stops the player must have something
   * drawn on it — otherwise it is an invisible wall, which is the one collision
   * failure a player can neither see nor reason about.
   */
  it('never blocks a tile with no art on it, at any tier', () => {
    const ghosts: string[] = [];

    for (const [name, anchor, tiers] of BUILDINGS) {
      tiers.forEach((look, tier) => {
        for (const t of buildingBodyTiles(anchor, look)) {
          if (coverage(look, anchor, t.x, t.y) === 0) ghosts.push(`${name} t${tier} (${t.x},${t.y})`);
        }
      });
    }

    expect(ghosts, 'solid tiles with nothing drawn on them').toEqual([]);
  });

  /**
   * Stronger than the above, and the reason the body is measured rather than
   * thresholded: a tile that is *technically* non-empty because a chimney clips
   * its corner is still an invisible wall to a player. Every solid tile should
   * be substantially covered.
   */
  it('blocks only tiles the building substantially covers', () => {
    const thin: string[] = [];

    for (const [name, anchor, tiers] of BUILDINGS) {
      tiers.forEach((look, tier) => {
        for (const t of buildingBodyTiles(anchor, look)) {
          const cov = coverage(look, anchor, t.x, t.y);
          if (cov < 0.25) thin.push(`${name} t${tier} (${t.x},${t.y}) ${(cov * 100).toFixed(0)}%`);
        }
      });
    }

    expect(thin, 'solid tiles under a quarter covered').toEqual([]);
  });

  /**
   * The body must never exceed the box. Reservation is the pessimistic
   * question and collision the permissive one; if collision ever grew past what
   * the generator reserved, a building could block ground the map is free to
   * put a tree on.
   */
  it('keeps every body inside the reserved footprint', () => {
    const box = [houseFootprint, coopFootprint, barnFootprint];

    BUILDINGS.forEach(([name, anchor, tiers], i) => {
      tiers.forEach((look, tier) => {
        const reserved: TileFootprint = box[i]!(tier);

        for (const t of buildingBodyTiles(anchor, look)) {
          const within =
            t.x >= reserved.x0 && t.x <= reserved.x1 && t.y >= reserved.y0 && t.y <= reserved.y1;
          expect(within, `${name} t${tier} (${t.x},${t.y}) is solid but unreserved`).toBe(true);
        }
      });
    });
  });

  /**
   * The body must still reach the ground. A building whose collision floated
   * above its own base would be one you could walk *through* at floor level —
   * the opposite failure, and a worse one.
   */
  it('always keeps the ground row solid', () => {
    for (const [name, anchor, tiers] of BUILDINGS) {
      tiers.forEach((look, tier) => {
        const onGround = buildingBodyTiles(anchor, look).filter((t) => t.y === anchor.y - 1);
        expect(onGround.length, `${name} t${tier} floats above its own base`).toBeGreaterThan(0);
      });
    }
  });

  /**
   * Every art the collision layer draws must have been measured. A missing key
   * falls back to the full height — the old, over-solid behaviour — so this
   * fails loudly rather than quietly reintroducing roof collision.
   */
  it('has a measured mask for every building art', () => {
    for (const [, , tiers] of BUILDINGS) {
      for (const look of tiers) {
        const mask = BUILDING_BODY_MASK[look.sheet.key];
        expect(mask, `${look.sheet.key} is unmeasured`).toBeDefined();

        /*
         * The mask must match the art's TILE grid, or it silently describes a
         * different building — the failure a string literal invites.
         *
         * Measured in tiles rather than in characters since the table gained
         * sub-tile masks: `obj-farmhouse` is authored at 3x, so it is 24x18
         * characters for an 8x6-tile building. Comparing raw lengths read that
         * as a 24-tile-wide farmhouse. `maskTileSize` is the shared answer, so
         * this cannot drift from the runtime's own reading.
         */
        const artCols = Math.ceil(look.look.width / TILE_SIZE);
        const size = maskTileSize(mask!, maskResolution(mask!, artCols));

        expect(size.rows, `${look.sheet.key} row count`).toBe(
          Math.ceil(look.look.height / TILE_SIZE),
        );
        expect(size.cols, `${look.sheet.key} column count`).toBe(artCols);
      }
    }
  });
});
