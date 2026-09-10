import { describe, it, expect } from 'vitest';
import {
  ANIMALS,
  ANIMAL_BUILDINGS,
  ANIMAL_KINDS,
  BUILDING_TIERS,
  type AnimalBuilding,
  type AnimalKind,
} from './animals.js';
import { TILE_SIZE } from './assets.js';
import {
  BUILDING_FOOTPRINTS,
  barnFootprint,
  coopFootprint,
  inFootprint,
  type TileFootprint,
} from './buildings.js';
import { FARM_HEIGHT, FARM_WIDTH } from './tilesets.js';
import { PLOT_POSITIONS } from './plots.generated.js';
import { pathTiles, waterTiles } from './farmLayout.js';
import {
  maxHerd,
  pastureFitsFarm,
  pastureSlot,
  yardFor,
  yardSlots,
  yardTile,
  yardTilesAcrossTiers,
} from './pasture.js';

/**
 * Placement is cosmetic, but four of its properties are not cosmetic at all:
 * an animal drawn outside the farm is invisible with no explanation, an animal
 * that moves between polls looks like a bug in the game rather than in the
 * layout, a yard too small for its own building's cap stacks the last animals a
 * player buys on top of earlier ones — and a yard that is nowhere near the
 * building it belongs to reads as broken, which is what T-18.04 found.
 */

const KINDS_BY_BUILDING = Object.fromEntries(
  ANIMAL_BUILDINGS.map((b) => [b, ANIMAL_KINDS.find((k) => ANIMALS[k].building === b)!]),
) as Record<string, AnimalKind>;

const TIERS_OF = (building: AnimalBuilding): number[] =>
  BUILDING_TIERS[building].map((_, tier) => tier);

const footprintOf = (building: AnimalBuilding, tier: number): TileFootprint =>
  building === 'coop' ? coopFootprint(tier) : barnFootprint(tier);

/** The tile an animal's feet land on, from its world-pixel slot. */
const tileOf = (slot: { x: number; y: number }) => ({
  x: Math.floor(slot.x / TILE_SIZE),
  y: Math.floor((slot.y - 1) / TILE_SIZE),
});

