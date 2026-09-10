import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import {
  ErrorCode,
  GameError,
  TRADE_INVITE_TTL_MS,
  TRADE_SESSION_TTL_MS,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Queryable, Tx } from '../../db/tx.js';
import { parseAppearance, type AuthedPlayer } from '../../middleware/auth.js';
import { assertBothCanTrade, assertCanTrade } from './eligibility.js';
import { TradeStatus, effectiveStatus, expiresInMs, isLiveStatus } from './lifecycle.js';
import type { TradeView } from '@tillhaven/shared';
import { decodeOffer, encodeOffer, normaliseOffer, type OfferItem } from './offer.js';
import {
  Container,
  addItem,
  capacityForPlayer,
  countItem,
  lockContainer,
  removeItem,
} from '../inventory/service.js';

/**
 * The trade session: invite, accept, cancel, expire (CLAUDE.md §6).
 *
 * This file owns *whether a conversation exists*. What is in the offer and
 * whether it executes are T-4.03 to T-4.05 — kept apart deliberately, because
 * the failure modes are different: a lifecycle bug strands people, an execution
 * bug duplicates items.
 *
 * **Expiry is never written by a job.** Every read runs `effectiveStatus`, so a
 * trade past its deadline is expired the moment anyone looks. A sweeper may tidy
 * the column later (T-6.03) but no decision waits on it.
 */

export interface TradeSide {
  readonly playerId: string;
  readonly username: string;
  readonly items: readonly OfferItem[];
  readonly gold: number;
  readonly confirmed: boolean;
}

/**
 * Re-exported, not redeclared (T-18.21).
 *
 * This interface was written out here AND in `apps/client/src/net/trade.ts`,
 * and two hand-kept copies of a wire contract is how the client's `TradeStatus`
 * came to disagree with the server's without anything failing. §10: defined
 * once in `packages/shared`, imported by both sides.
 */
export type { TradeView };

type TradeRow = typeof schema.trades.$inferSelect;

function sideOf(row: TradeRow, names: Record<string, string>, initiator: boolean): TradeSide {
  return {
    playerId: initiator ? row.initiatorId : row.recipientId,
    username: names[initiator ? row.initiatorId : row.recipientId] ?? 'someone',
    items: decodeOffer(initiator ? row.initiatorItems : row.recipientItems),
    gold: initiator ? row.initiatorGold : row.recipientGold,
    confirmed: initiator ? row.initiatorConfirmed : row.recipientConfirmed,
  };
}

function toView(row: TradeRow, names: Record<string, string>, viewerId: string, now: number): TradeView {
  const isInitiator = row.initiatorId === viewerId;

  return {
    you: sideOf(row, names, isInitiator),
    them: sideOf(row, names, !isInitiator),
    id: row.id,
    status: effectiveStatus(row, now),
    initiatorId: row.initiatorId,
    recipientId: row.recipientId,
    initiatorName: names[row.initiatorId] ?? 'someone',
    recipientName: names[row.recipientId] ?? 'someone',
    revision: row.revision,
    expiresInMs: expiresInMs(row, now),
    isInitiator,
    readyToExecute: row.initiatorConfirmed && row.recipientConfirmed,
  };
}

/** Usernames for both parties, so a view never exposes ids alone. */
async function namesFor(q: Queryable, ids: readonly string[]): Promise<Record<string, string>> {
  const rows = await q
    .select({ id: schema.players.id, username: schema.players.username })
    .from(schema.players)
    .where(or(...ids.map((id) => eq(schema.players.id, id))));

  return Object.fromEntries(rows.map((r) => [r.id, r.username]));
}

/** Every trade this player is party to, in any state. */
function partyTo(playerId: string) {
  return or(eq(schema.trades.initiatorId, playerId), eq(schema.trades.recipientId, playerId));
}

/**
 * The player's one live trade, or null.
 *
 * Filtered in code rather than SQL because "live" includes the expiry
 * comparison, and there must be exactly one definition of that — the pure one.
 * A player has at most a handful of trade rows ever, so this is not a scan
 * worth optimising.
 */
export async function liveTradeFor(
  q: Queryable,
  playerId: string,
  now: number,
): Promise<TradeRow | null> {
  const rows = await q.select().from(schema.trades).where(partyTo(playerId));
  return rows.find((row) => isLiveStatus(effectiveStatus(row, now))) ?? null;
}

