import { TILE_SIZE, type LookWindow } from './assets.js';
import {
  HOUSE_FOOTPRINT,
  barnFootprint,
  coopFootprint,
  inFootprint,
  type TileFootprint,
  type TilePoint,
} from './buildings.js';
import { OBJECT_TILES, fieldTiles, waterTiles } from './farmLayout.js';
import { yardTilesAcrossTiers } from './pasture.js';
import { placementsOverlap, type Placeable } from './placement.js';
import { FARM_HEIGHT, FARM_WIDTH } from './tilesets.js';

/**
 * Placeable farm decoration (Phase 15, §5.6-adjacent).
 *
 * **Deliberately NOT the house furniture system** (D-11). That one places
 * pieces in a bare 10x8 rectangle with no obstacles in it, and has been
 * unreachable since T-11.05 unregistered the Interior scene. This one places
 * pieces on a real map, where the predicate is "inside the farm AND not on a
 * plot AND not under a building at its CURRENT tier AND not on water AND not on
 * a map object AND not on a yard slot" — and answering it needs a `farms` row
 * read inside the transaction. Bolting that onto the furniture module would
 * mean editing its `.for('update')` locks to serve code the running game never
 * reaches. The two share `placementsOverlap` and nothing else.
 */

export interface DecorDef {
  readonly id: string;
  readonly name: string;
  /** `IMAGES` key of the kit this piece is drawn from. */
  readonly sheet: string;
  /** The window into that kit. Measured — see below. */
  readonly look: LookWindow;
  /**
   * Ground the piece occupies, in cells, anchored at its top-left.
   *
   * **AUTHORED, not derived from `look` — and this is the deliberate
   * divergence from `FurnitureDef`, whose footprint is `ceil(size / 16)`.**
   *
   * Indoors, deriving is right: you cannot slide a rug under the top half of a
   * fireplace, because on screen you could not see it. Outdoors it is wrong. A
   * street lamp is 37px tall and stands on a 17px base — deriving would reserve
   * three tiles of ground for a post you can walk right up to, and the player
   * would find an invisible wall two tiles above a lamp. Vertical overlap is
   * the norm out here; that is exactly what `DEPTH.world + y` sorting is for.
   *
   * So each footprint below is the piece's GROUND CONTACT, taken from
   * `scripts/measure-decor.mjs` and then rounded to what the piece should
   * plausibly stand on. Do not "fix" this into a derivation.
   */
  readonly footprint: { readonly width: number; readonly height: number };
  readonly price: number;
  /**
   * Whether the player bumps into it (D-9).
   *
   * Per-piece, because a fence you can walk through is not a fence and a berry
   * pile you cannot walk over is a nuisance. Solid pieces carry two extra
   * server-side rules — never orthogonally adjacent to a plot, and never
   * sealing off anything the player needs to reach — without which this flag
   * would be a way to grief yourself.
   */
  readonly solid: boolean;
  /** Decoration is cosmetic; nothing here may be tradeable for gold (§7). */
  readonly tradeable: boolean;
  /**
   * Buyable only while VIP is active (T-25.01, §7).
   *
   * This field existed from the start and, until T-25.01, **could not be set**:
   * `piece()` hardcoded `false`, so the server's `vipOnly` refusal in
   * `decor/service.ts` and the catalogue field the client is sent were both
   * dead code with no piece to apply to. `cosmeticsUnlocked` was advertised on
   * the landing page and delivered indoors only.
   */
  readonly vipOnly: boolean;
}

function piece(
  id: string,
  name: string,
  sheet: string,
  look: LookWindow,
  footprint: { width: number; height: number },
  price: number,
  solid: boolean,
  opts: { vipOnly?: boolean } = {},
): DecorDef {
  return {
    id,
    name,
    sheet,
    look,
    footprint,
    price,
    solid,
    tradeable: false,
    vipOnly: opts.vipOnly ?? false,
  };
}

