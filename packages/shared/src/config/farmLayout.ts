import {
  TILESET_GRASS_SPRING,
  TILESET_GRASS_WATER_SPRING,
  TILESET_PATHS,
  GRASS_FILL_FRAME,
  PATH_FILL_FRAME,
  TILLABLE_FILL_FRAME,
  NPC_CHEF_IDLE,
  NPC_MERCHANT_IDLE,
  OBJ_CHEST,
  OBJ_MAILBOX,
  OBJ_MAPLE_TREE,
  OBJ_NEWSSTAND,
  OBJ_SHIPPING_BOX,
  TILESET_PROPS_SEASONS,
  WATER_TILE,
  TILE_SIZE,
} from './assets.js';
import { OBJ_COLLISION_BASE, objectFootprint } from './collision.js';
import { FARM_WIDTH, FARM_HEIGHT } from './tilesets.js';
import type { TilePoint } from './buildings.js';
import type { GroundAnimationPlacement } from './groundAnim.js';
import { MAP_PLACED_OBJECTS, MAP_SOLID_TERRAIN } from './farmLayout.generated.js';
import { PLOT_POSITIONS } from './plots.generated.js';

/**
 * Re-exported here rather than from `config/index.ts`, so this module is the one
 * place anything reaches for the farm's layout. The generated file is data with
 * no behaviour; going through here means a caller cannot end up holding the raw
 * bake while the rest of the app reads the derived constants.
 */
export { MAP_PLACED_OBJECTS, MAP_SOLID_TERRAIN };

/**
 * Where everything on the farm's ground is, in TILE coordinates.
 *
 * These used to live as `const`s inside `apps/mapmaker/scripts/generate-farm.ts`,
 * where nothing else could read them (T-15.02). Three parties need them now:
 *
 *   - the map generator, which paints them;
 *   - the client, which derives collision from them (T-15.05/T-15.08);
 *   - the SERVER, which validates decor placement against them (T-15.16) and
 *     cannot read `farm.json` at all.
 *
 * This is the same argument `buildings.ts` already makes for `HOUSE_ANCHOR` —
 * "two copies of a tile coordinate is one too many" — applied to the rest of
 * the map.
 *
 * **The MAP is the authority, not this file (M5, reversing D-13).** Anything
 * the map can hold is baked out of it by `pnpm plots`, `pnpm collision` and
 * `pnpm layout`; what is left here is either derived from those bakes or is a
 * thing the map does not carry at all (the tier-dependent buildings, the
 * merchant NPC). If you move something in the editor, save and re-bake —
 * `apps/mapmaker/src/io/farmLayoutBake.test.ts` fails if you forget.
 */

/* ------------------------------------------------------------------ *
 * Terrain
 * ------------------------------------------------------------------ */

/** Water hugs the west edge — "water along one edge" per T-7.06. */
/* ------------------------------------------------------------------ *
 * The map is the source of truth
 *
 * `pnpm layout` bakes `farm.json` into `farmLayout.generated.ts`, and the
 * positions below are read back out of it. It used to run the other way — these
 * were constants and `generate-farm.ts` painted a map from them — which made a
 * hand-edited map into a farm the SERVER did not believe in: the decor
 * trap-guard protecting a chest that had moved, registration seeding trees the
 * map no longer drew, and a dev-only console warning as the only sign.
 *
 * The three bakes together are everything the server knows about the farm's
 * shape: `pnpm plots`, `pnpm collision`, `pnpm layout`.
 *
 * **Not everything moved.** The house, coop and barn are not map objects at all
 * — their art depends on a tier the player owns, so they are drawn from
 * `buildings.ts` and anchored by the constants further down. The merchant NPC is
 * likewise a constant. Reading a position out of the map for something the map
 * does not hold would be inventing agreement.
 * ------------------------------------------------------------------ */

/**
 * Where the map puts the one object with this art key.
 *
 * `pnpm layout` refuses to bake a map that does not place exactly one chest,
 * shipping box, mailbox and stall, so the four call sites below cannot be
 * looking at a hole. The throw is for the case that check cannot cover: a
 * generated file edited by hand, or one baked before the check existed.
 */
function placedObject(key: string): TilePoint {
  const found = MAP_PLACED_OBJECTS.find((o) => o.key === key);
  if (!found) {
    throw new Error(
      `farm.json places no ${key}. Place one in the map editor and run \`pnpm layout\`.`,
    );
  }
  return { x: found.x, y: found.y };
}

/** Every tile the map puts this art on, in map order. */
function placedObjects(key: string): TilePoint[] {
  return MAP_PLACED_OBJECTS.filter((o) => o.key === key).map((o) => ({ x: o.x, y: o.y }));
}

