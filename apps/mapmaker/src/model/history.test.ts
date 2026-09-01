import { describe, expect, it } from 'vitest';
import { createDoc, objectLayer, plotLayer, type MapDoc, type TileLayer } from './doc.js';
import { History } from './history.js';
import { toGid } from '@tillhaven/shared/config';
import { placeObject } from '../tools/objects.js';
import { togglePlot } from '../tools/plots.js';

function setup(): { doc: MapDoc; layer: TileLayer; history: History } {
  const doc = createDoc(6, 4);
  const layer = doc.layers[0];
  if (layer?.kind !== 'tile') throw new Error('expected a tile layer first');
  return { doc, layer, history: new History(doc) };
}

describe('tile history', () => {
  it('undoes and redoes a stroke as one step', () => {
    const { layer, history } = setup();

    history.begin('paint');
    history.setTile(layer, 0, 11);
    history.setTile(layer, 1, 11);
    history.setTile(layer, 2, 11);
    history.commit();

    expect(Array.from(layer.data.slice(0, 3))).toEqual([11, 11, 11]);
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(Array.from(layer.data.slice(0, 3))).toEqual([0, 0, 0]);

    history.redo();
    expect(Array.from(layer.data.slice(0, 3))).toEqual([11, 11, 11]);
  });

  it('restores the pre-stroke value when a cell is painted twice in one stroke', () => {
    // Dragging back over a cell must not make its "before" value the mid-stroke one.
    const { layer, history } = setup();
    layer.data[0] = 3;

    history.begin('paint');
    history.setTile(layer, 0, 7);
    history.setTile(layer, 0, 9);
    history.commit();

    expect(layer.data[0]).toBe(9);
    history.undo();
    expect(layer.data[0]).toBe(3);
  });

  it('reports a no-op write so callers can skip a redraw', () => {
    const { layer, history } = setup();
    layer.data[4] = 5;
    history.begin('paint');
    expect(history.setTile(layer, 4, 5)).toBe(false);
    expect(history.setTile(layer, 4, 6)).toBe(true);
    history.commit();
  });

  it('discards an empty batch rather than consuming an undo slot', () => {
    const { history } = setup();
    history.begin('nothing');
    history.commit();
    expect(history.canUndo).toBe(false);
  });

  it('clears the redo stack once a new edit lands', () => {
    const { layer, history } = setup();

    history.begin('a');
    history.setTile(layer, 0, 1);
    history.commit();
    history.undo();
    expect(history.canRedo).toBe(true);

    history.begin('b');
    history.setTile(layer, 1, 2);
    history.commit();
    expect(history.canRedo).toBe(false);
  });

  it('caps the stack so long sessions cannot grow without bound', () => {
    const { layer, history } = setup();
    for (let i = 0; i < 150; i++) {
      history.begin(`edit-${i}`);
      history.setTile(layer, 0, i + 1);
      history.commit();
    }
    let undone = 0;
    while (history.undo()) undone++;
    expect(undone).toBe(100);
  });

  it('ignores writes made outside a batch, but still applies them', () => {
    const { layer, history } = setup();
    history.setTile(layer, 0, 42);
    expect(layer.data[0]).toBe(42);
    expect(history.canUndo).toBe(false);
  });
});

describe('object and plot history', () => {
  it('undoes an object placement', () => {
    const doc = createDoc();
    const history = new History(doc);
    const layer = objectLayer(doc);
    expect(layer).toBeDefined();
    if (!layer) return;

    history.begin('place');
    placeObject(doc, layer, history, toGid('obj-maple-tree', 2), 3, 3, 'obj-maple-tree');
    history.commit();
    expect(layer.objects).toHaveLength(1);

    history.undo();
    expect(objectLayer(doc)?.objects).toHaveLength(0);
    history.redo();
    expect(objectLayer(doc)?.objects).toHaveLength(1);
  });

  it('undoes plot toggles, preserving unlock order', () => {
    const doc = createDoc();
    const history = new History(doc);
    const layer = plotLayer(doc);
    expect(layer).toBeDefined();
    if (!layer) return;

    history.begin('plots');
    togglePlot(doc, layer, history, 1, 1);
    togglePlot(doc, layer, history, 2, 1);
    history.commit();
    expect(plotLayer(doc)?.cells).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);

    history.undo();
    expect(plotLayer(doc)?.cells).toEqual([]);
    history.redo();
    expect(plotLayer(doc)?.cells).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
  });
});
