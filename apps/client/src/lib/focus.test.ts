import { describe, expect, it } from 'vitest';
import { MODAL_ATTR, modalOpenIn } from './focus.js';

/**
 * T-18.12 (BUG-10) — a modal panel takes movement input.
 *
 * Opening the shop at the merchant and holding the right arrow walked the
 * character away across the farm with the shop still open. The action key was
 * guarded by `isTypingInDom`; movement was not guarded at all.
 *
 * The predicate is split from the DOM read the same way `reducedMotionFrom` is
 * split from `prefersReducedMotion` (T-17.01): the client's tests run in node,
 * where `document` does not exist, and the decision is the part worth pinning.
 */

/** The one method `modalOpenIn` uses, recording what it was asked. */
function host(answer: unknown): { querySelector(s: string): unknown; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    querySelector(selectors: string) {
      asked.push(selectors);
      return answer;
    },
  };
}

describe('modalOpenIn', () => {
  it('is true when something matches', () => {
    expect(modalOpenIn(host({}))).toBe(true);
  });

  it('is false when nothing matches', () => {
    expect(modalOpenIn(host(null))).toBe(false);
  });

  /**
   * The query is the whole rule, so it is asserted rather than left to the
   * implementation: an open panel is one that carries the attribute AND is not
   * `hidden`. Dropping the `:not([hidden])` would freeze the character forever,
   * because every panel exists in the DOM from boot and is merely hidden.
   */
  it('asks only for panels that are not hidden', () => {
    const h = host(null);
    modalOpenIn(h);

    expect(h.asked).toEqual([`[${MODAL_ATTR}]:not([hidden])`]);
    expect(h.asked[0]).toContain(':not([hidden])');
  });

  /**
   * No document at all is not "a modal is open" — it is node, or a browser
   * before mount. Freezing movement on a missing DOM would be a hang with no
   * symptom to trace.
   */
  it('is false with no host, rather than throwing', () => {
    expect(modalOpenIn(null)).toBe(false);
    expect(modalOpenIn(undefined)).toBe(false);
  });

  /** `querySelector` returns `null`, not `undefined`, but both mean no match. */
  it('treats undefined as no match too', () => {
    expect(modalOpenIn(host(undefined))).toBe(false);
  });
});