export const WATER_COLS: readonly number[] = [0];

/**
 * The column where grass meets the water, drawn with the shoreline tile rather
 * than flat grass.
 *
 * One column east of the water itself: the shoreline tile is *grass with a
 * strip of water down its left edge*, so it belongs on the grass side of the
 * boundary, not on the water side.
 */
export const SHORE_COL = 1;

/* ------------------------------------------------------------------ *
 * The crop field
 * ------------------------------------------------------------------ */

/**
 * Every plantable cell, in unlock order — **read out of the map, not declared**.
 *
 * **A list, not a rectangle.** This was `FIELD_X0/Y0/W/H` and a double loop, so
 * the farm's plantable ground could only ever be a box — the shape was a
 * consequence of how it was stored rather than a decision anyone made. Written
 * out, a field can be an L, a terrace, or two patches either side of a path,
 * and none of that needs new code: `paintGround` already stamps
 * `GROUND_FILL.tillable` over whatever this returns, `paintScatter` already
 * reserves it, and `togglePlot` already marks it.
 *
 * **It is `PLOT_POSITIONS`, and that is the whole point.** Until M6 this was a
 * hand-written list of the same twenty cells that `pnpm plots` bakes out of the
 * map's `plots` object layer — two copies of one fact, kept equal by a test.
 * The test did its job: somebody moved the field in the editor, saved, and did
 * not re-bake, and for a while the map painted its orange tillable ground at
 * (8..12, 2..5) while the server opened plots at (9..13, 9..12) and
 * `decor.ts` reserved the wrong twenty cells from decoration. The bake is the
 * only copy now, so the two cannot disagree again — the same arrow M5 turned
 * round for `TREES`, `waterTiles()` and the object tiles.
 *
 * **ARRAY ORDER IS UNLOCK ORDER**, which is the one thing here that is not
 * cosmetic: `plotUnlockCost(index)` prices the nth plot at 250*n^2, and the
 * order is the order the markers appear in the map file. Re-ordering them in
 * the editor is a real edit, not a cosmetic one.
 *
 * **Reshaping this is not free, and the cost is not in this file.**
 * `newFarmPlots()` writes each plot's x/y into the database AT REGISTRATION, so
 * existing farms keep the coordinates they were created with. Moving the field
 * does not move their plots; it leaves them sitting on grass while the orange
 * tillable paint appears somewhere else. Pre-launch that is a database wipe
 * (see CLAUDE.md's migrations note); after launch it is a migration, and the
 * decision belongs above this line rather than in the editor.
 *
 * **The field cells are painted TILLABLE, not soil** (T-9.04). Tilled/wet state
 * is SERVER state, and the client draws it per plot on top of whatever the map
 * lays down. Two sources for the same pixel is one too many, and the map's copy
 * is the one that cannot be right.
 */
export const FIELD_CELLS: readonly TilePoint[] = PLOT_POSITIONS.map((p) => ({ x: p.x, y: p.y }));

/**
 * The field's westmost column, for the things that need to route around it.
 *
 * Derived rather than declared, because a list has no `X0`. The path skeleton
 * uses it to stay one column clear of the crop rows; a comment there used to
 * name `FIELD_X0` and would otherwise have gone stale the moment the field
 * stopped being a rectangle.
 */
export const FIELD_WEST = Math.min(...FIELD_CELLS.map((c) => c.x));

/** Every cell of the crop field, in unlock order. */
export function fieldTiles(): TilePoint[] {
  return FIELD_CELLS.map((cell) => ({ x: cell.x, y: cell.y }));
}

/* ------------------------------------------------------------------ *
 * Paths and map objects
 * ------------------------------------------------------------------ */

/**
 * Path skeleton, as `[x0, y0, x1, y1]` runs — each a straight line, either
 * horizontal or vertical.
 *
 * The first two are the original pair: one vertical spine west of the field,
 * one horizontal spine connecting the mailbox/chest/shipping-box row to it.
 * Deliberately routed AROUND the field (x=8, one column west of `FIELD_WEST`)
 * rather than through it — plot cells are painted last regardless of order, but
 * a path visibly crossing the crop rows would look like an authoring mistake
 * even though nothing would break.
 *
 * T-12.02b extended the horizontal spine east to x=20 and hung two new runs off
 * it: a north-south lane at x=20 serving the coop and the barn (x=20 is the
 * column between them and the rest of the farm — `COOP_FOOTPRINT` and
 * `BARN_FOOTPRINT` both start at x=21), and a southern run along y=20 under the
 * cow pasture.
 *
 * The west spine starts one row below the house rather than at the map's north
 * edge. It ran y=1..13 until T-12.02b, which put its top five tiles
 * *underneath* the house where the building simply drew over them; nothing was
 * visibly wrong, which is why it survived three tasks —
 * `assertGroundClearOfBuildings` is what found it. T-15.29 moved it down one
 * more row when the house became a real 8x6 building.
 */
