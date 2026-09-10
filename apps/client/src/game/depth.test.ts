import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '@tillhaven/shared/config';
import {
  CHARACTER_BIAS,
  DEPTH,
  aboveGround,
  belowGround,
  characterDepth,
  characterShadowDepth,
  groundDepth,
} from './depth.js';

/**
 * T-15.29. One sort rule for everything that stands on the ground.
 *
 * The failure this guards is specific and easy to miss: a character walking
 * *behind* something they are standing in front of. It only shows up when two
 * sprites are near the same row, which is exactly when nobody is looking.
 */

describe('groundDepth', () => {
  it('sorts by feet, so a sprite lower on the map draws in front', () => {
    expect(groundDepth(100)).toBeGreaterThan(groundDepth(84));
  });

  /*
   * The case that made this a shared function. The player standing one tile
   * south of a tree must draw in front of it; one tile north, behind it.
   * Fourteen call sites each computed this by hand before T-15.29.
   */
  it('puts the player in front of a tree a tile north, and behind one a tile south', () => {
    const tree = groundDepth(10 * TILE_SIZE);
    expect(groundDepth(11 * TILE_SIZE)).toBeGreaterThan(tree);
    expect(groundDepth(9 * TILE_SIZE)).toBeLessThan(tree);
  });

  it('keeps every standing sprite above the tile layers', () => {
    // Even at y=0 — the top row of the map — a sprite must not sort into the
    // ground or the decor layer.
    expect(groundDepth(0)).toBeGreaterThan(DEPTH.ground);
    expect(groundDepth(0)).toBeGreaterThan(DEPTH.decor);
  });

  it('stays below the overlay, which is for HUD-like things in world space', () => {
    const bottomOfMap = 22 * TILE_SIZE;
    expect(groundDepth(bottomOfMap)).toBeLessThan(DEPTH.overlay);
  });
});

/**
 * T-18.01. The ground-decal band, and why it is not a feet-Y.
 *
 * The bug: the plot container (opaque tilled soil + outline + crop) sorted at
 * `groundDepth(top + TILE_SIZE)` — the tile's bottom edge. A player standing on
 * that tile has feet in `(top, top + TILE_SIZE]`, so the character was drawn
 * UNDER the soil from every position on the plot, at every growth stage, from
 * every approach direction. Farming turned the character into a floating head.
 */
describe('DEPTH.groundDecal', () => {
  it('never occludes a character standing on the tile it is painted on', () => {
    const top = 9 * TILE_SIZE;

    // Every position a character can occupy while standing on that tile.
    for (let feet = top + 1; feet <= top + TILE_SIZE; feet++) {
      expect(characterDepth(feet)).toBeGreaterThan(DEPTH.groundDecal);
      // Their shadow too, or the soil cuts the contact shadow off.
      expect(characterShadowDepth(feet)).toBeGreaterThan(DEPTH.groundDecal);
    }
  });

  it('stays under even a sprite standing on the map top row', () => {
    // y=0 is the smallest feet-Y there is; the decal must still lose to it.
    expect(DEPTH.groundDecal).toBeLessThan(belowGround(0));
  });

  it('sits above the tile layers, since it is drawn over authored ground', () => {
    expect(DEPTH.groundDecal).toBeGreaterThan(DEPTH.ground);
    expect(DEPTH.groundDecal).toBeGreaterThan(DEPTH.decor);
  });

  it('is covered by the faced-tile outline, which must show on tilled soil', () => {
    expect(DEPTH.targetOutline).toBeGreaterThan(DEPTH.groundDecal);
    // ...but still passes behind everything that stands, including shadows.
    expect(DEPTH.targetOutline).toBeLessThan(belowGround(0));
  });
});

/**
 * T-18.01. Ties used to go to whoever was constructed last, which is why the
 * plots (built after the player) won and the buildings (built before) lost.
 */
describe('characterDepth', () => {
  it('beats static scenery standing on the same ground line', () => {
    const line = 12 * TILE_SIZE;
    expect(characterDepth(line)).toBeGreaterThan(groundDepth(line));
  });

  it('never reaches the next pixel row, so row order still wins', () => {
    expect(CHARACTER_BIAS).toBeGreaterThan(0);
    expect(CHARACTER_BIAS).toBeLessThan(1);

    const line = 12 * TILE_SIZE;
    expect(characterDepth(line)).toBeLessThan(groundDepth(line + 1));
    // A character one tile north still draws behind scenery one tile south.
    expect(characterDepth(line - TILE_SIZE)).toBeLessThan(groundDepth(line));
  });

  it('keeps its own badge above it and its own shadow below it', () => {
    const line = 12 * TILE_SIZE;
    expect(aboveGround(line)).toBeGreaterThan(characterDepth(line));
    expect(characterShadowDepth(line)).toBeLessThan(characterDepth(line));
    // The shadow must not sink behind whatever stands a full row back.
    expect(characterShadowDepth(line)).toBeGreaterThan(groundDepth(line - TILE_SIZE));
  });
});

describe('aboveGround / belowGround', () => {
  it('brackets its own sprite without crossing a neighbouring row', () => {
    const y = 10 * TILE_SIZE;
    expect(belowGround(y)).toBeLessThan(groundDepth(y));
    expect(aboveGround(y)).toBeGreaterThan(groundDepth(y));

    // A badge over one animal must not outrank the animal on the next row
    // down, or it floats in front of something standing closer to the camera.
    expect(aboveGround(y)).toBeLessThan(groundDepth(y + TILE_SIZE));
    // ...and a shadow must not sink behind the row above.
    expect(belowGround(y)).toBeGreaterThan(groundDepth(y - TILE_SIZE));
  });
});
