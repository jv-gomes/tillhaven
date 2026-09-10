import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILDING_FOOTPRINTS,
  GROUND_SCATTER,
  TILESET_RUNS,
  fromGid,
  FARM_WIDTH,
  FARM_HEIGHT,
  PLOT_POSITIONS,
  TILE_SIZE,
  borderTiles,
  ANIM_ID_PROPERTY,
  ANIM_LAYER_NAME,
  GROUND_FILL,
  fieldTiles,
  getGroundAnimation,
  inFootprint,
  pathTiles,
  scatterTiles,
  solidObjectTiles,
  toGid,
  waterTiles,
  yardTilesAcrossTiers,
} from '@tillhaven/shared/config';
import type { TiledMap } from './tiled.js';

/**
 * T-15.01 — the authored map, pinned against the manifest that numbered it.
 *
 * `TILESET_RUNS` allocates gids by walking `SHEETS` then `IMAGES` in their
 * declared order, giving every entry a slot whether the map uses it or not.
 * That determinism is a feature (see `tilesets.ts`) but it has a sharp edge:
 * **inserting anything into `SHEETS`, or into the middle of `IMAGES`, shifts
 * every firstgid after it** — and `farm.json` is a file full of already-written
 * gids that nobody renumbers. The map does not fail to load. It loads, and
 * draws the wrong tiles: a maple tree becomes a slice of a cow.
 *
 * That has bitten this repo before (T-7.02's filename collision, T-11.x's
 * silently-undrawn shipping box), and the only reason it is survivable is that
 * regenerating the map is cheap. This file makes it *loud* instead of silent.
 *
 * The rule it enforces, stated once so it can be quoted:
 *
 *   **Append new art to the END of `IMAGES` and nothing shifts. Touch `SHEETS`
 *   at all — or insert mid-`IMAGES` — and you MUST re-run
 *   `generate-farm.ts` + `verify-farm.ts` before committing.**
 *
 * This lives in the mapmaker rather than in `packages/shared` on purpose: the
 * mapmaker is the package that owns `farm.json` (it writes it, and
 * `verify-farm.ts` already reads it back), so it is the one place allowed to
 * hold both the manifest and the artefact in its head at once. `pnpm test`
 * runs it regardless of which package you were editing.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const FARM_JSON = resolve(ROOT, 'apps/client/public/tilemaps/farm.json');

const map = JSON.parse(readFileSync(FARM_JSON, 'utf8')) as TiledMap;

function layer(name: string) {
  const found = map.layers.find((l) => l.name === name);
  if (!found) throw new Error(`farm.json has no layer named ${name}`);
  return found;
}

/**
 * Every tile-object in the map, and the art it MUST resolve to.
 *
 * Measured from the committed map (T-15.01), not guessed. The maple is frame 2
 * of its strip rather than frame 0 because that is the still frame
 * `generate-farm.ts` stamps — the animated sheet is a separate tileset
 * (`obj-maple-tree-anim`) the client swaps in at runtime.
 *
 * Note two names that do not match their art key, and are correct anyway: the
 * merchant is drawn with `obj-newsstand`, and the object named `chest` is frame
 * 0 of a 16-frame chest sheet.
 */
const EXPECTED_OBJECTS: readonly { name: string; key: string; frame: number }[] = [
  { name: 'maple-tree', key: 'obj-maple-tree', frame: 2 },
  { name: 'maple-tree', key: 'obj-maple-tree', frame: 2 },
  { name: 'maple-tree', key: 'obj-maple-tree', frame: 2 },
  { name: 'maple-tree', key: 'obj-maple-tree', frame: 2 },
  { name: 'maple-tree', key: 'obj-maple-tree', frame: 2 },
  { name: 'mailbox', key: 'obj-mailbox', frame: 0 },
  { name: 'merchant', key: 'obj-newsstand', frame: 0 },
  { name: 'chest', key: 'obj-chest', frame: 0 },
  { name: 'shipping-box', key: 'obj-shipping-box', frame: 0 },
];

/**
 * The tilesets the ground layer actually draws from.
 *
 * Five, not the three you would guess from the names. The single-image
 * `ground-*` and `water-tile` entries are the flat fills; the two `tileset-*`
 * entries are the fringed border tiles that stop the farm ending in a hard
 * rectangle (`borderTiles()` in `farmLayout.ts`).
 *
 * `tileset-soil` used to be a sixth. It painted a 5x4 tilled patch at
 * (12..16, 4..7) — the field's position before T-12.02b moved it — which had no
 * plots under it and which T-9.04 had already decided should not exist at all
 * ("soil is SERVER state, the client draws it per plot"). T-15.00 deleted it.
 *
 * A change to this set is a real map edit and should be reviewed as one, which
 * is why the assertion is on the exact set rather than a subset.
 */
