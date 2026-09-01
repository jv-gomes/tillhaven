import { ITEMS } from '@tillhaven/shared/config';
import { messageFor } from '../net/errors.js';
import { idempotencyKey } from '../net/api.js';
import type { InventorySlot } from '../net/inventory.js';
import {
  depositItem,
  fetchShipping,
  type PaidShipment,
  type PendingShipment,
  type ShippingView,
} from '../net/shipping.js';

/**
 * The shipping box (T-11.03, CLAUDE.md §5.6).
 *
 * Sell without walking to the merchant: drop goods in, come back later, the
 * gold is there. The panel shows the three states that matters — what you can
 * ship, what is waiting, and what it paid.
 *
 * **Reading the box is what makes it pay.** Settlement happens on read
 * server-side (§4.2), so opening this panel can itself credit gold; when it
 * does, the response says how much and the panel says so out loud rather than
 * letting the number change quietly in the corner.
 *
 * Nothing here computes a payout for anything that has already sold: pending
 * rows show today's price as an estimate, and a paid row shows what the server
 * actually credited, from the row itself.
 */

/** Refresh cadence while the panel is open — countdowns tick locally. */
const TICK_MS = 1_000;

export interface ShippingHost {
  /** The bag, for the list of what can be shipped. Owned by the HUD. */
  slots(): readonly InventorySlot[];
  /** Called after a deposit or a settlement so the HUD can re-sync. */
  onChanged(): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  icon(itemId: string, scale?: number): HTMLElement | null;
}

const EMPTY: ShippingView = { pending: [], paid: [], justPaid: 0, payoutMs: 0 };

export class ShippingPanel {
  private root!: HTMLElement;
  private depositEl!: HTMLElement;
  private pendingEl!: HTMLElement;
  private paidEl!: HTMLElement;
  private host!: ShippingHost;

  private view: ShippingView = EMPTY;
  private open = false;
  private inFlight = false;
  private timer: number | null = null;

