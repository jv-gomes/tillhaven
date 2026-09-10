import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Prepared statements must be off through Supabase's transaction pooler.
 *
 * **This is tested because the failure is intermittent and looks like something
 * else.** postgres-js caches prepared statements per connection; PgBouncer in
 * transaction mode hands each transaction whichever backend is free. A
 * statement prepared on one and executed on another fails with `prepared
 * statement "s1" does not exist` — but only when the pool happens to switch,
 * so it passes every smoke test and surfaces under load, reading like a
 * database fault rather than a client setting.
 *
 * The detector is pure and lives in `client.ts`, which cannot be imported here
 * without a live `DATABASE_URL` (the module connects on import). So the URL
 * cases are asserted against the same rule, and the file is checked for the
 * setting — enough to catch someone "simplifying" `prepare` back to a constant.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = readFileSync(join(HERE, 'client.ts'), 'utf8');

/** Mirrors `isTransactionPooler` in `client.ts`. */
function isTransactionPooler(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.port === '6543' || parsed.hostname.includes('pooler.supabase.com');
  } catch {
    return false;
  }
}

describe('Supabase pooler detection', () => {
  it.each([
    ['supabase transaction pooler, by port', 'postgres://u:p@db.abc.supabase.co:6543/postgres'],
    ['supabase pooler host', 'postgres://u:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres'],
  ])('treats %s as pooled', (_label, url) => {
    expect(isTransactionPooler(url)).toBe(true);
  });

  it.each([
    ['supabase direct', 'postgres://u:p@db.abc.supabase.co:5432/postgres'],
    ['local docker', 'postgres://tillhaven:tillhaven@localhost:5432/tillhaven'],
  ])('treats %s as direct', (_label, url) => {
    expect(isTransactionPooler(url)).toBe(false);
  });

  /**
   * A malformed URL must not be *guessed* as pooled. Turning prepared
   * statements off on a direct connection is a silent performance loss on the
   * hottest path in the game (§11); letting postgres-js report the bad URL is
   * the honest failure.
   */
  it('does not guess when the URL is unparseable', () => {
    expect(isTransactionPooler('not-a-url')).toBe(false);
  });

  it('wires the detection to postgres-js rather than hardcoding prepare', () => {
    expect(CLIENT).toMatch(/prepare:\s*!usingPooler/);
  });

  /**
   * The reasoning is the point. Someone reading `prepare: !usingPooler` with no
   * explanation will eventually decide it looks unnecessary.
   */
  it('records why, next to the setting', () => {
    expect(CLIENT).toMatch(/transaction mode/i);
    expect(CLIENT).toMatch(/prepared statement/i);
  });
});
