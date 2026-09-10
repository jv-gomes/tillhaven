import { describe, it, expect } from 'vitest';
import { ItemCategory, ITEMS } from './items.js';
import { isGrantableItem } from './milestones.js';
import { NPC_DIALOGUE } from './dialogue.js';
import { FISH } from './fish.js';
import {
  DAILY_REQUEST_SLOTS,
  QUESTS,
  QUEST_IDS,
  QUEST_ROTATION_MS,
  dailyRequestId,
  dailyRequestsFor,
  parseDailyRequestId,
  resolveQuest,
  rotationEndsAt,
  rotationIndexAt,
  FISHING_IS_REACHABLE,
  obtainableAtLevel,
  questById,
  questsForLevel,
  requirementSellValue,
  rewardGoldValue,
} from './quests.js';

/**
 * T-33.04. The quest table, checked for the failures that make a quest board
 * worse than no quest board.
 *
 * The worst of them is not a crash: it is a board that asks a level-2 farm for
 * artisan cheese. The player cannot tell whether they are missing something or
 * the game is broken, and either way they learn to ignore the board — which, as
 * T-33.06 puts it, is worse than not having one.
 */
describe('every quest', () => {
  const quests = QUESTS.map((q) => [q.id, q] as const);

  it('has a unique id', () => {
    expect(new Set(QUEST_IDS).size).toBe(QUEST_IDS.length);
  });

  it.each(quests)('%s is given by somebody who can speak', (_id, quest) => {
    const givers = NPC_DIALOGUE.map((n) => n.id);
    expect(givers, `${quest.id} is given by "${quest.giver}", who has no dialogue`).toContain(
      quest.giver,
    );
  });

  it.each(quests)('%s asks for items that exist', (_id, quest) => {
    for (const need of quest.requires) {
      expect(ITEMS[need.itemId], `${quest.id} asks for unknown item "${need.itemId}"`).toBeDefined();
    }
  });

  it.each(quests)('%s asks for whole, positive quantities', (_id, quest) => {
    expect(quest.requires.length, `${quest.id} asks for nothing`).toBeGreaterThan(0);
    for (const need of quest.requires) {
      expect(Number.isInteger(need.quantity), `${quest.id}: ${need.itemId} is fractional`).toBe(
        true,
      );
      expect(need.quantity, `${quest.id}: ${need.itemId}`).toBeGreaterThan(0);
    }
  });

  /**
   * **The headline invariant.** A quest offered at level N must be completable
   * by a farm at level N — which means every crop it names has to be one the
   * merchant will already sell the seed for.
   *
   * This is what lets T-33.06 derive its board from `unlockLevel` alone instead
   * of re-deriving obtainability at request time.
   */
  it.each(quests)('%s asks only for what its level can obtain', (_id, quest) => {
    for (const need of quest.requires) {
      expect(
        obtainableAtLevel(need.itemId, quest.unlockLevel),
        `${quest.id} unlocks at farm level ${quest.unlockLevel} but asks for ` +
          `"${need.itemId}", which a farm cannot grow until later`,
      ).toBe(true);
    }
  });

  /**
   * **Never ask for a tool.** Tools are stack-1, unsellable and unique per
   * player (§5.2); a quest that consumed one would take the player's only hoe
   * and leave them unable to farm, with no way to get it back.
   */
  it.each(quests)('%s does not ask for a tool', (_id, quest) => {
    for (const need of quest.requires) {
      expect(
        ITEMS[need.itemId]?.category,
        `${quest.id} asks for "${need.itemId}", which is a tool`,
      ).not.toBe(ItemCategory.TOOL);
    }
  });

  it.each(quests)('%s pays whole, non-negative gold', (_id, quest) => {
    expect(Number.isInteger(quest.reward.gold), `${quest.id} pays fractional gold`).toBe(true);
    expect(quest.reward.gold, quest.id).toBeGreaterThanOrEqual(0);
  });

  /**
   * The same guard `grantReward` enforces at runtime, applied to the table so a
   * bad reward fails the build rather than a player's turn-in. A tool granted by
   * a quest would duplicate something the game treats as unique.
   */
  it.each(quests)('%s grants nothing that cannot be granted', (_id, quest) => {
    for (const stack of quest.reward.items) {
      expect(ITEMS[stack.itemId], `${quest.id} grants unknown item "${stack.itemId}"`).toBeDefined();
      expect(isGrantableItem(stack.itemId), `${quest.id} grants a tool`).toBe(true);
      expect(Number.isInteger(stack.quantity), `${quest.id}: fractional quantity`).toBe(true);
      expect(stack.quantity, `${quest.id}: ${stack.itemId}`).toBeGreaterThan(0);
    }
  });

  it.each(quests)('%s pays something', (_id, quest) => {
    expect(
      quest.reward.gold + quest.reward.items.length,
      `${quest.id} pays nothing at all`,
    ).toBeGreaterThan(0);
  });

  /**
   * **A quest must beat the shipping box**, or it is a worse way to sell the
   * same crop and the only thing it teaches the player is not to bother.
   *
   * Compared against `shopSellPrice` because that is the number the player
   * compares it against — the merchant is standing right there. Seeds in the
   * reward count at what the merchant charges for them, which is the honest
   * valuation of a thing you would otherwise have to buy.
   */
  it.each(quests)('%s pays more than selling the same items', (_id, quest) => {
    const asked = requirementSellValue(quest);
    const paid = rewardGoldValue(quest.reward);
    expect(
      paid,
      `${quest.id} asks for ${asked}g worth of goods and pays ${paid}g — a player ` +
        'is better off shipping them, so the quest is a trap',
    ).toBeGreaterThan(asked);
  });

  /**
   * ...but not so much more that a quest dominates farming itself. An unbounded
   * multiple is how an economy gets a single optimal action, and
   * `docs/economy.md` would have to carry it as a faucet either way.
   */
  it.each(quests)('%s does not pay absurdly more than the goods are worth', (_id, quest) => {
    const asked = requirementSellValue(quest);
    const paid = rewardGoldValue(quest.reward);
    // Quests are repeatable-shaped content; 4x the sale value is generous
    // without making "grow the quest crop" the only rational play.
    expect(paid, `${quest.id} pays ${paid}g for ${asked}g of goods`).toBeLessThanOrEqual(
      Math.max(asked * 4, 600),
    );
  });
});

