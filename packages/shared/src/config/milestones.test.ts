import { describe, expect, it } from 'vitest';
import {
  MILESTONES,
  MILESTONE_IDS,
  MILESTONE_REQUIREMENT_KINDS,
  getMilestone,
  isGrantableItem,
  isMilestoneEarned,
  requirementProgress,
  requirementTarget,
  type MilestoneProgressInput,
} from './milestones.js';
import { ITEMS, ItemCategory } from './items.js';
import { MAX_FARM_LEVEL } from './level.js';
import { STARTING_PLOTS, MAX_PLOTS } from './economy.js';
import { CROPS, CROP_IDS, unlockLevelForSeed } from './crops.js';

const EMPTY: MilestoneProgressInput = {
  plotsTilled: 0,
  experience: 0,
  farmLevel: 1,
  animalsOwned: 0,
  shipmentsMade: 0,
  plotsUnlocked: STARTING_PLOTS,
};

describe('the table', () => {
  it('has unique ids', () => {
    expect(new Set(MILESTONE_IDS).size).toBe(MILESTONES.length);
  });

  it('finds a milestone by id, and nothing by a bad one', () => {
    expect(getMilestone('break_ground')?.title).toBe('Break ground');
    expect(getMilestone('no_such_thing')).toBeUndefined();
  });

  it('gives every milestone a title and an imperative hint', () => {
    for (const m of MILESTONES) {
      expect(m.title.length, m.id).toBeGreaterThan(0);
      expect(m.hint.length, m.id).toBeGreaterThan(0);
      // A hint that just restates the counter is not a hint.
      expect(m.hint, m.id).toMatch(/[.!]$/);
    }
  });
});

/**
 * The load-bearing constraint. A requirement that can become FALSE again is a
 * milestone that appears, goes unclaimed, and vanishes — worse than never
 * offering it. Only monotonic facts are allowed, and this is the list.
 */
describe('every requirement is derivable and monotonic', () => {
  it('uses only the declared kinds', () => {
    for (const m of MILESTONES) {
      expect(MILESTONE_REQUIREMENT_KINDS, m.id).toContain(m.requirement.kind);
    }
  });

  it('has a progress reader and a target for every kind in use', () => {
    const full: MilestoneProgressInput = {
      plotsTilled: 99,
      experience: 99_999,
      farmLevel: MAX_FARM_LEVEL,
      animalsOwned: 99,
      shipmentsMade: 99,
      plotsUnlocked: MAX_PLOTS,
    };

    for (const m of MILESTONES) {
      expect(Number.isFinite(requirementTarget(m.requirement)), m.id).toBe(true);
      expect(Number.isFinite(requirementProgress(m.requirement, full)), m.id).toBe(true);
      // A generously-progressed farm has earned all of them.
      expect(isMilestoneEarned(m, full), m.id).toBe(true);
    }
  });

  /**
   * `harvested_at` and `watered_at` are both reset to null by `plant()`, so
   * neither is a lifetime fact. A milestone reading one would flicker off as
   * the player replants — this asserts the mistake was not made.
   */
  it('reads nothing that plant() resets', () => {
    for (const kind of MILESTONE_REQUIREMENT_KINDS) {
      expect(kind).not.toMatch(/harvest|water/i);
    }
  });

  it('earns nothing on a brand-new farm', () => {
    for (const m of MILESTONES) {
      expect(isMilestoneEarned(m, EMPTY), m.id).toBe(false);
    }
  });

  it('is monotonic: more progress never un-earns a milestone', () => {
    const steps: MilestoneProgressInput[] = [
      EMPTY,
      { ...EMPTY, plotsTilled: 1 },
      { ...EMPTY, plotsTilled: 6, experience: 9 },
      { ...EMPTY, plotsTilled: 6, experience: 500, farmLevel: 5, shipmentsMade: 1 },
      {
        plotsTilled: 20,
        experience: 99_999,
        farmLevel: MAX_FARM_LEVEL,
        animalsOwned: 12,
        shipmentsMade: 40,
        plotsUnlocked: MAX_PLOTS,
      },
    ];

    for (const m of MILESTONES) {
      let earnedAt = -1;
      steps.forEach((step, i) => {
        const earned = isMilestoneEarned(m, step);
        if (earned && earnedAt === -1) earnedAt = i;
        if (earnedAt !== -1) {
          expect(earned, `${m.id} un-earned itself at step ${i}`).toBe(true);
        }
      });
    }
  });
});