/** Loads a trade the caller is party to, or refuses. */
async function loadOwnTrade(q: Queryable, playerId: string, tradeId: string): Promise<TradeRow> {
  const rows = await q
    .select()
    .from(schema.trades)
    .where(and(eq(schema.trades.id, tradeId), partyTo(playerId)))
    .limit(1);

  const row = rows[0];
  // A trade someone else is having and a trade that does not exist look the
  // same from here — otherwise this endpoint confirms that an id is real.
  if (!row) throw new GameError(ErrorCode.TRADE_NOT_FOUND, 'That trade is not yours.');
  return row;
}

/**
 * Loads and LOCKS the trade row, for anything that writes to it.
 *
 * Without this, an offer edit and a confirmation can interleave: the confirming
 * transaction reads revision 3, the editing one bumps to 4 and clears both
 * flags, and then the confirm writes its flag back — leaving a confirmation
 * standing against an offer nobody agreed to. That is the scam this whole
 * subsystem exists to prevent, arriving through the back door.
 *
 * Both `setOffer` and `confirm` take it, so the two serialise per trade.
 */
async function lockOwnTrade(tx: Tx, playerId: string, tradeId: string): Promise<TradeRow> {
  const rows = await tx
    .select()
    .from(schema.trades)
    .where(and(eq(schema.trades.id, tradeId), partyTo(playerId)))
    .limit(1)
    .for('update');

  const row = rows[0];
  if (!row) throw new GameError(ErrorCode.TRADE_NOT_FOUND, 'That trade is not yours.');
  return row;
}

/** The caller's current trade, if they have one. */
export async function currentTrade(
  q: Queryable,
  player: AuthedPlayer,
  now: number,
): Promise<TradeView | null> {
  const row = await liveTradeFor(q, player.id, now);
  if (!row) return null;

  const names = await namesFor(q, [row.initiatorId, row.recipientId]);
  return toView(row, names, player.id, now);
}

export async function viewTrade(
  q: Queryable,
  player: AuthedPlayer,
  tradeId: string,
  now: number,
): Promise<TradeView> {
  const row = await loadOwnTrade(q, player.id, tradeId);
  const names = await namesFor(q, [row.initiatorId, row.recipientId]);
  return toView(row, names, player.id, now);
}

/**
 * Locks both players' rows in a fixed order.
 *
 * Sorted by id, always. Two people inviting each other at the same instant is
 * the obvious lock-order inversion here, and sorting is what makes it
 * impossible rather than unlikely — the same discipline the trade EXECUTION
 * will need (§6), established early so both use it.
 */
async function lockPlayers(tx: Tx, ids: readonly string[]): Promise<void> {
  const ordered = [...ids].sort();

  for (const id of ordered) {
    await tx.select({ id: schema.players.id }).from(schema.players).where(eq(schema.players.id, id)).for('update');
  }
}

/**
 * The full player row.
 *
 * Typed `AuthedPlayer`, which is a superset of `TradeCandidate` — so this one
 * function serves both the eligibility re-check (invite, accept, execute) and,
 * at execution, `capacityForPlayer`'s need for `vipUntil`/`gold` as well.
 */
async function candidate(q: Queryable, playerId: string): Promise<AuthedPlayer | null> {
  const rows = await q
    .select({
      id: schema.players.id,
      username: schema.players.username,
      email: schema.players.email,
      gold: schema.players.gold,
      backpackTier: schema.players.backpackTier,
      createdAt: schema.players.createdAt,
      experience: schema.players.experience,
      vipUntil: schema.players.vipUntil,
      flaggedAt: schema.players.flaggedAt,
      appearance: schema.players.appearance,
      energySpent: schema.players.energySpent,
      sleepingSince: schema.players.sleepingSince,
    })
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .limit(1);

  const row = rows[0];
  return row ? { ...row, appearance: parseAppearance(row.appearance) } : null;
}

/**
 * Opens a trade with another farmer, by name.
 *
 * By **username**, not by id: a player knows who they mean to trade with, and
 * accepting an id from the client would let one be harvested from anywhere and
 * pointed at a stranger.
 */