export const PATHS: readonly (readonly [number, number, number, number])[] = [
  // Starts at y=7, one row below the farmhouse's bottom edge (T-15.29). It ran
  // from y=6 until the house grew from a 3x3 silhouette to the real 8x6
  // building, which put the spine's top tile underneath it — caught by
  // `assertPathsClearOfBuildings` rather than by anyone looking at the map.
  [8, 7, 8, 13],
  [3, 13, 20, 13], // mailbox → merchant → chest → shipping box → east lane
  [20, 4, 20, 20], // east lane, past the coop and the barn
  [2, 20, 20, 20], // southern run below the cow pasture
];

/** Every tile of every path run, expanded. Throws on a diagonal run. */
export function pathTiles(): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (const [x0, y0, x1, y1] of PATHS) {
    if (x0 !== x1 && y0 !== y1) {
      throw new Error(`path run ${x0},${y0}-${x1},${y1} is neither horizontal nor vertical`);
    }
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

/**
 * The mailbox, on the north verge of the y=13 run.
 *
 * **On the verge, not on the run — that is T-18.05 (BUG-07).** It sat at (3,13)
 * for four phases: deliberately *on* the path so the player walks past it, and
 * therefore, once Phase 15 made map objects solid, standing in it. Walking west
 * along its own path stopped dead at tile 6 and the mailbox itself could not be
 * reached along the lane it was placed to decorate. `assertPathsClearOfObjects`
 * now refuses to generate that map.
 *
 * North rather than south, and the reason is depth, not taste: an object's
 * ground row draws in front of the row above it, so a 32px mailbox at (3,14)
 * would cover the legs of anyone walking the path at y=13. Everything on this
 * lane moved the same way for the same reason (the 48px stall makes the case
 * unarguable), which also keeps the row reading as one deliberate frontage
 * rather than as objects scattered on both banks.
 */
export const MAILBOX_TILE: TilePoint = placedObject(OBJ_MAILBOX.key);

/**
 * The merchant's stall (T-11.04), on the north verge of the horizontal path
 * between the mailbox and the field so it is passed on the way to and from the
 * crops. Two tiles wide and three tall anchored on its bottom edge, so it
 * covers x 5-6, y 10-12 — clear of the mailbox at x=3, the path spine at x=8,
 * and the field at x>=9.
 *
 * Moved off the run itself by T-18.05, with the mailbox and the shipping box.
 * Its 48px art is the reason the whole row went north: a stall on the south
 * verge (y=14) would draw over rows 12-14 and hide the player *completely* as
 * they walked past it.
 *
 * The move also puts the stall's own ground row level with the shopkeeper at
 * `MERCHANT_NPC_TILE` (7,12), who was standing a row north of the counter they
 * work at.
 */
export const MERCHANT_TILE: TilePoint = placedObject(OBJ_NEWSSTAND.key);

/**
 * The shopkeeper who runs that stall (T-18.02).
 *
 * Beside the counter rather than behind it: the stall art is 48px tall and
 * would draw over most of a 32px character standing north of it, and a vendor
 * you cannot see is not worth adding.
 *
 * (7,12) is the one cell that satisfies everything at once — east of the stall
 * (x 5-6), west of the path spine (x=8), north of the horizontal path run
 * (y=13), three rows south of the chest, and far west of the field (x>=9). The
 * player already stands here to face the stall, so the NPC lands exactly where
 * the interaction was.
 *
 * The original note here said (7,12) "adds no further blocker to a lane the
 * mailbox, stall and shipping box already interrupt". That was true, and it was
 * the wrong thing to be relaxed about: the interruption was BUG-07, and T-18.05
 * cleared it. The lane is now unbroken from x=3 to x=20, and the NPC is on its
 * north verge along with everything else — the same row as the stall it works
 * at, which is where a shopkeeper should have been standing all along.
 *
 * Not placed through `farm.json`: the map is generated from a script that
 * cannot reproduce the committed ground art (D-13/T-15.00), so a new map object
 * would mean regenerating it. Like the house, coop and barn, this is anchored
 * in config and built by the scene.
 */
export const MERCHANT_NPC_TILE: TilePoint = { x: 7, y: 12 };

/**
 * The Chef (T-33.03), on the south verge of the horizontal path.
 *
 * **Beside the road rather than in a field.** The southern half of the farm is
 * the largest open ground there is, and a character standing in the middle of it
 * reads as something the player dropped rather than somebody who lives here.
 * (5,14) is directly south of the path run that spans x=3..20 at y=13, so the
 * Chef is passed rather than sought — the player walks that lane between the
 * mailbox, the stall and the shipping box every session — and two tiles south of
 * the stall, which puts the village's two faces within sight of each other.
 *
 * West of the field (x>=9) and clear of every building footprint, which the
 * reachability tests check rather than this comment.
 *
 * **(6,14) was the first choice and the ground scatter had it.** `farmMap.test.ts`
 * refuses scatter on ground that is spoken for, and the authored map decorates
 * x=3, 6, 8, 11, 14 and 17 along that row. Moving the villager was right rather
 * than clearing the cell: T-33.03 promises `farm.json` is untouched, and a task
 * that quietly edits the map to make room for a constant is how the two drift
 * apart again (M6).
 *
 * Anchored in config, not in `farm.json`, for the same reason the shopkeeper is:
 * the buildings and the NPCs are the things the map does not hold (M5-1). It is
 * also what lets this task leave the map file byte-identical.
 */
export const CHEF_NPC_TILE: TilePoint = { x: 5, y: 14 };

/**
 * Everyone who lives on the farm: who they are, what they are drawn from, and
 * where they stand (T-33.03).
 *
 * **Shared config rather than a client module**, and the reason is mechanical:
 * `objectFootings()` below reads it to make their tiles solid, and the client's
 * `VillagerNpc` reads it to draw them. Two lists would be two places to add the
 * next villager, and the failure — a character who is drawn but walk-through, or
 * solid but invisible — is exactly the kind that ships. It also keeps the list
 * free of Phaser, which is what lets `reachability.test.ts` check it in node.
 *
 * **There is no Blacksmith here and that is a finding, not an omission** (D-28).
 * The pack ships two premade townsfolk, Gaston and Alaric, and
 * `npc-merchant-idle.png` is already a copy of Alaric — so a blacksmith placed
 * today would be the shopkeeper's identical twin standing in a field. The fix is
 * a decision about the MERCHANT's appearance, not the blacksmith's.
 */
export interface VillagerDef {
  /** The character this body belongs to. Also the key into the dialogue table. */
  readonly id: 'merchant' | 'chef';
  /** Art key, from the manifest. */
  readonly artKey: string;
  readonly tile: TilePoint;
}

export const VILLAGERS: readonly VillagerDef[] = [
  { id: 'merchant', artKey: NPC_MERCHANT_IDLE.key, tile: MERCHANT_NPC_TILE },
  { id: 'chef', artKey: NPC_CHEF_IDLE.key, tile: CHEF_NPC_TILE },
];

/**
 * The chest, west of the path spine.
 *
 * **Moved from x=8 in T-15.08, and the reason is collision.** The chest's art
 * is 15px wide inside a 32px frame (`OBJ_COLLISION_BASE`), offset far enough
 * right that at x=8 its footing straddled the tile boundary and covered tiles 8
 * AND 9 — so it made **plot (9,10) permanently unreachable** and severed the
 * north-south path spine at y=10. Neither was visible before anything was
 * solid, which is exactly why it survived: the chest was simply drawn over the
 * top-left plot and nobody could tell.
 *
 * At x=6 the footing covers tiles 6-7: clear of the field (which starts at
 * x=9), clear of the path spine (x=8), and well below the house footprint
 * (x 6-13, y 1-6 since T-15.29). The player walks the spine and faces west to
 * open it.
 *
 * **Row 9 rather than row 10, since T-18.05.** Moving the merchant's stall off
 * the path put its top row on y=10, and the stall art is two tiles wide from
 * x=5 — so at (6,10) the chest and the counter overlapped by a few pixels in
 * cell (6,10), with the stall (the lower ground row) drawn over the chest's
 * corner. One row north is open grass, still faced from the spine at (8,9), and
 * still clear of the house's bottom edge at y=6.
 */
export const CHEST_TILE: TilePoint = placedObject(OBJ_CHEST.key);

/**
 * The shipping box, on the north verge of the y=13 run beside the field's
 * south-east corner.
 *
 * Moved off the run by T-18.05 for the same reason as the mailbox and the
 * stall: at (14,13) its measured footing covered the path tile it stood on, and
 * walking east along the lane stopped at tile 13.
 */
export const SHIPPING_BOX_TILE: TilePoint = placedObject(OBJ_SHIPPING_BOX.key);

/**
 * Frame 2 of `obj-maple-tree`: a full mature green tree with its ground shadow
 * (row 0, col 2 — picked by rendering a magenta grid overlay over the sheet and
 * reading it, see the T-7.06 write-up).
 */
export const MAPLE_TREE_FRAME = 2;

export const TREES: readonly TilePoint[] = placedObjects(OBJ_MAPLE_TREE.key);

/** Every map object's anchor tile, for callers that need them as a set. */
export const OBJECT_TILES: readonly TilePoint[] = [
  MAILBOX_TILE,
  MERCHANT_TILE,
  CHEST_TILE,
  SHIPPING_BOX_TILE,
  // Not a map object, but it occupies ground the same way — listed so decor
  // placement cannot drop a scarecrow on the shopkeeper (T-18.02).
  MERCHANT_NPC_TILE,
  // And on the Chef (T-33.03).
  CHEF_NPC_TILE,
];

/* ------------------------------------------------------------------ *
 * What the map's objects actually stand on (T-18.05)
 * ------------------------------------------------------------------ */

/**
 * Everything the generator places, paired with the art key its FOOTING is
 * measured under in `OBJ_COLLISION_BASE`.
 *
 * `OBJECT_TILES` above is a list of anchor cells and answers "is this ground
 * spoken for". That is not the same question as "can the player walk here", and
 * the gap between them is BUG-07: the mailbox, the stall and the shipping box
 * were each placed *on* the y=13 path run, each anchored on a single cell of
 * it, and each — once T-15.05 measured their footings — solid. Four separate
 * checks looked at the anchors and none of them noticed, because an anchor on a
 * path is not obviously wrong; a FOOTING on a path is.
 *
 * The keys are the same ones `Farm.buildMapObjects` resolves out of the map at
 * runtime, so this list and the map cannot disagree about which art is where
 * without `farmMap.test.ts` saying so.
 */
export interface FarmObject {
  readonly key: string;
  readonly tile: TilePoint;
}

export const MAP_OBJECTS: readonly FarmObject[] = MAP_PLACED_OBJECTS.map((o) => ({
  key: o.key,
  tile: { x: o.x, y: o.y },
}));

/**
 * The bottom-left anchor, in map pixels, that Tiled hangs a tile-object from.
 *
 * One definition rather than the `{ x: t.x * 16, y: (t.y + 1) * 16 }` that had
 * been copied into two test files and the scene: getting the `+ 1` wrong shifts
 * every footing by a tile, and a footing that is wrong by a tile is exactly the
 * bug this module now exists to catch.
 */
export function objectAnchorPx(tile: TilePoint): TilePoint {
  return { x: tile.x * TILE_SIZE, y: (tile.y + 1) * TILE_SIZE };
}

export interface ObjectFooting {
  readonly key: string;
  readonly anchor: TilePoint;
  readonly tiles: readonly TilePoint[];
}

/**
 * Every solid thing standing on the farm's ground, and the tiles it covers.
 *
 * Includes the shopkeeper, who is not a map object at all: they are placed by a
 * constant and blocked by `Farm.buildMapObjects` as a bare cell, so a caller
 * asking "what is solid out there" that consulted only the map would miss them.
 * Objects with no measured base are skipped, matching `objectTiles()` in the
 * client — an unmeasured object is walk-through, never a whole guessed cell.
 */
export function objectFootings(): ObjectFooting[] {
  const footings: ObjectFooting[] = [];

  for (const { key, tile } of MAP_OBJECTS) {
    const base = OBJ_COLLISION_BASE[key];
    if (!base) continue;

    const box = objectFootprint(objectAnchorPx(tile), base);
    const tiles: TilePoint[] = [];
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) tiles.push({ x, y });
    }
    footings.push({ key, anchor: tile, tiles });
  }

  /*
   * Every villager blocks their own tile (T-18.02, T-33.03).
   *
   * D-14 said livestock must NOT be solid, because a full coop would pen its own
   * chickens in. A villager on open ground cannot do that: each stands on a cell
   * with free grass around it and nothing else within two tiles, so there is no
   * arrangement in which one encloses anything. `reachability.test.ts` proves it
   * against the worst-case world rather than this paragraph asserting it.
   *
   * Read from `VILLAGERS` so the next one needs no edit here.
   */
  for (const villager of VILLAGERS) {
    footings.push({ key: villager.artKey, anchor: villager.tile, tiles: [villager.tile] });
  }

  return footings;
}

