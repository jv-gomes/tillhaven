import { describe, it, expect } from 'vitest';
import { parseRef } from './inventoryPanel.js';

/**
 * What a grid will accept as a dragged slot (T-10.04b).
 *
 * A drop target accepts drops from ANYWHERE. The browser will happily deliver a
 * file from the desktop, a link from another tab or a paragraph of selected
 * text to a cell, all as a `drop` event with a `text/plain` payload this panel
 * never wrote. Everything below is really one question: can something the panel
 * did not write turn into a move request?
 *
 * The answer has to be no by construction, because the destination is real —
 * a bogus `from` paired with a real `to` is exactly the shape of "move an item
 * out of a slot nobody looked at".
 */

describe('parseRef', () => {
  it('reads back what a cell writes', () => {
    for (const ref of [
      { container: 'inventory', slot: 0 },
      { container: 'inventory', slot: 23 },
      { container: 'chest', slot: 5 },
    ] as const) {
      expect(parseRef(JSON.stringify(ref))).toEqual(ref);
    }
  });

  it('refuses anything that is not a slot reference', () => {
    for (const raw of [
      undefined,
      '',
      'https://example.com/a-link-someone-dragged-in',
      'some selected text',
      '[]',
      'null',
      '42',
      '"inventory"',
      '{"container":"inventory"', // truncated JSON
    ]) {
      expect(parseRef(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('refuses a container that is not one of the two', () => {
    // The server would refuse it too (its schema is the real gate), but a
    // request that cannot possibly succeed should not leave the browser.
    for (const container of ['bank', 'INVENTORY', '', 1, null]) {
      expect(parseRef(JSON.stringify({ container, slot: 0 })), String(container)).toBeNull();
    }
  });

  it('refuses a slot index that is not a whole number', () => {
    for (const slot of ['3', 1.5, Number.NaN, Infinity, null, undefined, {}]) {
      expect(
        parseRef(JSON.stringify({ container: 'chest', slot })),
        JSON.stringify(slot),
      ).toBeNull();
    }
  });

  /**
   * Bounds are the server's business, not the panel's: capacity depends on
   * tiers and VIP, and a client that decided for itself would be a second
   * answer to what the player owns (§4.1). A negative index is refused here
   * anyway, because -1 is where a swap parks a row mid-transaction and it must
   * never be reachable from outside.
   */
  it('leaves the capacity question to the server, but still refuses negatives', () => {
    expect(parseRef(JSON.stringify({ container: 'inventory', slot: 9_999 }))).toEqual({
      container: 'inventory',
      slot: 9_999,
    });
    expect(parseRef(JSON.stringify({ container: 'inventory', slot: -1 }))).toBeNull();
  });
});
