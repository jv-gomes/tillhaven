import {
  ITEMS,
  SHEETS,
  UI_COIN,
  UI_HUD,
  UI_ICON,
  UI_MONEY,
  type AnimalBuilding,
} from '@tillhaven/shared/config';
import type { IdleView, SelfPlayer } from '@tillhaven/shared/types';
import type { Appearance } from '@tillhaven/shared/schemas';
import type { CatalogueEntry, OwnedFurniture } from '../net/house.js';
import { sprite } from '../lib/sprite.js';
import { isTypingInDom } from '../lib/focus.js';
import { logout } from '../net/farm.js';
import type { InventorySlot } from '../net/inventory.js';
import { ShopPanel } from './shopPanel.js';
import { InventoryPanel } from './inventoryPanel.js';
import { ShippingPanel } from './shippingPanel.js';
import { CharacterCreator } from './characterCreator.js';
import { IdlePanel } from './idlePanel.js';
import { Hotbar, type Equipped } from './hotbar.js';

/**
 * The HUD: gold, hotbar, inventory, toasts.
 *
 * Rendered as DOM **over** the canvas rather than inside it (CLAUDE.md §2).
 * Panels made of real elements get text selection, keyboard focus and screen
 * reader support for free — none of which Phaser gives you.
 */

/** Integer upscale of the 16px HUD art. Fractional scaling turns it to mush. */
const HUD_ICON_SCALE = 2;

