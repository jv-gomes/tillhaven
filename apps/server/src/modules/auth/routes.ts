import type { FastifyInstance } from 'fastify';
import {
  registerSchema,
  loginSchema,
  type SelfPlayer,
} from '@tillhaven/shared';
import {
  requireAuth,
  currentPlayer,
  setSessionCookie,
  clearSessionCookie,
} from '../../middleware/auth.js';
import { SESSION_COOKIE, revokeSession } from './session.js';
import { register, login } from './service.js';
import { toSelfPlayer } from '../player/view.js';

/**
 * Route handlers parse, authorize, call a service, and respond — no business
 * logic (CLAUDE.md §10).
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Registration is the cheapest endpoint for a bot to hammer, so it gets the
   * tightest limit in the app. Per IP, because there is no account yet.
   */
  app.post(
    '/register',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 hour' },
      },
    },
    async (request, reply) => {
      const input = registerSchema.parse(request.body);
      const result = await register(input, Date.now());

      setSessionCookie(reply, result.session.rawToken);
      // The response carries no hash, no token, and no internal ids beyond the
      // player's own.
      return reply.status(201).send({
        player: { id: result.playerId, username: result.username },
      });
    },
  );

  app.post(
    '/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
          /*
           * Keyed on IP *and* the submitted identifier, so spraying one
           * password across many accounts from one address is limited, and so
           * is hammering one account from many addresses.
           */
          keyGenerator: (req) => {
            const body = req.body as { identifier?: unknown } | undefined;
            const id =
              typeof body?.identifier === 'string'
                ? body.identifier.toLowerCase().slice(0, 254)
                : '';
            return `${req.ip}:${id}`;
          },
        },
      },
    },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const result = await login(input, Date.now(), request.ip);

      setSessionCookie(reply, result.session.rawToken);
      return reply.send({
        player: { id: result.playerId, username: result.username },
      });
    },
  );

  /**
   * Logout revokes server-side, not just client-side. Clearing the cookie alone
   * would leave a token that still works if it was ever captured.
   *
   * Idempotent, and deliberately not behind requireAuth: signing out of an
   * already-dead session should succeed quietly, not 401.
   */
  app.post(
    '/logout',
    /*
     * The only mutating route without its own limit until T-14.07's audit, and
     * the loosest one deliberately: it is unauthenticated by design (above), it
     * writes one `revoked_at`, and it takes something AWAY from the caller. A
     * tight limit here would mostly get in the way of a browser retrying. The
     * global backstop covers the flooding case.
     */
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const raw = request.cookies[SESSION_COOKIE];
      if (raw) await revokeSession(raw, Date.now());

      clearSessionCookie(reply);
      return reply.send({ ok: true });
    },
  );

  /** Who am I. The client calls this on boot to decide what to render. */
  app.get('/me', { preHandler: requireAuth }, async (request) => {
    const player = currentPlayer(request);
    const self: SelfPlayer = toSelfPlayer(player, Date.now());
    return { player: self };
  });
}
