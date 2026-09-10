import { describe, expect, it } from 'vitest';
import { rateLimitKey } from './rateLimitKey.js';

/**
 * T-14.07 — what the rate limiter counts against.
 *
 * §8 asks for a limit "per account and per IP" and the codebase had only the
 * IP half on every authenticated route. These pin the two properties that make
 * the account half worth having, and the one that keeps it from becoming a
 * credential leak.
 */
describe('rateLimitKey', () => {
  const TOKEN = 'a'.repeat(64);

  /**
   * **The whole point.** An IP-keyed limit is defeated by rotating proxies,
   * which are a commodity; a session-keyed one is not. If this ever stops
   * holding, every per-route limit in the game silently becomes bypassable by
   * anyone who can change address.
   */
  it('gives one session the same key from any address', () => {
    expect(rateLimitKey(TOKEN, '1.2.3.4')).toBe(rateLimitKey(TOKEN, '203.0.113.9'));
  });

  /**
   * The mirror, and the reason a household behind one NAT is no longer one
   * budget: two signed-in players from the same address must not collide.
   */
  it('gives two sessions different keys from the same address', () => {
    const a = rateLimitKey('a'.repeat(64), '1.2.3.4');
    const b = rateLimitKey('b'.repeat(64), '1.2.3.4');

    expect(a).not.toBe(b);
  });

  it('falls back to the address when there is no session', () => {
    // Registration and login arrive with no cookie, and must still be limited.
    expect(rateLimitKey(undefined, '1.2.3.4')).toBe('ip:1.2.3.4');
    expect(rateLimitKey(undefined, '1.2.3.4')).not.toBe(rateLimitKey(undefined, '5.6.7.8'));
  });

  /**
   * An empty cookie is not a session. `''` is what a cleared cookie parses to,
   * and treating it as an identity would put every logged-out caller in the
   * world into one shared bucket.
   */
  it('treats an empty cookie as no session', () => {
    expect(rateLimitKey('', '1.2.3.4')).toBe('ip:1.2.3.4');
  });

  /**
   * **The token must never appear in the key.** Rate-limit keys are stored —
   * in memory here, in Redis when clustered — and a session token is a bearer
   * credential (§8). A limiter dump containing raw tokens would be an account
   * takeover, which is why `resolveSession` hashes for storage too.
   */
  it('never puts the raw token in the key', () => {
    const key = rateLimitKey(TOKEN, '1.2.3.4');

    expect(key).not.toContain(TOKEN);
    // ...and not a prefix of it either, which a naive `slice` would leave.
    expect(TOKEN.startsWith(key.replace('s:', ''))).toBe(false);
  });

  it('is deterministic, or the limit resets on every request', () => {
    expect(rateLimitKey(TOKEN, '1.2.3.4')).toBe(rateLimitKey(TOKEN, '1.2.3.4'));
  });

  /** Namespaced, so a hash can never collide with a literal IP string. */
  it('keeps session keys and address keys in separate namespaces', () => {
    expect(rateLimitKey(TOKEN, '1.2.3.4').startsWith('s:')).toBe(true);
    expect(rateLimitKey(undefined, '1.2.3.4').startsWith('ip:')).toBe(true);
  });
});
