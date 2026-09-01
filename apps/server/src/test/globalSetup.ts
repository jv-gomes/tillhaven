import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Creates and migrates the TEST database before any test runs.
 *
 * This exists because the suite truncates every table between tests. Pointed at
 * the development database, that silently deletes whatever you were playing
 * with — which is exactly what happened once. Tests now get their own database
 * (`<name>_test`), and `resetDb()` refuses to run against anything else.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'drizzle');

export default async function setup(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set for the test run.');

  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against "${dbName}" — the database name must end in "_test".\n` +
        'The suite truncates every table. Check vitest.config.ts.',
    );
  }

  // Connect to the maintenance database to create the test one if needed.
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });

  try {
    const existing = await admin`
      select 1 from pg_database where datname = ${dbName}
    `;
    if (existing.length === 0) {
      // Identifier cannot be parameterised; dbName is derived from our own
      // config and validated above, never from user input.
      await admin.unsafe(`create database "${dbName}"`);
      console.log(`[test] created database ${dbName}`);
    }
  } finally {
    await admin.end({ timeout: 5 });
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
