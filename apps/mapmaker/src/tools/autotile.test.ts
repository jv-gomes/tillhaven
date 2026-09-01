import { describe, expect, it } from 'vitest';
import { createDoc, indexOf, type MapDoc, type TileLayer } from '../model/doc.js';
import { History } from '../model/history.js';
import { runByKey, TILESET_GRASS_SPRING } from '@tillhaven/shared/config';
import { SPRING_BLOCK_ROLES, type TerrainSet } from '../tilesets/terrain.js';
import { eraseTerrain, paintTerrain } from './autotile.js';

/**
 * `paintTerrain`/`eraseTerrain` need a real nine-slice 4x4-block terrain set
 * to exercise the algorithm — a flat-fill `DEFAULT_TERRAIN_SETS` entry (the
 * only kind shipped since T-7.07 deleted the old pack's `tileset-spring`,
 * see terrain.ts's module comment) has no edge/corner art to pick between.
 * This fixture reuses a real, registered manifest sheet purely for its
 * geometry, exactly like `terrain.test.ts`'s `fixtureSet` — not a claim that
 * `tileset-grass-spring.png` is actually autotile-compatible (T-7.05 found
 * it isn't).
 */
const soil: TerrainSet = {
  id: 'fixture-soil',
  name: 'fixture',
  tilesetKey: TILESET_GRASS_SPRING.key,
  block: 3,
  roles: { ...SPRING_BLOCK_ROLES },
};
const grassFixture: TerrainSet = { ...soil, id: 'fixture-grass', block: 0 };
const run = runByKey(soil.tilesetKey);

function setup(w = 8, h = 8): { doc: MapDoc; layer: TileLayer; history: History } {
  const doc = createDoc(w, h);
  const layer = doc.layers[0];
  if (layer?.kind !== 'tile') throw new Error('expected a tile layer first');
  return { doc, layer, history: new History(doc) };
}

/** Block-local index of whatever tile ended up at (x, y). */
function localAt(doc: MapDoc, layer: TileLayer, x: number, y: number): number | null {
  if (!run) return null;
  const gid = layer.data[indexOf(doc, x, y)] ?? 0;
  if (gid === 0) return null;
  const frame = gid - run.firstgid;
  const row = Math.floor(frame / run.columns);
  return (row % 4) * 4 + (frame % run.columns);
}

function paintRect(
  doc: MapDoc,
  layer: TileLayer,
  history: History,
  x0: number,
  y0: number,
  w: number,
  h: number,
): void {
  const cells: number[] = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) cells.push(indexOf(doc, x, y));
  }
  history.begin('terrain');
  paintTerrain(doc, layer, history, soil, cells);
  history.commit();
}

