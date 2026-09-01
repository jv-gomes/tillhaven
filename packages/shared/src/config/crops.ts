import { HOUR, MINUTE } from './time.js';
import { CROP_STRAWBERRY, CROP_LEEK, CROP_POTATO, CROP_ONION, type SheetSpec } from './assets.js';

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
 * are the six growth stages (frame 0 is the just-planted look, and doubles
 * as the seed-packet icon — the sheet has no separate one), frame 6 is
 * fully transparent on every crop (unused), and frame 7 is the harvested
 * produce icon. Potato does NOT have a seventh stage in the new pack —
 * that was true of the old pack this replaced, not this one.
 */

export const CropId = {
  STRAWBERRY: 'strawberry',
  LEEK: 'leek',
  POTATO: 'potato',
  ONION: 'onion',
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
  /** Frame index of the seed packet icon. */
  readonly seedFrame: number;
}

/**
 * `stageFrames`/`seedFrame`/`produceFrame` are measured indices into each
 * crop's own sheet (T-7.08) — see the module doc comment above for how they
 * were measured. All four crops share the same layout: frames 0-5 are the
 * six growth stages, frame 0 doubles as the seed icon, frame 7 is produce.
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
