import { CROPS, type CropId } from './crops.js';
import { FISH } from './fish.js';
import type { NpcId } from './dialogue.js';
import { ITEMS } from './items.js';
import { pick, seedFrom } from './rng.js';
import type { MilestoneReward } from './milestones.js';

/**
 * What the villagers ask for (T-33.04, CLAUDE.md §4.4).
 *
 * **Milestones are a checklist; quests are direction.** The board (T-30.09)
 * counts what a player was going to do anyway and pays them for noticing. A
 * quest names a thing to go and *get*, from somebody who wants it — which is the
 * only mechanism in this game that can point at a specific crop.
 *
 * **The reward type is `MilestoneReward`, deliberately reused rather than
 * copied.** `grantReward` in `modules/progression/service.ts` is the single
 * place items and gold move into a player, and its own comment already
 * anticipated this: *"this function is the boundary quests will also come
 * through"*. One faucet, logged once (§5.8). A second reward shape would mean a
 * second grant path, and `docs/economy.md` would have two lists to keep.
 *
 * **Nothing here is authoritative.** The server re-reads this table when it
 * validates a turn-in; the client reads it to draw the board. Neither trusts a
 * quest id the other supplied without looking it up here first.
 */

export interface QuestRequirement {
  readonly itemId: string;
  /** Integer, positive (§10). */
  readonly quantity: number;
}

export interface Quest {
  readonly id: string;
  /** Who wants it. Must be somebody `config/dialogue.ts` can speak for. */
  readonly giver: NpcId;
  readonly title: string;
  /** The ask, in the giver's voice. One line — it renders in the dialogue box. */
  readonly summary: string;
  readonly requires: readonly QuestRequirement[];
  readonly reward: MilestoneReward;
  /**
   * The farm level at which this may be offered.
   *
   * **Not decoration — it is the obtainability guarantee.** `quests.test.ts`
   * checks every required item against what a farm at this level can actually
   * grow, so a quest asking for cabbage cannot be offered to a level-2 player
   * who has no way to buy the seed. T-33.06's board derives its offers from this
   * field, which is what makes "never offered an unreachable request" a property
   * of the data rather than of the board's code.
   */
  readonly unlockLevel: number;
}

/**
 * The farm level at which each produce item becomes obtainable.
 *
 * Derived from `CROPS` rather than restated, so adding a crop cannot leave a
 * quest asking for something no shop will sell the seed for. Items that are not
 * grown — wood, eggs, milk — are reachable from level 1: the axe, the coop and
 * the barn are gated by GOLD, not by level, and a quest that waits on a purchase
 * the player could make at any time is not level-gated in any useful sense.
 */
const PRODUCE_UNLOCK_LEVEL: Readonly<Record<string, number>> = Object.fromEntries(
  Object.values(CROPS).map((crop) => [crop.produceItemId, crop.unlockLevel]),
);

/** Fish carry their own level gate, exactly as crops do. */
const FISH_UNLOCK_LEVEL: Readonly<Record<string, number>> = Object.fromEntries(
  FISH.map((fish) => [fish.id, fish.unlockLevel]),
);

/**
 * Whether this game can currently catch a fish AT ALL.
 *
 * **Derived from whether a rod exists, not declared**, so T-34.06 flips it by
 * shipping the item and nobody has to remember to come back here. Until then no
 * amount of farm level makes a fish obtainable: there is no rod, so there is no
 * way to get one, and a quest asking for one would be uncompletable.
 *
 * **This hole was found by checking T-34.07's dependencies rather than by a
 * failing test**, which is worth recording. `obtainableAtLevel` returned `true`
 * for every item it did not recognise as a crop — correct for wood, eggs and
 * milk, which are gated by GOLD rather than by level, and quietly wrong for the
 * eighteen fish T-34.04 had just added. A fish quest would have passed
 * `quests.test.ts`'s headline invariant and shipped as a request nobody could
 * fill.
 */
export const FISHING_IS_REACHABLE: boolean = ITEMS['rod_wood'] !== undefined;

/**
 * Whether a farm at this level can get hold of this item.
 *
 * Three cases, and the DEFAULT is the one that needed thought: an item this
 * function does not recognise is assumed obtainable, because wood, eggs, milk
 * and feed are gated by gold rather than by level and a quest that waits on a
 * purchase the player could make at any time is not level-gated in any useful
 * sense. That default is right for those four and was wrong for fish — which is
 * the argument for every new *kind* of item asking itself whether it belongs in
 * a branch above rather than falling through to the bottom.
 */
