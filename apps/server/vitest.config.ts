import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
loadDotenv({ path: join(REPO_ROOT, '.env'), quiet: true });

/**
 * Tests get their OWN database.
 *
 * The suite truncates every table between tests, so pointing it at the
 * development database deletes whatever you were playing with. `TEST_DATABASE_URL`
 * wins if set; otherwise the dev URL's database name gets a `_test` suffix.
 * `src/test/globalSetup.ts` creates and migrates it, and refuses to run against
 * a name that does not end in `_test`.
 */
function testDatabaseUrl(): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit) return explicit;

  const dev = process.env['DATABASE_URL'];
  if (!dev) {
    throw new Error(
      'Neither TEST_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env.',
    );
  }

  const url = new URL(dev);
  url.pathname = `/${url.pathname.slice(1)}_test`;
  return url.toString();
}

const TEST_DATABASE_URL = testDatabaseUrl();

/*
 * Set on this process too, not just via `test.env`. `globalSetup` runs in the
 * main Vitest process before worker environments are built, so it would
 * otherwise see the DEVELOPMENT url — which is precisely the mistake this whole
 * arrangement exists to prevent.
 */
process.env['DATABASE_URL'] = TEST_DATABASE_URL;

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      // A stable, fake Stripe Price id and secret key so VIP checkout tests
      // (T-5.02) can exercise the real "price is configured" path, and prove
      // the secret never leaks into a response, without ever touching
      // Stripe — the test Stripe client is a hand-written mock, never the
      // real SDK, so neither value is ever sent over the network. Set here
      // rather than in the user's own `.env`, which stays untouched.
      STRIPE_VIP_PRICE_ID: 'price_test_vip_placeholder',
      STRIPE_SECRET_KEY: 'sk_test_must_never_appear_in_a_response_67890',
      // Read by webhook.integration.test.ts (T-5.03) to sign genuinely valid
      // test payloads with the REAL Stripe SDK's signing helper — pure local
      // HMAC, no network call, no real Stripe account involved.
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_for_webhook_tests_only',
    },
    globalSetup: ['./src/test/globalSetup.ts'],
    // argon2 and database round-trips are slow; the default 5s is too tight.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share one database, so files must not run in parallel
    // against each other. Unit tests are unaffected either way.
    fileParallelism: false,
    include: ['src/**/*.test.ts'],
  },
});
