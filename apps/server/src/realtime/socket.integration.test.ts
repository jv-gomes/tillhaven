import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  FARM_LEVEL_XP,
  TRADE_MIN_ACCOUNT_AGE_MS,
  TRADE_MIN_FARM_LEVEL,
} from '@tillhaven/shared';
import { buildApp } from '../app.js';
import { db, schema, closeDb } from '../db/client.js';
import { closeRedis } from '../db/redis.js';
import { resetDb } from '../test/helpers.js';

/**
 * T-4.10: the socket itself, tested against a REAL listening server —
 * `app.inject` (every other test file's HTTP client) never opens a socket, so
 * it cannot exercise the handshake, the auth middleware, or room membership.
 * `execution.integration.test.ts`'s helpers gave the pattern; the client here
 * is `socket.io-client` instead of `TestClient`.
 */

const ELIGIBLE_XP = FARM_LEVEL_XP[TRADE_MIN_FARM_LEVEL - 1]!;

let app: FastifyInstance;
let port: number;
let sockets: ClientSocket[] = [];

async function makeEligible(playerId: string): Promise<void> {
  await db
    .update(schema.players)
    .set({
      createdAt: Date.now() - TRADE_MIN_ACCOUNT_AGE_MS - 1000,
      experience: ELIGIBLE_XP,
      flaggedAt: null,
    })
    .where(eq(schema.players.id, playerId));
}

let userSeq = 0;

/** Registers a fresh account against the real listening app and returns its session cookie. */
async function registerAndGetCookie(): Promise<{ id: string; cookie: string }> {
  userSeq += 1;
  const suffix = `${Date.now().toString(36)}${userSeq}`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      username: `sock${suffix}`,
      email: `sock${suffix}@example.test`,
      password: 'a long enough passphrase',
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`registration failed: ${res.statusCode} ${res.body}`);
  }
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = String(raw).split(';')[0]!;
  const body = JSON.parse(res.body) as { player: { id: string } };
  return { id: body.player.id, cookie };
}

async function inject(method: 'POST', url: string, cookie: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as object, headers: { cookie } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

/** Connects a client socket, tracked for cleanup. Cookie omitted → unauthenticated. */
function connect(cookie?: string): ClientSocket {
  const socket = ioClient(`http://127.0.0.1:${port}`, {
    ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return socket;
}

/** Resolves with the next `event`, or rejects if none arrives within `ms`. */
function waitFor(socket: ClientSocket, event: string, ms = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** True if `event` does NOT arrive within `ms` — used to assert silence. */
async function staysQuiet(socket: ClientSocket, event: string, ms = 300): Promise<boolean> {
  try {
    await waitFor(socket, event, ms);
    return false;
  } catch {
    return true;
  }
}

beforeEach(async () => {
  await resetDb();
  sockets = [];
  app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});

afterEach(async () => {
  for (const socket of sockets) socket.close();
  await app.close();
});

afterAll(async () => {
  await closeDb();
  await closeRedis();
});

describe('the trade socket', () => {
  it('disconnects a socket with no session cookie', async () => {
    const socket = connect();
    const err = await waitFor(socket, 'connect_error');
    expect(String((err as Error).message)).toMatch(/unauthenticated/);
    expect(socket.connected).toBe(false);
  });

  it('disconnects a socket carrying a garbage cookie', async () => {
    const socket = connect('th_session=not-a-real-token');
    await waitFor(socket, 'connect_error');
    expect(socket.connected).toBe(false);
  });

  it('connects with a valid session cookie', async () => {
    const { cookie } = await registerAndGetCookie();
    const socket = connect(cookie);
    await waitFor(socket, 'connect');
    expect(socket.connected).toBe(true);
  });

  it('sends a resync signal on connect, even with nothing to report', async () => {
    const { cookie } = await registerAndGetCookie();
    const socket = connect(cookie);
    // No trade exists at all yet — the signal fires anyway.
    await waitFor(socket, 'trade:changed');
  });

  it('sends a fresh resync signal on every reconnect too, not just the first connect', async () => {
    const { cookie } = await registerAndGetCookie();
    const socket = connect(cookie);
    await waitFor(socket, 'trade:changed');

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    socket.connect();

    await waitFor(socket, 'trade:changed');
  });

  it('only notifies the two parties to a trade, nobody else', async () => {
    const alice = await registerAndGetCookie();
    const bob = await registerAndGetCookie();
    const carol = await registerAndGetCookie();
    await makeEligible(alice.id);
    await makeEligible(bob.id);
    await makeEligible(carol.id);

    const aliceSocket = connect(alice.cookie);
    const bobSocket = connect(bob.cookie);
    const carolSocket = connect(carol.cookie);
    await Promise.all([
      waitFor(aliceSocket, 'trade:changed'),
      waitFor(bobSocket, 'trade:changed'),
      waitFor(carolSocket, 'trade:changed'),
    ]);

    // Need the recipient's username for the invite call.
    const bobRow = await db.select().from(schema.players).where(eq(schema.players.id, bob.id));
    const bobUsername = bobRow[0]!.username;

    const invited = await inject('POST', '/api/trade/invite', alice.cookie, {
      targetUsername: bobUsername,
      idempotencyKey: `k-${Date.now()}`,
    });
    expect(invited.status, JSON.stringify(invited.body)).toBe(200);

    await Promise.all([waitFor(aliceSocket, 'trade:changed'), waitFor(bobSocket, 'trade:changed')]);
    expect(await staysQuiet(carolSocket, 'trade:changed')).toBe(true);
  });

  it('notifies both parties across the lifecycle, from invite through execute', async () => {
    const alice = await registerAndGetCookie();
    const bob = await registerAndGetCookie();
    await makeEligible(alice.id);
    await makeEligible(bob.id);
    const bobRow = await db.select().from(schema.players).where(eq(schema.players.id, bob.id));
    const bobUsername = bobRow[0]!.username;

    const aliceSocket = connect(alice.cookie);
    const bobSocket = connect(bob.cookie);
    await Promise.all([waitFor(aliceSocket, 'trade:changed'), waitFor(bobSocket, 'trade:changed')]);

    const invited = await inject('POST', '/api/trade/invite', alice.cookie, {
      targetUsername: bobUsername,
      idempotencyKey: `k-invite-${Date.now()}`,
    });
    const tradeId = invited.body.id as string;
    await Promise.all([waitFor(aliceSocket, 'trade:changed'), waitFor(bobSocket, 'trade:changed')]);

    await inject('POST', '/api/trade/accept', bob.cookie, {
      tradeId,
      idempotencyKey: `k-accept-${Date.now()}`,
    });
    await Promise.all([waitFor(aliceSocket, 'trade:changed'), waitFor(bobSocket, 'trade:changed')]);
  });

  it('never registers a handler for an inbound, state-changing event', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./socket.ts', import.meta.url), 'utf8'),
    );
    // The only `.on(` in this file is `io.on('connection', ...)` — a
    // lifecycle hook, not an intent handler. There must be no `socket.on(`.
    expect(source).not.toMatch(/socket\.on\(/);
  });
});
