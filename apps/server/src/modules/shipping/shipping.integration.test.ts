import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ErrorCode, ITEMS, SHIPPING_PAYOUT_MS, getItem } from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * The shipping box (T-11.02, CLAUDE.md §5.6).
 *
 * Two rules run through everything here. **Nothing is credited twice**: the
 * settlement UPDATE's own WHERE clause is the guard, so the tests that matter
 * most are the ones that read the box repeatedly and concurrently. And **gold
 * and the row move together** — a shipment marked paid whose gold never arrived
 * is worse than one that never settled, because only the player would notice.
 */

const LEEK = getItem('leek')!;

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  // Exact item counts matter here; the starter kit has its own test elsewhere.
  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, playerId));
});

afterAll(closeDb);

async function give(itemId: string, quantity: number, slotIndex = 0): Promise<void> {
  await db.insert(schema.inventoryItems).values({
    playerId,
    container: 'inventory',
    slotIndex,
    itemId,
    quantity,
  });
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
      and(eq(schema.inventoryItems.playerId, playerId), eq(schema.inventoryItems.itemId, itemId)),
    );
  return rows.reduce((sum, r) => sum + r.quantity, 0);
}

async function shipments() {
  return db
    .select()
    .from(schema.shipments)
    .where(eq(schema.shipments.playerId, playerId));
}

/** Backdates a deposit so it has come due. Moves ONE timestamp, nothing else. */
async function ripen(byMs = SHIPPING_PAYOUT_MS): Promise<void> {
  const rows = await shipments();
  for (const row of rows) {
    await db
      .update(schema.shipments)
      .set({ depositedAt: row.depositedAt - byMs })
      .where(eq(schema.shipments.id, row.id));
  }
}

const depositBody = (itemId: string, quantity: number) => ({
  itemId,
  quantity,
  idempotencyKey: newKey(),
});

describe('POST /api/shipping/deposit', () => {
  it('takes the items and records a shipment', async () => {
    await give('leek', 7);
    const before = await gold();

    const res = await client.post('/api/shipping/deposit', depositBody('leek', 5));

    expect(res.status, res.code).toBe(200);
    expect(res.body).toMatchObject({
      itemId: 'leek',
      quantity: 5,
      payout: LEEK.shopSellPrice! * 5,
      paysOutInMs: SHIPPING_PAYOUT_MS,
    });

    expect(await held('leek')).toBe(2);
    // A deposit is a promise of gold, not gold: nothing is credited yet.
    expect(await gold()).toBe(before);

    const rows = await shipments();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: 'leek', quantity: 5, paidAt: null, payout: null });
  });

  it('refuses an item the shop does not buy, without taking it', async () => {
    await give('hoe_wood', 1);

    const res = await client.post('/api/shipping/deposit', depositBody('hoe_wood', 1));

    expect(res.code).toBe(ErrorCode.ITEM_NOT_SELLABLE);
    expect(await held('hoe_wood')).toBe(1);
    expect(await shipments()).toHaveLength(0);
  });

  /**
   * Tools are undepositable because they are unsellable, not because anything
   * here knows what a tool is. Asserted over every tool in the game so a new
   * one cannot arrive with a sell price by accident.
   */
  it('cannot ship any tool', async () => {
    const tools = Object.values(ITEMS).filter((i) => i.category === 'tool');
    expect(tools.length).toBeGreaterThan(0);

    for (const [index, tool] of tools.entries()) {
      await give(tool.id, 1, index);
      const res = await client.post('/api/shipping/deposit', depositBody(tool.id, 1));

      expect(tool.shopSellPrice, `${tool.id} must have no sell price`).toBeNull();
      expect(res.code, tool.id).toBe(ErrorCode.ITEM_NOT_SELLABLE);
      expect(await held(tool.id)).toBe(1);
    }
  });

  it('refuses more than they hold, and takes nothing', async () => {
    await give('leek', 2);

    const res = await client.post('/api/shipping/deposit', depositBody('leek', 3));

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await held('leek')).toBe(2);
    expect(await shipments()).toHaveLength(0);
  });

  it('refuses an item that does not exist', async () => {
    const res = await client.post('/api/shipping/deposit', depositBody('moon_cheese', 1));
    expect(res.code).toBe(ErrorCode.UNKNOWN_ITEM);
  });

  it('rejects a quantity that is not a positive whole number', async () => {
    await give('leek', 5);
    for (const quantity of [0, -1, 1.5, 'two']) {
      const res = await client.post('/api/shipping/deposit', {
        itemId: 'leek',
        quantity,
        idempotencyKey: newKey(),
      });
      expect(res.code, String(quantity)).toBe(ErrorCode.VALIDATION_FAILED);
    }
    expect(await held('leek')).toBe(5);
  });

  it('replaying the same key ships one lot, not two', async () => {
    await give('leek', 10);
    const body = depositBody('leek', 4);

    const first = await client.post('/api/shipping/deposit', body);
    const replay = await client.post('/api/shipping/deposit', body);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await held('leek')).toBe(6);
    expect(await shipments()).toHaveLength(1);
  });

  it('never touches another player’s box', async () => {
    const other = await createTestClient();
    await registerTestUser(other);
    await give('leek', 3);

    // Their own bag is empty of leeks, so this can only fail — and if slot or
    // player ever resolved across accounts it would succeed on mine instead.
    const res = await other.post('/api/shipping/deposit', depositBody('leek', 1));

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await held('leek')).toBe(3);
    await other.close();
  });
});

