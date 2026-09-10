import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DOOR_X0,
  DOOR_X1,
  FLOOR_TOP,
  INTERIOR_DOOR_TILE,
  INTERIOR_FLOOR_FRAMES,
  floorFrameAt,
  INTERIOR_HEIGHT,
  INTERIOR_SPAWN_TILE,
  INTERIOR_WIDTH,
  TILESET_HOUSE,
  TILE_SIZE,
  WALL_ROWS,
  fromGid,
  toGid,
  wallTiles,
} from '@tillhaven/shared/config';
import type { TiledMap } from './tiled.js';

/**
 * T-16.10 — the interior map, pinned against the constants that painted it.
 *
 * `farmMap.test.ts`'s sibling, and it exists for the same reason plus one more.
 * The shared reason is gid drift: the map is a file full of already-written
 * gids that nobody renumbers, so a `SHEETS` edit repaints it silently.
 *
 * The extra reason is that this map has RULES the farm does not. A door that is
 * not in the wall's bottom course, or a spawn inside the wall, produce a room
 * you can see is wrong only by walking into it — and the interior is not
 * somewhere anyone visits by accident during other work. The generator refuses
 * to write either, and this refuses to let a committed map disagree with the
 * constants after the fact.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MAP_PATH = resolve(ROOT, 'apps/client/public/tilemaps/interior.json');

function loadMap(): TiledMap {
  return JSON.parse(readFileSync(MAP_PATH, 'utf8')) as TiledMap;
}

function tileLayer(map: TiledMap, name: string): readonly number[] {
  const layer = map.layers.find((l) => l.name === name);
  if (!layer || layer.type !== 'tilelayer' || !layer.data) {
    throw new Error(`no tile layer "${name}"`);
  }
  return layer.data;
}

const at = (data: readonly number[], x: number, y: number) => data[y * INTERIOR_WIDTH + x]!;

describe('interior.json matches the layout that generated it', () => {
  const map = loadMap();

  it('is the size the config says', () => {
    expect(map.width).toBe(INTERIOR_WIDTH);
    expect(map.height).toBe(INTERIOR_HEIGHT);
    expect(map.tilewidth).toBe(TILE_SIZE);
    expect(map.tileheight).toBe(TILE_SIZE);
  });

  it('embeds gids the current manifest still resolves', () => {
    // The drift check. Every non-zero gid in the file must resolve through the
    // manifest as it stands now — if `SHEETS` moved, this is where it shows.
    for (const layer of map.layers) {
      if (layer.type !== 'tilelayer' || !layer.data) continue;
      for (const gid of layer.data) {
        if (gid === 0) continue;
        expect(fromGid(gid), `gid ${gid} no longer resolves`).toBeDefined();
      }
    }
  });

  it('floors the whole room, including behind the wall', () => {
    const ground = tileLayer(map, 'ground');

    for (let y = 0; y < INTERIOR_HEIGHT; y++) {
      for (let x = 0; x < INTERIOR_WIDTH; x++) {
        // One of the three planks (T-18.11), and the one the hash names —
        // both halves, because "some floor tile" would pass on a room paved
        // at random and this map has to regenerate byte-identically.
        expect(at(ground, x, y), `floor missing at (${x},${y})`).toBe(
          toGid(TILESET_HOUSE.key, floorFrameAt(x, y)),
        );
      }
    }
  });

  /**
   * A floor of one tile is a grid; a floor of three laid in a bond is parquet.
   * The whole point of T-18.11 is that the room stops looking paved by a
   * placeholder, so "more than one plank actually got used" is the assertion.
   */
  it('lays more than one plank, or it is a grid again', () => {
    const ground = tileLayer(map, 'ground');
    const used = new Set<number>();
    for (let y = 0; y < INTERIOR_HEIGHT; y++) {
      for (let x = 0; x < INTERIOR_WIDTH; x++) used.add(at(ground, x, y));
    }

    expect(used.size).toBe(INTERIOR_FLOOR_FRAMES.length);
    // ...and no plank is a token presence — the rarest still covers a tenth of
    // the room, or the bond reads as a blemish rather than as a pattern.
    const counts = new Map<number, number>();
    for (let y = 0; y < INTERIOR_HEIGHT; y++) {
      for (let x = 0; x < INTERIOR_WIDTH; x++) {
        const gid = at(ground, x, y);
        counts.set(gid, (counts.get(gid) ?? 0) + 1);
      }
    }
    const cells = INTERIOR_WIDTH * INTERIOR_HEIGHT;
    for (const [gid, n] of counts) {
      expect(n / cells, `plank ${gid} covers ${n}/${cells}`).toBeGreaterThan(0.1);
    }
  });

  /**
   * Behind the wall too, and that is not belt-and-braces: the door's frame has
   * transparent pixels, so a gid 0 under it would show the page background
   * through the house.
   */
  it('paints exactly the wall the config describes', () => {
    const decor = tileLayer(map, 'decor');
    const expected = wallTiles();

    expect(expected).toHaveLength(WALL_ROWS * INTERIOR_WIDTH);
    for (const tile of expected) {
      expect(at(decor, tile.x, tile.y), `wall (${tile.x},${tile.y})`).toBe(
        toGid(TILESET_HOUSE.key, tile.frame),
      );
    }

    // ...and nothing below the wall band.
    for (let y = WALL_ROWS; y < INTERIOR_HEIGHT; y++) {
      for (let x = 0; x < INTERIOR_WIDTH; x++) {
        expect(at(decor, x, y), `stray decor at (${x},${y})`).toBe(0);
      }
    }
  });

  /**
   * The rules that make the room usable. Each one is something you would find
   * by walking into it, in a scene nobody opens by accident.
   */
  it('puts the door where a player standing on the floor can face it', () => {
    expect(INTERIOR_DOOR_TILE.y, 'door is not in the wall').toBeLessThan(WALL_ROWS);
    expect(INTERIOR_DOOR_TILE.y, 'door is not the wall’s bottom course').toBe(WALL_ROWS - 1);
    expect(INTERIOR_DOOR_TILE.x).toBeGreaterThanOrEqual(DOOR_X0);
    expect(INTERIOR_DOOR_TILE.x).toBeLessThanOrEqual(DOOR_X1);

    // The tile below it must be floor, or there is nowhere to stand.
    expect(INTERIOR_DOOR_TILE.y + 1).toBeGreaterThanOrEqual(FLOOR_TOP);
    expect(INTERIOR_DOOR_TILE.y + 1).toBeLessThan(INTERIOR_HEIGHT);
  });

  it('spawns the player on the floor, directly below the door', () => {
    expect(INTERIOR_SPAWN_TILE.y, 'spawn is inside the wall').toBeGreaterThanOrEqual(FLOOR_TOP);
    expect(INTERIOR_SPAWN_TILE.y).toBeLessThan(INTERIOR_HEIGHT);
    expect(INTERIOR_SPAWN_TILE.x).toBe(INTERIOR_DOOR_TILE.x);
    expect(INTERIOR_SPAWN_TILE.y, 'entering must leave the character facing the door').toBe(
      INTERIOR_DOOR_TILE.y + 1,
    );
  });

  it('leaves a walkable floor worth having', () => {
    // Four rows of wall out of ten leaves six. Fewer than three and the room is
    // a corridor; this catches a wall that grew without the room growing.
    expect(INTERIOR_HEIGHT - WALL_ROWS).toBeGreaterThanOrEqual(3);
  });
});
