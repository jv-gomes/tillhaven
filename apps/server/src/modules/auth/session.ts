import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db, schema } from '../../db/client.js';
import type { Queryable } from '../../db/tx.js';
import { DAY } from '@tillhaven/shared';

/**
 * Sessions (CLAUDE.md §8).
 *
 * The raw token exists in exactly two places: the Set-Cookie header, and the
 * player's browser. What the database stores is a SHA-256 of it. A leaked
 * database dump is therefore a pile of useless hashes rather than a pile of
 * live logins.
 *
 * SHA-256 is the right primitive here even though argon2 is right for
 * passwords: the token is 256 bits of CSPRNG output with no structure to
 * guess, so there is nothing for a slow hash to defend against, and session
 * lookup happens on every single request.
 */

export const SESSION_COOKIE = 'th_session';
export const SESSION_TTL_MS = 30 * DAY;

/** 32 bytes = 256 bits. Never Math.random — it is not a CSPRNG. */
const TOKEN_BYTES = 32;

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export interface CreatedSession {
  /** Goes in the cookie. Never store, log, or return this from an endpoint. */
  readonly rawToken: string;
  readonly expiresAt: number;
}

export async function createSession(
  playerId: string,
  now: number,
  tx: Queryable = db,
): Promise<CreatedSession> {
  const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = now + SESSION_TTL_MS;

  await tx.insert(schema.sessions).values({
    id: hashToken(rawToken),
    playerId,
    createdAt: now,
    expiresAt,
  });

  return { rawToken, expiresAt };
}

export interface ResolvedSession {
  readonly playerId: string;
  readonly expiresAt: number;
}

/**
 * Resolves a raw cookie value to a live session, or null.
 *
 * Returns null identically for: no such session, expired, and revoked. The
 * caller cannot distinguish them, and neither can an attacker.
 */
export async function resolveSession(
  rawToken: string,
  now: number,
): Promise<ResolvedSession | null> {
  if (!rawToken) return null;

  const rows = await db
    .select({
      playerId: schema.sessions.playerId,
      expiresAt: schema.sessions.expiresAt,
      revokedAt: schema.sessions.revokedAt,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, hashToken(rawToken)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt <= now) return null;

  return { playerId: row.playerId, expiresAt: row.expiresAt };
}

/**
 * Revokes a session by its raw token. Idempotent: revoking an already-revoked
 * or nonexistent session is a no-op, not an error.
 */
export async function revokeSession(rawToken: string, now: number): Promise<void> {
  if (!rawToken) return;

  await db
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.sessions.id, hashToken(rawToken)),
        isNull(schema.sessions.revokedAt),
      ),
    );
}

/** Revokes every live session for a player — used on password change or abuse. */
export async function revokeAllSessionsFor(
  playerId: string,
  now: number,
  tx: Queryable = db,
): Promise<void> {
  await tx
    .update(schema.sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.sessions.playerId, playerId),
        isNull(schema.sessions.revokedAt),
      ),
    );
}

/**
 * Deletes sessions that are long dead. Purely housekeeping — expiry and
 * revocation are already enforced on read, so this never changes behaviour.
 */
export async function pruneSessions(now: number): Promise<void> {
  const cutoff = now - 7 * DAY;
  await db
    .delete(schema.sessions)
    .where(
      or(
        lt(schema.sessions.expiresAt, cutoff),
        lt(schema.sessions.revokedAt, cutoff),
      ),
    );
}

/**
 * Constant-time string comparison, for anywhere a secret is compared outside
 * the database (the Stripe webhook signature check in Phase 5 will want it).
 * Session lookup itself goes through an indexed equality on a hash, which is
 * not a timing oracle worth defending.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
