import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  ANIMALS,
  CROPS,
  CROP_IDS,
  FARM_LEVEL_XP,
  MAX_FARM_LEVEL,
  TRADE_MIN_FARM_LEVEL,
  XP_PER_UNIT_MS,
  levelForXp,
  levelProgress,
  xpForCollect,
  xpForHarvest,
} from '@tillhaven/shared';
import { db, schema, closeDb } from '../../db/client.js';
import { resetDb, insertTestPlayer } from '../../test/helpers.js';
import { grantXp } from './level.js';

/**
 * Farm level is a **trade gate** before it is anything else (§6, §14): below
 * level 5 a player cannot trade, which is what makes throwaway-account scamming
 * expensive. So the properties that matter are not "does the curve feel nice"
 * but: can it be bought, can it go backwards, and is the boundary exactly where
 * the config says.
 */

describe('the curve', () => {
  it('starts at level 1 with no experience', () => {
    expect(levelForXp(0)).toBe(1);
    expect(FARM_LEVEL_XP[0]).toBe(0);
  });

  it('rises monotonically and never repeats a threshold', () => {
    for (let i = 1; i < FARM_LEVEL_XP.length; i++) {
      expect(FARM_LEVEL_XP[i]!, `level ${i + 1}`).toBeGreaterThan(FARM_LEVEL_XP[i - 1]!);
    }
    expect(FARM_LEVEL_XP).toHaveLength(MAX_FARM_LEVEL);
  });

  it('is whole numbers throughout — no fractional experience anywhere', () => {
    for (const xp of FARM_LEVEL_XP) expect(Number.isInteger(xp)).toBe(true);
  });

  it('gets harder with every level, so late levels are an achievement', () => {
    const steps = FARM_LEVEL_XP.slice(1).map((xp, i) => xp - FARM_LEVEL_XP[i]!);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!, `step to level ${i + 2}`).toBeGreaterThanOrEqual(steps[i - 1]!);
    }
  });

  /**
   * The boundary that gates trading. Asserted from both sides, at the exact
   * threshold, because "close enough" here means either locking out legitimate
   * players or letting a day-old scam account trade.
   */
  it('reaches the trade-eligible level at exactly its threshold', () => {
    const needed = FARM_LEVEL_XP[TRADE_MIN_FARM_LEVEL - 1]!;

    expect(levelForXp(needed - 1)).toBe(TRADE_MIN_FARM_LEVEL - 1);
    expect(levelForXp(needed)).toBe(TRADE_MIN_FARM_LEVEL);
    expect(levelForXp(needed + 1)).toBe(TRADE_MIN_FARM_LEVEL);
  });

  it('lands on the first experience of every level, exactly', () => {
    for (const [index, threshold] of FARM_LEVEL_XP.entries()) {
      expect(levelForXp(threshold), `threshold ${threshold}`).toBe(index + 1);
      if (index > 0) expect(levelForXp(threshold - 1)).toBe(index);
    }
  });

  it('caps rather than running off the end of the table', () => {
    const beyond = FARM_LEVEL_XP[MAX_FARM_LEVEL - 1]! * 1000;
    expect(levelForXp(beyond)).toBe(MAX_FARM_LEVEL);
  });

  it('treats nonsense experience as level 1 rather than throwing', () => {
    for (const xp of [-1, -1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(levelForXp(xp), String(xp)).toBeGreaterThanOrEqual(1);
      expect(levelForXp(xp)).toBeLessThanOrEqual(MAX_FARM_LEVEL);
    }
  });
});

