import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { ErrorCode, type Appearance } from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * Character appearance storage (T-8.01, CLAUDE.md §5.1).
 *
 * Appearance is purely cosmetic — nothing here checks gold, ownership of an
 * item, or growth. What matters is the same discipline every other endpoint
 * gets: server-side validation of every field, ownership from the session
 * (never a body field), and an idempotency replay that does not re-apply.
 */

let client: TestClient;
let playerId: string;

const VALID: Appearance = {
  skin: 2,
  eyes: { sex: 'female', color: 'blue' },
  hair: { style: 'josh', color: 'ginger' },
  clothes: 'green',
};

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;
});

afterAll(closeDb);

function putAppearance(appearance: unknown, idempotencyKey = newKey()) {
  return client.put('/api/player/appearance', { appearance, idempotencyKey });
}

describe('PUT /api/player/appearance', () => {
  it('requires a session', async () => {
    const anonymous = await createTestClient();
    const res = await anonymous.put('/api/player/appearance', {
      appearance: VALID,
      idempotencyKey: newKey(),
    });
    expect(res.code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });

  it('saves a valid appearance and returns it on the response', async () => {
    const res = await putAppearance(VALID);

    expect(res.status).toBe(200);
    expect(res.body.player.appearance).toEqual(VALID);

    const [row] = await db.select().from(schema.players).where(eq(schema.players.id, playerId));
    expect(JSON.parse(row!.appearance!)).toEqual(VALID);
  });

  it('is null until the creator saves one', async () => {
    const me = await client.get('/api/auth/me');
    expect(me.body.player.appearance).toBeNull();
  });

  it('GET /api/auth/me reflects the saved appearance', async () => {
    await putAppearance(VALID);

    const me = await client.get('/api/auth/me');
    expect(me.body.player.appearance).toEqual(VALID);
  });

  it('replacing a saved appearance with a second call overwrites it', async () => {
    await putAppearance(VALID);
    const second: Appearance = { ...VALID, clothes: 'red' };
    await putAppearance(second);

    const me = await client.get('/api/auth/me');
    expect(me.body.player.appearance).toEqual(second);
  });

  it('is idempotent: a replayed key does not re-apply a later change', async () => {
    const key = newKey();
    const first = await putAppearance(VALID, key);
    expect(first.status).toBe(200);

    // Same key, different body — a naive implementation would apply this one
    // too. The stored idempotency response must win instead.
    const replay = await putAppearance({ ...VALID, clothes: 'purple' }, key);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    const me = await client.get('/api/auth/me');
    expect(me.body.player.appearance).toEqual(VALID);
  });

  it('never lets one player set another’s appearance', async () => {
    await putAppearance(VALID);

    const other = await createTestClient();
    await registerTestUser(other);
    await other.put('/api/player/appearance', {
      appearance: { ...VALID, clothes: 'blue' },
      idempotencyKey: newKey(),
    });

    // The first player's own row is unaffected.
    const me = await client.get('/api/auth/me');
    expect(me.body.player.appearance).toEqual(VALID);
    await other.close();
  });

  describe('rejects out-of-enum values with VALIDATION_FAILED', () => {
    const cases: Record<string, unknown> = {
      'skin out of range': { ...VALID, skin: 5 },
      'unknown eye sex': { ...VALID, eyes: { sex: 'other', color: 'blue' } },
      'unknown eye color': { ...VALID, eyes: { sex: 'male', color: 'purple' } },
      'unknown hair style': { ...VALID, hair: { style: 'zelda', color: 'black' } },
      'unknown hair color': { ...VALID, hair: { style: 'josh', color: 'red' } },
      'unknown clothes color': { ...VALID, clothes: 'yellow' },
      'missing field': { ...VALID, clothes: undefined },
    };

    for (const [name, bad] of Object.entries(cases)) {
      it(name, async () => {
        const res = await putAppearance(bad);
        expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
      });
    }
  });

  it('rejects a missing idempotency key', async () => {
    const res = await client.put('/api/player/appearance', { appearance: VALID });
    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
