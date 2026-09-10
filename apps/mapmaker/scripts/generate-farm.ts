/**
 * T-7.06 — programmatic authoring of the new-pack farm map.
 * T-12.02b — re-authored at 30x22 so the Deluxe coop and barn have ground to
 * stand on. The extra land is all east (x >= 20) and south (y >= 16), which is
 * why `PLOT_POSITIONS` came out of `pnpm plots` unchanged.
 * T-15.00 — **this script is now the authority for `farm.json` (D-13)**, and no
 * longer throwaway. It gained the decorative border it could not previously
 * paint, and every layout constant moved to
 * `packages/shared/src/config/farmLayout.ts` so the client and server can read
 * them too (T-15.02).
 *
 * It builds the map through the SAME `MapDoc` + `History` +
 * `placeObject`/`togglePlot` + `serialize()` machinery the real editor uses, so
 * the output is exactly what "Save to project" would have written for these
 * clicks, not a hand-rolled JSON shape that merely looks similar.
 *
 * **Before T-15.00 this script and the committed map had silently diverged.**
 * The map carried 120 tiles of border art the script could not produce, and its
 * `plots` layer marked a field five tiles away from `PLOT_POSITIONS` — so
 * running the script flattened the border, and running `pnpm plots` would have
 * moved every plot on every farm. Both are fixed here; `farmMap.test.ts` now
 * fails if they drift again.
 *
 * Run: apps/mapmaker/node_modules/.bin/tsx apps/mapmaker/scripts/generate-farm.ts
 */

import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  animLayer,
  createDoc,
  objectLayer,
  plotLayer,
  indexOf,
  type MapDoc,
  type TileLayer,
} from '../src/model/doc.js';
import { History } from '../src/model/history.js';
import { placeObject } from '../src/tools/objects.js';
import { togglePlot } from '../src/tools/plots.js';
import { setAnim } from '../src/tools/anim.js';
import { serialize } from '../src/io/tiled.js';
import {
  BUILDING_FOOTPRINTS,
  CHEST_TILE,
  FARM_WIDTH,
  FARM_HEIGHT,
  GROUND_ANIMATIONS,
  getGroundAnimation,
  animationProblems,
  groundAnimationPlacements,
  GROUND_FILL,
  MAILBOX_TILE,
  MAPLE_TREE_FRAME,
  MERCHANT_TILE,
  OBJECT_TILES,
  SHIPPING_BOX_TILE,
  TREES,
  borderTiles,
  fieldTiles,
  inFootprint,
  scatterTiles,
  solidObjectTiles,
  yardTilesAcrossTiers,
  objectsBlockingPaths,
  pathTiles,
  toGid,
  waterTiles,
  type TilePoint,
} from '@tillhaven/shared/config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(ROOT, 'apps/client/public/tilemaps/farm.json');

function fail(message: string): never {
  console.error(`\n  generate-farm: ${message}\n`);
  process.exit(1);
}

function inRange(v: number, lo: number, hi: number): boolean {
  return v >= lo && v <= hi;
}

/**
 * Refuses to write a map where anything on the ground stands under a building.
 *
 * The buildings are NOT map objects (their crop windows are not gids — see
 * `Coop.ts`), so nothing in the map file records that their ground is taken;
 * without this check a path or a tree placed here would simply be drawn over by
 * a barn, and only at the tier that happens to reach it. `BUILDING_FOOTPRINTS`
 * is each building's LARGEST footprint, so a farm that looks fine at tier 0
 * cannot turn wrong the moment someone buys an upgrade.
 */
function assertGroundClearOfBuildings(tiles: readonly TilePoint[], what: string): void {
  for (const tile of tiles) {
    for (const box of BUILDING_FOOTPRINTS) {
      if (inFootprint(box, tile)) {
        fail(
          `${what} at (${tile.x},${tile.y}) is inside a building footprint ` +
            `(${box.x0},${box.y0})-(${box.x1},${box.y1})`,
        );
      }
    }
  }
}

/**
 * Refuses to write a map whose drawn paths are blocked by the things standing
 * on them (T-18.05, BUG-07).
 *
 * `assertGroundClearOfBuildings` above checks anchor cells against buildings,
 * which is a different question in both halves. The mailbox, the merchant's
 * stall and the shipping box were all placed deliberately ON the y=13 run so
 * the player would walk past them, and all three passed that check — then
 * Phase 15 measured their footings and made them solid, and the lane the player
 * was meant to walk became three walls. Walking west stopped at tile 6 and east
 * at tile 13, and the mailbox was unreachable along its own path.
 *
 * Footings, not anchors: the chest's 15px base straddles a tile boundary and
 * covers two cells from one anchor, so an anchor-only check can miss the cell
 * that actually does the blocking.
 */
