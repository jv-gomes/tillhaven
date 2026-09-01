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

const sql = postgres(env.DATABASE_URL, {
  max: 10,
  // Drizzle handles parameterisation; never build SQL by string concatenation.
  onnotice: () => {},
  debug: (_connection, query, parameters) => queryObserver?.(query, parameters),
});

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
