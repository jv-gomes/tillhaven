/**
 * Object-layer editing: place, hit-test, move and delete free-positioned sprites.
 *
 * Objects are not grid-locked the way tiles are — a maple tree is 32x48 and a
 * house spans several cells — but they snap to the tile grid by default because
 * hand-nudging pixel offsets on a 16px pixel-art map produces misalignment that
 * is invisible in the editor and obvious in the game.
 */

import type { MapDoc, ObjectLayer, PlacedObject } from '../model/doc.js';
import type { History } from '../model/history.js';
import { fromGid } from '@tillhaven/shared/config';

export function objectAt(layer: ObjectLayer, px: number, py: number): PlacedObject | undefined {
  // Topmost first: later objects draw over earlier ones, so they win the click.
  for (let i = layer.objects.length - 1; i >= 0; i--) {
    const o = layer.objects[i];
    if (!o) continue;
    if (px >= o.px && px < o.px + o.w && py >= o.py && py < o.py + o.h) return o;
  }
  return undefined;
}

/**
 * Place an object with its BOTTOM-LEFT on the given tile.
 *
 * Bottom-anchoring is deliberate: tall sprites (trees, houses, crops) are drawn
 * standing on the tile the user clicked, which is how they read in the game.
 * Top-anchoring would make a 48px tree appear two tiles above the cursor.
 */
export function placeObject(
  doc: MapDoc,
  layer: ObjectLayer,
  history: History,
  gid: number,
  tileX: number,
  tileY: number,
  name: string,
): PlacedObject | undefined {
  const loc = fromGid(gid);
  if (!loc) return undefined;

  const w = loc.run.tileWidth;
  const h = loc.run.tileHeight;
  const before = layer.objects;
  const object: PlacedObject = {
    id: doc.nextObjectId++,
    gid,
    px: tileX * doc.tileWidth,
    py: (tileY + 1) * doc.tileHeight - h,
    w,
    h,
    name,
  };

  const after = [...before, object];
  history.recordObjects(layer.id, before, after);
  layer.objects = after;
  return object;
}

export function moveObject(
  layer: ObjectLayer,
  history: History,
  id: number,
  px: number,
  py: number,
): void {
  const before = layer.objects;
  const after = before.map((o) => (o.id === id ? { ...o, px, py } : o));
  history.recordObjects(layer.id, before, after);
  layer.objects = after;
}

export function deleteObject(layer: ObjectLayer, history: History, id: number): void {
  const before = layer.objects;
  const after = before.filter((o) => o.id !== id);
  if (after.length === before.length) return;
  history.recordObjects(layer.id, before, after);
  layer.objects = after;
}

/** Snap a pixel position to the tile grid, keeping the object bottom-aligned. */
export function snapToGrid(doc: MapDoc, object: PlacedObject, px: number, py: number): {
  px: number;
  py: number;
} {
  const snappedX = Math.round(px / doc.tileWidth) * doc.tileWidth;
  const bottom = py + object.h;
  const snappedBottom = Math.round(bottom / doc.tileHeight) * doc.tileHeight;
  return { px: snappedX, py: snappedBottom - object.h };
}
