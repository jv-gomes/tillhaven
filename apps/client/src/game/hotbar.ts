import { HOTBAR_SLOTS, ITEMS, UI_INVENTORY_SLOTS, UI_SLOT } from '@tillhaven/shared/config';
import { isTypingInDom } from '../lib/focus.js';
import type { InventorySlot } from '../net/inventory.js';
import type { IconFactory } from './slotGrid.js';

/**
 * The hotbar: a window onto the first `HOTBAR_SLOTS` backpack slots.
 *
 * **Not a container of its own.** It shows slot indices 0…11 of the backpack
 * the server already stores, so it needs no schema, no endpoint and nothing
 * validated — rearranging the bag rearranges the hotbar, because they are the
 * same rows. `STARTING_ITEMS` puts the hoe and watering can at indices 0 and 1
 * precisely so a new player finds them on keys 1 and 2 (T-8.06).
 *
 * **Selection is client-side state and nothing else** (CLAUDE.md §5.5). It is
 * never sent anywhere and gates nothing on the server; what the equipped item
 * means is T-8.09's and T-9.06's problem, and even then the server will
 * validate the plot, not the client's idea of what is in hand.
 */

/** Integer upscale of the 18px slot art. Fractional scaling turns it to mush. */
const SLOT_SCALE = 3;

/**
 * The upscale on a short viewport (T-18.03).
 *
 * **2, not 2.5 or "80%".** The camera reserves the hotbar's height and fits the
 * farm in what is left, so on a 1366x768 laptop the strip's 80px was the
 * difference between zoom 2 and zoom 1 — the game rendering at native size in
 * the middle of the screen. Shrinking it buys that zoom level back.
 *
 * It has to stay a whole number for the same reason `SLOT_SCALE` does: the slot
 * art is an 18px sprite and every offset handed to CSS is measured at this
 * scale. 18x2 is sharp; 18x2.5 is a smear with half-pixel background offsets.
 */
const SLOT_SCALE_COMPACT = 2;

/**
 * Below this viewport height the hotbar goes compact.
 *
 * Matches the `max-height: 820px` query in `hud.css` that shrinks the top bar,
 * and is chosen so the sizes that already clear zoom 2 at full size — a
 * 900-tall laptop, a 1080p desktop — are untouched. **If you change one, change
 * the other**: the two halves of the chrome have to shrink together or the
 * camera gains back less than it needs.
 */
const COMPACT_MAX_HEIGHT = 820;

function slotScaleFor(viewportHeight: number): number {
  return viewportHeight <= COMPACT_MAX_HEIGHT ? SLOT_SCALE_COMPACT : SLOT_SCALE;
}

/**
 * Keys 1–9, then 0, -, = for slots 10–12.
 *
 * Matched on `event.code`, not `event.key`: `code` is the physical key, so a
 * layout that produces `&` on the 1 key still selects slot 1, and Shift+1
 * (which `key` reports as `!`) does not stop working the moment T-8.04's run
 * modifier is held.
 */
const SLOT_CODES: readonly string[] = [
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Digit0',
  'Minus',
  'Equal',
];

export interface Equipped {
  readonly slotIndex: number;
  readonly itemId: string;
}

export interface HotbarHost {
  icon: IconFactory;
}

export class Hotbar {
  private root!: HTMLElement;
  private host!: HotbarHost;
  private readonly cells: HTMLButtonElement[] = [];

  /** Whatever the server last said is in the backpack. Never invented here. */
  private slots: InventorySlot[] = [];
  private selected = 0;
  private readonly listeners: ((equipped: Equipped | null) => void)[] = [];

  /** The scale currently written to CSS, so a resize that changes nothing is free. */
  private scale = 0;

  private readonly onResize = (): void => {
    this.applyScale();
  };

  /**
   * Re-picks the slot scale for the current viewport, if it has changed.
   *
   * Public because `hud.chrome()` calls it **before measuring** (T-18.03). The
   * camera and this strip both react to a resize, and nothing orders those two
   * listeners — so a camera that fitted first would reserve the height of a
   * hotbar that was about to change size, and settle on a zoom that is wrong
   * until the next resize. Syncing on read removes the ordering question
   * instead of trying to win it.
   */
  syncScale(): void {
    this.applyScale();
  }

  private applyScale(): void {
    const root = this.root;
    if (!root) return;

    const scale = slotScaleFor(window.innerHeight);
    if (scale === this.scale) return;
    this.scale = scale;

    const px = (n: number) => `${n * scale}px`;
    root.style.setProperty('--slot-sheet', `url("${UI_INVENTORY_SLOTS.path}")`);
    root.style.setProperty('--slot-size', px(UI_SLOT.size));
    root.style.setProperty(
      '--slot-sheet-size',
      `${px(UI_INVENTORY_SLOTS.width)} ${px(UI_INVENTORY_SLOTS.height)}`,
    );
    root.style.setProperty('--slot-idle', `-${px(UI_SLOT.idle.x)} -${px(UI_SLOT.idle.y)}`);
    root.style.setProperty(
      '--slot-selected',
      `-${px(UI_SLOT.selected.x)} -${px(UI_SLOT.selected.y)}`,
    );
  }

