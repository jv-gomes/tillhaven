import { TILESET_HOUSE } from './assets.js';
import type { MapBounds } from './tilesets.js';

/**
 * The house interior's authored layout (T-16.10, D-17).
 *
 * The farm equivalent is `farmLayout.ts`, and this exists for the same reason:
 * `apps/mapmaker/scripts/generate-interior.ts` paints from these constants, the
 * client renders against them, and a drift test pins the committed map to what
 * they produce. The generator is the authority (D-13, extended to the second
 * map); the committed `interior.json` is its output, never hand-edited.
 *
 * **The room used to be a drawn rectangle.** T-3.05 recorded that the pack had
 * no floor or wall tiles, which was true of the OLD pack and has been quoted as
 * a constraint ever since. `TILESET_HOUSE` is 52x24 tiles of walls, floors and
 * door frames.
 */

/** Tileset columns, so a (col, row) reads as a frame index. */
const COLS = TILESET_HOUSE.cols;

/** Frame index of a tile at (col, row) in `TILESET_HOUSE`. */
export function houseFrame(col: number, row: number): number {
  return row * COLS + col;
}

/**
 * Room size, in tiles.
 *
 * Twelve by ten is chosen against the furniture rather than picked round: the
 * largest piece in the catalogue is 3x3 (the rug), the walkable floor is six
 * rows deep, and a player can cross the room in about two seconds at walk
 * speed — long enough to feel like a room, short enough that a house is not a
 * second farm to walk across.
 */
export const INTERIOR_WIDTH = 12;
export const INTERIOR_HEIGHT = 10;

export const INTERIOR_BOUNDS: MapBounds = {
  width: INTERIOR_WIDTH,
  height: INTERIOR_HEIGHT,
};

/**
 * How many map rows the north wall occupies.
 *
 * Four, because that is how the tileset draws a wall: an upper panel, a dado
 * rail, a lower panel and a skirting course, on tileset rows 4-7. It is a wall
 * ELEVATION, not a top-down wall, so the number comes from the art and is not
 * a thickness anyone chose.
 */
export const WALL_ROWS = 4;

/** The first walkable row. Everything above it is wall. */
export const FLOOR_TOP = WALL_ROWS;

/**
 * The wall colour block used, as a tileset column offset.
 *
 * The tileset repeats one wall in about thirteen colourways, four columns each:
 * a left jamb, two middle panels, a right jamb. Column 0 is the cream one.
 */
const WALL_COL = { left: 0, midA: 1, midB: 2, right: 3 } as const;

/** Tileset row of each wall course, top to bottom. */
const WALL_ROW = [4, 5, 6, 7] as const;

/**
 * The door, as a column range in the north wall.
 *
 * Three tiles wide because that is the door: `Tileset House.png` columns 1-3 of
 * rows 0-3 are one panelled door — left jamb, leaf, right jamb — and it is
 * exactly `WALL_ROWS` tall, which is what lets it drop into the wall band with
 * no special alignment. Column 4 is the start of the NEXT door and rendered as
 * a black seam down the right-hand side when it was included by mistake.
 */
export const DOOR_X0 = 4;
export const DOOR_X1 = 6;

/** Tileset columns of the door, left to right, matching `DOOR_X0..DOOR_X1`. */
const DOOR_COLS = [1, 2, 3] as const;
/** Tileset rows of the door, top to bottom. */
const DOOR_ROWS = [0, 1, 2, 3] as const;

/**
 * The tile the player faces to leave — the door's bottom row, at its centre.
 *
 * `facedTile` reports one tile, so the target is a single cell rather than the
 * whole four-wide opening: standing on the floor directly below it and facing
 * up is the one unambiguous way to be "at the door".
 */
export const INTERIOR_DOOR_TILE = {
  x: DOOR_X0 + 1,
  y: WALL_ROWS - 1,
} as const;

/** Where the character stands on entering: just below the door, facing down. */
export const INTERIOR_SPAWN_TILE = {
  x: INTERIOR_DOOR_TILE.x,
  y: FLOOR_TOP,
} as const;

