import type { LookWindow } from '@tillhaven/shared/config';
import { api, idempotencyKey } from './api.js';

/**
 * Farm decoration API.
 *
 * The client sends a piece and a tile. Whether that tile is legal — free
 * ground, not beside a crop, not sealing the farm — is the server's call every
 * time (§4.1). The client runs `canPlaceDecor` too, but only so the placement
 * marker can turn red before the round trip; it is a courtesy, never a gate.
 */

export interface PlacedDecor {
  readonly id: string;
  readonly decorId: string;
  readonly x: number;
  readonly y: number;
}

export interface OwnedDecor {
  readonly decorId: string;
  readonly quantity: number;
}

export interface DecorView {
  readonly placements: PlacedDecor[];
  /** Owned but not put down — what the placement tray offers. */
  readonly owned: OwnedDecor[];
}

/**
 * A catalogue row as the SERVER describes it.
 *
 * Includes `look` and `sheet` because the client has to crop the right window
 * out of a kit to draw the piece, and `solid`/`footprint` because the placement
 * marker has to size and colour itself before anything is sent. Prices come
 * from here rather than from the client's own copy of the config, so the shop
 * can never quote a number the purchase then refuses (§4.4).
 */
export interface DecorCatalogueEntry {
  readonly id: string;
  readonly name: string;
  readonly sheet: string;
  readonly look: LookWindow;
  readonly footprint: { readonly width: number; readonly height: number };
  readonly price: number;
  readonly solid: boolean;
  readonly vipOnly: boolean;
  readonly tradeable: boolean;
}

export function fetchDecor(): Promise<DecorView> {
  return api.get<DecorView>('/decor');
}

export function fetchDecorCatalogue(): Promise<{ decor: DecorCatalogueEntry[] }> {
  return api.get<{ decor: DecorCatalogueEntry[] }>('/decor/catalogue');
}

export interface BuyDecorResult {
  readonly decorId: string;
  readonly owned: number;
  readonly goldAfter: number;
}

export function buyDecor(decorId: string): Promise<BuyDecorResult> {
  return api.post<BuyDecorResult>('/decor/buy', {
    decorId,
    idempotencyKey: idempotencyKey(),
  });
}

export function placeDecor(decorId: string, x: number, y: number): Promise<PlacedDecor> {
  return api.post<PlacedDecor>('/decor/place', {
    decorId,
    x,
    y,
    idempotencyKey: idempotencyKey(),
  });
}

export interface RemoveDecorResult {
  readonly decorId: string;
  readonly owned: number;
}

export function removeDecor(placementId: string): Promise<RemoveDecorResult> {
  return api.post<RemoveDecorResult>('/decor/remove', {
    placementId,
    idempotencyKey: idempotencyKey(),
  });
}
