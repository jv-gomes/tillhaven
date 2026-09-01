import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb, insertTestPlayer } from '../../test/helpers.js';
import {
  createSession,
  resolveSession,
  revokeSession,
  revokeAllSessionsFor,
  pruneSessions,
  safeEqual,
  SESSION_TTL_MS,
} from './session.js';
import { DAY } from '@tillhaven/shared';

const NOW = 1_700_000_000_000;

beforeEach(resetDb);
afterAll(closeDb);

describe('createSession', () => {
  it('returns a token that resolves back to the player', async () => {
    const player = await insertTestPlayer();
    const { rawToken, expiresAt } = await createSession(player.id, NOW);

    expect(expiresAt).toBe(NOW + SESSION_TTL_MS);
    const resolved = await resolveSession(rawToken, NOW);
    expect(resolved?.playerId).toBe(player.id);
  });

  it('uses a token with at least 256 bits of entropy', async () => {
    const player = await insertTestPlayer();
    const { rawToken } = await createSession(player.id, NOW);
    // base64url of 32 bytes, unpadded.
    expect(Buffer.from(rawToken, 'base64url').length).toBe(32);
  });

  it('never issues the same token twice', async () => {
    const player = await insertTestPlayer();
    const tokens = new Set<string>();
    for (let i = 0; i < 25; i++) {
      tokens.add((await createSession(player.id, NOW)).rawToken);
    }
    expect(tokens.size).toBe(25);
  });

  /*
   * The point of the whole design: a database dump must not contain anything
   * that can be replayed as a login.
   */
  it('stores a hash, never the raw token', async () => {
    const player = await insertTestPlayer();
    const { rawToken } = await createSession(player.id, NOW);

    const rows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.playerId, player.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(rawToken);
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{64}$/);
    // And the raw token appears nowhere in the row at all.
    expect(JSON.stringify(rows[0])).not.toContain(rawToken);
  });

  it('allows a player several concurrent sessions', async () => {
    const player = await insertTestPlayer();
    const a = await createSession(player.id, NOW);
    const b = await createSession(player.id, NOW);

    expect((await resolveSession(a.rawToken, NOW))?.playerId).toBe(player.id);
    expect((await resolveSession(b.rawToken, NOW))?.playerId).toBe(player.id);
  });
});

describe('resolveSession', () => {
  it('returns null for an unknown token', async () => {
    expect(await resolveSession('not-a-real-token', NOW)).toBeNull();
  });

  it('returns null for an empty token without querying', async () => {
    expect(await resolveSession('', NOW)).toBeNull();
  });

  it('returns null once expired', async () => {
    const player = await insertTestPlayer();
    const { rawToken } = await createSession(player.id, NOW);

    // Valid one millisecond before expiry, gone at expiry.
    expect(await resolveSession(rawToken, NOW + SESSION_TTL_MS - 1)).not.toBeNull();
    expect(await resolveSession(rawToken, NOW + SESSION_TTL_MS)).toBeNull();
    expect(await resolveSession(rawToken, NOW + SESSION_TTL_MS + DAY)).toBeNull();
  });

  it('returns null once revoked', async () => {
    const player = await insertTestPlayer();
    const { rawToken } = await createSession(player.id, NOW);

    await revokeSession(rawToken, NOW + 1000);
    expect(await resolveSession(rawToken, NOW + 2000)).toBeNull();
  });

  it('does not accept the stored hash as if it were the token', async () => {
    const player = await insertTestPlayer();
    await createSession(player.id, NOW);
    const [row] = await db.select().from(schema.sessions);

    // Someone holding the database still cannot log in with what is in it.
    expect(await resolveSession(row!.id, NOW)).toBeNull();
  });
});

describe('revokeSession', () => {
  it('is idempotent', async () => {
    const player = await insertTestPlayer();
    const { rawToken } = await createSession(player.id, NOW);

    await revokeSession(rawToken, NOW + 1000);
    await expect(revokeSession(rawToken, NOW + 2000)).resolves.toBeUndefined();

    // The first revocation timestamp is kept, not overwritten.
    const [row] = await db.select().from(schema.sessions);
    expect(row!.revokedAt).toBe(NOW + 1000);
  });

  it('does not throw for an unknown or empty token', async () => {
    await expect(revokeSession('nope', NOW)).resolves.toBeUndefined();
    await expect(revokeSession('', NOW)).resolves.toBeUndefined();
  });

  it('only revokes the session it was given', async () => {
    const player = await insertTestPlayer();
    const a = await createSession(player.id, NOW);
    const b = await createSession(player.id, NOW);

    await revokeSession(a.rawToken, NOW + 1000);

    expect(await resolveSession(a.rawToken, NOW + 2000)).toBeNull();
    expect(await resolveSession(b.rawToken, NOW + 2000)).not.toBeNull();
  });
});

describe('revokeAllSessionsFor', () => {
  it('kills every live session for one player and leaves others alone', async () => {
    const alice = await insertTestPlayer();
    const bob = await insertTestPlayer();

    const a1 = await createSession(alice.id, NOW);
    const a2 = await createSession(alice.id, NOW);
    const b1 = await createSession(bob.id, NOW);

    await revokeAllSessionsFor(alice.id, NOW + 1000);

    expect(await resolveSession(a1.rawToken, NOW + 2000)).toBeNull();
    expect(await resolveSession(a2.rawToken, NOW + 2000)).toBeNull();
    expect(await resolveSession(b1.rawToken, NOW + 2000)).not.toBeNull();
  });
});

describe('pruneSessions', () => {
  it('removes long-dead rows but keeps live ones', async () => {
    const player = await insertTestPlayer();
    const live = await createSession(player.id, NOW);
    await createSession(player.id, NOW - SESSION_TTL_MS - 30 * DAY);

    expect(await db.select().from(schema.sessions)).toHaveLength(2);
    await pruneSessions(NOW);

    const left = await db.select().from(schema.sessions);
    expect(left).toHaveLength(1);
    expect(await resolveSession(live.rawToken, NOW)).not.toBeNull();
  });
});

describe('safeEqual', () => {
  it('compares correctly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