describe('questsForLevel', () => {
  it('offers nothing a level-1 farm cannot finish', () => {
    for (const quest of questsForLevel(1)) {
      for (const need of quest.requires) {
        expect(obtainableAtLevel(need.itemId, 1), `${quest.id} wants ${need.itemId}`).toBe(true);
      }
    }
  });

  it('never offers a quest above the given level', () => {
    for (const level of [1, 2, 3, 5, 10, 40]) {
      for (const quest of questsForLevel(level)) {
        expect(quest.unlockLevel).toBeLessThanOrEqual(level);
      }
    }
  });

  it('opens up rather than closing down as the farm grows', () => {
    let previous = 0;
    for (const level of [1, 2, 3, 4, 5, 10, 40]) {
      const count = questsForLevel(level).length;
      expect(count, `level ${level} offers fewer quests than the level below`).toBeGreaterThanOrEqual(
        previous,
      );
      previous = count;
    }
  });

  /**
   * A new farm must have something to be asked for on day one. A board that is
   * empty until level 3 is a board the player meets as a dead panel and never
   * opens again.
   */
  it('has at least one quest a brand-new farm can take', () => {
    expect(questsForLevel(1).length).toBeGreaterThan(0);
  });
});

describe('questById', () => {
  it('finds every quest it lists', () => {
    for (const id of QUEST_IDS) expect(questById(id)?.id).toBe(id);
  });

  it('refuses an id it does not know, rather than guessing', () => {
    expect(questById('chef_the_moon')).toBeUndefined();
  });
});

/**
 * T-33.06. The rotating half of the board.
 *
 * Three promises, and each is written as a property rather than a spot check:
 * the board only asks for what the player can grow, refreshing cannot re-roll
 * it, and nothing a player does changes what they are offered.
 */
