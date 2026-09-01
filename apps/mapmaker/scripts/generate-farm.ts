/**
 * T-7.06 — programmatic authoring of the new-pack farm map.
 * T-12.02b — re-authored at 30x22 so the Deluxe coop and barn have ground to
 * stand on. The extra land is all east (x >= 20) and south (y >= 16), which is
 * why `PLOT_POSITIONS` came out of `pnpm plots` unchanged.
 *
 * THROWAWAY, run-once script (measure-character.mjs precedent: "throwaway
 * quality is fine"). It exists because the mapmaker is a GUI and this agent
 * cannot click through one — but it builds the map through the SAME
 * `MapDoc` + `History` + `placeObject`/`togglePlot` + `serialize()` machinery
 * the real editor uses, so the output is exactly what "Save to project"
 * would have written for these clicks, not a hand-rolled JSON shape that
 * merely looks similar.
 *
 * Run: apps/mapmaker/node_modules/.bin/tsx apps/mapmaker/scripts/generate-farm.ts
 */

import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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
import { serialize } from '../src/io/tiled.js';
import {
  BUILDING_FOOTPRINTS,
  FARM_WIDTH,
  FARM_HEIGHT,
  inFootprint,
  toGid,
} from '@tillhaven/shared/config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(ROOT, 'apps/client/public/tilemaps/farm.json');

// ---- Layout constants (all in TILE coordinates) --------------------------

/** Water hugs the west edge — "water along one edge" per T-7.06. */
const WATER_COLS = [0];

/** 5 x 4 contiguous field, well clear of the water and the house's hardcoded
 *  footprint at HOUSE_TILE (6,6) in House.ts. Row-major order: array order
 *  is unlock order (plots.ts doc comment), so this also fixes which corner
 *  unlocks first — arbitrary but stable. */
const FIELD_X0 = 9;
const FIELD_Y0 = 9;
const FIELD_W = 5;
const FIELD_H = 4;

/** Path skeleton, as [x0,y0,x1,y1] runs — each is a straight line, either
 *  horizontal or vertical.
 *
 *  The first two are the original pair: one vertical spine west of the field,
 *  one horizontal spine connecting the mailbox/chest/shipping-box row to it.
 *  Deliberately routed AROUND the field (x=8, one column west of FIELD_X0)
 *  rather than through it — plot cells are painted last regardless of order
 *  (see `paintGround` below), but a path visibly crossing the crop rows would
 *  look like an authoring mistake even though nothing would break.
 *
 *  T-12.02b extended the horizontal spine east to x=20 and hung two new runs
 *  off it: a north-south lane at x=20 serving the coop and the barn (x=20 is
 *  the column between them and the rest of the farm — `COOP_FOOTPRINT` and
 *  `BARN_FOOTPRINT` both start at x=21), and a southern run along y=20 under
 *  the new cow pasture. `assertPathsClearOfBuildings` below refuses to write a
 *  map where any of them runs under a building at any tier. */
const PATHS: readonly (readonly [number, number, number, number])[] = [
  // West-of-field spine. Starts at y=6, one row below the house rather than
  // at the map's north edge: it ran y=1..13 until T-12.02b, which put its top
  // five tiles *underneath* the house (footprint (6,3)-(8,5)) where the
  // building simply drew over them. Nothing was visibly wrong, which is why it
  // survived three tasks — `assertGroundClearOfBuildings` is what found it.
  // Starting below the front door also makes it the walk it was meant to be.
  [8, 6, 8, 13],
  [3, 13, 20, 13], // mailbox → merchant → chest → shipping box → east lane
  [20, 4, 20, 20], // east lane, past the coop and the barn
  [2, 20, 20, 20], // southern run below the cow pasture
];

const MAILBOX_TILE = { x: 3, y: 13 };
/**
 * The merchant's stall (T-11.04), on the horizontal path between the mailbox
 * and the field so it is passed on the way to and from the crops. Two tiles
 * wide and three tall anchored on its bottom edge, so it covers x 5-6, y 11-13
 * — clear of the mailbox at x=3, the path spine at x=8, and the field at x>=9.
 */
const MERCHANT_TILE = { x: 5, y: 13 };
const CHEST_TILE = { x: 8, y: 10 };
const SHIPPING_BOX_TILE = { x: 14, y: 13 };

/** Frame 2 of obj-maple-tree: a full mature green tree with its ground
 *  shadow (row 0, col 2 — picked by rendering a magenta grid overlay over
 *  the sheet and reading it, see the T-7.06 write-up). */
