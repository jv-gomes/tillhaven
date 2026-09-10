import {
  TILE_SIZE,
  CHAR_ART,
  HOUSE_TIER_ART,
  COOP_TIER_ART,
  BARN_TIER_ART,
  type BuildingLook,
} from './assets.js';
import {
  BARN_ANCHOR,
  COOP_ANCHOR,
  HOUSE_ANCHOR,
  type TileFootprint,
  type TilePoint,
} from './buildings.js';
import { AUTHORED_COLLISION } from './collision.generated.js';

/**
 * What the player bumps into (T-15.05).
 *
 * Until Phase 15 nothing on the farm was solid: `movement.ts` clamped the
 * player to a rectangle around the map and that was the whole of it, so you
 * walked through the house, every tree, the water and the animals. The pieces
 * of the answer that BOTH sides need live here — the client to stop the
 * player, the server to keep placed decor off ground that is already taken
 * (§4.4).
 *
 * Nothing here is authority over the player's position. Collision is a
 * client-side UX gate like adjacency and facing (§5.1, §4.1); the server never
 * learns where anyone is standing.
 */

/* ------------------------------------------------------------------ *
 * The player's collider
 * ------------------------------------------------------------------ */

/**
 * The player's collision box, in pixels around their FEET position.
 *
 * **A feet box, not the silhouette.** `CHAR_ART` is 11px wide and 19px tall,
 * but a 19px-tall collider is wrong for a top-down game: it would let a tree
 * block the player's *head*, so you could not walk behind a canopy you can
 * plainly see over. Only the ground contact collides; everything above it is a
 * depth-sorting question, not a collision one.
 *
 * `halfWidth: 5` gives a 10px box, narrower than `CHAR_ART`'s 11px on purpose:
 * a 16px gap between two solid tiles has to be walkable without pixel-perfect
 * alignment, and 3px of clearance either side is the difference between "I
 * walked through the gate" and "I got stuck on the gate".
 *
 * `height: 6` is measured up from the feet, covering the character's boots and
 * the shadow they stand in.
 */
export const PLAYER_COLLIDER = { halfWidth: 5, height: 6 } as const;

export interface PixelRect {
  /** Offsets from the art's LEFT edge, inclusive. */
  readonly left: number;
  readonly right: number;
  /** Height in px, measured UP from the art's bottom edge. */
  readonly height: number;
}

/* ------------------------------------------------------------------ *
 * Map object bases
 * ------------------------------------------------------------------ */

/**
 * Where each map object meets the ground.
 *
 * **Measured, never guessed** (§9) — `node scripts/measure-object-bases.mjs`
 * prints these, along with the per-row alpha profile they were read from.
 *
 * Why measuring was necessary: `farm.json` records the object's CELL, which for
 * this pack is routinely far larger than the art in it. Deriving footprints
 * from the declared box would have made the mailbox 2x2 tiles of solid ground
 * and the shipping box 3x4. Nor is the alpha bounding box right — that includes
 * a tree's canopy, which the player walks BEHIND. The base is specifically the
 * horizontal extent of the bottom quarter of the art: the trunk, the post, the
 * crate's front face.
 *
 * The shipping box needed one more correction: `obj-shipping-box.png` is a
 * 48x64 kit of three crates and the scene draws only `OBJ_SHIPPING_BOX_LOOK`
 * (cell 0, 16x16). Measuring the file rather than the look reported a 3-tile
 * base for a 1-tile object.
 */
export const OBJ_COLLISION_BASE: Readonly<Record<string, PixelRect>> = {
  // 12px trunk inside a 32px frame; the canopy above it is walk-behind.
  'obj-maple-tree': { left: 11, right: 22, height: 8 },
  // 15px chest inside a 32px frame.
  'obj-chest': { left: 8, right: 22, height: 4 },
  // 10px post inside a 16px frame.
  'obj-mailbox': { left: 4, right: 13, height: 5 },
  // 15px stall inside a 16px frame.
  'obj-newsstand': { left: 1, right: 15, height: 7 },
  // The ONE drawn crate (OBJ_SHIPPING_BOX_LOOK), not the 3-crate kit.
  'obj-shipping-box': { left: 0, right: 15, height: 4 },
};

/**
 * The tiles an object's base covers, from its BOTTOM-LEFT anchor in map pixels.
 *
 * Rounded **outwards**, matching `footprintOf` in `buildings.ts`: a tile that
 * is half covered is still a tile you cannot stand in. That does over-block a
 * little — the maple's 12px trunk straddles a tile boundary and therefore
 * blocks two 16px tiles — but the alternative rules are worse. Majority
 * coverage would block *neither* of those tiles (5px and 7px of 16), letting
 * the player walk through the trunk; nearest-tile would pick one arbitrarily
 * and leave a visibly wrong half. Blocking a whole tile per tree is also what
 * the genre does.
 */
export function objectFootprint(anchorPx: TilePoint, base: PixelRect): TileFootprint {
  return {
    x0: Math.floor((anchorPx.x + base.left) / TILE_SIZE),
    x1: Math.ceil((anchorPx.x + base.right + 1) / TILE_SIZE) - 1,
    y0: Math.floor((anchorPx.y - base.height) / TILE_SIZE),
    y1: Math.ceil(anchorPx.y / TILE_SIZE) - 1,
  };
}

/* ------------------------------------------------------------------ *
 * Buildings
 * ------------------------------------------------------------------ */