describe('the rewards', () => {
  it('grants only integers', () => {
    for (const m of MILESTONES) {
      expect(Number.isInteger(m.reward.gold), m.id).toBe(true);
      expect(m.reward.gold, m.id).toBeGreaterThanOrEqual(0);
      for (const stack of m.reward.items) {
        expect(Number.isInteger(stack.quantity), `${m.id}/${stack.itemId}`).toBe(true);
        expect(stack.quantity, `${m.id}/${stack.itemId}`).toBeGreaterThan(0);
      }
    }
  });

  it('grants only items that exist', () => {
    for (const m of MILESTONES) {
      for (const stack of m.reward.items) {
        expect(ITEMS[stack.itemId], `${m.id} grants unknown item ${stack.itemId}`).toBeDefined();
      }
    }
  });

  /**
   * Tools are `stackLimit: 1`, unsellable and untradeable. Granting one hands
   * out a duplicate of something the game treats as unique, and `axe_wood` is
   * a 200g purchase a free copy would undercut.
   */
  it('never grants a tool', () => {
    for (const m of MILESTONES) {
      for (const stack of m.reward.items) {
        expect(isGrantableItem(stack.itemId), `${m.id} grants a tool`).toBe(true);
        expect(ITEMS[stack.itemId]!.category, `${m.id}/${stack.itemId}`).not.toBe(
          ItemCategory.TOOL,
        );
      }
    }
  });

  it('rejects a tool and an unknown id at the guard itself', () => {
    expect(isGrantableItem('hoe_wood')).toBe(false);
    expect(isGrantableItem('axe_wood')).toBe(false);
    expect(isGrantableItem('leek_seeds')).toBe(true);
    expect(isGrantableItem('no_such_item')).toBe(false);
  });

  /**
   * D-18: the first-session problem is a WAIT, and gold does not shorten a
   * wait. Paying for milestones would also add a faucet `docs/economy.md` has
   * to carry. The one exception marks the trade gate.
   */
  it('pays in goods, not gold, save for the one that marks the trade gate', () => {
    const paying = MILESTONES.filter((m) => m.reward.gold > 0);
    expect(paying).toHaveLength(1);
    expect(paying[0]!.id).toBe('level_5');
    expect(paying[0]!.requirement).toEqual({ kind: 'farmLevel', level: 5 });
  });

  /**
   * **A level milestone must not pay a seed the player still cannot buy**
   * (T-31.07).
   *
   * Planting is never gated — only buying is (T-31.06) — so a locked seed
   * given as a reward *works*, exactly once, and then the player goes to the
   * merchant to buy more and is refused. That is a worse experience than not
   * being given it: the reward teaches them about a crop and then takes it
   * away. Rewarding a seed at or below the level being celebrated means the
   * shop backs the gift up.
   */
  it('never rewards a level with a seed that level cannot buy', () => {
    const wrong: string[] = [];

    for (const m of MILESTONES) {
      if (m.requirement.kind !== 'farmLevel') continue;
      for (const stack of m.reward.items) {
        const needs = unlockLevelForSeed(stack.itemId);
        if (needs !== null && needs > m.requirement.level) {
          wrong.push(
            `${m.id} (level ${m.requirement.level}) pays ${stack.itemId}, which needs level ${needs}`,
          );
        }
      }
    }

    expect(wrong, 'the shop would refuse to restock this reward').toEqual([]);
  });

  /**
   * The board is the only place the game explains what farm level is FOR, so
   * every level that opens the shop should have a milestone naming it. Checked
   * as a set rather than a count: a new unlock level added without a milestone
   * is content that ships inert, which is the thing T-31.07 exists to prevent.
   */
  it('names every farm level that unlocks a seed', () => {
    const unlockLevels = new Set(
      CROP_IDS.map((id) => CROPS[id].unlockLevel).filter((level) => level > 1),
    );
    const celebrated = new Set(
      MILESTONES.filter((m) => m.requirement.kind === 'farmLevel').map((m) =>
        requirementTarget(m.requirement),
      ),
    );

    const unmarked = [...unlockLevels].filter((level) => !celebrated.has(level)).sort((a, b) => a - b);
    expect(unmarked, 'these levels open the shop and nothing on the board says so').toEqual([]);
  });

  /**
   * ...and the mirror, which started as "at most one level milestone may
   * unlock nothing" and got tightened when the first version failed.
   *
   * `level_10` was that one exception — a round number celebrating nothing,
   * while levels 9 and 11 opened the shop with no goal pointing at them. It
   * became `level_9`, `level_11` was added, and the exception stopped being
   * needed. **Every level milestone now names an unlock**, which is a stronger
   * claim than the one this test was written to make.
   */
  it('has no level milestone that unlocks nothing', () => {
    const unlockLevels = new Set(CROP_IDS.map((id) => CROPS[id].unlockLevel));
    const idle = MILESTONES.filter(
      (m) => m.requirement.kind === 'farmLevel' && !unlockLevels.has(m.requirement.level),
    );

    expect(
      idle.map((m) => `${m.id} at level ${requirementTarget(m.requirement)}`),
      'a level goal that opens nothing is a number pretending to be a reward',
    ).toEqual([]);
  });

  it('gives every milestone something to grant', () => {
    for (const m of MILESTONES) {
      expect(m.reward.gold > 0 || m.reward.items.length > 0, `${m.id} grants nothing`).toBe(true);
    }
  });
});

