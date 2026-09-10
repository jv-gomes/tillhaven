import type { AnimalKind, AnimalVariant } from '@tillhaven/shared/config';
import { api, idempotencyKey } from './api.js';

/**
 * Animal API wrapper.
 *
 * Intents only: which animal, and what to do with it. The client never states
 * how much produce is owed, when the animal matures, or what feeding costs —
 * the server knows all three (CLAUDE.md §4.1).
 */

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
  /**
   * Lifetime experience after this collection, and the level it derives to
   * (T-30.04).
   *
   * The **third** place this same omission was found: the server has returned
   * both since T-2.09 (`modules/animals/service.ts`), and this type not
   * declaring them is the only reason the client never saw them. Same fix as
   * `HarvestResult` in T-30.02 — a declaration, not a feature.
   */
  readonly experience: number;
  readonly farmLevel: number;
}

export interface FeedResult {
  readonly animalId: string;
  readonly itemId: string;
  readonly fedUntil: number;
}

export function buyAnimal(
  kind: AnimalKind,
  variant: AnimalVariant,
  key = idempotencyKey(),
): Promise<BuyAnimalResult> {
  return api.post<BuyAnimalResult>('/animals/buy', { kind, variant, idempotencyKey: key });
}

export function collectAnimal(animalId: string, key = idempotencyKey()): Promise<CollectResult> {
  return api.post<CollectResult>('/animals/collect', { animalId, idempotencyKey: key });
}

export function feedAnimal(animalId: string, key = idempotencyKey()): Promise<FeedResult> {
  return api.post<FeedResult>('/animals/feed', { animalId, idempotencyKey: key });
}

export interface CollectAllResult {
  readonly collected: readonly CollectResult[];
  /** Produce was left with its animal because the bag filled (T-24.02). */
  readonly stoppedByFullBag: boolean;
  /** True when the batch stopped because the farmer ran out of energy. */
  readonly stoppedByEnergy: boolean;
}

/**
 * Collects from every ready animal — the VIP `autoCollect` benefit (T-24.02).
 * No animal list, for the same reason `harvestAll` sends no plot list.
 */
export function collectAllAnimals(key = idempotencyKey()): Promise<CollectAllResult> {
  return api.post<CollectAllResult>('/animals/collect-all', { idempotencyKey: key });
}