describe('farm.json is numbered by the current manifest', () => {
  /*
   * The sharpest test in the file, and the one that will actually fire.
   *
   * A Tiled map embeds its own firstgid table, so the committed map carries a
   * frozen snapshot of `TILESET_RUNS` from the moment it was generated. If the
   * manifest has shifted since, these two disagree — and they disagree BEFORE
   * any individual gid has to be checked, which makes the failure message name
   * the tileset that moved rather than the tile that broke.
   */
  it('embeds a PREFIX of the manifest runs, at the same firstgids', () => {
    /*
     * A prefix, not the whole list (T-18.02).
     *
     * `assets.ts` documents one safe edit: appending to the END of `IMAGES`,
     * which allocates a new run after every existing one and therefore shifts
     * no `firstgid`. A map generated before that edit is still correct — it
     * simply does not mention the new run, because nothing places it as a tile.
     * Asserting the exact LENGTH made that safe edit fail identically to an
     * unsafe one, which is the wrong signal: it pushes you toward regenerating
     * a map that must not be regenerated (D-13/T-15.00).
     *
     * So the invariant is stated the way the manifest actually promises it:
     * every run the map embeds must sit at the index and firstgid the manifest
     * gives it, and the map may stop short. An insertion in the MIDDLE still
     * fails loudly, because every run after it moves.
     */
    expect(map.tilesets.length).toBeLessThanOrEqual(TILESET_RUNS.length);

    const embedded = new Map(map.tilesets.map((t) => [t.name, t.firstgid]));
    const drifted: string[] = [];

    for (const [index, run] of TILESET_RUNS.entries()) {
      const firstgid = embedded.get(run.key);
      if (firstgid === undefined) {
        // Fine only if this run is past the end of what the map embeds — i.e.
        // it was appended. A gap before that is a run that went missing.
        if (index < map.tilesets.length) {
          drifted.push(`${run.key}: missing from farm.json`);
        }
        continue;
      }
      if (firstgid !== run.firstgid) {
        drifted.push(`${run.key}: map says ${firstgid}, manifest says ${run.firstgid}`);
      }
    }

    // Anything the map embeds that the manifest no longer knows about is a
    // removal, which shifts everything after it.
    const known = new Set(TILESET_RUNS.map((run) => run.key));
    for (const tileset of map.tilesets) {
      if (!known.has(tileset.name)) drifted.push(`${tileset.name}: not in the manifest`);
    }

    expect(
      drifted,
      'farm.json was numbered by a different manifest. Re-run:\n' +
        '  node scripts/prepare-assets.mjs\n' +
        '  apps/mapmaker/node_modules/.bin/tsx apps/mapmaker/scripts/generate-farm.ts\n' +
        '  apps/mapmaker/node_modules/.bin/tsx apps/mapmaker/scripts/verify-farm.ts',
    ).toEqual([]);
  });

  it('is the size the shared config says the farm is', () => {
    expect([map.width, map.height]).toEqual([FARM_WIDTH, FARM_HEIGHT]);
  });
});

describe('every object gid resolves to the art it was authored with', () => {
  it('draws the trees, mailbox, merchant, chest and shipping box', () => {
    const objects = layer('objects').objects ?? [];

    const resolved = objects.map((o) => {
      const loc = fromGid(o.gid ?? 0);
      return { name: o.name, key: loc?.run.key ?? '(unresolved)', frame: loc?.frame ?? -1 };
    });

    expect(resolved).toEqual(EXPECTED_OBJECTS);
  });
});

/*
 * T-15.00's landmine, disarmed and pinned — and pointing the other way since M6.
 *
 * `plots.generated.ts` carries the instruction "to change the farm's shape,
 * move the markers in the map editor and re-run `pnpm plots`" — so the map's
 * `plots` layer is an INPUT to a generated file the server and client both read
 * as gospel. Before T-15.00 the two disagreed: the map marked (12..16, 4..7)
 * while `PLOT_POSITIONS` said (9..13, 9..12). At the time the advice was "do not
 * run `pnpm plots`, regenerate the map", because `generate-farm.ts` was the
 * authority (D-13) and the constants were the thing to trust.
 *
 * **M5 reversed that and M6 paid for the reversal.** The map is authored now,
 * the generator is scaffolding behind a `--force` guard, and the same
 * disagreement appeared again from the other side: the editor moved the field
 * to (8..12, 2..5) and nothing was re-baked. The old message told the reader to
 * destroy the authoring. Re-baking is the fix, and the only thing it costs
 * pre-launch is a database wipe, because `newFarmPlots()` wrote the old
 * coordinates into every farm that already exists.
 *
 * The disagreement was invisible because nothing at runtime reads the map's
 * plots layer. This test is the only thing that looks at both.
 */
