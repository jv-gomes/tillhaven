import { TILESET_GRASS_WATER_SPRING, TILESET_WATER_ANIM, WATER_ANIM_FPS } from './assets.js';
import { AUTHORED_GROUND_ANIMATIONS } from './groundAnim.generated.js';
import { runByKey } from './tilesets.js';

/**
 * Re-exported here rather than from `config/index.ts`, so this module is the one
 * place anything reaches for an animation. The generated file is data with no
 * behaviour; going through here means a caller cannot end up holding the
 * authored list while the rest of the app resolves ids against the merged one.
 */
export { AUTHORED_GROUND_ANIMATIONS };

/**
 * Animations the map can place on the ground.
 *
 * **The map decides what animates and where, rather than a scene deciding it in
 * code.** Before this the only animated surface in the game was the water
 * backdrop — one camera-sized `TileSprite` created by `Farm.ts`, behind
 * everything, which no authored map could put anywhere. An authored map could
 * stamp a gid and nothing else, so a fountain, a waving crop or a shimmering
 * puddle was a code change.
 *
 * **Frames are an explicit ordered list, and they may span sheets.** The order
 * is the animation, not a run of consecutive indices, because the pack does not
 * lay its frames out for our convenience — the water sheet's four usable frames
 * sit 96 apart, and there is no reason a two-sheet loop should be impossible
 * when a one-sheet one is trivial.
 *
 * **No new tilesets.** Frames index the existing manifest, so `TILESET_RUNS`
 * does not move and `farm.json`'s gids do not renumber. Touching `SHEETS`
 * forces a full map regeneration (the Phase 30+ rule); this deliberately avoids
 * needing one.
 */

/**
 * What the layer is called in the map file, and what its objects declare.
 *
 * **Shared, because both sides read it.** The mapmaker writes this layer and
 * the Farm scene looks it up by name; a private constant in each would be two
 * strings that have to stay equal, and the failure — a layer that serialises
 * fine and is silently never found — looks exactly like "the animation does not
 * work" with nothing in the console.
 */
export const ANIM_LAYER_NAME = 'animations';
export const ANIM_OBJECT_TYPE = 'groundAnimation';
/** The Tiled property each placement carries. */
export const ANIM_ID_PROPERTY = 'animId';

export interface AnimFrame {
  /** A tileset key from the shared manifest. */
  readonly sheet: string;
  /** Frame index within that sheet. */
  readonly frame: number;
}

export interface GroundAnimation {
  /** Stable id. Written into the map and read back by the scene. */
  readonly id: string;
  readonly name: string;
  /** In order. The animation is the sequence, not a range. */
  readonly frames: readonly AnimFrame[];
  readonly fps: number;
}

/**
 * The animations that ship in code, as opposed to the ones an author made.
 *
 * `water-ripple` is the four frames the water backdrop already cycles — the
 * same measurement, reused rather than re-derived. `docs/art-measurements.md`
 * records how it was found, including the two broken attempts that both
 * reported the water was standing still.
 *
 * **Built-ins stay in TypeScript because they are derived, not authored.** This
 * one reads `TILESET_WATER_ANIM.key` and `WATER_ANIM_FPS` rather than restating
 * them, so re-measuring the water sheet moves the ripple with it. Baking those
 * numbers into the generated file would fork the measurement, and a fork that
 * only shows up as "the ripple looks slightly wrong" is the kind nobody finds.
 */
/**
 * The animation the **sea** plays — the water the whole farm floats on.
 *
 * Named rather than spelt twice, because two places have to agree on it: the
 * built-in below defines it, and `Farm.createWater` looks it up to drive the
 * backdrop. They did not agree for a while. The backdrop read
 * `WATER_ANIM_FRAMES` and `WATER_ANIM_FPS` directly, so there was a built-in
 * animation called "Rippling water", derived from those same constants, that the
 * sea ignored completely — editing it in the map editor changed nothing on
 * screen, with no way to find out why.
 *
 * It is an ordinary entry in `GROUND_ANIMATIONS`, so it can be stamped on a cell
 * like any other AND overridden by an authored entry. Overriding it is how you
 * change the sea.
 */
export const SEA_ANIMATION_ID = 'water-ripple';

export const BUILTIN_GROUND_ANIMATIONS: readonly GroundAnimation[] = [
  {
    id: SEA_ANIMATION_ID,
    name: 'Rippling water',
    frames: [42, 138, 234, 330].map((frame) => ({ sheet: TILESET_WATER_ANIM.key, frame })),
    fps: WATER_ANIM_FPS,
  },
];

const BUILTIN_IDS = new Set(BUILTIN_GROUND_ANIMATIONS.map((a) => a.id));

/** Whether an id names a built-in, i.e. one an authored entry may override. */
export function isBuiltinAnimationId(id: string): boolean {
  return BUILTIN_IDS.has(id);
}

