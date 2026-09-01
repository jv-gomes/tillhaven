import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  ErrorCode,
  FARM_LEVEL_XP,
  TRADE_INVITE_TTL_MS,
  TRADE_MIN_ACCOUNT_AGE_MS,
  TRADE_MIN_FARM_LEVEL,
  TRADE_SESSION_TTL_MS,
  GOLD_IS_TRADEABLE,
} from '@tillhaven/shared';
import { and, eq as eqOp } from 'drizzle-orm';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb } from '../../test/helpers.js';
import { createTestClient, registerTestUser, newKey, type TestClient } from '../../test/app.js';
import { TradeStatus } from './lifecycle.js';
import {
  invite as inviteService,
  setOffer as setOfferService,
  confirm as confirmService,
} from './service.js';

/**
 * The trade session: who can open one, with whom, and when it dies.
 *
 * What is *in* the offer is T-4.03 onward. This file is about the conversation
 * existing — and its failure modes are the ones that strand people rather than
 * duplicate items, so the emphasis is on nobody getting stuck.
 */

const ELIGIBLE_XP = FARM_LEVEL_XP[TRADE_MIN_FARM_LEVEL - 1]!;

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let aliceName: string;
let bobName: string;

/** Makes an account old enough and experienced enough to trade. */
async function makeEligible(playerId: string): Promise<void> {
  await db
    .update(schema.players)
    .set({
      createdAt: Date.now() - TRADE_MIN_ACCOUNT_AGE_MS - 1000,
      experience: ELIGIBLE_XP,
      flaggedAt: null,
    })
    .where(eq(schema.players.id, playerId));
}

beforeEach(async () => {
  await resetDb();

  alice = await createTestClient();
  bob = await createTestClient();

  const a = await registerTestUser(alice);
  const b = await registerTestUser(bob);
  aliceId = a.id;
  bobId = b.id;
  aliceName = a.username;
  bobName = b.username;

  await makeEligible(aliceId);
  await makeEligible(bobId);
});

afterAll(closeDb);

function invite(client: TestClient, targetUsername: string) {
  return client.post('/api/trade/invite', { targetUsername, idempotencyKey: newKey() });
}

function accept(client: TestClient, tradeId: string) {
  return client.post('/api/trade/accept', { tradeId, idempotencyKey: newKey() });
}

function cancel(client: TestClient, tradeId: string) {
  return client.post('/api/trade/cancel', { tradeId });
}

/** Moves a trade's deadline into the past, without touching its status. */
async function expire(tradeId: string): Promise<void> {
  await db
    .update(schema.trades)
    .set({ expiresAt: Date.now() - 1 })
    .where(eq(schema.trades.id, tradeId));
}

async function storedStatus(tradeId: string): Promise<string> {
  const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
  return row!.status;
}

