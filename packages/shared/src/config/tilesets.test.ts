import { describe, expect, it } from 'vitest';
import { SHEETS, IMAGES } from './assets.js';
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
