import { MODAL_ATTR } from '../lib/focus.js';
import { ITEMS } from '@tillhaven/shared/config';
import { messageFor, codeOf } from '../net/errors.js';
import { idempotencyKey } from '../net/api.js';
import { onTradeChanged } from '../net/realtime.js';
import type { TradeEligibility } from '@tillhaven/shared/types';
import {
  fetchCurrentTrade,
  fetchTradeHistory,
  inviteTrade,
  acceptTrade,
  cancelTrade,
  setTradeOffer,
  confirmTrade,
  executeTrade,
  type TradeHistoryEntry,
  type TradeView,
} from '../net/trade.js';

/**
 * The trade panel (T-4.11, CLAUDE.md §6).
 *
 * This is a VIEW over server state, not a place decisions get made. Every
 * button here sends an intent and re-renders from whatever comes back —
 * confirming, executing, even "am I ready" is read from the response, never
 * computed locally (CLAUDE.md §4.1). The one thing rendered from a diff
 * rather than the raw response is the reset banner below, and that diff only
 * decides whether to show a banner, never what the trade actually contains.
 */

export interface TradeHost {
  /** Deduplicated bag contents, for the offer builder's item picker. */
  bagItems(): { itemId: string; quantity: number }[];
  /**
   * Whether this player may trade yet, and why not (T-22.03).
   *
   * Null before the first poll lands. The server decides; this is the reason it
   * gives, so the panel can explain a temporary rule instead of letting the
   * player discover it by being refused.
   */
  eligibility(): TradeEligibility | null;
  /** Called after a trade completes, so the bag and gold can be re-synced. */
  onExecuted(): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  icon(itemId: string, scale?: number): HTMLElement | null;
}

/**
 * Why this player cannot trade yet, as a sentence, or null when they can.
 *
 * **The rule is not the problem; discovering it by refusal is.** Trading is
 * gated on a 24-hour account age and farm level 5 (§14), checked for both
 * parties at invite AND at execution. Before T-22.03 the panel showed the
 * invite form regardless of eligibility, so the only way to learn about the
 * gate was to type a friend's name and be told no — on the one feature in the
 * game with a deliberate waiting period, which reads as a broken button.
 *
 * A free function rather than a method so it can be tested without a DOM: the
 * branching is the substance, and the rendering is one `innerHTML`.
 */
export function blockedReason(state: TradeEligibility | null): string | null {
  // Null before the first poll — say nothing rather than guess, since the
  // overwhelmingly common case is that the player CAN trade.
  if (!state || state.eligible) return null;

  switch (state.blockedBy) {
    case 'account_too_new': {
      // Rounded UP. "0 hours to go" on a gate that has not opened is a lie the
      // player will hold you to a minute later.
      const hours = Math.ceil(state.accountAgeRemainingMs / (60 * 60 * 1000));
      return `New farms cannot trade for their first day — about ${hours} hour${
        hours === 1 ? '' : 's'
      } to go.`;
    }
    case 'farm_too_low':
      return `Your farm reaches trading at level ${state.requiredFarmLevel}. It is level ${state.farmLevel} — keep harvesting.`;
    case 'flagged':
      // Deliberately vague. The player is told they cannot trade, not the
      // details of a chargeback investigation.
      return 'Trading is unavailable on this account.';
    default:
      return 'You cannot trade yet.';
  }
}

/** Local counter, not the server's revision — just a redraw throttle for the countdown. */
const TICK_MS = 1000;
/** Fallback re-fetch while open, in case the socket is down (T-4.10 is best-effort). */
const POLL_MS = 8000;

export class TradePanel {
  private root!: HTMLElement;
  private bodyEl!: HTMLElement;
  private alertEl!: HTMLElement;
  private host!: TradeHost;
  private open = false;
  private inFlight = false;
  private trade: TradeView | null = null;
  /** The revision + confirmed flags last RENDERED, to detect a reset worth flagging. */
  private lastSeenRevision: number | null = null;
  private lastSeenYouConfirmed = false;
  private lastSeenThemConfirmed = false;
  private expiresAt = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private alertTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private view: 'trade' | 'history' = 'trade';
  private historyEntries: TradeHistoryEntry[] = [];
  private historyCursor: string | null = null;

