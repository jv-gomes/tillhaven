#!/usr/bin/env node
/**
 * Decides D-10: do the chicken sheet's rows encode FACING, or cosmetic
 * variation? (T-15.10)
 *
 *   node scripts/measure-animal-rows.mjs
 *
 * T-7.10 already read these sheets carefully and wrote the results into
 * `assets.ts` — but it was answering "which row is the idle one", not "which
 * row is which direction". Those are different questions, and the second one
 * decides whether a wandering animal needs four rows, one row plus `setFlipX`,
 * or one row and nothing else. This script answers it with two mechanical
 * tests rather than by looking at the art and forming an impression:
 *
 *   MIRROR TEST — is row A pixel-identical to row B flipped horizontally? If
 *     yes, the sheet draws left and right explicitly and `setFlipX` would
 *     double up. If no pair mirrors, the sheet has no left/right distinction
 *     to find and flipping is how you get one.
 *
 *   WIDTH TEST — a front or back view of an animal is narrower than its side
 *     view (a chicken seen head-on is a body; seen side-on it is a body plus a
 *     beak and a tail). If rows 0-2 all measure the same width, they are not
 *     front/side/back.
 *
 * Plus a SELF-SYMMETRY check per frame: a sprite that is its own mirror image
 * is facing the camera, and cannot be a side view of anything.
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'apps/client/public/assets');

const TARGETS = [
  { key: 'animal-chicken-red', frame: 16, cols: 4, rows: 7 },
  { key: 'animal-chicken-baby-red', frame: 16, cols: 4, rows: 7 },
  { key: 'animal-cow-brown-female', frame: 32, cols: 4, rows: 9 },
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

/* ---------------- frame helpers ---------------- */

/** One frame as a flat RGBA array. */
function frameOf(img, col, row, size) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((row * size + y) * img.width + (col * size + x)) * 4;
      const dst = (y * size + x) * 4;
      for (let i = 0; i < 4; i++) out[dst + i] = img.data[src + i];
    }
  }
  return out;
}

function flipX(frame, size) {
  const out = new Uint8Array(frame.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = (y * size + (size - 1 - x)) * 4;
      for (let i = 0; i < 4; i++) out[dst + i] = frame[src + i];
    }
  }
  return out;
}

/** Fraction of pixels that differ, counting only where either is opaque. */
function difference(a, b) {
  let differing = 0;
  let considered = 0;
  for (let i = 0; i < a.length; i += 4) {
    const opaque = a[i + 3] > 0 || b[i + 3] > 0;
    if (!opaque) continue;
    considered++;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
      differing++;
    }
  }
  return considered === 0 ? 0 : differing / considered;
}

/** Frame translated by (dx, dy); vacated pixels become transparent. */
function translate(frame, size, dx, dy) {
  const out = new Uint8Array(frame.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx < 0 || sx >= size || sy < 0 || sy >= size) continue;
      const src = (sy * size + sx) * 4;
      const dst = (y * size + x) * 4;
      for (let i = 0; i < 4; i++) out[dst + i] = frame[src + i];
    }
  }
  return out;
}