describe('pastureSlot', () => {
  it('gives every animal of a kind its own spot', () => {
    for (const building of ANIMAL_BUILDINGS) {
      const kind = KINDS_BY_BUILDING[building]!;
      for (const tier of TIERS_OF(building)) {
        const total = yardSlots(yardFor(building, tier));
        const seen = new Set<string>();

        for (let i = 0; i < total; i++) {
          const { x, y } = pastureSlot(kind, i, tier);
          seen.add(`${x},${y}`);
        }
        expect(seen.size, `${building} tier ${tier}`).toBe(total);
      }
    }
  });

  it('is stable: the same index at the same tier is always the same spot', () => {
    for (const kind of ANIMAL_KINDS) {
      for (const index of [0, 3, 9, 13]) {
        expect(pastureSlot(kind, index, 0)).toEqual(pastureSlot(kind, index, 0));
      }
    }
  });

  /**
   * The two yards are separate places, not one grid read twice — a chicken and
   * a cow with the same index must not be standing on each other.
   */
  it('sends each kind to its own building yard', () => {
    expect(pastureSlot('chicken', 0, 0)).not.toEqual(pastureSlot('cow', 0, 0));

    for (const kind of ANIMAL_KINDS) {
      const building = ANIMALS[kind].building;
      const yard = yardFor(building, 0);
      const { x, y } = pastureSlot(kind, 0, 0);
      expect(x).toBe(yard.origin.x * TILE_SIZE + TILE_SIZE / 2);
      expect(y).toBe((yard.origin.y + 1) * TILE_SIZE);
    }
  });

  it('keeps every slot inside the farm, at every tier', () => {
    expect(pastureFitsFarm()).toBe(true);

    for (const tile of yardTilesAcrossTiers()) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(FARM_WIDTH);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(FARM_HEIGHT);
    }
  });

  /**
   * And outside the buildings, which "inside the farm" does not cover: a cow
   * drawn inside the barn wall is as invisible as one drawn off the map.
   *
   * Checked per tier now (T-18.04). It used to be checked against the LARGEST
   * footprint, which was the right test for a yard pinned clear of every tier —
   * and it is what forced the chicken yard up against the map's top border,
   * three empty rows from a tier-0 coop. A yard that follows its building has
   * the honest invariant instead: at tier T, no slot is under the building at
   * tier T.
   */
  it('keeps every slot out from under its own building, at its own tier', () => {
    for (const building of ANIMAL_BUILDINGS) {
      const kind = KINDS_BY_BUILDING[building]!;
      for (const tier of TIERS_OF(building)) {
        const box = footprintOf(building, tier);
        const total = yardSlots(yardFor(building, tier));

        for (let i = 0; i < total; i++) {
          const tile = tileOf(pastureSlot(kind, i, tier));
          expect(inFootprint(box, tile), `${kind} ${i} at tier ${tier} (${tile.x},${tile.y})`).toBe(
            false,
          );
        }
      }
    }
  });

  /**
   * THE BUG (T-18.04). A tier-0 coop occupies y=7..11 and its chickens stood at
   * y=1..3 — three empty rows away, hard against the map's border. "Near its
   * building" is the property that was missing, and no amount of "inside the
   * farm" or "not under a building" implies it.
   */
  it('stands the first animal right beside its building, at every tier', () => {
    for (const building of ANIMAL_BUILDINGS) {
      const kind = KINDS_BY_BUILDING[building]!;

      for (const tier of TIERS_OF(building)) {
        const box = footprintOf(building, tier);
        const yard = yardFor(building, tier);
        const tile = tileOf(pastureSlot(kind, 0, tier));

        /*
         * "Beside" is measured in the yard's own spacing, not in tiles, because
         * the spacing IS the animal's width: a chicken is one tile and stands
         * against the wall, a cow is two and centred, so a cow one tile out
         * would have half of itself inside the building. One step is as close
         * as each kind can physically get.
         */
        const reach = Math.max(Math.abs(yard.spacing.x), Math.abs(yard.spacing.y));
        const gapX = Math.max(box.x0 - tile.x, tile.x - box.x1, 0);
        const gapY = Math.max(box.y0 - tile.y, tile.y - box.y1, 0);
        const gap = Math.max(gapX, gapY);

        expect(
          gap,
          `${kind} slot 0 is ${gap} tiles from its ${building} at tier ${tier}`,
        ).toBeLessThanOrEqual(reach);
      }
    }
  });

  /** The yard grows AWAY from the building, so later animals are the far ones. */
  it('fills outward: each slot is no nearer its building than the one before', () => {
    for (const building of ANIMAL_BUILDINGS) {
      const kind = KINDS_BY_BUILDING[building]!;
      const box = footprintOf(building, 0);
      const yard = yardFor(building, 0);

      const distance = (i: number) => {
        const t = tileOf(pastureSlot(kind, i, 0));
        return Math.max(box.x0 - t.x, t.x - box.x1, box.y0 - t.y, t.y - box.y1, 0);
      };

      // Within a row: monotonically away.
      for (let i = 1; i < yard.columns; i++) {
        expect(distance(i), `${kind} slot ${i}`).toBeGreaterThanOrEqual(distance(i - 1));
      }
      // And the first slot of each row is further out than the first of the last.
      for (let row = 1; row < yard.rows; row++) {
        expect(distance(row * yard.columns)).toBeGreaterThanOrEqual(
          distance((row - 1) * yard.columns),
        );
      }
    }
  });

  /**
   * Each yard has to hold the largest herd its OWN building can produce — top
   * tier plus VIP — or the last animal a player buys lands on an earlier one.
   */
  it('has room for the highest cap each building can reach', () => {
    for (const building of ANIMAL_BUILDINGS) {
      for (const tier of TIERS_OF(building)) {
        expect(yardSlots(yardFor(building, tier)), `${building} tier ${tier}`).toBeGreaterThanOrEqual(
          maxHerd(building),
        );
      }
    }
  });

  /** Wrapping beats running off the map if a future cap outgrows a yard. */
  it('wraps rather than escaping the farm', () => {
    for (const kind of ANIMAL_KINDS) {
      const total = yardSlots(yardFor(ANIMALS[kind].building, 0));
      expect(pastureSlot(kind, total, 0)).toEqual(pastureSlot(kind, 0, 0));
      expect(pastureSlot(kind, total * 3 + 2, 0)).toEqual(pastureSlot(kind, 2, 0));
      expect(pastureSlot(kind, -1, 0)).toEqual(pastureSlot(kind, total - 1, 0));
    }
  });

  /**
   * A cow is 32px wide; a chicken is 16. The yards use different spacing for
   * exactly that reason, and packing cows one tile apart would have them
   * standing through each other.
   */
  it('leaves a cow twice the elbow room it gives a chicken', () => {
    const cowGap = Math.abs(pastureSlot('cow', 1, 0).x - pastureSlot('cow', 0, 0).x);
    const henGap = Math.abs(pastureSlot('chicken', 1, 0).x - pastureSlot('chicken', 0, 0).x);

    expect(cowGap).toBeGreaterThanOrEqual(2 * TILE_SIZE);
    expect(henGap).toBeGreaterThanOrEqual(TILE_SIZE);
  });

  it('stands animals on a tile edge, not floating between two', () => {
    for (const kind of ANIMAL_KINDS) {
      const building = ANIMALS[kind].building;
      for (const tier of TIERS_OF(building)) {
        const total = yardSlots(yardFor(building, tier));
        for (let i = 0; i < total; i++) {
          expect(pastureSlot(kind, i, tier).y % TILE_SIZE).toBe(0);
        }
      }
    }
  });
});

