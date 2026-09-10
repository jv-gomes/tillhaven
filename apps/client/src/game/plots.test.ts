import { describe, it, expect } from 'vitest';
import { CROPS, CROP_IDS, ITEMS, TILESET_SOIL, WATER_DURATION_MS, HOUR } from '@tillhaven/shared/config';
import type { PlotView } from '@tillhaven/shared/types';
import {
  SOIL_E,
  SOIL_N,
  SOIL_S,
  SOIL_W,
  THIRSTY_ITEM_ID,
  displayAt,
  plotBadgeFor,
  soilAt,
  soilFrame,
  soilMaskAt,
  thirstyCount,
  tileKey,
  type PlotDisplay,
} from './plots.js';

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

/* ------------------------------------------------------------------ *
 * Thirst (T-18.16, F-2)
 * ------------------------------------------------------------------ */

/**
 * D-1 made the whole farming loop turn on watering, and until T-18.16 the only
 * sign a crop had stopped growing was a hover countdown reading `DRY`. A player
 * who does not hover never learns why nothing is happening: the game looks
 * broken and the fix is one keypress away.
 */
describe('plotBadgeFor', () => {
  const display = (over: Partial<PlotDisplay> = {}): PlotDisplay => ({
    stage: 2,
    isRipe: false,
    readyInMs: 60_000,
    isPaused: true,
    soil: 'dry',
    ...over,
  });

  it('shows the watering can on a paused crop', () => {
    const badge = plotBadgeFor(display());

    expect(badge).not.toBeNull();
    // The can, not a droplet or a warning triangle: the badge's job is "bring
    // THIS", and it shows the icon already sitting in the player's hotbar.
    expect(badge).toEqual(ITEMS[THIRSTY_ITEM_ID]!.icon);
  });

  it('shows nothing while the crop is growing', () => {
    expect(plotBadgeFor(display({ isPaused: false, soil: 'wet' }))).toBeNull();
  });

  /**
   * A ripe crop is never paused — `displayAt` says so — so this can only be
   * reached by a caller constructing a display by hand. Asserted anyway,
   * because "READY" and "needs water" on the same tile would be a contradiction
   * the player has to resolve.
   */
  it('shows nothing on a ripe crop', () => {
    expect(plotBadgeFor(display({ isRipe: true, isPaused: false }))).toBeNull();
  });
});

describe('thirstyCount', () => {
  const NOW = 1_700_000_000_000;

  /** A plot that has been dry since before `NOW`, with a crop part-grown. */
  const dry = (over: Partial<PlotView> = {}): PlotView => ({
    ...EMPTY_PLOT,
    tilled: true,
    cropId: 'leek',
    plantedAt: NOW - 60_000,
    growthDurationMs: CROPS.leek.growthDurationMs,
    effectiveDurationMs: CROPS.leek.growthDurationMs,
    readyInMs: CROPS.leek.growthDurationMs,
    wetUntil: NOW - 1,
    ...over,
  });

  it('counts a dry planted plot', () => {
    expect(thirstyCount([dry()], NOW, NOW)).toBe(1);
  });

  it('does not count a wet one', () => {
    expect(thirstyCount([dry({ wetUntil: NOW + 60_000 })], NOW, NOW)).toBe(0);
  });

  it('does not count bare soil, however dry', () => {
    expect(thirstyCount([dry({ cropId: null, plantedAt: null })], NOW, NOW)).toBe(0);
  });

  it('counts nothing on an empty farm', () => {
    expect(thirstyCount([], NOW, NOW)).toBe(0);
  });

  /**
   * The reason this is counted on the CLIENT rather than sent by the server:
   * "paused" is a function of `wetUntil` and the clock, and the client already
   * interpolates that forward between polls. A count measured at the poll would
   * be a whole interval stale at exactly the moment it changes — the moment the
   * water runs out.
   */
  it('turns thirsty as the wet window closes, without a new poll', () => {
    const view = dry({ wetUntil: NOW + 10_000 });

    expect(thirstyCount([view], NOW, NOW), 'still wet').toBe(0);
    expect(thirstyCount([view], NOW, NOW + 10_001), 'the same poll, later').toBe(1);
  });
});