export function obtainableAtLevel(itemId: string, farmLevel: number): boolean {
  const crop = PRODUCE_UNLOCK_LEVEL[itemId];
  if (crop !== undefined) return farmLevel >= crop;

  const fish = FISH_UNLOCK_LEVEL[itemId];
  if (fish !== undefined) return FISHING_IS_REACHABLE && farmLevel >= fish;

  return true;
}

/**
 * The quests.
 *
 * **They ask for things the giver plausibly wants, and pay in things the player
 * plausibly needs.** Rewards are seeds and gold in the same proportion the
 * milestone board settled on (T-30.06): seeds early, because the first-session
 * problem D-18 measured is *waiting*, and more in the ground is the only thing
 * that shortens a wait; gold later, when the sinks that matter — plot expansion,
 * a barn — are priced past what a field pays.
 *
 * **Every quest must beat selling the same items to the merchant**, or it is a
 * worse shipping box with extra steps. `quests.test.ts` enforces that against
 * `shopSellPrice`, which is the comparison a player makes without being told to.
 * The margin is deliberately not large: a quest should be worth doing when you
 * were going to grow the thing anyway, not worth farming in preference to
 * everything else.
 *
 * **The Chef asks for produce he could cook if he had a kitchen.** He has not —
 * Phase 32 is superseded — and his dialogue says so. What he can honestly do
 * today is buy ingredients, which is what these are.
 */
export const QUESTS: readonly Quest[] = Object.freeze([
  {
    id: 'chef_first_basket',
    giver: 'chef',
    title: 'Something green',
    summary: 'Bring me four leeks and I will stop asking everyone for turnips.',
    requires: [{ itemId: 'leek', quantity: 4 }],
    reward: { gold: 0, items: [{ itemId: 'potato_seeds', quantity: 4 }] },
    unlockLevel: 1,
  },
  {
    id: 'chef_root_veg',
    giver: 'chef',
    title: 'Roots',
    summary: 'Six carrots and three potatoes. I have an idea and I need to test it.',
    requires: [
      { itemId: 'carrot', quantity: 6 },
      { itemId: 'potato', quantity: 3 },
    ],
    reward: { gold: 500, items: [{ itemId: 'carrot_seeds', quantity: 6 }] },
    unlockLevel: 2,
  },
  {
    id: 'chef_breakfast',
    giver: 'chef',
    title: 'Breakfast, eventually',
    summary: 'Six eggs. No, I do not have a pan yet. Yes, I am aware.',
    requires: [{ itemId: 'egg', quantity: 6 }],
    reward: { gold: 500, items: [] },
    unlockLevel: 3,
  },
  {
    id: 'chef_the_good_stuff',
    giver: 'chef',
    title: 'The good stuff',
    summary: 'Three broccoli. I will not tell you what for. You would talk me out of it.',
    requires: [{ itemId: 'broccoli', quantity: 3 }],
    reward: { gold: 380, items: [{ itemId: 'asparagus_seeds', quantity: 4 }] },
    unlockLevel: 4,
  },
  {
    id: 'merchant_restock',
    giver: 'merchant',
    title: 'A restock',
    summary: 'Ten wood. My shelves are held up by optimism and one nail.',
    requires: [{ itemId: 'wood', quantity: 10 }],
    /*
     * The one quest that pays far above the sale value on purpose.
     *
     * `docs/economy.md` records wood's price as effectively dead — 5g a log, so
     * chopping is a chore with no reason. Phase 32 was going to fix that by
     * spending wood on machines and is superseded. Until something does, a
     * merchant who pays properly for it is the only thing in the game that makes
     * the axe worth carrying, and the amounts are small enough that it cannot
     * become anybody's main income.
     */
    reward: { gold: 150, items: [] },
    unlockLevel: 2,
  },
  {
    id: 'merchant_the_road',
    giver: 'merchant',
    title: 'Worth the road',
    summary: 'Two cauliflower. I have a buyer three towns over and a cart that complains.',
    requires: [{ itemId: 'cauliflower', quantity: 2 }],
    reward: { gold: 640, items: [{ itemId: 'strawberry_seeds', quantity: 3 }] },
    unlockLevel: 5,
  },
]);

