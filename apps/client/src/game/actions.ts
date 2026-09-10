import { ANIMALS, ITEMS, ToolKind, cropForSeed, type CropId } from '@tillhaven/shared/config';
import type { AnimalView, PlotView } from '@tillhaven/shared/types';
import type { NpcId, TreeView } from '@tillhaven/shared/config';

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

/**
 * A one-shot character animation an action plays.
 *
 * These are `CharAnimKey`s verbatim (T-16.02), not a private vocabulary that
 * then needs translating. Before T-16.02 this was the pair `'hoe' | 'water'`
 * and `Player.playToolAnimation` mapped `'water'` to the animation actually
 * called `watering` — a two-value lookup that existed only because the two
 * names had drifted. Naming the animation directly deletes the mapping and the
 * chance of it going stale as more verbs get strips.
 */
export type Swing = 'hoe' | 'watering' | 'plant' | 'harvest' | 'pet' | 'axe';

export type FarmIntent =
  | { readonly kind: 'till'; readonly plotId: string }
  | { readonly kind: 'plant'; readonly plotId: string; readonly cropId: CropId }
  | { readonly kind: 'water'; readonly plotId: string }
  | { readonly kind: 'harvest'; readonly plotId: string }
  /*
   * Chopping (T-20.04). The odd one out in this union: it carries a `treeId`,
   * not a `plotId`. Kept here rather than beside `AnimalIntent` because it is a
   * TOOL SWING on the faced tile — same shape, same swing pipeline, same
   * `send` path — and the scene branches on the id field it needs anyway.
   */
  | { readonly kind: 'chop'; readonly treeId: string };

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
  readonly what: 'chest' | 'shipping' | 'shop' | 'trade';
};

/**
 * Starting a conversation (T-33.03).
 *
 * Its own kind rather than a fifth `OpenIntent.what`, for the same reason
 * `enter` is: `open` means "show a panel about something the player owns", and
 * this is a thing in the WORLD answering. It also carries which villager, which
 * no `what` string could.
 */
export type TalkIntent = {
  readonly kind: 'talk';
  readonly npc: NpcId;
};

/**
 * Stepping through the farmhouse door (T-16.11, D-7).
 *
 * Its own kind rather than a fourth `OpenIntent.what`, because it is not a
 * panel: `open` means "show some DOM over the farm", and this swaps the scene.
 * `Farm.act()` has to tell them apart, and a discriminated union is how the
 * rest of this file makes that impossible to get wrong.
 *
 * Nothing is sent. The server has no concept of which room a player is in and
 * must not — position is cosmetic (§4.1), so "I am indoors" is not a claim it
 * could check or would ever need to.
 */