function assertPathsClearOfObjects(): void {
  for (const { footing, tile } of objectsBlockingPaths()) {
    fail(
      `${footing.key} at (${footing.anchor.x},${footing.anchor.y}) stands on the ` +
        `drawn path at (${tile.x},${tile.y}) — its footing severs a run the ` +
        `player is meant to walk. Move it one row off the run (T-18.05).`,
    );
  }
}

function main(): void {
  const doc: MapDoc = createDoc(FARM_WIDTH, FARM_HEIGHT);
  const history = new History(doc);

  // Before anything is written: a map that puts a tree inside the barn is not
  // worth generating, and the message names the tile rather than leaving it to
  // be spotted in the browser.
  assertGroundClearOfBuildings(pathTiles(), 'path');
  assertGroundClearOfBuildings(TREES, 'tree');
  assertGroundClearOfBuildings(OBJECT_TILES, 'object');
  assertGroundClearOfBuildings(fieldTiles(), 'plot');
  assertPathsClearOfObjects();

  const ground = doc.layers.find((l): l is TileLayer => l.kind === 'tile' && l.id === 'ground');
  if (!ground) fail('no ground layer in a fresh createDoc() — model changed?');

  history.begin('paint ground');
  paintGround(doc, ground, history);
  history.commit();

  const decor = doc.layers.find((l): l is TileLayer => l.kind === 'tile' && l.id === 'decor');
  if (!decor) fail('no decor layer in a fresh createDoc()');

  history.begin('scatter');
  const scattered = paintScatter(doc, decor, history);
  history.commit();

  const objects = objectLayer(doc);
  if (!objects) fail('no object layer in a fresh createDoc()');

  history.begin('place objects');
  for (const tree of TREES) {
    placeObject(
      doc,
      objects,
      history,
      toGid('obj-maple-tree', MAPLE_TREE_FRAME),
      tree.x,
      tree.y,
      'maple-tree',
    );
  }
  placeObject(doc, objects, history, toGid('obj-mailbox', 0), MAILBOX_TILE.x, MAILBOX_TILE.y, 'mailbox');
  placeObject(
    doc,
    objects,
    history,
    toGid('obj-newsstand', 0),
    MERCHANT_TILE.x,
    MERCHANT_TILE.y,
    'merchant',
  );
  placeObject(doc, objects, history, toGid('obj-chest', 0), CHEST_TILE.x, CHEST_TILE.y, 'chest');
  placeObject(
    doc,
    objects,
    history,
    toGid('obj-shipping-box', 0),
    SHIPPING_BOX_TILE.x,
    SHIPPING_BOX_TILE.y,
    'shipping-box',
  );
  history.commit();

  const plots = plotLayer(doc);
  if (!plots) fail('no plot layer in a fresh createDoc()');

  history.begin('mark plots');
  for (const cell of fieldTiles()) {
    togglePlot(doc, plots, history, cell.x, cell.y);
  }
  history.commit();

  const expectedPlots = fieldTiles().length;
  if (plots.cells.length !== expectedPlots) {
    fail(`expected ${expectedPlots} plots, got ${plots.cells.length}`);
  }

  /*
   * Animated ground, last among the authored layers because it sits on top of
   * everything they paint.
   *
   * The frame check runs BEFORE anything is stamped: a frame outside its sheet
   * draws as an empty tile in Phaser — visible as nothing at all — so a map
   * that names one is not worth writing, and the message should say which
   * animation rather than leaving it to be spotted in the browser.
   */
  for (const animation of GROUND_ANIMATIONS) {
    const problems = animationProblems(animation);
    if (problems.length) fail(problems.join('\n  '));
  }

  const anims = animLayer(doc);
  if (!anims) fail('no animation layer in a fresh createDoc()');

  history.begin('place animations');
  for (const placement of groundAnimationPlacements()) {
    if (!getGroundAnimation(placement.animId)) {
      fail(
        `animation "${placement.animId}" at (${placement.x},${placement.y}) is not in ` +
          `GROUND_ANIMATIONS`,
      );
    }
    setAnim(doc, anims, history, placement.x, placement.y, placement.animId);
  }
  history.commit();

  const map = serialize(doc);
  const json = `${JSON.stringify(map, null, 2)}\n`;
  void writeFile(OUT, json, 'utf8').then(() => {
    console.log(`  wrote ${OUT}`);
    console.log(
      `  ${plots.cells.length} plots, ${objects.objects.length} objects, ` +
        `${scattered} scatter tiles, ${anims.cells.length} animated cells, ` +
        `${doc.width}x${doc.height} tiles`,
    );
  });
}