/** Those footings, flattened — the `objects` block layer, off the map. */
export function solidObjectTiles(): TilePoint[] {
  return objectFootings().flatMap((f) => f.tiles);
}

/**
 * Which objects, if any, are standing on a drawn path run.
 *
 * Returns findings rather than throwing so both callers can use it: the
 * generator refuses to write the map (T-18.05), and the tests assert the list
 * is empty and can show what is in it when it is not.
 */
export function objectsBlockingPaths(): { footing: ObjectFooting; tile: TilePoint }[] {
  const onPath = new Set(pathTiles().map((t) => `${t.x},${t.y}`));
  const found: { footing: ObjectFooting; tile: TilePoint }[] = [];

  for (const footing of objectFootings()) {
    for (const tile of footing.tiles) {
      if (onPath.has(`${tile.x},${tile.y}`)) found.push({ footing, tile });
    }
  }

  return found;
}

/* ------------------------------------------------------------------ *
 * The map's decorative border
 * ------------------------------------------------------------------ */

/**
 * The farm's grass is drawn as a BOUNDED PATCH, not a hard rectangle.
 *
 * `ground-grass` is a single flat colour (`#79BF56`), so a map painted only
 * with it ends at the viewport edge with a straight line, which reads as
 * "the world was cut off" rather than "the farm ends here". The pack's own
 * `tileset-grass-spring` carries edge tiles: the same `#79BF56` interior with a
 * dark scalloped grass fringe on one side and transparency beyond it. Laying
 * those along the map's edges gives the farm a soft, deliberate boundary.
 *
 * **Measured, not guessed** (T-15.00, §9). Each frame below was cropped out of
 * the tileset at 8x and read directly; the fringe direction named in each
 * comment is what the pixels show. `tileset-grass-spring#57` — which the
 * previously-committed map used for four tiles at (2..5, 1) — was found to be
 * *pixel-identical* to `ground-grass`, a solid `#79BF56` square with no fringe
 * at all, so it is deliberately NOT used here: it drew nothing.
 *
 * Known gap, deliberately preserved for now: the top-right (29,0) and
 * bottom-right (29,21) corners are plain grass rather than mitred corner tiles,
 * and the bottom edge starts at x=2 while the top starts at x=1. That is what
 * the committed map has; reproducing it exactly is what let T-15.00 prove the
 * generator now regenerates the map faithfully. **T-15.28 should close the
 * frame** — it is a one-line change here once there is a test to catch it.
 */