describe('the plots layer and PLOT_POSITIONS agree', () => {
  it('marks exactly the tiles the game unlocks, in the same order', () => {
    const objects = layer('plots').objects ?? [];

    // Tiled anchors a plain rectangle at its TOP-left, unlike the tile-objects
    // above, which hang from their bottom-left. No `- 1` here for that reason.
    const marked = objects.map((o) => ({ x: o.x / TILE_SIZE, y: o.y / TILE_SIZE }));

    expect(
      marked,
      'farm.json and plots.generated.ts disagree about where the field is. Run ' +
        '`pnpm plots` to bake the map you authored — and remember it moves the ' +
        'plots of every farm already in the database, so wipe the dev DB after.',
    ).toEqual(PLOT_POSITIONS.map((p) => ({ x: p.x, y: p.y })));
  });
});

describe('the plots layer follows FIELD_CELLS, whatever shape it is', () => {
  /**
   * The field is an authored LIST now, not a rectangle derived from
   * `FIELD_X0/Y0/W/H`. That is what lets it be an L or two patches either side
   * of a path — and it is also what makes it possible to author a field with a
   * duplicate cell, or one under a barn, neither of which the old double loop
   * could express. So the list gets the checks the loop never needed.
   */
  it('marks every field cell exactly once', () => {
    const cells = fieldTiles().map((t) => `${t.x},${t.y}`);
    expect(new Set(cells).size, 'the map marks one tile as a plot twice').toBe(cells.length);
  });

  it('paints tillable ground under every field cell and nowhere else', () => {
    const ground = layer('ground');
    const data = ground.data ?? [];
    const tillable = toGid(GROUND_FILL.tillable.sheet, GROUND_FILL.tillable.frame);
    const field = new Set(fieldTiles().map((t) => `${t.x},${t.y}`));

    const painted: string[] = [];
    for (let y = 0; y < FARM_HEIGHT; y++) {
      for (let x = 0; x < FARM_WIDTH; x++) {
        if (data[y * FARM_WIDTH + x] === tillable) painted.push(`${x},${y}`);
      }
    }

    expect(
      new Set(painted),
      'the orange tillable paint and the plot markers disagree — a player would ' +
        'see a field that is not where their plots are',
    ).toEqual(field);
  });

  /*
   * **The order test that used to live here is gone, and its absence is the
   * point.** It asserted `fieldTiles()` equalled `PLOT_POSITIONS`, which was
   * real work while `FIELD_CELLS` was a hand-written list — the two were
   * separate copies of the same twenty cells and the test was what kept them
   * equal. Since M6 `FIELD_CELLS` IS `PLOT_POSITIONS`, so the assertion
   * compares a value to itself and cannot fail. A test that cannot fail is not
   * evidence; the fact it was defending is now defended by construction, and
   * the map's marker order reaching `PLOT_POSITIONS` at all is what the
   * `plots layer and PLOT_POSITIONS agree` block above checks.
   */
});

