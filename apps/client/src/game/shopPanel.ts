import { MODAL_ATTR } from '../lib/focus.js';
import {
  ANIMALS,
  ANIMAL_BUILDINGS,
  ANIMAL_KINDS,
  ANIMAL_VARIANTS,
  ITEMS,
  VIP_BENEFITS,
  BACKPACK_TIERS,
  buildingCap,
  nextBuildingCost,
  type AnimalBuilding,
  type AnimalKind,
} from '@tillhaven/shared/config';
import { messageFor, codeOf } from '../net/errors.js';
import {
  fetchShop,
  buyItem,
  sellItem,
  upgradeBackpack,
  upgradeBuilding,
  type ShopEntry,
} from '../net/shop.js';
import { idempotencyKey } from '../net/api.js';
import { buyAnimal } from '../net/animals.js';
import { buyDecor, fetchDecorCatalogue, type DecorCatalogueEntry } from '../net/decor.js';

/**
 * The shop, as a DOM panel over the canvas.
 *
 * Quantities are clamped to what the player can actually afford or actually
 * holds, so the common mistakes never reach the server. That is a courtesy, not
 * a control — the server re-checks both and returns INSUFFICIENT_GOLD or
 * INSUFFICIENT_ITEMS regardless (CLAUDE.md §4.1).
 *
 * Gold is never adjusted locally. Every trade's response carries the
 * authoritative balance, and that is what gets displayed.
 */

type Mode = 'buy' | 'sell' | 'animals' | 'gear' | 'decor';

export interface ShopHost {
  /** Current gold, for clamping the buy quantity. */
  gold(): number;
  /** The backpack's size and what the next one costs, from the server. */
  backpack(): { readonly capacity: number; readonly nextCost: number | null };
  /** The server's coop/barn tier, straight from farm state (T-12.02). */
  buildingTier(building: AnimalBuilding): number;
  /** How many animals that building currently houses (T-18.14). */
  herdOf(building: AnimalBuilding): number;
  isVip(): boolean;
  /** How many of an item the player holds, for clamping the sell quantity. */
  heldOf(itemId: string): number;
  /** Called after any successful trade so the HUD and farm can re-sync. */
  onTraded(goldAfter: number): void;
  /** Gold after a decoration purchase — the server's number, not a subtraction. */
  onGold(gold: number): void;
  /** Called after buying decoration, so the placement tray restocks (T-15.23). */
  onDecorBought(): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  /**
   * The farm level the HUD last rendered (T-31.06). Display only — the server
   * re-derives it from experience before it will sell anything.
   */
  farmLevel(): number;
  /** Renders an item's icon from its configured sheet. */
  icon(itemId: string, scale?: number): HTMLElement | null;
}

/**
 * Why a Buy button is dead, or `null` when it is not (T-18.14, BUG-13).
 *
 * **A disabled button with no explanation is worse than an enabled one that
 * fails**, because a failure at least tells you something. With 100g, Shop →
 * Animals showed two dead BUY buttons with no `title`, no inline reason and
 * nothing distinguishing "you cannot afford this" from "your coop is full" —
 * two problems with completely different answers.
 *
 * Pure and exported so every row asks the same question the same way and so
 * the wording is testable without standing up a panel. Order matters: the
 * capacity is named FIRST, because a full coop is not fixed by earning more
 * gold and telling someone the price when the price is not the problem sends
 * them off to do the wrong thing.
 */
export interface Affordability {
  readonly gold: number;
  readonly price: number;
  /** Only for rows that also consume space. */
  readonly capacity?: { readonly used: number; readonly max: number; readonly noun: string };
}

export function purchaseBlocker(state: Affordability): string | null {
  const cap = state.capacity;
  if (cap && cap.used >= cap.max) return `${cap.noun} full — ${cap.used}/${cap.max}`;
  if (state.gold < state.price) return `need ${(state.price - state.gold).toLocaleString()}g more`;
  return null;
}

