import type { db } from './client.js';

/**
 * The transaction handle Drizzle hands to a `db.transaction(...)` callback.
 *
 * Services take a `Tx` rather than reaching for the module-level `db`, so any
 * one of them can be composed into a larger transaction. That is what makes
 * "no code path creates or destroys items outside a transaction"
 * (CLAUDE.md §4.3) enforceable rather than aspirational.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Anything that can run a query: the connection pool, or a transaction handle.
 *
 * Helpers that are useful both standalone and as part of a larger transaction
 * take this rather than forcing the caller to cast.
 */
export type Queryable = Tx | typeof db;

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * Used where a unique index is the concurrency control rather than a
 * pre-flight check — two simultaneous registrations, or two replays of one
 * idempotency key.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}
