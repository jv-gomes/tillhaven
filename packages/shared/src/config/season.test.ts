import { describe, expect, it } from 'vitest';
import { CROPS, CROP_IDS } from './crops.js';
import { SEASONS, Season, isSeason } from './season.js';

/**
 * Seasons (T-31.03).
 *
 * A type nothing reads yet is a type nothing can be wrong about, so the only
 * things worth pinning are the two that a future phase will silently depend
 * on: that the calendar order is a calendar and not an alphabet, and that
 * every crop declares a season set that could actually be checked against one.
 *
 * The invariant that matters is **non-empty**. A crop growing in no season is
 * a crop that can never be planted once Phase 35 enforces the field, and it
 * would fail as "the merchant has stopped stocking parsnips" months after the
 * config mistake was made.
 */

describe('the season vocabulary', () => {
  it('is in calendar order, not alphabetical', () => {
    expect(SEASONS).toEqual(['spring', 'summer', 'fall', 'winter']);
  });

  /**
   * Phase 35's "the season after this one" is an index into `SEASONS`, so an
   * alphabetical sort — which would put fall first and spring second — is the
   * exact mistake this pins. Asserted as a property rather than restating the
   * array, so it fails for a reordering even if someone updates the list above.
   */
  it('does not follow spring with fall', () => {
    expect(SEASONS.indexOf(Season.SUMMER)).toBe(SEASONS.indexOf(Season.SPRING) + 1);
    expect(SEASONS.indexOf(Season.FALL)).toBe(SEASONS.indexOf(Season.SUMMER) + 1);
    expect(SEASONS.indexOf(Season.WINTER)).toBe(SEASONS.indexOf(Season.FALL) + 1);
  });

  it('has one entry per member of the Season union', () => {
    expect([...SEASONS].sort()).toEqual([...Object.values(Season)].sort());
  });

  /**
   * The other three seasons exist in the type with nothing behind them, which
   * is the point: adding a season later must be one line per crop, not a
   * migration. Pinned so nobody "tidies" the unused members away.
   */
  it('keeps all four seasons in the type, even the empty ones', () => {
    expect(SEASONS).toHaveLength(4);
    for (const season of [Season.SUMMER, Season.FALL, Season.WINTER]) {
      expect(CROP_IDS.filter((id) => CROPS[id].seasons.includes(season)), season).toEqual([]);
    }
  });

  it('cannot be mutated by a caller', () => {
    expect(() => (SEASONS as Season[]).push(Season.SPRING)).toThrow();
  });

  it('recognises exactly the four seasons', () => {
    for (const season of SEASONS) expect(isSeason(season)).toBe(true);
    expect(isSeason('autumn')).toBe(false);
    expect(isSeason('')).toBe(false);
    expect(isSeason('Spring')).toBe(false);
  });
});

describe('every crop declares its seasons', () => {
  it('gives every crop a non-empty season set', () => {
    const empty = CROP_IDS.filter((id) => CROPS[id].seasons.length === 0);

    expect(
      empty,
      'a crop growing in no season can never be planted once Phase 35 enforces the field',
    ).toEqual([]);
  });

  it('uses only real seasons', () => {
    for (const id of CROP_IDS) {
      for (const season of CROPS[id].seasons) {
        expect(isSeason(season), `${id} declares "${season}"`).toBe(true);
      }
    }
  });

  it('never lists the same season twice for one crop', () => {
    for (const id of CROP_IDS) {
      const seasons = CROPS[id].seasons;
      expect(new Set(seasons).size, `${id} repeats a season`).toBe(seasons.length);
    }
  });

  /**
   * **The MVP is Spring only**, and this is the test that says so out loud.
   *
   * It replaces a narrower one that pinned only the absence of *winter* crops.
   * The re-scope cut summer and fall as well, so the honest assertion is that
   * every crop is spring — and the day someone adds a season, this fails and
   * points at `season.ts`, which is where the decision about what that season
   * IS has to be made first.
   */
  it('grows nothing outside spring', () => {
    const offSeason = CROP_IDS.filter(
      (id) => !CROPS[id].seasons.every((s) => s === Season.SPRING),
    ).map((id) => `${id}: ${CROPS[id].seasons.join(', ')}`);

    expect(
      offSeason,
      'a non-spring crop exists — see season.ts: the MVP has one season',
    ).toEqual([]);
  });
});