  mount(host: ShippingHost): HTMLElement {
    this.host = host;

    this.root = document.createElement('section');
    this.root.className = 'shipping';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Shipping box');
    this.root.innerHTML = `
      <header class="shipping__head">
        <span class="shipping__title">Shipping box</span>
        <button class="shipping__close" type="button" data-close aria-label="Close shipping box">×</button>
      </header>
      <p class="shipping__hint" data-hint></p>

      <section class="shipping__section" aria-label="Ship from your bag">
        <h3 class="shipping__label">Ship</h3>
        <div class="shipping__list" data-deposit></div>
      </section>

      <section class="shipping__section" aria-label="Waiting to sell">
        <h3 class="shipping__label">Waiting</h3>
        <div class="shipping__list" data-pending></div>
      </section>

      <section class="shipping__section" aria-label="Recently sold">
        <h3 class="shipping__label">Sold</h3>
        <div class="shipping__list" data-paid></div>
      </section>
    `;

    this.depositEl = this.root.querySelector('[data-deposit]')!;
    this.pendingEl = this.root.querySelector('[data-pending]')!;
    this.paidEl = this.root.querySelector('[data-paid]')!;

    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.hide());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.hide();
    });

    return this.root;
  }

  async toggle(): Promise<void> {
    if (this.open) {
      this.hide();
      return;
    }

    this.open = true;
    this.root.hidden = false;
    await this.refresh();

    /*
     * The countdowns tick locally between reads rather than polling the server
     * every second: `paysOutInMs` is measured from the response, so subtracting
     * elapsed time is exact until the next read corrects it.
     */
    this.timer = window.setInterval(() => this.render(), TICK_MS);
  }

  hide(): void {
    this.open = false;
    this.root.hidden = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Re-reads the box — which is also what settles it.
   *
   * `justPaid` is the gold this very request credited. Announcing it is the
   * point: the alternative is a balance that changes in the corner of the
   * screen with nothing to explain it.
   */
  async refresh(): Promise<void> {
    try {
      const before = Date.now();
      this.view = await fetchShipping();
      this.readAt = before;

      if (this.view.justPaid > 0) {
        this.host.toast(`The box sold your goods for ${this.view.justPaid.toLocaleString()}g.`);
        this.host.onChanged();
      }
      if (this.open) this.render();
    } catch (err) {
      if (this.open) this.host.toast(messageFor(err), 'error');
    }
  }

  /** When the current view was read, so countdowns can age locally. */
  private readAt = 0;

  private render(): void {
    const hint = this.root.querySelector('[data-hint]')!;
    const minutes = Math.round(this.view.payoutMs / 60_000);
    hint.textContent = `Goods left here sell themselves after about ${minutes} minutes, at the merchant's price.`;

    this.renderDeposit();
    this.renderPending();
    this.renderPaid();
  }

  /**
   * Everything shippable in the bag, one row each with a quantity.
   *
   * Unsellable items are left out entirely rather than shown and refused: the
   * server would answer `ITEM_NOT_SELLABLE`, and a row that exists only to say
   * no is a row that should not be there. Tools disappear from this list for
   * free, because they have no sell price.
   */
  private renderDeposit(): void {
    const totals = new Map<string, number>();
    for (const slot of this.host.slots()) {
      const item = ITEMS[slot.itemId];
      if (!item || item.shopSellPrice === null) continue;
      totals.set(slot.itemId, (totals.get(slot.itemId) ?? 0) + slot.quantity);
    }

    if (totals.size === 0) {
      this.depositEl.replaceChildren(emptyNote('Nothing in your bag sells.'));
      return;
    }

    this.depositEl.replaceChildren(
      ...[...totals].map(([itemId, held]) => this.depositRow(itemId, held)),
    );
  }

  private depositRow(itemId: string, held: number): HTMLElement {
    const item = ITEMS[itemId]!;
    const row = document.createElement('div');
    row.className = 'shiprow';

    const icon = document.createElement('span');
    icon.className = 'shiprow__icon';
    const art = this.host.icon(itemId, 2);
    if (art) icon.append(art);

    const name = document.createElement('span');
    name.className = 'shiprow__name';
    name.textContent = item.name;

    const meta = document.createElement('span');
    meta.className = 'shiprow__meta';
    meta.textContent = `${item.shopSellPrice}g each · ${held} held`;

    const quantity = document.createElement('input');
    quantity.className = 'shiprow__qty';
    quantity.type = 'number';
    quantity.min = '1';
    quantity.max = String(held);
    quantity.value = String(held);
    quantity.setAttribute('aria-label', `How many ${item.name} to ship`);

    const send = document.createElement('button');
    send.className = 'shiprow__btn';
    send.type = 'button';
    send.textContent = 'Ship';
    send.addEventListener('click', () => {
      // Clamped to what they hold — a courtesy, not a control: the server
      // re-checks and answers INSUFFICIENT_ITEMS regardless (§4.1).
      const wanted = Math.max(1, Math.min(held, Math.floor(Number(quantity.value) || 0)));
      void this.deposit(itemId, wanted);
    });

    row.append(icon, name, meta, quantity, send);
    return row;
  }

  private renderPending(): void {
    if (this.view.pending.length === 0) {
      this.pendingEl.replaceChildren(emptyNote('Nothing waiting.'));
      return;
    }
    this.pendingEl.replaceChildren(...this.view.pending.map((s) => this.pendingRow(s)));
  }

  private pendingRow(shipment: PendingShipment): HTMLElement {
    const row = document.createElement('div');
    row.className = 'shiprow';

    const icon = document.createElement('span');
    icon.className = 'shiprow__icon';
    const art = this.host.icon(shipment.itemId, 2);
    if (art) icon.append(art);

    const name = document.createElement('span');
    name.className = 'shiprow__name';
    name.textContent = `${itemName(shipment.itemId)} ×${shipment.quantity}`;

    const meta = document.createElement('span');
    meta.className = 'shiprow__meta';
    meta.textContent = `${shipment.payout.toLocaleString()}g`;

    /*
     * Aged locally from the moment the view was read. A row whose countdown has
     * run out has not been paid yet — settlement happens on the next read — so
     * it says so rather than claiming a payout that has not happened.
     */
    const left = Math.max(0, shipment.paysOutInMs - (Date.now() - this.readAt));
    const clock = document.createElement('span');
    clock.className = 'shiprow__clock';
    clock.textContent = left > 0 ? formatLeft(left) : 'selling…';

    row.append(icon, name, meta, clock);
    return row;
  }

  private renderPaid(): void {
    if (this.view.paid.length === 0) {
      this.paidEl.replaceChildren(emptyNote('Nothing sold yet.'));
      return;
    }
    this.paidEl.replaceChildren(...this.view.paid.map((s) => paidRow(s, this.host)));
  }

  private async deposit(itemId: string, quantity: number): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const result = await depositItem(itemId, quantity, idempotencyKey());
      this.host.toast(
        `Shipped ${result.quantity} × ${itemName(result.itemId)} — ` +
          `${result.payout.toLocaleString()}g in ${formatLeft(result.paysOutInMs)}.`,
      );
      // The bag changed, so whoever owns it re-reads; then so do we.
      this.host.onChanged();
      await this.refresh();
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
      await this.refresh();
    } finally {
      this.inFlight = false;
    }
  }
}

function paidRow(shipment: PaidShipment, host: ShippingHost): HTMLElement {
  const row = document.createElement('div');
  row.className = 'shiprow is-paid';

  const icon = document.createElement('span');
  icon.className = 'shiprow__icon';
  const art = host.icon(shipment.itemId, 2);
  if (art) icon.append(art);

  const name = document.createElement('span');
  name.className = 'shiprow__name';
  name.textContent = `${itemName(shipment.itemId)} ×${shipment.quantity}`;

  const meta = document.createElement('span');
  meta.className = 'shiprow__meta';
  // What was ACTUALLY credited, from the row — never recomputed from today's
  // price, which may have moved since (§5.8).
  meta.textContent = `+${shipment.payout.toLocaleString()}g`;

  row.append(icon, name, meta);
  return row;
}

function emptyNote(text: string): HTMLElement {
  const note = document.createElement('p');
  note.className = 'shipping__empty';
  note.textContent = text;
  return note;
}

function itemName(itemId: string): string {
  return ITEMS[itemId]?.name ?? itemId.replace(/_/g, ' ');
}

function formatLeft(ms: number): string {
  const total = Math.ceil(ms / 1000);
  if (total >= 60) return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
  return `${total}s`;
}
