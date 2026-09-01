import { defineConfig } from 'drizzle-kit';
import { config as loadDotenv } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The single .env lives at the monorepo root, not next to this config.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
loadDotenv({ path: join(REPO_ROOT, '.env'), quiet: true });

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env at the repo root.',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
