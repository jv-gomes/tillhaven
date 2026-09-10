/**
 * Whether this player has asked their OS to reduce motion (T-15.29).
 *
 * The CSS side of `prefers-reduced-motion` has been honoured since T-15.26 —
 * the spinning gold coin, the toast slide — but CSS cannot reach inside the
 * canvas, and the two most persistent movements in the game are both in there:
 * the maple leaves shedding on a loop and the animals drifting around their
 * yards. Both run forever, unprompted, in the player's peripheral vision, which
 * is exactly the category the setting exists for.
 *
 * **The decision is separated from the DOM read** so it can be tested without a
 * jsdom: `reducedMotionFrom` is pure, `prefersReducedMotion` is the one place
 * that touches `window`. The client's tests run in node, where `window` does
 * not exist at all — hence the `typeof` guard rather than an optional chain.
 *
 * **Cached, with a listener.** `matchMedia` is not free enough to call from an
 * `update()` at 60fps for every animal on the farm, but the setting can be
 * changed while the tab is open, so a value read once at boot would be wrong
 * for the rest of the session. One query, one `change` subscription, and the
 * cache stays honest.
 */

/** The subset of `MediaQueryList` this module needs. Keeps the tests DOM-free. */
export interface MotionQuery {
  readonly matches: boolean;
  addEventListener?(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * What a media-query result means.
 *
 * Deliberately `=== true` rather than truthiness: a missing query (no
 * `matchMedia`, an environment that does not implement this feature) means
 * "no preference expressed", which is full motion. Reduced motion is opt-in,
 * and a browser that cannot answer has not opted in.
 */
export function reducedMotionFrom(query: MotionQuery | null | undefined): boolean {
  return query?.matches === true;
}

let cached: boolean | null = null;

export function prefersReducedMotion(): boolean {
  if (cached !== null) return cached;

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    cached = false;
    return cached;
  }

  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  cached = reducedMotionFrom(query);
  // Older Safari exposes only the deprecated `addListener`; a browser with
  // neither simply keeps the boot-time value, which is the pre-existing
  // behaviour rather than a regression.
  query.addEventListener?.('change', (event) => {
    cached = event.matches;
  });
  return cached;
}

/** Test seam: drops the cached answer so the next call re-reads the query. */
export function resetReducedMotionCache(): void {
  cached = null;
}