describe('levelProgress', () => {
  it('reports the distance to the next level', () => {
    const atLevel2 = FARM_LEVEL_XP[1]!;
    const p = levelProgress(atLevel2 + 10);

    expect(p.level).toBe(2);
    expect(p.levelStartXp).toBe(atLevel2);
    expect(p.nextLevelXp).toBe(FARM_LEVEL_XP[2]);
    expect(p.toNextLevel).toBe(FARM_LEVEL_XP[2]! - atLevel2 - 10);
  });

  it('has no next level at the cap', () => {
    const p = levelProgress(FARM_LEVEL_XP[MAX_FARM_LEVEL - 1]!);
    expect(p.level).toBe(MAX_FARM_LEVEL);
    expect(p.nextLevelXp).toBeNull();
    expect(p.toNextLevel).toBe(0);
  });

  it('never reports a negative distance', () => {
    for (const xp of [0, 1, 500, 50_000, -5]) {
      expect(levelProgress(xp).toNextLevel).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('what earns experience', () => {
  /**
   * The load-bearing property: experience is bought with TIME, never with gold.
   * A funded scammer must not be able to mint an eligible account on demand.
   */
  const IDEAL_XP_PER_HOUR = 3_600_000 / XP_PER_UNIT_MS;

  const xpPerHour = (id: string): number =>
    (xpForHarvest(id) * 3_600_000) / CROPS[id as keyof typeof CROPS].growthDurationMs;

  /**
   * **The asymmetry here is the whole security property, and T-31.04 is what
   * exposed it.**
   *
   * This test used to assert `fastest / slowest < 1.1` — that every crop was
   * worth the same XP per hour to within a hair. That held while every crop's
   * duration was a whole multiple of `XP_PER_UNIT_MS` (5 minutes). Parsnip is
   * 12 minutes, so `floor(12 / 5)` pays 2 XP where the ideal is 2.4, and the
   * ratio went to 1.2.
   *
   * Tightening parsnip to 15 minutes would have restored the old test and
   * would have been the wrong fix, because **the two directions are not
   * equally dangerous.** Rounding DOWN costs a player a fraction of an XP;
   * they level slightly slower on a 12-minute crop, which is a balance
   * detail. Rounding UP is an exploit: `config/level.ts` is explicit that XP
   * exists primarily as the anti-alt control behind `TRADE_MIN_FARM_LEVEL`,
   * so a crop that pays more XP per hour than the norm is a crop that mints
   * trade-eligible alt accounts faster.
   *
   * So the ceiling is hard and the floor is loose.
   */
  it('no crop pays more experience per hour than the wait is worth', () => {
    const above = CROP_IDS.filter((id) => xpPerHour(id) > IDEAL_XP_PER_HOUR).map(
      (id) => `${id} at ${xpPerHour(id).toFixed(2)} XP/hr`,
    );

    expect(
      above,
      `no crop may beat ${IDEAL_XP_PER_HOUR} XP/hr — that would be the levelling crop, ` +
        'and levelling is what gates trading',
    ).toEqual([]);
  });

  it('no crop is a dead end for levelling either', () => {
    // Loose, unlike the ceiling: a sub-unit crop losing a fraction to `floor`
    // is fine, a crop worth a third of the norm would be a trap.
    for (const id of CROP_IDS) {
      expect(xpPerHour(id), `${id} levels far too slowly`).toBeGreaterThan(
        IDEAL_XP_PER_HOUR * 0.75,
      );
    }
  });

  /**
   * **The cliff the ceiling above exists to catch, stated directly.**
   *
   * `xpForDuration` is `max(1, floor(ms / XP_PER_UNIT_MS))`, and that `max(1,
   * ...)` is a floor on the AWARD, not on the rate. A crop shorter than
   * `XP_PER_UNIT_MS` still pays a whole XP — so a 1-minute crop would pay 60
   * XP/hr against the norm's 12, five times the rate, and a scammer would
   * plant nothing else.
   *
   * Nothing in the shipped table is close (parsnip, the shortest, is 12
   * minutes), but T-31.05 is about to add a deliberately fast starter crop and
   * D-18's brief says "sub-15-minute". This pins the actual boundary so that
   * task hits a failing test rather than a live exploit: **no crop may be
   * shorter than `XP_PER_UNIT_MS`.**
   */
  it('no crop is shorter than one unit of experience', () => {
    const tooFast = CROP_IDS.filter(
      (id) => CROPS[id].growthDurationMs < XP_PER_UNIT_MS,
    ).map((id) => `${id} at ${CROPS[id].growthDurationMs / 60_000}m`);

    expect(
      tooFast,
      `a crop under ${XP_PER_UNIT_MS / 60_000} minutes still pays a whole XP, so it beats ` +
        'every other crop on XP per hour — see xpForDuration',
    ).toEqual([]);
  });

  it('grants at least one experience for any crop', () => {
    for (const id of CROP_IDS) expect(xpForHarvest(id)).toBeGreaterThanOrEqual(1);
  });

  it('scales an animal collection by cycles, not by units of produce', () => {
    const one = xpForCollect('chicken', 1);
    expect(xpForCollect('chicken', 3)).toBe(one * 3);
    expect(xpForCollect('chicken', 0)).toBe(0);
    expect(xpForCollect('chicken', -2)).toBe(0);
  });

  it('pays a cow more per collection than a chicken, because the wait is longer', () => {
    expect(ANIMALS.cow.productionIntervalMs).toBeGreaterThan(ANIMALS.chicken.productionIntervalMs);
    expect(xpForCollect('cow', 1)).toBeGreaterThan(xpForCollect('chicken', 1));
  });

  it('grants nothing for something that is not in config', () => {
    expect(xpForHarvest('philosophers_stone')).toBe(0);
    expect(xpForCollect('griffin', 5)).toBe(0);
  });
});

describe('grantXp', () => {
  let playerId: string;

  beforeEach(async () => {
    await resetDb();
    playerId = (await insertTestPlayer()).id;
  });

  afterAll(closeDb);

  async function experience(): Promise<number> {
    const [row] = await db
      .select({ experience: schema.players.experience })
      .from(schema.players)
      .where(eq(schema.players.id, playerId));
    return row!.experience;
  }

  it('accumulates', async () => {
    await db.transaction((tx) => grantXp(tx, playerId, 30));
    await db.transaction((tx) => grantXp(tx, playerId, 12));
    expect(await experience()).toBe(42);
  });

  it('returns the new total', async () => {
    const total = await db.transaction((tx) => grantXp(tx, playerId, 7));
    expect(total).toBe(7);
  });

  /**
   * Read-modify-write would lose one of these. A player quietly failing to
   * reach the level that lets them trade is a bug nobody would report clearly.
   */
  it('does not lose a concurrent grant', async () => {
    await Promise.all(
      Array.from({ length: 8 }, () => db.transaction((tx) => grantXp(tx, playerId, 5))),
    );
    expect(await experience()).toBe(40);
  });

  it('refuses to subtract — experience only ever goes up', async () => {
    await db.transaction((tx) => grantXp(tx, playerId, 100));

    await expect(db.transaction((tx) => grantXp(tx, playerId, -50))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(db.transaction((tx) => grantXp(tx, playerId, 1.5))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    expect(await experience()).toBe(100);
  });

  it('a level derived from it therefore never decreases', async () => {
    let previous = 1;
    for (let i = 0; i < 12; i++) {
      const total = await db.transaction((tx) => grantXp(tx, playerId, 50));
      const level = levelForXp(total);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
    expect(previous).toBeGreaterThan(1);
  });

  it('rolls back with its caller', async () => {
    const attempt = db.transaction(async (tx) => {
      await grantXp(tx, playerId, 500);
      throw new Error('caller changed its mind');
    });

    await expect(attempt).rejects.toThrow();
    expect(await experience()).toBe(0);
  });
});
