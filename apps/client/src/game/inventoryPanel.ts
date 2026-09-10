import { MODAL_ATTR } from '../lib/focus.js';
import { HOTBAR_SLOTS, UI_INVENTORY_SLOTS, UI_SLOT } from '@tillhaven/shared/config';
import { codeOf, messageFor } from '../net/errors.js';
import { idempotencyKey } from '../net/api.js';
import {
  fetchChest,
  fetchInventory,
  moveSlot,
  upgradeChest,
  type BagView,
  type InventorySlot,
  type InventoryView,
  type SlotRef,
} from '../net/inventory.js';
import { buildSlotCell, buildSlotCells, type IconFactory } from './slotGrid.js';

/**
 * The inventory: **chest on top, backpack underneath**, in one panel
 * (T-10.04a, CLAUDE.md §5.5).
 *
 * One panel rather than two, because moving things between them is the point.
 * The old bag and chest panels each drew their own copy of the backpack and had
 * their own idea of how a slot behaves — a click meant "pick up" in one and
 * "send the whole stack across" in the other. Here a slot behaves the same way
 * wherever it is.
 *
 * **The chest half only exists when the chest is open.** The Bag button shows
 * the backpack alone; standing at the chest (T-10.05) shows both. Rendering an
 * empty chest section for a player who is nowhere near their chest would invite
 * a drag that cannot work.
 *
 * **The client never decides where an item ended up.** It sends two slot
 * references and re-renders from the containers the server sends back; it does
 * not replay the move locally and hope the two agree. A rejected move therefore
 * needs no rollback — the grid was never changed (§4.1).
 */

/**
 * Two codes mean something narrower here than they do elsewhere, and the
 * general wording would be actively confusing: a move rejected with
 * `INSUFFICIENT_ITEMS` means the slot dragged from is empty, not that the
 * player is short of something, and `VALIDATION_FAILED` means the destination
 * is past the slots they own rather than "some input was not valid".
 *
 * Overridden here rather than in `net/errors.ts` because that map is shared by
 * every screen, and these readings only make sense inside the inventory.
 */
const MOVE_MESSAGES: Readonly<Record<string, string>> = {
  INSUFFICIENT_ITEMS: 'That slot is empty.',
  VALIDATION_FAILED: 'You do not have a slot there yet.',
  INVENTORY_FULL: 'There is no room for that.',
};

function moveMessage(err: unknown): string {
  const code = codeOf(err);
  return (code ? MOVE_MESSAGES[code] : undefined) ?? messageFor(err);
}

/** Integer upscale of the 18px slot art. Fractional scaling turns it to mush. */
const SLOT_SCALE = 3;

const EMPTY: InventoryView = { slots: [], capacity: 0 };

export interface InventoryHost {
  /**
   * Called whenever the backpack changes, so the HUD's cached copy stays in
   * step.
   *
   * `bag` is present only when the panel FETCHED the backpack — a move's
   * response carries the slots but not the tier or the next tier's price, and
   * inventing them here would be worse than leaving the HUD's last known
   * values alone.
   */
  onSlotsChanged(slots: InventorySlot[], bag?: BagView): void;
  /** The authoritative balance after a chest upgrade. */
  onGoldChanged(goldAfter: number): void;
  /** Current gold, for disabling an upgrade nobody can afford. */
  gold(): number;
  toast(message: string, kind?: 'info' | 'error'): void;
  icon: IconFactory;
}

/** Which container a grid is, and where its cells came from. */
type ContainerName = SlotRef['container'];

export class InventoryPanel {
  private root!: HTMLElement;
  private host!: InventoryHost;

  private bagGrid!: HTMLElement;
  private chestGrid!: HTMLElement;
  private bagCount!: HTMLElement;
  private chestCount!: HTMLElement;
  private chestSection!: HTMLElement;
  private upgradeEl!: HTMLButtonElement;

  private bag: InventoryView = EMPTY;
  private chest: InventoryView = EMPTY;
  /** Cost of the next chest tier, from the server. null once there are none. */
  private nextChestCost: number | null = null;

  private open = false;
  /** Whether the chest half is part of this opening. */
  private withChest = false;
  /** The slot a click picked up, waiting for its destination. */
  private picked: SlotRef | null = null;
  /** One move at a time: a second drag mid-flight would race the first. */
  private inFlight = false;

