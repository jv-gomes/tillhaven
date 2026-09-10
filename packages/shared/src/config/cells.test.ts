import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from './assets.js';
import { BARN_TIER_ART, COOP_TIER_ART, HOUSE_TIER_ART } from './assets.js';
import { HOUSE_ANCHOR } from './buildings.js';
import { AUTHORED_COLLISION } from './collision.generated.js';
import {
  BUILDING_ANCHORS,
  COLLISION_CELL,
  authoredCollisionCells,
  authoredCollisionTiles,
  tileMaskToCells,
  buildingBodyCells,
  buildingBodyTiles,
  OBJ_COLLISION_BASE,
  SUBTILE_RESOLUTION,
  TILE_COLLISION_MASK,
  cellOfPixel,
  cellsToTiles,
  maskToCells,
  objectFootprint,
  pixelRectToCells,
  subTileMaskToTiles,
  terrainMask,
  tileToCells,
  tilesToCells,
} from './collision.js';

/**
 * The collision grid.
 *
 * Two grids now exist and they differ by 3x. Everything here is about the
 * boundary between them: that the conversion is exact, that the finer one never
 * blocks something the coarser one did not, and that a mask's authored shape
 * survives the trip.
 */

const key = (c: { cx: number; cy: number }) => `${c.cx},${c.cy}`;
const tileKey = (t: { x: number; y: number }) => `${t.x},${t.y}`;

describe('the cell grid', () => {
  it('divides a tile into exactly SUBTILE_RESOLUTION squared cells', () => {
    expect(tileToCells({ x: 0, y: 0 })).toHaveLength(SUBTILE_RESOLUTION * SUBTILE_RESOLUTION);
  });

  it('is the tile size divided by the resolution the masks are authored at', () => {
    expect(COLLISION_CELL).toBe(TILE_SIZE / SUBTILE_RESOLUTION);
  });

  /**
   * Fractional on purpose (16/3 = 5.33). `roundPixels: true` in `main.ts` means
   * a character stopped on a fractional world x still renders on a whole pixel.
   * The test is here so that "tidy this up to 4" is a decision rather than a
   * refactor — it would invalidate every measured mask in the repo.
   */
  it('is allowed to be fractional', () => {
    expect(Number.isInteger(COLLISION_CELL)).toBe(false);
  });

  it('maps a tile to a contiguous block with no gap and no overlap', () => {
    const cells = tileToCells({ x: 4, y: 7 });
    const xs = cells.map((c) => c.cx);
    const ys = cells.map((c) => c.cy);

    expect(Math.min(...xs)).toBe(4 * SUBTILE_RESOLUTION);
    expect(Math.max(...xs)).toBe(5 * SUBTILE_RESOLUTION - 1);
    expect(Math.min(...ys)).toBe(7 * SUBTILE_RESOLUTION);
    expect(Math.max(...ys)).toBe(8 * SUBTILE_RESOLUTION - 1);
    expect(new Set(cells.map(key)).size).toBe(cells.length);
  });

  it('round-trips a tile through cells and back', () => {
    for (const tile of [{ x: 0, y: 0 }, { x: 13, y: 9 }, { x: 29, y: 21 }]) {
      expect(cellsToTiles(tileToCells(tile))).toEqual([tile]);
    }
  });

  it('puts every pixel of a tile in one of that tile’s cells', () => {
    for (let px = 0; px < TILE_SIZE; px++) {
      const cell = cellOfPixel(px, px);
      expect(cell.cx, `px ${px}`).toBeGreaterThanOrEqual(0);
      expect(cell.cx, `px ${px}`).toBeLessThan(SUBTILE_RESOLUTION);
    }
  });

  /**
   * The thirds come out 6/5/5 in whole pixels, not 5/5/5 — which is what a
   * fractional cell size means in practice, and is worth being explicit about
   * rather than surprising somebody debugging a one-pixel discrepancy.
   */
  it('splits sixteen pixels into thirds of six, five and five', () => {
    const widths = [0, 0, 0];
    for (let px = 0; px < TILE_SIZE; px++) widths[cellOfPixel(px, 0).cx]!++;
    expect(widths).toEqual([6, 5, 5]);
  });

  it('handles negative pixels without folding them onto the map', () => {
    expect(cellOfPixel(-1, -1).cx).toBe(-1);
  });
});

