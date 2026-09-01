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