export type EnterIntent = {
  readonly kind: 'enter';
  readonly what: 'house';
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
  | EnterIntent
  | TalkIntent
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
  | { readonly kind: 'merchant' }
  /*
   * A villager with no counter to stand behind (T-33.03).
   *
   * The merchant is deliberately NOT this: facing the vendor and facing their
   * stall mean the same thing there, so the stall's arm covers both. The Chef
   * has no stall, so the character is the target.
   */
  | { readonly kind: 'villager'; readonly npc: NpcId }
  | { readonly kind: 'mailbox' }
  | { readonly kind: 'door' }
  | { readonly kind: 'tree'; readonly view: TreeView };

/**
 * Which swing to play for a farm intent. **Total since T-16.02** — every verb
 * now has one.
 *
 * It was not before: T-8.09 wired the only two strips that had been copied into
 * the pipeline, and recorded planting and harvesting as having no animation
 * because "a wrong-looking swing is worse than none". That reasoning was sound
 * and its premise was wrong — the pack ships ~45 animation folders, and
 * `6. Shovel`, `13.3 Carrying - Pick Up` and `20. Petting` are a crouch-place,
 * a bend-and-lift and a kneel-and-reach respectively. Nothing had looked.
 */
export function swingFor(intent: FarmIntent): Swing {
  return swingForKind(intent.kind);
}

/**
 * The same question asked of a bare verb.
 *
 * Idle replay (T-13.07) has a task from the server, not an intent it built, and
 * `IdleTask`'s four values are these four verbs — so it asks here rather than
 * assembling a fake intent or keeping a second copy of "which verbs have a
 * strip". One list, and it is this one. A consequence worth naming: making this
 * total also made the autonomous farmer plant and harvest visibly, with no
 * change to the replay code at all.
 *
 * A `switch` with no `default`, deliberately: adding a fifth verb to
 * `FarmIntent` then fails to compile here, rather than silently returning
 * undefined into `anims.play`, which does nothing and logs nothing (T-8.04).
 */
export function swingForKind(kind: FarmIntent['kind']): Swing {
  switch (kind) {
    case 'till':
      return 'hoe';
    case 'water':
      return 'watering';
    case 'plant':
      return 'plant';
    case 'harvest':
      return 'harvest';
    case 'chop':
      return 'axe';
  }
}

/**
 * The swing an animal action plays.
 *
 * Collecting and feeding both kneel — `20. Petting` is the same gesture either
 * way, and the pack has nothing that distinguishes taking an egg from putting
 * feed down. Inventing a distinction the art cannot draw is exactly the
 * "wrong-looking animation" T-8.09 was right to avoid.
 */
export const ANIMAL_SWING = 'pet' as const;

/**
 * True when the equipped item is a TOOL, which is what "by hand" really means
 * (T-18.06, BUG-08).
 *
 * Both hand actions — harvesting a crop, collecting from an animal — used to
 * test `held !== null`. That reads correctly and is wrong for a reason nothing
 * in the decision matrix could see: **the produce lands in the first free
 * backpack slot, and the first free slot is routinely the equipped one.** So
 * picking a potato into an empty hotbar slot puts a potato in your hand, and
 * the next plot in the row refuses with *"Empty your hands to harvest by
 * hand."* Harvesting a row meant cycling the hotbar between plots.
 *
 * The rule the player actually experiences is "you cannot pick with a hoe in
 * your fist", not "your hands must be empty" — and a hand full of the crop you
 * just picked is exactly the state harvesting produces. Asked of `toolKind`
 * rather than `category`, so the eight tiers D-4 will add are covered the day
 * they are declared and a future axe or pickaxe is covered by declaring its
 * kind.
 */
export function holdingTool(held: Held | null): boolean {
  return held !== null && ITEMS[held.itemId]?.toolKind !== undefined;
}

/**
 * Facing an animal (T-12.03).
 *
 * **What is in hand decides which of the two things happens**, exactly as it
 * does on a plot: the right feed feeds, anything else collects. That is a
 * deliberate change from the click path this replaced, where one click meant
 * "collect if you can, otherwise feed" and the player never chose. Feeding is a
 * purchase being spent, and spending it should take saying so.
 *
 * The feed has to be the RIGHT feed. The server derives which item to consume
 * from the animal's kind, so holding hay at a chicken would silently eat
 * chicken feed instead — the gate is here so the mismatch is a sentence rather
 * than a surprise.
 *
 * **"Anything else collects" was "an empty hand collects" until T-18.06.** The
 * stricter rule broke on its own output: the egg goes into the first free
 * backpack slot, which is routinely the equipped one, so collecting from one
 * chicken refused the next. Only a tool blocks a hand action now — see
 * `holdingTool`.
 *
 * A baby can be fed and cannot be collected from, which is not a special case:
 * it falls out of `hasProduce` being false and feeding being its own branch.
 */
function animalAction(held: Held | null, view: AnimalView): Dispatch {
  const def = ANIMALS[view.kind];
  // A kind config no longer knows about: refuse rather than throw. The sprite
  // is on screen because the server sent it, so the player is owed a message.
  if (!def) return refuse('That animal is not one this farm knows about.');

  if (held?.itemId === def.feedItemId) {
    if (view.isFed) return refuse(`Your ${def.name.toLowerCase()} is not hungry.`);
    return { kind: 'feed', animalId: view.id };
  }

  const feedName = ITEMS[def.feedItemId]?.name ?? def.feedItemId;

  /*
   * A tool in hand is the only thing that stops you collecting (T-18.06).
   *
   * This branch used to refuse EVERY held item, and it had BUG-08 in it for the
   * same reason the plot branch did: the egg lands in the first free backpack
   * slot, which is routinely the equipped one, so collecting from the first
   * chicken made the second refuse. A coop is a row of animals in exactly the
   * way a field is a row of plots.
   *
   * The "hold the right feed" rule (T-12.03) is untouched and is the branch
   * above: feeding spends a purchase, so it still takes saying so. What has
   * gone is the claim that holding *anything* means you did not mean to
   * collect.
   */
  if (holdingTool(held)) {
    return refuse(`Put your tool away to collect, or hold ${feedName} to feed it.`);
  }

  if (view.hasProduce) return { kind: 'collect', animalId: view.id };
  if (!view.isMature) return refuse('Still growing.');

  /*
   * Nothing to collect, and it is hungry. Naming the food beats "wrong item":
   * the shop sells both and the two bags look alike in a hotbar slot. This is
   * where hay-at-a-chicken lands, which is the mix-up the server cannot catch
   * — it derives the feed from the animal's KIND, so hay at a chicken would
   * quietly consume chicken feed.
   */
  if (!view.isFed) return refuse(`Hungry. Hold ${feedName} to feed it.`);
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
/**
 * What the action key does at a tree (T-20.04).
 *
 * **The axe check here is a UX gate, not authority.** `chop` on the server looks
 * the axe up in the player's own inventory and refuses with `TOOL_REQUIRED`
 * regardless of what this decides (§4.1, §5.1) — the point of checking twice is
 * that the player finds out by reading a sentence rather than by watching a
 * swing play and then get taken back.
 *
 * A stump refuses rather than doing nothing, for the same reason a locked plot
 * does: "nothing happened" is the one outcome the player cannot debug.
 */
function treeAction(held: Held | null, view: TreeView): Dispatch {
  if (!view.isStanding) return refuse('That tree is still growing back.');

  // What the item IS, from config, never from its id — so D-4's eight axe
  // tiers work the day they are declared.
  const item = held ? ITEMS[held.itemId] : undefined;
  if (item?.toolKind !== ToolKind.AXE) return refuse('You need an axe to chop that.');

  return { kind: 'chop', treeId: view.id };
}

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
  /*
   * A villager answers whatever is in hand, like every panel above. Refusing to
   * talk to somebody while holding a watering can would be a rule with nothing
   * behind it.
   */
  if (target.kind === 'villager') return { kind: 'talk', npc: target.npc };
  /*
   * The mailbox is the trade post (D-21, T-22.01). It opens whatever is in
   * hand, like the other three: the panel is a view of trades you are already
   * in, not an action on the world.
   */
  if (target.kind === 'mailbox') return { kind: 'open', what: 'trade' };
  /*
   * The mailbox is the trade post (D-21, T-22.01). It opens whatever is in
   * hand, like the other three: the panel is a view of trades you are already
   * in, not an action on the world.
   */


  /*
   * The door opens whatever is in hand too, and that is worth stating: a rule
   * like "put your hoe away before going indoors" would be a rule with nothing
   * behind it, and the player would meet it while standing on their own porch
   * wondering what they did wrong.
   */
  if (target.kind === 'door') return { kind: 'enter', what: 'house' };

  if (target.kind === 'animal') return animalAction(held, target.view);
  if (target.kind === 'tree') return treeAction(held, target.view);

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
    // Only a TOOL blocks picking (T-18.06). Holding the last potato must not
    // refuse the next one — see `holdingTool`. The two tool kinds are already
    // answered above, so this catches only kinds declared later.
    if (holdingTool(held)) return refuse('Put your tool away to harvest by hand.');
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
