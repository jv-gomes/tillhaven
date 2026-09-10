import { describe, expect, it } from 'vitest';
import {
  ANIMATED_SHEETS,
  ANIM_ID_PATTERN,
  SEA_ANIMATION_ID,
  animatedSheet,
  sheetAnimationFrames,
  AUTHORED_GROUND_ANIMATIONS,
  BUILTIN_GROUND_ANIMATIONS,
  GROUND_ANIMATIONS,
  MAX_ANIM_FPS,
  animationProblems,
  animationWarnings,
  getGroundAnimation,
  isBuiltinAnimationId,
  libraryProblems,
  slugifyAnimId,
  type GroundAnimation,
} from './groundAnim.js';
import {
  TILESET_GRASS_WATER_SPRING,
  TILESET_SOIL,
  TILESET_WATER_ANIM,
  WATER_ANIM_FPS,
  WATER_ANIM_FRAMES,
} from './assets.js';
import { runByKey } from './tilesets.js';

const SHEET = TILESET_WATER_ANIM.key;

function anim(over: Partial<GroundAnimation> = {}): GroundAnimation {
  return {
    id: 'test',
    name: 'Test',
    fps: 4,
    frames: [{ sheet: SHEET, frame: 0 }],
    ...over,
  };
}

describe('the shipped library', () => {
  it('has no problems', () => {
    expect(libraryProblems(GROUND_ANIMATIONS)).toEqual([]);
  });

  it('contains every built-in and every authored animation', () => {
    for (const a of BUILTIN_GROUND_ANIMATIONS) expect(getGroundAnimation(a.id)).toBeDefined();
    for (const a of AUTHORED_GROUND_ANIMATIONS) expect(getGroundAnimation(a.id)).toBeDefined();
  });

  it('knows which ids are built-in', () => {
    expect(isBuiltinAnimationId('water-ripple')).toBe(true);
    expect(isBuiltinAnimationId('nothing-like-this')).toBe(false);
  });
});

/**
 * The merge is the part that can go quietly wrong: an authored entry sharing an
 * id with a built-in must WIN, or somebody retimes the water in the editor,
 * saves, sees no change, and has nothing anywhere telling them why.
 */
describe('built-ins and authored entries merge', () => {
  it('resolves every id to exactly one animation', () => {
    const ids = GROUND_ANIMATIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists built-ins before authored ones, so the dropdown is stable', () => {
    const builtinCount = BUILTIN_GROUND_ANIMATIONS.filter(
      (b) => !AUTHORED_GROUND_ANIMATIONS.some((a) => a.id === b.id),
    ).length;
    expect(GROUND_ANIMATIONS.slice(0, builtinCount).every((a) => isBuiltinAnimationId(a.id))).toBe(
      true,
    );
  });
});

describe('animationProblems', () => {
  it('accepts a well-formed animation', () => {
    expect(animationProblems(anim())).toEqual([]);
  });

  it('rejects an empty frame list', () => {
    expect(animationProblems(anim({ frames: [] }))).toContain('test: no frames');
  });

  it('rejects a frame outside its sheet', () => {
    const problems = animationProblems(anim({ frames: [{ sheet: SHEET, frame: 999_999 }] }));
    expect(problems.join(' ')).toContain('is outside');
  });

  it('rejects a sheet that is not in the manifest', () => {
    const problems = animationProblems(anim({ frames: [{ sheet: 'not-a-sheet', frame: 0 }] }));
    expect(problems.join(' ')).toContain('no tileset');
  });

  it('rejects a non-positive rate', () => {
    expect(animationProblems(anim({ fps: 0 })).join(' ')).toContain('must be positive');
    expect(animationProblems(anim({ fps: -1 })).join(' ')).toContain('must be positive');
  });

  /**
   * The ceiling exists for the slipped decimal point and for an fps field that
   * was filled in with a millisecond delay — both schedule a timer every
   * couple of milliseconds across every placement on the map.
   */
  it('rejects an absurd rate', () => {
    expect(animationProblems(anim({ fps: MAX_ANIM_FPS + 1 })).join(' ')).toContain('at most');
    expect(animationProblems(anim({ fps: 600 })).join(' ')).toContain('at most');
  });

  it('rejects a malformed id', () => {
    for (const id of ['Test', 'two words', '-lead', 'trail-', 'double--dash', '']) {
      expect(animationProblems(anim({ id })).join(' ')).toContain('id must match');
    }
  });

  it('rejects an empty name', () => {
    expect(animationProblems(anim({ name: '   ' })).join(' ')).toContain('name is empty');
  });
});

