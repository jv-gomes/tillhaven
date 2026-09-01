import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { ErrorCode, FURNITURE, FURNITURE_IDS, INTERIOR_ROOM, getFurniture } from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';

/**
 * Furniture placement.
 *
 * Three rules the server owns and the client cannot talk it out of: the piece
 * must exist, it must fit inside the room, and it must not overlap anything
 * already there. Ownership is the fourth and comes from the cookie.
 */

let client: TestClient;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  client = await createTestClient();
  playerId = (await registerTestUser(client)).id;

  // Stock the storeroom, so the placement tests below exercise PLACEMENT rules
  // rather than re-testing ownership. Buying has its own section.
  await db.insert(schema.furnitureOwned).values(
    FURNITURE_IDS.map((furnitureId) => ({ playerId, furnitureId, quantity: 10 })),
  );
});

afterAll(closeDb);

function place(furnitureId: string, x: number, y: number) {
  return client.post('/api/house/place', { furnitureId, x, y, idempotencyKey: newKey() });
}

function move(placementId: string, x: number, y: number) {
  return client.post('/api/house/move', { placementId, x, y, idempotencyKey: newKey() });
}

function remove(placementId: string) {
  return client.post('/api/house/remove', { placementId, idempotencyKey: newKey() });
}

async function placements() {
  return db
    .select()
    .from(schema.furniturePlacements)
    .where(eq(schema.furniturePlacements.playerId, playerId));
}

