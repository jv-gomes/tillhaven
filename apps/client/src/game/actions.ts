import { ANIMALS, ITEMS, ToolKind, cropForSeed, type CropId } from '@tillhaven/shared/config';
import type { AnimalView, PlotView } from '@tillhaven/shared/types';

/**
 * What the action key does, decided from the equipped item and the faced tile
 * (T-9.06, CLAUDE.md §5.2).
 *
 * Pure, and separate from the scene for the reason `targeting.ts` and
 * `movement.ts` are: this is a matrix of item × plot state, and every cell of
 * it is one assertion here versus a canvas to drive and a network to stub.
 *
 * **This decides what to SEND, never what happens.** Every branch below is a
 * client-side UX gate (§5.1): it saves a doomed round trip and gives the player
 * a reason, and the server re-checks ownership and plot state on its own terms
 * and can still say no. Nothing here may be trusted by anything.
 */

export type FarmIntent =
  | { readonly kind: 'till'; readonly plotId: string }
  | { readonly kind: 'plant'; readonly plotId: string; readonly cropId: CropId }
  | { readonly kind: 'water'; readonly plotId: string }
  | { readonly kind: 'harvest'; readonly plotId: string };

/**
 * Working an animal the character is standing at (T-12.03).
 *
 * Kept separate from `FarmIntent` because it addresses an animal rather than a
 * plot — every plot intent carries a `plotId` and the scene's `send` leans on
 * that. Same rules otherwise: the server re-checks ownership, maturity, feed
 * state and produce on its own terms, so nothing decided here is trusted.
 */
export type AnimalIntent =
  | { readonly kind: 'collect'; readonly animalId: string }
  | { readonly kind: 'feed'; readonly animalId: string };

/**
 * Opening something the character is standing at (T-10.05, T-11.03, T-11.04).
 *
 * Not a `FarmIntent`: nothing is sent, nothing is validated, and the server
 * never hears about it. Opening a chest, the shipping box or the merchant's
 * stall is the client showing a panel — what is IN them, and what a purchase
 * costs, is already guarded on its own terms by the inventory, shipping and
 * shop endpoints, so standing next to one is UX, not permission (§5.1).
 */
export type OpenIntent = {
  readonly kind: 'open';
  readonly what: 'chest' | 'shipping' | 'shop';
};

/**
 * The four answers.
 *
 * `nothing` is deliberately distinct from `refused`: the character faces empty
 * grass most of the time it is moving, so a message on every press there would
 * teach the player to ignore messages. A message is worth showing when there IS
 * something in front of them and it cannot be worked — that is the case where
 * they are trying something and want to know why it did not happen.
 */
export type Dispatch =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'refused'; readonly message: string }
  | OpenIntent
  | FarmIntent
  | AnimalIntent;

/** Narrows a dispatch to the two intents that address an animal. */
export function isAnimalIntent(dispatch: Dispatch): dispatch is AnimalIntent {
  return dispatch.kind === 'collect' || dispatch.kind === 'feed';
}

const NOTHING: Dispatch = { kind: 'nothing' };

function refuse(message: string): Dispatch {
  return { kind: 'refused', message };
}

/** What the player is holding, as far as this decision is concerned. */
export interface Held {
  readonly itemId: string;
}

/**
 * What the character is facing: a plot, the chest, or nothing.
 *
 * A union rather than a plot plus some flags, because the faced tile is exactly
 * one thing. Two independent parameters would make "a plot that is also the
 * chest" expressible, and then every caller has to decide which wins.
 *
 * On the plot arm, `isRipe` comes in separately rather than being read off the
 * view: between polls the client draws ripeness from its own interpolation
 * (`displayAt`), and the gate has to agree with what the player can see —
 * otherwise a crop that has visibly finished refuses to be picked for up to
 * twenty seconds.
 */
export type Target =
  | { readonly kind: 'plot'; readonly view: PlotView; readonly isRipe: boolean }
  | { readonly kind: 'animal'; readonly view: AnimalView }
  | { readonly kind: 'chest' }
  | { readonly kind: 'shipping' }
  | { readonly kind: 'merchant' };

/**
 * Which tool swing to play, if any.
 *
 * Planting and harvesting have no animation: the pack ships hoe and watering
 * strips and nothing for kneeling or picking (T-8.09 measured what exists), and
 * a wrong-looking swing is worse than none.
 */
export function swingFor(intent: FarmIntent): 'hoe' | 'water' | null {
  return swingForKind(intent.kind);
}

/**
 * The same question asked of a bare verb.
 *
 * Idle replay (T-13.07) has a task from the server, not an intent it built, and
 * `IdleTask`'s four values are these four verbs — so it asks here rather than
 * assembling a fake intent or keeping a second copy of "which verbs have a
 * strip". One list, and it is this one.
 */
