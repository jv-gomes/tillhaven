/**
 * Bakes the authored map's LAYOUT into shared config.
 *
 *   pnpm layout
 *
 * Reads `apps/client/public/tilemaps/farm.json` and writes
 * `packages/shared/src/config/farmLayout.generated.ts`.
 *
 * **This is the task that made the map the source of truth.** Until now
 * `farmLayout.ts` held the positions of the trees, the chest, the shipping box,
 * the mailbox and the merchant's stall as constants, and `generate-farm.ts`
 * painted a map FROM them. Editing the map by hand therefore produced a farm the
 * server did not believe in: the trap-guard went on protecting the chest's old
 * tile, registration went on seeding trees where the map no longer drew any, and
 * a dev-only console warning was the only thing that ever said so.
 *
 * Now the map is authored and this reads it back, exactly the way `pnpm plots`
 * and `pnpm collision` already do for the plot markers and the collision brush.
 * The three together are the whole of what the server needs to know about the
 * farm's shape.
 *
 * **What this does NOT bake, and why.** The house, coop and barn are not on the
 * map's object layer at all: their ART depends on a tier the player owns, so
 * they are drawn from `buildings.ts` at runtime and anchored by config. The
 * merchant NPC is likewise a constant rather than an object. Baking a position
 * for something whose art the map does not hold would be inventing agreement.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FARM_HEIGHT, FARM_WIDTH, TILE_SIZE, fromGid, terrainMask } from '@tillhaven/shared/config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MAP_FILE = resolve(ROOT, 'apps/client/public/tilemaps/farm.json');
const OUT_FILE = resolve(ROOT, 'packages/shared/src/config/farmLayout.generated.ts');

/**
 * The one terrain key that blocks as a whole tile.
 *
 * Mirrors `isWaterKey` in `apps/client/src/game/collision.ts`. Duplicated rather
 * than imported because that module is client-side and pulls in Phaser; the
 * duplication is one string and `farmLayout.test.ts` pins that the baked tiles
 * are the ones the client's own rule produces.
 */
function isWaterKey(key: string): boolean {
  return key === 'water-tile';
}

interface TiledLayer {
  name: string;
  type: string;
  data?: number[];
  objects?: { gid?: number; x: number; y: number; name?: string }[];
}

interface TiledMap {
  width: number;
  height: number;
  layers: TiledLayer[];
}

function fail(message: string): never {
  console.error(`generate-farm-layout: ${message}`);
  process.exit(1);
}

