/**
 * Autotile ("terrain brush") support.
 *
 * `SPRING_BLOCK_ROLES` below documents a NINE-SLICE-PLUS-TWO-INNER-CORNERS
 * layout (4x4 tiles, one "block") that the OLD pack's `tileset-spring.png`
 * used to ship, in five repeated blocks:
 *
 *        c0        c1          c2          c3
 *   r0   NW         -          N           NE
 *   r1   W        inner\       -           -
 *   r2   -        FILL       inner/        E
 *   r3   SW        S          -            SE
 *
 * Block-local indices: NW 0, N 2, NE 3, W 4, inner\ 5, FILL 9, inner/ 10,
 * E 11, SW 12, S 13, SE 15. Locals 1, 6, 7, 8 and 14 are blank in every block.
 *
 * The two "inner" tiles carry inner (concave) corners on OPPOSITE diagonals:
 * tile 5 cuts the NW and SE corners, tile 10 cuts NE and SW. There is no tile
 * for a single inner corner, so requesting one necessarily draws its opposite
 * as well. That is a limit of the art, not of this code.
 *
 * **The old pack (and `tileset-spring.png` with it) is deleted in T-7.07.**
 * T-7.05 already found that none of the NEW pack's tileset sheets
 * (`tileset-grass-spring.png`, `tileset-soil.png`, `tileset-paths.png`) are
 * built this way — every cell is a self-contained rounded patch or framed-rug
 * piece, never straight-edged art meant to connect with a same-type
 * neighbour — which is why `DEFAULT_TERRAIN_SETS` below ships ONLY flat-fill
 * sets today. `SPRING_BLOCK_ROLES`/`roleFor`/`blockFrame`/`frameForRole` stay
 * as generic, asset-agnostic machinery (a role name and a mask do not care
 * which PNG they index into) for whenever real nine-slice autotile art shows
 * up in a future pack; they are exercised against a synthetic fixture set in
 * `terrain.test.ts`, not against a shipped default, until then.
 *
 * The layout still lives in data rather than in code so a different art pack —
 * or a correction — is a JSON edit calibrated in the Terrain panel, not a
 * rewrite. `terrain-sets.json` is the committed calibration.
 */

import { GROUND_GRASS, GROUND_SOIL_DRY, GROUND_SOIL_WET, GROUND_PATH, WATER_TILE } from '@tillhaven/shared/config';
import { runByKey } from '@tillhaven/shared/config';

export const ROLES = [
  'nw',
  'n',
  'ne',
  'w',
  'c',
  'e',
  'sw',
  's',
  'se',
  'innerNWSE',
  'innerNESW',
] as const;

export type Role = (typeof ROLES)[number];

export interface TerrainSet {
  /** Stable id used in saved editor state. */
  readonly id: string;
  readonly name: string;
  /** Tileset key from the shared manifest. */
  readonly tilesetKey: string;
  /** Which 4x4 block within that tileset, 0-based. */
  readonly block: number;
  /** Role -> tile index within the block (0..15). */
  readonly roles: Partial<Record<Role, number>>;
}

/** Rows per autotile block. Matches TILESET_SOURCE.blockRows in the manifest. */
export const BLOCK_ROWS = 4;
export const BLOCK_COLS = 4;

/**
 * Neighbour bits. Orthogonal only — the diagonals are consulted separately,
 * because they select between the two inner-corner tiles rather than
 * participating in the nine-slice choice.
 */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

/**
 * Orthogonal mask (0..15) -> nine-slice role.
 *
 * A bit is SET when that neighbour is the same terrain, so the role names the
 * side that is exposed: mask 14 (E|S|W set, N clear) means nothing above, i.e.
 * the north edge.
 *
 * Three cases have no art and degrade to the fill tile, documented rather than
 * silently wrong:
 *   0  a lone tile with no neighbours
 *   5  a 1-tile-wide vertical strip
 *   10 a 1-tile-wide horizontal strip
 * The tileset has no cap or corridor tiles, so a 1-wide run of terrain renders
 * as unbordered fill. Paint at least 2 tiles wide for a clean edge.
 */
export const MASK_TO_ROLE: readonly Role[] = [
  /*  0 ---- */ 'c',
  /*  1 N--- */ 's',
  /*  2 -E-- */ 'w',
  /*  3 NE-- */ 'sw',
  /*  4 --S- */ 'n',
  /*  5 N-S- */ 'c',
  /*  6 -ES- */ 'nw',
  /*  7 NES- */ 'w',
  /*  8 ---W */ 'e',
  /*  9 N--W */ 'se',
  /* 10 -E-W */ 'c',
  /* 11 NE-W */ 's',
  /* 12 --SW */ 'ne',
  /* 13 N-SW */ 'e',
  /* 14 -ESW */ 'n',
  /* 15 NESW */ 'c',
];

