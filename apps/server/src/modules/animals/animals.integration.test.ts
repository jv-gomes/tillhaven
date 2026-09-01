import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import {
  ANIMALS,
  BARN_TIERS,
  COOP_TIERS,
  BASE_INVENTORY_SLOTS,
  DAY,
  ErrorCode,
  HOUR,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * Buying, collecting and feeding, over the real stack.
 *
 * The production arithmetic is covered exhaustively and purely in
 * `production.test.ts`. What matters here is the part that touches rows: that
 * gold and animals move together, that a full bag leaves the produce with the
 * animal, and that an animal is never destroyed by anything.
 */

const CHICKEN = ANIMALS.chicken;
const COW = ANIMALS.cow;

/** Starting caps — tier 0 of each building, no VIP (T-12.02). */
const COOP_CAP = COOP_TIERS[0]!.cap;
const BARN_CAP = BARN_TIERS[0]!.cap;

let client: TestClient;
let playerId: string;
let farmId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  const [farm] = await db.select().from(schema.farms).where(eq(schema.farms.playerId, playerId));
  farmId = farm!.id;

  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, playerId));
  await setGold(1_000_000);
});

afterAll(closeDb);

async function setGold(gold: number): Promise<void> {
  await db.update(schema.players).set({ gold }).where(eq(schema.players.id, playerId));
}

async function gold(): Promise<number> {
  const [row] = await db
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, playerId));
  return row!.gold;
}

async function held(itemId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.playerId, playerId),
        eq(schema.inventoryItems.itemId, itemId),
      ),
    );
  return rows.reduce((sum, r) => sum + r.quantity, 0);
}

async function give(itemId: string, quantity: number): Promise<void> {
  const existing = await db
    .select({ slotIndex: schema.inventoryItems.slotIndex })
    .from(schema.inventoryItems)
    .where(
      and(
        eq(schema.inventoryItems.playerId, playerId),
        eq(schema.inventoryItems.container, 'inventory'),
      ),
    );

  const used = new Set(existing.map((s) => s.slotIndex));
  let slotIndex = 0;
  while (used.has(slotIndex)) slotIndex += 1;

  await db
    .insert(schema.inventoryItems)
    .values({ playerId, container: 'inventory', slotIndex, itemId, quantity });
}

async function animalRow(animalId: string) {
  const [row] = await db.select().from(schema.animals).where(eq(schema.animals.id, animalId));
  return row!;
}

async function animalCount(): Promise<number> {
  const rows = await db.select().from(schema.animals).where(eq(schema.animals.farmId, farmId));
  return rows.length;
}

/** Buys an animal through the endpoint and returns its id. */
async function buy(kind: 'chicken' | 'cow' = 'chicken'): Promise<string> {
  const def = ANIMALS[kind];
  const res = await client.post('/api/animals/buy', {
    kind,
    variant: def.variants[0],
    idempotencyKey: newKey(),
  });
  expect(res.status, res.code).toBe(200);
  return res.body.animalId;
}

/**
 * Moves an animal's timestamps back so it is mature, fed, and owes `cycles`.
 * Only TIMESTAMPS are faked — the production calculation itself is the real one.
 */
async function ready(animalId: string, cycles: number, kind: 'chicken' | 'cow' = 'chicken') {
  const def = ANIMALS[kind];
  const now = Date.now();
  const collectedAt = now - cycles * def.productionIntervalMs;

  await db
    .update(schema.animals)
    .set({
      maturesAt: collectedAt,
      lastCollectedAt: collectedAt,
      fedUntil: now + def.feedDurationMs,
    })
    .where(eq(schema.animals.id, animalId));
}

/* ------------------------------------------------------------------ *
 * Buying
 * ------------------------------------------------------------------ */

