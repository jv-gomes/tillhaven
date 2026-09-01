import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { GameError, ErrorCode, type Appearance } from '@tillhaven/shared';
import { db, schema } from '../db/client.js';
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS } from '../modules/auth/session.js';
import { env } from '../env.js';

/**
 * Resolves the session cookie to a player on every request (CLAUDE.md §8).
 *
 * Ownership is never taken from a client-supplied id. `request.player.id` is
 * the only identity the rest of the server trusts, and it comes from a cookie
 * the server itself signed the contents of.
 */

export interface AuthedPlayer {
  readonly id: string;
  readonly username: string;
  /** Only ever returned to the owning player, via toSelfPlayer. */
  readonly email: string;
  readonly gold: number;
  /** Purchased bag size (T-10.03). Slots come from `BACKPACK_TIERS`. */
  readonly backpackTier: number;
  /**
   * Lifetime experience. The farm LEVEL is derived from this by `farmLevelOf`
   * and is never stored — see modules/farm/level.ts for why.
   */
  readonly experience: number;
  readonly vipUntil: number | null;
  /** Set on refund or chargeback. Blocks VIP benefits and trading (§7). */
  readonly flaggedAt: number | null;
  readonly createdAt: number;
  /** Parsed from the `appearance` JSON column. Null until the character creator runs. */
  readonly appearance: Appearance | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only when a live session resolved. Never set from a body field. */
    player?: AuthedPlayer;
  }
}

/**
 * Attaches `request.player` when the cookie resolves, and does nothing when it
 * does not. Routes that require a player use `requireAuth` below; routes that
 * merely behave differently when signed in can read `request.player` directly.
 */
export async function attachPlayer(request: FastifyRequest): Promise<void> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return;

  const session = await resolveSession(raw, Date.now());
  // Expired, revoked, or forged — all indistinguishable, and all simply leave
  // `request.player` unset.
  if (!session) return;

  const rows = await db
    .select({
      id: schema.players.id,
      username: schema.players.username,
      email: schema.players.email,
      gold: schema.players.gold,
      backpackTier: schema.players.backpackTier,
      experience: schema.players.experience,
      vipUntil: schema.players.vipUntil,
      flaggedAt: schema.players.flaggedAt,
      createdAt: schema.players.createdAt,
      appearance: schema.players.appearance,
    })
    .from(schema.players)
    .where(eq(schema.players.id, session.playerId))
    .limit(1);

  const row = rows[0];
  // A session whose player row is gone is not a session.
  if (!row) return;

  request.player = { ...row, appearance: parseAppearance(row.appearance) };
}

/**
 * The column stores whatever `appearanceSchema.parse` accepted at write time
 * (T-8.01), so a parse failure here means the row predates the column or was
 * touched outside the app — not a case worth 500ing every request over.
 * Treated the same as "creator not run yet."
 */
export function parseAppearance(raw: string | null): Appearance | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Appearance;
  } catch {
    return null;
  }
}

/**
 * preHandler for anything that needs a signed-in player.
 *
 * Every failure mode — missing cookie, malformed cookie, expired session,
 * revoked session, deleted player — produces the same `UNAUTHENTICATED`. The
 * caller learns only that they are not signed in.
 */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.player) {
    throw new GameError(ErrorCode.UNAUTHENTICATED, 'Sign in to do that.');
  }
}

/**
 * Narrowing accessor. Route handlers call this instead of `request.player!`,
 * so a route that forgets its `requireAuth` preHandler fails loudly here
 * rather than dereferencing undefined somewhere deeper.
 */
export function currentPlayer(request: FastifyRequest): AuthedPlayer {
  const player = request.player;
  if (!player) {
    throw new GameError(ErrorCode.UNAUTHENTICATED, 'Sign in to do that.');
  }
  return player;
}

/** Set the session cookie. The only place cookie flags are decided. */
export function setSessionCookie(reply: FastifyReply, rawToken: string): void {
  reply.setCookie(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    // Not signed: the value is already an unguessable 256-bit random token
    // checked against the database. A signature would add nothing.
    signed: false,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