/**
 * What a decoration row's button should say and whether it works (T-25.02).
 *
 * Two reasons a piece cannot be bought, and they need different answers, in
 * this order:
 *
 * - **VIP-only, and this account is not VIP.** No amount of gold fixes it, so
 *   naming a price shortfall would send the player off to earn money that
 *   would change nothing — the same argument `purchaseBlocker` already makes
 *   for putting a full coop ahead of an empty wallet.
 * - **Too poor.** The ordinary case, and `purchaseBlocker` owns the wording.
 *
 * Pure and exported for the same reason `purchaseBlocker` is: the decision is
 * worth testing without standing up a panel, and this one guards a paid
 * feature. Before T-25.02 the row read `vipOnly` not at all and offered a Buy
 * button the server would always refuse.
 */
export interface DecorAffordability {
  readonly gold: number;
  readonly price: number;
  readonly vipOnly: boolean;
  readonly isVip: boolean;
}

export function decorRowState(state: DecorAffordability): {
  readonly label: string;
  readonly buyable: boolean;
  readonly reason: string | null;
} {
  if (state.vipOnly && !state.isVip) {
    return { label: 'VIP', buyable: false, reason: 'VIP farms only' };
  }
  const blocker = purchaseBlocker({ gold: state.gold, price: state.price });
  return { label: 'Buy', buyable: blocker === null, reason: blocker };
}

/**
 * What a SEED row's button should say and whether it works (T-31.06).
 *
 * Two reasons a seed cannot be bought, and — exactly as `purchaseBlocker` and
 * `decorRowState` already argue — the order matters more than the wording:
 *
 * - **The farm is not experienced enough.** No amount of gold fixes it, so
 *   naming a price shortfall would send the player off to earn money that
 *   would change nothing. Named first, and it names the LEVEL, because "Lv 6"
 *   is something a player can look at their own HUD bar and measure progress
 *   against (T-30.02 put the bar there).
 * - **Too poor.** The ordinary case, and `purchaseBlocker` owns the wording.
 *
 * `unlockLevel: null` means the item is not a seed and nothing gates it, which
 * is every tool, feed and material in the shop.
 *
 * **This decides nothing.** The server re-derives the requirement from the
 * player's own experience and answers `SEED_LOCKED` regardless (§4.1); this
 * exists so the row can explain itself rather than offering a Buy that is
 * always refused — the defect T-25.02 fixed for VIP decoration.
 */
export interface SeedAffordability {
  readonly gold: number;
  readonly price: number;
  /** From the catalogue. `null` for anything that is not a seed. */
  readonly unlockLevel: number | null;
  readonly farmLevel: number;
}

export function seedRowState(state: SeedAffordability): {
  readonly buyable: boolean;
  readonly reason: string | null;
} {
  if (state.unlockLevel !== null && state.farmLevel < state.unlockLevel) {
    return { buyable: false, reason: `farm level ${state.unlockLevel}` };
  }
  const blocker = purchaseBlocker({ gold: state.gold, price: state.price });
  return { buyable: blocker === null, reason: blocker };
}

/**
 * What an upgrade row's capacity line should say (T-18.15, BUG-14).
 *
 * "holds 4 chickens now · 4,000g" is the CURRENT capacity beside the price of
 * the NEXT one, and a reader joins those two facts into "4,000g buys a
 * 4-chicken coop" — which is exactly wrong, and wrong in the direction that
 * costs them money. A tier-0 coop really does hold 4 and tier 1 really does
 * hold 8, so both numbers are true and the sentence is not.
 *
 * `4 → 8 chickens` states the thing being bought.
 */
export function upgradeLabel(from: number, to: number, noun: string): string {
  return `${from} → ${to} ${noun}`;
}

/**
 * Puts the reason on the row, in its own element so CSS can grey the price and
 * highlight the reason independently (T-18.14).
 *
 * A `title` as well, because the reason is short by design and the tooltip is
 * where "coop full — 4/4" can be read without squinting.
 */
