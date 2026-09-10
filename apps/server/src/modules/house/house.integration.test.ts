import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import {
  ErrorCode,
  FURNITURE,
  FURNITURE_IDS,
  FURNITURE_SHEETS,
  IMAGES,
  INTERIOR_ROOM,
  STARTING_FURNITURE,
  getFurniture,
} from '@tillhaven/shared';
import { SPAWN_CELL } from './reachability.js';
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

  /*
   * Clear the starter furnishing (T-18.25).
   *
   * Registration now places `STARTING_FURNITURE`, and every test below reasons
   * about a room whose contents it put there — "refuses a piece landing on one
   * already there" means nothing if four other pieces are also in the way.
   * Emptying here keeps each test's subject the rule it is testing; the starter
   * layout is validated on its own terms in `reachability.test.ts`.
   */
  await db
    .delete(schema.furniturePlacements)
    .where(eq(schema.furniturePlacements.playerId, playerId));
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

/**
 * A cell at the far corner of the room that this piece still FITS in.
 *
 * Derived rather than written down, because the room's size is derived too
 * (T-16.13, D-17): it comes from the authored interior map, so any hardcoded
 * cell is really an assertion about the map's dimensions dressed up as an
 * assertion about placement.
 */
function farCell(furnitureId: string): { x: number; y: number } {
  const def = FURNITURE[furnitureId]!;
  return {
    x: INTERIOR_ROOM.width - def.footprint.width,
    y: INTERIOR_ROOM.height - def.footprint.height,
  };
}

async function placements() {
  return db
    .select()
    .from(schema.furniturePlacements)
    .where(eq(schema.furniturePlacements.playerId, playerId));
}

