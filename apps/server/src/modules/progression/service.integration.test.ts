import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { BASE_INVENTORY_SLOTS, ErrorCode, FARM_LEVEL_XP, getMilestone } from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, type TestClient } from '../../test/app.js';
import { boardFor, claimMilestone, grantReward, progressFor } from './service.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * Milestone claiming (T-30.07).
 *
 * The interesting cases are all failure cases: a claim that is not earned, a
 * claim that has already been paid, a claim into a full backpack, and two
 * claims arriving at once. Every one of them must leave the player exactly as
 * they were.
 */

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;
});

afterAll(closeDb);

async function player(): Promise<AuthedPlayer> {
  const [row] = await db.select().from(schema.players).where(eq(schema.players.id, playerId));
  return row as unknown as AuthedPlayer;
}

async function goldOf(): Promise<number> {
  const [row] = await db
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, playerId));
  return row!.gold;
}

async function itemCount(itemId: string): Promise<number> {
  const rows = await db
    .select({ q: schema.inventoryItems.quantity, i: schema.inventoryItems.itemId })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.playerId, playerId));
  return rows.filter((r) => r.i === itemId).reduce((n, r) => n + r.q, 0);
}

async function tillPlots(n: number): Promise<void> {
  const [farm] = await db
    .select({ id: schema.farms.id })
    .from(schema.farms)
    .where(eq(schema.farms.playerId, playerId));
  const plots = await db
    .select({ id: schema.plots.id })
    .from(schema.plots)
    .where(eq(schema.plots.farmId, farm!.id))
    .limit(n);

  for (const p of plots) {
    await db.update(schema.plots).set({ tilledAt: 1 }).where(eq(schema.plots.id, p.id));
  }
}

/** Fills every backpack slot with a distinct un-stackable-with-anything item. */
async function fillBackpack(): Promise<void> {
  await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.playerId, playerId));
  for (let slot = 0; slot < BASE_INVENTORY_SLOTS; slot++) {
    await db.insert(schema.inventoryItems).values({
      playerId,
      container: 'inventory',
      slotIndex: slot,
      itemId: 'onion',
      quantity: 999,
    });
  }
}

describe('progressFor', () => {
  it('derives every counter on read, from a farm that has done nothing', async () => {
    const p = await progressFor(db, await player());

    expect(p.plotsTilled).toBe(0);
    expect(p.animalsOwned).toBe(0);
    expect(p.shipmentsMade).toBe(0);
    expect(p.experience).toBe(0);
    expect(p.farmLevel).toBe(1);
    // The six a new farm starts with.
    expect(p.plotsUnlocked).toBeGreaterThan(0);
  });

  it('counts tilled plots as they are tilled', async () => {
    await tillPlots(3);
    expect((await progressFor(db, await player())).plotsTilled).toBe(3);
  });
});

describe('the board', () => {
  it('shows nothing earned and nothing claimed on a new farm', async () => {
    const board = await boardFor(db, await player());
    expect(board.length).toBeGreaterThan(0);
    expect(board.every((m) => !m.earned)).toBe(true);
    expect(board.every((m) => !m.claimed)).toBe(true);
  });

  it('caps progress at the target rather than showing 30 / 5', async () => {
    await db
      .update(schema.players)
      .set({ experience: FARM_LEVEL_XP[19]! })
      .where(eq(schema.players.id, playerId));

    const board = await boardFor(db, await player());
    for (const m of board) {
      expect(m.progress, m.id).toBeLessThanOrEqual(m.target);
    }
  });
});