/**
 * T-18.04. The coop's yard MOVES when the coop grows, which is the price of it
 * hugging the building. Everything that reserves ground has to reserve the
 * union, or an upgrade drops the flock on top of a statue the player paid for
 * and cannot move (animals have no coordinates).
 */
describe('yardTilesAcrossTiers', () => {
  it('covers every slot of every tier', () => {
    for (const building of ANIMAL_BUILDINGS) {
      const kind = KINDS_BY_BUILDING[building]!;
      for (const tier of TIERS_OF(building)) {
        for (let i = 0; i < maxHerd(building); i++) {
          const tile = tileOf(pastureSlot(kind, i, tier));
          expect(
            yardTilesAcrossTiers().some((t) => t.x === tile.x && t.y === tile.y),
            `${kind} slot ${i} at tier ${tier} (${tile.x},${tile.y}) is unreserved`,
          ).toBe(true);
        }
      }
    }
  });

  it('is a set — the tiers overlap and must not double-count', () => {
    const tiles = yardTilesAcrossTiers();
    expect(new Set(tiles.map((t) => `${t.x},${t.y}`)).size).toBe(tiles.length);
  });

  /**
   * It is strictly bigger than any one tier's yard, which is the whole reason
   * it exists. If a refactor ever made them equal, the reservation would have
   * silently narrowed back to "today's tier".
   */
  it('is larger than a single tier, because the coop yard moves', () => {
    const oneTier = yardSlots(yardFor('coop', 0)) + yardSlots(yardFor('barn', 0));
    expect(yardTilesAcrossTiers().length).toBeGreaterThan(oneTier);
  });

  /**
   * Reserved ground is ground nothing else may claim. A yard tile that is also
   * a plot, a path or water is a collision the player would experience as an
   * animal standing in a crop or in the river.
   */
  it('never overlaps the field, a path run or the water', () => {
    const yard = new Set(yardTilesAcrossTiers().map((t) => `${t.x},${t.y}`));

    for (const plot of PLOT_POSITIONS) expect(yard.has(`${plot.x},${plot.y}`)).toBe(false);
    for (const tile of pathTiles()) expect(yard.has(`${tile.x},${tile.y}`)).toBe(false);
    for (const tile of waterTiles()) expect(yard.has(`${tile.x},${tile.y}`)).toBe(false);
  });

  /**
   * A cow is drawn two tiles wide and centred, so a slot in column 1 hangs over
   * the water in column 0 even though its own tile is dry.
   */
  it('leaves a cow room for its width against the western water', () => {
    const cows = TIERS_OF('barn').flatMap((tier) =>
      Array.from({ length: maxHerd('barn') }, (_, i) => tileOf(pastureSlot('cow', i, tier))),
    );
    for (const tile of cows) expect(tile.x, 'a cow here would overhang the shore').toBeGreaterThan(1);
  });

  it('never lands under a building at the tier that building is at', () => {
    for (const building of ANIMAL_BUILDINGS) {
      const kind = KINDS_BY_BUILDING[building]!;
      for (const tier of TIERS_OF(building)) {
        const box = footprintOf(building, tier);
        for (let i = 0; i < maxHerd(building); i++) {
          expect(inFootprint(box, tileOf(pastureSlot(kind, i, tier)))).toBe(false);
        }
      }
    }
  });

  /**
   * The house never moves, so no yard may ever touch it — unlike the coop and
   * barn, where the yard is allowed to sit where a *different* tier's building
   * would be, because only one tier exists at a time.
   */
  it('never overlaps the farmhouse', () => {
    const house = BUILDING_FOOTPRINTS[0]!;
    for (const tile of yardTilesAcrossTiers()) {
      expect(inFootprint(house, tile), `${tile.x},${tile.y}`).toBe(false);
    }
  });
});

describe('yardTile', () => {
  it('walks the row in the yard spacing direction', () => {
    const yard = yardFor('barn', 0);
    const first = yardTile(yard, 0);
    const second = yardTile(yard, 1);
    expect(second.x - first.x).toBe(yard.spacing.x);
  });

  it('starts a new row once the columns run out', () => {
    const yard = yardFor('coop', 0);
    const wrapped = yardTile(yard, yard.columns);
    expect(wrapped.x).toBe(yard.origin.x);
    expect(wrapped.y).toBe(yard.origin.y + yard.spacing.y);
  });
});
