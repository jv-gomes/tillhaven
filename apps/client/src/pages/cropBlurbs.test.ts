import { describe, expect, it } from 'vitest';
import { CROPS, CROP_IDS, type CropId } from '@tillhaven/shared/config';
import { CROP_BLURBS } from './cropBlurbs.js';

/**
 * What the landing page is allowed to advertise (T-31.06).
 *
 * The page is a shop window, and the one way a shop window can lie is by
 * showing something the shop will not sell. T-31.06 gates seeds behind farm
 * level, so a crop on this page that a brand-new account cannot buy is an
 * advertisement for a locked item — and the heading above these cards says
 * *"Four crops to start the season"*.
 *
 * That is not a hypothetical: strawberry and onion were on this page from the
 * beginning and this task moved them to farm levels 3 and 7. Nothing would
 * have caught it.
 */

const advertised = Object.keys(CROP_BLURBS) as CropId[];

describe('the landing page crop cards', () => {
  it('advertises only crops a brand-new account can actually buy', () => {
    const locked = advertised.filter((id) => CROPS[id].unlockLevel > 1);

    expect(
      locked.map((id) => `${id} needs farm level ${CROPS[id].unlockLevel}`),
      'the landing page is advertising seeds the merchant will refuse to sell',
    ).toEqual([]);
  });

  it('advertises four, matching the heading on the page', () => {
    expect(advertised).toHaveLength(4);
  });

  it('names only real crops', () => {
    for (const id of advertised) {
      expect(CROP_IDS, `${id} is not a crop`).toContain(id);
    }
  });

  /**
   * A shop window showing four crops that all ripen in ten minutes tells a
   * visitor this is a clicker; four that all take a day tells them it is a
   * chore. The spread is the pitch, so it is pinned rather than left to
   * whoever next edits the copy.
   */
  it('spans a real range of waits, from minutes to hours', () => {
    const durations = advertised.map((id) => CROPS[id].growthDurationMs);

    expect(Math.min(...durations), 'nothing here finishes quickly').toBeLessThanOrEqual(
      15 * 60_000,
    );
    expect(Math.max(...durations), 'nothing here is worth leaving for').toBeGreaterThanOrEqual(
      60 * 60_000,
    );
  });

  it('writes real copy for every card', () => {
    for (const id of advertised) {
      expect(CROP_BLURBS[id]!.length, `${id} blurb`).toBeGreaterThan(20);
    }
  });
});
