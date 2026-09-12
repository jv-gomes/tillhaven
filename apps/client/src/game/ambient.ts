/**
 * Chimney smoke (U3-9, QA audit §G-6).
 *
 * The last survivor of the audit's "visual improvements, highest impact first"
 * list — G-1 through G-5 all shipped in Phase 18. Its complaint was that the
 * farm holds still when the player does: *"no ambient life"*. A farm whose
 * only motion is the thing you are currently pressing reads as a diorama
 * rather than as a place.
 *
 * **Pure and Phaser-free**, like `effects.ts` beside it, and for the same
 * reason: what smoke IS — how often, how fast, how grey — is a set of numbers
 * worth asserting without standing up a canvas. `House.ts` is the dozen lines
 * that hand these to Phaser.
 *
 * Nothing here is authority over anything. The server has no opinion about
 * whether a chimney is lit, and §4.1 would not let it matter if it did.
 */

/** A continuous emitter, in the units Phaser's particle manager takes. */
export interface Plume {
  /**
   * Tints, picked at random per particle.
   *
   * **Sampled off the art it rises from**, per §9 and the lesson `effects.ts`
   * records: `obj-farmhouse.png`'s chimney bricks are a grey family around
   * #8c8c96, and these are that family lightened toward the sky rather than a
   * neutral grey ramp. Smoke in a colour that is nowhere else on screen reads
   * as a UI overlay rather than as part of the world.
   */
  readonly tints: readonly number[];
  /** Milliseconds between particles. */
  readonly frequencyMs: number;
  /** Pixels per second. */
  readonly speed: { readonly min: number; readonly max: number };
  readonly lifespanMs: number;
  /** Negative lifts. Smoke rises and keeps rising. */
  readonly gravityY: number;
  /** Emission arc in degrees, Phaser's convention: 270 is straight up. */
  readonly angle: { readonly min: number; readonly max: number };
  /** Multiplied against a 2x2 texture, so 2 is a 4px speck. */
  readonly scale: { readonly start: number; readonly end: number };
  readonly alpha: { readonly start: number; readonly end: number };
}

/**
 * The house's chimney.
 *
 * **Slow on purpose.** At `frequencyMs: 520` there are about five particles
 * alive at once — enough that the roofline is never quite still, few enough
 * that nothing in the corner of the eye asks to be looked at. The audit asked
 * for life, not for weather.
 *
 * It widens and fades as it climbs (`scale` up, `alpha` down), which is what
 * stops a column of identical specks reading as a mistake.
 */
export const CHIMNEY_SMOKE: Plume = {
  tints: [0xb9b9c2, 0xa2a2ad, 0xd0d0d6],
  frequencyMs: 520,
  speed: { min: 5, max: 11 },
  lifespanMs: 2600,
  // Up, and increasingly so: smoke does not arc back down.
  gravityY: -14,
  // A narrow cone off vertical. Dead-straight up looks like a leak.
  angle: { min: 258, max: 282 },
  scale: { start: 2.2, end: 5.4 },
  alpha: { start: 0.62, end: 0 },
};

/**
 * How far above the chimney mouth the plume starts, in world pixels.
 *
 * One pixel, not zero: emitting exactly on the mouth row puts half the
 * particle's 4px sprite inside the brickwork, and a speck clipped by the roof
 * it is supposed to be leaving is the kind of wrong that is hard to name and
 * easy to see.
 */
export const CHIMNEY_OFFSET_Y = -1;

/**
 * How many particles are alive at steady state, for the tests and for anyone
 * tuning `frequencyMs` later without re-deriving the arithmetic.
 */
export function particlesAlive(plume: Plume): number {
  return plume.lifespanMs / plume.frequencyMs;
}
