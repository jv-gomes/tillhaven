import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';
import { CROP_IDS, IDLE_TASK_TYPES } from '@tillhaven/shared';
import { canonicalTasks, parseIdleTasks } from './idle.js';

/**
 * T-13.02 — the idle settings endpoint.
 *
 * Nothing simulates yet, so what is under test is the boundary: what the
 * endpoint refuses, what it stores, and the one piece of state it moves — the
 * watermark. That last one is where the exploit would be: a watermark left
 * pointing into the past is a backlog of work the farm never idled for, and
 * once T-13.04's applier exists it would be paid out in full.
 */

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;
});

afterAll(closeDb);

const CROP = CROP_IDS[0]!;

async function farmRow() {
  const rows = await db
    .select()
    .from(schema.farms)
    .where(eq(schema.farms.playerId, playerId))
    .limit(1);
  return rows[0]!;
}

function body(over: Record<string, unknown> = {}) {
  return { enabled: true, tasks: ['till'], idempotencyKey: newKey(), ...over };
}

describe('GET /api/farm/idle', () => {
  it('starts off, with nothing chosen and no watermark', async () => {
    const res = await client.get('/api/farm/idle');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, tasks: [], cropId: null, processedAt: null });
  });

  it('requires a session', async () => {
    const anon = await createTestClient();
    expect((await anon.get('/api/farm/idle')).code).toBe('UNAUTHENTICATED');
    await anon.close();
  });
});

describe('PUT /api/farm/idle', () => {
  it('stores what was chosen and reports it back', async () => {
    const res = await client.put(
      '/api/farm/idle',
      body({ tasks: ['harvest', 'till'], cropId: CROP }),
    );

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.cropId).toBe(CROP);
    expect(await client.get('/api/farm/idle').then((r) => r.body)).toEqual(res.body);
  });

  /**
   * The set is the player's; the order is the config's. Storing the request's
   * order would make the column's meaning depend on a client array literal,
   * and the simulator walks the list in dependency order.
   */
  it('stores tasks in config order however they were sent', async () => {
    await client.put('/api/farm/idle', body({ tasks: ['harvest', 'water', 'till'] }));

    const res = await client.get('/api/farm/idle');
    expect(res.body.tasks).toEqual(['till', 'water', 'harvest']);
  });

  it('replaces the whole setting rather than merging into it', async () => {
    await client.put(
      '/api/farm/idle',
      body({ tasks: ['till', 'plant', 'water'], cropId: CROP }),
    );
    // No cropId this time: on a PUT that means "sow nothing", not "keep it".
    await client.put('/api/farm/idle', body({ tasks: ['water'] }));

    const res = await client.get('/api/farm/idle');
    expect(res.body.tasks).toEqual(['water']);
    expect(res.body.cropId).toBeNull();
  });

  it('accepts every task the config lists', async () => {
    const res = await client.put(
      '/api/farm/idle',
      body({ tasks: [...IDLE_TASK_TYPES], cropId: CROP }),
    );

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([...IDLE_TASK_TYPES]);
  });

  it('requires a session', async () => {
    const anon = await createTestClient();
    expect((await anon.put('/api/farm/idle', body())).code).toBe('UNAUTHENTICATED');
    await anon.close();
  });
});

