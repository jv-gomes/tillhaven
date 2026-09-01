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

import type { MapDoc, PlotLayer } from '../model/doc.js';
import { inBounds } from '../model/doc.js';
import type { History } from '../model/history.js';

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
