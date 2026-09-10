import { describe, expect, it } from 'vitest';
import { IMAGES, TILE_SIZE } from './assets.js';
import { BARN_TIER_ART, COOP_TIER_ART } from './assets.js';
import { FARM_HEIGHT, FARM_WIDTH } from './tilesets.js';
import { PLOT_POSITIONS } from './plots.generated.js';
import { fieldTiles, waterTiles } from './farmLayout.js';
import {
  DECOR,
  DECOR_IDS,
  DECOR_VIP_TWIN,
  canPlaceDecor,
  decorFootprint,
  getDecor,
  reservedFarmTiles,
  solidDecorTiles,
  type DecorDef,
} from './decor.js';

/**
 * T-15.16. Placement is the whole system: everything else is plumbing around
 * "may this go here". The failures that matter are the ones a player cannot
 * undo — a piece on a plot, a piece under a building, a fence that seals a
 * plot off from every side you could work it from.
 */

const IMAGE_KEYS = new Map(IMAGES.map((i) => [i.key, i]));
const TIERS = { coop: 0, barn: 0 };

/** A tile far from anything reserved, for the "this is otherwise legal" cases. */
function freeTile(reserved: ReadonlySet<string>, def: DecorDef): { x: number; y: number } {
  for (let y = 1; y < FARM_HEIGHT - 2; y++) {
    for (let x = 2; x < FARM_WIDTH - 3; x++) {
      if (canPlaceDecor(def, x, y, reserved, []).ok) return { x, y };
    }
  }
  throw new Error(`no legal tile anywhere for ${def.id}`);
}

describe('the catalogue', () => {
  it('is not empty and every id matches its key', () => {
    expect(DECOR_IDS.length).toBeGreaterThan(5);
    for (const id of DECOR_IDS) expect(DECOR[id]!.id).toBe(id);
  });

  it('draws only from art that exists in the manifest', () => {
    for (const id of DECOR_IDS) {
      expect(IMAGE_KEYS.has(DECOR[id]!.sheet), `${id} -> ${DECOR[id]!.sheet}`).toBe(true);
    }
  });

  /*
   * The window is measured, so it must land inside the file it names. A window
   * that runs off the edge draws a torn sprite, or nothing — the exact failure
   * T-7.11 hit with the shipping box.
   */
  it('keeps every look window inside its own image', () => {
    for (const id of DECOR_IDS) {
      const def = DECOR[id]!;
      const image = IMAGE_KEYS.get(def.sheet)!;
      expect(def.look.x + def.look.width, `${id} runs off the right`).toBeLessThanOrEqual(
        image.width,
      );
      expect(def.look.y + def.look.height, `${id} runs off the bottom`).toBeLessThanOrEqual(
        image.height,
      );
      expect(def.look.width, `${id} has no width`).toBeGreaterThan(0);
      expect(def.look.height, `${id} has no height`).toBeGreaterThan(0);
    }
  });

  /*
   * The divergence from FurnitureDef, pinned so nobody "fixes" it back.
   *
   * Deriving footprint from the look would reserve three tiles of ground under
   * a street lamp you can walk right up to. At least one piece must be shorter
   * in footprint than its art is tall, or the divergence has quietly gone away.
   */
  it('authors footprints rather than deriving them from the art', () => {
    const overhanging = DECOR_IDS.filter((id) => {
      const def = DECOR[id]!;
      return def.footprint.height < Math.ceil(def.look.height / TILE_SIZE);
    });
    expect(overhanging.length, 'no piece overhangs its footprint any more').toBeGreaterThan(0);
  });

  it('prices everything, and makes nothing tradeable', () => {
    for (const id of DECOR_IDS) {
      expect(DECOR[id]!.price, `${id}`).toBeGreaterThan(0);
      expect(Number.isInteger(DECOR[id]!.price), `${id} price is not an integer`).toBe(true);
      // §7: cosmetics must never become a way to mint tradeable value.
      expect(DECOR[id]!.tradeable, `${id}`).toBe(false);
    }
  });

  it('has both solid and walk-over pieces, or D-9 was pointless', () => {
    const solid = DECOR_IDS.filter((id) => DECOR[id]!.solid);
    expect(solid.length).toBeGreaterThan(0);
    expect(solid.length).toBeLessThan(DECOR_IDS.length);
  });

  it('resolves a known id and refuses an unknown one', () => {
    expect(getDecor(DECOR_IDS[0]!)).toBeDefined();
    expect(getDecor('not-a-piece')).toBeUndefined();
  });
});

/**
 * The VIP half of the catalogue (T-25.01).
 *
 * §7 is the whole of it: a paid cosmetic must be **only** cosmetic. Not "we
 * intend it to be" — a property the config is checked against, because the
 * failure it prevents is a paying player buying something a free player
 * cannot match, which is how an economy tilts without anyone deciding to
 * tilt it.
 */
