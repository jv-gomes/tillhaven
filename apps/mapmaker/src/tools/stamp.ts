/**
 * A stamp is the unit every tile-painting tool works with.
 *
 * A single palette click makes a 1x1 stamp; a marquee drag over the palette (or
 * over the map, to copy) makes a WxH one. Paint, rectangle fill and flood fill
 * then all reduce to "write this stamp at this cell", which keeps the tools
 * from each growing their own copy of the same loop.
 */

import type { MapDoc, TileLayer } from '../model/doc.js';
import { inBounds, indexOf } from '../model/doc.js';
import type { History } from '../model/history.js';

export interface Stamp {
  readonly w: number;
  readonly h: number;
  /** Global tile ids, row-major, length w*h. 0 means "leave untouched". */
  readonly gids: readonly number[];
}

export const EMPTY_STAMP: Stamp = { w: 1, h: 1, gids: [0] };

export function singleStamp(gid: number): Stamp {
  return { w: 1, h: 1, gids: [gid] };
}

/**
 * True when the stamp would write nothing.
 *
 * A fresh editor has no palette selection, so painting with it is a silent
 * no-op — which reads as the tool being broken. Callers use this to say so.
 */
export function isEmptyStamp(stamp: Stamp): boolean {
  return stamp.gids.every((gid) => gid === 0);
}

export function stampAt(stamp: Stamp, sx: number, sy: number): number {
  return stamp.gids[sy * stamp.w + sx] ?? 0;
}

/**
 * Write a stamp with its top-left at (x, y).
 *
 * `eraseZeros` distinguishes the two things a 0 in a stamp can mean: when
 * painting a multi-tile stamp copied from the map, a 0 is a hole that should
 * leave whatever is underneath alone; when erasing, a 0 is the value to write.
 */
export function applyStamp(
  doc: MapDoc,
  layer: TileLayer,
  history: History,
  stamp: Stamp,
  x: number,
  y: number,
  eraseZeros = false,
): boolean {
  let changed = false;
  for (let sy = 0; sy < stamp.h; sy++) {
    for (let sx = 0; sx < stamp.w; sx++) {
      const gid = stampAt(stamp, sx, sy);
      if (gid === 0 && !eraseZeros) continue;
      const tx = x + sx;
      const ty = y + sy;
      if (!inBounds(doc, tx, ty)) continue;
      if (history.setTile(layer, indexOf(doc, tx, ty), gid)) changed = true;
    }
  }
  return changed;
}

/** Copy a rectangle of the map into a stamp, for the "pick up what is there" flow. */
export function stampFromLayer(
  doc: MapDoc,
  layer: TileLayer,
  x: number,
  y: number,
  w: number,
  h: number,
): Stamp {
  const gids: number[] = [];
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const tx = x + sx;
      const ty = y + sy;
      gids.push(inBounds(doc, tx, ty) ? (layer.data[indexOf(doc, tx, ty)] ?? 0) : 0);
    }
  }
  return { w, h, gids };
}
