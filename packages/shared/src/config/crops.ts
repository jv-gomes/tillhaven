import { HOUR, MINUTE } from './time.js';
import { Season } from './season.js';
import {
  CROP_STRAWBERRY,
  CROP_LEEK,
  CROP_POTATO,
  CROP_ONION,
  // Phase 31 (T-31.04). Sixteen sheets, appended to the manifest in one batch
  // by T-31.02 — see `docs/crop-sheets.md` for the measurement behind each.
  CROP_PARSNIP,
  CROP_CARROT,
  CROP_RICE,
  CROP_ASPARAGUS,
  CROP_BROCCOLI,
  CROP_CAULIFLOWER,
  CROP_CABBAGE,
  type SheetSpec,
} from './assets.js';

/**
 * Crop definitions. Read by the client for DISPLAY ONLY and by the server for
 * AUTHORITATIVE calculation — they must never diverge (CLAUDE.md §4.4).
 *
 * All durations are integer milliseconds. All prices are integer gold
 * (CLAUDE.md §10 — no floats for currency, ever).
 *
 * **Sheet and frame numbers are measured art (T-7.08).** Each crop has its
 * OWN new-pack sheet (`CROP_POTATO` etc., 8 frames of 16x16, T-7.04). All
 * four crop strips share the same measured layout — confirmed both by
 * grid-overlay inspection at 16x zoom and by summing each frame's alpha
 * channel (`assets.ts`'s crop-section comment has the numbers): frames 0-5
 * are the six growth stages (frame 0 is the just-planted look), frame 6 is
 * fully transparent on every crop (unused), and frame 7 is the harvested
 * produce icon. Potato does NOT have a seventh stage in the new pack —
 * that was true of the old pack this replaced, not this one.
 *
 * The sheet has no seed-packet frame. Frame 0 used to stand in for one, which
 * made the inventory icon identical to the sprout it becomes; T-16.01 moved
 * the icon to `ICON_SEED_BAGS` and left frame 0 doing only its real job.
 */

export const CropId = {
  STRAWBERRY: 'strawberry',
  LEEK: 'leek',
  POTATO: 'potato',
  ONION: 'onion',
  /*
   * Phase 31 (T-31.04), in growth-duration order — which is roughly the order
   * a player meets them once T-31.06 gates the shop by farm level.
   */
  PARSNIP: 'parsnip',
  CARROT: 'carrot',
  RICE: 'rice',
  ASPARAGUS: 'asparagus',
  BROCCOLI: 'broccoli',
  CAULIFLOWER: 'cauliflower',
  CABBAGE: 'cabbage',
} as const;
export type CropId = (typeof CropId)[keyof typeof CropId];

