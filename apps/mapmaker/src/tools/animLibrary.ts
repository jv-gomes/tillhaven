/**
 * Editing the animation LIBRARY, as opposed to stamping it.
 *
 * `anim.ts` is the brush: it puts an `animId` on a cell and takes it off again.
 * This is the other half — making the thing that id names. Until now the answer
 * was "edit `GROUND_ANIMATIONS` in TypeScript and restart", which meant the
 * editor could place exactly one animation, forever, and combining frames from
 * two sheets was a code change.
 *
 * **Every function here is pure and returns a new library.** Nothing mutates in
 * place, so undo is holding on to the previous array and the panel can re-render
 * from whatever it is handed without wondering whether it is looking at state
 * that has since moved. That matters more here than it looks: an animation is an
 * ordered frame list being reordered by drag, which is precisely the shape of
 * edit where in-place mutation and a stale render disagree quietly.
 *
 * **Built-ins are not in the library, but they can be overridden into it.** They
 * live in shared TypeScript because they are derived from measured constants
 * (see `BUILTIN_GROUND_ANIMATIONS`), and the editor never rewrites that file.
 * Editing one instead adds an authored entry with the SAME id, which the merge
 * in shared config resolves in preference to the built-in — so the change
 * reaches every cell already stamped with it, and `deleteAnimation` on that
 * entry puts the original back.
 *
 * The first version of this made built-ins read-only and offered `duplicate`
 * instead. That was wrong, and the difference is the id: a duplicate is a
 * *second* water, so every cell stamped with `water-ripple` went on showing the
 * one you were trying to change.
 */

import type { AnimFrame, GroundAnimation } from '@tillhaven/shared/config';
import { ANIM_ID_PATTERN, slugifyAnimId } from '@tillhaven/shared/config';

/** The authored animations, in the order they were made. */
export type AnimLibrary = readonly GroundAnimation[];

/** What a new animation starts as, before the author touches anything. */
export const DEFAULT_NEW_FPS = 6;
const DEFAULT_NEW_NAME = 'New animation';

export function findAnimation(library: AnimLibrary, id: string): GroundAnimation | undefined {
  return library.find((a) => a.id === id);
}

/**
 * An id nothing else is using.
 *
 * Suffixes rather than rejects, because the alternative is a modal telling
 * someone their perfectly reasonable name is taken while they are three clicks
 * into building a frame list. `taken` is passed in rather than derived from the
 * library alone so built-in ids are included — an authored `water-ripple` would
 * shadow the built-in silently, and the point of shadowing being *allowed* (see
 * `mergeAnimations`) is that someone did it deliberately, not by collision.
 */
export function uniqueAnimId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugifyAnimId(base) || 'animation';
  if (!used.has(root)) return root;

  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Adds an empty animation and tells you what it was called.
 *
 * Returns the id alongside the library because the caller's next act is always
 * to select it, and re-deriving "the one that was not there before" from two
 * arrays is a diff nobody should have to write.
 */
export function createAnimation(
  library: AnimLibrary,
  taken: Iterable<string>,
  name = DEFAULT_NEW_NAME,
): { library: AnimLibrary; id: string } {
  const id = uniqueAnimId(name, taken);
  const created: GroundAnimation = { id, name, frames: [], fps: DEFAULT_NEW_FPS };
  return { library: [...library, created], id };
}

/**
 * Copies an animation, built-in or authored, into an editable one.
 *
 * This is how a built-in gets "edited": you take a copy and change that. The
 * source can therefore be any `GroundAnimation`, not just a library member.
 */
export function duplicateAnimation(
  library: AnimLibrary,
  source: GroundAnimation,
  taken: Iterable<string>,
): { library: AnimLibrary; id: string } {
  const name = `${source.name} copy`;
  const id = uniqueAnimId(name, taken);
  const copy: GroundAnimation = {
    id,
    name,
    // Frames are copied element-wise: sharing the array would make two
    // animations that reorder together, which is the bug you find last.
    frames: source.frames.map((f) => ({ ...f })),
    fps: source.fps,
  };
  return { library: [...library, copy], id };
}