describe('the animations layer', () => {
  it('exists, so a map without one is a regeneration somebody forgot', () => {
    expect(layer(ANIM_LAYER_NAME)).toBeDefined();
  });

  /**
   * **This used to assert the map equalled `groundAnimationPlacements()`**, back
   * when the config was authoritative and the map was painted from it. The map
   * is authored now, so that pin had the arrow backwards: it failed whenever
   * somebody stamped an animation, which is the tool working.
   *
   * What is still worth pinning is that every placement lands on the grid. An
   * animation stamped outside the map draws nothing, silently.
   */
  it('places every animation inside the map', () => {
    for (const o of layer(ANIM_LAYER_NAME).objects ?? []) {
      const x = o.x / TILE_SIZE;
      const y = o.y / TILE_SIZE;
      expect(Number.isInteger(x) && Number.isInteger(y), `off-grid at ${o.x},${o.y}`).toBe(true);
      expect(x, `x=${x}`).toBeGreaterThanOrEqual(0);
      expect(x, `x=${x}`).toBeLessThan(FARM_WIDTH);
      expect(y, `y=${y}`).toBeGreaterThanOrEqual(0);
      expect(y, `y=${y}`).toBeLessThan(FARM_HEIGHT);
    }
  });

  /**
   * Every id in the map has to name a real animation. An unknown one draws a
   * static first frame and logs a warning — visible as "the water stopped
   * moving", which is not a phrase that leads anyone to this file.
   */
  it('names only animations that exist', () => {
    /*
     * Collected and reported together rather than asserted per object: the map
     * stamps the same id on dozens of cells, so a per-object assertion dies on
     * the first one and says nothing about the other three ids that are also
     * missing. What the reader needs is the list and the counts.
     */
    const missing = new Map<string, number>();
    for (const o of layer(ANIM_LAYER_NAME).objects ?? []) {
      const animId = String(o.properties?.find((p) => p.name === ANIM_ID_PROPERTY)?.value);
      if (!getGroundAnimation(animId)) missing.set(animId, (missing.get(animId) ?? 0) + 1);
    }

    expect(
      [...missing].map(([id, n]) => `${id} (${n} cells)`),
      'the map stamps animations that no longer exist — create them in the ' +
        'editor\'s Animations panel, or clear those cells. Painted water animates ' +
        'on its own now (ANIMATED_SHEETS), so shoreline stamps are usually redundant',
    ).toEqual([]);
  });

  /** Plain rectangles: no gid, so `y` is the TOP edge. */
  it('carries no gid, so its anchoring convention is unambiguous', () => {
    for (const o of layer(ANIM_LAYER_NAME).objects ?? []) {
      expect(o.gid).toBeUndefined();
    }
  });
});

describe('the decorative border survives regeneration', () => {
  /*
   * The other half of T-15.00. The border is 96 tiles of fringed grass and
   * shoreline that the generator could not paint until T-15.00 taught it how;
   * a regression would silently flatten the farm back into a hard rectangle
   * ending at the viewport edge, which is easy to miss in a screenshot and
   * impossible to miss once you are looking for it.
   */
  /**
   * **Dropped: the map no longer has to match `borderTiles()`.**
   *
   * This asserted every border tile in `farm.json` equalled what the generator
   * would paint, which was the point while the generator owned the map. Now the
   * map is authored and the generator is scaffolding behind `--force`, so the
   * assertion only ever fired when somebody re-cut the shoreline by hand — the
   * tool being used as intended.
   *
   * `borderTiles()` still has a shape test below, because the FUNCTION is still
   * used to scaffold a fresh map and can still be wrong on its own terms.
   */
  it('has a border at all, whoever painted it', () => {
    const ground = layer('ground').data ?? [];
    const edge = (x: number, y: number) => ground[y * FARM_WIDTH + x] ?? 0;

    // Every edge cell is painted with something. A hole in the border is the
    // failure worth catching — a farm that ends in a visible gap.
    for (let x = 0; x < FARM_WIDTH; x++) {
      expect(edge(x, 0), `top ${x}`).toBeGreaterThan(0);
      expect(edge(x, FARM_HEIGHT - 1), `bottom ${x}`).toBeGreaterThan(0);
    }
    for (let y = 0; y < FARM_HEIGHT; y++) {
      expect(edge(0, y), `left ${y}`).toBeGreaterThan(0);
      expect(edge(FARM_WIDTH - 1, y), `right ${y}`).toBeGreaterThan(0);
    }
  });

  it('frames all four edges rather than a stray run of tiles', () => {
    // A cheap shape check, so "the border exists" cannot degrade into "one
    // corner of the border exists" while the test above still passes.
    const tiles = borderTiles();
    expect(tiles.filter((t) => t.y === 0).length).toBeGreaterThan(FARM_WIDTH / 2);
    expect(tiles.filter((t) => t.y === FARM_HEIGHT - 1).length).toBeGreaterThan(FARM_WIDTH / 2);
    expect(tiles.filter((t) => t.x === FARM_WIDTH - 1).length).toBeGreaterThan(FARM_HEIGHT / 2);
    expect(tiles.filter((t) => t.x === 1).length).toBeGreaterThan(FARM_HEIGHT / 2);
  });
});