/**
 * The catalogue.
 *
 * Every `look` below was measured by `node scripts/measure-decor.mjs`, which
 * flood-fills each kit into its separate pieces (the fence) or splits it on its
 * grid (everything else) and reports each piece's alpha box. None of these
 * files is a single sprite: `decor-scarecrow.png` is eight scarecrows,
 * `decor-village-signs.png` twelve signs in summer and snow, and
 * `decor-fence-wood.png` a construction set drawn twice, plain above and
 * snow-topped below. The plain halves are the ones used.
 *
 * Fence orientations are separate ids rather than one id with a rotation
 * column: rotation would have to be stored, validated, and applied at draw
 * time, and the pack draws the two orientations as different art anyway.
 */
export const DECOR: Readonly<Record<string, DecorDef>> = Object.fromEntries(
  [
    // --- Fencing (solid, and the reason D-9 needed answering) ---------
    piece('fence_h', 'Wooden fence', 'decor-fence-wood',
      { x: 48, y: 0, width: 48, height: 16 }, { width: 3, height: 1 }, 40, true),
    piece('fence_v', 'Wooden fence post', 'decor-fence-wood',
      { x: 48, y: 28, width: 13, height: 20 }, { width: 1, height: 1 }, 15, true),

    // --- Standing pieces ----------------------------------------------
    piece('scarecrow', 'Scarecrow', 'decor-scarecrow',
      { x: 105, y: 1, width: 14, height: 31 }, { width: 1, height: 1 }, 120, true),
    piece('street_lamp', 'Street lamp', 'decor-street-lamp',
      { x: 36, y: 1, width: 25, height: 37 }, { width: 1, height: 1 }, 150, true),
    piece('stone_statue', 'Stone statue', 'decor-stone-statue',
      { x: 1, y: 5, width: 29, height: 40 }, { width: 2, height: 1 }, 400, true),
    piece('village_sign', 'Signpost', 'decor-village-signs',
      { x: 73, y: 1, width: 19, height: 29 }, { width: 1, height: 1 }, 60, true),
    piece('birdhouse', 'Birdhouse', 'decor-birdhouse',
      { x: 3, y: 10, width: 11, height: 21 }, { width: 1, height: 1 }, 80, true),

    // --- Farmyard clutter ----------------------------------------------
    piece('hay_bale', 'Hay bale', 'decor-hay-bales',
      { x: 0, y: 0, width: 16, height: 16 }, { width: 1, height: 1 }, 30, true),
    piece('feed_trough', 'Feed trough', 'decor-feed-trough',
      { x: 0, y: 4, width: 32, height: 12 }, { width: 2, height: 1 }, 90, true),
    piece('barrels', 'Stacked barrels', 'decor-stacked-barrels',
      { x: 2, y: 5, width: 43, height: 38 }, { width: 3, height: 1 }, 200, true),

    // --- Flat ground cover (the only NON-solid pieces) -------------------
    piece('berry_pile', 'Berry bush', 'decor-berry-piles',
      { x: 1, y: 3, width: 14, height: 13 }, { width: 1, height: 1 }, 25, false),

    /*
     * --- The Winter set: VIP-only (T-25.01, §7) ------------------------
     *
     * **Every one is an exact cosmetic TWIN of a piece above** — same
     * footprint, same `solid`, same price, different art. That is not a
     * shortcut, it is the requirement: §7 forbids VIP granting raw power, and
     * "identical in every field a rule reads, different only in `look`" is a
     * property a test can actually check. `decor.test.ts` does, per piece.
     *
     * The art costs nothing new. `decor-fence-wood` and `decor-village-signs`
     * are each drawn twice — plain on top, snow-topped below — and the
     * catalogue above uses only the plain halves (its own comment says so).
     * These are the halves that were already loaded and never shown, measured
     * by `node scripts/measure-decor.mjs` like every window above: fence rail
     * `#6`, fence post `#8`, signpost `r1c2`. No new file, no manifest entry,
     * no `prepare-assets.mjs` run.
     *
     * They still cost gold. VIP unlocks the right to buy them, exactly as it
     * does for the two `vipOnly` furniture pieces — it is not a gold grant.
     */
    piece('fence_frost_h', 'Frosted fence', 'decor-fence-wood',
      { x: 48, y: 80, width: 48, height: 16 }, { width: 3, height: 1 }, 40, true,
      { vipOnly: true }),
    piece('fence_frost_v', 'Frosted fence post', 'decor-fence-wood',
      { x: 48, y: 108, width: 13, height: 20 }, { width: 1, height: 1 }, 15, true,
      { vipOnly: true }),
    piece('village_sign_frost', 'Frosted signpost', 'decor-village-signs',
      { x: 73, y: 33, width: 19, height: 29 }, { width: 1, height: 1 }, 60, true,
      { vipOnly: true }),
  ].map((def) => [def.id, def]),
);

