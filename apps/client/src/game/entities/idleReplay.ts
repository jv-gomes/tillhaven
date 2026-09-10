import { TILE_SIZE } from '@tillhaven/shared/config';
import type { IdleNextAction } from '@tillhaven/shared/types';
import { MAX_STEP_MS, NO_INPUT, WALK_SPEED, type Direction, type MoveInput } from './movement.js';
import type { Position, TilePoint } from './targeting.js';

/**
 * Watching the idle farmer work (T-13.07, CLAUDE.md §5.3).
 *
 * **This is replay, never authority.** The work itself already happened — or
 * rather, it will be *derived* from timestamps the next time the farm is read
 * (§4.2), inside a transaction this file knows nothing about. All that happens
 * here is that a sprite walks to the plot the server said is next and swings a
 * tool at the instant the server said it would. Nothing computed in this module
 * may ever reach a payload; if it did, the client would be deciding what the
 * farmer did.
 *
 * That is what makes the tab-hidden case trivial rather than hard. There is no
 * local simulation to drift: a browser that was asleep for an hour comes back,
 * polls, and is handed a fresh `nextAction` describing a farm the server has
 * been advancing on its own. The character walks to wherever that is. It cannot
 * be "behind", because it was never keeping score.
 *
 * Pure, and Phaser-free, for the same reason `movement.ts` and `targeting.ts`
 * are: the interesting cases are arithmetic — when to set off so as to arrive
 * on time, which side of a plot to stand on, when to stop walking — and those
 * are miserable to reach by driving a canvas.
 */

/**
 * How long before the action the farmer aims to be standing still.
 *
 * A quarter second, so the tool swing starts from a stopped character rather
 * than out of a stride. Small enough that the pause does not read as hesitation
 * and large enough to absorb a frame or two of jitter.
 */
export const ARRIVAL_MARGIN_MS = 250;

/**
 * Feet position for standing ON a tile.
 *
 * The feet are a GROUND LINE — an exclusive bottom edge, which is why
 * `standingTile` reads `y - 1` — so the point that puts the character on tile
 * `ty` is that tile's BOTTOM edge, not its centre.
 *
 * `tileCentre` is the wrong function here and is wrong in a quiet way:
 * `standingTile` reports the same tile for either point, so nothing about
 * targeting or facing would break. The character would simply be drawn half a
 * tile high for the whole replay, hovering over the row it is supposed to be
 * stood on — which, in a module whose entire output is how something looks, is
 * the failure that matters.
 */
export function feetOnTile(tile: TilePoint): Position {
  return {
    x: tile.tileX * TILE_SIZE + TILE_SIZE / 2,
    y: (tile.tileY + 1) * TILE_SIZE,
  };
}

export interface Approach {
  /** The tile to stand on — beside the plot, never on it. */
  readonly tile: TilePoint;
  /** Which way to look once there: at the plot. */
  readonly facing: Direction;
}

/**
 * Which side of the plot to work from.
 *
 * Beside it and facing it, rather than standing on top of it, because that is
 * what the manual loop does: `facedTile` acts on the tile IN FRONT of the
 * character, so a farmer that stood on its plot would be swinging a hoe at its
 * own feet — the one arrangement a player never sees themselves in.
 *
 * The side is whichever the character is already nearest, on the axis it is
 * furthest along: approaching from behind the plot when you are stood in front
 * of it would mean walking around it for no reason. Ties go to the horizontal,
 * matching `step`'s own tie-break — a character seen from the side reads better
 * than one seen from behind.
 *
 * No bounds check. An approach tile off the edge of the map is clamped by
 * `playerBounds` when the character actually walks, so it simply gets as close
 * as it can — and being one tile out on a cosmetic replay is not worth a
 * special case that would need its own fallbacks.
 */
export function approachFor(from: Position, plot: TilePoint): Approach {
  const target = feetOnTile(plot);
  const dx = target.x - from.x;
  const dy = target.y - from.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { tile: { tileX: plot.tileX - 1, tileY: plot.tileY }, facing: 'right' }
      : { tile: { tileX: plot.tileX + 1, tileY: plot.tileY }, facing: 'left' };
  }

  return dy >= 0
    ? { tile: { tileX: plot.tileX, tileY: plot.tileY - 1 }, facing: 'down' }
    : { tile: { tileX: plot.tileX, tileY: plot.tileY + 1 }, facing: 'up' };
}

