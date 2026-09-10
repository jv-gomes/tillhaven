import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { BACKPACK_TIERS, ErrorCode, FARM_HEIGHT, FARM_WIDTH } from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { insertTestPlayer, resetDb } from '../../test/helpers.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { upgradeBackpack } from './service.js';

/**
 * The one thing about a backpack purchase that HTTP tests cannot reach.
 *
 * Every request re-reads the session, so over the wire the player object is
 * always fresh and a second purchase always sees the tier the first one wrote.
 * The dangerous case is the opposite: two purchases running against the SAME
 * snapshot, which is what two concurrent requests actually hold. Calling the
 * service twice inside one transaction reproduces it exactly, and
 * deterministically — no racing, no flake.
 *
 * The guard is that the tier comes from `lockForUpgrade`'s locked row rather
 * than from `player.backpackTier`. Reach for the snapshot and the second call
 * buys tier 1 twice, at full price.
 */

let player: AuthedPlayer;

beforeEach(async () => {
  await resetDb();
  const row = await insertTestPlayer({ gold: 1_000_000 });
  // `lockForUpgrade` locks the farm as well as the player — it is shared with
  // the house and chest tracks, both of which live on the farm row.
  await db.insert(schema.farms).values({
    playerId: row.id,
    width: FARM_WIDTH,
    height: FARM_HEIGHT,
    createdAt: Date.now(),
  });
  player = {
    id: row.id,
    username: row.username,
    email: 'x@example.test',
    gold: 1_000_000,
    // Deliberately stale from here on: nothing in the purchase may trust it.
    backpackTier: 0,
    experience: 0,
    energySpent: 0,
    sleepingSince: null,
    vipUntil: null,
    flaggedAt: null,
    createdAt: Date.now(),
    appearance: null,
  };
});

afterAll(closeDb);

async function stored(): Promise<{ tier: number; gold: number }> {
  const [row] = await db
    .select({ tier: schema.players.backpackTier, gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, player.id));
  return row!;
}

describe('upgradeBackpack against a stale player snapshot', () => {
  const TIER_1 = BACKPACK_TIERS.find((t) => t.tier === 1)!;
  const TIER_2 = BACKPACK_TIERS.find((t) => t.tier === 2)!;

  it('prices the second purchase from the row, not from the snapshot', async () => {
    const now = Date.now();

    const [first, second] = await db.transaction(async (tx) => [
      await upgradeBackpack(tx, player, now),
      await upgradeBackpack(tx, player, now),
    ]);

    expect(first!.tier).toBe(1);
    expect(second!.tier).toBe(2);
    expect(first!.goldDelta).toBe(-TIER_1.cost);
    expect(second!.goldDelta).toBe(-TIER_2.cost);

    const after = await stored();
    expect(after.tier).toBe(2);
    expect(after.gold).toBe(1_000_000 - TIER_1.cost - TIER_2.cost);
  });

  it('runs out of tiers rather than re-selling the last one', async () => {
    const now = Date.now();
    const top = BACKPACK_TIERS[BACKPACK_TIERS.length - 1]!;

    await expect(
      db.transaction(async (tx) => {
        for (const _ of BACKPACK_TIERS) await upgradeBackpack(tx, player, now);
      }),
    ).rejects.toMatchObject({ code: ErrorCode.UPGRADE_MAX_TIER });

    // The whole transaction rolled back, so nothing was bought at all.
    expect((await stored()).tier).toBe(0);
    expect(top.tier).toBe(BACKPACK_TIERS.length - 1);
  });
});
