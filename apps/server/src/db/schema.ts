import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Database schema (Drizzle).
 *
 * Conventions, per CLAUDE.md §10:
 *  - Every game timestamp is `bigint` epoch MILLISECONDS, UTC. Not `timestamp`,
 *    not local time. The only exception is `createdAt` audit columns on rows
 *    the game logic never does arithmetic on.
 *  - Gold and quantities are `integer`. Never numeric, never float.
 *
 * This file covers Phase 1 (auth, farm, plots, inventory) plus the columns
 * later phases need so that enabling a feature is a code change, not a
 * migration on live player data. See ROADMAP.md for what is actually wired up.
 */

const epochMs = (name: string) => bigint(name, { mode: 'number' });

/**
 * A DURATION in milliseconds, not an instant. Same storage as `epochMs`;
 * named apart because reading `grown_ms` as a timestamp is exactly the mistake
 * the growth-v2 model invites (see `plots.grownMs`).
 */
const durationMs = (name: string) => bigint(name, { mode: 'number' });

/* ------------------------------------------------------------------ *
 * Players & sessions
 * ------------------------------------------------------------------ */

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    /** argon2id hash. Plaintext passwords never touch this table. */
    passwordHash: text('password_hash').notNull(),

    gold: integer('gold').notNull().default(0),

    /**
     * Backpack size, as a purchased tier (T-10.03, CLAUDE.md §5.5).
     *
     * On the PLAYER rather than the farm: the backpack is carried, and unlike
     * the chest and the house it is not a thing standing on the ground. It also
     * keeps the hot path cheap — `capacityForPlayer` already has the player row
     * from the session, so bag capacity costs no extra query.
     *
     * Tier 0 is 12 slots, exactly the hotbar's width (`BACKPACK_TIERS`), so a
     * new player's whole bag is the strip along the bottom of the screen.
     */
    backpackTier: integer('backpack_tier').notNull().default(0),

    /**
     * Lifetime experience. Farm level is DERIVED from this and is not stored —
     * see `levelForXp`. A stored level would be a second source of truth that
     * could be set, and the level is a trade-eligibility gate (§6), so the only
     * thing that may raise it is recorded activity.
     *
     * Monotonic: nothing in the codebase ever subtracts from it.
     */
    experience: integer('experience').notNull().default(0),

    /** VIP expiry, epoch ms. null = never purchased or fully expired. */
    vipUntil: epochMs('vip_until'),
    /** Set on refund or chargeback; blocks VIP benefits and trading. */
    flaggedAt: epochMs('flagged_at'),

    /**
     * Character appearance, JSON-encoded `Appearance` (T-8.01). Null until the
     * player finishes the first-login character creator (T-8.02) — the client
     * treats null as "show the creator." Purely cosmetic: nothing here is ever
     * read by any gameplay check (§5.1), so it is stored as opaque validated
     * JSON rather than normalised columns.
     */
    appearance: text('appearance'),

    createdAt: epochMs('created_at').notNull(),
    lastSeenAt: epochMs('last_seen_at'),
  },
  (t) => [
    /*
     * Indexed on lower(...), not the raw column. A plain unique index is
     * case-SENSITIVE, which would let "Alice" and "alice" both register — two
     * accounts that look identical to every other player, and a ready-made
     * impersonation vector in a game with player-to-player trading.
     *
     * Lookups must use the same expression to hit these indexes; see
     * findPlayerByIdentifier in modules/auth/service.ts.
     */
    uniqueIndex('players_username_lower_idx').on(sql`lower(${t.username})`),
    uniqueIndex('players_email_lower_idx').on(sql`lower(${t.email})`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    /** Opaque random token. Stored hashed so a DB leak is not a session leak. */
    id: text('id').primaryKey(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    createdAt: epochMs('created_at').notNull(),
    expiresAt: epochMs('expires_at').notNull(),
    revokedAt: epochMs('revoked_at'),
  },
  (t) => [index('sessions_player_idx').on(t.playerId)],
);

/* ------------------------------------------------------------------ *
 * Farm
 * ------------------------------------------------------------------ */

export const farms = pgTable(
  'farms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    houseTier: integer('house_tier').notNull().default(0),
    chestTier: integer('chest_tier').notNull().default(0),
    /** Caps chickens (T-12.02). See `COOP_TIERS` / `BARN_TIERS` in shared config. */
    coopTier: integer('coop_tier').notNull().default(0),
    /** Caps cows. Separate from the coop so one kind never crowds out the other. */
    barnTier: integer('barn_tier').notNull().default(0),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: epochMs('created_at').notNull(),

    /*
     * ---- Idle mode (T-13.01, CLAUDE.md §5.3) --------------------------
     *
     * Standing orders, not a running process. Nothing ticks: the four columns
     * below say WHAT the farmer should do, and `idleProcessedAt` is the
     * watermark saying how far the world has already been simulated. On the
     * next read the server replays `(now - idleProcessedAt) / IDLE_ACTION_MS`
     * actions through a pure simulator and applies them in one transaction
     * (§4.2, §4.3) — which is what makes idle work happen with the tab closed.
     *
     * On the FARM rather than the player because every one of these is an
     * instruction about a farm: which of its plots to work and what to sow in
     * them. A player owns exactly one farm today (§5.1), so the distinction
     * costs nothing now and is the right side of the line if that changes.
     */

    /** Whether the farmer works on its own. False = the player drives. */
    idleEnabled: boolean('idle_enabled').notNull().default(false),
    /**
     * Which chores to do, as a JSON array of `IDLE_TASK_TYPES` values.
     *
     * Text rather than a Postgres array or four booleans: the set is expected
     * to grow (chop, mine, fish — §5.3), and adding a member to a JSON array is
     * a config change while adding a column is a migration. The server is the
     * only reader and validates it against the shared const with Zod on the way
     * in (§8), so nothing downstream trusts what is in here. Default `'[]'` —
     * enabling idle with no chores selected does nothing, which is the honest
     * reading of "I turned it on but chose nothing".
     */
    idleTasks: text('idle_tasks').notNull().default('[]'),
    /**
     * Which crop to sow. Null = plant nothing, which is a legitimate setting
     * (a player who only wants watering and harvesting done). Not a foreign
     * key: crops live in shared config, not in a table.
     */
    idleCropId: text('idle_crop_id'),
    /**
     * The watermark — everything before this instant has been simulated and
     * applied. Null when idle has never been enabled.
     *
     * Stamped to `now` when idle is switched ON and never backdated, so
     * flipping the switch cannot mint a backlog of free work out of the time
     * the farm spent idle-disabled.
     */
    idleProcessedAt: epochMs('idle_processed_at'),
  },
  (t) => [uniqueIndex('farms_player_idx').on(t.playerId)],
);

