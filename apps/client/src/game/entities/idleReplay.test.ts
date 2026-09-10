import { describe, it, expect } from 'vitest';
import { TILE_SIZE } from '@tillhaven/shared/config';
import { MAX_STEP_MS, NO_INPUT, WALK_SPEED, step, type MoveState } from './movement.js';
import { standingTile, tileCentre } from './targeting.js';
import {
  ARRIVAL_MARGIN_MS,
  approachFor,
  feetOnTile,
  frameDistance,
  hasArrived,
  planReplay,
  replayInput,
  travelMs,
} from './idleReplay.js';

/**
 * The idle farmer's walk (T-13.07).
 *
 * All of this is cosmetic — the work is the server's, derived from timestamps
 * whether or not anyone is watching (§4.2, §5.3) — so nothing here defends an
 * outcome. What it defends is that the animation stays *honest*: the character
 * arrives before the instant the server named rather than after it, it stands
 * beside the plot rather than on it, and it comes to a stop instead of
 * vibrating around its target forever.
 *
 * The last one is the reason `replayInput` takes the frame's own travel
 * distance rather than a fixed epsilon, and it is asserted by actually running
 * frames through `step` — the real mover — rather than by trusting the
 * arithmetic in isolation.
 */

const ORIGIN = { x: 0, y: 0 };
const BOUNDS = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const T0 = 1_700_000_000_000;

const action = (over: Partial<{ plotId: string; at: number; kind: 'till' }> = {}) => ({
  // An `IdleNextAction`, which still names a plot — it is `ReplayPlan` that
  // became target-agnostic in T-20.06, not the server's action.
  plotId: 'p1',
  at: T0 + 10_000,
  kind: 'till' as const,
  ...over,
});

describe('feetOnTile', () => {
  it('puts the character on the tile it names', () => {
    for (const tile of [
      { tileX: 0, tileY: 0 },
      { tileX: 3, tileY: 7 },
      { tileX: 12, tileY: 1 },
    ]) {
      expect(standingTile(feetOnTile(tile))).toEqual(tile);
    }
  });

  /**
   * The round-trip above is necessary and NOT sufficient, which is worth
   * saying out loud: `tileCentre` satisfies it too — both points land inside
   * the tile, so `standingTile` cannot tell them apart. The difference is
   * eight pixels of drawing, and in a module whose only output is how
   * something looks, eight pixels is the whole bug. So the ground line is
   * pinned exactly.
   */
  it('stands on the tile\'s ground line, not floating in its middle', () => {
    const tile = { tileX: 3, tileY: 7 };

    expect(feetOnTile(tile)).toEqual({
      x: 3 * TILE_SIZE + TILE_SIZE / 2,
      y: 8 * TILE_SIZE,
    });
    // Half a tile above the answer — where the character would hover.
    expect(tileCentre(tile).y).toBe(feetOnTile(tile).y - TILE_SIZE / 2);
  });
});