/**
 * Which non-VIP piece each VIP piece is the twin of (T-25.01).
 *
 * Declared rather than inferred, so the test checks a stated intention instead
 * of pairing pieces by whichever fields happen to match today — the latter
 * would pass trivially the moment a VIP piece stopped matching anything.
 */
export const DECOR_VIP_TWIN: Readonly<Record<string, string>> = {
  fence_frost_h: 'fence_h',
  fence_frost_v: 'fence_v',
  village_sign_frost: 'village_sign',
};

export const DECOR_IDS: readonly string[] = Object.keys(DECOR);

export function getDecor(id: string): DecorDef | undefined {
  return DECOR[id];
}

/** The tile box a piece placed at (x, y) covers. */
export function decorFootprint(def: DecorDef, x: number, y: number): TileFootprint {
  return {
    x0: x,
    y0: y,
    x1: x + def.footprint.width - 1,
    y1: y + def.footprint.height - 1,
  };
}

/**
 * Where a piece anchored at tile (x, y) is DRAWN, in world pixels.
 *
 * The bottom-left of its FOOTPRINT, not of its art. A piece is stored by the
 * top-left cell it occupies, so the drawing anchor is one footprint-height
 * below — and because the art may be far taller than the footprint (a 37px
 * street lamp standing on one tile), the sprite grows UPWARD from there. That
 * is what puts a lamp's post on its own tile and its head over the tile above,
 * which is the whole point of authoring footprints instead of deriving them.
 *
 * Pure geometry, so it lives here beside `decorFootprint` rather than in the
 * client's `Decor.ts` — which imports Phaser and therefore cannot be loaded by
 * a test without a browser environment.
 */
export function decorAnchorPx(
  def: DecorDef,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  return { x: x * TILE_SIZE, y: (y + def.footprint.height) * TILE_SIZE };
}

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * Every tile decoration may never be placed on, for a farm at these tiers.
 *
 * Takes the CURRENT tiers rather than the reserved maximum, for the same reason
 * `currentBuildingFootprints` does (see `collision.ts`): a player with a tier-0
 * coop should be able to decorate the grass a Deluxe coop would one day cover.
 * The consequence — upgrading can leave a piece underneath a new building — is
 * handled by the upgrade path, not by refusing the placement now.
 */
export function reservedFarmTiles(tiers: {
  readonly coop: number;
  readonly barn: number;
}): ReadonlySet<string> {
  const reserved = new Set<string>();
  const add = (t: TilePoint) => reserved.add(key(t.x, t.y));
  const addBox = (box: TileFootprint) => {
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) reserved.add(key(x, y));
    }
  };

  // The field. Decorating your own crops is the single most obvious way to
  // break a farm, and it is the one thing no reachability check would catch.
  for (const tile of fieldTiles()) add(tile);

  /*
   * The house is the deliberate exception to the current-tiers rule above: this
   * is `HOUSE_FOOTPRINT`, the LARGEST tier, not `houseFootprint(tiers.house)`.
   *
   * Since T-17.06 the tiers differ, but only by one row — and that row is the
   * map's top border row, which is not ground anybody wants to decorate. The
   * coop and barn grow by up to three rows across ground in the middle of the
   * farm, which is what the rule was written for. Reserving one border row
   * costs nothing and means a tier-2 upgrade can never bury a piece.
   */
  addBox(HOUSE_FOOTPRINT);
  addBox(coopFootprint(tiers.coop));
  addBox(barnFootprint(tiers.barn));

  for (const tile of waterTiles()) add(tile);
  for (const tile of OBJECT_TILES) add(tile);

  /*
   * Yard slots: an animal standing where a statue is drawn is not a bug the
   * player can fix, since animals have no coordinates to move.
   *
   * EVERY tier's yard, not the current one (T-18.04). The coop's yard follows
   * its roof, so a piece placed on open grass beside a small coop would be
   * standing in the flock after an upgrade — the same reason the buildings
   * reserve their largest footprint rather than their present one.
   */
  for (const tile of yardTilesAcrossTiers()) add(tile);

  return reserved;
}

