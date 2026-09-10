/**
 * Painting collision.
 *
 * **Cells, not tiles**, at `SUBTILE_RESOLUTION` per tile on each axis — the same
 * grid the game collides on, so what is painted here is exactly what stops the
 * character. That is the point: a tile-grained brush could only ever draw the
 * shapes the map already had.
 *
 * **Additive to the art's own collision, never a replacement.** Building
 * silhouettes and terrain masks are properties of the ART and stay in
 * `collision.ts`; this is for the shapes the art cannot express because they
 * are not about the art — a fenced-off corner, a gap the player should not fit
 * through, a ledge that reads as walkable and is not.
 *
 * **The set is the state and the stroke is the edit.** A drag records one
 * whole-list undo entry rather than one per cell, so a painted outline comes
 * back in one Ctrl+Z instead of forty.
 */

import { SUBTILE_RESOLUTION } from '@tillhaven/shared/config';
import type { CollisionCell, CollisionLayer, MapDoc } from '../model/doc.js';
import type { History } from '../model/history.js';

const key = (cx: number, cy: number): string => `${cx},${cy}`;

/** Is this collision cell painted solid? */
export function isSolidCell(layer: CollisionLayer, cx: number, cy: number): boolean {
  return layer.cells.some((c) => c.cx === cx && c.cy === cy);
}

/**
 * Cells are bounded by the map, in the finer grid.
 *
 * Written out rather than reusing `inBounds`, which takes tile coordinates —
 * passing a cell to it would accept everything in the left third of the map and
 * reject the rest, which is the kind of wrong that looks like the brush
 * "stopping working" two thirds of the way across.
 */
export function cellInBounds(doc: MapDoc, cx: number, cy: number): boolean {
  return (
    cx >= 0 &&
    cy >= 0 &&
    cx < doc.width * SUBTILE_RESOLUTION &&
    cy < doc.height * SUBTILE_RESOLUTION
  );
}

/**
 * Paints or erases a set of cells in one edit.
 *
 * Takes a list rather than one cell so a whole drag — or a whole tile's nine
 * cells — is a single undo step. Returns true if anything changed, so a stroke
 * that painted over what was already solid consumes no undo slot.
 */
export function paintCells(
  doc: MapDoc,
  layer: CollisionLayer,
  history: History,
  cells: Iterable<{ cx: number; cy: number }>,
  solid: boolean,
): boolean {
  const before = layer.cells;
  const present = new Set(before.map((c) => key(c.cx, c.cy)));
  const next = new Map(before.map((c) => [key(c.cx, c.cy), c] as const));
  let changed = false;

  for (const cell of cells) {
    if (!cellInBounds(doc, cell.cx, cell.cy)) continue;
    const k = key(cell.cx, cell.cy);

    if (solid && !present.has(k)) {
      next.set(k, { cx: cell.cx, cy: cell.cy });
      changed = true;
    } else if (!solid && present.has(k)) {
      next.delete(k);
      changed = true;
    }
  }

  if (!changed) return false;

  const after = [...next.values()];
  history.recordCollision(layer.id, before, after);
  layer.cells = after;
  return true;
}

/** Every cell of one whole tile, for the shift-click "block this tile" gesture. */
export function tileCells(tileX: number, tileY: number): CollisionCell[] {
  const cells: CollisionCell[] = [];
  for (let dy = 0; dy < SUBTILE_RESOLUTION; dy++) {
    for (let dx = 0; dx < SUBTILE_RESOLUTION; dx++) {
      cells.push({
        cx: tileX * SUBTILE_RESOLUTION + dx,
        cy: tileY * SUBTILE_RESOLUTION + dy,
      });
    }
  }
  return cells;
}

export function clearCollision(layer: CollisionLayer, history: History): void {
  if (layer.cells.length === 0) return;
  history.recordCollision(layer.id, layer.cells, []);
  layer.cells = [];
}