/** Diagonal neighbours, used only to refine the fill tile. */
export interface Diagonals {
  nw: boolean;
  ne: boolean;
  sw: boolean;
  se: boolean;
}

/**
 * Pick the role for a cell given which neighbours share its terrain.
 *
 * Diagonals are consulted only when all four orthogonals match — that is the
 * one situation where an inner corner is visible. When both diagonal pairs have
 * a gap the tileset can only express one of them; the pair with more missing
 * corners wins, ties going to the NW/SE tile so the result is deterministic.
 */
export function roleFor(mask: number, diag?: Diagonals): Role {
  const base = MASK_TO_ROLE[mask & 0b1111] ?? 'c';
  if (base !== 'c' || (mask & 0b1111) !== 0b1111 || !diag) return base;

  const nwse = (diag.nw ? 0 : 1) + (diag.se ? 0 : 1);
  const nesw = (diag.ne ? 0 : 1) + (diag.sw ? 0 : 1);
  if (nwse === 0 && nesw === 0) return 'c';
  return nwse >= nesw ? 'innerNWSE' : 'innerNESW';
}

/** Convert a block-local tile index to a frame index in the whole tileset. */
export function blockFrame(set: TerrainSet, localIndex: number): number | undefined {
  const run = runByKey(set.tilesetKey);
  if (!run) return undefined;
  const row = set.block * BLOCK_ROWS + Math.floor(localIndex / BLOCK_COLS);
  const col = localIndex % BLOCK_COLS;
  if (row >= run.rows || col >= run.columns) return undefined;
  return row * run.columns + col;
}

/**
 * Resolve a role to a frame index, falling back to the fill tile when a set has
 * not had that role calibrated. Returning the fill keeps a half-calibrated set
 * usable; returning undefined would punch holes in the map.
 */
export function frameForRole(set: TerrainSet, role: Role): number | undefined {
  const local = set.roles[role] ?? set.roles.c;
  if (local === undefined) return undefined;
  return blockFrame(set, local);
}

/** All frames a set owns, for "is this tile part of this terrain?" tests. */
export function framesOf(set: TerrainSet): Set<number> {
  const frames = new Set<number>();
  for (const role of ROLES) {
    const local = set.roles[role];
    if (local === undefined) continue;
    const frame = blockFrame(set, local);
    if (frame !== undefined) frames.add(frame);
  }
  return frames;
}

/**
 * The layout every block of the spring tileset uses. Kept as one constant so
 * the default sets below cannot drift apart from each other.
 */
export const SPRING_BLOCK_ROLES: Readonly<Record<Role, number>> = {
  nw: 0,
  n: 2,
  ne: 3,
  w: 4,
  innerNWSE: 5,
  c: 9,
  innerNESW: 10,
  e: 11,
  sw: 12,
  s: 13,
  se: 15,
};

/**
 * Shipped defaults. Only flat-fill sets today — see the module comment above
 * for why the old pack's 5-block nine-slice sets are gone rather than
 * re-pointed at the new pack (T-7.07).
 */
export const DEFAULT_TERRAIN_SETS: readonly TerrainSet[] = [
  // New pack (T-7.05). `tileset-grass-spring.png`, `tileset-soil.png` and
  // `tileset-paths.png` turned out to hold only self-contained rounded
  // patches / framed rug pieces — never straight-edged art meant to connect
  // with a same-type neighbour (verified by grid-overlay and
  // connected-component inspection, see the T-7.05 write-up in
  // ROADMAP.md). Forcing the 4x4 NW/N/NE/W/… layout above onto them would
  // paint gaps at every seam. Instead, each of these is a flat colour
  // sampled from the pack's own art (`scripts/draw-ground-tiles.py`) with
  // only the `c` (fill) role calibrated — `frameForRole`'s existing
  // fall-to-fill behaviour means every other role resolves to the SAME
  // frame, which is exactly correct for a flat tile: there is no edge to
  // draw. `water-tile.png` needs no synthesis; it already ships flat.
  {
    id: 'water',
    name: 'Water (flat)',
    tilesetKey: WATER_TILE.key,
    block: 0,
    roles: { c: 0 },
  },
  {
    id: 'ground-grass',
    name: 'Grass (flat fill)',
    tilesetKey: GROUND_GRASS.key,
    block: 0,
    roles: { c: 0 },
  },
  {
    id: 'ground-soil-dry',
    name: 'Tilled soil, dry (flat fill)',
    tilesetKey: GROUND_SOIL_DRY.key,
    block: 0,
    roles: { c: 0 },
  },
  {
    id: 'ground-soil-wet',
    name: 'Tilled soil, wet (flat fill)',
    tilesetKey: GROUND_SOIL_WET.key,
    block: 0,
    roles: { c: 0 },
  },
  {
    id: 'ground-path',
    name: 'Path (flat fill)',
    tilesetKey: GROUND_PATH.key,
    block: 0,
    roles: { c: 0 },
  },
];
