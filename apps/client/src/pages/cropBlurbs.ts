import type { CropId } from '@tillhaven/shared/config';

/**
 * Split out of `landing.ts` so it can be tested (T-31.06).
 *
 * `landing.ts` calls `mount()` at module scope and reaches straight for
 * `document`, so importing it from a test means standing up a DOM to assert a
 * four-entry object. This module is data and a type import, nothing else.
 */

/**
 * The crops the landing page shows, and the copy for each.
 *
 * **A curated four, not the whole table** (T-31.04). `CROPS` went from four
 * entries to twenty, and this page is a shop window rather than an inventory:
 * twenty cards under "Four crops to start the season" would be a wall, and
 * writing sixteen more pieces of marketing copy is not what a config change
 * should drag in.
 *
 * **All four must be level-1 stock** (T-31.06), and that rule cost this list
 * two entries. Strawberry and onion were here from the start and are now
 * gated behind farm levels 3 and 7 — advertising them under "Four crops to
 * start the season" would have been selling something a new account cannot
 * buy. Parsnip and carrot replace them.
 *
 * `Partial` is deliberate: a new crop must NOT be required to arrive with
 * marketing copy, and `buildCrops` iterates this object rather than `CROP_IDS`
 * so an unblurbed crop is simply absent instead of rendering an empty card.
 */
export const CROP_BLURBS: Readonly<Partial<Record<CropId, string>>> = {
  parsnip: 'The one you start with. Twelve minutes from seed to harvest, so the whole loop closes before you close the tab.',
  carrot: 'Half an hour in the ground. The first crop you buy rather than the one you were given.',
  leek: 'Turns over inside a lunch break and pays for the next handful of seeds.',
  potato: 'Plant a tray in the morning and it is done by mid-afternoon. The reliable middle of the season.',
};