/**
 * Every animation the map may place: the built-ins, then the authored ones.
 *
 * **Authored entries win on a shared id.** The alternative — refusing the
 * override — means someone who retimes `water-ripple` in the editor, saves, and
 * sees no change has to work out from nothing that a built-in silently shadowed
 * their edit. Overriding is the behaviour that matches what they did.
 *
 * Order is stable and built-ins come first, so the editor's dropdown does not
 * reshuffle when an animation is added.
 */
function mergeAnimations(): readonly GroundAnimation[] {
  const merged = new Map<string, GroundAnimation>();
  for (const animation of BUILTIN_GROUND_ANIMATIONS) merged.set(animation.id, animation);
  for (const animation of AUTHORED_GROUND_ANIMATIONS) merged.set(animation.id, animation);
  return [...merged.values()];
}

export const GROUND_ANIMATIONS: readonly GroundAnimation[] = mergeAnimations();

const BY_ID = new Map(GROUND_ANIMATIONS.map((a) => [a.id, a]));

export function getGroundAnimation(id: string): GroundAnimation | undefined {
  return BY_ID.get(id);
}

export const GROUND_ANIMATION_IDS: readonly string[] = GROUND_ANIMATIONS.map((a) => a.id);

/**
 * Where an animation is stamped. One cell, one animation.
 *
 * Deliberately a cell rather than a rectangle: an animation covering an area is
 * that many placements, which keeps the map file readable and means the scene
 * has one kind of thing to draw. A fill tool is the editor's job, not the
 * format's.
 */
export interface GroundAnimationPlacement {
  readonly x: number;
  readonly y: number;
  readonly animId: string;
}

/* ------------------------------------------------------------------ *
 * Animated TILESETS
 *
 * A different mechanism from everything above, for a different problem.
 * `GROUND_ANIMATIONS` is for animations somebody PLACES: an ordered frame list
 * with an id, stamped cell by cell with the Anim tool. This is for sheets whose
 * art is animated *by construction* — where a painted tile is already one frame
 * of a loop and the other three are a fixed offset away.
 *
 * **Painting water should animate it. Full stop.** Before this, water painted in
 * the editor sat perfectly still in the game, and the only way to move it was to
 * hand-author one `GroundAnimation` per shoreline tile and then stamp every cell
 * with the Anim tool — sixteen animations and a hundred stamps to express one
 * fact about the art. That is the sort of work the tool should be doing.
 * ------------------------------------------------------------------ */

/**
 * A sheet that holds its animation frames as repeated blocks.
 *
 * The step is in CELLS on each axis rather than as a flat frame offset, because
 * the two sheets in this pack repeat along different axes and a single "+n
 * frames" number silently wraps at the end of a row. `tileset-grass-water-spring`
 * frame 44 is the last column of the first row; +12 frames lands on the first
 * row's block again one row down, which is a real tile and the wrong one. As
 * `dx`/`dy` the bound is checkable and the mistake is impossible.
 */
export interface AnimatedSheet {
  /** A tileset key from the shared manifest. */
  readonly sheet: string;
  /** Frames per loop, including the base. */
  readonly frames: number;
  /** Step to the next frame, in cells. */
  readonly dx: number;
  readonly dy: number;
  readonly fps: number;
  /**
   * Cells that are byte-identical in every block, so there is nothing to play.
   *
   * **The layout is animated; not every cell in it is.** Both sheets carry flat
   * fills and pure-grass pieces that repeat unchanged across all four blocks —
   * animating one draws the same image four times, which is exactly as still as
   * not animating it, but costs a timer entry and a layer redraw.
   *
   * Measured by `node scripts/measure-tile-animation.mjs`, which crops every
   * cell and compares it against its counterparts. **This is the list that stops
   * "I painted water and it did not move" being a mystery**: the farm's top row
   * was painted with one of these, the mechanism was working perfectly, and the
   * art had nothing to show. The editor marks them in the palette now.
   */
  readonly staticFrames: ReadonlySet<number>;
}

/**
 * The sheets whose tiles animate wherever they are painted.
 *
 * **Both entries are measured, not read off a filename.** Cropping every cell
 * and comparing it against its counterpart one step away:
 *
 * - `tileset-grass-water-spring` (48x16) is **four frames of twelve columns**.
 *   172 of its 192 base cells differ across the four; the 20 that do not are the
 *   pure-grass and flat-fill cells, which have nothing to animate.
 * - `tileset-water-anim` (24x16) is **four frames of four rows** — the layout
 *   `WATER_ANIM_FRAMES` already relied on for the backdrop, generalised from the
 *   one cell it named to the whole block. 92 of 96 base cells animate.
 *
 * The shoreline sheet being animated at all was not known when the water went
 * in: `TILESET_GRASS_WATER_SPRING`'s note called it "distinct from the plain
 * water-tile fill" and left it there, so the shore was painted from its first
 * block and stood still while the backdrop behind it moved.
 */