describe('the rotating board', () => {
  const PLAYER = 'e6c0a0d4-0000-4000-8000-000000000001';
  const OTHER = 'e6c0a0d4-0000-4000-8000-000000000002';
  /*
   * Aligned to the START of a rotation, not an arbitrary instant. The first
   * version of these tests used a raw timestamp and asserted the board was
   * unchanged at `NOW + QUEST_ROTATION_MS - 1` — which crosses the boundary
   * whenever `NOW` is mid-rotation, as almost every timestamp is. The test was
   * wrong and the code was right, which is worth a line of comment: "within a
   * rotation" is a claim about the rotation's own span.
   */
  const NOW = rotationIndexAt(1_788_000_000_000) * QUEST_ROTATION_MS;

  it('offers a full board to a brand-new farm', () => {
    expect(dailyRequestsFor(PLAYER, 1, NOW)).toHaveLength(DAILY_REQUEST_SLOTS);
  });

  /**
   * **The phase's title, as a property.** Not "the three it happens to pick are
   * fine" — every crop it could pick, at every level, is one the farm can grow.
   */
  it.each([1, 2, 3, 4, 5, 7, 9, 40])('at level %i asks only for what that farm grows', (level) => {
    for (const request of dailyRequestsFor(PLAYER, level, NOW)) {
      for (const need of request.requires) {
        expect(
          obtainableAtLevel(need.itemId, level),
          `a level-${level} board asked for ${need.itemId}`,
        ).toBe(true);
      }
    }
  });

  /**
   * **Refreshing must not re-roll.** The board is a pure function of the player
   * and the rotation, so "call it again" is the same call.
   */
  it('gives the same board every time it is asked, within a rotation', () => {
    const first = dailyRequestsFor(PLAYER, 5, NOW);
    const later = dailyRequestsFor(PLAYER, 5, NOW + QUEST_ROTATION_MS - 1);

    expect(later).toEqual(first);
  });

  it('turns over at the rotation boundary', () => {
    const before = dailyRequestsFor(PLAYER, 5, NOW);
    const after = dailyRequestsFor(PLAYER, 5, rotationEndsAt(NOW));

    expect(after.map((q) => q.id)).not.toEqual(before.map((q) => q.id));
  });

  it('gives two players different boards in the same rotation', () => {
    const mine = dailyRequestsFor(PLAYER, 5, NOW).map((q) => q.requires[0]!);
    const theirs = dailyRequestsFor(OTHER, 5, NOW).map((q) => q.requires[0]!);

    // Not a guarantee for any single pair, but across three slots two players
    // drawing an identical board would mean the seed is not using the id.
    expect(mine).not.toEqual(theirs);
  });

  /**
   * **The rotation cannot be farmed for a better offer.** Stated as: the only
   * inputs are the player id and the clock, so there is nothing a player can do
   * to change what they see. The farm LEVEL is an input too — but it only ever
   * adds crops, and levelling is not a re-roll a player can repeat.
   */
  it('cannot be re-rolled by anything the player can do', () => {
    const board = dailyRequestsFor(PLAYER, 5, NOW);

    // Time passing within the rotation: same board.
    for (const t of [0, 1, 1000, QUEST_ROTATION_MS / 2, QUEST_ROTATION_MS - 1]) {
      expect(dailyRequestsFor(PLAYER, 5, NOW + t)).toEqual(board);
    }
  });

  it('never asks for a trap — every derived request beats selling the goods', () => {
    for (const level of [1, 2, 3, 5, 9, 40]) {
      for (let r = 0; r < 40; r++) {
        const at = NOW + r * QUEST_ROTATION_MS;
        for (const request of dailyRequestsFor(PLAYER, level, at)) {
          const asked = requirementSellValue(request);
          const paid = rewardGoldValue(request.reward);
          expect(paid, `${request.id} asks ${asked}g and pays ${paid}g`).toBeGreaterThan(asked);
        }
      }
    }
  });

  it('asks for whole, sane quantities however the seed falls', () => {
    for (let r = 0; r < 200; r++) {
      for (const request of dailyRequestsFor(PLAYER, 40, NOW + r * QUEST_ROTATION_MS)) {
        for (const need of request.requires) {
          expect(Number.isInteger(need.quantity)).toBe(true);
          expect(need.quantity).toBeGreaterThanOrEqual(1);
          expect(need.quantity).toBeLessThanOrEqual(12);
        }
      }
    }
  });

  it('does not ask for the same crop twice on one board', () => {
    for (let r = 0; r < 100; r++) {
      const board = dailyRequestsFor(PLAYER, 40, NOW + r * QUEST_ROTATION_MS);
      const items = board.map((q) => q.requires[0]!.itemId);
      expect(new Set(items).size, `rotation ${r} repeated a crop`).toBe(items.length);
    }
  });

  it('gives every request a giver who can speak', () => {
    const givers = NPC_DIALOGUE.map((n) => n.id);
    for (const request of dailyRequestsFor(PLAYER, 40, NOW)) {
      expect(givers).toContain(request.giver);
    }
  });
});

