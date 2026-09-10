import { describe, expect, it } from 'vitest';
import { metaFor } from './tooltip.js';
import { ITEMS, ItemCategory, type ItemDef } from '@tillhaven/shared/config';

/**
 * What an item tooltip says (Phase U).
 *
 * **Only the pure half is tested here, and that is the house pattern rather
 * than a shortcut.** This repo has no jsdom — `animalSprites.ts` records the
 * same constraint — so `inventoryPanel.test.ts` tests `parseRef` and not the
 * grid, and this tests `metaFor` and not the hover. The DOM half (delegation,
 * focus, positioning) is verified in a real browser, which is also the only
 * place `getBoundingClientRect` returns anything meaningful.
 *
 * The lines below are the tooltip's actual decisions. Each one exists because
 * the obvious version says something wrong.
 */

const anyTool = Object.values(ITEMS).find((i) => i.category === ItemCategory.TOOL);
const anySellable = Object.values(ITEMS).find(
  (i) => i.category !== ItemCategory.TOOL && i.shopSellPrice !== null,
);

describe('what a tooltip says about an item', () => {
  it('always leads with how full the stack is', () => {
    expect(metaFor(anySellable!, 3)).toContain(`3 / ${anySellable!.stackLimit}`);
  });

  /**
   * Tools are stack-1, unsellable and untradeable by design (CLAUDE.md §5.2).
   * Printing "sells for 0g" for a hoe describes a rule as if it were a price,
   * and a player reasonably reads that as the game being broken.
   */
  it('calls a tool a tool rather than quoting it at nothing', () => {
    expect(anyTool, 'no tool in ITEMS to test with').toBeDefined();
    expect(metaFor(anyTool!, 1)).toContain('tool');
    expect(metaFor(anyTool!, 1)).not.toContain('0g');
    expect(metaFor(anyTool!, 1)).not.toContain('sells for');
  });

  it('quotes the merchant price for something the merchant buys', () => {
    expect(metaFor(anySellable!, 1)).toContain(`sells for ${anySellable!.shopSellPrice}g`);
  });

  /**
   * Untradeable is worth saying out loud. A player who cannot see it finds out
   * by building a trade offer that will not accept the item, which is the worst
   * possible moment to learn a rule.
   */
  it('warns when an item cannot cross a trade', () => {
    const untradeable: ItemDef = { ...anySellable!, tradeable: false };
    expect(metaFor(untradeable, 1)).toContain('not tradeable');
  });

  it('stays quiet about tradeability when there is nothing to warn about', () => {
    const tradeable: ItemDef = { ...anySellable!, tradeable: true };
    expect(metaFor(tradeable, 1)).not.toContain('not tradeable');
  });

  it('separates its parts so the line reads as a list', () => {
    const line = metaFor({ ...anySellable!, tradeable: false }, 2);
    expect(line.split(' · ').length).toBeGreaterThanOrEqual(3);
  });
});