export const ANIMATED_SHEETS: readonly AnimatedSheet[] = [
  {
    sheet: TILESET_GRASS_WATER_SPRING.key,
    frames: 4,
    dx: 12,
    dy: 0,
    fps: WATER_ANIM_FPS,
    // 20 static base cells, listed in all four of their blocks.
    staticFrames: new Set([
      9, 10, 21, 22, 33, 34, 45, 46, 58, 70, 82, 94, 105, 117, 129, 141, 250, 262, 274, 286, 293,
      294, 297, 305, 306, 309, 317, 318, 321, 329, 330, 333, 345, 346, 357, 358, 369, 370, 381,
      382, 393, 394, 405, 406, 417, 418, 429, 430, 442, 454, 466, 478, 489, 501, 513, 525, 634,
      646, 658, 670, 677, 678, 681, 689, 690, 693, 701, 702, 705, 713, 714, 717, 729, 730, 741,
      742, 753, 754, 765, 766,
    ]),
  },
  {
    sheet: TILESET_WATER_ANIM.key,
    frames: 4,
    dx: 0,
    dy: 4,
    fps: WATER_ANIM_FPS,
    /*
     * 4 static base cells — one of which is the flat `#0092dd` fill that
     * `WATER_ANIM_FRAMES` records picking *against*: "92 cells animate and the
     * flat fill is not one of them". Same measurement, now machine-checked.
     */
    staticFrames: new Set([34, 46, 57, 69, 130, 142, 153, 165, 226, 238, 249, 261, 322, 334, 345, 357]),
  },
];

const ANIMATED_BY_SHEET = new Map(ANIMATED_SHEETS.map((s) => [s.sheet, s]));

export function animatedSheet(key: string): AnimatedSheet | undefined {
  return ANIMATED_BY_SHEET.get(key);
}

/**
 * The frames a painted tile cycles through, or `null` if its sheet does not
 * animate.
 *
 * **A tile in any block animates; the block it came from is its PHASE.** The
 * first version of this refused anything outside the first block, on the theory
 * that painting from block 2 was a mistake and standing still is a more visible
 * failure than flickering. The map disproved it: the farm's top row had been
 * painted from block 1 — not deliberately, just by picking the tile that looked
 * right in the palette — and 28 tiles of shore sat frozen while the other 92
 * moved. Nothing was wrong with them. Block 2 of a four-block sheet is the same
 * art at frame 2 of the same loop, so the honest reading is a rotation, not a
 * rejection.
 *
 * **The returned list STARTS at the tile that was painted.** The renderer must
 * not change what the author placed, so `frames[0]` is always the frame in the
 * map and a paused game matches the map file. The consequence is that tiles
 * painted from different blocks ripple out of phase with each other — which is
 * what water does anyway, and is fixable by repainting from one block now that
 * the editor animates too.
 */
export function sheetAnimationFrames(key: string, frame: number): number[] | null {
  const spec = ANIMATED_BY_SHEET.get(key);
  const run = runByKey(key);
  if (!spec || !run) return null;
  if (!Number.isInteger(frame) || frame < 0 || frame >= run.tileCount) return null;
  // Static art. Cycling it draws the same image four times — as still as leaving
  // it alone, but costing a timer entry and a layer redraw per tick.
  if (spec.staticFrames.has(frame)) return null;

  const col = frame % run.columns;
  const row = Math.floor(frame / run.columns);

  /*
   * Which block the tile is in, and therefore how far the cycle is already
   * wound on. Only one axis steps per sheet, so exactly one of these is
   * non-zero — but computing both and taking the larger means a future sheet
   * that stepped diagonally would not need this rewritten.
   */
  const phase = Math.max(
    spec.dx > 0 ? Math.floor(col / spec.dx) : 0,
    spec.dy > 0 ? Math.floor(row / spec.dy) : 0,
  );
  if (phase >= spec.frames) return null;

  // Wind back to the first block, which is where the cycle is generated from.
  const baseCol = col - spec.dx * phase;
  const baseRow = row - spec.dy * phase;

  // Every frame has to land inside the sheet on BOTH axes. Checking the flat
  // index alone would accept a column step that wrapped onto the next row.
  if (baseCol + spec.dx * (spec.frames - 1) >= run.columns) return null;
  if (baseRow + spec.dy * (spec.frames - 1) >= run.rows) return null;

  const frames: number[] = [];
  for (let k = 0; k < spec.frames; k++) {
    // Rotated by `phase`, so the list starts at the tile that was painted.
    const step = (phase + k) % spec.frames;
    frames.push((baseRow + spec.dy * step) * run.columns + (baseCol + spec.dx * step));
  }
  return frames;
}

