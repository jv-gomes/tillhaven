import { describe, it, expect } from 'vitest';
import { FARM_BOUNDS, FARM_HEIGHT, FARM_WIDTH, TILE_SIZE } from '@tillhaven/shared/config';
import { facedTile, standingTile, tileCentre } from './targeting.js';
import type { Direction } from './movement.js';

/** Feet at the bottom edge of tile (5, 7) — an exact boundary, as at spawn. */
const ON_BOUNDARY = { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE };

/** Feet in the middle of tile (5, 7)'s vertical span. */
const MID_TILE = { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 7 * TILE_SIZE + 8 };

const ALL: Direction[] = ['down', 'up', 'left', 'right'];

describe('standingTile', () => {
  /**
   * The whole reason for the `- 1`. The feet position is an exclusive bottom
   * edge, so a character whose feet sit exactly on the line between rows 7 and
   * 8 is standing in row 7 — the one it is actually drawn on.
   */
  it('puts a character standing on an exact tile boundary in the tile above it', () => {
    expect(standingTile(ON_BOUNDARY)).toEqual({ tileX: 5, tileY: 7 });
  });

  it('agrees with itself anywhere inside the same tile', () => {
    for (let offset = 1; offset <= TILE_SIZE; offset++) {
      const y = 7 * TILE_SIZE + offset;
      expect(standingTile({ x: MID_TILE.x, y }), `feet at y=${y}`).toEqual({
        tileX: 5,
        tileY: 7,
      });
    }
  });

  it('moves to the next tile one pixel past the boundary', () => {
    expect(standingTile({ x: MID_TILE.x, y: 8 * TILE_SIZE + 1 }).tileY).toBe(8);
    expect(standingTile({ x: 6 * TILE_SIZE, y: MID_TILE.y }).tileX).toBe(6);
    expect(standingTile({ x: 6 * TILE_SIZE - 1, y: MID_TILE.y }).tileX).toBe(5);
  });
});

describe('facedTile', () => {
  it('points at the neighbour in each of the four directions', () => {
    expect(facedTile(MID_TILE, 'down')).toEqual({ tileX: 5, tileY: 8 });
    expect(facedTile(MID_TILE, 'up')).toEqual({ tileX: 5, tileY: 6 });
    expect(facedTile(MID_TILE, 'left')).toEqual({ tileX: 4, tileY: 7 });
    expect(facedTile(MID_TILE, 'right')).toEqual({ tileX: 6, tileY: 7 });
  });

  it('never targets the tile the character is standing on, away from the edges', () => {
    const standing = standingTile(MID_TILE);
    for (const facing of ALL) {
      expect(facedTile(MID_TILE, facing), facing).not.toEqual(standing);
    }
  });

  it('targets exactly one tile away — never a diagonal, never two', () => {
    const standing = standingTile(MID_TILE);
    for (const facing of ALL) {
      const target = facedTile(MID_TILE, facing);
      const dx = Math.abs(target.tileX - standing.tileX);
      const dy = Math.abs(target.tileY - standing.tileY);
      expect(dx + dy, facing).toBe(1);
    }
  });

  it('is consistent with standingTile across a tile boundary', () => {
    // One pixel apart, either side of the row 7/8 line: the targets must shift
    // by exactly one row, not jump.
    const above = facedTile({ x: MID_TILE.x, y: 8 * TILE_SIZE }, 'down');
    const below = facedTile({ x: MID_TILE.x, y: 8 * TILE_SIZE + 1 }, 'down');
    expect(below.tileY - above.tileY).toBe(1);
  });

  describe('map-edge clamping', () => {
    const topLeft = { x: 0, y: 1 };
    // The LAST pixel of the map, not one past it: `FARM_WIDTH * TILE_SIZE` is
    // already off the right-hand edge.
    const bottomRight = { x: FARM_WIDTH * TILE_SIZE - 1, y: FARM_HEIGHT * TILE_SIZE };

    it('never leaves the map, whichever way the character faces at a corner', () => {
      for (const position of [topLeft, bottomRight]) {
        for (const facing of ALL) {
          const { tileX, tileY } = facedTile(position, facing);
          expect(tileX, `x at ${JSON.stringify(position)} facing ${facing}`).toBeGreaterThanOrEqual(0);
          expect(tileX).toBeLessThan(FARM_WIDTH);
          expect(tileY).toBeGreaterThanOrEqual(0);
          expect(tileY).toBeLessThan(FARM_HEIGHT);
        }
      }
    });

    it('collapses onto the standing tile when facing off the map', () => {
      expect(facedTile(topLeft, 'left')).toEqual(standingTile(topLeft));
      expect(facedTile(topLeft, 'up')).toEqual(standingTile(topLeft));
      expect(facedTile(bottomRight, 'right')).toEqual(standingTile(bottomRight));
      expect(facedTile(bottomRight, 'down')).toEqual(standingTile(bottomRight));
    });

    /**
     * `standingTile` reports where the character IS and deliberately does not
     * clamp; only the target does. `playerBounds` already keeps the feet on
     * the map, so a standing tile off it would be a bug worth seeing rather
     * than one worth hiding.
     */
    it('clamps the target but not the report of where the character stands', () => {
      const offMap = { x: FARM_WIDTH * TILE_SIZE + 40, y: 1 };
      expect(standingTile(offMap).tileX).toBe(FARM_WIDTH + 2);
      expect(facedTile(offMap, 'right').tileX).toBe(FARM_WIDTH - 1);
    });

    it('still targets normally at an edge when facing back inland', () => {
      expect(facedTile(topLeft, 'right')).toEqual({ tileX: 1, tileY: 0 });
      expect(facedTile(bottomRight, 'up')).toEqual({
        tileX: FARM_WIDTH - 1,
        tileY: FARM_HEIGHT - 2,
      });
    });
  });
});

