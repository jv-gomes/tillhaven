import { describe, it, expect } from 'vitest';
import { CROPS, CROP_IDS, ITEMS, MINUTE } from '@tillhaven/shared/config';
import type { IdleSummaryView } from '@tillhaven/shared/types';
import { IDLE_SUMMARY_MIN_GAP_MS, idleSummaryMessage } from './idleSummary.js';

/**
 * "While you were away…" (T-13.08).
 *
 * The server already guarantees this is SENT once — it rides the one read that
 * applied the shift, and that read settles the watermark. What is under test
 * here is the other half of "shown once": that a player who is sitting and
 * watching, and therefore generating a summary on every twenty-second poll, is
 * not toasted at every one of them.
 */

const T0 = 1_700_000_000_000;
const CROP = CROPS[CROP_IDS[0]!];

function summary(over: Partial<IdleSummaryView> = {}): IdleSummaryView {
  return {
    tilled: 0,
    planted: 0,
    watered: 0,
    harvested: {},
    window: { from: T0 - 2 * MINUTE, to: T0 },
    bagWasFull: false,
    ...over,
  };
}

describe('idleSummaryMessage', () => {
  it('says nothing on the polls that carry no summary — almost all of them', () => {
    expect(idleSummaryMessage(null)).toBeNull();
  });

  /**
   * The reason there is a threshold at all. The catch-up fires whenever a whole
   * `IDLE_ACTION_MS` has passed, so a player watching their own farmer produces
   * a summary every single poll — none of which is an absence.
   */
  it('says nothing for a gap too short to be an absence', () => {
    const watching = summary({
      tilled: 2,
      window: { from: T0 - 20_000, to: T0 },
    });

    expect(idleSummaryMessage(watching)).toBeNull();
  });

  it('speaks once the gap is long enough to have been somewhere else', () => {
    const away = summary({
      tilled: 2,
      window: { from: T0 - IDLE_SUMMARY_MIN_GAP_MS, to: T0 },
    });

    expect(idleSummaryMessage(away)).toBe('While you were away: tilled 2.');
  });

  it('lists the chores in the order the farmer does them', () => {
    const message = idleSummaryMessage(summary({ tilled: 3, planted: 2, watered: 5 }))!;

    expect(message).toBe('While you were away: tilled 3, planted 2, watered 5.');
  });

  it('leaves out the chores that did not happen', () => {
    expect(idleSummaryMessage(summary({ watered: 4 }))).toBe('While you were away: watered 4.');
  });

  /**
   * A count of plots watered is progress; a count of things picked is loot, and
   * the player wants to know it was four leeks rather than four somethings. The
   * name comes from config, so the toast and the bag cannot disagree (§4.4).
   */
  it('names what was harvested', () => {
    const message = idleSummaryMessage(
      summary({ harvested: { [CROP.produceItemId]: 4 } }),
    )!;

    expect(message).toContain(`picked 4 × ${ITEMS[CROP.produceItemId]!.name}`);
  });

  it('reads the same way twice for the same haul', () => {
    const haul = { potato: 2, leek: 3 };

    expect(idleSummaryMessage(summary({ harvested: haul }))).toBe(
      idleSummaryMessage(summary({ harvested: { leek: 3, potato: 2 } })),
    );
  });

  it('falls back to the id for produce this build has never heard of', () => {
    expect(idleSummaryMessage(summary({ harvested: { moonfruit: 1 } }))).toContain(
      'picked 1 × moonfruit',
    );
  });

  /**
   * The nudge, and the case that makes it worth having: a shift that did
   * nothing BUT run out of room still has something to tell the player, and it
   * is the one thing they can act on.
   */
  it('says a full bag left a crop standing, even with nothing else to report', () => {
    const message = idleSummaryMessage(summary({ bagWasFull: true }))!;

    expect(message).toBe('Your bag filled up, so a ripe crop is still standing.');
  });

  it('says both when the farmer worked and then ran out of room', () => {
    const message = idleSummaryMessage(
      summary({ watered: 2, harvested: { leek: 1 }, bagWasFull: true }),
    )!;

    expect(message).toMatch(/^While you were away: watered 2, picked 1 × .+\. Your bag filled up/);
  });

  /**
   * "While you were away:" followed by nothing is worse than silence. The
   * applier only sends a summary when it did something, but a shift can be
   * entirely blocked, so the empty case has to be handled rather than assumed
   * away.
   */
  it('says nothing at all rather than an empty sentence', () => {
    expect(idleSummaryMessage(summary())).toBeNull();
  });

  it('ignores a harvest recorded as zero', () => {
    expect(idleSummaryMessage(summary({ harvested: { leek: 0 } }))).toBeNull();
  });
});
