#!/usr/bin/env node
/**
 * Measures the character animation strips (T-7.03).
 *
 * The pack's character animations are single-row 32px-tall strips with no
 * metadata. This script derives, per animation:
 *   - frame count (width / 32)
 *   - frames per direction (count / 4)
 *   - the DIRECTION ORDER of the four blocks
 *
 * Direction detection uses the Eyes layer, which only has pixels where eyes
 * are visible:
 *   - a block with (near-)zero eye pixels  -> facing UP (back of head)
 *   - eyes present, centroid ~centred      -> facing DOWN (both eyes)
 *   - eyes present, centroid off-centre    -> LEFT or RIGHT (one eye, on
 *     the side the character faces)
 *
 * CAUTION — this is the part that has been got wrong twice. The head alone
 * does NOT settle left from right: in a 32px profile the visible eye, the
 * exposed face and the hair mass appear to point in different directions, and
 * reasoning from any of them is how this script once carried an INVERTED sign
 * convention (labelling the right-facing block "left") that the T-7.03
 * write-up then recorded as fact.
 *
 * The check that is not ambiguous uses the `tool` layer, which this script
 * does not read: composite Watering's tool onto skin + clothes and look at a
 * late frame. The can is held out and the water pours in the direction faced —
 * block 2 pours RIGHT, block 3 pours LEFT. If the pack ever updates, re-run
 * this script for the GEOMETRY and re-check the side blocks that way.
 *
 * Findings are recorded as constants in packages/shared/src/config/assets.ts
 * (CHAR_* block) with a test pinning strip width = frame * count. Re-run
 * this script if the pack ever updates, but re-verify left/right by eye.
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAR = join(ROOT, 'apps', 'client', 'public', 'assets', 'character');

const FRAME = 32;

/* Minimal PNG decode (8-bit RGBA, non-interlaced) — same approach the old
 * prepare-assets codec used; kept local to this throwaway measuring tool. */
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

/** Opaque-pixel count and x-centroid (relative to frame centre) for one frame. */
function frameStats(img, frameIndex) {
  let count = 0;
  let sumX = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < FRAME; x++) {
      const s = (y * img.width + frameIndex * FRAME + x) * 4;
      if (img.data[s + 3] > 0) {
        count++;
        sumX += x - FRAME / 2 + 0.5;
      }
    }
  }
  return { count, centroidX: count ? sumX / count : 0 };
}

function classifyBlocks(eyes, framesPerDir) {
  const blocks = [];
  for (let b = 0; b < 4; b++) {
    let count = 0;
    let centroid = 0;
    for (let f = 0; f < framesPerDir; f++) {
      const s = frameStats(eyes, b * framesPerDir + f);
      count += s.count;
      centroid += s.centroidX * s.count;
    }
    blocks.push({ block: b, count, centroidX: count ? centroid / count : 0 });
  }

  const labels = new Array(4).fill(null);
  // Fewest eye pixels -> UP.
  const sorted = [...blocks].sort((a, b) => a.count - b.count);
  labels[sorted[0].block] = 'up';
  // Of the rest, the most-centred centroid -> DOWN; the other two by sign.
  const rest = sorted.slice(1).sort((a, b) => Math.abs(a.centroidX) - Math.abs(b.centroidX));
  labels[rest[0].block] = 'down';
  // Plain sign: eye pixels right of centre -> facing right. The inverted
  // convention that used to sit here came from reading hair and face shape in
  // a 32px profile, and it was wrong — see the caution above.
  for (const r of rest.slice(1)) {
    labels[r.block] = r.centroidX < 0 ? 'left' : 'right';
  }
  return { labels, blocks };
}

const ANIMS = ['idle', 'walk', 'run', 'hoe', 'watering'];

for (const anim of ANIMS) {
  const skin = decodePng(readFileSync(join(CHAR, anim, 'skin', '1.png')));
  const eyes = decodePng(readFileSync(join(CHAR, anim, 'eyes', 'male-black.png')));

  if (skin.width !== eyes.width || skin.height !== FRAME) {
    throw new Error(`${anim}: layer geometry mismatch (skin ${skin.width}x${skin.height}, eyes ${eyes.width}x${eyes.height})`);
  }
  const frames = skin.width / FRAME;
  if (!Number.isInteger(frames) || frames % 4 !== 0) {
    throw new Error(`${anim}: ${frames} frames does not divide into 4 directions`);
  }
  const framesPerDir = frames / 4;
  const { labels, blocks } = classifyBlocks(eyes, framesPerDir);

  console.log(`${anim.padEnd(9)} ${String(skin.width).padStart(4)}x32  ${frames} frames = 4 x ${framesPerDir}`);
  console.log(`          direction order: [${labels.join(', ')}]`);
  console.log(`          eye px per block: ${blocks.map((b) => b.count).join(', ')}  centroids: ${blocks.map((b) => b.centroidX.toFixed(1)).join(', ')}`);
}
