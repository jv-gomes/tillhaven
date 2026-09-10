#!/usr/bin/env node
/**
 * Measures every UI sheet in the pack (Phase U, T-U.02).
 *
 *   node scripts/measure-ui.mjs          # human-readable report
 *   node scripts/measure-ui.mjs --md     # the table pasted into docs/ui-measurements.md
 *   node scripts/measure-ui.mjs --check  # self-check only, exit 1 on failure
 *
 * Why this exists. The UI reskin cuts nine-slice frames and button plates out
 * of atlases, and a nine-slice cut one pixel wrong does not look one pixel
 * wrong — it looks like a smeared corner on every panel in the game. `hud.css`
 * already carries the scar of guessing at this sheet: a `border-image` attempt
 * that took "pixels from four unrelated corners" because nobody had measured
 * where the plate actually sat.
 *
 * §9 says measure, never guess. So the crop rectangles in `lib/ui-crops.mjs`
 * are not typed from looking at the art in an editor; they are checked against
 * what this script reads out of the pixels, and `--check` fails if they drift.
 *
 * What it measures, and how:
 *
 *   1. **Pieces.** A kit sheet (`Inventory/inventory.png`) holds several
 *      unrelated frames separated by transparent gutters. Decomposing by
 *      non-empty row runs, then non-empty column runs inside each, recovers
 *      them as rectangles without anyone counting pixels by hand.
 *
 *   2. **Frame grid.** If the gutters are evenly spaced the sheet is a uniform
 *      spritesheet, and the pitch is the frame size. Reported only when the
 *      spacing is actually uniform — an irregular sheet says so instead of
 *      being forced into a grid that would misread every frame after the first.
 *
 *   3. **Nine-slice insets.** The inset is *the distance from each edge to the
 *      first pair of identical adjacent rows (or columns)*. That is not a
 *      heuristic, it is the definition: `border-image` stretches the middle
 *      band, and stretching is lossless exactly where consecutive lines repeat.
 *      A frame whose middle never repeats is reported as NOT sliceable rather
 *      than given a plausible-looking number.
 *
 * Two sheets defeat step 1 and are declared, not inferred: `0.2.png` and
 * `dialogue box.png` are fully opaque edge to edge with no gutters at all, so
 * their rectangles in `lib/ui-crops.mjs` are hand-read and carry a `handCut`
 * flag. The self-check still verifies their *insets*, which is the part that
 * has to be right.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, cropPng, encodePng, alphaAt } from './lib/png.mjs';
import { UI_CROPS } from './lib/ui-crops.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_DIR = join(ROOT, 'assets/UI');

const MD = process.argv.includes('--md');
const CHECK_ONLY = process.argv.includes('--check');


/* ------------------------------------------------------------------ *
 * Decomposition
 * ------------------------------------------------------------------ */

const rowEmpty = (img, y) => {
  for (let x = 0; x < img.width; x++) if (alphaAt(img, x, y) > 0) return false;
  return true;
};

const colEmptyIn = (img, x, y0, y1) => {
  for (let y = y0; y <= y1; y++) if (alphaAt(img, x, y) > 0) return false;
  return true;
};

/** Maximal runs of consecutive indices for which `empty(i)` is false. */
function runs(length, empty) {
  const out = [];
  let start = -1;
  for (let i = 0; i < length; i++) {
    const e = empty(i);
    if (!e && start < 0) start = i;
    if (e && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, length - 1]);
  return out;
}

