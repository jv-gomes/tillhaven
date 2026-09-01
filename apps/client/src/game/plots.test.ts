import { describe, it, expect } from 'vitest';
import { CROPS, CROP_IDS, WATER_DURATION_MS, HOUR } from '@tillhaven/shared/config';
import type { PlotView } from '@tillhaven/shared/types';
import { displayAt, soilAt } from './plots.js';

/**
 * These are the client's half of CLAUDE.md §4.1: the client may draw what it
 * expects, but it may never *decide* anything. Every test below is really one
 * question — can this drawing path invent something the server did not say?
 *
 * Since D-1 (T-9.04) there is a second question running alongside it: does the
 * drawing stop when the soil dries out? A countdown that keeps ticking on a
 * paused crop is not a rendering nicety, it is the client claiming growth the
 * server will not agree to.
 *
 * The `predictPlant`/`predictHarvest` suites went with those functions in
 * T-9.06 — the tool swing covers the round trip now, so there is nothing left
 * to predict.
 */

const T0 = 1_700_000_000_000;

const EMPTY_PLOT: PlotView = {
  id: 'plot-1',
  farmId: 'farm-1',
  x: 5,
  y: 7,
  unlocked: true,
  cropId: null,
  plantedAt: null,
  growthDurationMs: null,
  wateredAt: null,
  witheredAt: null,
  harvestedAt: null,
  tilled: false,
  stage: 0,
  isRipe: false,
  readyInMs: 0,
  isPaused: false,
  isWet: false,
  wetUntil: null,
  effectiveDurationMs: 0,
};

const LEEK = CROPS['leek'];

/**
 * A plot as the server would report it: `elapsed` ms of WATERED growth done,
 * and wet from `serverNow` for a full window unless told otherwise.
 */
function growing(elapsed: number, serverNow = T0, overrides: Partial<PlotView> = {}): PlotView {
  const wateredAt = serverNow;
  return {
    ...EMPTY_PLOT,
    cropId: 'leek',
    plantedAt: serverNow - elapsed,
    growthDurationMs: LEEK.growthDurationMs,
    effectiveDurationMs: LEEK.growthDurationMs,
    tilled: true,
    wateredAt,
    wetUntil: wateredAt + WATER_DURATION_MS,
    isWet: true,
    isPaused: false,
    stage: 0,
    isRipe: false,
    readyInMs: LEEK.growthDurationMs - elapsed,
    ...overrides,
  };
}

/** The same crop, on soil that dried out before the view was taken. */
function parched(elapsed: number, serverNow = T0): PlotView {
  return growing(elapsed, serverNow, {
    wetUntil: serverNow - 1,
    isWet: false,
    isPaused: true,
  });
}

describe('soilAt', () => {
  it('draws nothing on ground that has never been hoed', () => {
    expect(soilAt(EMPTY_PLOT, T0)).toBe('untilled');
    // Not even if it somehow carries a wet window: untilled wins.
    expect(soilAt({ ...EMPTY_PLOT, wetUntil: T0 + HOUR }, T0)).toBe('untilled');
  });

  it('is dry soil once tilled, and wet soil while the window is open', () => {
    const tilled = { ...EMPTY_PLOT, tilled: true };
    expect(soilAt(tilled, T0)).toBe('dry');
    expect(soilAt({ ...tilled, wetUntil: T0 + HOUR }, T0)).toBe('wet');
  });

  /**
   * The whole reason `wetUntil` is sent as an absolute instant. Polls are 20s
   * apart; deriving wetness from the server's `isWet` boolean would leave a
   * plot looking watered for up to a poll after it stopped growing.
   */
  it('dries out on the client at the exact instant the window closes', () => {
    const view = growing(0);
    const wetUntil = view.wetUntil!;

    expect(soilAt(view, wetUntil - 1)).toBe('wet');
    expect(soilAt(view, wetUntil)).toBe('dry');
    // ...even though the view still says it was wet when it was measured.
    expect(view.isWet).toBe(true);
  });
});

