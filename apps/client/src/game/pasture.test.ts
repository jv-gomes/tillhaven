import { describe, it, expect } from 'vitest';
import {
  ANIMALS,
  ANIMAL_BUILDINGS,
  ANIMAL_KINDS,
  BUILDING_FOOTPRINTS,
  inFootprint,
  FARM_HEIGHT,
  FARM_WIDTH,
  TILE_SIZE,
  type AnimalKind,
} from '@tillhaven/shared/config';
import {
  YARDS,
  maxHerd,
  pastureFitsFarm,
  pastureSlot,
  yardSlots,
} from './pasture.js';

/**
 * Placement is cosmetic, but three of its properties are not cosmetic at all:
 * an animal drawn outside the farm is invisible with no explanation, an animal
 * that moves between polls looks like a bug in the game rather than in the
 * layout, and a yard too small for its own building's cap stacks the last
 * animals a player buys on top of earlier ones.
 */

const KINDS_BY_BUILDING = Object.fromEntries(
  ANIMAL_BUILDINGS.map((b) => [b, ANIMAL_KINDS.find((k) => ANIMALS[k].building === b)!]),
) as Record<string, AnimalKind>;

describe('pastureSlot', () => {
  it('gives every animal of a kind its own spot', () => {
    for (const building of ANIMAL_BUILDINGS) {
      const kind = KINDS_BY_BUILDING[building]!;
      const total = yardSlots(YARDS[building]);
      const seen = new Set<string>();

      for (let i = 0; i < total; i++) {
        const { x, y } = pastureSlot(kind, i);
        seen.add(`${x},${y}`);
      }
      expect(seen.size, building).toBe(total);
    }
  });

  it('is stable: the same index is always the same spot', () => {
    for (const kind of ANIMAL_KINDS) {
      for (const index of [0, 3, 9, 13]) {
        expect(pastureSlot(kind, index)).toEqual(pastureSlot(kind, index));
      }
    }
  });

  /**
   * The two yards are separate places, not one grid read twice — a chicken and
   * a cow with the same index must not be standing on each other.
   */
  it('sends each kind to its own building yard', () => {
    expect(pastureSlot('chicken', 0)).not.toEqual(pastureSlot('cow', 0));

    for (const kind of ANIMAL_KINDS) {
      const yard = YARDS[ANIMALS[kind].building];
      const { x, y } = pastureSlot(kind, 0);
      expect(x).toBe(yard.origin.x * TILE_SIZE + TILE_SIZE / 2);
      expect(y).toBe((yard.origin.y + 1) * TILE_SIZE);
    }
  });

  it('keeps every slot inside the farm', () => {
    expect(pastureFitsFarm()).toBe(true);

    for (const kind of ANIMAL_KINDS) {
      const total = yardSlots(YARDS[ANIMALS[kind].building]);
      for (let i = 0; i < total; i++) {
        const { x, y } = pastureSlot(kind, i);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(FARM_WIDTH * TILE_SIZE);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThanOrEqual(FARM_HEIGHT * TILE_SIZE);
      }
    }
  });

  /**
   * And outside the buildings, which "inside the farm" does not cover: the
   * yards sit right beside the coop and barn, and a cow drawn inside the barn
   * wall is as invisible as one drawn off the map. Checked against the LARGEST
   * footprint of each, so buying an upgrade can never swallow a yard (T-12.02b).
   */
  it('keeps every slot out from under a building, at every tier', () => {
    for (const kind of ANIMAL_KINDS) {
      const total = yardSlots(YARDS[ANIMALS[kind].building]);
      for (let i = 0; i < total; i++) {
        const { x, y } = pastureSlot(kind, i);
        // Feet are on the tile's bottom edge, so the tile they stand on is the
        // one above that edge.
        const tile = { x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) - 1 };

        for (const box of BUILDING_FOOTPRINTS) {
          expect(inFootprint(box, tile), `${kind} ${i} at (${tile.x},${tile.y})`).toBe(false);
        }
      }
    }
  });

  /**
   * Each yard has to hold the largest herd its OWN building can produce — top
   * tier plus VIP — or the last animal a player buys lands on an earlier one.
   * Both sides are read from config, so retuning `COOP_TIERS`/`BARN_TIERS`
   * fails here rather than silently overflowing a yard (T-12.02).
   */
  it('has room for the highest cap each building can reach', () => {
    for (const building of ANIMAL_BUILDINGS) {
      expect(yardSlots(YARDS[building]), building).toBeGreaterThanOrEqual(maxHerd(building));
    }
  });

  /** Wrapping beats running off the map if a future cap outgrows a yard. */
  it('wraps rather than escaping the farm', () => {
    for (const kind of ANIMAL_KINDS) {
      const total = yardSlots(YARDS[ANIMALS[kind].building]);
      expect(pastureSlot(kind, total)).toEqual(pastureSlot(kind, 0));
      expect(pastureSlot(kind, total * 3 + 2)).toEqual(pastureSlot(kind, 2));
      expect(pastureSlot(kind, -1)).toEqual(pastureSlot(kind, total - 1));
    }
  });

  /**
   * A cow is 32px wide; a chicken is 16. The yards use different spacing for
   * exactly that reason, and packing cows one tile apart would have them
   * standing through each other.
   */
  it('leaves a cow twice the elbow room it gives a chicken', () => {
    const cowGap = Math.abs(pastureSlot('cow', 1).x - pastureSlot('cow', 0).x);
    const henGap = Math.abs(pastureSlot('chicken', 1).x - pastureSlot('chicken', 0).x);

    expect(cowGap).toBeGreaterThanOrEqual(2 * TILE_SIZE);
    expect(henGap).toBeGreaterThanOrEqual(TILE_SIZE);
  });

  it('stands animals on a tile edge, not floating between two', () => {
    for (const kind of ANIMAL_KINDS) {
      const total = yardSlots(YARDS[ANIMALS[kind].building]);
      for (let i = 0; i < total; i++) {
        expect(pastureSlot(kind, i).y % TILE_SIZE).toBe(0);
      }
    }
  });
});
