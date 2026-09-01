import { describe, expect, it } from 'vitest';
import { createDoc, type MapDoc, type TileLayer } from '../model/doc.js';
import { History } from '../model/history.js';
import { fillRect, floodFill, rectFromDrag } from './fill.js';
import { EMPTY_STAMP, isEmptyStamp, singleStamp, type Stamp } from './stamp.js';

function setup(): { doc: MapDoc; layer: TileLayer; history: History } {
  const doc = createDoc(8, 6);
  const layer = doc.layers[0];
  if (layer?.kind !== 'tile') throw new Error('expected a tile layer first');
  const history = new History(doc);
  history.begin('test');
  return { doc, layer, history };
}

function grid(doc: MapDoc, layer: TileLayer): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < doc.height; y++) {
    const row: number[] = [];
    for (let x = 0; x < doc.width; x++) row.push(layer.data[y * doc.width + x] ?? 0);
    rows.push(row);
  }
  return rows;
}

describe('isEmptyStamp', () => {
  // A fresh editor starts with EMPTY_STAMP, so painting with it wrote nothing
  // and said nothing — the tools looked broken. main.ts refuses the stroke and
  // explains why; this pins the predicate that decision rests on.
  it('recognises the default stamp as writing nothing', () => {
    expect(isEmptyStamp(EMPTY_STAMP)).toBe(true);
    expect(isEmptyStamp({ w: 2, h: 1, gids: [0, 0] })).toBe(true);
  });

  it('does not flag a stamp with any real tile in it', () => {
    expect(isEmptyStamp(singleStamp(7))).toBe(false);
    expect(isEmptyStamp({ w: 2, h: 1, gids: [0, 7] })).toBe(false);
  });

  it('confirms an empty stamp really is a no-op through the fill tools', () => {
    const { doc, layer, history } = setup();
    fillRect(doc, layer, history, EMPTY_STAMP, { x: 0, y: 0, w: 4, h: 4 });
    expect(grid(doc, layer).flat().every((v) => v === 0)).toBe(true);
  });
});

describe('rectFromDrag', () => {
  it('normalises a drag made in any direction', () => {
    expect(rectFromDrag(5, 5, 2, 3)).toEqual({ x: 2, y: 3, w: 4, h: 3 });
    expect(rectFromDrag(2, 3, 5, 5)).toEqual({ x: 2, y: 3, w: 4, h: 3 });
  });

  it('makes a click a 1x1 rect, not an empty one', () => {
    expect(rectFromDrag(4, 4, 4, 4)).toEqual({ x: 4, y: 4, w: 1, h: 1 });
  });
});

describe('fillRect', () => {
  it('fills exactly the rectangle and nothing else', () => {
    const { doc, layer, history } = setup();
    fillRect(doc, layer, history, singleStamp(7), { x: 1, y: 1, w: 3, h: 2 });
    const rows = grid(doc, layer);
    expect(rows[0]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(rows[1]).toEqual([0, 7, 7, 7, 0, 0, 0, 0]);
    expect(rows[2]).toEqual([0, 7, 7, 7, 0, 0, 0, 0]);
    expect(rows[3]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('clips at the map edge instead of wrapping to the next row', () => {
    const { doc, layer, history } = setup();
    fillRect(doc, layer, history, singleStamp(3), { x: 6, y: 0, w: 5, h: 1 });
    const rows = grid(doc, layer);
    expect(rows[0]).toEqual([0, 0, 0, 0, 0, 0, 3, 3]);
    expect(rows[1]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('tiles a multi-tile stamp across the region', () => {
    const { doc, layer, history } = setup();
    const stamp: Stamp = { w: 2, h: 1, gids: [1, 2] };
    fillRect(doc, layer, history, stamp, { x: 0, y: 0, w: 4, h: 1 });
    expect(grid(doc, layer)[0]).toEqual([1, 2, 1, 2, 0, 0, 0, 0]);
  });
});

describe('floodFill', () => {
  it('fills a contiguous region of the map', () => {
    const { doc, layer, history } = setup();
    expect(floodFill(doc, layer, history, singleStamp(4), 0, 0)).toBe(true);
    for (const row of grid(doc, layer)) expect(row.every((v) => v === 4)).toBe(true);
  });

  it('stops at a boundary of different tiles', () => {
    const { doc, layer, history } = setup();
    // Wall down column 3 splits the map in two.
    fillRect(doc, layer, history, singleStamp(9), { x: 3, y: 0, w: 1, h: 6 });
    floodFill(doc, layer, history, singleStamp(4), 0, 0);

    const rows = grid(doc, layer);
    expect(rows[0]?.slice(0, 3)).toEqual([4, 4, 4]);
    expect(rows[0]?.[3]).toBe(9);
    expect(rows[0]?.slice(4)).toEqual([0, 0, 0, 0]);
  });

  it('is a no-op when the target already holds the fill tile', () => {
    // The classic infinite loop: without the early return this never terminates.
    const { doc, layer, history } = setup();
    fillRect(doc, layer, history, singleStamp(5), { x: 0, y: 0, w: 8, h: 6 });
    expect(floodFill(doc, layer, history, singleStamp(5), 2, 2)).toBe(false);
  });

  it('does nothing outside the map', () => {
    const { doc, layer, history } = setup();
    expect(floodFill(doc, layer, history, singleStamp(4), -1, 0)).toBe(false);
    expect(floodFill(doc, layer, history, singleStamp(4), 0, 99)).toBe(false);
    expect(grid(doc, layer).flat().every((v) => v === 0)).toBe(true);
  });

  it('aligns a multi-tile stamp to map coordinates, not the click point', () => {
    const { doc, layer, history } = setup();
    const stamp: Stamp = { w: 2, h: 1, gids: [1, 2] };
    floodFill(doc, layer, history, stamp, 5, 0);
    // Column parity decides the tile, so two fills of adjacent regions line up.
    expect(grid(doc, layer)[0]).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
  });
});
