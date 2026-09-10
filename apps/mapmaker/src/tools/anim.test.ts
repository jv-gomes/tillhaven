import { describe, expect, it } from 'vitest';
import {
  BUILTIN_GROUND_ANIMATIONS,
  GROUND_ANIMATIONS,
  animationProblems,
  getGroundAnimation,
} from '@tillhaven/shared/config';
import { animLayer, createDoc, type AnimLayer, type MapDoc } from '../model/doc.js';
import { History } from '../model/history.js';
import { deserialize, serialize } from '../io/tiled.js';
import { animAt, clearAnims, renameAnimId, setAnim } from './anim.js';

/**
 * Animated ground.
 *
 * The map records WHERE an animation goes; `GROUND_ANIMATIONS` owns WHAT it is.
 * So the things that can go wrong here are about placement and about the trip
 * through the file — the frames themselves are pinned in shared config.
 */

function fixture(): { doc: MapDoc; layer: AnimLayer; history: History } {
  const doc = createDoc(10, 8);
  const layer = animLayer(doc)!;
  const history = new History(doc);
  history.begin('test');
  return { doc, layer, history };
}

const ANY = GROUND_ANIMATIONS[0]!.id;

describe('the layer', () => {
  it('exists in a fresh document', () => {
    expect(animLayer(createDoc())).toBeDefined();
    expect(animLayer(createDoc())!.cells).toEqual([]);
  });
});

describe('setAnim', () => {
  it('stamps a cell', () => {
    const { doc, layer, history } = fixture();
    expect(setAnim(doc, layer, history, 3, 4, ANY)).toBe(true);
    expect(animAt(layer, 3, 4)).toEqual({ x: 3, y: 4, animId: ANY });
  });

  /**
   * **One animation per cell.** Two would be two sprites at one depth, and
   * which you saw would come down to insertion order.
   */
  it('replaces rather than layering', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 1, 1, 'a');
    setAnim(doc, layer, history, 1, 1, 'b');

    expect(layer.cells).toHaveLength(1);
    expect(animAt(layer, 1, 1)?.animId).toBe('b');
  });

  it('clears with null', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 2, 2, ANY);
    expect(setAnim(doc, layer, history, 2, 2, null)).toBe(true);
    expect(layer.cells).toEqual([]);
  });

  /** A click that stamps what is already there should not cost an undo slot. */
  it('reports no change when nothing changed', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 5, 5, ANY);
    expect(setAnim(doc, layer, history, 5, 5, ANY)).toBe(false);
    expect(setAnim(doc, layer, history, 6, 6, null)).toBe(false);
  });

  it('refuses a cell outside the map', () => {
    const { doc, layer, history } = fixture();
    expect(setAnim(doc, layer, history, -1, 0, ANY)).toBe(false);
    expect(setAnim(doc, layer, history, 10, 0, ANY)).toBe(false);
    expect(setAnim(doc, layer, history, 0, 8, ANY)).toBe(false);
    expect(layer.cells).toEqual([]);
  });

  it('undoes and redoes as one edit', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 4, 4, ANY);
    history.commit();

    expect(history.undo()).toBe(true);
    expect(animLayer(doc)!.cells).toEqual([]);
    expect(history.redo()).toBe(true);
    expect(animLayer(doc)!.cells).toEqual([{ x: 4, y: 4, animId: ANY }]);
  });
});

describe('clearAnims', () => {
  it('empties the layer in one undoable step', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 1, 1, ANY);
    setAnim(doc, layer, history, 2, 2, ANY);
    // Its own batch: `fixture` opens one for the stamps, and undo reverts a
    // whole batch — testing the clear inside the same one would only prove that
    // undoing everything undoes everything.
    history.commit();
    history.begin('clear');
    clearAnims(layer, history);
    history.commit();

    expect(layer.cells).toEqual([]);
    history.undo();
    expect(animLayer(doc)!.cells).toHaveLength(2);
  });

  it('does nothing to an empty layer', () => {
    const { layer, history } = fixture();
    clearAnims(layer, history);
    history.commit();
    expect(history.undo(), 'an empty clear must not consume an undo slot').toBe(false);
  });
});