/**
 * Ordering is by earliest-reachable, so the board never shows a later goal
 * above an earlier one. Checked WITHIN a requirement kind, because comparing a
 * plot count against an experience total is meaningless.
 */
describe('ordering', () => {
  it('is non-decreasing within each requirement kind', () => {
    for (const kind of MILESTONE_REQUIREMENT_KINDS) {
      const targets = MILESTONES.filter((m) => m.requirement.kind === kind).map((m) =>
        requirementTarget(m.requirement),
      );
      const sorted = [...targets].sort((a, b) => a - b);
      expect(targets, `${kind} milestones are out of order`).toEqual(sorted);
    }
  });

  it('opens with a milestone a player earns in their first minute', () => {
    const first = MILESTONES[0]!;
    expect(first.requirement).toEqual({ kind: 'plotsTilled', count: 1 });
    expect(isMilestoneEarned(first, { ...EMPTY, plotsTilled: 1 })).toBe(true);
  });

  /**
   * The first two are reachable inside the opening minutes — tilling one plot
   * and tilling all six. The third needs a harvest, and that used to mean a
   * 45-minute wait: this comment recorded, rather than padded around, that no
   * third milestone could land inside ten minutes *"until T-31.05 ships a
   * sub-15-minute starter crop"*.
   *
   * **T-31.05 shipped it.** The starter kit is four parsnip at 12 minutes, so
   * the third milestone now lands at about 0:15 — the whole board's first
   * three goals inside one sitting. The assertion is unchanged, because what
   * it pins is still true and still worth pinning: the third goal must be
   * *earned by farming*, not by tilling more dirt.
   */
  it('reaches its first two on tilling alone', () => {
    const tilledSix = { ...EMPTY, plotsTilled: 6 };
    expect(isMilestoneEarned(MILESTONES[0]!, tilledSix)).toBe(true);
    expect(isMilestoneEarned(MILESTONES[1]!, tilledSix)).toBe(true);
    // ...and the third still needs a harvest, which needs the wait.
    expect(isMilestoneEarned(MILESTONES[2]!, tilledSix)).toBe(false);
    expect(MILESTONES[2]!.requirement.kind).toBe('experience');
  });

  it('never asks for more plots than the map has', () => {
    for (const m of MILESTONES) {
      if (m.requirement.kind === 'plotsUnlocked' || m.requirement.kind === 'plotsTilled') {
        expect(requirementTarget(m.requirement), m.id).toBeLessThanOrEqual(MAX_PLOTS);
      }
      if (m.requirement.kind === 'farmLevel') {
        expect(requirementTarget(m.requirement), m.id).toBeLessThanOrEqual(MAX_FARM_LEVEL);
      }
    }
  });
});
