import type { Swing } from './actions.js';

/**
 * What an action looks like where it lands (T-18.10, G-4/F-6).
 *
 * Until now tilling, watering and harvesting each played a swing animation and
 * raised a toast, and **nothing happened at the tile**. `grep` found zero
 * `add.particles` and zero `tweens.add` in the entire client. The difference
 * that makes is not decoration: a swing plus a line of text says *the state
 * changed*, and a puff of soil under the hoe says *I did that*, which is the
 * whole feedback loop of a game where you press one key at one tile.
 *
 * **Pure and Phaser-free**, like `plots.ts`, `collision.ts` and
 * `animalWander.ts` beside it, and for the same reason: what a burst IS — how
 * many, how fast, what colour, how long — is a set of numbers worth asserting
 * without standing up a canvas. `Farm.playBurst` is the twenty lines that hand
 * these to Phaser.
 *
 * Nothing here is authority over anything. A particle is cosmetic even by the
 * generous standard of §4.1 — the server has already decided what happened, and
 * this draws a reaction to it.
 */

/** One burst of particles, in the units Phaser's emitter takes. */
export interface Burst {
  /**
   * Tints, picked at random per particle. **Sampled from the art the burst is
   * standing on** (§9), never invented: dust is the two soil fills, splash is
   * `water-tile`'s single colour, and the harvest pop is read out of the ripe
   * frame of `crop-potato.png`. A burst in a colour that is not on screen
   * anywhere reads as a UI overlay rather than as part of the world.
   *
   * **Sampled from the art it lands on is not the same as "the same colour as
   * the art it lands on"**, and the first version of this got that wrong.
   * `ground-soil-dry` is `#be6d47`, so half the hoe's dust was drawn in exactly
   * the colour of the tile it was landing on and was invisible — the burst
   * fired, seven particles were alive, and the screenshot showed nothing. The
   * dark under-soil leads now, which is also what a hoe actually turns up.
   */
  readonly tints: readonly number[];
  readonly count: number;
  /** Pixels per second, before `gravityY`. */
  readonly speed: { readonly min: number; readonly max: number };
  readonly lifespanMs: number;
  /** Positive pulls down. Dust and produce fall back; a splash mostly does not. */
  readonly gravityY: number;
  /** Emission arc in degrees, Phaser's convention: 0 is east, 270 is up. */
  readonly angle: { readonly min: number; readonly max: number };
  /**
   * Multiplied against a 2x2 texture, so `start: 2` is a 4px speck — a quarter
   * of a tile. Below about 1.5 a burst is invisible at the farm's zoom, which
   * is how the first version of these numbers shipped nothing visible while
   * every test passed.
   */
  readonly scale: { readonly start: number; readonly end: number };
}

/** The texture every burst is drawn from, in pixels. See `Farm.particleTexture`. */
export const PARTICLE_PX = 2;

/** How far the fastest particle in a burst can travel, ignoring gravity. */
export function burstReachPx(burst: Burst): number {
  return (burst.speed.max * burst.lifespanMs) / 1000;
}

/**
 * The three actions that happen AT a tile and change it.
 *
 * Planting and petting are deliberately absent. Planting puts a seed in the
 * ground and nothing about that is a spray; petting is a gesture at an animal,
 * and a puff of anything at a chicken would read as harm. Both already play
 * their own animation, which is the feedback they need.
 */
export const BURSTS: Readonly<Record<'hoe' | 'watering' | 'harvest', Burst>> = {
  /**
   * Dry soil kicked up by the hoe. Narrow, low and quick — a hoe strike is a
   * single downward blow, so the dust goes up a little and comes straight back.
   */
  hoe: {
    // Dark under-soil twice to weight it: Phaser picks uniformly from this
    // list, and the pale tone alone disappears into dry soil.
    tints: [0x76422a, 0x76422a, 0xbe6d47],
    count: 7,
    speed: { min: 34, max: 74 },
    lifespanMs: 340,
    gravityY: 220,
    angle: { min: 250, max: 290 },
    scale: { start: 2, end: 0.6 },
  },

  /**
   * Water off the can. Wider than the dust and barely falls: droplets at this
   * scale are two pixels and read better drifting out than arcing.
   */
  watering: {
    tints: [0x0092dd, 0x0092dd, 0x76422a],
    count: 9,
    speed: { min: 38, max: 84 },
    lifespanMs: 420,
    gravityY: 60,
    angle: { min: 225, max: 315 },
    scale: { start: 1.75, end: 0.6 },
  },

  /**
   * The crop coming out of the ground. Fewer, slower and larger than the
   * others, because this one is a reward rather than an impact — it should read
   * as something lifting out, not as debris.
   */
  harvest: {
    tints: [0xb26247, 0x8c3c32, 0xdc9b78],
    count: 6,
    speed: { min: 26, max: 58 },
    lifespanMs: 480,
    gravityY: 160,
    angle: { min: 245, max: 295 },
    scale: { start: 2.25, end: 0.7 },
  },
};

/**
 * The burst a swing gets, or `null` for the swings that get none.
 *
 * Keyed off `Swing` rather than off `FarmIntent['kind']` so the idle replay
 * gets the same feedback for free: it already asks `swingForKind` for what to
 * play, and the autonomous farmer working a field the player is watching should
 * kick up the same dust the player does.
 */
export function burstFor(swing: Swing): Burst | null {
  return swing === 'hoe' || swing === 'watering' || swing === 'harvest'
    ? BURSTS[swing]
    : null;
}

/**
 * How long the emitter has to stay alive after it stops emitting.
 *
 * The longest a particle from this burst can still be on screen. Getting this
 * wrong by being too small pops particles out of existence mid-flight; too
 * large just leaves a dead object around a fraction longer, so it rounds up.
 */
export function burstDurationMs(burst: Burst): number {
  return burst.lifespanMs + 100;
}
