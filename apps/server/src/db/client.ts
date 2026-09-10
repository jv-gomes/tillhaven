import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

/**
 * Postgres is the source of truth (CLAUDE.md §2).
 *
 * Use `db.transaction(...)` for ANY operation touching more than one row —
 * trading, buying, crafting, selling. There must be no code path that creates
 * or destroys items outside a transaction (CLAUDE.md §4.3).
 */
/**
 * Optional per-query observer, off unless something installs one.
 *
 * It exists so "this endpoint issues a constant number of queries however big
 * the farm is" can be **asserted** rather than eyeballed — an N+1 is the kind
 * of regression that passes every behavioural test and only shows up as a slow
 * game months later (CLAUDE.md §11 calls the farm endpoint the hottest path).
 *
 * The cost when nobody is watching is one optional call per query.
 */
/**
 * `query` and `params` are forwarded (rather than dropped) so a test can
 * inspect not just HOW MANY queries ran but what they touched and in what
 * order — trade execution's lock-order guarantee (§6) is otherwise
 * unobservable from outside the transaction.
 */
type QueryObserver = (query: string, params: readonly unknown[]) => void;
let queryObserver: QueryObserver | null = null;

export function observeQueries(observer: QueryObserver | null): void {
  queryObserver = observer;
}

/** Counts the queries `run` issues. Not concurrency-safe — one caller at a time. */
export async function countQueries<T>(run: () => Promise<T>): Promise<{ result: T; queries: number }> {
  let queries = 0;
  observeQueries(() => {
    queries += 1;
  });
  try {
    return { result: await run(), queries };
  } finally {
    observeQueries(null);
  }
}

/**
 * Is this URL a transaction-mode connection pooler?
 *
 * Supabase serves the same database on two ports: **5432 direct** and **6543
 * through PgBouncer in transaction mode**. Managed container platforms open and
 * close connections freely, so the pooler is the right target for the app — but
 * transaction mode hands a different backend connection to each transaction,
 * which breaks anything that outlives one.
 *
 * Detected from the URL rather than configured separately, so there is one
 * `DATABASE_URL` to get right instead of a URL plus a flag that can disagree
 * with it. Supabase also spells it in the hostname (`...pooler.supabase.com`),
 * which is checked too in case the port is ever remapped.
 */
function isTransactionPooler(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.port === '6543' || parsed.hostname.includes('pooler.supabase.com');
  } catch {
    // An unparseable URL is postgres-js's problem to report, not ours to guess
    // at. Assume a direct connection and let the connection attempt fail loudly.
    return false;
  }
}

const usingPooler = isTransactionPooler(env.DATABASE_URL);

const sql = postgres(env.DATABASE_URL, {
  max: 10,
  /**
   * **Prepared statements must be off through a transaction-mode pooler.**
   *
   * postgres-js names and caches prepared statements per connection. PgBouncer
   * in transaction mode gives each transaction whichever backend is free, so a
   * statement prepared on one connection is looked up on another and the query
   * fails with `prepared statement "s1" does not exist`. It fails
   * *intermittently* — only when the pool happens to hand out a different
   * backend — which makes it the kind of bug that passes a smoke test and
   * appears under load.
   *
   * Left ON for a direct connection, where it is a real saving on the farm
   * endpoint (§11 calls it the hottest path).
   *
   * **This does not weaken anything.** Parameterisation is unaffected — values
   * are still sent out of band, never concatenated (§8) — and row-level locks
   * still work, because `SELECT ... FOR UPDATE` inside `db.transaction()` is
   * scoped to one transaction, which is exactly the unit the pooler keeps
   * intact. Trading (§6) and every other multi-row mutation (§4.3) are safe.
   */
  prepare: !usingPooler,
  // Drizzle handles parameterisation; never build SQL by string concatenation.
  onnotice: () => {},
  debug: (_connection, query, parameters) => queryObserver?.(query, parameters),
});

/** Exported for the boot log and for tests that assert the pooler is detected. */
export const databaseUsesPooler = usingPooler;

export const db = drizzle(sql, { schema });
export { schema };

export async function pingDb(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