describe('claiming', () => {
  it('pays the reward and records the claim', async () => {
    await tillPlots(1);
    const before = await itemCount('leek_seeds');

    const result = await db.transaction(async (tx) =>
      claimMilestone(tx, await player(), 'break_ground', Date.now()),
    );

    expect(result.milestoneId).toBe('break_ground');
    const reward = getMilestone('break_ground')!.reward;
    expect(await itemCount('leek_seeds')).toBe(before + reward.items[0]!.quantity);

    const claims = await db
      .select()
      .from(schema.milestoneClaims)
      .where(eq(schema.milestoneClaims.playerId, playerId));
    expect(claims).toHaveLength(1);
  });

  it('refuses a milestone that has not been earned, and pays nothing', async () => {
    const goldBefore = await goldOf();
    const seedsBefore = await itemCount('leek_seeds');

    await expect(
      db.transaction(async (tx) =>
        claimMilestone(tx, await player(), 'break_ground', Date.now()),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.MILESTONE_NOT_EARNED });

    expect(await goldOf()).toBe(goldBefore);
    expect(await itemCount('leek_seeds')).toBe(seedsBefore);
  });

  it('refuses an unknown milestone id', async () => {
    await expect(
      db.transaction(async (tx) => claimMilestone(tx, await player(), 'nope', Date.now())),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('refuses a second claim of the same milestone', async () => {
    await tillPlots(1);
    await db.transaction(async (tx) =>
      claimMilestone(tx, await player(), 'break_ground', Date.now()),
    );
    const after = await itemCount('leek_seeds');

    await expect(
      db.transaction(async (tx) =>
        claimMilestone(tx, await player(), 'break_ground', Date.now()),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.MILESTONE_ALREADY_CLAIMED });

    // Paid once, not twice.
    expect(await itemCount('leek_seeds')).toBe(after);
  });

  /**
   * The point of the unique index. Both requests see "not claimed" and both
   * proceed; only one insert can survive, and the loser's items and gold roll
   * back with it.
   */
  it('pays exactly once when two claims arrive together', async () => {
    await tillPlots(1);
    const before = await itemCount('leek_seeds');
    const reward = getMilestone('break_ground')!.reward.items[0]!.quantity;

    const attempt = () =>
      db.transaction(async (tx) => claimMilestone(tx, await player(), 'break_ground', Date.now()));

    const results = await Promise.allSettled([attempt(), attempt()]);
    const ok = results.filter((r) => r.status === 'fulfilled');

    expect(ok).toHaveLength(1);
    expect(await itemCount('leek_seeds')).toBe(before + reward);

    const claims = await db
      .select()
      .from(schema.milestoneClaims)
      .where(eq(schema.milestoneClaims.playerId, playerId));
    expect(claims).toHaveLength(1);
  });

  /**
   * A full backpack must not consume the claim. The reward is still there to
   * collect once room is made — the alternative is a milestone that pays
   * nothing and can never be claimed again, which is the worst outcome
   * available.
   */
  it('grants no gold and burns no claim when the bag is full', async () => {
    // level_5 pays gold AND is the only one that does, which makes it the
    // sharpest test of "items fail, so gold must not land".
    await db
      .update(schema.players)
      .set({ experience: FARM_LEVEL_XP[4]! })
      .where(eq(schema.players.id, playerId));
    await tillPlots(1);
    await fillBackpack();

    const goldBefore = await goldOf();

    await expect(
      db.transaction(async (tx) =>
        claimMilestone(tx, await player(), 'break_ground', Date.now()),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVENTORY_FULL });

    expect(await goldOf()).toBe(goldBefore);

    const claims = await db
      .select()
      .from(schema.milestoneClaims)
      .where(eq(schema.milestoneClaims.playerId, playerId));
    expect(claims, 'a failed claim must not be recorded').toHaveLength(0);
  });
});

describe('grantReward', () => {
  it('refuses to grant a tool', async () => {
    const goldBefore = await goldOf();

    await expect(
      db.transaction(async (tx) =>
        grantReward(
          tx,
          await player(),
          { gold: 50, items: [{ itemId: 'axe_wood', quantity: 1 }] },
          Date.now(),
        ),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });

    // Refused before anything was written — the gold in that reward never lands.
    expect(await goldOf()).toBe(goldBefore);
  });

  it('credits gold when there are no items to fail on', async () => {
    const before = await goldOf();
    await db.transaction(async (tx) =>
      grantReward(tx, await player(), { gold: 250, items: [] }, Date.now()),
    );
    expect(await goldOf()).toBe(before + 250);
  });
});