/**
 * T-19.01 — the soil edge mask.
 *
 * This is what gives a tilled patch a boundary. Before it, soil was a flat
 * `#be6d47` fill: a hoed plot was a bare terracotta square butted against
 * grass, and the pack's own soil art could not fix that either — `TILESET_SOIL`
 * is rounded clod stamps with dark outline pixels along every cell edge, so
 * tiling it puts eight of them at each 16px junction. That dot grid is the bug
 * these frames exist to avoid, so the mask is worth pinning precisely.
 *
 * The cases below are shapes a player actually makes, in the order they make
 * them: one plot, then a line, then a corner, then the field.
 */
describe('soilMaskAt', () => {
  /** A tilled set from grid cells, spelled the way the scene spells it. */
  const tilled = (...cells: readonly (readonly [number, number])[]): ReadonlySet<string> =>
    new Set(cells.map(([x, y]) => tileKey(x, y)));

  it('gives an isolated plot no neighbours at all', () => {
    // Mask 0 — the very first plot anyone tills, and precisely the case a
    // 9-role nine-slice has no art for.
    expect(soilMaskAt(tilled([5, 5]), 5, 5)).toBe(0);
  });

  it('reads each direction into its own bit', () => {
    expect(soilMaskAt(tilled([5, 5], [5, 4]), 5, 5), 'north').toBe(SOIL_N);
    expect(soilMaskAt(tilled([5, 5], [6, 5]), 5, 5), 'east').toBe(SOIL_E);
    expect(soilMaskAt(tilled([5, 5], [5, 6]), 5, 5), 'south').toBe(SOIL_S);
    expect(soilMaskAt(tilled([5, 5], [4, 5]), 5, 5), 'west').toBe(SOIL_W);
  });

  /**
   * The bits must not collide, or two different shapes would draw the same
   * frame. Four powers of two, so any subset is recoverable.
   */
  it('uses four distinct bits', () => {
    expect(new Set([SOIL_N, SOIL_E, SOIL_S, SOIL_W]).size).toBe(4);
    expect(SOIL_N | SOIL_E | SOIL_S | SOIL_W).toBe(15);
  });

  it('rims both open sides of a corner', () => {
    // An L: (5,5) is the elbow, with neighbours east and south.
    const shape = tilled([5, 5], [6, 5], [5, 6]);
    expect(soilMaskAt(shape, 5, 5), 'elbow').toBe(SOIL_E | SOIL_S);
    expect(soilMaskAt(shape, 6, 5), 'the east arm').toBe(SOIL_W);
    expect(soilMaskAt(shape, 5, 6), 'the south arm').toBe(SOIL_N);
  });

  it('handles a one-wide row, which has no nine-slice role', () => {
    const row = tilled([4, 5], [5, 5], [6, 5]);
    expect(soilMaskAt(row, 4, 5), 'west end').toBe(SOIL_E);
    expect(soilMaskAt(row, 5, 5), 'middle — open north AND south').toBe(SOIL_E | SOIL_W);
    expect(soilMaskAt(row, 6, 5), 'east end').toBe(SOIL_W);
  });

  it('handles a one-wide column the same way', () => {
    const col = tilled([5, 4], [5, 5], [5, 6]);
    expect(soilMaskAt(col, 5, 4), 'north end').toBe(SOIL_S);
    expect(soilMaskAt(col, 5, 5), 'middle — open east AND west').toBe(SOIL_N | SOIL_S);
    expect(soilMaskAt(col, 5, 6), 'south end').toBe(SOIL_N);
  });

  /**
   * The whole field: only the interior is unrimmed. If this said 15 everywhere
   * the field would have no outline against the grass, which is the flat-fill
   * behaviour this replaced.
   */
  it('rims the border of a filled field and nothing inside it', () => {
    const field = tilled(
      ...Array.from({ length: 3 }, (_, x) =>
        Array.from({ length: 3 }, (_, y) => [x, y] as const),
      ).flat(),
    );

    expect(soilMaskAt(field, 1, 1), 'centre').toBe(15);
    expect(soilMaskAt(field, 0, 0), 'north-west corner').toBe(SOIL_E | SOIL_S);
    expect(soilMaskAt(field, 2, 2), 'south-east corner').toBe(SOIL_N | SOIL_W);
    expect(soilMaskAt(field, 1, 0), 'north edge').toBe(SOIL_E | SOIL_S | SOIL_W);
    expect(soilMaskAt(field, 0, 1), 'west edge').toBe(SOIL_N | SOIL_E | SOIL_S);
  });

  /**
   * The one the scene has to get right when it builds the set. A locked plot is
   * not tilled and must be absent, or the field would run past the edge of what
   * the player owns with no boundary drawn.
   */
  it('rims against a neighbour that is absent from the set', () => {
    // (6,5) is a locked plot, so the scene never adds it. From (5,5) that edge
    // must read exactly like grass.
    expect(soilMaskAt(tilled([5, 5]), 5, 5)).toBe(soilMaskAt(tilled([5, 5], [7, 5]), 5, 5));
  });

  /** Diagonals are not neighbours — the sheet has no inner-corner art. */
  it('ignores diagonals', () => {
    expect(soilMaskAt(tilled([5, 5], [6, 6], [4, 4], [6, 4], [4, 6]), 5, 5)).toBe(0);
  });
});

