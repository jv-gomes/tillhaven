#!/usr/bin/env node
/**
 * Bakes the map's authored collision into shared config.
 *
 *   node scripts/generate-collision.mjs          (pnpm collision)
 *
 * Reads the `collision` object layer out of apps/client/public/tilemaps/farm.json
 * and writes packages/shared/src/config/collision.generated.ts.
 *
 * **The same reasoning as `pnpm plots`, and one reason of its own.** The server
 * must not depend on a file in the client's public directory, and collision is
 * config the whole monorepo shares (§4.4). The reason of its own is the
 * important one: `modules/decor/reachability.ts` refuses a decor placement that
 * would wall the player out of their own farm, and it can only do that if it
 * knows about every solid thing on the map. Authored collision that reached the
 * client and not the server would be a way to narrow a corridor invisibly — and
 * then a legal-looking fence placement completes a trap the guard cannot see.
 *
 * Cells are stored as one mask string per tile, exactly as the map file stores
 * them: a cell is 5.33px, so cell-sized rectangles would put repeating
 * fractions in every coordinate, and nine characters read the way every other
 * mask in the codebase reads.
 *
 * Re-run this after painting collision in the editor.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_FILE = resolve(ROOT, 'apps/client/public/tilemaps/farm.json');
const OUT_FILE = resolve(ROOT, 'packages/shared/src/config/collision.generated.ts');

const LAYER = 'collision';
const OBJECT_TYPE = 'collisionMask';
const MASK_PROPERTY = 'mask';
const SUBTILE_RESOLUTION = 3;

function fail(message) {
  console.error(`\n  generate-collision: ${message}\n`);
  process.exit(1);
}

function propertyValue(object, name) {
  return object.properties?.find((p) => p.name === name)?.value;
}

const map = JSON.parse(await readFile(MAP_FILE, 'utf8'));

const layer = map.layers.find(
  (l) =>
    l.name === LAYER ||
    (l.type === 'objectgroup' &&
      (l.objects ?? []).length > 0 &&
      (l.objects ?? []).every((o) => o.type === OBJECT_TYPE)),
);

// A map with no collision layer is a map generated before this existed, not an
// error — an empty result is the honest answer and the game behaves as it did.
const objects = layer?.objects ?? [];
const entries = [];

for (const object of objects) {
  const mask = propertyValue(object, MASK_PROPERTY);
  if (typeof mask !== 'string') {
    fail(`object ${object.id} on the ${LAYER} layer has no "${MASK_PROPERTY}" property`);
  }
  if (mask.length !== SUBTILE_RESOLUTION * SUBTILE_RESOLUTION) {
    fail(
      `object ${object.id} has a ${mask.length}-character mask; ` +
        `expected ${SUBTILE_RESOLUTION * SUBTILE_RESOLUTION}`,
    );
  }
  if (!/^[#.]+$/.test(mask)) {
    fail(`object ${object.id} has a mask containing something other than # and .`);
  }
  // A tile whose mask is empty carries no information and would be noise in the
  // generated file; the editor does not write one, but a hand edit can.
  if (!mask.includes('#')) continue;

  entries.push({
    x: Math.round(object.x / map.tilewidth),
    y: Math.round(object.y / map.tileheight),
    mask,
  });
}

entries.sort((a, b) => a.y - b.y || a.x - b.x);

const rows = entries.map((e) => `  { x: ${e.x}, y: ${e.y}, mask: '${e.mask}' },`).join('\n');
const cells = entries.reduce((n, e) => n + [...e.mask].filter((c) => c === '#').length, 0);

const source = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by \`pnpm collision\` from the \`collision\` object layer of
 * apps/client/public/tilemaps/farm.json. To change it, paint with the collision
 * brush in the map editor (\`pnpm dev:mapmaker\`), save, and re-run.
 *
 * **Additive to the art's own collision, never a replacement.** Building
 * silhouettes and terrain masks live in \`collision.ts\` because they are
 * properties of the ART — a shoreline tile is the same shape everywhere it is
 * stamped. This is for the shapes the art cannot express.
 *
 * One mask per tile, ${SUBTILE_RESOLUTION}x${SUBTILE_RESOLUTION} cells row-major, \`#\` solid.
 *
 * Source map: ${map.width}x${map.height} tiles, ${entries.length} tiles, ${cells} solid cells.
 */

export interface AuthoredCollisionTile {
  readonly x: number;
  readonly y: number;
  readonly mask: string;
}

export const AUTHORED_COLLISION: readonly AuthoredCollisionTile[] = [
${rows}
];
`;

await writeFile(OUT_FILE, source, 'utf8');
console.log(`  ${entries.length} tiles, ${cells} solid cells -> ${OUT_FILE}`);