describe('POST /api/trade/invite', () => {
  it('opens a pending trade with the named farmer', async () => {
    const res = await invite(alice, bobName);

    expect(res.status, res.code).toBe(200);
    expect(res.body.status).toBe(TradeStatus.PENDING);
    expect(res.body.initiatorName).toBe(aliceName);
    expect(res.body.recipientName).toBe(bobName);
    expect(res.body.isInitiator).toBe(true);
    expect(res.body.expiresInMs).toBeGreaterThan(0);
    expect(res.body.expiresInMs).toBeLessThanOrEqual(TRADE_INVITE_TTL_MS);
  });

  it('finds a farmer whatever case their name is typed in', async () => {
    const res = await invite(alice, bobName.toUpperCase());
    expect(res.status, res.code).toBe(200);
  });

  it('refuses a name nobody has', async () => {
    const res = await invite(alice, 'nobody_at_all');
    expect(res.code).toBe(ErrorCode.TRADE_NOT_FOUND);
  });

  it('refuses trading with yourself', async () => {
    const res = await invite(alice, aliceName);
    expect(res.code).toBe(ErrorCode.TRADE_SELF);
  });

  /* ---- eligibility, both parties ---- */

  it('refuses an ineligible caller, and says why', async () => {
    await db.update(schema.players).set({ experience: 0 }).where(eq(schema.players.id, aliceId));

    const res = await invite(alice, bobName);

    expect(res.code).toBe(ErrorCode.TRADE_NOT_ELIGIBLE);
    expect(res.body.error.details.blockedBy).toBe('farm_too_low');
  });

  /** The same scam run from the other end: pulling an ineligible player in. */
  it('refuses an ineligible target', async () => {
    await db.update(schema.players).set({ experience: 0 }).where(eq(schema.players.id, bobId));

    const res = await invite(alice, bobName);
    expect(res.code).toBe(ErrorCode.TRADE_NOT_ELIGIBLE);
  });

  it('does not say why the target is ineligible', async () => {
    await db
      .update(schema.players)
      .set({ experience: 0, flaggedAt: Date.now() })
      .where(eq(schema.players.id, bobId));

    const res = await invite(alice, bobName);
    expect(res.body.error.details).toEqual({ blockedBy: 'partner' });
  });

  /* ---- one at a time ---- */

  it('refuses a second trade while one is live', async () => {
    await invite(alice, bobName);

    const carol = await createTestClient();
    const c = await registerTestUser(carol);
    await makeEligible(c.id);

    const res = await invite(alice, c.username);
    expect(res.code).toBe(ErrorCode.TRADE_ALREADY_OPEN);
    await carol.close();
  });

  it('refuses inviting someone who is already trading', async () => {
    const carol = await createTestClient();
    const c = await registerTestUser(carol);
    await makeEligible(c.id);

    await invite(carol, bobName);
    const res = await invite(alice, bobName);

    expect(res.code).toBe(ErrorCode.TRADE_ALREADY_OPEN);
    await carol.close();
  });

  /**
   * The real race, at the service level.
   *
   * Two transactions inviting the same third player, deliberately overlapped.
   * Under MVCC the second cannot see the first's uncommitted insert, so without
   * a lock on the target both read "carol has no live trade" and both commit —
   * leaving her in two trades, able to offer the same item in each.
   *
   * Driven through `db.transaction` rather than the HTTP layer on purpose: two
   * earlier attempts through `app.inject` passed with the lock removed, because
   * the in-process harness serialises those requests and the race never
   * happened. A test that cannot fail is not evidence.
   */
  it('cannot be raced into pulling one player into two trades', async () => {
    const carol = await createTestClient();
    const c = await registerTestUser(carol);
    await makeEligible(c.id);

    const [aliceRow] = await db.select().from(schema.players).where(eq(schema.players.id, aliceId));
    const [bobRow] = await db.select().from(schema.players).where(eq(schema.players.id, bobId));
    const now = Date.now();

    let release: (() => void) | undefined;
    const holdOpen = new Promise<void>((resolve) => {
      release = resolve;
    });

    // First invite, held open inside its transaction so the second overlaps it.
    const first = db.transaction(async (tx) => {
      const view = await inviteService(tx, aliceRow as never, c.username, now);
      await holdOpen;
      return view;
    });

    await new Promise((r) => setTimeout(r, 150));

    const second = db
      .transaction((tx) => inviteService(tx, bobRow as never, c.username, now))
      .then(() => 'landed')
      .catch((err: { code?: string }) => err.code ?? 'error');

    await new Promise((r) => setTimeout(r, 150));
    release!();

    await first;
    const outcome = await second;

    expect(outcome, 'the second invite landed — carol is in two trades at once').toBe(
      ErrorCode.TRADE_ALREADY_OPEN,
    );
    expect(await db.select().from(schema.trades)).toHaveLength(1);
    await carol.close();
  });

  it('allows a new trade once the last one is over', async () => {
    const first = await invite(alice, bobName);
    await cancel(alice, first.body.id);

    expect((await invite(alice, bobName)).status).toBe(200);
  });

  it('is idempotent: a replayed invite opens one trade', async () => {
    const key = newKey();
    const body = { targetUsername: bobName, idempotencyKey: key };

    const first = await alice.post('/api/trade/invite', body);
    const replay = await alice.post('/api/trade/invite', body);

    expect(replay.body).toEqual(first.body);
    expect(await db.select().from(schema.trades)).toHaveLength(1);
  });
});

