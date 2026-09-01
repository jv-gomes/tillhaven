import type { CropId } from '../config/crops.js';
import type { AnimalKind, AnimalVariant } from '../config/animals.js';
import type { IdleTask } from '../config/idle.js';
import type { Appearance } from '../schemas/index.js';

/**
 * Shared domain types. Defined ONCE here and imported by both client and
 * server — never duplicated (CLAUDE.md §10).
 *
 * All timestamps are epoch milliseconds, UTC. All quantities and gold are
 * integers.
 */

/* ------------------------------------------------------------------ *
 * Player
 * ------------------------------------------------------------------ */

export interface PublicPlayer {
  readonly id: string;
  readonly username: string;
  readonly createdAt: number;
  readonly farmLevel: number;
  /** True while VIP is active. The exact expiry is not exposed for other players. */
  readonly isVip: boolean;
}

/** Only ever sent to the owning player. */
export interface SelfPlayer extends PublicPlayer {
  readonly email: string;
  readonly gold: number;
  readonly vipUntil: number | null;
  readonly canTrade: boolean;
  /** Null until the player finishes the first-login character creator (T-8.02). */
  readonly appearance: Appearance | null;
}

/* ------------------------------------------------------------------ *
 * Farm
 * ------------------------------------------------------------------ */

export interface Plot {
  readonly id: string;
  readonly farmId: string;
  /** Position on the farm tile grid. */
  readonly x: number;
  readonly y: number;
  readonly unlocked: boolean;
  readonly cropId: CropId | null;
  readonly plantedAt: number | null;
  readonly growthDurationMs: number | null;
  /** When the soil was last watered; null = never (D-1, §5.2). */
  readonly wateredAt: number | null;
  /** Reserved for the undecided withering mechanic. Always null today. */
  readonly witheredAt: number | null;
  readonly harvestedAt: number | null;
}

/**
 * A plot as the client sees it: growth already resolved by the server.
 *
 * Everything derived is derived HERE, once, from the row and the server's own
 * clock. The client renders these numbers and interpolates between polls; it
 * never recomputes them from `plantedAt` (§4.1), which since D-1 would not even
 * be possible — growth accrues on watered time, not wall-clock time.
 */
export interface PlotView extends Plot {
  /** Hoed, so something can be planted. Harvesting leaves this true (§5.2). */
  readonly tilled: boolean;
  /** Index into the crop's stageFrames. */
  readonly stage: number;
  readonly isRipe: boolean;
  /**
   * **Milliseconds of WATERED time still needed**, not wall-clock time — a dry
   * crop's countdown is stopped, so "ms from now" has no answer. 0 once ripe.
   * Pair with `isPaused` to know whether it is currently ticking down.
   */
  readonly readyInMs: number;
  /** Growth is stopped: planted, not ripe, and the soil is dry. */
  readonly isPaused: boolean;
  /** Whether the soil is wet AT `serverNow`. Between polls, use `wetUntil`. */
  readonly isWet: boolean;
  /**
   * When the current wet window closes, on the server's clock; null = never
   * watered. Absolute rather than relative so the client can let the soil dry
   * out on screen without waiting for the next poll to be told.
   */
  readonly wetUntil: number | null;
  /**
   * Total watered time this crop needs, VIP multiplier already applied; 0 for
   * an empty plot.
   *
   * Sent so the client draws stages with the SAME formula the server uses
   * (§4.4) instead of inferring the duration from timestamps. It exposes
   * nothing: the multiplier is public config, and this is it applied to
   * `growthDurationMs`, which the view already carries.
   */
  readonly effectiveDurationMs: number;
}

export interface Animal {
  readonly id: string;
  readonly farmId: string;
  readonly kind: AnimalKind;
  readonly variant: AnimalVariant;
  readonly name: string | null;
  readonly acquiredAt: number;
  readonly maturesAt: number;
  readonly lastCollectedAt: number;
  /** Feeding expires at this timestamp; unfed animals stop producing. */
  readonly fedUntil: number | null;
}

export interface AnimalView extends Animal {
  readonly isMature: boolean;
  readonly isFed: boolean;
  readonly hasProduce: boolean;
  readonly readyInMs: number;
}

/**
 * The farmer's standing orders, as the server holds them (T-13.02).
 *
 * `processedAt` is the watermark: everything before it has been simulated and
 * applied. It is reported rather than hidden because the client needs it to
 * say "working since …" — but it is never *sent* by the client, and the server
 * recomputes rather than trusts it (§4.1).
 */
export interface IdleSettings {
  readonly enabled: boolean;
  /** In `IDLE_TASK_TYPES` order, deduplicated — canonical, not as submitted. */
  readonly tasks: readonly IdleTask[];
  readonly cropId: CropId | null;
  readonly processedAt: number | null;
}

/**
 * The one thing the farmer is about to do next (T-13.05).
 *
 * Computed by running the simulator a single step forward, so it is not a
 * guess the view invented — it is the same function, over the same plots, that
 * the next catch-up will run. That is what lets the client walk the character
 * to the right tile and swing the right tool *before* the action lands
 * (T-13.07) while the server stays the only authority on what actually
 * happened (§4.1).
 *
 * `at` is when the action COMPLETES, and it can be in the past: a player back
 * from a long absence has a backlog, and the next catch-up works through it
 * from the watermark rather than from now. Null means the farmer has nothing to
 * do in the near future — an empty bag of seeds, a field with nothing ripe, or
 * simply a switch that is off.
 */
