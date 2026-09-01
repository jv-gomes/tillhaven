import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { env } from '../env.js';
import { resolveSession, SESSION_COOKIE } from '../modules/auth/session.js';

/**
 * The first push channel in the project (T-4.10). Everything else in
 * Tillhaven is request/response — the farm-state endpoint computes growth on
 * read (§4.2), trades are polled — because nothing else needs to tell a
 * player something happened while they were looking at something else. A
 * trade invite does.
 *
 * **This is a notification channel, not an intent channel.** The socket never
 * accepts anything that changes state — there is no inbound listener for a
 * trade action anywhere below, and there must never be one. It only ever
 * emits "something about one of your trades changed," and the client's only
 * correct response is to
 * re-fetch `GET /api/trade/current` — the server stays the only source of
 * truth, exactly as `§4.1` requires for the HTTP API. Splitting the mutation
 * path in two (HTTP for real, socket for a shortcut) would double the attack
 * surface for the highest-risk system in the game.
 *
 * One Socket.IO instance per Fastify app, attached via `app.decorate`, so
 * every test's own `buildApp()` gets its own isolated server — nothing here
 * is a module-level singleton shared across tests or requests.
 */

declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
  }
}

/** Every authenticated socket joins exactly this room — nothing else. */
function playerRoom(playerId: string): string {
  return `player:${playerId}`;
}

/**
 * Reads the raw `th_session` value out of a socket handshake's Cookie header.
 *
 * Hand-parsed rather than pulling in the `cookie` package: the value is an
 * opaque, unsigned token with no special characters (`setSessionCookie` never
 * signs it — see `middleware/auth.ts`), so splitting on `;` and `=` is exactly
 * as correct as a full parser here and adds no dependency.
 */
function sessionTokenFrom(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Attaches Socket.IO to this Fastify instance's underlying HTTP server.
 *
 * Called from `buildApp` unconditionally — Socket.IO only adds listeners to
 * the `http.Server`, it does not require the server to be listening, so this
 * is exactly as safe for the `app.inject`-only test suite as it is for a real
 * `app.listen`.
 */
export function attachRealtime(app: FastifyInstance): Server {
  // `connectionStateRecovery` is deliberately left unset. Turning it on would
  // buffer and replay missed events across a reconnect — exactly what T-4.10
  // asks NOT to happen ("reconnect resyncs rather than replaying"). Instead,
  // every fresh connection — first-time or reconnect, indistinguishable —
  // gets exactly one `trade:changed` below, unconditionally.
  const io = new Server(app.server, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
  });

  io.use(async (socket, next) => {
    const token = sessionTokenFrom(socket.handshake.headers.cookie);
    const session = token ? await resolveSession(token, Date.now()) : null;
    if (!session) {
      next(new Error('unauthenticated'));
      return;
    }
    socket.data['playerId'] = session.playerId;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const playerId = socket.data['playerId'] as string;
    void socket.join(playerRoom(playerId));

    // Unconditional resync signal — covers both "something changed while you
    // were disconnected" and "nothing did," which from the client's side must
    // look identical: re-fetch and find out.
    socket.emit('trade:changed');
  });

  app.decorate('io', io);
  app.addHook('onClose', async () => {
    await io.close();
  });

  return io;
}

/**
 * Notifies both parties to a trade that something about it changed. Carries
 * no payload beyond the event name — see the file doc comment for why: this
 * is a "go look" signal, not a state feed.
 */
export function emitTradeChanged(app: FastifyInstance, playerIds: readonly string[]): void {
  if (playerIds.length === 0) return;
  app.io.to(playerIds.map(playerRoom)).emit('trade:changed');
}
