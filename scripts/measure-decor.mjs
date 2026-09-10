#!/usr/bin/env node
/**
 * Finds the individual pieces inside each decor kit, and measures what each one
 * stands on (T-15.15).
 *
 *   node scripts/measure-decor.mjs            # every kit
 *   node scripts/measure-decor.mjs fence-wood # one kit
 *
 * Every file the decor catalogue draws from is a KIT, not a sprite:
 * `decor-scarecrow.png` is eight scarecrows in a row, `decor-village-signs.png`
 * is twelve signs in summer and snow, `decor-fence-wood.png` is a whole fence
 * construction set drawn twice (plain, then snow-topped). So the catalogue has
 * to name a window into each file, and a window guessed from a clean-looking
 * division of the file size is exactly how T-7.11 ended up drawing a
 * double-wide shipping box.
 *
 * Two passes:
 *
 *   CONNECTED COMPONENTS — flood-fill the opaque pixels to find each separate
 *     piece and print its bounding box. This finds the real pieces in an
 *     irregular kit (the fence), where no grid exists to divide by.
 *
 *   GRID — where a kit IS a clean grid (the scarecrows), report each cell's
 *     alpha box instead, since components would merge pieces that touch.
 *
 * Both then report the GROUND-CONTACT footprint: the widest opaque band in the
 * bottom quarter of the piece, rounded outwards to whole tiles. That is what a
 * player cannot stand on — the post, not the lamp head. Same rule and same
 * reasoning as `scripts/measure-object-bases.mjs` (T-15.04).
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'apps/client/public/assets');
const TILE = 16;
const BASE_BAND = 0.25;

/**
 * The kits, and how to split each one.
 *
 * `grid` splits into fixed cells; `components` flood-fills. Chosen per kit from
 * looking at the art: a row of eight evenly-spaced scarecrows is a grid, and a
 * fence construction set with pieces of four different sizes is not.
 */
const KITS = [
  { key: 'decor-fence-wood', mode: 'components', note: 'plain fence on top, snow-topped below' },
  { key: 'decor-scarecrow', mode: 'grid', cell: [32, 32], note: '8 scarecrows' },
  { key: 'decor-street-lamp', mode: 'grid', cell: [32, 48], note: 'unlit, lit' },
  { key: 'decor-hay-bales', mode: 'grid', cell: [16, 16], note: '6 bales' },
  { key: 'decor-feed-trough', mode: 'grid', cell: [32, 16], note: 'one trough' },
  { key: 'decor-stone-statue', mode: 'grid', cell: [32, 48], note: 'one statue' },
  { key: 'decor-birdhouse', mode: 'grid', cell: [16, 32], note: '2 birdhouses' },
  { key: 'decor-village-signs', mode: 'grid', cell: [32, 32], note: 'row 0 plain, row 1 snowy' },
  { key: 'decor-berry-piles', mode: 'grid', cell: [16, 16], note: 'small ground clutter' },
  { key: 'decor-stacked-barrels', mode: 'grid', cell: [48, 48], note: 'one stack' },
];

/* ---------------- PNG decode (RGBA8, non-interlaced) ---------------- */

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colourType !== 6) {
    throw new Error(`expected 8-bit RGBA, got ${bitDepth}/${colourType}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      const x = line[i];
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, data: out };
}

const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

/* ---------------- piece finding ---------------- */

/** Flood-fill opaque pixels into separate pieces, 8-connected. */
function components(img, minPixels = 12) {
  const seen = new Uint8Array(img.width * img.height);
  const pieces = [];

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const start = y * img.width + x;
      if (seen[start] || alphaAt(img, x, y) === 0) continue;

      let x0 = x;
      let x1 = x;
      let y0 = y;
      let y1 = y;
      let count = 0;
      const stack = [start];
      seen[start] = 1;

      while (stack.length > 0) {
        const index = stack.pop();
        const cx = index % img.width;
        const cy = (index - cx) / img.width;
        count++;
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue;
            const n = ny * img.width + nx;
            if (seen[n] || alphaAt(img, nx, ny) === 0) continue;
            seen[n] = 1;
            stack.push(n);
          }
        }
      }

      if (count >= minPixels) pieces.push({ x0, y0, x1, y1, count });
    }
  }

  // Reading order, so the printed list matches what the contact sheet shows.
  return pieces.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** Alpha box of one grid cell, or null when the cell is empty. */
function cellBox(img, cx, cy, cw, ch) {
  let x0 = cw;
  let x1 = -1;
  let y0 = ch;
  let y1 = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (alphaAt(img, cx + x, cy + y) === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0: cx + x0, y0: cy + y0, x1: cx + x1, y1: cy + y1 };
}

/** Widest opaque band in the bottom `BASE_BAND` of a piece: what it stands on. */
function groundBase(img, box) {
  const height = box.y1 - box.y0 + 1;
  const bandHeight = Math.max(1, Math.round(height * BASE_BAND));
  const bandTop = box.y1 - bandHeight + 1;

  let left = img.width;
  let right = -1;
  for (let y = bandTop; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      if (alphaAt(img, x, y) === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return right < 0 ? null : { left, right, height: bandHeight, width: right - left + 1 };
}

/* ---------------- report ---------------- */

const only = process.argv[2];

for (const kit of KITS) {
  if (only && !kit.key.includes(only)) continue;

  const img = decodePng(readFileSync(join(ASSETS, `${kit.key}.png`)));
  console.log(`\n${'='.repeat(76)}`);
  console.log(`${kit.key}.png  ${img.width}x${img.height}  —  ${kit.note}  [${kit.mode}]`);

  const boxes = [];
  if (kit.mode === 'grid') {
    const [cw, ch] = kit.cell;
    for (let row = 0; row < img.height / ch; row++) {
      for (let col = 0; col < img.width / cw; col++) {
        const box = cellBox(img, col * cw, row * ch, cw, ch);
        if (box) boxes.push({ ...box, label: `r${row}c${col}` });
      }
    }
  } else {
    for (const [i, p] of components(img).entries()) boxes.push({ ...p, label: `#${i}` });
  }

  console.log(
    `  ${'piece'.padEnd(7)} ${'look (x,y,w,h)'.padEnd(22)} ${'base'.padEnd(14)} footprint`,
  );
  for (const box of boxes) {
    const w = box.x1 - box.x0 + 1;
    const h = box.y1 - box.y0 + 1;
    const base = groundBase(img, box);
    const tilesW = base ? Math.ceil((base.right + 1) / TILE) - Math.floor(base.left / TILE) : 0;
    const tilesH = base ? Math.max(1, Math.round(base.height / TILE)) : 0;

    console.log(
      `  ${box.label.padEnd(7)} ` +
        `${`${box.x0},${box.y0} ${w}x${h}`.padEnd(22)} ` +
        `${base ? `${base.width}px wide`.padEnd(14) : '-'.padEnd(14)} ` +
        `${tilesW}x${tilesH} tiles`,
    );
  }
}
