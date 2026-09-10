import { describe, expect, it } from 'vitest';
import { DAY_LENGTH_MS, DAY_SEGMENTS, MINUTE, darknessAt, timeOfDayAt } from './time.js';
import { SLEEP_DURATION_MS } from './energy.js';
import { CLOCK_HAND_FRAMES, UI_CLOCK_HAND, clockHandFrame } from './assets.js';

/**
 * Day and night (MVP re-scope).
 *
 * Cosmetic, by decision: crops grow and actions work at any hour, and sleeping
 * is available at any hour. So nothing here gates anything — what it has to get
 * right is that the cycle is the same for everybody, moves smoothly, and comes
 * back round.
 */

describe('the cycle', () => {
  it('is two sleeps long, so sleeping through the night means something', () => {
    expect(DAY_LENGTH_MS).toBe(2 * SLEEP_DURATION_MS);
  });

  /**
   * **Short enough that one session sees all of it.** A cycle tied to the real
   * day would make the sky a fact about the player's timezone; §1 asks for
   * short frequent sessions, and a player who only sees night is being shown
   * half the art.
   */
  it('fits inside a single sitting', () => {
    expect(DAY_LENGTH_MS).toBeLessThanOrEqual(30 * MINUTE);
  });

  it('names its segments in phase order, starting at zero', () => {
    expect(DAY_SEGMENTS[0]!.from).toBe(0);
    for (let i = 1; i < DAY_SEGMENTS.length; i++) {
      expect(DAY_SEGMENTS[i]!.from, DAY_SEGMENTS[i]!.name).toBeGreaterThan(
        DAY_SEGMENTS[i - 1]!.from,
      );
    }
  });

  it('keeps every segment inside the cycle', () => {
    for (const s of DAY_SEGMENTS) {
      expect(s.from, s.name).toBeGreaterThanOrEqual(0);
      expect(s.from, s.name).toBeLessThan(1);
    }
  });
});

describe('timeOfDayAt', () => {
  it('starts the cycle at the epoch', () => {
    expect(timeOfDayAt(0)).toEqual({ phase: 0, segment: 'morning', hour: 0 });
  });

  it('comes back to where it started after a full day', () => {
    expect(timeOfDayAt(DAY_LENGTH_MS)).toEqual(timeOfDayAt(0));
    expect(timeOfDayAt(DAY_LENGTH_MS * 37 + 1234)).toEqual(timeOfDayAt(1234));
  });

  it('keeps the phase inside [0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const { phase } = timeOfDayAt(i * 6_871);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });

  /**
   * **The bug this is here for.** `%` keeps the sign of the dividend, so a
   * pre-epoch timestamp lands on a negative phase — which then falls off the
   * front of the segment table and reads as morning at what should be midnight.
   * Nothing in the game produces one, but a clock skew or a test fixture can.
   */
  it('normalises a timestamp from before the epoch', () => {
    const { phase, segment } = timeOfDayAt(-DAY_LENGTH_MS * 0.1);
    expect(phase).toBeCloseTo(0.9, 6);
    expect(segment).toBe('night');
  });

  it('treats nonsense as the start of the day rather than throwing', () => {
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(timeOfDayAt(now).segment, String(now)).toBe('morning');
    }
  });

  it('names each segment at its own boundary and just before the next', () => {
    for (let i = 0; i < DAY_SEGMENTS.length; i++) {
      const here = DAY_SEGMENTS[i]!;
      const next = DAY_SEGMENTS[i + 1]?.from ?? 1;

      expect(timeOfDayAt(here.from * DAY_LENGTH_MS).segment, `${here.name} start`).toBe(here.name);
      expect(timeOfDayAt((next - 0.001) * DAY_LENGTH_MS).segment, `${here.name} end`).toBe(
        here.name,
      );
    }
  });

  it('runs a 24-hour clock face across the cycle', () => {
    expect(timeOfDayAt(0).hour).toBe(0);
    expect(timeOfDayAt(DAY_LENGTH_MS / 2).hour).toBe(12);
    expect(timeOfDayAt(DAY_LENGTH_MS * 0.75).hour).toBe(18);
  });

  /**
   * Everyone sees the same sky. Anchoring to the epoch rather than to a
   * per-player start is what makes two screenshots of the same field agree,
   * and it costs no stored column for a purely cosmetic effect.
   */
  it('depends on nothing but the clock', () => {
    const now = 1_788_900_000_000;
    expect(timeOfDayAt(now)).toEqual(timeOfDayAt(now));
  });
});

