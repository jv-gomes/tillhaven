import { describe, expect, it } from 'vitest';
import { TradeStatus } from '@tillhaven/shared';

/**
 * T-18.21 (BUG-17) — the trade wire contract, pinned.
 *
 * `tradePanel.ts` is 21KB with zero importers, `net/trade.ts` and
 * `net/realtime.ts` likewise. The audit's concern was not the dead weight but
 * the consequence: *"it typechecks and will never run, so any drift from the
 * server contract is invisible."*
 *
 * **It had already drifted, and badly.** `TradeStatus` was declared FOUR times
 * — in `packages/shared/src/types` (which nothing imported), in the server's
 * `lifecycle.ts`, in the database column, and in `net/trade.ts`. The first
 * three agree on `'pending' | 'open' | …`; the client's said
 * `'PENDING' | 'ACTIVE' | …`, and `tradePanel.ts` branched on `'ACTIVE'` and
 * `'PENDING'`. **Every status branch in the panel was unreachable.** Wire it up
 * as it stood and it would have shown "waiting for a reply" forever.
 *
 * One declaration now, in shared, imported by both sides — so the next
 * divergence is a compile error. This test is the belt: it pins the VALUES,
 * which a rename would not catch.
 */
describe('TradeStatus', () => {
  /**
   * The strings themselves, not just the shape. These are what the `trades`
   * table stores and what six server integration test files assert against, so
   * changing one is a migration and not a refactor.
   */
  it('is the lower-case set the database and the server already use', () => {
    expect({ ...TradeStatus }).toEqual({
      PENDING: 'pending',
      OPEN: 'open',
      COMPLETED: 'completed',
      CANCELLED: 'cancelled',
      EXPIRED: 'expired',
    });
  });

  /**
   * The specific mistake, named so it cannot come back quietly. The client's
   * copy used `ACTIVE` for what the server calls `open` — a synonym, which is
   * why it read as correct in review and failed at runtime.
   */
  it('calls the live state "open", never "active"', () => {
    const values = Object.values(TradeStatus) as string[];
    expect(values).toContain('open');
    expect(values).not.toContain('active');
    expect(values).not.toContain('ACTIVE');
  });

  it('is entirely lower-case, which is the half that drifted', () => {
    for (const value of Object.values(TradeStatus)) {
      expect(value, `${value} is not lower-case`).toBe(value.toLowerCase());
    }
  });

  /**
   * A trade is in exactly one state and the panel switches on it, so a
   * duplicate value would make one branch unreachable — the same class of bug
   * this task exists to fix.
   */
  it('has no duplicate values', () => {
    const values = Object.values(TradeStatus);
    expect(new Set(values).size).toBe(values.length);
  });
});