export interface CropDef {
  readonly id: CropId;
  readonly name: string;
  /** Item granted on harvest. Must exist in items.ts. */
  readonly produceItemId: string;
  /** Item consumed on plant. Must exist in items.ts. */
  readonly seedItemId: string;
  /** Total time from planting to ripe, ms. Integer. */
  readonly growthDurationMs: number;
  /** Units of produce granted per harvest. Integer. */
  readonly yieldAmount: number;
  /** This crop's own sheet (T-7.04: one 8-frame sheet per crop, not a shared row). */
  readonly sheet: SheetSpec;
  /**
   * Frame indices for each growth stage, in order. The LAST entry is the ripe
   * stage. All four crops happen to have six today (T-7.08) — an explicit
   * list rather than a computed range so a future crop can differ.
   */
  readonly stageFrames: readonly number[];
  /** Frame index of the harvested produce icon. */
  readonly produceFrame: number;
  /**
   * Frame index of this crop's just-planted look, on THIS crop's own sheet.
   *
   * Note this is the same number as `stageFrames[0]` for every crop today and
   * that is not a redundancy — it names the stage the plot shows the moment a
   * seed goes in, which a future crop could give a distinct frame. It is NOT
   * the inventory icon; see `seedBagFrame`.
   */
  readonly seedFrame: number;
  /**
   * Frame index into `ICON_ALL_CROPS` — the INVENTORY icon for this crop's
   * seed item.
   *
   * Deliberately a different sheet from `seedFrame`. Before T-16.01 the seed
   * item borrowed `seedFrame`, so the packet in your hotbar was pixel-identical
   * to the sprout it turns into; you could not tell a bag of potato seeds from
   * a potato plant at stage 0.
   *
   * **One bag per crop, at last.** T-16.01 pointed these at `Bags.png`, which
   * holds seven sacks — fine for four crops, and by T-31.04 twenty crops were
   * sharing them, which forced the "every crop takes a distinct bag" invariant
   * to be relaxed. `All Crops.png` has a bag drawn for every crop, in its own
   * colours, so the invariant is back.
   *
   * Measured, not typed: the sheet's produce column is byte-identical to frame
   * 7 of each crop's own strip, so the crop-to-row mapping is derived by
   * hashing rather than maintained by hand. See `docs/art-measurements.md`.
   */
  readonly seedBagFrame: number;
  /**
   * The seasons this crop grows in (T-31.03).
   *
   * **Nothing reads it yet** — Phase 35 does. It is here a phase early because
   * adding a required field to a twenty-crop table later means re-touching
   * every entry and every test, and re-deciding each crop's season
   * retroactively. See `season.ts` for the whole argument, including why
   * winter exists in the type with no crops in it.
   *
   * Non-empty by invariant (`crops.test.ts`): a crop that grows in no season
   * is a crop that can never be planted, which is a config mistake rather than
   * a design.
   */
  readonly seasons: readonly Season[];
  /**
   * The farm level at which the merchant starts stocking this crop's seed
   * (T-31.06). 1 means "from the first minute".
   *
   * **This is the first thing in the game farm level is SPENT on.** Until now
   * it was earned, shown (T-30.02) and read for exactly one purpose — the
   * trade gate (`TRADE_MIN_FARM_LEVEL`, §6). That makes this a change with a
   * security shadow as well as a design one: the shop is now a second reason
   * to want levels, and `config/level.ts` is explicit that XP must stay bought
   * with time rather than gold, or a funded account mints eligible alts.
   * Gating the shop does not create an XP source, so it does not weaken that —
   * but anything that later *pays* XP for shopping would.
   *
   * **The gate is on BUYING, never on planting.** A milestone can hand a
   * level-1 player potato seeds (`first_yield` does), and a seed you hold and
   * cannot sow would be a reward that reads as a bug.
   */
  readonly unlockLevel: number;
}

/**
 * `stageFrames`/`seedFrame`/`produceFrame` are measured indices into each
 * crop's own sheet (T-7.08) — see the module doc comment above for how they
 * were measured. All four crops share the same layout: frames 0-5 are the
 * six growth stages, frame 7 is produce.
 *
 * `seedBagFrame` is the exception: it indexes `ICON_ALL_CROPS`, the pack's
 * per-crop seed-bag sheet, not the crop's own sheet.
 */