/** Rectangles of art separated by fully transparent gutters. */
function pieces(img) {
  const out = [];
  for (const [y0, y1] of runs(img.height, (y) => rowEmpty(img, y))) {
    for (const [x0, x1] of runs(img.width, (x) => colEmptyIn(img, x, y0, y1))) {
      out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
  }
  return out;
}

/**
 * A uniform frame grid, or null.
 *
 * Uniform means every piece is the same size AND the gaps between successive
 * origins are constant on each axis. Both halves matter: `Bars.png` has
 * equal-width bars at unequal spacing, and calling that a grid would place
 * every frame after the first in the wrong pixels.
 */
function frameGrid(img, ps) {
  if (ps.length < 2) return null;
  const w = ps[0].w;
  const h = ps[0].h;
  if (!ps.every((p) => p.w === w && p.h === h)) return null;

  const xs = [...new Set(ps.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(ps.map((p) => p.y))].sort((a, b) => a - b);
  const pitch = (vs) => {
    if (vs.length < 2) return null;
    const d = vs[1] - vs[0];
    return vs.every((v, i) => i === 0 || v - vs[i - 1] === d) ? d : null;
  };
  const px = pitch(xs);
  const py = pitch(ys);
  if (xs.length > 1 && px === null) return null;
  if (ys.length > 1 && py === null) return null;

  return { cols: xs.length, rows: ys.length, frameW: w, frameH: h, pitchX: px ?? w, pitchY: py ?? h };
}


/* ------------------------------------------------------------------ *
 * Nine-slice insets
 * ------------------------------------------------------------------ */

const sameRow = (img, a, b) =>
  img.data.compare(
    img.data, b * img.width * 4, (b + 1) * img.width * 4,
    a * img.width * 4, (a + 1) * img.width * 4,
  ) === 0;

function sameCol(img, a, b) {
  for (let y = 0; y < img.height; y++) {
    const ia = (y * img.width + a) * 4;
    const ib = (y * img.width + b) * 4;
    for (let k = 0; k < 4; k++) if (img.data[ia + k] !== img.data[ib + k]) return false;
  }
  return true;
}

/**
 * `{ top, right, bottom, left }` for a frame, or null when the middle never
 * repeats and the frame therefore cannot be stretched without distorting it.
 */
function insets(frame) {
  const firstRepeat = (n, same) => {
    for (let i = 0; i < n - 1; i++) if (same(i, i + 1)) return i;
    return null;
  };
  const lastRepeat = (n, same) => {
    for (let i = n - 1; i > 0; i--) if (same(i, i - 1)) return i;
    return null;
  };

  const rowSame = (a, b) => sameRow(frame, a, b);
  const colSame = (a, b) => sameCol(frame, a, b);

  const top = firstRepeat(frame.height, rowSame);
  const bottomAt = lastRepeat(frame.height, rowSame);
  const left = firstRepeat(frame.width, colSame);
  const rightAt = lastRepeat(frame.width, colSame);
  if (top === null || bottomAt === null || left === null || rightAt === null) return null;

  return {
    top,
    bottom: frame.height - 1 - bottomAt,
    left,
    right: frame.width - 1 - rightAt,
  };
}


/* ------------------------------------------------------------------ *
 * Walk the pack
 * ------------------------------------------------------------------ */

function pngsUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pngsUnder(full));
    else if (name.toLowerCase().endsWith('.png')) out.push(full);
  }
  return out;
}

function describe(file) {
  const rel = relative(UI_DIR, file).split(sep).join('/');
  const img = decodePng(readFileSync(file));
  const ps = pieces(img);
  const grid = frameGrid(img, ps);

  // A single edge-to-edge piece means no transparent gutters anywhere.
  const opaque = ps.length === 1 && ps[0].w === img.width && ps[0].h === img.height;

  return { rel, img, pieces: ps, grid, opaque };
}


/* ------------------------------------------------------------------ *
 * Self-check: the crop table must match the pixels
 * ------------------------------------------------------------------ */

/**
 * Every crop in `lib/ui-crops.mjs`, re-derived from the art.
 *
 * Three things are checked, and they fail for three different reasons:
 *   - the rectangle fits the sheet (the pack moved, or a number was typed);
 *   - the crop is not blank (the rectangle landed in a gutter);
 *   - the recorded `slice` matches the measured insets (the nine-slice would
 *     smear, which is the failure this whole script exists to prevent).
 *
 * It also round-trips each crop through the codec, so `pnpm assets` is never
 * the first thing to discover an encoder regression.
 */
function selfCheck() {
  const failures = [];
  const cache = new Map();

  for (const crop of UI_CROPS) {
    const src = join(ROOT, 'assets', crop.src);
    let img = cache.get(src);
    if (!img) {
      try {
        img = decodePng(readFileSync(src));
        cache.set(src, img);
      } catch (err) {
        failures.push(`${crop.out}: cannot read ${crop.src} — ${err.message}`);
        continue;
      }
    }

    let cut;
    try {
      cut = cropPng(img, crop.x, crop.y, crop.w, crop.h);
    } catch (err) {
      failures.push(`${crop.out}: ${err.message}`);
      continue;
    }

    let opaque = 0;
    for (let i = 3; i < cut.data.length; i += 4) if (cut.data[i] > 0) opaque++;
    if (opaque === 0) {
      failures.push(`${crop.out}: crop is entirely transparent — the rectangle missed the art`);
      continue;
    }

    const back = decodePng(encodePng(cut));
    if (!back.data.equals(cut.data)) {
      failures.push(`${crop.out}: PNG codec round-trip is not identical`);
    }

    if (crop.slice) {
      const measured = insets(cut);
      if (!measured) {
        failures.push(`${crop.out}: declares a slice, but the middle never repeats — not stretchable`);
      } else {
        for (const side of ['top', 'right', 'bottom', 'left']) {
          const want = crop.slice[side];
          if (want !== measured[side]) {
            failures.push(
              `${crop.out}: slice.${side} is ${want}, measured ${measured[side]}`,
            );
          }
        }
      }
    }
  }

  return failures;
}