export const QUEST_IDS: readonly string[] = QUESTS.map((q) => q.id);

const BY_ID = new Map(QUESTS.map((q) => [q.id, q]));

export function questById(id: string): Quest | undefined {
  return BY_ID.get(id);
}

/** Every quest a farm at this level may be offered. */
export function questsForLevel(farmLevel: number): readonly Quest[] {
  return QUESTS.filter((q) => q.unlockLevel <= farmLevel);
}

/**
 * What the merchant would pay for a quest's requirements.
 *
 * The number a player compares the reward against without being asked to, which
 * is why the invariant is written in terms of it rather than in terms of a
 * hand-picked "fair" figure. Produce with no sell price counts as zero, which
 * makes the comparison conservative in the direction that matters — a quest can
 * only look *worse* than it is.
 */
export function requirementSellValue(quest: Quest): number {
  return quest.requires.reduce(
    (sum, need) => sum + (ITEMS[need.itemId]?.shopSellPrice ?? 0) * need.quantity,
    0,
  );
}

/** Gold value of a reward, counting seeds at what the merchant charges for them. */
export function rewardGoldValue(reward: MilestoneReward): number {
  return reward.items.reduce(
    (sum, stack) => sum + (ITEMS[stack.itemId]?.shopBuyPrice ?? 0) * stack.quantity,
    reward.gold,
  );
}

/** Crop ids, for tests that need to walk what is growable. */
export const GROWABLE_PRODUCE: readonly string[] = Object.values(CROPS).map(
  (c: { produceItemId: string }) => c.produceItemId,
);

export type { CropId };

/* ------------------------------------------------------------------ *
 * The rotating board (T-33.06)
 * ------------------------------------------------------------------ */

/**
 * How long one rotation of derived requests lasts.
 *
 * **Six real hours, not one in-game day.** The in-game day is twenty minutes
 * (`DAY_LENGTH_MS`), so a board that rotated with it would turn over three times
 * an hour — a player who left to make tea would come back to different work, and
 * nothing asked for would survive the crop that fills it. Six hours is long
 * enough that an accepted request outlives the crop it needs (the slowest spring
 * crop is ten hours, but a request is completed from stock, not from scratch)
 * and short enough that a session tomorrow finds a different board.
 *
 * It is deliberately NOT a multiple of 24: a fixed daily boundary means everyone
 * in one timezone always meets the board at the same point in their day, and the
 * player who plays at 8am sees the same slot forever.
 */
export const QUEST_ROTATION_MS = 6 * 60 * 60 * 1000;

/** How many derived requests are on offer at once. */
export const DAILY_REQUEST_SLOTS = 3;

/**
 * What a derived request pays, as a multiple of what the goods would sell for.
 *
 * Inside the band the authored quests were tuned to (1.4–1.5x), because the two
 * kinds of request sit on the same board and a player comparing them should not
 * find one strictly better. Being a MULTIPLE rather than a table is what makes
 * the T-33.04 invariant hold by construction for content nobody wrote: a derived
 * request cannot be a trap, whatever crop it lands on.
 */
export const DAILY_REQUEST_MARGIN = 1.45;

/** Roughly what a derived request should be worth, in sale value. */
const DAILY_REQUEST_TARGET_VALUE = 300;
const DAILY_REQUEST_MIN_QTY = 2;
const DAILY_REQUEST_MAX_QTY = 12;

/** Which rotation `now` falls in. Pure, global, and stored nowhere (§4.2). */
export function rotationIndexAt(now: number): number {
  return Math.floor(now / QUEST_ROTATION_MS);
}

/** When the rotation containing `now` ends. */
export function rotationEndsAt(now: number): number {
  return (rotationIndexAt(now) + 1) * QUEST_ROTATION_MS;
}

/**
 * The id of a derived request.
 *
 * **The rotation is IN the id**, which is what lets `quest_progress` store
 * derived and authored requests in one column with one unique index. It also
 * makes a stale offer refuse itself: an id from rotation 8 posted during
 * rotation 9 does not match the current board, and `acceptQuest` says so without
 * needing a history of what used to be offered.
 */
export function dailyRequestId(rotation: number, slot: number): string {
  return `daily:${rotation}:${slot}`;
}

