#!/usr/bin/env node
/**
 * Maps a terrain tileset so the ground can be painted from the pack itself.
 *
 *   node scripts/measure-terrain.mjs                      # every sheet below
 *   node scripts/measure-terrain.mjs "Grass Spring"       # one, by substring
 *   node scripts/measure-terrain.mjs --json               # machine-readable
 *   node scripts/measure-terrain.mjs --md                 # docs/terrain.md
 *
 * **Why this exists, and what it overturned.** T-7.05 measured the pack's
 * tilesets and concluded they held only *self-contained rounded patches* —
 * never art that fills its cell edge to edge — so the game drew its own flat
 * ground tiles instead (`scripts/draw-ground-tiles.py`, since deleted). That
 * conclusion was drawn from the **incomplete** copy of the pack. The complete
 * one has whole bands of fully-opaque tiles and pure single-colour fills, so
 * the ground can come from the pack after all.
 *
 * Reads `assets/` (the pack) rather than the prepared output, like
 * `measure-crops.mjs` and for the same reason: it measures candidates, and a
 * candidate has not been copied into the client yet.
 *
 * What each column of the map means:
 *
 *   `.`  fully transparent
 *   lower-case  partially transparent — a patch stamp or an edge piece, drawn
 *               to sit ON something else
 *   UPPER-CASE  fully opaque — a tile that can be a BASE FILL without leaving
 *               a seam, which is the whole question this script answers
 *
 * The letter is the tile's dominant colour family (see `FAMILIES`), so a band
 * of one letter is a terrain set and a change of letter is a change of
 * material. A tile that is fully opaque AND has one or two colours is a *flat*
 * fill — reported separately, because that is the tile a large area is painted
 * with.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TILESETS = join(ROOT, 'assets', 'Tileset');
const TILE = 16;

/**
 * The sheets the MVP paints ground from.
 *
 * Named rather than globbed: the folder holds thirty-odd tilesets for seasons
 * and biomes this MVP does not have, and measuring all of them would bury the
 * four that matter under noise.
 */
const SHEETS = [
  'Tileset Grass Spring.png',
  'Tileset Grass Cliff Tileset Spring.png',
  'Tilled Soil and wet soil.png',
  'Water Ground animations tiles.png',
  'Water tile.png',
  'Path tiles.png',
  'Tileset Grass Water Spring.png',
];

/**
 * Colour families, so a 24x40 map reads as terrain rather than as hex codes.
 *
 * Sampled from the sheets themselves; anything unmatched prints `?`, which is
 * information rather than a failure — `?` runs are where the detail variants
 * (flowers, pebbles) live.
 */
const FAMILIES = [
  ['g', '#79bf56', 'light grass'],
  ['G', '#32ad53', 'deep grass'],
  ['O', '#ee9d51', 'orange dirt'],
  ['B', '#be6d47', 'brown soil (dry)'],
  ['D', '#9d4c46', 'dark brown soil (wet)'],
  ['W', '#767ede', 'pack blue "wet" — unused, reads as water'],
  ['V', '#4b5096', 'dark blue — unused'],
  ['A', '#0092dd', 'water'],
  ['K', '#0d0e13', 'near-black'],
];

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Everything worth knowing about one 16x16 cell. */
function tileStats(img, col, row) {
  const counts = new Map();
  let opaque = 0;

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = ((row * TILE + y) * img.width + (col * TILE + x)) * 4;
      if (img.data[i + 3] === 0) continue;
      opaque++;
      const key = hex(img.data[i], img.data[i + 1], img.data[i + 2]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  return {
    coverage: opaque / (TILE * TILE),
    colours: counts.size,
    dominant: ranked[0]?.[0] ?? null,
    top: ranked.slice(0, 3),
  };
}

function familyOf(dominant) {
  return FAMILIES.find(([, colour]) => colour === dominant)?.[0] ?? '?';
}

/**
 * A tile that can be tiled as a base fill.
 *
 * Fully opaque is the hard requirement — one transparent pixel on an edge is a
 * seam once the tile repeats. Two colours or fewer is what makes it *flat*
 * rather than a detailed cell that would visibly repeat across a field.
 */
function isFlatFill(stats) {
  return stats.coverage === 1 && stats.colours <= 2;
}

function measure(path) {
  const img = decodePng(readFileSync(path));
  const cols = Math.floor(img.width / TILE);
  const rows = Math.floor(img.height / TILE);
  const tiles = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.push({ col: c, row: r, ...tileStats(img, c, r) });
  }

  const at = (c, r) => tiles[r * cols + c];
  const map = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const t = at(c, r);
      const letter = familyOf(t.dominant);
      line += t.coverage === 0 ? '.' : t.coverage === 1 ? letter.toUpperCase() : letter.toLowerCase();
    }
    map.push(line);
  }

  /** Contiguous row runs that are fully opaque — candidate terrain bands. */
  const bands = [];
  for (let r = 0; r < rows; r++) {
    const full = tiles.slice(r * cols, (r + 1) * cols).every((t) => t.coverage === 1);
    const last = bands[bands.length - 1];
    if (full && last && last.to === r - 1) last.to = r;
    else if (full) bands.push({ from: r, to: r });
  }

  return {
    file: basename(path),
    width: img.width,
    height: img.height,
    cols,
    rows,
    map,
    bands,
    flatFills: tiles.filter(isFlatFill).map((t) => ({
      col: t.col,
      row: t.row,
      frame: t.row * cols + t.col,
      colour: t.dominant,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const wantMd = args.includes('--md');
const only = args.find((a) => !a.startsWith('--'));

const chosen = SHEETS.filter((f) => !only || f.toLowerCase().includes(only.toLowerCase()));
const results = chosen.map((f) => measure(join(TILESETS, f)));

if (wantJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    const header = `${r.file} — ${r.width}x${r.height} (${r.cols}x${r.rows} tiles)`;
    console.log(wantMd ? `### ${header}\n` : `\n=== ${header} ===`);

    console.log(wantMd ? '```' : '');
    for (const [i, line] of r.map.entries()) console.log(String(i).padStart(2) + ' ' + line);
    console.log(wantMd ? '```\n' : '');

    console.log(
      'fully-opaque row bands (candidate base terrain): ' +
        (r.bands.length ? r.bands.map((b) => `${b.from}-${b.to}`).join(', ') : 'none'),
    );
    console.log(
      `flat fills (opaque, <=2 colours): ` +
        (r.flatFills.length
          ? r.flatFills.map((f) => `(${f.col},${f.row}) frame ${f.frame} ${f.colour}`).join('  ')
          : 'none'),
    );
  }

  console.log('\nlegend: ' + FAMILIES.map(([l, c, name]) => `${l}=${name} ${c}`).join('  '));
  console.log('  "." empty   lower-case partial (patch/edge)   UPPER-CASE fully opaque');
}
