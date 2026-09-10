import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHEST_TILE,
  MAILBOX_TILE,
  MAP_PLACED_OBJECTS,
  MAP_SOLID_TERRAIN,
  MAP_OBJECTS,
  MERCHANT_TILE,
  SHIPPING_BOX_TILE,
  TILE_SIZE,
  TREES,
  fromGid,
  terrainMask,
  waterTiles,
} from '@tillhaven/shared/config';
import type { TiledMap } from './tiled.js';

/**
 * `pnpm layout` is current — the bake matches the map it was baked from.
 *
 * **This is the arrow that replaced T-15.00's.** `farmMap.test.ts` used to pin
 * that `farm.json` matched what `generate-farm.ts` would paint, which made every
 * hand edit a build failure. The map is authored now and `farmLayout.generated.ts`
 * is read back out of it, so the thing worth pinning is the opposite: that the
 * bake has been re-run since the map last changed.
 *
 * The failure this catches is quiet and expensive. Move the chest in the editor,
 * save, forget `pnpm layout`, and the game draws it in the new place while the
 * server's decor trap-guard goes on keeping a path open to the old one — a
 * disagreement with no symptom until a player fences themselves off from a chest
 * the server believes is somewhere else.
 *
 * It re-derives rather than shelling out to the script: a test that ran the
 * generator would pass by rewriting the file it was meant to be checking.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const FARM_JSON = resolve(ROOT, 'apps/client/public/tilemaps/farm.json');

const map = JSON.parse(readFileSync(FARM_JSON, 'utf8')) as TiledMap;

/** Mirrors `isWaterKey` in the client, as the generator does. */
const isWaterKey = (key: string): boolean => key === 'water-tile';

function deriveSolidTerrain(): { x: number; y: number }[] {
  const ground = map.layers.find((l) => l.type === 'tilelayer' && l.name === 'ground');
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const gid = ground?.data?.[y * map.width + x] ?? 0;
      if (gid === 0) continue;
      const loc = fromGid(gid);
      if (!loc) continue;
      const mask = terrainMask(loc.run.key, loc.frame);
      if (mask) {
        if (mask.some((row) => row.includes('#'))) out.push({ x, y });
      } else if (isWaterKey(loc.run.key)) {
        out.push({ x, y });
      }
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

function derivePlacements(): { key: string; x: number; y: number }[] {
  const objects = map.layers.find((l) => l.type === 'objectgroup' && l.name === 'objects');
  const out: { key: string; x: number; y: number }[] = [];
  for (const o of objects?.objects ?? []) {
    if (!o.gid) continue;
    const loc = fromGid(o.gid);
    if (!loc) continue;
    // Tiled anchors a tile-object to its BOTTOM edge, so subtract the row.
    out.push({ key: loc.run.key, x: Math.floor(o.x / TILE_SIZE), y: Math.floor(o.y / TILE_SIZE) - 1 });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key) || a.y - b.y || a.x - b.x);
}

describe('the layout bake is current', () => {
  it('MAP_SOLID_TERRAIN matches the map, so run `pnpm layout` if this fails', () => {
    expect(MAP_SOLID_TERRAIN.map((t) => ({ x: t.x, y: t.y }))).toEqual(deriveSolidTerrain());
  });

  it('MAP_PLACED_OBJECTS matches the map, so run `pnpm layout` if this fails', () => {
    expect(MAP_PLACED_OBJECTS.map((o) => ({ key: o.key, x: o.x, y: o.y }))).toEqual(
      derivePlacements(),
    );
  });
});

/**
 * The four the game cannot do without.
 *
 * Each is somewhere the player interacts and the server reasons about — the
 * chest and the shipping box are what the decor trap-guard keeps reachable, the
 * mailbox and stall are where the mail and the shop open. `pnpm layout` refuses
 * to bake a map missing one; this says the same thing about the baked result, so
 * a hand-edited generated file cannot smuggle one out.
 */
describe('the map places what the game requires', () => {
  it('has exactly one of each interactive object', () => {
    for (const key of ['obj-chest', 'obj-shipping-box', 'obj-mailbox', 'obj-newsstand']) {
      expect(
        MAP_PLACED_OBJECTS.filter((o) => o.key === key),
        `${key} in farm.json`,
      ).toHaveLength(1);
    }
  });

  it('resolves each of them to the tile the map draws it on', () => {
    const at = (key: string) => {
      const o = MAP_PLACED_OBJECTS.find((p) => p.key === key)!;
      return { x: o.x, y: o.y };
    };
    expect(CHEST_TILE).toEqual(at('obj-chest'));
    expect(SHIPPING_BOX_TILE).toEqual(at('obj-shipping-box'));
    expect(MAILBOX_TILE).toEqual(at('obj-mailbox'));
    expect(MERCHANT_TILE).toEqual(at('obj-newsstand'));
  });

  /**
   * Trees are seeded into the database at registration from `TREES`, so this is
   * the list a new farm's rows are built from. A tree in the config that the map
   * does not draw is a stump the player can chop and never see.
   */
  it('seeds trees from the map, not from a constant', () => {
    const fromMap = MAP_PLACED_OBJECTS.filter((o) => o.key === 'obj-maple-tree');
    expect(TREES).toHaveLength(fromMap.length);
    expect([...TREES].sort((a, b) => a.y - b.y || a.x - b.x)).toEqual(
      fromMap.map((o) => ({ x: o.x, y: o.y })).sort((a, b) => a.y - b.y || a.x - b.x),
    );
  });

  it('lists every placed object in MAP_OBJECTS, keys and tiles together', () => {
    expect(MAP_OBJECTS.map((o) => ({ key: o.key, x: o.tile.x, y: o.tile.y }))).toEqual(
      MAP_PLACED_OBJECTS.map((o) => ({ key: o.key, x: o.x, y: o.y })),
    );
  });

  /** `waterTiles()` is the map's solid terrain now, not a column of constants. */
  it('reports water as whatever terrain the map makes impassable', () => {
    expect(waterTiles()).toEqual(MAP_SOLID_TERRAIN.map((t) => ({ x: t.x, y: t.y })));
  });
});