describe('libraryProblems', () => {
  it('catches a duplicate id, which a single-entry check cannot see', () => {
    const problems = libraryProblems([anim({ id: 'dup' }), anim({ id: 'dup' })]);
    expect(problems).toContain('duplicate id "dup"');
  });

  it('reports every entry, not just the first bad one', () => {
    const problems = libraryProblems([anim({ id: 'a', frames: [] }), anim({ id: 'b', fps: 0 })]);
    expect(problems).toHaveLength(2);
  });
});

/**
 * Mixed sizes are legal — the scene draws every frame from the cell's top-left
 * corner, so a taller frame bleeds down and right, which is how you animate
 * something standing proud of its tile. It is also what clicking the wrong sheet
 * looks like, so it is a warning rather than a refusal.
 */
describe('animationWarnings', () => {
  it('says nothing about a single-sheet animation', () => {
    // Two frames: one frame is its own warning, tested below.
    const twoFrames = anim({
      frames: [
        { sheet: SHEET, frame: 42 },
        { sheet: SHEET, frame: 138 },
      ],
    });
    expect(animationWarnings(twoFrames)).toEqual([]);
  });

  /**
   * A single-frame "animation" is a static tile with a timer attached. A
   * WARNING rather than a problem: it is the legitimate state of every animation
   * just after the first Add frame, and refusing to save it would mean an author
   * could not stop halfway.
   */
  it('flags a one-frame animation without making it invalid', () => {
    const one = anim();
    expect(animationWarnings(one).join(' ')).toContain('static tile');
    expect(animationProblems(one)).toEqual([]);
  });

  it('flags frames of different sizes without making them invalid', () => {
    const mixed = anim({
      frames: [
        { sheet: SHEET, frame: 0 },
        { sheet: TILESET_SOIL.key, frame: 0 },
      ],
    });
    const warnings = animationWarnings(mixed);
    // Only meaningful if the two sheets really do differ; if the pack ever makes
    // them equal this asserts nothing and the `animationProblems` check below is
    // what still matters.
    if (warnings.length > 0) expect(warnings[0]).toContain('different sizes');
    expect(animationProblems(mixed)).toEqual([]);
  });
});

describe('slugifyAnimId', () => {
  it('produces ids that match the pattern', () => {
    for (const name of ['Fountain', 'Waving Grass', 'Água fresca', '  spaced  out  ', 'a/b&c']) {
      expect(ANIM_ID_PATTERN.test(slugifyAnimId(name))).toBe(true);
    }
  });

  it('strips accents rather than dropping the letter', () => {
    expect(slugifyAnimId('Água fresca')).toBe('agua-fresca');
  });

  it('returns empty for a name with nothing usable in it', () => {
    expect(slugifyAnimId('!!!')).toBe('');
    expect(slugifyAnimId('   ')).toBe('');
  });
});

/**
 * Animated SHEETS — a different mechanism from the placed animations above.
 *
 * These sheets hold their frames as repeated blocks, so a painted tile is
 * already frame 1 of a loop and the rest are a fixed offset away. Both entries
 * were measured by cropping every cell and comparing it against its counterpart
 * one step along; the numbers here are that measurement, and the tests exist so
 * a manifest edit that moves a sheet cannot quietly invalidate it.
 */
