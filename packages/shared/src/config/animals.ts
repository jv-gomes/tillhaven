import { HOUR, MINUTE } from './time.js';

/**
 * Animal definitions (CLAUDE.md §5.3).
 *
 * Production is timestamp-based: ready when
 *   `lastCollectedAt + productionIntervalMs <= now`.
 *
 * Unfed animals stop producing. They are NEVER killed or lost — permanent loss
 * is bad retention in a casual idle game, and CLAUDE.md §5.3 rules it out.
 */

export const AnimalKind = {
  COW: 'cow',
  CHICKEN: 'chicken',
} as const;
export type AnimalKind = (typeof AnimalKind)[keyof typeof AnimalKind];

/** The two farm buildings that house animals and cap how many fit (T-12.02). */
export const AnimalBuilding = {
  COOP: 'coop',
  BARN: 'barn',
} as const;
export type AnimalBuilding = (typeof AnimalBuilding)[keyof typeof AnimalBuilding];

/**
 * Cosmetic only. Never affects production (CLAUDE.md §5.3).
 *
 * Every colour the art pack ships is registered (T-12.01) because a variant
 * costs nothing but a sheet: the price, the interval, the yield and the feed
 * are all per-KIND, and this enum is the only thing a player's choice touches.
 * Ids are `<kind>_<colour>[_<sex>]`; for chickens a two-word colour is
 * body-then-accent (`chicken_black_white` is a black hen with a white wing).
 */
export const AnimalVariant = {
  CHICKEN_BLACK: 'chicken_black',
  CHICKEN_BLACK_WHITE: 'chicken_black_white',
  CHICKEN_BLONDE: 'chicken_blonde',
  CHICKEN_BLONDE_GREEN: 'chicken_blonde_green',
  CHICKEN_BROWN_BLACK: 'chicken_brown_black',
  CHICKEN_BROWN_WHITE: 'chicken_brown_white',
  CHICKEN_EVIL: 'chicken_evil',
  CHICKEN_FULL: 'chicken_full',
  CHICKEN_GREEN: 'chicken_green',
  CHICKEN_PINK: 'chicken_pink',
  CHICKEN_RED: 'chicken_red',
  CHICKEN_UNIVERSE: 'chicken_universe',
  CHICKEN_WHITE: 'chicken_white',

  COW_BLACK_FEMALE: 'cow_black_female',
  COW_BLACK_MALE: 'cow_black_male',
  COW_BLONDE_FEMALE: 'cow_blonde_female',
  COW_BLONDE_MALE: 'cow_blonde_male',
  COW_BROWN_FEMALE: 'cow_brown_female',
  COW_BROWN_MALE: 'cow_brown_male',
  COW_PINK_FEMALE: 'cow_pink_female',
  COW_PINK_MALE: 'cow_pink_male',
  COW_HIGHLAND_BLACK_FEMALE: 'cow_highland_black_female',
  COW_HIGHLAND_BLACK_MALE: 'cow_highland_black_male',
  COW_HIGHLAND_BROWN_FEMALE: 'cow_highland_brown_female',
  COW_HIGHLAND_BROWN_MALE: 'cow_highland_brown_male',
} as const;
export type AnimalVariant = (typeof AnimalVariant)[keyof typeof AnimalVariant];

/**
 * What a variant is, in full: a label to show and the art to show it with.
 *
 * The sheets are named by KEY rather than imported from `assets.ts`, the same
 * way item icons are — this file stays free of the asset manifest, and
 * `config.test.ts` cross-checks that every key here really is in `SHEETS`. A
 * typo is a failing test, not a missing sprite discovered by a player.
 */
export interface AnimalVariantDef {
  readonly id: AnimalVariant;
  readonly kind: AnimalKind;
  /** Shown in the shop's colour picker. Cosmetic description, nothing more. */
  readonly label: string;
  /** `SHEETS` key of the adult sheet. */
  readonly sheet: string;
  /**
   * `SHEETS` key of the sheet to draw before maturity, or null for a kind
   * that is bought adult. The pack ships 10 chick sheets for 13 adult
   * colours, so several adults hatch from the same one — paired by BODY
   * colour (the first word of a two-word slug), which is the part of the
   * chick that is actually coloured. Verified against the art in T-12.01 by
   * comparing each adult's opaque-pixel palette against every chick's; the
   * name-based pairing and the palette-nearest pairing agree except where an
   * adult's accent colour dominates, and the body colour wins there.
   */
  readonly babySheet: string | null;
}

