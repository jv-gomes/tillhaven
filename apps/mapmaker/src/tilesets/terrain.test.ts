import { describe, expect, it } from 'vitest';
import { TILESET_GRASS_SPRING } from '@tillhaven/shared/config';
import {
  BLOCK_COLS,
  BLOCK_ROWS,
  DEFAULT_TERRAIN_SETS,
  E,
  MASK_TO_ROLE,
  N,
  ROLES,
  S,
  SPRING_BLOCK_ROLES,
  W,
  blockFrame,
  frameForRole,
  framesOf,
  roleFor,
  type TerrainSet,
} from './terrain.js';
import terrainSetsJson from './terrain-sets.json';

/**
 * `SPRING_BLOCK_ROLES`/`blockFrame`/`frameForRole` are generic, asset-
 * agnostic machinery kept for whenever real nine-slice autotile art shows up
 * (see terrain.ts's module comment) — no shipped `DEFAULT_TERRAIN_SETS` entry
 * uses them today (T-7.07: the old pack's `tileset-spring` is deleted, and
 * T-7.05 already found none of the new pack's tilesets are built this way).
 * These fixtures exercise the algorithm against a real, registered manifest
 * sheet purely for its geometry (big enough for 5 stacked 4x4 blocks) — NOT
 * a claim that `tileset-grass-spring.png` is autotile-compatible.
 */
function fixtureSet(block: number): TerrainSet {
  return {
    id: `fixture-block-${block}`,
    name: 'fixture',
    tilesetKey: TILESET_GRASS_SPRING.key,
    block,
    roles: { ...SPRING_BLOCK_ROLES },
  };
}

const grass = fixtureSet(0);

describe('MASK_TO_ROLE', () => {
  it('covers all 16 orthogonal neighbourhoods', () => {
    expect(MASK_TO_ROLE).toHaveLength(16);
    for (const role of MASK_TO_ROLE) {
      expect(ROLES).toContain(role);
    }
  });

  it('names the exposed side, not the occupied one', () => {
    // Nothing above -> north edge. This is the direction that is easy to invert.
    expect(roleFor(E | S | W)).toBe('n');
    expect(roleFor(N | E | W)).toBe('s');
    expect(roleFor(N | E | S)).toBe('w');
    expect(roleFor(N | S | W)).toBe('e');
  });

  it('maps the four outer corners', () => {
    expect(roleFor(E | S)).toBe('nw');
    expect(roleFor(S | W)).toBe('ne');
    expect(roleFor(N | E)).toBe('sw');
    expect(roleFor(N | W)).toBe('se');
  });

  it('degrades unsupported shapes to fill rather than emitting nothing', () => {
    // The tileset has no cap or corridor art; documented in terrain.ts.
    expect(roleFor(0)).toBe('c');
    expect(roleFor(N | S)).toBe('c');
    expect(roleFor(E | W)).toBe('c');
  });
});

describe('roleFor diagonals', () => {
  const all = N | E | S | W;
  const full = { nw: true, ne: true, sw: true, se: true };

  it('returns plain fill when every diagonal matches', () => {
    expect(roleFor(all, full)).toBe('c');
  });

  it('selects the inner-corner tile covering the missing diagonal', () => {
    expect(roleFor(all, { ...full, nw: false })).toBe('innerNWSE');
    expect(roleFor(all, { ...full, se: false })).toBe('innerNWSE');
    expect(roleFor(all, { ...full, ne: false })).toBe('innerNESW');
    expect(roleFor(all, { ...full, sw: false })).toBe('innerNESW');
  });

  it('picks the pair with more gaps, deterministically on a tie', () => {
    expect(roleFor(all, { nw: false, se: false, ne: false, sw: true })).toBe('innerNWSE');
    expect(roleFor(all, { nw: true, se: false, ne: false, sw: false })).toBe('innerNESW');
    // Tie: one gap on each diagonal. NW/SE wins so the result is stable.
    expect(roleFor(all, { nw: false, se: true, ne: false, sw: true })).toBe('innerNWSE');
  });

  it('ignores diagonals unless the cell is fully surrounded', () => {
    expect(roleFor(E | S, { nw: false, ne: false, sw: false, se: false })).toBe('nw');
  });
});

