import { and, asc, eq, sql } from 'drizzle-orm';
import {
  ANIMALS,
  ErrorCode,
  GameError,
  benefitsFor,
  buildingCap,
  isAnimalKind,
  type AnimalBuilding,
  type AnimalKind,
  type AnimalVariant,
  EnergyAction,
} from '@tillhaven/shared';
import { schema } from '../../db/client.js';
import type { Queryable, Tx } from '../../db/tx.js';
import type { AuthedPlayer } from '../../middleware/auth.js';
import { readEnergyRow, spendEnergy } from '../farm/energy.js';
import { farmTiers, type FarmTiers } from '../farm/tiers.js';
import { addItem, removeItem, capacityForPlayer, Container } from '../inventory/service.js';
import { collectAt, feedAt, productionAt } from './production.js';
import { grantXp, levelForXp, xpForCollect } from '../farm/level.js';

/**
 * Animals: buying, collecting, feeding (CLAUDE.md §5.3).
 *
 * All the timestamp arithmetic lives in `production.ts` and is pure. This file
 * is the part that touches rows: it locks, checks ownership, moves items and
 * gold, and writes back what the pure functions worked out.
 *
 * **Nothing here deletes an animal, and nothing anywhere else does either.**
 * An animal left unfed stops producing and nothing more — §5.3 rules out
 * permanent loss, because it is bad retention in a casual idle game and it
 * turns a forgotten week into a destroyed purchase. A test asserts no `delete`
 * against the animals table exists in the whole source tree.
 */

/** What the player is told after each intent. */
export interface BuyAnimalResult {
  readonly animalId: string;
  readonly kind: AnimalKind;
  readonly variant: AnimalVariant;
  readonly maturesAt: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
}

export interface CollectResult {
  readonly animalId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly experience: number;
  readonly farmLevel: number;
}

export interface FeedResult {
  readonly animalId: string;
  readonly itemId: string;
  readonly fedUntil: number;
}

/**
 * Locks the player row and returns their gold.
 *
 * Taken first by every intent that spends, in the same order as the shop's, so
 * a purchase and a sale racing on one account cannot deadlock. It also
 * serialises purchases per player, which is what makes the animal-cap check
 * below meaningful rather than a suggestion two concurrent buys can step past.
 */
async function lockPlayerGold(tx: Tx, playerId: string): Promise<number> {
  const rows = await tx
    .select({ gold: schema.players.gold })
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .limit(1)
    .for('update');

  const row = rows[0];
  if (!row) throw new GameError(ErrorCode.NOT_FOUND, 'No such player.');
  return row.gold;
}

/**
 * Loads an animal and proves the caller owns it.
 *
 * An animal belonging to someone else and an animal that does not exist give
 * the same answer — distinguishing them would confirm that a given id is real
 * (§8: ownership is checked on every request, and never inferred from an id).
 */
async function lockOwnedAnimal(tx: Tx, playerId: string, animalId: string) {
  const rows = await tx
    .select({ animal: schema.animals, farmPlayerId: schema.farms.playerId })
    .from(schema.animals)
    .innerJoin(schema.farms, eq(schema.animals.farmId, schema.farms.id))
    .where(eq(schema.animals.id, animalId))
    .limit(1)
    .for('update', { of: schema.animals });

  const row = rows[0];
  if (!row || row.farmPlayerId !== playerId) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That animal is not on your farm.');
  }
  return row.animal;
}

/** The tier the farm has bought for one building. */
export function tierOf(tiers: FarmTiers | null, building: AnimalBuilding): number {
  if (!tiers) return 0;
  return building === 'coop' ? tiers.coopTier : tiers.barnTier;
}

/**
 * How many animals of one KIND a farm may hold (T-12.02).
 *
 * Per kind, not per farm: the cap comes from the building that kind lives in
 * (`ANIMALS[kind].building`), so a full coop says nothing about the barn. The
 * previous farm-wide number let twelve chickens make a cow unbuyable, which is
 * not a decision a player ever meant to make.
 *
 * Nothing here caches. The cap is recomputed from the farm's tier every time
 * it is needed, so an upgrade takes effect on the very next request rather
 * than on some later refresh.
 */
