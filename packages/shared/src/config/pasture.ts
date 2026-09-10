import {
  ANIMALS,
  BUILDING_TIERS,
  type AnimalBuilding,
  type AnimalKind,
} from './animals.js';
import { TILE_SIZE } from './assets.js';
import { BARN_FOOTPRINT, coopFootprint, type TilePoint } from './buildings.js';
import { FARM_HEIGHT, FARM_WIDTH } from './tilesets.js';
import { VIP_BENEFITS } from './vip.js';

/**
 * Where animals stand.
 *
 * Unlike plots, animals have **no position in the database** — the server does
 * not care where a cow is, and a coordinate the client sent would be one more
 * thing to validate for no gameplay gain (§4.1). So placement is purely
 * presentational and lives here.
 *
 * Slots are assigned by the animal's index among its OWN kind, in the farm's
 * ordering (by `acquiredAt`) — stable across polls, so a cow does not teleport
 * around the field every twenty seconds.
 *
 * **One pasture became two yards in T-12.02**, because caps did: the coop caps
 * chickens and the barn caps cows, so "the largest herd" is now two numbers and
 * a single shared grid could not be sized against either of them. Splitting
 * also lets each yard use the spacing its animals need — a chicken is 16px
 * wide and packs one per tile, a cow is 32px and needs two.
 */

export interface Yard {
  /**
   * The slot NEAREST the building — index 0, and the corner everything else is
   * measured from (T-18.04).
   *
   * It used to be the top-left tile and the yard filled left-to-right from
   * there, which put the first cow a player ever bought at x=2: the far
   * bottom-left corner of the map, nineteen tiles from the barn that was
   * supposed to house it. A yard fills OUTWARD from its building now, so one
   * animal stands beside the building and the row only stretches away as the
   * herd grows.
   */
  readonly origin: { readonly x: number; readonly y: number };
  /**
   * Tiles between neighbours, and the DIRECTION the yard grows in.
   *
   * Signed, which is the whole change: `-2` walks a cow row west away from the
   * barn, `-1` stacks chicken rows north away from the coop's roof.
   */
  readonly spacing: { readonly x: number; readonly y: number };
  readonly columns: number;
  readonly rows: number;
}

/** Chicken yard: 5 across, 3 deep. 15 slots — the top coop tier's 12 plus VIP's 3. */
const COOP_YARD_SHAPE = { columns: 5, rows: 3 } as const;
/** Cow yard: one row of 9 — the top barn tier's 6 plus VIP's 3. */
const BARN_YARD_SHAPE = { columns: 9, rows: 1 } as const;

/**
 * Chickens: the grass immediately north of the coop's roof, at THIS tier.
 *
 * 1x1 spacing because a chicken sprite is exactly one tile, and the rows stack
 * northwards so the nearest birds are the ones against the building.
 *
 * **Derived per tier, not authored (T-18.04).** It used to be a fixed band at
 * y=1..3, chosen so it cleared the coop at its *largest* size — `COOP_FOOTPRINT`
 * is the Deluxe box and starts at y=4, so rows 1-3 are the only band that is
 * safe at every tier. That is sound, and it is also why a tier-0 player, whose
 * coop occupies y=7..11, found their chickens three empty rows north of it and
 * hard against the map's top border. One fixed yard cannot hug a building that
 * grows three sizes; the yard follows the roof instead.
 *
 * The consequence is that upgrading moves the flock, which is fine — it is a
 * visible event the player just paid for — but it does mean placed decoration
 * has to be kept off *every* tier's yard, not just the current one. See
 * `yardTilesAcrossTiers`.
 */
export function coopYard(tier: number): Yard {
  const roof = coopFootprint(tier);
  return {
    // Left edge of the building, one row above its roof.
    origin: { x: roof.x0, y: roof.y0 - 1 },
    spacing: { x: 1, y: -1 },
    ...COOP_YARD_SHAPE,
  };
}

/**
 * Cows: the open southern band the farm gained in T-12.02b, west of the barn.
 *
 * One row, 2-tile spacing — a cow is 32px wide and 32px tall, so a second row a
 * single tile up would have them standing through each other.
 *
 * **Tier-independent, unlike the coop's**: every barn tier shares the same west
 * wall (`x0` is 21 at all three), so a row to the west of it is clear whatever
 * the player has bought. Only the fill DIRECTION changed in T-18.04 — the row
 * now starts beside the barn and runs away from it, instead of starting at the
 * map's western edge and arriving at the barn only once the herd was full.
 *
 * Ends at x=19, one lane short of the barn's wall at x=21, and reaches x=3 at
 * nine cows: clear of the water in column 0 and of the shoreline at column 1,
 * which a 2-tile-wide cow centred on column 2 would have overhung.
 */
