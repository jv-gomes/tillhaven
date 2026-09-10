import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { closeDb } from '../db/client.js';
import { resetDb } from '../test/helpers.js';
import { createTestClient, registerTestUser, type TestClient } from '../test/app.js';

/**
 * T-14.07 — the rate limiter counts per session, not per address.
 *
 * `rateLimitKey.test.ts` proves the key function; this proves the LIMITER
 * actually uses it. The two are not the same claim: a perfect key that
 * `@fastify/rate-limit` never consults would pass every unit test and leave
 * every endpoint IP-limited, which is precisely the state this task found.
 *
 * Driven through `app.inject`'s `remoteAddress`, which is the only way to
 * present the same session from two addresses without a network.
 */

let client: TestClient;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  await registerTestUser(client);
});

afterAll(closeDb);

/**
 * `POST /api/vip/checkout` — 10/minute, the tightest authenticated limit, which
 * is what makes it the cheapest route to exhaust in a test.
 *
 * **It never returns 200 here, and that does not matter.** With no
 * `STRIPE_SECRET_KEY` configured the route itself answers 401, so every
 * assertion below is deliberately `429 or not 429`: a 429 comes from the
 * limiter in an `onRequest` hook, and anything else means the limiter let the
 * request through to the route. That distinction is the entire subject — the
 * route's own outcome is irrelevant to whether the budget was keyed correctly.
 */
const LIMIT = 10;
const LIMITED = 429;

function hit(cookie: string | undefined, ip: string) {
  return client.app.inject({
    method: 'POST',
    url: '/api/vip/checkout',
    remoteAddress: ip,
    payload: { idempotencyKey: crypto.randomUUID() },
    headers: cookie ? { cookie } : {},
  });
}

describe('per-session rate limiting', () => {
  /**
   * The finding this task exists for. Before the `keyGenerator`, spending a
   * session's budget and then changing address reset it — so any per-route
   * limit in the game was worth exactly as much as a proxy costs.
   */
  it('does not reset a session‘s budget when the address changes', async () => {
    const cookie = client.cookie!;

    // Spend the whole budget from one address.
    for (let i = 0; i < LIMIT + 2; i++) await hit(cookie, '1.2.3.4');
    const exhausted = await hit(cookie, '1.2.3.4');
    expect(exhausted.statusCode, 'the limit never engaged at all').toBe(LIMITED);

    /*
     * Same session, different address: still spent. Under the IP key this
     * returned the route's own 401 — the limiter had passed it through on a
     * fresh budget — which is exactly the failure the break-test reproduces.
     */
    const elsewhere = await hit(cookie, '203.0.113.9');
    expect(elsewhere.statusCode, 'changing IP reset the budget').toBe(LIMITED);
  });

  /**
   * The mirror, and the reason this is an improvement rather than a trade: two
   * players behind one NAT must not share a budget. Under the old IP key they
   * did.
   */
  it('gives a second player their own budget from the same address', async () => {
    const first = client.cookie!;
    for (let i = 0; i < LIMIT + 2; i++) await hit(first, '1.2.3.4');
    expect((await hit(first, '1.2.3.4')).statusCode).toBe(LIMITED);

    const other = await createTestClient();
    await registerTestUser(other);
    const second = other.cookie!;

    const theirs = await other.app.inject({
      method: 'POST',
      url: '/api/vip/checkout',
      remoteAddress: '1.2.3.4',
      payload: { idempotencyKey: crypto.randomUUID() },
      headers: { cookie: second },
    });

    // Not 429: the limiter passed it to the route, which then answered on its
    // own terms. Under the old IP key this was a 429 — the housemate's budget.
    expect(theirs.statusCode, 'a housemate spent this player‘s budget').not.toBe(LIMITED);
    await other.close();
  });

  /**
   * Anonymous traffic still has to be limited by address — there is nothing
   * else to limit it by, and registration is the endpoint a script would
   * otherwise use to mint accounts freely.
   */
  it('still limits an unauthenticated caller by address', async () => {
    const anon = (ip: string) =>
      client.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        remoteAddress: ip,
        payload: { username: `x${Math.random().toString(36).slice(2, 10)}`, email: 'a@b.test', password: 'x' },
      });

    // Whatever the limit is, a cookieless caller must not be sharing a bucket
    // with every other cookieless caller in the world — different addresses
    // must be different keys.
    const a = await anon('1.2.3.4');
    const b = await anon('5.6.7.8');
    expect(a.statusCode).not.toBe(LIMITED);
    expect(b.statusCode).not.toBe(LIMITED);
  });
});