describe('POST /api/trade/accept', () => {
  it('opens the session and restarts the clock', async () => {
    const invited = await invite(alice, bobName);

    const res = await accept(bob, invited.body.id);

    expect(res.status, res.code).toBe(200);
    expect(res.body.status).toBe(TradeStatus.OPEN);
    // The negotiation gets its own, longer deadline.
    expect(res.body.expiresInMs).toBeGreaterThan(TRADE_INVITE_TTL_MS);
    expect(res.body.expiresInMs).toBeLessThanOrEqual(TRADE_SESSION_TTL_MS);
  });

  it('refuses the initiator accepting their own invite', async () => {
    const invited = await invite(alice, bobName);

    const res = await accept(alice, invited.body.id);
    expect(res.code).toBe(ErrorCode.TRADE_NOT_FOUND);
  });

  it("refuses a stranger's trade without confirming it exists", async () => {
    const invited = await invite(alice, bobName);

    const carol = await createTestClient();
    await registerTestUser(carol);

    const res = await accept(carol, invited.body.id);
    expect(res.code).toBe(ErrorCode.TRADE_NOT_FOUND);
    await carol.close();
  });

  it('refuses an expired invite', async () => {
    const invited = await invite(alice, bobName);
    await expire(invited.body.id);

    const res = await accept(bob, invited.body.id);
    expect(res.code).toBe(ErrorCode.TRADE_EXPIRED);
  });

  it('refuses accepting twice', async () => {
    const invited = await invite(alice, bobName);
    await accept(bob, invited.body.id);

    const res = await accept(bob, invited.body.id);
    expect(res.code).toBe(ErrorCode.TRADE_NOT_FOUND);
  });

  /** An invite can sit for two minutes; a chargeback can land in that time. */
  it('re-checks eligibility at accept, not just at invite', async () => {
    const invited = await invite(alice, bobName);

    await db
      .update(schema.players)
      .set({ flaggedAt: Date.now() })
      .where(eq(schema.players.id, aliceId));

    const res = await accept(bob, invited.body.id);
    expect(res.code).toBe(ErrorCode.TRADE_NOT_ELIGIBLE);
  });
});