describe('the ground layer resolves cleanly', () => {
  const ground = layer('ground');

  it('covers every cell — no holes for the player to see through', () => {
    expect(ground.data).toHaveLength(FARM_WIDTH * FARM_HEIGHT);
    expect(ground.data?.filter((gid) => gid === 0)).toEqual([]);
  });

  /**
   * **Every gid resolves — but the SET is no longer pinned.**
   *
   * The exact-set assertion was there so "a change to this set is a real map
   * edit and should be reviewed as one", which held while the map was generated.
   * An authored map may legitimately draw from any sheet in the manifest, and
   * failing the build because somebody painted with a new tileset is the tool
   * arguing with its user.
   *
   * The half worth keeping is the corruption check: a gid belonging to no
   * tileset means the manifest moved under the map (the failure that made maple
   * trees render as milk bottles), and that is not an authoring choice.
   */
  it('draws only gids the manifest can resolve', () => {
    const unresolved = new Set<number>();
    for (const gid of ground.data ?? []) {
      if (gid !== 0 && !fromGid(gid)) unresolved.add(gid);
    }
    expect([...unresolved]).toEqual([]);
  });
});

/**
 * The `decor` tile layer (T-18.09).
 *
 * It was EMPTY from the day the map was first authored until this task — zero
 * non-zero gids — which is why the farm read as a flat `#79BF56` field
 * (G-3). These assertions are about the two ways scatter goes wrong: it lands
 * somewhere it should not, or it stops being reproducible.
 */
describe('the decor layer carries the ground scatter', () => {
  const decor = layer('decor');
  const data = decor.data ?? [];

  const at = (x: number, y: number) => data[y * FARM_WIDTH + x] ?? 0;

  it('has scatter on it at all', () => {
    const painted = data.filter((gid) => gid !== 0);
    expect(painted.length).toBeGreaterThan(30);
    // ...and is still mostly empty. Scatter is texture, not a second ground.
    expect(painted.length).toBeLessThan(data.length / 4);
  });

  it('draws only the measured flat frames, and only from the props sheet', () => {
    const allowed = new Set<number>([...GROUND_SCATTER.tufts, ...GROUND_SCATTER.stones]);

    for (const gid of data) {
      if (gid === 0) continue;
      const loc = fromGid(gid);
      expect(loc?.run.key ?? `(unresolved gid ${gid})`).toBe(GROUND_SCATTER.sheet);
      // The frame list is the whole safety argument: every other frame on this
      // sheet has HEIGHT, and this layer draws below every world sprite.
      expect(allowed.has(loc!.frame), `frame ${loc!.frame} is not flat scatter`).toBe(true);
    }
  });

  /**
   * The one that would actually go wrong. A tuft under the barn, on the path,
   * or in the crop field is not a crash — it is a farm that looks like nobody
   * checked, and only at the tier that happens to reach it.
   */
  it('never lands on ground that is spoken for', () => {
    const taken = new Set<string>();
    const take = (t: { x: number; y: number }) => taken.add(`${t.x},${t.y}`);

    for (const t of waterTiles()) take(t);
    for (const t of borderTiles()) take(t);
    for (const t of pathTiles()) take(t);
    for (const t of fieldTiles()) take(t);
    for (const t of solidObjectTiles()) take(t);
    for (const t of yardTilesAcrossTiers()) take(t);

    const offences: string[] = [];
    for (let y = 0; y < FARM_HEIGHT; y++) {
      for (let x = 0; x < FARM_WIDTH; x++) {
        if (at(x, y) === 0) continue;
        if (taken.has(`${x},${y}`)) offences.push(`(${x},${y}) is reserved ground`);
        for (const box of BUILDING_FOOTPRINTS) {
          if (inFootprint(box, { x, y })) offences.push(`(${x},${y}) is inside a building`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  /**
   * Regenerating must not reshuffle the farm. The scatter is a pure function of
   * the tile coordinate for exactly this reason — a seeded sequence would make
   * every regeneration a several-hundred-line diff, and this file would have
   * nothing useful left to say about the map.
   */
  it('is reproducible from the tile coordinate alone', () => {
    const open: { x: number; y: number }[] = [];
    for (let y = 0; y < FARM_HEIGHT; y++) {
      for (let x = 0; x < FARM_WIDTH; x++) if (at(x, y) !== 0) open.push({ x, y });
    }

    const again = scatterTiles(open);
    // Every tile the map has scatter on must still get scatter, with the same
    // frame, when the function is asked a second time.
    expect(again).toHaveLength(open.length);
    for (const tile of again) {
      expect(fromGid(at(tile.x, tile.y))?.frame, `(${tile.x},${tile.y})`).toBe(tile.frame);
    }
  });
});