function chickenVariant(
  id: AnimalVariant,
  label: string,
  slug: string,
  babySlug: string,
): AnimalVariantDef {
  return {
    id,
    kind: 'chicken',
    label,
    sheet: `animal-chicken-${slug}`,
    babySheet: `animal-chicken-baby-${babySlug}`,
  };
}

function cowVariant(id: AnimalVariant, label: string, slug: string): AnimalVariantDef {
  // No baby sheet: cows are bought adult (`maturityDurationMs: 0`), so the
  // pack's Baby Cow art is deliberately not registered or shipped.
  return { id, kind: 'cow', label, sheet: `animal-cow-${slug}`, babySheet: null };
}

const VARIANT_LIST: readonly AnimalVariantDef[] = [
  chickenVariant(AnimalVariant.CHICKEN_BLACK, 'Black', 'black', 'black'),
  chickenVariant(AnimalVariant.CHICKEN_BLACK_WHITE, 'Black & white', 'black-white', 'black'),
  chickenVariant(AnimalVariant.CHICKEN_BLONDE, 'Blonde', 'blonde', 'blonde'),
  chickenVariant(AnimalVariant.CHICKEN_BLONDE_GREEN, 'Blonde & green', 'blonde-green', 'blonde'),
  chickenVariant(AnimalVariant.CHICKEN_BROWN_BLACK, 'Brown & black', 'brown-black', 'brown'),
  chickenVariant(AnimalVariant.CHICKEN_BROWN_WHITE, 'Brown & white', 'brown-white', 'brown'),
  chickenVariant(AnimalVariant.CHICKEN_EVIL, 'Midnight', 'evil', 'evil'),
  chickenVariant(AnimalVariant.CHICKEN_FULL, 'Crimson', 'full', 'red'),
  chickenVariant(AnimalVariant.CHICKEN_GREEN, 'Green', 'green', 'green'),
  chickenVariant(AnimalVariant.CHICKEN_PINK, 'Pink', 'pink', 'pink'),
  chickenVariant(AnimalVariant.CHICKEN_RED, 'Red', 'red', 'red'),
  chickenVariant(AnimalVariant.CHICKEN_UNIVERSE, 'Cosmic', 'universe', 'universe'),
  chickenVariant(AnimalVariant.CHICKEN_WHITE, 'White', 'white', 'white'),

  cowVariant(AnimalVariant.COW_BLACK_FEMALE, 'Black (cow)', 'black-female'),
  cowVariant(AnimalVariant.COW_BLACK_MALE, 'Black (bull)', 'black-male'),
  cowVariant(AnimalVariant.COW_BLONDE_FEMALE, 'Blonde (cow)', 'blonde-female'),
  cowVariant(AnimalVariant.COW_BLONDE_MALE, 'Blonde (bull)', 'blonde-male'),
  cowVariant(AnimalVariant.COW_BROWN_FEMALE, 'Brown (cow)', 'brown-female'),
  cowVariant(AnimalVariant.COW_BROWN_MALE, 'Brown (bull)', 'brown-male'),
  cowVariant(AnimalVariant.COW_PINK_FEMALE, 'Pink (cow)', 'pink-female'),
  cowVariant(AnimalVariant.COW_PINK_MALE, 'Pink (bull)', 'pink-male'),
  cowVariant(AnimalVariant.COW_HIGHLAND_BLACK_FEMALE, 'Highland black (cow)', 'highland-black-female'),
  cowVariant(AnimalVariant.COW_HIGHLAND_BLACK_MALE, 'Highland black (bull)', 'highland-black-male'),
  cowVariant(AnimalVariant.COW_HIGHLAND_BROWN_FEMALE, 'Highland brown (cow)', 'highland-brown-female'),
  cowVariant(AnimalVariant.COW_HIGHLAND_BROWN_MALE, 'Highland brown (bull)', 'highland-brown-male'),
];