/**
 * Which tiles of a building actually stop the player (T-23.02).
 *
 * **Buildings used to collide with their roofs**, and that is what this fixes.
 * `footprintOf` makes every tile the art's bounding box touches solid, which is
 * right for reserving ground and wrong for stopping a character. Measured on the
 * tier-0 farmhouse, **six of its forty-eight solid tiles contained no drawn
 * pixels at all**, and the top row was 10.6% covered — a 20px chimney cap
 * walling off eight tiles of visible grass. Walking the north edge of the map
 * met an invisible wall.
 *
 * Map objects never had the problem: `OBJ_COLLISION_BASE` above already answers
 * this question for them, so a maple blocks its 12px trunk and its canopy is
 * walk-behind. **The roof is the canopy.**
 *
 * **A mask, not a rectangle, and the measurement is why.** The first attempt
 * here was "the bottom N pixels are solid". The tests rejected it: several
 * buildings have a wing whose base sits higher than the rest, leaving the tiles
 * below it empty at ground level. `obj-farmhouse-t1` has seven such tiles. Those
 * are not the building — in this projection, empty pixels BELOW a wall are the
 * yard in front of it, and a player should walk there.
 *
 * **The roof mass stays solid, deliberately.** A second attempt freed it
 * entirely, so the player could walk behind a building the way they already
 * walk behind a maple's canopy. `reachability.test.ts` rejected THAT: the idle
 * replay walks straight octile lines with no avoidance (D-8), so the pocket
 * behind the house is a concave trap — a greedy walker slides along a wall only
 * while it has a lateral component, and once its x matches the target's it
 * wedges and stops. Twenty plot approaches failed from one start, and the
 * north-west maple is an idle chop target, so the farmer would have routed
 * through there routinely and then had its collision dropped by the 2s unstick,
 * walking visibly through the farmhouse. The silhouette blocks; nothing else.
 *
 * **Generated by `scripts/measure-building-bodies.mjs`, then reviewed.** The
 * script proposes a mask at >=25% tile coverage and a human checks it against
 * the art. The farmhouse chimney is KEPT — it sits on solid roof rather than
 * floating, so it is a bump in the silhouette; the coop and barn taper to a
 * roof apex, which is the roof's own mass and reads as the triangle a player
 * sees.
 *
 * Rows read TOP-DOWN, so each literal looks like the building it describes:
 * `#` stops the player, `.` is walk-behind roof or walk-on yard. An art with no
 * entry falls back to its full bounding box — the old, over-solid behaviour —
 * so forgetting to measure a new building is visible rather than silent.
 */
export const SUBTILE_RESOLUTION = 3 as const;

/**
 * A building mask is authored in 3x3 sub-tiles per world tile, which gives a
 * finer contour without changing the building's footprint.
 *
 * **These masks now reach the player.** Until the sub-tile collision work they
 * were reduced back to whole tiles by `SUBTILE_SOLID_THRESHOLD` before movement
 * ever saw them — the measurement was taken and then thrown away, and every
 * building collided as a rectangle. `maskToCells` below is the same mask with
 * no reduction step, and it is what the runtime reads.
 *
 * The threshold and the `*Tiles` functions are still here and still used: the
 * SERVER's reachability flood fill works in whole tiles (see `maskToCells`),
 * and reducing a mask is exactly how it gets a whole-tile answer.
 */
export const BUILDING_BODY_MASK: Readonly<Record<string, readonly string[]>> = {
  /*
   * The tier-0 farmhouse, at 3x sub-tile resolution: 24x18 micro-cells for an
   * 8x6-tile building.
   *
   * **Measured from `obj-farmhouse.png`'s alpha, not hand-drawn.** The
   * hand-written version was 21 rows — SEVEN tiles tall for six tiles of art —
   * which put a phantom row of collision above the roof and re-created the
   * invisible wall along the north edge that T-23.03 removed. Each micro-cell
   * here is `#` where at least a quarter of its pixels are drawn, the same
   * rule `scripts/measure-building-bodies.mjs` proposes.
   *
   * **The micro-grid is laid out on the 16px TILE grid measured up from the
   * art's ground line — not stretched over `look.height`.** The look box is
   * 87px tall, nine short of six whole tiles, so spreading eighteen micro-rows
   * across it compressed the whole building upward and made the top tile-row
   * read as solid roof. Measured correctly, tile row 0 is **4.6% covered** —
   * the chimney and nothing else, exactly the sparse top row T-23.03 found.
   *
   * Every other entry below is a COARSE mask, one character per world tile.
   * Both kinds are valid; `maskResolution` tells them apart by width.
   *
   * **Three coarse masks were one column too wide** — `obj-chicken-coop`
   * (5 for a 4-tile art) and `obj-chicken-coop-big` / `obj-barn-big` (ragged
   * 7-and-8 rows for 7-tile art). Each blocked a strip of visible grass down
   * the building's right-hand side, and the raggedness crashed the padding
   * outright once resolution entered the picture. All three are re-measured
   * from their own art here; `sizes every building mask to the art it
   * describes` now refuses the whole class.
   */
  /*
   * **The west wall is authored straight, and the art is not.**
   *
   * Measured, the farmhouse insets its west edge by about five pixels at the
   * top (rows 4-6) and again at the bottom (rows 14-17) — so a faithful mask
   * steps in and out by a single sub-cell. A mask is a collision approximation,
   * not a tracing, and a one-cell step is a trap: the player's collider is 10px
   * and a cell is 5.33px, so the character wedges half of itself into standing
   * room it cannot walk out of. The idle replay, which steers in straight
   * octile lines with no obstacle avoidance (D-8), walked south-east into
   * exactly this step and stopped — twenty plots unreachable from one start,
   * caught by `reachability.test.ts` before a player could meet it.
   *
   * `noSubCellSteps` in `cells.test.ts` enforces the rule on every mask here,
   * so the next one cannot reintroduce it quietly. The cost is five pixels of
   * yard down the west side, which nobody can see.
   */
  'obj-farmhouse': [
    '........................',
    '......##................',
    '......##................',
    '....#####...............',
    '########################',
    '########################',
    '#######################.',
    '#######################.',
    '#######################.',
    '#######################.',
    '#######################.',
    '#######################.',
    '#######################.',
    '#######################.',
    '#######################.',
    '#####################...',
    '#############...........',
    '#############...........',
  ],
  // Tier 1's right wing is set back further still — the front yard remains open.
  'obj-farmhouse-t1': ['.##.....', '########', '########', '########', '########', '####....'],
  'obj-farmhouse-t2': ['..#.....', '.#######', '########', '########', '########', '########', '########'],

  // Coop and barn taper to a roof apex rather than carrying furniture on top,
  // so their top rows are the roof's own mass and stay solid — the triangular
  // silhouette is what a player sees and what they should walk around. The
  // contour is intentionally tighter than a full box, leaving the approach lane
  // readable and keeping the passable yard around the building.
  'obj-chicken-coop': ['.##.', '####', '####', '####', '####'],
  'obj-chicken-coop-big': ['...##..', '..####.', '#######', '#######', '#######', '######.'],
  'obj-chicken-coop-deluxe': ['...##....', '..####...', '..#####..', '..#####..', '########.', '#########', '#########', '#########'],

  'obj-barn': ['.##..', '####.', '####.', '#####', '#####'],
  'obj-barn-big': ['.###...', '######.', '######.', '######.', '######.', '######.'],
  'obj-barn-deluxe': ['..###...', '#######.', '#######.', '#######.', '#######.', '#######.', '########', '#######.'],
};