export const BORDER = {
  /** Fringe along the TOP edge of the tile. Row 0. */
  top: { sheet: TILESET_GRASS_SPRING.key, frame: 10 },
  /** Fringe along the RIGHT edge. Column `FARM_WIDTH - 1`. */
  right: { sheet: TILESET_GRASS_SPRING.key, frame: 59 },
  /** Fringe along the BOTTOM edge. Row `FARM_HEIGHT - 1`. */
  bottom: { sheet: TILESET_GRASS_SPRING.key, frame: 81 },
  /** Grass with a strip of water down its left edge. Column `SHORE_COL`. */
  shore: { sheet: TILESET_GRASS_WATER_SPRING.key, frame: 92 },
  /** Rounded north-west corner where the top fringe meets the shoreline. */
  shoreCorner: { sheet: TILESET_GRASS_WATER_SPRING.key, frame: 8 },
} as const;

/**
 * How many tiles of the map's edge are decorative frame rather than farm
 * (T-18.03).
 *
 * One on every side: row 0 is the top fringe, row `FARM_HEIGHT - 1` the bottom
 * fringe, column `FARM_WIDTH - 1` the right fringe, and column 0 the water the
 * shoreline runs beside. Uniform, which is why `FARM_CONTENT` shares the map's
 * centre and the camera does not have to re-centre when it fits one instead of
 * the other.
 *
 * The camera uses this to answer a question the fit had never asked: *what
 * actually has to be on screen?* Requiring the full 480x352 bitmap made
 * `fitCamera` drop a whole zoom level to keep a scalloped grass edge visible.
 * The fringe exists so the farm reads as bounded land rather than as a
 * viewport crop — worth having, not worth halving the game for.
 */