describe('maskToCells', () => {
  /**
   * **The whole point of the exercise.** `subTileMaskToTiles` counts coverage
   * per world tile and calls the tile solid at `SUBTILE_SOLID_THRESHOLD`, so a
   * mask that carves one corner out of a tile loses the carve. `maskToCells`
   * keeps every character where it was authored.
   */
  it('keeps a notch that the threshold fills in', () => {
    const mask = ['.##', '###', '###'];
    const anchor = { x: 5, y: 5 };

    // The whole-tile answer: one tile, solid, corner and all.
    expect(subTileMaskToTiles(anchor, mask, SUBTILE_RESOLUTION)).toEqual([{ x: 5, y: 4 }]);

    // The cell answer: eight of nine, with the notch still missing.
    const cells = maskToCells(anchor, mask, SUBTILE_RESOLUTION);
    expect(cells).toHaveLength(8);
    expect(cells.map(key)).not.toContain(`${5 * SUBTILE_RESOLUTION},${4 * SUBTILE_RESOLUTION}`);
  });

  it('anchors the mask above the anchor row, not on it', () => {
    const cells = maskToCells({ x: 2, y: 6 }, ['###', '###', '###'], SUBTILE_RESOLUTION);
    const maxCy = Math.max(...cells.map((c) => c.cy));

    // The last covered cell row is the one just above tile row 6.
    expect(maxCy).toBe(6 * SUBTILE_RESOLUTION - 1);
  });

  /**
   * A coarse mask is one character per world tile, and five of the nine
   * building entries are authored that way. Each character has to expand to a
   * full square of cells or those buildings shrink to a third of themselves —
   * the exact bug `maskResolution` was written to prevent, one grid down.
   */
  it('expands a coarse mask to full tiles rather than single cells', () => {
    const cells = maskToCells({ x: 0, y: 2 }, ['##', '##'], 1);
    expect(cells).toHaveLength(2 * 2 * SUBTILE_RESOLUTION * SUBTILE_RESOLUTION);
    expect(cellsToTiles(cells)).toHaveLength(4);
  });

  it('returns nothing for an empty or nonsensical mask', () => {
    expect(maskToCells({ x: 0, y: 0 }, [], 3)).toEqual([]);
    expect(maskToCells({ x: 0, y: 0 }, ['###'], 0)).toEqual([]);
    // A resolution the cell grid cannot divide by cleanly.
    expect(maskToCells({ x: 0, y: 0 }, ['###'], 2)).toEqual([]);
  });

  it('emits each cell once, however the mask overlaps itself', () => {
    const cells = maskToCells({ x: 1, y: 3 }, ['###', '###', '###'], SUBTILE_RESOLUTION);
    expect(new Set(cells.map(key)).size).toBe(cells.length);
  });
});

/**
 * **The property the server rests on.**
 *
 * `modules/decor/reachability.ts` and `modules/house/reachability.ts` flood-fill
 * in whole tiles and are staying that way. That is only safe if sub-tile
 * collision can never block something whole-tile collision did not: then the
 * server's answer is merely STRICTER than the client's — it may refuse a
 * placement that would have been fine, and can never allow one that traps the
 * player.
 *
 * Asserted against every shipped mask rather than argued in a comment.
 */
describe('sub-tile collision is a subset of the whole-tile answer', () => {
  /**
   * Every shipped building at every tier, through the REAL pair of functions.
   *
   * Deliberately not a synthetic mask at a chosen resolution: five of the nine
   * entries are coarse and four are sub-tile, the resolution is derived from
   * the art's width, and testing them at a resolution they were not authored at
   * asks a question neither function is ever asked in production.
   */
  const looks = [
    ...HOUSE_TIER_ART.map((art, tier) => [`house t${tier}`, HOUSE_ANCHOR, art] as const),
    ...COOP_TIER_ART.map((art, tier) => [`coop t${tier}`, BUILDING_ANCHORS.coop, art] as const),
    ...BARN_TIER_ART.map((art, tier) => [`barn t${tier}`, BUILDING_ANCHORS.barn, art] as const),
  ];

  it.each(looks)('%s', (_label, anchor, art) => {
    const wholeTiles = new Set(buildingBodyTiles(anchor, art).map(tileKey));

    for (const tile of cellsToTiles(buildingBodyCells(anchor, art))) {
      expect(
        wholeTiles.has(tileKey(tile)),
        `cell grid blocks (${tile.x},${tile.y}), tile grid does not`,
      ).toBe(true);
    }
  });

  /**
   * ...and it is a PROPER subset somewhere, or the finer grid bought nothing at
   * all. At least one shipped building must have a tile the threshold called
   * solid and the cells leave partly open — that tile is the notch the player
   * can now walk into.
   */
  it('is strictly finer for at least one shipped building', () => {
    const finer = looks.filter(([, anchor, art]) => {
      const cells = buildingBodyCells(anchor, art).length;
      const tiles = buildingBodyTiles(anchor, art).length;
      return cells < tiles * SUBTILE_RESOLUTION * SUBTILE_RESOLUTION;
    });

    expect(finer.map(([label]) => label).length).toBeGreaterThan(0);
  });

  /** And never coarser: the cell grid may not add a tile the tile grid lacks. */
  it('blocks no tile that whole-tile collision left open, at any tier', () => {
    for (const [label, anchor, art] of looks) {
      const wholeTiles = new Set(buildingBodyTiles(anchor, art).map(tileKey));
      const cellTiles = cellsToTiles(buildingBodyCells(anchor, art)).map(tileKey);
      expect(cellTiles.filter((t) => !wholeTiles.has(t)), label).toEqual([]);
    }
  });
});

