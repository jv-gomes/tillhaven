import { cpus, totalmem } from 'node:os';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { db, schema, closeDb, countQueries } from '../../src/db/client.js';
import { env } from '../../src/env.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { CROPS, STARTING_GOLD } from '@tillhaven/shared';

/**
 * Load harness for `GET /api/farm` — the hottest path in the game
 * (CLAUDE.md §11), because it is polled and it grows with the farm.
 *
 *   pnpm --filter @tillhaven/server load:farm
 *
 * Not part of the test suite: it takes seconds, its numbers depend on the
 * machine, and a latency threshold in CI would either be so loose it proves
 * nothing or so tight it fails on a busy laptop. The **query count** is the
 * part worth asserting automatically, and that lives in
 * `src/modules/farm/farm.queries.test.ts` instead.
 *
 * Measures server-side work only: requests go through `app.inject`, so routing,
 * the auth hook, Zod, the error handler and every query are included, but the
 * socket and the network are not. That is the number to optimise — the rest is
 * the deployment's problem.
 *
 * It creates one player, measures, and deletes it. It touches nothing else.
 *
 * ---------------------------------------------------------------------------
 * RESULTS — 2026-08-24
 *
 * 40 plots (half mid-growth) + 10 animals, 2000 requests after 200 warm-up.
 * Two runs, reported as a range so the noise is visible.
 *
 *   sequential
 *     p50          1.50 – 1.64 ms
 *     p95          1.89 – 2.00 ms
 *     p99          2.85 – 3.90 ms
 *     max          9.29 – 10.48 ms
 *     mean         1.59 – 1.73 ms
 *     throughput   577 – 628 req/s, single process
 *
 *   concurrency 50
 *     p50          31.7 – 35.2 ms
 *     p95          45.4 – 47.2 ms
 *     p99          51.9 – 53.7 ms
 *     throughput   1156 – 1273 req/s
 *
 *   queries per request   5, at every farm size (see farm.queries.test.ts)
 *
 * Hardware: AMD Ryzen 5 5600 (12 threads), 16 GB RAM, Node v25.7.0,
 * Postgres in Docker on the same machine, connection pool max 10.
 *
 * READING THESE
 *
 * The sequential p95 of ~2 ms is the real per-request cost: five queries to a
 * database on the same host, plus JSON.
 *
 * The concurrency-50 p95 of ~46 ms is **queueing, not work**. The pool is 10
 * connections, so fifty simultaneous requests mean forty of them waiting. Note
 * that throughput roughly doubles while latency grows twenty-fold — that is the
 * signature of a saturated pool, and it is the first thing to raise if a real
 * deployment ever sees p95 climb.
 *
 * Read them as an ORDER OF MAGNITUDE, not a target. They come from one idle
 * desktop and a local database. What matters is the SHAPE: flat query count as
 * the farm grows, which is asserted automatically rather than measured here.
 * ---------------------------------------------------------------------------
 */

/** A farm bigger than the game can currently produce, per the task's brief. */
const PLOTS = 40;
const ANIMALS = 10;

const WARMUP = 200;
const SAMPLES = 2_000;
const CONCURRENCY = 50;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index]!;
}

