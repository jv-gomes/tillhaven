import { describe, expect, it } from 'vitest';
import {
  BURSTS,
  PARTICLE_PX,
  burstDurationMs,
  burstFor,
  burstReachPx,
  type Burst,
} from './effects.js';
import { TILE_SIZE } from '@tillhaven/shared/config';
import { swingForKind } from './actions.js';

/**
 * T-18.10 (G-4, F-6) — what an action looks like where it lands.
 *
 * The client had **zero** `add.particles` and **zero** `tweens.add` before
 * this, so tilling, watering and harvesting each played a swing, raised a toast
 * and left the tile visually untouched at the moment of impact. These are the
 * numbers behind the three bursts; the twenty lines that hand them to Phaser
 * live in `Farm.playBurst`.
 */

const ALL: [string, Burst][] = Object.entries(BURSTS);

describe('burstFor', () => {
  it('gives the three actions that change a tile a burst', () => {
    expect(burstFor('hoe')).toBe(BURSTS.hoe);
    expect(burstFor('watering')).toBe(BURSTS.watering);
    expect(burstFor('harvest')).toBe(BURSTS.harvest);
  });

  /**
   * Planting and petting are deliberately silent: a seed going into the ground
   * is not a spray, and a puff of anything at a chicken reads as harm. Asserted
   * rather than left implicit, because "add one for completeness" is exactly
   * the change that would make the coop unpleasant.
   */
  it('gives planting and petting none', () => {
    expect(burstFor('plant')).toBeNull();
    expect(burstFor('pet')).toBeNull();
  });

  /**
   * The join that makes the idle farmer kick up dust for free: the replay asks
   * `swingForKind` what to play, and this is keyed off the same answer. If a
   * fifth verb ever gets a strip, it gets a burst decision here or explicitly
   * none — it cannot silently fall through.
   */
  it('answers every verb the idle replay can play', () => {
    for (const kind of ['till', 'water', 'plant', 'harvest'] as const) {
      expect(() => burstFor(swingForKind(kind))).not.toThrow();
    }
    expect(burstFor(swingForKind('till'))).toBe(BURSTS.hoe);
    expect(burstFor(swingForKind('water'))).toBe(BURSTS.watering);
    expect(burstFor(swingForKind('harvest'))).toBe(BURSTS.harvest);
  });
});

describe('every burst', () => {
  it.each(ALL)('%s emits something, briefly', (_name, burst) => {
    expect(burst.count).toBeGreaterThan(0);
    // A burst that outlives its own swing stops reading as a reaction to it.
    // The character's tool animations run a few hundred ms.
    expect(burst.lifespanMs).toBeGreaterThan(0);
    expect(burst.lifespanMs).toBeLessThanOrEqual(600);
  });

  it.each(ALL)('%s is small enough not to become the scene', (_name, burst) => {
    // Twenty particles at 16px tiles is a smoke bomb, not a hoe strike.
    expect(burst.count).toBeLessThanOrEqual(12);
  });

  /**
   * The assertion that would have caught the first version of these numbers.
   * They passed every other test in this file and produced a burst nobody
   * could see: 2px particles travelling 6px on a 16px tile, half of them
   * tinted the exact colour of the soil underneath. Both halves are pinned now
   * — this is the size half.
   */
  it.each(ALL)('%s is big enough to see on a 16px tile', (_name, burst) => {
    // A quarter of a tile at its widest. Below this it reads as noise.
    expect(burst.scale.start * PARTICLE_PX).toBeGreaterThanOrEqual(TILE_SIZE / 5);
    // ...and not so big it is a splat rather than a spray.
    expect(burst.scale.start * PARTICLE_PX).toBeLessThanOrEqual(TILE_SIZE / 2);
  });

  /** ...and this is the travel half: the burst has to leave the tile it is on. */
  it.each(ALL)('%s carries clear of the tile it fires on', (_name, burst) => {
    expect(burstReachPx(burst)).toBeGreaterThanOrEqual(TILE_SIZE);
    // But not across the farm — a burst is an impact, not a firework.
    expect(burstReachPx(burst)).toBeLessThanOrEqual(TILE_SIZE * 3);
  });

  it.each(ALL)('%s shrinks as it dies rather than vanishing', (_name, burst) => {
    expect(burst.scale.end).toBeLessThan(burst.scale.start);
    expect(burst.scale.end).toBeGreaterThan(0);
  });

  /**
   * Upward, always. Phaser measures angles clockwise from east, so "up" is
   * around 270 — and a burst emitted downward would go straight into the
   * ground it is supposed to be coming out of.
   */
  it.each(ALL)('%s throws its particles upward', (_name, burst) => {
    expect(burst.angle.min).toBeGreaterThanOrEqual(180);
    expect(burst.angle.max).toBeLessThanOrEqual(360);
    expect(burst.angle.min).toBeLessThan(burst.angle.max);
    const centre = (burst.angle.min + burst.angle.max) / 2;
    expect(Math.abs(centre - 270)).toBeLessThanOrEqual(20);
  });

  it.each(ALL)('%s moves at a speed with a real range', (_name, burst) => {
    expect(burst.speed.min).toBeGreaterThan(0);
    expect(burst.speed.max).toBeGreaterThan(burst.speed.min);
  });

  /**
   * **Every tint is sampled from art that is actually on screen** (§9). These
   * are the exact colours `ground-soil-dry`/`-wet`, `water-tile` and the ripe
   * frame of `crop-potato.png` are drawn in — a burst in a colour the world
   * does not contain reads as a UI overlay stuck over the game.
   */
  it.each(ALL)('%s is tinted in colours the farm already uses', (_name, burst) => {
    const onScreen = new Set([
      0xbe6d47, // ground-soil-dry
      0x76422a, // ground-soil-wet
      0x0092dd, // water-tile
      0xb26247, // crop-potato, ripe
      0x8c3c32,
      0xdc9b78,
    ]);

    expect(burst.tints.length).toBeGreaterThan(0);
    for (const tint of burst.tints) {
      expect(onScreen.has(tint), `#${tint.toString(16)} is not a colour on the farm`).toBe(true);
    }
  });
});

describe('burstDurationMs', () => {
  it('outlives the last particle', () => {
    for (const [, burst] of ALL) {
      expect(burstDurationMs(burst)).toBeGreaterThan(burst.lifespanMs);
    }
  });

  /**
   * The emitter is destroyed on this timer. Too short pops particles out of
   * existence mid-flight; too long leaves a dead object around. It only has to
   * be an upper bound, so it rounds up — but not by a second.
   */
  it('does not leave the emitter around long after it is empty', () => {
    for (const [, burst] of ALL) {
      expect(burstDurationMs(burst) - burst.lifespanMs).toBeLessThanOrEqual(250);
    }
  });
});
