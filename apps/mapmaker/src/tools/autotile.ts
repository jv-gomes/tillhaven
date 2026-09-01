/**
 * The terrain brush.
 *
 * Painting terrain is a two-step operation: mark the cells as belonging to the
 * terrain, then re-derive the correct edge tile for every cell whose
 * neighbourhood changed — which includes the ring around the painted area, not
 * just the painted cells themselves. Skipping the ring is what leaves seams.
 */

import type { MapDoc, TileLayer } from '../model/doc.js';
import { inBounds, indexOf, tileAt } from '../model/doc.js';
import type { History } from '../model/history.js';
import { toGid, runByKey } from '@tillhaven/shared/config';
import { E, N, S, W, framesOf, frameForRole, roleFor, type TerrainSet } from '../tilesets/terrain.js';

/** Cells the brush has claimed, keyed by map index, for the current operation. */
export type TerrainMask = Set<number>;

function isTerrain(
  doc: MapDoc,
  layer: TileLayer,
  set: TerrainSet,
  frames: Set<number>,
  x: number,
  y: number,
  claimed: TerrainMask,
): boolean {
  if (!inBounds(doc, x, y)) {
    // Treat off-map as "same terrain" so a region painted to the map edge gets
    // a clean fill rather than an edge tile facing nothing.
    return true;
  }
  if (claimed.has(indexOf(doc, x, y))) return true;

  const run = runByKey(set.tilesetKey);
  if (!run) return false;
  const gid = tileAt(doc, layer, x, y);
  if (gid === 0) return false;
  const frame = gid - run.firstgid;
  return frame >= 0 && frame < run.tileCount && frames.has(frame);
}

/**
 * Recompute the tile at (x, y) from its neighbourhood. Only touches cells that
 * belong to the terrain — a neighbour of a different terrain keeps its own tile.
 */
function refresh(
  doc: MapDoc,
  layer: TileLayer,
  history: History,
  set: TerrainSet,
  frames: Set<number>,
  claimed: TerrainMask,
  x: number,
  y: number,
): void {
  if (!inBounds(doc, x, y)) return;
  if (!isTerrain(doc, layer, set, frames, x, y, claimed)) return;

  const same = (dx: number, dy: number): boolean =>
    isTerrain(doc, layer, set, frames, x + dx, y + dy, claimed);

  const mask =
    (same(0, -1) ? N : 0) | (same(1, 0) ? E : 0) | (same(0, 1) ? S : 0) | (same(-1, 0) ? W : 0);

  const role = roleFor(mask, {
    nw: same(-1, -1),
    ne: same(1, -1),
    sw: same(-1, 1),
    se: same(1, 1),
  });

  const frame = frameForRole(set, role);
  if (frame === undefined) return;
  history.setTile(layer, indexOf(doc, x, y), toGid(set.tilesetKey, frame));
}

/**
 * Paint terrain into the given cells and fix up the surrounding ring.
 *
 * `cells` is the set of map indices the user's stroke covered. The caller owns
 * the history batch so a drag is one undo step.
 */
export function paintTerrain(
  doc: MapDoc,
  layer: TileLayer,
  history: History,
  set: TerrainSet,
  cells: Iterable<number>,
): void {
  const frames = framesOf(set);
  const claimed: TerrainMask = new Set(cells);

  // Every claimed cell plus its 8-neighbourhood may need a different tile now.
  const dirty = new Set<number>();
  for (const index of claimed) {
    const x = index % doc.width;
    const y = Math.floor(index / doc.width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (inBounds(doc, nx, ny)) dirty.add(indexOf(doc, nx, ny));
      }
    }
  }

  for (const index of dirty) {
    refresh(doc, layer, history, set, frames, claimed, index % doc.width, Math.floor(index / doc.width));
  }
}

/**
 * Erase terrain from the given cells, then re-derive the ring so the tiles left
 * behind close up their edges instead of pointing at nothing.
 */
export function eraseTerrain(
  doc: MapDoc,
  layer: TileLayer,
  history: History,
  set: TerrainSet,
  cells: Iterable<number>,
): void {
  const frames = framesOf(set);
  const removed = new Set(cells);

  for (const index of removed) {
    history.setTile(layer, index, 0);
  }

  const empty: TerrainMask = new Set();
  for (const index of removed) {
    const x = index % doc.width;
    const y = Math.floor(index / doc.width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        refresh(doc, layer, history, set, frames, empty, x + dx, y + dy);
      }
    }
  }
}
