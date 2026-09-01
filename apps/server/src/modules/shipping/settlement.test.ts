import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { SHIPPING_PAYOUT_MS, getItem } from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { insertTestPlayer, resetDb } from '../../test/helpers.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { settleShipments } from './service.js';

/**
 * The exactly-once guard, held under a real interleaving.
 *
 * `settleShipments` claims each row with `UPDATE … WHERE id = ? AND paid_at IS
 * NULL`. The dangerous case is two settlements whose SELECTs both run before
 * either COMMIT: both see the row as unpaid, and only the UPDATE's own WHERE
 * clause stops the second one paying for it again.
 *
 * **Firing concurrent HTTP requests does not reach that case** — they serialize
 * enough that the second SELECT sees the committed row and skips it, so the
 * guard could be deleted with every endpoint test still green (it was, and they
 * were). Two transactions opened by hand, with the first held open until the
 * second has selected, reproduce it exactly and deterministically.
 *
 * At READ COMMITTED the second UPDATE blocks on the row lock, then re-evaluates
 * its WHERE clause against the row the first one committed. That re-evaluation
 * is the whole mechanism, and it is why the guard belongs in the UPDATE rather
 * than in an `if` above it.
 */

const LEEK = getItem('leek')!;
const QUANTITY = 5;
const PAYOUT = LEEK.shopSellPrice! * QUANTITY;

let player: AuthedPlayer;

beforeEach(async () => {
  await resetDb();
  const row = await insertTestPlayer({ gold: 0 });
  player = {
    id: row.id,
    username: row.username,
    email: 'x@example.test',
    gold: 0,
    backpackTier: 0,
    experience: 0,
    vipUntil: null,
    flaggedAt: null,
    createdAt: Date.now(),
    appearance: null,
  };

  // Deposited long enough ago to be due.
  await db.insert(schema.shipments).values({
    playerId: row.id,
    itemId: 'leek',
    quantity: QUANTITY,
    depositedAt: Date.now() - SHIPPING_PAYOUT_MS - 1_000,
  });
});

afterAll(closeDb);

async function gold(): Promise<number> {
  const [row] = await db
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, player.id));
  return row!.gold;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('settleShipments under an overlapping settlement', () => {
  it('credits the shipment once, not once per reader', async () => {
    const now = Date.now();

    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    // First: settles, then HOLDS the transaction open, uncommitted.
    const first = db.transaction(async (tx) => {
      const paid = await settleShipments(tx, player, now);
      await held;
      return paid;
    });

    await sleep(150);

    // Second: its SELECT runs while the first is still uncommitted, so it sees
    // the row as unpaid. Its UPDATE then blocks until the first commits.
    const second = db.transaction((tx) => settleShipments(tx, player, now));

    await sleep(150);
    release();

    const [firstPaid, secondPaid] = await Promise.all([first, second]);

    expect(firstPaid).toBe(PAYOUT);
    // Without the guard this is PAYOUT as well, and the gold below is doubled.
    expect(secondPaid).toBe(0);
    expect(await gold()).toBe(PAYOUT);

    const [row] = await db.select().from(schema.shipments);
    expect(row!.payout).toBe(PAYOUT);
  });

  it('settles nothing at all when the shipment is not due yet', async () => {
    await db
      .update(schema.shipments)
      .set({ depositedAt: Date.now() })
      .where(eq(schema.shipments.playerId, player.id));

    const paid = await db.transaction((tx) => settleShipments(tx, player, Date.now()));

    expect(paid).toBe(0);
    expect(await gold()).toBe(0);
    expect((await db.select().from(schema.shipments))[0]!.paidAt).toBeNull();
  });

  /**
   * Gold and the row move together or not at all (§4.3). A settlement that
   * marked the row paid and then failed would be an item sink the player pays
   * for; rolling the transaction back has to undo both halves.
   */
  it('leaves nothing settled if the transaction rolls back', async () => {
    await expect(
      db.transaction(async (tx) => {
        await settleShipments(tx, player, Date.now());
        throw new Error('something later in the request failed');
      }),
    ).rejects.toThrow('something later');

    expect(await gold()).toBe(0);
    expect((await db.select().from(schema.shipments))[0]!.paidAt).toBeNull();
  });
});
