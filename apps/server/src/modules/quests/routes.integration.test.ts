import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  ErrorCode,
  dailyRequestId,
  obtainableAtLevel,
  questById,
  rotationIndexAt,
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
 * The quest endpoints (T-33.05).
 *
 * Driven through `app.inject` rather than the service, because the layers this
 * task adds — Zod, the rate limit, `requireAuth`, `runIdempotent` and the error
 * handler — are exactly the ones a service-level test skips.
 *
 * The four cases the task names are the four that decide whether this system can
 * destroy or mint value: turning in without the goods, a partial shortfall,
 * turning in twice concurrently, and reaching for somebody else's row.
 */

let client: TestClient;
let playerId: string;

const FIRST = questById('chef_first_basket')!;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;
});

afterAll(closeDb);

/** Puts items straight into the player's bag, bypassing the game. */
async function give(itemId: string, quantity: number): Promise<void> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(${schema.inventoryItems.slotIndex}), -1)::int` })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.playerId, playerId));

  await db.insert(schema.inventoryItems).values({
    playerId,
    container: 'inventory',
    slotIndex: (row?.n ?? -1) + 1,
    itemId,
    quantity,
  });
}

async function held(itemId: string): Promise<number> {
  const rows = await db
    .select({ q: schema.inventoryItems.quantity, i: schema.inventoryItems.itemId })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.playerId, playerId));
  return rows.filter((r) => r.i === itemId).reduce((n, r) => n + r.q, 0);
}

async function gold(): Promise<number> {
  const [p] = await db
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, playerId));
  return p!.gold;
}

async function accept(questId: string): Promise<TestResponse> {
  return client.post('/api/quests/accept', { questId, idempotencyKey: newKey() });
}

describe('GET /api/quests', () => {
  it('offers a brand-new farm something it can actually do', async () => {
    const res = await client.get('/api/quests');

    expect(res.status).toBe(200);
    expect(res.body.quests.length).toBeGreaterThan(0);
    expect(res.body.quests.every((q: { status: string }) => q.status === 'available')).toBe(true);
  });

  /**
   * The board's whole promise (T-33.06): never ask for what the player cannot
   * get. At level 1 that means nothing gated above level 1 may appear.
   */
  it('hides quests the farm has not levelled into', async () => {
    const res = await client.get('/api/quests');
    const shown = res.body.quests as { id: string; unlockLevel: number }[];

    expect(shown.every((q) => q.unlockLevel <= 1)).toBe(true);
    expect(shown.some((q) => q.id === 'merchant_the_road')).toBe(false);
  });

  it('carries everything a panel needs, so the client needs no second source', async () => {
    const res = await client.get('/api/quests');
    const first = res.body.quests[0];

    expect(first).toMatchObject({
      id: expect.any(String),
      giver: expect.any(String),
      title: expect.any(String),
      summary: expect.any(String),
      status: 'available',
    });
    expect(Array.isArray(first.requires)).toBe(true);
  });
});

describe('POST /api/quests/accept', () => {
  it('takes a quest on and shows it as held', async () => {
    expect((await accept(FIRST.id)).status).toBe(200);

    const res = await client.get('/api/quests');
    const mine = res.body.quests.find((q: { id: string }) => q.id === FIRST.id);
    expect(mine.status).toBe('accepted');
  });

  it('refuses a quest the farm has not levelled into', async () => {
    const res = await accept('merchant_the_road');

    expect(res.status).toBe(409);
    expect(res.code).toBe(ErrorCode.QUEST_NOT_AVAILABLE);
  });

  it('refuses a quest that does not exist', async () => {
    const res = await accept('chef_the_moon');
    expect(res.status).toBe(404);
  });

  it('refuses to take the same quest on twice', async () => {
    await accept(FIRST.id);
    const again = await accept(FIRST.id);

    expect(again.status).toBe(409);
    expect(again.code).toBe(ErrorCode.QUEST_ALREADY_ACCEPTED);
  });

  it('accepts once when two distinct requests arrive together', async () => {
    const results = await Promise.all([accept(FIRST.id), accept(FIRST.id)]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const rows = await db
      .select()
      .from(schema.questProgress)
      .where(eq(schema.questProgress.playerId, playerId));
    expect(rows).toHaveLength(1);
  });
});

describe('POST /api/quests/turn-in', () => {
  async function turnIn(questId = FIRST.id): Promise<TestResponse> {
    return client.post('/api/quests/turn-in', { questId, idempotencyKey: newKey() });
  }

  it('consumes the goods and pays, in one go', async () => {
    await accept(FIRST.id);
    await give('leek', 4);

    const res = await turnIn();

    expect(res.status).toBe(200);
    expect(await held('leek')).toBe(0);
    expect(await held('potato_seeds')).toBe(4);
  });

  /**
   * **Turning in without the goods must consume nothing**, which is only
   * interesting if the player holds SOME of what was asked — a player with an
   * empty bag cannot tell a careful refusal from a lucky one.
   */
  it('refuses without the goods and consumes nothing', async () => {
    await accept(FIRST.id);
    await give('leek', 3); // one short

    const res = await turnIn();

    expect(res.status).toBe(409);
    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await held('leek')).toBe(3);
    expect(await held('potato_seeds')).toBe(0);
  });

  /**
   * **Partial failure grants nothing and consumes nothing.** The two-item quest
   * is the one that can fail halfway: hold all the carrots and none of the
   * potatoes, and a turn-in that consumed as it went would eat the carrots and
   * then refuse.
   */
  it('takes nothing when only part of a multi-item quest is held', async () => {
    // Level 2 is needed for this one; XP is the only way in (§4.1 — no
    // client-settable level), so it is written straight to the row.
    await db
      .update(schema.players)
      .set({ experience: 100_000 })
      .where(eq(schema.players.id, playerId));

    const roots = questById('chef_root_veg')!;
    expect((await accept(roots.id)).status).toBe(200);

    await give('carrot', 6);
    await give('potato', 1); // three are needed

    const goldBefore = await gold();
    const res = await turnIn(roots.id);

    expect(res.status).toBe(409);
    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await held('carrot'), 'the carrots were eaten by a failed turn-in').toBe(6);
    expect(await held('potato')).toBe(1);
    expect(await gold()).toBe(goldBefore);

    // And the completion the service claims BEFORE consuming must have rolled
    // back with everything else, or the quest is dead in the player's log.
    const [row] = await db
      .select({ completedAt: schema.questProgress.completedAt })
      .from(schema.questProgress)
      .where(eq(schema.questProgress.playerId, playerId));
    expect(row!.completedAt, 'the quest was marked done by a turn-in that failed').toBeNull();
  });

  /**
   * **The turn-in must work with a completely full bag**, and this is the test
   * that makes the consume-then-grant ordering load-bearing rather than merely
   * tidy.
   *
   * Break-testing found the ordering was not covered: swapping `grantReward`
   * ahead of `removeItem` passed all nineteen other tests, because the
   * transaction rolls back either way and no value is ever at risk. The
   * difference is not safety, it is whether the quest is *completable*. Hand
   * over four leeks from a full backpack and the slot they vacate is exactly
   * where the reward goes — grant first and `INVENTORY_FULL` fires on a bag the
   * player was about to make room in.
   */
  it('can be handed in from a completely full backpack', async () => {
    await accept(FIRST.id);

    // Twelve slots at tier 0. One holds the leeks the quest wants; the rest are
    // filled with something that is neither asked for nor granted.
    await give('leek', 4);
    for (let i = 0; i < 11; i++) await give('wood', 1 + i);

    const res = await turnIn();

    expect(
      res.status,
      'a full bag refused a turn-in that would have made room for itself',
    ).toBe(200);
    expect(await held('leek')).toBe(0);
    expect(await held('potato_seeds')).toBe(4);
  });

  it('refuses a quest that was never accepted', async () => {
    await give('leek', 4);
    const res = await turnIn();

    expect(res.status).toBe(409);
    expect(res.code).toBe(ErrorCode.QUEST_NOT_ACCEPTED);
    expect(await held('leek')).toBe(4);
  });

  it('refuses a second turn-in', async () => {
    await accept(FIRST.id);
    await give('leek', 8);
    expect((await turnIn()).status).toBe(200);

    const again = await turnIn();
    expect(again.status).toBe(409);
    expect(again.code).toBe(ErrorCode.QUEST_ALREADY_COMPLETED);
    // The four left over must still be there.
    expect(await held('leek')).toBe(4);
  });

  /**
   * **Turning in twice grants once — tested concurrently**, which is the case a
   * sequential test cannot see. Two open tabs, two distinct idempotency keys, so
   * `runIdempotent` does not collapse them: the only thing standing between the
   * player and a double payment is the conditional update.
   */
  it('pays once when two distinct turn-ins arrive together', async () => {
    await accept(FIRST.id);
    await give('leek', 8); // enough for two, so a double-pay is possible

    const results = await Promise.all([turnIn(), turnIn()]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await held('potato_seeds'), 'paid twice').toBe(4);
    expect(await held('leek'), 'consumed twice').toBe(4);
  });

  /**
   * A retry of the SAME request — a flaky connection rather than two tabs —
   * returns the first response instead of a confusing refusal (§4.5).
   */
  it('returns the first answer to a retried request', async () => {
    await accept(FIRST.id);
    await give('leek', 8);

    const key = newKey();
    const first = await client.post('/api/quests/turn-in', { questId: FIRST.id, idempotencyKey: key });
    const retry = await client.post('/api/quests/turn-in', { questId: FIRST.id, idempotencyKey: key });

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(await held('potato_seeds'), 'a retry paid a second time').toBe(4);
    expect(await held('leek')).toBe(4);
  });
});

/**
 * **Another player's quest row is refused** — and the mechanism is that it
 * cannot be named. Neither payload carries a player id, so the only row either
 * endpoint can touch is the one belonging to the session cookie.
 */
describe('one player cannot reach another player\'s quests', () => {
  it('does not let a second player turn in the first player\'s accepted quest', async () => {
    await accept(FIRST.id);
    await give('leek', 4);

    const other = await createTestClient();
    await registerTestUser(other, { username: 'someoneelse' });

    const res = await other.post('/api/quests/turn-in', {
      questId: FIRST.id,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(409);
    expect(res.code).toBe(ErrorCode.QUEST_NOT_ACCEPTED);

    // The first player's row is untouched, and their leeks are still theirs.
    const [row] = await db
      .select({ completedAt: schema.questProgress.completedAt })
      .from(schema.questProgress)
      .where(eq(schema.questProgress.playerId, playerId));
    expect(row!.completedAt).toBeNull();
    expect(await held('leek')).toBe(4);
  });

  it('shows each player only their own progress', async () => {
    await accept(FIRST.id);

    const other = await createTestClient();
    await registerTestUser(other, { username: 'anotherfarm' });

    const theirs = await other.get('/api/quests');
    const mine = theirs.body.quests.find((q: { id: string }) => q.id === FIRST.id);
    expect(mine.status).toBe('available');
  });
});

/**
 * T-33.06's three promises, at the endpoint rather than in the pure function —
 * because "refreshing does not re-roll" is a claim about the HTTP surface, and a
 * board that recomputed its seed per request would still pass a pure test that
 * only ever calls the function once per assertion.
 */
describe('the rotating half of the board', () => {
  it('gives the same board to two identical requests', async () => {
    const first = await client.get('/api/quests');
    const second = await client.get('/api/quests');

    const ids = (r: typeof first) =>
      (r.body.quests as { id: string; rotating: boolean }[])
        .filter((q) => q.rotating)
        .map((q) => `${q.id}`);

    expect(ids(first).length).toBeGreaterThan(0);
    expect(ids(second), 'refreshing re-rolled the board').toEqual(ids(first));

    // And the asks themselves, not only the ids.
    expect(second.body.quests).toEqual(first.body.quests);
  });

  it('tells the client when the rotation turns over, rather than making it guess', async () => {
    const res = await client.get('/api/quests');
    expect(typeof res.body.rotationEndsAt).toBe('number');
    expect(res.body.rotationEndsAt).toBeGreaterThan(Date.now());
  });

  it('only ever asks a new farm for what a new farm can grow', async () => {
    const res = await client.get('/api/quests');
    const rotating = res.body.quests.filter((q: { rotating: boolean }) => q.rotating);

    expect(rotating.length).toBeGreaterThan(0);
    for (const request of rotating) {
      for (const need of request.requires) {
        expect(
          obtainableAtLevel(need.itemId, 1),
          `a level-1 board asked for ${need.itemId}`,
        ).toBe(true);
      }
    }
  });

  it('can be accepted and turned in like any other request', async () => {
    const res = await client.get('/api/quests');
    const request = res.body.quests.find((q: { rotating: boolean }) => q.rotating);
    const need = request.requires[0];

    expect((await accept(request.id)).status).toBe(200);
    await give(need.itemId, need.quantity);

    const goldBefore = await gold();
    const done = await client.post('/api/quests/turn-in', {
      questId: request.id,
      idempotencyKey: newKey(),
    });

    expect(done.status).toBe(200);
    expect(await held(need.itemId)).toBe(0);
    expect(await gold()).toBe(goldBefore + request.reward.gold);
  });

  /**
   * **A stale offer refuses itself.** The rotation index is in the id, so an id
   * kept from an earlier board resolves to nothing — no stored history of what
   * used to be on offer, and nothing for a client to replay.
   */
  it('refuses an offer from a rotation that has passed', async () => {
    const past = dailyRequestId(rotationIndexAt(Date.now()) - 1, 0);
    const res = await accept(past);

    expect(res.status).toBe(404);
  });

  it('refuses an offer from a rotation that has not arrived', async () => {
    const future = dailyRequestId(rotationIndexAt(Date.now()) + 1, 0);
    expect((await accept(future)).status).toBe(404);
  });

  /**
   * **The rotation cannot be farmed.** Accepting and then asking again must not
   * change what else is on offer — the seed has no term a player controls.
   */
  it('does not change what is offered when a request is accepted', async () => {
    const before = await client.get('/api/quests');
    const rotating = before.body.quests.filter((q: { rotating: boolean }) => q.rotating);

    await accept(rotating[0].id);

    const after = await client.get('/api/quests');
    const stillRotating = after.body.quests.filter((q: { rotating: boolean }) => q.rotating);

    expect(stillRotating.map((q: { id: string }) => q.id)).toEqual(
      rotating.map((q: { id: string }) => q.id),
    );
    expect(stillRotating.map((q: { requires: unknown }) => q.requires)).toEqual(
      rotating.map((q: { requires: unknown }) => q.requires),
    );
  });

  it('gives two different players different boards', async () => {
    const mine = await client.get('/api/quests');

    const other = await createTestClient();
    await registerTestUser(other, { username: 'secondfarm' });
    const theirs = await other.get('/api/quests');

    const asks = (r: typeof mine) =>
      r.body.quests.filter((q: { rotating: boolean }) => q.rotating).map((q: any) => q.requires);

    expect(asks(theirs)).not.toEqual(asks(mine));
  });
});

/**
 * **The trade gate is a security control, and this is the test that keeps it
 * one** (T-33.08).
 *
 * `config/level.ts` states the rule the whole anti-alt design rests on:
 * *experience is bought with time, never with gold*. A scammer cannot buy their
 * way to `TRADE_MIN_FARM_LEVEL`; they have to wait. Quests are the first system
 * since that was written that pays a player for an ACTION rather than for a
 * wait, so they are the first thing that could break it.
 *
 * They do not — `turnInQuest` calls `grantXp(…, 0)`, a read dressed as a grant
 * so every paying action returns the same shape. But that is one argument away
 * from being changed by a future task that thinks a quest ought to pay XP, and
 * the argument would not be wrong on its own terms. Recording it as a test
 * rather than a comment is what makes that a decision somebody has to reopen.
 */
describe('quests pay no experience, because experience is bought with time', () => {
  it('leaves experience untouched by a turn-in', async () => {
    await accept(FIRST.id);
    await give('leek', 4);

    const before = await db
      .select({ experience: schema.players.experience })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));

    const res = await client.post('/api/quests/turn-in', {
      questId: FIRST.id,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(res.body.experience, 'a quest paid experience').toBe(before[0]!.experience);

    const after = await db
      .select({ experience: schema.players.experience })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));
    expect(after[0]!.experience).toBe(before[0]!.experience);
  });

  it('leaves experience untouched by a rotating request too', async () => {
    const board = await client.get('/api/quests');
    const request = board.body.quests.find((q: { rotating: boolean }) => q.rotating);
    const need = request.requires[0];

    await accept(request.id);
    await give(need.itemId, need.quantity);

    const [before] = await db
      .select({ experience: schema.players.experience })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));

    const res = await client.post('/api/quests/turn-in', {
      questId: request.id,
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(res.body.experience).toBe(before!.experience);
  });
});

describe('the endpoints are guarded', () => {
  it('requires a session', async () => {
    const anon = await createTestClient();
    expect((await anon.get('/api/quests')).status).toBe(401);
    expect(
      (await anon.post('/api/quests/accept', { questId: FIRST.id, idempotencyKey: newKey() }))
        .status,
    ).toBe(401);
  });

  it('validates the payload', async () => {
    const res = await client.post('/api/quests/accept', { idempotencyKey: newKey() });
    expect(res.status).toBe(400);
  });
});
