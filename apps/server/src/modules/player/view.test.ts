import { describe, expect, it } from 'vitest';
import { FARM_LEVEL_XP, MAX_FARM_LEVEL, TRADE_MIN_FARM_LEVEL } from '@tillhaven/shared';
import { toPublicPlayer, toSelfPlayer } from './view.js';
import type { AuthedPlayer } from '../../middleware/auth.js';

/**
 * The view boundary (T-30.01).
 *
 * `levelProgress` itself is covered in `modules/farm/level.test.ts`; what is
 * tested here is the WIRING — that the derivation actually reaches the client,
 * and that it cannot contradict the `farmLevel` sitting beside it.
 */

const NOW = 1_700_000_000_000;

function player(overrides: Partial<AuthedPlayer> = {}): AuthedPlayer {
  return {
    id: 'p1',
    username: 'tester',
    email: 'tester@example.com',
    gold: 500,
    backpackTier: 0,
    experience: 0,
    energySpent: 0,
    sleepingSince: null,
    vipUntil: null,
    flaggedAt: null,
    // Old enough that account age never blocks trading; level is the variable
    // under test.
    createdAt: NOW - 30 * 24 * 60 * 60 * 1000,
    appearance: null,
    ...overrides,
  };
}

describe('toSelfPlayer level progress', () => {
  it('ships the progress the server was already computing', () => {
    const atLevel2 = FARM_LEVEL_XP[1]!;
    const self = toSelfPlayer(player({ experience: atLevel2 + 10 }), NOW);

    expect(self.progress.level).toBe(2);
    expect(self.progress.experience).toBe(atLevel2 + 10);
    expect(self.progress.levelStartXp).toBe(atLevel2);
    expect(self.progress.nextLevelXp).toBe(FARM_LEVEL_XP[2]);
    expect(self.progress.toNextLevel).toBeGreaterThan(0);
  });

  it('starts a brand-new farm at level 1 with somewhere to go', () => {
    const self = toSelfPlayer(player({ experience: 0 }), NOW);

    expect(self.progress.level).toBe(1);
    expect(self.progress.experience).toBe(0);
    expect(self.progress.levelStartXp).toBe(0);
    // A bar that has no target on a new account is a bar that renders as either
    // empty or full forever, which is the whole failure this task exists to fix.
    expect(self.progress.nextLevelXp).toBe(FARM_LEVEL_XP[1]);
    expect(self.progress.toNextLevel).toBe(FARM_LEVEL_XP[1]);
  });

  it('has no next level at the cap', () => {
    const capped = FARM_LEVEL_XP[MAX_FARM_LEVEL - 1]!;
    const self = toSelfPlayer(player({ experience: capped }), NOW);

    expect(self.progress.level).toBe(MAX_FARM_LEVEL);
    expect(self.progress.nextLevelXp).toBeNull();
    expect(self.progress.toNextLevel).toBe(0);
  });

  /**
   * `farmLevel` is inherited from `PublicPlayer` and `progress.level` is derived
   * separately. Both go through `levelForXp`, so they cannot disagree — but
   * "cannot" is worth a test, because the day someone stores a level instead of
   * deriving one, this is what catches it.
   */
  it('never contradicts the farmLevel beside it', () => {
    for (const xp of [0, 1, 79, 80, 500, 5_000, 500_000]) {
      const self = toSelfPlayer(player({ experience: xp }), NOW);
      expect(self.progress.level, `xp=${xp}`).toBe(self.farmLevel);
    }
  });

  /**
   * The trade gate is the one thing level has ever controlled (§6). Showing the
   * player their progress toward it must not change who is allowed through it.
   */
  it('does not disturb the trade gate it makes visible', () => {
    const belowGate = toSelfPlayer(player({ experience: 0 }), NOW);
    expect(belowGate.progress.level).toBeLessThan(TRADE_MIN_FARM_LEVEL);
    expect(belowGate.trade.eligible).toBe(false);

    const atGate = toSelfPlayer(
      player({ experience: FARM_LEVEL_XP[TRADE_MIN_FARM_LEVEL - 1]! }),
      NOW,
    );
    expect(atGate.progress.level).toBe(TRADE_MIN_FARM_LEVEL);
    expect(atGate.trade.eligible).toBe(true);
  });
});

describe('toPublicPlayer', () => {
  /**
   * §4.1: the view boundary is the reason a new column is invisible by default.
   * Progress is a self-only shape — another player's distance to the trade gate
   * is exactly the kind of thing a scammer would shop for.
   */
  it('does not leak progress to other players', () => {
    const other = toPublicPlayer(player({ experience: 5_000 }), NOW);
    expect(other).not.toHaveProperty('progress');
    expect(other).not.toHaveProperty('experience');
    expect(other).not.toHaveProperty('gold');
    expect(other).not.toHaveProperty('email');
  });
});