/**
 * How much of a world tile must be drawn before the tile stops the player.
 *
 * **A threshold, not "any pixel", and that distinction is the whole reason a
 * sub-tile mask is worth having.** Reducing a 3x3 block with OR — solid if any
 * micro-cell is `#` — can only ever make the silhouette *coarser* than the
 * mask that produced it: one micro-cell of chimney re-blocks its whole tile,
 * which is precisely the invisible wall T-23.03 removed. A finer mask that
 * cannot carve is a finer mask for nothing.
 *
 * 1/3 rather than a half, because it matches what
 * `scripts/measure-building-bodies.mjs` already proposes from the art (>=25%
 * coverage) and errs solid: a wall you can see beats a wall you cannot, which
 * is the same direction every other default in this file leans.
 */
export const SUBTILE_SOLID_THRESHOLD = 1 / 3;

/**
 * Reduces a silhouette mask to the world tiles it blocks.
 *
 * **The mask's resolution is derived, not assumed.** `BUILDING_BODY_MASK`
 * holds two kinds of entry: coarse masks with one character per world tile
 * (the coop, the barn, the tier-1 and tier-2 houses) and sub-tile masks with
 * `SUBTILE_RESOLUTION` characters per world tile (the tier-0 farmhouse).
 * Running a coarse mask through a fixed resolution of 3 reads a five-tile coop
 * as under two tiles wide — buildings quietly shrank to a third of themselves
 * and the player walked through them.
 *
 * So the caller passes the art's width in world tiles and the resolution falls
 * out of the mask itself. A mask whose width is not a whole multiple of that
 * is a mistake worth failing loudly on rather than padding into silence.
 */
export function subTileMaskToTiles(
  anchor: TilePoint,
  mask: readonly string[],
  // `number`, not the literal type of `SUBTILE_RESOLUTION`: the resolution is
  // now derived per mask and 1 is as valid as 3.
  resolution: number = SUBTILE_RESOLUTION,
): TilePoint[] {
  const tiles = new Map<string, TilePoint>();
  const rows = mask.length;
  const cols = maskCols(mask);

  if (!rows || !cols || resolution < 1) {
    return [];
  }

  const paddedRows = Math.ceil(rows / resolution) * resolution;
  const paddedCols = Math.ceil(cols / resolution) * resolution;
  const padded = Array.from({ length: paddedRows }, (_, row) => {
    const source = mask[row] ?? '';
    return (source + '.'.repeat(paddedCols - source.length)).slice(0, paddedCols);
  });

  const perTile = resolution * resolution;
  const needed = Math.max(1, Math.ceil(perTile * SUBTILE_SOLID_THRESHOLD));

  for (let y = 0; y < paddedRows; y += resolution) {
    for (let x = 0; x < paddedCols; x += resolution) {
      let drawn = 0;
      for (let microY = 0; microY < resolution; microY++) {
        for (let microX = 0; microX < resolution; microX++) {
          if ((padded[y + microY]?.[x + microX] ?? '.') === '#') drawn++;
        }
      }

      if (drawn >= needed) {
        const worldX = anchor.x + Math.floor(x / resolution);
        const worldY = anchor.y - Math.ceil(paddedRows / resolution) + Math.floor(y / resolution);
        tiles.set(`${worldX},${worldY}`, { x: worldX, y: worldY });
      }
    }
  }

  return [...tiles.values()];
}

/**
 * The resolution a mask is authored at, derived from how wide the art is.
 *
 * Returns 1 for a coarse mask and `SUBTILE_RESOLUTION` for a sub-tile one —
 * and 1 for anything that divides unevenly, which is the safe reading: a
 * misread coarse mask over-blocks, a misread sub-tile mask lets the player
 * walk through a wall.
 */
export function maskResolution(mask: readonly string[], tileCols: number): number {
  const cols = maskCols(mask);
  if (tileCols <= 0 || cols <= 0) return 1;

  const ratio = cols / tileCols;
  return Number.isInteger(ratio) && ratio >= 1 ? ratio : 1;
}

/**
 * The widest row, not the first.
 *
 * Two masks in the table have ragged rows (`obj-chicken-coop-big` and
 * `obj-barn-big` mix 7- and 8-character rows), and reading the width off row 0
 * made the padding compute a negative repeat and throw `Invalid count value`.
 * Ragged authoring is tolerated and padded with empty space; it is not a
 * reason to crash.
 */
function maskCols(mask: readonly string[]): number {
  return mask.reduce((widest, row) => Math.max(widest, row.length), 0);
}

