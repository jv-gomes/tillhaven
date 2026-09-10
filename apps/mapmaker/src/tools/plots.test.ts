import { describe, expect, it } from 'vitest';
import { GROUND_FILL, toGid } from '@tillhaven/shared/config';
import {
  GROUND_LAYER_ID,
  createDoc,
  indexOf,
  plotLayer,
  type MapDoc,
  type TileLayer,
} from '../model/doc.js';
import { History } from '../model/history.js';
import { togglePlot } from './plots.js';

/**
 * Marking a plot, and the ground under it.
 *
 * The unlock-order rules are pinned in `io/farmMap.test.ts` against the shipped
 * map. What is worth testing here is the coupling that is easy to forget: a
 * plantable area has to LOOK plantable, or the game shows a tile the player can
 * farm with nothing to say so.
 */

function fixture(): { doc: MapDoc; ground: TileLayer; history: History } {
  const doc = createDoc(8, 6);
  const ground = doc.layers.find(
    (l): l is TileLayer => l.kind === 'tile' && l.id === GROUND_LAYER_ID,
  )!;
  const history = new History(doc);
  history.begin('test');
  return { doc, ground, history };
}

const TILLABLE = toGid(GROUND_FILL.tillable.sheet, GROUND_FILL.tillable.frame);
const GRASS = toGid(GROUND_FILL.grass.sheet, GROUND_FILL.grass.frame);

describe('marking a plot paints the ground under it', () => {
  it('stamps the tillable fill', () => {
    const { doc, ground, history } = fixture();
    const layer = plotLayer(doc)!;

    togglePlot(doc, layer, history, 3, 2);
    expect(ground.data[indexOf(doc, 3, 2)]).toBe(TILLABLE);
  });

  /**
   * **Puts back what was there, not grass.** A field that crosses a path should
   * leave the path behind when a plot is removed; assuming grass would quietly
   * erase authored ground.
   */
  it('restores the previous tile when the plot is removed', () => {
    const { doc, ground, history } = fixture();
    const layer = plotLayer(doc)!;
    const path = toGid(GROUND_FILL.path.sheet, GROUND_FILL.path.frame);
    history.setTile(ground, indexOf(doc, 1, 1), path);

    togglePlot(doc, layer, history, 1, 1);
    expect(ground.data[indexOf(doc, 1, 1)]).toBe(TILLABLE);

    togglePlot(doc, layer, history, 1, 1);
    expect(ground.data[indexOf(doc, 1, 1)]).toBe(path);
  });

  it('leaves the ground alone for a cell outside the map', () => {
    const { doc, ground, history } = fixture();
    const layer = plotLayer(doc)!;
    const before = Array.from(ground.data);

    expect(togglePlot(doc, layer, history, 99, 99)).toBe(-1);
    expect(Array.from(ground.data)).toEqual(before);
  });

  it('undoes the marker and the paint together', () => {
    const { doc, ground, history } = fixture();
    const layer = plotLayer(doc)!;
    history.setTile(ground, indexOf(doc, 2, 2), GRASS);
    history.commit();

    history.begin('mark');
    togglePlot(doc, layer, history, 2, 2);
    history.commit();

    expect(history.undo()).toBe(true);
    expect(plotLayer(doc)!.cells).toEqual([]);
    expect(ground.data[indexOf(doc, 2, 2)]).toBe(GRASS);
  });

  /**
   * The invariant `farmMap.test.ts` pins against the shipped map, asserted here
   * against editor gestures — the generator is not the only thing that writes a
   * map any more.
   */
  it('keeps the paint and the markers in step across a series of edits', () => {
    const { doc, ground, history } = fixture();
    const layer = plotLayer(doc)!;

    for (const [x, y] of [[1, 1], [2, 1], [3, 1], [2, 2]] as const) {
      togglePlot(doc, layer, history, x, y);
    }
    togglePlot(doc, layer, history, 2, 1);

    const painted = new Set<string>();
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        if (ground.data[indexOf(doc, x, y)] === TILLABLE) painted.add(`${x},${y}`);
      }
    }

    expect(painted).toEqual(new Set(layer.cells.map((c) => `${c.x},${c.y}`)));
  });
});
