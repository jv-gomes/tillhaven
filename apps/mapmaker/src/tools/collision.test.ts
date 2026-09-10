import { describe, expect, it } from 'vitest';
import {
  SUBTILE_RESOLUTION,
  cellsToTileMasks,
  tileMaskToCells,
} from '@tillhaven/shared/config';
import { collisionLayer, createDoc, type CollisionLayer, type MapDoc } from '../model/doc.js';
import { History } from '../model/history.js';
import { deserialize, serialize } from '../io/tiled.js';
import { cellInBounds, clearCollision, isSolidCell, paintCells, tileCells } from './collision.js';

/**
 * Authored collision.
 *
 * The map can now outline a shape the art cannot express. Two things have to
 * hold for that to be worth anything: the cells mean what they say (the finer
 * grid, not the tile grid), and they survive the trip through the file.
 */

function fixture(): { doc: MapDoc; layer: CollisionLayer; history: History } {
  const doc = createDoc(10, 8);
  const layer = collisionLayer(doc)!;
  const history = new History(doc);
  history.begin('test');
  return { doc, layer, history };
}

describe('the layer', () => {
  it('exists in a fresh document and starts empty', () => {
    expect(collisionLayer(createDoc())?.cells).toEqual([]);
  });
});

describe('cellInBounds', () => {
  /**
   * **The bug this exists to prevent.** `inBounds` takes TILE coordinates, so
   * passing it a cell accepts everything in the left third of the map and
   * rejects the rest — a brush that looks like it stops working two thirds of
   * the way across.
   */
  it('bounds the finer grid, not the tile grid', () => {
    const doc = createDoc(10, 8);
    expect(cellInBounds(doc, 10, 0), 'a cell at tile-width is well inside the map').toBe(true);
    expect(cellInBounds(doc, 10 * SUBTILE_RESOLUTION - 1, 0)).toBe(true);
    expect(cellInBounds(doc, 10 * SUBTILE_RESOLUTION, 0)).toBe(false);
    expect(cellInBounds(doc, 0, 8 * SUBTILE_RESOLUTION)).toBe(false);
    expect(cellInBounds(doc, -1, 0)).toBe(false);
  });
});

describe('paintCells', () => {
  it('paints and erases', () => {
    const { doc, layer, history } = fixture();
    expect(paintCells(doc, layer, history, [{ cx: 4, cy: 5 }], true)).toBe(true);
    expect(isSolidCell(layer, 4, 5)).toBe(true);

    expect(paintCells(doc, layer, history, [{ cx: 4, cy: 5 }], false)).toBe(true);
    expect(isSolidCell(layer, 4, 5)).toBe(false);
  });

  /** A stroke over ground that is already painted must not cost an undo slot. */
  it('reports no change when nothing changed', () => {
    const { doc, layer, history } = fixture();
    paintCells(doc, layer, history, [{ cx: 1, cy: 1 }], true);
    expect(paintCells(doc, layer, history, [{ cx: 1, cy: 1 }], true)).toBe(false);
    expect(paintCells(doc, layer, history, [{ cx: 2, cy: 2 }], false)).toBe(false);
  });

  it('never stores a cell twice', () => {
    const { doc, layer, history } = fixture();
    paintCells(doc, layer, history, [{ cx: 3, cy: 3 }, { cx: 3, cy: 3 }], true);
    expect(layer.cells).toHaveLength(1);
  });

  it('drops cells outside the map rather than storing them', () => {
    const { doc, layer, history } = fixture();
    paintCells(doc, layer, history, [{ cx: -1, cy: 0 }, { cx: 0, cy: 0 }], true);
    expect(layer.cells).toEqual([{ cx: 0, cy: 0 }]);
  });

  /**
   * **A drag is one undo, not forty.** Recording per cell would make erasing a
   * painted outline a Ctrl+Z marathon, which is how a tool stops being used.
   */
  it('makes a whole stroke a single undo step', () => {
    const { doc, layer, history } = fixture();
    paintCells(doc, layer, history, tileCells(2, 2), true);
    history.commit();

    expect(layer.cells).toHaveLength(SUBTILE_RESOLUTION * SUBTILE_RESOLUTION);
    expect(history.undo()).toBe(true);
    expect(collisionLayer(doc)!.cells).toEqual([]);
    expect(history.redo()).toBe(true);
    expect(collisionLayer(doc)!.cells).toHaveLength(SUBTILE_RESOLUTION * SUBTILE_RESOLUTION);
  });
});

describe('tileCells', () => {
  it('covers exactly one tile', () => {
    const cells = tileCells(1, 2);
    expect(cells).toHaveLength(SUBTILE_RESOLUTION * SUBTILE_RESOLUTION);
    expect(Math.min(...cells.map((c) => c.cx))).toBe(SUBTILE_RESOLUTION);
    expect(Math.max(...cells.map((c) => c.cy))).toBe(3 * SUBTILE_RESOLUTION - 1);
  });
});

