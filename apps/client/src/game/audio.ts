import type { Swing } from './actions.js';

/**
 * The game's sound, synthesised rather than loaded (T-18.19, T-14.09).
 *
 * **There is not one audio file in the repository, and there is no way to add
 * one honestly.** §9 says every asset comes from the licensed pack in
 * `assets/`, and that pack is art: a search across it for `.wav`, `.mp3`,
 * `.ogg`, `.m4a` and `.flac` returns **zero** files. Sourcing audio elsewhere is
 * a licensing and procurement decision, not an engineering one, and it is not a
 * decision a task about adding sound effects gets to take on the owner's behalf.
 *
 * So these are generated with WebAudio: an oscillator, an envelope, and for the
 * two that need texture a burst of noise. That is not a stopgap — short
 * synthesised blips are what this genre sounds like, they cost nothing to ship,
 * they add no manifest entry (and therefore no `firstgid` shift, T-7.09/T-8.03),
 * and there is no third party to credit.
 *
 * **The spec table is pure and the player is thin**, the same split
 * `effects.ts` uses for particles and for the same reason: what a cue *is* —
 * pitch, shape, length — is a table worth asserting without an audio context,
 * and node has no `AudioContext` at all.
 */

/** A single tone or noise burst. Everything a cue is made of. */
export interface Voice {
  /** `noise` is a white-noise burst; the rest are oscillator types. */
  readonly wave: 'sine' | 'square' | 'triangle' | 'sawtooth' | 'noise';
  /** Hz at the start of the voice. Ignored for noise. */
  readonly from: number;
  /** Hz at the end. Equal to `from` for a flat tone. Ignored for noise. */
  readonly to: number;
  /** Seconds. Kept short — these play on a keypress, not between them. */
  readonly seconds: number;
  /** Peak gain, 0..1, before the master volume. */
  readonly gain: number;
  /** Seconds to wait before this voice starts, for two-note cues. */
  readonly delay: number;
  /** Low-pass corner in Hz, or null for none. Noise without one is harsh. */
  readonly lowpass: number | null;
}

function voice(over: Partial<Voice> & Pick<Voice, 'wave' | 'from'>): Voice {
  return {
    to: over.from,
    seconds: 0.08,
    gain: 0.2,
    delay: 0,
    lowpass: null,
    ...over,
  };
}

export type CueId =
  | 'till'
  | 'water'
  | 'harvest'
  | 'plant'
  | 'collect'
  | 'buy'
  | 'refused'
  | 'open';

/**
 * What each cue is made of.
 *
 * **Every one of them is short**, which is the constraint that matters: these
 * fire on a keypress, and a player working a row of six plots will trigger the
 * same cue six times in fifteen seconds. Anything with a tail becomes a drone.
 */
export const CUES: Readonly<Record<CueId, readonly Voice[]>> = {
  /** A hoe into soil: a dull thud with no pitch to speak of. */
  till: [
    voice({ wave: 'noise', from: 0, seconds: 0.09, gain: 0.22, lowpass: 700 }),
    voice({ wave: 'triangle', from: 150, to: 70, seconds: 0.1, gain: 0.16 }),
  ],

  /** Water off a can: brighter noise, and longer because a splash rings. */
  water: [
    voice({ wave: 'noise', from: 0, seconds: 0.16, gain: 0.15, lowpass: 3200 }),
    voice({ wave: 'sine', from: 900, to: 1500, seconds: 0.12, gain: 0.1 }),
  ],

  /** Pulling a crop: a short rising pop, the one cue that should feel like a reward. */
  harvest: [
    voice({ wave: 'square', from: 440, to: 880, seconds: 0.07, gain: 0.14 }),
    voice({ wave: 'sine', from: 880, to: 1320, seconds: 0.09, gain: 0.12, delay: 0.05 }),
  ],

  /** A seed going in: quieter and lower than a harvest, because it is the start. */
  plant: [voice({ wave: 'triangle', from: 330, to: 220, seconds: 0.1, gain: 0.14 })],

  /** Taking an egg: a two-note chime, a fifth apart. */
  collect: [
    voice({ wave: 'sine', from: 660, seconds: 0.08, gain: 0.13 }),
    voice({ wave: 'sine', from: 990, seconds: 0.1, gain: 0.13, delay: 0.07 }),
  ],

  /** Money changing hands. Three quick rising notes — the genre's coin sound. */
  buy: [
    voice({ wave: 'square', from: 880, seconds: 0.05, gain: 0.1 }),
    voice({ wave: 'square', from: 1175, seconds: 0.05, gain: 0.1, delay: 0.05 }),
    voice({ wave: 'square', from: 1568, seconds: 0.09, gain: 0.1, delay: 0.1 }),
  ],

  /**
   * A refusal. Low, flat and slightly buzzy — it must be unmistakably NOT the
   * sound of something working, because it fires on the same keypress that
   * usually does work.
   */
  refused: [voice({ wave: 'sawtooth', from: 160, to: 120, seconds: 0.14, gain: 0.1, lowpass: 900 })],

  /** A panel opening. The quietest thing here: it happens constantly. */
  open: [voice({ wave: 'sine', from: 520, to: 660, seconds: 0.06, gain: 0.07 })],
};

/**
 * The cue a swing plays, or `null`.
 *
 * Keyed on `Swing` so it lines up with `burstFor` in `effects.ts` — the same
 * action produces the same particle and the same sound from the same value, and
 * the idle replay gets both for free because it already asks `swingForKind`.
 */
export function cueForSwing(swing: Swing): CueId | null {
  switch (swing) {
    case 'hoe':
      return 'till';
    case 'watering':
      return 'water';
    case 'harvest':
      return 'harvest';
    case 'plant':
      return 'plant';
    case 'pet':
      return 'collect';
    default:
      return null;
  }
}

/** How long a cue runs, for anything that needs to not overlap itself. */
export function cueDurationMs(cue: CueId): number {
  const voices = CUES[cue];
  return Math.max(...voices.map((v) => (v.delay + v.seconds) * 1000));
}
