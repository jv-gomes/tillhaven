import {
  ICON_CHICKEN_EGG,
  ICON_COW_MILK,
  ICON_ANIMAL_FEED,
  ICON_ALL_CROPS,
  ICON_WHEAT,
  ITEM_ICON_FRAME,
  TOOL_AXE_WOOD,
  TOOL_HOE_WOOD,
  TOOL_WATERING_CAN_WOOD,
  ICON_WOOD,
} from './assets.js';
import { CROPS, CropId } from './crops.js';
import { FISH } from './fish.js';

/**
 * Produce icons reuse each crop's own produce frame from `crops.ts` (single
 * source of truth, not a duplicated frame number). **Seed icons deliberately
 * do NOT** — they come from `ICON_ALL_CROPS` via `CropDef.seedBagFrame`,
 * because a seed packet that is the same frame as the sprout it becomes is
 * unreadable in a hotbar (T-16.01).
 *
 * Animal-produce/feed icons (T-7.09, "Item icon rewire") point at the
 * dedicated `Icons/Food Icons/` sheets registered in `assets.ts`: egg ->
 * Chicken Egg, milk -> Small Cow Milk, chicken feed -> Animal Feed. `hay`
 * has no file literally named "Hay" anywhere in the pack (checked, see
 * `assets.ts`'s `ICON_WHEAT` comment) so it uses Wheat, the closest match —
 * the same "closest match, keep the item id" reasoning `CROP_LEEK` already
 * documents for Spring Onion. This replaces the T-7.07 placeholder that
 * borrowed real, visible crop growth-stage frames (onion/potato frames 2-3)
 * for these four items.
 */
const ANIMAL_ITEM_ICON = {
  egg: { sheet: ICON_CHICKEN_EGG.key, frame: ITEM_ICON_FRAME },
  milk: { sheet: ICON_COW_MILK.key, frame: ITEM_ICON_FRAME },
  chicken_feed: { sheet: ICON_ANIMAL_FEED.key, frame: ITEM_ICON_FRAME },
  hay: { sheet: ICON_WHEAT.key, frame: ITEM_ICON_FRAME },
} as const;

/**
 * Item catalogue (CLAUDE.md §5.4).
 *
 * `shopBuyPrice`  — gold the player PAYS the NPC shop. null = not for sale.
 * `shopSellPrice` — gold the player RECEIVES from the NPC shop. null = not sellable.
 *
 * The shop always buys back BELOW player-to-player value so trading between
 * players is meaningfully better than vendoring (CLAUDE.md §5.6). Keep
 * shopSellPrice well under shopBuyPrice for the same item — see the invariant
 * test in items.test.ts.
 *
 * Every price here must also appear in docs/economy.md. An idle economy dies
 * from unlogged faucets.
 */

export const ItemCategory = {
  SEED: 'seed',
  PRODUCE: 'produce',
  ANIMAL_PRODUCE: 'animal_produce',
  FEED: 'feed',
  DECORATION: 'decoration',
  TOOL: 'tool',
  /**
   * Something pulled out of the water (T-34.04).
   *
   * Its own category rather than `PRODUCE` for the reason `MATERIAL` is one:
   * the game already asks questions the two answer differently. Produce comes
   * off a plot and counts toward harvest XP; a fish comes off a rod and does
   * not, and the Chef will want to tell them apart when there is a kitchen.
   */
  FISH: 'fish',
  /**
   * A raw resource gathered from the world rather than grown or produced
   * (T-20.02). Wood is the first; ore would be the second.
   *
   * Its own category rather than `PRODUCE` because the two answer differently
   * to questions the game already asks — produce comes off a plot and counts
   * toward harvest XP, a material comes off a tree and does not.
   */
  MATERIAL: 'material',
} as const;
export type ItemCategory = (typeof ItemCategory)[keyof typeof ItemCategory];

/**
 * What a tool DOES, independent of its tier.
 *
 * Declared rather than parsed out of the item id: D-4 will add eight more tiers
 * (`hoe_iron`, `watering_can_gold`, …) and a control scheme that decides what
 * the action key does by matching id prefixes would keep working right up until
 * someone names one differently.
 */
export const ToolKind = {
  HOE: 'hoe',
  WATERING_CAN: 'watering_can',
  AXE: 'axe',
} as const;
export type ToolKind = (typeof ToolKind)[keyof typeof ToolKind];

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly category: ItemCategory;
  /** Max units in one inventory slot. Integer. */
  readonly stackLimit: number;
  readonly shopBuyPrice: number | null;
  readonly shopSellPrice: number | null;
  /**
   * Whether this item may cross a player-to-player trade. Cosmetic VIP items
   * are always false — VIP must never mint tradeable value (CLAUDE.md §7).
   */
  readonly tradeable: boolean;
  /** Set on tools only; what the item is used FOR (see `ToolKind`). */
  readonly toolKind?: ToolKind;
  readonly icon: { readonly sheet: string; readonly frame: number };
}

