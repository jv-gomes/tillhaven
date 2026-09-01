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