export async function invite(
  tx: Tx,
  player: AuthedPlayer,
  targetUsername: string,
  now: number,
): Promise<TradeView> {
  // The caller's own eligibility first, so they get a reason they can act on.
  assertCanTrade(player, now);

  const targets = await tx
    .select({ id: schema.players.id })
    .from(schema.players)
    .where(sql`lower(${schema.players.username}) = lower(${targetUsername})`)
    .limit(1);

  const targetId = targets[0]?.id;
  if (!targetId) {
    throw new GameError(ErrorCode.TRADE_NOT_FOUND, 'No farmer by that name.');
  }
  if (targetId === player.id) {
    throw new GameError(ErrorCode.TRADE_SELF, 'You cannot trade with yourself.');
  }

  await lockPlayers(tx, [player.id, targetId]);

  const target = await candidate(tx, targetId);
  if (!target) throw new GameError(ErrorCode.TRADE_NOT_FOUND, 'No farmer by that name.');

  // Re-checked under the lock, and for BOTH parties (§6).
  assertBothCanTrade(player, target, now);

  /*
   * One live trade each. Checked under the lock, which is what stops two
   * simultaneous invites from both passing — without it a player could be
   * pulled into two trades and offer the same item in each.
   */
  for (const id of [player.id, targetId]) {
    if (await liveTradeFor(tx, id, now)) {
      throw new GameError(
        ErrorCode.TRADE_ALREADY_OPEN,
        id === player.id ? 'You are already in a trade.' : 'They are already in a trade.',
      );
    }
  }

  const inserted = await tx
    .insert(schema.trades)
    .values({
      status: TradeStatus.PENDING,
      initiatorId: player.id,
      recipientId: targetId,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + TRADE_INVITE_TTL_MS,
    })
    .returning();

  const row = inserted[0]!;
  const names = await namesFor(tx, [row.initiatorId, row.recipientId]);
  return toView(row, names, player.id, now);
}

/**
 * Accepts an invite. Recipient only.
 *
 * Eligibility is re-checked for both parties: an invite can sit for two minutes,
 * and an account can be flagged for a chargeback in that time.
 */
export async function accept(
  tx: Tx,
  player: AuthedPlayer,
  tradeId: string,
  now: number,
): Promise<TradeView> {
  const row = await loadOwnTrade(tx, player.id, tradeId);

  if (row.recipientId !== player.id) {
    throw new GameError(ErrorCode.TRADE_NOT_FOUND, 'That invite is not yours to accept.');
  }

  const status = effectiveStatus(row, now);
  if (status === TradeStatus.EXPIRED) {
    throw new GameError(ErrorCode.TRADE_EXPIRED, 'That invite has expired.');
  }
  if (status !== TradeStatus.PENDING) {
    throw new GameError(ErrorCode.TRADE_NOT_FOUND, 'That invite is no longer open.');
  }

  await lockPlayers(tx, [row.initiatorId, row.recipientId]);

  const initiator = await candidate(tx, row.initiatorId);
  if (!initiator) {
    throw new GameError(ErrorCode.TRADE_PARTNER_LEFT, 'That farmer is no longer available.');
  }
  assertBothCanTrade(player, initiator, now);

  const updated = await tx
    .update(schema.trades)
    .set({
      status: TradeStatus.OPEN,
      updatedAt: now,
      // The clock restarts: an invite's two minutes is for answering, and the
      // negotiation that follows gets its own, longer deadline.
      expiresAt: now + TRADE_SESSION_TTL_MS,
    })
    .where(eq(schema.trades.id, tradeId))
    .returning();

  const fresh = updated[0]!;
  const names = await namesFor(tx, [fresh.initiatorId, fresh.recipientId]);
  return toView(fresh, names, player.id, now);
}

/**
 * Cancels a trade. Either party, at any live moment.
 *
 * Cancelling is always allowed and never fails for a trade that is already over
 * — walking away is the one action a trading system must never make difficult,
 * and "cancel" on an already-dead trade is what a player does when they are
 * unsure, not an error to report at them.
 */
export async function cancel(
  tx: Tx,
  player: AuthedPlayer,
  tradeId: string,
  now: number,
): Promise<TradeView> {
  const row = await loadOwnTrade(tx, player.id, tradeId);
  const status = effectiveStatus(row, now);

  if (!isLiveStatus(status)) {
    // Already finished, expired or cancelled. Report it as it stands.
    const names = await namesFor(tx, [row.initiatorId, row.recipientId]);
    return toView(row, names, player.id, now);
  }

  const updated = await tx
    .update(schema.trades)
    .set({ status: TradeStatus.CANCELLED, updatedAt: now })
    .where(eq(schema.trades.id, tradeId))
    .returning();

  const fresh = updated[0]!;
  const names = await namesFor(tx, [fresh.initiatorId, fresh.recipientId]);
  return toView(fresh, names, player.id, now);
}

