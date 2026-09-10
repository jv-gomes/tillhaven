#!/usr/bin/env node
/**
 * Measures every crop sheet in the pack, so Phase 31 picks its crops from
 * numbers rather than from a guess (T-31.01).
 *
 *   node scripts/measure-crops.mjs             # every sheet, one line each
 *   node scripts/measure-crops.mjs --frames    # ...plus a per-frame table
 *   node scripts/measure-crops.mjs Tomato      # one sheet, always with frames
 *
 * **Reads the pack at `assets/`, unlike every other measure script**, which
 * read `apps/client/public/assets`. That is deliberate: this measures
 * CANDIDATES — sheets that may never be copied into the client at all — so it
 * has to look at the source pack rather than at the prepared output.
 *
 * What it reports, and why each number is here:
 *
 *   GEOMETRY — width, height, and therefore how many 16px frames and how many
 *     16px rows. `crops.ts` hardcodes `frameWidth`/`frameHeight` per sheet, so
 *     a sheet with a different shape is a sheet the renderer draws wrong.
 *
 *   TALL-vs-TWO-ROW — a 128x32 sheet is ambiguous: it is either 8 frames of
 *     16x32 (a tall plant) or 16 frames of 16x16 (two sequences). Decided by
 *     asking whether any column has opaque pixels on BOTH sides of the
 *     horizontal midline; art that crosses the seam cannot be two independent
 *     16x16 cells. Reported per sheet rather than assumed.
 *
 *   PER-FRAME ALPHA + BOUNDING BOX — which frames are empty (the pack leaves
 *     gaps), and which frame is the produce icon. The signal for produce is
 *     that a growth stage is PLANTED — its art reaches the bottom row of the
 *     frame, because it is standing in soil — while the produce icon FLOATS,
 *     centred with clear pixels beneath it. So the produce frame is the last
 *     non-empty frame that does not touch the bottom row. Stated as a rule the
 *     output can be checked against, not as a lookup table.
 *
 * The four crops already in the game (Potato, Strawberry, Onion, Spring Onion)
 * are measured alongside the candidates on purpose: `crops.ts` records
 * `stageFrames: [0..5]`, `produceFrame: 7` for all four, so this script's
 * classification must reproduce those four known answers before any of its
 * answers about the other twenty-odd sheets are worth trusting.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, alphaAt } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CROPS = join(ROOT, 'assets', 'Crops');
/*
 * **Spring only.** The MVP has one season (see `docs/art-measurements.md`), so
 * the summer and fall folders are candidates for a game that does not exist.
 * They are still in the pack; add them back here if a season ever ships.
 */
const SEASONS = ['Spring'];
const TILE = 16;

/**
 * The combined atlases, skipped by name.
 *
 * `Spring Crops.png` and friends are contact sheets of every crop in the
 * season stacked into a grid — useful to look at, useless to slice, and the
 * per-crop files are what `assets.ts` points at (T-7.04). Skipped rather than
 * measured, and NAMED here so "why is Spring Crops.png missing" has an answer.
 */
const ATLASES = /Crops\.png$/;

/** What the four shipped crops are, so the script can check itself. */
const KNOWN = {
  'Spring/Potato.png': { frames: 8, stages: [0, 1, 2, 3, 4, 5], produce: 7 },
  'Spring/Strawberry.png': { frames: 8, stages: [0, 1, 2, 3, 4, 5], produce: 7 },
  'Spring/Onion.png': { frames: 8, stages: [0, 1, 2, 3, 4, 5], produce: 7 },
  'Spring/Spring Onion.png': { frames: 8, stages: [0, 1, 2, 3, 4, 5], produce: 7 },
};

/* ------------------------------------------------------------------ *
 * Measuring
 * ------------------------------------------------------------------ */

/**
 * Whether the art crosses the horizontal seam between the two 16px bands.
 *
 * If it does, the sheet is one row of TALL (16x32) frames rather than two rows
 * of 16x16 — art that spans the seam cannot be two independent cells. Counted
 * per column so a single stray pixel does not decide it, and `crossings` is
 * reported so the caller can see how strong the signal is.
 */