/**
 * Grass everywhere, water down the west edge, a path skeleton, and a fringed
 * border around the whole thing.
 *
 * **Plot cells are the TILLABLE field, neither grass nor soil.** T-9.04 stopped
 * stamping them with dry-tilled soil, because that made every plot look hoed
 * before anyone had touched a hoe — soil is SERVER state (`plots.tilled` and
 * the wet window) and the client draws it per plot on top of whatever the map
 * lays down. But grass was one step too far the other way: nothing on screen
 * said where the field was. The pack's orange band says "you can till here"
 * without claiming anything about whether it has been tilled.
 *
 * They are still painted LAST among the fills, so a plot cell always wins over a
 * path tile that would otherwise land under one.
 *
 * **The border goes last of all.** It is the map's outermost ring, and painting
 * it before the paths would let the southern path run (y=20) and the east lane
 * overwrite the fringe where they reach the edge.
 */
function paintGround(doc: MapDoc, ground: TileLayer, history: History): void {
  const grass = toGid(GROUND_FILL.grass.sheet, GROUND_FILL.grass.frame);
  const water = toGid(GROUND_FILL.water.sheet, GROUND_FILL.water.frame);
  const path = toGid(GROUND_FILL.path.sheet, GROUND_FILL.path.frame);
  const tillable = toGid(GROUND_FILL.tillable.sheet, GROUND_FILL.tillable.frame);

  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      history.setTile(ground, indexOf(doc, x, y), grass);
    }
  }

  for (const tile of waterTiles()) {
    history.setTile(ground, indexOf(doc, tile.x, tile.y), water);
  }

  for (const tile of pathTiles()) {
    history.setTile(ground, indexOf(doc, tile.x, tile.y), path);
  }

  for (const { x, y } of fieldTiles()) {
    if (!inRange(x, 0, doc.width - 1) || !inRange(y, 0, doc.height - 1)) {
      fail(`field cell (${x},${y}) is outside the ${doc.width}x${doc.height} map`);
    }
    history.setTile(ground, indexOf(doc, x, y), tillable);
  }

  for (const tile of borderTiles()) {
    history.setTile(ground, indexOf(doc, tile.x, tile.y), toGid(tile.sheet, tile.frame));
  }
}

/**
 * Refuse to run without `--force`.
 *
 * **The authored map is the source of truth now**, and this script rebuilds
 * `farm.json` from constants — so an accidental run discards every hand-painted
 * tile, every re-cut shoreline and every stamped animation in it. That is not a
 * hypothetical: it happened while this very guard was being added, because the
 * guard was appended by a script whose own assertion failed *after* the file had
 * already been imported and run. The check therefore lives at the top of the
 * module, before anything can execute.
 *
 * A flag rather than a prompt, because this is also run non-interactively and a
 * prompt that can be piped past is not a guard.
 */
if (!process.argv.includes('--force')) {
  console.error(
    'generate-farm: refusing to run.\n\n' +
      '  The authored map is the source of truth. `pnpm layout` reads farm.json\n' +
      '  INTO shared config; this script writes farm.json FROM that config, and\n' +
      '  would discard everything authored in the editor.\n\n' +
      '  Pass --force only to scaffold a fresh map from scratch.',
  );
  process.exit(1);
}

main();

/**
 * Tufts, flowers and stones over the open grass — the `decor` layer (T-18.09).
 *
 * **What counts as "open grass" is the whole of this function**, and it is
 * deliberately pessimistic on every axis:
 *
 *   - the FRAME (row 0, the last row and both edge columns), because scatter
 *     drawn into the fringe fights the fringe;
 *   - water, the shoreline column and every path tile — a tuft of grass on a
 *     gravel path reads as an authoring mistake;
 *   - the crop field, whose cells get tilled soil drawn over them at runtime;
 *   - `BUILDING_FOOTPRINTS`, the LARGEST footprint of each building rather than
 *     today's, so a flower does not appear from under a barn's eaves the moment
 *     someone upgrades it — the same argument the constant already makes;
 *   - every yard slot at every tier, for the same reason;
 *   - the measured footing of every map object and the shopkeeper's cell.
 *
 * The last three are exactly `reservedFarmTiles`' inputs, and that is not a
 * coincidence: "ground that is spoken for" is one question, asked here about
 * paint and there about placed decor.
 */
function paintScatter(doc: MapDoc, decor: TileLayer, history: History): number {
  const taken = new Set<string>();
  const take = (t: TilePoint) => taken.add(`${t.x},${t.y}`);

  for (const t of waterTiles()) take(t);
  for (const t of borderTiles()) take(t);
  for (const t of pathTiles()) take(t);
  for (const t of fieldTiles()) take(t);
  for (const t of solidObjectTiles()) take(t);
  for (const t of yardTilesAcrossTiers()) take(t);
  for (const box of BUILDING_FOOTPRINTS) {
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) take({ x, y });
    }
  }

  const open: TilePoint[] = [];
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      if (!taken.has(`${x},${y}`)) open.push({ x, y });
    }
  }

  const scattered = scatterTiles(open);
  for (const tile of scattered) {
    history.setTile(decor, indexOf(doc, tile.x, tile.y), toGid(tile.sheet, tile.frame));
  }

  return scattered.length;
}