export const CROPS: Readonly<Record<CropId, CropDef>> = {
  [CropId.STRAWBERRY]: {
    id: CropId.STRAWBERRY,
    name: 'Strawberry',
    produceItemId: 'strawberry',
    seedItemId: 'strawberry_seeds',
    growthDurationMs: 4 * HOUR,
    yieldAmount: 2,
    sheet: CROP_STRAWBERRY,
    stageFrames: [0, 1, 2, 3, 4, 5],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 52,
    seasons: [Season.SPRING],
    unlockLevel: 3,
  },
  [CropId.LEEK]: {
    id: CropId.LEEK,
    name: 'Leek',
    produceItemId: 'leek',
    seedItemId: 'leek_seeds',
    growthDurationMs: 45 * MINUTE,
    yieldAmount: 1,
    sheet: CROP_LEEK,
    stageFrames: [0, 1, 2, 3, 4, 5],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 78,
    seasons: [Season.SPRING],
    unlockLevel: 1,
  },
  [CropId.POTATO]: {
    id: CropId.POTATO,
    name: 'Potato',
    produceItemId: 'potato',
    seedItemId: 'potato_seeds',
    growthDurationMs: 2 * HOUR,
    yieldAmount: 1,
    sheet: CROP_POTATO,
    stageFrames: [0, 1, 2, 3, 4, 5],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 104,
    seasons: [Season.SPRING],
    unlockLevel: 1,
  },
  [CropId.ONION]: {
    id: CropId.ONION,
    name: 'Onion',
    produceItemId: 'onion',
    seedItemId: 'onion_seeds',
    growthDurationMs: 8 * HOUR,
    yieldAmount: 3,
    sheet: CROP_ONION,
    stageFrames: [0, 1, 2, 3, 4, 5],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 130,
    seasons: [Season.SPRING],
    unlockLevel: 7,
  },

  [CropId.PARSNIP]: {
    id: CropId.PARSNIP,
    name: 'Parsnip',
    produceItemId: 'parsnip',
    seedItemId: 'parsnip_seeds',
    growthDurationMs: 12 * MINUTE,
    yieldAmount: 1,
    sheet: CROP_PARSNIP,
    stageFrames: [0, 1, 2, 3, 4],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 208,
    seasons: [Season.SPRING],
    unlockLevel: 1,
  },
  [CropId.CARROT]: {
    id: CropId.CARROT,
    name: 'Carrot',
    produceItemId: 'carrot',
    seedItemId: 'carrot_seeds',
    growthDurationMs: 30 * MINUTE,
    yieldAmount: 1,
    sheet: CROP_CARROT,
    stageFrames: [0, 1, 2, 3, 4, 5],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 156,
    seasons: [Season.SPRING],
    unlockLevel: 1,
  },
  [CropId.RICE]: {
    id: CropId.RICE,
    name: 'Rice',
    produceItemId: 'rice',
    seedItemId: 'rice_seeds',
    growthDurationMs: 1 * HOUR,
    yieldAmount: 2,
    sheet: CROP_RICE,
    stageFrames: [0, 1, 2, 3, 4, 5],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 286,
    seasons: [Season.SPRING],
    unlockLevel: 1,
  },
  [CropId.ASPARAGUS]: {
    id: CropId.ASPARAGUS,
    name: 'Asparagus',
    produceItemId: 'asparagus',
    seedItemId: 'asparagus_seeds',
    growthDurationMs: 150 * MINUTE,
    yieldAmount: 2,
    sheet: CROP_ASPARAGUS,
    stageFrames: [0, 1, 2, 3, 4],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 338,
    seasons: [Season.SPRING],
    unlockLevel: 2,
  },
  [CropId.BROCCOLI]: {
    id: CropId.BROCCOLI,
    name: 'Broccoli',
    produceItemId: 'broccoli',
    seedItemId: 'broccoli_seeds',
    growthDurationMs: 3 * HOUR,
    yieldAmount: 1,
    sheet: CROP_BROCCOLI,
    stageFrames: [0, 1, 2, 3, 4],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 312,
    seasons: [Season.SPRING],
    unlockLevel: 2,
  },
  [CropId.CAULIFLOWER]: {
    id: CropId.CAULIFLOWER,
    name: 'Cauliflower',
    produceItemId: 'cauliflower',
    seedItemId: 'cauliflower_seeds',
    growthDurationMs: 6 * HOUR,
    yieldAmount: 1,
    sheet: CROP_CAULIFLOWER,
    stageFrames: [0, 1, 2, 3, 4, 5],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 260,
    seasons: [Season.SPRING],
    unlockLevel: 5,
  },
  [CropId.CABBAGE]: {
    id: CropId.CABBAGE,
    name: 'Cabbage',
    produceItemId: 'cabbage',
    seedItemId: 'cabbage_seeds',
    growthDurationMs: 10 * HOUR,
    yieldAmount: 1,
    sheet: CROP_CABBAGE,
    stageFrames: [0, 1, 2, 3, 4, 5, 6],
    produceFrame: 7,
    seedFrame: 0,
    seedBagFrame: 234,
    seasons: [Season.SPRING],
    unlockLevel: 9,
  },
};

