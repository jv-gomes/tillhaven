import { ITEMS, ItemCategory } from './items.js';

/**
 * The goal board (T-30.06).
 *
 * `docs/qa-audit-2026-09-03.md` F-1 found a **42-minute hole at 0:03** in the
 * first session: six plots planted in three minutes, then nothing. D-18 costed
 * three fixes and none of them is this — but D-18 also says the hole is not
 * about gold, and a board of named goals is the cheap answer to the half that
 * is about *attention*. A player with nothing to do and a visible list of what
 * to work toward is in a different situation from one with nothing to do.
 *
 * **Every requirement is derived on read.** The only new state in the whole
 * feature is which milestones have been claimed; nothing here is counted,
 * incremented, or written when an action happens (§4.2).
 */

/* ------------------------------------------------------------------ *
 * Requirements
 * ------------------------------------------------------------------ */

/**
 * The facts a milestone may depend on.
 *
 * **This list is short on purpose, and the constraint is monotonicity.** A
 * requirement that can become false again is a milestone that appears, is not
 * claimed in time, and vanishes — which is worse than not offering it.
 *
 * Checked against the schema, only these are monotonic:
 *
 * - `plotsTilled` — `plots.tilled_at` is deliberately never cleared; harvest
 *   leaves workable soil (`modules/farm/service.ts`).
 * - `experience` — granted only, never spent or reduced (`config/level.ts`).
 * - `farmLevel` — derived from experience, so monotonic with it.
 * - `animalsOwned` — there is no endpoint that removes an animal.
 * - `shipmentsMade` — shipment rows persist after payout.
 * - `plotsUnlocked` — expansion only ever flips `unlocked` on.
 *
 * **What is deliberately absent**: anything reading `harvested_at` or
 * `watered_at`. Both are reset to null by `plant()`, so "has harvested" is not
 * a lifetime fact — it means "is currently sitting empty", which would make a
 * milestone flicker as the player replants. `experience` is the honest proxy
 * for "has harvested something", because harvesting and collecting are the
 * only two things that grant it.
 */
export type MilestoneRequirement =
  | { readonly kind: 'plotsTilled'; readonly count: number }
  | { readonly kind: 'experience'; readonly amount: number }
  | { readonly kind: 'farmLevel'; readonly level: number }
  | { readonly kind: 'animalsOwned'; readonly count: number }
  | { readonly kind: 'shipmentsMade'; readonly count: number }
  | { readonly kind: 'plotsUnlocked'; readonly count: number };

export const MILESTONE_REQUIREMENT_KINDS = [
  'plotsTilled',
  'experience',
  'farmLevel',
  'animalsOwned',
  'shipmentsMade',
  'plotsUnlocked',
] as const;

/** The numbers a milestone check needs, all derived on read. */
export interface MilestoneProgressInput {
  readonly plotsTilled: number;
  readonly experience: number;
  readonly farmLevel: number;
  readonly animalsOwned: number;
  readonly shipmentsMade: number;
  readonly plotsUnlocked: number;
}

/** The target a requirement is measured against. */
export function requirementTarget(requirement: MilestoneRequirement): number {
  switch (requirement.kind) {
    case 'plotsTilled':
      return requirement.count;
    case 'experience':
      return requirement.amount;
    case 'farmLevel':
      return requirement.level;
    case 'animalsOwned':
      return requirement.count;
    case 'shipmentsMade':
      return requirement.count;
    case 'plotsUnlocked':
      return requirement.count;
  }
}

/** How far along the player is, in the requirement's own units. */
export function requirementProgress(
  requirement: MilestoneRequirement,
  input: MilestoneProgressInput,
): number {
  switch (requirement.kind) {
    case 'plotsTilled':
      return input.plotsTilled;
    case 'experience':
      return input.experience;
    case 'farmLevel':
      return input.farmLevel;
    case 'animalsOwned':
      return input.animalsOwned;
    case 'shipmentsMade':
      return input.shipmentsMade;
    case 'plotsUnlocked':
      return input.plotsUnlocked;
  }
}

export function isMilestoneEarned(
  milestone: Milestone,
  input: MilestoneProgressInput,
): boolean {
  return requirementProgress(milestone.requirement, input) >= requirementTarget(milestone.requirement);
}

/* ------------------------------------------------------------------ *
 * Rewards
 * ------------------------------------------------------------------ */