export const ANIMAL_VARIANTS: Readonly<Record<AnimalVariant, AnimalVariantDef>> =
  Object.fromEntries(VARIANT_LIST.map((v) => [v.id, v])) as Record<
    AnimalVariant,
    AnimalVariantDef
  >;

/** The variants of one kind, in shop order. */
function variantsOf(kind: AnimalKind): readonly AnimalVariant[] {
  return VARIANT_LIST.filter((v) => v.kind === kind).map((v) => v.id);
}

export interface AnimalDef {
  readonly kind: AnimalKind;
  readonly name: string;
  readonly produceItemId: string;
  readonly feedItemId: string;
  /** Time between collections, ms. Integer. */
  readonly productionIntervalMs: number;
  /** Units granted per collection. Integer. */
  readonly yieldAmount: number;
  /** Time from purchase until the animal starts producing, ms. */
  readonly maturityDurationMs: number;
  /** How long one feeding lasts, ms. */
  readonly feedDurationMs: number;
  /** Gold cost from the NPC shop. */
  readonly purchasePrice: number;
  /** Cosmetic variants available for this kind. */
  readonly variants: readonly AnimalVariant[];
  /**
   * The building this kind lives in, and therefore whose tier caps it
   * (T-12.02). Caps are per BUILDING, so chickens can never eat a cow's room
   * and vice versa — that separation is expressed here, once, rather than in
   * a counting query somewhere on the server.
   */
  readonly building: AnimalBuilding;
}

export const ANIMALS: Readonly<Record<AnimalKind, AnimalDef>> = {
  [AnimalKind.CHICKEN]: {
    kind: AnimalKind.CHICKEN,
    name: 'Chicken',
    produceItemId: 'egg',
    feedItemId: 'chicken_feed',
    productionIntervalMs: 90 * MINUTE,
    yieldAmount: 1,
    // Chickens hatch as babies and use the baby sprite sheet until mature.
    maturityDurationMs: 12 * HOUR,
    feedDurationMs: 24 * HOUR,
    purchasePrice: 400,
    variants: variantsOf(AnimalKind.CHICKEN),
    building: AnimalBuilding.COOP,
  },
  [AnimalKind.COW]: {
    kind: AnimalKind.COW,
    name: 'Cow',
    produceItemId: 'milk',
    feedItemId: 'hay',
    productionIntervalMs: 6 * HOUR,
    yieldAmount: 1,
    // Cows are purchased adult. The pack does ship Baby Cow art, so this is a
    // design choice rather than an art limit: a cow already costs 2000g and
    // pays back slowly, and a maturity wait on top of that is a long time to
    // stare at nothing. Flipping it later means setting this and registering
    // the four Baby Cow sheets — nothing else.
    maturityDurationMs: 0,
    feedDurationMs: 24 * HOUR,
    purchasePrice: 2_000,
    variants: variantsOf(AnimalKind.COW),
    building: AnimalBuilding.BARN,
  },
};

export const ANIMAL_KINDS = Object.keys(ANIMALS) as AnimalKind[];

export function isAnimalKind(v: string): v is AnimalKind {
  return Object.prototype.hasOwnProperty.call(ANIMALS, v);
}

/* ------------------------------------------------------------------ *
 * Coop and barn tiers (T-12.02, CLAUDE.md §5.4)
 * ------------------------------------------------------------------ */

/**
 * A building tier: what it costs to reach, and how many animals it holds.
 *
 * Shaped like `Tier` in the server's `farm/upgrades.ts` on purpose — `cost`
 * plus a tier number is all `nextTier`/`costAfter` need, so coop and barn
 * upgrades reuse the same spine as the chest, house and backpack instead of
 * growing a fourth way to buy the next thing.
 */
export interface BuildingTier {
  readonly tier: number;
  readonly cost: number;
  /** Animals of this building's kinds that fit. Integer, never a multiplier. */
  readonly cap: number;
}

/**
 * Chicken housing. Prices sit under the barn's at every tier: a chicken costs
 * 400g and pays out every 90 minutes, so the coop is the early-game track and
 * the barn is what the gold from it eventually buys.
 */
