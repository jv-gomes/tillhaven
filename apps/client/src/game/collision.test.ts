import { describe, expect, it } from 'vitest';
import {
  BARN_TIER_ART,
  COOP_TIER_ART,
  FARM_HEIGHT,
  FARM_WIDTH,
  MAP_OBJECTS,
  PLOT_POSITIONS,
  TILE_SIZE,
  GRASS_FILL_FRAME,
  SUBTILE_RESOLUTION,
  COLLISION_CELL,
  PLAYER_COLLIDER,
  cellsToTiles,
  currentBuildingCells,
  tilesToCells,
  objectAnchorPx,
  maxHerd,
  pastureSlot,
  waterTiles,
} from '@tillhaven/shared/config';
import {
  BlockMap,
  feetCells,
  feetTiles,
  footprintTiles,
  footprintsTiles,
  isWaterKey,
  objectCells,
  playerWorld,
  terrainCells,
} from './collision.js';

/**
 * T-15.07. The `BlockMap` decides where the farm is solid, so its failure modes
 * are the ones a player cannot report usefully: a plot they cannot reach, a
 * yard walled off, an invisible barrier where a building is not yet built.
 */

describe('BlockMap', () => {
  it('starts empty', () => {
    const map = new BlockMap();
    expect(map.has(0, 0)).toBe(false);
    expect(map.size).toBe(0);
  });

  it('unions every layer', () => {
    const map = new BlockMap();
    map.set('terrain', [{ cx: 1, cy: 1 }]);
    map.set('buildings', [{ cx: 2, cy: 2 }]);

    expect(map.has(1, 1)).toBe(true);
    expect(map.has(2, 2)).toBe(true);
    expect(map.has(3, 3)).toBe(false);
  });

  /*
   * The reason the layers are named instead of flattened on the way in.
   * Buildings are rebuilt whenever a tier is bought and animals whenever the
   * poll returns; if replacing one dropped the others, buying a coop would
   * briefly make the water walkable.
   */
  it('replaces one layer without disturbing the rest', () => {
    const map = new BlockMap();
    map.set('terrain', [{ cx: 1, cy: 1 }]);
    map.set('buildings', [{ cx: 2, cy: 2 }]);

    map.set('buildings', [{ cx: 5, cy: 5 }]);

    expect(map.has(1, 1), 'terrain survived the buildings rebuild').toBe(true);
    expect(map.has(2, 2), 'the old building cell is gone').toBe(false);
    expect(map.has(5, 5)).toBe(true);
  });

  it('keeps a cell solid while any layer still claims it', () => {
    const map = new BlockMap();
    map.set('animals', [{ cx: 4, cy: 4 }]);
    map.set('decor', [{ cx: 4, cy: 4 }]);

    map.set('animals', []);
    expect(map.has(4, 4), 'decor still claims it').toBe(true);

    map.set('decor', []);
    expect(map.has(4, 4)).toBe(false);
  });

  it('reports which layers make a cell solid', () => {
    const map = new BlockMap();
    map.set('terrain', [{ cx: 7, cy: 7 }]);
    map.set('decor', [{ cx: 7, cy: 7 }]);
    expect(map.reasons(7, 7).sort()).toEqual(['decor', 'terrain']);
    expect(map.reasons(0, 0)).toEqual([]);
  });

  it('exposes a pre-bound `blocked` safe to pass to step()', () => {
    const map = new BlockMap();
    map.set('terrain', [{ cx: 1, cy: 2 }]);
    // Detached from the instance on purpose: this is exactly how step() gets it.
    const { blocked } = map;
    expect(blocked(1, 2)).toBe(true);
    expect(blocked(2, 1)).toBe(false);
  });

  it('clears a layer', () => {
    const map = new BlockMap();
    map.set('decor', [{ cx: 3, cy: 3 }]);
    map.clear('decor');
    expect(map.has(3, 3)).toBe(false);
  });
});