describe('daily request ids', () => {
  it('round-trip', () => {
    expect(parseDailyRequestId(dailyRequestId(1234, 2))).toEqual({ rotation: 1234, slot: 2 });
  });

  it('does not mistake an authored quest for a rotating one', () => {
    for (const id of QUEST_IDS) expect(parseDailyRequestId(id)).toBeNull();
  });

  /**
   * **A stale offer refuses itself.** The rotation is in the id, so an id the
   * player kept from an earlier board simply does not appear in the current one
   * — no stored history of what used to be offered.
   */
  it('resolves only within its own rotation', () => {
    const PLAYER = 'e6c0a0d4-0000-4000-8000-000000000001';
    const NOW = 1_788_000_000_000;
    const [first] = dailyRequestsFor(PLAYER, 5, NOW);

    expect(resolveQuest(first!.id, PLAYER, 5, NOW)?.id).toBe(first!.id);
    expect(resolveQuest(first!.id, PLAYER, 5, rotationEndsAt(NOW))).toBeUndefined();
  });

  it('still resolves an authored quest at any time', () => {
    expect(resolveQuest('chef_first_basket', 'anyone', 1, 0)?.id).toBe('chef_first_basket');
  });
});

/**
 * T-34.07's dependency check, turned into a guard (found while checking whether
 * that task was blocked).
 *
 * `obtainableAtLevel` returned `true` for anything it did not recognise as a
 * crop. That is correct for wood, eggs, milk and feed — gated by GOLD, not by
 * level — and it was quietly wrong for the eighteen fish T-34.04 added. A Chef
 * quest asking for a Golden Fish would have passed the headline invariant above
 * and shipped as a request nobody could fill, because there is no rod.
 */
describe('fish obtainability', () => {
  it('respects a fish\'s own level gate, not just a crop\'s', () => {
    const golden = FISH.find((f) => f.id === 'golden_fish')!;
    expect(golden.unlockLevel).toBeGreaterThan(1);

    // Below its level it must be unobtainable whatever else is true.
    expect(obtainableAtLevel('golden_fish', golden.unlockLevel - 1)).toBe(false);
  });

  /**
   * **No fish is obtainable until a rod exists**, whatever the farm level.
   * `FISHING_IS_REACHABLE` is derived from the rod item, so T-34.06 flips this
   * by shipping `rod_wood` and nobody has to remember to come back here.
   */
  it('treats every fish as unobtainable while there is no rod', () => {
    if (FISHING_IS_REACHABLE) {
      // The rod shipped. Then the gate is the fish's own level, and a
      // max-level farm can catch the rarest thing in the river.
      expect(obtainableAtLevel('golden_fish', 99)).toBe(true);
      return;
    }

    for (const fish of FISH) {
      expect(
        obtainableAtLevel(fish.id, 99),
        `${fish.id} is reported obtainable, but no rod exists to catch it with`,
      ).toBe(false);
    }
  });

  it('still treats gold-gated goods as obtainable at any level', () => {
    // The default branch, which is right for these and was wrong for fish.
    for (const id of ['wood', 'egg', 'milk']) {
      expect(obtainableAtLevel(id, 1), `${id} became level-gated`).toBe(true);
    }
  });

  /**
   * The consequence, stated where a future author will meet it: no quest may
   * ask for a fish until fishing is reachable. This is the same assertion the
   * headline invariant makes, narrowed to the case that would have slipped.
   */
  it('lets no quest ask for a fish that cannot be caught', () => {
    const fishIds = new Set(FISH.map((f) => f.id));
    for (const quest of QUESTS) {
      for (const need of quest.requires) {
        if (!fishIds.has(need.itemId)) continue;
        expect(
          obtainableAtLevel(need.itemId, quest.unlockLevel),
          `${quest.id} asks for ${need.itemId}, which cannot be obtained yet`,
        ).toBe(true);
      }
    }
  });
});