describe('the trip through Tiled JSON', () => {
  /**
   * **Frame ORDER is the animation**, so the thing most worth pinning is that
   * the file cannot quietly reorder it. It cannot, because the file carries
   * only an id — but that is the property, not an accident, and it is what
   * makes a two-sheet loop survive a round trip that knows nothing about
   * sheets.
   */
  it('round-trips placements', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 3, 4, ANY);
    setAnim(doc, layer, history, 7, 1, ANY);
    history.commit();

    const back = deserialize(serialize(doc)).doc;
    const cells = animLayer(back)!.cells;

    expect(cells).toHaveLength(2);
    expect(cells).toContainEqual({ x: 3, y: 4, animId: ANY });
    expect(cells).toContainEqual({ x: 7, y: 1, animId: ANY });
  });

  /**
   * The rectangles have no gid, so `y` is the TOP edge — the opposite
   * convention from a tile-object, in the same file. Getting it backwards would
   * shift every animation down by a tile, which is exactly the mistake the
   * plot layer's comment already warns about.
   */
  it('anchors the rectangles at the top edge, not the bottom', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 2, 5, ANY);
    history.commit();

    const map = serialize(doc);
    const objects = map.layers.find((l) => l.name === 'animations')!.objects!;
    expect(objects[0]!.y).toBe(5 * doc.tileHeight);
    expect(objects[0]!.gid).toBeUndefined();
  });

  it('keeps animation ids clear of plot object ids', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 0, 0, ANY);
    history.commit();

    const map = serialize(doc);
    const ids = map.layers.flatMap((l) => (l.objects ?? []).map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops a placement that names no animation rather than carrying an empty cell', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 1, 1, ANY);
    history.commit();

    const map = serialize(doc);
    const objects = map.layers.find((l) => l.name === 'animations')!.objects!;
    objects[0]!.properties = [];

    expect(animLayer(deserialize(map).doc)!.cells).toEqual([]);
  });

  it('survives a document with no animations at all', () => {
    const back = deserialize(serialize(createDoc(4, 4))).doc;
    expect(animLayer(back)).toBeDefined();
    expect(animLayer(back)!.cells).toEqual([]);
  });
});

describe('the shipped animations', () => {
  it('name frames that exist in the manifest', () => {
    for (const animation of GROUND_ANIMATIONS) {
      expect(animationProblems(animation), animation.id).toEqual([]);
    }
  });

  it('has unique ids', () => {
    const ids = GROUND_ANIMATIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds one by id, and nothing by a wrong one', () => {
    expect(getGroundAnimation(ANY)?.id).toBe(ANY);
    expect(getGroundAnimation('no-such-animation')).toBeUndefined();
  });

  /**
   * A single-frame "animation" is a static tile with a timer attached — it
   * should be painted on the ground layer instead, where it costs nothing.
   *
   * **Scoped to the BUILT-INS, and that narrowing is the point.** This was
   * written over `GROUND_ANIMATIONS` when that array was a shipped constant. It
   * now includes whatever an author has made, so the old form asserted a design
   * rule over somebody's in-progress work and failed the build the moment they
   * saved an animation mid-edit. A property of the shipped art belongs in a
   * test; a property of user data belongs in a warning the editor shows, which
   * is what `animationWarnings` does with it.
   */
  it('the built-ins have something to animate', () => {
    for (const animation of BUILTIN_GROUND_ANIMATIONS) {
      expect(animation.frames.length, animation.id).toBeGreaterThan(1);
    }
  });

  /**
   * `animationProblems` has to actually look, or the test above passes on
   * everything. Two deliberate mistakes, both of which draw as an empty tile in
   * Phaser — the worst way for an authoring error to present.
   */
  it('catches a frame outside its sheet and a sheet that does not exist', () => {
    const real = GROUND_ANIMATIONS[0]!;
    expect(
      animationProblems({ ...real, frames: [{ sheet: real.frames[0]!.sheet, frame: 999_999 }] }),
    ).not.toEqual([]);
    expect(animationProblems({ ...real, frames: [{ sheet: 'no-such-sheet', frame: 0 }] })).not.toEqual(
      [],
    );
    expect(animationProblems({ ...real, frames: [] })).not.toEqual([]);
    expect(animationProblems({ ...real, fps: 0 })).not.toEqual([]);
  });
});

/**
 * Renaming an id.
 *
 * The map stores the id and only the id, so a rename in the animation library
 * orphans every cell that stamped the old one — in the game, a console warning
 * and a bare patch of ground, a long way from the rename that caused it.
 * `renameAnimId` is what stops that for the map currently open.
 */
describe('renameAnimId', () => {
  it('repoints every cell with the old id', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 1, 1, 'old');
    setAnim(doc, layer, history, 2, 2, 'other');
    setAnim(doc, layer, history, 3, 3, 'old');

    expect(renameAnimId(layer, history, 'old', 'new')).toBe(2);
    expect(animAt(layer, 1, 1)!.animId).toBe('new');
    expect(animAt(layer, 3, 3)!.animId).toBe('new');
    expect(animAt(layer, 2, 2)!.animId).toBe('other');
  });

  it('does nothing when no cell uses the old id', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 1, 1, 'other');
    const before = layer.cells;

    expect(renameAnimId(layer, history, 'old', 'new')).toBe(0);
    expect(layer.cells).toBe(before);
  });

  it('is a no-op when the id has not changed', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 1, 1, 'same');
    expect(renameAnimId(layer, history, 'same', 'same')).toBe(0);
  });

  it('is undoable', () => {
    const { doc, layer, history } = fixture();
    setAnim(doc, layer, history, 1, 1, 'old');
    history.commit();

    history.begin('rename');
    renameAnimId(layer, history, 'old', 'new');
    history.commit();
    expect(animAt(layer, 1, 1)!.animId).toBe('new');

    history.undo();
    expect(animLayer(doc)!.cells[0]!.animId).toBe('old');
  });
});