/** A mask's size in WORLD TILES, whatever resolution it is authored at. */
export function maskTileSize(
  mask: readonly string[],
  resolution: number,
): { readonly cols: number; readonly rows: number } {
  return {
    cols: Math.ceil(maskCols(mask) / resolution),
    rows: Math.ceil(mask.length / resolution),
  };
}

/**
 * Whether one world tile of a mask is solid.
 *
 * **The single definition of that question**, shared by the tile-list, the
 * broad-phase box and the exact per-tile test. They disagreed once — the
 * sub-tile mask landed in `subTileMaskToTiles` while the other two kept
 * indexing the mask one character per tile, so a 3x mask made the farmhouse
 * report a 24-tile-wide box and answer the exact test with a micro-cell. One
 * function means they cannot drift again.
 */
export function maskTileIsSolid(
  mask: readonly string[],
  resolution: number,
  tileX: number,
  tileY: number,
): boolean {
  const { cols, rows } = maskTileSize(mask, resolution);
  if (tileX < 0 || tileY < 0 || tileX >= cols || tileY >= rows) return false;

  const perTile = resolution * resolution;
  const needed = Math.max(1, Math.ceil(perTile * SUBTILE_SOLID_THRESHOLD));

  let drawn = 0;
  for (let microY = 0; microY < resolution; microY++) {
    for (let microX = 0; microX < resolution; microX++) {
      const row = mask[tileY * resolution + microY];
      if ((row?.[tileX * resolution + microX] ?? '.') === '#') drawn++;
    }
  }
  return drawn >= needed;
}

/**
 * Broad, cheap phase of collision.
 *
 * This is the "am I anywhere near the building?" gate. It is intentionally a
 * rectangle and never blocks a player by itself; it only decides whether we
 * should run the much more precise silhouette test.
 */
export function buildingBodyFastFootprint(anchor: TilePoint, art: BuildingLook): TileFootprint {
  const mask = BUILDING_BODY_MASK[art.sheet.key];
  const artCols = Math.ceil(art.look.width / TILE_SIZE);
  // In WORLD TILES. A 3x sub-tile mask is 24 characters wide for an 8-tile
  // building, and reading that as 24 tiles made the broad phase three times
  // too wide — so the box comes from the mask's tile size, not its length.
  const size = mask ? maskTileSize(mask, maskResolution(mask, artCols)) : null;
  const rows = size ? size.rows : Math.ceil(art.look.height / TILE_SIZE);
  const cols = size ? size.cols : artCols;

  return {
    x0: anchor.x,
    x1: anchor.x + cols - 1,
    y0: anchor.y - rows,
    y1: anchor.y - 1,
  };
}

/**
 * Convenience version of the fast phase as plain tile coordinates. Useful when a
 * caller wants the broad box without a custom bounds check.
 */
export function buildingBodyFastTiles(anchor: TilePoint, art: BuildingLook): TilePoint[] {
  const box = buildingBodyFastFootprint(anchor, art);
  const tiles: TilePoint[] = [];
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) tiles.push({ x, y });
  }
  return tiles;
}

/**
 * Exact collision test for one tile when the player already entered the broad
 * building box. This is the second phase: the broad box only decides whether to
 * consider the building; the mask decides whether the tile actually stops the
 * player.
 */
export function buildingBodyExactTile(anchor: TilePoint, art: BuildingLook, tileX: number, tileY: number): boolean {
  const mask = BUILDING_BODY_MASK[art.sheet.key];
  if (!mask) {
    return false;
  }

  const resolution = maskResolution(mask, Math.ceil(art.look.width / TILE_SIZE));
  const { rows } = maskTileSize(mask, resolution);

  // Anchored bottom-left like every sprite here, so local row 0 is the TOP of
  // the building and `anchor.y - 1` is its bottom row.
  return maskTileIsSolid(mask, resolution, tileX - anchor.x, tileY - anchor.y + rows);
}

/**
 * The tiles a building's body covers — what the player collides with.
 *
 * Deliberately not `footprintOf`, which returns the whole bounding box and is
 * still correct for reservation. Anchored at the bottom-left like every sprite
 * here, so a taller roof grows into walkable space rather than into collision.
 */
export function buildingBodyTiles(anchor: TilePoint, art: BuildingLook): TilePoint[] {
  const mask = BUILDING_BODY_MASK[art.sheet.key];
  const rows = Math.ceil(art.look.height / TILE_SIZE);
  const cols = Math.ceil(art.look.width / TILE_SIZE);

  // No measurement yet: fall back to the full box. Over-solid is the safe
  // direction — a wall you can see beats a wall you cannot.
  if (!mask) {
    const tiles: TilePoint[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) tiles.push({ x: anchor.x + c, y: anchor.y - 1 - r });
    }
    return tiles;
  }

  // Coarse and sub-tile masks live in the same table, so the resolution comes
  // from the mask's own width against the art's — see `maskResolution`.
  return subTileMaskToTiles(anchor, mask, maskResolution(mask, cols));
}

/**
 * Every tile the buildings block **as they stand right now**, at the tiers the
 * farm has actually bought.
 *
 * Deliberately NOT `BUILDING_FOOTPRINTS`. That constant is each building's
 * LARGEST bounding box and exists so the map generator never puts a tree where
 * a Deluxe barn will one day go — it is about reserving ground, and it is
 * correct to be pessimistic. Collision is a different question twice over: a
 * player with a tier-0 coop must be able to walk where a Deluxe one would
 * later stand, **and nobody should ever be stopped by a roof**.
 *
 * Returns TILES rather than boxes since T-23.03, because a building's body is
 * not a rectangle — see `BUILDING_BODY_MASK`. Every caller already wrapped this
 * in `footprintsTiles`, so the rename cost them one call each and made the
 * shape honest.
 */
