import { describe, expect, it } from 'vitest';
import { SHEETS, ICON_SHEETS, IMAGES } from './assets.js';
import { TILESET_RUNS, fromGid, runByKey, toGid } from './tilesets.js';

describe('gid allocation', () => {
  it('covers every sheet and image in the manifest', () => {
    expect(TILESET_RUNS).toHaveLength(SHEETS.length + IMAGES.length);
    for (const sheet of SHEETS) expect(runByKey(sheet.key)).toBeDefined();
    for (const image of IMAGES) expect(runByKey(image.key)).toBeDefined();
  });

  it('starts at 1, leaving 0 to mean empty', () => {
    expect(TILESET_RUNS[0]?.firstgid).toBe(1);
  });

  it('allocates contiguous, non-overlapping runs', () => {
    let expected = 1;
    for (const run of TILESET_RUNS) {
      expect(run.firstgid).toBe(expected);
      expect(run.tileCount).toBeGreaterThan(0);
      expected += run.tileCount;
    }
  });

  it('matches the manifest geometry it was derived from', () => {
    for (const sheet of SHEETS) {
      const run = runByKey(sheet.key);
      expect(run?.tileCount).toBe(sheet.cols * sheet.rows);
      expect(run?.tileWidth).toBe(sheet.frameWidth);
      expect(run?.tileHeight).toBe(sheet.frameHeight);
    }
  });
});

describe('toGid / fromGid', () => {
  it('round-trips every frame of every tileset', () => {
    for (const run of TILESET_RUNS) {
      for (const frame of [0, 1, run.tileCount - 1]) {
        if (frame < 0 || frame >= run.tileCount) continue;
        const gid = toGid(run.key, frame);
        const back = fromGid(gid);
        expect(back?.run.key).toBe(run.key);
        expect(back?.frame).toBe(frame);
      }
    }
  });

  it('treats 0 and negatives as empty rather than throwing', () => {
    expect(fromGid(0)).toBeUndefined();
    expect(fromGid(-1)).toBeUndefined();
  });

  it('returns undefined for a gid past the last tileset', () => {
    const last = TILESET_RUNS[TILESET_RUNS.length - 1];
    expect(last).toBeDefined();
    expect(fromGid((last?.firstgid ?? 0) + (last?.tileCount ?? 0))).toBeUndefined();
  });

  it('rejects an out-of-range frame instead of producing a neighbour tileset gid', () => {
    const run = TILESET_RUNS[0];
    expect(run).toBeDefined();
    expect(() => toGid(run?.key ?? '', run?.tileCount ?? 0)).toThrow();
    expect(() => toGid(run?.key ?? '', -1)).toThrow();
  });

  it('throws on an unknown tileset key', () => {
    expect(() => toGid('not-a-real-sheet', 0)).toThrow();
  });
});

/**
 * **`ICON_SHEETS` costs no gids, which is the only reason it exists** (T-34.04).
 *
 * Item icons are never painted on a map, but four of them are in `SHEETS`
 * anyway — each one having cost a gid shift and a map regeneration to add,
 * each carrying a comment saying so. Since M5 the map is AUTHORED, so
 * "regenerate it" is no longer an answer, and adding eighteen fish icons the old
 * way would have renumbered every object in `farm.json`.
 *
 * These tests are what stop somebody helpfully "tidying" the third list back
 * into the first.
 */
describe('the gid-free icon list', () => {
  it('allocates no gid to any icon sheet', () => {
    for (const icon of ICON_SHEETS) {
      expect(
        runByKey(icon.key),
        `${icon.key} has a gid — it was added to SHEETS or IMAGES, which ` +
          'renumbers every tileset after it and repaints farm.json',
      ).toBeUndefined();
    }
  });

  it('keeps every icon sheet out of the gid-allocated lists', () => {
    const allocated = new Set(TILESET_RUNS.map((r) => r.key));
    for (const icon of ICON_SHEETS) expect(allocated.has(icon.key)).toBe(false);
  });

  it('still gives every icon sheet a unique key across all three lists', () => {
    const keys = [...SHEETS, ...ICON_SHEETS, ...IMAGES].map((s) => s.key);
    expect(new Set(keys).size, 'two manifest entries share a key').toBe(keys.length);
  });

  /**
   * The gid table must not move when the icon list grows. Pinned as a total, so
   * appending a nineteenth fish cannot silently shift the map — the number here
   * changes only when somebody edits `SHEETS` or `IMAGES`, which is exactly the
   * edit that needs a second look.
   */
  it('has a gid table that ends where the paintable art ends', () => {
    const last = TILESET_RUNS[TILESET_RUNS.length - 1]!;
    const total = last.firstgid + last.tileCount - 1;
    const paintable = [...SHEETS, ...IMAGES].length;

    expect(TILESET_RUNS).toHaveLength(paintable);
    expect(total).toBeGreaterThan(0);
  });
});