export const BORDER_RING = 1;

/**
 * The ground the game is actually played on: the map inset by `BORDER_RING`.
 *
 * Everything that matters is inside it — the house at y1-6, the chicken yard,
 * the barn's bottom row at y20, the path runs. The camera guarantees this
 * rectangle is visible; the frame around it may be clipped.
 */
export const FARM_CONTENT = {
  tilesWide: FARM_WIDTH - BORDER_RING * 2,
  tilesHigh: FARM_HEIGHT - BORDER_RING * 2,
  /** In map pixels, which is what the camera fit needs. */
  width: (FARM_WIDTH - BORDER_RING * 2) * TILE_SIZE,
  height: (FARM_HEIGHT - BORDER_RING * 2) * TILE_SIZE,
} as const;

export interface BorderTile {
  readonly x: number;
  readonly y: number;
  readonly sheet: string;
  readonly frame: number;
}

/**
 * Every border tile, in paint order.
 *
 * Derived from `FARM_WIDTH`/`FARM_HEIGHT` rather than written out, so growing
 * the farm again (as T-12.02b did) re-frames it automatically instead of
 * leaving a fringe stranded mid-map.
 */
export function borderTiles(): BorderTile[] {
  const tiles: BorderTile[] = [];
  const lastX = FARM_WIDTH - 1;
  const lastY = FARM_HEIGHT - 1;

  // North-west corner, where the top fringe turns into the shoreline.
  tiles.push({ x: SHORE_COL, y: 0, ...BORDER.shoreCorner });

  // Top fringe, from just east of the corner to just west of the right edge.
  for (let x = SHORE_COL + 1; x < lastX; x++) tiles.push({ x, y: 0, ...BORDER.top });

  // Shoreline and right fringe run the full height between the corners.
  for (let y = 1; y < lastY; y++) {
    tiles.push({ x: SHORE_COL, y, ...BORDER.shore });
    tiles.push({ x: lastX, y, ...BORDER.right });
  }

  // Bottom fringe. Starts at SHORE_COL + 1 because the water column widens to
  // two tiles on the last row (see `waterTiles`).
  for (let x = SHORE_COL + 1; x < lastX; x++) tiles.push({ x, y: lastY, ...BORDER.bottom });

  return tiles;
}