export function currentBuildingTiles(tiers: {
  readonly house?: number;
  readonly coop: number;
  readonly barn: number;
}): TilePoint[] {
  // `house` is optional and defaults to 0 so a caller that has not been taught
  // about house tiers yet gets the SMALLEST building — walkable ground that
  // turns out to be solid is a wall you cannot see, which is worse than the
  // reverse.
  const tier = <T,>(list: readonly T[], want: number): T => list[want] ?? list[0]!;

  return [
    ...buildingBodyTiles(HOUSE_ANCHOR, tier(HOUSE_TIER_ART, tiers.house ?? 0)),
    ...buildingBodyTiles(COOP_ANCHOR, tier(COOP_TIER_ART, tiers.coop)),
    ...buildingBodyTiles(BARN_ANCHOR, tier(BARN_TIER_ART, tiers.barn)),
  ];
}

/**
 * A building's body on the COLLISION grid — what the player actually collides
 * with since sub-tile collision landed.
 *
 * The twin of `buildingBodyTiles`, taking the same mask through `maskToCells`
 * instead of `subTileMaskToTiles`. The two must stay in step, which is why the
 * fallback and the resolution are derived here exactly as they are there rather
 * than reasoned about a second time — and why a test asserts one is a subset of
 * the other for every shipped mask.
 */
export function buildingBodyCells(anchor: TilePoint, art: BuildingLook): CellPoint[] {
  const mask = BUILDING_BODY_MASK[art.sheet.key];
  const rows = Math.ceil(art.look.height / TILE_SIZE);
  const cols = Math.ceil(art.look.width / TILE_SIZE);

  // Same reasoning as `buildingBodyTiles`: no measurement means the full box,
  // because over-solid is the safe direction.
  if (!mask) {
    const tiles: TilePoint[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) tiles.push({ x: anchor.x + c, y: anchor.y - 1 - r });
    }
    return tilesToCells(tiles);
  }

  return maskToCells(anchor, mask, maskResolution(mask, cols));
}

/** `currentBuildingTiles`, on the collision grid. */
export function currentBuildingCells(tiers: {
  readonly house?: number;
  readonly coop: number;
  readonly barn: number;
}): CellPoint[] {
  const tier = <T,>(list: readonly T[], want: number): T => list[want] ?? list[0]!;

  return [
    ...buildingBodyCells(HOUSE_ANCHOR, tier(HOUSE_TIER_ART, tiers.house ?? 0)),
    ...buildingBodyCells(COOP_ANCHOR, tier(COOP_TIER_ART, tiers.coop)),
    ...buildingBodyCells(BARN_ANCHOR, tier(BARN_TIER_ART, tiers.barn)),
  ];
}

/** The anchors those bodies hang from, for callers that need them. */
export const BUILDING_ANCHORS = { coop: COOP_ANCHOR, barn: BARN_ANCHOR } as const;

/* ------------------------------------------------------------------ *
 * Sanity, asserted by tests
 * ------------------------------------------------------------------ */

/**
 * True when the player can fit through a one-tile gap between two solid tiles.
 *
 * Pinned by `collision.test.ts` rather than left as a comment: a future tweak
 * to `PLAYER_COLLIDER.halfWidth` that made the box 16px wide would silently
 * make every doorway and every gap in a fence impassable, and the symptom
 * ("the character sticks sometimes") is miles from the cause.
 */
export function playerFitsThroughOneTileGap(): boolean {
  return PLAYER_COLLIDER.halfWidth * 2 < TILE_SIZE;
}

/**
 * True when the collider is no wider than the character actually drawn.
 *
 * A collider wider than the art blocks on empty pixels — the player stops a
 * visible gap short of a wall. `CHAR_ART` spans x 11..22, so the silhouette is
 * 11px and its half-width 5.5; a `halfWidth` of 5 sits just inside it.
 *
 * (Computed from `CHAR_ART` rather than from `Player.ts`'s `CHAR_FRAME_CENTRE`,
 * which is private to the client and derived from `CHAR_ORIGIN`. This needs the
 * art's own width, not its offset within the frame.)
 */
export function colliderFitsArt(): boolean {
  const artHalfWidth = (CHAR_ART.right - CHAR_ART.left) / 2;
  return PLAYER_COLLIDER.halfWidth <= artHalfWidth;
}

/* ------------------------------------------------------------------ *
 * The farmhouse door (T-16.11, D-7)
 * ------------------------------------------------------------------ */

/**
 * **D-7, decided: the door is a faced-tile trigger, not a walk-through gap.**
 *
 * This constant deliberately did not exist for the whole of Phase 15 — its
 * absence was the open decision. The alternative was a hole in the building's
 * footprint you could walk into, which is worse than it sounds: buildings are
 * solid at every tier, so a gap wide enough to enter is also a pocket you can
 * end up standing inside with the roof drawn over you. Facing a tile and
 * pressing the action key is what the chest, the shipping box and the merchant
 * already do, so it is the pattern the player has learned rather than a second
 * kind of interaction.
 *
 * **Measured, not centred.** `House.doorway()` returns the building's
 * bottom-CENTRE 2x2, which is where the door was assumed to be when every tier
 * shared one doorless silhouette. The farmhouse art has an actual door, and it
 * is not in the middle: profiling the non-wall pixels of the bottom band
 * (`OBJ_FARMHOUSE_LOOK` rows 65-87) gives one solid 16px-wide block at crop
 * columns 40-55, with the flower-box window at 16-29 and the porch edge at
 * 59-65. Sixteen pixels is exactly one tile, so the door is one tile, offset
 * two tiles right of the house's anchor.
 *
 * At tier 0 it lands on (8, 6), directly above where T-15.29 re-routed the path
 * spine to start "below the front door" — the two agree, which is the check
 * that this is the door and not a window.
 *
 * **The spine still meets the door at every tier** (T-17.06), which the plan
 * expected to be a problem and is not. Tiers 1 and 2 put the door one tile
 * further left — columns `anchor.x + 1..2` against tier 0's `+ 2..3` — so the
 * three tiers OVERLAP at `anchor.x + 2`, which is x=8, which is the spine.
 * A player walking up the path faces a door tile whatever house they own.
 */