  mount(host: TradeHost): HTMLElement {
    this.host = host;

    this.root = document.createElement('section');
    this.root.className = 'trade';
    // A dialog the player is reading, so it takes movement input (T-18.12).
    // `isModalOpen` finds it by this attribute; see `lib/focus.ts`.
    this.root.setAttribute(MODAL_ATTR, '');
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Trade');
    this.root.innerHTML = `
      <header class="trade__head">
        <span class="trade__title">Trade</span>
        <span class="trade__expiry" data-expiry></span>
        <button class="trade__history-toggle" type="button" data-toggle-history>History</button>
        <button class="trade__close" type="button" data-close aria-label="Close trade"><i class="ui-icon" style="--icon-col: 15" aria-hidden="true"></i></button>
      </header>
      <div class="trade__alert" data-alert hidden role="alert"></div>
      <div class="trade__body" data-body></div>
    `;

    this.bodyEl = this.root.querySelector('[data-body]')!;
    this.alertEl = this.root.querySelector('[data-alert]')!;
    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.hide());
    this.root.querySelector('[data-toggle-history]')!.addEventListener('click', () => {
      this.view = this.view === 'trade' ? 'history' : 'trade';
      if (this.view === 'history') {
        this.historyEntries = [];
        this.historyCursor = null;
        void this.loadHistory();
      } else {
        this.render();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.open) return;
      /*
       * Consume the press (T-18.13, BUG-11). Phaser's keyboard plugin listens
       * on `window`; these panels listen on `document`, which is the last hop
       * before it — so stopping here is what keeps one Escape to one layer.
       * Without it, closing this panel ALSO ran the Interior scene's handler
       * and walked the player out of the house in the same press.
       *
       * `stopPropagation`, not `stopImmediatePropagation`: the other panels'
       * listeners are on this same node and are harmless (each checks its own
       * `open`), and silencing them would make this depend on registration
       * order, which is the thing that made the bug hard to see.
       */
      e.stopPropagation();
      this.hide();
    });