/**
 * Every water tile.
 *
 * `WATER_COLS` for every row, plus one extra at the foot of the shoreline
 * column: the shore tile's own water strip has nothing below it on the last
 * row, and leaving grass there ends the river in mid-air.
 */
export function waterTiles(): TilePoint[] {
  return MAP_SOLID_TERRAIN.map((t) => ({ x: t.x, y: t.y }));
}

/* ------------------------------------------------------------------ *
 * Animated ground
 * ------------------------------------------------------------------ */

/**
 * Where the map stamps an animation.
 *
 * **The river actually moves now.** The water column has always been the flat
 * `water-tile` fill, with the only motion coming from the camera-sized backdrop
 * *behind* the whole map — so the water beyond the map's edge rippled and the
 * water inside it sat perfectly still. Two kinds of water, one of them frozen,
 * a tile apart. Stamping `water-ripple` on the same cells `waterTiles()`
 * paints closes that.
 *
 * Derived from `waterTiles()` rather than written out, for the reason
 * `borderTiles` gives about itself: growing the farm again should not leave a
 * stripe of still water where the map used to end.
 */
export function groundAnimationPlacements(): GroundAnimationPlacement[] {
  return waterTiles().map((tile) => ({ x: tile.x, y: tile.y, animId: 'water-ripple' }));
}

/* ------------------------------------------------------------------ *
 * Ground scatter — the `decor` tile layer (T-18.09)
 * ------------------------------------------------------------------ */

/**
 * Tufts, flowers and loose stones sprinkled over the grass.
 *
 * The map has carried an EMPTY `decor` tile layer since it was first authored,
 * and the farm was a flat `#79bf56` field because of it. The grass fill is one
 * solid colour — it was a hand-drawn tile when this was written and is now the
 * pack's own flat fill, but either way it is a single colour, so every square
 * metre of the farm looked identical to every other.
 *
 * **Every frame here is measured, not picked by eye** (§9). All 264 cells of
 * `TILESET_PROPS_SEASONS` were profiled for alpha coverage, bounding box and
 * whether the art touches the cell edge; these are the ones that are
 * self-contained (they do not run into the next cell, so they can be dropped
 * anywhere) and FLAT.
 *
 * **Flat is the constraint that decides the list.** The `decor` layer draws at
 * `DEPTH.decor`, *below* every world sprite — so a tall flower put here would
 * be drawn behind the player even when the player is standing north of it, from
 * every angle, permanently. The sheet's standing flowers, mushrooms and
 * driftwood are all excluded for that reason; they would each have to be a
 * `DecorPiece` sorting on its own feet. Grass and pebbles have no height to get
 * wrong: you walk over them.
 */
export const GROUND_SCATTER = {
  sheet: TILESET_PROPS_SEASONS.key,
  /**
   * Spring tufts and small flowers, sheet row 0.
   *
   * Frames 0 and 4 are in the same band and deliberately left out: both carry a
   * brown lump that reads as bare earth rather than grass, which is a hole in
   * the lawn at farm zoom. The six kept are pure tufts (1, 5) and tufts with
   * white/yellow/pink flowers (2, 3, 6, 7). None is a pixel duplicate of
   * another — checked, because T-15.00 found `tileset-grass-spring#57` to be
   * pixel-identical to plain grass and drawing nothing at all.
   */
  tufts: [1, 2, 3, 5, 6, 7],
  /** Loose stones, sheet row 6. Flat, 11-15px tall inside their cell. */
  stones: [132, 133, 134, 137, 138],
} as const;

/** Scatter is painted the same way the border is: a tile, a sheet, a frame. */
export type ScatterTile = BorderTile;

