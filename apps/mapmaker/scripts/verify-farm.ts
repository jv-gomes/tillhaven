/**
 * T-7.06 verification: farm.json actually round-trips through the mapmaker's
 * own Tiled deserializer with zero warnings, and every object/plot lands
 * where generate-farm.ts intended. Throwaway, same as generate-farm.ts.
 *
 * Run: apps/mapmaker/node_modules/.bin/tsx apps/mapmaker/scripts/verify-farm.ts
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserialize, type TiledMap } from '../src/io/tiled.js';
import { objectLayer, plotLayer } from '../src/model/doc.js';
import { fromGid } from '@tillhaven/shared/config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FILE = resolve(ROOT, 'apps/client/public/tilemaps/farm.json');

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(FILE, 'utf8')) as TiledMap;
  const { doc, warnings } = deserialize(raw);

  console.log(`warnings: ${warnings.length}`);
  for (const w of warnings) console.log(`  ! ${w}`);

  console.log(`doc size: ${doc.width}x${doc.height}`);

  const objects = objectLayer(doc);
  console.log(`objects: ${objects?.objects.length}`);
  for (const o of objects?.objects ?? []) {
    const loc = fromGid(o.gid);
    console.log(
      `  ${o.name.padEnd(14)} gid=${o.gid} key=${loc?.run.key ?? '???'} frame=${loc?.frame} px=(${o.px},${o.py}) w=${o.w} h=${o.h} tile=(${o.px / doc.tileWidth},${(o.py + o.h) / doc.tileHeight - 1})`,
    );
  }

  const plots = plotLayer(doc);
  console.log(`plots: ${plots?.cells.length}`);
  console.log(`  first ${JSON.stringify(plots?.cells[0])} last ${JSON.stringify(plots?.cells[plots.cells.length - 1])}`);

  if (warnings.length > 0) process.exitCode = 1;
}

void main();