export interface IdleNextAction {
  readonly kind: IdleTask;
  readonly plotId: string;
  readonly at: number;
}

/**
 * Idle mode as the farm view reports it.
 *
 * Deliberately NOT `IdleSettings`: the watermark is an implementation detail of
 * the catch-up, and what the client needs on every poll is the *plan* — what
 * the farmer is set to do, and what it is doing next.
 */
export interface IdleView {
  readonly enabled: boolean;
  readonly tasks: readonly IdleTask[];
  readonly cropId: CropId | null;
  readonly nextAction: IdleNextAction | null;
}

/**
 * What the farmer got through while nobody was looking (T-13.08).
 *
 * Reported ONLY on the farm read that actually applied the work, never again —
 * the catch-up settles its watermark, so the next poll has nothing pending and
 * nothing to report. That is what makes "show it once" a property of the
 * protocol rather than a flag the client has to remember not to lose.
 *
 * A player who was away five minutes and one who was away five hours both get
 * one of these; deciding which is worth interrupting someone about is the
 * client's call, from `window`.
 */
export interface IdleSummaryView {
  readonly tilled: number;
  readonly planted: number;
  readonly watered: number;
  /** Produce picked, by item id — what actually landed in the bag. */
  readonly harvested: Readonly<Record<string, number>>;
  /** The stretch of time this accounts for, in epoch ms. */
  readonly window: { readonly from: number; readonly to: number };
  /**
   * A ripe crop was left standing because the bag was full.
   *
   * The one outcome a player can do something about, which is why it is
   * reported at all — everything else here is news, this is a nudge. A boolean
   * rather than the simulator's own stop reason: "why the loop exited" is
   * internal vocabulary, and the client only needs the one case that means
   * something to a person.
   */
  readonly bagWasFull: boolean;
}

export interface Farm {
  readonly id: string;
  readonly playerId: string;
  readonly houseTier: number;
  readonly chestTier: number;
  /** Caps chickens and picks the coop's look on the map (T-12.02). */
  readonly coopTier: number;
  /** Caps cows and picks the barn's look. */
  readonly barnTier: number;
  readonly width: number;
  readonly height: number;
}

/** Response of the farm-state endpoint — the hottest path in the game. */
export interface FarmState {
  readonly farm: Farm;
  readonly plots: readonly PlotView[];
  readonly animals: readonly AnimalView[];
  readonly player: SelfPlayer;
  /**
   * Gold the shipping box paid out while serving THIS request (T-11.03).
   *
   * Settlement happens on read (§4.2) and the farm poll is the read a player
   * actually makes, so the ten minutes usually run out while they are standing
   * in a field nowhere near the box. Reporting what was just credited is what
   * lets the client say so, instead of the balance changing in the corner of
   * the screen with nothing to explain it. 0 on almost every poll.
   */
  readonly shippingPaid: number;
  /** Standing orders and the farmer's next move (T-13.05). */
  readonly idle: IdleView;
  /**
   * What the farmer did while away, on the ONE read that applied it (T-13.08).
   *
   * Null on every other poll, which is almost all of them.
   */
  readonly idleSummary: IdleSummaryView | null;
  /** Server clock at the moment of computation. Clients reconcile against this. */
  readonly serverNow: number;
}

/* ------------------------------------------------------------------ *
 * House interior
 * ------------------------------------------------------------------ */

export interface InteriorRoom {
  readonly width: number;
  readonly height: number;
}

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

export interface InventorySlot {
  readonly index: number;
  readonly itemId: string;
  readonly quantity: number;
}

export interface Inventory {
  readonly slots: readonly InventorySlot[];
  readonly capacity: number;
}

/* ------------------------------------------------------------------ *
 * Trade
 * ------------------------------------------------------------------ */

export const TradeStatus = {
  PENDING: 'pending',
  OPEN: 'open',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;
export type TradeStatus = (typeof TradeStatus)[keyof typeof TradeStatus];

export interface TradeOfferItem {
  readonly itemId: string;
  readonly quantity: number;
}

export interface TradeSide {
  readonly playerId: string;
  readonly username: string;
  readonly items: readonly TradeOfferItem[];
  /** Present but always 0 while GOLD_IS_TRADEABLE is false. */
  readonly gold: number;
  readonly confirmed: boolean;
}

export interface Trade {
  readonly id: string;
  readonly status: TradeStatus;
  readonly initiator: TradeSide;
  readonly recipient: TradeSide;
  readonly createdAt: number;
  readonly updatedAt: number;
  /**
   * Bumped on every offer mutation. Confirmations carry the revision they were
   * made against; a mismatch means the offer changed and both confirmations
   * reset (CLAUDE.md §6).
   */
  readonly revision: number;
}

/** Immutable record written on every completed trade. Never updated or deleted. */
export interface TradeLogEntry {
  readonly id: string;
  readonly tradeId: string;
  readonly initiatorId: string;
  readonly recipientId: string;
  readonly initiatorItems: readonly TradeOfferItem[];
  readonly recipientItems: readonly TradeOfferItem[];
  readonly initiatorGold: number;
  readonly recipientGold: number;
  readonly completedAt: number;
}

/* ------------------------------------------------------------------ *
 * API envelope
 * ------------------------------------------------------------------ */

export interface ApiError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, string | number>;
  };
}

export type ApiResult<T> = T | ApiError;

export function isApiError(v: unknown): v is ApiError {
  return typeof v === 'object' && v !== null && 'error' in v;
}
