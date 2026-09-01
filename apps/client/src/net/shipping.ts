import { api, idempotencyKey } from './api.js';

/**
 * Shipping box API wrapper (CLAUDE.md §5.6).
 *
 * The client says WHAT and HOW MANY, never what it is worth: the payout is
 * computed server-side at settlement, from config the client only ever reads
 * for display (§4.1). Reading the box is what makes it pay — settlement happens
 * on read, so `fetchShipping` can return gold that was just credited.
 */

export interface PendingShipment {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly depositedAt: number;
  /** What it will fetch at today's price. */
  readonly payout: number;
  /** ms until it pays out; 0 means "next time anyone looks". */
  readonly paysOutInMs: number;
}

export interface PaidShipment {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly paidAt: number;
  /** What was actually credited, from the row. */
  readonly payout: number;
}

export interface ShippingView {
  readonly pending: PendingShipment[];
  readonly paid: PaidShipment[];
  /** Gold this very request credited. Non-zero means something just settled. */
  readonly justPaid: number;
  readonly payoutMs: number;
}

export interface DepositResult {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly depositedAt: number;
  readonly payout: number;
  readonly paysOutInMs: number;
}

export function fetchShipping(): Promise<ShippingView> {
  return api.get<ShippingView>('/shipping');
}

/** One key per deposit, reused if that deposit is retried (CLAUDE.md §4.5). */
export function depositItem(
  itemId: string,
  quantity: number,
  key = idempotencyKey(),
): Promise<DepositResult> {
  return api.post<DepositResult>('/shipping/deposit', {
    itemId,
    quantity,
    idempotencyKey: key,
  });
}