/**
 * The door's crop columns **per tier** (T-17.06). The door moves when the house
 * upgrades; nothing else about this calculation does.
 *
 * **Measured the same way for all three, and the method self-checks.** Profile
 * the last opaque row of each look window: tier 0's is *exactly* x 40..55 and
 * tier 1's is *exactly* x 18..33 — sixteen pixels each, one tile, because the
 * bottom row of those sprites IS the doorstep and nothing else reaches the
 * ground. That reproduces `HOUSE_DOOR_ART_X0/X1`'s original numbers from the
 * art alone, which is the check that this is the door and not a window.
 *
 * Tier 2 has a full-width foundation course, so its last row says nothing.
 * Profiling the dark door panel in its wall band instead gives x 21..30, dead
 * centre on 25.5 — the same centre as tier 1's 18..33, so tier 2's door is at
 * the same columns as tier 1's. Two houses in a family drawn on the same grid.
 *
 * **The tile stays the sprite's bottom row at every tier**, including tier 2,
 * where the door art actually stops 23px higher (crop row ~85 of 109) with wall
 * and foundation below it. Putting the tile where the art is would make the
 * approach tile the foundation — inside the footprint, therefore solid, and
 * therefore a door you cannot stand in front of. Facing the base of the house
 * below the door is what the player already does at tier 0.
 */
export const HOUSE_DOOR_ART: readonly { readonly x0: number; readonly x1: number }[] = [
  { x0: 40, x1: 55 },
  { x0: 18, x1: 33 },
  { x0: 18, x1: 33 },
];

/**
 * Every tile the door art covers, and the tiles you stand on to face them.
 *
 * **The door straddles a tile boundary, so it is TWO tiles, not one.** The art
 * spans world pixels 136-151 with the house at its anchor: eight pixels in
 * column 8 and eight in column 9, split exactly down the middle. Rounding to a
 * single column is arbitrary, and worse than arbitrary in practice — the player
 * walks up to a door that is visibly right in front of them, presses the action
 * key on the half they happen to be standing at, and nothing happens.
 *
 * That is not hypothetical: the first version rounded to column 8 (and to 9
 * before an off-by-one was fixed), the browser put the character on column 9,
 * and the door did nothing at all. No test could have caught it, because both
 * columns are defensible in isolation — the mistake was answering a question
 * the art does not have a single answer to.
 *
 * The door tiles are INSIDE the house footprint and therefore solid: that is
 * the substance of D-7. Each `approach` is the tile directly below one, which
 * the building does not cover.
 */
export function houseDoorTile(
  anchor: { readonly x: number; readonly y: number },
  tier = 0,
): {
  readonly tiles: readonly { readonly x: number; readonly y: number }[];
  readonly approach: readonly { readonly x: number; readonly y: number }[];
} {
  const art = HOUSE_DOOR_ART[tier] ?? HOUSE_DOOR_ART[0]!;
  const first = anchor.x + Math.floor(art.x0 / TILE_SIZE);
  const last = anchor.x + Math.floor(art.x1 / TILE_SIZE);
  // Bottom-anchored sprite: its last covered pixel row is `anchor.y * 16 - 1`,
  // which is the row above the anchor.
  const y = anchor.y - 1;

  const tiles = [];
  for (let x = first; x <= last; x++) tiles.push({ x, y });

  return { tiles, approach: tiles.map((t) => ({ x: t.x, y: t.y + 1 })) };
}

/** True when this tile is part of the farmhouse door. */
export function isHouseDoorTile(
  anchor: { readonly x: number; readonly y: number },
  tileX: number,
  tileY: number,
  tier = 0,
): boolean {
  return houseDoorTile(anchor, tier).tiles.some((t) => t.x === tileX && t.y === tileY);
}

/* ------------------------------------------------------------------ *
 * The collision grid
 * ------------------------------------------------------------------ */

/**
 * Sub-tile collision.
 *
 * **There are now two grids, and they must never be confused.** `TilePoint` is
 * the GAMEPLAY grid: plots, the faced tile, building footprints, decor
 * placement, the server's reachability flood fill. `CellPoint` is the
 * COLLISION grid, three times finer on each axis, and it exists only to answer
 * "can the character stand here".
 *
 * They are deliberately structurally incompatible — `{cx, cy}` against
 * `{x, y}` — rather than the same shape with different meanings. A tile
 * coordinate passed where a cell was wanted is off by a factor of three, which
 * on a 30x22 farm reads as "collision is in the top-left corner of the map";
 * the compiler refusing it costs one rename and removes the whole class of bug.
 *
 * **Nothing in `movement.ts` changes for any of this.** `overlapsBlocked` and
 * `slide` were already written entirely in terms of `world.tileSize` with no
 * hard-coded 16, so handing them `COLLISION_CELL` makes collision sub-tile with
 * no change to the movement maths at all. The work is all in what feeds the
 * grid.
 */

/**
 * One collision cell, in world pixels. 16/3 = 5.33, deliberately fractional.
 *
 * `main.ts` sets `roundPixels: true`, so a character stopped on a fractional
 * world x still renders on a whole pixel. The tidier alternative — resolution
 * 4, giving 4px cells — would invalidate all nine measured
 * `BUILDING_BODY_MASK` entries and every terrain mask in
 * `docs/art-measurements.md`, to buy a rounder number nobody reads.
 */
export const COLLISION_CELL = TILE_SIZE / SUBTILE_RESOLUTION;

