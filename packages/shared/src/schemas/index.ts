import { z } from 'zod';
import { CROP_IDS } from '../config/crops.js';
import { ANIMAL_KINDS } from '../config/animals.js';
import { IDLE_TASK_TYPES, type IdleTask } from '../config/idle.js';
import { FARM_HEIGHT, FARM_WIDTH } from '../config/tilesets.js';

/**
 * Zod schemas at the boundary (CLAUDE.md §8). The SERVER is the authority:
 * every inbound payload is parsed here before it reaches business logic.
 *
 * The client imports the same schemas to give immediate form feedback. That is
 * a convenience only — client-side validation is never a security control
 * (CLAUDE.md §4.1).
 */

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** Quantities and gold are always non-negative integers (CLAUDE.md §10). */
export const quantitySchema = z.number().int().nonnegative();
export const positiveQuantitySchema = z.number().int().positive();

export const uuidSchema = z.string().uuid();

/**
 * Idempotency key, required on every state-changing endpoint (CLAUDE.md §4.5).
 * Double-submitting `harvest` on a flaky connection must not double-reward.
 */
export const idempotencyKeySchema = z.string().min(8).max(128);

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export const usernameSchema = z
  .string()
  .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters.`)
  .max(USERNAME_MAX, `Username must be at most ${USERNAME_MAX} characters.`)
  .regex(
    /^[a-zA-Z0-9_]+$/,
    'Username can only use letters, numbers and underscores.',
  );

export const emailSchema = z
  .string()
  .min(3)
  .max(254)
  .email('That does not look like an email address.');

/**
 * Length-first password policy. Long passphrases beat short complex ones, and
 * composition rules mostly push people toward predictable substitutions.
 * Hashing is argon2 server-side (CLAUDE.md §8).
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters.`);

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  /** Accepts either an email or a username. */
  identifier: z.string().min(1, 'Enter your email or username.').max(254),
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX),
});
export type LoginInput = z.infer<typeof loginSchema>;

/* ------------------------------------------------------------------ *
 * Character appearance (T-8.01)
 *
 * Enum values are the ACTUAL folder/file names under
 * `assets/Character/Character/PNG/1. Idle/` (lower-cased), verified
 * directly against the pack rather than assumed — see the T-8.01 write-up in
 * ROADMAP.md for the listing. Purely cosmetic (§5.1): nothing here is ever
 * read by a gameplay check, and no server logic may branch on it.
 * ------------------------------------------------------------------ */

/** `Skins/{1,2,3,4}.png`. */
export const SKIN_IDS = [1, 2, 3, 4] as const;
export type SkinId = (typeof SKIN_IDS)[number];

/** `Eyes/{Female,Male}/...`. */
export const EYE_SEXES = ['male', 'female'] as const;
/** `Eyes/<sex>/{Black,Blue,Brown,Green}.png`. */
export const EYE_COLORS = ['black', 'blue', 'brown', 'green'] as const;

/** `Hair's/{Fawn,Iridessa,Josh,Lyria,Sebastian,Silvermist,Standard}/...`. */
export const HAIR_STYLES = [
  'fawn',
  'iridessa',
  'josh',
  'lyria',
  'sebastian',
  'silvermist',
  'standard',
] as const;
/** `Hair's/<style>/{Black,Blonde,Brown,Ginger}.png`. */
export const HAIR_COLORS = ['black', 'blonde', 'brown', 'ginger'] as const;

/** `Clothers/Farm/{Blue,Green,Pink,Purple,Red}.png`. */
export const CLOTHES_COLORS = ['blue', 'green', 'pink', 'purple', 'red'] as const;