function seed(
  id: string,
  name: string,
  crop: CropId,
  buy: number,
): ItemDef {
  const def = CROPS[crop];
  return {
    id,
    name,
    category: ItemCategory.SEED,
    stackLimit: 999,
    shopBuyPrice: buy,
    // Seeds are not buyable back — otherwise buy/sell round-tripping is a
    // gold sink or faucet depending on the spread, and it is neither by design.
    shopSellPrice: null,
    tradeable: true,
    // The pack's per-crop seed bag, never the crop's own sheet (T-16.01) — see
    // `CropDef.seedBagFrame`. Produce below still uses the crop sheet, which is
    // correct: a harvested potato should look like a potato.
    icon: { sheet: ICON_ALL_CROPS.key, frame: def.seedBagFrame },
  };
}

function produce(
  id: string,
  name: string,
  crop: CropId,
  sell: number,
): ItemDef {
  const def = CROPS[crop];
  return {
    id,
    name,
    category: ItemCategory.PRODUCE,
    stackLimit: 999,
    shopBuyPrice: null,
    shopSellPrice: sell,
    tradeable: true,
    icon: { sheet: def.sheet.key, frame: def.produceFrame },
  };
}

/**
 * A tool (T-8.06, CLAUDE.md §5.2).
 *
 * Tools cannot be **sold** and cannot cross a **trade**. Both follow from one
 * fact: a tool you can buy from the merchant at a fixed price has no scarcity,
 * so a player-to-player market in one would be a market in nothing, and a sell
 * price would just be a gold faucet with a buy-back loop attached.
 *
 * **Buying is the exception, and T-20.05 is why.** The original rule said tools
 * could not be bought either, on the grounds that *"every player is granted the
 * wood tier at registration"* — true of the hoe and the can, and false of the
 * axe, which is granted to nobody. A tool that is neither granted nor sold is a
 * tool that cannot be obtained, so `buy` is an explicit opt-in per tool rather
 * than a blanket ban.
 *
 * Encoding all of this as a constructor rather than as fields per item is still
 * the point: a tool cannot accidentally acquire a sell price or become
 * tradeable, because there is no argument for either.
 *
 * `stackLimit: 1` because a slot holding "3 hoes" is meaningless and, once
 * T-8.07 makes the hotbar the first twelve slots, actively confusing.
 *
 * Icon frame is `ITEM_ICON_FRAME` — the same frame 0 every other item icon
 * uses. Measured rather than assumed: on all six 2-frame icon sheets in the
 * pack (the four food icons and both tools), frame 1 is pixel-identical to
 * frame 0 plus a surrounding outline, added pixels only, nothing removed. The
 * outlined variant is the odd one out in an inventory grid, so tools match the
 * rest rather than being the only two icons with a border.
 */
function tool(
  id: string,
  name: string,
  sheetKey: string,
  kind: ToolKind,
  /** What the merchant charges. `null` for tools granted at registration. */
  buy: number | null = null,
): ItemDef {
  return {
    id,
    name,
    category: ItemCategory.TOOL,
    stackLimit: 1,
    shopBuyPrice: buy,
    shopSellPrice: null,
    tradeable: false,
    toolKind: kind,
    icon: { sheet: sheetKey, frame: ITEM_ICON_FRAME },
  };
}

