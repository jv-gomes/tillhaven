import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ErrorCode,
  FARM_LEVEL_XP,
  TRADE_MIN_ACCOUNT_AGE_MS,
  TRADE_MIN_FARM_LEVEL,
  levelForXp,
} from '@tillhaven/shared';
import {
  TradeBlock,
  assertBothCanTrade,
  assertCanTrade,
  canTrade,
  tradeEligibility,
  type TradeCandidate,
} from './eligibility.js';

/**
 * The rule that makes throwaway-account scamming expensive (§6, §14).
 *
 * Both boundaries are tested **exactly** — at the millisecond and at the
 * experience point — because "roughly a day" and "about level five" are how a
 * gate becomes either an obstacle to real players or a formality to a scammer.
 */

const NOW = 1_800_000_000_000;

/** Experience that lands exactly on the trade-eligible level. */
const ELIGIBLE_XP = FARM_LEVEL_XP[TRADE_MIN_FARM_LEVEL - 1]!;

function player(overrides: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    id: 'player-1',
    username: 'farmer',
    createdAt: NOW - TRADE_MIN_ACCOUNT_AGE_MS,
    experience: ELIGIBLE_XP,
    flaggedAt: null,
    ...overrides,
  };
}

describe('tradeEligibility', () => {
  it('lets through an account that is old enough and high enough', () => {
    const result = tradeEligibility(player(), NOW);

    expect(result.eligible).toBe(true);
    expect(result.blockedBy).toBeNull();
    expect(result.accountAgeRemainingMs).toBe(0);
    expect(result.farmLevel).toBe(TRADE_MIN_FARM_LEVEL);
  });

  /* ---- the account-age boundary, to the millisecond ---- */

  it('blocks an account one millisecond too young, and allows it one later', () => {
    const tooNew = player({ createdAt: NOW - TRADE_MIN_ACCOUNT_AGE_MS + 1 });
    const justOld = player({ createdAt: NOW - TRADE_MIN_ACCOUNT_AGE_MS });

    expect(tradeEligibility(tooNew, NOW).eligible).toBe(false);
    expect(tradeEligibility(tooNew, NOW).blockedBy).toBe(TradeBlock.ACCOUNT_TOO_NEW);
    expect(tradeEligibility(justOld, NOW).eligible).toBe(true);
  });

  it('counts down the wait, and reaches zero exactly on time', () => {
    const created = NOW;
    const fresh = player({ createdAt: created });

    expect(tradeEligibility(fresh, created).accountAgeRemainingMs).toBe(
      TRADE_MIN_ACCOUNT_AGE_MS,
    );
    expect(
      tradeEligibility(fresh, created + TRADE_MIN_ACCOUNT_AGE_MS - 1).accountAgeRemainingMs,
    ).toBe(1);
    expect(
      tradeEligibility(fresh, created + TRADE_MIN_ACCOUNT_AGE_MS).accountAgeRemainingMs,
    ).toBe(0);
  });

  it('never reports a negative wait for an old account', () => {
    const ancient = player({ createdAt: NOW - TRADE_MIN_ACCOUNT_AGE_MS * 500 });
    expect(tradeEligibility(ancient, NOW).accountAgeRemainingMs).toBe(0);
  });

  /* ---- the farm-level boundary, to the experience point ---- */

  it('blocks one experience point below the required level, and allows it at it', () => {
    const justUnder = player({ experience: ELIGIBLE_XP - 1 });
    const exactly = player({ experience: ELIGIBLE_XP });

    expect(levelForXp(ELIGIBLE_XP - 1)).toBe(TRADE_MIN_FARM_LEVEL - 1);
    expect(tradeEligibility(justUnder, NOW).eligible).toBe(false);
    expect(tradeEligibility(justUnder, NOW).blockedBy).toBe(TradeBlock.FARM_TOO_LOW);

    expect(tradeEligibility(exactly, NOW).eligible).toBe(true);
  });

  it('allows any level above the requirement', () => {
    const high = player({ experience: FARM_LEVEL_XP[FARM_LEVEL_XP.length - 1]! });
    expect(tradeEligibility(high, NOW).eligible).toBe(true);
  });

  it('blocks a brand-new farm on both counts at once', () => {
    const brandNew = player({ createdAt: NOW, experience: 0 });
    const result = tradeEligibility(brandNew, NOW);

    expect(result.eligible).toBe(false);
    expect(result.farmLevel).toBe(1);
  });

  /* ---- flagged ---- */

  /**
   * A refund or chargeback outranks everything. It is also checked FIRST, so a
   * flagged account is told it is flagged rather than sent off to farm for a
   * level it will never be allowed to use.
   */
  it('blocks a flagged account however old and high-level it is', () => {
    const flagged = player({
      flaggedAt: NOW - 1,
      createdAt: NOW - TRADE_MIN_ACCOUNT_AGE_MS * 100,
      experience: FARM_LEVEL_XP[FARM_LEVEL_XP.length - 1]!,
    });

    const result = tradeEligibility(flagged, NOW);
    expect(result.eligible).toBe(false);
    expect(result.blockedBy).toBe(TradeBlock.FLAGGED);
  });

  it('reports flagged ahead of the other reasons', () => {
    const flaggedAndNew = player({ flaggedAt: NOW, createdAt: NOW, experience: 0 });
    expect(tradeEligibility(flaggedAndNew, NOW).blockedBy).toBe(TradeBlock.FLAGGED);
  });
});

