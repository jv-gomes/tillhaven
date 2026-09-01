import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * There is one .env, at the monorepo root. Bare `dotenv/config` resolves
 * relative to the process working directory, which differs between
 * `pnpm dev` at the root, `pnpm dev` inside apps/server, and drizzle-kit — so
 * it is resolved from this file's own location instead.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
loadDotenv({ path: join(REPO_ROOT, '.env'), quiet: true });

/**
 * Environment is validated once at boot. A missing or malformed variable fails
 * loudly here rather than as an undefined deep inside a request handler.
 *
 * Secrets live only in the environment and never reach the client
 * (CLAUDE.md §8).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** CORS is locked to exactly these origins. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters.'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((s) => s === 'true'),

  // Phase 5 only. Empty until Stripe is wired up.
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_VIP_PRICE_ID: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(`Invalid environment:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
