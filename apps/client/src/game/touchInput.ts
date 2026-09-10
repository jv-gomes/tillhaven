import type { MoveInput } from './entities/movement.js';
import { NO_INPUT } from './entities/movement.js';

/**
 * The touch input model (T-28.01, D-19).
 *
 * **A virtual stick, not tap-to-move, and the reason is that a stick changes
 * nothing else.** `Player.readInput` returns five booleans — up, down, left,
 * right, run — and every rule downstream is built on them: `movement.step`
 * resolves per axis from those, facing derives from the direction walked, and
 * `targeting.ts` aims from facing at the tile in front of the feet. A stick
 * produces exactly those five booleans, so a finger and a keyboard arrive at
 * the same place and §5.1's *"actions happen on the tile the character faces"*
 * holds without a single new rule.
 *
 * Tap-to-move cannot say that. It would need a path (D-8 chose deliberately
 * NOT to have pathfinding), and it would have to invent an answer for what the
 * character faces when it arrives — the tapped tile? the last step's
 * direction? — which is a second, quietly different targeting model for touch
 * users only. Two targeting models is how a game gets a bug that only exists
 * on phones.
 *
 * This module is deliberately pure: vectors in, `MoveInput` out. The DOM half
 * lives in `touchControls.ts`, so the interesting decisions — the dead zone,
 * the diagonal band, when a push counts as a run — are testable without a
 * touchscreen.
 */

/**
 * Fraction of the stick's radius that reads as "not moving".
 *
 * A thumb resting on a stick is never exactly centred, and without a dead zone
 * the character creeps. 0.3 is large by gamepad standards because this is a
 * thumb on glass with no spring to return it, not a sprung analogue stick.
 */
export const STICK_DEAD_ZONE = 0.3;

/**
 * Fraction of the radius past which the push counts as a run.
 *
 * The keyboard's run is a separate key (Shift). A stick has no spare finger, so
 * the distance IS the modifier — push a little to walk, push to the edge to
 * run, which is the convention every twin-stick game already teaches.
 */
export const STICK_RUN_ZONE = 0.85;

/**
 * Half-width of the band, in degrees, where a push counts as purely one axis.
 *
 * Without it a stick is diagonal almost always, because holding a thumb at
 * exactly 0° is not a thing hands do — and a character permanently walking
 * diagonally can never face a tile squarely, which is precisely what the action
 * key needs. 30° each side gives four 60° cardinal bands and four 30° diagonal
 * ones: diagonals stay reachable, but you have to mean it.
 */
export const CARDINAL_BAND_DEG = 30;

export interface StickVector {
  /** Right-positive, in units of the stick's radius. Not clamped by the caller. */
  readonly x: number;
  /** DOWN-positive, matching screen coordinates rather than maths convention. */
  readonly y: number;
}

/**
 * Turns a stick displacement into the same five booleans the keyboard produces.
 *
 * The vector is clamped to the unit circle first, so a drag that leaves the
 * stick's circle reads as "hard over" rather than as a larger number — which is
 * what makes `STICK_RUN_ZONE` a position on the stick rather than a function of
 * how far the finger wandered.
 */
export function stickToInput(v: StickVector): MoveInput {
  const magnitude = Math.hypot(v.x, v.y);
  if (magnitude < STICK_DEAD_ZONE) return NO_INPUT;

  const clamped = Math.min(1, magnitude);
  const run = clamped >= STICK_RUN_ZONE;

  // Screen-space angle, 0° = right, measured toward DOWN so it matches `y`.
  const deg = (Math.atan2(v.y, v.x) * 180) / Math.PI;

  /** Is the push within the cardinal band centred on `centre` degrees? */
  const near = (centre: number): boolean => {
    let delta = Math.abs(deg - centre) % 360;
    if (delta > 180) delta = 360 - delta;
    return delta <= CARDINAL_BAND_DEG;
  };

  if (near(0)) return { up: false, down: false, left: false, right: true, run };
  if (near(180)) return { up: false, down: false, left: true, right: false, run };
  if (near(90)) return { up: false, down: true, left: false, right: false, run };
  if (near(-90)) return { up: true, down: false, left: false, right: false, run };

  // Outside every cardinal band, so it is a diagonal: take the sign of each
  // axis. Both are non-zero here by construction.
  return {
    up: v.y < 0,
    down: v.y > 0,
    left: v.x < 0,
    right: v.x > 0,
    run,
  };
}

/**
 * Merges the stick with the keyboard.
 *
 * OR rather than "whichever moved last": a tablet with a keyboard attached is a
 * real device, and a rule that made one input win would make the other
 * intermittently dead. `run` ORs too, so Shift still works while a thumb is
 * mid-stick.
 */
export function mergeInput(keyboard: MoveInput, touch: MoveInput): MoveInput {
  return {
    up: keyboard.up || touch.up,
    down: keyboard.down || touch.down,
    left: keyboard.left || touch.left,
    right: keyboard.right || touch.right,
    run: keyboard.run || touch.run,
  };
}