export interface MilestoneReward {
  /** Integer gold (§10). Zero on most milestones — see the note below. */
  readonly gold: number;
  readonly items: readonly { readonly itemId: string; readonly quantity: number }[];
}

export interface Milestone {
  readonly id: string;
  readonly title: string;
  /** One line, imperative, naming the action rather than the counter. */
  readonly hint: string;
  readonly requirement: MilestoneRequirement;
  readonly reward: MilestoneReward;
}

/**
 * The board.
 *
 * **Rewards are seeds and feed, not gold, and that is D-18's finding applied.**
 * The first-session problem is a 42-minute wait with nothing to do; gold does
 * not shorten a wait, and paying for milestones would add a faucet
 * `docs/economy.md` has to carry for no gain. Seeds put more in the ground,
 * which is the thing that makes the next session sooner.
 *
 * The one gold reward is level 5, where it marks something real — that is the
 * trade gate (`TRADE_MIN_FARM_LEVEL`), so the milestone doubles as the only
 * announcement a player gets that trading has opened.
 *
 * **Farm level became worth wanting in T-31.06, and this board is where the
 * player finds that out** (T-31.07). Until then a level milestone said "reach
 * farm level 3" and the honest answer to *why* was "so you can trade at 5".
 * Now every level from 2 to 13 unlocks seeds the merchant would otherwise
 * refuse, so each level milestone **names the crops it opens** and pays a
 * handful of them — the board stops being a list of numbers and becomes the
 * game's only account of what levelling is for.
 *
 * That also fixes something that was quietly inert: sixteen crops shipped in
 * T-31.04 with nothing pointing at them. A phase that adds content without
 * giving the previous phase's systems something to point at wastes both.
 *
 * **The obvious milestones are still not expressible, and that is the
 * requirement list's doing rather than an oversight.** "Grow one of each
 * spring crop" needs a lifetime record of what has been harvested, and
 * `plant()` clears `harvested_at` — see the `MilestoneRequirement` note above.
 * `farmLevel` is the honest proxy: it is monotonic, it is what actually gates
 * the seeds, and it cannot flicker.
 *
 * Order is the order they appear on the board and is asserted to be a total
 * order by earliest-reachable, so the list never shows a later goal above an
 * earlier one.
 */