function seamCrossings(img) {
  const mid = img.height / 2;
  let crossings = 0;

  for (let x = 0; x < img.width; x++) {
    if (alphaAt(img, x, mid - 1) > 0 && alphaAt(img, x, mid) > 0) crossings++;
  }
  return crossings;
}

/** Whether a horizontal band of the sheet is entirely transparent. */
function bandEmpty(img, band) {
  for (let y = band * TILE; y < (band + 1) * TILE; y++) {
    for (let x = 0; x < img.width; x++) if (alphaAt(img, x, y) > 0) return false;
  }
  return true;
}

/**
 * Alpha sum, opaque bounding box, and a content hash of one frame.
 *
 * The hash is over the frame's actual RGBA bytes, not its silhouette: two
 * different-coloured frames can easily share an alpha sum and a bounding box,
 * and reporting those as "identical art" would be a false alarm on exactly the
 * sheets this is meant to be trusted about.
 */
function frameStats(img, x0, y0, w, h) {
  let sum = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  // FNV-1a, 32-bit. Not cryptographic and does not need to be — it is deciding
  // whether two 16x32 tiles in one file are byte-for-byte the same.
  let hash = 0x811c9dc5;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + (x0 + x)) * 4;
      for (let b = 0; b < 4; b++) {
        hash = Math.imul(hash ^ img.data[i + b], 0x01000193) >>> 0;
      }

      const a = alphaAt(img, x0 + x, y0 + y);
      if (a === 0) continue;
      sum += a;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const empty = maxY < 0;
  return {
    sum,
    hash,
    empty,
    box: empty ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    // "Standing in soil": the art reaches the last pixel row of the frame.
    grounded: !empty && maxY === h - 1,
  };
}

function measure(path) {
  const img = decodePng(readFileSync(path));
  const bands = img.height / TILE;

  if (!Number.isInteger(img.width / TILE) || !Number.isInteger(bands)) {
    return { img, odd: `not a whole number of ${TILE}px cells` };
  }

  let frameW = TILE;
  let frameH = TILE;
  let crossings = 0;
  let tallReason = null;

  if (bands === 2) {
    crossings = seamCrossings(img);
    /*
     * Two ways a 32px-tall sheet proves it is one row of TALL frames, and the
     * second one is why the first is not enough.
     *
     * A plant that grows above 16px crosses the seam, and `crossings` finds it.
     * A SHORT plant on a tall canvas never touches the top band at all —
     * Blueberry and Adzuki Bean are both 16px of art under 16px of headroom —
     * and the seam test called them two rows of 16x16, producing a first "row"
     * of eight blank frames. A row of blank frames is not a sequence; an empty
     * top band means headroom, so the sheet is tall.
     *
     * Anything else — content in BOTH bands that never meets — is genuinely
     * ambiguous and gets flagged rather than guessed at.
     */
    if (crossings > 0) {
      frameH = TILE * 2;
      tallReason = `${crossings} seam cols`;
    } else if (bandEmpty(img, 0)) {
      frameH = TILE * 2;
      tallReason = 'empty top band (headroom)';
    }
  } else if (bands > 2) {
    return { img, odd: `${bands} bands of ${TILE}px — not a crop strip` };
  }

  const cols = img.width / frameW;
  const rows = img.height / frameH;
  const frames = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      frames.push(frameStats(img, c * frameW, r * frameH, frameW, frameH));
    }
  }

  /*
   * The produce icon is the last non-empty frame that is NOT grounded. A
   * growth stage stands in soil and reaches the bottom row; the picked produce
   * floats. If every non-empty frame is grounded there is no produce frame,
   * which is a real answer and one worth seeing rather than defaulting to
   * "the last one".
   */
  let produce = null;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].empty) continue;
    if (!frames[i].grounded) produce = i;
    break;
  }

  const stages = frames
    .map((f, i) => ({ f, i }))
    .filter(({ f, i }) => !f.empty && i !== produce)
    .map(({ i }) => i);

  const emptyFrames = frames.map((f, i) => (f.empty ? i : -1)).filter((i) => i >= 0);

  /*
   * A gap INSIDE the growth run, which is different from trailing padding.
   * `crops.ts` reads `stageFrames` in order and the last entry is ripe, so a
   * hole between two stages means either the pack left a frame blank or the
   * classifier is wrong about where the sequence ends. Either way it is not
   * something to notice later.
   */
  const gaps = stages.length
    ? emptyFrames.filter((i) => i > stages[0] && i < stages[stages.length - 1])
    : [];

  return {
    img,
    frameW,
    frameH,
    cols,
    rows,
    crossings,
    tallReason,
    frames,
    stages,
    produce,
    emptyFrames,
    gaps,
  };
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const wantFrames = args.includes('--frames');
/**
 * `--md` prints the table `docs/crop-sheets.md` carries.
 *
 * The doc is generated from this rather than typed, for the reason every
 * measurement in this repo is: a hand-copied table of thirty rows of frame
 * indices is a table with a typo in it, and the typo becomes a crop that
 * renders its produce icon as a growth stage.
 */
