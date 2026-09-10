import { describe, expect, it } from 'vitest';
import { ENERGY_BASE, SLEEP_DURATION_MS, energyStateAt } from '@tillhaven/shared/config';
import { restedAt, sleepLabel } from './sleepBanner.js';

/**
 * The sleeping banner (MVP re-scope).
 *
 * The banner is the only thing on screen while the character is not the
 * player's to walk around, so the two ways it can be wrong both matter: a
 * countdown that drifts from the server's, and a countdown that reaches zero
 * before the energy does.
 */

const asleepAt = (spent: number, since: number, now: number) =>
  energyStateAt({ energySpent: spent, sleepingSince: since }, 1, now);

describe('restedAt', () => {
  it('turns the server duration into an instant the clock can chase', () => {
    const energy = asleepAt(ENERGY_BASE, 0, 0);
    expect(restedAt(energy, 1_000)).toBe(1_000 + SLEEP_DURATION_MS);
  });

  /**
   * **The reason the deadline is stored rather than the duration.** Two polls
   * a minute apart describe the same bedtime, so they must name the same
   * instant — otherwise every poll would jerk the countdown back to where it
   * was and it would never finish.
   */
  it('names the same instant however late the poll arrives', () => {
    const bedtime = 5_000;
    const early = restedAt(asleepAt(ENERGY_BASE, bedtime, bedtime + 1_000), bedtime + 1_000);
    const late = restedAt(asleepAt(ENERGY_BASE, bedtime, bedtime + 60_000), bedtime + 60_000);

    expect(late).toBe(early);
  });

  /**
   * A nearly-full bar reaches full early — the server already says so via
   * `fullInMs`, and the banner must not promise ten more minutes of nothing.
   */
  it('is now, not ten minutes away, for someone who had nothing to recover', () => {
    expect(restedAt(asleepAt(0, 0, 1_000), 1_000)).toBe(1_000);
  });

  it('is now for a player who is awake', () => {
    const awake = energyStateAt({ energySpent: 10, sleepingSince: null }, 1, 0);
    expect(restedAt(awake, 4_000)).toBe(4_000);
  });
});

describe('sleepLabel', () => {
  it('counts the remaining seconds', () => {
    expect(sleepLabel(SLEEP_DURATION_MS)).toBe('Sleeping — rested in 600s');
  });

  /**
   * Rounded UP. `floor` would show "0s" for the whole final second, which
   * reads as a hung timer rather than as one about to finish.
   */
  it('shows the last second rather than a stuck zero', () => {
    expect(sleepLabel(1)).toBe('Sleeping — rested in 1s');
    expect(sleepLabel(999)).toBe('Sleeping — rested in 1s');
    expect(sleepLabel(1_001)).toBe('Sleeping — rested in 2s');
  });

  it('says the waiting is over at zero and below', () => {
    expect(sleepLabel(0)).toBe('Fully rested — get up whenever.');
    expect(sleepLabel(-5_000)).toBe('Fully rested — get up whenever.');
  });

  it('does not print NaN if a clock ever hands it one', () => {
    expect(sleepLabel(Number.NaN)).toBe('Fully rested — get up whenever.');
  });

  /**
   * **The countdown must not finish before the energy does.** These are two
   * independent calculations of the same moment — one arithmetic on the
   * client, one `energyStateAt` on the server — and the banner saying "rested"
   * over a bar that is not yet full is the visible form of them disagreeing.
   */
  it('reaches zero exactly when the bar reaches full', () => {
    const bedtime = 1_000;
    const deadline = restedAt(asleepAt(ENERGY_BASE, bedtime, bedtime), bedtime);

    const justBefore = asleepAt(ENERGY_BASE, bedtime, deadline - 1_000);
    expect(justBefore.current).toBeLessThan(justBefore.max);
    expect(sleepLabel(deadline - (deadline - 1_000))).toContain('rested in');

    const atDeadline = asleepAt(ENERGY_BASE, bedtime, deadline);
    expect(atDeadline.current).toBe(atDeadline.max);
    expect(sleepLabel(0)).toBe('Fully rested — get up whenever.');
  });

  /**
   * Waking early is worth its fraction, so the banner is never a threshold the
   * player is waiting to cross — half a night is half a bar, on the server.
   */
  it('describes a bar that is already filling, not one that unlocks at the end', () => {
    const half = asleepAt(ENERGY_BASE, 0, SLEEP_DURATION_MS / 2);
    expect(half.current).toBe(ENERGY_BASE / 2);
    expect(sleepLabel(SLEEP_DURATION_MS / 2)).toBe('Sleeping — rested in 300s');
  });
});