describe('approachFor', () => {
  const PLOT = { tileX: 5, tileY: 5 };

  it('stands beside the plot, never on it', () => {
    for (const from of [
      { x: 0, y: 0 },
      { x: 200, y: 200 },
      { x: 88, y: 0 },
      { x: 0, y: 96 },
    ]) {
      const { tile } = approachFor(from, PLOT);
      expect(tile).not.toEqual(PLOT);
      // Exactly one tile away, on exactly one axis.
      const steps = Math.abs(tile.tileX - PLOT.tileX) + Math.abs(tile.tileY - PLOT.tileY);
      expect(steps).toBe(1);
    }
  });

  it('faces the plot from whichever side it stands on', () => {
    const cases = [
      { from: { x: 0, y: 88 }, side: { tileX: 4, tileY: 5 }, facing: 'right' },
      { from: { x: 200, y: 88 }, side: { tileX: 6, tileY: 5 }, facing: 'left' },
      { from: { x: 88, y: 0 }, side: { tileX: 5, tileY: 4 }, facing: 'down' },
      { from: { x: 88, y: 200 }, side: { tileX: 5, tileY: 6 }, facing: 'up' },
    ] as const;

    for (const { from, side, facing } of cases) {
      expect(approachFor(from, PLOT)).toEqual({ tile: side, facing });
    }
  });

  /**
   * Approaching from the far side would mean walking around a plot the farmer
   * is already stood next to — half the interval spent on a detour nobody asked
   * for.
   */
  it('never walks past the plot to work it from the other side', () => {
    const target = feetOnTile(PLOT);

    for (const from of [
      { x: target.x - 40, y: target.y },
      { x: target.x + 40, y: target.y },
      { x: target.x, y: target.y - 40 },
      { x: target.x, y: target.y + 40 },
    ]) {
      const { tile } = approachFor(from, PLOT);
      const side = feetOnTile(tile);
      // The chosen side is nearer to where the character already is than the
      // opposite side would be.
      expect(Math.hypot(side.x - from.x, side.y - from.y)).toBeLessThan(
        Math.hypot(target.x - from.x, target.y - from.y) + TILE_SIZE,
      );
    }
  });

  it('is total: a character stood on the plot still gets a side', () => {
    const { tile, facing } = approachFor(feetOnTile(PLOT), PLOT);

    expect(tile).toEqual({ tileX: 4, tileY: 5 });
    expect(facing).toBe('right');
  });
});

describe('travelMs', () => {
  it('times a straight walk at the walking speed', () => {
    // 48px at 48px/s.
    expect(travelMs(ORIGIN, { x: 48, y: 0 })).toBeCloseTo(1000, 5);
    expect(travelMs(ORIGIN, { x: 0, y: -48 })).toBeCloseTo(1000, 5);
  });

  /**
   * A pure diagonal covers `√2 × leg` of real ground, and `step` scales each
   * axis by `SQRT1_2` so it does that at full speed. Timing it as a straight
   * line would send the farmer off late every time it had to turn a corner.
   */
  it('times a diagonal by the distance actually walked', () => {
    expect(travelMs(ORIGIN, { x: 48, y: 48 })).toBeCloseTo(1000 * Math.SQRT2, 5);
  });

  it('times a dog-leg as its diagonal plus its straight', () => {
    // 48 across, 96 down: 48 of it diagonal, 48 of it straight down.
    expect(travelMs(ORIGIN, { x: 48, y: 96 })).toBeCloseTo(1000 * (Math.SQRT2 + 1), 5);
  });

  it('agrees with what the character actually does', () => {
    const target = { x: 60, y: 100 };
    const predicted = travelMs(ORIGIN, target);

    // Walk it for real, one 16ms frame at a time, steering the same way.
    let state: MoveState = { ...ORIGIN, facing: 'down', moving: false, running: false };
    let elapsed = 0;
    for (let i = 0; i < 10_000; i++) {
      const input = replayInput(
        { targetId: 'p', at: 0, kind: 'till', target, facing: 'down', travelMs: 0, departAt: 0 },
        state,
        1,
        frameDistance(16),
      );
      if (input === NO_INPUT || (!input.up && !input.down && !input.left && !input.right)) break;
      state = step(state, input, 16, BOUNDS);
      elapsed += 16;
    }

    expect(Math.hypot(state.x - target.x, state.y - target.y)).toBeLessThan(1);
    // Within one frame of the prediction — the walk is quantised into frames,
    // so exact equality is not a thing to ask for.
    expect(Math.abs(elapsed - predicted)).toBeLessThan(2 * 16);
  });

  it('is zero rather than infinite for a speed that cannot move', () => {
    expect(travelMs(ORIGIN, { x: 100, y: 0 }, 0)).toBe(0);
  });
});