describe('POST /api/trade/cancel', () => {
  it('lets the initiator walk away', async () => {
    const invited = await invite(alice, bobName);

    const res = await cancel(alice, invited.body.id);
    expect(res.body.status).toBe(TradeStatus.CANCELLED);
  });

  it('lets the recipient refuse', async () => {
    const invited = await invite(alice, bobName);

    const res = await cancel(bob, invited.body.id);
    expect(res.body.status).toBe(TradeStatus.CANCELLED);
  });

  it('works on an accepted session too', async () => {
    const invited = await invite(alice, bobName);
    await accept(bob, invited.body.id);

    expect((await cancel(alice, invited.body.id)).body.status).toBe(TradeStatus.CANCELLED);
  });

  /**
   * Walking away must never fail. "Cancel" on an already-dead trade is what a
   * player does when they are unsure, not an error to report at them.
   */
  it('is not an error to cancel twice', async () => {
    const invited = await invite(alice, bobName);
    await cancel(alice, invited.body.id);

    const again = await cancel(alice, invited.body.id);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe(TradeStatus.CANCELLED);
  });

  it("refuses to cancel a stranger's trade", async () => {
    const invited = await invite(alice, bobName);

    const carol = await createTestClient();
    await registerTestUser(carol);

    expect((await cancel(carol, invited.body.id)).code).toBe(ErrorCode.TRADE_NOT_FOUND);
    await carol.close();
  });

  it('frees both parties to trade again', async () => {
    const invited = await invite(alice, bobName);
    await cancel(bob, invited.body.id);

    expect((await invite(bob, aliceName)).status).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * Expiry
 * ------------------------------------------------------------------ */

/**
 * §4.2 applied to trades: expiry is **computed on read**, never ticked. A
 * sweeper that runs every minute leaves a window where an abandoned trade is
 * still executable, and "it completed after I walked away" is the one complaint
 * a trading system cannot afford.
 */
describe('expiry needs no job', () => {
  it('reads as expired the instant its deadline passes', async () => {
    const invited = await invite(alice, bobName);
    await expire(invited.body.id);

    const res = await alice.get(`/api/trade/${invited.body.id}`);

    expect(res.body.status).toBe(TradeStatus.EXPIRED);
    expect(res.body.expiresInMs).toBe(0);
    // Nothing wrote the column — the status is derived.
    expect(await storedStatus(invited.body.id)).toBe(TradeStatus.PENDING);
  });

  it('stops being the player’s current trade', async () => {
    const invited = await invite(alice, bobName);
    expect((await alice.get('/api/trade/current')).body.trade).not.toBeNull();

    await expire(invited.body.id);
    expect((await alice.get('/api/trade/current')).body.trade).toBeNull();
  });

  it('frees both parties to trade again, with no cleanup run', async () => {
    const invited = await invite(alice, bobName);
    await expire(invited.body.id);

    const res = await invite(alice, bobName);
    expect(res.status, res.code).toBe(200);
  });

  it('leaves a completed or cancelled trade alone whatever its deadline says', async () => {
    const invited = await invite(alice, bobName);
    await cancel(alice, invited.body.id);
    await expire(invited.body.id);

    const res = await alice.get(`/api/trade/${invited.body.id}`);
    expect(res.body.status).toBe(TradeStatus.CANCELLED);
  });
});

describe('GET /api/trade/current', () => {
  it('is null when there is no trade', async () => {
    expect((await alice.get('/api/trade/current')).body.trade).toBeNull();
  });

  it('shows the same trade to both parties, from each point of view', async () => {
    const invited = await invite(alice, bobName);

    const hers = (await alice.get('/api/trade/current')).body.trade;
    const his = (await bob.get('/api/trade/current')).body.trade;

    expect(hers.id).toBe(invited.body.id);
    expect(his.id).toBe(invited.body.id);
    expect(hers.isInitiator).toBe(true);
    expect(his.isInitiator).toBe(false);
  });

  it('requires a session', async () => {
    const anonymous = await createTestClient();
    expect((await anonymous.get('/api/trade/current')).code).toBe(ErrorCode.UNAUTHENTICATED);
    await anonymous.close();
  });
});

/* ------------------------------------------------------------------ *
 * The offer, and the revision counter (T-4.03)
 * ------------------------------------------------------------------ */

/**
 * The anti-scam mechanic (§6).
 *
 * The classic trade scam is to wait until the other party has confirmed, swap
 * something valuable for something worthless, and let them complete out of
 * habit. Every test below exists to make that impossible rather than merely
 * unlikely.
 */
describe('POST /api/trade/offer', () => {
  let tradeId: string;

  /** Puts items in a player's bag, in the first free slot. */
  async function give(playerId: string, itemId: string, quantity: number): Promise<void> {
    const existing = await db
      .select({ slotIndex: schema.inventoryItems.slotIndex })
      .from(schema.inventoryItems)
      .where(
        and(
          eqOp(schema.inventoryItems.playerId, playerId),
          eqOp(schema.inventoryItems.container, 'inventory'),
        ),
      );

    const used = new Set(existing.map((s) => s.slotIndex));
    let slotIndex = 0;
    while (used.has(slotIndex)) slotIndex += 1;

    await db
      .insert(schema.inventoryItems)
      .values({ playerId, container: 'inventory', slotIndex, itemId, quantity });
  }

  function offer(client: TestClient, items: unknown[], gold = 0) {
    return client.post('/api/trade/offer', {
      tradeId,
      items,
      gold,
      idempotencyKey: newKey(),
    });
  }

  function confirmDirectly(playerId: string) {
    // T-4.04 owns the confirm endpoint; this sets the flag so T-4.03 can prove
    // that editing an offer clears it.
    const column = playerId === aliceId ? 'initiatorConfirmed' : 'recipientConfirmed';
    return db
      .update(schema.trades)
      .set({ [column]: true })
      .where(eqOp(schema.trades.id, tradeId));
  }

  async function tradeRow() {
    const [row] = await db.select().from(schema.trades).where(eqOp(schema.trades.id, tradeId));
    return row!;
  }

  beforeEach(async () => {
    const invited = await invite(alice, bobName);
    await accept(bob, invited.body.id);
    tradeId = invited.body.id;

    await give(aliceId, 'leek', 10);
    await give(bobId, 'potato', 10);
  });

  it('sets the caller’s own side', async () => {
    const res = await offer(alice, [{ itemId: 'leek', quantity: 3 }]);

    expect(res.status, res.code).toBe(200);
    expect(res.body.you.items).toEqual([{ itemId: 'leek', quantity: 3 }]);
    expect(res.body.them.items).toEqual([]);
  });

  /** The side comes from the session; there is no field to tamper with. */
  it('never lets a player set the other side', async () => {
    await offer(alice, [{ itemId: 'leek', quantity: 3 }]);
    const res = await offer(bob, [{ itemId: 'potato', quantity: 2 }]);

    const row = await tradeRow();
    expect(row.initiatorItems).toContain('leek');
    expect(row.recipientItems).toContain('potato');
    // Each sees their own as "you".
    expect(res.body.you.items).toEqual([{ itemId: 'potato', quantity: 2 }]);
    expect(res.body.them.items).toEqual([{ itemId: 'leek', quantity: 3 }]);
  });

  /* ---- the revision counter ---- */

  it('bumps the revision on every change', async () => {
    const before = (await tradeRow()).revision;

    await offer(alice, [{ itemId: 'leek', quantity: 1 }]);
    expect((await tradeRow()).revision).toBe(before + 1);

    await offer(bob, [{ itemId: 'potato', quantity: 1 }]);
    expect((await tradeRow()).revision).toBe(before + 2);
  });

  it('increases monotonically and never reuses a value', async () => {
    const seen: number[] = [];

    for (let i = 1; i <= 6; i++) {
      const res = await offer(i % 2 === 0 ? alice : bob, [
        { itemId: i % 2 === 0 ? 'leek' : 'potato', quantity: i },
      ]);
      seen.push(res.body.revision);
    }

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('bumps even when the offer is set to the same thing', async () => {
    const first = await offer(alice, [{ itemId: 'leek', quantity: 2 }]);
    const again = await offer(alice, [{ itemId: 'leek', quantity: 2 }]);

    expect(again.body.revision).toBeGreaterThan(first.body.revision);
  });

  it('bumps when an offer is emptied', async () => {
    const first = await offer(alice, [{ itemId: 'leek', quantity: 2 }]);
    const cleared = await offer(alice, []);

    expect(cleared.body.revision).toBeGreaterThan(first.body.revision);
    expect(cleared.body.you.items).toEqual([]);
  });

  /* ---- both confirmations die on every edit ---- */

  /**
   * The scam this prevents: confirm, then swap the goods, and rely on the
   * victim's confirmation still standing. Clearing only the OTHER side would
   * leave exactly that hole, so the editor's own confirmation goes too.
   */
  it('clears BOTH confirmations when either side edits', async () => {
    await confirmDirectly(aliceId);
    await confirmDirectly(bobId);

    let row = await tradeRow();
    expect(row.initiatorConfirmed && row.recipientConfirmed).toBe(true);

    await offer(alice, [{ itemId: 'leek', quantity: 5 }]);

    row = await tradeRow();
    expect(row.initiatorConfirmed).toBe(false);
    expect(row.recipientConfirmed).toBe(false);
  });

  it('clears both when the RECIPIENT edits too', async () => {
    await confirmDirectly(aliceId);
    await confirmDirectly(bobId);

    await offer(bob, [{ itemId: 'potato', quantity: 1 }]);

    const row = await tradeRow();
    expect(row.initiatorConfirmed).toBe(false);
    expect(row.recipientConfirmed).toBe(false);
  });

  it('reports both sides as unconfirmed afterwards', async () => {
    await confirmDirectly(aliceId);
    const res = await offer(alice, [{ itemId: 'leek', quantity: 1 }]);

    expect(res.body.you.confirmed).toBe(false);
    expect(res.body.them.confirmed).toBe(false);
  });

  /* ---- what may be offered ---- */

  it('refuses an item the player does not hold', async () => {
    const res = await offer(alice, [{ itemId: 'potato', quantity: 1 }]);
    expect(res.code).toBe(ErrorCode.TRADE_ITEM_MISSING);
  });

  it('refuses more than the player holds', async () => {
    const res = await offer(alice, [{ itemId: 'leek', quantity: 11 }]);
    expect(res.code).toBe(ErrorCode.TRADE_ITEM_MISSING);
  });

  it('refuses an unknown item', async () => {
    const res = await offer(alice, [{ itemId: 'philosophers_stone', quantity: 1 }]);
    expect(res.code).toBe(ErrorCode.UNKNOWN_ITEM);
  });

  /**
   * T-8.06. Tools are the first inventory items marked `tradeable: false`, so
   * until now `offer.ts`'s guard had nothing to refuse and no test could reach
   * it. Every account is granted the wood tier at registration, so a tool
   * market would be a market in nothing — and the refusal has to come from the
   * item's own flag, not from a hardcoded id list.
   */
  it('refuses a tool, which the player really does hold', async () => {
    // Straight from the starter kit — this is not an item Alice lacks.
    const bag = await alice.get('/api/inventory');
    const hoe = bag.body.slots.find((s: { itemId: string }) => s.itemId === 'hoe_wood');
    expect(hoe, 'the starter kit should have granted a hoe').toBeDefined();

    for (const itemId of ['hoe_wood', 'watering_can_wood']) {
      const res = await offer(alice, [{ itemId, quantity: 1 }]);
      expect(res.code, itemId).toBe(ErrorCode.VALIDATION_FAILED);
      expect(res.body.error.details.itemId, itemId).toBe(itemId);
    }
  });

  it('refuses a quantity that is not a positive whole number', async () => {
    for (const quantity of [0, -1, 1.5]) {
      const res = await offer(alice, [{ itemId: 'leek', quantity }]);
      expect(res.code, String(quantity)).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  /**
   * Summing duplicates would mean the offer a player confirms is not the offer
   * they were shown — the exact confusion this system exists to prevent.
   */
  it('refuses the same item listed twice rather than adding it up', async () => {
    const res = await offer(alice, [
      { itemId: 'leek', quantity: 2 },
      { itemId: 'leek', quantity: 3 },
    ]);

    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  /** D-3 is undecided: gold is refused outright, never silently dropped. */
  it('refuses gold while GOLD_IS_TRADEABLE is false', async () => {
    expect(GOLD_IS_TRADEABLE).toBe(false);

    const res = await offer(alice, [{ itemId: 'leek', quantity: 1 }], 100);
    expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);

    const row = await tradeRow();
    expect(row.initiatorGold).toBe(0);
  });

  /* ---- when an offer may be set ---- */

  it('refuses before the invite is accepted', async () => {
    const carol = await createTestClient();
    const c = await registerTestUser(carol);
    await makeEligible(c.id);
    await cancel(alice, tradeId);

    const pending = await invite(alice, c.username);
    const res = await alice.post('/api/trade/offer', {
      tradeId: pending.body.id,
      items: [],
      gold: 0,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.TRADE_NOT_FOUND);
    await carol.close();
  });

  it('refuses on an expired trade', async () => {
    await expire(tradeId);
    const res = await offer(alice, [{ itemId: 'leek', quantity: 1 }]);
    expect(res.code).toBe(ErrorCode.TRADE_EXPIRED);
  });

  it('refuses on a cancelled trade', async () => {
    await cancel(bob, tradeId);
    const res = await offer(alice, [{ itemId: 'leek', quantity: 1 }]);
    expect(res.code).toBe(ErrorCode.TRADE_NOT_FOUND);
  });

  it("refuses a stranger's trade", async () => {
    const carol = await createTestClient();
    await registerTestUser(carol);

    const res = await carol.post('/api/trade/offer', {
      tradeId,
      items: [],
      gold: 0,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.TRADE_NOT_FOUND);
    await carol.close();
  });

  it('is idempotent: a replayed offer bumps the revision once', async () => {
    const key = newKey();
    const body = {
      tradeId,
      items: [{ itemId: 'leek', quantity: 4 }],
      gold: 0,
      idempotencyKey: key,
    };

    const first = await alice.post('/api/trade/offer', body);
    const replay = await alice.post('/api/trade/offer', body);

    expect(replay.body).toEqual(first.body);
    expect((await tradeRow()).revision).toBe(first.body.revision);
  });
});

/* ------------------------------------------------------------------ *
 * Dual confirmation (T-4.04)
 * ------------------------------------------------------------------ */

/**
 * A confirmation is agreement to a **specific offer**, carried as a revision.
 * One that meant "whatever is there now" would be the scam this endpoint exists
 * to prevent.
 */
describe('POST /api/trade/confirm', () => {
  let tradeId: string;

  async function give(playerId: string, itemId: string, quantity: number): Promise<void> {
    const existing = await db
      .select({ slotIndex: schema.inventoryItems.slotIndex })
      .from(schema.inventoryItems)
      .where(
        and(
          eqOp(schema.inventoryItems.playerId, playerId),
          eqOp(schema.inventoryItems.container, 'inventory'),
        ),
      );
    const used = new Set(existing.map((s) => s.slotIndex));
    let slotIndex = 0;
    while (used.has(slotIndex)) slotIndex += 1;

    await db
      .insert(schema.inventoryItems)
      .values({ playerId, container: 'inventory', slotIndex, itemId, quantity });
  }

  function offer(client: TestClient, items: unknown[]) {
    return client.post('/api/trade/offer', {
      tradeId,
      items,
      gold: 0,
      idempotencyKey: newKey(),
    });
  }

  function confirmAt(client: TestClient, revision: number) {
    return client.post('/api/trade/confirm', {
      tradeId,
      revision,
      idempotencyKey: newKey(),
    });
  }

  async function tradeRow() {
    const [row] = await db.select().from(schema.trades).where(eqOp(schema.trades.id, tradeId));
    return row!;
  }

  beforeEach(async () => {
    const invited = await invite(alice, bobName);
    await accept(bob, invited.body.id);
    tradeId = invited.body.id;

    await give(aliceId, 'leek', 10);
    await give(bobId, 'potato', 10);
  });

  it('confirms one side at the current revision', async () => {
    const { revision } = (await offer(alice, [{ itemId: 'leek', quantity: 2 }])).body;

    const res = await confirmAt(alice, revision);

    expect(res.status, res.code).toBe(200);
    expect(res.body.you.confirmed).toBe(true);
    expect(res.body.them.confirmed).toBe(false);
    expect(res.body.readyToExecute).toBe(false);
  });

  it('is ready only when both have confirmed', async () => {
    const { revision } = (await offer(alice, [{ itemId: 'leek', quantity: 2 }])).body;

    await confirmAt(alice, revision);
    const res = await confirmAt(bob, revision);

    expect(res.body.readyToExecute).toBe(true);
    const row = await tradeRow();
    expect(row.initiatorConfirmed && row.recipientConfirmed).toBe(true);
  });

  /* ---- a stale revision ---- */

  it('refuses a revision that is behind the current one', async () => {
    const first = (await offer(alice, [{ itemId: 'leek', quantity: 1 }])).body;
    await offer(alice, [{ itemId: 'leek', quantity: 9 }]);

    const res = await confirmAt(bob, first.revision);

    expect(res.code).toBe(ErrorCode.TRADE_OFFER_CHANGED);
    expect((await tradeRow()).recipientConfirmed).toBe(false);
  });

  it('refuses a revision from the future', async () => {
    const { revision } = (await offer(alice, [{ itemId: 'leek', quantity: 1 }])).body;

    const res = await confirmAt(bob, revision + 5);
    expect(res.code).toBe(ErrorCode.TRADE_OFFER_CHANGED);
  });

  /**
   * The scam, end to end: Bob confirms, Alice swaps the goods, and Bob's
   * agreement must not survive it. He has to look again and confirm the new
   * offer — which is the entire point of the mechanism.
   */
  it('makes a confirmation worthless once the offer is edited', async () => {
    const first = (await offer(alice, [{ itemId: 'leek', quantity: 9 }])).body;
    await confirmAt(bob, first.revision);
    expect((await tradeRow()).recipientConfirmed).toBe(true);

    // Alice swaps nine leeks for one.
    const swapped = (await offer(alice, [{ itemId: 'leek', quantity: 1 }])).body;

    const row = await tradeRow();
    expect(row.recipientConfirmed).toBe(false);
    expect(row.initiatorConfirmed).toBe(false);

    // And Bob's old confirmation cannot be replayed.
    expect((await confirmAt(bob, first.revision)).code).toBe(ErrorCode.TRADE_OFFER_CHANGED);
    // Only the offer he can actually see now.
    expect((await confirmAt(bob, swapped.revision)).status).toBe(200);
  });

  /* ---- confirming twice ---- */

  it('refuses a second confirmation from the same player', async () => {
    const { revision } = (await offer(alice, [{ itemId: 'leek', quantity: 2 }])).body;
    await confirmAt(alice, revision);

    const res = await confirmAt(alice, revision);
    expect(res.code).toBe(ErrorCode.TRADE_ALREADY_CONFIRMED);
  });

  it('lets a player confirm again after an edit reset them', async () => {
    const first = (await offer(alice, [{ itemId: 'leek', quantity: 2 }])).body;
    await confirmAt(alice, first.revision);

    const second = (await offer(bob, [{ itemId: 'potato', quantity: 1 }])).body;
    expect((await confirmAt(alice, second.revision)).status).toBe(200);
  });

  /* ---- when confirmation is allowed at all ---- */

  it('refuses on an expired trade', async () => {
    const { revision } = (await offer(alice, [{ itemId: 'leek', quantity: 1 }])).body;
    await expire(tradeId);

    expect((await confirmAt(alice, revision)).code).toBe(ErrorCode.TRADE_EXPIRED);
  });

  it('refuses on a cancelled trade', async () => {
    const { revision } = (await offer(alice, [{ itemId: 'leek', quantity: 1 }])).body;
    await cancel(bob, tradeId);

    expect((await confirmAt(alice, revision)).code).toBe(ErrorCode.TRADE_NOT_FOUND);
  });

  it("refuses a stranger's trade", async () => {
    const carol = await createTestClient();
    await registerTestUser(carol);

    const res = await carol.post('/api/trade/confirm', {
      tradeId,
      revision: 0,
      idempotencyKey: newKey(),
    });

    expect(res.code).toBe(ErrorCode.TRADE_NOT_FOUND);
    await carol.close();
  });

  it('is idempotent: a replayed confirm is not a double confirm', async () => {
    const { revision } = (await offer(alice, [{ itemId: 'leek', quantity: 1 }])).body;
    const key = newKey();
    const body = { tradeId, revision, idempotencyKey: key };

    const first = await alice.post('/api/trade/confirm', body);
    const replay = await alice.post('/api/trade/confirm', body);

    expect(first.status).toBe(200);
    expect(replay.body).toEqual(first.body);
  });

  /**
   * The dangerous interleaving: a confirmation in flight while the other party
   * edits. Without a lock on the trade row, the confirm reads revision N, the
   * edit bumps to N+1 and clears both flags, and then the confirm writes its
   * flag back — leaving a confirmation standing against an offer nobody agreed
   * to.
   */
  it('cannot confirm an offer that was edited underneath it', async () => {
    const start = (await offer(alice, [{ itemId: 'leek', quantity: 9 }])).body;

    const [aliceRow] = await db.select().from(schema.players).where(eqOp(schema.players.id, aliceId));
    const [bobRow] = await db.select().from(schema.players).where(eqOp(schema.players.id, bobId));
    const now = Date.now();

    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Alice's edit, held open so Bob's confirm overlaps it.
    const editing = db.transaction(async (tx) => {
      await setOfferService(tx, aliceRow as never, tradeId, [{ itemId: 'leek', quantity: 1 }], 0, now);
      await hold;
    });

    await new Promise((r) => setTimeout(r, 150));

    const confirming = db
      .transaction((tx) => confirmService(tx, bobRow as never, tradeId, start.revision, now))
      .then(() => 'confirmed')
      .catch((err: { code?: string }) => err.code ?? 'error');

    await new Promise((r) => setTimeout(r, 150));
    release!();
    await editing;

    expect(
      await confirming,
      'a confirmation landed against an offer that had already changed',
    ).toBe(ErrorCode.TRADE_OFFER_CHANGED);

    const row = await tradeRow();
    expect(row.recipientConfirmed).toBe(false);
  });
});