describe('tileCentre', () => {
  it('centres a tile-sized marker on the tile it names', () => {
    expect(tileCentre({ tileX: 0, tileY: 0 })).toEqual({ x: 8, y: 8 });
    expect(tileCentre({ tileX: 5, tileY: 7 })).toEqual({
      x: 5 * TILE_SIZE + TILE_SIZE / 2,
      y: 7 * TILE_SIZE + TILE_SIZE / 2,
    });
  });

  /** Round-trip: the centre of a tile must resolve back to that tile. */
  it('round-trips through standingTile for every tile on the map', () => {
    for (let tileX = 0; tileX < FARM_WIDTH; tileX++) {
      for (let tileY = 0; tileY < FARM_HEIGHT; tileY++) {
        const centre = tileCentre({ tileX, tileY });
        expect(standingTile({ x: centre.x, y: centre.y }), `${tileX},${tileY}`).toEqual({
          tileX,
          tileY,
        });
      }
    }
  });
});

/**
 * T-16.09 — `facedTile` clamps to the map it is given, not to the farm.
 *
 * It read `FARM_WIDTH`/`FARM_HEIGHT` as module constants, which is right for
 * the one map that existed and silently wrong for a second: a character at the
 * east wall of a ten-tile room, facing east, would have been told about column
 * 29 — nineteen columns outside the room, and a tile the interior has no object
 * on, so the action key would have done nothing with no way to tell why.
 */
describe('facedTile clamps to the map it is acting on', () => {
  const ROOM = { width: 10, height: 8 };

  it('clamps to a small room rather than to the farm', () => {
    // Standing on the room's last column, facing further east.
    const atEastWall = { x: (ROOM.width - 1) * TILE_SIZE + TILE_SIZE / 2, y: 4 * TILE_SIZE };
    expect(facedTile(atEastWall, 'right', ROOM).tileX).toBe(ROOM.width - 1);
    expect(facedTile(atEastWall, 'right').tileX, 'the farm default still reaches further').toBe(
      ROOM.width,
    );
  });

  it('clamps the south edge too', () => {
    const atSouthWall = { x: 3 * TILE_SIZE + 8, y: ROOM.height * TILE_SIZE };
    expect(facedTile(atSouthWall, 'down', ROOM).tileY).toBe(ROOM.height - 1);
  });

  it('defaults to the farm, so every existing call site is unchanged', () => {
    const pos = { x: 5 * TILE_SIZE + 8, y: 5 * TILE_SIZE };
    for (const facing of ['up', 'down', 'left', 'right'] as const) {
      expect(facedTile(pos, facing)).toEqual(facedTile(pos, facing, FARM_BOUNDS));
    }
  });
});