describe('VIP-only decoration', () => {
  const vipIds = DECOR_IDS.filter((id) => DECOR[id]!.vipOnly);

  it('exists at all — the flag was unsettable before T-25.01', () => {
    expect(vipIds.length).toBeGreaterThan(0);
    // And is not the whole catalogue: a shop with nothing a free account can
    // buy is a different product.
    expect(vipIds.length).toBeLessThan(DECOR_IDS.length);
  });

  it('names a real twin for every VIP piece, and no others', () => {
    expect(Object.keys(DECOR_VIP_TWIN).sort()).toEqual([...vipIds].sort());
    for (const [vipId, twinId] of Object.entries(DECOR_VIP_TWIN)) {
      expect(DECOR[twinId], `${vipId}'s twin ${twinId} does not exist`).toBeDefined();
      expect(DECOR[twinId]!.vipOnly, `${twinId} is itself VIP-only`).toBe(false);
    }
  });

  /**
   * The load-bearing one. Every field any RULE reads must be identical to the
   * twin's: `footprint` decides what ground it takes and what it can seal off,
   * `solid` decides whether it blocks, `price` decides what it costs. Only
   * `look` — the art — may differ. That is what "cosmetic" has to mean if the
   * word is going to carry §7's weight.
   */
  it('differs from its twin in art and nothing else', () => {
    for (const [vipId, twinId] of Object.entries(DECOR_VIP_TWIN)) {
      const vip = DECOR[vipId]!;
      const twin = DECOR[twinId]!;

      expect(vip.footprint, `${vipId} footprint`).toEqual(twin.footprint);
      expect(vip.solid, `${vipId} solid`).toBe(twin.solid);
      expect(vip.price, `${vipId} price`).toBe(twin.price);
      expect(vip.tradeable, `${vipId} tradeable`).toBe(twin.tradeable);

      // Different art, or it is not a cosmetic — it is the same piece sold twice.
      expect(
        vip.sheet !== twin.sheet || JSON.stringify(vip.look) !== JSON.stringify(twin.look),
        `${vipId} draws exactly what ${twinId} draws`,
      ).toBe(true);
    }
  });

  it('is never tradeable, whatever else changes', () => {
    for (const id of vipIds) expect(DECOR[id]!.tradeable, id).toBe(false);
  });
});

describe('decorFootprint', () => {
  it('is inclusive and matches the piece size', () => {
    const def = DECOR.fence_h!;
    const box = decorFootprint(def, 5, 7);
    expect(box).toEqual({ x0: 5, y0: 7, x1: 5 + def.footprint.width - 1, y1: 7 });
  });
});

describe('reservedFarmTiles', () => {
  const reserved = reservedFarmTiles(TIERS);

  it('reserves every plot', () => {
    for (const plot of PLOT_POSITIONS) {
      expect(reserved.has(`${plot.x},${plot.y}`), `plot (${plot.x},${plot.y})`).toBe(true);
    }
  });

  it('reserves the water', () => {
    for (const tile of waterTiles()) {
      expect(reserved.has(`${tile.x},${tile.y}`), `water (${tile.x},${tile.y})`).toBe(true);
    }
  });

  it('leaves most of the farm free, or there is nowhere to decorate', () => {
    expect(reserved.size).toBeLessThan((FARM_WIDTH * FARM_HEIGHT) / 2);
  });

  /*
   * Current tiers, not the reserved maximum — the same distinction
   * `currentBuildingFootprints` draws for collision. A tier-0 player should be
   * able to decorate ground a Deluxe coop would one day cover.
   */
  it('reserves less ground at tier 0 than at the top tier', () => {
    const top = reservedFarmTiles({
      coop: COOP_TIER_ART.length - 1,
      barn: BARN_TIER_ART.length - 1,
    });
    expect(reserved.size).toBeLessThan(top.size);
  });
});

