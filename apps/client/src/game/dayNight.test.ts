import { describe, expect, it } from 'vitest';
import { DAY_LENGTH_MS } from '@tillhaven/shared/config';
import { DEPTH } from './depth.js';
import {
  NIGHT_FADE_PER_SECOND,
  NIGHT_MAX_ALPHA,
  approachAlpha,
  nightAlphaAt,
} from './dayNight.js';

/**
 * The night tint (MVP re-scope).
 *
 * Two things can go wrong with a cosmetic overlay, and both are worse than not
 * having one: it can make the game unplayable, and it can flash.
 */

describe('nightAlphaAt', () => {
  it('is clear at midday', () => {
    expect(nightAlphaAt(DAY_LENGTH_MS * 0.4)).toBeCloseTo(0, 6);
  });

  it('reaches its darkest at midnight, and no darker', () => {
    expect(nightAlphaAt(DAY_LENGTH_MS * 0.9)).toBeCloseTo(NIGHT_MAX_ALPHA, 6);
  });

  /**
   * **The farm must stay playable at 3am.** A full-opacity tint is a black
   * screen, and a player who logs in at the wrong moment of a twenty-minute
   * cycle is not being given atmosphere, they are being locked out.
   */
  it('never darkens the farm past the point of being readable', () => {
    expect(NIGHT_MAX_ALPHA).toBeLessThanOrEqual(0.6);
    for (let i = 0; i <= 500; i++) {
      const a = nightAlphaAt((i / 500) * DAY_LENGTH_MS);
      expect(a, `t=${i}`).toBeGreaterThanOrEqual(0);
      expect(a, `t=${i}`).toBeLessThanOrEqual(NIGHT_MAX_ALPHA);
    }
  });

  it('repeats every cycle', () => {
    expect(nightAlphaAt(DAY_LENGTH_MS * 3 + 4_000)).toBeCloseTo(nightAlphaAt(4_000), 6);
  });
});

describe('approachAlpha', () => {
  it('moves toward the target without overshooting it', () => {
    expect(approachAlpha(0, 1, 1000, false)).toBeCloseTo(NIGHT_FADE_PER_SECOND, 6);
    expect(approachAlpha(0, 0.1, 1000, false)).toBe(0.1);
  });

  it('moves in both directions', () => {
    expect(approachAlpha(0.5, 0, 100, false)).toBeLessThan(0.5);
    expect(approachAlpha(0, 0.5, 100, false)).toBeGreaterThan(0);
  });

  /**
   * **The jump this exists for.** A tab left in the background for twenty
   * minutes comes back with a target on the far side of the cycle, and without
   * a rate limit the farm changes from noon to midnight between two frames.
   */
  it('takes more than a frame to cross the whole cycle', () => {
    let alpha = 0;
    const frame = 16;
    let frames = 0;
    while (alpha < NIGHT_MAX_ALPHA && frames < 10_000) {
      alpha = approachAlpha(alpha, NIGHT_MAX_ALPHA, frame, false);
      frames++;
    }
    expect(frames).toBeGreaterThan(30);
  });

  /**
   * ...but not so long that it is itself the animation. A fade that outlasts
   * the twenty-minute cycle would mean the tint never arrives anywhere.
   */
  it('catches up in seconds, not minutes', () => {
    expect(NIGHT_MAX_ALPHA / NIGHT_FADE_PER_SECOND).toBeLessThan(5);
  });

  /**
   * **Reduced motion snaps rather than fades, which is the right way round.**
   * The setting asks for less movement, and a slow wash across the entire
   * screen is more movement than an instant change, not less. The cycle itself
   * moves at about 0.003 alpha a second — below anything a person reads as
   * motion — so the only thing being suppressed is the catch-up.
   */
  it('snaps straight to the target under reduced motion', () => {
    expect(approachAlpha(0, NIGHT_MAX_ALPHA, 16, true)).toBe(NIGHT_MAX_ALPHA);
    expect(approachAlpha(NIGHT_MAX_ALPHA, 0, 16, true)).toBe(0);
  });

  it('holds still when no time has passed', () => {
    expect(approachAlpha(0.2, 0.9, 0, false)).toBe(0.2);
    expect(approachAlpha(0.2, 0.9, Number.NaN, false)).toBe(0.2);
  });

  it('settles exactly on the target rather than oscillating around it', () => {
    let alpha = 0;
    for (let i = 0; i < 200; i++) alpha = approachAlpha(alpha, 0.33, 16, false);
    expect(alpha).toBe(0.33);
  });
});

describe('where the tint sits', () => {
  /**
   * Above every sprite — a character lit at noon inside a dark field is worse
   * than no cycle — and below the overlay band, because the hint text and the
   * collision debug are read rather than looked at.
   */
  it('covers the world but not the text drawn over it', () => {
    expect(DEPTH.night).toBeGreaterThan(DEPTH.world);
    expect(DEPTH.night).toBeLessThan(DEPTH.overlay);
  });
});
