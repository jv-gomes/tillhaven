import {
  ANIMALS,
  BUILDING_TIERS,
  FARM_HEIGHT,
  FARM_WIDTH,
  TILE_SIZE,
  VIP_BENEFITS,
  type AnimalBuilding,
  type AnimalKind,
} from '@tillhaven/shared/config';

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
  /** Top-left tile. */
  readonly origin: { readonly x: number; readonly y: number };
  /** Tiles between neighbours. */
  readonly spacing: { readonly x: number; readonly y: number };
  readonly columns: number;
  readonly rows: number;
}

/**
 * Chickens: the grass north of the coop, five across and three deep.
 *
 * 1x1 spacing because a chicken sprite is exactly one tile. Fifteen slots is
 * exactly the largest flock the game can produce — the top coop tier's 12 plus
 * VIP's 3 — which `pasture.test.ts` pins rather than trusts.
 *
 * Moved with the coop in T-12.02b: both live in the eastern land the farm grew
 * to fit the Deluxe buildings, and the yard sits in the three rows above the
 * Deluxe coop's roof (`COOP_FOOTPRINT.y0` is 4).
 */
export const COOP_YARD: Yard = {
  origin: { x: 21, y: 1 },
  spacing: { x: 1, y: 1 },
  columns: 5,
  rows: 3,
};

/**
 * Cows: the open southern band the farm gained in T-12.02b, west of the barn.
 *
 * One row, 2-tile spacing — a cow is 32px wide and 32px tall, so a second row
 * a single tile up would have them standing through each other. Nine slots for
 * a maximum herd of nine (top barn tier's 6 plus VIP's 3), which is why
 * `BARN_TIERS`' top cap is what it is.
 *
 * Starts at x=2, not x=1: a cow is drawn centred on its tile and two tiles
 * wide, so a cow in column 1 hangs over the water that runs down column 0.
 * Ends at x=18, one lane short of the barn — the row is sized by the herd, and
 * a tenth cow would be standing in the barn's wall.
 */
export const BARN_YARD: Yard = {
  origin: { x: 2, y: 18 },
  spacing: { x: 2, y: 1 },
  columns: 9,
  rows: 1,
};

export const YARDS: Readonly<Record<AnimalBuilding, Yard>> = {
  coop: COOP_YARD,
  barn: BARN_YARD,
};

export function yardSlots(yard: Yard): number {
  return yard.columns * yard.rows;
}

export interface PasturePoint {
  /** Feet position in world (map) pixels, like every other sprite here. */
  readonly x: number;
  readonly y: number;
}

/**
 * The standing position for the nth animal of one kind.
 *
 * Wraps rather than running off the map if a future cap outgrows its yard:
 * two animals overlapping is a cosmetic problem, one rendered outside the farm
 * is a bug the player cannot explain.
 */
export function pastureSlot(kind: AnimalKind, index: number): PasturePoint {
  const yard = YARDS[ANIMALS[kind].building];
  const total = yardSlots(yard);
  const slot = ((index % total) + total) % total;
  const column = slot % yard.columns;
  const row = Math.floor(slot / yard.columns);

  const tileX = yard.origin.x + column * yard.spacing.x;
  const tileY = yard.origin.y + row * yard.spacing.y;

  return {
    x: tileX * TILE_SIZE + TILE_SIZE / 2,
    // Bottom edge of the tile: the animal stands ON it, like map objects do.
    y: (tileY + 1) * TILE_SIZE,
  };
}

/** True when every slot of every yard is inside the farm. Asserted by tests. */
export function pastureFitsFarm(): boolean {
  return Object.values(YARDS).every((yard) => {
    const lastColumn = yard.origin.x + (yard.columns - 1) * yard.spacing.x;
    const lastRow = yard.origin.y + (yard.rows - 1) * yard.spacing.y;
    return lastColumn < FARM_WIDTH && lastRow < FARM_HEIGHT;
  });
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