/**
 * What an id may look like.
 *
 * Kebab-case and nothing else, because an id is written into every map file
 * that stamps it and read back out of Tiled JSON — quoting, case folding and
 * whitespace are three ways for a round trip to come back different. It is also
 * what the dev-server save endpoint validates against before it writes a
 * TypeScript file, so the character set has to be one that cannot mean anything
 * in TypeScript.
 */
export const ANIM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Ceiling on the rate, so a typo is caught rather than rendered.
 *
 * There is no animation in this art pack that wants to run faster than this,
 * and `fps: 600` (a slipped decimal point, or a value meant as a millisecond
 * delay) schedules a timer every 1.7ms across every placement on the map.
 */
export const MAX_ANIM_FPS = 60;

/**
 * The id an editor should offer for a given display name.
 *
 * Derived rather than typed, because the two are not independent: an author who
 * has to invent both will eventually produce `Rippling water` / `water2`, and
 * the id is the half that ends up in the map file and in every diff. Returns
 * the empty string when a name has nothing usable in it, which the caller must
 * treat as "not ready to save" rather than as an id.
 */
export function slugifyAnimId(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    // Strip combining marks so "Água" slugs as "agua" rather than losing the
    // letter entirely to the non-alphanumeric pass below.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Problems with a whole library, not just one animation.
 *
 * Duplicate ids are the interesting case and cannot be seen from a single
 * entry: the later one silently wins the `Map` lookup, so the symptom is an
 * animation in the list that plays as a different animation, with nothing
 * anywhere saying why.
 */
export function libraryProblems(animations: readonly GroundAnimation[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const animation of animations) {
    if (seen.has(animation.id)) problems.push(`duplicate id "${animation.id}"`);
    seen.add(animation.id);
    problems.push(...animationProblems(animation));
  }

  return problems;
}

/**
 * Things worth saying but not worth refusing to save over.
 *
 * Mixed frame sizes are legal and occasionally deliberate — the scene draws
 * every frame from the cell's top-left corner, so a 32px frame in a 16px loop
 * bleeds down and right, which is how you would animate something that stands
 * proud of its tile. It is also exactly what an accidental click on the wrong
 * sheet looks like, so the editor says so and leaves the choice to the author.
 */
export function animationWarnings(animation: GroundAnimation): string[] {
  const warnings: string[] = [];

  /*
   * A single-frame "animation" is a static tile with a timer attached — it
   * should be painted on the ground layer instead, where it costs nothing.
   *
   * A warning rather than a problem: it is a legitimate intermediate state
   * (every animation has exactly one frame just after the first Add frame), and
   * refusing to save it would mean an author could not stop halfway.
   */
  if (animation.frames.length === 1) {
    warnings.push(`${animation.id}: one frame is a static tile — paint it on the ground instead`);
  }

  const sizes = new Set<string>();
  for (const frame of animation.frames) {
    const run = runByKey(frame.sheet);
    if (run) sizes.add(`${run.tileWidth}x${run.tileHeight}`);
  }
  if (sizes.size > 1) {
    warnings.push(`${animation.id}: frames are different sizes (${[...sizes].join(', ')})`);
  }

  return warnings;
}

/**
 * Every frame an animation names, checked against the manifest.
 *
 * Returns the problems rather than throwing, so the map generator can report
 * all of them at once and a test can assert there are none. A frame outside its
 * sheet draws as an empty tile in Phaser — visible as nothing at all, which is
 * the worst way for an authoring mistake to present.
 */
export function animationProblems(animation: GroundAnimation): string[] {
  const problems: string[] = [];

  if (!ANIM_ID_PATTERN.test(animation.id)) {
    problems.push(`"${animation.id}": id must match ${ANIM_ID_PATTERN.source}`);
  }
  if (animation.name.trim() === '') {
    problems.push(`${animation.id}: name is empty`);
  }
  if (animation.frames.length === 0) {
    problems.push(`${animation.id}: no frames`);
  }
  if (!Number.isFinite(animation.fps) || animation.fps <= 0) {
    problems.push(`${animation.id}: fps must be positive, got ${animation.fps}`);
  } else if (animation.fps > MAX_ANIM_FPS) {
    problems.push(`${animation.id}: fps must be at most ${MAX_ANIM_FPS}, got ${animation.fps}`);
  }

  for (const [index, frame] of animation.frames.entries()) {
    const run = runByKey(frame.sheet);
    if (!run) {
      problems.push(`${animation.id}[${index}]: no tileset "${frame.sheet}" in the manifest`);
      continue;
    }
    if (!Number.isInteger(frame.frame) || frame.frame < 0 || frame.frame >= run.tileCount) {
      problems.push(
        `${animation.id}[${index}]: frame ${frame.frame} is outside ${frame.sheet} ` +
          `(0..${run.tileCount - 1})`,
      );
    }
  }

  return problems;
}