    // The push channel: any change to a trade either party is in re-fetches
    // and re-renders. This fires once on every (re)connect too (T-4.10), so
    // opening the panel is always working from fresh state, not a stale cache.
    this.unsubscribeRealtime = onTradeChanged(() => {
      if (this.open) void this.refresh();
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
    this.view = 'trade';
    await this.refresh();

    this.tickTimer = setInterval(() => this.renderCountdown(), TICK_MS);
    // Fallback only — the socket is the primary signal. If it is healthy this
    // just re-confirms what is already on screen.
    this.pollTimer = setInterval(() => void this.refresh(), POLL_MS);
  }

  hide(): void {
    this.open = false;
    this.root.hidden = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.hideAlert();
    this.tickTimer = null;
    this.pollTimer = null;
  }

  destroy(): void {
    this.hide();
    this.unsubscribeRealtime?.();
  }

  private async refresh(): Promise<void> {
    try {
      const { trade } = await fetchCurrentTrade();
      this.apply(trade);
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    }
  }

  /** Applies a freshly-fetched trade, flagging a reset before replacing state. */
  private apply(trade: TradeView | null): void {
    const wasCompleted = this.trade?.status === 'open' && trade?.status === 'completed';

    if (trade && trade.status === 'open' && this.lastSeenRevision !== null) {
      const revisionMoved = trade.revision !== this.lastSeenRevision;
      const someoneWasConfirmed = this.lastSeenYouConfirmed || this.lastSeenThemConfirmed;
      if (revisionMoved && someoneWasConfirmed && trade.id === this.trade?.id) {
        this.flashResetAlert();
      }
    }

    this.trade = trade;
    if (trade) {
      this.lastSeenRevision = trade.revision;
      this.lastSeenYouConfirmed = trade.you.confirmed;
      this.lastSeenThemConfirmed = trade.them.confirmed;
      this.expiresAt = Date.now() + trade.expiresInMs;
    } else {
      this.lastSeenRevision = null;
      this.lastSeenYouConfirmed = false;
      this.lastSeenThemConfirmed = false;
    }

    if (wasCompleted) {
      this.host.toast('Trade complete!');
      this.host.onExecuted();
    }

    this.render();
  }

  /**
   * The anti-scam affordance CLAUDE.md §6 asks for: an offer changing after
   * someone confirmed must be impossible to miss. A quiet re-render of the
   * confirmed checkboxes is not enough — this is a sticky banner PLUS a toast,
   * so it lands whether the player is looking at the panel body or not.
   */
  private flashResetAlert(): void {
    this.alertEl.hidden = false;
    this.alertEl.textContent = 'The offer changed — review it and confirm again.';
    this.host.toast('The offer changed. Both confirmations were reset.', 'error');

    if (this.alertTimer) clearTimeout(this.alertTimer);
    this.alertTimer = setTimeout(() => this.hideAlert(), 6000);
  }

  private hideAlert(): void {
    this.alertEl.hidden = true;
    this.alertEl.textContent = '';
    if (this.alertTimer) clearTimeout(this.alertTimer);
    this.alertTimer = null;
  }

  private render(): void {
    if (this.view === 'history') {
      this.hideAlert();
      this.renderHistory();
      return;
    }

    if (!this.trade) {
      this.hideAlert();
      this.renderInvite();
      return;
    }

    switch (this.trade.status) {
      case 'pending':
        this.hideAlert();
        this.renderPending(this.trade);
        break;
      case 'open':
        this.renderActive(this.trade);
        break;
      default:
        // COMPLETED, CANCELLED, EXPIRED all read the same from here: over,
        // nothing left to show. `apply` already toasted COMPLETED specifically.
        this.hideAlert();
        this.renderInvite();
    }

    this.renderCountdown();
  }

  private renderCountdown(): void {
    const el = this.root.querySelector<HTMLElement>('[data-expiry]')!;
    if (!this.trade || this.trade.status !== 'open') {
      el.textContent = '';
      return;
    }
    const remaining = Math.max(0, this.expiresAt - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const mm = Math.floor(seconds / 60);
    const ss = String(seconds % 60).padStart(2, '0');
    el.textContent = remaining > 0 ? `expires in ${mm}:${ss}` : 'expired';
  }

  /** Fetches the next page and appends — the list only ever grows while open. */
  private async loadHistory(): Promise<void> {
    try {
      const page = await fetchTradeHistory(this.historyCursor);
      this.historyEntries = [...this.historyEntries, ...page.entries];
      this.historyCursor = page.nextCursor;
      this.render();
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    }
  }

  /**
   * A player's own completed trades (T-4.12) — their record of what they
   * traded, read straight from what the server returned. No local reasoning
   * about who offered what; every field here is exactly what the response
   * named it.
   */
  private renderHistory(): void {
    this.bodyEl.innerHTML = `<div class="trade__history" data-list></div>`;
    const list = this.bodyEl.querySelector<HTMLElement>('[data-list]')!;

    if (this.historyEntries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'trade__empty';
      empty.textContent = 'No completed trades yet.';
      list.append(empty);
      return;
    }

    for (const entry of this.historyEntries) {
      const row = document.createElement('div');
      row.className = 'historyrow';

      const head = document.createElement('div');
      head.className = 'historyrow__head';
      const when = new Date(entry.completedAt).toLocaleString();
      head.textContent = `${entry.youWereInitiator ? 'You traded' : 'Traded'} with ${entry.counterpartyName} · ${when}`;

      const swap = document.createElement('div');
      swap.className = 'historyrow__swap';
      swap.append(
        this.renderHistorySide('You gave', entry.yourItems),
        Object.assign(document.createElement('span'), { className: 'historyrow__arrow', textContent: '↔' }),
        this.renderHistorySide('You got', entry.theirItems),
      );

      row.append(head, swap);
      list.append(row);
    }

    if (this.historyCursor) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'trade__btn';
      more.textContent = 'Load more';
      more.addEventListener('click', () => void this.loadHistory());
      list.append(more);
    }
  }

  private renderHistorySide(label: string, items: readonly { itemId: string; quantity: number }[]): HTMLElement {
    const el = document.createElement('span');
    el.className = 'historyrow__side';
    const text = items.length === 0
      ? 'nothing'
      : items.map((i) => `${ITEMS[i.itemId]?.name ?? i.itemId} × ${i.quantity}`).join(', ');
    el.textContent = `${label}: ${text}`;
    return el;
  }

  private renderInvite(): void {
    const blocked = blockedReason(this.host.eligibility());
    if (blocked !== null) {
      /*
       * No input at all, deliberately. A disabled field the player can type
       * into and not submit is a worse version of the same dead end — the
       * sentence IS the answer, and there is nothing useful to do here yet.
       */
      this.bodyEl.innerHTML = `<p class="trade__hint trade__hint--blocked">${escapeHtml(
        blocked,
      )}</p>`;
      return;
    }

    this.bodyEl.innerHTML = `
      <p class="trade__hint">Invite a farmer to trade by their farm name.</p>
      <div class="trade__invite">
        <input class="trade__input" type="text" data-username placeholder="Farm name" />
        <button class="trade__btn" type="button" data-invite>Invite</button>
      </div>
    `;
    const input = this.bodyEl.querySelector<HTMLInputElement>('[data-username]')!;
    this.bodyEl.querySelector('[data-invite]')!.addEventListener('click', () => {
      const username = input.value.trim();
      if (username) void this.doInvite(username);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) void this.doInvite(input.value.trim());
    });
  }

