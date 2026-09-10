/**
 * Tiled JSON serialization.
 *
 * The export target is the format Tiled 1.10 writes and Phaser's
 * `load.tilemapTiledJSON` reads, so the game side needs no custom loader and
 * CLAUDE.md §9 ("author tilemaps in Tiled, export JSON, load in Phaser") is
 * satisfied by the artefact even though the authoring tool is ours.
 *
 * Three details are easy to get wrong and each has a test in tiled.test.ts:
 *
 *  1. Tile layer `data` is a plain array of global ids with `encoding` omitted.
 *     Base64+zlib is also valid Tiled, but it makes the file a blob in git; a
 *     plain array diffs line by line.
 *
 *  2. A tile-object (an object carrying a `gid`) is positioned by its BOTTOM
 *     edge in Tiled, not its top. The editor stores top-left, so serialization
 *     adds the height and deserialization subtracts it. Getting this backwards
 *     shifts every tree and house by its own height.
 *
 *  3. Plot markers are plain rectangle objects with NO gid, so their `y` is the
 *     top edge — the opposite convention from (2), in the same file.
 */

import type { AnimCell, CollisionCell, MapDoc, PlacedObject, PlotCell } from '../model/doc.js';
import { createDoc, createTileLayer } from '../model/doc.js';
import {
  ANIM_ID_PROPERTY,
  ANIM_LAYER_NAME,
  ANIM_OBJECT_TYPE,
  COLLISION_LAYER_NAME,
  COLLISION_MASK_PROPERTY,
  COLLISION_OBJECT_TYPE,
  TILESET_RUNS,
  cellsToTileMasks,
  fromGid,
  tileMaskToCells,
} from '@tillhaven/shared/config';

export const TILED_VERSION = '1.10';
export const TILED_EDITOR_VERSION = '1.10.2';

/** Marks a map as ours, so a human reading the JSON knows what wrote it. */
export const GENERATOR = '@tillhaven/mapmaker';

export interface TiledProperty {
  name: string;
  type: 'int' | 'string' | 'bool';
  value: number | string | boolean;
}

export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0;
  visible: boolean;
  gid?: number;
  properties?: TiledProperty[];
}

export interface TiledLayer {
  id: number;
  name: string;
  type: 'tilelayer' | 'objectgroup';
  visible: boolean;
  opacity: number;
  x: 0;
  y: 0;
  width?: number;
  height?: number;
  data?: number[];
  draworder?: 'topdown';
  objects?: TiledObject[];
}

export interface TiledTileset {
  firstgid: number;
  name: string;
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  columns: number;
  tilecount: number;
  margin: 0;
  spacing: 0;
}

export interface TiledMap {
  type: 'map';
  version: string;
  tiledversion: string;
  orientation: 'orthogonal';
  renderorder: 'right-down';
  infinite: false;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  nextlayerid: number;
  nextobjectid: number;
  properties: TiledProperty[];
  tilesets: TiledTileset[];
  layers: TiledLayer[];
}

export const PLOT_LAYER_NAME = 'plots';
export const PLOT_OBJECT_TYPE = 'plot';
// Re-exported rather than redeclared: the names live in shared config because
// the Farm scene reads them too (see `groundAnim.ts` and `collision.ts`).
export { ANIM_LAYER_NAME, ANIM_OBJECT_TYPE, COLLISION_LAYER_NAME, COLLISION_OBJECT_TYPE };

/**
 * Every manifest tileset is embedded, used or not, in a fixed order. That keeps
 * `firstgid` values stable across exports, so editing two tiles produces a
 * two-line diff instead of renumbering the file.
 *
 * Embedded rather than external `.tsx`: Phaser resolves embedded tilesets
 * directly, while external ones need a second fetch and an XML parse for no
 * benefit here.
 */
function tilesets(): TiledTileset[] {
  return TILESET_RUNS.map((run) => ({
    firstgid: run.firstgid,
    name: run.key,
    image: run.path,
    imagewidth: run.imageWidth,
    imageheight: run.imageHeight,
    tilewidth: run.tileWidth,
    tileheight: run.tileHeight,
    columns: run.columns,
    tilecount: run.tileCount,
    margin: 0,
    spacing: 0,
  }));
}

