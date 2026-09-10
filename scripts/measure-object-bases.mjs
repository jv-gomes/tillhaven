#!/usr/bin/env node
/**
 * Measures the GROUND-CONTACT BASE of every map object (T-15.04).
 *
 *   node scripts/measure-object-bases.mjs
 *
 * Why this exists. Collision needs to know which tiles an object actually
 * stands on, and `farm.json` cannot answer that: Tiled records the object's
 * CELL, which for this pack is routinely much larger than the art inside it.
 * The shipping box is declared 48x64 for a 16x16 look; the maple tree is
 * declared 32x48 for a trunk about one tile wide. Deriving footprints from the
 * declared box would wall off a 3x4 block of grass around a mailbox.
 *
 * What "base" means here. Not the alpha bounding box — that includes the
 * canopy, which a player walks BEHIND, not into. The base is the object's
 * footing: the horizontal extent of opaque pixels in the bottom band of the
 * art, where it meets the ground. A tree's canopy is 32px wide and its trunk
 * 8px; only the trunk blocks.
 *
 * Method (§9 — measure, never guess):
 *   1. Decode the PNG and crop the frame the map actually places.
 *   2. Print a per-row opaque-pixel count, so the silhouette is legible as a
 *      profile and the point where canopy becomes trunk is visible.
 *   3. Take the bottom `BASE_BAND` fraction of the art's alpha box and report
 *      the union of opaque columns in it — that is the base rect.
 *   4. Print the tile footprint that rect implies, rounded OUTWARDS, so a
 *      partly-covered tile still counts as covered (same rule `footprintOf`
 *      uses in `buildings.ts`).
 *
 * Output is a table plus a paste-ready `OBJ_COLLISION_BASE` literal. The
 * numbers it prints are the ones recorded in
 * `packages/shared/src/config/collision.ts`; re-run it to re-derive them.
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, alphaAt } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'apps/client/public/assets');
const TILE = 16;

/**
 * Fraction of the art's height, measured up from its lowest opaque row, that
 * counts as "touching the ground".
 *
 * A quarter is enough to catch a full trunk or a crate's front face without
 * reaching up into a canopy or a roof overhang. It is a judgement, so the
 * script prints the full row profile too — if a future object's base looks
 * wrong, read the profile rather than trusting this constant.
 */
const BASE_BAND = 0.25;

/**
 * The objects `farm.json` places, and the exact pixels each one DRAWS.
 *
 * `look` overrides the frame grid for art whose file is a kit rather than a
 * uniform sheet. It matters: `obj-shipping-box.png` is 48x64 and holds THREE
 * crates, but the scene draws only `OBJ_SHIPPING_BOX_LOOK` — cell 0, a single
 * 16x16 crate. Measuring the file would have reported a 3-tile-wide base for a
 * one-tile object and walled off the path beside it. (The manifest's own
 * comment warns about exactly this: "the window is 16 wide, NOT 29 — do not
 * re-trim it to alpha bounds".)
 *
 * The other four are uniform sheets or single images, so their frame grid is
 * already the truth.
 */
const TARGETS = [
  { key: 'obj-maple-tree', frame: 2, note: 'young spring maple (the map places frame 2)' },
  { key: 'obj-chest', frame: 0, note: 'closed chest' },
  { key: 'obj-mailbox', frame: 0, note: 'mailbox on its post' },
  { key: 'obj-newsstand', frame: 0, note: 'the merchant stall' },
  {
    key: 'obj-shipping-box',
    frame: 0,
    look: { x: 0, y: 16, width: 16, height: 16 }, // = OBJ_SHIPPING_BOX_LOOK
    note: 'shipping crate — the ONE drawn crate, not the 3-crate kit',
  },
];
/* PNG decoding lives in ./lib/png.mjs — shared with measure-building-bodies.mjs. */


/* ------------------------------------------------------------------ *
 * Measurement
 * ------------------------------------------------------------------ */