function appendReason(meta: HTMLElement, reason: string): void {
  const span = document.createElement('span');
  span.className = 'shoprow__reason';
  span.textContent = ` · ${reason}`;
  meta.append(span);
  meta.title = reason;
}

export class ShopPanel {
  private root!: HTMLElement;
  private listEl!: HTMLElement;
  private catalogue: ShopEntry[] = [];
  private decorCatalogue: DecorCatalogueEntry[] = [];
  private decorLoading = false;
  private mode: Mode = 'buy';
  private open = false;
  private inFlight = false;
  private host!: ShopHost;

  mount(host: ShopHost): HTMLElement {
    this.host = host;

    this.root = document.createElement('section');
    this.root.className = 'shop';
    // A dialog the player is reading, so it takes movement input (T-18.12).
    // `isModalOpen` finds it by this attribute; see `lib/focus.ts`.
    this.root.setAttribute(MODAL_ATTR, '');
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Shop');
    this.root.innerHTML = `
      <header class="shop__head">
        <span class="shop__title">Shop</span>
        <div class="shop__tabs" role="tablist">
          <button class="shop__tab is-active" type="button" role="tab" data-mode="buy">Buy</button>
          <button class="shop__tab" type="button" role="tab" data-mode="sell">Sell</button>
          <button class="shop__tab" type="button" role="tab" data-mode="animals">Animals</button>
          <button class="shop__tab" type="button" role="tab" data-mode="gear">Gear</button>
          <button class="shop__tab" type="button" role="tab" data-mode="decor">Decor</button>
        </div>
        <button class="shop__close" type="button" data-close aria-label="Close shop"><i class="ui-icon" style="--icon-col: 15" aria-hidden="true"></i></button>
      </header>
      <div class="shop__list" data-list></div>
    `;

    this.listEl = this.root.querySelector('[data-list]')!;

    for (const tab of this.root.querySelectorAll<HTMLButtonElement>('.shop__tab')) {
      tab.addEventListener('click', () => this.setMode(tab.dataset['mode'] as Mode));
    }
    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.hide());

    // Escape closes it, like any other dialog.
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