describe('pixelRectToCells', () => {
  /**
   * The other measurement that was being thrown away. `objectFootprint` rounds
   * a measured pixel footing outwards to whole tiles; at 5.33px cells it
   * survives much closer to what it says.
   */
  it('never blocks a tile the whole-tile footprint did not', () => {
    const anchorPx = { x: 7 * TILE_SIZE, y: 11 * TILE_SIZE };

    for (const [objectKey, base] of Object.entries(OBJ_COLLISION_BASE)) {
      const box = objectFootprint(anchorPx, base);
      for (const tile of cellsToTiles(pixelRectToCells(anchorPx, base))) {
        expect(
          tile.x >= box.x0 && tile.x <= box.x1 && tile.y >= box.y0 && tile.y <= box.y1,
          `${objectKey}: cells reach (${tile.x},${tile.y}), outside the footprint`,
        ).toBe(true);
      }
    }
  });

  it('is bottom-anchored, like the art', () => {
    const anchorPx = { x: 0, y: 32 };
    const cells = pixelRectToCells(anchorPx, { left: 0, right: 15, height: 16 });

    // Covered pixel rows are [16, 31], so no cell may reach row 32.
    expect(Math.max(...cells.map((c) => c.cy))).toBe(Math.floor(31 / COLLISION_CELL));
  });

  it('blocks at least one cell for every measured object', () => {
    for (const [objectKey, base] of Object.entries(OBJ_COLLISION_BASE)) {
      expect(
        pixelRectToCells({ x: 0, y: TILE_SIZE * 4 }, base).length,
        objectKey,
      ).toBeGreaterThan(0);
    }
  });
});

