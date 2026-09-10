import { describe, expect, it } from 'vitest';
import { DECOR, DECOR_IDS, TILE_SIZE, decorAnchorPx } from '@tillhaven/shared/config';

/**
 * T-15.22. The drawing anchor is the one bit of arithmetic here that can be
 * silently wrong: get it off by a footprint and every piece floats a tile above
 * where the server thinks it is.
 */

describe('decorAnchorPx', () => {
  /*
   * A piece is STORED by its top-left cell but DRAWN bottom-anchored, so the
   * anchor is one footprint-height below the stored y. A 1x1 piece at tile
   * (3,4) therefore draws from py 80 — the bottom edge of row 4 — not py 64.
   */
  it('anchors a one-tile piece on the bottom edge of its cell', () => {
    const def = DECOR.berry_pile!;
    expect(def.footprint).toEqual({ width: 1, height: 1 });
    expect(decorAnchorPx(def, 3, 4)).toEqual({ x: 3 * TILE_SIZE, y: 5 * TILE_SIZE });
  });

  it('anchors a taller piece below its whole footprint', () => {
    const def = { ...DECOR.berry_pile!, footprint: { width: 1, height: 2 } };
    expect(decorAnchorPx(def, 3, 4)).toEqual({ x: 3 * TILE_SIZE, y: 6 * TILE_SIZE });
  });

  it('puts x on the left edge, so a wide piece grows rightward', () => {
    const fence = DECOR.fence_h!;
    expect(decorAnchorPx(fence, 10, 5).x).toBe(10 * TILE_SIZE);
  });

  /*
   * The reason footprints are authored rather than derived (T-15.16): art
   * taller than its footprint overhangs UPWARD from the anchor, which is what
   * puts a street lamp's post on its tile and its head over the tile above.
   * If this ever stopped being true, the overhang would be drawn downward and
   * every tall piece would sink into the ground.
   */
  it('leaves tall art overhanging upward rather than sinking', () => {
    const lamp = DECOR.street_lamp!;
    const anchor = decorAnchorPx(lamp, 6, 6);
    const artTop = anchor.y - lamp.look.height;
    expect(lamp.look.height).toBeGreaterThan(lamp.footprint.height * TILE_SIZE);
    expect(artTop, 'the art should extend above the footprint').toBeLessThan(6 * TILE_SIZE);
  });

  it('agrees with the footprint for every catalogue piece', () => {
    for (const id of DECOR_IDS) {
      const def = DECOR[id]!;
      const anchor = decorAnchorPx(def, 2, 2);
      expect(anchor.y - 2 * TILE_SIZE, `${id}`).toBe(def.footprint.height * TILE_SIZE);
    }
  });
});