function main(): void {
  const map = JSON.parse(readFileSync(MAP_FILE, 'utf8')) as TiledMap;

  if (map.width !== FARM_WIDTH || map.height !== FARM_HEIGHT) {
    fail(
      `map is ${map.width}x${map.height} but FARM_WIDTH/FARM_HEIGHT say ` +
        `${FARM_WIDTH}x${FARM_HEIGHT}. Resize the map or change the constants; ` +
        `baking a layout for the wrong grid would put every tile in the wrong place.`,
    );
  }

  const ground = map.layers.find((l) => l.type === 'tilelayer' && l.name === 'ground');
  if (!ground?.data) fail('no `ground` tile layer in the map');

  /*
   * Solid terrain, by the SAME rule the client renders with: an authored mask
   * in `TILE_COLLISION_MASK` wins, otherwise the whole tile blocks if its key is
   * water. Anything else is walkable.
   *
   * A tile with a mask counts as solid terrain if the mask blocks anything at
   * all — the shoreline blocks one column of three, and a decoration standing in
   * the sea is as wrong there as on the flat fill.
   */
  const solid: { x: number; y: number }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const gid = ground.data[y * map.width + x] ?? 0;
      if (gid === 0) continue;
      const loc = fromGid(gid);
      if (!loc) continue;

      const mask = terrainMask(loc.run.key, loc.frame);
      if (mask) {
        if (mask.some((row) => row.includes('#'))) solid.push({ x, y });
      } else if (isWaterKey(loc.run.key)) {
        solid.push({ x, y });
      }
    }
  }

  const objectLayer = map.layers.find((l) => l.type === 'objectgroup' && l.name === 'objects');
  const placements: { key: string; x: number; y: number }[] = [];

  for (const object of objectLayer?.objects ?? []) {
    if (!object.gid) continue; // gid-less rectangles are plots/animations/collision
    const loc = fromGid(object.gid);
    if (!loc) {
      fail(`object at ${object.x},${object.y} has gid ${object.gid}, which is in no tileset`);
    }
    /*
     * Tiled anchors a tile-object to its BOTTOM edge, so the tile it stands on
     * is one row up. This is the inverse of `objectAnchorPx`, and getting the
     * `- 1` wrong shifts every object by a tile — the exact bug `MAP_OBJECTS`
     * was created to make impossible.
     */
    placements.push({
      key: loc.run.key,
      x: Math.floor(object.x / TILE_SIZE),
      y: Math.floor(object.y / TILE_SIZE) - 1,
    });
  }

  /*
   * The four the game cannot do without.
   *
   * Each is a place the player interacts with and the server reasons about: the
   * chest and the shipping box are what the decor trap-guard keeps reachable,
   * and the mailbox and stall are where the shop and the mail open. A map
   * missing one is not a variation on the farm, it is a farm with no way to sell
   * anything — so this fails at bake time rather than letting the absence turn
   * into a null two layers away in the server.
   *
   * Trees are deliberately NOT here: a farm with no trees is merely a farm with
   * no trees.
   */
  for (const required of ['obj-chest', 'obj-shipping-box', 'obj-mailbox', 'obj-newsstand']) {
    const found = placements.filter((p) => p.key === required);
    if (found.length !== 1) {
      fail(
        `the map must place exactly one ${required}, found ${found.length}. ` +
          `The game opens the shop, the mail and the shipping box at these, and the ` +
          `server keeps them reachable — place it in the editor and re-run.`,
      );
    }
  }

  // Sorted so a re-bake of an unchanged map is a zero-line diff whatever order
  // the editor happened to write its objects in.
  solid.sort((a, b) => a.y - b.y || a.x - b.x);
  placements.sort((a, b) => a.key.localeCompare(b.key) || a.y - b.y || a.x - b.x);

  const tileList = (tiles: { x: number; y: number }[]): string =>
    tiles.map((t) => `  { x: ${t.x}, y: ${t.y} },`).join('\n');

  const out = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by \`pnpm layout\` from apps/client/public/tilemaps/farm.json. To
 * change any of it, move the thing in the map editor (\`pnpm dev:mapmaker\`),
 * save, and re-run.
 *
 * **The map is the source of truth for the farm's shape.** \`farmLayout.ts\`
 * used to hold these positions as constants and the map was painted from them;
 * that made a hand-edited map into a farm the server did not believe in — the
 * trap-guard protecting a chest that had moved, registration seeding trees the
 * map no longer drew. This file is the other direction, and it is the third of
 * three bakes: \`pnpm plots\`, \`pnpm collision\`, \`pnpm layout\`.
 *
 * Source map: ${map.width}x${map.height} tiles, ${solid.length} solid terrain tiles,
 * ${placements.length} objects.
 */

export interface GeneratedTile {
  readonly x: number;
  readonly y: number;
}

/** An object on the map's \`objects\` layer: its art key and the tile it stands on. */
export interface GeneratedObject {
  /** A tileset key from the shared manifest, e.g. \`obj-chest\`. */
  readonly key: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Ground tiles the terrain art makes impassable.
 *
 * By the same rule the client renders with: an authored mask in
 * \`TILE_COLLISION_MASK\` wins, otherwise a whole tile blocks if its key draws
 * open water. This is what \`waterTiles()\` returns.
 */
export const MAP_SOLID_TERRAIN: readonly GeneratedTile[] = [
${tileList(solid)}
];

/** Every gid-bearing object the map places, anchored to the tile it stands on. */
export const MAP_PLACED_OBJECTS: readonly GeneratedObject[] = [
${placements.map((p) => `  { key: ${JSON.stringify(p.key)}, x: ${p.x}, y: ${p.y} },`).join('\n')}
];
`;

  writeFileSync(OUT_FILE, out, 'utf8');
  console.log(
    `generate-farm-layout: ${solid.length} solid terrain tiles, ` +
      `${placements.length} objects -> packages/shared/src/config/farmLayout.generated.ts`,
  );
  for (const [key, n] of countBy(placements.map((p) => p.key))) {
    console.log(`  ${key} x${n}`);
  }
}

function countBy(keys: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].sort();
}

main();