describe('terrain masks', () => {
  it('answers null for a frame nobody measured', () => {
    expect(terrainMask('tileset-grass-spring', 57)).toBeNull();
    expect(terrainMask('no-such-sheet', 0)).toBeNull();
  });

  /**
   * The shore tile is walkable in full today — the whole cell, sea included.
   * Its measured mask is what sub-tile collision is FOR, so a table that
   * silently lost it should fail here rather than in a playtest.
   */
  it('leaves the bank walkable and the water not', () => {
    const mask = terrainMask('tileset-grass-water-spring', 92);
    expect(mask).not.toBeNull();
    expect(mask).toEqual(['#..', '#..', '#..']);
  });

  it('authors every mask at the collision resolution', () => {
    for (const [sheetKey, frames] of Object.entries(TILE_COLLISION_MASK)) {
      for (const [frame, mask] of Object.entries(frames)) {
        expect(mask.length, `${sheetKey}#${frame} rows`).toBe(SUBTILE_RESOLUTION);
        for (const row of mask) {
          expect(row.length, `${sheetKey}#${frame} row "${row}"`).toBe(SUBTILE_RESOLUTION);
        }
      }
    }
  });

  it('uses only the two characters the format defines', () => {
    for (const frames of Object.values(TILE_COLLISION_MASK)) {
      for (const mask of Object.values(frames)) {
        for (const row of mask) expect(row).toMatch(/^[#.]+$/);
      }
    }
  });

  /** A fully solid terrain mask is the same nine cells `tileToCells` gives. */
  it('agrees with tileToCells when a frame is solid throughout', () => {
    const solid = maskToCells({ x: 3, y: 5 }, ['###', '###', '###'], SUBTILE_RESOLUTION);
    const whole = tilesToCells([{ x: 3, y: 4 }]);
    expect(new Set(solid.map(key))).toEqual(new Set(whole.map(key)));
  });
});

/**
 * **No mask may step by a single cell.**
 *
 * The rule this pins is about the COLLIDER, not about the art. A cell is
 * 5.33px and `PLAYER_COLLIDER` is 10px wide, so five pixels of standing room
 * against a wall is not space the character can use — it is a notch to wedge
 * half of itself into. Two cells (10.7px) clears the collider, so a genuine
 * recess stays a recess and only the unusable ones are refused.
 *
 * The farmhouse art really does inset its west edge by about five pixels, and
 * the mask really did trace it. The idle replay — straight octile lines, no
 * obstacle avoidance (D-8) — walked south-east into the step, found both axes
 * refused and stopped; twenty plots became unreachable from one start position.
 * `reachability.test.ts` caught it, which is the system working, but it caught
 * it three files away from the cause. This catches it at the mask.
 *
 * Enforced here rather than smoothed at runtime, and that was a decision with
 * evidence: a runtime pass that squared every wall face also squared the
 * shoreline, shaving five pixels off the west bank for the map's whole height
 * because the water widens by one tile at the very bottom. A rule that fires
 * where a human is authoring beats one that fires over the union of five
 * layers and surprises somebody in a scene file.
 */
/**
 * **There is no structural test here for "no mask has a one-cell wall step",
 * and that is a decision.**
 *
 * The rule is real — a cell is 5.33px and `PLAYER_COLLIDER` is 10px, so a wall
 * that steps by one cell is a notch the character wedges half of itself into
 * and cannot steer out of. It is what made twenty plots unreachable from one
 * start position, and it is why `obj-farmhouse` authors a straight west wall
 * over art that insets by five pixels.
 *
 * Three attempts at pinning it structurally all misfired, each in a way worth
 * recording: flagging every wall step also flagged the coop's tapered roof;
 * restricting it to downward ledges also flagged the farmhouse's gable;
 * requiring a two-row notch also flagged its chimney. None of those is
 * reachable — nothing walks beside a chimney — and the difference between a
 * notch and a chimney is *reachability*, which cannot be read off a mask.
 *
 * It can be read off the farm, and it already is:
 * `apps/client/src/game/entities/reachability.test.ts` walks the real map with
 * the real straight-line steering from five starts to every plot, and that is
 * the test that caught this. A second, weaker rule that cries wolf on every
 * roofline would get suppressed the first time somebody added a building.
 */

/**
 * Authored collision — what the MAP blocks, over and above the art.
 *
 * The shipped map paints none today, so most of this exercises the encoding
 * rather than the data. The property that matters is the last one.
 */
describe('authored collision', () => {
  it('reads whatever the generated file holds', () => {
    const cells = authoredCollisionCells();
    const solid = AUTHORED_COLLISION.reduce(
      (n, tile) => n + [...tile.mask].filter((c) => c === '#').length,
      0,
    );
    expect(cells).toHaveLength(solid);
  });

  it('places every cell inside the tile its mask belongs to', () => {
    for (const tile of AUTHORED_COLLISION) {
      for (const cell of tileMaskToCells(tile.x, tile.y, tile.mask)) {
        expect(Math.floor(cell.cx / SUBTILE_RESOLUTION)).toBe(tile.x);
        expect(Math.floor(cell.cy / SUBTILE_RESOLUTION)).toBe(tile.y);
      }
    }
  });

  it('generates only well-formed masks', () => {
    for (const tile of AUTHORED_COLLISION) {
      expect(tile.mask, `(${tile.x},${tile.y})`).toMatch(/^[#.]+$/);
      expect(tile.mask.length, `(${tile.x},${tile.y})`).toBe(
        SUBTILE_RESOLUTION * SUBTILE_RESOLUTION,
      );
      expect(tile.mask, `(${tile.x},${tile.y}) is an empty entry`).toContain('#');
    }
  });

  /**
   * **The property the server's trap-guard rests on, and the one the collision
   * brush could quietly break.**
   *
   * Authored cells are ADDITIVE — unlike the art's masks, they can block a tile
   * nothing else blocks. So the subset argument that makes a whole-tile flood
   * fill safe does not extend to them for free: the fill has to be told. It is,
   * via `authoredCollisionTiles`, and this asserts the two agree rather than
   * leaving it to a comment.
   *
   * Written to hold whether or not the shipped map paints any, so it starts
   * working the moment somebody uses the brush.
   */
  it('reaches the tile grid the server flood-fills on', () => {
    const cellTiles = new Set(cellsToTiles(authoredCollisionCells()).map(tileKey));
    const serverTiles = new Set(authoredCollisionTiles().map(tileKey));

    expect(serverTiles).toEqual(cellTiles);
  });

  it('tells the server about a tile it only partly blocks', () => {
    // One cell of one tile: the client blocks a ninth of it, the server must
    // treat the whole tile as solid rather than rounding the ninth away.
    const cells = tileMaskToCells(4, 7, '#........');
    expect(cells).toHaveLength(1);
    expect(cellsToTiles(cells)).toEqual([{ x: 4, y: 7 }]);
  });
});