/**
 * The floor, as a small set of plank tiles laid in a random bond (T-18.11).
 *
 * **It was one tile of diagonal parquet, `houseFrame(19, 0)`, and the QA audit
 * was right that it read as a placeholder** (G-5): "a strong repeating stripe".
 * Measured rather than argued — profiling every one of the tileset's 1248 cells
 * for whether its left edge matches its own right edge showed that tile's seams
 * differing by 29 and 35 (of 255). It does **not** tile with itself, so every
 * 16px boundary is a visible break in the diagonal, and a 12x10 room shows 120
 * of them. The comment that shipped with it claimed the opposite — "the
 * diagonal runs across tile seams, so a floor of it has no visible grid" — which
 * is the thing worth recording: it was a reasonable guess and the pixels
 * disagreed.
 *
 * These three are seamless against themselves and against each other (all four
 * edge comparisons measure 0.0), so mixing them cannot produce a break. Two of
 * them are the same plank block rotated, which is what makes a random mix read
 * as **parquet** rather than as noise: a floor of one is a hard grid, a floor of
 * three is a laid floor.
 */
export const INTERIOR_FLOOR_FRAMES: readonly number[] = [
  houseFrame(25, 0),
  houseFrame(26, 0),
  houseFrame(25, 1),
];

/**
 * Which plank goes on a given cell.
 *
 * A hash of the coordinate, not a seeded sequence — the same argument
 * `scatterTiles` makes on the farm (T-18.09). The map is committed and the
 * generator owns it, so a floor that reshuffled on every regeneration would
 * make each run a 120-line diff and leave `interiorMap.test.ts` unable to say
 * anything useful about it.
 */
export function floorFrameAt(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const index = ((h ^ (h >>> 16)) >>> 0) % INTERIOR_FLOOR_FRAMES.length;
  return INTERIOR_FLOOR_FRAMES[index]!;
}

export interface PaintedTile {
  readonly x: number;
  readonly y: number;
  readonly frame: number;
}

/**
 * Every tile of the north wall, door included, in paint order.
 *
 * Derived rather than written out, so widening the room or moving the door
 * cannot leave a hand-listed tile behind — the failure mode would be one column
 * of wall missing from the middle of a room, which is easy to miss in a diff
 * and impossible to miss on screen.
 */
export function wallTiles(): PaintedTile[] {
  const out: PaintedTile[] = [];

  for (let row = 0; row < WALL_ROWS; row++) {
    for (let x = 0; x < INTERIOR_WIDTH; x++) {
      const inDoor = x >= DOOR_X0 && x <= DOOR_X1;

      if (inDoor) {
        const col = DOOR_COLS[x - DOOR_X0]!;
        out.push({ x, y: row, frame: houseFrame(col, DOOR_ROWS[row]!) });
        continue;
      }

      // Jambs at the room's own edges, middle panels between them, alternating
      // so a long wall does not read as one stamped tile.
      let col: number = WALL_COL.midA;
      if (x === 0) col = WALL_COL.left;
      else if (x === INTERIOR_WIDTH - 1) col = WALL_COL.right;
      else col = x % 2 === 0 ? WALL_COL.midA : WALL_COL.midB;

      out.push({ x, y: row, frame: houseFrame(col, WALL_ROW[row]!) });
    }
  }

  return out;
}

/**
 * Tiles the player cannot walk on: the whole wall band.
 *
 * The door is included. You LEAVE by facing it and pressing the action key, the
 * same way you enter (D-7) — walking through a doorway is not a thing this game
 * does, and a walk-through gap in a wall is a hole you can end up behind.
 */
export function interiorBlockedTiles(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < WALL_ROWS; y++) {
    for (let x = 0; x < INTERIOR_WIDTH; x++) out.push({ x, y });
  }
  return out;
}

/**
 * True when a room tile is part of the door the player leaves through.
 *
 * The mirror of `isHouseDoorTile` on the farm side, and the same rule: you face
 * the door and press the action key (D-7). The door is solid, so walking into
 * it is not a way out and never becomes one by accident.
 */
export function isInteriorDoorTile(tileX: number, tileY: number): boolean {
  return tileY === INTERIOR_DOOR_TILE.y && tileX >= DOOR_X0 && tileX <= DOOR_X1;
}