/** A cell of the collision grid. NOT a tile — see the note above. */
export interface CellPoint {
  readonly cx: number;
  readonly cy: number;
}

export function cellPoint(cx: number, cy: number): CellPoint {
  return { cx, cy };
}

/** The cell a world-pixel position falls in. */
export function cellOfPixel(px: number, py: number): CellPoint {
  return { cx: Math.floor(px / COLLISION_CELL), cy: Math.floor(py / COLLISION_CELL) };
}

/**
 * Every cell of one whole tile.
 *
 * The conversion every existing whole-tile collision source goes through, so
 * they behave exactly as they did before: a solid tile is nine solid cells.
 */
export function tileToCells(tile: TilePoint): CellPoint[] {
  const cells: CellPoint[] = [];
  for (let dy = 0; dy < SUBTILE_RESOLUTION; dy++) {
    for (let dx = 0; dx < SUBTILE_RESOLUTION; dx++) {
      cells.push({
        cx: tile.x * SUBTILE_RESOLUTION + dx,
        cy: tile.y * SUBTILE_RESOLUTION + dy,
      });
    }
  }
  return cells;
}

export function tilesToCells(tiles: Iterable<TilePoint>): CellPoint[] {
  const cells: CellPoint[] = [];
  for (const tile of tiles) cells.push(...tileToCells(tile));
  return cells;
}

/**
 * A silhouette mask straight to collision cells, with no reduction.
 *
 * **This is `subTileMaskToTiles` with the lossy step removed**, and it is the
 * point of the whole exercise. That function counts how much of each world
 * tile a mask covers and calls the tile solid at `SUBTILE_SOLID_THRESHOLD`;
 * this one keeps every `#` exactly where it was authored. A farmhouse roof that
 * clips a corner keeps the corner.
 *
 * **Anchored at the BOTTOM edge**, the same convention `subTileMaskToTiles` and
 * every Tiled tile-object use: the mask sits *above* `anchor`, whose own tile
 * row it does not cover. Getting this backwards moves every building down by
 * its own height.
 *
 * A coarse mask (resolution 1, one character per world tile) still works —
 * each character expands to a full `SUBTILE_RESOLUTION` square of cells, so the
 * five coarse entries in `BUILDING_BODY_MASK` keep their current shape while
 * the four sub-tile ones gain detail.
 */
export function maskToCells(
  anchor: TilePoint,
  mask: readonly string[],
  resolution: number = SUBTILE_RESOLUTION,
): CellPoint[] {
  const rows = mask.length;
  const cols = maskCols(mask);
  if (!rows || !cols || resolution < 1) return [];

  // How many cells one mask character covers on a side. 1 for a mask already
  // authored at the collision resolution, 3 for a coarse one.
  const scale = SUBTILE_RESOLUTION / resolution;
  if (!Number.isInteger(scale) || scale < 1) return [];

  const tileRows = Math.ceil(rows / resolution);
  // Top-left cell of the mask, in collision coordinates.
  const originX = anchor.x * SUBTILE_RESOLUTION;
  const originY = (anchor.y - tileRows) * SUBTILE_RESOLUTION;

  const cells = new Map<string, CellPoint>();
  for (let row = 0; row < rows; row++) {
    const line = mask[row] ?? '';
    for (let col = 0; col < cols; col++) {
      if ((line[col] ?? '.') !== '#') continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const cx = originX + col * scale + dx;
          const cy = originY + row * scale + dy;
          cells.set(`${cx},${cy}`, { cx, cy });
        }
      }
    }
  }
  return [...cells.values()];
}

/**
 * A measured pixel footing to collision cells.
 *
 * `OBJ_COLLISION_BASE` records each map object's footing in PIXELS, and
 * `objectFootprint` has always rounded that outwards to whole tiles — so the
 * chest's 15px base blocks two full cells and the mailbox blocks a tile it
 * barely touches. At 5.33px cells the measurement survives much closer to what
 * it says.
 *
 * Bottom-anchored, like the art and like `objectFootprint`: the covered pixel
 * rows are `[anchorPx.y - height, anchorPx.y - 1]`.
 */
export function pixelRectToCells(anchorPx: TilePoint, base: PixelRect): CellPoint[] {
  const x0 = Math.floor((anchorPx.x + base.left) / COLLISION_CELL);
  const x1 = Math.floor((anchorPx.x + base.right) / COLLISION_CELL);
  const y0 = Math.floor((anchorPx.y - base.height) / COLLISION_CELL);
  const y1 = Math.floor((anchorPx.y - 1) / COLLISION_CELL);

  const cells: CellPoint[] = [];
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) cells.push({ cx, cy });
  }
  return cells;
}

/**
 * The tiles a set of cells touches. For talking to whole-tile code.
 *
 * Deliberately "touches", not "fills": this is what lets a test assert that
 * sub-tile collision is a SUBSET of the whole-tile answer, which is the
 * property the server's tile-based reachability rests on.
 */
export function cellsToTiles(cells: Iterable<CellPoint>): TilePoint[] {
  const tiles = new Map<string, TilePoint>();
  for (const cell of cells) {
    const x = Math.floor(cell.cx / SUBTILE_RESOLUTION);
    const y = Math.floor(cell.cy / SUBTILE_RESOLUTION);
    tiles.set(`${x},${y}`, { x, y });
  }
  return [...tiles.values()];
}

/* ------------------------------------------------------------------ *
 * Terrain shapes
 * ------------------------------------------------------------------ */