describe('PUT /api/farm/idle — validation', () => {
  it('refuses a task it has never heard of', async () => {
    const res = await client.put('/api/farm/idle', body({ tasks: ['till', 'mine'] }));

    expect(res.code).toBe('VALIDATION_FAILED');
    expect((await farmRow()).idleTasks).toBe('[]');
  });

  it('refuses a crop it has never heard of', async () => {
    const res = await client.put('/api/farm/idle', body({ cropId: 'moon_wheat' }));
    expect(res.code).toBe('VALIDATION_FAILED');
  });

  /** A client bug, not an attack — but accepting it means the bug ships. */
  it('refuses a duplicated task', async () => {
    const res = await client.put('/api/farm/idle', body({ tasks: ['till', 'till'] }));
    expect(res.code).toBe('VALIDATION_FAILED');
  });

  /**
   * T-18.07 (BUG-09). This parsed cleanly for five phases and is the worst
   * state the headline feature can be put in: the HUD says the farmer is
   * working, the player is locked out of moving and using tools — `Farm.ts`
   * gates input on `enabled` alone — and the simulator has no chores to do, so
   * nothing ever happens. The player has traded their farm for nothing.
   *
   * Refused on the SERVER and not only in the panel, because §4.1 makes the
   * panel a UX gate: a stale build, a replayed request or a curl would each put
   * a real farm into a state the game has no way out of except the Stop button.
   */
  it('refuses to switch on with no chores at all', async () => {
    const res = await client.put('/api/farm/idle', body({ enabled: true, tasks: [] }));

    expect(res.code).toBe('VALIDATION_FAILED');
    expect((await farmRow()).idleEnabled).toBe(false);
  });

  /**
   * The other half of the same rule, and the reason it is a refinement rather
   * than `tasks.nonempty()`: switching OFF with an empty list is ordinary.
   * A farmer that is not working needs no chores.
   */
  it('accepts an empty chore list when idle is switched off', async () => {
    const res = await client.put('/api/farm/idle', body({ enabled: false, tasks: [] }));

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.tasks).toEqual([]);
  });

  it('refuses a body with no idempotency key', async () => {
    const res = await client.put('/api/farm/idle', { enabled: true, tasks: [] });
    expect(res.code).toBe('VALIDATION_FAILED');
  });

  /**
   * Told to plant, but not told what. Accepted-and-ignored would put a farmer
   * in a tilled field sowing nothing, which a player cannot tell from a bug.
   */
  it('refuses to plant without a crop, and names the task', async () => {
    const res = await client.put('/api/farm/idle', body({ tasks: ['till', 'plant'] }));

    expect(res.code).toBe('IDLE_CROP_REQUIRED');
    expect(res.status).toBe(400);
    expect(res.body.error.details.task).toBe('plant');
  });

  it('allows a crop with no plant task — it is simply unused', async () => {
    const res = await client.put('/api/farm/idle', body({ tasks: ['water'], cropId: CROP }));
    expect(res.status).toBe(200);
    expect(res.body.cropId).toBe(CROP);
  });

  it('writes nothing when it refuses', async () => {
    await client.put('/api/farm/idle', body({ tasks: ['water'], cropId: CROP }));
    const before = await farmRow();

    await client.put('/api/farm/idle', body({ tasks: ['plant'] }));

    expect(await farmRow()).toEqual(before);
  });
});

describe('PUT /api/farm/idle — the watermark', () => {
  it('is stamped when idle is switched on, not backdated to the farm', async () => {
    const before = Date.now();
    await client.put('/api/farm/idle', body({ tasks: ['till'] }));
    const after = Date.now();

    const { idleProcessedAt } = await farmRow();
    expect(idleProcessedAt).not.toBeNull();
    expect(idleProcessedAt!).toBeGreaterThanOrEqual(before);
    expect(idleProcessedAt!).toBeLessThanOrEqual(after);
  });

  /**
   * The exploit this exists to prevent: a farm idle-disabled for a month, then
   * switched on, must not owe a month of work. The watermark moving forward on
   * every write is what makes that true by construction.
   */
  it('cannot be left pointing at a moment before the settings that are in force', async () => {
    await client.put('/api/farm/idle', body({ tasks: ['till'] }));

    // A month of not idling, as the database would see it.
    const stale = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await db
      .update(schema.farms)
      .set({ idleProcessedAt: stale, idleEnabled: false })
      .where(eq(schema.farms.playerId, playerId));

    await client.put('/api/farm/idle', body({ tasks: ['till'] }));

    const { idleProcessedAt } = await farmRow();
    expect(idleProcessedAt!).toBeGreaterThan(stale);
    expect(Date.now() - idleProcessedAt!).toBeLessThan(60_000);
  });

  it('never moves backwards, even if the clock does', async () => {
    const future = Date.now() + 60 * 60 * 1000;
    await db
      .update(schema.farms)
      .set({ idleProcessedAt: future })
      .where(eq(schema.farms.playerId, playerId));

    await client.put('/api/farm/idle', body({ tasks: ['till'] }));

    expect((await farmRow()).idleProcessedAt).toBe(future);
  });

  it('keeps the watermark when idle is switched off, rather than clearing it', async () => {
    await client.put('/api/farm/idle', body({ tasks: ['till'] }));
    await client.put('/api/farm/idle', body({ enabled: false, tasks: [] }));

    const row = await farmRow();
    expect(row.idleEnabled).toBe(false);
    expect(row.idleProcessedAt).not.toBeNull();
  });
});