export const plots = pgTable(
  'plots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id, { onDelete: 'cascade' }),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    unlocked: boolean('unlocked').notNull().default(false),

    cropId: text('crop_id'),
    plantedAt: epochMs('planted_at'),
    /** Snapshotted at plant time so a config change never retroactively
     *  shortens or extends a crop already in the ground. */
    growthDurationMs: epochMs('growth_duration_ms'),

    /*
     * ---- Growth v2 (D-1 DECIDED: watering required) -------------------
     *
     * A crop only grows while its soil is WET, and the model stays O(1) with
     * no jobs (§4.2) by storing settled progress plus one open window:
     *
     *   effectiveGrowth(now) = grownMs + overlap([wateredAt, wateredAt + WATER_DURATION_MS],
     *                                            [wateredAt, now])
     *
     * `grownMs` is growth already BANKED — every wet window that has closed,
     * summed. `wateredAt` opens the current window; the overlap term is
     * whatever of it has elapsed, clamped to the window's length, so a plot
     * left dry for a week accrues nothing and a plot re-watered early loses
     * nothing (the service settles `grownMs` before re-stamping `wateredAt`).
     *
     * Deliberately NOT a "wateredUntil" instant: two fields that must agree
     * about the same window is one more thing to keep in step, and the window
     * length is config that may be retuned.
     *
     * A dry crop PAUSES; it never dies. `witheredAt` stays unused.
     */

    /** When the soil was last watered. Null = never, so growth is 0. */
    wateredAt: epochMs('watered_at'),
    /** Growth banked from closed wet windows. Never decreases. */
    grownMs: durationMs('grown_ms').notNull().default(0),
    /**
     * When this plot was last hoed. Null = untilled, and planting is refused.
     * Harvesting deliberately does NOT clear it — soil stays workable, so the
     * loop after the first harvest is plant → water → harvest (CLAUDE.md §5.2).
     */
    tilledAt: epochMs('tilled_at'),

    /** Reserved for the undecided withering mechanic (CLAUDE.md §14). */
    witheredAt: epochMs('withered_at'),

    harvestedAt: epochMs('harvested_at'),
  },
  (t) => [
    index('plots_farm_idx').on(t.farmId),
    uniqueIndex('plots_farm_pos_idx').on(t.farmId, t.x, t.y),
  ],
);

