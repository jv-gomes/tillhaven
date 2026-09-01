import type { InteriorRoom } from '@tillhaven/shared/types';
import { api, idempotencyKey } from './api.js';

/**
 * House interior API.
 *
 * The client sends a piece and a cell. Whether that cell is legal — inside the
 * room, and not under something else — is the server's call every time
 * (CLAUDE.md §4.1); the client's own check is only there to grey out an obvious
 * mistake before the round trip.
 */

export interface PlacedFurniture {
  readonly id: string;
  readonly furnitureId: string;
  readonly x: number;
  readonly y: number;
}

export interface OwnedFurniture {
  readonly furnitureId: string;
  readonly quantity: number;
}

export interface InteriorView {
  readonly room: InteriorRoom;
  readonly placements: PlacedFurniture[];
  /** Owned but not placed — what the decoration tray offers. */
  readonly owned: OwnedFurniture[];
}

export interface CatalogueEntry {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly footprint: { readonly width: number; readonly height: number };
  readonly vipOnly: boolean;
  readonly tradeable: boolean;
}

export interface BuyFurnitureResult {
  readonly furnitureId: string;
  readonly owned: number;
  readonly goldDelta: number;
  readonly goldAfter: number;
}

/** Prices come from the server, not the client's copy of the config. */
export function fetchCatalogue(): Promise<{ furniture: CatalogueEntry[] }> {
  return api.get<{ furniture: CatalogueEntry[] }>('/house/catalogue');
}

export function buyFurniture(
  furnitureId: string,
  key = idempotencyKey(),
): Promise<BuyFurnitureResult> {
  return api.post<BuyFurnitureResult>('/house/buy', { furnitureId, idempotencyKey: key });
}

export function fetchInterior(): Promise<InteriorView> {
  return api.get<InteriorView>('/house');
}

export function placeFurniture(
  furnitureId: string,
  x: number,
  y: number,
  key = idempotencyKey(),
): Promise<PlacedFurniture> {
  return api.post<PlacedFurniture>('/house/place', { furnitureId, x, y, idempotencyKey: key });
}

export function moveFurniture(
  placementId: string,
  x: number,
  y: number,
  key = idempotencyKey(),
): Promise<PlacedFurniture> {
  return api.post<PlacedFurniture>('/house/move', { placementId, x, y, idempotencyKey: key });
}

export function removeFurniture(
  placementId: string,
  key = idempotencyKey(),
): Promise<{ id: string }> {
  return api.post<{ id: string }>('/house/remove', { placementId, idempotencyKey: key });
}