describe('GET /api/house', () => {
  it('reports the room size, and an empty room once cleared', async () => {
    const res = await client.get('/api/house');

    expect(res.status).toBe(200);
    expect(res.body.placements).toEqual([]);
    expect(res.body.room).toEqual({
      width: INTERIOR_ROOM.width,
      height: INTERIOR_ROOM.height,
    });
  });

  /**
   * A brand-new account walks into a furnished room (T-18.25). Asserted
   * against a client whose `beforeEach` cleanup has NOT run, because the
   * cleanup above is what every other test in this file needs and this is the
   * one test that needs the opposite.
   */
  it('starts a new account with the starter furnishing already placed', async () => {
    const fresh = await createTestClient();
    await registerTestUser(fresh);

    const res = await fresh.get('/api/house');

    expect(res.status).toBe(200);
    expect(res.body.placements).toHaveLength(STARTING_FURNITURE.length);
    expect(res.body.placements.map((p: { furnitureId: string }) => p.furnitureId).sort()).toEqual(
      STARTING_FURNITURE.map((p) => p.furnitureId).sort(),
    );
    await fresh.close();
  });

  it('never shows another player’s house', async () => {
    await place('clock', 0, 0);

    const other = await createTestClient();
    await registerTestUser(other);

    // The other account has its OWN starter room (T-18.25) — the point is that
    // it does not contain this player's clock.
    const theirs = (await other.get('/api/house')).body.placements as { furnitureId: string }[];
    expect(theirs).toHaveLength(STARTING_FURNITURE.length);
    expect(theirs.some((p) => p.furnitureId === 'clock')).toBe(false);

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

  /* ---- reachability (T-18.08) ---- */

  /**
   * Furniture is SOLID since T-18.08, so a placement can now cost the player
   * something permanent: the doorway is where they materialise and the only
   * cell the door can be faced from, and there is no in-game way to remove a
   * piece you cannot walk up to.
   *
   * Asserted through the endpoint and not only in `reachability.test.ts`,
   * because the guard being *wired in* is the half that would break silently —
   * a pure function nobody calls refuses nothing.
   */
  it('refuses a piece that stands in the doorway', async () => {
    const res = await place('stool', SPAWN_CELL.x, SPAWN_CELL.y);

    expect(res.code).toBe(ErrorCode.FURNITURE_BLOCKS_ROOM);
    expect(await placements()).toHaveLength(0);
  });

  it('refuses a piece that boxes another one into a corner', async () => {
    expect((await place('stool', 0, 0)).status).toBe(200);
    expect((await place('stool', 1, 0)).status).toBe(200);

    // The third seals the first in: (0,0)'s only free neighbours were (1,0)
    // and (0,1).
    const res = await place('stool', 0, 1);

    expect(res.code).toBe(ErrorCode.FURNITURE_BLOCKS_ROOM);
    expect(await placements()).toHaveLength(2);
  });

  /**
   * The rug is walked over, so it can never cut anything off — including when
   * it is laid across the doorway, which is what a doormat is.
   */
  it('lets a flat piece go anywhere, doorway included', async () => {
    const res = await place('rug', SPAWN_CELL.x, SPAWN_CELL.y);

    expect(res.status, res.code).toBe(200);
    expect(await placements()).toHaveLength(1);
  });

  /** A move is a placement too, and can seal exactly the same way. */
  it('refuses a MOVE that would stand in the doorway', async () => {
    const placed = await place('stool', 0, 0);
    const id = placed.body.id as string;

    const res = await move(id, SPAWN_CELL.x, SPAWN_CELL.y);

    expect(res.code).toBe(ErrorCode.FURNITURE_BLOCKS_ROOM);
    expect((await placements())[0]).toMatchObject({ x: 0, y: 0 });
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

  /**
   * T-18.28 — the placement race, as far as it can honestly be tested here.
   *
   * **This does not fail on the broken code, and it is kept anyway with that
   * said out loud.** `lockPlacements` uses `SELECT … FOR UPDATE`, which locks
   * only the rows it RETURNS — an empty room returns none — so two overlapping
   * placements can both read "that cell is free" and both insert. The
   * two-request version of this test caught exactly that twice in about six
   * full-suite runs, failing with *both* requests returning 200.
   *
   * Eight requests did not make it reliable, and neither did forcing the
   * interleaving with two held transactions: with the fix REMOVED, both
   * variants still passed. Whatever serialises these in practice is not
   * something this layer can control, so there is no regression test here that
   * would go red if `lockRoom` were deleted — and a test that cannot fail is
   * not evidence (see any "How it turned out" entry in this file).
   *
   * What remains is a smoke test that concurrent placements do not stack, plus
   * the write-up's honest note that the fix rests on inspection and on two
   * observed failures rather than on a red test.
   */
  it('does not stack pieces when placements are fired concurrently', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => place('clock', 4, 4)),
    );

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
  /**
   * The destination is DERIVED, not written down. It was a hardcoded (5,5),
   * which fitted the 10x8 room T-3.05 invented and stopped fitting the moment
   * T-16.13 derived the room from the authored map (12x6) — a 1x2 clock at row
   * 5 wants row 6, and there is no row 6. The test was asserting the room's old
   * dimensions while claiming to assert that moving works.
   */
  it('moves a piece', async () => {
    const placed = (await place('clock', 0, 0)).body;
    const to = farCell('clock');

    const res = await move(placed.id, to.x, to.y);

    expect(res.status, res.code).toBe(200);
    expect(res.body).toMatchObject(to);
    expect((await placements())[0]).toMatchObject(to);
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
    const to = farCell('clock');
    await place('picture', to.x, to.y);

    const res = await move(clock.id, to.x, to.y);

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
  /**
   * T-16.08 gave this test teeth it did not have. It used to compare every crop
   * against one hardcoded 192x144 — the dimensions of a sheet that had already
   * been deleted — so it passed while every piece pointed at an arbitrary slice
   * of a house exterior. Each piece now carries its own kit, and the bound is
   * that kit's real size, which is the check that would have failed then.
   */
  it('crops every piece from inside its own sheet', () => {
    for (const id of Object.keys(FURNITURE)) {
      const def = FURNITURE[id]!;
      expect(def.crop.width, id).toBeGreaterThan(0);
      expect(def.crop.height, id).toBeGreaterThan(0);
      expect(def.crop.x, id).toBeGreaterThanOrEqual(0);
      expect(def.crop.y, id).toBeGreaterThanOrEqual(0);
      expect(def.crop.x + def.crop.width, `${id} overruns ${def.sheet.key}`).toBeLessThanOrEqual(
        def.sheet.width,
      );
      expect(def.crop.y + def.crop.height, `${id} overruns ${def.sheet.key}`).toBeLessThanOrEqual(
        def.sheet.height,
      );
    }
  });

  /** Every kit a piece names has to be one the client actually loads. */
  it('draws every piece from a registered image', () => {
    const registered = new Set(IMAGES.map((i) => i.key));
    for (const id of Object.keys(FURNITURE)) {
      const def = FURNITURE[id]!;
      expect(registered.has(def.sheet.key), `${id} names unregistered sheet ${def.sheet.key}`).toBe(
        true,
      );
    }
    // And nothing is registered for the catalogue that no piece uses.
    for (const sheet of FURNITURE_SHEETS) {
      expect(registered.has(sheet.key), `${sheet.key} is not in IMAGES`).toBe(true);
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
      // T-16.08: which kit the piece is cropped out of. Art, not a benefit —
      // and admitted to this list deliberately rather than by the test being
      // relaxed, which is the only way this guard stays worth having.
      'sheet',
      'crop',
      'footprint',
      /*
       * T-18.08: whether the piece is paint on the floor (the rug) or an object
       * standing on it (everything else). Admitted for the same reason `sheet`
       * was — it decides how the piece is DRAWN and whether it is walked over,
       * not what its owner gets. Neither value grants anything: an upright
       * piece is solid and a flat one is not, and no benefit calculation
       * anywhere reads either.
       */
      'flat',
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