function measure(img, fx, fy, fw, fh) {
  // Alpha bounding box of the whole frame.
  let top = -1;
  let bottom = -1;
  let left = fw;
  let right = -1;
  const rows = [];

  for (let y = 0; y < fh; y++) {
    let count = 0;
    let rowLeft = fw;
    let rowRight = -1;
    for (let x = 0; x < fw; x++) {
      if (alphaAt(img, fx + x, fy + y) === 0) continue;
      count++;
      if (x < rowLeft) rowLeft = x;
      if (x > rowRight) rowRight = x;
    }
    rows.push({ y, count, left: rowLeft, right: rowRight });
    if (count > 0) {
      if (top === -1) top = y;
      bottom = y;
      if (rowLeft < left) left = rowLeft;
      if (rowRight > right) right = rowRight;
    }
  }

  if (bottom === -1) throw new Error('frame is fully transparent');

  // The base band: the bottom BASE_BAND of the art, at least one row.
  const artHeight = bottom - top + 1;
  const bandHeight = Math.max(1, Math.round(artHeight * BASE_BAND));
  const bandTop = bottom - bandHeight + 1;

  let baseLeft = fw;
  let baseRight = -1;
  for (const row of rows) {
    if (row.y < bandTop || row.y > bottom || row.count === 0) continue;
    if (row.left < baseLeft) baseLeft = row.left;
    if (row.right > baseRight) baseRight = row.right;
  }

  return {
    art: { left, top, right, bottom, width: right - left + 1, height: artHeight },
    band: { top: bandTop, bottom, height: bandHeight },
    base: { left: baseLeft, right: baseRight, width: baseRight - baseLeft + 1 },
    rows,
  };
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const manifest = readFileSync(join(ROOT, 'packages/shared/src/config/assets.ts'), 'utf8');

/** Pull a frame size out of the manifest so this script cannot disagree with it. */
function frameSize(key) {
  const block = manifest.split(`key: '${key}'`)[1];
  if (!block) return null;
  const head = block.slice(0, 400);
  const num = (name) => {
    const m = head.match(new RegExp(`${name}:\\s*(\\d+)`));
    return m ? Number(m[1]) : null;
  };
  const fw = num('frameWidth') ?? num('width');
  const fh = num('frameHeight') ?? num('height');
  return { frameWidth: fw, frameHeight: fh, cols: num('cols') ?? 1 };
}

const results = [];

for (const target of TARGETS) {
  const img = decodePng(readFileSync(join(ASSETS, `${target.key}.png`)));
  const spec = frameSize(target.key);
  const fw = target.look?.width ?? spec?.frameWidth ?? img.width;
  const fh = target.look?.height ?? spec?.frameHeight ?? img.height;
  const cols = spec?.cols ?? 1;
  const col = target.frame % cols;
  const row = Math.floor(target.frame / cols);
  const ox = target.look?.x ?? col * fw;
  const oy = target.look?.y ?? row * fh;

  const m = measure(img, ox, oy, fw, fh);

  console.log(`\n${'='.repeat(72)}`);
  console.log(`${target.key}  frame ${target.frame}  —  ${target.note}`);
  console.log(`  image ${img.width}x${img.height}, frame ${fw}x${fh}, ${cols} col(s)`);
  console.log(
    `  art box   x ${m.art.left}..${m.art.right} (w ${m.art.width}), ` +
      `y ${m.art.top}..${m.art.bottom} (h ${m.art.height})`,
  );
  console.log(`  base band rows ${m.band.top}..${m.band.bottom} (bottom ${Math.round(BASE_BAND * 100)}%)`);
  console.log(`  BASE      x ${m.base.left}..${m.base.right}  width ${m.base.width}px`);

  console.log('\n  row profile (opaque px per row, "|" marks the base band):');
  for (const r of m.rows) {
    if (r.count === 0 && (r.y < m.art.top || r.y > m.art.bottom)) continue;
    const mark = r.y >= m.band.top && r.y <= m.band.bottom ? '|' : ' ';
    const bar = '#'.repeat(Math.min(48, r.count));
    console.log(
      `   ${mark} y=${String(r.y).padStart(2)}  ${String(r.count).padStart(3)}  ` +
        `${r.count ? `x ${String(r.left).padStart(2)}..${String(r.right).padStart(2)}` : '       '}  ${bar}`,
    );
  }

  // Tiles the base covers, anchored bottom-left like every map object here.
  const tileW = Math.ceil((m.base.right + 1) / TILE) - Math.floor(m.base.left / TILE);
  const tileH = Math.ceil(m.band.height / TILE);
  console.log(`\n  => footprint ${tileW} x ${tileH} tile(s)`);

  results.push({ ...target, m, tileW, tileH });
}

console.log(`\n${'='.repeat(72)}`);
console.log('Paste-ready (pixels are relative to the frame\'s bottom-left corner,');
console.log('y measured UPWARD, matching footprintOf() in buildings.ts):\n');
console.log('export const OBJ_COLLISION_BASE = {');
for (const r of results) {
  const fh = r.m.art.bottom + 1;
  console.log(
    `  '${r.key}': { left: ${r.m.base.left}, right: ${r.m.base.right}, ` +
      `height: ${r.m.band.height} }, // ${r.tileW}x${r.tileH} tiles — ${r.note}`,
  );
  void fh;
}
console.log('} as const;');