export const CROP_IDS = Object.keys(CROPS) as CropId[];

export function isCropId(v: string): v is CropId {
  return Object.prototype.hasOwnProperty.call(CROPS, v);
}

/**
 * Which crop a seed item plants, or null if the item is not a seed.
 *
 * The mapping already exists in `CROPS[*].seedItemId`; this is the same fact
 * read the other way, built once instead of scanning the table at every call
 * site. Config, not client logic (§4.4) — the hotbar needs it to turn "a stack
 * of leek seeds is equipped" into a plant intent, and anything server-side that
 * ever has to answer the same question must get the same answer.
 */
const CROP_BY_SEED: ReadonlyMap<string, CropId> = new Map(
  (Object.keys(CROPS) as CropId[]).map((id) => [CROPS[id].seedItemId, id]),
);

export function cropForSeed(itemId: string): CropId | null {
  return CROP_BY_SEED.get(itemId) ?? null;
}

/**
 * The farm level a seed item needs before the merchant will sell it, or `null`
 * if the item is not a seed (T-31.06).
 *
 * Shared rather than server-only, and that is the §4.1 shape: the SERVER
 * refuses an under-level purchase, and the client reads the same number only
 * to explain the dead button. Two copies of this rule would eventually
 * disagree, and the one that disagrees visibly is the client offering a Buy
 * the server will always refuse — which is the exact defect T-25.02 fixed for
 * VIP decoration.
 */
export function unlockLevelForSeed(itemId: string): number | null {
  const crop = cropForSeed(itemId);
  return crop === null ? null : CROPS[crop].unlockLevel;
}

/**
 * The lowest level at which anything can be sown.
 *
 * Derived rather than declared so "level 1 still has enough to do" is a
 * property of the table instead of a promise in a comment — `config.test.ts`
 * asserts against this, and a retune that accidentally locked every crop would
 * fail there rather than at a new player's first shop visit.
 */
export const MIN_CROP_UNLOCK_LEVEL = Math.min(
  ...(Object.keys(CROPS) as CropId[]).map((id) => CROPS[id].unlockLevel),
);

/**
 * D-1 — DECIDED: watering is REQUIRED (CLAUDE.md §5.2).
 *
 * A crop grows only while its soil is wet, and pauses when it dries out. It
 * never dies of drought — the idle-first pillar means an absence costs time,
 * not a harvest.
 *
 * **Live since T-9.03b**, the task that added `POST /api/farm/water`. The
 * constant survives the flip as a one-line revert: `effectiveGrowthMs` is the
 * single place that reads it, so setting it back to `false` restores v1's
 * `now - plantedAt` growth exactly, with no other code path to unwind. Both
 * branches are tested (`growth.watering.test.ts` for this one,
 * `growth.test.ts` for the fallback), which is what makes the revert safe
 * rather than merely available.
 */
export const WATERING_ENABLED = true;

/**
 * How long one watering keeps the soil wet.
 *
 * Four hours is chosen against the crop table, not picked round. Leek (45m),
 * potato (2h) and strawberry (4h) all ripen inside a single window, so the
 * early crops never gate a harvest behind a second visit; onion (8h) needs
 * exactly two, which is what makes the long crop feel long. It is also
 * comfortably longer than a session, which is what keeps this idle-first:
 * water, leave, come back.
 */
export const WATER_DURATION_MS = 4 * HOUR;

/**
 * OPEN DECISION (CLAUDE.md §14) — withering is not implemented.
 *
 * Ripe crops currently sit in their plot indefinitely, which is the behaviour
 * the idle-first pillar implies. `witheredAt` exists as a nullable column so
 * this can be switched on later without a data migration.
 */
export const WITHERING_ENABLED = false;