    return this.root;
  }

  async toggle(): Promise<void> {
    if (this.open) {
      this.hide();
      return;
    }

    if (this.catalogue.length === 0) {
      try {
        this.catalogue = (await fetchShop()).items;
      } catch (err) {
        this.host.toast(messageFor(err), 'error');
        return;
      }
    }

    this.open = true;
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.hidden = true;
  }

  /** Re-render in place, so prices and clamps track the current balance. */
  refresh(): void {
    if (this.open) this.render();
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    for (const tab of this.root.querySelectorAll<HTMLButtonElement>('.shop__tab')) {
      tab.classList.toggle('is-active', tab.dataset['mode'] === mode);
    }
    this.render();
  }

  private render(): void {
    if (this.mode === 'animals') {
      this.listEl.replaceChildren(...ANIMAL_KINDS.map((kind) => this.renderAnimalRow(kind)));
      return;
    }

    if (this.mode === 'gear') {
      this.listEl.replaceChildren(
        this.renderBackpackRow(),
        ...ANIMAL_BUILDINGS.map((building) => this.renderBuildingRow(building)),
      );
      return;
    }

    if (this.mode === 'decor') {
      this.listEl.replaceChildren();
      if (this.decorCatalogue.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'shop__empty';
        empty.textContent = 'Loading decoration…';
        this.listEl.append(empty);
        // Fetched lazily: most visits to the shop are for seeds, and the
        // catalogue is static once loaded.
        void this.loadDecorCatalogue();
        return;
      }
      for (const entry of this.decorCatalogue) this.listEl.append(this.renderDecorRow(entry));
      return;
    }

    const rows = this.catalogue.filter((entry) =>
      this.mode === 'buy' ? entry.buyPrice !== null : entry.sellPrice !== null,
    );

    this.listEl.replaceChildren();

    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'shop__empty';
      empty.textContent =
        this.mode === 'buy' ? 'Nothing for sale.' : 'The shop buys nothing right now.';
      this.listEl.append(empty);
      return;
    }

    for (const entry of rows) {
      this.listEl.append(this.renderRow(entry));
    }
  }

  /**
   * One row per animal kind, with its cosmetic variants as the choice.
   *
   * The variant is the only thing the player picks, and it is cosmetic by
   * design (CLAUDE.md §5.3) — a red hen and a blonde one lay the same egg at the
   * same rate, so the row says so rather than leaving it to be guessed at.
   */
  private renderAnimalRow(kind: AnimalKind): HTMLElement {
    const def = ANIMALS[kind];
    /*
     * Two reasons a chicken cannot be bought, and they need different answers
     * (T-18.14). The cap is the server's own `buildingCap`, so the row cannot
     * offer room the server is about to refuse — the same argument
     * `renderBuildingRow` already makes for its price.
     */
    const max = buildingCap(
      def.building,
      this.host.buildingTier(def.building),
      this.host.isVip() ? VIP_BENEFITS.bonusAnimalCap : 0,
    );
    const blocker = purchaseBlocker({
      gold: this.host.gold(),
      price: def.purchasePrice,
      capacity: {
        used: this.host.herdOf(def.building),
        max,
        noun: def.building === 'coop' ? 'coop' : 'barn',
      },
    });
    const affordable = blocker === null;

    const row = document.createElement('div');
    row.className = 'shoprow';
    if (!affordable) row.classList.add('is-disabled');

    const icon = document.createElement('span');
    icon.className = 'shoprow__icon';
    const art = this.host.icon(def.produceItemId, 2);
    if (art) icon.append(art);

    const name = document.createElement('span');
    name.className = 'shoprow__name';
    name.textContent = def.name;

    const meta = document.createElement('span');
    meta.className = 'shoprow__meta';
    meta.textContent = `${def.purchasePrice}g · ${ITEMS[def.produceItemId]?.name ?? def.produceItemId} · eats ${ITEMS[def.feedItemId]?.name ?? def.feedItemId}`;
    if (blocker) appendReason(meta, blocker);

    const variant = document.createElement('select');
    variant.className = 'shoprow__qty';
    variant.setAttribute('aria-label', `Colour of ${def.name}`);
    variant.disabled = !affordable;
    for (const value of def.variants) {
      const option = document.createElement('option');
      option.value = value;
      // Cosmetic only, so the label is just the colour — written out in
      // ANIMAL_VARIANTS rather than un-slugified from the id, which reads
      // badly once there are 13 of them ("black white", "universe").
      option.textContent = ANIMAL_VARIANTS[value]?.label ?? value;
      variant.append(option);
    }

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'shoprow__btn';
    action.textContent = 'Buy';
    action.disabled = !affordable;
    action.addEventListener('click', () => {
      void this.buyAnimal(kind, variant.value);
    });

    const text = document.createElement('span');
    text.className = 'shoprow__text';
    text.append(name, meta);

    row.append(icon, text, variant, action);
    return row;
  }

  /**
   * The backpack upgrade (T-11.04): one row, no quantity, no target tier.
   *
   * The price comes from the server's own view of the bag rather than from the
   * client's copy of `BACKPACK_TIERS` — same config, but only one of them is
   * authoritative, and a shop quoting a stale price is a shop that lies (§4.4).
   */
  /* ---------------------------------------------------------------- *
   * Decoration (T-15.23)
   * ---------------------------------------------------------------- */

  private async loadDecorCatalogue(): Promise<void> {
    if (this.decorLoading) return;
    this.decorLoading = true;
    try {
      this.decorCatalogue = (await fetchDecorCatalogue()).decor;
      if (this.mode === 'decor') this.render();
    } catch {
      // Leave the placeholder. A shop tab that failed to load is not worth a
      // toast over the farm.
    } finally {
      this.decorLoading = false;
    }
  }

  /**
   * One row per catalogue piece.
   *
   * **Prices come from the SERVER's catalogue, not from the client's copy of
   * `DECOR`** — the same rule the item shop follows, so a row can never quote a
   * number the purchase then refuses (§4.4). Buying puts the piece in decor
   * storage rather than the backpack (§5.6): decoration has no slot and no
   * stack, and a full bag must not stop you buying a fence.
   */
  private renderDecorRow(entry: DecorCatalogueEntry): HTMLElement {
    /*
     * Two different reasons a piece cannot be bought, and they need different
     * answers (T-25.02) — the same distinction `renderAnimalRow` draws between
     * "too poor" and "no room". `vipOnly` came down with the catalogue from the
     * first version of this endpoint and had **no reader**: the row offered a
     * Buy button the server was always going to refuse.
     *
     * Locked pieces stay LISTED to a free account rather than being filtered
     * out. Knowing what VIP includes is the point of an exclusive, and the
     * server refuses the purchase either way — hiding them would make VIP
     * cosmetics undiscoverable except by buying VIP.
     */
    const state = decorRowState({
      gold: this.host.gold(),
      price: entry.price,
      vipOnly: entry.vipOnly,
      isVip: this.host.isVip(),
    });

    const row = document.createElement('div');
    row.className = 'shoprow';
    if (!state.buyable) row.classList.add('is-disabled');

    const icon = document.createElement('span');
    icon.className = 'shoprow__icon';

    const name = document.createElement('span');
    name.className = 'shoprow__name';
    name.textContent = entry.name;

    const meta = document.createElement('span');
    meta.className = 'shoprow__meta';
    // `solid` is worth saying out loud: it is the difference between a fence
    // that pens animals in and one you walk straight through, and it decides
    // where the piece is allowed to go.
    const facts = `${entry.price.toLocaleString()}g · ${entry.solid ? 'blocks the way' : 'walk over it'}`;
    // Says what it costs AND that it is out of reach — a row that only said
    // "VIP" would hide the price behind the paywall for no reason.
    meta.textContent = entry.vipOnly ? `${facts} · VIP only` : facts;

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'shoprow__btn';
    action.textContent = state.label;
    action.disabled = !state.buyable;
    if (state.reason) action.title = state.reason;
    action.addEventListener('click', () => void this.buyDecorPiece(entry));

    const text = document.createElement('span');
    text.className = 'shoprow__text';
    text.append(name, meta);

    row.append(icon, text, action);
    return row;
  }

  private async buyDecorPiece(entry: DecorCatalogueEntry): Promise<void> {
    try {
      const result = await buyDecor(entry.id);
      // Gold from the server's response, never computed locally.
      this.host.onGold(result.goldAfter);
      this.host.onDecorBought();
      this.host.toast(`Bought ${entry.name}. Open Decorate to place it.`);
    } catch (error) {
      this.host.toast(messageFor(error));
    }
  }

  private renderBackpackRow(): HTMLElement {
    const { capacity, nextCost } = this.host.backpack();
    /*
     * The size the next tier gives, read out of the SHARED table rather than
     * derived from anything local (§4.4) — the row has to name what the money
     * buys, and the server is buying from this list.
     */
    const nextCapacity =
      BACKPACK_TIERS.find((t) => t.slots > capacity)?.slots ?? capacity;

    const row = document.createElement('div');
    row.className = 'shoprow';

    const icon = document.createElement('span');
    icon.className = 'shoprow__icon';

    const name = document.createElement('span');
    name.className = 'shoprow__name';
    name.textContent = 'Bigger backpack';

    const meta = document.createElement('span');
    meta.className = 'shoprow__meta';

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'shoprow__btn';

    if (nextCost === null) {
      // Nothing left to sell them. Say so rather than showing a dead button.
      row.classList.add('is-disabled');
      meta.textContent = `${capacity} slots — as big as it gets`;
      action.textContent = 'Bought';
      action.disabled = true;
    } else {
      const blocker = purchaseBlocker({ gold: this.host.gold(), price: nextCost });
      if (blocker) row.classList.add('is-disabled');
      // The size it BECOMES, not the size it is (T-18.15, BUG-14).
      meta.textContent = `${upgradeLabel(capacity, nextCapacity, 'slots')} · ${nextCost.toLocaleString()}g`;
      if (blocker) appendReason(meta, blocker);
      action.textContent = 'Buy';
      action.disabled = blocker !== null;
      action.addEventListener('click', () => void this.buyBackpack());
    }

    const text = document.createElement('span');
    text.className = 'shoprow__text';
    text.append(name, meta);

    row.append(icon, text, action);
    return row;
  }

  /**
   * The coop and barn upgrades (T-12.02): one row each, no quantity, no
   * target tier — the same shape as the backpack row above.
   *
   * The TIER is the server's, straight out of farm state. The cap and the next
   * price are then read through `buildingCap`/`BUILDING_TIERS` — the very
   * functions the server uses to decide the purchase, not a second formula
   * written out here (§4.4). That is what stops the row promising room the
   * server will refuse.
   */
  private renderBuildingRow(building: AnimalBuilding): HTMLElement {
    const tier = this.host.buildingTier(building);
    const cap = buildingCap(building, tier, this.host.isVip() ? VIP_BENEFITS.bonusAnimalCap : 0);
    const nextCost = nextBuildingCost(building, tier);
    const holds = building === 'coop' ? 'chickens' : 'cows';

    const row = document.createElement('div');
    row.className = 'shoprow';

    const icon = document.createElement('span');
    icon.className = 'shoprow__icon';

    const name = document.createElement('span');
    name.className = 'shoprow__name';
    name.textContent = building === 'coop' ? 'Bigger coop' : 'Bigger barn';

    const meta = document.createElement('span');
    meta.className = 'shoprow__meta';

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'shoprow__btn';

    if (nextCost === null) {
      row.classList.add('is-disabled');
      meta.textContent = `holds ${cap} ${holds} — as big as it gets`;
      action.textContent = 'Bought';
      action.disabled = true;
    } else {
      const blocker = purchaseBlocker({ gold: this.host.gold(), price: nextCost });
      if (blocker) row.classList.add('is-disabled');
      // The capacity it BECOMES (T-18.15, BUG-14): "holds 4 chickens now ·
      // 4,000g" invited the reader to think 4,000g bought a 4-chicken coop.
      const nextCap = buildingCap(
        building,
        tier + 1,
        this.host.isVip() ? VIP_BENEFITS.bonusAnimalCap : 0,
      );
      meta.textContent = `holds ${upgradeLabel(cap, nextCap, holds)} · ${nextCost.toLocaleString()}g`;
      if (blocker) appendReason(meta, blocker);
      action.textContent = 'Buy';
      action.disabled = blocker !== null;
      action.addEventListener('click', () => void this.buyBuilding(building));
    }

    const text = document.createElement('span');
    text.className = 'shoprow__text';
    text.append(name, meta);

    row.append(icon, text, action);
    return row;
  }

  private async buyBuilding(building: AnimalBuilding): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const result = await upgradeBuilding(building, idempotencyKey());
      const holds = building === 'coop' ? 'chickens' : 'cows';
      this.host.toast(`Your ${building} now holds ${result.cap} ${holds}.`);
      // The server's balance and the server's cap, never ones computed here.
      this.host.onTraded(result.goldAfter);
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
    }
  }

  private async buyBackpack(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const result = await upgradeBackpack(idempotencyKey());
      this.host.toast(`Backpack enlarged to ${result.capacity} slots.`);
      // The server's balance and the server's capacity, never ones computed
      // here; `onTraded` is what re-reads the bag so the row updates.
      this.host.onTraded(result.goldAfter);
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
    }
  }

  private async buyAnimal(kind: AnimalKind, variant: string): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const result = await buyAnimal(kind, variant as never, idempotencyKey());
      this.host.toast(`Bought a ${ANIMALS[kind].name.toLowerCase()}.`);
      // The server's balance, never one computed here.
      this.host.onTraded(result.goldAfter);
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
    }
  }

  private renderRow(entry: ShopEntry): HTMLElement {
    const price = this.mode === 'buy' ? entry.buyPrice! : entry.sellPrice!;
    const held = this.host.heldOf(entry.itemId);

    /*
     * The level gate applies to BUYING only (T-31.06). Selling a crop you were
     * given, or grew from a milestone's seeds, must never be refused for a
     * level you have not reached — the seed is already in your hands.
     */
    const state =
      this.mode === 'buy'
        ? seedRowState({
            gold: this.host.gold(),
            price,
            unlockLevel: entry.unlockLevel,
            farmLevel: this.host.farmLevel(),
          })
        : { buyable: held > 0, reason: null };

    const locked = this.mode === 'buy' && !state.buyable && state.reason?.startsWith('farm level');

    // The most the player could do right now. Zero disables the row.
    const max =
      locked
        ? 0
        : this.mode === 'buy'
          ? price > 0
            ? Math.floor(this.host.gold() / price)
            : 0
          : held;

    const row = document.createElement('div');
    row.className = 'shoprow';
    if (max === 0) row.classList.add('is-disabled');

    const icon = document.createElement('span');
    icon.className = 'shoprow__icon';
    const art = this.host.icon(entry.itemId, 2);
    if (art) icon.append(art);

    const name = document.createElement('span');
    name.className = 'shoprow__name';
    name.textContent = ITEMS[entry.itemId]?.name ?? entry.name;

    const meta = document.createElement('span');
    meta.className = 'shoprow__meta';
    meta.textContent = this.mode === 'buy' ? `${price}g each` : `${price}g each · ${held} held`;
    // Only the level reason goes on the row. "need 40g more" is already
    // obvious from the price beside an empty purse, and T-18.14's point was
    // about reasons the player CANNOT read off the screen.
    if (locked && state.reason) appendReason(meta, state.reason);

    const qty = document.createElement('input');
    qty.className = 'shoprow__qty';
    qty.type = 'number';
    qty.min = '1';
    qty.max = String(Math.max(1, max));
    qty.value = '1';
    qty.disabled = max === 0;
    qty.setAttribute('aria-label', `Quantity of ${name.textContent}`);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'shoprow__btn';
    action.textContent = this.mode === 'buy' ? 'Buy' : 'Sell';
    action.disabled = max === 0;
    if (locked && state.reason) action.title = `Unlocks at ${state.reason}`;

    action.addEventListener('click', () => {
      // Clamp again at click time: the balance may have moved since render.
      const wanted = Math.floor(Number(qty.value));
      const limit =
        this.mode === 'buy'
          ? Math.floor(this.host.gold() / price)
          : this.host.heldOf(entry.itemId);
      const quantity = Math.max(1, Math.min(wanted || 1, Math.max(1, limit)));
      void this.trade(entry.itemId, quantity);
    });

    const text = document.createElement('span');
    text.className = 'shoprow__text';
    text.append(name, meta);

    row.append(icon, text, qty, action);
    return row;
  }

  private async trade(itemId: string, quantity: number): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    // One key per user action, reused if this action is retried (§4.5).
    const key = idempotencyKey();

    try {
      const result =
        this.mode === 'buy'
          ? await buyItem(itemId, quantity, key)
          : await sellItem(itemId, quantity, key);

      const name = ITEMS[itemId]?.name ?? itemId;
      this.host.toast(
        this.mode === 'buy'
          ? `Bought ${quantity} × ${name} for ${Math.abs(result.goldDelta)}g.`
          : `Sold ${quantity} × ${name} for ${result.goldDelta}g.`,
      );

      // The server's balance wins, always.
      this.host.onTraded(result.goldAfter);
    } catch (err) {
      if (codeOf(err) === 'UNAUTHENTICATED') {
        window.location.assign('/login');
        return;
      }
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
      this.render();
    }
  }
}