/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

function main() {
  const failures = selfCheck();

  if (!CHECK_ONLY) {
    const files = pngsUnder(UI_DIR).map(describe);

    if (MD) {
      /*
       * Two tables, and the second is the one that matters.
       *
       * The sheet table says what each file IS — how many pieces, whether the
       * gutters make a grid. It deliberately does not report a nine-slice inset
       * per sheet: an atlas has no single inset, and printing its first piece's
       * would put "0 0 0 0" beside `button.png`, whose plates measure 3 3 5 3.
       * A number that is wrong in a way that looks right is worse than no
       * number, which is the lesson `docs/crop-sheets.md` was written to record.
       */
      console.log('## Sheets\n');
      console.log('| Sheet | Size | Pieces | Frame grid |');
      console.log('|---|---|---|---|');
      for (const f of files) {
        const grid = f.grid
          ? `${f.grid.cols}x${f.grid.rows} @ ${f.grid.frameW}x${f.grid.frameH}` +
            (f.grid.pitchX !== f.grid.frameW || f.grid.pitchY !== f.grid.frameH
              ? ` (pitch ${f.grid.pitchX}x${f.grid.pitchY})`
              : '')
          : '— irregular';
        const hand = f.pieces.length === 1 ? ' (one piece — hand-cut)' : '';
        console.log(
          `| \`${f.rel}\` | ${f.img.width}x${f.img.height} | ${f.pieces.length}${hand} | ${grid} |`,
        );
      }

      console.log('\n## The crops\n');
      console.log('| Output | Source | Rect | Slice (t r b l) | What it is |');
      console.log('|---|---|---|---|---|');
      for (const crop of UI_CROPS) {
        const rect = `${crop.w}x${crop.h} @ (${crop.x},${crop.y})`;
        const slice = crop.slice
          ? `${crop.slice.top} ${crop.slice.right} ${crop.slice.bottom} ${crop.slice.left}`
          : '—';
        const note = (crop.note ?? '').replace(/\s+/g, ' ');
        console.log(
          `| \`${crop.out}\` | \`${crop.src.replace('UI/', '')}\` | ${rect} | ${slice} | ${note} |`,
        );
      }
    } else {
      for (const f of files) {
        console.log(`\n${f.rel}  ${f.img.width}x${f.img.height}`);
        if (f.opaque) {
          console.log('  no transparent gutters — hand-cut, see lib/ui-crops.mjs');
        } else if (f.grid) {
          console.log(
            `  grid ${f.grid.cols}x${f.grid.rows} of ${f.grid.frameW}x${f.grid.frameH}` +
              ` (pitch ${f.grid.pitchX}x${f.grid.pitchY})`,
          );
        } else {
          console.log(`  ${f.pieces.length} pieces, irregular spacing`);
        }
        for (const p of f.pieces.slice(0, 12)) {
          const ins = insets(cropPng(f.img, p.x, p.y, p.w, p.h));
          console.log(
            `    ${String(p.w).padStart(3)}x${String(p.h).padEnd(3)} at (${p.x},${p.y})` +
              (ins ? `   slice ${ins.top} ${ins.right} ${ins.bottom} ${ins.left}` : '   not sliceable'),
          );
        }
        if (f.pieces.length > 12) console.log(`    … ${f.pieces.length - 12} more`);
      }
    }
  }

  console.log('');
  if (failures.length) {
    console.error(`Self-check FAILED — ${failures.length} problem(s):`);
    for (const f of failures) console.error(`  ${f}`);
    console.error('\nThe crop table in scripts/lib/ui-crops.mjs disagrees with the art.');
    process.exit(1);
  }
  console.log(`Self-check passed: ${UI_CROPS.length} crop rectangles match the pixels.`);
}

main();
