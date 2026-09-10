import { describe, expect, it } from 'vitest';
import type { GroundAnimation } from '@tillhaven/shared/config';
import { BUILTIN_GROUND_ANIMATIONS, animationProblems, libraryProblems } from '@tillhaven/shared/config';
import {
  DEFAULT_NEW_FPS,
  addFrame,
  createAnimation,
  deleteAnimation,
  duplicateAnimation,
  findAnimation,
  moveFrame,
  overrideAnimation,
  removeFrameAt,
  renameAnimation,
  setAnimationFps,
  setAnimationId,
  takenIds,
  uniqueAnimId,
  type AnimLibrary,
} from './animLibrary.js';

const SHEET = 'tileset-water-anim';

function anim(id: string, frames: number[], fps = 4): GroundAnimation {
  return { id, name: id, fps, frames: frames.map((frame) => ({ sheet: SHEET, frame })) };
}

describe('uniqueAnimId', () => {
  it('slugifies a display name', () => {
    expect(uniqueAnimId('Rippling Water', [])).toBe('rippling-water');
  });

  it('suffixes rather than rejecting a taken id', () => {
    expect(uniqueAnimId('Fountain', ['fountain'])).toBe('fountain-2');
    expect(uniqueAnimId('Fountain', ['fountain', 'fountain-2'])).toBe('fountain-3');
  });

  it('falls back when a name slugs to nothing', () => {
    expect(uniqueAnimId('!!!', [])).toBe('animation');
  });

  it('never collides with a built-in', () => {
    const taken = takenIds([], BUILTIN_GROUND_ANIMATIONS);
    expect(uniqueAnimId('Rippling water', taken)).not.toBe('water-ripple');
  });
});

describe('createAnimation', () => {
  it('adds an empty animation and names it', () => {
    const { library, id } = createAnimation([], [], 'Fountain');
    expect(id).toBe('fountain');
    expect(library).toHaveLength(1);
    expect(findAnimation(library, id)).toEqual({
      id: 'fountain',
      name: 'Fountain',
      frames: [],
      fps: DEFAULT_NEW_FPS,
    });
  });

  it('leaves the input library untouched', () => {
    const before: AnimLibrary = [anim('a', [0])];
    createAnimation(before, ['a'], 'B');
    expect(before).toHaveLength(1);
  });
});

describe('duplicateAnimation', () => {
  it('copies a built-in into an editable entry', () => {
    const source = BUILTIN_GROUND_ANIMATIONS[0]!;
    const { library, id } = duplicateAnimation([], source, takenIds([], BUILTIN_GROUND_ANIMATIONS));

    const copy = findAnimation(library, id)!;
    expect(copy.id).not.toBe(source.id);
    expect(copy.fps).toBe(source.fps);
    expect(copy.frames).toEqual(source.frames);
  });

  /**
   * The bug this is here for: a shallow copy shares the frames array, so
   * reordering one animation reorders the other, and it looks like the editor
   * randomly corrupted an animation you were not editing.
   */
  it('copies frames element-wise, so reordering the copy leaves the source alone', () => {
    const source = anim('src', [0, 1, 2]);
    const { library, id } = duplicateAnimation([source], source, ['src']);
    const moved = moveFrame(library, id, 0, 2);

    expect(findAnimation(moved, id)!.frames.map((f) => f.frame)).toEqual([1, 2, 0]);
    expect(source.frames.map((f) => f.frame)).toEqual([0, 1, 2]);
  });
});