describe('GET /api/shipping', () => {
  it('lists what is waiting, with the time left on it', async () => {
    await give('leek', 4);
    await client.post('/api/shipping/deposit', depositBody('leek', 4));

    const res = await client.get('/api/shipping');

    expect(res.status).toBe(200);
    expect(res.body.payoutMs).toBe(SHIPPING_PAYOUT_MS);
    expect(res.body.justPaid).toBe(0);
    expect(res.body.paid).toEqual([]);
    expect(res.body.pending).toHaveLength(1);
    expect(res.body.pending[0]).toMatchObject({
      itemId: 'leek',
      quantity: 4,
      payout: LEEK.shopSellPrice! * 4,
    });
    expect(res.body.pending[0].paysOutInMs).toBeGreaterThan(0);
    expect(res.body.pending[0].paysOutInMs).toBeLessThanOrEqual(SHIPPING_PAYOUT_MS);
  });

  it('pays out what has come due, and only that', async () => {
    await give('leek', 10);
    await client.post('/api/shipping/deposit', depositBody('leek', 4));
    await ripen();
    // A second deposit, made after the backdating, is not yet due.
    await client.post('/api/shipping/deposit', depositBody('leek', 6));

    const before = await gold();
    const res = await client.get('/api/shipping');

    const expected = LEEK.shopSellPrice! * 4;
    expect(res.body.justPaid).toBe(expected);
    expect(await gold()).toBe(before + expected);
    expect(res.body.paid).toHaveLength(1);
    expect(res.body.paid[0]).toMatchObject({ quantity: 4, payout: expected });
    expect(res.body.pending).toHaveLength(1);
    expect(res.body.pending[0].quantity).toBe(6);
  });

  it('records what was credited on the row, not what it is worth later', async () => {
    await give('leek', 3);
    await client.post('/api/shipping/deposit', depositBody('leek', 3));
    await ripen();
    await client.get('/api/shipping');

    const [row] = await shipments();
    expect(row!.paidAt).not.toBeNull();
    expect(row!.payout).toBe(LEEK.shopSellPrice! * 3);
  });

  /** The guard, stated plainly: reading twice must not pay twice. */
  it('pays exactly once however many times the box is read', async () => {
    await give('leek', 5);
    await client.post('/api/shipping/deposit', depositBody('leek', 5));
    await ripen();

    const before = await gold();
    const first = await client.get('/api/shipping');
    for (let i = 0; i < 4; i++) await client.get('/api/shipping');

    const expected = LEEK.shopSellPrice! * 5;
    expect(first.body.justPaid).toBe(expected);
    expect(await gold()).toBe(before + expected);
    // And the later reads say they paid nothing, rather than lying about it.
    expect((await client.get('/api/shipping')).body.justPaid).toBe(0);
  });

  /**
   * The same question under fire. Without the `paid_at IS NULL` guard on the
   * UPDATE, two reads that both see the row as unpaid would both credit it.
   */
  it('pays exactly once when several reads land at the same moment', async () => {
    await give('leek', 8);
    await client.post('/api/shipping/deposit', depositBody('leek', 8));
    await ripen();

    const before = await gold();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => client.get('/api/shipping')),
    );

    const expected = LEEK.shopSellPrice! * 8;
    expect(await gold()).toBe(before + expected);
    // Exactly one of them did the crediting; the rest paid nothing.
    const payers = results.filter((r) => r.body.justPaid > 0);
    expect(payers).toHaveLength(1);
    expect(payers[0]!.body.justPaid).toBe(expected);
  });

  it('settles several shipments in one read', async () => {
    await give('leek', 6);
    await give('onion', 4, 1);
    await client.post('/api/shipping/deposit', depositBody('leek', 6));
    await client.post('/api/shipping/deposit', depositBody('onion', 4));
    await ripen();

    const before = await gold();
    const res = await client.get('/api/shipping');

    const expected = LEEK.shopSellPrice! * 6 + getItem('onion')!.shopSellPrice! * 4;
    expect(res.body.justPaid).toBe(expected);
    expect(await gold()).toBe(before + expected);
    expect(res.body.pending).toEqual([]);
    expect(res.body.paid).toHaveLength(2);
  });

  it('never shows another player’s shipments', async () => {
    await give('leek', 3);
    await client.post('/api/shipping/deposit', depositBody('leek', 3));

    const other = await createTestClient();
    await registerTestUser(other);
    const res = await other.get('/api/shipping');

    expect(res.body.pending).toEqual([]);
    expect(res.body.paid).toEqual([]);
    await other.close();
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    expect((await anonymous.get('/api/shipping')).code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

/**
 * The box settles wherever anyone looks, not only at the box (§4.2). The farm
 * poll is the request a player actually makes every twenty seconds, so gold
 * from a shipment that came due should arrive while they are standing in the
 * field rather than waiting for them to walk over and open the lid.
 */
describe('the farm poll settles the box too', () => {
  it('credits a due shipment on a plain farm read', async () => {
    await give('leek', 5);
    await client.post('/api/shipping/deposit', depositBody('leek', 5));
    await ripen();

    const before = await gold();
    const farm = await client.get('/api/farm');

    const expected = LEEK.shopSellPrice! * 5;
    expect(await gold()).toBe(before + expected);
    // The response's own player block reports the balance AFTER the credit,
    // not the one the session was loaded with.
    expect(farm.body.player.gold).toBe(before + expected);
    expect((await client.get('/api/shipping')).body.justPaid).toBe(0);
  });

  it('leaves a shipment that is not due yet alone', async () => {
    await give('leek', 5);
    await client.post('/api/shipping/deposit', depositBody('leek', 5));

    const before = await gold();
    await client.get('/api/farm');

    expect(await gold()).toBe(before);
    expect((await shipments())[0]!.paidAt).toBeNull();
  });
});