/**
 * The impassable shape of a terrain tile, by tileset key and frame.
 *
 * **The shape belongs to the ART, not to the map cell**, which is why this is
 * keyed by frame rather than by coordinate. A shoreline tile is the same shape
 * everywhere it is stamped, so declaring it once is both less authoring and
 * impossible to get inconsistent; `farmLayout.ts` carries a per-map override
 * list for genuine one-offs.
 *
 * **Measured from COLOUR, not alpha** — see `scripts/measure-tile-masks.mjs`
 * and the table in `docs/art-measurements.md`. A building is drawn on
 * transparency so alpha answers "is this solid"; a shoreline tile is opaque
 * across its whole cell, half grass and half water, so alpha says "solid
 * everywhere" and means nothing. What blocks is the water.
 *
 * A frame with no entry falls back to whole-tile behaviour: all nine cells if
 * the key is solid, none if it is not. Forgetting to measure a tile therefore
 * looks exactly like today rather than like a hole in the map.
 */
export const TILE_COLLISION_MASK: Readonly<
  Record<string, Readonly<Record<number, readonly string[]>>>
> = {
  'tileset-grass-water-spring': {
    /**
     * `BORDER.shore` — grass with the sea down its left edge.
     *
     * **Walkable in full today**, because `isWaterKey` only calls the flat fill
     * solid and the bank is somewhere you stand. That was the only answer a
     * whole-tile grid could give, and it let the character stand in the sea.
     * Two thirds of the tile stay walkable; the water strip does not.
     */
    92: ['#..', '#..', '#..'],
    /** `BORDER.shoreCorner` — the rounded corner where fringe meets shoreline. */
    8: ['...', '#..', '#..'],
  },
};

/** The authored shape of a terrain frame, or null if it has none. */
export function terrainMask(sheetKey: string, frame: number): readonly string[] | null {
  return TILE_COLLISION_MASK[sheetKey]?.[frame] ?? null;
}

/* ------------------------------------------------------------------ *
 * Authored collision, as the map stores it
 * ------------------------------------------------------------------ */

/**
 * The map's collision layer, one tile at a time.
 *
 * **A mask string per tile, not a rectangle per cell.** A cell is 5.33px, so
 * cell-sized rectangles would put repeating fractions in every coordinate of
 * the map file; a tile is a whole number of pixels and carries its nine cells
 * as nine characters. It also reads the way every other mask in this codebase
 * reads — `'#..'` rows, `#` solid — so the same eyes work on both.
 *
 * Row-major, `SUBTILE_RESOLUTION` squared characters, no separators.
 */
export function cellsToTileMasks(
  cells: Iterable<CellPoint>,
): { readonly x: number; readonly y: number; readonly mask: string }[] {
  const byTile = new Map<string, Set<number>>();

  for (const cell of cells) {
    const x = Math.floor(cell.cx / SUBTILE_RESOLUTION);
    const y = Math.floor(cell.cy / SUBTILE_RESOLUTION);
    // Negative coordinates floor away from zero, so the modulo has to be
    // normalised or a cell at cx -1 lands in slot -1 of the tile at x -1.
    const sx = ((cell.cx % SUBTILE_RESOLUTION) + SUBTILE_RESOLUTION) % SUBTILE_RESOLUTION;
    const sy = ((cell.cy % SUBTILE_RESOLUTION) + SUBTILE_RESOLUTION) % SUBTILE_RESOLUTION;

    const key = `${x},${y}`;
    const slots = byTile.get(key) ?? new Set<number>();
    slots.add(sy * SUBTILE_RESOLUTION + sx);
    byTile.set(key, slots);
  }

  const out: { x: number; y: number; mask: string }[] = [];
  for (const [key, slots] of byTile) {
    const [rawX, rawY] = key.split(',');
    let mask = '';
    for (let i = 0; i < SUBTILE_RESOLUTION * SUBTILE_RESOLUTION; i++) {
      mask += slots.has(i) ? '#' : '.';
    }
    out.push({ x: Number(rawX), y: Number(rawY), mask });
  }

  // Sorted, so the map file diffs by line rather than by insertion order.
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * The inverse. A malformed mask yields nothing for that tile rather than
 * throwing — a hand-edited map should lose one tile's collision, not fail to
 * load.
 */
export function tileMaskToCells(x: number, y: number, mask: string): CellPoint[] {
  const cells: CellPoint[] = [];
  if (mask.length !== SUBTILE_RESOLUTION * SUBTILE_RESOLUTION) return cells;

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== '#') continue;
    cells.push({
      cx: x * SUBTILE_RESOLUTION + (i % SUBTILE_RESOLUTION),
      cy: y * SUBTILE_RESOLUTION + Math.floor(i / SUBTILE_RESOLUTION),
    });
  }
  return cells;
}

/**
 * Every cell the MAP marks solid, over and above what the art does.
 *
 * **Both sides read this, and the server's need is the sharper one.**
 * `modules/decor/reachability.ts` refuses a decor placement that would wall the
 * player out of their own farm, and it can only do that if it knows every solid
 * thing on the map. Authored collision that reached the client and not the
 * server would narrow a corridor invisibly, and then a legal-looking fence
 * placement completes a trap the guard cannot see.
 */
export function authoredCollisionCells(): CellPoint[] {
  const cells: CellPoint[] = [];
  for (const tile of AUTHORED_COLLISION) {
    cells.push(...tileMaskToCells(tile.x, tile.y, tile.mask));
  }
  return cells;
}

/**
 * The whole TILES authored collision touches, for the server's flood fill.
 *
 * Deliberately "touches", not "fills". The server works in tiles and must stay
 * conservative: a tile with one authored solid cell is a tile it should treat
 * as solid, because refusing a placement that would have been fine is safe and
 * approving one that traps the player is not.
 */
export function authoredCollisionTiles(): TilePoint[] {
  return cellsToTiles(authoredCollisionCells());
}

/** What the collision layer is called in the map file. Shared: both sides read it. */
export const COLLISION_LAYER_NAME = 'collision';
export const COLLISION_OBJECT_TYPE = 'collisionMask';
export const COLLISION_MASK_PROPERTY = 'mask';

