/**
 * T-16.10 — programmatic authoring of the house interior map.
 *
 * The farm's sibling (`generate-farm.ts`), and deliberately the same shape: it
 * builds through the SAME `MapDoc` + `History` + `serialize()` machinery the
 * real editor uses, so the output is what "Save to project" would have written,
 * not a hand-rolled JSON that merely looks similar. D-13 made the generator the
 * authority for `farm.json`; the same rule applies here from the first commit
 * rather than being retrofitted after a divergence.
 *
 * Every constant comes from `packages/shared/src/config/interiorLayout.ts`, so
 * the client and the server read the same room the map is painted from.
 *
 * Run: apps/mapmaker/node_modules/.bin/tsx apps/mapmaker/scripts/generate-interior.ts
 */

import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDoc,
  layerById,
  indexOf,
  DECOR_LAYER_ID,
  GROUND_LAYER_ID,
  type MapDoc,
  type TileLayer,
} from '../src/model/doc.js';
import { History } from '../src/model/history.js';
import { serialize } from '../src/io/tiled.js';
import {
  INTERIOR_DOOR_TILE,
  floorFrameAt,
  INTERIOR_HEIGHT,
  INTERIOR_SPAWN_TILE,
  INTERIOR_WIDTH,
  TILESET_HOUSE,
  WALL_ROWS,
  toGid,
  wallTiles,
} from '@tillhaven/shared/config';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../client/public/tilemaps/interior.json');

function fail(message: string): never {
  console.error(`generate-interior: ${message}`);
  process.exit(1);
}

function tileLayer(doc: MapDoc, id: string): TileLayer {
  const layer = layerById(doc, id);
  if (!layer || layer.kind !== 'tile') fail(`no tile layer "${id}" in a fresh createDoc()`);
  return layer;
}

function main(): void {
  const doc = createDoc(INTERIOR_WIDTH, INTERIOR_HEIGHT);
  const history = new History();

  const ground = tileLayer(doc, GROUND_LAYER_ID);
  const decor = tileLayer(doc, DECOR_LAYER_ID);

  /*
   * Floor everywhere, wall on top.
   *
   * The floor runs under the wall rather than stopping at it. Painting only the
   * walkable rows would leave gid 0 behind the wall band, and any wall tile
   * with transparency — the door's frame has some — would show the page
   * background through the house.
   */
  history.begin('floor');
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      // A plank per cell rather than one tile everywhere (T-18.11): three
      // seamless variants in a coordinate-hashed bond, which reads as parquet
      // instead of as the diagonal hatch the audit called a placeholder.
      history.setTile(ground, indexOf(doc, x, y), toGid(TILESET_HOUSE.key, floorFrameAt(x, y)));
    }
  }
  history.commit();

  history.begin('wall');
  for (const tile of wallTiles()) {
    if (tile.x < 0 || tile.y < 0 || tile.x >= doc.width || tile.y >= doc.height) {
      fail(`wall tile (${tile.x},${tile.y}) is outside the ${doc.width}x${doc.height} room`);
    }
    history.setTile(decor, indexOf(doc, tile.x, tile.y), toGid(TILESET_HOUSE.key, tile.frame));
  }
  history.commit();

  /*
   * The two rules that make the room usable, asserted rather than assumed.
   * A door in the wrong row, or a spawn inside the wall, are both things you
   * discover by walking into them; here they refuse to write the map.
   */
  if (INTERIOR_DOOR_TILE.y !== WALL_ROWS - 1) {
    fail(`door row ${INTERIOR_DOOR_TILE.y} is not the wall's bottom course`);
  }
  if (INTERIOR_SPAWN_TILE.y < WALL_ROWS) {
    fail(`spawn (${INTERIOR_SPAWN_TILE.x},${INTERIOR_SPAWN_TILE.y}) is inside the wall`);
  }
  if (INTERIOR_SPAWN_TILE.y !== INTERIOR_DOOR_TILE.y + 1) {
    fail('spawn must be directly below the door, or entering does not face it');
  }

  const painted = decor.data.reduce((n, gid) => (gid > 0 ? n + 1 : n), 0);
  if (painted !== WALL_ROWS * INTERIOR_WIDTH) {
    fail(`painted ${painted} wall tiles, expected ${WALL_ROWS * INTERIOR_WIDTH}`);
  }

  const map = serialize(doc);
  const json = `${JSON.stringify(map, null, 2)}\n`;
  void writeFile(OUT, json, 'utf8').then(() => {
    console.log(`  wrote ${OUT}`);
    console.log(`  ${doc.width}x${doc.height} tiles, ${painted} wall tiles`);
  });
}

main();
