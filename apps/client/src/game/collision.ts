import {
  FARM_HEIGHT,
  FARM_WIDTH,
  OBJ_COLLISION_BASE,
  COLLISION_CELL,
  PLAYER_COLLIDER,
  SUBTILE_RESOLUTION,
  TILE_SIZE,
  maskToCells,
  objectFootprint,
  pixelRectToCells,
  terrainMask,
  tileToCells,
  tilesToCells,
  type CellPoint,
  type PixelRect,
  type TileFootprint,
  type TilePoint,
} from '@tillhaven/shared/config';
import type { Blocked, World } from './entities/movement.js';

/**
 * Which CELLS the player cannot walk into.
 *
 * **Cells, not tiles, since sub-tile collision landed.** The grid is three
 * times finer than the gameplay grid on each axis (`SUBTILE_RESOLUTION`), so a
 * building's measured silhouette reaches the player instead of being rounded
 * back to a rectangle first. Everything below deals in `CellPoint`; the
 * gameplay grid — plots, the faced tile, footprints — stays on `TilePoint` and
 * the two are structurally incompatible so they cannot be crossed by accident.
 *
 * Pure and Phaser-free, beside `plots.ts` and for the same reason: what counts
 * as solid is a set of rules about the farm, and rules are worth proving
 * without standing up a canvas.
 *
 * **Layered rather than one flat set**, because the sources update on different
 * clocks and a rebuild must not lose the others. Terrain and map objects are
 * fixed once the map loads; buildings change when a tier is bought; animals
 * change as they are acquired; decor changes on every placement. A single set
 * would have to be recomputed wholesale from all five every time any one of
 * them moved, and would silently drop a layer whose source had not been
 * consulted that frame.
 *
 * Nothing here is server authority. Collision is a client-side UX gate (§4.1,
 * §5.1) — the server never learns where the player is standing.
 */

/**
 * Where a solid tile came from.
 *
 * Named rather than anonymous so a rebuild can replace exactly one source, and
 * so a debug overlay can say *why* a tile is solid.
 */
export type BlockLayerId = 'terrain' | 'objects' | 'buildings' | 'animals' | 'decor';

const cellKey = (cx: number, cy: number): string => `${cx},${cy}`;

export class BlockMap {
  private readonly layers = new Map<BlockLayerId, ReadonlySet<string>>();

  /**
   * The flattened union, rebuilt on `set()` rather than recomputed per query.
   *
   * `has()` runs a few times per frame per axis; `set()` runs on a poll. Paying
   * on the rare path is the right trade, and it keeps `has()` a single Set
   * lookup no matter how many layers exist.
   */
  private union: Set<string> = new Set();

  /** Replace one layer wholesale. Absent cells in that layer become walkable. */
  set(layer: BlockLayerId, cells: Iterable<CellPoint>): void {
    const next = new Set<string>();
    for (const cell of cells) next.add(cellKey(cell.cx, cell.cy));
    this.layers.set(layer, next);
    this.rebuild();
  }

  /** Drop a layer entirely — equivalent to `set(layer, [])`, but says so. */
  clear(layer: BlockLayerId): void {
    this.layers.delete(layer);
    this.rebuild();
  }

  has(cellX: number, cellY: number): boolean {
    return this.union.has(cellKey(cellX, cellY));
  }

  /** Which layers make a cell solid. For debugging and for error messages. */
  reasons(cellX: number, cellY: number): BlockLayerId[] {
    const key = cellKey(cellX, cellY);
    const found: BlockLayerId[] = [];
    for (const [id, tiles] of this.layers) if (tiles.has(key)) found.push(id);
    return found;
  }

  get size(): number {
    return this.union.size;
  }

  /**
   * Bound to the instance, ready to hand to `step()`.
   *
   * A property rather than a method so callers cannot accidentally pass an
   * unbound `map.has` and get a `this`-less crash at 60fps.
   */
  readonly blocked: Blocked = (x, y) => this.has(x, y);

  /**
   * True if ANY cell of a whole tile is solid.
   *
   * For the callers that still think in tiles — the debug overlay, and any
   * check that wants "is there something in this tile at all". Deliberately
   * `any`, not `all`: a tile with one solid cell is a tile you cannot walk
   * freely across, and reporting it as clear would make the overlay lie.
   */
  hasInTile(tileX: number, tileY: number): boolean {
    return tileToCells({ x: tileX, y: tileY }).some((c) => this.has(c.cx, c.cy));
  }

  private rebuild(): void {
    const union = new Set<string>();
    for (const tiles of this.layers.values()) for (const key of tiles) union.add(key);
    this.union = union;
  }
}

/* ------------------------------------------------------------------ *
 * Layer builders
 * ------------------------------------------------------------------ */

/** Every tile of a footprint, inclusive on both ends like `TileFootprint` is. */
export function footprintTiles(box: TileFootprint): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) tiles.push({ x, y });
  }
  return tiles;
}

/** Every tile of every footprint, flattened. */
export function footprintsTiles(boxes: Iterable<TileFootprint>): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (const box of boxes) tiles.push(...footprintTiles(box));
  return tiles;
}

/**
 * A map object placed on the farm, as the scene knows it.
 *
 * `anchorPx` is the object's BOTTOM-LEFT corner in world pixels — Tiled's
 * convention for a tile-object, and the one `buildMapObjects` already draws
 * with.
 */
export interface PlacedObject {
  readonly key: string;
  readonly anchorPx: { readonly x: number; readonly y: number };
}