function ms(value: number): string {
  return `${value.toFixed(2)} ms`;
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('The load harness writes rows. Do not point it at production.');
  }

  // Rate limiting off: the point is to measure the endpoint, not the limiter.
  // It caps this route at 120/min, which would otherwise be all this measures.
  const app = await buildApp({ rateLimit: false });
  await app.ready();

  const suffix = `load${Date.now().toString(36)}`;
  const now = Date.now();

  const [player] = await db
    .insert(schema.players)
    .values({
      username: suffix,
      email: `${suffix}@example.test`,
      passwordHash: await hashPassword('a long enough passphrase'),
      gold: STARTING_GOLD,
      createdAt: now,
    })
    .returning({ id: schema.players.id });

  const [farm] = await db
    .insert(schema.farms)
    .values({ playerId: player!.id, width: 20, height: 16, createdAt: now })
    .returning({ id: schema.farms.id });

  await db.insert(schema.plots).values(
    Array.from({ length: PLOTS }, (_, i) => ({
      farmId: farm!.id,
      x: i % 20,
      y: Math.floor(i / 20),
      unlocked: true,
      // Half the field mid-growth, so every plot exercises the growth
      // calculation rather than the empty-plot early return.
      ...(i % 2 === 0
        ? {
            cropId: 'onion',
            plantedAt: now - CROPS.onion.growthDurationMs / 2,
            growthDurationMs: CROPS.onion.growthDurationMs,
          }
        : {}),
    })),
  );

  await db.insert(schema.animals).values(
    Array.from({ length: ANIMALS }, () => ({
      farmId: farm!.id,
      kind: 'chicken',
      variant: 'chicken_red',
      acquiredAt: now,
      maturesAt: now,
      lastCollectedAt: now - 2 * 60 * 60 * 1000,
      fedUntil: now + 24 * 60 * 60 * 1000,
    })),
  );

  // A session, so requests take the real authenticated path.
  const register = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { identifier: suffix, password: 'a long enough passphrase' },
  });
  const cookie = register.headers['set-cookie'];
  if (!cookie) throw new Error(`could not sign in the load player: ${register.body}`);

  const headers = { cookie: Array.isArray(cookie) ? cookie.join('; ') : cookie };
  const request = () => app.inject({ method: 'GET', url: '/api/farm', headers });

  const first = await request();
  if (first.statusCode !== 200) {
    throw new Error(`farm state did not load: ${first.statusCode} ${first.body}`);
  }

  const { queries } = await countQueries(request);

  console.log(`\nGET /api/farm — ${PLOTS} plots, ${ANIMALS} animals`);
  console.log(`  queries per request  ${queries}`);

  for (let i = 0; i < WARMUP; i++) await request();

  const timings: number[] = [];
  const startedAt = performance.now();
  for (let i = 0; i < SAMPLES; i++) {
    const t = performance.now();
    await request();
    timings.push(performance.now() - t);
  }
  const elapsed = performance.now() - startedAt;

  timings.sort((a, b) => a - b);
  const mean = timings.reduce((sum, t) => sum + t, 0) / timings.length;

  console.log(`\n  sequential, ${SAMPLES} requests`);
  console.log(`    p50   ${ms(percentile(timings, 50))}`);
  console.log(`    p95   ${ms(percentile(timings, 95))}`);
  console.log(`    p99   ${ms(percentile(timings, 99))}`);
  console.log(`    max   ${ms(timings[timings.length - 1]!)}`);
  console.log(`    mean  ${ms(mean)}`);
  console.log(`    throughput  ${Math.round(SAMPLES / (elapsed / 1000))} req/s`);

  // Again with requests in flight together, which is what a poll from many
  // players actually looks like.
  const concurrent: number[] = [];
  const concurrentStart = performance.now();
  for (let batch = 0; batch < SAMPLES / CONCURRENCY; batch++) {
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        const t = performance.now();
        await request();
        concurrent.push(performance.now() - t);
      }),
    );
  }
  const concurrentElapsed = performance.now() - concurrentStart;
  concurrent.sort((a, b) => a - b);

  console.log(`\n  concurrency ${CONCURRENCY}, ${concurrent.length} requests`);
  console.log(`    p50   ${ms(percentile(concurrent, 50))}`);
  console.log(`    p95   ${ms(percentile(concurrent, 95))}`);
  console.log(`    p99   ${ms(percentile(concurrent, 99))}`);
  console.log(`    throughput  ${Math.round(concurrent.length / (concurrentElapsed / 1000))} req/s`);

  console.log(`\n  hardware`);
  console.log(`    ${cpus()[0]?.model.trim()} (${cpus().length} threads)`);
  console.log(`    ${Math.round(totalmem() / 1024 ** 3)} GB RAM, Node ${process.version}`);

  // Clean up after ourselves: cascades remove the farm, plots and animals.
  const sessions = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.playerId, player!.id));
  if (sessions.length > 0) {
    await db.delete(schema.sessions).where(inArray(schema.sessions.id, sessions.map((s) => s.id)));
  }
  await db.delete(schema.players).where(eq(schema.players.id, player!.id));

  await app.close();
  await closeDb();
}

await main();
