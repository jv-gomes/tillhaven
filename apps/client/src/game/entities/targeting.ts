import { FARM_BOUNDS, TILE_SIZE, type MapBounds } from '@tillhaven/shared/config';
import type { Direction } from './movement.js';

/**
 * Which tile the character is about to act on, with no Phaser in it.
 *
 * Split out and pure for the same reason `movement.ts` is (ROADMAP "Testing
 * shape"): the interesting cases are boundaries — standing exactly on a tile
 * edge, facing off the map — and those are miserable to reach by driving a
 * canvas and trivial to assert against a function.
 *
 * **This decides pixels, never permission.** Adjacency and facing are
 * client-side UX (CLAUDE.md §5.1): the server validates ownership and plot
 * state and never learns where the character stood. Nothing computed here may
 * ever be put in a payload.
 */

export interface TilePoint {
  readonly tileX: number;
  readonly tileY: number;
}

export interface Position {
  /** Feet position, world pixels — the same point `MoveState` carries. */
  readonly x: number;
  readonly y: number;
}

/** One tile forward, per facing. */
const FORWARD: Readonly<Record<Direction, TilePoint>> = {
  down: { tileX: 0, tileY: 1 },
  up: { tileX: 0, tileY: -1 },
  left: { tileX: -1, tileY: 0 },
  right: { tileX: 1, tileY: 0 },
};

/**
 * The tile the character is standing on.
 *
 * The feet position is a GROUND LINE — an exclusive bottom edge, exactly like
 * `CHAR_ART.bottom` — so the tile it belongs to is the one containing the last
 * pixel row the character actually covers, `y - 1`. Dropping that offset looks
 * right until the feet land on an exact tile boundary (which is precisely
 * where the character spawns), and then the standing tile silently becomes the
 * row BELOW the character's feet and every target is off by one.
 *
 * Deliberately NOT clamped to the map, unlike `facedTile`: this reports where
 * the character is, and `playerBounds` already guarantees that is on the map.
 * A standing tile outside it would be a bug worth seeing.
 */
export function standingTile(position: Position): TilePoint {
  return {
    tileX: Math.floor(position.x / TILE_SIZE),
    tileY: Math.floor((position.y - 1) / TILE_SIZE),
  };
}

/**
 * The tile directly in front of the character's feet, clamped to the map.
 *
 * At a map edge the target collapses onto the standing tile rather than
 * pointing at nothing. That is deliberate: every caller from T-8.06 onward has
 * to check what is actually ON the target anyway (a plot, a chest, the
 * merchant), so a clamped target fails the same way an empty one does, and
 * clamping means no caller has to handle a null.
 *
 * **`bounds` became a parameter in T-16.09.** It was `FARM_WIDTH`/`FARM_HEIGHT`
 * read as module constants, which is right exactly once and silently wrong the
 * moment the same character stands in a ten-tile room: facing east from the far
 * wall would report a tile nineteen columns outside it. Defaulted to the farm
 * so the farm's four call sites read unchanged.
 */
export function facedTile(
  position: Position,
  facing: Direction,
  bounds: MapBounds = FARM_BOUNDS,
): TilePoint {
  const standing = standingTile(position);
  const forward = FORWARD[facing];

  return {
    tileX: clamp(standing.tileX + forward.tileX, 0, bounds.width - 1),
    tileY: clamp(standing.tileY + forward.tileY, 0, bounds.height - 1),
  };
}

/** Centre of a tile in world pixels — where a tile-sized marker is drawn. */
export function tileCentre(tile: TilePoint): Position {
  return {
    x: tile.tileX * TILE_SIZE + TILE_SIZE / 2,
    y: tile.tileY * TILE_SIZE + TILE_SIZE / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