describe('GET /api/house', () => {
  it('starts empty, and reports the room size', async () => {
    const res = await client.get('/api/house');

    expect(res.status).toBe(200);
    expect(res.body.placements).toEqual([]);
    expect(res.body.room).toEqual({
      width: INTERIOR_ROOM.width,
      height: INTERIOR_ROOM.height,
    });
  });

  it('never shows another player’s house', async () => {
    await place('clock', 0, 0);

    const other = await createTestClient();
    await registerTestUser(other);

    expect((await other.get('/api/house')).body.placements).toEqual([]);
    expect((await client.get('/api/house')).body.placements).toHaveLength(1);
    await other.close();
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    expect((await anonymous.get('/api/house')).code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

describe('POST /api/house/place', () => {
  it('places a piece and reports where it went', async () => {
    const res = await place('rug', 1, 2);

    expect(res.status, res.code).toBe(200);
    expect(res.body).toMatchObject({ furnitureId: 'rug', x: 1, y: 2 });
    expect(await placements()).toHaveLength(1);
  });

  it('refuses a piece that is not in the catalogue', async () => {
    const res = await place('throne_of_skulls', 0, 0);

    expect(res.code).toBe(ErrorCode.UNKNOWN_ITEM);
    expect(await placements()).toHaveLength(0);
  });

  /* ---- position ---- */

  it('refuses a position outside the room', async () => {
    const res = await place('clock', INTERIOR_ROOM.width, 0);

    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(await placements()).toHaveLength(0);
  });

  /**
   * The subtle one: the top-left corner is inside the room but the piece is
   * wide enough to hang out of it. Checking the corner alone would let a rug
   * half-vanish through the wall.
   */
  it('refuses a piece whose FOOTPRINT leaves the room, even when its corner does not', async () => {
    const rug = getFurniture('rug')!;
    expect(rug.footprint.width).toBeGreaterThan(1);

    const x = INTERIOR_ROOM.width - 1;
    const res = await place('rug', x, 0);

    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(await placements()).toHaveLength(0);
  });

  it('allows a piece flush against the far wall', async () => {
    const rug = getFurniture('rug')!;
    const res = await place(
      'rug',
      INTERIOR_ROOM.width - rug.footprint.width,
      INTERIOR_ROOM.height - rug.footprint.height,
    );

    expect(res.status, res.code).toBe(200);
  });

  it('refuses a negative or fractional cell at the schema', async () => {
    for (const [x, y] of [[-1, 0], [0, -1], [1.5, 0]] as const) {
      const res = await client.post('/api/house/place', {
        furnitureId: 'clock',
        x,
        y,
        idempotencyKey: newKey(),
      });
      expect(res.code, `${x},${y}`).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  /* ---- overlap ---- */

  it('refuses a piece landing on one already there', async () => {
    await place('clock', 3, 3);
    const res = await place('clock', 3, 3);

    expect(res.code).toBe(ErrorCode.PLOT_OCCUPIED);
    expect(await placements()).toHaveLength(1);
  });

  /**
   * Overlap is rectangle intersection, not corner equality — a big piece can
   * cover a cell its own corner is nowhere near.
   */
  it('refuses a piece that overlaps only partly', async () => {
    await place('rug', 0, 0); // 3x2 cells
    const rug = getFurniture('rug')!;

    // Corner inside the rug's span but not on its corner.
    const res = await place('clock', rug.footprint.width - 1, rug.footprint.height - 1);

    expect(res.code).toBe(ErrorCode.PLOT_OCCUPIED);
    expect(await placements()).toHaveLength(1);
  });

  it('allows a piece immediately alongside another', async () => {
    const rug = getFurniture('rug')!;
    await place('rug', 0, 0);

    const res = await place('clock', rug.footprint.width, 0);
    expect(res.status, res.code).toBe(200);
    expect(await placements()).toHaveLength(2);
  });

  it('cannot be raced into stacking two pieces on one cell', async () => {
    const results = await Promise.all([place('clock', 4, 4), place('clock', 4, 4)]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await placements()).toHaveLength(1);
  });

  it('is idempotent: a replayed placement puts down one piece', async () => {
    const key = newKey();
    const body = { furnitureId: 'clock', x: 2, y: 2, idempotencyKey: key };

    const first = await client.post('/api/house/place', body);
    const replay = await client.post('/api/house/place', body);

    expect(replay.body).toEqual(first.body);
    expect(await placements()).toHaveLength(1);
  });
});

describe('POST /api/house/move', () => {
  it('moves a piece', async () => {
    const placed = (await place('clock', 0, 0)).body;

    const res = await move(placed.id, 5, 5);

    expect(res.status, res.code).toBe(200);
    expect(res.body).toMatchObject({ x: 5, y: 5 });
    expect((await placements())[0]).toMatchObject({ x: 5, y: 5 });
  });

  /** Nudging one cell must not collide with where the piece already is. */
  it('does not collide with itself', async () => {
    const rug = (await place('rug', 0, 0)).body;

    const res = await move(rug.id, 1, 0);

    expect(res.status, res.code).toBe(200);
    expect((await placements())[0]).toMatchObject({ x: 1, y: 0 });
  });

  it('refuses a move onto another piece, leaving it where it was', async () => {
    const clock = (await place('clock', 0, 0)).body;
    await place('picture', 5, 5);

    const res = await move(clock.id, 5, 5);

    expect(res.code).toBe(ErrorCode.PLOT_OCCUPIED);
    expect((await placements()).find((p) => p.id === clock.id)).toMatchObject({ x: 0, y: 0 });
  });

  it('refuses a move out of the room', async () => {
    const clock = (await place('clock', 0, 0)).body;

    const res = await move(clock.id, INTERIOR_ROOM.width, 0);

    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect((await placements())[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("refuses to move another player's furniture", async () => {
    const clock = (await place('clock', 0, 0)).body;

    const other = await createTestClient();
    await registerTestUser(other);
    const res = await other.post('/api/house/move', {
      placementId: clock.id,
      x: 7,
      y: 7,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.NOT_FOUND);
    expect((await placements())[0]).toMatchObject({ x: 0, y: 0 });
    await other.close();
  });
});

describe('POST /api/house/remove', () => {
  it('takes a piece back out', async () => {
    const clock = (await place('clock', 0, 0)).body;

    const res = await remove(clock.id);

    expect(res.status, res.code).toBe(200);
    expect(await placements()).toHaveLength(0);
  });

  it('frees the cell it was on', async () => {
    const clock = (await place('clock', 3, 3)).body;
    await remove(clock.id);

    expect((await place('picture', 3, 3)).status).toBe(200);
  });

  it("refuses another player's furniture", async () => {
    const clock = (await place('clock', 0, 0)).body;

    const other = await createTestClient();
    await registerTestUser(other);
    const res = await other.post('/api/house/remove', {
      placementId: clock.id,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.NOT_FOUND);
    expect(await placements()).toHaveLength(1);
    await other.close();
  });

  it('is idempotent: a replayed removal is not an error', async () => {
    const clock = (await place('clock', 0, 0)).body;
    const key = newKey();

    const first = await client.post('/api/house/remove', {
      placementId: clock.id,
      idempotencyKey: key,
    });
    const replay = await client.post('/api/house/remove', {
      placementId: clock.id,
      idempotencyKey: key,
    });

    expect(first.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await placements()).toHaveLength(0);
  });
});

describe('the catalogue', () => {
  it('crops every piece from inside the sheet', () => {
    for (const id of Object.keys(FURNITURE)) {
      const def = FURNITURE[id]!;
      expect(def.crop.width, id).toBeGreaterThan(0);
      expect(def.crop.height, id).toBeGreaterThan(0);
      expect(def.crop.x + def.crop.width, id).toBeLessThanOrEqual(192);
      expect(def.crop.y + def.crop.height, id).toBeLessThanOrEqual(144);
    }
  });

  it('gives every piece a footprint that fits in the room', () => {
    for (const id of Object.keys(FURNITURE)) {
      const def = FURNITURE[id]!;
      expect(def.footprint.width, id).toBeGreaterThanOrEqual(1);
      expect(def.footprint.width, id).toBeLessThanOrEqual(INTERIOR_ROOM.width);
      expect(def.footprint.height, id).toBeLessThanOrEqual(INTERIOR_ROOM.height);
    }
  });

  /** §7: a VIP cosmetic must never be tradeable. */
  it('never marks a VIP-only piece tradeable', () => {
    for (const id of Object.keys(FURNITURE)) {
      const def = FURNITURE[id]!;
      if (def.vipOnly) expect(def.tradeable, id).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Buying (T-3.06)
 * ------------------------------------------------------------------ */

describe('the decoration catalogue', () => {
  async function gold(): Promise<number> {
    const [row] = await db
      .select({ gold: schema.players.gold })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));
    return row!.gold;
  }

  async function setGold(amount: number): Promise<void> {
    await db.update(schema.players).set({ gold: amount }).where(eq(schema.players.id, playerId));
  }

  async function makeVip(): Promise<void> {
    await db
      .update(schema.players)
      .set({ vipUntil: Date.now() + 86_400_000 })
      .where(eq(schema.players.id, playerId));
  }

  function buy(furnitureId: string) {
    return client.post('/api/house/buy', { furnitureId, idempotencyKey: newKey() });
  }

  async function ownedOf(furnitureId: string): Promise<number> {
    const rows = await db
      .select()
      .from(schema.furnitureOwned)
      .where(eq(schema.furnitureOwned.playerId, playerId));
    return rows.find((r) => r.furnitureId === furnitureId)?.quantity ?? 0;
  }

  it('serves the catalogue with prices from config', async () => {
    const res = await client.get('/api/house/catalogue');

    expect(res.status).toBe(200);
    expect(res.body.furniture).toHaveLength(FURNITURE_IDS.length);

    const rug = res.body.furniture.find((f: { id: string }) => f.id === 'rug');
    expect(rug.price).toBe(FURNITURE.rug!.price);
  });

  it('charges gold and adds the piece to storage', async () => {
    const chair = FURNITURE.chair!;
    await setGold(chair.price);
    const before = await ownedOf('chair');

    const res = await buy('chair');

    expect(res.status, res.code).toBe(200);
    expect(res.body.goldDelta).toBe(-chair.price);
    expect(await gold()).toBe(0);
    expect(await ownedOf('chair')).toBe(before + 1);
  });

  it('refuses without the gold, and stores nothing', async () => {
    const fireplace = FURNITURE.fireplace!;
    await setGold(fireplace.price - 1);
    const before = await ownedOf('fireplace');

    const res = await buy('fireplace');

    expect(res.code).toBe(ErrorCode.INSUFFICIENT_GOLD);
    expect(await ownedOf('fireplace')).toBe(before);
    expect(await gold()).toBe(fireplace.price - 1);
  });

  it('refuses a piece that is not in the catalogue', async () => {
    await setGold(1_000_000);
    expect((await buy('throne_of_skulls')).code).toBe(ErrorCode.UNKNOWN_ITEM);
  });

  it('is idempotent: a replayed purchase buys one', async () => {
    await setGold(1_000_000);
    const before = await ownedOf('clock');
    const key = newKey();

    const first = await client.post('/api/house/buy', { furnitureId: 'clock', idempotencyKey: key });
    const replay = await client.post('/api/house/buy', { furnitureId: 'clock', idempotencyKey: key });

    expect(replay.body).toEqual(first.body);
    expect(await ownedOf('clock')).toBe(before + 1);
  });

  it('cannot be raced into buying two for one price', async () => {
    const chair = FURNITURE.chair!;
    await setGold(chair.price);
    const before = await ownedOf('chair');

    const results = await Promise.all([buy('chair'), buy('chair'), buy('chair')]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await ownedOf('chair')).toBe(before + 1);
    expect(await gold()).toBe(0);
  });

  /* ---- VIP exclusives (§7) ---- */

  it('refuses a VIP-only piece to a free account', async () => {
    const vipPiece = FURNITURE_IDS.find((id) => FURNITURE[id]!.vipOnly)!;
    await setGold(1_000_000);
    const before = await ownedOf(vipPiece);

    const res = await buy(vipPiece);

    expect(res.code).toBe(ErrorCode.FORBIDDEN);
    expect(await ownedOf(vipPiece)).toBe(before);
    expect(await gold()).toBe(1_000_000);
  });

  it('sells a VIP-only piece to a VIP', async () => {
    const vipPiece = FURNITURE_IDS.find((id) => FURNITURE[id]!.vipOnly)!;
    await setGold(1_000_000);
    await makeVip();

    expect((await buy(vipPiece)).status).toBe(200);
  });

  /**
   * §7 again, from the other direction: a refund flags the account, and a
   * flagged account is not VIP however far off its expiry is.
   */
  it('refuses a VIP-only piece to a flagged account, even before its VIP expires', async () => {
    const vipPiece = FURNITURE_IDS.find((id) => FURNITURE[id]!.vipOnly)!;
    await setGold(1_000_000);
    await makeVip();
    await db
      .update(schema.players)
      .set({ flaggedAt: Date.now() })
      .where(eq(schema.players.id, playerId));

    expect((await buy(vipPiece)).code).toBe(ErrorCode.FORBIDDEN);
  });
});

/* ------------------------------------------------------------------ *
 * Furniture is conserved
 * ------------------------------------------------------------------ */

/**
 * Placing takes one out of storage and removing puts it back, so the total a
 * player owns only changes when they buy. Without that, a room could be filled
 * with pieces nobody paid for — the same class of bug as an item dupe, just
 * quieter, because decoration is not worth anything to anyone else.
 */
describe('placing and removing conserve furniture', () => {
  async function totalOwned(): Promise<number> {
    const rows = await db
      .select()
      .from(schema.furnitureOwned)
      .where(eq(schema.furnitureOwned.playerId, playerId));
    return rows.reduce((sum, r) => sum + r.quantity, 0);
  }

  it('placing takes one from storage', async () => {
    const before = await totalOwned();
    await place('chair', 0, 0);
    expect(await totalOwned()).toBe(before - 1);
  });

  it('removing puts it back', async () => {
    const before = await totalOwned();
    const chair = (await place('chair', 0, 0)).body;
    await remove(chair.id);
    expect(await totalOwned()).toBe(before);
  });

  it('moving changes nothing', async () => {
    const chair = (await place('chair', 0, 0)).body;
    const before = await totalOwned();

    await move(chair.id, 5, 5);
    expect(await totalOwned()).toBe(before);
  });

  it('refuses to place a piece the player does not own', async () => {
    await db.delete(schema.furnitureOwned).where(eq(schema.furnitureOwned.playerId, playerId));

    const res = await place('chair', 0, 0);
    expect(res.code).toBe(ErrorCode.INSUFFICIENT_ITEMS);
  });

  it('cannot place the same single piece twice at once', async () => {
    await db.delete(schema.furnitureOwned).where(eq(schema.furnitureOwned.playerId, playerId));
    await db
      .insert(schema.furnitureOwned)
      .values({ playerId, furnitureId: 'chair', quantity: 1 });

    const results = await Promise.all([place('chair', 0, 0), place('chair', 4, 4)]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await totalOwned()).toBe(0);
  });

  it('reports storage alongside the room', async () => {
    const res = await client.get('/api/house');
    expect(res.body.owned.length).toBeGreaterThan(0);
    expect(res.body.owned.every((o: { quantity: number }) => o.quantity > 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Decoration is decoration (§5.5, §7)
 * ------------------------------------------------------------------ */

/**
 * "No decoration grants any gameplay benefit" is the kind of rule that is true
 * on the day it is written and quietly false a year later, when someone adds a
 * `bonusStorage` to a wardrobe because it seemed harmless. These are the two
 * ways to hold it: the DEFINITION cannot express a benefit, and the code that
 * computes benefits cannot see furniture.
 */
describe('furniture grants nothing', () => {
  it('has no field on its definition that could be a bonus', () => {
    const allowed = new Set([
      'id',
      'name',
      'crop',
      'footprint',
      'price',
      'tradeable',
      'vipOnly',
    ]);

    for (const id of FURNITURE_IDS) {
      for (const key of Object.keys(FURNITURE[id]!)) {
        expect(
          allowed.has(key),
          `furniture "${id}" has an unexpected field "${key}" — if it is a gameplay ` +
            'bonus, §5.5 says decoration must not have one',
        ).toBe(true);
      }
    }
  });

  /**
   * The stronger half. Capacity, the animal cap and production are computed in
   * known places; none of them may so much as import the furniture config,
   * because a benefit it cannot see is a benefit it cannot grant.
   */
  it('is invisible to every file that computes a bonus', async () => {
    const serverSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const benefitFiles = [
      join(serverSrc, 'modules', 'inventory', 'service.ts'),
      join(serverSrc, 'modules', 'animals', 'service.ts'),
      join(serverSrc, 'modules', 'animals', 'production.ts'),
      join(serverSrc, 'modules', 'farm', 'growth.ts'),
      join(serverSrc, 'modules', 'farm', 'house.ts'),
      join(serverSrc, 'modules', 'farm', 'level.ts'),
    ];

    for (const path of benefitFiles) {
      const source = await readFile(path, 'utf8');
      expect(
        /\bFURNITURE\b|getFurniture|furnitureOwned|furniturePlacements/.test(source),
        `${relative(serverSrc, path)} references furniture — it computes a gameplay ` +
          'bonus, and decoration must never feed into one',
      ).toBe(false);
    }
  });

  /** Every VIP exclusive is non-tradeable, checked against the live catalogue. */
  it('never makes a VIP exclusive tradeable', () => {
    const vipPieces = FURNITURE_IDS.filter((id) => FURNITURE[id]!.vipOnly);

    expect(vipPieces.length, 'the §7 rule needs at least one VIP piece to be about').toBeGreaterThan(0);
    for (const id of vipPieces) {
      expect(FURNITURE[id]!.tradeable, id).toBe(false);
    }
  });

  it('prices every piece as a positive whole number of gold', () => {
    for (const id of FURNITURE_IDS) {
      const price = FURNITURE[id]!.price;
      expect(Number.isInteger(price), id).toBe(true);
      expect(price, id).toBeGreaterThan(0);
    }
  });
});
