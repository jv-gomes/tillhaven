import { Season, SEASONS } from './season.js';
import { pick, noise } from './rng.js';

/**
 * The river fish (T-34.01, CLAUDE.md §4.4).
 *
 * **Eighteen, not nine.** The task said nine; `Icons/Fish/River/` holds
 * eighteen, each a 64x16 strip of four 16x16 frames. Using all of them beats
 * inventing a subset, because the pack is what decides how much content there
 * is — and this is the third time a phase brief has been wrong about the pack's
 * contents (T-31.01's frame counts, T-33.03's premade townsfolk), which is why
 * every one of these tasks starts by counting rather than reading.
 *
 * **Rarity is a weight, not a probability**, so a level gate can remove a fish
 * from the table without every other number having to be re-tuned to keep the
 * total at 1. `rollFish` renormalises over whatever is actually available.
 *
 * **Nothing here rolls anything.** The server owns the roll (T-34.02) and this
 * is the table it rolls against; the client reads the same table to draw a fish
 * it has been TOLD it caught. A client that could roll would be a client that
 * could choose (§4.1).
 */

export interface FishDef {
  readonly id: string;
  readonly name: string;
  /**
   * Relative rarity. Higher is commoner. Never zero — a fish nothing can catch
   * is content that exists only in a config file, and `fish.test.ts` refuses it.
   */
  readonly weight: number;
  /** Farm level at which this fish starts appearing in the river. */
  readonly unlockLevel: number;
  /**
   * When it bites. **Present and unenforced**, exactly as `CROPS.seasons` is
   * (T-31.03): the MVP is spring-only, so this changes nothing today and means
   * Phase 35 is one line per fish rather than a migration-shaped problem.
   */
  readonly seasons: readonly Season[];
  /** Integer gold at the merchant (§10). */
  readonly sellPrice: number;
  /**
   * How hard it fights, 1–5, for the reel minigame (T-34.03).
   *
   * Correlated with rarity on purpose: the fish worth catching should be the
   * fish that can get away, or the minigame is a formality attached to a
   * lottery. It is a separate number rather than derived from `weight` because
   * the two want to diverge — a common fish that fights hard is a good teaching
   * fish, and that is a decision this field leaves open.
   */
  readonly difficulty: number;
}

const ALL: readonly Season[] = SEASONS;
const SPRING_SUMMER: readonly Season[] = [Season.SPRING, Season.SUMMER];
const SPRING_FALL: readonly Season[] = [Season.SPRING, Season.FALL];
const FALL_WINTER: readonly Season[] = [Season.FALL, Season.WINTER];

/**
 * The table.
 *
 * Five bands, and the bands are the design: **the value of a fish rises with
 * its rarity and so does its difficulty**, so a long session trends toward a
 * memorable catch rather than toward a bigger pile of the same fish.
 *
 * **Every fish is in spring**, bar the two that are deliberately not — a
 * spring-only MVP that shipped fish nobody can catch would be shipping inert
 * content, and Phase 35's job is to make their absence *felt*, not to reveal
 * them for the first time. `fish.test.ts` requires every season to hold enough
 * fish to be worth fishing in, which is what stops a future edit from emptying
 * one.
 */
