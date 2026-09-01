#!/usr/bin/env node
/**
 * Measures the maple tree sheets (T-9.05), and re-checks the constants that
 * came out of it.
 *
 *   node scripts/measure-maple.mjs
 *
 * The pack ships two maple files with no metadata: a still sheet of variants
 * (`obj-maple-tree.png`, 9x4) and an "animation" sheet (`obj-maple-tree-anim.png`,
 * 4x7). The manifest's original notes guessed at both — "a gentle sway", "a
 * shadow column" — and neither is what the art does. This script is the
 * evidence, kept runnable so the next person does not have to take the
 * findings on trust:
 *
 *   1. Every row of the anim sheet holds ONE tree; the four columns are
 *      [plain, white silhouette, leaves A, leaves B].
 *   2. Columns 0/2/3 have IDENTICAL canopies and trunks — the differing pixels
 *      are all detached leaves landing in previously transparent space. There
 *      is no sway to play.
 *   3. Anim row 0 is pixel-for-pixel the still sheet's frame 2, the tree
 *      `farm.json` actually places. That equality is what lets the client swap
 *      one sheet for the other without moving or recolouring anything.
 *
 * Exits non-zero if any of that stops being true, so it doubles as a guard for
 * a pack update. The config test in packages/shared covers the arithmetic
 * (frame indices in range, right row, silhouette skipped); only this can check
 * the pixels.
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'apps', 'client', 'public', 'assets');

/** Frame geometry, from `OBJ_MAPLE_TREE`/`OBJ_MAPLE_TREE_ANIM` in assets.ts. */
const W = 32;
const H = 48;
/** The one column the loop must never play — see the silhouette check below. */
const SILHOUETTE_COLUMN = 1;

/**
 * Reads `MAPLE_TREE` out of the manifest rather than restating it.
 *
 * A second copy of these numbers here would be a copy that can go stale
 * silently, which defeats the point of a checker. Scraping the source is
 * clumsy — importing it would mean building the TS package for a throwaway
 * tool — but it fails loudly if the shape changes, which a stale copy does not.
 */
function readMapleConstants() {
  const src = readFileSync(join(ROOT, 'packages', 'shared', 'src', 'config', 'assets.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const MAPLE_TREE = {'));
  const number = (name) => {
    const m = block.match(new RegExp(`${name}:\\s*(\\d+)`));
    if (!m) throw new Error(`could not find MAPLE_TREE.${name} in assets.ts`);
    return Number(m[1]);
  };
  const columns = block.match(/animColumns:\s*\[([\d,\s]+)\]/);
  if (!columns) throw new Error('could not find MAPLE_TREE.animColumns in assets.ts');

  return {
    stillFrame: number('stillFrame'),
    animRow: number('animRow'),
    animColumns: columns[1].split(',').map((n) => Number(n.trim())),
  };
}

const EXPECTED = readMapleConstants();

/* Minimal PNG decode (8-bit RGBA, non-interlaced) — same local copy as
 * scripts/measure-character.mjs, kept local for the same reason: these are
 * throwaway measuring tools, not a library. */
function decodePng(buf) {
  let pos = 8;
  let width = 0, height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('expected 8-bit RGBA');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[x - 4] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 0xff;
    }
  }
  return { width, height, data: px };
}

/** One WxH cell as a flat RGBA array. */
function cell(img, col, row) {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = ((row * H + y) * img.width + col * W + x) * 4;
      const d = (y * W + x) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

/** Differing pixels between two cells, split by what changed. */
function compare(a, b) {
  let added = 0; // was transparent, now painted — a leaf in mid-air
  let removed = 0;
  let recoloured = 0; // the tree itself changed — that would be a sway
  for (let i = 0; i < a.length; i += 4) {
    const oa = a[i + 3] > 8;
    const ob = b[i + 3] > 8;
    if (!oa && ob) added++;
    else if (oa && !ob) removed++;
    else if (oa && ob && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])) {
      recoloured++;
    }
  }
  return { added, removed, recoloured };
}

function opaqueColours(c) {
  const seen = new Set();
  for (let i = 0; i < c.length; i += 4) {
    if (c[i + 3] > 8) seen.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
  }
  return seen;
}

const still = decodePng(readFileSync(join(ASSETS, 'obj-maple-tree.png')));
const anim = decodePng(readFileSync(join(ASSETS, 'obj-maple-tree-anim.png')));
const problems = [];

console.log(`still ${still.width}x${still.height}   anim ${anim.width}x${anim.height}`);
console.log('\nanim sheet, per row: differences from column 0');
console.log('row   col1(silhouette)          col2            col3');

const animCols = anim.width / W;
const animRows = anim.height / H;

for (let row = 0; row < animRows; row++) {
  const base = cell(anim, 0, row);
  const parts = [];
  for (let col = 1; col < animCols; col++) {
    const d = compare(base, cell(anim, col, row));
    parts.push(`+${d.added} -${d.removed} ~${d.recoloured}`.padEnd(18));
  }
  console.log(`${row}     ${parts.join(' ')}`);

  // The claim: the leaf columns add pixels and never repaint the tree.
  for (const col of EXPECTED.animColumns.filter((c) => c !== 0)) {
    const d = compare(base, cell(anim, col, row));
    if (d.recoloured !== 0 || d.removed !== 0) {
      problems.push(
        `row ${row} col ${col} changes the tree itself ` +
          `(${d.recoloured} recoloured, ${d.removed} removed) — that WOULD be a sway`,
      );
    }
    if (d.added === 0) problems.push(`row ${row} col ${col} is identical to col 0 — no leaves`);
  }
}

// The silhouette column: the canopy filled with one flat colour.
const silhouette = cell(anim, SILHOUETTE_COLUMN, EXPECTED.animRow);
const colours = opaqueColours(silhouette);
console.log(`\ncol ${SILHOUETTE_COLUMN} distinct opaque colours: ${colours.size} (${[...colours].join(' ')})`);
if (!colours.has('255,255,255')) {
  problems.push(`col ${SILHOUETTE_COLUMN} is not the white silhouette it is documented as`);
}

// The equality the whole swap rests on.
const stillCell = cell(still, EXPECTED.stillFrame % (still.width / W), Math.floor(EXPECTED.stillFrame / (still.width / W)));
const animCell = cell(anim, 0, EXPECTED.animRow);
const same = stillCell.every((v, i) => v === animCell[i]);
console.log(
  `\nstill frame ${EXPECTED.stillFrame} vs anim row ${EXPECTED.animRow} col 0: ` +
    (same ? 'IDENTICAL' : 'DIFFERENT'),
);
if (!same) {
  problems.push(
    `still frame ${EXPECTED.stillFrame} is not anim row ${EXPECTED.animRow} — ` +
      'animating would change the tree the map placed',
  );
}

if (problems.length > 0) {
  console.error('\n  measure-maple: the art no longer matches MAPLE_TREE in assets.ts\n');
  for (const p of problems) console.error(`   - ${p}`);
  console.error('');
  process.exit(1);
}
console.log('\nMAPLE_TREE in packages/shared/src/config/assets.ts matches the art.');