  mount(host: HotbarHost): HTMLElement {
    this.host = host;

    this.root = document.createElement('div');
    this.root.className = 'hotbar';
    this.root.setAttribute('role', 'radiogroup');
    this.root.setAttribute('aria-label', 'Hotbar');

    this.applyScale();
    /*
     * Re-applied on resize (T-18.03). The scale is chosen from the viewport
     * height, and dragging a window shorter has to shrink the strip — otherwise
     * the camera, which re-fits on the same event and reserves this element's
     * height, is measuring a hotbar that no longer matches the screen.
     */
    window.addEventListener('resize', this.onResize);

    for (let index = 0; index < HOTBAR_SLOTS; index++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'hotbar__slot';
      cell.setAttribute('role', 'radio');
      cell.dataset['slot'] = String(index);
      cell.append(
        Object.assign(document.createElement('span'), {
          className: 'hotbar__key',
          textContent: keyLabel(index),
        }),
        Object.assign(document.createElement('span'), { className: 'hotbar__art' }),
        Object.assign(document.createElement('span'), { className: 'hotbar__qty' }),
      );
      cell.addEventListener('click', () => this.select(index));

      this.cells.push(cell);
      this.root.append(cell);
    }

    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    // One listener, on the document, so a wheel over the canvas works too.
    // Non-passive because cycling must not also scroll the page.
    document.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });

    this.render();
    return this.root;
  }

  /**
   * The equipped slot, or null when it is empty.
   *
   * Resolved from the CURRENT slots every call rather than cached on selection:
   * the item under the cursor can change without the cursor moving — a harvest
   * empties a slot, a poll rearranges the bag — and a cached answer would go
   * stale silently.
   */
  getEquipped(): Equipped | null {
    const slot = this.slots.find((s) => s.slotIndex === this.selected);
    return slot ? { slotIndex: slot.slotIndex, itemId: slot.itemId } : null;
  }

  get selectedIndex(): number {
    return this.selected;
  }

  /** Fires on selection changes AND when the equipped item itself changes. */
  onEquippedChange(listener: (equipped: Equipped | null) => void): void {
    this.listeners.push(listener);
    listener(this.getEquipped());
  }

  /**
   * The authoritative backpack, from whichever panel last fetched it.
   *
   * The hotbar never fetches: the bag panel and the farm poll both already do,
   * and a third fetcher would be a third answer to what is in the bag.
   */
  setSlots(slots: readonly InventorySlot[]): void {
    const before = this.getEquipped();
    this.slots = [...slots];
    this.render();
    this.announceIfChanged(before);
  }

  private select(index: number): void {
    if (index === this.selected) return;
    const before = this.getEquipped();
    this.selected = index;
    this.render();
    this.announceIfChanged(before);
  }

  private announceIfChanged(before: Equipped | null): void {
    const after = this.getEquipped();
    if (before?.slotIndex === after?.slotIndex && before?.itemId === after?.itemId) return;
    for (const listener of this.listeners) listener(after);
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Typing a quantity into the shop must not also re-equip (CLAUDE.md §2).
    if (isTypingInDom()) return;
    // A browser shortcut (Ctrl+1 switches tab) is not a hotbar press.
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const index = SLOT_CODES.indexOf(event.code);
    if (index === -1 || index >= HOTBAR_SLOTS) return;

    event.preventDefault();
    this.select(index);
  }

  private onWheel(event: WheelEvent): void {
    if (isTypingInDom() || event.deltaY === 0) return;

    /*
     * A wheel over an open panel is someone scrolling a list of shop rows or
     * chest slots — the bag and the chest both overflow — so only the world
     * and the hotbar itself cycle. The canvas is outside `.hud` entirely,
     * which is what makes this one check enough.
     */
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.hud') && !target.closest('.hotbar')) return;

    event.preventDefault();
    const step = event.deltaY > 0 ? 1 : -1;
    // Wraps in both directions: a hotbar you can fall off the end of makes the
    // wheel useless for reaching slot 1 from slot 12.
    this.select((this.selected + step + HOTBAR_SLOTS) % HOTBAR_SLOTS);
  }

  private render(): void {
    const occupied = new Map(this.slots.map((s) => [s.slotIndex, s]));

    for (const [index, cell] of this.cells.entries()) {
      const slot = occupied.get(index);
      const isSelected = index === this.selected;

      cell.classList.toggle('is-selected', isSelected);
      cell.classList.toggle('is-empty', !slot);
      cell.setAttribute('aria-checked', String(isSelected));

      const art = cell.querySelector<HTMLElement>('.hotbar__art')!;
      const qty = cell.querySelector<HTMLElement>('.hotbar__qty')!;

      if (!slot) {
        art.replaceChildren();
        qty.textContent = '';
        // Clearing the dataset is what hides the tooltip for an empty slot;
        // `tooltip.ts` only matches cells that carry `data-item`.
        delete cell.dataset['item'];
        delete cell.dataset['qty'];
        cell.setAttribute('aria-label', `Slot ${index + 1}: empty`);
        continue;
      }

      const icon = this.host.icon(slot.itemId, 2);
      art.replaceChildren(...(icon ? [icon] : []));
      // A stack of one is every tool, and "×1" on all of them is noise.
      qty.textContent = slot.quantity > 1 ? String(slot.quantity) : '';

      const name = ITEMS[slot.itemId]?.name ?? slot.itemId;
      // The styled tooltip reads these; `title` was the native one it replaced.
      cell.dataset['item'] = slot.itemId;
      cell.dataset['qty'] = String(slot.quantity);
      cell.setAttribute('aria-label', `Slot ${index + 1}: ${name}, ${slot.quantity}`);
    }
  }
}

/** What is printed in the corner of a slot: 1–9, then 0, -, =. */
function keyLabel(index: number): string {
  if (index < 9) return String(index + 1);
  return ['0', '-', '='][index - 9] ?? '';
}