/**
 * Solid cells for map objects, from their MEASURED footing (T-15.04).
 *
 * **The measurement now survives.** `OBJ_COLLISION_BASE` records each footing
 * in PIXELS and `objectFootprint` rounded it outwards to whole tiles, so the
 * chest's 15px base blocked two full cells and the mailbox blocked a tile it
 * barely touched. At 5.33px cells the footing lands close to where it was
 * measured.
 *
 * An object whose art has no entry in `OBJ_COLLISION_BASE` is deliberately
 * treated as walk-through rather than as a full cell: the mailbox and the
 * newsstand are 2-4 declared cells each, and defaulting an unmeasured object to
 * its declared box would wall off a patch of grass nobody can explain. Missing
 * measurement should look like nothing happened, not like a bug in the map.
 */
export function objectCells(objects: Iterable<PlacedObject>): CellPoint[] {
  return objectCellsImpl(objects);
}

/**
 * The same footing, as whole TILES.
 *
 * **Not redundant with `objectCells`, and the difference is which grid the
 * caller lives on.** `Farm.ts` asks this to answer *"which tiles do you chop a
 * tree from"* — a gameplay question about the tile you face, on the same grid as
 * plots and the action key. Collision asks `objectCells` and gets the footing at
 * three times the resolution. One measurement, two grids, two functions rather
 * than one function and a conversion the caller has to remember.
 */
export function objectTiles(objects: Iterable<PlacedObject>): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (const object of objects) {
    const base: PixelRect | undefined = OBJ_COLLISION_BASE[object.key];
    if (!base) continue;
    tiles.push(...footprintTiles(objectFootprint(object.anchorPx, base)));
  }
  return tiles;
}

function objectCellsImpl(objects: Iterable<PlacedObject>): CellPoint[] {
  const cells: CellPoint[] = [];
  for (const object of objects) {
    const base: PixelRect | undefined = OBJ_COLLISION_BASE[object.key];
    if (!base) continue;
    cells.push(...pixelRectToCells(object.anchorPx, base));
  }
  return cells;
}

/**
 * Solid cells for terrain, from a grid of resolved tileset keys and frames.
 *
 * Takes already-resolved keys rather than gids so this stays testable without
 * the manifest, and so the caller owns the one tricky part — Phaser may remap a
 * tile index, which is why `Farm.ts` resolves through the map's own tileset
 * table (`locateInMap`) rather than through `fromGid` alone.
 *
 * **Three answers per tile now, not two.** A frame with an authored shape in
 * `TILE_COLLISION_MASK` gets that shape; a frame without one falls back to the
 * old whole-tile question, all nine cells or none. That fallback is what makes
 * an unmeasured tile behave exactly as it does today rather than becoming a
 * hole in the map — forgetting to measure should look like nothing happened.
 *
 * The shore tile is the reason this exists. Water is the only solid terrain,
 * and the shoreline is *mostly* grass with a strip of sea down one edge — so
 * whole-tile collision had to pick: block the bank you are meant to stand on,
 * or let the character stand in the sea. It picked the sea, and the mask is how
 * that stops being a choice.
 */
export function terrainCells(
  at: (x: number, y: number) => { readonly key: string; readonly frame: number } | null,
  isSolid: (key: string) => boolean = isWaterKey,
): CellPoint[] {
  const cells: CellPoint[] = [];

  for (let y = 0; y < FARM_HEIGHT; y++) {
    for (let x = 0; x < FARM_WIDTH; x++) {
      const tile = at(x, y);
      if (!tile) continue;

      const mask = terrainMask(tile.key, tile.frame);
      if (mask) {
        // Masks are anchored bottom-left like every other silhouette here, so
        // the row below is the one the mask sits on.
        cells.push(...maskToCells({ x, y: y + 1 }, mask, SUBTILE_RESOLUTION));
      } else if (isSolid(tile.key)) {
        cells.push(...tileToCells({ x, y }));
      }
    }
  }

  return cells;
}

/**
 * True for the two tilesets that draw open water.
 *
 * `water-tile` is the flat fill. `tileset-grass-water-spring` is the shoreline,
 * which is mostly grass with a strip of water down one edge — and is
 * deliberately NOT solid: it is the bank, you stand on it. Only the flat fill
 * blocks. (Kept as a named predicate so this distinction has somewhere to live
 * besides a string comparison in a loop.)
 */
export function isWaterKey(key: string): boolean {
  return key === 'water-tile';
}

/**
 * Feet positions (world px) → the tiles they stand on.
 *
 * Still TILES, deliberately. This feeds the animal layer, and an animal
 * occupies a tile of the farm the way a plot does — the gameplay grid, not the
 * collision one. `tilesToCells` is applied at the call site so the conversion
 * is visible where the two grids meet rather than buried here.
 */
export function feetTiles(points: Iterable<{ x: number; y: number }>): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (const p of points) {
    tiles.push({ x: Math.floor(p.x / TILE_SIZE), y: Math.floor((p.y - 1) / TILE_SIZE) });
  }
  return tiles;
}

/** `feetTiles`, converted for the block map. */
export function feetCells(points: Iterable<{ x: number; y: number }>): CellPoint[] {
  return tilesToCells(feetTiles(points));
}

/**
 * The `World` every scene hands to `step()`.
 *
 * **One function so `tileSize` is decided once.** It is the single line that
 * makes collision sub-tile — `step` and `slide` are written entirely in terms
 * of it, with no hard-coded 16 — and it is therefore the single line that
 * silently reverts collision to whole tiles if somebody writes `TILE_SIZE`
 * there out of habit. Both scenes built this object inline until that break was
 * tried and every test stayed green; a shared constructor is what gives the
 * property somewhere to be asserted.
 */
export function playerWorld(blocked: Blocked): World {
  return { blocked, collider: PLAYER_COLLIDER, tileSize: COLLISION_CELL };
}