/** Throws unless the trade is accepted and still live. */
function assertOpen(row: TradeRow, now: number): void {
  const status = effectiveStatus(row, now);

  if (status === TradeStatus.EXPIRED) {
    throw new GameError(ErrorCode.TRADE_EXPIRED, 'That trade has expired.');
  }
  if (status !== TradeStatus.OPEN) {
    throw new GameError(
      ErrorCode.TRADE_NOT_FOUND,
      status === TradeStatus.PENDING
        ? 'That trade has not been accepted yet.'
        : 'That trade is no longer open.',
    );
  }
}

/* ------------------------------------------------------------------ *
 * The offer (T-4.03)
 * ------------------------------------------------------------------ */

/**
 * Replaces one side of the offer.
 *
 * **Every change bumps `revision` and clears BOTH confirmations.** That is the
 * anti-scam mechanic of the whole system (§6): the classic trade scam is to wait
 * until the other party has confirmed, swap a gold bar for a pebble, and let
 * them complete out of habit. Here that is not a race the scammer can win — it
 * is impossible, because their own confirmation dies with the edit too.
 *
 * A player may only set **their own** side. The side is derived from the
 * session, never taken from the request, so there is no field to tamper with.
 *
 * Holdings are checked here **and again at execution** (T-4.05). This check is
 * the courtesy that stops a player building an offer they cannot honour; the
 * one at execution is the one that matters, because items can leave a bag in
 * the minutes between.
 */
export async function setOffer(
  tx: Tx,
  player: AuthedPlayer,
  tradeId: string,
  items: readonly OfferItem[],
  gold: number,
  now: number,
): Promise<TradeView> {
  const normalised = normaliseOffer(items, gold);

  const row = await lockOwnTrade(tx, player.id, tradeId);
  assertOpen(row, now);

  // Offered from the BAG, not the chest: "bring what you want to trade" is a
  // rule players already understand, and it keeps the execution lock to one
  // container per player.
  for (const entry of normalised) {
    const held = await countItem(tx, player.id, entry.itemId);
    if (held < entry.quantity) {
      throw new GameError(ErrorCode.TRADE_ITEM_MISSING, "You don't have that to offer.", {
        itemId: entry.itemId,
        offered: entry.quantity,
        held,
      });
    }
  }

  const isInitiator = row.initiatorId === player.id;
  const encoded = encodeOffer(normalised);

  const updated = await tx
    .update(schema.trades)
    .set({
      ...(isInitiator
        ? { initiatorItems: encoded, initiatorGold: gold }
        : { recipientItems: encoded, recipientGold: gold }),
      /*
       * Both confirmations, every time — including the editor's own. Clearing
       * only the other side would let a scammer confirm, edit, and rely on the
       * victim's stale confirmation still standing.
       */
      initiatorConfirmed: false,
      recipientConfirmed: false,
      revision: sql`${schema.trades.revision} + 1`,
      updatedAt: now,
    })
    .where(eq(schema.trades.id, tradeId))
    .returning();

  const fresh = updated[0]!;
  const names = await namesFor(tx, [fresh.initiatorId, fresh.recipientId]);
  return toView(fresh, names, player.id, now);
}

/* ------------------------------------------------------------------ *
 * Dual confirmation (T-4.04)
 * ------------------------------------------------------------------ */

/**
 * True when both sides have confirmed.
 *
 * **This is necessarily "at the same revision".** Every offer edit clears both
 * flags in the same statement that bumps the revision, so two standing
 * confirmations cannot straddle an edit — the state is unreachable rather than
 * merely unlikely. `assertSameRevision` below is what keeps it that way.
 */
export function bothConfirmed(row: TradeRow): boolean {
  return row.initiatorConfirmed && row.recipientConfirmed;
}

/**
 * Confirms the caller's side, against the revision they were shown.
 *
 * The revision is the whole mechanism. A client confirms *a specific offer*, not
 * "whatever is there now" — so if anything changed between the screen they read
 * and the button they pressed, the confirmation is refused rather than applied
 * to an offer they never saw.
 */
