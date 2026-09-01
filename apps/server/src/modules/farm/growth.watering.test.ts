import { describe, it, expect } from 'vitest';
import {
  CROPS,
  HOUR,
  MINUTE,
  DAY,
  VIP_BENEFITS,
  WATER_DURATION_MS,
  WATERING_ENABLED,
} from '@tillhaven/shared';
import {
  growthAt,
  effectiveGrowthMs,
  settleGrowth,
  isRipe,
  type GrowablePlot,
} from './growth.js';

/**
 * Growth v2: the watered model (T-9.03a, D-1) — **live since T-9.03b**.
 *
 * Written against a `vi.mock` that forced `WATERING_ENABLED` on; the flip
 * removed the mock, so this suite now tests what actually ships, unchanged.
 * The fallback branch behind the flag kept its coverage the same way, in
 * `growth.test.ts`, which now carries the mock instead.
 */

const T0 = 1_700_000_000_000;
/** Read from config rather than restated: retuning it must fail loudly here. */
const WINDOW = WATER_DURATION_MS;

/** Potato: 2h to ripen, comfortably inside one 4h window. */
const POTATO = CROPS.potato.growthDurationMs;
/** Onion: 8h, so it needs more than one window by construction. */
const ONION = CROPS.onion.growthDurationMs;

function plot(overrides: Partial<GrowablePlot> = {}): GrowablePlot {
  return {
    cropId: 'potato',
    plantedAt: T0,
    growthDurationMs: POTATO,
    wateredAt: null,
    grownMs: 0,
    ...overrides,
  };
}

describe('watering is the live model', () => {
  it('is testing the watered path, not v1 under another name', () => {
    // Was the mock guard; now it guards the shipped constant. If the flag were
    // reverted, every assertion below would still pass against the v1 model
    // for the wrong reason — a plot never watered would keep growing — so this
    // stays as the one place that says out loud which model is in force.
    expect(WATERING_ENABLED).toBe(true);
    expect(effectiveGrowthMs(plot(), T0 + DAY)).toBe(0);
  });
});

describe('effectiveGrowthMs', () => {
  it('is zero for a crop that has never been watered, however long it waits', () => {
    expect(effectiveGrowthMs(plot(), T0)).toBe(0);
    expect(effectiveGrowthMs(plot(), T0 + HOUR)).toBe(0);
    expect(effectiveGrowthMs(plot(), T0 + DAY)).toBe(0);
  });

  it('accrues in real time inside an open window', () => {
    const p = plot({ wateredAt: T0 });
    expect(effectiveGrowthMs(p, T0)).toBe(0);
    expect(effectiveGrowthMs(p, T0 + MINUTE)).toBe(MINUTE);
    expect(effectiveGrowthMs(p, T0 + HOUR)).toBe(HOUR);
  });

  it('stops accruing once the window closes, and stays stopped', () => {
    const p = plot({ wateredAt: T0 });
    expect(effectiveGrowthMs(p, T0 + WINDOW)).toBe(WINDOW);
    // A week of drought banks one window, not a week.
    expect(effectiveGrowthMs(p, T0 + WINDOW + MINUTE)).toBe(WINDOW);
    expect(effectiveGrowthMs(p, T0 + 7 * DAY)).toBe(WINDOW);
  });

  it('adds banked growth to the open window', () => {
    const p = plot({ grownMs: 30 * MINUTE, wateredAt: T0 });
    expect(effectiveGrowthMs(p, T0)).toBe(30 * MINUTE);
    expect(effectiveGrowthMs(p, T0 + HOUR)).toBe(90 * MINUTE);
  });

  it('never goes backwards when the clock does', () => {
    const p = plot({ grownMs: HOUR, wateredAt: T0 });
    // `now` before `wateredAt` must not subtract from banked growth.
    expect(effectiveGrowthMs(p, T0 - DAY)).toBe(HOUR);
  });

  it('treats a negative or missing grownMs as zero rather than debt', () => {
    expect(effectiveGrowthMs(plot({ grownMs: -HOUR, wateredAt: T0 }), T0 + HOUR)).toBe(HOUR);
    expect(effectiveGrowthMs(plot({ grownMs: null, wateredAt: T0 }), T0 + HOUR)).toBe(HOUR);
  });

  it('is zero for an unplanted plot', () => {
    expect(effectiveGrowthMs(plot({ plantedAt: null, wateredAt: T0 }), T0 + HOUR)).toBe(0);
  });
});

describe('settleGrowth', () => {
  /**
   * The property the whole model rests on: re-watering must never destroy
   * progress. Settling before re-stamping is what guarantees it, and settling
   * IS `effectiveGrowthMs` — so this is really asserting they cannot drift.
   */
  it('banks exactly what has been earned so far', () => {
    const p = plot({ wateredAt: T0 });
    for (const at of [0, MINUTE, HOUR, WINDOW, WINDOW + DAY]) {
      expect(settleGrowth(p, T0 + at), `settled at +${at}`).toBe(
        effectiveGrowthMs(p, T0 + at),
      );
    }
  });

  it('loses nothing when re-watered before the window expires', () => {
    const first = plot({ wateredAt: T0 });
    const atRewater = T0 + HOUR;

    // Water again an hour in: settle, then re-stamp.
    const banked = settleGrowth(first, atRewater);
    const second = plot({ grownMs: banked, wateredAt: atRewater });

    expect(banked).toBe(HOUR);
    // Continuous growth across the boundary — the hour before the re-water and
    // the hour after add up to two.
    expect(effectiveGrowthMs(second, atRewater + HOUR)).toBe(2 * HOUR);
  });

  it('loses nothing when re-watered long after the window expires', () => {
    const first = plot({ wateredAt: T0 });
    const atRewater = T0 + 3 * DAY;

    const banked = settleGrowth(first, atRewater);
    const second = plot({ grownMs: banked, wateredAt: atRewater });

    // The three dry days contributed nothing, but the full first window did.
    expect(banked).toBe(WINDOW);
    expect(effectiveGrowthMs(second, atRewater + HOUR)).toBe(WINDOW + HOUR);
  });

  it('is idempotent: settling twice at the same instant banks the same total', () => {
    const p = plot({ wateredAt: T0 });
    const once = settleGrowth(p, T0 + HOUR);
    const twice = settleGrowth({ ...p, grownMs: once, wateredAt: T0 + HOUR }, T0 + HOUR);
    expect(twice).toBe(once);
  });
});

