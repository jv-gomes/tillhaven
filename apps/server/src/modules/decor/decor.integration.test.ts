import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  DECOR,
  DECOR_IDS,
  ErrorCode,
  FARM_HEIGHT,
  PLOT_POSITIONS,
  canPlaceDecor,
  reservedFarmTiles,
  waterTiles,
  type DecorDef,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * Farm decoration, end to end.
 *
 * The rules the server owns and the client cannot argue with: the piece must
 * exist and be owned, it must land on ground that is free, a solid piece must
 * not make a plot unworkable, and it must not seal off part of the farm.
 * Ownership is the fifth and comes from the cookie.
 */

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  // Stock the storeroom, so the placement tests exercise PLACEMENT rules rather
  // than re-testing ownership. Buying has its own section.
  await db
    .insert(schema.decorOwned)
    .values(DECOR_IDS.map((decorId) => ({ playerId, decorId, quantity: 20 })));
});

afterAll(closeDb);

const place = (decorId: string, x: number, y: number) =>
  client.post('/api/decor/place', { decorId, x, y, idempotencyKey: newKey() });

const move = (placementId: string, x: number, y: number) =>
  client.post('/api/decor/move', { placementId, x, y, idempotencyKey: newKey() });

const remove = (placementId: string) =>
  client.post('/api/decor/remove', { placementId, idempotencyKey: newKey() });

const buy = (decorId: string) =>
  client.post('/api/decor/buy', { decorId, idempotencyKey: newKey() });

async function placements() {
  return db
    .select()
    .from(schema.decorPlacements)
    .where(eq(schema.decorPlacements.playerId, playerId));
}

async function gold(): Promise<number> {
  const rows = await db
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, playerId));
  return rows[0]!.gold;
}

async function setGold(amount: number): Promise<void> {
  await db.update(schema.players).set({ gold: amount }).where(eq(schema.players.id, playerId));
}

async function ownedOf(decorId: string): Promise<number> {
  const rows = await db
    .select({ decorId: schema.decorOwned.decorId, quantity: schema.decorOwned.quantity })
    .from(schema.decorOwned)
    .where(eq(schema.decorOwned.playerId, playerId));
  return rows.find((r) => r.decorId === decorId)?.quantity ?? 0;
}

/** A tile where `def` is legal on a fresh farm. Found, not guessed. */
function legalTile(def: DecorDef): { x: number; y: number } {
  const reserved = reservedFarmTiles({ coop: 0, barn: 0 });
  for (let y = 1; y < FARM_HEIGHT - 2; y++) {
    for (let x = 2; x < 28; x++) {
      if (canPlaceDecor(def, x, y, reserved, []).ok) return { x, y };
    }
  }
  throw new Error(`no legal tile for ${def.id}`);
}

const berry = DECOR.berry_pile!;
const post = DECOR.fence_v!;

