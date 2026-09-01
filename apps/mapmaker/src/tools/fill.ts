/**
 * Rectangle fill and flood fill.
 *
 * Both are stamp-tiled rather than single-tile: filling a region with a 2x2
 * stamp repeats it across the region aligned to the region's own origin, which
 * is what makes stamps useful for paths and fences.
 */

import type { MapDoc, TileLayer } from '../model/doc.js';
import { inBounds, indexOf, tileAt } from '../model/doc.js';
import type { History } from '../model/history.js';
import { stampAt, type Stamp } from './stamp.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalise a drag (which can run in any direction) into a positive rect. */
export function rectFromDrag(x0: number, y0: number, x1: number, y1: number): Rect {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

export function fillRect(
  doc: MapDoc,
  layer: TileLayer,
  history: History,
  stamp: Stamp,
  rect: Rect,
): boolean {
  let changed = false;
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const tx = rect.x + dx;
      const ty = rect.y + dy;
      if (!inBounds(doc, tx, ty)) continue;
      const gid = stampAt(stamp, dx % stamp.w, dy % stamp.h);
      if (history.setTile(layer, indexOf(doc, tx, ty), gid)) changed = true;
    }
  }
  return changed;
}

/**
 * Flood fill the contiguous 4-connected region matching the tile under (x, y).
 *
 * Two things make this terminate, and both are load-bearing:
 *  - a `seen` set, so a cell is queued at most once
 *  - an early return when the region's tile already equals what a 1x1 stamp
 *    would write, which is the classic "fill blue with blue" infinite loop
 *
 * The stamp is sampled in MAP space (`tx % stamp.w`), not region space, so a
 * multi-tile stamp tiles seamlessly across separate fills of adjacent regions.
 */
export function floodFill(
  doc: MapDoc,
  layer: TileLayer,
  history: History,
  stamp: Stamp,
  x: number,
  y: number,
): boolean {
  if (!inBounds(doc, x, y)) return false;

  const target = tileAt(doc, layer, x, y);
  if (stamp.w === 1 && stamp.h === 1 && stampAt(stamp, 0, 0) === target) return false;

  const seen = new Set<number>([indexOf(doc, x, y)]);
  const queue: Array<[number, number]> = [[x, y]];
  let changed = false;

  while (queue.length > 0) {
    const cell = queue.pop();
    if (!cell) break;
    const [cx, cy] = cell;

    const gid = stampAt(stamp, ((cx % stamp.w) + stamp.w) % stamp.w, ((cy % stamp.h) + stamp.h) % stamp.h);
    if (history.setTile(layer, indexOf(doc, cx, cy), gid)) changed = true;

    const neighbours: Array<[number, number]> = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of neighbours) {
      if (!inBounds(doc, nx, ny)) continue;
      const key = indexOf(doc, nx, ny);
      if (seen.has(key)) continue;
      if (tileAt(doc, layer, nx, ny) !== target) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }

  return changed;
}
