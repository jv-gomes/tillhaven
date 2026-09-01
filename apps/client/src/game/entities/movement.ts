/**
 * The player's movement maths, with no Phaser in it.
 *
 * Split out so it can be unit-tested without a canvas, a clock or a game loop
 * (ROADMAP "Testing shape"): `step()` is pure, and `deltaMs` is a parameter
 * rather than something read from a timer.
 *
 * Nothing here reaches the server. Movement is cosmetic and gates no action
 * (CLAUDE.md §5.1) — that is precisely why it can live entirely on the client.
 */

/**
 * Which of the character strip's 4 direction blocks to draw — see
 * `CHAR_DIRECTION_ORDER` in the shared config. Unlike the old pack's 3-row
 * (down/up/side) sheet with a mirrored side row (T-7.07 retired that
 * scheme), the new pack draws all four directions explicitly, so there is
 * no separate "which way is mirrored" flag to track any more.
 */
export type Direction = 'down' | 'up' | 'left' | 'right';

/** World pixels per second. Three 16px tiles a second across a 20-tile farm. */
export const WALK_SPEED = 48;

/**
 * World pixels per second while Shift is held — 1.75× walk, 5.25 tiles a
 * second (T-8.04).
 *
 * Crossing the farm is the thing running is for, so it has to be plainly
 * faster than walking; doubling it made the character overshoot the tile it
 * was aiming at, which matters once T-8.05 makes the faced tile the thing you
 * act on.
 */
export const RUN_SPEED = 84;

/**
 * Longest frame `step` will integrate over.
 *
 * A backgrounded tab hands back a delta of whole seconds when it wakes, and
 * `position += speed * delta` would teleport the character across the farm on
 * the first frame back. Capping it means a long pause costs a little travel
 * rather than a jump.
 */
export const MAX_STEP_MS = 100;

export interface MoveInput {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
  /** Shift. A modifier on the other four, never a direction of its own. */
  readonly run: boolean;
}

export const NO_INPUT: MoveInput = {
  up: false,
  down: false,
  left: false,
  right: false,
  run: false,
};

/** Limits on the player's FEET position, in world pixels. */
export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface MoveState {
  /** Feet position, world pixels. */
  readonly x: number;
  readonly y: number;
  /** Which direction block of the character strip to draw. */
  readonly facing: Direction;
  readonly moving: boolean;
  /**
   * Moving AND Shift held — which animation to draw, not merely which key is
   * down. Shift alone standing still is not running, so this is resolved here
   * rather than left to the renderer to combine two flags and get it wrong.
   */
  readonly running: boolean;
}

/**
 * Advance the player by one frame.
 *
 * Facing is only updated while there is input, so releasing a key leaves the
 * character looking where it was walking instead of snapping back to face the
 * camera.
 *
 * Speed comes from `input.run` rather than from a parameter. There WAS a
 * `speed` argument (T-8.04 removed it): nothing ever passed one, and keeping
 * both would leave two answers to "how fast is this character" with no rule
 * about which wins.
 */
export function step(
  state: MoveState,
  input: MoveInput,
  deltaMs: number,
  bounds: Bounds,
): MoveState {
  // Opposing keys cancel, so holding left+right stands still rather than
  // picking whichever was polled last.
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);

  if (dx === 0 && dy === 0) {
    return state.moving || state.running
      ? { ...state, moving: false, running: false }
      : state;
  }

  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  // Diagonals would otherwise cover sqrt(2) times the distance per second.
  const scale = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
  const distance = speed * (clampDelta(deltaMs) / 1000) * scale;

  return {
    x: clamp(state.x + dx * distance, bounds.minX, bounds.maxX),
    y: clamp(state.y + dy * distance, bounds.minY, bounds.maxY),
    // Horizontal wins a tie: a diagonal walk reads better from the side than
    // from behind.
    facing: dx !== 0 ? (dx > 0 ? 'right' : 'left') : dy < 0 ? 'up' : 'down',
    moving: true,
    running: input.run,
  };
}

/** Guards against a NaN or negative delta as well as a huge one. */
function clampDelta(deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  return Math.min(deltaMs, MAX_STEP_MS);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
