import { DAY, MINUTE } from './time.js';
import { PLOT_POSITIONS } from './plots.generated.js';

/**
 * Economy constants (CLAUDE.md §5.6). Gold is the single soft currency and is
 * always an integer.
 *
 * Every faucet and sink defined here must be mirrored in docs/economy.md.
 */

/** Starting gold for a new account. This is the only unconditional gold faucet. */
export const STARTING_GOLD = 500;

/**
 * The starter kit: the two tools a farm cannot be worked without, plus enough
 * seed to fill the opening plots and see a first harvest without the shop.
 *
 * Granted once, in the same transaction as the account. Counted in
 * docs/economy.md as an item faucet — the seeds are worth
 * `4 × parsnip_seeds + 2 × leek_seeds` = 64g of goods. The tools are worth
 * nothing by construction: unbuyable, unsellable, untradeable (T-8.06), so
 * they add no value to the economy, only the ability to farm at all.
 *
 * **The kit closes D-18's 42-minute hole with the mechanic, not with gold**
 * (T-31.05). Until Phase 31 the fastest crop in the game was leek at 45
 * minutes, so a new player planted six plots in three minutes and then had
 * nothing to do until 0:45 — they left before ever completing the loop the
 * game is made of. Parsnip ripens in **12 minutes**, so the first thing
 * planted finishes while the player is still there: till, plant, water,
 * harvest, all inside one sitting.
 *
 * **Four parsnip and two leek rather than six of either**, and the split is
 * the teaching. Four parsnips at 0:15 is a harvest that feels like one and
 * closes the loop; the two leeks ripening at 0:45 are the first reason to come
 * back later, which is the idle pillar (§1) demonstrated rather than
 * explained. Six identical seeds would teach the loop and nothing else.
 *
 * **Potato left the kit and that is not a downgrade.** It was the 2-hour crop
 * in a kit meant to teach a loop, and the `first_yield` milestone
 * (`milestones.ts`) pays two potato seeds for the first harvest — so a player
 * still meets potato in the first session, as a reward for finishing the loop
 * rather than as a plot they cannot check on. The kit's goods value drops from
 * 180g to 64g, which is deliberate: the opening constraint is **plots and
 * time**, not gold — 500 starting gold already buys far more seed than six
 * plots can hold.
 *
 * **Twelve minutes is a floor, not a preference.** `xpForDuration` awards
 * `max(1, floor(ms / XP_PER_UNIT_MS))`, so a crop under five minutes still
 * pays a whole XP and would beat every other crop on experience per hour —
 * and experience is the anti-alt control behind `TRADE_MIN_FARM_LEVEL`
 * (`config/level.ts`). `level.test.ts` refuses any crop shorter than
 * `XP_PER_UNIT_MS`. The hole can be made small; it cannot be made zero.
 *
 * **Order is load-bearing.** `auth/service.ts` inserts these at
 * `slotIndex: index`, and T-8.07 makes the first twelve backpack slots the
 * hotbar — so the tools go first, landing a new player's hoe and watering can
 * on keys 1 and 2 without them having to arrange anything. Reordering this
 * array silently reshuffles every future account's hotbar.
 */
export const STARTING_ITEMS: readonly { readonly itemId: string; readonly quantity: number }[] = [
  { itemId: 'hoe_wood', quantity: 1 },
  { itemId: 'watering_can_wood', quantity: 1 },
  { itemId: 'parsnip_seeds', quantity: 4 },
  { itemId: 'leek_seeds', quantity: 2 },
];

/** Plot count a new farm begins with. */
export const STARTING_PLOTS = 6;

/**
 * Hard ceiling on plots, before VIP.
 *
 * Derived from the authored map rather than picked: every plot must stand on a
 * cell someone drew soil under, so the pool cannot exceed what
 * `plots.generated.ts` provides. Add plots in the map editor and re-run
 * `pnpm plots` to raise it.
 *
 * NOTE for T-3.03 / VIP: `VIP_BENEFITS.bonusPlotSlots` grants plots ON TOP of
 * this cap, and they need authored positions too. Until the map marks
 * `MAX_PLOTS + bonusPlotSlots` cells, a VIP's bonus plots have nowhere to go —
 * whoever implements plot unlocking must either mark more cells or clamp.
 */
export const MAX_PLOTS = PLOT_POSITIONS.length;

/**
 * The backpack a new player starts with. `BACKPACK_TIERS` and VIP go on top.
 *
 * Was 24 and came partly from the house until T-10.03 moved bag size onto its
 * own purchased tier (§5.5). Kept as a named constant because "the starting
 * bag" is what most callers actually mean; `BACKPACK_TIERS[0].slots` is the
 * same number said the other way.
 */
export const BASE_INVENTORY_SLOTS = 12;

/**
 * Backpack tiers (T-10.03, CLAUDE.md §5.5) — bought at the merchant.
 *
 * The bag's size is a purchase now, not a side effect of the house. Tier 0 is
 * 12 slots, which is exactly `HOTBAR_SLOTS`: a new player's entire backpack is
 * the strip along the bottom of the screen, and the first upgrade is what
 * introduces the idea of a bag with more in it than the hand can reach.
 *
 * Priced level with the chest's first two tiers on purpose. They compete for
 * the same early gold, and the choice — carry more, or store more — should be
 * a real one rather than one obviously-cheaper answer.
 */
