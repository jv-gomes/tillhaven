/**
 * Plot marking.
 *
 * A plot is a single grid cell the server will create a `plots` row for. The
 * ARRAY ORDER is the unlock order — `plotUnlockCost(index)` in
 * `packages/shared/src/config/economy.ts` prices the nth plot at 250*n^2 — so
 * adding a plot appends, and removing one renumbers everything after it. That
 * renumbering is the point: it keeps the indices dense, which the cost curve
 * assumes.
 */

import { GROUND_FILL, toGid } from '@tillhaven/shared/config';
import type { MapDoc, PlotLayer, TileLayer } from '../model/doc.js';
import { GROUND_LAYER_ID, inBounds, indexOf } from '../model/doc.js';
import type { History } from '../model/history.js';

/**
 * Marking a plot also paints the ground under it, and unmarking un-paints it.
 *
 * **Because a plantable area has to LOOK plantable.** The generator has always
 * stamped `GROUND_FILL.tillable` over the field — the orange band that says
 * "you can hoe here" without claiming anything about whether it has been hoed —
 * and `farmMap.test.ts` pins that the paint and the plot markers match exactly.
 * A plot marked in the editor and not painted would break that invariant the
 * moment anybody saved, and the symptom in the game is a plot sitting on grass:
 * a tile the player can farm with nothing to say so.
 *
 * The previous tile is remembered so removing a plot puts back what was there
 * rather than assuming grass — a plot on a path should leave the path behind.
 */
function paintUnderPlot(
  doc: MapDoc,
  history: History,
  x: number,
  y: number,
  tillable: boolean,
): void {
  const ground = doc.layers.find(
    (l): l is TileLayer => l.kind === 'tile' && l.id === GROUND_LAYER_ID,
  );
  if (!ground) return;

  const index = indexOf(doc, x, y);
  if (tillable) {
    const gid = toGid(GROUND_FILL.tillable.sheet, GROUND_FILL.tillable.frame);
    // Remembered on the layer, not in the history entry: undo restores the tile
    // through `history.setTile` anyway, and a side table would be a second
    // source of truth for the same pixel.
    UNDER_PLOT.set(`${x},${y}`, ground.data[index] ?? 0);
    history.setTile(ground, index, gid);
  } else {
    const previous = UNDER_PLOT.get(`${x},${y}`);
    if (previous !== undefined) {
      history.setTile(ground, index, previous);
      UNDER_PLOT.delete(`${x},${y}`);
    }
  }
}

/**
 * What was under each plot before it was marked, so unmarking can put it back.
 *
 * Session-scoped, deliberately: a plot loaded from a saved map has no
 * "before" — the map IS the before — so removing one leaves the tillable paint
 * for the user to change with the ordinary paint tool. Guessing grass would be
 * wrong wherever the field crosses a path.
 */
const UNDER_PLOT = new Map<string, number>();

export function plotIndexAt(layer: PlotLayer, x: number, y: number): number {
  return layer.cells.findIndex((c) => c.x === x && c.y === y);
}

/** Add the cell if absent, remove it if present. Returns the new index, or -1. */
export function togglePlot(
  doc: MapDoc,
  layer: PlotLayer,
  history: History,
  x: number,
  y: number,
): number {
  if (!inBounds(doc, x, y)) return -1;

  const before = layer.cells;
  const existing = plotIndexAt(layer, x, y);
  const after =
    existing >= 0 ? before.filter((_, i) => i !== existing) : [...before, { x, y }];

  history.recordPlots(layer.id, before, after);
  layer.cells = after;
  paintUnderPlot(doc, history, x, y, existing < 0);
  return existing >= 0 ? -1 : after.length - 1;
}

/** Move a plot to a different position in the unlock order. */
export function reorderPlot(
  layer: PlotLayer,
  history: History,
  from: number,
  to: number,
): void {
  if (from === to) return;
  const before = layer.cells;
  if (from < 0 || from >= before.length || to < 0 || to >= before.length) return;

  const after = [...before];
  const [moved] = after.splice(from, 1);
  if (!moved) return;
  after.splice(to, 0, moved);

  history.recordPlots(layer.id, before, after);
  layer.cells = after;
}

export function clearPlots(layer: PlotLayer, history: History): void {
  if (layer.cells.length === 0) return;
  history.recordPlots(layer.id, layer.cells, []);
  layer.cells = [];
}