describe('PUT /api/farm/idle — idempotency', () => {
  it('replays the first response for a repeated key without writing again', async () => {
    const key = newKey();
    const first = await client.put('/api/farm/idle', {
      enabled: true,
      tasks: ['till'],
      idempotencyKey: key,
    });
    const rowAfterFirst = await farmRow();

    // A DIFFERENT intent under the SAME key: the replay must win, or a retry
    // that raced a real change would apply the change.
    const second = await client.put('/api/farm/idle', {
      enabled: false,
      tasks: ['harvest'],
      idempotencyKey: key,
    });

    expect(second.body).toEqual(first.body);
    expect(await farmRow()).toEqual(rowAfterFirst);
  });

  it('applies a second change under a new key', async () => {
    await client.put('/api/farm/idle', body({ tasks: ['till'] }));
    await client.put('/api/farm/idle', body({ tasks: ['harvest'] }));

    expect((await client.get('/api/farm/idle')).body.tasks).toEqual(['harvest']);
  });
});

describe('PUT /api/farm/idle — ownership', () => {
  it('changes only the caller’s farm', async () => {
    const other = await createTestClient();
    const otherId = (await registerTestUser(other)).id;

    await client.put('/api/farm/idle', body({ tasks: ['till', 'water'] }));

    const rows = await db
      .select()
      .from(schema.farms)
      .where(eq(schema.farms.playerId, otherId))
      .limit(1);

    expect(rows[0]!.idleEnabled).toBe(false);
    expect(rows[0]!.idleTasks).toBe('[]');
    expect(rows[0]!.idleProcessedAt).toBeNull();
    await other.close();
  });
});

/**
 * `idle_tasks` is text, so its contents are not guaranteed by the type system.
 * A bad migration, a manual UPDATE, or a future build writing a task this one
 * has never heard of all land in the same place — and none of them is a reason
 * to take the farm away from the player.
 */
describe('reading a settings column that is not what this build expects', () => {
  it.each([
    ['not JSON at all', 'till,water'],
    ['JSON that is not an array', '{"till":true}'],
    ['an array of non-strings', '[1,2,3]'],
    ['a task from a later version', '["till","fish"]'],
  ])('survives %s', async (_name, stored) => {
    await db
      .update(schema.farms)
      .set({ idleTasks: stored })
      .where(eq(schema.farms.playerId, playerId));

    const res = await client.get('/api/farm/idle');
    expect(res.status).toBe(200);
    expect(res.body.tasks.every((t: string) => IDLE_TASK_TYPES.includes(t as never))).toBe(true);
  });

  it('keeps the tasks it does recognise from a mixed list', async () => {
    await db
      .update(schema.farms)
      .set({ idleTasks: '["fish","water","till"]' })
      .where(eq(schema.farms.playerId, playerId));

    expect((await client.get('/api/farm/idle')).body.tasks).toEqual(['till', 'water']);
  });

  it('reads a crop this build does not know as sowing nothing', async () => {
    await db
      .update(schema.farms)
      .set({ idleCropId: 'moon_wheat' })
      .where(eq(schema.farms.playerId, playerId));

    expect((await client.get('/api/farm/idle')).body.cropId).toBeNull();
  });
});

describe('parseIdleTasks / canonicalTasks', () => {
  it('round-trips the canonical form', () => {
    expect(parseIdleTasks(JSON.stringify(canonicalTasks(['harvest', 'till'])))).toEqual([
      'till',
      'harvest',
    ]);
  });

  it('deduplicates', () => {
    expect(canonicalTasks(['till', 'till', 'water'])).toEqual(['till', 'water']);
  });

  it('is empty for anything unreadable', () => {
    for (const junk of ['', 'null', '[]', '"till"', '[[]]']) {
      expect(parseIdleTasks(junk), junk).toEqual([]);
    }
  });
});