describe('spring tileset layout', () => {
  it('assigns every role a distinct cell in the 4x4 block', () => {
    const indices = Object.values(SPRING_BLOCK_ROLES);
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices.every((i) => i >= 0 && i < BLOCK_COLS * BLOCK_ROWS)).toBe(true);
  });

  it('never assigns a role to one of the five blank cells', () => {
    // Verified by inspecting the rendered PNG: locals 1, 6, 7, 8 and 14 are
    // fully transparent in every block. Painting one would punch a hole.
    const blank = new Set([1, 6, 7, 8, 14]);
    for (const index of Object.values(SPRING_BLOCK_ROLES)) {
      expect(blank.has(index)).toBe(false);
    }
  });

  it('offsets block-local indices into the right tileset row', () => {
    // Block 2 local 0 is tileset row 8, column 0; local 15 is row 11, column 3.
    const soil = fixtureSet(2);
    expect(blockFrame(soil, 0)).toBe(8 * TILESET_GRASS_SPRING.cols + 0);
    expect(blockFrame(soil, 15)).toBe(11 * TILESET_GRASS_SPRING.cols + 3);
  });
});

describe('frameForRole', () => {
  it('resolves every role for a fully calibrated set', () => {
    for (const role of ROLES) {
      expect(frameForRole(grass, role)).toBeTypeOf('number');
    }
  });

  it('falls back to fill for an uncalibrated role instead of leaving a hole', () => {
    const partial: TerrainSet = { ...grass, roles: { c: SPRING_BLOCK_ROLES.c } };
    expect(frameForRole(partial, 'nw')).toBe(frameForRole(partial, 'c'));
  });

  it('returns undefined when the set has no fill at all', () => {
    const empty: TerrainSet = { ...grass, roles: {} };
    expect(frameForRole(empty, 'c')).toBeUndefined();
  });

  it('lists exactly the frames the set owns', () => {
    expect(framesOf(grass).size).toBe(Object.keys(SPRING_BLOCK_ROLES).length);
  });
});

describe('terrain-sets.json', () => {
  const sets = terrainSetsJson as unknown as TerrainSet[];

  it('stays in step with the shipped defaults', () => {
    // The JSON is what the editor actually loads. If it drifts from the code
    // defaults, the brush silently behaves differently from what terrain.ts
    // documents.
    expect(sets.map((s) => s.id)).toEqual(DEFAULT_TERRAIN_SETS.map((s) => s.id));
    for (const [i, set] of sets.entries()) {
      expect(set.roles).toEqual(DEFAULT_TERRAIN_SETS[i]?.roles);
      expect(set.block).toBe(DEFAULT_TERRAIN_SETS[i]?.block);
    }
  });

});

describe('flat-fill sets', () => {
  /*
   * These sets calibrate ONLY the `c` role, because the surfaces they paint
   * have no edge art in the map: the ground layer is flat and `plots.ts` draws
   * the tilled-soil rims at runtime from its own neighbour mask.
   *
   * **What changed in the re-scope**: the frames used to be 0 on synthetic 1x1
   * images the game drew itself, because T-7.05 measured the incomplete pack
   * and found no tile that fills its cell edge to edge. They are now measured
   * frames of the pack's own tilesets, so `c` is 57 or 345 rather than 0, and
   * several sets legitimately share a sheet.
   */
  const flatIds = [
    'water',
    'ground-grass',
    'ground-tillable',
    'ground-soil-dry',
    'ground-soil-wet',
    'ground-path',
  ];
  const flatSets = flatIds.map(
    (id) => DEFAULT_TERRAIN_SETS.find((s) => s.id === id) as TerrainSet,
  );

  it('are present, one per flat surface, all block 0', () => {
    for (const [i, set] of flatSets.entries()) {
      expect(set, `${flatIds[i]} is missing`).toBeDefined();
      expect(set.block, flatIds[i]).toBe(0);
      // A flat surface declares an absolute frame and no roles at all — see
      // `TerrainSet.fillFrame` for why a block index cannot express these.
      expect(Object.keys(set.roles), flatIds[i]).toEqual([]);
      expect(set.fillFrame, flatIds[i]).toEqual(expect.any(Number));
    }
  });

  it('resolve the SAME frame for every role — a flat fill has no edges', () => {
    for (const set of flatSets) {
      const fill = set.fillFrame!;
      for (const role of ROLES) {
        expect(frameForRole(set, role), `${set.id} ${role}`).toBe(fill);
      }
    }
  });

  /**
   * **Distinct (tileset, frame) pairs, not distinct tilesets.**
   *
   * The old rule was "a flat fill is not reused across surfaces", asserted as
   * distinct tileset KEYS — which held only while every surface had its own
   * one-tile image. Grass and the tillable field now come from the same sheet
   * at different frames, as do dry and wet soil, so keys collide by design.
   *
   * What must still hold is that no two surfaces look identical: if the
   * tillable field ever resolved to the same frame as grass, the player would
   * have no way to see where the field is.
   */
  it('paint six visibly different surfaces', () => {
    const painted = flatSets.map((s) => `${s.tilesetKey}#${s.fillFrame}`);
    expect(new Set(painted).size, painted.join(' ')).toBe(painted.length);
  });
});

