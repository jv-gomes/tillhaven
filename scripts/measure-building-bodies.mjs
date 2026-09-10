#!/usr/bin/env node
/**
 * Measures the BODY of every farm building — the part that blocks the player
 * (T-23.02).
 *
 *   node scripts/measure-building-bodies.mjs
 *
 * Why this exists. `footprintOf` in `buildings.ts` makes every tile the art's
 * bounding box touches solid, which for a building drawn in near-front
 * elevation means **the roof collides**. Measured on the tier-0 farmhouse: six
 * of its forty-eight solid tiles contain no drawn pixels at all, and the top
 * row is 10.6% covered — a twenty-pixel chimney cap blocking eight tiles of
 * visible grass. A player walking the top of the map meets an invisible wall.
 *
 * Map objects never had this problem, because `measure-object-bases.mjs`
 * already answers the same question for them: a maple blocks its 12px trunk,
 * not its 32px cell, and the canopy is walk-behind. This script is that idea
 * applied to buildings.
 *
 * What "body" means here. The rows where the building meets the ground — walls,
 * doors, windows — and NOT the roof above them. The boundary is a judgement
 * about art, so this script does not decide it: it prints the per-row alpha
 * profile and the tile grid, and a human reads the wall/roof line off the
 * picture. A bare coverage threshold gets this wrong in a way that matters —
 * on the farmhouse it leaves the chimney tile solid, a one-tile pillar standing
 * in open grass, which reads worse to a player than the wall it replaced.
 *
 * The output is paste-ready for `BUILDING_BODY` in `config/collision.ts`, but
 * the `bodyPx` values are REVIEWED, not generated. Same discipline as §9: the
 * script measures, a person decides, and the reasoning goes in the comment.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, alphaAt } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'apps/client/public/assets');
const TILE = 16;

/**
 * Coverage at which a tile counts as part of the building.
 *
 * A quarter, not a half: the eaves and gable edges of these roofs taper, and a
 * corner tile carrying a real slice of wall should still stop the player. The
 * threshold only PROPOSES a mask — the numbers below it are reviewed by eye,
 * because a threshold alone cannot tell a chimney from a chimney-shaped wall.
 */
const SOLID_COVERAGE = 0.25;

/** Every building look the collision layer draws, in tier order. */
const TARGETS = [
  ['obj-farmhouse', 'OBJ_FARMHOUSE_LOOK', 'farmhouse tier 0'],
  ['obj-farmhouse-t1', 'OBJ_FARMHOUSE_T1_LOOK', 'farmhouse tier 1'],
  ['obj-farmhouse-t2', 'OBJ_FARMHOUSE_T2_LOOK', 'farmhouse tier 2'],
  ['obj-chicken-coop', 'OBJ_CHICKEN_COOP_LOOK', 'coop tier 0'],
  ['obj-chicken-coop-big', 'OBJ_CHICKEN_COOP_BIG_LOOK', 'coop tier 1'],
  ['obj-chicken-coop-deluxe', 'OBJ_CHICKEN_COOP_DELUXE_LOOK', 'coop tier 2'],
  ['obj-barn', 'OBJ_BARN_LOOK', 'barn tier 0'],
  ['obj-barn-big', 'OBJ_BARN_BIG_LOOK', 'barn tier 1'],
  ['obj-barn-deluxe', 'OBJ_BARN_DELUXE_LOOK', 'barn tier 2'],
];

const manifest = readFileSync(join(ROOT, 'packages/shared/src/config/assets.ts'), 'utf8');

function look(name) {
  const m = manifest.match(
    new RegExp(`export const ${name} = \\{ x: (\\d+), y: (\\d+), width: (\\d+), height: (\\d+) \\}`),
  );
  if (!m) throw new Error(`no look window named ${name} in assets.ts`);
  return { x: +m[1], y: +m[2], width: +m[3], height: +m[4] };
}

for (const [key, lookName, label] of TARGETS) {
  const img = decodePng(readFileSync(join(ASSETS, `${key}.png`)));
  const win = look(lookName);
  const rows = Math.ceil(win.height / TILE);
  const cols = Math.ceil(win.width / TILE);

  console.log(`\n${'='.repeat(64)}\n${label}  —  ${key}.png  ${win.width}x${win.height}px`);
  console.log(`bounding box: ${cols}x${rows} tiles = ${cols * rows} solid today`);
  console.log('\n  row  coverage  opaque span            tiles (# = >0 art)');

  for (let r = rows - 1; r >= 0; r--) {
    // Row r counted from the BOTTOM, matching how a bottom-anchored sprite sits.
    const yTop = Math.max(0, win.height - (r + 1) * TILE);
    const yBot = win.height - r * TILE;

    let opaque = 0;
    let total = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let cells = '';

    for (let c = 0; c < cols; c++) {
      let cellOpaque = 0;
      for (let y = yTop; y < yBot; y++) {
        for (let x = c * TILE; x < Math.min(win.width, (c + 1) * TILE); x++) {
          total += 1;
          if (alphaAt(img, win.x + x, win.y + y) > 0) {
            opaque += 1;
            cellOpaque += 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      cells += cellOpaque === 0 ? '.' : '#';
    }

    const pct = total ? (opaque / total) * 100 : 0;
    const span = minX === Infinity ? 'EMPTY' : `x${minX}..${maxX}`;
    const px = `${r * TILE}..${(r + 1) * TILE - 1}px`;
    const flag = pct === 0 ? '  <-- NO ART, yet solid' : pct < 25 ? '  <-- roof furniture?' : '';
    console.log(
      `  ${String(r).padStart(2)}  ${pct.toFixed(1).padStart(6)}%  ${span.padEnd(12)} ${px.padEnd(10)} ${cells}${flag}`,
    );
  }

  /*
   * The paste-ready mask. A rectangle is NOT enough and the measurement is why:
   * several buildings have a wing whose base sits higher than the rest, so the
   * tiles below it are empty at ground level — yard in FRONT of the wall, which
   * a player should walk on. `house t1` has seven such tiles.
   *
   * Rows are printed top-down so the string literal in `collision.ts` looks
   * like the building.
   */
  const mask = [];
  for (let r = rows - 1; r >= 0; r--) {
    const yTop = Math.max(0, win.height - (r + 1) * TILE);
    const yBot = win.height - r * TILE;
    let row = '';
    for (let c = 0; c < cols; c++) {
      let opaque = 0;
      let total = 0;
      for (let y = yTop; y < yBot; y++) {
        for (let x = c * TILE; x < Math.min(win.width, (c + 1) * TILE); x++) {
          total += 1;
          if (alphaAt(img, win.x + x, win.y + y) > 0) opaque += 1;
        }
      }
      row += total && opaque / total >= SOLID_COVERAGE ? '#' : '.';
    }
    mask.push(row);
  }
  console.log(`\n  proposed mask (>=${SOLID_COVERAGE * 100}% coverage, REVIEW before pasting):`);
  console.log(`  '${key}': [`);
  for (const row of mask) console.log(`    '${row}',`);
  console.log('  ],');
}