export async function confirm(
  tx: Tx,
  player: AuthedPlayer,
  tradeId: string,
  revision: number,
  now: number,
): Promise<TradeView> {
  const row = await lockOwnTrade(tx, player.id, tradeId);
  assertOpen(row, now);

  if (revision !== row.revision) {
    throw new GameError(ErrorCode.TRADE_OFFER_CHANGED, 'The offer changed. Check it again.', {
      yourRevision: revision,
      currentRevision: row.revision,
    });
  }

  const isInitiator = row.initiatorId === player.id;
  const alreadyConfirmed = isInitiator ? row.initiatorConfirmed : row.recipientConfirmed;

  if (alreadyConfirmed) {
    throw new GameError(ErrorCode.TRADE_ALREADY_CONFIRMED, 'You have already confirmed.');
  }

  const updated = await tx
    .update(schema.trades)
    .set({
      ...(isInitiator ? { initiatorConfirmed: true } : { recipientConfirmed: true }),
      updatedAt: now,
    })
    // Guarded on the revision as well, so even a lock-free path could not apply
    // a confirmation to an offer that moved underneath it.
    .where(and(eq(schema.trades.id, tradeId), eq(schema.trades.revision, revision)))
    .returning();

  const fresh = updated[0];
  if (!fresh) {
    throw new GameError(ErrorCode.TRADE_OFFER_CHANGED, 'The offer changed. Check it again.');
  }

  const names = await namesFor(tx, [fresh.initiatorId, fresh.recipientId]);
  return toView(fresh, names, player.id, now);
}

/* ------------------------------------------------------------------ *
 * Execution (T-4.05) — the highest-risk step in the whole system
 * ------------------------------------------------------------------ */

/**
 * Executes a trade both parties have confirmed.
 *
 * Everything below happens once, in one transaction, or none of it happens.
 * The locking order is fixed and documented because it is the one thing that
 * has to be right for the whole system to be safe:
 *
 *   1. the TRADE row (already held by `lockOwnTrade`, below)
 *   2. both PLAYER rows, sorted by id (`lockPlayers` — shared with invite/accept)
 *   3. both players' INVENTORY rows, sorted by id (`lockContainer`)
 *
 * Sorted order is what makes two concurrent executions provably unable to
 * deadlock, even though today's "one live trade per player" rule means no two
 * live trades ever share a player — a future feature that relaxed that rule
 * must not silently reintroduce a deadlock, so the order is enforced now.
 *
 * **Every offered item is re-verified here**, under the lock, against what the
 * player actually holds at this instant — never against the count `setOffer`
 * saw when the offer was written. Minutes can pass between confirming and
 * executing, and items do not wait.
 *
 * Gold is not moved. `initiatorGold`/`recipientGold` are always 0 while
 * `GOLD_IS_TRADEABLE` is false — `offer.ts` refuses to store anything else —
 * so there is nothing here to move yet. T-4.09 adds it once D-3 is decided.
 */
