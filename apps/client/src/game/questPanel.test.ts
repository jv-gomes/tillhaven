import { describe, it, expect } from 'vitest';
import type { QuestView } from '../net/quests.js';
import { canTurnIn, questPercent, questRewardText, questRows } from './questPanel.js';

/**
 * T-33.07. What a quest row says, decided without a browser.
 *
 * The failure that matters most here is a row telling the player they are nearly
 * finished when they cannot finish at all — the surplus of one item filling the
 * bar for another they hold none of.
 */

function view(over: Partial<QuestView> = {}): QuestView {
  return {
    id: 'chef_first_basket',
    giver: 'chef',
    title: 'Something green',
    summary: 'Bring me four leeks.',
    requires: [{ itemId: 'leek', quantity: 4 }],
    reward: { gold: 0, items: [{ itemId: 'potato_seeds', quantity: 4 }] },
    unlockLevel: 1,
    status: 'available',
    rotating: false,
    ...over,
  };
}

const bag = (counts: Record<string, number>) => (id: string) => counts[id] ?? 0;

describe('questPercent', () => {
  it('is zero with an empty bag and a hundred when the ask is met', () => {
    expect(questPercent(view(), bag({}))).toBe(0);
    expect(questPercent(view(), bag({ leek: 4 }))).toBe(100);
  });

  it('does not exceed a hundred when the player holds more than asked', () => {
    expect(questPercent(view(), bag({ leek: 400 }))).toBe(100);
  });

  /**
   * **The bug this function exists to avoid.** Six carrots and three potatoes:
   * holding thirty carrots and no potatoes is 6/9, not 100%. Without the
   * per-requirement cap the surplus of one item fills the bar for the other and
   * the row says "nearly there" to somebody who cannot finish.
   */
  it('caps each requirement before summing, so a surplus cannot fill another bar', () => {
    const roots = view({
      requires: [
        { itemId: 'carrot', quantity: 6 },
        { itemId: 'potato', quantity: 3 },
      ],
    });

    expect(questPercent(roots, bag({ carrot: 30 }))).toBe(67);
    expect(questPercent(roots, bag({ carrot: 6, potato: 3 }))).toBe(100);
  });

  it('treats a negative count as nothing rather than going backwards', () => {
    expect(questPercent(view(), bag({ leek: -5 }))).toBe(0);
  });
});

describe('canTurnIn', () => {
  /**
   * Deliberately not `percent === 100`. Rounding reaches 100 before the last
   * item does on a large enough ask, and a Turn in button that refuses is worse
   * than one that is not offered.
   */
  it('is false while any requirement is short, however small the shortfall', () => {
    const big = view({ requires: [{ itemId: 'leek', quantity: 400 }] });

    expect(questPercent(big, bag({ leek: 399 }))).toBe(100);
    expect(canTurnIn(big, bag({ leek: 399 }))).toBe(false);
    expect(canTurnIn(big, bag({ leek: 400 }))).toBe(true);
  });

  it('needs every item of a multi-item request', () => {
    const roots = view({
      requires: [
        { itemId: 'carrot', quantity: 2 },
        { itemId: 'potato', quantity: 2 },
      ],
    });
    expect(canTurnIn(roots, bag({ carrot: 2 }))).toBe(false);
    expect(canTurnIn(roots, bag({ carrot: 2, potato: 2 }))).toBe(true);
  });
});

describe('questRewardText', () => {
  it('names items rather than counting them', () => {
    expect(questRewardText(view())).toBe('4 × Potato Seeds');
  });

  it('says both halves when a request pays gold and goods', () => {
    const both = view({ reward: { gold: 500, items: [{ itemId: 'leek_seeds', quantity: 2 }] } });
    expect(questRewardText(both)).toBe('500g and 2 × Leek Seeds');
  });

  it('says gold alone for a rotating request', () => {
    expect(questRewardText(view({ reward: { gold: 1200, items: [] } }))).toBe('1,200g');
  });
});

describe('questRows', () => {
  it('drops completed requests rather than listing them as ticks', () => {
    const rows = questRows([view({ status: 'completed' })], bag({}));
    expect(rows).toEqual([]);
  });

  it('marks a request ready only when it is accepted AND filled', () => {
    const held = bag({ leek: 4 });

    expect(questRows([view({ status: 'available' })], held)[0]!.turnInReady).toBe(false);
    expect(questRows([view({ status: 'accepted' })], held)[0]!.turnInReady).toBe(true);
  });

  it('offers Accept only on a request not yet taken on', () => {
    expect(questRows([view({ status: 'available' })], bag({}))[0]!.acceptable).toBe(true);
    expect(questRows([view({ status: 'accepted' })], bag({}))[0]!.acceptable).toBe(false);
  });

  /**
   * Ready first, then the ones with a deadline. A reward waiting to be collected
   * is the most useful thing the panel can point at — the same rule `nextGoals`
   * follows — and after that, the thing that expires.
   */
  it('puts what can be handed in first, then what expires', () => {
    const rows = questRows(
      [
        view({ id: 'permanent', status: 'available', rotating: false }),
        view({ id: 'rotating', status: 'available', rotating: true }),
        view({ id: 'ready', status: 'accepted', rotating: false }),
      ],
      bag({ leek: 4 }),
    );

    expect(rows.map((r) => r.id)).toEqual(['ready', 'rotating', 'permanent']);
  });

  it('counts each need against the bag, capped at what was asked', () => {
    const rows = questRows([view({ requires: [{ itemId: 'leek', quantity: 4 }] })], bag({ leek: 9 }));
    expect(rows[0]!.needs).toEqual(['4 / 4 Leek']);
  });

  it('shows a shortfall honestly', () => {
    const rows = questRows([view()], bag({ leek: 1 }));
    expect(rows[0]!.needs).toEqual(['1 / 4 Leek']);
  });
});