export function serialize(doc: MapDoc): TiledMap {
  const layers: TiledLayer[] = [];
  let layerId = 1;
  let maxObjectId = 0;

  for (const layer of doc.layers) {
    if (layer.kind === 'tile') {
      layers.push({
        id: layerId++,
        name: layer.name,
        type: 'tilelayer',
        visible: layer.visible,
        opacity: layer.opacity,
        x: 0,
        y: 0,
        width: doc.width,
        height: doc.height,
        data: Array.from(layer.data),
      });
    } else if (layer.kind === 'object') {
      const objects = layer.objects.map((o): TiledObject => {
        maxObjectId = Math.max(maxObjectId, o.id);
        return {
          id: o.id,
          name: o.name,
          type: '',
          gid: o.gid,
          x: o.px,
          // Tile-objects are anchored at their bottom edge.
          y: o.py + o.h,
          width: o.w,
          height: o.h,
          rotation: 0,
          visible: true,
        };
      });
      layers.push({
        id: layerId++,
        name: layer.name,
        type: 'objectgroup',
        visible: layer.visible,
        opacity: layer.opacity,
        x: 0,
        y: 0,
        draworder: 'topdown',
        objects,
      });
    } else if (layer.kind === 'collision') {
      /*
       * Authored collision, one rectangle per TILE carrying its nine cells as a
       * mask string.
       *
       * Cell-sized rectangles would put 5.33 repeating in every coordinate of
       * the file; a tile is a whole number of pixels. The mask reads the way
       * every other mask in the codebase reads, so the same eyes work on both.
       */
      const masks = cellsToTileMasks(layer.cells);
      const objects = masks.map((entry, index): TiledObject => {
        const id = 300000 + index;
        maxObjectId = Math.max(maxObjectId, id);
        return {
          id,
          name: COLLISION_OBJECT_TYPE,
          type: COLLISION_OBJECT_TYPE,
          x: entry.x * doc.tileWidth,
          y: entry.y * doc.tileHeight,
          width: doc.tileWidth,
          height: doc.tileHeight,
          rotation: 0,
          visible: true,
          properties: [{ name: COLLISION_MASK_PROPERTY, type: 'string', value: entry.mask }],
        };
      });
      layers.push({
        id: layerId++,
        name: layer.name,
        type: 'objectgroup',
        visible: layer.visible,
        opacity: layer.opacity,
        x: 0,
        y: 0,
        draworder: 'topdown',
        objects,
      });
    } else if (layer.kind === 'anim') {
      /*
       * Animated ground, as plain rectangles carrying an `animId` (the third
       * authored thing, after tiles and plots).
       *
       * Same shape as the plot layer and for the same reason: no gid, so `y` is
       * the TOP edge — the opposite convention from a tile-object, in the same
       * file. What the animation *is* lives in `GROUND_ANIMATIONS`; the map
       * records only where it goes, so re-timing one is a config edit rather
       * than a map regeneration.
       *
       * Ids start above the plot range so the three object layers never collide
       * whatever order they were edited in.
       */
      const objects = layer.cells.map((cell, index): TiledObject => {
        const id = 200000 + index;
        maxObjectId = Math.max(maxObjectId, id);
        return {
          id,
          name: ANIM_OBJECT_TYPE,
          type: ANIM_OBJECT_TYPE,
          x: cell.x * doc.tileWidth,
          y: cell.y * doc.tileHeight,
          width: doc.tileWidth,
          height: doc.tileHeight,
          rotation: 0,
          visible: true,
          properties: [{ name: ANIM_ID_PROPERTY, type: 'string', value: cell.animId }],
        };
      });
      layers.push({
        id: layerId++,
        name: layer.name,
        type: 'objectgroup',
        visible: layer.visible,
        opacity: layer.opacity,
        x: 0,
        y: 0,
        draworder: 'topdown',
        objects,
      });
    } else {
      const objects = layer.cells.map((cell, index): TiledObject => {
        // Plot ids are allocated above the object-layer range so the two layers
        // never collide, whatever order they were edited in.
        const id = 100000 + index;
        maxObjectId = Math.max(maxObjectId, id);
        return {
          id,
          name: PLOT_OBJECT_TYPE,
          type: PLOT_OBJECT_TYPE,
          // Plain rectangle: no gid, so y is the TOP edge.
          x: cell.x * doc.tileWidth,
          y: cell.y * doc.tileHeight,
          width: doc.tileWidth,
          height: doc.tileHeight,
          rotation: 0,
          visible: true,
          properties: [{ name: 'index', type: 'int', value: index }],
        };
      });
      layers.push({
        id: layerId++,
        name: layer.name,
        type: 'objectgroup',
        visible: layer.visible,
        opacity: layer.opacity,
        x: 0,
        y: 0,
        draworder: 'topdown',
        objects,
      });
    }
  }

  return {
    type: 'map',
    version: TILED_VERSION,
    tiledversion: TILED_EDITOR_VERSION,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width: doc.width,
    height: doc.height,
    tilewidth: doc.tileWidth,
    tileheight: doc.tileHeight,
    nextlayerid: layerId,
    nextobjectid: Math.max(maxObjectId + 1, doc.nextObjectId),
    properties: [{ name: 'generator', type: 'string', value: GENERATOR }],
    tilesets: tilesets(),
    layers,
  };
}

function propertyValue(object: TiledObject, name: string): number | string | boolean | undefined {
  return object.properties?.find((p) => p.name === name)?.value;
}