export async function execute(
  tx: Tx,
  player: AuthedPlayer,
  tradeId: string,
  now: number,
): Promise<TradeView> {
  const row = await lockOwnTrade(tx, player.id, tradeId);
  const status = effectiveStatus(row, now);

  // Already done: whichever party's request got here first, the outcome is the
  // same trade either of them agreed to. Reporting it as a success rather than
  // an error matches how `cancel` treats a trade that is already resolved.
  if (status === TradeStatus.COMPLETED) {
    const names = await namesFor(tx, [row.initiatorId, row.recipientId]);
    return toView(row, names, player.id, now);
  }

  assertOpen(row, now);

  if (!bothConfirmed(row)) {
    throw new GameError(ErrorCode.TRADE_NOT_READY, 'Both farmers need to confirm first.');
  }

  // 2. Both PLAYER rows, sorted — the same lock and the same order `invite`
  // and `accept` already use for exactly this reason.
  await lockPlayers(tx, [row.initiatorId, row.recipientId]);

  const initiator = await candidate(tx, row.initiatorId);
  const recipient = await candidate(tx, row.recipientId);
  if (!initiator || !recipient) {
    throw new GameError(ErrorCode.TRADE_PARTNER_LEFT, 'That farmer is no longer available.');
  }

  // Re-checked for BOTH parties, at the second of the two moments §6 names —
  // the first was at invite. An account can be flagged for a chargeback in the
  // minutes a trade sits open.
  assertBothCanTrade(initiator, recipient, now);

  // 3. Both players' INVENTORY rows, sorted — same order as step 2, for the
  // same deadlock-avoidance reason.
  const sortedIds = [row.initiatorId, row.recipientId].sort();
  await lockContainer(tx, sortedIds[0]!, Container.INVENTORY);
  await lockContainer(tx, sortedIds[1]!, Container.INVENTORY);

  const initiatorOffer = decodeOffer(row.initiatorItems);
  const recipientOffer = decodeOffer(row.recipientItems);

  // Re-verify OWNERSHIP of every offered item, under the lock, against reality
  // — never against the count `setOffer` saw when the offer was written.
  for (const entry of initiatorOffer) {
    const held = await countItem(tx, row.initiatorId, entry.itemId, Container.INVENTORY);
    if (held < entry.quantity) {
      throw new GameError(ErrorCode.TRADE_ITEM_MISSING, 'They no longer have what was offered.', {
        itemId: entry.itemId,
      });
    }
  }
  for (const entry of recipientOffer) {
    const held = await countItem(tx, row.recipientId, entry.itemId, Container.INVENTORY);
    if (held < entry.quantity) {
      throw new GameError(ErrorCode.TRADE_ITEM_MISSING, 'They no longer have what was offered.', {
        itemId: entry.itemId,
      });
    }
  }

  const initiatorCapacity = await capacityForPlayer(tx, initiator, Container.INVENTORY, now);
  const recipientCapacity = await capacityForPlayer(tx, recipient, Container.INVENTORY, now);

  /*
   * REMOVE before ADD, on both sides, in that order. This is not arbitrary:
   * removing a player's own offered items can free the very slot their
   * incoming items need. A straight swap of two full bags — "I'll trade you my
   * only sword for your only shield" — must not spuriously fail INVENTORY_FULL
   * because the check ran before the outgoing item made room. `addItem` reads
   * occupied slots fresh at call time, so ordering it after both removals is
   * what makes that room visible.
   *
   * If anything past this point throws, the whole transaction rolls back —
   * including the removals already applied here. There is no path that leaves
   * an item removed from one bag without landing in the other.
   */
  for (const entry of initiatorOffer) {
    await removeItem(tx, row.initiatorId, entry.itemId, entry.quantity, Container.INVENTORY);
  }
  for (const entry of recipientOffer) {
    await removeItem(tx, row.recipientId, entry.itemId, entry.quantity, Container.INVENTORY);
  }

  for (const entry of recipientOffer) {
    await addItem(tx, row.initiatorId, entry.itemId, entry.quantity, {
      capacity: initiatorCapacity,
      container: Container.INVENTORY,
    });
  }
  for (const entry of initiatorOffer) {
    await addItem(tx, row.recipientId, entry.itemId, entry.quantity, {
      capacity: recipientCapacity,
      container: Container.INVENTORY,
    });
  }

  // Marked completed inside the SAME transaction as the swap — the two either
  // both happen or neither does.
  const updated = await tx
    .update(schema.trades)
    .set({ status: TradeStatus.COMPLETED, updatedAt: now })
    .where(eq(schema.trades.id, tradeId))
    .returning();

  const fresh = updated[0]!;

  // Immutable audit row (CLAUDE.md §6), in the SAME transaction as the swap —
  // either the trade completes with a record of it, or neither happens. This
  // line only runs on the branch that actually performed the swap; the
  // "already COMPLETED" early return above is what keeps a second party's
  // execute call from writing a second row for the same trade. Nothing in
  // this codebase ever UPDATEs or DELETEs `trade_log` — it is written here,
  // once, and never touched again.
  await tx.insert(schema.tradeLog).values({
    tradeId: fresh.id,
    initiatorId: fresh.initiatorId,
    recipientId: fresh.recipientId,
    initiatorItems: fresh.initiatorItems,
    recipientItems: fresh.recipientItems,
    initiatorGold: fresh.initiatorGold,
    recipientGold: fresh.recipientGold,
    completedAt: now,
  });

  const names = await namesFor(tx, [fresh.initiatorId, fresh.recipientId]);
  return toView(fresh, names, player.id, now);
}