describe('growthAt with watering', () => {
  it('reports a never-watered crop as paused at stage 0', () => {
    const g = growthAt(plot(), T0 + DAY);
    expect(g.isPaused).toBe(true);
    expect(g.isRipe).toBe(false);
    expect(g.stage).toBe(0);
    // The countdown is the FULL duration: no growing time has been earned.
    expect(g.readyInMs).toBe(POTATO);
  });

  it('is not paused while the soil is wet', () => {
    const g = growthAt(plot({ wateredAt: T0 }), T0 + HOUR);
    expect(g.isPaused).toBe(false);
    expect(g.readyInMs).toBe(POTATO - HOUR);
  });

  it('pauses the moment the window closes, not a millisecond earlier', () => {
    const p = plot({ cropId: 'onion', growthDurationMs: ONION, wateredAt: T0 });
    expect(growthAt(p, T0 + WINDOW - 1).isPaused).toBe(false);
    expect(growthAt(p, T0 + WINDOW).isPaused).toBe(true);
  });

  it('ripens inside a single window when the crop is short enough', () => {
    const p = plot({ wateredAt: T0 });
    expect(growthAt(p, T0 + POTATO - 1).isRipe).toBe(false);
    expect(growthAt(p, T0 + POTATO).isRipe).toBe(true);
    expect(isRipe(p, T0 + POTATO)).toBe(true);
  });

  it('needs a second watering for a crop longer than one window', () => {
    const first = plot({ cropId: 'onion', growthDurationMs: ONION, wateredAt: T0 });
    // One full window is not enough for an 8h onion...
    expect(growthAt(first, T0 + DAY).isRipe).toBe(false);
    expect(growthAt(first, T0 + DAY).isPaused).toBe(true);

    // ...but banking it and watering again gets there.
    const banked = settleGrowth(first, T0 + DAY);
    const second = {
      ...first,
      grownMs: banked,
      wateredAt: T0 + DAY,
    } satisfies GrowablePlot;
    expect(growthAt(second, T0 + DAY + WINDOW).isRipe).toBe(true);
  });

  it('stays ripe once ripe, even after the soil dries out', () => {
    // A finished crop does not un-ripen; it waits to be picked (§5.2 — a dry
    // crop pauses, it never dies).
    const p = plot({ grownMs: POTATO, wateredAt: null });
    const g = growthAt(p, T0 + 7 * DAY);
    expect(g.isRipe).toBe(true);
    expect(g.isPaused).toBe(false);
    expect(g.readyInMs).toBe(0);
  });

  it('advances stages on watered time, not wall-clock time', () => {
    const stages = CROPS.potato.stageFrames.length;
    const perStage = POTATO / stages;

    const wet = plot({ wateredAt: T0 });
    expect(growthAt(wet, T0 + perStage).stage).toBe(1);

    // The same wall-clock gap with dry soil leaves the crop at stage 0.
    const dry = plot();
    expect(growthAt(dry, T0 + perStage).stage).toBe(0);
  });

  it('never reports a stage past the last frame', () => {
    const p = plot({ grownMs: 10 * DAY, wateredAt: T0 });
    expect(growthAt(p, T0 + DAY).stage).toBe(CROPS.potato.stageFrames.length - 1);
  });

  it('applies the VIP multiplier to the target, not to the growing', () => {
    const percent = VIP_BENEFITS.durationPercent;
    const p = plot({ wateredAt: T0 });
    const shortened = (POTATO * percent) / 100;

    const free = growthAt(p, T0 + shortened);
    const vip = growthAt(p, T0 + shortened, percent);

    // Same watered time, same accrued growth — but VIP needs less of it.
    expect(free.isRipe).toBe(false);
    expect(vip.isRipe).toBe(true);
    expect(vip.effectiveDurationMs).toBe(shortened);
  });

  it('reports a paused VIP crop against the shortened target', () => {
    const percent = VIP_BENEFITS.durationPercent;
    const g = growthAt(plot(), T0 + DAY, percent);
    expect(g.isPaused).toBe(true);
    expect(g.readyInMs).toBe((POTATO * percent) / 100);
  });

  it('keeps readyInMs finite and non-negative in every state', () => {
    const cases: [string, GrowablePlot, number][] = [
      ['never watered', plot(), T0 + DAY],
      ['wet', plot({ wateredAt: T0 }), T0 + MINUTE],
      ['dried out', plot({ wateredAt: T0 }), T0 + 7 * DAY],
      ['ripe', plot({ grownMs: POTATO }), T0],
      ['over-grown', plot({ grownMs: 100 * DAY }), T0],
    ];

    for (const [label, p, at] of cases) {
      const g = growthAt(p, at);
      expect(Number.isFinite(g.readyInMs), `${label} is finite`).toBe(true);
      expect(g.readyInMs, `${label} is non-negative`).toBeGreaterThanOrEqual(0);
    }
  });
});
