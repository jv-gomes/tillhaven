#!/usr/bin/env node
/**
 * Which cells of an animated tileset actually animate.
 *
 *   node scripts/measure-tile-animation.mjs
 *
 * `ANIMATED_SHEETS` says a sheet holds four frames of the same art a fixed
 * offset apart. That is true of the LAYOUT and not of every cell in it: both
 * water sheets carry flat fills and pure-grass pieces that are byte-identical in
 * all four blocks. Animating one draws the same image four times — as still as
 * not animating at all, but paying for a timer and a layer redraw.
 *
 * **This is the measurement that stops "I painted water and it did not move"
 * being a mystery.** The farm's top row was painted with one of these cells; the
 * mechanism was working perfectly and the art had nothing to show. Knowing which
 * cells are static lets the editor mark them, so the answer is visible in the
 * palette instead of after a save and a reload.
 *
 * Prints the static frame indices per sheet, for pasting into
 * `packages/shared/src/config/groundAnim.ts` as measured constants — the same
 * way `WATER_ANIM_FRAMES` and `SOIL_DRY_FRAMES` are recorded.
 *
 * Requires the prepared assets (`pnpm assets`). Decoded with the repo's own
 * `lib/png.mjs`, like every other measure-* script — no image dependency.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'apps/client/public/assets');

/** Mirrors `ANIMATED_SHEETS`. Kept here rather than imported so this script
 *  stays runnable against a checkout with a broken shared build. */
const SHEETS = [
  { key: 'tileset-grass-water-spring', cols: 48, rows: 16, frames: 4, dx: 12, dy: 0 },
  { key: 'tileset-water-anim', cols: 24, rows: 16, frames: 4, dx: 0, dy: 4 },
];

const TILE = 16;

function main() {
  for (const spec of SHEETS) {
    const img = decodePng(readFileSync(resolve(ASSETS, `${spec.key}.png`)));

    /** One cell's pixels as a comparable string. */
    const cell = (col, row) => {
      const out = [];
      for (let y = 0; y < TILE; y++) {
        const base = ((row * TILE + y) * img.width + col * TILE) * 4;
        for (let i = 0; i < TILE * 4; i++) out.push(img.data[base + i]);
      }
      return out.join(',');
    };

    const staticFrames = [];
    let animating = 0;

    for (let row = 0; row < spec.rows; row++) {
      for (let col = 0; col < spec.cols; col++) {
        // Only the first block is walked: every other block is one of the
        // frames of a first-block cell, and reporting it separately would
        // count the same loop four times.
        if (spec.dx > 0 && col >= spec.dx) continue;
        if (spec.dy > 0 && row >= spec.dy) continue;

        const seq = [];
        for (let k = 0; k < spec.frames; k++) {
          seq.push(cell(col + spec.dx * k, row + spec.dy * k));
        }

        const base = row * spec.cols + col;
        if (new Set(seq).size === 1) {
          // Every block's copy of this cell is static, so record all of them —
          // a tile painted from block 3 is just as still as one from block 0.
          for (let k = 0; k < spec.frames; k++) {
            staticFrames.push(
              (row + spec.dy * k) * spec.cols + (col + spec.dx * k),
            );
          }
        } else {
          animating += 1;
        }
        void base;
      }
    }

    staticFrames.sort((a, b) => a - b);
    console.log(`\n${spec.key} — ${img.width}x${img.height}, ${spec.cols}x${spec.rows} cells`);
    console.log(`  animating base cells: ${animating}`);
    console.log(`  static frames (${staticFrames.length}):`);
    console.log(`  [${staticFrames.join(', ')}]`);
  }
}

main();
