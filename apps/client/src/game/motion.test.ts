import { afterEach, describe, expect, it } from 'vitest';
import {
  REDUCED_MOTION_QUERY,
  prefersReducedMotion,
  reducedMotionFrom,
  resetReducedMotionCache,
} from './motion.js';

/**
 * Reduced motion (T-15.29).
 *
 * The client's tests run in node, so `window` genuinely does not exist here —
 * which makes the no-DOM path the DEFAULT case rather than an edge one worth
 * simulating. The rest is exercised by installing a minimal fake, because the
 * only thing this module does with a `MediaQueryList` is read `matches` and
 * subscribe to `change`.
 */

type Listener = (event: { matches: boolean }) => void;

interface FakeQuery {
  matches: boolean;
  addEventListener?: (type: 'change', listener: Listener) => void;
}

/** Installs a fake `window.matchMedia` and returns a way to flip the setting. */
function installMatchMedia(
  initial: boolean,
  options: { listenable?: boolean } = {},
): { flip(to: boolean): void; queried: string[] } {
  const listeners: Listener[] = [];
  const queried: string[] = [];
  const query: FakeQuery = { matches: initial };
  if (options.listenable !== false) {
    query.addEventListener = (_type, listener) => listeners.push(listener);
  }

  (globalThis as { window?: unknown }).window = {
    matchMedia: (media: string) => {
      queried.push(media);
      return query;
    },
  };

  return {
    queried,
    flip(to: boolean) {
      query.matches = to;
      for (const listener of listeners) listener({ matches: to });
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  resetReducedMotionCache();
});

describe('reducedMotionFrom', () => {
  it('is on only when the query actually matches', () => {
    expect(reducedMotionFrom({ matches: true })).toBe(true);
    expect(reducedMotionFrom({ matches: false })).toBe(false);
  });

  /**
   * The distinction this pins: "the browser cannot tell me" is NOT the same
   * answer as "the player asked for reduced motion". Reduced motion is opt-in,
   * so an absent query has to fall through to full motion — the alternative is
   * a game that renders motionless in any environment without `matchMedia`.
   */
  it('treats a missing query as no preference, not as a preference for stillness', () => {
    expect(reducedMotionFrom(null)).toBe(false);
    expect(reducedMotionFrom(undefined)).toBe(false);
  });
});

describe('prefersReducedMotion', () => {
  it('is false with no DOM at all', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('asks for the standard media feature', () => {
    const media = installMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(media.queried).toEqual([REDUCED_MOTION_QUERY]);
  });

  /**
   * The whole reason the value is cached: `Animal.update()` asks once per
   * animal per frame, and `matchMedia` is not free enough for that.
   */
  it('queries once however many times it is asked', () => {
    const media = installMatchMedia(false);
    for (let i = 0; i < 100; i++) prefersReducedMotion();
    expect(media.queried).toHaveLength(1);
  });

  /** ...and the reason the cache is not simply read-once-at-boot. */
  it('follows the setting changing with the tab open', () => {
    const media = installMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);

    media.flip(true);
    expect(prefersReducedMotion()).toBe(true);

    media.flip(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  /**
   * A browser too old to subscribe keeps the value it booted with rather than
   * throwing — the pre-existing behaviour everywhere, not a regression.
   */
  it('survives a query that cannot be subscribed to', () => {
    installMatchMedia(true, { listenable: false });
    expect(prefersReducedMotion()).toBe(true);
  });
});
