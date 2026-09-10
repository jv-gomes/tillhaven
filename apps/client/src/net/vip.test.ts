import { describe, expect, it } from 'vitest';
import { vipReturnFrom } from './vip.js';

/**
 * T-18.20 (BUG-18) — the VIP purchase path's one risky reading.
 *
 * `POST /api/vip/checkout` has been correct since T-5.02 and had no client
 * caller anywhere: no `net/vip.ts`, no button, no mention of Stripe in
 * `apps/client/src`. The product's only revenue mechanism was unreachable from
 * the product.
 *
 * The parsing is the only part of the client half worth a test, and it is worth
 * one for a specific reason: **`?vip=success` means Stripe took the money, not
 * that this account is VIP.** Those are different events with a webhook between
 * them, and anyone can type the query into the address bar. What this returns
 * may only ever choose a sentence.
 */
describe('vipReturnFrom', () => {
  it('reads the two outcomes the server sends back', () => {
    expect(vipReturnFrom('?vip=success')).toBe('success');
    expect(vipReturnFrom('?vip=cancelled')).toBe('cancelled');
  });

  it('finds them beside other query parameters', () => {
    expect(vipReturnFrom('?a=1&vip=success&b=2')).toBe('success');
  });

  it('is null when there is nothing to read', () => {
    for (const search of ['', '?', '?other=1', '?vip=']) {
      expect(vipReturnFrom(search), search).toBeNull();
    }
  });

  /**
   * Anything unrecognised is null rather than a guess. The value decides which
   * sentence a player is shown after paying, and "nearly success" is a worse
   * answer than no answer.
   */
  it('refuses a value it does not recognise', () => {
    for (const search of ['?vip=Success', '?vip=true', '?vip=1', '?vip=granted', '?vip=SUCCESS']) {
      expect(vipReturnFrom(search), search).toBeNull();
    }
  });

  /**
   * The one that matters most, stated as an assertion rather than a comment:
   * this function's whole output is a two-value enum with no grant in it. There
   * is no shape it can return that another part of the client could mistake for
   * "this account is now VIP" — that fact lives only in `SelfPlayer.isVip`,
   * which comes from the server after the webhook.
   */
  it('can only ever answer with a redirect outcome, never a grant', () => {
    const answers = new Set(
      ['?vip=success', '?vip=cancelled', '?vip=anything', ''].map(vipReturnFrom),
    );
    // Sorted with an explicit comparator: the default one stringifies, so
    // `null` lands between 'cancelled' and 'success' rather than first.
    expect([...answers].map(String).sort()).toEqual(['cancelled', 'null', 'success']);
  });
});