/* ------------------------------------------------------------------ *
 * History (T-4.12, CLAUDE.md §6)
 * ------------------------------------------------------------------ */

export interface TradeHistoryEntry {
  readonly tradeId: string;
  readonly counterpartyId: string;
  readonly counterpartyName: string;
  readonly youWereInitiator: boolean;
  readonly yourItems: readonly OfferItem[];
  readonly theirItems: readonly OfferItem[];
  readonly yourGold: number;
  readonly theirGold: number;
  readonly completedAt: number;
}

export interface TradeHistoryPage {
  readonly entries: readonly TradeHistoryEntry[];
  /** Pass back verbatim as `cursor` for the next page. Null once there is no more. */
  readonly nextCursor: string | null;
}

/** Opaque to the client on purpose — nothing here is meant to be constructed by hand. */
function encodeHistoryCursor(completedAt: number, id: string): string {
  return `${completedAt}:${id}`;
}

function decodeHistoryCursor(raw: string): { completedAt: number; id: string } | null {
  const sep = raw.indexOf(':');
  if (sep === -1) return null;
  const completedAt = Number(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (!Number.isFinite(completedAt) || !id) return null;
  return { completedAt, id };
}

/**
 * A player's own completed trades, read from the immutable `trade_log` —
 * never from `trades`, which only holds live sessions and is overwritten as
 * soon as a player opens a new one.
 *
 * **Ownership is the WHERE clause, not a check bolted on after.** Every row
 * this can possibly return already has `playerId` as initiator or recipient;
 * there is no code path where a row for someone else's trade reaches this
 * function's caller (CLAUDE.md §8).
 *
 * **Keyset-paginated on `(completedAt, id)`, not offset.** An offset shifts
 * under a page boundary the instant a new trade completes between two
 * requests — page 2 silently skips or repeats a row depending on which way
 * the list moved. A cursor built from the last row actually shown does not,
 * because it does not care how many rows exist before it, only which ones
 * come after the one it names. `id` breaks ties at identical millisecond
 * timestamps, which two trades completing in the same request tick could
 * otherwise produce.
 */
export async function tradeHistory(
  q: Queryable,
  playerId: string,
  cursor: string | undefined,
  limit: number,
): Promise<TradeHistoryPage> {
  const party = or(
    eq(schema.tradeLog.initiatorId, playerId),
    eq(schema.tradeLog.recipientId, playerId),
  );

  // A garbled or tampered cursor just restarts at page one — there is nothing
  // sensitive encoded in it, so there is nothing to refuse.
  const decoded = cursor ? decodeHistoryCursor(cursor) : null;
  const where = decoded
    ? and(
        party,
        or(
          lt(schema.tradeLog.completedAt, decoded.completedAt),
          and(
            eq(schema.tradeLog.completedAt, decoded.completedAt),
            lt(schema.tradeLog.id, decoded.id),
          ),
        ),
      )
    : party;

  // One extra row fetched, never returned, purely to know whether a next
  // page exists without a separate COUNT query.
  const rows = await q
    .select()
    .from(schema.tradeLog)
    .where(where)
    .orderBy(desc(schema.tradeLog.completedAt), desc(schema.tradeLog.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);

  const counterpartyIds = pageRows.map((row) =>
    row.initiatorId === playerId ? row.recipientId : row.initiatorId,
  );
  const names = await namesFor(q, counterpartyIds);

  const entries: TradeHistoryEntry[] = pageRows.map((row) => {
    const youWereInitiator = row.initiatorId === playerId;
    const counterpartyId = youWereInitiator ? row.recipientId : row.initiatorId;
    return {
      tradeId: row.tradeId,
      counterpartyId,
      counterpartyName: names[counterpartyId] ?? 'someone',
      youWereInitiator,
      yourItems: decodeOffer(youWereInitiator ? row.initiatorItems : row.recipientItems),
      theirItems: decodeOffer(youWereInitiator ? row.recipientItems : row.initiatorItems),
      yourGold: youWereInitiator ? row.initiatorGold : row.recipientGold,
      theirGold: youWereInitiator ? row.recipientGold : row.initiatorGold,
      completedAt: row.completedAt,
    };
  });

  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeHistoryCursor(last.completedAt, last.id) : null;

  return { entries, nextCursor };
}
