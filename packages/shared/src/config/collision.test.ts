import { describe, expect, it } from 'vitest';
import { IMAGES, SHEETS, TILE_SIZE } from './assets.js';
import {
  BUILDING_FOOTPRINTS,
  HOUSE_ANCHOR,
  HOUSE_FOOTPRINT,
  houseFootprint,
  inFootprint,
  type TilePoint,
} from './buildings.js';
import {
  MAILBOX_TILE,
  MAP_OBJECTS,
  MERCHANT_NPC_TILE,
  MERCHANT_TILE,
  OBJECT_TILES,
  SHIPPING_BOX_TILE,
  objectAnchorPx,
  objectFootings,
  objectsBlockingPaths,
  pathTiles,
  waterTiles,
} from './farmLayout.js';
import {
  DOOR_X0,
  DOOR_X1,
  INTERIOR_DOOR_TILE,
  INTERIOR_HEIGHT,
  INTERIOR_WIDTH,
  WALL_ROWS,
  interiorBlockedTiles,
  isInteriorDoorTile,
} from './interiorLayout.js';
import { INTERIOR_ROOM } from './furniture.js';
import { BARN_TIER_ART, COOP_TIER_ART, HOUSE_TIER_ART } from './assets.js';
import { HOUSE_TIERS } from './economy.js';
import { FARM_WIDTH } from './tilesets.js';
import { PLOT_POSITIONS } from './plots.generated.js';
import {
  HOUSE_DOOR_ART,
  OBJ_COLLISION_BASE,
  PLAYER_COLLIDER,
  houseDoorTile,
  isHouseDoorTile,
  colliderFitsArt,
  currentBuildingTiles,
  objectFootprint,
  playerFitsThroughOneTileGap,
  BUILDING_BODY_MASK,
  maskResolution,
  maskTileSize,
  subTileMaskToTiles,
} from './collision.js';

/**
 * T-15.05. These are the constants that decide where the player can and cannot
 * walk, so the failure modes are all of the "the game feels broken and nobody
 * can say why" kind: a collider one pixel too wide makes every gate sticky, an
 * over-large object base walls off a path, and a footprint taken at the wrong
 * tier makes a player bump into a barn they have not bought.
 */

const ART_KEYS = new Set([...SHEETS.map((s) => s.key), ...IMAGES.map((i) => i.key)]);

describe('the player collider', () => {
  it('fits through a one-tile gap', () => {
    // The whole reason halfWidth is 5 and not 8. A 16px-wide collider cannot
    // pass a 16px gap without pixel-perfect alignment.
    expect(playerFitsThroughOneTileGap()).toBe(true);
    expect(PLAYER_COLLIDER.halfWidth * 2).toBeLessThan(TILE_SIZE);
  });

  it('is no wider than the character actually drawn', () => {
    expect(colliderFitsArt()).toBe(true);
  });

  it('is a feet box, not the full silhouette', () => {
    // CHAR_ART is 19px tall. A collider that tall would let a tree canopy block
    // the player's head, so you could not walk behind art you can see over.
    expect(PLAYER_COLLIDER.height).toBeLessThan(TILE_SIZE);
  });
});

