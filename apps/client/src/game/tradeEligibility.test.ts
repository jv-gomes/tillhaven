import { describe, expect, it } from 'vitest';
import { HOUR, TRADE_MIN_FARM_LEVEL } from '@tillhaven/shared/config';
import type { TradeEligibility } from '@tillhaven/shared/types';
import { blockedReason } from './tradePanel.js';

/**
 * T-22.03 — the trade post explains itself.
 *
 * **The gap this closes.** `SelfPlayer.canTrade` had been computed and sent on
 * every poll since Phase 4, and **nothing on the client read it** — zero
 * references in `apps/client/src`. So a new player walked to the mailbox, was
 * shown the invite form like anyone else, typed a friend's farm name, pressed
 * Invite, and got an error toast. On the one feature in the game with a
 * deliberate waiting period, that reads as a broken button rather than a rule.
 *
 * The gate itself is not in question (§14, and the reasoning in
 * `eligibility.ts`: it makes throwaway-account scamming expensive). Only the
 * silence was.
 */

const base: TradeEligibility = {
  eligible: true,
  blockedBy: null,
  accountAgeRemainingMs: 0,
  farmLevel: 9,
  requiredFarmLevel: TRADE_MIN_FARM_LEVEL,
};

describe('blockedReason', () => {
  it('says nothing to a player who can trade', () => {
    expect(blockedReason(base)).toBeNull();
  });

  /**
   * Before the first poll there is no answer yet. Guessing "you cannot trade"
   * would flash a refusal at the overwhelming majority who can.
   */
  it('says nothing before the server has answered', () => {
    expect(blockedReason(null)).toBeNull();
  });

  it('names the waiting period, and how much is left', () => {
    const message = blockedReason({
      ...base,
      eligible: false,
      blockedBy: 'account_too_new',
      accountAgeRemainingMs: 5 * HOUR,
    });

    expect(message).toMatch(/first day/i);
    expect(message).toContain('5 hours');
  });

  /**
   * **Rounded up, and this is the case that matters.** A partial hour reported
   * with `floor` shows "0 hours to go" on a gate that has not opened — a lie
   * the player will hold you to a minute later.
   */
  it('never claims zero hours remain while the gate is shut', () => {
    const message = blockedReason({
      ...base,
      eligible: false,
      blockedBy: 'account_too_new',
      accountAgeRemainingMs: 60_000,
    });

    expect(message).toContain('1 hour');
    expect(message).not.toContain('0 hour');
  });

  it('gets the singular right', () => {
    const message = blockedReason({
      ...base,
      eligible: false,
      blockedBy: 'account_too_new',
      accountAgeRemainingMs: HOUR,
    });

    expect(message).toContain('1 hour ');
    expect(message).not.toContain('1 hours');
  });

  /**
   * The level gate has to say BOTH numbers. "Reach level 5" alone leaves the
   * player unable to tell whether they are one level away or four.
   */
  it('names the level required and the level reached', () => {
    const message = blockedReason({
      ...base,
      eligible: false,
      blockedBy: 'farm_too_low',
      farmLevel: 2,
    });

    expect(message).toContain(`level ${TRADE_MIN_FARM_LEVEL}`);
    expect(message).toContain('level 2');
  });

  /**
   * A flagged account is told it cannot trade and nothing more — the details of
   * a chargeback investigation are not the player's to read off a panel.
   */
  it('stays vague about a flagged account', () => {
    const message = blockedReason({ ...base, eligible: false, blockedBy: 'flagged' });

    expect(message).toBe('Trading is unavailable on this account.');
    expect(message).not.toMatch(/refund|chargeback|dispute/i);
  });

  /** A reason this build does not know about must still say something. */
  it('falls back rather than rendering nothing', () => {
    const message = blockedReason({
      ...base,
      eligible: false,
      blockedBy: 'something_new' as TradeEligibility['blockedBy'],
    });

    expect(message).toBe('You cannot trade yet.');
  });
});