class Hud {
  private root!: HTMLElement;
  private goldEl!: HTMLElement;
  private nameEl!: HTMLElement;
  private idleBtn!: HTMLElement;
  private toastsEl!: HTMLElement;
  private mounted = false;
  private readonly shop = new ShopPanel();
  /**
   * One panel for both containers (T-10.04a). The Bag button opens the
   * backpack alone; the Chest button opens it with the chest half as well.
   */
  private readonly pack = new InventoryPanel();
  /** The shipping box. Opened at the box in the world, never from the bar. */
  private readonly shipping = new ShippingPanel();
  private readonly creator = new CharacterCreator();
  /** Idle mode's switch (T-13.06). Owns the standing orders and the banner. */
  private readonly idle = new IdlePanel();
  private readonly hotbar = new Hotbar();
  /** The server's last word on this player's appearance. Cosmetic only (§5.1). */
  private appearance: Appearance | null = null;
  private onAppearanceListener: ((appearance: Appearance) => void) | null = null;
  /** Last known gold and bag contents, used only to clamp the shop's inputs. */
  private gold = 0;
  private slots: InventorySlot[] = [];
  /** The backpack's size and next price, from the server. For the shop's row. */
  private bag: { capacity: number; nextCost: number | null } = { capacity: 0, nextCost: null };
  /**
   * Coop and barn tiers, as last reported by farm state (T-12.02).
   *
   * Held here rather than fetched, because the shop needs them and the farm
   * poll already carries them — a second endpoint for two integers on the
   * hottest path would be a strange trade.
   */
  private buildings: Record<AnimalBuilding, number> = { coop: 0, barn: 0 };
  private vip = false;
  /** Set by the Farm scene so a trade can trigger an authoritative re-sync. */
  private onStateChanged: (() => void) | null = null;
  /** Set by the Interior scene, so the HUD's Leave button can close it. */
  private onLeaveHouseListener: (() => void) | null = null;
  private onPlaceListener: ((furnitureId: string) => void) | null = null;
  private onBuyFurnitureListener: ((furnitureId: string) => void) | null = null;
  private onIdleChangedListener: ((view: IdleView) => void) | null = null;

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;

    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <header class="hud__bar">
        <span class="hud__brand">Tillhaven</span>
        <span class="hud__name" data-name></span>
        <span class="hud__gold"><i class="hud__coin" aria-hidden="true"></i><span data-gold>—</span></span>
        <button class="hud__btn" type="button" data-bag>
          <i class="hud__icon hud__icon--bag" aria-hidden="true"></i>Bag
        </button>
        <button class="hud__btn" type="button" data-idle aria-expanded="false">Idle</button>
        <button class="hud__btn" type="button" data-logout>Log out</button>
      </header>
      <div class="hud__toasts" data-toasts role="status" aria-live="polite"></div>
    `;

    /*
     * The bar's art, from the manifest rather than retyped in the stylesheet
     * (§9) — same technique the hotbar and the inventory panel use. The coin is
     * a six-frame strip stepped by a CSS animation; the bag is one cell of the
     * icon grid.
     */
    const px = (n: number) => `${n * HUD_ICON_SCALE}px`;
    this.root.style.setProperty('--coin-sheet', `url("${UI_MONEY.path}")`);
    this.root.style.setProperty('--coin-size', px(UI_COIN.size));
    this.root.style.setProperty('--coin-strip', px(UI_COIN.size * UI_COIN.frames));
    this.root.style.setProperty('--coin-frames', String(UI_COIN.frames));
    this.root.style.setProperty('--coin-spin', `${UI_COIN.frames / UI_COIN.fps}s`);
    this.root.style.setProperty('--icon-sheet', `url("${UI_HUD.path}")`);
    this.root.style.setProperty('--icon-size', px(UI_ICON.size));
    this.root.style.setProperty('--icon-sheet-size', `${px(UI_HUD.width)} ${px(UI_HUD.height)}`);
    this.root.style.setProperty('--icon-bag', `-${px(UI_ICON.bag.x)} -${px(UI_ICON.bag.y)}`);

    document.body.appendChild(this.root);

    this.goldEl = this.root.querySelector('[data-gold]')!;
    this.nameEl = this.root.querySelector('[data-name]')!;
    this.toastsEl = this.root.querySelector('[data-toasts]')!;

    this.root.querySelector('[data-logout]')!.addEventListener('click', () => {
      void logout().finally(() => window.location.assign('/'));
    });

    this.root.append(
      this.shop.mount({
        gold: () => this.gold,
        backpack: () => this.bag,
        buildingTier: (building) => this.buildings[building] ?? 0,
        isVip: () => this.vip,
        heldOf: (itemId) =>
          this.slots
            .filter((s) => s.itemId === itemId)
            .reduce((sum, s) => sum + s.quantity, 0),
        onTraded: (goldAfter) => {
          // The server's balance, not a locally computed one.
          this.gold = goldAfter;
          this.goldEl.textContent = `${goldAfter.toLocaleString()}g`;
          // Re-fetch bag and farm so everything agrees again.
          void this.refreshInventory().then(() => this.shop.refresh());
          this.onStateChanged?.();
        },
        toast: (message, kind) => this.toast(message, kind),
        icon: (itemId, scale) => iconFor(itemId, scale),
      }),
    );



    this.root.append(
      this.pack.mount({
        // The panel owns the fetch, so this is how the HUD's own copy — used
        // only to clamp the shop's sell quantities — stays in step.
        onSlotsChanged: (slots, bag) => {
          this.setSlots(slots);
          // Only a fetched view carries these; a move's response does not.
          if (bag) this.bag = { capacity: bag.capacity, nextCost: bag.nextCost };
        },
        onGoldChanged: (goldAfter) => {
          this.gold = goldAfter;
          this.goldEl.textContent = `${goldAfter.toLocaleString()}g`;
          this.onStateChanged?.();
        },
        gold: () => this.gold,
        toast: (message, kind) => this.toast(message, kind),
        icon: (itemId, scale) => iconFor(itemId, scale),
      }),
    );

    this.root.append(
      this.shipping.mount({
        // The bag it lists is the HUD's own copy, kept current by the panel
        // that owns the fetch — no third fetcher for the same rows.
        slots: () => this.slots,
        onChanged: () => {
          void this.refreshInventory();
          this.onStateChanged?.();
        },
        toast: (message, kind) => this.toast(message, kind),
        icon: (itemId, scale) => iconFor(itemId, scale),
      }),
    );

    this.root.append(
      this.idle.mount({
        toast: (message, kind) => this.toast(message, kind),
        onChanged: (view) => {
          this.idleBtn.textContent = view.enabled ? 'Idle · on' : 'Idle';
          // The scene locks or frees the character off this, and re-polls so
          // the field it now owns (or has given back) is up to date.
          this.onIdleChangedListener?.(view);
        },
        onOpenChange: (open) => this.idleBtn.setAttribute('aria-expanded', String(open)),
      }),
    );

    this.idleBtn = this.root.querySelector('[data-idle]')!;
    this.idleBtn.addEventListener('click', () => this.idle.toggle());

    this.root.querySelector('[data-bag]')!.addEventListener('click', () => {
      void this.pack.toggle();
    });

    /*
     * I and Tab open the backpack, the two keys everyone tries. Tab has to be
     * prevented or the browser moves focus to the next control instead, and
     * both are ignored while something is being typed (§2, the same guard the
     * hotbar and the action key use).
     *
     * There is no key for the CHEST: it opens by standing at it (T-10.05).
     */
    document.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyI' && event.code !== 'Tab') return;
      if (isTypingInDom() || event.ctrlKey || event.metaKey || event.altKey) return;

      event.preventDefault();
      void this.pack.toggle();
    });

    /*
     * The trade panel is NOT mounted (T-11.05). Trading is a place-based
     * interaction like everything else now, and there is nowhere to do it yet —
     * a button that opens a window onto an unreachable feature is worse than no
     * button. The panel, its endpoints and their tests are untouched and green;
     * T-14.03 re-enables it against the new HUD.
     */

    this.root.append(this.hotbar.mount({ icon: (itemId, scale) => iconFor(itemId, scale) }));

    // Last, so it paints over the bar and every panel: until there is a
    // character there is nothing else worth clicking.
    this.root.append(
      this.creator.mount({
        toast: (message, kind) => this.toast(message, kind),
        onSaved: (appearance) => this.setAppearance(appearance),
      }),
    );

    // Dev-only handle, matching main.ts's `__game`. The creator normally shows
    // once per account ever, which makes it the one panel that is otherwise
    // impossible to look at twice; T-8.03 needs exactly this to re-render a
    // character against a changed appearance. Stripped from production builds.
    if (import.meta.env.DEV) {
      (window as unknown as { __hud: Hud }).__hud = this;
    }
  }

  /**
   * The bag, from whichever panel last fetched it.
   *
   * One funnel rather than three call sites: the HUD's own copy (which clamps
   * the shop's sell quantities) and the hotbar's view must be the same list,
   * and the two panels that fetch it should not each have to remember both.
   */
  private setSlots(slots: InventorySlot[]): void {
    this.slots = slots;
    this.hotbar.setSlots(slots);
    this.shop.refresh();
  }

  /** What the character is holding. Client-side state; gates nothing (§5.1). */
  getEquipped(): Equipped | null {
    return this.hotbar.getEquipped();
  }

  onEquippedChange(listener: (equipped: Equipped | null) => void): void {
    this.hotbar.onEquippedChange(listener);
  }

  /** Dev-only re-entry into the character creator. See the `__hud` handle above. */
  openCharacterCreator(): void {
    this.creator.reopen(this.appearance);
  }

  /**
   * Tells the Farm scene what the character looks like (T-8.03).
   *
   * The HUD is where appearance already arrives — on every `setPlayer`, and
   * again the moment the creator saves — so it is also where the scene hears
   * about it, rather than the scene fetching the player a second time. Fires
   * immediately if the answer is already known, since the scene may register
   * after the first poll has landed.
   */
  onAppearance(listener: (appearance: Appearance) => void): void {
    this.onAppearanceListener = listener;
    if (this.appearance) listener(this.appearance);
  }

  /** One place that both records the appearance and announces it. */
  private setAppearance(appearance: Appearance): void {
    this.appearance = appearance;
    this.onAppearanceListener?.(appearance);
  }

  /**
   * Opens the inventory with the chest half showing.
   *
   * Called by the Farm scene when the action key is pressed facing the chest —
   * the only way in. Standing at the box is what makes the chest's grid appear,
   * so the panel never offers a drag into a container the player is nowhere
   * near (T-10.05).
   */
  openChest(): Promise<void> {
    return this.pack.toggle(true);
  }

  /**
   * Opens the merchant's shop. Called by the Farm scene when the action key is
   * pressed facing the stall, and from nowhere else — buying and selling are a
   * place you walk to now, not a button in the corner (T-11.04).
   */
  async openShop(): Promise<void> {
    // Same reason the shipping box refreshes first: the sell tab clamps to what
    // the bag holds, and the bag has been changing while the player farmed.
    await this.refreshInventory();
    await this.shop.toggle();
  }

  /**
   * Opens the shipping box. Called by the Farm scene when the action key is
   * pressed facing the box, and from nowhere else — like the chest, standing
   * there is what opens it (T-11.03).
   */
  async openShipping(): Promise<void> {
    // The bag it lists is this HUD's cached copy, and the player has been
    // farming since it was last read — refresh before showing them what they
    // can ship, or the list is whatever they were carrying a poll ago.
    if (!this.shipping.isOpen) await this.refreshInventory();
    await this.shipping.toggle();
  }

  /**
   * Announces gold the SERVER credited while settling the box on a farm poll.
   *
   * The balance would otherwise change in the corner of the screen with nothing
   * to explain it — the player is standing in a field, nowhere near the box,
   * when the ten minutes run out.
   */
  reportShippingPaid(amount: number): void {
    if (amount > 0) this.toast(`The shipping box sold your goods for ${amount.toLocaleString()}g.`);
  }

  /** Lets the Farm scene re-sync after a trade changes the bag. */
  onStateChange(listener: () => void): void {
    this.onStateChanged = listener;
  }

  /**
   * Idle mode's standing orders, from the farm poll (T-13.05 puts them there).
   *
   * The poll is the only thing that seeds this panel — there is no settings
   * fetch of its own, which is also why the switch is still where the player
   * left it after a reload.
   */
  setIdle(view: IdleView): void {
    if (!this.mounted) return;

    this.idle.setView(view);
    this.idleBtn.textContent = view.enabled ? 'Idle · on' : 'Idle';
  }

  /**
   * Whether the farmer, rather than the player, is working the farm.
   *
   * The Farm scene asks before letting a key do anything. Answered from the
   * panel's copy of the SERVER's last word, never from the checkbox — see
   * `IdlePanel` for why that distinction is the whole safety of the lock.
   */
  isIdleEnabled(): boolean {
    return this.idle.isEnabled;
  }

  onIdleChange(listener: (view: IdleView) => void): void {
    this.onIdleChangedListener = listener;
  }

  onLeaveHouse(listener: () => void): void {
    this.onLeaveHouseListener = listener;
  }

  onDecorate(
    onPlace: (furnitureId: string) => void,
    onBuy: (furnitureId: string) => void,
  ): void {
    this.onPlaceListener = onPlace;
    this.onBuyFurnitureListener = onBuy;
  }

  /**
   * The farm's building tiers, as the server reported them (T-12.02).
   *
   * Only the TIER comes from the server; the cap and next price the shop shows
   * are read from shared config through the same functions the purchase uses,
   * so there is no second formula to drift (§4.4).
   */
  setBuildings(coopTier: number, barnTier: number): void {
    this.buildings = { coop: coopTier, barn: barnTier };
    this.shop.refresh();
  }

  /** The authoritative balance after a purchase. Never computed locally. */
  setGold(gold: number): void {
    this.gold = gold;
    this.goldEl.textContent = `${gold.toLocaleString()}g`;
    this.shop.refresh();
  }

  /**
   * The decoration tray: what is in storage, and what the catalogue sells.
   *
   * A piece in storage offers "Place"; one you do not own offers its price.
   * VIP-only pieces stay listed to a free account rather than being hidden —
   * knowing what VIP includes is the point of an exclusive, and the server
   * refuses the purchase anyway.
   */
  setDecorations(catalogue: CatalogueEntry[], owned: OwnedFurniture[]): void {
    if (!this.mounted) return;

    const stock = new Map(owned.map((o) => [o.furnitureId, o.quantity]));
    const list = this.houseControls().querySelector('[data-decorlist]')!;
    list.replaceChildren();

    for (const entry of catalogue) {
      const held = stock.get(entry.id) ?? 0;

      const row = document.createElement('div');
      row.className = 'decorrow';

      const name = document.createElement('span');
      name.className = 'decorrow__name';
      name.textContent = entry.vipOnly ? `${entry.name} ★` : entry.name;
      if (entry.vipOnly) name.title = 'VIP farms only. Never tradeable.';

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'decorrow__btn';

      if (held > 0) {
        action.textContent = held > 1 ? `Place (${held})` : 'Place';
        action.addEventListener('click', () => this.onPlaceListener?.(entry.id));
      } else {
        action.textContent = `${entry.price.toLocaleString()}g`;
        action.disabled = this.gold < entry.price;
        action.addEventListener('click', () => this.onBuyFurnitureListener?.(entry.id));
      }

      row.append(name, action);
      list.append(row);
    }
  }

  /**
   * Indoors, the farm's controls are about a place the player cannot see.
   *
   * Nothing has to be hidden for the farm any more: T-9.06 retired the seed
   * picker, and the hotbar is the bag — it stays useful inside. Only the
   * house's own controls appear and disappear.
   */
  setInsideHouse(inside: boolean): void {
    if (!this.mounted) return;

    this.houseControls().hidden = !inside;
  }

  /**
   * The house's own controls — Leave, and the decoration tray — built on first
   * use rather than baked into the bar.
   *
   * Nothing calls this today: the Interior scene is unregistered (T-11.05), so
   * there is no way inside and no dead button in the markup. The API stays
   * because the scene and the furniture endpoints do (T-14.04 re-enables them),
   * and DOM that only exists once someone is indoors cannot be dead.
   */
  private houseControls(): HTMLElement {
    const existing = this.root.querySelector<HTMLElement>('[data-house]');
    if (existing) return existing;

    const panel = document.createElement('aside');
    panel.className = 'hud__decor';
    panel.dataset['house'] = '';
    panel.hidden = true;
    panel.innerHTML = `
      <p class="hud__label">Decorate</p>
      <div class="hud__decorlist" data-decorlist></div>
      <button class="hud__btn hud__btn--leave" type="button" data-leave>Leave house</button>
    `;
    panel.querySelector('[data-leave]')!.addEventListener('click', () => {
      this.onLeaveHouseListener?.();
    });

    this.root.append(panel);
    return panel;
  }

  /** Gold comes from the server on every refresh — never incremented locally. */
  setPlayer(player: SelfPlayer): void {
    this.gold = player.gold;
    this.goldEl.textContent = `${player.gold.toLocaleString()}g`;
    this.nameEl.textContent = player.username;
    // The SERVER's answer (it also knows about flagged accounts, which the
    // client is deliberately never told about) — not a local expiry compare.
    this.vip = player.isVip;
    this.shop.refresh();

    // A brand-new account has no character yet. The creator decides whether
    // that means "show me" — it also knows about the save this poll predates.
    if (player.appearance) this.setAppearance(player.appearance);
    this.creator.ensure(player.appearance);
  }

  /**
   * Re-reads the bag from the server.
   *
   * Delegated to the panel rather than duplicated: one fetch, one place that
   * knows the shape of the response, and the HUD's cached slots come back
   * through `onSlotsChanged`.
   */
  refreshInventory(): Promise<void> {
    return this.pack.refresh();
  }

  toast(message: string, kind: 'info' | 'error' = 'info'): void {
    const el = document.createElement('p');
    el.className = `toast toast--${kind}`;
    el.textContent = message;
    this.toastsEl.append(el);

    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }
}

/**
 * Renders an item's icon from whichever sheet its definition names.
 *
 * Every item carries `icon: { sheet, frame }` in the shared config, so this
 * looks the sheet up rather than assuming crops — seeds and produce live on
 * each crop's own sheet (`CROPS[id].sheet`, T-7.07), eggs/milk/feed on
 * borrowed placeholder frames until T-7.09 gives them real icons.
 */
const SHEETS_BY_KEY = new Map(SHEETS.map((s) => [s.key, s]));

export function iconFor(itemId: string, scale = 2): HTMLElement | null {
  const item = ITEMS[itemId];
  if (!item) return null;

  const sheet = SHEETS_BY_KEY.get(item.icon.sheet);
  if (!sheet) return null;

  return sprite(sheet, item.icon.frame, { scale, title: item.name });
}

export const hud = new Hud();
