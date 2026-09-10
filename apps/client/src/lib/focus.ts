/**
 * Whether the player is typing into the page rather than playing.
 *
 * The HUD is real DOM over the canvas (CLAUDE.md §2) and every game key
 * listener is on the window, so without this a shop quantity of "3" also
 * selects hotbar slot 3, and typing a farm name walks the character across the
 * field. Phaser's own key handling does not check what has focus.
 *
 * Lives here rather than in `Player.ts` because it is now needed by two
 * unrelated input paths — movement and the hotbar (T-8.07) — and two copies of
 * this predicate would drift the moment one of them learns about a new kind of
 * editable element.
 */
export function isTypingInDom(): boolean {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

/**
 * The attribute that marks a HUD element as a MODAL panel (T-18.12, BUG-10).
 *
 * Declarative rather than a list of panel classes held somewhere central: a
 * panel opts in by carrying the attribute on its root, and a new one that
 * forgets it fails visibly (the character walks out from under it) rather than
 * silently diverging from a registry nobody remembers to update.
 */
export const MODAL_ATTR = 'data-modal';

/** The subset of `Document` this needs. Keeps the decision testable in node. */
export interface ModalHost {
  querySelector(selectors: string): unknown;
}

/**
 * Whether a modal HUD panel is open over the canvas.
 *
 * **The bug this exists for:** the shop, the chest and the shipping box are
 * real DOM over the canvas, and every movement key listener is on the window.
 * Opening the shop at the merchant and holding the right arrow walked the
 * character away across the farm with the shop still open (BUG-10) — the action
 * key was guarded by `isTypingInDom`, and movement was not guarded at all.
 *
 * `isTypingInDom` is not enough on its own and never was: it answers "is a text
 * field focused", and a shop with no input focused is still a shop the player
 * is looking at rather than a farm they are walking around.
 *
 * **Popovers deliberately do not carry the attribute.** The decor tray is the
 * clearest case — arming a piece and then WALKING to where it goes is the whole
 * interaction, so a tray that froze the character would break the feature it
 * belongs to. The rule is "a dialog you are reading" takes input, not "any
 * floating element".
 */
export function modalOpenIn(host: ModalHost | null | undefined): boolean {
  return host?.querySelector(`[${MODAL_ATTR}]:not([hidden])`) != null;
}

export function isModalOpen(): boolean {
  return typeof document !== 'undefined' && modalOpenIn(document);
}