/** Every frame the generator scatters, tufts and stones together. */
const SCATTER_FRAMES = new Set<number>([...GROUND_SCATTER.tufts, ...GROUND_SCATTER.stones]);

/**
 * Whether a palette cell is one the farm's own scatter uses.
 *
 * **A vouched-for list, not a measurement.** These eleven frames were picked by
 * hand for the `decor` layer against the constraint above — flat, no height to
 * get wrong, safe to walk over — and none is a pixel duplicate of another. The
 * rest of the sheet is not *forbidden*; it simply has not been checked, and the
 * ones that read as standing objects will draw behind the player forever if they
 * go on this layer.
 *
 * The editor marks these so someone adding grass by hand can match what is
 * already on the map, and find what to erase.
 */
export function isGroundScatterFrame(sheetKey: string, frame: number): boolean {
  return sheetKey === GROUND_SCATTER.sheet && SCATTER_FRAMES.has(frame);
}

/**
 * How much of the open grass gets something on it, per thousand tiles.
 *
 * Tuned by looking at it rather than derived: below about 10% the farm still
 * reads as flat, and above about 20% the field starts to look overgrown rather
 * than tended, which is the wrong note for a farm the player is keeping. Stones
 * are much rarer than grass because a stone is an event and a tuft is texture.
 */
export const SCATTER_PER_MILLE = { tufts: 150, stones: 35 } as const;

/**
 * A stable hash of a tile coordinate, 0..999.
 *
 * Deterministic and position-based rather than a seeded sequence, so the
 * scatter does not move when the map is regenerated, when the farm grows, or
 * when this function is called in a different order. The map is committed
 * (D-13); a scatter that shuffled every run would make every regeneration a
 * large diff and `farmMap.test.ts` unable to say anything useful.
 *
 * The two multipliers are the usual large odd primes used for spatial hashing;
 * nothing about them is tuned.
 */
function tileHash(x: number, y: number, salt: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) % 1000;
}

/**
 * Every tile the scatter goes on, and what goes there.
 *
 * `openGrass` is the caller's answer to "which tiles are plain, walkable,
 * unspoken-for grass" — passed in rather than computed here because the full
 * answer needs the building footprints, the yards and the measured object
 * footings, and `pasture.ts` and `collision.ts` own those. Keeping the
 * eligibility rule at the call site is also what stops this quietly disagreeing
 * with `reservedFarmTiles`.
 */
export function scatterTiles(openGrass: Iterable<TilePoint>): ScatterTile[] {
  const out: ScatterTile[] = [];

  for (const tile of openGrass) {
    const roll = tileHash(tile.x, tile.y, 1);

    if (roll < SCATTER_PER_MILLE.stones) {
      const frames = GROUND_SCATTER.stones;
      out.push({
        ...tile,
        sheet: GROUND_SCATTER.sheet,
        frame: frames[tileHash(tile.x, tile.y, 2) % frames.length]!,
      });
      continue;
    }

    if (roll < SCATTER_PER_MILLE.stones + SCATTER_PER_MILLE.tufts) {
      const frames = GROUND_SCATTER.tufts;
      out.push({
        ...tile,
        sheet: GROUND_SCATTER.sheet,
        frame: frames[tileHash(tile.x, tile.y, 3) % frames.length]!,
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Flat fills
 * ------------------------------------------------------------------ */

/** The tiles the generator uses for the map's three flat areas. */
/**
 * What the ground layer is painted with.
 *
 * **All three now come from the pack** (MVP re-scope). Grass and path were
 * flat first-party tiles drawn because T-7.05 measured the incomplete pack and
 * found no tile that fills its cell edge to edge; the complete pack has one in
 * every terrain block, at the same position each time — see
 * `docs/art-measurements.md`.
 *
 * Water is unchanged: `WATER_TILE` was always the pack's own flat fill, and it
 * is the one surface T-7.05 did not have to synthesise.
 */
export const GROUND_FILL = {
  grass: { sheet: TILESET_GRASS_SPRING.key, frame: GRASS_FILL_FRAME },
  /**
   * The field, before a hoe touches it.
   *
   * T-9.04 stopped stamping plot cells with dry soil, because that made every
   * plot look hoed before anyone had touched one — soil is server state and
   * the client draws it per plot. But the correction went one step too far:
   * plots became plain grass, so nothing on screen said where the field WAS.
   * The orange band gives the middle answer — visibly tillable ground, with no
   * claim about whether it has been tilled.
   */
  tillable: { sheet: TILESET_GRASS_SPRING.key, frame: TILLABLE_FILL_FRAME },
  path: { sheet: TILESET_PATHS.key, frame: PATH_FILL_FRAME },
  water: { sheet: WATER_TILE.key, frame: 0 },
} as const;