export const animals = pgTable(
  'animals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Cosmetic only; never affects production. */
    variant: text('variant').notNull(),
    name: text('name'),

    acquiredAt: epochMs('acquired_at').notNull(),
    /** Babies mature into producing adults at this timestamp. */
    maturesAt: epochMs('matures_at').notNull(),
    lastCollectedAt: epochMs('last_collected_at').notNull(),
    /** Unfed animals stop producing. They are never killed (CLAUDE.md §5.3). */
    fedUntil: epochMs('fed_until'),
  },
  (t) => [index('animals_farm_idx').on(t.farmId)],
);

/**
 * Furniture placed inside a player's house (CLAUDE.md §5.5).
 *
 * One row per placed piece. Position is the TOP-LEFT cell of its footprint;
 * the footprint size comes from config, so a config change resizes what a piece
 * occupies without a migration. Overlap is enforced in the service rather than
 * by a constraint — a rectangle-intersection rule is not something a unique
 * index can express.
 */
export const furniturePlacements = pgTable(
  'furniture_placements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    furnitureId: text('furniture_id').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    placedAt: epochMs('placed_at').notNull(),
  },
  (t) => [index('furniture_player_idx').on(t.playerId)],
);

/**
 * Furniture a player owns but has not necessarily put down.
 *
 * Separate from `inventory_items` on purpose: furniture has no stack limit, no
 * shop sell price and no bag slot, and forcing it through the slot system would
 * mean a full bag could stop you buying a rug. One row per kind, with a count.
 */
export const furnitureOwned = pgTable(
  'furniture_owned',
  {
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    furnitureId: text('furniture_id').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (t) => [uniqueIndex('furniture_owned_pk').on(t.playerId, t.furnitureId)],
);

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

/** `container` distinguishes carried inventory from chest storage. */
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    container: text('container').notNull(), // 'inventory' | 'chest'
    slotIndex: integer('slot_index').notNull(),
    itemId: text('item_id').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    index('inventory_player_idx').on(t.playerId),
    uniqueIndex('inventory_slot_idx').on(t.playerId, t.container, t.slotIndex),
  ],
);

/* ------------------------------------------------------------------ *
 * Idempotency (CLAUDE.md §4.5)
 * ------------------------------------------------------------------ */

/**
 * Every state-changing endpoint records its key here inside the same
 * transaction as the mutation. A replayed key returns the stored response
 * instead of re-running the mutation, so a double-submitted `harvest` cannot
 * double-reward.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').notNull(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    /** JSON response replayed on a duplicate submission. */
    response: text('response').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (t) => [uniqueIndex('idempotency_pk').on(t.playerId, t.key)],
);

/* ------------------------------------------------------------------ *
 * Trade (CLAUDE.md §6)
 * ------------------------------------------------------------------ */

export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: text('status').notNull(),
    initiatorId: uuid('initiator_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),

    /** JSON arrays of { itemId, quantity }. */
    initiatorItems: text('initiator_items').notNull().default('[]'),
    recipientItems: text('recipient_items').notNull().default('[]'),
    initiatorGold: integer('initiator_gold').notNull().default(0),
    recipientGold: integer('recipient_gold').notNull().default(0),

    initiatorConfirmed: boolean('initiator_confirmed').notNull().default(false),
    recipientConfirmed: boolean('recipient_confirmed').notNull().default(false),

    /**
     * Bumped on every offer mutation. A confirmation carries the revision it
     * was made against; any mismatch resets BOTH confirmations. This is what
     * makes "change the offer after they confirm" impossible.
     */
    revision: integer('revision').notNull().default(0),

    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
    expiresAt: epochMs('expires_at').notNull(),
  },
  (t) => [
    index('trades_initiator_idx').on(t.initiatorId),
    index('trades_recipient_idx').on(t.recipientId),
  ],
);