describe('displayAt', () => {
  it('counts down while the soil is wet', () => {
    const view = growing(0);

    expect(displayAt(view, T0, T0).readyInMs).toBe(LEEK.growthDurationMs);
    expect(displayAt(view, T0, T0 + 60_000).readyInMs).toBe(LEEK.growthDurationMs - 60_000);
    expect(displayAt(view, T0, T0 + 60_000).isPaused).toBe(false);
  });

  /**
   * The headline behaviour of growth v2 on the client. A leek needs 45 minutes
   * and the window here closes after 10, so the plot must stop dead at 10 —
   * without a poll, without being told.
   */
  it('freezes the moment the wet window closes, however long it is left', () => {
    const closesAt = T0 + 10 * 60_000;
    const view = growing(0, T0, { wetUntil: closesAt });

    const atClose = displayAt(view, T0, closesAt);
    expect(atClose.readyInMs).toBe(LEEK.growthDurationMs - 10 * 60_000);
    expect(atClose.isPaused).toBe(true);
    expect(atClose.soil).toBe('dry');

    for (const later of [closesAt + 1, closesAt + HOUR, closesAt + 400 * HOUR]) {
      const frozen = displayAt(view, T0, later);
      expect(frozen.readyInMs, `frozen at +${later - closesAt}`).toBe(atClose.readyInMs);
      expect(frozen.stage).toBe(atClose.stage);
      expect(frozen.isRipe).toBe(false);
    }
  });

  it('never advances a crop whose soil was already dry when the view was taken', () => {
    const view = parched(60_000);

    for (const later of [T0, T0 + 1, T0 + LEEK.growthDurationMs * 10]) {
      const display = displayAt(view, T0, later);
      expect(display.readyInMs).toBe(view.readyInMs);
      expect(display.isPaused).toBe(true);
      expect(display.isRipe).toBe(false);
    }
  });

  it('ripens locally when the window outlasts the countdown', () => {
    // Leek: 45 minutes, inside a 4h window, so it does finish on its own.
    const view = growing(0);
    const ripensAt = T0 + LEEK.growthDurationMs;

    expect(displayAt(view, T0, ripensAt - 1).isRipe).toBe(false);
    expect(displayAt(view, T0, ripensAt).isRipe).toBe(true);
    expect(displayAt(view, T0, ripensAt).readyInMs).toBe(0);
  });

  /**
   * The staleness case. A poll five minutes ago and a prediction made this
   * instant carry `readyInMs` measured from different moments; if the drawing
   * code used the field directly, the older one would appear five minutes
   * behind.
   */
  it('does not drift when the view it was given is stale', () => {
    const fresh = growing(0, T0);
    const stale = growing(0, T0 - 300_000);

    const now = T0 + 60_000;
    expect(displayAt(fresh, T0, now).readyInMs).toBe(
      displayAt(stale, T0 - 300_000, now).readyInMs + 300_000,
    );
  });

  it('trusts the server over the local clock when the server says ripe', () => {
    const view: PlotView = { ...growing(10), isRipe: true };
    expect(displayAt(view, T0, T0).isRipe).toBe(true);
    expect(displayAt(view, T0, T0).stage).toBe(LEEK.stageFrames.length - 1);
  });

  it('never calls a ripe crop paused, however dry its soil is', () => {
    // A finished crop does not un-ripen; it waits to be picked (§5.2). Same
    // rule as the server's growth.ts, and the countdown label depends on it.
    const view: PlotView = { ...parched(LEEK.growthDurationMs), isRipe: true };
    const display = displayAt(view, T0, T0 + 400 * HOUR);

    expect(display.isRipe).toBe(true);
    expect(display.isPaused).toBe(false);
    expect(display.soil).toBe('dry');
  });

  it('renders an empty plot as empty whatever the clock says', () => {
    expect(displayAt(EMPTY_PLOT, T0, T0 + 10_000_000)).toEqual({
      stage: 0,
      isRipe: false,
      readyInMs: 0,
      isPaused: false,
      soil: 'untilled',
    });
  });

  it('reports the soil for an empty plot too, so bare tilled ground still draws', () => {
    const tilled = { ...EMPTY_PLOT, tilled: true, wetUntil: T0 + HOUR };
    expect(displayAt(tilled, T0, T0).soil).toBe('wet');
    expect(displayAt(tilled, T0, T0 + 2 * HOUR).soil).toBe('dry');
  });

  /**
   * The client draws stages with the server's own formula against the duration
   * the server sent (§4.4). Before T-9.04 it inferred the duration from
   * `plantedAt`, which watering made meaningless — a crop that spent a day dry
   * would have been drawn nearly ripe.
   */
  it('uses the effective duration the server sent, not the config one', () => {
    // A VIP account: the server ripens leek in 80% of the config duration.
    const effectiveDurationMs = LEEK.growthDurationMs * 0.8;
    const view = growing(0, T0, { effectiveDurationMs, readyInMs: effectiveDurationMs });

    expect(displayAt(view, T0, T0 + effectiveDurationMs).isRipe).toBe(true);
    expect(displayAt(view, T0, T0 + effectiveDurationMs - 1).isRipe).toBe(false);
    expect(displayAt(view, T0, T0 + LEEK.growthDurationMs).isRipe).toBe(true);

    /*
     * The STAGES have to come from the same number, not just the ripeness.
     * Against the config duration this crop would look 20% of the way through
     * the moment it was planted — a fresh seed drawn as a sprouted one.
     */
    expect(displayAt(view, T0, T0).stage).toBe(0);
    const stages = LEEK.stageFrames.length;
    expect(displayAt(view, T0, T0 + effectiveDurationMs / stages).stage).toBe(1);
    expect(displayAt(view, T0, T0 + effectiveDurationMs / 2).stage).toBe(stages / 2);
  });
});