const MAPLE_TREE_FRAME = 2;
const TREES = [
  { x: 3, y: 2 },
  { x: 16, y: 3 },
  { x: 17, y: 11 },
  // T-12.02b: two in the new southern land, so it does not read as a blank
  // green rectangle. Clear of the cow row (y=18) and both new path runs.
  { x: 2, y: 17 },
  { x: 17, y: 17 },
];

function fail(message: string): never {
  console.error(`\n  generate-farm: ${message}\n`);
  process.exit(1);
}

function inRange(v: number, lo: number, hi: number): boolean {
  return v >= lo && v <= hi;
}

/** Every cell of the crop field, in unlock order. */
function fieldTiles(): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];

  for (let row = 0; row < FIELD_H; row++) {
    for (let col = 0; col < FIELD_W; col++) {
      tiles.push({ x: FIELD_X0 + col, y: FIELD_Y0 + row });
    }
  }

  return tiles;
}

/** Every tile of every path run, expanded. */
function pathTiles(): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];

  for (const [x0, y0, x1, y1] of PATHS) {
    if (x0 !== x1 && y0 !== y1) fail(`path run ${x0},${y0}-${x1},${y1} is neither H nor V`);
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        tiles.push({ x, y });
      }
    }
  }

  return tiles;
}

/**
 * Refuses to write a map where anything on the ground stands under a building.
 *
 * The buildings are NOT map objects (their crop windows are not gids — see
 * `Coop.ts`), so nothing in the map file records that their ground is taken;
 * without this check a path or a tree placed here would simply be drawn over
 * by a barn, and only at the tier that happens to reach it. `BUILDING_FOOTPRINTS`
 * is each building's LARGEST footprint, so a farm that looks fine at tier 0
 * cannot turn wrong the moment someone buys an upgrade.
 */
function assertGroundClearOfBuildings(tiles: readonly { x: number; y: number }[], what: string): void {
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

function main(): void {
  const doc: MapDoc = createDoc(FARM_WIDTH, FARM_HEIGHT);
  const history = new History(doc);

  // Before anything is written: a map that puts a tree inside the barn is not
  // worth generating, and the message names the tile rather than leaving it to
  // be spotted in the browser.
  assertGroundClearOfBuildings(pathTiles(), 'path');
  assertGroundClearOfBuildings(TREES, 'tree');
  assertGroundClearOfBuildings(
    [MAILBOX_TILE, MERCHANT_TILE, CHEST_TILE, SHIPPING_BOX_TILE],
    'object',
  );
  assertGroundClearOfBuildings(fieldTiles(), 'plot');

  const ground = doc.layers.find((l): l is TileLayer => l.kind === 'tile' && l.id === 'ground');
  if (!ground) fail('no ground layer in a fresh createDoc() — model changed?');

  history.begin('paint ground');
  paintGround(doc, ground, history);
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

  if (plots.cells.length !== FIELD_W * FIELD_H) {
    fail(`expected ${FIELD_W * FIELD_H} plots, got ${plots.cells.length}`);
  }

  const map = serialize(doc);
  const json = `${JSON.stringify(map, null, 2)}\n`;
  void writeFile(OUT, json, 'utf8').then(() => {
    console.log(`  wrote ${OUT}`);
    console.log(`  ${plots.cells.length} plots, ${objects.objects.length} objects, ${doc.width}x${doc.height} tiles`);
  });
}

/**
 * Grass everywhere, water down the west edge, and a path skeleton.
 *
 * **Plot cells are grass, not soil** (changed in T-9.04). They were stamped
 * with dry-tilled soil here, which made every plot look hoed before anyone had
 * touched a hoe; soil is SERVER state now — `plots.tilled` and the wet window —
 * and the client draws it per plot on top of whatever the map lays down. Two
 * sources for the same pixel is one too many, and the map's copy was the one
 * that could not be right.
 *
 * They are still painted LAST, so a plot cell always wins over a path tile that
 * would otherwise land under one.
 */
function paintGround(doc: MapDoc, ground: TileLayer, history: History): void {
  const grass = toGid('ground-grass', 0);
  const water = toGid('water-tile', 0);
  const path = toGid('ground-path', 0);

  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      history.setTile(ground, indexOf(doc, x, y), grass);
    }
  }

  for (let y = 0; y < doc.height; y++) {
    for (const x of WATER_COLS) {
      history.setTile(ground, indexOf(doc, x, y), water);
    }
  }

  for (const tile of pathTiles()) {
    history.setTile(ground, indexOf(doc, tile.x, tile.y), path);
  }

  for (const { x, y } of fieldTiles()) {
    if (!inRange(x, 0, doc.width - 1) || !inRange(y, 0, doc.height - 1)) {
      fail(`field cell (${x},${y}) is outside the ${doc.width}x${doc.height} map`);
    }
    history.setTile(ground, indexOf(doc, x, y), grass);
  }
}

main();