export const FISH: readonly FishDef[] = Object.freeze([
  // Common. What a new farm pulls out of the water all afternoon.
  { id: 'carp', name: 'Carp', weight: 100, unlockLevel: 1, seasons: ALL, sellPrice: 30, difficulty: 1 },
  { id: 'chub', name: 'Chub', weight: 100, unlockLevel: 1, seasons: ALL, sellPrice: 26, difficulty: 1 },
  { id: 'perch', name: 'Perch', weight: 100, unlockLevel: 1, seasons: SPRING_FALL, sellPrice: 34, difficulty: 1 },
  { id: 'sunfish', name: 'Sunfish', weight: 100, unlockLevel: 1, seasons: SPRING_SUMMER, sellPrice: 28, difficulty: 1 },
  { id: 'shad', name: 'Shad', weight: 100, unlockLevel: 1, seasons: ALL, sellPrice: 40, difficulty: 2 },

  // Uncommon. The reason to keep casting once the novelty has gone.
  { id: 'bullhead_catfish', name: 'Bullhead Catfish', weight: 55, unlockLevel: 2, seasons: ALL, sellPrice: 75, difficulty: 2 },
  { id: 'large_mouth_bass', name: 'Large Mouth Bass', weight: 55, unlockLevel: 2, seasons: SPRING_SUMMER, sellPrice: 95, difficulty: 3 },
  { id: 'walleye', name: 'Walleye', weight: 55, unlockLevel: 3, seasons: SPRING_FALL, sellPrice: 88, difficulty: 3 },
  { id: 'pike', name: 'Pike', weight: 55, unlockLevel: 3, seasons: ALL, sellPrice: 110, difficulty: 3 },
  { id: 'tiger_trout', name: 'Tiger Trout', weight: 55, unlockLevel: 4, seasons: FALL_WINTER, sellPrice: 120, difficulty: 4 },

  // Rare. Worth telling somebody about.
  { id: 'sturgeon', name: 'Sturgeon', weight: 18, unlockLevel: 5, seasons: ALL, sellPrice: 220, difficulty: 4 },
  { id: 'dorado', name: 'Dorado', weight: 18, unlockLevel: 5, seasons: SPRING_SUMMER, sellPrice: 260, difficulty: 4 },
  { id: 'ghost_catfish', name: 'Ghost Catfish', weight: 18, unlockLevel: 6, seasons: ALL, sellPrice: 195, difficulty: 4 },
  { id: 'bone_fish', name: 'Bone Fish', weight: 18, unlockLevel: 6, seasons: FALL_WINTER, sellPrice: 240, difficulty: 5 },

  // Very rare. A story.
  { id: 'zombie_fish', name: 'Zombie Fish', weight: 5, unlockLevel: 7, seasons: ALL, sellPrice: 380, difficulty: 5 },
  { id: 'dynamite_fish', name: 'Dynamite Fish', weight: 5, unlockLevel: 7, seasons: ALL, sellPrice: 340, difficulty: 5 },
  { id: 'faeries_fish', name: 'Faeries Fish', weight: 5, unlockLevel: 8, seasons: SPRING_SUMMER, sellPrice: 430, difficulty: 5 },

  /*
   * The one everybody knows about.
   *
   * **Weight 4 and 540g, both corrected by this file's own tests.** It was
   * weight 6 — chosen to land inside the odds band — which made it COMMONER
   * than the very-rare band while paying nearly twice as much, exactly the
   * rarity-and-value inversion that makes a rare drop a disappointment. And it
   * was 700g, above the dearest crop, which put the whole fishing economy
   * outside the band it is supposed to sit in. Four is still 1 in ~216, inside
   * the window.
   */
  { id: 'golden_fish', name: 'Golden Fish', weight: 4, unlockLevel: 9, seasons: ALL, sellPrice: 540, difficulty: 5 },
]);

export const FISH_IDS: readonly string[] = FISH.map((f) => f.id);

const BY_ID = new Map(FISH.map((f) => [f.id, f]));

export function fishById(id: string): FishDef | undefined {
  return BY_ID.get(id);
}

/**
 * How rare the rarest fish is allowed to be.
 *
 * **This is the "genuinely rare without being a slot machine" line, written as
 * a number so it can be checked.** Too common and the Golden Fish is just
 * another fish; too rare and the player is pulling a lever rather than fishing.
 * At the low end of this band a dedicated session reaches it; at the high end it
 * is still a thing that happens to you rather than a thing you farm.
 */
export const RAREST_MIN_ODDS = 1 / 250;
export const RAREST_MAX_ODDS = 1 / 60;

/** Every fish a farm at this level and season can hook. */
export function fishFor(farmLevel: number, season: Season): FishDef[] {
  return FISH.filter((f) => f.unlockLevel <= farmLevel && f.seasons.includes(season));
}

/** Total weight of a table, for turning weights into probabilities. */
export function totalWeight(table: readonly FishDef[]): number {
  return table.reduce((sum, f) => sum + f.weight, 0);
}

/** The chance of hooking this fish, given everything else available. */
export function oddsOf(fish: FishDef, table: readonly FishDef[]): number {
  const total = totalWeight(table);
  return total > 0 ? fish.weight / total : 0;
}

/**
 * Rolls a fish out of the available table.
 *
 * **The server calls this and the client never does** (§4.1). Seeded rather
 * than `Math.random()` for the same reason everything else in this codebase is:
 * a roll that cannot be reproduced cannot be tested, and this one decides what a
 * player is paid.
 *
 * Walks the cumulative weights rather than using `pick`, because `pick` is
 * uniform over a count and these are weighted — a uniform draw would make the
 * Golden Fish as likely as a Carp.
 */
export function rollFish(seed: number, n: number, table: readonly FishDef[]): FishDef | undefined {
  const total = totalWeight(table);
  if (total <= 0) return undefined;

  let roll = noise(seed, n) * total;
  for (const fish of table) {
    roll -= fish.weight;
    if (roll < 0) return fish;
  }
  // Floating point can leave `roll` at exactly 0 after the last subtraction.
  return table[table.length - 1];
}

/**
 * What one cast is worth on average, before any cost of casting.
 *
 * The number T-34.09 will balance against farming, and the one this file's own
 * test bounds so a price edit cannot quietly make fishing the only sensible
 * thing to do. Uses `pick` nowhere — it is arithmetic over the table, not a
 * simulation.
 */
export function expectedValue(table: readonly FishDef[]): number {
  const total = totalWeight(table);
  if (total <= 0) return 0;
  return table.reduce((sum, f) => sum + (f.weight / total) * f.sellPrice, 0);
}

/** Re-exported so a caller reaching for a seeded roll finds it here. */
export { pick };