describe('paintTerrain', () => {
  it('picks the right nine-slice tile for every position in a block', () => {
    const { doc, layer, history } = setup();
    paintRect(doc, layer, history, 2, 2, 4, 4);

    expect(localAt(doc, layer, 2, 2)).toBe(SPRING_BLOCK_ROLES.nw);
    expect(localAt(doc, layer, 3, 2)).toBe(SPRING_BLOCK_ROLES.n);
    expect(localAt(doc, layer, 5, 2)).toBe(SPRING_BLOCK_ROLES.ne);
    expect(localAt(doc, layer, 2, 3)).toBe(SPRING_BLOCK_ROLES.w);
    expect(localAt(doc, layer, 3, 3)).toBe(SPRING_BLOCK_ROLES.c);
    expect(localAt(doc, layer, 5, 3)).toBe(SPRING_BLOCK_ROLES.e);
    expect(localAt(doc, layer, 2, 5)).toBe(SPRING_BLOCK_ROLES.sw);
    expect(localAt(doc, layer, 3, 5)).toBe(SPRING_BLOCK_ROLES.s);
    expect(localAt(doc, layer, 5, 5)).toBe(SPRING_BLOCK_ROLES.se);
  });

  it('leaves no cell of the painted region empty', () => {
    const { doc, layer, history } = setup();
    paintRect(doc, layer, history, 1, 1, 5, 5);
    for (let y = 1; y < 6; y++) {
      for (let x = 1; x < 6; x++) expect(localAt(doc, layer, x, y)).not.toBeNull();
    }
  });

  it('treats the map edge as more of the same terrain, so borders stay filled', () => {
    // Otherwise a field painted to the edge is ringed with edge tiles facing
    // off-map, which reads as a hole in the world.
    const { doc, layer, history } = setup(4, 4);
    paintRect(doc, layer, history, 0, 0, 4, 4);
    expect(localAt(doc, layer, 0, 0)).toBe(SPRING_BLOCK_ROLES.c);
    expect(localAt(doc, layer, 3, 3)).toBe(SPRING_BLOCK_ROLES.c);
  });

  it('re-resolves existing neighbours when the region grows', () => {
    const { doc, layer, history } = setup();
    paintRect(doc, layer, history, 2, 2, 2, 2);
    expect(localAt(doc, layer, 3, 2)).toBe(SPRING_BLOCK_ROLES.ne);

    // Extending to the right must turn the old NE corner into a north edge.
    paintRect(doc, layer, history, 4, 2, 2, 2);
    expect(localAt(doc, layer, 3, 2)).toBe(SPRING_BLOCK_ROLES.n);
    expect(localAt(doc, layer, 5, 2)).toBe(SPRING_BLOCK_ROLES.ne);
  });

  it('uses an inner-corner tile only where a diagonal alone is missing', () => {
    const { doc, layer, history } = setup(9, 9);
    paintRect(doc, layer, history, 1, 1, 6, 6);

    // Punch out a single cell. (4,2) keeps all four orthogonal neighbours but
    // loses its NE diagonal, which is exactly the inner-corner case.
    history.begin('erase');
    eraseTerrain(doc, layer, history, soil, [indexOf(doc, 5, 1)]);
    history.commit();

    expect(localAt(doc, layer, 4, 2)).toBe(SPRING_BLOCK_ROLES.innerNESW);

    // Cells that lose an ORTHOGONAL neighbour get ordinary edge and corner
    // tiles — inner corners must not leak into that case. (4,1) sits on the
    // region's top row and now has nothing to its east, so it is a NE corner.
    expect(localAt(doc, layer, 4, 1)).toBe(SPRING_BLOCK_ROLES.ne);
    expect(localAt(doc, layer, 5, 2)).toBe(SPRING_BLOCK_ROLES.n);
  });

  it('is one undo step per stroke', () => {
    const { doc, layer, history } = setup();
    paintRect(doc, layer, history, 2, 2, 3, 3);
    expect(layer.data.some((v) => v !== 0)).toBe(true);
    history.undo();
    expect(layer.data.every((v) => v === 0)).toBe(true);
  });
});

describe('eraseTerrain', () => {
  it('clears the cells and re-closes the edges around them', () => {
    const { doc, layer, history } = setup();
    paintRect(doc, layer, history, 1, 1, 6, 6);

    history.begin('erase');
    eraseTerrain(doc, layer, history, soil, [indexOf(doc, 1, 1)]);
    history.commit();

    expect(localAt(doc, layer, 1, 1)).toBeNull();
    // The cell to its right lost its west neighbour and becomes a west edge.
    expect(localAt(doc, layer, 2, 1)).toBe(SPRING_BLOCK_ROLES.nw);
  });

  it('does not touch tiles belonging to a different terrain', () => {
    const { doc, layer, history } = setup();
    const grass = grassFixture;

    history.begin('grass');
    paintTerrain(doc, layer, history, grass, [indexOf(doc, 0, 0)]);
    history.commit();
    const before = layer.data[indexOf(doc, 0, 0)];

    history.begin('erase soil');
    eraseTerrain(doc, layer, history, soil, [indexOf(doc, 5, 5)]);
    history.commit();

    expect(layer.data[indexOf(doc, 0, 0)]).toBe(before);
  });
});
