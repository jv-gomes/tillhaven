import { ITEMS } from '@tillhaven/shared/config';
import type { InventorySlot } from '../net/inventory.js';

/**
 * The visual half of a slot grid, shared by the backpack and the chest.
 *
 * Only the *appearance* is shared. The panel attaches its own handlers to the
 * button this returns, because what a slot DOES depends on which container it
 * is in and what is currently picked up — state this module deliberately knows
 * nothing about.
 *
 * (Until T-10.04a there were two panels with two different ideas of what a
 * click meant. There is one now, and the handlers it attaches are the same in
 * both grids.)
 *
 * Every cell is a real `<button>`: that is what makes both grids reachable by
 * keyboard and usable on a touchscreen without any extra work.
 */

export type IconFactory = (itemId: string, scale?: number) => HTMLElement | null;

export interface SlotCellOptions {
  readonly index: number;
  readonly slot: InventorySlot | undefined;
  readonly icon: IconFactory;
  /** Prefix for the accessible name, e.g. "Bag slot 3". */
  readonly label: string;
}

export function buildSlotCell(options: SlotCellOptions): HTMLButtonElement {
  const { index, slot, icon, label } = options;
  const item = slot ? ITEMS[slot.itemId] : undefined;

  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = 'slot';
  cell.dataset['slot'] = String(index);
  cell.classList.toggle('is-empty', !slot);

  cell.setAttribute(
    'aria-label',
    slot
      ? `${label} ${index + 1}: ${item?.name ?? slot.itemId}, ${slot.quantity}`
      : `${label} ${index + 1}: empty`,
  );

  if (!slot) return cell;

  if (item) cell.title = `${item.name} ×${slot.quantity}`;

  const art = icon(slot.itemId, 2);
  if (art) cell.append(art);

  cell.append(
    Object.assign(document.createElement('span'), {
      className: 'slot__qty',
      textContent: String(slot.quantity),
    }),
  );

  return cell;
}

/**
 * Builds a cell per slot, filling in whichever are occupied.
 *
 * Renders `capacity` cells **or as many as it takes to show every stored item**,
 * whichever is more. Those are not always the same number: a chest's capacity
 * includes the VIP bonus, so when VIP lapses the capacity shrinks and anything
 * stored in the slots it used to have is suddenly past the end. Drawing exactly
 * `capacity` cells would make those items invisible — the player would see an
 * empty chest and a stack of missing produce.
 *
 * Capacity limits what you can PUT IN, never what you can see or take out. The
 * cells past it are marked `is-over-capacity` so the difference is legible
 * rather than mysterious.
 */
export function buildSlotCells(
  capacity: number,
  slots: readonly InventorySlot[],
  make: (index: number, slot: InventorySlot | undefined) => HTMLElement,
): HTMLElement[] {
  const occupied = new Map(slots.map((s) => [s.slotIndex, s]));
  const highest = slots.reduce((max, s) => Math.max(max, s.slotIndex + 1), 0);
  const count = Math.max(capacity, highest);

  return Array.from({ length: count }, (_, index) => {
    const cell = make(index, occupied.get(index));
    if (index >= capacity) cell.classList.add('is-over-capacity');
    return cell;
  });
}