/**
 * Makes a built-in editable **without changing its id**.
 *
 * This is the difference between editing the water and making a second water.
 * `duplicateAnimation` gives you a new id, so every cell already stamped with
 * `water-ripple` goes on showing the untouched original — which is not what
 * anyone means when they say they want to change it. An override keeps the id,
 * so the map follows the edit.
 *
 * It works because `mergeAnimations` in shared config resolves an id to the
 * AUTHORED entry when there is one. That rule was written for exactly this and
 * then not used: the panel refused to let anyone reach it.
 *
 * A no-op when the id is already authored, so callers can fork on every edit
 * without checking first.
 */
export function overrideAnimation(library: AnimLibrary, source: GroundAnimation): AnimLibrary {
  if (library.some((a) => a.id === source.id)) return library;
  return [
    ...library,
    {
      ...source,
      // Element-wise, for the reason `duplicateAnimation` gives: a shared frames
      // array would make the override and the built-in reorder together.
      frames: source.frames.map((f) => ({ ...f })),
    },
  ];
}

/**
 * Removes an animation.
 *
 * For an authored animation this deletes it. For an **override** it restores the
 * built-in, because the merge falls back the moment the authored entry is gone —
 * which is why the panel calls this "Reset to built-in" there. One operation,
 * two honest names.
 */
export function deleteAnimation(library: AnimLibrary, id: string): AnimLibrary {
  return library.filter((a) => a.id !== id);
}

/**
 * Replaces one animation, leaving position alone.
 *
 * Position is preserved rather than moving the edited entry to the end because
 * the dropdown is ordered by it, and a list that reshuffles when you change an
 * fps value is a list you cannot keep your place in.
 */
function replace(
  library: AnimLibrary,
  id: string,
  update: (animation: GroundAnimation) => GroundAnimation,
): AnimLibrary {
  return library.map((a) => (a.id === id ? update(a) : a));
}

export function renameAnimation(library: AnimLibrary, id: string, name: string): AnimLibrary {
  return replace(library, id, (a) => ({ ...a, name }));
}

export function setAnimationFps(library: AnimLibrary, id: string, fps: number): AnimLibrary {
  return replace(library, id, (a) => ({ ...a, fps }));
}

/**
 * Changes an animation's id, keeping the library consistent.
 *
 * **This is the one edit that can break a saved map**, because the map stores
 * the id and nothing else — renaming `puddle` to `pond` orphans every cell that
 * stamped `puddle`, and the symptom in the game is a console warning and a bare
 * patch of ground. The caller is expected to say so; this function's job is
 * only to refuse an id that is malformed or already taken, since those two are
 * corruptions rather than consequences.
 */
export function setAnimationId(
  library: AnimLibrary,
  id: string,
  nextId: string,
  taken: Iterable<string>,
): AnimLibrary | null {
  if (nextId === id) return library;
  if (!ANIM_ID_PATTERN.test(nextId)) return null;
  if (new Set(taken).has(nextId)) return null;
  return replace(library, id, (a) => ({ ...a, id: nextId }));
}

export function addFrame(library: AnimLibrary, id: string, frame: AnimFrame): AnimLibrary {
  // Appended, never deduplicated: a frame repeated in a loop is a hold, which is
  // how you make one pose linger without inventing per-frame durations.
  return replace(library, id, (a) => ({ ...a, frames: [...a.frames, { ...frame }] }));
}

export function removeFrameAt(library: AnimLibrary, id: string, index: number): AnimLibrary {
  return replace(library, id, (a) => ({
    ...a,
    frames: a.frames.filter((_, i) => i !== index),
  }));
}

/**
 * Moves a frame, taking `to` as the destination INDEX after removal.
 *
 * Spelt out because the two readings differ by one whenever you drag rightwards,
 * and "the frame lands one short of where I dropped it" is the classic symptom.
 * Out-of-range indices are a no-op rather than a throw — a drag can end anywhere,
 * including outside the strip.
 */
export function moveFrame(
  library: AnimLibrary,
  id: string,
  from: number,
  to: number,
): AnimLibrary {
  return replace(library, id, (a) => {
    if (from === to) return a;
    if (from < 0 || from >= a.frames.length) return a;
    if (to < 0 || to >= a.frames.length) return a;

    const frames = [...a.frames];
    const [moved] = frames.splice(from, 1);
    if (!moved) return a;
    frames.splice(to, 0, moved);
    return { ...a, frames };
  });
}

/** Every id in use, built-ins included, for the uniqueness checks above. */
export function takenIds(
  library: AnimLibrary,
  builtins: readonly GroundAnimation[],
): string[] {
  return [...builtins.map((a) => a.id), ...library.map((a) => a.id)];
}
