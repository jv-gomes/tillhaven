import { describe, expect, it } from 'vitest';
import { FARM_CONTENT, PIXEL_SCALE, TILE_SIZE, FARM_WIDTH, FARM_HEIGHT } from '@tillhaven/shared/config';
import { centreOffset, fitZoom, type Chrome } from './camera.js';

/**
 * T-18.03. The regression these guard is not subtle once it happens — the farm
 * renders at native size in the middle of the screen — but it is invisible in
 * code review, because it is a `Math.floor` landing on the wrong side of a
 * decimal nobody computed.
 */

/** What the HUD measures at full size, from `hud.chrome()` in the browser. */
const FULL: Chrome = { top: 71, bottom: 80 };
/** ...and under `hud.css`'s `max-height: 820px` compact rules. */
const COMPACT: Chrome = { top: 58, bottom: 56 };

const farm = (w: number, h: number, chrome: Chrome) =>
  fitZoom({ width: w, height: h }, FARM_CONTENT, chrome, PIXEL_SCALE);

describe('fitZoom on the farm', () => {
  /**
   * The bug, stated as a test. 1366x768 is the most common laptop resolution
   * there is, and it was rendering the game at 1:1.
   */
  it('reaches zoom 2 on a 1366x768 laptop', () => {
    expect(farm(1366, 768, COMPACT)).toBe(2);
  });

  it('would still be stuck at zoom 1 there without the compact chrome', () => {
    // 640px of farm needs to fit; full-size chrome leaves 617. This is the
    // whole reason `hud.css` shrinks the bar and the hotbar on short screens —
    // if that media query is ever removed, the laptop case silently regresses.
    expect(farm(1366, 768, FULL)).toBe(1);
  });

  it('leaves the sizes that already worked alone', () => {
    expect(farm(1920, 1080, FULL)).toBe(2);
    expect(farm(1440, 900, FULL)).toBe(2);
  });

  it('never exceeds PIXEL_SCALE, however big the screen', () => {
    expect(farm(3840, 2160, FULL)).toBe(PIXEL_SCALE);
  });

  it('never goes below 1, however small', () => {
    expect(farm(320, 200, COMPACT)).toBe(1);
    // Chrome taller than the viewport must not produce 0 or a negative zoom.
    expect(farm(320, 100, FULL)).toBe(1);
  });

  /**
   * The fit targets the CONTENT rect, not the map. Asserting the two differ is
   * what stops someone "simplifying" this back to the map's own size — which is
   * exactly the code that shipped the 1366x768 bug.
   */
  it('asks for the map minus its decorative frame, not the whole map', () => {
    const map = { width: FARM_WIDTH * TILE_SIZE, height: FARM_HEIGHT * TILE_SIZE };
    expect(FARM_CONTENT.width).toBeLessThan(map.width);
    expect(FARM_CONTENT.height).toBeLessThan(map.height);

    const withMap = fitZoom({ width: 1366, height: 768 }, map, COMPACT, PIXEL_SCALE);
    expect(withMap, 'the frame is what costs the zoom level').toBeLessThan(
      farm(1366, 768, COMPACT),
    );
  });

  it('is monotonic: a bigger screen never draws a smaller world', () => {
    let previous = 0;
    for (const height of [400, 600, 720, 768, 900, 1080, 1440]) {
      const zoom = farm(2560, height, COMPACT);
      expect(zoom).toBeGreaterThanOrEqual(previous);
      previous = zoom;
    }
  });
});

describe('centreOffset', () => {
  it('is zero when the chrome is balanced, so the world sits centred', () => {
    expect(centreOffset({ top: 60, bottom: 60 }, 2)).toBe(0);
  });

  it('pushes the world down when the top bar is the heavier one', () => {
    // A positive offset is subtracted from the centre, moving the focus up and
    // the world down — away from the bar.
    expect(centreOffset({ top: 71, bottom: 0 }, 2)).toBeGreaterThan(0);
  });

  it('pushes it back up when the hotbar is heavier', () => {
    expect(centreOffset({ top: 58, bottom: 80 }, 2)).toBeLessThan(0);
  });

  /**
   * The offset is in WORLD pixels, so it has to shrink as the zoom grows or the
   * world slides further at every zoom level for the same fixed-size bar.
   */
  it('shrinks with zoom, because it is measured in world pixels', () => {
    const at2 = centreOffset(FULL, 2);
    const at3 = centreOffset(FULL, 3);
    expect(Math.abs(at3)).toBeLessThan(Math.abs(at2));
  });
});

describe('the content rect the farm fits', () => {
  it('is the map inset by exactly one tile on every side', () => {
    expect(FARM_CONTENT.tilesWide).toBe(FARM_WIDTH - 2);
    expect(FARM_CONTENT.tilesHigh).toBe(FARM_HEIGHT - 2);
    expect(FARM_CONTENT.width).toBe(FARM_CONTENT.tilesWide * TILE_SIZE);
    expect(FARM_CONTENT.height).toBe(FARM_CONTENT.tilesHigh * TILE_SIZE);
  });

  /**
   * Concentric with the map, which is why `fitCamera` can keep centring on the
   * map's own centre. A non-uniform ring would silently shift the world.
   */
  it('shares the map centre, so no separate origin is needed', () => {
    const inset = (FARM_WIDTH * TILE_SIZE - FARM_CONTENT.width) / 2;
    const insetY = (FARM_HEIGHT * TILE_SIZE - FARM_CONTENT.height) / 2;
    expect(inset).toBe(TILE_SIZE);
    expect(insetY).toBe(TILE_SIZE);
  });
});
