import {
  ANIMALS,
  ANIMAL_BUILDINGS,
  ANIMAL_KINDS,
  ANIMAL_VARIANTS,
  ITEMS,
  VIP_BENEFITS,
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

type Mode = 'buy' | 'sell' | 'animals' | 'gear';

export interface ShopHost {
  /** Current gold, for clamping the buy quantity. */
  gold(): number;
  /** The backpack's size and what the next one costs, from the server. */
  backpack(): { readonly capacity: number; readonly nextCost: number | null };
  /** The server's coop/barn tier, straight from farm state (T-12.02). */
  buildingTier(building: AnimalBuilding): number;
  isVip(): boolean;
  /** How many of an item the player holds, for clamping the sell quantity. */
  heldOf(itemId: string): number;
  /** Called after any successful trade so the HUD and farm can re-sync. */
  onTraded(goldAfter: number): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  /** Renders an item's icon from its configured sheet. */
  icon(itemId: string, scale?: number): HTMLElement | null;
}

export class ShopPanel {
  private root!: HTMLElement;
  private listEl!: HTMLElement;
  private catalogue: ShopEntry[] = [];
  private mode: Mode = 'buy';
  private open = false;
  private inFlight = false;
  private host!: ShopHost;

  mount(host: ShopHost): HTMLElement {
    this.host = host;

    this.root = document.createElement('section');
    this.root.className = 'shop';
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
        </div>
        <button class="shop__close" type="button" data-close aria-label="Close shop">×</button>
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
      if (e.key === 'Escape' && this.open) this.hide();
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
    const affordable = this.host.gold() >= def.purchasePrice;

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
  private renderBackpackRow(): HTMLElement {
    const { capacity, nextCost } = this.host.backpack();

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
      const affordable = this.host.gold() >= nextCost;
      if (!affordable) row.classList.add('is-disabled');
      meta.textContent = `${capacity} slots now · ${nextCost.toLocaleString()}g`;
      action.textContent = 'Buy';
      action.disabled = !affordable;
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
      const affordable = this.host.gold() >= nextCost;
      if (!affordable) row.classList.add('is-disabled');
      meta.textContent = `holds ${cap} ${holds} now · ${nextCost.toLocaleString()}g`;
      action.textContent = 'Buy';
      action.disabled = !affordable;
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

    // The most the player could do right now. Zero disables the row.
    const max =
      this.mode === 'buy'
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
