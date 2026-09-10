import { ITEMS, ItemCategory, type ItemDef } from '@tillhaven/shared/config';

/**
 * Item tooltips (Phase U).
 *
 * **There was no tooltip anywhere in this game before now.** Slots carried a
 * native `title`, which the browser renders after a ~500ms delay, in the OS
 * font, at the cursor, with no way to style it — so the one place the game
 * explained what an item is looked like a spreadsheet, arrived late, and never
 * appeared at all for a keyboard user.
 *
 * Three decisions worth stating, because each one is the reason a naive version
 * of this feels wrong:
 *
 *   - **One element, delegated.** A tooltip per cell means 36 nodes rebuilt on
 *     every inventory poll. There is exactly one, moved and refilled on demand.
 *   - **Focus counts as hover.** `focusin` shows it too, so tabbing through the
 *     backpack explains items the same way pointing at them does. The cells are
 *     real `<button>`s precisely so that works (`slotGrid.ts`).
 *   - **It never takes a pointer event** (`pointer-events: none` in `ui.css`).
 *     A tooltip that can be hovered sits under the cursor, steals the mouseout,
 *     and flickers.
 *
 * The tooltip is `aria-hidden`: everything it says is already in each cell's
 * `aria-label`, so announcing it again would read every item twice.
 */

/** Gap between the cell and the tooltip, in px. */
const OFFSET = 10;

/** Keeps the tooltip fully on screen. */
const MARGIN = 8;

export interface Tooltip {
  readonly el: HTMLElement;
  destroy(): void;
}

/**
 * What a tooltip says about an item, beyond its name.
 *
 * Exported and pure so it can be tested: this repo has **no jsdom**
 * (`animalSprites.ts` records the same constraint), so the house pattern is to
 * pull the decision out of the DOM code and unit-test that, then verify the
 * hover and focus behaviour in a real browser. The decisions here — that a tool
 * says "tool" rather than "0g", and that untradeable is called out — are the
 * part worth pinning; `show()` below is just positioning.
 */
export function metaFor(item: ItemDef, quantity: number): string {
  const parts: string[] = [];

  parts.push(`${quantity} / ${item.stackLimit}`);

  if (item.category === ItemCategory.TOOL) {
    // Tools are stack-1, unsellable and untradeable by design (CLAUDE.md §5.2).
    // Saying "0g" for them would read as a bug rather than a rule.
    parts.push('tool');
  } else if (item.shopSellPrice !== null) {
    parts.push(`sells for ${item.shopSellPrice}g`);
  }

  if (!item.tradeable) parts.push('not tradeable');

  return parts.join(' · ');
}

/**
 * Mounts the single tooltip into `host` and wires delegated listeners.
 *
 * Returns a handle so the HUD can tear it down; the listeners are on `host`
 * rather than on cells, so nothing needs rebinding when a grid re-renders.
 */
export function mountTooltip(host: HTMLElement): Tooltip {
  const el = document.createElement('div');
  el.className = 'ui-tooltip ui-dialogue';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;

  const name = document.createElement('span');
  name.className = 'ui-tooltip__name';
  const meta = document.createElement('span');
  meta.className = 'ui-tooltip__meta';
  el.append(name, meta);
  host.append(el);

  const hide = () => {
    el.hidden = true;
  };

  const show = (cell: HTMLElement) => {
    const itemId = cell.dataset['item'];
    const quantity = Number(cell.dataset['qty'] ?? '0');
    if (!itemId) return hide();

    const item = ITEMS[itemId];
    if (!item) return hide();

    name.textContent = item.name;
    meta.textContent = metaFor(item, quantity);

    // Unhide before measuring — a hidden element has no size to position by.
    el.hidden = false;

    const cellBox = cell.getBoundingClientRect();
    const tip = el.getBoundingClientRect();

    // Above the cell by default; below it when there is no room above, which is
    // the hotbar's case — it lives at the bottom of the screen.
    let top = cellBox.top - tip.height - OFFSET;
    if (top < MARGIN) top = cellBox.bottom + OFFSET;

    let left = cellBox.left + cellBox.width / 2 - tip.width / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - tip.width - MARGIN));

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  };

  const cellFrom = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>('.slot[data-item], .hotbar__slot[data-item]');
  };

  const onOver = (event: Event) => {
    const cell = cellFrom(event.target);
    if (cell) show(cell);
    else hide();
  };

  host.addEventListener('mouseover', onOver);
  host.addEventListener('focusin', onOver);
  host.addEventListener('mouseout', hide);
  host.addEventListener('focusout', hide);
  // A tooltip left behind by a panel that closed under the cursor is a ghost.
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  return {
    el,
    destroy() {
      host.removeEventListener('mouseover', onOver);
      host.removeEventListener('focusin', onOver);
      host.removeEventListener('mouseout', hide);
      host.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      el.remove();
    },
  };
}