describe('footprint tiles', () => {
  it('is inclusive on both ends, like TileFootprint', () => {
    expect(footprintTiles({ x0: 1, y0: 1, x1: 2, y1: 2 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
  });

  it('flattens many footprints', () => {
    const tiles = footprintsTiles([
      { x0: 0, y0: 0, x1: 0, y1: 0 },
      { x0: 5, y0: 5, x1: 5, y1: 5 },
    ]);
    expect(tiles).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
  });
});

describe('object cells', () => {
  it('uses the measured footing, not the declared cell', () => {
    // The maple's declared cell is 32x48; its trunk is 12px and blocks 2 tiles.
    const tiles = cellsToTiles(
      objectCells([{ key: 'obj-maple-tree', anchorPx: { x: 48, y: 48 } }]),
    );
    expect(tiles.length).toBeLessThanOrEqual(4);
    expect(tiles.length).toBeGreaterThan(0);
  });

  /**
   * **The measurement stops being rounded away.** The footing is recorded in
   * pixels and used to be widened to whole tiles; a 12px trunk in a 32px cell
   * now blocks the trunk rather than the cell.
   */
  it('blocks less than the tiles it touches', () => {
    const cells = objectCells([{ key: 'obj-maple-tree', anchorPx: { x: 48, y: 48 } }]);
    const tiles = cellsToTiles(cells);
    expect(cells.length).toBeLessThan(tiles.length * SUBTILE_RESOLUTION * SUBTILE_RESOLUTION);
  });

  it('treats unmeasured art as walk-through rather than as a full cell', () => {
    // Silence is the safe default: a mailbox defaulting to its declared 2-cell
    // box would wall off grass with no visible cause.
    expect(objectCells([{ key: 'not-measured', anchorPx: { x: 0, y: 16 } }])).toEqual([]);
  });
});

describe('terrain tiles', () => {
  it('blocks the flat water fill', () => {
    expect(isWaterKey('water-tile')).toBe(true);
  });

  /*
   * The shoreline is grass with a strip of water down its left edge — it is the
   * BANK, and the player stands on it. Blocking it would put an invisible wall
   * one tile inside the visible waterline all the way down the farm.
   */
  it('does not block the shoreline, which is bank you stand on', () => {
    expect(isWaterKey('tileset-grass-water-spring')).toBe(false);
    expect(isWaterKey('ground-grass')).toBe(false);
    expect(isWaterKey('ground-path')).toBe(false);
  });

  it('walks the whole grid and blocks exactly the water', () => {
    const water = new Set(waterTiles().map((t) => `${t.x},${t.y}`));
    const cells = terrainCells((x, y) =>
      water.has(`${x},${y}`)
        ? { key: 'water-tile', frame: 0 }
        : { key: 'tileset-grass-spring', frame: GRASS_FILL_FRAME },
    );

    // Nine cells per solid tile, since neither frame has an authored shape.
    expect(cells).toHaveLength(water.size * SUBTILE_RESOLUTION * SUBTILE_RESOLUTION);
    for (const tile of cellsToTiles(cells)) {
      expect(water.has(`${tile.x},${tile.y}`)).toBe(true);
    }
  });

  /**
   * **The shore tile, which is what sub-tile collision is for.** Its key is not
   * solid — the bank is somewhere you stand — so whole-tile collision left the
   * whole cell walkable, sea included. Its measured mask blocks the water strip
   * and nothing else.
   */
  it('blocks the water strip of a shoreline tile without blocking the bank', () => {
    const cells = terrainCells((x, y) =>
      x === 3 && y === 4 ? { key: 'tileset-grass-water-spring', frame: 92 } : null,
    );

    expect(cells.length, 'the shore blocks something now').toBeGreaterThan(0);
    expect(cells.length, 'but not the whole tile').toBeLessThan(
      SUBTILE_RESOLUTION * SUBTILE_RESOLUTION,
    );
    expect(cellsToTiles(cells)).toEqual([{ x: 3, y: 4 }]);
    // The strip is the LEFT third: every solid cell is in the tile's first column.
    for (const cell of cells) expect(cell.cx).toBe(3 * SUBTILE_RESOLUTION);
  });

  /**
   * An unmeasured frame falls back to the whole-tile question, so forgetting to
   * measure looks like nothing happened rather than like a hole in the map.
   */
  it('falls back to the whole tile for a frame nobody measured', () => {
    const cells = terrainCells((x, y) =>
      x === 1 && y === 1 ? { key: 'water-tile', frame: 999 } : null,
    );
    expect(cells).toHaveLength(SUBTILE_RESOLUTION * SUBTILE_RESOLUTION);
  });

  it('ignores a null tile rather than treating it as solid', () => {
    expect(terrainCells(() => null)).toEqual([]);
  });
});

describe('feet tiles', () => {
  it('converts to the collision grid on request', () => {
    expect(feetCells([{ x: 8, y: 16 }])).toEqual(tilesToCells([{ x: 0, y: 0 }]));
  });

  it('puts a sprite standing on a tile boundary on the tile above it', () => {
    // Feet sit on the tile's bottom edge, so y is exclusive — the same
    // off-by-one `rememberObjectTiles` documents in Farm.ts.
    expect(feetTiles([{ x: 8, y: 16 }])).toEqual([{ x: 0, y: 0 }]);
    expect(feetTiles([{ x: 8, y: 17 }])).toEqual([{ x: 0, y: 1 }]);
  });
});

describe('the farm stays playable', () => {
  /**
   * Build the worst-case block map: every building at its top tier, the water,
   * and every yard slot occupied.
   */
  function worstCase(): BlockMap {
    const map = new BlockMap();
    map.set('terrain', tilesToCells(waterTiles()));
    map.set(
      'buildings',
      currentBuildingCells({
        coop: COOP_TIER_ART.length - 1,
        barn: BARN_TIER_ART.length - 1,
      }),
    );

    /*
     * The map objects, at the anchors `farmLayout.ts` places them.
     *
     * A tile-object hangs from its BOTTOM-left, so the anchor's y is the tile
     * BELOW it: tile (8,10) anchors at py 176, not 160.
     *
     * Including these is the whole point. The first version of this test
     * layered only water, buildings and animals and passed — while the chest,
     * which is 15px of art straddling a tile boundary, was quietly making plot
     * (9,10) unreachable on the real farm.
     */
    /*
     * Driven off `MAP_OBJECTS` rather than a hand-written list (T-18.05). The
     * copy here had to be kept in step with `farmLayout.ts` by hand, in two
     * test files, and a stale copy makes a "worst case" that is quietly missing
     * an obstacle.
     */
    map.set(
      'objects',
      objectCells(MAP_OBJECTS.map((o) => ({ key: o.key, anchorPx: objectAnchorPx(o.tile) }))),
    );

    // Animals are deliberately NOT in this map — see the D-14 test below.
    return map;
  }

  /*
   * The single most important assertion in this file. You act on the tile you
   * are FACING, so you must be able to stand next to every plot — and the idle
   * replay walks the farmer across the field, so standing ON one must stay
   * legal too. A blocker creeping onto a plot makes part of the farm silently
   * unusable.
   */
  it('never blocks a plot tile, even at the top building tiers', () => {
    const map = worstCase();
    for (const plot of PLOT_POSITIONS) {
      expect(map.hasInTile(plot.x, plot.y), `plot (${plot.x},${plot.y}) is blocked`).toBe(false);
    }
  });

  /**
   * **This used to assert the shape of the water column**: solid down x=0 for
   * every row, walkable at (1,0), solid at (1, bottom). That was a description
   * of the map `generate-farm.ts` painted, and `waterTiles()` reads `farm.json`
   * now — so the assertions failed the moment somebody re-cut the shoreline by
   * hand, which is the editor working.
   *
   * What is still worth pinning is the WIRING: every tile `waterTiles()` names
   * is solid once fed through `tilesToCells`, and nothing else is. A map with no
   * impassable terrain is a legitimate map and makes this vacuous rather than
   * failing — the shape of the farm is the author's business.
   */
  it('blocks exactly the tiles waterTiles() names', () => {
    const map = new BlockMap();
    const water = waterTiles();
    map.set('terrain', tilesToCells(water));

    const solid = new Set(water.map((t) => `${t.x},${t.y}`));
    for (let y = 0; y < FARM_HEIGHT; y++) {
      for (let x = 0; x < FARM_WIDTH; x++) {
        expect(map.hasInTile(x, y), `(${x},${y})`).toBe(solid.has(`${x},${y}`));
      }
    }
  });

  it('leaves the farm mostly walkable', () => {
    // A blunt sanity check: if a refactor ever makes "solid" the default, the
    // exact assertions above might all still pass while the farm is unplayable.
    const map = worstCase();
    let open = 0;
    for (let y = 0; y < FARM_HEIGHT; y++) {
      for (let x = 0; x < FARM_WIDTH; x++) if (!map.hasInTile(x, y)) open++;
    }
    expect(open).toBeGreaterThan((FARM_WIDTH * FARM_HEIGHT) / 2);
  });

  it('keeps a walkable tile between adjacent cows in the barn row', () => {
    // The cow yard is spaced 2 tiles apart because a cow is 32px wide. The row
    // runs WEST from the barn since T-18.04, so compare the distance rather
    // than the signed difference.
    const first = feetTiles([pastureSlot('cow', 0, 0)])[0]!;
    const second = feetTiles([pastureSlot('cow', 1, 0)])[0]!;
    expect(Math.abs(second.x - first.x)).toBe(2);
  });
});

/*
 * D-14, and the evidence for it.
 *
 * The Phase 15 plan said animals should block their home tile. They must not,
 * and this is why: the coop yard is 5x3 on 1x1 spacing and `maxHerd('coop')` is
 * exactly 15, so a full flock occupies every slot. If each chicken were solid,
 * the three in the middle row would be enclosed by other chickens — you could
 * never stand adjacent to one, never face it, and therefore never feed or
 * collect from it, with nothing the player could do about it. An animal you
 * cannot feed is an animal that stops producing forever (§5.4).
 *
 * Cows are fine (2-tile spacing), which is exactly the trap: block animals,
 * test with a couple of cows, ship it, and the bug only appears for a player
 * who fills their coop.
 */
describe('D-14: why livestock is walk-through', () => {
  function yardTiles(kind: 'chicken' | 'cow'): { x: number; y: number }[] {
    const herd = maxHerd(kind === 'chicken' ? 'coop' : 'barn');
    const slots = [];
    for (let i = 0; i < herd; i++) slots.push(pastureSlot(kind, i, 0));
    return feetTiles(slots);
  }

  function stranded(tiles: readonly { x: number; y: number }[]): string[] {
    const taken = new Set(tiles.map((t) => `${t.x},${t.y}`));
    return tiles
      .filter((t) =>
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].every(([dx, dy]) => taken.has(`${t.x + dx!},${t.y + dy!}`)),
      )
      .map((t) => `(${t.x},${t.y})`);
  }

  it('a full coop would wall three chickens in, if animals were solid', () => {
    // The finding itself, pinned. If a future change gives the coop yard more
    // room (or spaces it out), this stops being true and animals could become
    // solid again — at which point this test tells you so by failing.
    expect(stranded(yardTiles('chicken'))).toHaveLength(3);
  });

  it('a full barn would not, because cows are spaced two tiles apart', () => {
    expect(stranded(yardTiles('cow'))).toEqual([]);
  });

  it('so the scene leaves the animals layer empty', () => {
    // A BlockMap with no animals layer is what Farm.syncAnimals now produces.
    const map = new BlockMap();
    for (const tile of yardTiles('chicken')) {
      expect(map.hasInTile(tile.x, tile.y), `chicken at (${tile.x},${tile.y}) blocks`).toBe(false);
    }
  });
});

/**
 * The one line that makes collision sub-tile.
 *
 * Break-tested by hand first, which is why this exists: setting the scenes'
 * `tileSize` back to `TILE_SIZE` left every test in the repo green while
 * collision silently reverted to a third of the map, because no test imported
 * a scene. `playerWorld` gives the property a home that node can reach.
 */
describe('playerWorld', () => {
  it('walks the collision grid, not the map grid', () => {
    expect(playerWorld(() => false).tileSize).toBe(COLLISION_CELL);
    expect(playerWorld(() => false).tileSize).not.toBe(TILE_SIZE);
  });

  it('carries the shared collider rather than a copy of its numbers', () => {
    expect(playerWorld(() => false).collider).toBe(PLAYER_COLLIDER);
  });

  it('passes the predicate straight through', () => {
    const world = playerWorld((x, y) => x === 3 && y === 4);
    expect(world.blocked(3, 4)).toBe(true);
    expect(world.blocked(4, 3)).toBe(false);
  });
});

describe('tile geometry matches the shared constants', () => {
  it('uses the same tile size the map does', () => {
    expect(TILE_SIZE).toBe(16);
  });
});