export type DecorRefusal = 'off_map' | 'reserved' | 'occupied' | 'blocks_plot';

export type DecorPlacementResult = { ok: true } | { ok: false; reason: DecorRefusal };

/** A placed piece, as the server stores it. */
export interface PlacedDecor {
  readonly id: string;
  readonly decorId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Whether a piece may go here.
 *
 * Pure and shared: the client uses it to tint the placement ghost before it
 * sends anything, and the server uses it as the actual gate. The client's copy
 * is a courtesy — it exists so an illegal target is red before the round trip,
 * never so the server can skip the check (§4.1).
 */
export function canPlaceDecor(
  def: DecorDef,
  x: number,
  y: number,
  reserved: ReadonlySet<string>,
  others: readonly { readonly def: DecorDef; readonly x: number; readonly y: number }[],
): DecorPlacementResult {
  const box = decorFootprint(def, x, y);

  if (box.x0 < 0 || box.y0 < 0 || box.x1 >= FARM_WIDTH || box.y1 >= FARM_HEIGHT) {
    return { ok: false, reason: 'off_map' };
  }

  for (let ty = box.y0; ty <= box.y1; ty++) {
    for (let tx = box.x0; tx <= box.x1; tx++) {
      if (reserved.has(key(tx, ty))) return { ok: false, reason: 'reserved' };
    }
  }

  const self: Placeable = { x, y, footprint: def.footprint };
  for (const other of others) {
    if (placementsOverlap(self, { x: other.x, y: other.y, footprint: other.def.footprint })) {
      return { ok: false, reason: 'occupied' };
    }
  }

  /*
   * A solid piece may not sit orthogonally beside a plot.
   *
   * You act on the tile you are FACING, so working a plot means standing on one
   * of its four neighbours. Wall all four and the plot is still visible, still
   * grows, and can never be watered or harvested again — by hand OR by the idle
   * farmer. Rather than work out which neighbours are still free (which changes
   * as more pieces go down, and would have to be re-checked on every removal),
   * solid decor simply keeps out of the ring entirely. Non-solid pieces are
   * free to sit right beside a plot: you can stand on them.
   */
  if (def.solid) {
    for (const plot of fieldTiles()) {
      for (let ty = box.y0; ty <= box.y1; ty++) {
        for (let tx = box.x0; tx <= box.x1; tx++) {
          const adjacent =
            (Math.abs(plot.x - tx) === 1 && plot.y === ty) ||
            (Math.abs(plot.y - ty) === 1 && plot.x === tx);
          if (adjacent) return { ok: false, reason: 'blocks_plot' };
        }
      }
    }
  }

  return { ok: true };
}

/** Every tile a set of placed decor makes solid. */
export function solidDecorTiles(
  placements: readonly { readonly def: DecorDef; readonly x: number; readonly y: number }[],
): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (const placement of placements) {
    if (!placement.def.solid) continue;
    const box = decorFootprint(placement.def, placement.x, placement.y);
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) tiles.push({ x, y });
    }
  }
  return tiles;
}

/** Re-exported so callers do not need `buildings.js` just to test a box. */
export { inFootprint };