describe('animated sheets', () => {
  it('names sheets that are in the manifest', () => {
    for (const spec of ANIMATED_SHEETS) {
      expect(runByKey(spec.sheet), spec.sheet).toBeDefined();
    }
  });

  it('has a positive rate and more than one frame', () => {
    for (const spec of ANIMATED_SHEETS) {
      expect(spec.frames, spec.sheet).toBeGreaterThan(1);
      expect(spec.fps, spec.sheet).toBeGreaterThan(0);
    }
  });

  it('recognises the shoreline sheet, stepping 12 columns', () => {
    // The user-facing case: a shore tile painted at col 8, row 1.
    expect(sheetAnimationFrames(TILESET_GRASS_WATER_SPRING.key, 56)).toEqual([56, 68, 80, 92]);
  });

  it('recognises the open-water sheet, stepping 4 rows', () => {
    // The same four frames `WATER_ANIM_FRAMES` names for the backdrop, now
    // derived from the base rather than written down.
    expect(sheetAnimationFrames(TILESET_WATER_ANIM.key, WATER_ANIM_FRAMES[0]!)).toEqual([
      ...WATER_ANIM_FRAMES,
    ]);
  });

  /**
   * The renderer must not change what the author placed: a paused game has to
   * match the map file, whichever block the tile came from.
   */
  it('starts every cycle at the painted tile, so a still map looks unchanged', () => {
    for (const spec of ANIMATED_SHEETS) {
      const run = runByKey(spec.sheet)!;
      for (let frame = 0; frame < run.tileCount; frame++) {
        const cycle = sheetAnimationFrames(spec.sheet, frame);
        if (cycle) expect(cycle[0], `${spec.sheet} ${frame}`).toBe(frame);
      }
    }
  });

  /**
   * The bug a flat "+n frames" offset would have: `tileset-grass-water-spring`
   * frame 44 is the LAST column of row 0, and +12 lands on row 1 column 8 — a
   * real tile, and the wrong one. Expressed as dx/dy the bound is checkable.
   */
  it('never lets a cycle wrap onto the next row', () => {
    const cycle = sheetAnimationFrames(TILESET_GRASS_WATER_SPRING.key, 44)!;
    expect(cycle).not.toBeNull();
    // Frame 44 is col 44 — block 3, the last frame — so the cycle winds back to
    // col 8 and rotates to start where it was painted.
    expect(cycle).toEqual([44, 8, 20, 32]);
    expect(cycle.every((f) => Math.floor(f / 48) === 0)).toBe(true);
  });

  /**
   * **A tile in a later block is a PHASE, not a mistake.** The first version
   * refused these, and the map disproved it: the farm's top row was painted from
   * block 1 and 28 tiles of shore sat frozen while the other 92 moved. Nothing
   * was wrong with them — block 2 of a four-block sheet is the same art at frame
   * 2 of the same loop.
   */
  it('animates a tile painted out of a later block, rotated to it', () => {
    // Block 1 of the loop whose base is col 8 — the left shore column's art.
    expect(sheetAnimationFrames(TILESET_GRASS_WATER_SPRING.key, 20)).toEqual([20, 32, 44, 8]);
    // The same loop, whichever block you enter it from.
    for (const start of [8, 20, 32, 44]) {
      const cycle = sheetAnimationFrames(TILESET_GRASS_WATER_SPRING.key, start)!;
      expect(new Set(cycle)).toEqual(new Set([8, 20, 32, 44]));
      expect(cycle[0]).toBe(start);
    }
  });

  /**
   * **The layout is animated; not every cell in it is.** This is the measurement
   * that explains the farm's top row: it was painted with col 10 of the
   * shoreline sheet, which is byte-identical in all four blocks. The mechanism
   * was working perfectly and the art had nothing to show — so the answer is to
   * say so, not to cycle four copies of the same image.
   */
  it('refuses cells whose art is identical in every block', () => {
    // The exact tile farm.json paints across its top row.
    expect(sheetAnimationFrames(TILESET_GRASS_WATER_SPRING.key, 22)).toBeNull();
    // And its counterparts in the other three blocks.
    for (const f of [10, 22, 34, 46]) {
      expect(sheetAnimationFrames(TILESET_GRASS_WATER_SPRING.key, f), `frame ${f}`).toBeNull();
    }
    // The flat `#0092dd` fill `WATER_ANIM_FRAMES` records picking *against*.
    expect(sheetAnimationFrames(TILESET_WATER_ANIM.key, 57)).toBeNull();
  });

  it('lists static frames in every block, not just the first', () => {
    for (const spec of ANIMATED_SHEETS) {
      const run = runByKey(spec.sheet)!;
      for (const frame of spec.staticFrames) {
        expect(frame, spec.sheet).toBeGreaterThanOrEqual(0);
        expect(frame, spec.sheet).toBeLessThan(run.tileCount);
      }
      // One base cell contributes all `frames` of its copies.
      expect(spec.staticFrames.size % spec.frames, spec.sheet).toBe(0);
    }
  });

  it('rotates the open-water sheet the same way', () => {
    const [f0, f1, f2, f3] = WATER_ANIM_FRAMES as [number, number, number, number];
    expect(sheetAnimationFrames(TILESET_WATER_ANIM.key, f1)).toEqual([f1, f2, f3, f0]);
  });

  it('refuses a sheet that does not animate, and a frame that does not exist', () => {
    expect(sheetAnimationFrames('tileset-grass-spring', 57)).toBeNull();
    expect(sheetAnimationFrames('not-a-sheet', 0)).toBeNull();
    expect(sheetAnimationFrames(TILESET_WATER_ANIM.key, -1)).toBeNull();
    expect(sheetAnimationFrames(TILESET_WATER_ANIM.key, 999_999)).toBeNull();
  });

  /**
   * Every frame the cycle names has to be a real cell, on every base the sheet
   * accepts. A step that ran off the end would draw whatever is past it, which
   * in a tileset is another tile — silently wrong art rather than a blank.
   */
  it('every cycle it accepts lands inside the sheet', () => {
    for (const spec of ANIMATED_SHEETS) {
      const run = runByKey(spec.sheet)!;
      let accepted = 0;
      for (let frame = 0; frame < run.tileCount; frame++) {
        const cycle = sheetAnimationFrames(spec.sheet, frame);
        if (!cycle) continue;
        accepted += 1;
        expect(cycle).toHaveLength(spec.frames);
        for (const f of cycle) {
          expect(f, `${spec.sheet} base ${frame}`).toBeGreaterThanOrEqual(0);
          expect(f, `${spec.sheet} base ${frame}`).toBeLessThan(run.tileCount);
        }
        // No cell may appear twice — that would mean the step is wrong and the
        // loop is showing the same art at two points in the cycle.
        expect(new Set(cycle).size, `${spec.sheet} base ${frame}`).toBe(spec.frames);
      }
      // Every tile in the sheet animates except the ones the art leaves still:
      // a later block is a phase, not a rejection.
      expect(accepted, spec.sheet).toBe(run.tileCount - spec.staticFrames.size);
    }
  });

  it('agrees with the backdrop constant it generalises', () => {
    const spec = animatedSheet(TILESET_WATER_ANIM.key)!;
    expect(spec.frames).toBe(WATER_ANIM_FRAMES.length);
    expect(spec.fps).toBe(WATER_ANIM_FPS);
  });
});