describe('canTrade', () => {
  it('agrees with the full result', () => {
    for (const candidate of [
      player(),
      player({ createdAt: NOW }),
      player({ experience: 0 }),
      player({ flaggedAt: NOW }),
    ]) {
      expect(canTrade(candidate, NOW)).toBe(tradeEligibility(candidate, NOW).eligible);
    }
  });
});

describe('assertCanTrade', () => {
  it('passes an eligible player silently', () => {
    expect(() => assertCanTrade(player(), NOW)).not.toThrow();
  });

  it('throws TRADE_NOT_ELIGIBLE with a reason the player can act on', () => {
    try {
      assertCanTrade(player({ experience: 0 }), NOW);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toMatchObject({
        code: ErrorCode.TRADE_NOT_ELIGIBLE,
        details: { blockedBy: TradeBlock.FARM_TOO_LOW },
      });
      expect(String((err as Error).message)).toContain(String(TRADE_MIN_FARM_LEVEL));
    }
  });

  it('tells a young account how long it has left', () => {
    try {
      assertCanTrade(player({ createdAt: NOW - 1000 }), NOW);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { details: Record<string, number> }).details.accountAgeRemainingMs).toBe(
        TRADE_MIN_ACCOUNT_AGE_MS - 1000,
      );
    }
  });
});