export function barnYard(): Yard {
  return {
    origin: { x: BARN_FOOTPRINT.x0 - 2, y: 18 },
    spacing: { x: -2, y: -1 },
    ...BARN_YARD_SHAPE,
  };
}

/** The yard a building's animals stand in, at the tier the farm has now. */
export function yardFor(building: AnimalBuilding, tier: number): Yard {
  return building === 'coop' ? coopYard(tier) : barnYard();
}

export function yardSlots(yard: Yard): number {
  return yard.columns * yard.rows;
}

export interface PasturePoint {
  /** Feet position in world (map) pixels, like every other sprite here. */
  readonly x: number;
  readonly y: number;
}

/** The tile the nth slot of a yard occupies. */
export function yardTile(yard: Yard, index: number): TilePoint {
  const total = yardSlots(yard);
  const slot = ((index % total) + total) % total;
  const column = slot % yard.columns;
  const row = Math.floor(slot / yard.columns);

  return {
    x: yard.origin.x + column * yard.spacing.x,
    y: yard.origin.y + row * yard.spacing.y,
  };
}

/**
 * The standing position for the nth animal of one kind, at the farm's current
 * building tier.
 *
 * `tier` is the coop's or the barn's, whichever houses this kind. It is only
 * load-bearing for chickens — the cow row is the same at every barn tier — but
 * it is taken for both so callers do not have to know which.
 *
 * Wraps rather than running off the map if a future cap outgrows its yard:
 * two animals overlapping is a cosmetic problem, one rendered outside the farm
 * is a bug the player cannot explain.
 */
export function pastureSlot(kind: AnimalKind, index: number, tier: number): PasturePoint {
  const tile = yardTile(yardFor(ANIMALS[kind].building, tier), index);

  return {
    x: tile.x * TILE_SIZE + TILE_SIZE / 2,
    // Bottom edge of the tile: the animal stands ON it, like map objects do.
    y: (tile.y + 1) * TILE_SIZE,
  };
}

/**
 * A reserved yard tile, and which building's animals stand on it.
 *
 * The building travels with the tile so the reachability check can still name
 * what a bad placement stranded — "the coop yard" is the difference between an
 * error a player can act on and a coordinate they cannot.
 */
export interface YardTile extends TilePoint {
  readonly building: AnimalBuilding;
}

/** Every tier a building has art and a cap for. */
function tiersOf(building: AnimalBuilding): number[] {
  return BUILDING_TIERS[building].map((_, tier) => tier);
}

/**
 * Every tile any animal could stand on, at ANY tier (T-18.04).
 *
 * **This, not the current tier, is what decoration must be kept off.** The coop
 * yard moves when the coop grows, so a statue placed on empty grass at tier 0
 * would be standing inside the flock after an upgrade — and an animal has no
 * coordinates the player could move it away from. Reserving the union is the
 * same argument `BUILDING_FOOTPRINTS` already makes for the buildings
 * themselves: reserve the ground the thing will ever need, not the ground it
 * needs today.
 *
 * Deduplicated, because the tiers' yards overlap heavily.
 */
export function yardTilesAcrossTiers(): YardTile[] {
  const seen = new Set<string>();
  const tiles: YardTile[] = [];

  for (const building of Object.keys(BUILDING_TIERS) as AnimalBuilding[]) {
    const herd = maxHerd(building);
    for (const tier of tiersOf(building)) {
      const yard = yardFor(building, tier);
      for (let i = 0; i < herd; i++) {
        const tile = yardTile(yard, i);
        const key = `${tile.x},${tile.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tiles.push({ ...tile, building });
      }
    }
  }

  return tiles;
}

/** True when every slot of every yard, at every tier, is inside the farm. */
export function pastureFitsFarm(): boolean {
  return yardTilesAcrossTiers().every(
    (tile) => tile.x >= 0 && tile.x < FARM_WIDTH && tile.y >= 0 && tile.y < FARM_HEIGHT,
  );
}

/**
 * The most animals a building can ever hold — top tier plus VIP.
 *
 * Read from config rather than written down, so retuning a tier cannot leave
 * the yard quietly too small for the herd it has to draw.
 */
export function maxHerd(building: AnimalBuilding): number {
  const best = Math.max(...BUILDING_TIERS[building].map((t) => t.cap));
  return best + VIP_BENEFITS.bonusAnimalCap;
}
