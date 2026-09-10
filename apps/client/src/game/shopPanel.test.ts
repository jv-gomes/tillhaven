import { describe, expect, it } from 'vitest';
import { decorRowState, purchaseBlocker, seedRowState, upgradeLabel } from './shopPanel.js';
import { ANIMALS, BACKPACK_TIERS, buildingCap } from '@tillhaven/shared/config';

/**
 * T-18.14 (BUG-13) and T-18.15 (BUG-14) — the shop says what it means.
 *
 * A disabled button with no explanation is worse than an enabled one that
 * fails: a failure tells you something. With 100g, Shop → Animals showed two
 * dead BUY buttons with no title, no inline reason and nothing separating "you
 * cannot afford this" from "your coop is full" — two problems whose answers
 * have nothing in common.
 */

describe('purchaseBlocker', () => {
  it('says nothing when the purchase can go ahead', () => {
    expect(purchaseBlocker({ gold: 500, price: 400 })).toBeNull();
    expect(purchaseBlocker({ gold: 400, price: 400 }), 'exact change is enough').toBeNull();
  });

  /**
   * The shortfall, not the price. The player can already see the price — what
   * they cannot see is how far off they are, which is the number that tells
   * them whether to go and sell something or forget it for today.
   */
  it('names how much more gold is needed', () => {
    expect(purchaseBlocker({ gold: 100, price: 400 })).toBe('need 300g more');
    expect(purchaseBlocker({ gold: 0, price: 12_000 })).toBe('need 12,000g more');
  });

  it('names a full building, with the count', () => {
    const reason = purchaseBlocker({
      gold: 99_999,
      price: 400,
      capacity: { used: 4, max: 4, noun: 'coop' },
    });

    expect(reason).toBe('coop full — 4/4');
  });

  /**
   * **Capacity is named first, and that is the whole ordering decision.** A
   * full coop is not fixed by earning more gold, so telling someone the price
   * when the price is not the problem sends them off to do the wrong thing for
   * an hour.
   */
  it('blames the coop, not the wallet, when both are true', () => {
    const reason = purchaseBlocker({
      gold: 0,
      price: 400,
      capacity: { used: 4, max: 4, noun: 'coop' },
    });

    expect(reason).toBe('coop full — 4/4');
  });

  it('ignores capacity while there is room in it', () => {
    expect(
      purchaseBlocker({ gold: 500, price: 400, capacity: { used: 3, max: 4, noun: 'coop' } }),
    ).toBeNull();
  });

  /**
   * A cap that has somehow been exceeded is still "full" rather than silently
   * passing. `>=`, not `===`: a VIP whose bonus lapses can hold more animals
   * than the cap allows, and the row must not offer another one.
   */
  it('treats an over-full building as full', () => {
    expect(
      purchaseBlocker({ gold: 500, price: 400, capacity: { used: 6, max: 4, noun: 'barn' } }),
    ).toBe('barn full — 6/4');
  });
});

describe('upgradeLabel', () => {
  /**
   * BUG-14, in one line. "holds 4 chickens now · 4,000g" puts the CURRENT
   * capacity beside the price of the NEXT one, and a reader joins those into
   * "4,000g buys a 4-chicken coop" — wrong, and wrong in the direction that
   * costs them money. Both numbers were true; the sentence was not.
   */
  it('states what the money buys, not what you already have', () => {
    expect(upgradeLabel(4, 8, 'chickens')).toBe('4 → 8 chickens');
    expect(upgradeLabel(12, 24, 'slots')).toBe('12 → 24 slots');
  });

  /**
   * Against the real tables, so the label cannot promise a jump the config
   * does not deliver. These are the numbers the audit quoted.
   */
  it('matches the coop the server would actually sell', () => {
    const at = (tier: number) => buildingCap(ANIMALS.chicken.building, tier, 0);
    expect(upgradeLabel(at(0), at(1), 'chickens')).toBe(`${at(0)} → ${at(1)} chickens`);
    expect(at(1)).toBeGreaterThan(at(0));
  });

  it('matches the backpack the server would actually sell', () => {
    const [first, second] = BACKPACK_TIERS;
    expect(upgradeLabel(first!.slots, second!.slots, 'slots')).toBe(
      `${first!.slots} → ${second!.slots} slots`,
    );
  });
});