const DEFS: readonly ItemDef[] = [
  // --- tools ---
  // Wood tier only; the pack ships nine tiers but what the others mean is
  // D-4, and chopping/mining are post-MVP (ROADMAP "What is deliberately NOT
  // in this roadmap").
  tool('hoe_wood', 'Wooden Hoe', TOOL_HOE_WOOD.key, ToolKind.HOE),
  tool('watering_can_wood', 'Wooden Watering Can', TOOL_WATERING_CAN_WOOD.key, ToolKind.WATERING_CAN),
  /*
   * The axe (T-20.02, on sale since T-20.05). The one tool the merchant sells,
   * because it is the one tool registration does not hand out.
   *
   * **200g is priced against what it unlocks, not against the other tools** —
   * there is nothing to compare it to, since it is the only tool with a price.
   * Wood sells for 5g and the faucet is 45/day at full use, so a player
   * chopping properly earns it back in under a day and a casual one in two or
   * three. That is the shape a starter tool should have: a real decision on
   * day one out of 500 starting gold, and forgotten by week two.
   *
   * It opened at 150g, which `config.test.ts` rejected for costing **less than
   * a packet of onion seeds** — the game's priciest consumable outpricing its
   * only permanent tool. The test moved the number, not the other way round.
   */
  tool('axe_wood', 'Wooden Axe', TOOL_AXE_WOOD.key, ToolKind.AXE, 200),

  // --- seeds ---
  seed('leek_seeds', 'Leek Seeds', CropId.LEEK, 20),
  seed('potato_seeds', 'Potato Seeds', CropId.POTATO, 50),
  seed('strawberry_seeds', 'Strawberry Seeds', CropId.STRAWBERRY, 100),
  seed('onion_seeds', 'Onion Seeds', CropId.ONION, 160),
  seed('parsnip_seeds', 'Parsnip Seeds', CropId.PARSNIP, 6),
  seed('carrot_seeds', 'Carrot Seeds', CropId.CARROT, 12),
  seed('rice_seeds', 'Rice Seeds', CropId.RICE, 24),
  seed('asparagus_seeds', 'Asparagus Seeds', CropId.ASPARAGUS, 64),
  seed('broccoli_seeds', 'Broccoli Seeds', CropId.BROCCOLI, 78),
  seed('cauliflower_seeds', 'Cauliflower Seeds', CropId.CAULIFLOWER, 172),
  seed('cabbage_seeds', 'Cabbage Seeds', CropId.CABBAGE, 311),

  // --- crop produce ---
  produce('leek', 'Leek', CropId.LEEK, 35),
  produce('potato', 'Potato', CropId.POTATO, 90),
  produce('strawberry', 'Strawberry', CropId.STRAWBERRY, 95),
  produce('onion', 'Onion', CropId.ONION, 110),
  produce('parsnip', 'Parsnip', CropId.PARSNIP, 9),
  produce('carrot', 'Carrot', CropId.CARROT, 21),
  produce('rice', 'Rice', CropId.RICE, 22),
  produce('asparagus', 'Asparagus', CropId.ASPARAGUS, 58),
  produce('broccoli', 'Broccoli', CropId.BROCCOLI, 142),
  produce('cauliflower', 'Cauliflower', CropId.CAULIFLOWER, 313),
  produce('cabbage', 'Cabbage', CropId.CABBAGE, 566),

  // --- materials ---
  /*
   * Wood (T-20.02). Dropped by chopping a tree; `WOOD_PER_TREE` x 5 trees x
   * three 8h cycles is a faucet of 45 a day, asserted in `trees.test.ts`.
   *
   * **The sell price is a deliberate floor, not a valuation.** 5g puts the
   * whole faucet at 225g/day — real money to a new farm, rounding error to a
   * mature one, which is the shape a passive supplement should have. It is set
   * LOW on purpose: wood's real job is to be a crafting input, and a material
   * that sells well is a material nobody crafts with. Revisit when there is
   * something to build (T-14.05's successors), not before.
   *
   * **8g was the first answer and it was wrong.** At 8g the faucet came to
   * 360g/day against a mature onion plot's 330g/day — so five chops a day beat
   * a plot that had to be planted, watered twice and harvested. `config.test.ts`
   * computed both and failed; the price moved, not the assertion.
   *
   * Tradeable, unlike a tool: wood has genuine scarcity — an 8h regrow — so
   * there is something real to trade.
   */
  {
    id: 'wood',
    name: 'Wood',
    category: ItemCategory.MATERIAL,
    stackLimit: 999,
    shopBuyPrice: null,
    shopSellPrice: 5,
    tradeable: true,
    icon: { sheet: ICON_WOOD.key, frame: ITEM_ICON_FRAME },
  },

  // --- animal produce ---
  {
    id: 'egg',
    name: 'Egg',
    category: ItemCategory.ANIMAL_PRODUCE,
    stackLimit: 999,
    shopBuyPrice: null,
    shopSellPrice: 60,
    tradeable: true,
    icon: ANIMAL_ITEM_ICON.egg,
  },
  {
    id: 'milk',
    name: 'Milk',
    category: ItemCategory.ANIMAL_PRODUCE,
    stackLimit: 999,
    shopBuyPrice: null,
    shopSellPrice: 190,
    tradeable: true,
    icon: ANIMAL_ITEM_ICON.milk,
  },

  // --- feed ---
  {
    id: 'chicken_feed',
    name: 'Chicken Feed',
    category: ItemCategory.FEED,
    stackLimit: 999,
    shopBuyPrice: 15,
    shopSellPrice: null,
    tradeable: true,
    icon: ANIMAL_ITEM_ICON.chicken_feed,
  },
  {
    id: 'hay',
    name: 'Hay',
    category: ItemCategory.FEED,
    stackLimit: 999,
    shopBuyPrice: 40,
    shopSellPrice: null,
    tradeable: true,
    icon: ANIMAL_ITEM_ICON.hay,
  },

  /*
   * The river fish (T-34.04).
   *
   * **Generated from `FISH` rather than written out**, so a fish cannot exist
   * in the rarity table and not in the bag, and its price cannot be one number
   * here and another there. That is the same rule the seed and produce items
   * already follow from `CROPS` — the table that decides what a thing IS owns
   * its price, and everything else derives.
   *
   * Sellable and tradeable like produce. Not buyable: the merchant does not
   * stock fish, because a fish you can buy is a fish nobody needs to catch.
   */
  ...FISH.map(
    (fish): ItemDef => ({
      id: fish.id,
      name: fish.name,
      category: ItemCategory.FISH,
      stackLimit: 999,
      shopBuyPrice: null,
      shopSellPrice: fish.sellPrice,
      tradeable: true,
      icon: { sheet: `icon-fish-${fish.id.replace(/_/g, '-')}`, frame: ITEM_ICON_FRAME },
    }),
  ),
];

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.freeze(
  Object.fromEntries(DEFS.map((d) => [d.id, d])),
);

export const ITEM_IDS = DEFS.map((d) => d.id);

export function getItem(id: string): ItemDef | undefined {
  return ITEMS[id];
}
