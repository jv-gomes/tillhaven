import type { FarmState, IdleSettings } from '@tillhaven/shared/types';
import type { CropId, IdleTask } from '@tillhaven/shared/config';
import { api, idempotencyKey } from './api.js';

/**
 * Farm API wrapper.
 *
 * The client sends INTENTS and renders whatever the server says came of them
 * (CLAUDE.md §4.1). Nothing here computes a growth stage, a gold total, or an
 * item count — those all arrive from the server.
 */

export interface PlantResult {
  readonly plotId: string;
  readonly cropId: CropId;
  readonly plantedAt: number;
  readonly readyAt: number;
}

export interface HarvestResult {
  readonly plotId: string;
  readonly itemId: string;
  readonly quantity: number;
}

export interface InventorySlot {
  readonly slotIndex: number;
  readonly itemId: string;
  readonly quantity: number;
}

export function fetchFarm(): Promise<FarmState> {
  return api.get<FarmState>('/farm');
}

export function fetchInventory(): Promise<{ slots: InventorySlot[] }> {
  return api.get<{ slots: InventorySlot[] }>('/farm/inventory');
}

/**
 * One idempotency key per user action, generated at the call site and reused
 * across retries of THAT action (CLAUDE.md §4.5). A resubmitted plant after a
 * dropped connection must not consume two seeds.
 */
export function plant(plotId: string, cropId: CropId, key = idempotencyKey()): Promise<PlantResult> {
  return api.post<PlantResult>('/farm/plant', { plotId, cropId, idempotencyKey: key });
}

export interface TillResult {
  readonly plotId: string;
  readonly tilledAt: number;
}

export interface WaterResult {
  readonly plotId: string;
  readonly wateredAt: number;
  readonly wetUntil: number;
  readonly grownMs: number;
}

/**
 * Neither of these says which tool was swung, and neither should: the equipped
 * item is client-side state, and a server that took the client's word for what
 * is in hand would be trusting the client to say it owns a hoe (§5.1).
 */
export function till(plotId: string, key = idempotencyKey()): Promise<TillResult> {
  return api.post<TillResult>('/farm/till', { plotId, idempotencyKey: key });
}

export function water(plotId: string, key = idempotencyKey()): Promise<WaterResult> {
  return api.post<WaterResult>('/farm/water', { plotId, idempotencyKey: key });
}

export function harvest(plotId: string, key = idempotencyKey()): Promise<HarvestResult> {
  return api.post<HarvestResult>('/farm/harvest', { plotId, idempotencyKey: key });
}

export interface ExpansionPlot {
  readonly plotId: string;
  readonly cost: number;
  readonly index: number;
}

export interface UnlockResult {
  readonly plotId: string;
  readonly cost: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
  readonly unlockedPlots: number;
  readonly plotCap: number;
}

/** What each remaining plot would cost. Prices are the server's, always. */
export function fetchExpansion(): Promise<{ plots: ExpansionPlot[] }> {
  return api.get<{ plots: ExpansionPlot[] }>('/farm/expansion');
}

/** Buys one locked plot. The client sends an id and no price (§4.1). */
export function unlockPlot(plotId: string, key = idempotencyKey()): Promise<UnlockResult> {
  return api.post<UnlockResult>('/farm/unlock', { plotId, idempotencyKey: key });
}

export interface IdleIntent {
  readonly enabled: boolean;
  readonly tasks: readonly IdleTask[];
  /** `null` means "sow nothing" — a real setting, not an omission. */
  readonly cropId: CropId | null;
}

/**
 * Replaces the farmer's standing orders (T-13.06).
 *
 * A PUT because the server replaces the whole resource: an absent task is a
 * task switched off, not one left alone. So every call sends the complete
 * settings, never a delta — a panel that posted only what changed would switch
 * off everything it did not mention.
 */
export function setIdle(intent: IdleIntent, key = idempotencyKey()): Promise<IdleSettings> {
  return api.put<IdleSettings>('/farm/idle', { ...intent, idempotencyKey: key });
}

export function logout(): Promise<unknown> {
  return api.post('/auth/logout');
}