describe('canPlaceDecor', () => {
  const reserved = reservedFarmTiles(TIERS);
  const berry = DECOR.berry_pile!;
  const fence = DECOR.fence_h!;

  it('allows a legal placement', () => {
    const at = freeTile(reserved, berry);
    expect(canPlaceDecor(berry, at.x, at.y, reserved, [])).toEqual({ ok: true });
  });

  it('refuses off the map, on either edge', () => {
    expect(canPlaceDecor(berry, -1, 5, reserved, [])).toEqual({ ok: false, reason: 'off_map' });
    expect(canPlaceDecor(berry, 5, FARM_HEIGHT, reserved, [])).toEqual({
      ok: false,
      reason: 'off_map',
    });
    // A wide piece whose ANCHOR is on the map but whose far edge is not.
    expect(canPlaceDecor(fence, FARM_WIDTH - 1, 5, reserved, [])).toEqual({
      ok: false,
      reason: 'off_map',
    });
  });

  it('refuses a plot', () => {
    const plot = PLOT_POSITIONS[0]!;
    expect(canPlaceDecor(berry, plot.x, plot.y, reserved, [])).toEqual({
      ok: false,
      reason: 'reserved',
    });
  });

  /**
   * **Takes the FIRST water tile, not the sixth.** How much water the farm has
   * is the map author's decision now — `waterTiles()` reads `farm.json` — so an
   * index into the middle of it was asserting a map shape rather than the rule.
   * The rule is what matters: solid terrain is never placeable.
   */
  it('refuses water', () => {
    const water = waterTiles()[0];
    if (!water) return; // A map with no impassable terrain has nothing to refuse.

    expect(canPlaceDecor(berry, water.x, water.y, reserved, [])).toEqual({
      ok: false,
      reason: 'reserved',
    });
  });

  it('refuses a tile another piece already occupies', () => {
    const at = freeTile(reserved, berry);
    const others = [{ def: berry, x: at.x, y: at.y }];
    expect(canPlaceDecor(berry, at.x, at.y, reserved, others)).toEqual({
      ok: false,
      reason: 'occupied',
    });
  });

  it('lets a piece sit flush beside another without overlapping', () => {
    const at = freeTile(reserved, fence);
    const others = [{ def: fence, x: at.x, y: at.y }];
    // Half-open edges: a 3-wide piece at x occupies x..x+2, so x+3 is free.
    const beside = canPlaceDecor(fence, at.x + fence.footprint.width, at.y, reserved, others);
    if (beside.ok) expect(beside).toEqual({ ok: true });
    // (If the neighbouring tile happens to be reserved on this map, the point
    // is still made by the overlap test above.)
    expect(beside.ok || beside.reason !== 'occupied').toBe(true);
  });

  /*
   * The rule that makes solid decor safe to allow at all.
   *
   * You act on the tile you are FACING, so a plot is worked from one of its
   * four neighbours. Wall all four and the plot still grows and can never be
   * harvested — by hand or by the idle farmer.
   */
  describe('the plot ring', () => {
    const plot = PLOT_POSITIONS[0]!;
    const neighbours = [
      { x: plot.x - 1, y: plot.y },
      { x: plot.x + 1, y: plot.y },
      { x: plot.x, y: plot.y - 1 },
      { x: plot.x, y: plot.y + 1 },
    ];

    it('refuses a SOLID piece orthogonally beside a plot', () => {
      const post = DECOR.fence_v!;
      let refusals = 0;
      for (const at of neighbours) {
        const result = canPlaceDecor(post, at.x, at.y, reserved, []);
        // Some neighbours are themselves plots (reserved); the rest must be
        // refused for blocking, not allowed.
        expect(result.ok, `solid piece allowed at (${at.x},${at.y})`).toBe(false);
        if (!result.ok && result.reason === 'blocks_plot') refusals++;
      }
      expect(refusals, 'no neighbour was refused for blocking a plot').toBeGreaterThan(0);
    });

    it('ALLOWS a walk-over piece beside a plot', () => {
      // You can stand on a berry bush, so it takes nothing away.
      const allowed = neighbours.some((at) => canPlaceDecor(berry, at.x, at.y, reserved, []).ok);
      expect(allowed, 'non-solid decor should be placeable beside a plot').toBe(true);
    });

    it('does not refuse a solid piece far from the field', () => {
      const at = freeTile(reserved, DECOR.fence_v!);
      expect(canPlaceDecor(DECOR.fence_v!, at.x, at.y, reserved, []).ok).toBe(true);
    });
  });
});

describe('solidDecorTiles', () => {
  it('includes solid pieces and excludes walk-over ones', () => {
    const fence = DECOR.fence_h!;
    const berry = DECOR.berry_pile!;

    const tiles = solidDecorTiles([
      { def: fence, x: 4, y: 4 },
      { def: berry, x: 10, y: 10 },
    ]);

    expect(tiles).toHaveLength(fence.footprint.width * fence.footprint.height);
    expect(tiles.some((t) => t.x === 10 && t.y === 10)).toBe(false);
  });

  it('covers the whole footprint of a multi-tile piece', () => {
    const barrels = DECOR.barrels!;
    const tiles = solidDecorTiles([{ def: barrels, x: 3, y: 3 }]);
    expect(tiles).toHaveLength(barrels.footprint.width * barrels.footprint.height);
  });
});

describe('the field is decorable around, not into', () => {
  it('has at least one legal tile for every catalogue piece', () => {
    // A piece the map has nowhere to put is a piece the shop should not sell.
    const reserved = reservedFarmTiles(TIERS);
    for (const id of DECOR_IDS) {
      expect(() => freeTile(reserved, DECOR[id]!), `${id} has nowhere legal`).not.toThrow();
    }
  });

  it('never reserves a tile outside the map', () => {
    for (const tile of fieldTiles()) {
      expect(tile.x).toBeLessThan(FARM_WIDTH);
      expect(tile.y).toBeLessThan(FARM_HEIGHT);
    }
  });
});