const wantMd = args.includes('--md');
/**
 * `--json` prints one machine-readable record per sheet.
 *
 * Added so the Phase 31 crop config could be GENERATED from the measurement
 * rather than transcribed from it (T-31.04): `stageFrames` and `produceFrame`
 * for twenty crops is exactly the kind of table where the fourteenth row gets
 * a digit wrong and nothing notices until a ripe cabbage renders as a sprout.
 */
const wantJson = args.includes('--json');
const only = args.find((a) => !a.startsWith('--'));

const sheets = [];
for (const season of SEASONS) {
  for (const file of readdirSync(join(CROPS, season)).sort()) {
    if (!file.endsWith('.png') || ATLASES.test(file)) continue;
    if (only && !file.toLowerCase().includes(only.toLowerCase())) continue;
    sheets.push({ season, file, rel: `${season}/${file}` });
  }
}

const odd = [];
const shapes = new Map();

const json = [];

if (wantMd) {
  console.log('| Sheet | Size | Frames | Frame | Growth stages | Produce | Blank |');
  console.log('|---|---|---|---|---|---|---|');
}

for (const sheet of sheets) {
  const m = measure(join(CROPS, sheet.season, sheet.file));

  if (m.odd) {
    odd.push(`${sheet.rel}: ${m.odd}`);
    console.log(`${sheet.rel.padEnd(28)} ${m.img.width}x${m.img.height}  ⚠ ${m.odd}`);
    continue;
  }

  const shape = `${m.cols}×${m.frameW}x${m.frameH}`;
  shapes.set(shape, (shapes.get(shape) ?? 0) + 1);

  const tall = m.frameH > TILE ? ` TALL(${m.tallReason})` : '';
  const emptyNote = m.emptyFrames.length ? ` empty=[${m.emptyFrames.join(',')}]` : '';
  const produceNote = m.produce === null ? ' produce=NONE ⚠' : ` produce=${m.produce}`;

  json.push({
    sheet: sheet.rel,
    season: sheet.season.toLowerCase(),
    name: sheet.file.replace(/\.png$/, ''),
    width: m.img.width,
    height: m.img.height,
    cols: m.cols,
    rows: m.rows,
    frameW: m.frameW,
    frameH: m.frameH,
    stageFrames: m.stages,
    produceFrame: m.produce,
    emptyFrames: m.emptyFrames,
  });

  if (wantJson) {
    // Printed at the end, as one array.
  } else if (wantMd) {
    console.log(
      `| \`${sheet.rel}\` | ${m.img.width}x${m.img.height} | ${m.cols} | ` +
        `${m.frameW}x${m.frameH}${m.frameH > TILE ? ' **tall**' : ''} | ` +
        `\`[${m.stages.join(',')}]\` (${m.stages.length}) | ` +
        `${m.produce === null ? '**none**' : m.produce} | ` +
        `${m.emptyFrames.length ? `\`[${m.emptyFrames.join(',')}]\`` : '—'} |`,
    );
  } else {
    console.log(
      `${sheet.rel.padEnd(28)} ${String(m.img.width).padStart(3)}x${String(m.img.height).padEnd(3)}` +
        ` ${m.cols} frames of ${m.frameW}x${m.frameH}${tall}` +
        `  stages=[${m.stages.join(',')}]${produceNote}${emptyNote}`,
    );
  }

  if (m.produce === null) odd.push(`${sheet.rel}: no floating frame — produce icon not found`);
  if (m.frameH > TILE) {
    odd.push(`${sheet.rel}: TALL frames ${m.frameW}x${m.frameH} (${m.tallReason})`);
  }
  if (m.rows === 2) odd.push(`${sheet.rel}: two rows of ${m.frameW}x${m.frameH} — ambiguous, decide by eye`);
  if (m.cols !== 8 && m.cols !== 10) odd.push(`${sheet.rel}: ${m.cols} frames, not 8 or 10`);
  if (m.gaps.length) odd.push(`${sheet.rel}: blank frame(s) [${m.gaps.join(',')}] INSIDE the growth run`);
  /*
   * No frame reaching the bottom row means this sheet's baseline sits higher
   * than every other sheet's — the crop would render floating above its soil —
   * AND it means the produce-frame rule has nothing to distinguish on, so
   * whatever index was reported above is not evidence.
   */
  if (!m.frames.some((f) => f.grounded)) {
    odd.push(`${sheet.rel}: NO frame touches the bottom row — different baseline, produce index unreliable`);
  }
  const dupes = new Map();
  for (const [i, f] of m.frames.entries()) {
    if (f.empty) continue;
    dupes.set(f.hash, [...(dupes.get(f.hash) ?? []), i]);
  }
  for (const run of dupes.values()) {
    if (run.length > 1) odd.push(`${sheet.rel}: frames [${run.join(',')}] are identical — repeated art, not stages`);
  }
  if (m.stages.length !== 6) odd.push(`${sheet.rel}: ${m.stages.length} growth stages, not the 6 every shipped crop has`);

  // The self-check: the four shipped crops must come back as `crops.ts` has them.
  const known = KNOWN[sheet.rel];
  if (known) {
    const ok =
      m.cols === known.frames &&
      m.produce === known.produce &&
      JSON.stringify(m.stages) === JSON.stringify(known.stages);
    if (!wantMd && !wantJson) {
      console.log(
        `${''.padEnd(28)} ${ok ? '✓' : '✗'} self-check against crops.ts ` +
          `(${known.frames} frames, stages 0-5, produce ${known.produce})`,
      );
    }
    if (!ok) odd.push(`${sheet.rel}: DISAGREES with crops.ts — the classifier is wrong`);
  }

  if (!wantMd && !wantJson && (wantFrames || only)) {
    for (const [i, f] of m.frames.entries()) {
      const box = f.box ? `x${f.box.x} y${f.box.y} ${f.box.w}x${f.box.h}` : '—';
      console.log(
        `    frame ${String(i).padStart(2)}  alpha ${String(f.sum).padStart(6)}` +
          `  box ${box.padEnd(18)} ${f.empty ? 'EMPTY' : f.grounded ? 'grounded' : 'floating'}`,
      );
    }
  }
}

if (wantJson) {
  console.log(JSON.stringify(json, null, 2));
} else if (wantMd) {
  console.log('\nShapes seen:\n');
  for (const [shape, n] of [...shapes].sort()) console.log(`- \`${shape}\` — ${n} sheet(s)`);
  console.log(`\nFlagged (${odd.length}):\n`);
  for (const line of odd) console.log(`- ${line.replace(/^([^:]+):/, '`$1` —')}`);
} else {
  console.log('\nshapes seen:');
  for (const [shape, n] of [...shapes].sort()) console.log(`  ${shape.padEnd(14)} ${n} sheet(s)`);

  console.log(`\n${odd.length} sheet(s) flagged as not matching the plain 8×16x16 strip:`);
  for (const line of odd) console.log(`  ${line}`);
}