export const COOP_TIERS: readonly BuildingTier[] = [
  { tier: 0, cost: 0, cap: 4 },
  { tier: 1, cost: 4_000, cap: 8 },
  { tier: 2, cost: 20_000, cap: 12 },
];

/**
 * Cow housing. Fewer animals per tier than the coop, because a cow is worth
 * five chickens at purchase and produces on a six-hour cycle.
 *
 * The top cap is also what the farm can physically draw: a cow is 32px square
 * and the only clear run of ground left is the band below the path, which
 * holds ten of them (`BARN_YARD` in the client's `pasture.ts`). Six plus VIP's
 * three is nine, and `pasture.test.ts` fails if a retune here outgrows that.
 */
export const BARN_TIERS: readonly BuildingTier[] = [
  { tier: 0, cost: 0, cap: 2 },
  { tier: 1, cost: 10_000, cap: 4 },
  { tier: 2, cost: 40_000, cap: 6 },
];

export const BUILDING_TIERS: Readonly<Record<AnimalBuilding, readonly BuildingTier[]>> = {
  [AnimalBuilding.COOP]: COOP_TIERS,
  [AnimalBuilding.BARN]: BARN_TIERS,
};

export const ANIMAL_BUILDINGS = Object.keys(BUILDING_TIERS) as AnimalBuilding[];

export function isAnimalBuilding(v: string): v is AnimalBuilding {
  return Object.prototype.hasOwnProperty.call(BUILDING_TIERS, v);
}

/**
 * How many animals a building holds at a given tier.
 *
 * **This replaced `BASE_ANIMAL_CAP` and the house's `bonusAnimalCap`
 * outright** (T-12.02). One farm-wide number could not express "the coop is
 * full but the barn is empty", and a house that silently made room for
 * livestock was a strange thing for a house to do. The two tier-0 caps add up
 * to 6, which is exactly what `BASE_ANIMAL_CAP` used to be, so a farm that
 * never buys a building is no worse off than before — it just cannot spend all
 * six on cows any more.
 *
 * `vipBonus` is `VIP_BENEFITS.bonusAnimalCap` and applies **per building**,
 * because the cap it modifies is now per building. That does mean VIP is worth
 * +3 in the coop AND +3 in the barn where it used to be +3 in total; it is a
 * convenience benefit either way (§7 — no tradeable value is minted), but it
 * is a real buff and belongs on the list for the balance pass.
 *
 * An unknown tier falls back to tier 0 rather than throwing: under-reporting
 * capacity is the safe direction, since the alternative is room nobody bought.
 */
export function buildingCap(
  building: AnimalBuilding,
  tier: number,
  vipBonus: number,
): number {
  const tiers = BUILDING_TIERS[building];
  const found = tiers.find((t) => t.tier === tier) ?? tiers[0]!;
  return found.cap + vipBonus;
}

/**
 * What the next tier of a building costs, or null at the top.
 *
 * Shared rather than server-only so the shop row and the purchase quote the
 * same number from the same table (§4.4) — the server's `costAfter` says this
 * for every other upgrade track, and duplicating it on the client is exactly
 * how a shop starts lying about a price.
 */
export function nextBuildingCost(building: AnimalBuilding, tier: number): number | null {
  return BUILDING_TIERS[building].find((t) => t.tier === tier + 1)?.cost ?? null;
}

/* ------------------------------------------------------------------ *
 * Wander (T-15.12)
 * ------------------------------------------------------------------ */

