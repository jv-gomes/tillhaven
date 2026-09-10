import { describe, expect, it } from 'vitest';
import { CUES, cueDurationMs, cueForSwing, type CueId, type Voice } from './audio.js';
import { swingForKind } from './actions.js';
import { burstFor } from './effects.js';

/**
 * T-18.19 (T-14.09) — the game's sound.
 *
 * **There is not one audio file in the repository and no honest way to add
 * one.** §9 says every asset comes from the licensed pack, and that pack is
 * art: searching it for `.wav`, `.mp3`, `.ogg`, `.m4a` and `.flac` returns
 * zero. So the cues are synthesised, and this is the table they are synthesised
 * from — testable in node, which has no `AudioContext` at all. The twenty lines
 * that hand it to WebAudio are `sound.ts`.
 */

const ALL = Object.entries(CUES) as [CueId, readonly Voice[]][];

describe('every cue', () => {
  it.each(ALL)('%s has at least one voice', (_id, voices) => {
    expect(voices.length).toBeGreaterThan(0);
  });

  /**
   * The constraint that matters most. These fire on a keypress, and a player
   * working a row of six plots triggers the same cue six times in fifteen
   * seconds — anything with a tail becomes a drone rather than feedback.
   */
  it.each(ALL)('%s is over in a quarter of a second', (id, _voices) => {
    expect(cueDurationMs(id as CueId)).toBeLessThanOrEqual(250);
    expect(cueDurationMs(id as CueId)).toBeGreaterThan(0);
  });

  /**
   * Headroom. Voices in a cue play together, so their gains SUM — three at 0.4
   * would clip on the way out even though each looks modest on its own.
   */
  it.each(ALL)('%s cannot clip when its voices stack', (_id, voices) => {
    const peak = voices.reduce((n, v) => n + v.gain, 0);
    expect(peak).toBeLessThanOrEqual(0.6);
  });

  it.each(ALL)('%s describes voices WebAudio can actually play', (_id, voices) => {
    for (const v of voices) {
      expect(v.seconds).toBeGreaterThan(0);
      expect(v.gain).toBeGreaterThan(0);
      expect(v.delay).toBeGreaterThanOrEqual(0);
      // An exponential frequency ramp is undefined through zero, and `play`
      // clamps to 1 — but a cue should not be relying on that clamp.
      if (v.wave !== 'noise') {
        expect(v.from).toBeGreaterThan(0);
        expect(v.to).toBeGreaterThan(0);
      }
      if (v.lowpass !== null) expect(v.lowpass).toBeGreaterThan(0);
    }
  });

  /** Noise with no filter is a hiss, not a splash. */
  it.each(ALL)('%s filters any noise it uses', (_id, voices) => {
    for (const v of voices) {
      if (v.wave === 'noise') expect(v.lowpass, 'unfiltered noise is harsh').not.toBeNull();
    }
  });
});

describe('cueForSwing', () => {
  /**
   * Keyed on `Swing` so it lines up with `burstFor` in `effects.ts`: the same
   * value drives the particle and the sound, so an action cannot end up with
   * one and not the other.
   */
  it('gives every action that shows a burst a sound as well', () => {
    for (const swing of ['hoe', 'watering', 'harvest'] as const) {
      expect(burstFor(swing), swing).not.toBeNull();
      expect(cueForSwing(swing), swing).not.toBeNull();
    }
  });

  /**
   * ...and two that have a sound with no burst, which is deliberate rather
   * than an oversight: planting a seed and kneeling at a chicken are both
   * quiet, gentle actions where a spray of debris would read as damage.
   */
  it('gives planting and petting a sound but no burst', () => {
    for (const swing of ['plant', 'pet'] as const) {
      expect(burstFor(swing), swing).toBeNull();
      expect(cueForSwing(swing), swing).not.toBeNull();
    }
  });

  it('answers every verb the idle replay can play', () => {
    for (const kind of ['till', 'water', 'plant', 'harvest'] as const) {
      expect(cueForSwing(swingForKind(kind)), kind).not.toBeNull();
    }
  });

  it('names a cue that exists', () => {
    for (const swing of ['hoe', 'watering', 'harvest', 'plant', 'pet'] as const) {
      const cue = cueForSwing(swing)!;
      expect(CUES[cue], `${swing} names a missing cue`).toBeDefined();
    }
  });
});

describe('cueDurationMs', () => {
  it('covers the last voice, delay included', () => {
    // `buy` is three notes staggered by 50ms; its length is the last one's
    // start plus its own duration, not the longest single voice.
    const last = CUES.buy[CUES.buy.length - 1]!;
    expect(cueDurationMs('buy')).toBeCloseTo((last.delay + last.seconds) * 1000, 5);
    expect(cueDurationMs('buy')).toBeGreaterThan(last.seconds * 1000);
  });
});
