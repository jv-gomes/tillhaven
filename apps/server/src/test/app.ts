import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../app.js';

/**
 * An in-process HTTP client over `app.inject`, so integration tests exercise
 * the real stack — routing, hooks, Zod parsing, the error handler, cookies —
 * without opening a socket.
 *
 * Testing the service functions directly would skip exactly the layers where
 * authorization and validation live.
 */

export interface TestClient {
  readonly app: FastifyInstance;
  get(path: string): Promise<TestResponse>;
  post(path: string, body?: unknown): Promise<TestResponse>;
  put(path: string, body?: unknown): Promise<TestResponse>;
  /** Keeps the session cookie from the last response, like a browser would. */
  cookie: string | undefined;
  close(): Promise<void>;
}

export interface TestResponse {
  readonly status: number;
  readonly body: any;
  readonly headers: Record<string, unknown>;
  /** Machine-readable error code, when the response was an error. */
  readonly code: string | undefined;
}

/**
 * `opts` passes straight through to `buildApp` — the one caller that needs
 * it is T-5.02's VIP tests, which inject a mock `stripe` client so the real
 * checkout route can be exercised without a network call.
 */
export async function createTestClient(opts: BuildAppOptions = {}): Promise<TestClient> {
  const app = await buildApp(opts);
  await app.ready();

  const client: TestClient = {
    app,
    cookie: undefined,

    async get(path) {
      return send(app, client, 'GET', path);
    },

    async post(path, body) {
      return send(app, client, 'POST', path, body);
    },

    async put(path, body) {
      return send(app, client, 'PUT', path, body);
    },

    async close() {
      await app.close();
    },
  };

  return client;
}

async function send(
  app: FastifyInstance,
  client: TestClient,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<TestResponse> {
  const res = await app.inject({
    method,
    url: path,
    ...(body === undefined ? {} : { payload: body as object }),
    headers: client.cookie ? { cookie: client.cookie } : {},
  });

  // Capture Set-Cookie so subsequent requests are authenticated.
  const setCookie = res.headers['set-cookie'];
  if (setCookie) {
    const raw = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of raw) {
      const pair = c.split(';')[0] ?? '';
      if (pair.startsWith('th_session=')) {
        const value = pair.slice('th_session='.length);
        client.cookie = value === '' ? undefined : pair;
      }
    }
  }

  let parsed: unknown = null;
  try {
    parsed = res.body ? JSON.parse(res.body) : null;
  } catch {
    parsed = res.body;
  }

  const code =
    typeof parsed === 'object' && parsed !== null && 'error' in parsed
      ? String((parsed as { error: { code: string } }).error.code)
      : undefined;

  return {
    status: res.statusCode,
    body: parsed,
    headers: res.headers as Record<string, unknown>,
    code,
  };
}

let userSeq = 0;

/** Registers a fresh account and leaves the client signed in as them. */
export async function registerTestUser(
  client: TestClient,
  overrides: Partial<{ username: string; email: string; password: string }> = {},
): Promise<{ username: string; email: string; password: string; id: string }> {
  userSeq += 1;
  const suffix = `${Date.now().toString(36)}${userSeq}`;
  const creds = {
    username: overrides.username ?? `farmer${suffix}`,
    email: overrides.email ?? `farmer${suffix}@example.test`,
    password: overrides.password ?? 'a long enough passphrase',
  };

  const res = await client.post('/api/auth/register', creds);
  if (res.status !== 201) {
    throw new Error(`registration failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { ...creds, id: res.body.player.id };
}

let keySeq = 0;

/** A fresh idempotency key. Reuse one deliberately to test replay. */
export function newKey(prefix = 'test'): string {
  keySeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${keySeq}`;
}