export function parseDailyRequestId(id: string): { rotation: number; slot: number } | null {
  const match = /^daily:(\d+):(\d+)$/.exec(id);
  if (!match) return null;
  return { rotation: Number(match[1]), slot: Number(match[2]) };
}

/**
 * The produce a farm at this level can actually grow, in a stable order.
 *
 * **Stable, because the seed indexes into it.** `Object.values(CROPS)` is
 * insertion order and would silently re-shuffle every board if somebody moved a
 * crop in the table; sorting by id means adding a crop changes future boards
 * (which is correct — there is new content) but never re-rolls a rotation that
 * is already on screen.
 */
function growableAtLevel(farmLevel: number): { itemId: string; price: number }[] {
  return Object.values(CROPS)
    .filter((crop) => crop.unlockLevel <= farmLevel)
    .map((crop) => ({
      itemId: crop.produceItemId,
      price: ITEMS[crop.produceItemId]?.shopSellPrice ?? 0,
    }))
    .filter((c) => c.price > 0)
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

/**
 * The derived requests on offer to this player, this rotation.
 *
 * **Seeded from the player id and the rotation index, and nothing else.** That
 * is the anti-farming property, stated as a construction rather than as a check:
 * there is no action a player can take that changes either input, so the board
 * cannot be re-rolled by refreshing, by logging out, by accepting and abandoning,
 * or by planting anything. It also needs no stored seed column — the seed is
 * derivable, which is the same argument `timeOfDayAt` makes for the clock.
 *
 * Every offer is drawn from `growableAtLevel`, so **the board can only ask for
 * what the player can already grow**. That is the phase's title and it is true
 * by construction rather than by a filter somebody has to remember to apply.
 */
export function dailyRequestsFor(playerId: string, farmLevel: number, now: number): Quest[] {
  const growable = growableAtLevel(farmLevel);
  if (growable.length === 0) return [];

  const rotation = rotationIndexAt(now);
  const seed = seedFrom(`${playerId}:${rotation}`);
  const out: Quest[] = [];
  const used = new Set<string>();

  for (let slot = 0; slot < DAILY_REQUEST_SLOTS; slot++) {
    /*
     * Two draws per slot, offset far apart in the counter so the crop and the
     * quantity do not correlate — with adjacent counters, an expensive crop
     * would reliably draw a similar quantity and the board would rhyme.
     */
    let choice = growable[pick(seed, slot * 2, growable.length)]!;

    // Prefer not to ask for the same crop twice on one board. Walks forward
    // rather than re-drawing, so the result stays a pure function of the seed.
    for (let i = 0; used.has(choice.itemId) && i < growable.length; i++) {
      choice = growable[(pick(seed, slot * 2, growable.length) + i + 1) % growable.length]!;
    }
    used.add(choice.itemId);

    const ideal = Math.round(DAILY_REQUEST_TARGET_VALUE / choice.price);
    const jitter = 1 + pick(seed, slot * 2 + 1, 3) - 1; // -1, 0 or +1
    const quantity = Math.max(
      DAILY_REQUEST_MIN_QTY,
      Math.min(DAILY_REQUEST_MAX_QTY, ideal + jitter),
    );

    const sellValue = choice.price * quantity;
    const item = ITEMS[choice.itemId];

    out.push({
      id: dailyRequestId(rotation, slot),
      giver: slot % 2 === 0 ? 'chef' : 'merchant',
      title: `Wanted: ${item?.name ?? choice.itemId}`,
      summary: `${quantity} × ${item?.name ?? choice.itemId}, before the board turns over.`,
      requires: [{ itemId: choice.itemId, quantity }],
      // Ceil, so the margin can never round DOWN to at-or-below the sale value
      // and turn a derived request into the trap the invariant forbids.
      reward: { gold: Math.ceil(sellValue * DAILY_REQUEST_MARGIN), items: [] },
      unlockLevel: 1,
    });
  }

  return out;
}

/**
 * Any request by id — authored or derived — for the player and moment given.
 *
 * The server resolves through this so `accept` and `turn-in` need no branch: an
 * id either names something on this player's board right now, or it does not.
 */
export function resolveQuest(
  id: string,
  playerId: string,
  farmLevel: number,
  now: number,
): Quest | undefined {
  const authored = questById(id);
  if (authored) return authored;
  if (!parseDailyRequestId(id)) return undefined;
  return dailyRequestsFor(playerId, farmLevel, now).find((q) => q.id === id);
}