  mount(host: InventoryHost): HTMLElement {
    this.host = host;

    this.root = document.createElement('section');
    this.root.className = 'pack';
    // A dialog the player is reading, so it takes movement input (T-18.12).
    // `isModalOpen` finds it by this attribute; see `lib/focus.ts`.
    this.root.setAttribute(MODAL_ATTR, '');
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Inventory');
    this.root.innerHTML = `
      <header class="pack__head">
        <span class="pack__title" data-title>Backpack</span>
        <button class="pack__close" type="button" data-close aria-label="Close inventory">×</button>
      </header>

      <section class="pack__section" data-chest-section hidden aria-label="Chest">
        <h3 class="pack__label">
          Chest <span class="pack__count" data-chest-count></span>
          <button class="pack__upgrade" type="button" data-upgrade hidden></button>
        </h3>
        <div class="pack__grid" data-chest-grid></div>
      </section>

      <section class="pack__section" aria-label="Backpack">
        <h3 class="pack__label">Backpack <span class="pack__count" data-bag-count></span></h3>
        <div class="pack__grid" data-bag-grid></div>
      </section>

      <!--
        "The top row" was true only while twelve columns fitted (T-29.01). On a
        phone the grid reflows to as many as the screen allows, so the hotbar
        stops being a row — but every hotbar slot still carries its own gilt
        underline, which is the thing the reader can actually see. Naming the
        marker instead of the row makes the sentence true at every width.
      -->
      <p class="pack__hint">
        Drag a slot onto another, or click one and then the slot to move it to.
        The slots with a gold line underneath are your hotbar.
      </p>
    `;

    /*
     * The slot art's position inside its sheet, scaled — written once in the
     * shared config (`UI_SLOT`, measured in T-8.07) and handed to CSS, never
     * retyped in a stylesheet. Same values the hotbar uses, so a slot looks the
     * same whether it is in the strip or in the panel.
     */
    const px = (n: number) => `${n * SLOT_SCALE}px`;
    this.root.style.setProperty('--slot-sheet', `url("${UI_INVENTORY_SLOTS.path}")`);
    this.root.style.setProperty('--slot-size', px(UI_SLOT.size));
    this.root.style.setProperty(
      '--slot-sheet-size',
      `${px(UI_INVENTORY_SLOTS.width)} ${px(UI_INVENTORY_SLOTS.height)}`,
    );
    this.root.style.setProperty('--slot-idle', `-${px(UI_SLOT.idle.x)} -${px(UI_SLOT.idle.y)}`);
    this.root.style.setProperty(
      '--slot-selected',
      `-${px(UI_SLOT.selected.x)} -${px(UI_SLOT.selected.y)}`,
    );
    // The backpack grid is exactly the hotbar's width, so its first row IS the
    // hotbar rather than merely containing it.
    this.root.style.setProperty('--pack-columns', String(HOTBAR_SLOTS));

    this.bagGrid = this.root.querySelector('[data-bag-grid]')!;
    this.chestGrid = this.root.querySelector('[data-chest-grid]')!;
    this.bagCount = this.root.querySelector('[data-bag-count]')!;
    this.chestCount = this.root.querySelector('[data-chest-count]')!;
    this.chestSection = this.root.querySelector('[data-chest-section]')!;
    this.upgradeEl = this.root.querySelector('[data-upgrade]')!;

    this.upgradeEl.addEventListener('click', () => void this.upgrade());
    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.hide());

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
      // Escape cancels a pick-up first, and only closes the panel if there is
      // nothing to cancel — otherwise there is no way to put an item back down.
      if (this.picked !== null) this.pickUp(null);
      else this.hide();
    });

    return this.root;
  }

  /**
   * Opens the backpack, and the chest with it when asked.
   *
   * Toggling with a DIFFERENT set of grids re-opens rather than closing: using
   * the chest while the bag panel is already up should show the chest, not
   * dismiss the panel and leave the player wondering what the key did.
   */
  async toggle(withChest = false): Promise<void> {
    if (this.open && this.withChest === withChest) {
      this.hide();
      return;
    }

    this.open = true;
    this.withChest = withChest;
    this.picked = null;
    this.root.hidden = false;
    this.chestSection.hidden = !withChest;
    this.root.querySelector('[data-title]')!.textContent = withChest ? 'Chest' : 'Backpack';
    await this.refresh();
  }

  hide(): void {
    this.open = false;
    this.picked = null;
    this.root.hidden = true;
    /*
     * Closed means closed, including the chest half: leaving it marked visible
     * on a hidden panel is a lie to anyone reading the DOM, and the next
     * opening decides for itself anyway. It also means walking away from the
     * chest and pressing Bag can never flash the chest's grid.
     */
    this.withChest = false;
    this.chestSection.hidden = true;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Pulls the authoritative containers and redraws.
   *
   * The chest is only fetched when it is on screen: a closed chest section is
   * not a stale one, it is one nobody is looking at, and asking for it anyway
   * doubles the requests behind every farm poll.
   *
   * A failure while the panel is closed is cosmetic — the farm poll calls this
   * again every few seconds — so it stays quiet rather than stacking toasts on
   * someone who is not even looking.
   */
  async refresh(): Promise<void> {
    try {
      if (this.withChest) {
        const [bag, chest] = await Promise.all([fetchInventory(), fetchChest()]);
        this.nextChestCost = chest.nextCost;
        this.apply(bag, chest, bag);
      } else {
        const bag = await fetchInventory();
        this.apply(bag, this.chest, bag);
      }
    } catch (err) {
      if (this.open) this.host.toast(messageFor(err), 'error');
    }
  }

  private apply(bag: InventoryView, chest: InventoryView, fetched?: BagView): void {
    this.bag = bag;
    this.chest = chest;
    this.host.onSlotsChanged(bag.slots, fetched);
    if (this.open) this.render();
  }

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */

  private render(): void {
    this.bagCount.textContent = `${this.bag.slots.length} / ${this.bag.capacity}`;
    this.bagGrid.replaceChildren(
      ...buildSlotCells(this.bag.capacity, this.bag.slots, (index, slot) =>
        this.buildCell('inventory', index, slot),
      ),
    );

    if (!this.withChest) return;

    this.renderUpgrade();
    this.chestCount.textContent = `${this.chest.slots.length} / ${this.chest.capacity}`;
    this.chestGrid.replaceChildren(
      ...buildSlotCells(this.chest.capacity, this.chest.slots, (index, slot) =>
        this.buildCell('chest', index, slot),
      ),
    );
  }

  /**
   * The next tier's price, or nothing at all once the chest is as big as it
   * gets. The cost comes from the server rather than from the client's copy of
   * `CHEST_TIERS`: same config, but only one of the two is authoritative.
   */
  private renderUpgrade(): void {
    if (this.nextChestCost === null) {
      this.upgradeEl.hidden = true;
      return;
    }

    this.upgradeEl.hidden = false;
    this.upgradeEl.textContent = `Enlarge — ${this.nextChestCost.toLocaleString()}g`;
    this.upgradeEl.disabled = this.host.gold() < this.nextChestCost;
  }

  private buildCell(
    container: ContainerName,
    index: number,
    slot: InventorySlot | undefined,
  ): HTMLElement {
    const label = container === 'chest' ? 'Chest slot' : 'Backpack slot';
    const cell = buildSlotCell({ index, slot, icon: this.host.icon, label });
    const ref: SlotRef = { container, slot: index };

    cell.classList.toggle('is-picked', this.isPicked(ref));
    // The first backpack row is the hotbar — the same twelve slots the strip at
    // the bottom of the screen shows, not a copy of them.
    if (container === 'inventory' && index < HOTBAR_SLOTS) cell.classList.add('is-hotbar');

    if (slot) {
      // Only an occupied slot is a drag source; an empty one has nothing to drag.
      cell.draggable = true;
      cell.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', JSON.stringify(ref));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        cell.classList.add('is-dragging');
      });
      /*
       * `dragend` fires on the SOURCE however the drag ended — dropped, or
       * cancelled with Escape or by letting go over nothing. A cancel does not
       * fire `dragleave` on whichever cell was last hovered, so clearing the
       * drop highlight here as well is what stops a cell being left lit under
       * a drag that never happened.
       */
      cell.addEventListener('dragend', () => {
        cell.classList.remove('is-dragging');
        this.clearDropHighlights();
      });
    }

    // Every cell is a drop target, including empty ones — that is the whole
    // point of dragging something to an empty slot.
    cell.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      cell.classList.add('is-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('is-over'));
    cell.addEventListener('drop', (event) => {
      event.preventDefault();
      cell.classList.remove('is-over');

      const from = parseRef(event.dataTransfer?.getData('text/plain'));
      if (from) void this.move(from, ref);
    });

    cell.addEventListener('click', () => this.onCellClicked(ref, Boolean(slot)));

    return cell;
  }

  /* ---------------------------------------------------------------- *
   * Moving
   * ---------------------------------------------------------------- */

  private isPicked(ref: SlotRef): boolean {
    return this.picked?.container === ref.container && this.picked.slot === ref.slot;
  }

  private onCellClicked(ref: SlotRef, occupied: boolean): void {
    if (this.picked === null) {
      // Nothing to pick up from an empty slot, and doing nothing beats sending
      // a move the server is certain to refuse.
      if (!occupied) return;
      this.pickUp(ref);
      return;
    }

    if (this.isPicked(ref)) {
      this.pickUp(null);
      return;
    }

    const from = this.picked;
    this.pickUp(null);
    void this.move(from, ref);
  }

  private pickUp(ref: SlotRef | null): void {
    this.picked = ref;
    for (const [container, grid] of [
      ['inventory', this.bagGrid],
      ['chest', this.chestGrid],
    ] as const) {
      for (const cell of grid.querySelectorAll<HTMLElement>('.slot')) {
        const isPicked =
          ref !== null && ref.container === container && cell.dataset['slot'] === String(ref.slot);
        cell.classList.toggle('is-picked', isPicked);
      }
    }
  }

  /** Every cell in both grids, un-lit. */
  private clearDropHighlights(): void {
    for (const cell of this.root.querySelectorAll<HTMLElement>('.slot.is-over')) {
      cell.classList.remove('is-over');
    }
  }

  private async move(from: SlotRef, to: SlotRef): Promise<void> {
    if (this.inFlight) return;
    if (from.container === to.container && from.slot === to.slot) return;
    this.inFlight = true;

    try {
      // One key for this drag, reused if it has to be retried (§4.5).
      const result = await moveSlot(from, to, idempotencyKey());
      // Both containers come back on every move, so both grids redraw from the
      // server's answer — never from a replayed guess.
      this.apply(result.bag, this.withChest ? result.chest : this.chest);
    } catch (err) {
      /*
       * Nothing to roll back — the grid still shows the last state the server
       * sent. A rejected move must never look like a click that did nothing, so
       * every code it can return gets a message.
       */
      this.host.toast(moveMessage(err), 'error');
      await this.refresh();
    } finally {
      this.inFlight = false;
    }
  }

  private async upgrade(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const result = await upgradeChest(idempotencyKey());
      this.nextChestCost = result.nextCost;
      // The server's balance, never one computed here.
      this.host.onGoldChanged(result.goldAfter);
      this.host.toast(`Chest enlarged to ${result.capacity} slots.`);
      await this.refresh();
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
    }
  }
}

/**
 * Reads a dragged slot reference back, tolerating anything that is not one.
 *
 * A grid accepts drops from ANYWHERE — a file from the desktop, a link from
 * another tab, a paragraph of selected text — and every one of those arrives as
 * a `drop` event with a `text/plain` payload the panel did not write. This is
 * the boundary that keeps those from becoming a move request; exported so the
 * cases can be asserted rather than assumed.
 */
export function parseRef(raw: string | undefined): SlotRef | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { container, slot } = parsed as { container?: unknown; slot?: unknown };
    if (container !== 'inventory' && container !== 'chest') return null;
    /*
     * A whole number, and not a negative one. How MANY slots the player owns is
     * the server's business — capacity depends on tiers and VIP, and deciding
     * it here would be a second answer to what they own (§4.1) — but -1 is
     * where the server's swap parks a row mid-transaction, so it must never be
     * reachable from a payload.
     */
    if (!Number.isInteger(slot) || (slot as number) < 0) return null;
    return { container, slot: slot as number };
  } catch {
    // A drag from outside the game — a file, a link, some text — is not a move.
    return null;
  }
}