export function swingForKind(kind: FarmIntent['kind']): 'hoe' | 'water' | null {
  if (kind === 'till') return 'hoe';
  if (kind === 'water') return 'water';
  return null;
}

/**
 * Facing an animal (T-12.03).
 *
 * **What is in hand decides which of the two things happens**, exactly as it
 * does on a plot: an empty hand collects, the right feed feeds. That is a
 * deliberate change from the click path this replaced, where one click meant
 * "collect if you can, otherwise feed" and the player never chose. Feeding is a
 * purchase being spent, and spending it should take saying so.
 *
 * The feed has to be the RIGHT feed. The server derives which item to consume
 * from the animal's kind, so holding hay at a chicken would silently eat
 * chicken feed instead — the gate is here so the mismatch is a sentence rather
 * than a surprise.
 *
 * A baby can be fed and cannot be collected from, which is not a special case:
 * it falls out of `hasProduce` being false and feeding being its own branch.
 */
function animalAction(held: Held | null, view: AnimalView): Dispatch {
  const def = ANIMALS[view.kind];
  // A kind config no longer knows about: refuse rather than throw. The sprite
  // is on screen because the server sent it, so the player is owed a message.
  if (!def) return refuse('That animal is not one this farm knows about.');

  if (held) {
    if (held.itemId === def.feedItemId) {
      if (view.isFed) return refuse(`Your ${def.name.toLowerCase()} is not hungry.`);
      return { kind: 'feed', animalId: view.id };
    }

    const feedName = ITEMS[def.feedItemId]?.name ?? def.feedItemId;
    // Naming the food they need beats "wrong item": the shop sells both, and
    // the two bags look alike in a hotbar slot.
    return refuse(`Hold ${feedName} to feed it, or empty your hands to collect.`);
  }

  if (view.hasProduce) return { kind: 'collect', animalId: view.id };
  if (!view.isMature) return refuse('Still growing.');
  if (!view.isFed) {
    const feedName = ITEMS[def.feedItemId]?.name ?? def.feedItemId;
    return refuse(`Hungry. Hold ${feedName} to feed it.`);
  }
  return refuse('Nothing ready yet.');
}

/**
 * The whole control scheme, in one function.
 *
 * Order matters: the plot's own state is checked before the item, so a locked
 * plot answers "not cleared yet" whatever is in hand, and an occupied plot says
 * so rather than complaining about the tool. The player's question is always
 * "why did nothing happen", and the most useful answer is the blocking fact
 * closest to them, not the first rule that happens to fail.
 */
export function actionFor(held: Held | null, target: Target | null): Dispatch {
  if (!target) return NOTHING;

  /*
   * Both boxes open whatever is in hand. Refusing while holding a hoe would be
   * a rule with nothing behind it — these panels are views of what the player
   * already owns, not actions on the world.
   */
  if (target.kind === 'chest') return { kind: 'open', what: 'chest' };
  if (target.kind === 'shipping') return { kind: 'open', what: 'shipping' };
  if (target.kind === 'merchant') return { kind: 'open', what: 'shop' };

  if (target.kind === 'animal') return animalAction(held, target.view);

  const { view } = target;
  if (!view.unlocked) return refuse('That plot is not cleared yet.');

  // What the item IS, from config — never inferred from its id, so the eight
  // tool tiers D-4 will add work the day they are declared.
  const item = held ? ITEMS[held.itemId] : undefined;
  const isHoe = item?.toolKind === ToolKind.HOE;
  const isCan = item?.toolKind === ToolKind.WATERING_CAN;
  const seedCrop = held ? cropForSeed(held.itemId) : null;
  const planted = view.cropId !== null && view.plantedAt !== null;

  if (planted) {
    // A crop in the ground answers for the plot: the hoe and a second seed are
    // both refused with the reason the player actually needs to hear.
    if (isCan) return { kind: 'water', plotId: view.id };
    if (isHoe || seedCrop !== null) return refuse('Something is already growing there.');
    if (held !== null) return refuse('Empty your hands to harvest by hand.');
    if (!target.isRipe) return refuse('That is not ready to harvest yet.');
    return { kind: 'harvest', plotId: view.id };
  }

  if (!view.tilled) {
    if (isHoe) return { kind: 'till', plotId: view.id };
    if (seedCrop !== null) return refuse('That soil needs tilling first. Use the hoe.');
    return refuse('Nothing to do there — try the hoe.');
  }

  // Tilled and empty: the one state a seed is for.
  if (seedCrop !== null) return { kind: 'plant', plotId: view.id, cropId: seedCrop };
  if (isHoe) return refuse('That soil is already tilled.');
  return refuse('Nothing growing there. Plant a seed.');
}