describe('assertBothCanTrade', () => {
  it('passes when both may trade', () => {
    expect(() => assertBothCanTrade(player(), player({ id: 'b' }), NOW)).not.toThrow();
  });

  /**
   * Checking only the caller would let an eligible player pull an ineligible
   * one into a trade — the same scam, run from the other end.
   */
  it('refuses when only the partner is ineligible', () => {
    const partner = player({ id: 'b', experience: 0 });

    expect(() => assertBothCanTrade(player(), partner, NOW)).toThrow();
    try {
      assertBothCanTrade(player(), partner, NOW);
    } catch (err) {
      expect(err).toMatchObject({ code: ErrorCode.TRADE_NOT_ELIGIBLE });
    }
  });

  it('refuses when only the caller is ineligible', () => {
    expect(() =>
      assertBothCanTrade(player({ flaggedAt: NOW }), player({ id: 'b' }), NOW),
    ).toThrow();
  });

  /**
   * A partner's account age and farm level are not the caller's business.
   * Leaking them would turn a trade invite into a way to probe strangers'
   * accounts, so the partner's refusal says nothing but "not yet".
   */
  it('does not leak why the partner is ineligible', () => {
    const partner = player({ id: 'b', experience: 0, createdAt: NOW, flaggedAt: NOW });

    try {
      assertBothCanTrade(player(), partner, NOW);
      expect.unreachable('should have thrown');
    } catch (err) {
      const details = (err as { details: Record<string, unknown> }).details;
      expect(details).toEqual({ blockedBy: 'partner' });
      expect((err as Error).message).not.toMatch(/level|flag|day/i);
    }
  });

  /** Same rule both ways round: neither side is privileged. */
  it('is symmetric about which party is ineligible', () => {
    const good = player();
    const bad = player({ id: 'b', experience: 0 });

    expect(() => assertBothCanTrade(good, bad, NOW)).toThrow();
    expect(() => assertBothCanTrade(bad, good, NOW)).toThrow();
  });

  it('refuses a player trying to trade with themselves-as-partner too', () => {
    const ineligible = player({ experience: 0 });
    expect(() => assertBothCanTrade(ineligible, ineligible, NOW)).toThrow();
  });
});

/**
 * The gate is only worth having if clearing it costs real time. This is the
 * property the whole rule rests on, so it is asserted rather than assumed.
 */
describe('the cost of eligibility', () => {
  it('cannot be cleared on the day an account is made', () => {
    const rich = player({ createdAt: NOW, experience: 10_000_000 });
    expect(tradeEligibility(rich, NOW).eligible).toBe(false);
  });

  it('cannot be cleared by waiting alone', () => {
    const idle = player({ createdAt: NOW - TRADE_MIN_ACCOUNT_AGE_MS * 30, experience: 0 });
    expect(tradeEligibility(idle, NOW).eligible).toBe(false);
  });

  it('needs both, which is the point', () => {
    const both = player({ createdAt: NOW - TRADE_MIN_ACCOUNT_AGE_MS, experience: ELIGIBLE_XP });
    expect(tradeEligibility(both, NOW).eligible).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Checked at BOTH call sites
 * ------------------------------------------------------------------ */

/**
 * §6 requires eligibility to be checked at invite **and again** at execution,
 * for both parties. The gap between the two is exactly where an account gets
 * flagged for a chargeback, and a trade authorised an hour ago is not
 * authorised now.
 *
 * Those two code paths are T-4.02 and T-4.05 and do not exist yet, so this is a
 * **forward guard**: it passes vacuously today and starts biting the moment a
 * trade lifecycle appears without the check. That is worth more than a note in
 * a file nobody rereads — the rule is easiest to forget precisely when the
 * interesting work is the state machine around it.
 */
describe('every trade entry point checks eligibility', () => {
  it('has no invite, accept or execution path that skips the check', async () => {
    const tradeDir = dirname(fileURLToPath(import.meta.url));
    const offenders: string[] = [];

    for (const entry of await readdir(tradeDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.test.ts') || entry.name === 'eligibility.ts') continue;

      const source = await readFile(join(tradeDir, entry.name), 'utf8');

      // Functions that open or complete a trade — the two moments §6 names.
      const gatekeepers = /export\s+async\s+function\s+(invite|accept|execute|openTrade|executeTrade)/;
      if (!gatekeepers.test(source)) continue;

      /*
       * Matches a CALL, not the import line. An earlier version tested for the
       * bare names and passed happily on a file that imported them and never
       * called them — which is exactly the omission this guard exists to catch.
       */
      if (!/assert(Can|BothCan)Trade\s*\(/.test(source)) {
        offenders.push(entry.name);
      }
    }

    expect(
      offenders,
      'these files open or complete a trade without checking eligibility — §6 ' +
        'requires it at invite AND at execution, for both parties',
    ).toEqual([]);
  });
});