/**
 * T-25.02 — the decoration row asks about `vipOnly`.
 *
 * `DecorCatalogueEntry.vipOnly` came down with the catalogue from the first
 * version of the endpoint and had **no reader**: the shop offered a working Buy
 * button on a piece the server was always going to refuse with `FORBIDDEN`.
 * The failure is a paying feature that looks free until you press it.
 */
describe('decorRowState', () => {
  const AFFORDABLE = { gold: 1_000, price: 40 };

  it('offers an ordinary piece to anyone who can afford it', () => {
    expect(decorRowState({ ...AFFORDABLE, vipOnly: false, isVip: false })).toEqual({
      label: 'Buy',
      buyable: true,
      reason: null,
    });
  });

  it('still names the shortfall on an ordinary piece', () => {
    const state = decorRowState({ gold: 10, price: 40, vipOnly: false, isVip: false });
    expect(state.buyable).toBe(false);
    expect(state.reason).toBe('need 30g more');
  });

  /** The one that matters: no Buy button the server would refuse. */
  it('refuses a VIP piece to a free account, and says why', () => {
    const state = decorRowState({ ...AFFORDABLE, vipOnly: true, isVip: false });
    expect(state.buyable).toBe(false);
    expect(state.label).toBe('VIP');
    expect(state.reason).toBe('VIP farms only');
  });

  it('sells the same piece to a VIP', () => {
    const state = decorRowState({ ...AFFORDABLE, vipOnly: true, isVip: true });
    expect(state.buyable).toBe(true);
    expect(state.label).toBe('Buy');
  });

  /**
   * **VIP is named before the wallet, and that is the whole ordering
   * decision** — the same rule `purchaseBlocker` follows for a full coop. No
   * amount of gold unlocks a VIP piece, so reporting a shortfall would send the
   * player off to earn money that changes nothing.
   */
  it('blames VIP, not the wallet, when both are true', () => {
    const state = decorRowState({ gold: 0, price: 40, vipOnly: true, isVip: false });
    expect(state.reason).toBe('VIP farms only');
  });

  /** A VIP who cannot afford it is an ordinary shortfall again. */
  it('falls back to the price once VIP is out of the way', () => {
    const state = decorRowState({ gold: 10, price: 40, vipOnly: true, isVip: true });
    expect(state.reason).toBe('need 30g more');
  });
});

/**
 * Why a SEED row's Buy button is dead (T-31.06).
 *
 * The ORDER is the whole point, and it is the same argument `purchaseBlocker`
 * makes for putting a full coop ahead of an empty wallet: naming a price
 * shortfall on a locked seed sends the player off to earn gold that will
 * change nothing.
 */
describe('seedRowState', () => {
  const base = { gold: 1_000, price: 100, unlockLevel: null, farmLevel: 1 } as const;

  it('sells anything that is not a seed, whatever the level', () => {
    expect(seedRowState({ ...base, unlockLevel: null, farmLevel: 1 })).toEqual({
      buyable: true,
      reason: null,
    });
  });

  it('sells a seed the farm has reached the level for', () => {
    expect(seedRowState({ ...base, unlockLevel: 7, farmLevel: 7 })).toEqual({
      buyable: true,
      reason: null,
    });
  });

  it('names the LEVEL, not the price, when the farm is too young', () => {
    const state = seedRowState({ ...base, unlockLevel: 7, farmLevel: 3 });

    expect(state.buyable).toBe(false);
    expect(state.reason).toBe('farm level 7');
  });

  /**
   * The ordering test. A player who is both too poor AND too low-level must be
   * told about the level: gold is the fixable-looking problem and the wrong
   * one to name.
   */
  it('names the level even when the player also cannot afford it', () => {
    const state = seedRowState({ gold: 0, price: 500, unlockLevel: 9, farmLevel: 2 });

    expect(state.reason).toBe('farm level 9');
    expect(state.reason).not.toContain('g more');
  });

  it('falls back to affordability once the level is met', () => {
    const state = seedRowState({ gold: 10, price: 500, unlockLevel: 2, farmLevel: 2 });

    expect(state.buyable).toBe(false);
    expect(state.reason).toBe('need 490g more');
  });

  /**
   * A level ABOVE the requirement must not re-lock the row. Trivial, and
   * exactly the off-by-one a `!==` instead of a `<` would introduce.
   */
  it('does not re-lock a seed for a player past the requirement', () => {
    expect(seedRowState({ ...base, unlockLevel: 3, farmLevel: 30 }).buyable).toBe(true);
  });
});