/**
 * How long the walk takes, in ms — the **octile** distance, not the Euclidean
 * one.
 *
 * The character is driven with the same four booleans a keyboard produces, so
 * it moves diagonally while both axes have ground to cover and straight after
 * that. `step` scales a diagonal by `SQRT1_2` per axis, which means the
 * diagonal leg covers `min(dx, dy) * √2` of real distance at full speed and the
 * straight leg covers the difference. Timing the walk as though it were a
 * straight line would have the farmer set off late every time it had to turn a
 * corner.
 */
export function travelMs(from: Position, to: Position, speed = WALK_SPEED): number {
  if (!(speed > 0)) return 0;

  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const diagonal = Math.min(dx, dy);
  const straight = Math.abs(dx - dy);

  return ((diagonal * Math.SQRT2 + straight) / speed) * 1000;
}

export interface ReplayPlan {
  /**
   * What is being worked, so a changed action is recognised as changed.
   *
   * A plot id for every task but `chop`, which works a tree (T-20.06). Named
   * for the role rather than the kind, because that is all this is used for —
   * comparing one job to the next.
   */
  readonly targetId: string;
  /** The instant the server says the action lands. */
  readonly at: number;
  readonly kind: IdleNextAction['kind'];
  /** Where the farmer stands to do it, in feet-position world pixels. */
  readonly target: Position;
  readonly facing: Direction;
  readonly travelMs: number;
  /**
   * When to set off, on the SERVER clock.
   *
   * Derived backwards from the deadline rather than "leave now and wait": one
   * action lands every `IDLE_ACTION_MS`, so a farmer that walked immediately
   * would spend most of the interval standing on the plot doing nothing, which
   * reads as a stuck character rather than a working one. Setting off late
   * means it is walking when it is between jobs.
   *
   * It can be in the PAST, and that is not an error — a farm with a backlog has
   * actions dated behind `now`, and the honest answer is "set off immediately
   * and get there when you get there" (§4.1: the server is right, the sprite
   * catches up).
   */
  readonly departAt: number;
}

/**
 * The plan for one action, or null when there is nothing to watch.
 *
 * Recomputed only when the ACTION changes, not every frame: `approachFor` reads
 * the character's position, so re-planning continuously would let the chosen
 * side of the plot flip as the character walked past it, and the farmer would
 * orbit its target instead of reaching it.
 */
export function planReplay(
  from: Position,
  action: IdleNextAction | null,
  /** The tile the action happens ON — a plot's cell, or a tree's trunk. */
  targetTile: TilePoint | null,
  speed = WALK_SPEED,
): ReplayPlan | null {
  if (!action || !targetTile) return null;

  const targetId = action.plotId ?? action.treeId;
  // An action naming neither cannot be walked to. Nothing produces one today;
  // returning null beats inventing a destination.
  if (targetId === undefined) return null;

  const approach = approachFor(from, targetTile);
  const target = feetOnTile(approach.tile);
  const travel = travelMs(from, target, speed);

  return {
    targetId,
    at: action.at,
    kind: action.kind,
    target,
    facing: approach.facing,
    travelMs: travel,
    departAt: action.at - travel - ARRIVAL_MARGIN_MS,
  };
}

/**
 * The four booleans to feed the character this frame.
 *
 * `stepPx` is how far one frame of walking actually moves it — passed in rather
 * than assumed, because it is the only honest stopping threshold. A fixed
 * epsilon smaller than a frame's travel makes the character overshoot and jitter
 * around its target forever; one larger makes it stop visibly short. Comparing
 * against the frame's own distance stops it within a fraction of a pixel at any
 * frame rate.
 */
export function replayInput(
  plan: ReplayPlan | null,
  from: Position,
  now: number,
  stepPx: number,
): MoveInput {
  if (!plan || now < plan.departAt) return NO_INPUT;

  const dx = plan.target.x - from.x;
  const dy = plan.target.y - from.y;
  const threshold = Math.max(stepPx, 0);

  return {
    right: dx > threshold,
    left: -dx > threshold,
    down: dy > threshold,
    up: -dy > threshold,
    // The farmer never runs. Running is the player's, and a sprint between
    // plots would make ten-second work look frantic rather than steady.
    run: false,
  };
}

/** How far one frame of walking moves the character — `step`'s own arithmetic. */
export function frameDistance(deltaMs: number, speed = WALK_SPEED): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  return (speed * Math.min(deltaMs, MAX_STEP_MS)) / 1000;
}

/** True once the character is close enough to stand still and work. */
export function hasArrived(plan: ReplayPlan | null, from: Position, stepPx: number): boolean {
  if (!plan) return false;

  const threshold = Math.max(stepPx, 0);
  return (
    Math.abs(plan.target.x - from.x) <= threshold && Math.abs(plan.target.y - from.y) <= threshold
  );
}
