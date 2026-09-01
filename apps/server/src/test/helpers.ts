import { sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

/**
 * Helpers for tests that touch the database.
 *
 * `resetDb()` truncates every table, so it runs against a dedicated `_test`
 * database created by `src/test/globalSetup.ts` — never the development one.
 * `vitest.config.ts` sets `fileParallelism: false` so two files cannot truncate
 * each other's rows mid-test.
 */

/**
 * Every table, asked of the database rather than listed here.
 *
 * It WAS a hardcoded list, and a hardcoded list is one somebody has to remember
 * to extend: a new table that nobody adds is a table whose rows survive
 * `resetDb()` and leak into the next test, which fails somewhere else entirely.
 * `shipments` (T-11.01) was going to be the third such table.
 *
 * Order does not matter — `cascade` handles the foreign keys — and the drizzle
 * migrations table lives in its own schema, so `public` is exactly the set of
 * game tables.
 */
let tables: string[] | null = null;

async function gameTables(): Promise<string[]> {
  if (tables) return tables;

  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const found = [...rows].map((r) => r.tablename);
  // An empty list would make resetDb a silent no-op, and every test that relies
  // on a clean database would start failing for mysterious reasons.
  if (found.length === 0) throw new Error('resetDb(): no tables found — did migrations run?');

  tables = found;
  return tables;
}

/**
 * Independent of the config, checked once per process.
 *
 * globalSetup already refuses a non-`_test` database, but this is the call that
 * actually destroys data, so it verifies for itself. A misconfigured
 * `TEST_DATABASE_URL` should fail loudly here, not quietly wipe a real farm.
 */
let guardChecked = false;

function assertTestDatabase(): void {
  if (guardChecked) return;

  const url = process.env['DATABASE_URL'] ?? '';
  const name = url ? new URL(url).pathname.slice(1) : '';
  if (!name.endsWith('_test')) {
    throw new Error(
      `resetDb() refuses to truncate "${name || '(unset)'}" — the database name must end in "_test".`,
    );
  }
  guardChecked = true;
}

export async function resetDb(): Promise<void> {
  assertTestDatabase();
  const names = await gameTables();
  await db.execute(
    sql.raw(`truncate table ${names.map((t) => `"${t}"`).join(', ')} restart identity cascade`),
  );
}

let seq = 0;

/** A unique-enough suffix so parallel-ish tests never collide on a username. */
export function uniqueSuffix(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

/**
 * Inserts a bare player directly, bypassing registration.
 *
 * For tests that need *a* player to exist but are not testing registration
 * itself. Anything testing the real signup path should call the endpoint.
 */
export async function insertTestPlayer(
  overrides: Partial<typeof schema.players.$inferInsert> = {},
): Promise<{ id: string; username: string }> {
  const suffix = uniqueSuffix();
  const rows = await db
    .insert(schema.players)
    .values({
      username: `player_${suffix}`,
      email: `player_${suffix}@example.test`,
      passwordHash: '$argon2id$placeholder',
      createdAt: Date.now(),
      ...overrides,
    })
    .returning({ id: schema.players.id, username: schema.players.username });

  const row = rows[0];
  if (!row) throw new Error('failed to insert test player');
  return row;
}