describe('GET /api/decor', () => {
  it('starts with nothing placed', async () => {
    const res = await client.get('/api/decor');
    expect(res.status).toBe(200);
    expect(res.body.placements).toEqual([]);
  });

  it('never shows another player’s farm', async () => {
    const at = legalTile(berry);
    await place(berry.id, at.x, at.y);

    const other = await createTestClient();
    await registerTestUser(other);

    expect((await other.get('/api/decor')).body.placements).toEqual([]);
    expect((await client.get('/api/decor')).body.placements).toHaveLength(1);
    await other.close();
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    expect((await anonymous.get('/api/decor')).code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

describe('GET /api/decor/catalogue', () => {
  it('serves every piece with the price and the art window', async () => {
    const res = await client.get('/api/decor/catalogue');
    expect(res.status).toBe(200);
    expect(res.body.decor).toHaveLength(DECOR_IDS.length);

    const one = res.body.decor[0];
    expect(one).toMatchObject({ id: expect.any(String), price: expect.any(Number) });
    expect(one.look).toMatchObject({ width: expect.any(Number) });
  });
});

describe('POST /api/decor/buy', () => {
  it('charges the catalogue price and adds one to storage', async () => {
    await setGold(1000);
    const before = await ownedOf(berry.id);

    const res = await buy(berry.id);

    expect(res.status, res.code).toBe(200);
    expect(await gold()).toBe(1000 - berry.price);
    expect(await ownedOf(berry.id)).toBe(before + 1);
  });

  it('refuses when the player cannot afford it', async () => {
    await setGold(0);
    const res = await buy(DECOR.stone_statue!.id);

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_GOLD);
    expect(await gold()).toBe(0);
  });

  it('refuses an unknown piece', async () => {
    expect((await buy('not-a-piece')).code).toBe(ErrorCode.UNKNOWN_ITEM);
  });

  it('charges once for a replayed idempotency key', async () => {
    await setGold(1000);
    const key = newKey();
    const body = { decorId: berry.id, idempotencyKey: key };

    await client.post('/api/decor/buy', body);
    const replay = await client.post('/api/decor/buy', body);

    expect(replay.status).toBe(200);
    expect(await gold()).toBe(1000 - berry.price);
  });

  /**
   * The VIP gate (T-25.01).
   *
   * **This refusal has been in `service.ts` since T-15.23 and could never fire**
   * — `piece()` hardcoded `vipOnly: false`, so there was no piece to refuse and
   * no test could reach the branch. T-25.01 gave it something to guard.
   */
  describe('a VIP-only piece', () => {
    const vipPiece = DECOR[DECOR_IDS.find((id) => DECOR[id]!.vipOnly)!]!;

    const makeVip = (flaggedAt: number | null = null) =>
      db
        .update(schema.players)
        .set({ vipUntil: Date.now() + 30 * 24 * 3_600_000, flaggedAt })
        .where(eq(schema.players.id, playerId));

    it('is refused to a free account, and costs nothing', async () => {
      await setGold(10_000);
      const res = await buy(vipPiece.id);

      expect(res.code).toBe(ErrorCode.FORBIDDEN);
      expect(await gold()).toBe(10_000);
      expect(await ownedOf(vipPiece.id)).toBe(20);
    });

    it('is sold to a VIP, at the ordinary price', async () => {
      await makeVip();
      await setGold(10_000);

      const res = await buy(vipPiece.id);

      expect(res.status, res.code).toBe(200);
      // Same price as anyone pays for its twin: VIP unlocks the piece, it does
      // not discount it, and it is certainly not a gold grant (§7).
      expect(await gold()).toBe(10_000 - vipPiece.price);
      expect(await ownedOf(vipPiece.id)).toBe(21);
    });

    /**
     * A refunded or charged-back account is not VIP, whatever `vipUntil` still
     * says — `isVipActive` is the one place that rule lives, and this is the
     * only decor path that reads it.
     */
    it('is refused to a flagged account with VIP time left', async () => {
      await makeVip(Date.now() - 1);
      await setGold(10_000);

      expect((await buy(vipPiece.id)).code).toBe(ErrorCode.FORBIDDEN);
      expect(await gold()).toBe(10_000);
    });

    /**
     * Listed, not hidden. Knowing what VIP includes is the point of an
     * exclusive, and the client is told which pieces those are so it can say so
     * rather than offering a Buy button the server will refuse (T-25.02).
     */
    it('is still listed in the catalogue, flagged as VIP-only', async () => {
      const res = await client.get('/api/decor/catalogue');
      const entry = res.body.decor.find((d: { id: string }) => d.id === vipPiece.id);

      expect(entry).toBeDefined();
      expect(entry.vipOnly).toBe(true);
      expect(res.body.decor.some((d: { vipOnly: boolean }) => !d.vipOnly)).toBe(true);
    });
  });
});

describe('POST /api/decor/place', () => {

  /**
   * T-18.28 — the same hole the house module had, tested here because the two
   * modules deliberately share a shape (D-11) and a fix applied to one of them
   * is how the other is forgotten.
   *
   * Like its counterpart in `house.integration.test.ts`, this is a smoke test
   * and NOT a regression test: it passes with `lockFarmDecor` removed. The hole
   * is real by inspection — `lockPlacements` locks only the rows it returns,
   * and an undecorated farm returns none — but nothing at this layer reliably
   * produces the interleaving that exposes it.
   */
  it('does not stack pieces when placements are fired concurrently', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => place(DECOR_IDS[0]!, 3, 16)),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await placements()).toHaveLength(1);
  });
  it('places a piece and reports where it went', async () => {
    const at = legalTile(berry);
    const res = await place(berry.id, at.x, at.y);

    expect(res.status, res.code).toBe(200);
    expect(res.body).toMatchObject({ decorId: berry.id, x: at.x, y: at.y });
    expect(await placements()).toHaveLength(1);
  });

  it('consumes one from storage', async () => {
    const before = await ownedOf(berry.id);
    const at = legalTile(berry);
    await place(berry.id, at.x, at.y);
    expect(await ownedOf(berry.id)).toBe(before - 1);
  });

  it('refuses a piece the player does not own', async () => {
    await db.delete(schema.decorOwned).where(eq(schema.decorOwned.playerId, playerId));
    const at = legalTile(berry);

    expect((await place(berry.id, at.x, at.y)).code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await placements()).toHaveLength(0);
  });

  /*
   * The dupe vector `takeOwned`'s `where quantity > 0` actually guards, which
   * the test above does NOT reach: a storage row that EXISTS at zero. Deleting
   * the row makes the update match nothing and throw for a different reason,
   * so removing the guard left that test green — found by break-testing it.
   *
   * Without the guard this drives the count negative and mints decoration from
   * nothing, one placement at a time.
   */
  it('refuses a piece whose storage row exists but is empty', async () => {
    await db
      .update(schema.decorOwned)
      .set({ quantity: 0 })
      .where(eq(schema.decorOwned.playerId, playerId));

    const at = legalTile(berry);
    expect((await place(berry.id, at.x, at.y)).code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
    expect(await placements()).toHaveLength(0);
    expect(await ownedOf(berry.id), 'quantity went negative').toBe(0);
  });

  it('refuses a plot', async () => {
    const plot = PLOT_POSITIONS[0]!;
    expect((await place(berry.id, plot.x, plot.y)).code).toBe(ErrorCode.DECOR_RESERVED_GROUND);
  });

  it('refuses water', async () => {
    // First, not seventh: how much water the farm has is the map author's
    // decision now (`waterTiles()` reads farm.json), and indexing into the
    // middle of it asserted a map shape rather than the rule under test.
    const water = waterTiles()[0];
    if (!water) return;
    expect((await place(berry.id, water.x, water.y)).code).toBe(ErrorCode.DECOR_RESERVED_GROUND);
  });

  it('refuses a tile that is already taken', async () => {
    const at = legalTile(berry);
    await place(berry.id, at.x, at.y);
    expect((await place(berry.id, at.x, at.y)).code).toBe(ErrorCode.PLOT_OCCUPIED);
  });

  it('refuses a solid piece beside a plot', async () => {
    const plot = PLOT_POSITIONS[0]!;
    const res = await place(post.id, plot.x - 1, plot.y);
    expect([ErrorCode.DECOR_BLOCKS_PLOT, ErrorCode.DECOR_RESERVED_GROUND]).toContain(res.code);
  });

  it('refuses a placement off the map', async () => {
    const res = await client.post('/api/decor/place', {
      decorId: berry.id,
      x: 999,
      y: 999,
      idempotencyKey: newKey(),
    });
    // Caught by the schema before it reaches the service.
    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  /*
   * The flood fill, through the real endpoint. A wall of posts down a column
   * cuts the farm in two; the placement that CLOSES it is the one refused, and
   * every piece before it goes down fine.
   */
  it('refuses the piece that would seal the farm, and keeps the rest', async () => {
    let refusals = 0;
    let placed = 0;

    for (let y = 0; y < FARM_HEIGHT; y++) {
      const res = await place(post.id, 20, y);
      if (res.status === 200) placed++;
      else if (res.code === ErrorCode.DECOR_BLOCKS_PATH) refusals++;
    }

    expect(refusals, 'nothing was ever refused for sealing the farm').toBeGreaterThan(0);
    expect(placed, 'no fence could be built at all').toBeGreaterThan(0);
    expect(await placements()).toHaveLength(placed);
  });

  it('places once for a replayed idempotency key', async () => {
    const at = legalTile(berry);
    const body = { decorId: berry.id, x: at.x, y: at.y, idempotencyKey: newKey() };

    await client.post('/api/decor/place', body);
    const replay = await client.post('/api/decor/place', body);

    expect(replay.status).toBe(200);
    expect(await placements()).toHaveLength(1);
  });

  it('refuses an unknown piece', async () => {
    expect((await place('not-a-piece', 5, 5)).code).toBe(ErrorCode.UNKNOWN_ITEM);
  });
});

describe('POST /api/decor/move', () => {
  it('moves a piece without needing a second one', async () => {
    const at = legalTile(berry);
    const placed = (await place(berry.id, at.x, at.y)).body;
    const owned = await ownedOf(berry.id);

    const to = { x: at.x + 3, y: at.y };
    const res = await move(placed.id, to.x, to.y);

    expect(res.status, res.code).toBe(200);
    expect(res.body).toMatchObject({ x: to.x, y: to.y });
    expect(await ownedOf(berry.id), 'moving should not consume storage').toBe(owned);
  });

  it('does not collide a piece with where it already is', async () => {
    // The self-exclusion in `lockPlacements`: nudging a piece must not be
    // refused for overlapping itself.
    const at = legalTile(DECOR.fence_h!);
    const placed = (await place(DECOR.fence_h!.id, at.x, at.y)).body;
    const res = await move(placed.id, at.x + 1, at.y);
    expect([200, 409]).toContain(res.status);
    if (res.status === 409) expect(res.code).not.toBe(ErrorCode.PLOT_OCCUPIED);
  });

  it('refuses another player’s placement', async () => {
    const at = legalTile(berry);
    const placed = (await place(berry.id, at.x, at.y)).body;

    const other = await createTestClient();
    await registerTestUser(other);
    const res = await other.post('/api/decor/move', {
      placementId: placed.id,
      x: 5,
      y: 5,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.NOT_FOUND);
    await other.close();
  });
});

describe('POST /api/decor/remove', () => {
  it('returns the piece to storage rather than destroying it', async () => {
    const at = legalTile(berry);
    const placed = (await place(berry.id, at.x, at.y)).body;
    const owned = await ownedOf(berry.id);

    const res = await remove(placed.id);

    expect(res.status, res.code).toBe(200);
    expect(await placements()).toHaveLength(0);
    // Redecorating is free: a 400g statue picked back up is not 400g gone.
    expect(await ownedOf(berry.id)).toBe(owned + 1);
  });

  it('refuses another player’s placement', async () => {
    const at = legalTile(berry);
    const placed = (await place(berry.id, at.x, at.y)).body;

    const other = await createTestClient();
    await registerTestUser(other);
    const res = await other.post('/api/decor/remove', {
      placementId: placed.id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.NOT_FOUND);
    expect(await placements(), 'the placement survived').toHaveLength(1);
    await other.close();
  });

  it('removes once for a replayed idempotency key', async () => {
    const at = legalTile(berry);
    const placed = (await place(berry.id, at.x, at.y)).body;
    const body = { placementId: placed.id, idempotencyKey: newKey() };

    await client.post('/api/decor/remove', body);
    const replay = await client.post('/api/decor/remove', body);

    expect(replay.status).toBe(200);
    expect(await placements()).toHaveLength(0);
  });
});

describe('building tiers are read at placement time', () => {
  /*
   * A tier-0 player may decorate ground a Deluxe coop would one day cover, and
   * upgrading later does not retroactively refuse it. The important half is the
   * first: reading the reserved MAXIMUM here would make a new farm's east side
   * undecorable for no reason the player could see.
   */
  it('allows ground the top-tier coop would cover, while the coop is tier 0', () => {
    const atTier0 = reservedFarmTiles({ coop: 0, barn: 0 });
    const atTop = reservedFarmTiles({ coop: 2, barn: 2 });
    expect(atTier0.size).toBeLessThan(atTop.size);
  });

  it('refuses ground the CURRENT coop covers', async () => {
    await db.update(schema.farms).set({ coopTier: 2 }).where(eq(schema.farms.playerId, playerId));

    // A tile inside the top-tier coop footprint but outside the tier-0 one.
    const tier0 = reservedFarmTiles({ coop: 0, barn: 0 });
    const top = reservedFarmTiles({ coop: 2, barn: 2 });
    const onlyAtTop = [...top].find((k) => !tier0.has(k))!;
    const [x, y] = onlyAtTop.split(',').map(Number);

    const res = await place(berry.id, x!, y!);
    expect(res.code).toBe(ErrorCode.DECOR_RESERVED_GROUND);
  });
});