/**
 * The sea.
 *
 * **`Farm.createWater` resolves this id rather than reading the manifest**, so
 * an authored override reaches the backdrop. It did not for a long time: the
 * backdrop read `WATER_ANIM_FRAMES`/`WATER_ANIM_FPS` directly, which left a
 * built-in animation called "Rippling water", derived from those same constants,
 * that the sea ignored completely — you could edit it, save, reload, and watch
 * nothing happen.
 */
describe('the sea animation', () => {
  it('is an id the library always resolves', () => {
    expect(getGroundAnimation(SEA_ANIMATION_ID)).toBeDefined();
  });

  it('is a built-in, so it is always there to fall back to', () => {
    expect(isBuiltinAnimationId(SEA_ANIMATION_ID)).toBe(true);
    expect(BUILTIN_GROUND_ANIMATIONS.some((a) => a.id === SEA_ANIMATION_ID)).toBe(true);
  });

  /**
   * The built-in must keep deriving from the measured constants rather than
   * restating them, or re-measuring the water sheet would move the backdrop and
   * leave this behind.
   */
  it('derives its frames from the measured constants', () => {
    const builtin = BUILTIN_GROUND_ANIMATIONS.find((a) => a.id === SEA_ANIMATION_ID)!;
    expect(builtin.fps).toBe(WATER_ANIM_FPS);
    expect(builtin.frames.map((f) => f.frame)).toEqual([...WATER_ANIM_FRAMES]);
    expect(builtin.frames.every((f) => f.sheet === TILESET_WATER_ANIM.key)).toBe(true);
  });

  it('can be overridden, which is how the sea is changed', () => {
    // What the editor writes when someone edits it: same id, authored entry.
    const override: GroundAnimation = {
      id: SEA_ANIMATION_ID,
      name: 'Flat water',
      fps: 1,
      frames: [{ sheet: 'water-tile', frame: 0 }],
    };
    expect(animationProblems(override)).toEqual([]);
    // A one-frame sea is legal and still — a warning, not a refusal.
    expect(animationWarnings(override).join(' ')).toContain('static tile');
  });
});
