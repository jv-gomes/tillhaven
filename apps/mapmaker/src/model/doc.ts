/**
 * The editor document.
 *
 * Grid geometry mirrors the farm (`FARM_WIDTH` x `FARM_HEIGHT` in shared
 * config) so an authored map lines up 1:1 with the plot coordinates the
 * database stores. Tile size comes from the shared manifest — nothing here
 * invents a number.
 */

import { FARM_HEIGHT, FARM_WIDTH, TILE_SIZE } from '@tillhaven/shared/config';

/**
 * Default map size, matching the farm grid.
 *
 * Read from shared config rather than written down (T-12.02b): they were
 * literals until the farm grew to 30x22, at which point opening the editor
 * gave you a 20x16 canvas that could not hold the map it was for.
 */
export const DEFAULT_WIDTH = FARM_WIDTH;
export const DEFAULT_HEIGHT = FARM_HEIGHT;

export interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1. Applied at render time only; exported verbatim. */
  opacity: number;
}

export interface TileLayer extends LayerBase {
  kind: 'tile';
  /** Global tile ids, row-major, length = width * height. 0 means empty. */
  data: Int32Array;
}

export interface PlacedObject {
  id: number;
  gid: number;
  /** Top-left in map pixels. Tiled stores tile-objects by their BOTTOM edge;
   *  that conversion happens in io/tiled.ts, not here. */
  px: number;
  py: number;
  w: number;
  h: number;
  name: string;
}

export interface ObjectLayer extends LayerBase {
  kind: 'object';
  objects: PlacedObject[];
}

export interface PlotCell {
  x: number;
  y: number;
}

export interface PlotLayer extends LayerBase {
  kind: 'plots';
  /**
   * ORDER MATTERS: array position is the plot's unlock index, which the economy
   * prices with `plotUnlockCost(index)`. Reordering is a real edit, not cosmetic.
   */
  cells: PlotCell[];
}

export type Layer = TileLayer | ObjectLayer | PlotLayer;

export interface MapDoc {
  width: number;
  height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Bottom-most first, matching Tiled's layer array and draw order. */
  layers: Layer[];
  nextObjectId: number;
}

export const GROUND_LAYER_ID = 'ground';
export const DECOR_LAYER_ID = 'decor';
export const OBJECT_LAYER_ID = 'objects';
export const PLOT_LAYER_ID = 'plots';

export function createDoc(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT): MapDoc {
  return {
    width,
    height,
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    layers: [
      createTileLayer(GROUND_LAYER_ID, 'ground', width, height),
      createTileLayer(DECOR_LAYER_ID, 'decor', width, height),
      { kind: 'object', id: OBJECT_LAYER_ID, name: 'objects', visible: true, opacity: 1, objects: [] },
      { kind: 'plots', id: PLOT_LAYER_ID, name: 'plots', visible: true, opacity: 1, cells: [] },
    ],
    nextObjectId: 1,
  };
}

export function createTileLayer(id: string, name: string, width: number, height: number): TileLayer {
  return {
    kind: 'tile',
    id,
    name,
    visible: true,
    opacity: 1,
    data: new Int32Array(width * height),
  };
}

export function layerById(doc: MapDoc, id: string): Layer | undefined {
  return doc.layers.find((layer) => layer.id === id);
}

export function tileLayers(doc: MapDoc): TileLayer[] {
  return doc.layers.filter((layer): layer is TileLayer => layer.kind === 'tile');
}

export function objectLayer(doc: MapDoc): ObjectLayer | undefined {
  return doc.layers.find((layer): layer is ObjectLayer => layer.kind === 'object');
}

export function plotLayer(doc: MapDoc): PlotLayer | undefined {
  return doc.layers.find((layer): layer is PlotLayer => layer.kind === 'plots');
}

export function inBounds(doc: MapDoc, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}

export function indexOf(doc: MapDoc, x: number, y: number): number {
  return y * doc.width + x;
}

/**
 * Read a tile, treating out-of-bounds as empty rather than wrapping. Every read
 * goes through here so `noUncheckedIndexedAccess` is honoured in one place
 * instead of at forty call sites.
 */
export function tileAt(doc: MapDoc, layer: TileLayer, x: number, y: number): number {
  if (!inBounds(doc, x, y)) return 0;
  return layer.data[indexOf(doc, x, y)] ?? 0;
}

/**
 * Resize preserving the top-left origin. Anything outside the new bounds is
 * dropped — including objects and plots, which would otherwise linger off-map
 * and reappear if the user resized back.
 */
export function resizeDoc(doc: MapDoc, width: number, height: number): void {
  if (width === doc.width && height === doc.height) return;

  for (const layer of doc.layers) {
    if (layer.kind === 'tile') {
      const next = new Int32Array(width * height);
      const copyW = Math.min(width, doc.width);
      const copyH = Math.min(height, doc.height);
      for (let y = 0; y < copyH; y++) {
        for (let x = 0; x < copyW; x++) {
          next[y * width + x] = layer.data[y * doc.width + x] ?? 0;
        }
      }
      layer.data = next;
    } else if (layer.kind === 'object') {
      layer.objects = layer.objects.filter(
        (o) => o.px < width * doc.tileWidth && o.py < height * doc.tileHeight,
      );
    } else {
      layer.cells = layer.cells.filter((c) => c.x < width && c.y < height);
    }
  }

  doc.width = width;
  doc.height = height;
}

export function cloneDoc(doc: MapDoc): MapDoc {
  return {
    width: doc.width,
    height: doc.height,
    tileWidth: doc.tileWidth,
    tileHeight: doc.tileHeight,
    nextObjectId: doc.nextObjectId,
    layers: doc.layers.map((layer): Layer => {
      if (layer.kind === 'tile') return { ...layer, data: Int32Array.from(layer.data) };
      if (layer.kind === 'object') return { ...layer, objects: layer.objects.map((o) => ({ ...o })) };
      return { ...layer, cells: layer.cells.map((c) => ({ ...c })) };
    }),
  };
}