describe('darknessAt', () => {
  it('is fully light in the middle of the day', () => {
    expect(darknessAt(0.4)).toBeCloseTo(0, 6);
  });

  it('is fully dark in the middle of the night', () => {
    expect(darknessAt(0.9)).toBeCloseTo(1, 6);
  });

  it('stays inside 0 and 1 everywhere', () => {
    for (let i = 0; i <= 1000; i++) {
      const d = darknessAt(i / 1000);
      expect(d, `phase ${i / 1000}`).toBeGreaterThanOrEqual(0);
      expect(d, `phase ${i / 1000}`).toBeLessThanOrEqual(1);
    }
  });

  /**
   * **Smooth, because four stepped tints would snap four times every twenty
   * minutes** — on a pixel-art field that reads as a rendering fault, not as
   * dusk. No two adjacent thousandths of the cycle may differ by much.
   */
  it('never jumps', () => {
    let previous = darknessAt(0);
    for (let i = 1; i <= 1000; i++) {
      const d = darknessAt(i / 1000);
      expect(Math.abs(d - previous), `phase ${i / 1000}`).toBeLessThan(0.02);
      previous = d;
    }
  });

  it('is continuous across the wrap, not just inside it', () => {
    expect(Math.abs(darknessAt(0.999) - darknessAt(0))).toBeLessThan(0.02);
  });

  it('wraps like the phase does', () => {
    expect(darknessAt(1.4)).toBeCloseTo(darknessAt(0.4), 6);
    expect(darknessAt(-0.1)).toBeCloseTo(darknessAt(0.9), 6);
  });

  it('is light in the day segment and dark in the night one', () => {
    expect(darknessAt(timeOfDayAt(DAY_LENGTH_MS * 0.4).phase)).toBeLessThan(0.1);
    expect(darknessAt(timeOfDayAt(DAY_LENGTH_MS * 0.9).phase)).toBeGreaterThan(0.9);
  });

  it('treats nonsense as daylight rather than blacking out the screen', () => {
    expect(darknessAt(Number.NaN)).toBe(0);
  });
});

/**
 * The clock hand (MVP re-scope).
 *
 * Eight positions, measured from the pack: each frame's opaque centroid sits at
 * a bearing roughly 45 degrees on from the last, clockwise from straight up.
 */
describe('clockHandFrame', () => {
  it('has a frame for every position the strip actually holds', () => {
    expect(UI_CLOCK_HAND.width / UI_CLOCK_HAND.frameWidth).toBe(CLOCK_HAND_FRAMES);
  });

  it('points straight up at the top of the cycle', () => {
    expect(clockHandFrame(0)).toBe(0);
  });

  it('walks once round the face across one day', () => {
    const seen = new Set<number>();
    for (let i = 0; i < CLOCK_HAND_FRAMES; i++) seen.add(clockHandFrame(i / CLOCK_HAND_FRAMES));
    expect(seen.size).toBe(CLOCK_HAND_FRAMES);
  });

  it('stays inside the strip, whatever it is given', () => {
    for (const phase of [0, 0.999, 1, 1.5, -0.3, 12.75, Number.NaN]) {
      const f = clockHandFrame(phase);
      expect(Number.isInteger(f), String(phase)).toBe(true);
      expect(f, String(phase)).toBeGreaterThanOrEqual(0);
      expect(f, String(phase)).toBeLessThan(CLOCK_HAND_FRAMES);
    }
  });

  /**
   * **Rounded, not floored.** A floored hand only reaches a position once the
   * day is fully past it, so the face lags the sky it is describing by an
   * eighth of a day — visible, because the tint moves continuously and the hand
   * does not.
   */
  it('moves to a position at its midpoint, not at its end', () => {
    expect(clockHandFrame(1 / CLOCK_HAND_FRAMES / 2 + 0.001)).toBe(1);
  });

  it('comes back to the top rather than off the end', () => {
    expect(clockHandFrame(0.999)).toBe(0);
  });

  /**
   * The hand and the tint read the same phase, so they cannot disagree about
   * what time it is — the reason `timeOfDayAt` puts phase 0 at the top of the
   * cycle and the strip puts frame 0 straight up, with no offset between them.
   */
  it('agrees with the segment the sky is showing', () => {
    expect(clockHandFrame(timeOfDayAt(0).phase)).toBe(0);
    expect(clockHandFrame(timeOfDayAt(DAY_LENGTH_MS / 2).phase)).toBe(CLOCK_HAND_FRAMES / 2);
  });
});
