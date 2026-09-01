import { describe, it, expect, vi } from 'vitest';
import { CROPS, CROP_IDS, HOUR, DAY, VIP_BENEFITS } from '@tillhaven/shared';
import { growthAt, isRipe, isEmpty, plantedCrop, type GrowablePlot } from './growth.js';

/**
 * Growth v1: the un-watered fallback path.
 *
 * T-9.03b flipped `WATERING_ENABLED` to true, so this suite now pins the
 * branch behind the flag rather than live behaviour — the mirror image of what
 * `growth.watering.test.ts` did before the flip, and the reason the flag is
 * still a safe one-line revert. `vi.mock` is per-file, so forcing it false
 * here leaves every other suite testing what actually ships.
 *
 * Nothing below is about watering: these are the stage boundaries, the crop
 * table walk and the VIP maths, which sit downstream of `effectiveGrowthMs`
 * and are identical in both modes. `growth.watering.test.ts` re-proves the
 * ones that could plausibly diverge against the live flag.
 */
vi.mock('@tillhaven/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tillhaven/shared')>();
  return { ...actual, WATERING_ENABLED: false };
});

const T0 = 1_700_000_000_000;

describe('the flag is really forced off here', () => {
  it('is testing the un-watered path, not the live one', () => {
    // Guards the mock itself, exactly as the watering suite used to: with the
    // real flag, a plot that was never watered grows nothing, so this crop
    // would not be ripe and half the file below would fail for the right
    // reason but a confusing one.
    expect(isRipe(plot('potato', T0, HOUR), T0 + HOUR)).toBe(true);
  });
});

function plot(cropId: string, plantedAt: number, durationMs: number): GrowablePlot {
  return { cropId, plantedAt, growthDurationMs: durationMs };
}

const EMPTY_PLOT: GrowablePlot = {
  cropId: null,
  plantedAt: null,
  growthDurationMs: null,
};

describe('empty plots', () => {
  it('report stage -1 and never ripe', () => {
    const g = growthAt(EMPTY_PLOT, T0);
    expect(g.stage).toBe(-1);
    expect(g.isRipe).toBe(false);
    expect(g.readyInMs).toBe(0);
    expect(isEmpty(EMPTY_PLOT)).toBe(true);
  });

  it.each([
    ['crop but no plantedAt', { cropId: 'potato', plantedAt: null, growthDurationMs: HOUR }],
    ['plantedAt but no crop', { cropId: null, plantedAt: T0, growthDurationMs: HOUR }],
    ['zero duration', { cropId: 'potato', plantedAt: T0, growthDurationMs: 0 }],
    ['negative duration', { cropId: 'potato', plantedAt: T0, growthDurationMs: -1 }],
    ['null duration', { cropId: 'potato', plantedAt: T0, growthDurationMs: null }],
  ])('treats %s as empty rather than throwing', (_label, p) => {
    expect(growthAt(p as GrowablePlot, T0 + DAY).stage).toBe(-1);
  });

  it('treats a crop id that is no longer in config as empty', () => {
    // A crop removed from config must not take the whole farm-state request
    // down with it.
    const p = plot('sunflower_that_was_cut', T0, HOUR);
    expect(plantedCrop(p)).toBeNull();
    expect(growthAt(p, T0 + DAY).isRipe).toBe(false);
  });
});