describe('map object bases', () => {
  it('names only art that exists in the manifest', () => {
    for (const key of Object.keys(OBJ_COLLISION_BASE)) {
      expect(ART_KEYS, `${key} is not in SHEETS or IMAGES`).toContain(key);
    }
  });

  it('describes a real rectangle', () => {
    for (const [key, base] of Object.entries(OBJ_COLLISION_BASE)) {
      expect(base.left, key).toBeGreaterThanOrEqual(0);
      expect(base.right, key).toBeGreaterThanOrEqual(base.left);
      expect(base.height, key).toBeGreaterThan(0);
    }
  });

  /*
   * The measurement's whole point, pinned.
   *
   * `farm.json` declares the maple as 32x48 and the shipping box as 48x64. If
   * anyone ever "simplifies" these bases back to the declared cell, this fails:
   * a tree would block its entire canopy and the shipping box would wall off
   * three tiles of the path it stands beside.
   */
  it('is the object FOOTING, not its declared cell', () => {
    const maple = OBJ_COLLISION_BASE['obj-maple-tree']!;
    expect(maple.right - maple.left + 1, 'maple trunk should be ~12px, not 32').toBeLessThan(
      TILE_SIZE,
    );

    const shipping = OBJ_COLLISION_BASE['obj-shipping-box']!;
    expect(
      shipping.right - shipping.left + 1,
      'the shipping box draws ONE 16px crate, not the 48px 3-crate kit',
    ).toBeLessThanOrEqual(TILE_SIZE);
  });

  it('turns an anchor into the tiles the footing covers, rounded outwards', () => {
    // A 16px-wide base sitting exactly on a tile boundary covers exactly one
    // tile; the same base shifted 1px covers two.
    const flush = objectFootprint({ x: 32, y: 48 }, { left: 0, right: 15, height: 4 });
    expect([flush.x0, flush.x1]).toEqual([2, 2]);

    const straddling = objectFootprint({ x: 33, y: 48 }, { left: 0, right: 15, height: 4 });
    expect([straddling.x0, straddling.x1]).toEqual([2, 3]);
  });

  it('anchors the footing at the object bottom, growing upward', () => {
    // Tiled hangs a tile-object from its bottom-left, so a base 4px tall at
    // y=48 occupies the tile ending at y=48, i.e. tile row 2.
    const box = objectFootprint({ x: 0, y: 48 }, { left: 0, right: 15, height: 4 });
    expect([box.y0, box.y1]).toEqual([2, 2]);
  });
});