function bbox(frame, size) {
  let x0 = size;
  let x1 = -1;
  let y0 = size;
  let y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (frame[(y * size + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, x1, y0, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/* ---------------- report ---------------- */

/** Below this fraction of differing pixels, two frames are "the same image". */
const SAME = 0.02;

for (const target of TARGETS) {
  const img = decodePng(readFileSync(join(ASSETS, `${target.key}.png`)));
  const { frame: size, cols, rows } = target;

  console.log(`\n${'='.repeat(74)}`);
  console.log(`${target.key}  —  ${img.width}x${img.height}, ${cols}x${rows} @ ${size}px`);

  // --- WIDTH TEST -------------------------------------------------
  console.log('\n  WIDTH TEST (a front/back view is narrower than a side view)');
  const widths = [];
  for (let r = 0; r < rows; r++) {
    const boxes = [];
    for (let c = 0; c < cols; c++) {
      const box = bbox(frameOf(img, c, r, size), size);
      if (box) boxes.push(box);
    }
    const w = boxes.map((b) => b.width);
    const h = boxes.map((b) => b.height);
    widths.push(Math.max(...w));
    console.log(
      `    row ${r}: width ${Math.min(...w)}-${Math.max(...w)}  height ${Math.min(...h)}-${Math.max(...h)}`,
    );
  }

  // --- SELF-SYMMETRY ----------------------------------------------
  console.log('\n  SELF-SYMMETRY (a frame equal to its own mirror faces the camera)');
  for (let r = 0; r < rows; r++) {
    const f = frameOf(img, 0, r, size);
    const d = difference(f, flipX(f, size));
    console.log(
      `    row ${r} frame 0: ${(d * 100).toFixed(1)}% differ from its mirror` +
        `${d < SAME ? '   <- SYMMETRIC (front/back view)' : ''}`,
    );
  }

  // --- MIRROR TEST ------------------------------------------------
  console.log('\n  MIRROR TEST (is row A row B flipped? then the sheet has explicit L/R)');
  let anyMirror = false;
  for (let a = 0; a < rows; a++) {
    for (let b = a + 1; b < rows; b++) {
      let worst = 0;
      for (let c = 0; c < cols; c++) {
        const d = difference(frameOf(img, c, a, size), flipX(frameOf(img, c, b, size), size));
        worst = Math.max(worst, d);
      }
      if (worst < SAME) {
        console.log(`    row ${a} IS row ${b} mirrored (worst frame ${(worst * 100).toFixed(1)}%)`);
        anyMirror = true;
      }
    }
  }
  if (!anyMirror) {
    console.log('    no row is any other row mirrored — no explicit left/right in this sheet');
  }

  // --- ROW-TO-ROW DISTINCTNESS ------------------------------------
  console.log('\n  ROW DISTINCTNESS (identical rows are cosmetic duplicates, not poses)');
  for (let a = 0; a < rows; a++) {
    for (let b = a + 1; b < rows; b++) {
      let worst = 0;
      for (let c = 0; c < cols; c++) {
        worst = Math.max(worst, difference(frameOf(img, c, a, size), frameOf(img, c, b, size)));
      }
      if (worst < SAME) console.log(`    row ${a} == row ${b} (worst ${(worst * 100).toFixed(1)}%)`);
    }
  }

  /*
   * --- BOB OR WALK -------------------------------------------------
   *
   * A raw frame-to-frame diff cannot tell these apart: shifting a whole
   * sprite down one pixel moves every pixel in it and reads as ~60% changed,
   * exactly like a leg cycle would. (The first version of this script made
   * that mistake and cheerfully reported that every chicken row "animates".)
   *
   * So: try to explain frame B as frame A translated by a small offset. If
   * some shift within +/-2px reduces the difference to near nothing, the row
   * is a BOB — the body moved, the limbs did not. If no shift explains it,
   * parts of the sprite moved relative to each other, which is a real cycle.
   */
  console.log('\n  BOB OR WALK (can a small translation explain the whole frame delta?)');
  for (let r = 0; r < rows; r++) {
    let worstResidual = 0;
    for (let c = 1; c < cols; c++) {
      const a = frameOf(img, c - 1, r, size);
      const b = frameOf(img, c, r, size);
      let best = difference(a, b);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          best = Math.min(best, difference(translate(a, size, dx, dy), b));
        }
      }
      worstResidual = Math.max(worstResidual, best);
    }
    /*
     * Reported as a number, not a verdict. The residuals form a spectrum, not
     * two clusters — chicken rows 0-2 land near 15-19% while their peck rows
     * land at 30-60% and the cow's static lying rows at 7% — and consecutive
     * frames of a 4-phase cycle differ by more than a shift even when the
     * cycle as a whole is a bob (T-7.10 found the chicken's frames 0/2 and 1/3
     * identical bar 1px, which is a 0-vs-2 relationship this 0-vs-1 comparison
     * does not measure). Only the flat cases below 10% are called.
     */
    console.log(
      `    row ${r}: residual after best shift ${(worstResidual * 100).toFixed(1)}%` +
        `${worstResidual < 0.1 ? '   <- near-static (body barely moves)' : ''}`,
    );
  }
}
