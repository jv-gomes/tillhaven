#!/usr/bin/env node
/**
 * Measures the IMPASSABLE shape of a terrain tile, at sub-tile resolution.
 *
 *   node scripts/measure-tile-masks.mjs "Grass Water Spring" 92
 *   node scripts/measure-tile-masks.mjs "Grass Water Spring" 92 --art
 *
 * **A different question from `measure-terrain.mjs`, which is why it is a
 * different script.** That one asks *what colour is this tile and can it be a
 * base fill* — a question about painting. This asks *which thirds of this tile
 * can a character not walk into* — a question about collision. Running both
 * from one script would mean one output where every reader has to work out
 * which half applies to them.
 *
 * **Terrain masks are colour-based, and that is the whole trick.**
 * `BUILDING_BODY_MASK` was measured from ALPHA: a building is drawn on
 * transparency, so "is there art here" and "is this solid" are the same
 * question. Terrain is the opposite — a shoreline tile is fully opaque across
 * its whole cell, half grass and half water, so alpha says "solid everywhere"
 * and means nothing. What makes a terrain third impassable is that it is
 * *water*, so this counts pixels against a water palette instead.
 *
 * `--art` falls back to alpha, for measuring a tile drawn on transparency the
 * way a building is.
 *
 * Emits the same 3-row x 3-character format `BUILDING_BODY_MASK` already uses,
 * so a measured terrain mask can be pasted straight into `TILE_COLLISION_MASK`
 * beside it: `#` solid, `.` walkable.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TILESETS = join(ROOT, 'assets', 'Tileset');
const TILE = 16;

/**
 * Sub-tile resolution. Mirrors `SUBTILE_RESOLUTION` in shared config — a mask
 * measured at a different resolution than the one that reads it is a mask that
 * silently means something else.
 */
const RES = 3;

/**
 * A third counts as solid at this coverage. Mirrors `SUBTILE_SOLID_THRESHOLD`.
 *
 * Low on purpose, and the reasoning is the same as for buildings: a third that
 * is a quarter water is a third whose water you can see, and letting the
 * character stand in visible water reads as a bug in a way that a slightly
 * generous bank does not.
 */
const THRESHOLD = 1 / 3;

/**
 * What reads as water, sampled from the pack rather than guessed.
 *
 * `#005ba7` is the shoreline sheet's own blue and `#8dfdff` its foam highlight;
 * `#0092dd` is the flat `water-tile` fill (`measure-terrain.mjs` reports it as
 * family `A`). Foam counts as water because it is drawn ON the water, at the
 * waterline — a character standing in the surf is standing in the sea.
 */
const WATER = new Set(['#005ba7', '#8dfdff', '#0092dd', '#2d594f']);

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * Pixel bounds of one sub-tile third.
 *
 * `TILE / RES` is 5.33, so the thirds are NOT equal in whole pixels — they come
 * out 6/5/5. Rounding each boundary rather than taking a fixed width is what
 * keeps them contiguous with no gap and no overlap; a fixed `floor(16/3) = 5`
 * would leave the tile's last pixel in no third at all.
 */
function band(index) {
  return [Math.round((index * TILE) / RES), Math.round(((index + 1) * TILE) / RES)];
}

function measureFrame(img, cols, frame, useAlpha) {
  const cx = (frame % cols) * TILE;
  const cy = Math.floor(frame / cols) * TILE;

  const rows = [];
  const detail = [];

  for (let ry = 0; ry < RES; ry++) {
    const [y0, y1] = band(ry);
    let row = '';
    const cells = [];

    for (let rx = 0; rx < RES; rx++) {
      const [x0, x1] = band(rx);
      let solid = 0;
      let total = 0;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = ((cy + y) * img.width + (cx + x)) * 4;
          total++;
          const a = img.data[i + 3];
          if (useAlpha) {
            if (a !== 0) solid++;
          } else if (a !== 0 && WATER.has(hex(img.data[i], img.data[i + 1], img.data[i + 2]))) {
            solid++;
          }
        }
      }

      const coverage = total === 0 ? 0 : solid / total;
      cells.push(coverage);
      row += coverage >= THRESHOLD ? '#' : '.';
    }

    rows.push(row);
    detail.push(cells);
  }

  return { rows, detail };
}

/** The tile as pixels, so a mask can be eyeballed against the art it came from. */
function art(img, cols, frame, useAlpha) {
  const cx = (frame % cols) * TILE;
  const cy = Math.floor(frame / cols) * TILE;
  const lines = [];
  for (let y = 0; y < TILE; y++) {
    let line = '';
    for (let x = 0; x < TILE; x++) {
      const i = ((cy + y) * img.width + (cx + x)) * 4;
      const a = img.data[i + 3];
      if (a === 0) line += ' ';
      else if (useAlpha) line += '#';
      else line += WATER.has(hex(img.data[i], img.data[i + 1], img.data[i + 2])) ? '~' : '.';
    }
    lines.push(line);
  }
  return lines;
}

const args = process.argv.slice(2);
const useAlpha = args.includes('--art');
const positional = args.filter((a) => !a.startsWith('--'));
const [needle, frameArg] = positional;

if (!needle || frameArg === undefined) {
  console.error('usage: measure-tile-masks.mjs <sheet substring> <frame> [--art]');
  process.exit(1);
}

const file = readdirSync(TILESETS).find((f) =>
  f.toLowerCase().includes(needle.toLowerCase()),
);
if (!file) {
  console.error(`no tileset matching "${needle}" in ${TILESETS}`);
  process.exit(1);
}

const img = decodePng(readFileSync(join(TILESETS, file)));
const cols = Math.floor(img.width / TILE);
const frame = Number(frameArg);

console.log(`\n${file}  ${img.width}x${img.height}  ${cols} cols`);
console.log(`frame ${frame} @ cell (${frame % cols},${Math.floor(frame / cols)})`);
console.log(`counting ${useAlpha ? 'ALPHA (art on transparency)' : 'WATER COLOURS'}\n`);

for (const line of art(img, cols, frame, useAlpha)) console.log(`  |${line}|`);

const { rows, detail } = measureFrame(img, cols, frame, useAlpha);
console.log('\ncoverage per third:');
for (const cells of detail) {
  console.log('  ' + cells.map((c) => `${(c * 100).toFixed(0).padStart(3)}%`).join(' '));
}

console.log('\nmask:');
for (const row of rows) console.log(`  '${row}',`);
console.log();