describe('frame edits', () => {
  const library: AnimLibrary = [anim('a', [0, 1, 2])];

  it('appends a frame', () => {
    const next = addFrame(library, 'a', { sheet: 'tileset-soil', frame: 7 });
    expect(findAnimation(next, 'a')!.frames).toHaveLength(4);
    expect(findAnimation(next, 'a')!.frames[3]).toEqual({ sheet: 'tileset-soil', frame: 7 });
  });

  it('allows a repeated frame, because a repeat is a hold', () => {
    const next = addFrame(library, 'a', { sheet: SHEET, frame: 0 });
    expect(findAnimation(next, 'a')!.frames.map((f) => f.frame)).toEqual([0, 1, 2, 0]);
  });

  it('removes by index', () => {
    expect(findAnimation(removeFrameAt(library, 'a', 1), 'a')!.frames.map((f) => f.frame)).toEqual([
      0, 2,
    ]);
  });

  /**
   * `to` is the destination index AFTER removal. The two readings differ by one
   * whenever you drag rightwards, and the classic symptom is a frame landing one
   * short of where it was dropped.
   */
  it('moves a frame rightwards to the index it was dropped on', () => {
    expect(findAnimation(moveFrame(library, 'a', 0, 2), 'a')!.frames.map((f) => f.frame)).toEqual([
      1, 2, 0,
    ]);
  });

  it('moves a frame leftwards', () => {
    expect(findAnimation(moveFrame(library, 'a', 2, 0), 'a')!.frames.map((f) => f.frame)).toEqual([
      2, 0, 1,
    ]);
  });

  it('ignores an out-of-range drop rather than throwing', () => {
    expect(findAnimation(moveFrame(library, 'a', 0, 9), 'a')!.frames.map((f) => f.frame)).toEqual([
      0, 1, 2,
    ]);
    expect(findAnimation(moveFrame(library, 'a', -1, 0), 'a')!.frames.map((f) => f.frame)).toEqual([
      0, 1, 2,
    ]);
  });

  it('leaves other animations alone', () => {
    const two: AnimLibrary = [anim('a', [0]), anim('b', [5])];
    const next = addFrame(two, 'a', { sheet: SHEET, frame: 9 });
    expect(findAnimation(next, 'b')!.frames.map((f) => f.frame)).toEqual([5]);
  });
});

describe('setAnimationId', () => {
  const library: AnimLibrary = [anim('a', [0]), anim('b', [1])];

  it('renames', () => {
    const next = setAnimationId(library, 'a', 'pond', ['a', 'b'])!;
    expect(findAnimation(next, 'pond')).toBeDefined();
    expect(findAnimation(next, 'a')).toBeUndefined();
  });

  it('keeps the entry in place, so the dropdown does not reshuffle', () => {
    const next = setAnimationId(library, 'a', 'pond', ['a', 'b'])!;
    expect(next.map((x) => x.id)).toEqual(['pond', 'b']);
  });

  it('refuses a taken id', () => {
    expect(setAnimationId(library, 'a', 'b', ['a', 'b'])).toBeNull();
  });

  it('refuses a malformed id', () => {
    for (const bad of ['Pond', 'pond water', '-pond', 'pond-', 'pond--water', '']) {
      expect(setAnimationId(library, 'a', bad, ['a', 'b'])).toBeNull();
    }
  });

  it('is a no-op for the id it already has', () => {
    expect(setAnimationId(library, 'a', 'a', ['a', 'b'])).toBe(library);
  });
});

describe('rename and fps', () => {
  const library: AnimLibrary = [anim('a', [0])];

  it('changes the display name without touching the id', () => {
    const next = renameAnimation(library, 'a', 'Bubbling');
    expect(findAnimation(next, 'a')!.name).toBe('Bubbling');
    expect(findAnimation(next, 'a')!.id).toBe('a');
  });

  it('changes the rate', () => {
    expect(findAnimation(setAnimationFps(library, 'a', 12), 'a')!.fps).toBe(12);
  });
});

describe('deleteAnimation', () => {
  it('removes only the named entry', () => {
    const library: AnimLibrary = [anim('a', [0]), anim('b', [1])];
    expect(deleteAnimation(library, 'a').map((x) => x.id)).toEqual(['b']);
  });
});

/**
 * The editor must not be able to build something the save endpoint will refuse
 * — a panel that says "saved" for everything except the one thing you made is
 * worse than one that never worked.
 */
