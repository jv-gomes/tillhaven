import { describe, expect, it } from 'vitest';
import { createDoc, objectLayer, plotLayer, type MapDoc } from '../model/doc.js';
import { History } from '../model/history.js';
import { TILESET_RUNS, toGid } from '@tillhaven/shared/config';
import { placeObject } from '../tools/objects.js';
import { togglePlot } from '../tools/plots.js';
import { PLOT_OBJECT_TYPE, deserialize, serialize } from './tiled.js';

function populated(): MapDoc {
  const doc = createDoc();
  const history = new History(doc);
  history.begin('setup');

  const ground = doc.layers[0];
  if (ground?.kind === 'tile') {
    history.setTile(ground, 0, toGid('ground-grass', 0));
    history.setTile(ground, 5, toGid('tileset-grass-spring', 41));
    history.setTile(ground, 21, toGid('ground-path', 0));
  }

  const objects = objectLayer(doc);
  if (objects) {
    placeObject(doc, objects, history, toGid('obj-maple-tree', 3), 4, 6, 'obj-maple-tree');
    placeObject(doc, objects, history, toGid('obj-tiny-house', 0), 10, 3, 'obj-tiny-house');
  }

  const plots = plotLayer(doc);
  if (plots) {
    togglePlot(doc, plots, history, 4, 6);
    togglePlot(doc, plots, history, 5, 6);
    togglePlot(doc, plots, history, 6, 6);
  }

  history.commit();
  return doc;
}

describe('serialize', () => {
  it('emits a Tiled 1.10 orthogonal map', () => {
    const map = serialize(createDoc());
    expect(map.type).toBe('map');
    expect(map.version).toBe('1.10');
    expect(map.orientation).toBe('orthogonal');
    expect(map.renderorder).toBe('right-down');
    expect(map.infinite).toBe(false);
    expect(map.tilewidth).toBe(16);
    expect(map.tileheight).toBe(16);
  });

  it('writes tile data as a plain gid array of width*height', () => {
    const doc = populated();
    const map = serialize(doc);
    const ground = map.layers.find((l) => l.type === 'tilelayer');
    expect(ground?.data).toHaveLength(doc.width * doc.height);
    expect(Array.isArray(ground?.data)).toBe(true);
    // No base64/zlib: the file has to diff line by line in git.
    expect(ground).not.toHaveProperty('encoding');
    expect(ground).not.toHaveProperty('compression');
  });

  it('embeds every manifest tileset with stable firstgids', () => {
    const a = serialize(createDoc());
    const b = serialize(populated());
    expect(a.tilesets.map((t) => t.firstgid)).toEqual(b.tilesets.map((t) => t.firstgid));
    expect(a.tilesets).toHaveLength(TILESET_RUNS.length);
    expect(a.tilesets[0]?.firstgid).toBe(1);
    for (const ts of a.tilesets) {
      expect(ts.image.startsWith('/assets/')).toBe(true);
      expect(ts.columns * ts.tilewidth).toBe(ts.imagewidth);
    }
  });

  it('anchors tile-objects to their BOTTOM edge', () => {
    const doc = populated();
    const objects = objectLayer(doc);
    const source = objects?.objects[0];
    expect(source).toBeDefined();

    const map = serialize(doc);
    const layer = map.layers.find((l) => l.type === 'objectgroup' && l.name === 'objects');
    const written = layer?.objects?.[0];
    expect(written?.y).toBe((source?.py ?? 0) + (source?.h ?? 0));
    expect(written?.x).toBe(source?.px);
    expect(written?.gid).toBe(source?.gid);
  });

  it('writes plots as gid-less rectangles anchored to their TOP edge', () => {
    const map = serialize(populated());
    const layer = map.layers.find((l) => l.name === 'plots');
    const first = layer?.objects?.[0];
    expect(first?.gid).toBeUndefined();
    expect(first?.type).toBe(PLOT_OBJECT_TYPE);
    // Plot at tile (4,6) with no gid -> top-left pixel, not bottom.
    expect(first?.x).toBe(64);
    expect(first?.y).toBe(96);
    expect(first?.properties?.find((p) => p.name === 'index')?.value).toBe(0);
  });

  it('gives plots ids that cannot collide with object ids', () => {
    const map = serialize(populated());
    const objectIds = map.layers.find((l) => l.name === 'objects')?.objects?.map((o) => o.id) ?? [];
    const plotIds = map.layers.find((l) => l.name === 'plots')?.objects?.map((o) => o.id) ?? [];
    expect(objectIds.length).toBeGreaterThan(0);
    expect(plotIds.length).toBeGreaterThan(0);
    for (const id of plotIds) expect(objectIds).not.toContain(id);
  });
});

describe('round trip', () => {
  it('restores tile layers byte for byte', () => {
    const doc = populated();
    const { doc: back } = deserialize(serialize(doc));

    expect(back.width).toBe(doc.width);
    expect(back.height).toBe(doc.height);
    expect(back.layers).toHaveLength(doc.layers.length);

    for (const [i, layer] of doc.layers.entries()) {
      const other = back.layers[i];
      expect(other?.kind).toBe(layer.kind);
      if (layer.kind === 'tile' && other?.kind === 'tile') {
        expect(Array.from(other.data)).toEqual(Array.from(layer.data));
      }
    }
  });

  it('restores object positions, undoing the bottom-edge anchoring', () => {
    const doc = populated();
    const { doc: back } = deserialize(serialize(doc));
    const before = objectLayer(doc)?.objects ?? [];
    const after = objectLayer(back)?.objects ?? [];

    expect(after).toHaveLength(before.length);
    for (const [i, object] of before.entries()) {
      expect(after[i]).toEqual(object);
    }
  });

  it('restores plots in unlock order', () => {
    const doc = populated();
    const { doc: back } = deserialize(serialize(doc));
    expect(plotLayer(back)?.cells).toEqual(plotLayer(doc)?.cells);
  });

  it('honours the stored index over array position', () => {
    // A hand-edited file may list plots in any order; the index property is the
    // authority because it is what prices the unlock.
    const map = serialize(populated());
    const plots = map.layers.find((l) => l.name === 'plots');
    if (plots?.objects) plots.objects.reverse();

    const { doc: back } = deserialize(map);
    expect(plotLayer(back)?.cells).toEqual([
      { x: 4, y: 6 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
    ]);
  });

  it('survives a JSON stringify/parse cycle, which is how it reaches disk', () => {
    const doc = populated();
    const map = JSON.parse(JSON.stringify(serialize(doc))) as ReturnType<typeof serialize>;
    const { doc: back, warnings } = deserialize(map);
    expect(warnings).toEqual([]);
    expect(plotLayer(back)?.cells).toEqual(plotLayer(doc)?.cells);
  });
});

describe('deserialize warnings', () => {
  it('reports a tileset whose firstgid no longer matches the manifest', () => {
    const map = serialize(createDoc());
    const first = map.tilesets[0];
    if (first) first.firstgid = 9999;

    const { warnings } = deserialize(map);
    expect(warnings.some((w) => w.includes('firstgid'))).toBe(true);
  });

  it('reports a tileset the manifest no longer knows about', () => {
    const map = serialize(createDoc());
    const first = map.tilesets[0];
    if (first) first.name = 'tileset-from-another-pack';

    const { warnings } = deserialize(map);
    expect(warnings.some((w) => w.includes('Unknown tileset'))).toBe(true);
  });
});