/**
 * How far, and how often, an animal drifts around its yard slot.
 *
 * **Chickens stay in their tile; cows roam south into the open band** (T-16.04
 * and T-16.05, D-15). The split is the art's, not a preference:
 *
 *   - The chicken sheet has **no walk cycle** — measured in T-15.10: every row
 *     is the same side view and no row is any other row mirrored — so a chicken
 *     translated a whole tile would be *sliding*, not walking. What its sheet
 *     does carry is pecking, nesting and lying-down rows, and T-16.05 spends
 *     them on a behaviour routine instead. Pose variety is what it can sell.
 *   - The cow sheet carries a genuine 4-phase leg cycle with separate front and
 *     back views (rows 0/1/2), drawn for exactly this and never once played as
 *     movement before T-16.04.
 *
 * Until T-16.04 nothing left its tile at all, because `Animal.bounds()`
 * hit-tests an animal's HOME slot and a sprite that wandered off it would mean
 * walking up to feed something and finding the tile it answers on is not the
 * tile it is standing on. T-16.06 resolves that (D-16) by letting a roaming
 * cow's box follow it — which is only safe because the roam is vertical, so
 * two cows can never share a column.
 *
 * `radiusX` is a half-extent either side of the slot; `radiusY` is upward ONLY
 * (see `offsetFor` — a slot puts the animal's feet on its tile's bottom edge,
 * so a symmetric vertical drift would spend half of every leg on the next tile
 * down). Both must stay under half a tile: for a chicken that is what keeps it
 * on the tile its `bounds()` answers on, and for a cow it is what keeps the
 * roam a whole number of tiles rather than a smear across two. A test pins it
 * rather than trusting the numbers to look small.
 *
 * A cow's `radiusX` is not much larger than a chicken's despite its yard being
 * spaced twice as wide, and that is now load-bearing rather than incidental:
 * see `roamTilesUp` for why a cow has no horizontal room at all at full
 * occupancy.
 *
 * `legMs` is how long one drift takes end to end, and `moveFraction` how much
 * of that is spent moving rather than posing — a cow that ambles for two
 * seconds and then chews for two reads as an animal; one that moves constantly
 * reads as a screensaver.
 */
export const WANDER = {
  chicken: {
    radiusX: 5,
    radiusY: 4,
    legMs: 2600,
    moveFraction: 0.45,
    roamTilesUp: 0,
    roamTilesDown: 0,
  },
  cow: {
    radiusX: 6,
    radiusY: 4,
    legMs: 4200,
    moveFraction: 0.5,
    // Down only. Two of the nine cow columns have a maple tree's base directly
    // above them — see `roamTilesUp`.
    roamTilesUp: 0,
    roamTilesDown: 2,
  },
} as const satisfies Record<AnimalKind, WanderTuning>;

export interface WanderTuning {
  /** Half-extent in px from the slot centre, horizontally. */
  readonly radiusX: number;
  readonly radiusY: number;
  /** One drift, end to end, in ms. */
  readonly legMs: number;
  /** Fraction of a leg spent moving; the rest is spent holding a pose. */
  readonly moveFraction: number;
  /**
   * Whole tiles this kind may leave its home tile by, VERTICALLY (T-16.04).
   *
   * Zero for chickens, and that is D-15 rather than a value waiting to be
   * tuned: their sheet has no walk cycle, so a translating chicken slides.
   *
   * **Vertical only**, because horizontally there is no room at all.
   * `BARN_YARD` spaces cows 2 tiles apart and the cow sprite is 32px —
   * precisely 2 tiles — so at the worst case the barn supports (tier-2 cap 6
   * plus VIP 3 = 9 cows, which is every slot) two neighbours abut exactly.
   * Roaming sideways would overlap them, and once `Animal.bounds()` follows the
   * sprite (T-16.06) that is not merely ugly: it is two cows answering on one
   * tile, which is the D-14 trap in a new costume.
   *
   * **Downward only, and that was found by a test rather than by looking.** The
   * yard row is y=18. Two of the nine cow columns — x=2 and x=18 — have a maple
   * tree's collision base sitting directly above them at y=17, so a cow allowed
   * one tile up would spend part of its life standing inside a tree, in a spot
   * the player cannot walk to. Nothing prevents that at runtime: animals are
   * not solid (D-14) and the wander is pure arithmetic over a slot that never
   * consults the block map. Below the row the band really is empty for every
   * column, so the roam goes south into it.
   *
   * `reachability.test.ts` proves all of this against the worst-case world at
   * full occupancy rather than trusting this comment — which is how the trees
   * turned up, after an earlier hand-check of the same band mis-anchored the
   * tree footprints and declared it clear.
   */
  readonly roamTilesUp: number;
  readonly roamTilesDown: number;
}

/** True when a kind roams beyond its home tile at all (T-16.04). */
export function roams(kind: AnimalKind): boolean {
  return WANDER[kind].roamTilesUp > 0 || WANDER[kind].roamTilesDown > 0;
}