describe('soilFrame', () => {
  it('has no frame for untilled ground', () => {
    // The caller hides the sprite and the map's own ground shows through —
    // which since the re-scope is the ORANGE tillable fill, so an un-hoed plot
    // still reads as a field rather than as grass.
    expect(soilFrame(0, 'untilled')).toBeNull();
    expect(soilFrame(15, 'untilled')).toBeNull();
  });

  /**
   * Thirty-two distinct frames — sixteen masks in each of two states — and all
   * of them the pack's own art since the re-scope. They used to be cropped out
   * of a generated strip.
   */
  it('gives one distinct frame per mask per state', () => {
    const frames = new Set<number>();
    for (const soil of ['dry', 'wet'] as const) {
      for (let mask = 0; mask < 16; mask++) frames.add(soilFrame(mask, soil)!);
    }
    expect(frames.size).toBe(32);
  });

  it('answers for every mask, with no gaps', () => {
    for (const soil of ['dry', 'wet'] as const) {
      for (let mask = 0; mask < 16; mask++) {
        expect(soilFrame(mask, soil), `${soil} mask ${mask}`).toEqual(expect.any(Number));
      }
    }
  });

  /**
   * Wetness changes the frame, never the mask. A watered plot inside a dry
   * field must be a colour change with NO rim around it — the soil is
   * continuous even though the wetness is not — or every lapsing water window
   * would visibly chop the field into fenced-off patches.
   *
   * Asserted as the RELATIONSHIP the layout guarantees: the wet set is the dry
   * set twelve columns right, so every pair differs by exactly 12. That
   * survives a re-measurement in a way `'wet-15'` never could.
   */
  it('keeps the mask when only the wetness differs', () => {
    for (let mask = 0; mask < 16; mask++) {
      expect(soilFrame(mask, 'wet')! - soilFrame(mask, 'dry')!, `mask ${mask}`).toBe(12);
    }
  });

  /**
   * Every frame must be inside the sheet. A number out of range renders as a
   * blank tile rather than throwing, which is exactly the silent failure the
   * measurement discipline exists to prevent.
   */
  it('stays inside TILESET_SOIL', () => {
    const last = TILESET_SOIL.cols * TILESET_SOIL.rows - 1;
    for (const soil of ['dry', 'wet'] as const) {
      for (let mask = 0; mask < 16; mask++) {
        const frame = soilFrame(mask, soil)!;
        expect(frame, `${soil} mask ${mask}`).toBeGreaterThanOrEqual(0);
        expect(frame, `${soil} mask ${mask}`).toBeLessThanOrEqual(last);
      }
    }
  });
});
