/**
 * Global tile id ("gid") allocation, and the authored tilemaps.
 *
 * Tiled numbers tiles in one flat space across every tileset a map uses: gid 0
 * means empty, and each tileset claims a contiguous run starting at its
 * `firstgid`. The map editor stores gids in that same space internally, so
 * exporting a tile layer is a straight copy with no remapping step to get wrong.
 *
 * The runs are allocated by walking the asset manifest in its declared order
 * and giving EVERY sheet a slot, used or not. That is deliberate: a
 * deterministic firstgid means re-exporting a map after editing two tiles
 * produces a two-line git diff instead of renumbering the whole file.
 *
 * This lives in `packages/shared` because BOTH sides need it and must agree
 * exactly (CLAUDE.md §10): `apps/mapmaker` writes gids into the map, and
 * `apps/client` reads them back to place objects. Two implementations of this
 * numbering would be two chances to disagree.
 */

import { SHEETS, IMAGES, type SheetSpec, type ImageSpec } from './assets.js';

/** Where exported tilemaps live under the client's public root. */
export const TILEMAP_BASE = '/tilemaps' as const;

export interface TilemapSpec {
  readonly key: string;
  readonly path: string;
}

/**
 * The farm map, authored in `apps/mapmaker` and exported as Tiled JSON.
 * Loaded with `load.tilemapTiledJSON` — nothing references the path directly.
 */
export const FARM_MAP: TilemapSpec = {
  key: 'farm-map',
  path: `${TILEMAP_BASE}/farm.json`,
};

export const TILEMAPS = [FARM_MAP] as const satisfies readonly TilemapSpec[];

/**
 * Farm grid size in tiles.
 *
 * Shared rather than server-only because three things must agree on it: the
 * server stamps it onto every new farm row, the client renders against it, and
 * the authored map in `apps/mapmaker` is this size. It used to live in
 * `apps/server/src/modules/farm/layout.ts` where the client could not see it.
 *
 * Changing these does NOT resize `farm.json` — re-author the map to match.
 *
 * **Grew from 20x16 in T-12.02b, because the buildings did.** The Deluxe coop
 * is 9x8 tiles and the Deluxe barn 8x8, and on the old map neither had a
 * single anchor where its footprint landed on free ground. The extra land is
 * all east (x >= 20) and south (y >= 16), so `PLOT_POSITIONS` did not move —
 * an existing farm's plot rows still name the tiles they always did, and only
 * `farms.width`/`height` (which nothing reads back) go stale.
 */
export const FARM_WIDTH = 30;
export const FARM_HEIGHT = 22;

export interface TilesetRun {
  readonly key: string;
  readonly path: string;
  /** First gid belonging to this tileset. Never 0 — that is reserved for empty. */
  readonly firstgid: number;
  readonly tileCount: number;
  readonly columns: number;
  readonly rows: number;
  /** Frame size, px. Tiled calls these tilewidth/tileheight. */
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Source image size, px. */
  readonly imageWidth: number;
  readonly imageHeight: number;
}

function runFromSheet(spec: SheetSpec, firstgid: number): TilesetRun {
  return {
    key: spec.key,
    path: spec.path,
    firstgid,
    tileCount: spec.cols * spec.rows,
    columns: spec.cols,
    rows: spec.rows,
    tileWidth: spec.frameWidth,
    tileHeight: spec.frameHeight,
    imageWidth: spec.width,
    imageHeight: spec.height,
  };
}

/** A single-image asset is just a 1x1 tileset. Treating it uniformly keeps the
 *  object layer from needing a second code path for `chest`. */
function runFromImage(spec: ImageSpec, firstgid: number): TilesetRun {
  return {
    key: spec.key,
    path: spec.path,
    firstgid,
    tileCount: 1,
    columns: 1,
    rows: 1,
    tileWidth: spec.width,
    tileHeight: spec.height,
    imageWidth: spec.width,
    imageHeight: spec.height,
  };
}

function allocate(): TilesetRun[] {
  const runs: TilesetRun[] = [];
  let next = 1;
  for (const sheet of SHEETS) {
    const run = runFromSheet(sheet, next);
    runs.push(run);
    next += run.tileCount;
  }
  for (const image of IMAGES) {
    const run = runFromImage(image, next);
    runs.push(run);
    next += run.tileCount;
  }
  return runs;
}

/** Every tileset the editor knows about, in manifest order. */
export const TILESET_RUNS: readonly TilesetRun[] = allocate();

const BY_KEY = new Map(TILESET_RUNS.map((run) => [run.key, run]));

export function runByKey(key: string): TilesetRun | undefined {
  return BY_KEY.get(key);
}

/** Convert a frame index within a sheet to a global tile id. */
export function toGid(key: string, frame: number): number {
  const run = BY_KEY.get(key);
  if (!run) throw new Error(`Unknown tileset key: ${key}`);
  if (frame < 0 || frame >= run.tileCount) {
    throw new Error(`Frame ${frame} out of range for ${key} (0..${run.tileCount - 1})`);
  }
  return run.firstgid + frame;
}

export interface GidLocation {
  readonly run: TilesetRun;
  /** Frame index within that tileset. */
  readonly frame: number;
}

/**
 * Resolve a gid back to its tileset and frame. Returns undefined for gid 0
 * (empty) and for any gid outside every allocated run — the caller decides
 * whether that is a skip or an error, because an imported map may legitimately
 * carry a gid from a tileset that has since been removed from the manifest.
 */
export function fromGid(gid: number): GidLocation | undefined {
  if (gid <= 0) return undefined;
  for (let i = TILESET_RUNS.length - 1; i >= 0; i--) {
    const run = TILESET_RUNS[i];
    if (run && gid >= run.firstgid) {
      const frame = gid - run.firstgid;
      return frame < run.tileCount ? { run, frame } : undefined;
    }
  }
  return undefined;
}