export const BACKPACK_TIERS: readonly {
  readonly tier: number;
  readonly cost: number;
  readonly slots: number;
}[] = [
  { tier: 0, cost: 0, slots: BASE_INVENTORY_SLOTS },
  { tier: 1, cost: 2_000, slots: 24 },
  { tier: 2, cost: 10_000, slots: 36 },
];

/**
 * How many backpack slots the hotbar shows (CLAUDE.md §5.5, T-8.07).
 *
 * The hotbar is **not a separate container** — it is a window onto slot
 * indices 0 to `HOTBAR_SLOTS - 1` of the backpack the server already stores.
 * That is why it needs no schema, no endpoint and no validation: rearranging
 * the bag rearranges the hotbar, because they are the same rows.
 *
 * Shared rather than client-local because `STARTING_ITEMS` order is chosen to
 * land the tools inside this window (T-8.06), and the two must agree.
 */
export const HOTBAR_SLOTS = 12;

/** Base chest slots at chest tier 0. */
export const BASE_CHEST_SLOTS = 24;

/**
 * Cost in gold to unlock the Nth plot (0-indexed past the starting plots).
 * Superlinear so plot expansion stays a real sink at every stage.
 * Integer math only — no floats for gold, ever (CLAUDE.md §10).
 */
export function plotUnlockCost(plotIndex: number): number {
  const n = plotIndex - STARTING_PLOTS + 1;
  if (n <= 0) return 0;
  return 250 * n * n;
}

/** Chest upgrade tiers: cost in gold, and slots granted at that tier. */
export const CHEST_TIERS: readonly { readonly tier: number; readonly cost: number; readonly slots: number }[] = [
  { tier: 0, cost: 0, slots: BASE_CHEST_SLOTS },
  { tier: 1, cost: 2_000, slots: 48 },
  { tier: 2, cost: 10_000, slots: 96 },
  { tier: 3, cost: 40_000, slots: 160 },
];

/**
 * House upgrade tiers.
 *
 * **The house is now purely cosmetic** (T-12.02). It used to carry
 * `bonusAnimalCap`, which was the last mechanical thing it did after T-10.03
 * took bag slots off it; animal caps moved onto `COOP_TIERS`/`BARN_TIERS` in
 * `config/animals.ts`, where "the coop is full" and "the barn is full" can be
 * different sentences.
 *
 * That leaves a tier that buys nothing observable — the house renders with one
 * look at every tier (a T-7.11 regression, recorded there). It is still a
 * declared gold sink in `docs/economy.md` and the endpoint still works, but
 * until Phase 14 gives the house per-tier art there is nothing here for a
 * player to see, which is why the shop does not offer it.
 */
export const HOUSE_TIERS: readonly {
  readonly tier: number;
  readonly cost: number;
}[] = [
  { tier: 0, cost: 0 },
  { tier: 1, cost: 5_000 },
  { tier: 2, cost: 25_000 },
];

/* ------------------------------------------------------------------ *
 * Trade eligibility (CLAUDE.md §6 / §14 — DECIDED)
 * ------------------------------------------------------------------ */

/**
 * A player may not open or accept a trade until BOTH conditions hold. This is
 * the throwaway-account scam limiter recommended in CLAUDE.md §14.
 */
export const TRADE_MIN_ACCOUNT_AGE_MS = 1 * DAY;
export const TRADE_MIN_FARM_LEVEL = 5;

/**
 * How long a trade lives before it expires on its own.
 *
 * An INVITE is short: it is an interruption on someone else's screen, and one
 * left hanging blocks both parties from trading with anyone else. An accepted
 * SESSION gets longer, because by then two people are actually negotiating.
 *
 * Expiry is enforced ON READ (§4.2), so these are real deadlines without a job
 * running anywhere.
 */
export const TRADE_INVITE_TTL_MS = 2 * MINUTE;
export const TRADE_SESSION_TTL_MS = 10 * MINUTE;

/** Rate limit: completed trades per account per window. */
export const TRADE_RATE_LIMIT = { max: 20, windowMs: 1 * DAY } as const;

/**
 * OPEN DECISION (CLAUDE.md §14) — is gold itself tradeable?
 *
 * Kept false until decided. Gold-for-items is the cleanest real-money-trading
 * vector and the easiest thing for gold-selling bots to move, so the safe
 * default is items-only. The trade schema still carries `goldOffered` fields so
 * flipping this does not require a migration.
 */
export const GOLD_IS_TRADEABLE = false;

/* ------------------------------------------------------------------ *
 * Shipping box (CLAUDE.md §5.6)
 * ------------------------------------------------------------------ */

/**
 * How long the shipping box takes to turn goods into gold.
 *
 * Ten minutes, not a day. The box is the *convenient* way to sell — walk past,
 * drop a harvest in, carry on — and the merchant is the immediate one at the
 * same price. What the wait buys is a reason to come back, which is the whole
 * idle loop in miniature; a day-long wait would instead make the box the thing
 * you use before logging off, and nothing else.
 *
 * Settled ON READ (§4.2), so this is a real deadline with no job behind it:
 * whatever has come due is credited by the next request that looks.
 */
export const SHIPPING_PAYOUT_MS = 10 * MINUTE;
