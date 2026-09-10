import { cropForSeed } from '@tillhaven/shared/config';
import type { PlotView } from '@tillhaven/shared/types';
import { displayAt } from './plots.js';

/**
 * The one line telling a new player what to do next (T-18.17, F-5).
 *
 * **The action key is never named anywhere in the game.** A new account lands
 * on a farm holding a hoe, with a hotbar, a highlighted tile in front of them
 * and no indication that any of it does anything. Every mechanic this project
 * has built — the faced tile, the four verbs, the watering requirement that
 * D-1 made the loop turn on — is reachable only by pressing a key nobody has
 * mentioned.
 *
 * **Derived from farm state, with nothing persisted.** This is the whole design
 * decision. A scripted tutorial needs a cursor — "step 3 of 5" — which needs
 * storage, which needs to survive a reload, a second device and a player who
 * does things out of order. Reading the farm instead means the hint is always
 * *true*: it says "water" because something is dry, not because a counter says
 * the player has not been told about watering yet. Skip a step, do them
 * backwards, come back a week later — it still says the right thing, and there
 * is no state to migrate, reset or get wrong.
 *
 * It also ends by itself. Once any plot has been harvested the player has been
 * round the loop, so the hint has nothing left to teach and stops appearing —
 * without a "don't show this again" checkbox, and without ever having stored
 * that they ticked it.
 *
 * Pure and Phaser-free like `plots.ts` and `actions.ts` beside it: which
 * sentence to show is a decision table, and a decision table is worth asserting
 * without a canvas.
 */

export type OnboardingStep = 'till' | 'plant' | 'water' | 'harvest' | 'buy_seeds' | 'growing';

/**
 * The only thing this needs from a bag slot.
 *
 * Structural rather than the shared `InventorySlot` — it reads two fields and
 * asking for exactly those keeps it usable by anything slot-shaped, including
 * the tests, without a fixture carrying a `slotIndex` that means nothing here.
 *
 * It was structural for a worse reason until T-18.26: the client and shared
 * declarations of `InventorySlot` genuinely disagreed (`slotIndex` versus
 * `index`), so naming either one would have picked a side. They are one
 * declaration now, and this stays structural because it wants to be.
 */
export interface SeedBearingSlot {
  readonly itemId: string;
  readonly quantity: number;
}

export interface OnboardingState {
  readonly plots: readonly PlotView[];
  readonly slots: readonly SeedBearingSlot[];
  /** The poll's server clock, for `displayAt`. */
  readonly serverNow: number;
  readonly now: number;
}

/**
 * What the player should do next, or `null` when they have done the loop.
 *
 * **Ordered by what is most urgent on the farm, not by what a tutorial script
 * would say next.** A ripe crop outranks dry soil which outranks bare ground,
 * because that is the order the farm itself would want attention in — and
 * because a player who has somehow ended up with a ripe crop before ever
 * seeing the "till" hint should be told to pick it, not sent back to the
 * beginning.
 */
export function nextStep(state: OnboardingState): OnboardingStep | null {
  const { plots, slots, serverNow, now } = state;

  /*
   * The exit. One harvest is the whole loop — till, plant, water, pick — so a
   * player who has done it once needs no more prompting, and the hint is gone
   * for good without anything having been written down.
   */
  if (plots.some((p) => p.harvestedAt !== null)) return null;

  const unlocked = plots.filter((p) => p.unlocked);
  if (unlocked.length === 0) return null;

  const displays = unlocked.map((p) => ({ plot: p, view: displayAt(p, serverNow, now) }));

  if (displays.some(({ view }) => view.isRipe)) return 'harvest';
  if (displays.some(({ view }) => view.isPaused)) return 'water';

  const tilledEmpty = unlocked.some((p) => p.tilled && p.cropId === null);
  if (tilledEmpty) {
    // Told to plant with nothing to plant is a dead end, and a new farm can
    // reach it by sowing all four leeks and both potatoes before harvesting.
    return hasSeeds(slots) ? 'plant' : 'buy_seeds';
  }

  if (unlocked.some((p) => !p.tilled)) return 'till';

  /*
   * Everything is planted, watered and growing — and this is F-1's "nothing to
   * do", reached about three minutes into a first session (T-18.18).
   *
   * A hint saying "wait" would be noise; a hint saying **why** waiting is the
   * game is not. This is an idle game (§1: "sessions are short and frequent,
   * not long and grindy"), so a first-timer standing on a fully planted farm
   * with nothing happening has not hit a dead end — they have hit the design,
   * and nothing anywhere told them so. The one moment worth spending a
   * sentence on is the moment the player would otherwise close the tab.
   *
   * It is still not shown after a first harvest, like every other step: this is
   * for the player who does not yet know the game keeps running without them.
   */
  return 'growing';
}

function hasSeeds(slots: readonly SeedBearingSlot[]): boolean {
  return slots.some((slot) => slot.quantity > 0 && cropForSeed(slot.itemId) !== null);
}

/**
 * The sentence for a step.
 *
 * **Every one of them names a key**, which is the entire point of F-5: the
 * player is not short of motivation, they are short of the fact that `E` exists.
 * The tools are named by their hotbar position as well as their name, because
 * "the watering can" is only findable if you already know the strip along the
 * bottom is your bag.
 */
export const STEP_TEXT: Readonly<Record<OnboardingStep, string>> = {
  till: 'Walk with WASD. Face a plot and press E to break the soil with your hoe.',
  plant: 'Pick seeds from the hotbar with the number keys, then press E on tilled soil.',
  water: 'Crops only grow while the soil is wet — take the watering can and press E.',
  harvest: 'That crop is ready. Empty your hands and press E to pick it.',
  buy_seeds: 'Out of seeds. Press E at the market stall on the path to buy more.',
  growing: 'All planted. Crops keep growing while you are away — close the tab, or press Idle to let your farmer work.',
};
