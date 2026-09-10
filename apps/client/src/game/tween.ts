/**
 * Named motion presets (T-30.05).
 *
 * Pure data, Phaser-free, like `effects.ts`'s `BURSTS` and `floatText.ts`
 * beside it. The scene turns these into `tweens.add` and `cameras.main.shake`
 * calls; what a pop or a shake IS — how far, how long, how hard — is a set of
 * numbers worth asserting without a canvas.
 *
 * **Why a module rather than three inline tweens.** The client had exactly one
 * `tweens.add` before this task (the float in T-30.04) and no camera shake at
 * all. Motion that is invented at each call site drifts: two pops with
 * different durations read as two different events, and the reduced-motion
 * check gets remembered in two places out of three. Every piece of feedback in
 * this phase comes from here.
 *
 * Nothing here is authority over anything (§4.1) — the server has decided what
 * happened; this is how the client reacts to it.
 */

/** A scale pulse: grow, then settle back. */
export interface PopSpec {
  /** Peak scale, relative to the object's own resting scale. */
  readonly scale: number;
  /** Time to reach the peak. The settle back takes the same again. */
  readonly durationMs: number;
  readonly ease: string;
}

/** A camera shake, in Phaser's units. */
export interface ShakeSpec {
  readonly durationMs: number;
  /** Fraction of the viewport, Phaser's convention. 0.01 is a hard knock. */
  readonly intensity: number;
}

/** A brief full-screen wash of colour. */
export interface FlashSpec {
  readonly durationMs: number;
  /** `[r, g, b]`, 0-255. */
  readonly rgb: readonly [number, number, number];
}

/**
 * The pop a plot gets when its crop comes out of the ground.
 *
 * Small on purpose: a tile is 16px, so 1.15 is about two pixels of growth at
 * the farm's zoom. Anything larger reads as the plot jumping rather than
 * reacting, and neighbouring plots are one pixel away.
 */
export const POP: PopSpec = {
  scale: 1.15,
  durationMs: 90,
  ease: 'Quad.easeOut',
};

/**
 * The level-up knock.
 *
 * `0.004` rather than something bigger, and this is the one number in the file
 * most worth defending: a level-up is **good news**, and a hard shake is the
 * vocabulary of damage. It should feel like a thump of arrival, not a hit. It
 * is also the only camera shake in the game, so it has no siblings to be
 * consistent with — the restraint has to come from the number itself.
 */
export const LEVEL_UP_SHAKE: ShakeSpec = {
  durationMs: 220,
  intensity: 0.004,
};

/**
 * The wash that goes with it, in the level bar's own green.
 *
 * Same colour as `FLOAT_TINTS.xp` and the bar fill (T-30.02), so a level-up
 * reads as the same system announcing itself louder rather than as a new
 * effect the player has to learn.
 */
export const LEVEL_UP_FLASH: FlashSpec = {
  durationMs: 260,
  rgb: [121, 191, 86],
};

/**
 * What the effect becomes when the player has asked for less motion.
 *
 * **Not "nothing" in every case, and the distinction is the point.** A pop and
 * a shake are pure decoration and go to zero — they say nothing a player cannot
 * read elsewhere. The level-up flash is the only signal that a level was
 * gained *at the moment it happens*, so it is shortened rather than removed:
 * a colour wash that does not move is not what the setting is about, and
 * deleting it would leave the reduced-motion player with no level-up feedback
 * at all beyond a bar that quietly resets.
 */
export function popFor(reducedMotion: boolean): PopSpec | null {
  return reducedMotion ? null : POP;
}

export function shakeFor(reducedMotion: boolean): ShakeSpec | null {
  return reducedMotion ? null : LEVEL_UP_SHAKE;
}

export function flashFor(reducedMotion: boolean): FlashSpec {
  return reducedMotion ? { ...LEVEL_UP_FLASH, durationMs: 120 } : LEVEL_UP_FLASH;
}

/** Total wall time a pop occupies, out and back. */
export function popDurationMs(pop: PopSpec): number {
  return pop.durationMs * 2;
}

/** Phaser wants `#rrggbb` for a DOM colour and three ints for `camera.flash`. */
export function rgbHex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
