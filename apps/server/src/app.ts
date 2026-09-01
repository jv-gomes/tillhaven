import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { env, isProd } from './env.js';
import { pingDb } from './db/client.js';
import { pingRedis } from './db/redis.js';
import { registerErrorHandler } from './middleware/errors.js';
import { attachPlayer } from './middleware/auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { playerRoutes } from './modules/player/routes.js';
import { farmRoutes } from './modules/farm/routes.js';
import { inventoryRoutes } from './modules/inventory/routes.js';
import { animalRoutes } from './modules/animals/routes.js';
import { houseRoutes } from './modules/house/routes.js';
import { tradeRoutes } from './modules/trade/routes.js';
import { shopRoutes } from './modules/shop/routes.js';
import { shippingRoutes } from './modules/shipping/routes.js';
import { vipRoutes } from './modules/vip/routes.js';
import { vipWebhookRoutes } from './modules/vip/webhookRoutes.js';
import { defaultVipStripeClient, type VipStripeClient } from './modules/vip/stripe.js';
import { attachRealtime } from './realtime/socket.js';

declare module 'fastify' {
  interface FastifyInstance {
    stripe: VipStripeClient;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
/** Built client output. Present in production; absent in dev (Vite serves it). */
const CLIENT_DIST = join(HERE, '..', '..', 'client', 'dist');

/**
 * Route -> HTML entry. The URLs are extensionless by design: the player sees
 * `/play`, never `/play.html`.
 */
const PAGES: Readonly<Record<string, string>> = {
  '/': 'index.html',
  '/login': 'login.html',
  '/register': 'register.html',
  '/play': 'play.html',
  '/terms': 'terms.html',
  '/privacy': 'privacy.html',
};

/** Pages that require a session. Reached without one, they bounce to /login. */
const PROTECTED = new Set(['/play']);

export interface BuildAppOptions {
  /**
   * Rate limiting, on by default.
   *
   * The only caller that turns it off is the load harness, which needs to
   * measure the endpoint rather than the limiter. **Ignored in production** —
   * a flag that could disable rate limiting on a live server would be a worse
   * problem than the one it solves (CLAUDE.md §8).
   */
  readonly rateLimit?: boolean;
  /**
   * Overrides the Stripe client for VIP checkout (T-5.02). Tests inject a
   * hand-written mock here so the real `/api/vip/checkout` route — auth,
   * validation, rate limiting, the `VIP_ALREADY_ACTIVE` guard, all of it —
   * can be exercised through `app.inject` without a network call or a real
   * API key. Left unset in every other caller, including production.
   */
  readonly stripe?: VipStripeClient;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  // Annotated rather than inlined: passing the literal directly makes TypeScript
  // resolve Fastify's HTTP/2 overload, which then poisons every downstream type.
  const options: FastifyServerOptions = {
    // Silent under test: a few hundred request lines per run bury the actual
    // assertion failures.
    logger: env.NODE_ENV === 'test' ? false : isProd ? true : { level: 'info' },
    // Trust the proxy's X-Forwarded-For so per-IP rate limiting sees the real
    // client address rather than the load balancer's.
    trustProxy: isProd,
  };

  const app: FastifyInstance = Fastify(options);

  // CORS locked to known origins (CLAUDE.md §8).
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
  });

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
    parseOptions: {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
    },
  });

  /**
   * Global backstop only. Idle games are heavily botted, so every mutating
   * endpoint gets its own tighter per-account limit on top of this
   * (CLAUDE.md §8).
   */
  if (opts.rateLimit !== false || isProd) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
    });
  }

  registerErrorHandler(app);

  // Attaches to `app.server` — safe before `.listen()` is ever called, so
  // this runs the same way for a real boot and for the `app.inject`-only
  // test suite (CLAUDE.md §6, T-4.10).
  attachRealtime(app);

  // `defaultVipStripeClient` defers to the real Stripe SDK lazily, at call
  // time — so decorating with it here is safe even with no
  // `STRIPE_SECRET_KEY` configured (T-5.02). `opts.stripe` overrides it for
  // tests only; nothing else ever sets it.
  app.decorate('stripe', opts.stripe ?? defaultVipStripeClient);

  /* -------------------------------------------------------------- *
   * API
   * -------------------------------------------------------------- */

  app.get('/api/health', async () => {
    const [dbOk, redisOk] = await Promise.all([pingDb(), pingRedis()]);
    return { ok: dbOk && redisOk, db: dbOk, redis: redisOk, now: Date.now() };
  });

  /**
   * Server clock. The client renders growth locally between polls by
   * interpolating from the authoritative timestamps, so it needs to know its
   * own clock offset. It is never trusted to report time back.
   */
  app.get('/api/time', async () => ({ now: Date.now() }));

  /*
   * Resolves the session cookie on every request. Registered as a global hook
   * rather than per-route so that no route can accidentally skip it and then
   * read a player that was never authenticated.
   */
  app.addHook('preHandler', attachPlayer);

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(playerRoutes, { prefix: '/api/player' });
  await app.register(farmRoutes, { prefix: '/api/farm' });
  await app.register(inventoryRoutes, { prefix: '/api/inventory' });
  await app.register(animalRoutes, { prefix: '/api/animals' });
  await app.register(houseRoutes, { prefix: '/api/house' });
  await app.register(tradeRoutes, { prefix: '/api/trade' });
  await app.register(shopRoutes, { prefix: '/api/shop' });
  await app.register(shippingRoutes, { prefix: '/api/shipping' });
  await app.register(vipRoutes, { prefix: '/api/vip' });
  // A separate plugin instance, deliberately — it needs the raw request body
  // and must NOT inherit `vipRoutes`'s `requireAuth` hook (see the file's
  // own doc comment). Fastify's plugin encapsulation is what keeps the two
  // from leaking into each other despite sharing a prefix.
  await app.register(vipWebhookRoutes, { prefix: '/api/vip' });

  /* -------------------------------------------------------------- *
   * Static client
   *
   * In development this is skipped entirely — Vite serves the client on :5173
   * and proxies /api here, so there is one origin and cookies just work.
   * -------------------------------------------------------------- */

  if (existsSync(CLIENT_DIST)) {
    await app.register(fastifyStatic, {
      root: CLIENT_DIST,
      prefix: '/',
      // We route the HTML entries by hand below so the URLs stay extensionless.
      index: false,
      wildcard: false,
    });

    for (const [route, file] of Object.entries(PAGES)) {
      app.get(route, async (req, reply) => {
        if (PROTECTED.has(route) && !hasSession(req.cookies)) {
          return reply.redirect('/login', 302);
        }
        return reply.type('text/html').sendFile(file);
      });
    }

    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'No such endpoint.' },
        });
      }
      return reply.status(404).type('text/html').sendFile('index.html');
    });
  } else {
    app.log.info('No client build found; running API only (Vite serves the client in dev).');
  }

  return app;
}

/**
 * Presence check only — this decides whether to render the page or bounce to
 * login, nothing more. The session is properly verified against the database
 * by the auth middleware on every API call. A forged cookie gets you a page
 * that immediately fails its first API request (CLAUDE.md §4.1).
 */
function hasSession(cookies: Record<string, string | undefined>): boolean {
  return typeof cookies['th_session'] === 'string' && cookies['th_session'].length > 0;
}