describe('what the editor can build is what shared config accepts', () => {
  it('a fresh animation is invalid only because it has no frames yet', () => {
    const { library, id } = createAnimation([], [], 'Fountain');
    expect(animationProblems(findAnimation(library, id)!)).toEqual(['fountain: no frames']);
  });

  it('a named animation with one real frame passes', () => {
    const { library, id } = createAnimation([], [], 'Fountain');
    const withFrame = addFrame(library, id, { sheet: SHEET, frame: 42 });
    expect(libraryProblems(withFrame)).toEqual([]);
  });

  it('ids created here always match the shared pattern', () => {
    const names = ['Fountain', 'Waving Grass', 'Água fresca', '  spaced  out  ', '42'];
    let library: AnimLibrary = [];
    for (const name of names) {
      const created = createAnimation(library, takenIds(library, BUILTIN_GROUND_ANIMATIONS), name);
      library = addFrame(created.library, created.id, { sheet: SHEET, frame: 0 });
    }
    expect(libraryProblems(library)).toEqual([]);
    expect(library.map((a) => a.id)).toEqual([
      'fountain',
      'waving-grass',
      'agua-fresca',
      'spaced-out',
      '42',
    ]);
  });
});

/**
 * Overriding a built-in.
 *
 * **The difference between editing the water and making a second water is the
 * id.** Built-ins were read-only at first, with `duplicate` offered instead —
 * and a duplicate has a NEW id, so every cell already stamped with
 * `water-ripple` went on showing the animation you were trying to change. An
 * override keeps the id, and `mergeAnimations` in shared config resolves it in
 * preference to the built-in.
 */
describe('overrideAnimation', () => {
  const builtin = BUILTIN_GROUND_ANIMATIONS[0]!;

  it('keeps the id, unlike duplicate', () => {
    const overridden = overrideAnimation([], builtin);
    expect(overridden).toHaveLength(1);
    expect(overridden[0]!.id).toBe(builtin.id);

    const { id: copyId } = duplicateAnimation([], builtin, [builtin.id]);
    expect(copyId).not.toBe(builtin.id);
  });

  it('copies the built-in exactly, so the first edit changes nothing else', () => {
    const copy = overrideAnimation([], builtin)[0]!;
    expect(copy.name).toBe(builtin.name);
    expect(copy.fps).toBe(builtin.fps);
    expect(copy.frames).toEqual(builtin.frames);
  });

  it('copies frames element-wise, so editing the override leaves the built-in alone', () => {
    const library = overrideAnimation([], builtin);
    const moved = moveFrame(library, builtin.id, 0, builtin.frames.length - 1);
    expect(findAnimation(moved, builtin.id)!.frames).not.toEqual(builtin.frames);
    expect(BUILTIN_GROUND_ANIMATIONS[0]!.frames).toEqual(builtin.frames);
  });

  /**
   * Every mutating handler calls this before editing, so it has to be safe to
   * call on something already overridden — otherwise the second keystroke in
   * the fps field would throw away the first.
   */
  it('is a no-op once the id is already authored', () => {
    const once = overrideAnimation([], builtin);
    const edited = setAnimationFps(once, builtin.id, 9);
    const twice = overrideAnimation(edited, builtin);
    expect(twice).toBe(edited);
    expect(findAnimation(twice, builtin.id)!.fps).toBe(9);
  });

  it('leaves an authored animation of the same name alone', () => {
    const existing: AnimLibrary = [anim('other', [0])];
    const next = overrideAnimation(existing, builtin);
    expect(next).toHaveLength(2);
    expect(findAnimation(next, 'other')).toBeDefined();
  });

  /** Deleting an override is how you get the built-in back — the merge falls
   *  back the moment the authored entry is gone. */
  it('is undone by deleteAnimation, which is what "reset" means', () => {
    const library = setAnimationFps(overrideAnimation([], builtin), builtin.id, 30);
    expect(findAnimation(library, builtin.id)!.fps).toBe(30);
    expect(deleteAnimation(library, builtin.id)).toEqual([]);
  });

  it('produces a library shared config still accepts', () => {
    const library = setAnimationFps(overrideAnimation([], builtin), builtin.id, 8);
    expect(libraryProblems(library)).toEqual([]);
  });
});