export const appearanceSchema = z.object({
  skin: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  eyes: z.object({
    sex: z.enum(EYE_SEXES),
    color: z.enum(EYE_COLORS),
  }),
  hair: z.object({
    style: z.enum(HAIR_STYLES),
    color: z.enum(HAIR_COLORS),
  }),
  clothes: z.enum(CLOTHES_COLORS),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const setAppearanceSchema = z.object({
  appearance: appearanceSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type SetAppearanceInput = z.infer<typeof setAppearanceSchema>;

/* ------------------------------------------------------------------ *
 * Farm intents
 *
 * The client sends INTENTS, never results (CLAUDE.md §4.1). There is no
 * schema anywhere that accepts a gold amount, an item grant, or a growth
 * stage from the client — if you find yourself writing one, stop.
 * ------------------------------------------------------------------ */

export const plantSchema = z.object({
  plotId: uuidSchema,
  cropId: z.enum(CROP_IDS as [string, ...string[]]),
  idempotencyKey: idempotencyKeySchema,
});
export type PlantInput = z.infer<typeof plantSchema>;

/**
 * Tilling carries a plot id and nothing else. Notably NOT which tool was used:
 * the equipped item is client-side state (§5.1) and a server that trusted it
 * would be trusting the client to say it owns a hoe.
 */
export const tillSchema = z.object({
  plotId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type TillInput = z.infer<typeof tillSchema>;

/**
 * Watering carries a plot id and nothing else — no timestamp, and no "how
 * long" (§4.1): when the soil was wetted and for how long are both the
 * server's to decide, from its own clock and `WATER_DURATION_MS`.
 */
export const waterSchema = z.object({
  plotId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type WaterInput = z.infer<typeof waterSchema>;

export const harvestSchema = z.object({
  plotId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type HarvestInput = z.infer<typeof harvestSchema>;

/**
 * Bulk harvest — `VIP_BENEFITS.bulkHarvest` (T-24.01).
 *
 * Carries NO plot list. The client does not get to nominate which plots are
 * ripe: the server already computes ripeness from timestamps for every plot it
 * owns (§4.2), and a list in the payload would be a second opinion it would
 * have to either trust or re-derive. Re-deriving it is the whole endpoint, so
 * the list would be pure attack surface.
 */
export const harvestAllSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});
export type HarvestAllInput = z.infer<typeof harvestAllSchema>;

/**
 * Chopping carries a tree id and nothing else (T-20.03).
 *
 * No tool field, for the same reason `tillSchema` has none — but note the
 * difference in what that costs. Tilling checks no tool at all, because every
 * account is granted a hoe; chopping DOES require an axe, and the server looks
 * it up in the player's own inventory rather than believing a field. A payload
 * that named the tool would be the client asserting what it owns (§4.1).
 *
 * No coordinates either: the tree is named by id, so "which tree" never depends
 * on a position the server does not track (§5.1).
 */
export const chopSchema = z.object({
  treeId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type ChopInput = z.infer<typeof chopSchema>;

export const unlockPlotSchema = z.object({
  plotId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});

/* ------------------------------------------------------------------ *
 * Idle mode (CLAUDE.md §5.3)
 * ------------------------------------------------------------------ */

/**
 * The farmer's standing orders.
 *
 * A **whole-resource PUT**, not a patch: every field is the new setting, and
 * an omitted `cropId` means "sow nothing", not "leave it as it was". A partial
 * update would need a way to say "clear the crop" that is distinct from "don't
 * mention it", and every such API eventually gets that wrong.
 *
 * Nothing here is a result (§4.1) — no timestamp, no watermark, no count of
 * actions owed. When idle work happened and how much of it is the server's to
 * work out from its own clock.
 *
 * Duplicate tasks are REFUSED rather than deduplicated. `["till","till"]` is a
 * client bug, and silently accepting it means the bug ships.
 *
 * **Enabled with no chores is refused too (T-18.07, BUG-09).** It parsed
 * cleanly for five phases and it is the worst state the feature can be put in:
 * the HUD says "your farmer is working", movement and the action key go dead —
 * `Farm.ts` locks input on `enabled` alone — and the simulator has nothing in
 * its task list, so it does nothing, forever. The player has given up their
 * farm in exchange for nothing, and the only signal that anything is wrong is
 * that nothing happens.
 *
 * Refused HERE rather than only in the panel, because §4.1 means the panel is a
 * UX gate and this is a rule about what the farm may BE. `enabled` with an
 * empty task list has no meaning the server could act on; it is not a setting,
 * it is a contradiction.
 */
export const idleSettingsSchema = z
  .object({
    enabled: z.boolean(),
    tasks: z
      .array(z.enum(IDLE_TASK_TYPES as [IdleTask, ...IdleTask[]]))
      .max(IDLE_TASK_TYPES.length)
      .refine((tasks) => new Set(tasks).size === tasks.length, {
        message: 'Each task may be listed only once.',
      }),
    /** `null` and omitted both mean "sow nothing" — see the PUT note above. */
    cropId: z.enum(CROP_IDS as [string, ...string[]]).nullish(),
    idempotencyKey: idempotencyKeySchema,
  })
  .refine((body) => !body.enabled || body.tasks.length > 0, {
    // Pointed at `tasks`, not at `enabled`: the chore list is what is missing,
    // and it is the field the player can do something about.
    path: ['tasks'],
    message: 'Choose at least one chore for your farmer to do.',
  });
export type IdleSettingsInput = z.infer<typeof idleSettingsSchema>;

/* ------------------------------------------------------------------ *
 * Animal intents
 * ------------------------------------------------------------------ */

export const buyAnimalSchema = z.object({
  kind: z.enum(ANIMAL_KINDS as [string, ...string[]]),
  variant: z.string().min(1).max(64),
  idempotencyKey: idempotencyKeySchema,
});

export const collectAnimalSchema = z.object({
  animalId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const feedAnimalSchema = z.object({
  animalId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});

/**
 * Bulk collect — `VIP_BENEFITS.autoCollect` (T-24.02). Same reasoning as
 * `harvestAllSchema`: no animal list, because the server owns the answer.
 */
export const collectAllSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});
export type CollectAllInput = z.infer<typeof collectAllSchema>;

/* ------------------------------------------------------------------ *
 * Inventory intents
 * ------------------------------------------------------------------ */

/**
 * A slot index.
 *
 * The upper bound here is a sanity limit, not the real one: how many slots a
 * player actually has depends on their house tier, chest tier and VIP status,
 * which only the server knows. It re-checks the index against the true capacity
 * before touching a row — a client cannot invent a slot it has not paid for
 * (CLAUDE.md §4.1).
 */
export const slotIndexSchema = z.number().int().nonnegative().max(999);

/**
 * Bag <-> chest. The client says WHAT and HOW MANY, never where it lands: slot
 * placement is the server's business, and a client-chosen destination slot
 * would be a second thing to validate for no gain.
 */
export const inventoryTransferSchema = z.object({
  itemId: z.string().min(1).max(64),
  quantity: positiveQuantitySchema.max(9_999),
  direction: z.enum(['to_chest', 'to_bag']),
  idempotencyKey: idempotencyKeySchema,
});
export type InventoryTransferInput = z.infer<typeof inventoryTransferSchema>;

/**
 * The two containers a slot can live in.
 *
 * Named here rather than inlined because the move schema, T-10.02's
 * cross-container form and the client all have to agree on the same two
 * strings, and they are the same strings the `container` column stores.
 */
export const containerSchema = z.enum(['inventory', 'chest']);
export type ContainerName = z.infer<typeof containerSchema>;

/** One end of a drag: which container, and which slot in it. */
export const slotRefSchema = z.object({
  container: containerSchema,
  slot: slotIndexSchema,
});
export type SlotRef = z.infer<typeof slotRefSchema>;

/**
 * Rearranging, within one container or across both (T-10.02).
 *
 * Both ends name their own container, so bag→bag, chest→chest and bag↔chest
 * are one request shape rather than three endpoints. Which container each end
 * names decides which capacity that slot index is checked against; a chest
 * index is not a bag index (§4.1).
 *
 * T-10.01's flat `{fromSlot, toSlot, container}` form is gone rather than kept
 * as a compatibility skin: the only caller is this repo's own client, migrated
 * in the same change, and a legacy shape whose sole user has already moved is
 * a second contract to keep working for nobody.
 */
export const inventoryMoveSchema = z.object({
  from: slotRefSchema,
  to: slotRefSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type InventoryMoveInput = z.infer<typeof inventoryMoveSchema>;

/**
 * Dropping goods into the shipping box.
 *
 * WHAT and HOW MANY, and nothing else — no price, and no idea of what it is
 * worth. The payout is the server's to compute at settlement, from its own
 * config (§4.1).
 */
export const shippingDepositSchema = z.object({
  itemId: z.string().min(1).max(64),
  quantity: positiveQuantitySchema.max(9_999),
  idempotencyKey: idempotencyKeySchema,
});
export type ShippingDepositInput = z.infer<typeof shippingDepositSchema>;

/* ------------------------------------------------------------------ *
 * Milestones (T-30.08)
 * ------------------------------------------------------------------ */

/**
 * Claiming one earned milestone.
 *
 * The id only. Whether it is EARNED is the server's arithmetic over counters
 * it derives itself (§4.1), and whether it is already CLAIMED is a unique
 * index, not a field the client could assert.
 */
export const claimMilestoneSchema = z.object({
  milestoneId: z.string().min(1).max(64),
  idempotencyKey: idempotencyKeySchema,
});
export type ClaimMilestoneInput = z.infer<typeof claimMilestoneSchema>;

/* ------------------------------------------------------------------ *
 * Quests (T-33.05)
 * ------------------------------------------------------------------ */

/**
 * Accepting a quest, and turning one in.
 *
 * **The id and nothing else, on both.** Whether the quest is offered is derived
 * from the farm's level, which the server holds; whether the player has the
 * items is a locked read of their own inventory; whether it is already done is a
 * unique index. There is nothing here a client could usefully assert, which is
 * the point (§4.1) — and no player id, so "somebody else's quest" is
 * unexpressible rather than merely refused.
 */
export const acceptQuestSchema = z.object({
  questId: z.string().min(1).max(64),
  idempotencyKey: idempotencyKeySchema,
});
export type AcceptQuestInput = z.infer<typeof acceptQuestSchema>;

export const turnInQuestSchema = z.object({
  questId: z.string().min(1).max(64),
  idempotencyKey: idempotencyKeySchema,
});
export type TurnInQuestInput = z.infer<typeof turnInQuestSchema>;

/* ------------------------------------------------------------------ *
 * Fishing (T-34.02)
 * ------------------------------------------------------------------ */

/**
 * Casting a line.
 *
 * **An idempotency key and nothing else.** There is deliberately no position:
 * standing at water is a client-side UX gate (§5.1), and a server that accepted
 * coordinates would be the first place in this game to treat the character's
 * position as authority. There is also no bait, no rod tier and no target —
 * everything the cast depends on, the server already holds.
 */
export const castSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});
export type CastInput = z.infer<typeof castSchema>;

/**
 * Reeling in.
 *
 * **The cast id and nothing else, and `.strict()` is load-bearing here.**
 * Every other schema in this file is permissive about extra keys because extra
 * keys are harmless when nothing reads them. This one refuses them, because the
 * exploit it guards against is a client that helpfully includes its own
 * `reactionMs` — and the honest failure for that is a 400 saying the field is
 * not accepted, not a silent success that leaves the sender believing it worked.
 *
 * A client that reports its own reaction time reports a perfect one. The server
 * has `biteAt` and its own clock; that is the entire judgement.
 */
export const reelSchema = z
  .object({
    castId: z.string().uuid(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export type ReelInput = z.infer<typeof reelSchema>;

/* ------------------------------------------------------------------ *
 * House interior (CLAUDE.md §5.5)
 * ------------------------------------------------------------------ */

/**
 * A cell in the interior room. Bounded loosely here; the SERVER checks the
 * actual room size and the piece's footprint, because only it knows both.
 */
const roomCellSchema = z.number().int().nonnegative().max(64);

/* ------------------------------------------------------------------ *
 * Farm decoration (T-15.20)
 * ------------------------------------------------------------------ */

/**
 * A tile coordinate on the farm.
 *
 * Bounded by the map rather than left as a bare integer: the placement rules
 * refuse anything off the map anyway, but a schema that accepts 2^31 lets a
 * hostile payload reach the flood fill and make it allocate. Cheap to say here.
 */
const farmTileSchema = z.number().int().min(0).max(Math.max(FARM_WIDTH, FARM_HEIGHT) - 1);

export const buyDecorSchema = z.object({
  decorId: z.string().min(1).max(64),
  idempotencyKey: idempotencyKeySchema,
});

export const placeDecorSchema = z.object({
  decorId: z.string().min(1).max(64),
  x: farmTileSchema,
  y: farmTileSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const moveDecorSchema = z.object({
  placementId: uuidSchema,
  x: farmTileSchema,
  y: farmTileSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const removeDecorSchema = z.object({
  placementId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const buyFurnitureSchema = z.object({
  furnitureId: z.string().min(1).max(64),
  idempotencyKey: idempotencyKeySchema,
});

export const placeFurnitureSchema = z.object({
  furnitureId: z.string().min(1).max(64),
  x: roomCellSchema,
  y: roomCellSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const moveFurnitureSchema = z.object({
  placementId: uuidSchema,
  x: roomCellSchema,
  y: roomCellSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const removeFurnitureSchema = z.object({
  placementId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});

/* ------------------------------------------------------------------ *
 * Upgrades
 * ------------------------------------------------------------------ */

/**
 * Buying the next tier of something.
 *
 * Deliberately carries NO target tier. "Upgrade" means "the one after the one
 * I have", so skipping a tier is not something the wire format can express —
 * which is a stronger guarantee than validating it (CLAUDE.md §4.1).
 */
export const upgradeSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});
export type UpgradeInput = z.infer<typeof upgradeSchema>;

/**
 * Going to bed, and getting up again.
 *
 * **Carries nothing but the key**, and that is the same argument
 * `upgradeSchema` makes. A duration, a "wake at" time or an amount of energy
 * would all be things the client could get wrong or lie about; the server has
 * a clock and `SLEEP_DURATION_MS`, so the only thing the wire needs to say is
 * *which* of the two things is happening — and the URL says that.
 *
 * There is no bed id either. A player has one house and one bed; standing at
 * it is a client-side UX gate like every other adjacency check (§5.1), so
 * accepting an id would invite one to be harvested from somewhere else.
 */
export const sleepSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});
export type SleepInput = z.infer<typeof sleepSchema>;

/* ------------------------------------------------------------------ *
 * Shop intents
 * ------------------------------------------------------------------ */

export const shopBuySchema = z.object({
  itemId: z.string().min(1).max(64),
  quantity: positiveQuantitySchema.max(9_999),
  idempotencyKey: idempotencyKeySchema,
});

export const shopSellSchema = z.object({
  itemId: z.string().min(1).max(64),
  quantity: positiveQuantitySchema.max(9_999),
  idempotencyKey: idempotencyKeySchema,
});

/* ------------------------------------------------------------------ *
 * Trade intents (CLAUDE.md §6)
 * ------------------------------------------------------------------ */

export const tradeOfferItemSchema = z.object({
  itemId: z.string().min(1).max(64),
  quantity: positiveQuantitySchema.max(9_999),
});

export const tradeInviteSchema = z.object({
  targetUsername: usernameSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const tradeSetOfferSchema = z.object({
  tradeId: uuidSchema,
  items: z.array(tradeOfferItemSchema).max(24),
  /** Ignored while GOLD_IS_TRADEABLE is false; the server rejects non-zero. */
  gold: quantitySchema.default(0),
  idempotencyKey: idempotencyKeySchema,
});

export const tradeConfirmSchema = z.object({
  tradeId: uuidSchema,
  /**
   * The revision the player is confirming. If it no longer matches the trade's
   * current revision, the offer changed — the server rejects with
   * TRADE_OFFER_CHANGED and both confirmations reset.
   */
  revision: z.number().int().nonnegative(),
  idempotencyKey: idempotencyKeySchema,
});

export const tradeCancelSchema = z.object({
  tradeId: uuidSchema,
});

/**
 * Executes a trade both parties have confirmed. Carries no revision: by the
 * time BOTH confirmations stand, they necessarily agree on the same offer —
 * any edit resets both flags, so there is no state for a revision to guard
 * against here that `bothConfirmed` does not already guarantee.
 */
export const tradeExecuteSchema = z.object({
  tradeId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
});

/**
 * `GET /trade/history` query params. `cursor` is opaque to the client — it is
 * whatever `nextCursor` came back on the previous page, echoed verbatim, not
 * something the client constructs. Read-only, so no idempotency key.
 */
export const tradeHistorySchema = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/* ------------------------------------------------------------------ *
 * VIP (CLAUDE.md §7)
 * ------------------------------------------------------------------ */

/**
 * The client asks to START checkout and gets back a Stripe-hosted URL. It
 * never supplies a price, an amount, or a duration — payment data is
 * constructed server-side only.
 */
export const vipCheckoutSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});
