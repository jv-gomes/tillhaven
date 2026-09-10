import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  BITE_MAX_MS,
  BITE_MIN_MS,
  ENERGY_COST,
  EnergyAction,
  ErrorCode,
  FISH_IDS,
  REEL_WINDOW_MS,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import {
  createTestClient,
  registerTestUser,
  newKey,
  type TestClient,
  type TestResponse,
} from '../../test/app.js';

/**
 * The cast endpoint (T-34.02).
 *
 * **The tests that matter are about what is NOT in the response.** A client that
 * learns the fish can throw back the ones it does not want; a client that learns
 * the seed can predict every future cast. Both defeat the rarity system by
 * refresh, and neither would show up as a bug in anything a player could see.
 */

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;
});

afterAll(closeDb);

const cast = (): Promise<TestResponse> =>
  client.post('/api/fishing/cast', { idempotencyKey: newKey() });

async function energySpent(): Promise<number> {
  const [p] = await db
    .select({ spent: schema.players.energySpent })
    .from(schema.players)
    .where(eq(schema.players.id, playerId));
  return p!.spent;
}

async function openCasts(): Promise<{ fishId: string; biteAt: number; castAt: number }[]> {
  return db
    .select({
      fishId: schema.casts.fishId,
      biteAt: schema.casts.biteAt,
      castAt: schema.casts.castAt,
    })
    .from(schema.casts)
    .where(eq(schema.casts.playerId, playerId));
}

