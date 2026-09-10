import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECOR, DECOR_IDS, DECOR_VIP_TWIN, IMAGES } from '@tillhaven/shared/config';
// @ts-expect-error -- plain .mjs tooling module, shared with the measure scripts.
import { decodePng } from '../../../../scripts/lib/png.mjs';

/**
 * T-25.01 — a VIP cosmetic must actually LOOK different.
 *
 * `decor.test.ts` in `packages/shared` already proves the two halves of the
 * bargain that arithmetic can see: a VIP piece matches its twin in every field
 * a rule reads (footprint, solid, price, tradeable), and its `look` window is
 * at different coordinates. Neither of those is enough. **Different coordinates
 * into the same sheet can still be the same picture** — a duplicated row, a
 * blank region, an off-by-one that lands on the neighbour — and then the paid
 * piece is the free piece sold twice, which is worse than not shipping it.
 *
 * Only the pixels can settle it, so this lives in the mapmaker, for the reason
 * `buildingBodies.test.ts` gives: `packages/shared` cannot read a PNG, and this
 * is the package allowed to hold the manifest and the real files at once.
 *
 * Measured when written: 25% of the fence rail's pixels differ, 25% of the
 * post's, and 19% of the signpost's. The signpost is the interesting one — it
 * has the SAME silhouette as its twin (318 opaque pixels in both), because the
 * snow is painted onto the same shape rather than added to it. An
 * alpha-coverage check would have called those two identical.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ASSETS = resolve(ROOT, 'apps/client/public/assets');
const IMAGE_KEYS = new Map(IMAGES.map((i) => [i.key, i]));

const cache = new Map<string, ReturnType<typeof decodePng>>();
function art(key: string) {
  if (!cache.has(key)) {
    const path = IMAGE_KEYS.get(key)!.path.replace(/^.*\/assets\//, '');
    cache.set(key, decodePng(readFileSync(resolve(ASSETS, path))));
  }
  return cache.get(key)!;
}

/** RGBA at a pixel, as one packed number. */
function px(img: ReturnType<typeof decodePng>, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  return (d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!;
}

function windowPixels(id: string): { pixels: number[]; opaque: number } {
  const def = DECOR[id]!;
  const img = art(def.sheet);
  const { x, y, width, height } = def.look;

  const pixels: number[] = [];
  let opaque = 0;
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const value = px(img, x + dx, y + dy);
      pixels.push(value);
      if ((value & 0xff) > 0) opaque += 1;
    }
  }
  return { pixels, opaque };
}

describe('VIP decoration art', () => {
  const vipIds = DECOR_IDS.filter((id) => DECOR[id]!.vipOnly);

  it('has something to check', () => {
    expect(vipIds.length).toBeGreaterThan(0);
    expect(Object.keys(DECOR_VIP_TWIN)).toEqual(expect.arrayContaining(vipIds));
  });

  /**
   * A window full of nothing draws nothing, and the player pays for an empty
   * patch of grass. The plain catalogue is checked the same way by
   * `decor.test.ts`'s "inside its own image" rule only for BOUNDS — this is the
   * contents.
   */
  it('draws a substantial sprite in every VIP window', () => {
    for (const id of vipIds) {
      const def = DECOR[id]!;
      const { opaque } = windowPixels(id);
      const area = def.look.width * def.look.height;
      expect(opaque / area, `${id} is mostly empty`).toBeGreaterThan(0.25);
    }
  });

  /** The load-bearing one: paid art must not be free art at other coordinates. */
  it('differs from its twin in the pixels, not just the coordinates', () => {
    for (const [vipId, twinId] of Object.entries(DECOR_VIP_TWIN)) {
      const a = windowPixels(vipId).pixels;
      const b = windowPixels(twinId).pixels;

      // Same window size, or the twin claim in `decor.ts` is already wrong.
      expect(a.length, `${vipId} and ${twinId} are different sizes`).toBe(b.length);

      let differing = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing += 1;

      expect(
        differing / a.length,
        `${vipId} draws all but ${differing} of ${twinId}'s pixels`,
      ).toBeGreaterThan(0.05);
    }
  });
});