describe('planReplay', () => {
  it('is null when the farmer has nothing next', () => {
    expect(planReplay(ORIGIN, null, { tileX: 1, tileY: 1 })).toBeNull();
  });

  it('is null when the named plot is not on the map the client is holding', () => {
    expect(planReplay(ORIGIN, action(), null)).toBeNull();
  });

  /**
   * The departure is derived BACKWARDS from the deadline. One action lands
   * every `IDLE_ACTION_MS`, so a farmer that set off immediately would spend
   * most of the interval standing on the plot, which reads as a stuck
   * character rather than a working one.
   */
  it('sets off late enough to arrive just before the action', () => {
    const plan = planReplay(ORIGIN, action(), { tileX: 5, tileY: 5 })!;

    expect(plan.departAt).toBe(plan.at - plan.travelMs - ARRIVAL_MARGIN_MS);
    expect(plan.departAt + plan.travelMs).toBeLessThan(plan.at);
  });

  /**
   * A backlogged farm has actions dated behind `now` (T-13.05 reports them
   * honestly rather than pretending they are due). The plan says "set off
   * immediately" rather than refusing.
   */
  it('gives a past departure for an action that is already overdue', () => {
    const plan = planReplay(ORIGIN, action({ at: T0 - 60_000 }), { tileX: 5, tileY: 5 })!;

    expect(plan.departAt).toBeLessThan(T0);
    expect(replayInput(plan, ORIGIN, T0, frameDistance(16))).not.toEqual(NO_INPUT);
  });

  it('carries the verb through, so the right tool is swung', () => {
    expect(planReplay(ORIGIN, action({ kind: 'till' }), { tileX: 1, tileY: 1 })!.kind).toBe('till');
  });
});

describe('replayInput', () => {
  const plan = planReplay(ORIGIN, action(), { tileX: 5, tileY: 5 })!;

  it('stands still until it is time to leave', () => {
    expect(replayInput(plan, ORIGIN, plan.departAt - 1, frameDistance(16))).toEqual(NO_INPUT);
  });

  it('walks once it is', () => {
    const input = replayInput(plan, ORIGIN, plan.departAt, frameDistance(16));

    expect(input.right || input.left || input.up || input.down).toBe(true);
  });

  it('never runs — running is the player\'s', () => {
    expect(replayInput(plan, ORIGIN, plan.at, frameDistance(16)).run).toBe(false);
  });

  it('stands still with no plan at all', () => {
    expect(replayInput(null, ORIGIN, T0, frameDistance(16))).toEqual(NO_INPUT);
  });

  /**
   * The whole reason the threshold is the frame's own travel distance.
   *
   * With a fixed epsilon smaller than a frame's step, the character overshoots,
   * is told to come back, overshoots again — and jitters on the spot forever.
   * Run enough frames that any oscillation would show, then check it is both
   * stopped and actually there.
   */
  it('comes to a stop instead of oscillating around the target', () => {
    let state: MoveState = { ...ORIGIN, facing: 'down', moving: false, running: false };

    for (let i = 0; i < 2_000; i++) {
      state = step(state, replayInput(plan, state, plan.at, frameDistance(16)), 16, BOUNDS);
    }

    expect(Math.hypot(state.x - plan.target.x, state.y - plan.target.y)).toBeLessThan(1);
    expect(state.moving).toBe(false);
    expect(hasArrived(plan, state, frameDistance(16))).toBe(true);
  });

  it('holds still at a target it is already standing on', () => {
    expect(replayInput(plan, plan.target, plan.at, frameDistance(16))).toEqual(NO_INPUT);
  });
});

describe('frameDistance', () => {
  it('is what one frame of walking covers', () => {
    expect(frameDistance(1000)).toBeCloseTo(WALK_SPEED * (MAX_STEP_MS / 1000), 10);
    expect(frameDistance(16)).toBeCloseTo((WALK_SPEED * 16) / 1000, 10);
  });

  /**
   * The same cap `step` applies. A backgrounded tab hands back a delta of whole
   * seconds; a threshold built from that would be wider than the farm, and the
   * character would decide it had arrived from anywhere.
   */
  it('is capped exactly where step caps its own delta', () => {
    expect(frameDistance(60_000)).toBe(frameDistance(MAX_STEP_MS));
  });

  it('is zero for a delta that is not a duration', () => {
    for (const delta of [0, -5, Number.NaN]) expect(frameDistance(delta)).toBe(0);
  });
});