describe('clearCollision', () => {
  it('empties the layer, undoably', () => {
    const { doc, layer, history } = fixture();
    paintCells(doc, layer, history, tileCells(0, 0), true);
    history.commit();

    history.begin('clear');
    clearCollision(layer, history);
    history.commit();

    expect(layer.cells).toEqual([]);
    history.undo();
    expect(collisionLayer(doc)!.cells).toHaveLength(SUBTILE_RESOLUTION * SUBTILE_RESOLUTION);
  });

  it('does nothing to an empty layer', () => {
    const { layer, history } = fixture();
    clearCollision(layer, history);
    history.commit();
    expect(history.undo()).toBe(false);
  });
});

describe('the mask encoding', () => {
  /**
   * **A mask string per tile, not a rectangle per cell.** A cell is 5.33px, so
   * cell-sized rectangles would put repeating fractions in every coordinate of
   * the map file. A tile is a whole number of pixels.
   */
  it('round-trips an arbitrary set of cells', () => {
    const cells = [
      { cx: 0, cy: 0 },
      { cx: 2, cy: 1 },
      { cx: 4, cy: 4 },
      { cx: 29, cy: 17 },
    ];

    const back = cellsToTileMasks(cells).flatMap((m) => tileMaskToCells(m.x, m.y, m.mask));
    expect(new Set(back.map((c) => `${c.cx},${c.cy}`))).toEqual(
      new Set(cells.map((c) => `${c.cx},${c.cy}`)),
    );
  });

  it('writes one entry per tile, however many of its cells are set', () => {
    expect(cellsToTileMasks(tileCells(3, 3))).toHaveLength(1);
    expect(cellsToTileMasks(tileCells(3, 3))[0]).toEqual({ x: 3, y: 3, mask: '#########' });
  });

  it('sorts, so the map file diffs by line rather than by insertion order', () => {
    const masks = cellsToTileMasks([
      { cx: 9, cy: 9 },
      { cx: 0, cy: 0 },
      { cx: 3, cy: 0 },
    ]);
    expect(masks.map((m) => `${m.x},${m.y}`)).toEqual(['0,0', '1,0', '3,3']);
  });

  /**
   * `%` keeps the sign of the dividend, so a cell at cx -1 would land in slot
   * -1 of the tile at x -1 and vanish. Nothing in the editor produces one —
   * `cellInBounds` refuses it — but a hand-edited file can.
   */
  it('normalises a negative cell rather than losing it', () => {
    const masks = cellsToTileMasks([{ cx: -1, cy: -1 }]);
    expect(masks).toHaveLength(1);
    expect(masks[0]!.mask.split('').filter((c) => c === '#')).toHaveLength(1);
  });

  it('ignores a malformed mask rather than throwing', () => {
    expect(tileMaskToCells(0, 0, '')).toEqual([]);
    expect(tileMaskToCells(0, 0, '##')).toEqual([]);
    expect(tileMaskToCells(0, 0, '.........')).toEqual([]);
  });
});

describe('the trip through Tiled JSON', () => {
  it('round-trips painted collision', () => {
    const { doc, layer, history } = fixture();
    paintCells(doc, layer, history, [{ cx: 1, cy: 2 }, { cx: 7, cy: 0 }], true);
    paintCells(doc, layer, history, tileCells(4, 4), true);
    history.commit();

    const back = collisionLayer(deserialize(serialize(doc)).doc)!;
    expect(new Set(back.cells.map((c) => `${c.cx},${c.cy}`))).toEqual(
      new Set(layer.cells.map((c) => `${c.cx},${c.cy}`)),
    );
  });

  it('carries no gid, so its anchoring convention is unambiguous', () => {
    const { doc, layer, history } = fixture();
    paintCells(doc, layer, history, [{ cx: 0, cy: 0 }], true);
    history.commit();

    const objects = serialize(doc).layers.find((l) => l.name === 'collision')!.objects!;
    expect(objects[0]!.gid).toBeUndefined();
    expect(objects[0]!.x).toBe(0);
  });

  it('survives a document with no authored collision', () => {
    const back = deserialize(serialize(createDoc(4, 4))).doc;
    expect(collisionLayer(back)?.cells).toEqual([]);
  });

  it('keeps the three object layers’ ids apart', () => {
    const { doc, layer, history } = fixture();
    paintCells(doc, layer, history, [{ cx: 0, cy: 0 }], true);
    history.commit();

    const ids = serialize(doc).layers.flatMap((l) => (l.objects ?? []).map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