export async function animalCapFor(
  q: Queryable,
  player: AuthedPlayer,
  kind: AnimalKind,
  now: number,
): Promise<number> {
  const tiers = await farmTiers(q, player.id);
  const building = ANIMALS[kind].building;

  return buildingCap(building, tierOf(tiers, building), benefitsFor(player, now).bonusAnimalCap);
}

/**
 * Animals of one kind on a farm.
 *
 * Counted by kind rather than in total, because that is what the cap is about
 * now. `kind` is a config-checked value from `isAnimalKind`, never raw input.
 */
async function countAnimals(tx: Tx, farmId: string, kind: AnimalKind): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.animals)
    .where(and(eq(schema.animals.farmId, farmId), eq(schema.animals.kind, kind)));

  return rows[0]?.count ?? 0;
}

/**
 * Buys an animal at the configured price.
 *
 * Gold leaves and the animal arrives in one transaction. The variant is
 * cosmetic and is checked against the kind's own list — a chicken cannot be
 * bought wearing a cow's colours, not because it matters mechanically but
 * because an unrecognised variant renders as a missing sprite later.
 *
 * **A new animal arrives unfed.** It costs nothing and produces nothing until
 * the player buys feed, which keeps animals a running cost rather than a
 * one-off purchase and avoids handing out free feed that `docs/economy.md`
 * would then have to account for. If onboarding proves this confusing, the
 * kinder alternative is a starting `fedUntil` — a balance decision (T-6.01),
 * not a mechanical one.
 */
export async function buyAnimal(
  tx: Tx,
  player: AuthedPlayer,
  kind: string,
  variant: string,
  now: number,
): Promise<BuyAnimalResult> {
  if (!isAnimalKind(kind)) {
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'No such animal.', { kind });
  }

  const def = ANIMALS[kind as AnimalKind];
  if (!def.variants.includes(variant as AnimalVariant)) {
    throw new GameError(ErrorCode.VALIDATION_FAILED, 'That is not a colour this animal comes in.', {
      kind,
      variant,
    });
  }

  const gold = await lockPlayerGold(tx, player.id);

  const tiers = await farmTiers(tx, player.id);
  if (!tiers) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That farm does not exist.');
  }

  const building = def.building;
  const [held, cap] = await Promise.all([
    countAnimals(tx, tiers.farmId, kind),
    animalCapFor(tx, player, kind, now),
  ]);

  if (held >= cap) {
    // Names the BUILDING, not the farm: "your coop is full" tells the player
    // which of the two upgrades to go and buy.
    throw new GameError(ErrorCode.ANIMAL_CAP_REACHED, `There is no room in your ${building}.`, {
      building,
      held,
      cap,
    });
  }

  if (gold < def.purchasePrice) {
    throw new GameError(ErrorCode.INSUFFICIENT_GOLD, "You can't afford that.", {
      needed: def.purchasePrice,
      held: gold,
    });
  }

  const maturesAt = now + def.maturityDurationMs;

  const inserted = await tx
    .insert(schema.animals)
    .values({
      farmId: tiers.farmId,
      kind,
      variant,
      name: null,
      acquiredAt: now,
      maturesAt,
      lastCollectedAt: now,
      fedUntil: null,
    })
    .returning({ id: schema.animals.id });

  await tx
    .update(schema.players)
    .set({ gold: sql`${schema.players.gold} - ${def.purchasePrice}` })
    .where(eq(schema.players.id, player.id));

  return {
    animalId: inserted[0]!.id,
    kind: kind as AnimalKind,
    variant: variant as AnimalVariant,
    maturesAt,
    goldDelta: -def.purchasePrice,
    goldAfter: gold - def.purchasePrice,
  };
}