describe('what the buildings actually block', () => {
  const area = (b: { x0: number; x1: number; y0: number; y1: number }) =>
    (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
  const inside = (b: { x0: number; x1: number; y0: number; y1: number }, t: TilePoint) =>
    t.x >= b.x0 && t.x <= b.x1 && t.y >= b.y0 && t.y <= b.y1;

  it('blocks far less than the ground it reserves', () => {
    const reserved = BUILDING_FOOTPRINTS.reduce((n, b) => n + area(b), 0);
    const solid = currentBuildingTiles({ coop: 0, barn: 0 }).length;

    // Two reasons, not one. At tier 0 you may walk where a Deluxe barn will
    // later stand — and at EVERY tier you may walk behind a roof (T-23.03).
    expect(solid).toBeLessThan(reserved);
  });

  /**
   * The headline of T-23.03, as an invariant rather than a number: collision
   * must never grow past what the generator reserved, at any tier. If it did,
   * a building could block ground the map was free to put a tree on.
   */
  it('never blocks a tile outside the reserved ground, at any tier', () => {
    for (const tier of [0, 1, 2]) {
      for (const t of currentBuildingTiles({ house: tier, coop: tier, barn: tier })) {
        expect(
          BUILDING_FOOTPRINTS.some((b) => inside(b, t)),
          `(${t.x},${t.y}) is solid but unreserved at tier ${tier}`,
        ).toBe(true);
      }
    }
  });

  /**
   * **The invisible walls, gone (T-23.03).**
   *
   * The tier-0 farmhouse used to block its whole 8x6 bounding box. Six of those
   * tiles — the top row either side of a 20px chimney cap — contained no drawn
   * pixels at all, so a player walking the north edge of the map was stopped by
   * nothing at all. These are those exact tiles.
   */
  it('no longer blocks the farmhouse tiles that have no art on them', () => {
    const solid = new Set(
      currentBuildingTiles({ house: 0, coop: 0, barn: 0 }).map((t) => `${t.x},${t.y}`),
    );

    for (const x of [6, 9, 10, 11, 12, 13]) {
      expect(solid.has(`${x},1`), `(${x},1) has no art and still blocks`).toBe(false);
    }
  });

  /**
   * The yard in front of a set-back wing. `obj-farmhouse-t1`'s right wing sits
   * on a base a row higher than the left's, so the ground tiles beneath it are
   * grass — in this projection, empty pixels BELOW a wall are the ground in
   * front of it.
   */
  it('opens the yard under a wing whose base sits higher', () => {
    const solid = new Set(
      currentBuildingTiles({ house: 1, coop: 0, barn: 0 }).map((t) => `${t.x},${t.y}`),
    );
    const ground = houseFootprint(1).y1;

    expect(solid.has(`${6},${ground}`), 'the left wing still meets the ground').toBe(true);
    expect(solid.has(`${12},${ground}`), 'the right wing has no base here').toBe(false);
  });

  /**
   * ...and the roof MASS still blocks, which is the other half of the decision.
   * Freeing it entirely traps the idle replay behind the house — see
   * `BUILDING_BODY_MASK`, and `reachability.test.ts`, which is what caught it.
   */
  it('keeps the roof itself solid, so the house cannot be walked through', () => {
    const solid = new Set(
      currentBuildingTiles({ house: 0, coop: 0, barn: 0 }).map((t) => `${t.x},${t.y}`),
    );
    const box = houseFootprint(0);

    for (let y = box.y0 + 1; y <= box.y1; y++) {
      expect(solid.has(`${box.x0 + 2},${y}`), `(${box.x0 + 2},${y}) should be solid`).toBe(true);
    }
  });

  /**
   * **Every mask must be exactly as big as the art it describes.**
   *
   * The sub-tile experiment shipped a farmhouse mask 21 rows tall for six
   * tiles of art — SEVEN tiles — which hung a phantom row of collision above
   * the roof and re-created the invisible north-edge wall T-23.03 removed.
   * Nothing caught it, because every consumer happily indexed whatever it was
   * given.
   *
   * Coarse (1x) and sub-tile (3x) masks are both allowed; what is not allowed
   * is a mask that does not divide evenly into the art's tile box.
   */
  it('sizes every building mask to the art it describes', () => {
    const arts = [...HOUSE_TIER_ART, ...COOP_TIER_ART, ...BARN_TIER_ART];
    const wrong: string[] = [];

    for (const [key, mask] of Object.entries(BUILDING_BODY_MASK)) {
      const art = arts.find((a) => a.sheet.key === key);
      if (!art) {
        wrong.push(`${key}: no art in any tier list`);
        continue;
      }

      const artCols = Math.ceil(art.look.width / TILE_SIZE);
      const artRows = Math.ceil(art.look.height / TILE_SIZE);
      const resolution = maskResolution(mask, artCols);
      const size = maskTileSize(mask, resolution);

      if (size.cols !== artCols || size.rows !== artRows) {
        wrong.push(
          `${key}: mask is ${size.cols}x${size.rows} tiles at ${resolution}x, ` +
            `art is ${artCols}x${artRows}`,
        );
      }
    }

    expect(wrong, 'a mask that outgrows its art is collision with no picture').toEqual([]);
  });

  /**
   * A 3x3 block reduced with OR can only ever be coarser than the mask that
   * produced it — one micro-cell of chimney re-blocks its whole tile, which is
   * the invisible wall again. The threshold is what makes carving possible, so
   * it is asserted directly rather than only through its consequences.
   */
  it('reduces a sub-tile block by coverage, not by any-pixel', () => {
    const anchor = { x: 0, y: 1 };
    const oneCell = ['#..', '...', '...'];
    const aThird = ['###', '...', '...'];

    expect(subTileMaskToTiles(anchor, oneCell, 3), 'one of nine must not block').toEqual([]);
    expect(subTileMaskToTiles(anchor, aThird, 3), 'three of nine must block').toHaveLength(1);
  });

  /** Ragged rows are tolerated and padded, not a crash. */
  it('survives a mask whose rows are not all the same length', () => {
    expect(() => subTileMaskToTiles({ x: 0, y: 1 }, ['###', '########'], 3)).not.toThrow();
  });

  it('grows with the tier the farm actually has', () => {
    const at = (tier: number) => currentBuildingTiles({ house: tier, coop: tier, barn: tier }).length;

    expect(at(2)).toBeGreaterThan(at(0));
  });

  /**
   * The direction that matters if it is ever wrong. Ground the player may walk
   * on must not be reported solid: an invisible wall has no in-game remedy,
   * while a roof you can walk under is merely a picture.
   */
  it('defaults an unstated house tier to the SMALLEST building', () => {
    const unstated = currentBuildingTiles({ coop: 0, barn: 0 }).length;
    const explicit = currentBuildingTiles({ house: 0, coop: 0, barn: 0 }).length;

    expect(unstated).toBe(explicit);
    expect(unstated).toBeLessThan(currentBuildingTiles({ house: 2, coop: 0, barn: 0 }).length);
  });
});

describe('plots stay walkable', () => {
  /*
   * The single most important assertion in this file.
   *
   * You act on the tile you are FACING, which means you have to be able to
   * stand next to a plot — and standing ON one has to stay legal too, because
   * the idle replay walks the farmer across the field. A building footprint
   * that crept over a plot would make part of the farm unusable with no error
   * message anywhere.
   */
  it('is never inside a building footprint, at any tier', () => {
    const tiers = [0, COOP_TIER_ART.length - 1];
    for (const coop of tiers) {
      for (const barn of tiers) {
        const solid = new Set(
          currentBuildingTiles({ house: coop, coop, barn }).map((t) => `${t.x},${t.y}`),
        );
        for (const plot of PLOT_POSITIONS) {
          expect(
            solid.has(`${plot.x},${plot.y}`),
            `plot (${plot.x},${plot.y}) is inside a building at coop ${coop} barn ${barn}`,
          ).toBe(false);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * The farmhouse door (T-16.11, D-7)
 * ------------------------------------------------------------------ */

describe('houseDoorTile', () => {
  const door = houseDoorTile(HOUSE_ANCHOR);

  /**
   * **The door straddles a tile boundary**, so the rounding rule decides which
   * column it is — and the first version got it wrong by one, landing on x=9.
   *
   * The independent check is the path: T-15.29 re-routed the spine to start
   * "directly below the front door", and it runs down x=8. Asserting against
   * `pathTiles()` rather than against a hardcoded 8 means the two cannot drift
   * apart silently — if the house moves, either both move or this fails.
   */
  /**
   * **The door covers two tiles, and both must be targetable.** The art spans
   * eight pixels either side of a tile boundary, so rounding to one column is a
   * coin flip — and the browser landed on the other side of it, walking the
   * character up to a door that then did nothing.
   */
  it('covers every tile its art overlaps', () => {
    expect(door.tiles.length, 'the art spans two columns').toBe(2);
    expect(door.tiles.map((t) => t.x)).toEqual([8, 9]);
    expect(new Set(door.tiles.map((t) => t.y)).size, 'all on one row').toBe(1);
  });

  it('is targetable from the column the path spine runs up to', () => {
    const row = door.approach[0]!.y;
    const spine = pathTiles().filter((t) => t.y === row).map((t) => t.x);
    const reachable = door.approach.filter((a) => spine.includes(a.x));
    expect(reachable.length, 'no path leads to any door tile').toBeGreaterThan(0);
  });

  it('answers to isHouseDoorTile on every tile it covers, and nowhere else', () => {
    for (const t of door.tiles) {
      expect(isHouseDoorTile(HOUSE_ANCHOR, t.x, t.y), `${t.x},${t.y}`).toBe(true);
    }
    const y = door.tiles[0]!.y;
    const xs = door.tiles.map((t) => t.x);
    expect(isHouseDoorTile(HOUSE_ANCHOR, Math.min(...xs) - 1, y)).toBe(false);
    expect(isHouseDoorTile(HOUSE_ANCHOR, Math.max(...xs) + 1, y)).toBe(false);
    expect(isHouseDoorTile(HOUSE_ANCHOR, xs[0]!, y + 1), 'the approach is not the door').toBe(false);
  });

  /** You face the door; you never stand on it. It is inside a solid building. */
  it('is inside the house footprint, and its approach is not', () => {
    const fp = HOUSE_FOOTPRINT;
    const inside = (t: { x: number; y: number }) =>
      t.x >= fp.x0 && t.x <= fp.x1 && t.y >= fp.y0 && t.y <= fp.y1;

    for (const t of door.tiles) {
      expect(inside(t), `door tile ${t.x},${t.y} must be solid (D-7)`).toBe(true);
    }
    for (const a of door.approach) {
      expect(inside(a), `approach ${a.x},${a.y} must be standable`).toBe(false);
    }
  });

  it('puts each approach directly below its door tile', () => {
    door.tiles.forEach((t, i) => {
      expect(door.approach[i]!.x).toBe(t.x);
      expect(door.approach[i]!.y).toBe(t.y + 1);
    });
  });

  it('measures one tile of door at every tier, not a centred guess', () => {
    // Inclusive width must be exactly TILE_SIZE. A door measured as wider than
    // a tile would mean `facedTile` could point at a column that is only half
    // door, which is how the off-by-one happened in the first place.
    HOUSE_DOOR_ART.forEach((art, tier) => {
      expect(art.x1 - art.x0 + 1, `tier ${tier}`).toBe(TILE_SIZE);
    });
  });
});

/**
 * T-17.06 — the door after the house upgrades.
 *
 * `HOUSE_TIERS` is a declared gold sink the shop did not offer, because every
 * tier drew the same house. Giving the upper tiers their own art moves the door
 * one tile left, and a door that moves without the collision knowing is a house
 * you cannot get into — which is strictly worse than no upgrade at all.
 */
describe('houseDoorTile across tiers', () => {
  const tiers = HOUSE_TIER_ART.map((_, tier) => tier);

  it('has art and a door window for every tier the economy sells', () => {
    // The coupling that actually matters: a tier with no picture draws nothing,
    // and a tier with no door window silently falls back to tier 0's columns.
    expect(HOUSE_DOOR_ART.length).toBe(HOUSE_TIER_ART.length);
    expect(HOUSE_TIER_ART.length).toBe(HOUSE_TIERS.length);
  });

  it('moves the door one tile left at tiers 1 and 2', () => {
    // The whole reason this task was blocked. Not an incidental difference:
    // tier 0's door is at crop x40-55, tiers 1 and 2 at x18-33.
    expect(houseDoorTile(HOUSE_ANCHOR, 0).tiles.map((t) => t.x)).toEqual([8, 9]);
    expect(houseDoorTile(HOUSE_ANCHOR, 1).tiles.map((t) => t.x)).toEqual([7, 8]);
    expect(houseDoorTile(HOUSE_ANCHOR, 2).tiles.map((t) => t.x)).toEqual([7, 8]);
  });

  /**
   * The check that keeps the upgrade playable. T-17.06's plan expected the path
   * spine to stop meeting the door — it does not, because every tier overlaps
   * at column 8, which is the spine. If a future tier moved the door off it,
   * this fails rather than shipping a house nobody can reach on foot.
   */
  it('leaves every tier a door tile reachable from the path', () => {
    for (const tier of tiers) {
      const door = houseDoorTile(HOUSE_ANCHOR, tier);
      const row = door.approach[0]!.y;
      const spine = pathTiles().filter((t) => t.y === row).map((t) => t.x);
      const reachable = door.approach.filter((a) => spine.includes(a.x));
      expect(reachable.length, `tier ${tier} has no path to its door`).toBeGreaterThan(0);
    }
  });

  /** D-7 holds at every tier: the door is solid, its approach is not. */
  it('keeps every tier its door inside its own footprint and its approach outside', () => {
    for (const tier of tiers) {
      const fp = houseFootprint(tier);
      const inside = (t: { x: number; y: number }) =>
        t.x >= fp.x0 && t.x <= fp.x1 && t.y >= fp.y0 && t.y <= fp.y1;
      const door = houseDoorTile(HOUSE_ANCHOR, tier);

      for (const t of door.tiles) {
        expect(inside(t), `tier ${tier} door ${t.x},${t.y} must be solid`).toBe(true);
      }
      for (const a of door.approach) {
        expect(inside(a), `tier ${tier} approach ${a.x},${a.y} must be standable`).toBe(false);
      }
    }
  });

  it('falls back to tier 0 rather than throwing on a tier that does not exist', () => {
    // The server sends the tier; a value this list has not caught up with must
    // still draw a door, not crash the scene.
    expect(houseDoorTile(HOUSE_ANCHOR, 99).tiles).toEqual(houseDoorTile(HOUSE_ANCHOR, 0).tiles);
    expect(houseFootprint(99)).toEqual(houseFootprint(0));
  });
});

/**
 * T-17.06 / D-20 — the tier-2 house is a row taller.
 *
 * The decision was that it may take the map's fringed border row. These pin
 * that it takes exactly one row and only at the top tier, so a future look
 * window cannot quietly grow the house off the top of the map.
 */
describe('house footprints across tiers', () => {
  it('is the same size at tiers 0 and 1, and one row taller at tier 2', () => {
    const [t0, t1, t2] = [0, 1, 2].map(houseFootprint);
    expect(t1).toEqual(t0);
    expect(t2!.y1).toBe(t0!.y1);
    expect(t0!.y0 - t2!.y0, 'tier 2 grows upward by exactly one row').toBe(1);
  });

  it('keeps the border row at tiers 0 and 1 and gives it up at tier 2 (D-20)', () => {
    expect(houseFootprint(0).y0, 'border row visible').toBeGreaterThan(0);
    expect(houseFootprint(2).y0, 'roof reaches the border row').toBe(0);
  });

  it('never leaves the map, at any tier', () => {
    for (const tier of [0, 1, 2, 99]) {
      const fp = houseFootprint(tier);
      expect(fp.y0, `tier ${tier} overhangs the top`).toBeGreaterThanOrEqual(0);
      expect(fp.x0, `tier ${tier} overhangs the west`).toBeGreaterThanOrEqual(0);
      expect(fp.x1, `tier ${tier} overhangs the east`).toBeLessThan(FARM_WIDTH);
    }
  });

  /** `HOUSE_FOOTPRINT` reserves ground for the biggest house, never the current one. */
  it('reserves the largest tier as the building footprint', () => {
    expect(HOUSE_FOOTPRINT).toEqual(houseFootprint(HOUSE_TIER_ART.length - 1));
  });
});

/* ------------------------------------------------------------------ *
 * The interior room (T-16.15)
 * ------------------------------------------------------------------ */

describe('interior collision', () => {
  const blocked = new Set(interiorBlockedTiles().map((t) => `${t.x},${t.y}`));
  const isBlocked = (x: number, y: number) => blocked.has(`${x},${y}`);

  /**
   * The room had no character until T-16.15, so nothing consulted this and it
   * went unnoticed that nothing did: you could walk through the wall and out
   * through the door art, into the black beyond the room.
   */
  it('blocks every tile of the wall band and nothing below it', () => {
    for (let x = 0; x < INTERIOR_WIDTH; x++) {
      for (let y = 0; y < WALL_ROWS; y++) {
        expect(isBlocked(x, y), `wall (${x},${y}) is walkable`).toBe(true);
      }
      for (let y = WALL_ROWS; y < INTERIOR_HEIGHT; y++) {
        expect(isBlocked(x, y), `floor (${x},${y}) is blocked`).toBe(false);
      }
    }
  });

  /**
   * **The door is solid, and that is the point of D-7 restated indoors.** You
   * leave by facing it and pressing the action key. A walk-through doorway
   * would put the character in the wall band, where there is no floor drawn and
   * no way to work out which room they are in.
   */
  it('blocks the door as firmly as the wall around it', () => {
    for (let x = DOOR_X0; x <= DOOR_X1; x++) {
      expect(isInteriorDoorTile(x, INTERIOR_DOOR_TILE.y), `${x} is not door`).toBe(true);
      expect(isBlocked(x, INTERIOR_DOOR_TILE.y), `door (${x}) is walkable`).toBe(true);
    }
  });

  it('leaves the tile below the door standable, or there is no way out', () => {
    const below = INTERIOR_DOOR_TILE.y + 1;
    expect(below).toBeLessThan(INTERIOR_HEIGHT);
    expect(isBlocked(INTERIOR_DOOR_TILE.x, below)).toBe(false);
    expect(isInteriorDoorTile(INTERIOR_DOOR_TILE.x, below), 'the approach is not the door').toBe(
      false,
    );
  });

  /**
   * Every placement cell has to be reachable, or a piece can be put somewhere
   * it can never be picked up from. The floor is one open rectangle with no
   * interior walls, so this is currently trivially true — asserted anyway,
   * because the day someone adds an internal partition is the day it stops
   * being trivial and nothing else would notice.
   */
  it('leaves every placement cell walkable', () => {
    for (let y = 0; y < INTERIOR_ROOM.height; y++) {
      for (let x = 0; x < INTERIOR_ROOM.width; x++) {
        expect(isBlocked(x, y + WALL_ROWS), `cell (${x},${y}) is blocked`).toBe(false);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * The merchant NPC (T-18.02)
 * ------------------------------------------------------------------ */

/**
 * The shopkeeper is placed by a constant rather than by the map, so nothing
 * downstream validates the cell the way `verify-farm` validates a map object.
 * These are that check: the same questions the generator asks of every tree and
 * stall, asked of the one thing the generator never sees.
 */
describe('MERCHANT_NPC_TILE', () => {
  const npc = MERCHANT_NPC_TILE;

  it('stands beside the stall, not inside it', () => {
    // The stall is 2 tiles wide anchored at MERCHANT_TILE, covering x..x+1.
    const insideStallColumns = npc.x >= MERCHANT_TILE.x && npc.x <= MERCHANT_TILE.x + 1;
    expect(insideStallColumns, 'the NPC would be drawn behind the counter art').toBe(false);
    // ...but close enough to read as belonging to it.
    expect(Math.abs(npc.x - MERCHANT_TILE.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(npc.y - MERCHANT_TILE.y)).toBeLessThanOrEqual(3);
  });

  /**
   * The NPC is SOLID, so a cell on a path run would sever it — and the mailbox,
   * stall and shipping box already interrupt the y=13 lane. One more blocker on
   * a drawn path is one more place the player walks into thin air.
   */
  it('is off every path run', () => {
    const onPath = pathTiles().some((t) => t.x === npc.x && t.y === npc.y);
    expect(onPath, 'a solid NPC standing on a drawn path severs it').toBe(false);
  });

  it('is clear of the field, the buildings and the water', () => {
    /*
     * The control. This assertion was written with an extra argument
     * (`inFootprint(f, npc.x, npc.y)`), which type-errors but runs: the number
     * arrived where a `TilePoint` was expected, every comparison read
     * `undefined`, and the test passed without checking anything. Proving the
     * predicate can still say `true` is what makes the `false` below mean
     * something.
     */
    const insideHouse = { x: HOUSE_ANCHOR.x + 1, y: HOUSE_ANCHOR.y - 1 };
    expect(inFootprint(HOUSE_FOOTPRINT, insideHouse), 'the check is live').toBe(true);

    expect(PLOT_POSITIONS.some((p) => p.x === npc.x && p.y === npc.y)).toBe(false);
    expect(BUILDING_FOOTPRINTS.some((f) => inFootprint(f, npc))).toBe(false);
    expect(waterTiles().some((t) => t.x === npc.x && t.y === npc.y)).toBe(false);
  });

  it('does not share a cell with any map object', () => {
    const others = OBJECT_TILES.filter((t) => t !== npc);
    expect(others.some((t) => t.x === npc.x && t.y === npc.y)).toBe(false);
  });

  /** Listed as reserved ground, or decor placement could bury the shopkeeper. */
  it('is reserved against decor placement', () => {
    expect(OBJECT_TILES).toContain(npc);
  });
});

/* ------------------------------------------------------------------ *
 * The drawn path must be walkable (T-18.05, BUG-07)
 * ------------------------------------------------------------------ */

/**
 * A path is a promise. Painting `ground-path` across the farm tells the player
 * "walk here", and for four phases the y=13 run broke that promise in three
 * places: the mailbox at (3,13), the merchant's stall at (5,13) and the
 * shipping box at (14,13) were each placed ON the run so the player would pass
 * them, and each became solid the moment T-15.05 measured its footing. Walking
 * west stopped dead at tile 6, east at tile 13, and the mailbox could not be
 * reached along the path that led to it.
 *
 * Nothing caught it. `assertGroundClearOfBuildings` checks anchors against
 * buildings; `reachability.test.ts` proves the farmer reaches every PLOT, and it
 * does — going round. The missing question was the simplest one: is the thing
 * we drew as walkable actually walkable?
 */
describe('the drawn path', () => {
  const solid = new Set(objectFootings().flatMap((f) => f.tiles.map((t) => `${t.x},${t.y}`)));

  it('carries no object footing anywhere along it', () => {
    expect(
      objectsBlockingPaths().map(
        ({ footing, tile }) => `${footing.key} blocks the path at (${tile.x},${tile.y})`,
      ),
      'Move the object one row off the run in farmLayout.ts and regenerate ' +
        'the map (T-18.05).',
    ).toEqual([]);
  });

  it('runs under no building and through no water', () => {
    for (const tile of pathTiles()) {
      expect(
        BUILDING_FOOTPRINTS.some((f) => inFootprint(f, tile)),
        `path tile (${tile.x},${tile.y}) is inside a building`,
      ).toBe(false);
      expect(
        waterTiles().some((w) => w.x === tile.x && w.y === tile.y),
        `path tile (${tile.x},${tile.y}) is in the water`,
      ).toBe(false);
    }
  });

  /**
   * The control. `objectsBlockingPaths()` returning `[]` proves nothing unless
   * it can return something, and the honest way to show that is to reproduce
   * the bug: put a footing back on the run and confirm it is found.
   *
   * Done through `objectFootprint` on the OLD anchors rather than by mutating
   * the config, so the check under test — footing arithmetic, then a set
   * lookup against `pathTiles()` — is the same one that runs for real.
   */
  it('would notice an object standing on it, which is how BUG-07 happened', () => {
    const onPath = new Set(pathTiles().map((t) => `${t.x},${t.y}`));

    // The three pre-T-18.05 positions, all one row south of where they are now.
    const before = [
      { key: 'obj-mailbox', tile: { x: MAILBOX_TILE.x, y: 13 } },
      { key: 'obj-newsstand', tile: { x: MERCHANT_TILE.x, y: 13 } },
      { key: 'obj-shipping-box', tile: { x: SHIPPING_BOX_TILE.x, y: 13 } },
    ];

    for (const { key, tile } of before) {
      const box = objectFootprint(objectAnchorPx(tile), OBJ_COLLISION_BASE[key]!);
      const covers: string[] = [];
      for (let y = box.y0; y <= box.y1; y++) {
        for (let x = box.x0; x <= box.x1; x++) covers.push(`${x},${y}`);
      }
      expect(covers.some((k) => onPath.has(k)), `${key} at its old cell was ON the path`).toBe(
        true,
      );
    }
  });

  /**
   * The lane exists to be walked from end to end, so it has to be CONNECTED,
   * not merely unobstructed tile by tile. Four separate runs that never touch
   * would each pass the check above and still leave the farm in pieces.
   */
  it('is one connected network, not four disjoint runs', () => {
    const all = pathTiles().map((t) => `${t.x},${t.y}`);
    const remaining = new Set(all);
    const queue = [all[0]!];
    remaining.delete(all[0]!);

    while (queue.length > 0) {
      const [x, y] = queue.pop()!.split(',').map(Number) as [number, number];
      for (const n of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]) {
        if (remaining.delete(n)) queue.push(n);
      }
    }

    expect([...remaining], 'these path tiles cannot be walked to from the rest').toEqual([]);
  });

  /**
   * The shopkeeper is placed by a constant and blocked as a bare cell, so they
   * are the one solid thing on the farm that no map check ever sees. Asserted
   * against the same footing set as everything else rather than on their own,
   * which is what `objectFootings()` including them buys.
   */
  it('is clear of the shopkeeper too', () => {
    expect(solid.has(`${MERCHANT_NPC_TILE.x},${MERCHANT_NPC_TILE.y}`), 'the NPC is solid').toBe(
      true,
    );
    expect(
      pathTiles().some((t) => t.x === MERCHANT_NPC_TILE.x && t.y === MERCHANT_NPC_TILE.y),
    ).toBe(false);
  });

  /**
   * Every object on this lane was put there to be *used*, so being off the path
   * is only half the fix: there must still be a path tile you can stand on and
   * face it from. This is the assertion that would have caught the bug from the
   * other direction — an unreachable mailbox on its own path.
   */
  it('leaves every object on it reachable from a path tile', () => {
    const onPath = new Set(pathTiles().map((t) => `${t.x},${t.y}`));

    for (const footing of objectFootings()) {
      const adjacent = footing.tiles.flatMap((t) => [
        `${t.x},${t.y + 1}`,
        `${t.x},${t.y - 1}`,
        `${t.x + 1},${t.y}`,
        `${t.x - 1},${t.y}`,
      ]);
      // Trees are scenery — nobody walks up to them, so only the four objects
      // the player interacts with have to be answerable from the lane.
      if (footing.key === 'obj-maple-tree') continue;

      expect(
        adjacent.some((k) => onPath.has(k) && !solid.has(k)),
        `${footing.key} at (${footing.anchor.x},${footing.anchor.y}) cannot be ` +
          'faced from any walkable path tile',
      ).toBe(true);
    }
  });

  it('names every object it places with a key that has a measured footing', () => {
    // A typo'd key would silently skip the object in `objectFootings()` — the
    // check would pass by looking at nothing, which is how BUG-07 survived.
    for (const { key } of MAP_OBJECTS) {
      expect(OBJ_COLLISION_BASE[key], `${key} has no measured base`).toBeDefined();
    }
  });
});