/**
 * Immutable audit log. Append-only: never UPDATE, never DELETE. This is the
 * record that lets a scam report actually be investigated (CLAUDE.md §6).
 */
export const tradeLog = pgTable(
  'trade_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tradeId: uuid('trade_id').notNull(),
    initiatorId: uuid('initiator_id').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    initiatorItems: text('initiator_items').notNull(),
    recipientItems: text('recipient_items').notNull(),
    initiatorGold: integer('initiator_gold').notNull(),
    recipientGold: integer('recipient_gold').notNull(),
    completedAt: epochMs('completed_at').notNull(),
  },
  (t) => [
    index('trade_log_initiator_idx').on(t.initiatorId),
    index('trade_log_recipient_idx').on(t.recipientId),
    index('trade_log_completed_idx').on(t.completedAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Purchases (CLAUDE.md §7)
 * ------------------------------------------------------------------ */

/**
 * One row per Stripe one-time payment, for reconciliation and support.
 * `stripeSessionId` is unique, which is what makes webhook fulfilment
 * idempotent under Stripe's retries.
 */
export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    stripeSessionId: text('stripe_session_id').notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    /** Smallest currency unit, as Stripe reports it. Integer. */
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    createdAt: epochMs('created_at').notNull(),
    refundedAt: epochMs('refunded_at'),
  },
  (t) => [
    uniqueIndex('purchases_session_idx').on(t.stripeSessionId),
    index('purchases_player_idx').on(t.playerId),
  ],
);

/* ------------------------------------------------------------------ *
 * Shipping box (CLAUDE.md §5.6)
 * ------------------------------------------------------------------ */

/**
 * One row per deposit into the shipping box: items left to be sold, and what
 * they eventually fetched.
 *
 * **Settled on read, never by a job** (§4.2). A row becomes payable at
 * `depositedAt + SHIPPING_PAYOUT_MS`; nothing ticks in the meantime. The next
 * request that looks at a player's shipments — the box itself, or the farm
 * state — credits whatever has come due, in the same transaction that reads
 * it. That is the same shape as crop growth: the passage of time is a
 * comparison against a stored instant, so an offline player's box pays out the
 * moment they come back and a player who never returns costs nothing.
 *
 * **`paidAt` is the exactly-once guard.** Settlement is a single UPDATE whose
 * WHERE clause requires `paid_at IS NULL`; two concurrent reads therefore
 * cannot both credit the same row, because the second one matches no rows.
 * There is no separate "already paid?" check to forget — the write IS the
 * check.
 *
 * **`payout` records what was actually credited**, not what the item is worth
 * today. Prices are config and config moves; a ledger that recomputed the
 * value would quietly rewrite history, and §5.8 wants every faucet accounted
 * for by what it actually paid. Null until settlement, alongside `paidAt`.
 */
export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),

    itemId: text('item_id').notNull(),
    /** Units deposited. Integer, positive — no floats for quantities (§10). */
    quantity: integer('quantity').notNull(),

    depositedAt: epochMs('deposited_at').notNull(),
    /** When it was credited. Null = still pending; the settlement guard. */
    paidAt: epochMs('paid_at'),
    /** Gold actually credited. Null until paid. Integer (§10). */
    payout: integer('payout'),
  },
  (t) => [index('shipments_player_idx').on(t.playerId)],
);

/* ------------------------------------------------------------------ *
 * Security audit (CLAUDE.md §8)
 * ------------------------------------------------------------------ */

export const securityLog = pgTable(
  'security_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id'),
    /** e.g. 'login_failed', 'trade_executed', 'vip_granted', 'refund'. */
    event: text('event').notNull(),
    ip: text('ip'),
    detail: text('detail'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('security_log_event_idx').on(t.event)],
);
