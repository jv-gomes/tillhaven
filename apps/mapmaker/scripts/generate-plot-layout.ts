/**
 * Generates the farm's plot layout from the authored map.
 *
 *   pnpm plots
 *
 * Reads the `plots` object layer out of apps/client/public/tilemaps/farm.json
 * and writes packages/shared/src/config/plots.generated.ts, so the SERVER's
 * plot positions come from the map you drew rather than from a hardcoded
 * origin-plus-columns formula.
 *
 * Why generate a file instead of reading the JSON at runtime: the server must
 * not depend on a file in the client's public directory, and plot positions are
 * config the whole monorepo shares (CLAUDE.md §4.4). Committing the generated
 * file also means a layout change shows up as a reviewable diff instead of
 * silently altering every new farm.
 *
 * ARRAY ORDER IS UNLOCK ORDER. It comes from each object's `index` property,
 * which the map editor writes and which prices the unlock via plotUnlockCost().
 * Re-run this after moving or reordering plots in the editor.
 *
 * **It is TypeScript, and it lives here, so it can see the buildings** (M6).
 * As a plain `.mjs` at the repo root it could only check the map against itself
 * — duplicates, bounds, marker count — and that family of check cannot see a
 * constraint held in config the map has never heard of. A field was authored on
 * top of the farmhouse and this script baked it without complaint; the failure
 * surfaced two packages away as `plot (8,2): expected true to be false`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reservedBy } from '@tillhaven/shared/config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MAP_FILE = resolve(ROOT, 'apps/client/public/tilemaps/farm.json');
const OUT_FILE = resolve(ROOT, 'packages/shared/src/config/plots.generated.ts');

const PLOT_LAYER = 'plots';
const PLOT_TYPE = 'plot';

function fail(message: string): never {
  console.error(`\n  generate-plot-layout: ${message}\n`);
  process.exit(1);
}

function propertyValue(object: TiledObject, name: string): unknown {
  return object.properties?.find((p) => p.name === name)?.value;
}

interface TiledObject {
  x: number;
  y: number;
  type?: string;
  name?: string;
  properties?: { name: string; value: unknown }[];
}

interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers?: { name?: string; type?: string; objects?: TiledObject[] }[];
}

/**
 * Plot markers are plain rectangles with NO gid, so `x`/`y` are the TOP-LEFT
 * corner in pixels. (Tile-objects on the `objects` layer use the bottom edge
 * instead — do not copy this conversion over to those.)
 */
function toCell(object: TiledObject, tileWidth: number, tileHeight: number): { x: number; y: number } {
  return { x: Math.round(object.x / tileWidth), y: Math.round(object.y / tileHeight) };
}

async function main(): Promise<void> {
  let map: TiledMap;
  try {
    map = JSON.parse(await readFile(MAP_FILE, 'utf8'));
  } catch (err) {
    fail(
      `could not read ${MAP_FILE}\n  ${String(err)}\n\n` +
        '  Author a map first: pnpm dev:mapmaker, then "Save to project".',
    );
  }

  const layer = map.layers?.find((l) => l.name === PLOT_LAYER && l.type === 'objectgroup');
  if (!layer) fail(`the map has no "${PLOT_LAYER}" object layer`);

  const objects = (layer.objects ?? []).filter((o) => o.type === PLOT_TYPE || o.name === PLOT_TYPE);
  if (objects.length === 0) {
    fail(
      'the map has no plot markers.\n' +
        '  Open the editor, pick the Plot tool (P) and click the cells crops grow on.',
    );
  }

  // Sort by the stored index, not array position: a hand-edited file may list
  // them in any order, and the index is what the economy prices against.
  const ordered = objects
    .map((o, i) => ({ order: Number(propertyValue(o, 'index') ?? i), object: o }))
    .sort((a, b) => a.order - b.order)
    .map(({ object }) => toCell(object, map.tilewidth, map.tileheight));

  // A duplicate would create two DB rows on the same square, which violates the
  // plots_farm_pos_idx unique index at registration — better to fail here.
  const seen = new Map<string, number>();
  for (const [i, cell] of ordered.entries()) {
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key)) fail(`plots ${seen.get(key)} and ${i} are both on cell (${key})`);
    seen.set(key, i);
    if (cell.x < 0 || cell.y < 0 || cell.x >= map.width || cell.y >= map.height) {
      fail(`plot ${i} at (${key}) is outside the ${map.width}x${map.height} map`);
    }

    /*
     * The check the map cannot make about itself (M6).
     *
     * The house, coop and barn occupy farm ground without being in any layer of
     * `farm.json` — their art depends on a tier the player owns — so the editor
     * draws that ground as empty grass and an author has no way to see it. This
     * is the earliest place both facts are in one process, so it is where the
     * bake stops rather than writing a file the buildings tests will reject.
     *
     * Reserved ground is the LARGEST tier of each building, not the tier a
     * given farm has bought: a player who upgrades has already paid.
     */
    const building = reservedBy(cell);
    if (building) {
      fail(
        `plot ${i} at (${key}) is under the ${building}.\n` +
          `  The house, coop and barn are NOT in farm.json — their art depends on a tier —\n` +
          `  so the editor draws their ground as empty grass. Turn on the "Buildings"\n` +
          '  overlay in the map editor, move the markers off the hatched area, save, and\n' +
          '  re-run `pnpm plots`.',
      );
    }
  }

  const rows = ordered
    .map((cell, i) => `  { x: ${cell.x}, y: ${cell.y} }, // ${String(i).padStart(2)}`)
    .join('\n');

  const body = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by \`pnpm plots\` from the \`plots\` object layer of
 * apps/client/public/tilemaps/farm.json. To change the farm's shape, move the
 * markers in the map editor (\`pnpm dev:mapmaker\`), save, and re-run \`pnpm plots\`.
 *
 * ARRAY ORDER IS UNLOCK ORDER: index N is the Nth plot a player unlocks, priced
 * by \`plotUnlockCost(N)\`. The first STARTING_PLOTS are free.
 *
 * Source map: ${map.width}x${map.height} tiles, ${ordered.length} plots.
 */

export interface PlotPosition {
  readonly x: number;
  readonly y: number;
}

export const PLOT_POSITIONS: readonly PlotPosition[] = [
${rows}
] as const;
`;

  await writeFile(OUT_FILE, body, 'utf8');

  const xs = ordered.map((c) => c.x);
  const ys = ordered.map((c) => c.y);
  console.log(
    `  ${ordered.length} plots -> packages/shared/src/config/plots.generated.ts\n` +
      `  bounds x ${Math.min(...xs)}..${Math.max(...xs)}, y ${Math.min(...ys)}..${Math.max(...ys)}`,
  );
}

await main();