/**
 * Every crop, not just the one the rest of this file uses.
 *
 * All four crops happen to share the same stage count today (T-7.08), but
 * this suite deliberately reads `crop.stageFrames.length` rather than
 * hardcoding it — a future crop with a different count must not silently
 * render its last stage as its first, or index a frame that is not in the
 * sheet. That only shows up if the tests actually walk all four.
 */
describe('every crop', () => {
  for (const cropId of CROP_IDS) {
    const crop = CROPS[cropId];

    describe(crop.name, () => {
      /*
       * Watered for longer than the crop needs, so this suite is about the
       * stage maths rather than about the window. `wetUntil` is set from the
       * duration rather than from WATER_DURATION_MS on purpose: onion is
       * longer than one real window, and pausing half way would make "walks
       * every stage" fail for a reason that has nothing to do with frames.
       */
      const planted: PlotView = {
        ...EMPTY_PLOT,
        cropId,
        tilled: true,
        plantedAt: T0,
        growthDurationMs: crop.growthDurationMs,
        effectiveDurationMs: crop.growthDurationMs,
        readyInMs: crop.growthDurationMs,
        wateredAt: T0,
        wetUntil: T0 + crop.growthDurationMs * 2,
        isWet: true,
      };
      const ripensAt = T0 + crop.growthDurationMs;

      it('walks through every stage exactly once, in order', () => {
        const seen: number[] = [];
        let previous = -1;

        // Fine enough to land inside every stage of even the shortest crop.
        const steps = crop.stageFrames.length * 12;
        for (let i = 0; i <= steps; i++) {
          const now = T0 + Math.floor((crop.growthDurationMs * i) / steps);
          const { stage } = displayAt(planted, T0, now);

          expect(stage).toBeGreaterThanOrEqual(previous);
          previous = stage;
          if (!seen.includes(stage)) seen.push(stage);
        }

        expect(seen).toEqual([...crop.stageFrames.keys()]);
      });

      it('never names a frame the crop does not have', () => {
        for (const fraction of [0, 0.001, 0.25, 0.5, 0.999, 1, 2, 1000]) {
          const now = T0 + Math.floor(crop.growthDurationMs * fraction);
          const { stage } = displayAt(planted, T0, now);

          expect(stage).toBeGreaterThanOrEqual(0);
          expect(stage).toBeLessThan(crop.stageFrames.length);
          // What the scene actually passes to setFrame.
          expect(crop.stageFrames[stage]).toBeDefined();
        }
      });

      it('is ripe on its last frame, and only at its own duration', () => {
        expect(displayAt(planted, T0, ripensAt - 1).isRipe).toBe(false);

        const ripe = displayAt(planted, T0, ripensAt);
        expect(ripe.isRipe).toBe(true);
        expect(ripe.stage).toBe(crop.stageFrames.length - 1);
      });

      it('stops at whatever stage it had reached when the soil dried', () => {
        const dryAt = T0 + Math.floor(crop.growthDurationMs / 3);
        const thirsty: PlotView = { ...planted, wetUntil: dryAt };

        const atClose = displayAt(thirsty, T0, dryAt);
        const muchLater = displayAt(thirsty, T0, dryAt + 1000 * HOUR);

        expect(muchLater.stage).toBe(atClose.stage);
        expect(muchLater.isRipe).toBe(false);
        expect(muchLater.isPaused).toBe(true);
      });
    });
  }
});
