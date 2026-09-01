import {
  ICON_CHICKEN_EGG,
  ICON_COW_MILK,
  ICON_ANIMAL_FEED,
  ICON_WHEAT,
  ITEM_ICON_FRAME,
  TOOL_HOE_WOOD,
  TOOL_WATERING_CAN_WOOD,
} from './assets.js';
import { CROPS, CropId } from './crops.js';

/**
 * Seed/produce icons reuse each crop's own seed/produce frame from
 * `crops.ts` (single source of truth, not a duplicated frame number).
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
    icon: { sheet: def.sheet.key, frame: def.seedFrame },
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
 * Tools are the one item class with **no economy at all**: they cannot be
 * bought, cannot be sold, and cannot cross a trade. That is not three
 * independent settings but one rule with three expressions — every player is
 * granted the wood tier at registration, so a tool has no scarcity to price
 * and a tool market would be a market in nothing. Encoding it as a constructor
 * rather than three fields per item means a future axe cannot accidentally be
 * given a sell price.
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
function tool(id: string, name: string, sheetKey: string, kind: ToolKind): ItemDef {
  return {
    id,
    name,
    category: ItemCategory.TOOL,
    stackLimit: 1,
    shopBuyPrice: null,
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

  // --- seeds ---
  seed('leek_seeds', 'Leek Seeds', CropId.LEEK, 20),
  seed('potato_seeds', 'Potato Seeds', CropId.POTATO, 50),
  seed('strawberry_seeds', 'Strawberry Seeds', CropId.STRAWBERRY, 100),
  seed('onion_seeds', 'Onion Seeds', CropId.ONION, 160),

  // --- crop produce ---
  produce('leek', 'Leek', CropId.LEEK, 35),
  produce('potato', 'Potato', CropId.POTATO, 90),
  produce('strawberry', 'Strawberry', CropId.STRAWBERRY, 95),
  produce('onion', 'Onion', CropId.ONION, 110),

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
];

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.freeze(
  Object.fromEntries(DEFS.map((d) => [d.id, d])),
);

export const ITEM_IDS = DEFS.map((d) => d.id);

export function getItem(id: string): ItemDef | undefined {
  return ITEMS[id];
}