describe('POST /api/fishing/cast', () => {
  it('puts a line in the water and says when to animate', async () => {
    const res = await cast();

    expect(res.status).toBe(200);
    expect(typeof res.body.castId).toBe('string');
    expect(typeof res.body.biteAt).toBe('number');
  });

  /**
   * **The headline security property.** Everything the client is not allowed to
   * know, checked against the serialised body rather than against named fields —
   * a future addition that leaked the fish under a different key would slip past
   * a field-by-field check.
   */
  it('tells the client nothing about the fish, the seed or the window', async () => {
    const res = await cast();
    const body = JSON.stringify(res.body);

    expect(Object.keys(res.body).sort()).toEqual(['biteAt', 'castId']);

    for (const id of FISH_IDS) {
      expect(body, `the response leaks the fish id "${id}"`).not.toContain(id);
    }
    expect(body).not.toContain('seed');
    expect(body).not.toContain('weight');
    expect(body).not.toContain('window');
  });

  /**
   * The fish IS rolled — it exists in the row from the moment of the cast, so
   * the reel is a judgement about the clock and not about the roll. If this
   * moved to reel time, the outcome would depend on when the player clicked.
   */
  it('rolls and stores the fish at cast time', async () => {
    await cast();
    const rows = await openCasts();

    expect(rows).toHaveLength(1);
    expect(FISH_IDS, 'the stored fish is not one this game has').toContain(rows[0]!.fishId);
  });

  it('draws a bite delay inside the declared range', async () => {
    await cast();
    const [row] = await openCasts();
    const delay = row!.biteAt - row!.castAt;

    expect(delay).toBeGreaterThanOrEqual(BITE_MIN_MS);
    expect(delay).toBeLessThanOrEqual(BITE_MAX_MS);
  });

  /**
   * **A range, not a metronome.** A fixed delay makes the player count rather
   * than watch, and the five-stage animation has nothing to say. Twenty casts
   * across twenty players should not all land on the same number.
   */
  it('does not give every cast the same delay', async () => {
    const delays = new Set<number>();

    for (let i = 0; i < 12; i++) {
      const other = await createTestClient();
      const them = await registerTestUser(other, { username: `anglerx${i}` });
      await other.post('/api/fishing/cast', { idempotencyKey: newKey() });
      const [row] = await db
        .select({ biteAt: schema.casts.biteAt, castAt: schema.casts.castAt })
        .from(schema.casts)
        .where(eq(schema.casts.playerId, them.id));
      delays.add(row!.biteAt - row!.castAt);
    }

    expect(delays.size, 'every cast bit at the same moment').toBeGreaterThan(1);
  });

  it('refuses a second cast while the line is out', async () => {
    expect((await cast()).status).toBe(200);

    const second = await cast();
    expect(second.status).toBe(409);
    expect(second.code).toBe(ErrorCode.LINE_ALREADY_OUT);
    expect(await openCasts()).toHaveLength(1);
  });

  it('opens one line when two casts arrive together', async () => {
    const results = await Promise.all([cast(), cast()]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await openCasts()).toHaveLength(1);
  });

  /**
   * **Energy is what makes a bot no better than a person** (T-34.02's third
   * requirement). A rate limit caps requests; energy caps FISHING, and a script
   * hits the same wall a player does.
   */
  it('charges energy for the cast', async () => {
    const before = await energySpent();
    await cast();

    expect(await energySpent()).toBe(before + ENERGY_COST[EnergyAction.CAST]);
  });

  it('refuses to cast when there is no energy, and charges nothing', async () => {
    // Spend the bar down to nothing. Written straight to the row: energy is
    // server state and there is no client path that sets it (§4.1).
    await db
      .update(schema.players)
      .set({ energySpent: 1_000 })
      .where(eq(schema.players.id, playerId));

    const res = await cast();

    expect(res.status).toBe(409);
    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ENERGY);
    expect(await openCasts(), 'a refused cast still put a line in the water').toHaveLength(0);
    expect(await energySpent()).toBe(1_000);
  });

  /**
   * A tired player's REFUSED cast must cost nothing — the energy check runs
   * before the insert, and both are in one transaction, so a failure at either
   * end unwinds the other.
   */
  it('costs nothing when the line is already out', async () => {
    await cast();
    const after = await energySpent();

    await cast(); // refused

    expect(await energySpent(), 'a refused cast still charged energy').toBe(after);
  });

  it('returns the first answer to a retried request', async () => {
    const key = newKey();
    const first = await client.post('/api/fishing/cast', { idempotencyKey: key });
    const retry = await client.post('/api/fishing/cast', { idempotencyKey: key });

    expect(first.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(await openCasts(), 'a retry cast a second line').toHaveLength(1);
  });

  it('requires a session', async () => {
    const anon = await createTestClient();
    const res = await anon.post('/api/fishing/cast', { idempotencyKey: newKey() });
    expect(res.status).toBe(401);
  });

  it('validates the payload', async () => {
    expect((await client.post('/api/fishing/cast', {})).status).toBe(400);
  });

  /**
   * **There is no position in the payload, and a server that accepted one would
   * be the first to treat the character's coordinates as authority** (§4.1,
   * §5.1). Standing at water is a client-side UX gate, exactly like facing a
   * plot to till it.
   */
  it('ignores anything the client says about where it is standing', async () => {
    const res = await client.post('/api/fishing/cast', {
      idempotencyKey: newKey(),
      x: 0,
      y: 0,
      tile: '0,0',
    });

    // Accepted and ignored, or rejected — either is fine. What must NOT happen
    // is the extra fields changing the outcome.
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(Object.keys(res.body).sort()).toEqual(['biteAt', 'castId']);
    }
  });
});

/**
 * Reeling (T-34.03).
 *
 * **The judgement is `now - biteAt`, computed on the server, against a window
 * the client is never told.** This is the one measurement in the game a player
 * is directly rewarded for lying about, which is why the schema refuses the
 * field rather than ignoring it.
 */