/**
 * Collects everything an animal is owed, in one intent.
 *
 * If the bag is full, `addItem` throws and the whole transaction rolls back, so
 * the animal is still standing there with its produce waiting (§5.4). It is the
 * **transaction** that guarantees that, not the order of the two writes — both
 * happen on `tx`, so either both land or neither does. Doing the add first is
 * just the clearer reading order; a `db` handle sneaking in here instead of
 * `tx` is the mistake that would actually break it.
 */
export async function collect(
  tx: Tx,
  player: AuthedPlayer,
  animalId: string,
  now: number,
): Promise<CollectResult> {
  const animal = await lockOwnedAnimal(tx, player.id, animalId);
  const def = ANIMALS[animal.kind as AnimalKind];
  if (!def) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That animal no longer exists.');
  }

  const { durationPercent } = benefitsFor(player, now);

  const state = productionAt(animal, now, durationPercent);

  if (!state.isMature) {
    throw new GameError(ErrorCode.ANIMAL_NOT_MATURE, 'That one is still too young.', {
      readyInMs: animal.maturesAt - now,
    });
  }

  const collected = collectAt(animal, now, durationPercent);
  if (!collected) {
    /*
     * Two different reasons for an empty collection, and the player can act on
     * the difference: an unfed animal needs feeding, a fed one just needs time.
     */
    if (!state.isFed) {
      throw new GameError(ErrorCode.ANIMAL_UNFED, 'That one needs feeding before it produces.');
    }
    throw new GameError(ErrorCode.NOTHING_TO_COLLECT, 'Nothing is ready yet.', {
      readyInMs: state.readyInMs,
    });
  }

  await spendEnergy(tx, player, EnergyAction.COLLECT, now);

  const capacity = await capacityForPlayer(tx, player, Container.INVENTORY, now);

  // Throws INVENTORY_FULL and rolls back, leaving the produce with the animal.
  await addItem(tx, player.id, def.produceItemId, collected.quantity, { capacity });

  await tx
    .update(schema.animals)
    .set({ lastCollectedAt: collected.lastCollectedAt })
    .where(eq(schema.animals.id, animal.id));

  // Per production CYCLE, not per unit: a cow that yields three of something
  // is not three times the wait.
  const experience = await grantXp(tx, player.id, xpForCollect(animal.kind, collected.cyclesOwed));

  return {
    animalId: animal.id,
    itemId: def.produceItemId,
    quantity: collected.quantity,
    experience,
    farmLevel: levelForXp(experience),
  };
}

export interface CollectAllResult {
  readonly collected: readonly CollectResult[];
  /** Ready produce was left with its animal because the bag filled. */
  readonly stoppedByFullBag: boolean;
  /** True when the batch stopped because the farmer ran out of energy. */
  readonly stoppedByEnergy: boolean;
  readonly experience: number;
  readonly farmLevel: number;
}

/**
 * Collects from every ready animal in one intent — `VIP_BENEFITS.autoCollect`
 * (T-24.02, D-23). The twin of `harvestAll`, and the same three rules apply,
 * for the same reasons: it loops over the real `collect` rather than
 * reimplementing it, each animal gets its own savepoint (see `harvestAll` for
 * what that actually buys — it is not what it looks like), and animals are
 * taken in `id` order so two batches cannot deadlock.
 *
 * The one difference is what counts as "skip". A plot is either ripe or not; an
 * animal can be too young, unfed, or merely early, and all three mean *this one
 * has nothing for you right now* rather than an error. An unfed cow in the barn
 * must not stop the button from emptying the coop.
 */