describe('POST /api/animals/buy', () => {
  it('charges the configured price and puts the animal on the farm', async () => {
    const before = await gold();
    const res = await client.post('/api/animals/buy', {
      kind: 'chicken',
      variant: CHICKEN.variants[0],
      idempotencyKey: newKey(),
    });

    expect(res.status).toBe(200);
    expect(res.body.goldDelta).toBe(-CHICKEN.purchasePrice);
    expect(await gold()).toBe(before - CHICKEN.purchasePrice);

    const animal = await animalRow(res.body.animalId);
    expect(animal.farmId).toBe(farmId);
    expect(animal.kind).toBe('chicken');
  });

  it('starts a chicken as a baby that matures later', async () => {
    const id = await buy('chicken');
    const animal = await animalRow(id);

    expect(animal.maturesAt).toBeGreaterThan(animal.acquiredAt);
    expect(animal.maturesAt - animal.acquiredAt).toBe(CHICKEN.maturityDurationMs);

    const state = await client.get('/api/farm');
    const view = state.body.animals.find((a: { id: string }) => a.id === id);
    expect(view.isMature).toBe(false);
    expect(view.hasProduce).toBe(false);
  });

  it('starts a cow mature — there is no baby-cow sprite', async () => {
    const id = await buy('cow');
    const animal = await animalRow(id);
    expect(animal.maturesAt).toBe(animal.acquiredAt);
  });

  it('arrives unfed, so feed is a running cost rather than a one-off', async () => {
    const id = await buy('cow');
    expect((await animalRow(id)).fedUntil).toBeNull();

    const state = await client.get('/api/farm');
    const view = state.body.animals.find((a: { id: string }) => a.id === id);
    expect(view.isFed).toBe(false);
  });

  it('refuses when the gold is not there, and creates nothing', async () => {
    await setGold(CHICKEN.purchasePrice - 1);

    const res = await client.post('/api/animals/buy', {
      kind: 'chicken',
      variant: CHICKEN.variants[0],
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_GOLD);
    expect(await animalCount()).toBe(0);
    expect(await gold()).toBe(CHICKEN.purchasePrice - 1);
  });

  it('refuses past the coop cap, and takes no gold for the refusal', async () => {
    for (let i = 0; i < COOP_CAP; i++) await buy('chicken');

    const before = await gold();
    const res = await client.post('/api/animals/buy', {
      kind: 'chicken',
      variant: CHICKEN.variants[0],
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.ANIMAL_CAP_REACHED);
    expect(await animalCount()).toBe(COOP_CAP);
    expect(await gold()).toBe(before);
  });

  /**
   * The whole point of splitting the cap in T-12.02: a full coop is not a full
   * farm. Before it, six chickens made a cow unbuyable — a decision no player
   * ever meant to make.
   */
  it('keeps the coop and barn caps entirely separate', async () => {
    for (let i = 0; i < COOP_CAP; i++) await buy('chicken');

    // The coop is full...
    expect(
      (
        await client.post('/api/animals/buy', {
          kind: 'chicken',
          variant: CHICKEN.variants[0],
          idempotencyKey: newKey(),
        })
      ).code,
    ).toBe(ErrorCode.ANIMAL_CAP_REACHED);

    // ...and the barn is untouched. `buy` asserts a 200 for each one.
    for (let i = 0; i < BARN_CAP; i++) await buy('cow');
    expect(
      (
        await client.post('/api/animals/buy', {
          kind: 'cow',
          variant: COW.variants[0],
          idempotencyKey: newKey(),
        })
      ).code,
    ).toBe(ErrorCode.ANIMAL_CAP_REACHED);

    expect(await animalCount()).toBe(COOP_CAP + BARN_CAP);
  });

  /** The refusal names which building filled up, so the UI can point at it. */
  it('says which building is full', async () => {
    for (let i = 0; i < COOP_CAP; i++) await buy('chicken');

    const res = await client.post('/api/animals/buy', {
      kind: 'chicken',
      variant: CHICKEN.variants[0],
      idempotencyKey: newKey(),
    });

    expect(res.body.error.details.building).toBe('coop');
  });

  /**
   * The cap must not be a suggestion two simultaneous purchases can step past.
   * Locking the player row first is what serialises them.
   */
  it('cannot be raced past the cap by two simultaneous purchases', async () => {
    for (let i = 0; i < COOP_CAP - 1; i++) await buy('chicken');

    const results = await Promise.all([
      client.post('/api/animals/buy', {
        kind: 'chicken',
        variant: CHICKEN.variants[0],
        idempotencyKey: newKey(),
      }),
      client.post('/api/animals/buy', {
        kind: 'chicken',
        variant: CHICKEN.variants[0],
        idempotencyKey: newKey(),
      }),
    ]);

    const succeeded = results.filter((r) => r.status === 200);
    expect(succeeded).toHaveLength(1);
    expect(await animalCount()).toBe(COOP_CAP);
  });

  it('rejects a variant that belongs to a different animal', async () => {
    const res = await client.post('/api/animals/buy', {
      kind: 'chicken',
      variant: COW.variants[0],
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(await animalCount()).toBe(0);
  });

  it('rejects an unknown kind at the schema', async () => {
    const res = await client.post('/api/animals/buy', {
      kind: 'griffin',
      variant: 'gold',
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('is idempotent: a replayed key buys one animal, not two', async () => {
    const key = newKey();
    const body = { kind: 'chicken', variant: CHICKEN.variants[0], idempotencyKey: key };

    const before = await gold();
    const first = await client.post('/api/animals/buy', body);
    const replay = await client.post('/api/animals/buy', body);

    expect(replay.body).toEqual(first.body);
    expect(await animalCount()).toBe(1);
    expect(await gold()).toBe(before - CHICKEN.purchasePrice);
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    const res = await anonymous.post('/api/animals/buy', {
      kind: 'chicken',
      variant: CHICKEN.variants[0],
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

/* ------------------------------------------------------------------ *
 * Collecting
 * ------------------------------------------------------------------ */

describe('POST /api/animals/collect', () => {
  it('grants the produce and advances the animal', async () => {
    const id = await buy('chicken');
    await ready(id, 3);

    const res = await client.post('/api/animals/collect', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.status, res.code).toBe(200);
    expect(res.body.itemId).toBe(CHICKEN.produceItemId);
    expect(res.body.quantity).toBe(3 * CHICKEN.yieldAmount);
    expect(await held(CHICKEN.produceItemId)).toBe(3 * CHICKEN.yieldAmount);

    // Nothing left immediately afterwards.
    const again = await client.post('/api/animals/collect', {
      animalId: id,
      idempotencyKey: newKey(),
    });
    expect(again.code).toBe(ErrorCode.NOTHING_TO_COLLECT);
  });

  it('refuses an animal that is still a baby', async () => {
    const id = await buy('chicken');

    const res = await client.post('/api/animals/collect', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.ANIMAL_NOT_MATURE);
  });

  it('refuses when nothing is ready yet', async () => {
    const id = await buy('cow');
    await db
      .update(schema.animals)
      .set({ fedUntil: Date.now() + COW.feedDurationMs })
      .where(eq(schema.animals.id, id));

    const res = await client.post('/api/animals/collect', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.NOTHING_TO_COLLECT);
  });

  /** The player can act on the difference: feed it, rather than wait. */
  it('says the animal is unfed rather than just "nothing ready"', async () => {
    const id = await buy('cow');

    const res = await client.post('/api/animals/collect', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.ANIMAL_UNFED);
  });

  /**
   * The rule that mirrors "a harvested crop stays in its plot". Collecting into
   * a full bag must not consume the produce.
   */
  it('leaves the produce with the animal when the bag is full', async () => {
    const id = await buy('chicken');
    await ready(id, 2);

    for (let i = 0; i < BASE_INVENTORY_SLOTS; i++) await give('hay', 999);

    const res = await client.post('/api/animals/collect', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.INVENTORY_FULL);
    expect(await held(CHICKEN.produceItemId)).toBe(0);

    // The clock was not advanced: the eggs are still there to collect later.
    const state = await client.get('/api/farm');
    const view = state.body.animals.find((a: { id: string }) => a.id === id);
    expect(view.hasProduce).toBe(true);
  });

  /**
   * `lastCollectedAt` advances by what was handed over, not to `now`. A player
   * who collects a little early must not lose the progress toward the next egg.
   */
  it('does not discard progress toward the next cycle', async () => {
    const id = await buy('chicken');
    await ready(id, 1);

    // Half an interval past the first cycle.
    const half = Math.floor(CHICKEN.productionIntervalMs / 2);
    const before = await animalRow(id);
    await db
      .update(schema.animals)
      .set({ lastCollectedAt: before.lastCollectedAt - half, maturesAt: before.maturesAt - half })
      .where(eq(schema.animals.id, id));

    await client.post('/api/animals/collect', { animalId: id, idempotencyKey: newKey() });

    const after = await animalRow(id);
    // Exactly one interval on from where the window began — the extra half hour
    // of progress survives rather than being reset to now.
    expect(Date.now() - after.lastCollectedAt).toBeGreaterThanOrEqual(half - 5_000);
  });

  it("refuses another player's animal, and does not confirm it exists", async () => {
    const id = await buy('chicken');
    await ready(id, 1);

    const other = await createTestClient();
    await registerTestUser(other);

    const res = await other.post('/api/animals/collect', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.NOT_FOUND);
    expect(await held(CHICKEN.produceItemId)).toBe(0);
    await other.close();
  });

  it('is idempotent: a replayed key pays out once', async () => {
    const id = await buy('chicken');
    await ready(id, 2);

    const key = newKey();
    const first = await client.post('/api/animals/collect', { animalId: id, idempotencyKey: key });
    const replay = await client.post('/api/animals/collect', { animalId: id, idempotencyKey: key });

    expect(replay.body).toEqual(first.body);
    expect(await held(CHICKEN.produceItemId)).toBe(2 * CHICKEN.yieldAmount);
  });

  it('pays out once when two concurrent collections race the same animal', async () => {
    const id = await buy('chicken');
    await ready(id, 4);

    const results = await Promise.all([
      client.post('/api/animals/collect', { animalId: id, idempotencyKey: newKey() }),
      client.post('/api/animals/collect', { animalId: id, idempotencyKey: newKey() }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await held(CHICKEN.produceItemId)).toBe(4 * CHICKEN.yieldAmount);
  });
});

/* ------------------------------------------------------------------ *
 * Feeding
 * ------------------------------------------------------------------ */

describe('POST /api/animals/feed', () => {
  it('consumes one feed item and sets the expiry', async () => {
    const id = await buy('chicken');
    await give(CHICKEN.feedItemId, 5);

    const res = await client.post('/api/animals/feed', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.status, res.code).toBe(200);
    expect(await held(CHICKEN.feedItemId)).toBe(4);
    expect(res.body.fedUntil).toBeGreaterThan(Date.now());
  });

  it('extends from the existing expiry, so feeding early wastes nothing', async () => {
    const id = await buy('chicken');
    await give(CHICKEN.feedItemId, 2);

    const first = await client.post('/api/animals/feed', {
      animalId: id,
      idempotencyKey: newKey(),
    });
    const second = await client.post('/api/animals/feed', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(second.body.fedUntil - first.body.fedUntil).toBe(CHICKEN.feedDurationMs);
  });

  it('refuses without the feed, and changes nothing', async () => {
    const id = await buy('chicken');

    const res = await client.post('/api/animals/feed', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect((await animalRow(id)).fedUntil).toBeNull();
  });

  it('will not accept a cow being fed with chicken feed', async () => {
    const id = await buy('cow');
    await give(CHICKEN.feedItemId, 5);

    const res = await client.post('/api/animals/feed', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await held(CHICKEN.feedItemId)).toBe(5);
  });

  /**
   * The anti-banking rule, end to end. An animal left hungry for a week and
   * then fed keeps what it had earned and gains nothing for the week.
   */
  it('does not pay out for the days it went unfed', async () => {
    const id = await buy('chicken');
    const now = Date.now();

    // Fed for two cycles' worth, then a week of neglect.
    const startedAt = now - 8 * DAY;
    await db
      .update(schema.animals)
      .set({
        maturesAt: startedAt,
        lastCollectedAt: startedAt,
        fedUntil: startedAt + 2 * CHICKEN.productionIntervalMs,
      })
      .where(eq(schema.animals.id, id));

    await give(CHICKEN.feedItemId, 1);
    await client.post('/api/animals/feed', { animalId: id, idempotencyKey: newKey() });

    const res = await client.post('/api/animals/collect', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.status, res.code).toBe(200);
    expect(res.body.quantity).toBe(2 * CHICKEN.yieldAmount);
  });

  it('is idempotent: a replayed key consumes one feed', async () => {
    const id = await buy('chicken');
    await give(CHICKEN.feedItemId, 5);

    const key = newKey();
    const first = await client.post('/api/animals/feed', { animalId: id, idempotencyKey: key });
    const replay = await client.post('/api/animals/feed', { animalId: id, idempotencyKey: key });

    expect(replay.body).toEqual(first.body);
    expect(await held(CHICKEN.feedItemId)).toBe(4);
  });

  it("refuses another player's animal", async () => {
    const id = await buy('chicken');

    const other = await createTestClient();
    await registerTestUser(other);
    const res = await other.post('/api/animals/feed', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.NOT_FOUND);
    await other.close();
  });
});

/* ------------------------------------------------------------------ *
 * Animals are never destroyed (CLAUDE.md §5.3)
 * ------------------------------------------------------------------ */

describe('an animal is never lost', () => {
  it('survives every rejected intent', async () => {
    const id = await buy('chicken');

    // Immature collect, unfed collect, feed with nothing to feed it, and a
    // purchase that fails for gold.
    await client.post('/api/animals/collect', { animalId: id, idempotencyKey: newKey() });
    await client.post('/api/animals/feed', { animalId: id, idempotencyKey: newKey() });
    await setGold(0);
    await client.post('/api/animals/buy', {
      kind: 'cow',
      variant: COW.variants[0],
      idempotencyKey: newKey(),
    });

    expect(await animalCount()).toBe(1);
    expect(await animalRow(id)).toBeDefined();
  });

  it('survives being left unfed indefinitely', async () => {
    const id = await buy('cow');
    await db
      .update(schema.animals)
      .set({ maturesAt: Date.now() - 400 * DAY, fedUntil: Date.now() - 365 * DAY })
      .where(eq(schema.animals.id, id));

    const state = await client.get('/api/farm');
    const view = state.body.animals.find((a: { id: string }) => a.id === id);

    expect(view).toBeDefined();
    expect(view.isFed).toBe(false);
    expect(view.hasProduce).toBe(false);
    expect(await animalCount()).toBe(1);
  });

  /**
   * The stronger version of the rule: not "no test deletes an animal" but "no
   * code can". §5.3 forbids permanent loss outright, so the source tree is
   * searched for any delete against the animals table.
   */
  it('has no delete against the animals table anywhere in the source', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const offenders: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);

        if (entry.isDirectory()) {
          // `src/test` holds the truncation helper, which is how the suite
          // resets between tests and is not a game code path.
          if (entry.name !== 'test') await walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;

        const source = await readFile(path, 'utf8');
        if (/delete\s*\(\s*schema\.animals\s*\)/.test(source)) offenders.push(path);
      }
    }

    await walk(root);
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Offline progression
 * ------------------------------------------------------------------ */

describe('offline progression', () => {
  it('a fed animal left alone accrues without any request in between', async () => {
    const id = await buy('cow');
    const now = Date.now();

    await db
      .update(schema.animals)
      .set({
        maturesAt: now - 2 * DAY,
        lastCollectedAt: now - 12 * HOUR,
        fedUntil: now + COW.feedDurationMs,
      })
      .where(eq(schema.animals.id, id));

    // Twelve hours at six hours a cycle, with nothing polling in between.
    const res = await client.post('/api/animals/collect', {
      animalId: id,
      idempotencyKey: newKey(),
    });

    expect(res.status, res.code).toBe(200);
    expect(res.body.quantity).toBe(2 * COW.yieldAmount);
  });
});
