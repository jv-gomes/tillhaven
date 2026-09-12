import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAY_LENGTH_MS, darknessAt, timeOfDayAt } from '@tillhaven/shared/config';
import {
  CYCLE_MINUTES,
  HERO_NIGHT_MAX_ALPHA,
  LAMP_FULL_AT,
  LAMP_ON_AT,
  heroSkyAt,
  segmentLabel,
} from './heroSky.js';

/**
 * The hero band's clock (U3-3).
 *
 * The claim the feature makes is that the landing page and the farm depict the
 * same sky at the same instant. That claim is only true while both sides call
 * the same functions with the same constants, so most of this file checks the
 * agreement rather than the arithmetic — the arithmetic already has tests in
 * `packages/shared`.
 */

/** Phase → `now`, since both modules are pure functions of the wall clock. */
const at = (phase: number) => phase * DAY_LENGTH_MS;

const MIDDAY = 0.4;
const MIDNIGHT = 0.9;

describe('the hero sky agrees with the game', () => {
  /**
   * **The one that matters.** `game/dayNight.ts` declares its own
   * `NIGHT_MAX_ALPHA` because it cannot import from `pages/`, and this module
   * declares its own because a marketing page must not import from `game/`.
   * Two independent declarations of one number is exactly how a site and a
   * game start depicting different nights, so the copy is pinned here.
   */
  it('uses the same maximum tint as the game overlay', () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const dayNight = readFileSync(join(HERE, '..', 'game', 'dayNight.ts'), 'utf8');
    const declared = /NIGHT_MAX_ALPHA\s*=\s*([\d.]+)/.exec(dayNight)?.[1];
    expect(declared, 'NIGHT_MAX_ALPHA not found in game/dayNight.ts').toBeDefined();
    expect(Number(declared)).toBe(HERO_NIGHT_MAX_ALPHA);
  });

  it('derives darkness from the shared curve, not its own', () => {
    for (const phase of [0, 0.15, 0.4, 0.65, 0.8, 0.9, 0.99]) {
      expect(heroSkyAt(at(phase)).darkness).toBeCloseTo(darknessAt(phase), 10);
    }
  });

  it('reports the segment the shared clock reports', () => {
    for (const phase of [0, 0.14, 0.15, 0.5, 0.7, 0.85]) {
      expect(heroSkyAt(at(phase)).segment).toBe(timeOfDayAt(at(phase)).segment);
    }
  });
});

describe('the band through one day', () => {
  it('is untinted at midday and deepest at midnight', () => {
    expect(heroSkyAt(at(MIDDAY)).tint).toBeCloseTo(0, 6);
    expect(heroSkyAt(at(MIDNIGHT)).tint).toBeCloseTo(HERO_NIGHT_MAX_ALPHA, 6);
  });

  /**
   * The cap is the reason this is atmosphere rather than a black rectangle.
   * `dayNight.ts` makes the same point for the farm: a player who arrives at
   * the wrong moment must still be able to see it.
   */
  it('never tints past the cap, at any moment of the cycle', () => {
    for (let i = 0; i < 240; i++) {
      const { tint } = heroSkyAt(at(i / 240));
      expect(tint).toBeGreaterThanOrEqual(0);
      expect(tint).toBeLessThanOrEqual(HERO_NIGHT_MAX_ALPHA);
    }
  });

  it('keeps the lamps out by day and full at night', () => {
    expect(heroSkyAt(at(MIDDAY)).lamp).toBe(0);
    expect(heroSkyAt(at(MIDNIGHT)).lamp).toBe(1);
  });

  /**
   * Pre-dawn is as dark as late evening, and the lamps should be on for both.
   * The curve is symmetric about midday, so this is really a check that
   * nothing downstream has assumed "later in the phase means darker".
   */
  it('lights the lamps at the dark end of morning too', () => {
    expect(heroSkyAt(at(0.02)).lamp).toBeGreaterThan(0.9);
  });

  it('moves the lamps monotonically with darkness', () => {
    const samples = Array.from({ length: 200 }, (_, i) => heroSkyAt(at(i / 200)));
    for (const s of samples) {
      if (s.darkness <= LAMP_ON_AT) expect(s.lamp).toBe(0);
      if (s.darkness >= LAMP_FULL_AT) expect(s.lamp).toBe(1);
      expect(s.lamp).toBeGreaterThanOrEqual(0);
      expect(s.lamp).toBeLessThanOrEqual(1);
    }
  });

  it('reads out a two-digit in-game clock that stays in range', () => {
    for (let i = 0; i < 500; i++) {
      const { clock } = heroSkyAt(at(i / 500));
      expect(clock).toMatch(/^\d{2}:\d{2}$/);
      const [h, m] = clock.split(':').map(Number);
      expect(h).toBeLessThan(24);
      expect(m).toBeLessThan(60);
    }
  });

  it('wraps rather than running off the end of the cycle', () => {
    // One full cycle later is the same sky. If this ever fails, something has
    // started accumulating instead of deriving.
    const a = heroSkyAt(at(0.3));
    const b = heroSkyAt(at(0.3) + DAY_LENGTH_MS * 7);
    expect(b).toEqual(a);
  });

  it('survives a nonsense clock without throwing', () => {
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const sky = heroSkyAt(now);
      expect(Number.isFinite(sky.tint)).toBe(true);
      expect(sky.clock).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});

describe('the readout', () => {
  it('prints the cycle length from the shared constant', () => {
    expect(CYCLE_MINUTES).toBe(DAY_LENGTH_MS / 60_000);
  });

  it('sentence-cases the segment', () => {
    expect(segmentLabel('morning')).toBe('Morning');
    expect(segmentLabel('dusk')).toBe('Dusk');
  });
});