export const MILESTONES: readonly Milestone[] = Object.freeze([
  {
    id: 'break_ground',
    title: 'Break ground',
    hint: 'Till a plot with your hoe.',
    requirement: { kind: 'plotsTilled', count: 1 },
    reward: { gold: 0, items: [{ itemId: 'leek_seeds', quantity: 2 }] },
  },
  {
    id: 'six_beds',
    title: 'A field of your own',
    hint: 'Till all six of your starting plots.',
    requirement: { kind: 'plotsTilled', count: 6 },
    reward: { gold: 0, items: [{ itemId: 'leek_seeds', quantity: 3 }] },
  },
  {
    id: 'first_yield',
    title: 'First harvest',
    hint: 'Water a crop and harvest it once it ripens.',
    requirement: { kind: 'experience', amount: 1 },
    reward: { gold: 0, items: [{ itemId: 'potato_seeds', quantity: 2 }] },
  },
  {
    id: 'first_shipment',
    title: 'Something to sell',
    hint: 'Put anything in the shipping box.',
    requirement: { kind: 'shipmentsMade', count: 1 },
    reward: { gold: 0, items: [{ itemId: 'leek_seeds', quantity: 4 }] },
  },
  {
    id: 'first_livestock',
    title: 'A henhouse needs a hen',
    hint: 'Buy your first animal from the merchant.',
    requirement: { kind: 'animalsOwned', count: 1 },
    reward: { gold: 0, items: [{ itemId: 'chicken_feed', quantity: 5 }] },
  },
  /*
   * Farm level 2 is the first unlock (T-31.06): asparagus and broccoli. It sits
   * before `level_3` in the array because per-kind ordering is asserted, and
   * ahead of `first_expansion` on the board because a level arrives well before
   * 250g of spare gold does.
   */
  {
    id: 'level_2',
    title: 'Deeper beds',
    hint: 'Reach farm level 2. Asparagus and broccoli come into stock.',
    requirement: { kind: 'farmLevel', level: 2 },
    reward: { gold: 0, items: [{ itemId: 'asparagus_seeds', quantity: 3 }] },
  },
  {
    id: 'level_3',
    title: 'Finding the rhythm',
    hint: 'Reach farm level 3. Strawberries come into stock.',
    requirement: { kind: 'farmLevel', level: 3 },
    reward: { gold: 0, items: [{ itemId: 'strawberry_seeds', quantity: 2 }] },
  },
  {
    id: 'first_expansion',
    title: 'More room',
    hint: 'Clear a seventh plot.',
    requirement: { kind: 'plotsUnlocked', count: 7 },
    reward: { gold: 0, items: [{ itemId: 'potato_seeds', quantity: 3 }] },
  },
  {
    id: 'level_5',
    title: 'Open for business',
    hint: 'Reach farm level 5. Trading opens here, and so does cauliflower.',
    requirement: { kind: 'farmLevel', level: 5 },
    reward: { gold: 250, items: [] },
  },
  {
    id: 'a_real_flock',
    title: 'A real flock',
    hint: 'Keep four animals at once.',
    requirement: { kind: 'animalsOwned', count: 4 },
    reward: { gold: 0, items: [{ itemId: 'chicken_feed', quantity: 8 }] },
  },
  /*
   * The shipping box had exactly one milestone — "put anything in it" — which
   * made it a thing you try once. Ten shipments is a habit, and it is the only
   * counter on the board that rewards using a system repeatedly rather than
   * reaching a number.
   */
  {
    id: 'regular_shipper',
    title: 'A standing order',
    hint: 'Send ten shipments to town.',
    requirement: { kind: 'shipmentsMade', count: 10 },
    reward: { gold: 0, items: [{ itemId: 'cauliflower_seeds', quantity: 2 }] },
  },
  {
    id: 'level_7',
    title: 'Working the long rows',
    hint: 'Reach farm level 7. Onions come into stock.',
    requirement: { kind: 'farmLevel', level: 7 },
    reward: { gold: 0, items: [{ itemId: 'onion_seeds', quantity: 2 }] },
  },
  /*
   * **This was `level_10` and is now `level_9`**, because 10 unlocked nothing
   * and 9 unlocks aloe and cabbage (T-31.07). A round number is a worse
   * landmark than a real one: the board is the only place the game explains
   * what levelling is for, and a goal whose reward is "you are now level ten"
   * explains nothing. The id changed with the target — `milestone_claims` keys
   * on it, which is survivable only because the game is pre-launch.
   */
  {
    id: 'level_9',
    title: 'Seasoned',
    hint: 'Reach farm level 9. Cabbage comes into stock — the longest crop there is.',
    requirement: { kind: 'farmLevel', level: 9 },
    reward: { gold: 0, items: [{ itemId: 'cabbage_seeds', quantity: 2 }] },
  },
  /*
   * `level_11` and `level_13` used to sit here, opening aubergine/melon and
   * watermelon. **The Spring-only cut removed all three crops**, so with
   * eleven crops the last unlock is cabbage at level 9 — and a level goal that
   * opens nothing is a number pretending to be a reward, which
   * `milestones.test.ts` refuses outright.
   *
   * The board therefore ends on a PLOT goal rather than a level one. That is a
   * better ending anyway: twelve beds is something the player does, where
   * "reach level 13" is something that happens to them.
   */
  {
    id: 'wide_field',
    title: 'Twelve beds',
    hint: 'Clear twelve plots.',
    requirement: { kind: 'plotsUnlocked', count: 12 },
    reward: { gold: 0, items: [{ itemId: 'onion_seeds', quantity: 2 }] },
  },
]);

export const MILESTONE_IDS: readonly string[] = MILESTONES.map((m) => m.id);

export function getMilestone(id: string): Milestone | undefined {
  return MILESTONES.find((m) => m.id === id);
}

/**
 * Whether a reward is safe to grant.
 *
 * Tools are `stackLimit: 1`, unsellable and untradeable — granting one would
 * hand out a duplicate of something the game treats as unique per player, and
 * `axe_wood` is a 200g purchase the milestone would undercut. Nothing on this
 * board may pay in tools, and a test enforces it rather than trusting the
 * table to stay clean.
 */
export function isGrantableItem(itemId: string): boolean {
  const item = ITEMS[itemId];
  return item !== undefined && item.category !== ItemCategory.TOOL;
}
