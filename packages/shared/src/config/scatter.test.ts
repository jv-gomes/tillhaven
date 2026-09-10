import { describe, expect, it } from 'vitest';
import { GROUND_SCATTER, isGroundScatterFrame, scatterTiles } from './farmLayout.js';
import { TILESET_PROPS_SEASONS } from './assets.js';
import { runByKey } from './tilesets.js';

/**
 * Which props the editor marks as safe for the `decor` layer.
 *
 * **A vouched-for list, not a measurement.** `decor` draws BELOW every world
 * sprite, so a prop with height is drawn behind the player from every angle,
 * permanently. These eleven frames were picked by hand against that constraint;
 * the rest of the sheet is not forbidden, just unchecked. The palette marks
 * these so somebody adding grass by hand can match what is already on the map.
 */
describe('isGroundScatterFrame', () => {
  it('marks exactly the frames the generator scatters', () => {
    const expected = [...GROUND_SCATTER.tufts, ...GROUND_SCATTER.stones].sort((a, b) => a - b);
    const run = runByKey(GROUND_SCATTER.sheet)!;
    const marked: number[] = [];
    for (let f = 0; f < run.tileCount; f++) {
      if (isGroundScatterFrame(GROUND_SCATTER.sheet, f)) marked.push(f);
    }
    expect(marked).toEqual(expected);
  });

  it('marks nothing on any other sheet', () => {
    expect(isGroundScatterFrame('tileset-grass-spring', 1)).toBe(false);
    expect(isGroundScatterFrame('tileset-water-anim', 1)).toBe(false);
  });

  /**
   * Frames 0 and 4 sit in the same band and are deliberately excluded: both
   * carry a brown lump that reads as bare earth rather than grass — a hole in
   * the lawn at farm zoom.
   */
  it('excludes the two bare-earth tufts in the same band', () => {
    expect(isGroundScatterFrame(GROUND_SCATTER.sheet, 0)).toBe(false);
    expect(isGroundScatterFrame(GROUND_SCATTER.sheet, 4)).toBe(false);
  });

  it('names frames that exist in the sheet', () => {
    const run = runByKey(GROUND_SCATTER.sheet)!;
    expect(GROUND_SCATTER.sheet).toBe(TILESET_PROPS_SEASONS.key);
    for (const f of [...GROUND_SCATTER.tufts, ...GROUND_SCATTER.stones]) {
      expect(f, `frame ${f}`).toBeLessThan(run.tileCount);
    }
  });

  /** Everything the generator actually places must be a marked frame, or the
   *  palette would show a map full of props it calls unvouched-for. */
  it('marks every frame scatterTiles can emit', () => {
    const open = [];
    for (let y = 0; y < 22; y++) for (let x = 0; x < 30; x++) open.push({ x, y });
    const placed = scatterTiles(open);
    expect(placed.length).toBeGreaterThan(0);
    for (const t of placed) {
      expect(isGroundScatterFrame(t.sheet, t.frame), `${t.sheet} ${t.frame}`).toBe(true);
    }
  });
});