  private renderPending(trade: TradeView): void {
    if (trade.isInitiator) {
      this.bodyEl.innerHTML = `
        <p class="trade__hint">Waiting for ${escapeHtml(trade.them.username)} to accept…</p>
        <button class="trade__btn trade__btn--danger" type="button" data-cancel>Cancel</button>
      `;
    } else {
      this.bodyEl.innerHTML = `
        <p class="trade__hint">${escapeHtml(trade.them.username)} wants to trade with you.</p>
        <div class="trade__actions">
          <button class="trade__btn" type="button" data-accept>Accept</button>
          <button class="trade__btn trade__btn--danger" type="button" data-cancel>Decline</button>
        </div>
      `;
      this.bodyEl.querySelector('[data-accept]')!.addEventListener('click', () => void this.doAccept(trade.id));
    }
    this.bodyEl.querySelector('[data-cancel]')!.addEventListener('click', () => void this.doCancel(trade.id));
  }

  private renderActive(trade: TradeView): void {
    this.bodyEl.innerHTML = `
      <div class="trade__columns">
        <section class="trade__side" data-you>
          <h3 class="trade__sidehead">You <span class="trade__badge" data-you-badge></span></h3>
          <div class="trade__items" data-you-items></div>
          <div class="trade__add" data-add></div>
        </section>
        <section class="trade__side" data-them>
          <h3 class="trade__sidehead">${escapeHtml(trade.them.username)} <span class="trade__badge" data-them-badge></span></h3>
          <div class="trade__items" data-them-items></div>
        </section>
      </div>
      <div class="trade__actions">
        <button class="trade__btn" type="button" data-confirm></button>
        <button class="trade__btn trade__btn--primary" type="button" data-execute>Execute</button>
        <button class="trade__btn trade__btn--danger" type="button" data-cancel>Cancel</button>
      </div>
    `;

    this.renderSideBadge('[data-you-badge]', trade.you.confirmed, true);
    this.renderSideBadge('[data-them-badge]', trade.them.confirmed, false);
    this.renderItems('[data-you-items]', trade.you.items, true, trade);
    this.renderItems('[data-them-items]', trade.them.items, false, trade);
    this.renderAddPicker(trade);

    const confirmBtn = this.bodyEl.querySelector<HTMLButtonElement>('[data-confirm]')!;
    confirmBtn.textContent = trade.you.confirmed ? 'Confirmed ✓' : 'Confirm offer';
    confirmBtn.disabled = trade.you.confirmed;
    confirmBtn.addEventListener('click', () => void this.doConfirm(trade.id, trade.revision));

    const executeBtn = this.bodyEl.querySelector<HTMLButtonElement>('[data-execute]')!;
    executeBtn.disabled = !trade.readyToExecute;
    executeBtn.title = trade.readyToExecute ? '' : 'Both sides need to confirm first.';
    executeBtn.addEventListener('click', () => void this.doExecute(trade.id));

    this.bodyEl.querySelector('[data-cancel]')!.addEventListener('click', () => void this.doCancel(trade.id));
  }

  private renderSideBadge(selector: string, confirmed: boolean, isYou: boolean): void {
    const el = this.bodyEl.querySelector<HTMLElement>(selector)!;
    el.textContent = confirmed ? '✓ confirmed' : isYou ? 'not confirmed' : 'waiting';
    el.classList.toggle('is-confirmed', confirmed);
  }

  private renderItems(
    selector: string,
    items: TradeView['you']['items'],
    editable: boolean,
    trade: TradeView,
  ): void {
    const el = this.bodyEl.querySelector<HTMLElement>(selector)!;
    el.replaceChildren();

    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'trade__empty';
      empty.textContent = 'Nothing offered yet.';
      el.append(empty);
      return;
    }