describe('POST /api/fishing/reel', () => {
  const reel = (castId: string, extra: Record<string, unknown> = {}): Promise<TestResponse> =>
    client.post('/api/fishing/reel', { castId, idempotencyKey: newKey(), ...extra });

  /** Drags a cast's bite time to `offset` ms from now, so a test need not wait. */
  async function biteAt(castId: string, offset: number): Promise<void> {
    await db
      .update(schema.casts)
      .set({ biteAt: Date.now() + offset })
      .where(eq(schema.casts.id, castId));
  }

  async function held(itemId: string): Promise<number> {
    const rows = await db
      .select({ q: schema.inventoryItems.quantity, i: schema.inventoryItems.itemId })
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.playerId, playerId));
    return rows.filter((r) => r.i === itemId).reduce((n, r) => n + r.q, 0);
  }

  it('lands the fish when the reel is inside the window', async () => {
    const { body } = await cast();
    await biteAt(body.castId, -200); // bit 200ms ago

    const res = await reel(body.castId);

    expect(res.status).toBe(200);
    expect(res.body.landed).toBe(true);
    expect(FISH_IDS).toContain(res.body.fishId);
    expect(await held(res.body.fishId)).toBe(1);
  });

  /**
   * **Reeling before the bite fails, and consumes the cast.** If an early reel
   * left the line in the water, hammering the button would be strictly better
   * than watching for the bite, and the minigame would be a formality attached
   * to a lottery.
   */
  it('fails on an early strike and consumes the cast', async () => {
    const { body } = await cast();
    await biteAt(body.castId, 5_000); // bites in five seconds

    const res = await reel(body.castId);

    expect(res.status).toBe(200);
    expect(res.body.landed).toBe(false);
    expect(res.body.fishId, 'a miss told the client what it lost').toBeNull();

    const [row] = await db
      .select({ reeledAt: schema.casts.reeledAt, landed: schema.casts.landed })
      .from(schema.casts)
      .where(eq(schema.casts.id, body.castId));
    expect(row!.reeledAt, 'an early reel left the line in the water').not.toBeNull();
    expect(row!.landed).toBe(false);
  });

  it('fails cleanly long after the bite', async () => {
    const { body } = await cast();
    await biteAt(body.castId, -REEL_WINDOW_MS - 5_000);

    const res = await reel(body.castId);

    expect(res.status).toBe(200);
    expect(res.body.landed).toBe(false);
    expect(res.body.fishId).toBeNull();
  });

  it('lets the player cast again once the line is reeled', async () => {
    const { body } = await cast();
    await biteAt(body.castId, 5_000);
    await reel(body.castId); // a miss, but the line is now free

    expect((await cast()).status).toBe(200);
  });

  /**
   * **The exploit test.** A client that reports its own reaction time reports a
   * perfect one, so the field must not be accepted at all — a 400 rather than a
   * silent success that leaves the sender believing it counted.
   */
  it('refuses a client-reported reaction time rather than ignoring it', async () => {
    const { body } = await cast();
    await biteAt(body.castId, 5_000); // would be an early strike

    for (const field of [{ reactionMs: 0 }, { elapsedMs: 100 }, { now: Date.now() }]) {
      const res = await reel(body.castId, field);
      expect(res.status, `the schema accepted ${Object.keys(field)[0]}`).toBe(400);
    }

    // And the cast is untouched by the refused attempts.
    const [row] = await db
      .select({ reeledAt: schema.casts.reeledAt })
      .from(schema.casts)
      .where(eq(schema.casts.id, body.castId));
    expect(row!.reeledAt).toBeNull();
  });

  it('refuses a cast that was already reeled', async () => {
    const { body } = await cast();
    await biteAt(body.castId, -200);
    expect((await reel(body.castId)).status).toBe(200);

    const again = await reel(body.castId);
    expect(again.status).toBe(409);
    expect(again.code).toBe(ErrorCode.NO_LINE_OUT);
  });

  it('lands one fish when two reels arrive together', async () => {
    const { body } = await cast();
    await biteAt(body.castId, -200);

    const results = await Promise.all([reel(body.castId), reel(body.castId)]);
    const ok = results.filter((r) => r.status === 200);

    expect(ok).toHaveLength(1);
    expect(await held(ok[0]!.body.fishId)).toBe(1);
  });

  /**
   * Another player's cast is not reelable, and the refusal is the SAME message
   * as "no such cast" — a distinct error would confirm the id is real.
   */
  it('refuses to reel somebody else\'s line', async () => {
    const { body } = await cast();
    await biteAt(body.castId, -200);

    const other = await createTestClient();
    await registerTestUser(other, { username: 'otherangler' });

    const res = await other.post('/api/fishing/reel', {
      castId: body.castId,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe(ErrorCode.NO_LINE_OUT);

    const [row] = await db
      .select({ reeledAt: schema.casts.reeledAt })
      .from(schema.casts)
      .where(eq(schema.casts.id, body.castId));
    expect(row!.reeledAt, "another player reeled this player's line").toBeNull();
  });

  it('refuses a cast id that does not exist', async () => {
    const res = await reel('00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(409);
    expect(res.code).toBe(ErrorCode.NO_LINE_OUT);
  });

  it('rejects a castId that is not a uuid', async () => {
    expect((await reel('not-a-uuid')).status).toBe(400);
  });
});
