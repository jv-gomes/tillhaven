import { describe, it, expect } from 'vitest';
import { BARN_TIERS, COOP_TIERS } from './animals.js';
import { BARN_TIER_ART, COOP_TIER_ART, TILE_SIZE } from './assets.js';
import {
  BARN_ANCHOR,
  BARN_FOOTPRINT,
  BUILDING_FOOTPRINTS,
  COOP_ANCHOR,
  COOP_FOOTPRINT,
  HOUSE_FOOTPRINT,
  barnFootprint,
  coopFootprint,
  footprintOf,
  footprintsOverlap,
  inFootprint,
} from './buildings.js';
import { PLOT_POSITIONS } from './plots.generated.js';
import { FARM_HEIGHT, FARM_WIDTH } from './tilesets.js';

/**
 * T-12.02b. The buildings are drawn from hardcoded anchors and are NOT map
 * objects, so nothing in `farm.json` records that their ground is taken —
 * these are the checks that a barn is not standing on the crop field, off the
 * edge of the farm, or on top of the coop.
 *
 * They matter most at the tiers nobody plays at first: the farm has to hold a
 * Deluxe coop AND a Deluxe barn from the day it is authored, because the
 * player who buys one has already paid.
 */
describe('building footprints', () => {
  const TIERS = [
    ...COOP_TIER_ART.map((_, tier) => ({ name: `coop tier ${tier}`, box: coopFootprint(tier) })),
    ...BARN_TIER_ART.map((_, tier) => ({ name: `barn tier ${tier}`, box: barnFootprint(tier) })),
    { name: 'house', box: HOUSE_FOOTPRINT },
  ];

  it.each(TIERS)('$name stands entirely inside the farm', ({ box }) => {
    expect(box.x0).toBeGreaterThanOrEqual(0);
    expect(box.y0).toBeGreaterThanOrEqual(0);
    expect(box.x1).toBeLessThan(FARM_WIDTH);
    expect(box.y1).toBeLessThan(FARM_HEIGHT);
  });

  it.each(TIERS)('$name covers no plot', ({ box }) => {
    for (const plot of PLOT_POSITIONS) {
      expect(inFootprint(box, plot), `plot (${plot.x},${plot.y})`).toBe(false);
    }
  });

  /**
   * The reserved ground is the LARGEST tier, not the one a given farm has
   * bought — an upgrade must never drop a barn onto the coop.
   */
  it('reserves ground the three buildings do not share', () => {
    expect(footprintsOverlap(COOP_FOOTPRINT, BARN_FOOTPRINT)).toBe(false);
    expect(footprintsOverlap(COOP_FOOTPRINT, HOUSE_FOOTPRINT)).toBe(false);
    expect(footprintsOverlap(BARN_FOOTPRINT, HOUSE_FOOTPRINT)).toBe(false);
    expect(BUILDING_FOOTPRINTS).toHaveLength(3);
  });

  /**
   * Every smaller tier fits inside the reserved box, which is what makes
   * reserving the largest one sufficient. This holds because the tiers share a
   * bottom-left corner — if an anchor ever stopped being shared, the map's
   * clearance check would be checking the wrong rectangle.
   */
  it.each(COOP_TIER_ART.map((_, tier) => tier))('coop tier %i fits its reserved ground', (tier) => {
    const box = coopFootprint(tier);
    expect(box.x0).toBeGreaterThanOrEqual(COOP_FOOTPRINT.x0);
    expect(box.y0).toBeGreaterThanOrEqual(COOP_FOOTPRINT.y0);
    expect(box.x1).toBeLessThanOrEqual(COOP_FOOTPRINT.x1);
    expect(box.y1).toBeLessThanOrEqual(COOP_FOOTPRINT.y1);
  });

  it.each(BARN_TIER_ART.map((_, tier) => tier))('barn tier %i fits its reserved ground', (tier) => {
    const box = barnFootprint(tier);
    expect(box.x0).toBeGreaterThanOrEqual(BARN_FOOTPRINT.x0);
    expect(box.y0).toBeGreaterThanOrEqual(BARN_FOOTPRINT.y0);
    expect(box.x1).toBeLessThanOrEqual(BARN_FOOTPRINT.x1);
    expect(box.y1).toBeLessThanOrEqual(BARN_FOOTPRINT.y1);
  });

  /**
   * A tier the client has never heard of falls back to the basic look rather
   * than throwing or drawing nothing. The server is the authority on tiers, and
   * a picture the client does not have is not a reason for a hole in the farm.
   */
  it('falls back to the basic look for a tier that has no art', () => {
    expect(coopFootprint(99)).toEqual(coopFootprint(0));
    expect(barnFootprint(-1)).toEqual(barnFootprint(0));
  });
});

describe('footprintOf', () => {
  /**
   * Rounded OUTWARDS, on both axes. The Deluxe coop is 129px wide — eight
   * whole tiles and one pixel — and the ninth tile it pokes into is still a
   * tile nothing else may stand on. Rounding to nearest would hand it away.
   */
  it('counts a partly-covered tile as covered', () => {
    const box = footprintOf({ x: 0, y: 10 }, { x: 0, y: 0, width: TILE_SIZE + 1, height: 1 });
    expect(box.x1).toBe(1);
  });

  it('anchors on the row below the building, so the anchor tile is free', () => {
    const box = footprintOf({ x: 4, y: 10 }, { x: 0, y: 0, width: TILE_SIZE, height: TILE_SIZE * 2 });
    expect(box).toEqual({ x0: 4, y0: 8, x1: 4, y1: 9 });
  });
});

/**
 * One picture per tier, and every tier has one. A fourth `COOP_TIERS` entry
 * with no art would leave the building drawing its previous look forever — a
 * player would pay 20,000g and see nothing change.
 */
describe('tier art tables', () => {
  it('gives every coop and barn tier exactly one look', () => {
    expect(COOP_TIER_ART).toHaveLength(COOP_TIERS.length);
    expect(BARN_TIER_ART).toHaveLength(BARN_TIERS.length);
  });

  it('gives each tier its own sheet, so no two tiers look the same', () => {
    const keys = [...COOP_TIER_ART, ...BARN_TIER_ART].map((art) => art.sheet.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('draws a bigger building at every step up', () => {
    for (const table of [COOP_TIER_ART, BARN_TIER_ART]) {
      for (let tier = 1; tier < table.length; tier++) {
        const previous = table[tier - 1]!.look;
        const current = table[tier]!.look;
        expect(current.width * current.height).toBeGreaterThan(previous.width * previous.height);
      }
    }
  });
});

/** The anchors themselves, pinned so a stray edit has to be deliberate. */
describe('building anchors', () => {
  it('puts the coop above the barn with a row of grass between them', () => {
    expect(COOP_ANCHOR.x).toBe(BARN_ANCHOR.x);
    expect(COOP_FOOTPRINT.y1).toBeLessThan(BARN_FOOTPRINT.y0);
  });
});