export async function collectAll(
  tx: Tx,
  player: AuthedPlayer,
  now: number,
): Promise<CollectAllResult> {
  const benefits = benefitsFor(player, now);
  if (!benefits.autoCollect) {
    throw new GameError(ErrorCode.FORBIDDEN, 'Collecting everything at once is a VIP perk.');
  }

  // Unlocked scan; every candidate is re-checked under its row lock in `collect`.
  const rows = await tx
    .select({ animal: schema.animals })
    .from(schema.animals)
    .innerJoin(schema.farms, eq(schema.animals.farmId, schema.farms.id))
    .where(eq(schema.farms.playerId, player.id))
    .orderBy(asc(schema.animals.id));

  const ready = rows
    .map((r) => r.animal)
    .filter((animal) => {
      const def = ANIMALS[animal.kind as AnimalKind];
      if (!def) return false;
      return productionAt(animal, now, benefits.durationPercent).cyclesOwed > 0;
    });

  if (ready.length === 0) {
    throw new GameError(ErrorCode.NOTHING_TO_COLLECT, 'Nothing is ready to collect yet.');
  }

  const collected: CollectResult[] = [];
  let stoppedByFullBag = false;
  let stoppedByEnergy = false;

  for (const animal of ready) {
    try {
      // Re-read every iteration: `collect` charges energy with a conditional
      // update, so the session copy is stale after the first animal.
      const energy = await readEnergyRow(tx, player.id);
      const current: AuthedPlayer = { ...player, ...energy };

      const result = await tx.transaction((sp) => collect(sp as Tx, current, animal.id, now));
      collected.push(result);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      if (err.code === ErrorCode.INVENTORY_FULL) {
        stoppedByFullBag = true;
        break;
      }
      // Out of energy partway through: stop cleanly and report how far it got,
      // exactly as a full bag does.
      if (err.code === ErrorCode.INSUFFICIENT_ENERGY) {
        stoppedByEnergy = true;
        break;
      }
      if (
        err.code === ErrorCode.NOTHING_TO_COLLECT ||
        err.code === ErrorCode.ANIMAL_UNFED ||
        err.code === ErrorCode.ANIMAL_NOT_MATURE
      ) {
        continue;
      }
      throw err;
    }
  }

  if (collected.length === 0 && stoppedByEnergy) {
    throw new GameError(ErrorCode.INSUFFICIENT_ENERGY, 'You are too tired.');
  }
  if (collected.length === 0 && !stoppedByFullBag) {
    throw new GameError(ErrorCode.NOTHING_TO_COLLECT, 'Nothing is ready to collect yet.');
  }
  if (collected.length === 0) {
    throw new GameError(ErrorCode.INVENTORY_FULL, 'Your bag is full.');
  }

  const last = collected[collected.length - 1]!;
  return {
    collected,
    stoppedByFullBag,
    stoppedByEnergy,
    experience: last.experience,
    farmLevel: last.farmLevel,
  };
}

/**
 * Feeds an animal, consuming one unit of its feed item.
 *
 * `fedUntil` extends from `max(now, fedUntil)` so topping up early banks the
 * remainder rather than wasting it, and a feeding that revives a lapsed animal
 * also closes the unfed gap so it cannot pay out for the days it went hungry.
 * Both rules live in `feedAt`; this function only writes what it returns.
 */
export async function feed(
  tx: Tx,
  player: AuthedPlayer,
  animalId: string,
  now: number,
): Promise<FeedResult> {
  const animal = await lockOwnedAnimal(tx, player.id, animalId);
  const def = ANIMALS[animal.kind as AnimalKind];
  if (!def) {
    throw new GameError(ErrorCode.NOT_FOUND, 'That animal no longer exists.');
  }

  const { durationPercent } = benefitsFor(player, now);

  // Throws INSUFFICIENT_ITEMS and rolls back if they have none.
  await removeItem(tx, player.id, def.feedItemId, 1);

  const result = feedAt(animal, now, durationPercent);


  await spendEnergy(tx, player, EnergyAction.FEED, now);
  await tx
    .update(schema.animals)
    .set({ fedUntil: result.fedUntil, lastCollectedAt: result.lastCollectedAt })
    .where(eq(schema.animals.id, animal.id));

  return {
    animalId: animal.id,
    itemId: def.feedItemId,
    fedUntil: result.fedUntil,
  };
}
