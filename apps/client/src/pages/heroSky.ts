import { DAY_LENGTH_MS, darknessAt, timeOfDayAt, type DaySegment } from '@tillhaven/shared/config';

/**
 * The hero's sky, as arithmetic (U3-3).
 *
 * The landing page's farm band runs the game's own day/night cycle, and it
 * runs it off **the same pure functions the game does** — `timeOfDayAt` and
 * `darknessAt` from the shared config, which is also what `game/dayNight.ts`
 * calls. Neither takes a server round trip or a stored column, so the site and
 * the farm cannot depict different skies at the same instant. A visitor who
 * reads the page and then clicks through to `/play` arrives at the hour they
 * were just looking at.
 *
 * **The cycle is twenty real minutes, not twenty-four real hours** — see
 * `DAY_LENGTH_MS`. That is what makes this worth building: the sky visibly
 * moves while someone reads the page, rather than being a state they happen to
 * catch once. It is also anchored to the Unix epoch, so two people opening the
 * page in different timezones see the same sky.
 *
 * Pure and separated from the DOM for the reason the rest of this client
 * separates them (`touchInput.ts` beside `touchControls.ts`): the interesting
 * behaviour is arithmetic, and there is no jsdom in this repo.
 */

/**
 * The darkest the tint may get.
 *
 * **Deliberately the same number as `game/dayNight.ts`'s `NIGHT_MAX_ALPHA`**,
 * and deliberately not imported from it — that module type-imports Phaser and
 * lives in `game/`, and a marketing page should not reach into the game's
 * scene code for a constant. The two are pinned equal by `heroSky.test.ts`, so
 * a change to one fails on the other rather than drifting quietly.
 */
export const HERO_NIGHT_MAX_ALPHA = 0.55;

/**
 * Where the lamps begin and finish coming on, measured in darkness.
 *
 * `darknessAt` reads 0.5 at each twilight boundary and 0.9 at the edges of
 * night, so a ramp of 0.45 → 0.8 lights the lamps just before dusk and has
 * them at full through the night — and, symmetrically, keeps them lit through
 * the dark end of morning, which is pre-dawn and correct.
 */
export const LAMP_ON_AT = 0.45;
export const LAMP_FULL_AT = 0.8;

export interface HeroSky {
  /** 0 (midday) to 1 (midnight). */
  readonly darkness: number;
  /** Opacity for the tint sheet over the farm band. */
  readonly tint: number;
  /** Opacity for the lamp glow, 0 by day. */
  readonly lamp: number;
  readonly segment: DaySegment;
  /** `06:00`-style in-game clock, for the readout. */
  readonly clock: string;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** What the band should look like at `now`. */
export function heroSkyAt(now: number): HeroSky {
  const { phase, segment, hour } = timeOfDayAt(now);
  const darkness = darknessAt(phase);

  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);

  return {
    darkness,
    tint: darkness * HERO_NIGHT_MAX_ALPHA,
    lamp: clamp01((darkness - LAMP_ON_AT) / (LAMP_FULL_AT - LAMP_ON_AT)),
    segment,
    clock: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
  };
}

/**
 * How long until the next full cycle, for the "a whole day every N minutes"
 * line the band prints. Kept here rather than formatted inline so the page and
 * the test read the same number out of the same place.
 */
export const CYCLE_MINUTES = Math.round(DAY_LENGTH_MS / 60_000);

/** Sentence-case label for the segment. The game's HUD says the same words. */
export function segmentLabel(segment: DaySegment): string {
  return segment[0]!.toUpperCase() + segment.slice(1);
}