/**
 * Read a Tiled map back into an editor document.
 *
 * Gids are taken at face value: the editor's gid space is derived from the same
 * manifest that produced the file, so a map exported by this editor round-trips
 * exactly. A map whose `tilesets` disagree with the current manifest would need
 * remapping, which is why `deserialize` returns the discrepancy rather than
 * silently rendering the wrong art.
 */
export interface DeserializeResult {
  doc: MapDoc;
  /** Tileset names in the file whose firstgid no longer matches the manifest. */
  warnings: string[];
}

export function deserialize(map: TiledMap): DeserializeResult {
  const warnings: string[] = [];

  for (const ts of map.tilesets) {
    const run = TILESET_RUNS.find((r) => r.key === ts.name);
    if (!run) {
      warnings.push(`Unknown tileset "${ts.name}" — its tiles will render as empty.`);
    } else if (run.firstgid !== ts.firstgid) {
      warnings.push(
        `Tileset "${ts.name}" has firstgid ${ts.firstgid} but the manifest now allocates ${run.firstgid}. Tiles may be wrong.`,
      );
    }
  }

  const doc = createDoc(map.width, map.height);
  doc.layers = [];
  let nextObjectId = 1;

  for (const layer of map.layers) {
    if (layer.type === 'tilelayer') {
      const tile = createTileLayer(layer.name, layer.name, map.width, map.height);
      tile.visible = layer.visible;
      tile.opacity = layer.opacity;
      const data = layer.data ?? [];
      for (let i = 0; i < tile.data.length; i++) {
        tile.data[i] = data[i] ?? 0;
      }
      doc.layers.push(tile);
      continue;
    }

    const objects = layer.objects ?? [];

    /*
     * Named OR typed, like the plot branch below: a hand-renamed layer whose
     * objects still declare their type should still come back as animations.
     */
    const isCollision =
      layer.name === COLLISION_LAYER_NAME ||
      (objects.length > 0 && objects.every((o) => o.type === COLLISION_OBJECT_TYPE));

    if (isCollision) {
      const cells: CollisionCell[] = [];
      for (const o of objects) {
        const mask = propertyValue(o, COLLISION_MASK_PROPERTY);
        if (typeof mask !== 'string') continue;
        cells.push(
          ...tileMaskToCells(
            Math.round(o.x / map.tilewidth),
            Math.round(o.y / map.tileheight),
            mask,
          ),
        );
      }

      doc.layers.push({
        kind: 'collision',
        id: layer.name,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        cells,
      });
      continue;
    }

    const isAnim =
      layer.name === ANIM_LAYER_NAME ||
      (objects.length > 0 && objects.every((o) => o.type === ANIM_OBJECT_TYPE));

    if (isAnim) {
      const cells: AnimCell[] = [];
      for (const o of objects) {
        const animId = propertyValue(o, ANIM_ID_PROPERTY);
        // A placement with no id names no animation and would draw nothing.
        // Dropping it is better than carrying an empty cell that looks placed.
        if (typeof animId !== 'string' || animId === '') continue;
        cells.push({
          x: Math.round(o.x / map.tilewidth),
          y: Math.round(o.y / map.tileheight),
          animId,
        });
      }

      doc.layers.push({
        kind: 'anim',
        id: layer.name,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        cells,
      });
      continue;
    }

    const isPlots =
      layer.name === PLOT_LAYER_NAME ||
      (objects.length > 0 && objects.every((o) => o.type === PLOT_OBJECT_TYPE));

    if (isPlots) {
      // Order by the stored index, not array position, so a hand-edited file
      // with reordered objects still yields the intended unlock sequence.
      const cells: PlotCell[] = objects
        .map((o) => ({
          index: Number(propertyValue(o, 'index') ?? 0),
          cell: {
            x: Math.round(o.x / map.tilewidth),
            y: Math.round(o.y / map.tileheight),
          },
        }))
        .sort((a, b) => a.index - b.index)
        .map((entry) => entry.cell);

      doc.layers.push({
        kind: 'plots',
        id: layer.name,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        cells,
      });
      continue;
    }

    const placed: PlacedObject[] = [];
    for (const o of objects) {
      if (o.gid === undefined) continue;
      const loc = fromGid(o.gid);
      const w = o.width || loc?.run.tileWidth || map.tilewidth;
      const h = o.height || loc?.run.tileHeight || map.tileheight;
      nextObjectId = Math.max(nextObjectId, o.id + 1);
      placed.push({
        id: o.id,
        gid: o.gid,
        px: o.x,
        // Undo the bottom-edge anchoring applied on the way out.
        py: o.y - h,
        w,
        h,
        name: o.name,
      });
    }

    doc.layers.push({
      kind: 'object',
      id: layer.name,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      objects: placed,
    });
  }

  doc.nextObjectId = nextObjectId;
  return { doc, warnings };
}