    for (const entry of items) {
      const row = document.createElement('div');
      row.className = 'traderow';

      const icon = document.createElement('span');
      icon.className = 'traderow__icon';
      const art = this.host.icon(entry.itemId, 2);
      if (art) icon.append(art);

      const name = document.createElement('span');
      name.className = 'traderow__name';
      name.textContent = `${ITEMS[entry.itemId]?.name ?? entry.itemId} × ${entry.quantity}`;

      row.append(icon, name);

      if (editable) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'traderow__remove';
        /*
         * The pack's own cross, not the character. Column 15 of
         * `ui-button.png`'s 16px icon grid — the same glyph every panel's close
         * button wears since U3-7, so "remove this" reads the same everywhere.
         * `aria-hidden` on the glyph because the button already says what it
         * removes, and the item's name is the part that matters.
         */
        const removeIcon = document.createElement('i');
        removeIcon.className = 'ui-icon';
        removeIcon.style.setProperty('--icon-col', '15');
        removeIcon.setAttribute('aria-hidden', 'true');
        remove.append(removeIcon);
        remove.setAttribute('aria-label', `Remove ${name.textContent} from your offer`);
        remove.addEventListener('click', () => {
          const next = trade.you.items.filter((i) => i.itemId !== entry.itemId);
          void this.doSetOffer(trade.id, next);
        });
        row.append(remove);
      }

      el.append(row);
    }
  }

  /** A small picker for adding one more item from the bag to the offer. */
  private renderAddPicker(trade: TradeView): void {
    const el = this.bodyEl.querySelector<HTMLElement>('[data-add]')!;
    el.replaceChildren();

    const offered = new Set(trade.you.items.map((i) => i.itemId));
    const available = this.host.bagItems().filter((i) => !offered.has(i.itemId) && i.quantity > 0);
    if (available.length === 0) return;

    const select = document.createElement('select');
    select.className = 'trade__select';
    select.setAttribute('aria-label', 'Item to add to your offer');
    for (const entry of available) {
      const opt = document.createElement('option');
      opt.value = entry.itemId;
      opt.textContent = `${ITEMS[entry.itemId]?.name ?? entry.itemId} (${entry.quantity} held)`;
      select.append(opt);
    }

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.className = 'trade__qty';
    qty.min = '1';
    qty.value = '1';

    const syncMax = () => {
      const held = available.find((a) => a.itemId === select.value)?.quantity ?? 1;
      qty.max = String(held);
      if (Number(qty.value) > held) qty.value = String(held);
    };
    select.addEventListener('change', syncMax);
    syncMax();

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'trade__btn';
    add.textContent = 'Add';
    add.addEventListener('click', () => {
      const held = available.find((a) => a.itemId === select.value)?.quantity ?? 0;
      const quantity = Math.max(1, Math.min(Math.floor(Number(qty.value)) || 1, held));
      const next = [...trade.you.items, { itemId: select.value, quantity }];
      void this.doSetOffer(trade.id, next);
    });

    el.append(select, qty, add);
  }

  private async doInvite(targetUsername: string): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const trade = await inviteTrade(targetUsername, idempotencyKey());
      this.apply(trade);
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
    }
  }

  private async doAccept(tradeId: string): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const trade = await acceptTrade(tradeId, idempotencyKey());
      this.apply(trade);
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
    }
  }

  private async doCancel(tradeId: string): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const trade = await cancelTrade(tradeId);
      this.apply(trade);
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
    }
  }

  private async doSetOffer(
    tradeId: string,
    items: readonly { itemId: string; quantity: number }[],
  ): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const trade = await setTradeOffer(tradeId, items, idempotencyKey());
      this.apply(trade);
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
    }
  }

  private async doConfirm(tradeId: string, revision: number): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const trade = await confirmTrade(tradeId, revision, idempotencyKey());
      this.apply(trade);
    } catch (err) {
      if (codeOf(err) === 'TRADE_OFFER_CHANGED') {
        // The server is more current than we are — re-fetch rather than show
        // a stale-revision error the player cannot act on.
        await this.refresh();
        return;
      }
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
    }
  }

  private async doExecute(tradeId: string): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const trade = await executeTrade(tradeId, idempotencyKey());
      this.apply(trade);
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
      // Holdings may have changed underneath (T-4.05's ownership re-check) —
      // refresh so the panel does not keep offering to execute a trade the
      // server already knows cannot go through as shown.
      await this.refresh();
    } finally {
      this.inFlight = false;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