describe('growthAt', () => {
  const potato = CROPS.potato;
  const D = potato.growthDurationMs;

  it('is stage 0 at the moment of planting', () => {
    const g = growthAt(plot('potato', T0, D), T0);
    expect(g.stage).toBe(0);
    expect(g.isRipe).toBe(false);
    expect(g.readyInMs).toBe(D);
  });

  it('is the last stage and ripe exactly at the duration boundary', () => {
    const justBefore = growthAt(plot('potato', T0, D), T0 + D - 1);
    const exactly = growthAt(plot('potato', T0, D), T0 + D);

    expect(justBefore.isRipe).toBe(false);
    expect(justBefore.readyInMs).toBe(1);
    expect(exactly.isRipe).toBe(true);
    expect(exactly.readyInMs).toBe(0);
    expect(exactly.stage).toBe(potato.stageFrames.length - 1);
  });

  it('stays ripe indefinitely past the boundary', () => {
    // No withering — CLAUDE.md §14 D-2 is undecided, so a ripe crop waits.
    for (const after of [D + 1, D + DAY, D + 365 * DAY]) {
      const g = growthAt(plot('potato', T0, D), T0 + after);
      expect(g.isRipe).toBe(true);
      expect(g.stage).toBe(potato.stageFrames.length - 1);
      expect(g.readyInMs).toBe(0);
    }
  });

  it('advances monotonically and hits every stage exactly once', () => {
    const seen: number[] = [];
    const step = Math.floor(D / (potato.stageFrames.length * 8));

    let previous = -1;
    for (let t = 0; t <= D; t += step) {
      const { stage } = growthAt(plot('potato', T0, D), T0 + t);
      expect(stage).toBeGreaterThanOrEqual(previous);
      previous = stage;
      if (!seen.includes(stage)) seen.push(stage);
    }

    expect(seen).toEqual([...potato.stageFrames.keys()]);
  });

  it('lands on the first frame of each stage at its exact boundary', () => {
    const n = potato.stageFrames.length;
    for (let s = 0; s < n; s++) {
      const boundary = Math.ceil((s * D) / n);
      expect(growthAt(plot('potato', T0, D), T0 + boundary).stage).toBe(s);
    }
  });

  it('never returns an index outside the crop stage frames', () => {
    // Potato has 7 stages where the others have 6 — an off-by-one here would
    // index a frame that does not exist in the sheet.
    for (const id of CROP_IDS) {
      const crop = CROPS[id];
      const last = crop.stageFrames.length - 1;
      for (const frac of [0, 0.001, 0.5, 0.999, 1, 1.5, 100]) {
        const { stage } = growthAt(
          plot(id, T0, crop.growthDurationMs),
          T0 + Math.floor(crop.growthDurationMs * frac),
        );
        expect(stage).toBeGreaterThanOrEqual(0);
        expect(stage).toBeLessThanOrEqual(last);
        expect(crop.stageFrames[stage]).toBeDefined();
      }
    }
  });

  it('uses the snapshotted duration, not the current config value', () => {
    // A crop planted when potato took 30 minutes stays a 30-minute crop even
    // though config now says 2 hours.
    const snapshot = 30 * 60_000;
    expect(snapshot).not.toBe(potato.growthDurationMs);

    const g = growthAt(plot('potato', T0, snapshot), T0 + snapshot);
    expect(g.isRipe).toBe(true);
    expect(g.effectiveDurationMs).toBe(snapshot);
  });

  it('clamps a clock that has gone backwards', () => {
    const g = growthAt(plot('potato', T0, D), T0 - DAY);
    expect(g.stage).toBe(0);
    expect(g.isRipe).toBe(false);
    expect(g.readyInMs).toBe(D);
  });
});

describe('VIP multiplier', () => {
  const D = CROPS.potato.growthDurationMs;
  const vip = VIP_BENEFITS.durationPercent;

  it('shortens the effective duration', () => {
    const g = growthAt(plot('potato', T0, D), T0, vip);
    expect(g.effectiveDurationMs).toBe(Math.ceil((D * vip) / 100));
    expect(g.effectiveDurationMs).toBeLessThan(D);
  });

  it('ripens sooner than a free account', () => {
    const at = T0 + Math.ceil((D * vip) / 100);
    expect(isRipe(plot('potato', T0, D), at, vip)).toBe(true);
    expect(isRipe(plot('potato', T0, D), at, 100)).toBe(false);
  });

  it('produces the same result as a free account at 100', () => {
    const a = growthAt(plot('potato', T0, D), T0 + D / 3, 100);
    const b = growthAt(plot('potato', T0, D), T0 + D / 3);
    expect(a).toEqual(b);
  });

  it('never makes a crop instant', () => {
    // applyDurationPercent rounds up, so even a 1ms crop takes 1ms.
        const g = growthAt(plot('potato', T0, 1), T0, 1);
    expect(g.effectiveDurationMs).toBeGreaterThan(0);
  });
});

describe('offline progression', () => {
  it('eight hours away is exactly eight hours of growth', () => {
    // The whole point of the game (CLAUDE.md §4.2). No requests happen between
    // planting and checking; the answer comes from arithmetic alone.
    const onion = CROPS.onion;
    expect(onion.growthDurationMs).toBe(8 * HOUR);

    const p = plot('onion', T0, onion.growthDurationMs);
    expect(growthAt(p, T0 + 4 * HOUR).isRipe).toBe(false);
    expect(growthAt(p, T0 + 8 * HOUR).isRipe).toBe(true);
  });

  it('gives the same answer however many times it is asked', () => {
    const p = plot('potato', T0, CROPS.potato.growthDurationMs);
    const at = T0 + CROPS.potato.growthDurationMs / 2;
    const first = growthAt(p, at);
    for (let i = 0; i < 100; i++) expect(growthAt(p, at)).toEqual(first);
  });
});
