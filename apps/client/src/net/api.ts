import { isApiError, type ApiError } from '@tillhaven/shared';
import { apiUrl } from './origin.js';

/**
 * Thin wrapper over the REST API.
 *
 * The client sends INTENTS and renders whatever the server says came of them.
 * It never decides an outcome (CLAUDE.md §4.1). Session state lives in an
 * httpOnly cookie, so there is no token to hold here — `credentials: 'include'`
 * is what carries it.
 *
 * The URL comes from `origin.ts` rather than being written `/api...` here: the
 * client and the API are deployed to different origins now, and that module is
 * the one place that knows where the API is.
 */

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, string | number> | undefined;

  constructor(status: number, body: ApiError) {
    super(body.error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    // A network failure is not a game error; say so plainly rather than
    // inventing a code the server never sent.
    throw new ApiRequestError(0, {
      error: { code: 'NETWORK', message: 'Could not reach the server.' },
    });
  }

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    if (isApiError(parsed)) throw new ApiRequestError(res.status, parsed);
    throw new ApiRequestError(res.status, {
      error: { code: 'INTERNAL', message: 'Something went wrong.' },
    });
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body),
};

/**
 * Idempotency key for a state-changing intent (CLAUDE.md §4.5). Generate one
 * per user action and reuse it across retries of THAT action, so a resubmitted
 * harvest cannot double-reward.
 */
export function idempotencyKey(): string {
  return crypto.randomUUID();
}
