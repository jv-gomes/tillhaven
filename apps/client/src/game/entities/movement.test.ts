import { describe, it, expect } from 'vitest';
import {
  step,
  MAX_STEP_MS,
  WALK_SPEED,
  RUN_SPEED,
  NO_INPUT,
  type Bounds,
  type MoveInput,
  type MoveState,
  type World,
} from './movement.js';

const BOUNDS: Bounds = { minX: 0, maxX: 320, minY: 0, maxY: 256 };

const START: MoveState = {
  x: 160,
  y: 128,
  facing: 'down',
  moving: false,
  running: false,
};

function input(partial: Partial<MoveInput>) {
  return { ...NO_INPUT, ...partial };
}

/** Distance a straight walk covers in one second, in whole frames. */
const ONE_SECOND_FRAMES = 1000 / MAX_STEP_MS;

function walk(from: MoveState, held: Parameters<typeof step>[1], frames: number): MoveState {
  let state = from;
  for (let i = 0; i < frames; i++) state = step(state, held, MAX_STEP_MS, BOUNDS);
  return state;
}

describe('step', () => {
  it('covers speed pixels per second walking straight', () => {
    const end = walk(START, input({ right: true }), ONE_SECOND_FRAMES);
    expect(end.x - START.x).toBeCloseTo(WALK_SPEED);
    expect(end.y).toBe(START.y);
  });

  /** The classic: diagonals must not be a free 41% speed boost. */
  it('does not let a diagonal travel further than a straight line', () => {
    const straight = walk(START, input({ right: true }), ONE_SECOND_FRAMES);
    const diagonal = walk(START, input({ right: true, down: true }), ONE_SECOND_FRAMES);

    const straightDistance = straight.x - START.x;
    const diagonalDistance = Math.hypot(diagonal.x - START.x, diagonal.y - START.y);

    expect(diagonalDistance).toBeCloseTo(straightDistance);
  });

  it('cancels opposing keys instead of favouring one', () => {
    const end = step(START, input({ left: true, right: true }), MAX_STEP_MS, BOUNDS);
    expect(end.x).toBe(START.x);
    expect(end.moving).toBe(false);
  });

  it('keeps the last facing when input stops, and stops moving', () => {
    const walking = step(START, input({ right: true }), MAX_STEP_MS, BOUNDS);
    expect(walking.facing).toBe('right');

    const idle = step(walking, NO_INPUT, MAX_STEP_MS, BOUNDS);
    expect(idle.facing).toBe('right');
    expect(idle.moving).toBe(false);
    expect(idle.x).toBe(walking.x);
  });

  /**
   * The new pack draws left and right as separate, explicit frame blocks
   * (`CHAR_DIRECTION_ORDER`) rather than one side row mirrored, so there is
   * no "which way does the art actually point" ambiguity to assert here the
   * way the old pack's `PLAYER_MIRROR_FACES_RIGHT` needed.
   */
  it('picks a distinct facing for left and right', () => {
    expect(step(START, input({ left: true }), MAX_STEP_MS, BOUNDS).facing).toBe('left');
    expect(step(START, input({ right: true }), MAX_STEP_MS, BOUNDS).facing).toBe('right');
  });

  it('uses distinct facings for all four directions', () => {
    const facings = new Set([
      step(START, input({ up: true }), MAX_STEP_MS, BOUNDS).facing,
      step(START, input({ down: true }), MAX_STEP_MS, BOUNDS).facing,
      step(START, input({ left: true }), MAX_STEP_MS, BOUNDS).facing,
      step(START, input({ right: true }), MAX_STEP_MS, BOUNDS).facing,
    ]);
    expect(facings.size).toBe(4);
  });

  it('faces up and down on vertical input, and prefers horizontal on a diagonal', () => {
    expect(step(START, input({ up: true }), MAX_STEP_MS, BOUNDS).facing).toBe('up');
    expect(step(START, input({ down: true }), MAX_STEP_MS, BOUNDS).facing).toBe('down');
    expect(step(START, input({ up: true, left: true }), MAX_STEP_MS, BOUNDS).facing).toBe(
      'left',
    );
  });

  it('clamps to every edge and never leaves the bounds', () => {
    const far = ONE_SECOND_FRAMES * 30;
    expect(walk(START, input({ left: true }), far).x).toBe(BOUNDS.minX);
    expect(walk(START, input({ right: true }), far).x).toBe(BOUNDS.maxX);
    expect(walk(START, input({ up: true }), far).y).toBe(BOUNDS.minY);
    expect(walk(START, input({ down: true }), far).y).toBe(BOUNDS.maxY);
  });

  /**
   * A backgrounded tab reports one enormous delta on its first frame back.
   * Uncapped, that is a teleport across the farm.
   */
  it('caps a huge delta instead of teleporting', () => {
    const woken = step(START, input({ right: true }), 30_000, BOUNDS);
    const capped = step(START, input({ right: true }), MAX_STEP_MS, BOUNDS);
    expect(woken.x).toBe(capped.x);
  });

  it('treats a NaN or negative delta as no time passing', () => {
    for (const delta of [Number.NaN, -16, 0, Number.POSITIVE_INFINITY]) {
      const end = step(START, input({ right: true }), delta, BOUNDS);
      expect(Number.isFinite(end.x), `delta ${delta}`).toBe(true);
    }
    expect(step(START, input({ right: true }), Number.NaN, BOUNDS).x).toBe(START.x);
    expect(step(START, input({ right: true }), -16, BOUNDS).x).toBe(START.x);
  });

  it('returns the same object when nothing changed, so callers can skip work', () => {
    const idle = step(START, NO_INPUT, MAX_STEP_MS, BOUNDS);
    expect(idle).toBe(START);
  });
});

/**
 * Running (T-8.04). Shift is a MODIFIER on the four direction keys, not a
 * fifth direction — which is the whole reason `running` is resolved in here
 * rather than left to the renderer to and-together "shift held" with "moving".
 */
describe('step while running', () => {
  it('covers RUN_SPEED pixels per second, and that is faster than walking', () => {
    const end = walk(START, input({ right: true, run: true }), ONE_SECOND_FRAMES);
    expect(end.x - START.x).toBeCloseTo(RUN_SPEED);
    expect(RUN_SPEED).toBeGreaterThan(WALK_SPEED);
  });

  it('normalizes a running diagonal too — the boost is speed, never distance', () => {
    const straight = walk(START, input({ right: true, run: true }), ONE_SECOND_FRAMES);
    const diagonal = walk(START, input({ right: true, down: true, run: true }), ONE_SECOND_FRAMES);

    const straightDistance = straight.x - START.x;
    const diagonalDistance = Math.hypot(diagonal.x - START.x, diagonal.y - START.y);

    expect(diagonalDistance).toBeCloseTo(straightDistance);
    // And the whole point: a running diagonal still beats a walking straight
    // line, so normalizing has not quietly cancelled the run out.
    expect(diagonalDistance).toBeGreaterThan(WALK_SPEED);
  });

  it('is running only while actually moving', () => {
    expect(step(START, input({ right: true, run: true }), MAX_STEP_MS, BOUNDS).running).toBe(true);
    // Shift alone is a player standing still with a finger on a key.
    expect(step(START, input({ run: true }), MAX_STEP_MS, BOUNDS).running).toBe(false);
    // As is Shift with two opposing keys that cancel.
    expect(
      step(START, input({ left: true, right: true, run: true }), MAX_STEP_MS, BOUNDS).running,
    ).toBe(false);
  });

  it('drops out of running when Shift is released mid-stride, without stopping', () => {
    const running = step(START, input({ right: true, run: true }), MAX_STEP_MS, BOUNDS);
    const walking = step(running, input({ right: true }), MAX_STEP_MS, BOUNDS);

    expect(walking.running).toBe(false);
    expect(walking.moving).toBe(true);
    expect(walking.x - running.x).toBeCloseTo((WALK_SPEED * MAX_STEP_MS) / 1000);
  });

  it('clears running when input stops, so an idle character is never mid-run', () => {
    const running = step(START, input({ up: true, run: true }), MAX_STEP_MS, BOUNDS);
    const stopped = step(running, NO_INPUT, MAX_STEP_MS, BOUNDS);

    expect(stopped.moving).toBe(false);
    expect(stopped.running).toBe(false);
    // Still a new object, because there was something to clear.
    expect(stopped).not.toBe(running);
  });

  it('still clamps to the bounds at run speed', () => {
    const far = ONE_SECOND_FRAMES * 30;
    expect(walk(START, input({ right: true, run: true }), far).x).toBe(BOUNDS.maxX);
    expect(walk(START, input({ up: true, run: true }), far).y).toBe(BOUNDS.minY);
  });

  it('caps a huge delta at run speed too', () => {
    const woken = step(START, input({ right: true, run: true }), 30_000, BOUNDS);
    const capped = step(START, input({ right: true, run: true }), MAX_STEP_MS, BOUNDS);
    expect(woken.x).toBe(capped.x);
  });
});

/* ------------------------------------------------------------------ *
 * Collision (T-15.06)
 * ------------------------------------------------------------------ */

const TILE = 16;
/** The same box shared config defines as `PLAYER_COLLIDER`. */
const COLLIDER = { halfWidth: 5, height: 6 };

/** A world where the named tiles are solid and everything else is open. */
function worldOf(...solid: readonly (readonly [number, number])[]): World {
  const keys = new Set(solid.map(([x, y]) => `${x},${y}`));
  return {
    collider: COLLIDER,
    tileSize: TILE,
    blocked: (x, y) => keys.has(`${x},${y}`),
  };
}

/** Feet position at the centre of a tile, where the character stands. */
function centreOf(tileX: number, tileY: number): MoveState {
  return {
    x: tileX * TILE + TILE / 2,
    y: tileY * TILE + TILE - 1,
    facing: 'down',
    moving: false,
    running: false,
  };
}

function walkInto(from: MoveState, held: MoveInput, world: World, frames: number): MoveState {
  let state = from;
  for (let i = 0; i < frames; i++) state = step(state, held, MAX_STEP_MS, BOUNDS, world);
  return state;
}

describe('step with collision', () => {
  it('is unchanged when no world is supplied', () => {
    const free = step(START, input({ right: true }), MAX_STEP_MS, BOUNDS);
    const alsoFree = step(START, input({ right: true }), MAX_STEP_MS, BOUNDS, worldOf());
    expect(alsoFree.x).toBe(free.x);
  });

  it('stops the player walking head-on into a solid tile', () => {
    const start = centreOf(5, 5);
    const world = worldOf([6, 5]);
    const after = walkInto(start, input({ right: true }), world, 20);

    // Blocked well before the far side of the solid tile.
    expect(after.x).toBeLessThan(6 * TILE);
    // And it did not simply refuse to move at all.
    expect(after.x).toBeGreaterThan(start.x);
  });

  /*
   * The reason the sweep is per-axis and ordered. Resolving both axes against
   * the ORIGINAL position makes this test fail: the character stops dead the
   * moment it touches the wall at an angle, instead of sliding along it.
   */
  it('slides along a wall on a diagonal instead of sticking', () => {
    const start = centreOf(5, 5);
    const world = worldOf([6, 5], [6, 4], [6, 6]); // a wall to the east
    const after = walkInto(start, input({ right: true, up: true }), world, 10);

    expect(after.x).toBeLessThan(6 * TILE); // blocked horizontally
    expect(after.y).toBeLessThan(start.y); // but still moving north
  });

  /*
   * Why the Y sweep tests the ALREADY-RESOLVED x rather than the original.
   *
   * Moving right+down with only the diagonal tile solid: the X move slides the
   * collider into column 6, and the Y move must then be judged from there. Test
   * Y against the ORIGINAL x — still wholly in column 5 — and it sees no
   * blocker, so the character finishes the frame standing inside the solid
   * tile. It is a one-word difference in `resolve` and the symptom is a player
   * embedded in a wall.
   *
   * Asserted on the FIRST frame deliberately. Once the collider is inside a
   * solid tile, `resolve`'s escape hatch turns collision off until it is clear
   * again (so nobody is ever trapped) — which means a longer walk washes the
   * evidence away and the test would pass either way.
   */
  it('never comes to rest inside a solid tile when cutting a diagonal corner', () => {
    const world = worldOf([6, 6]);
    const after = step(centreOf(5, 5), input({ right: true, down: true }), MAX_STEP_MS, BOUNDS, world);

    const left = Math.floor((after.x - COLLIDER.halfWidth) / TILE);
    const right = Math.ceil((after.x + COLLIDER.halfWidth) / TILE) - 1;
    const top = Math.floor((after.y - COLLIDER.height) / TILE);
    const bottom = Math.ceil(after.y / TILE) - 1;

    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        expect(world.blocked(tx, ty), `resting inside solid tile (${tx},${ty})`).toBe(false);
      }
    }
  });

  it('stops in a corner where both axes are blocked', () => {
    const start = centreOf(5, 5);
    const world = worldOf([6, 5], [5, 4], [6, 4]);
    const after = walkInto(start, input({ right: true, up: true }), world, 10);

    expect(after.x).toBeLessThan(6 * TILE);
    expect(after.y).toBeGreaterThan(4 * TILE + TILE - 1);
  });

  it('comes to rest flush against the wall, not a frame-step short of it', () => {
    /*
     * A frame covers up to 8.4px. Refusing a blocked step outright would stop
     * the character up to 8px from the wall AND leave it unable to close the
     * gap, because every later frame proposes the same blocked destination —
     * an invisible wall standing off the real one. `slide` snaps the leading
     * edge to the tile boundary instead.
     */
    const after = walkInto(centreOf(5, 5), input({ right: true }), worldOf([6, 5]), 20);
    expect(after.x + COLLIDER.halfWidth).toBe(6 * TILE);
  });

  it('keeps facing the wall it is walking into', () => {
    // So the faced-tile action still targets what the player is pressed against.
    const after = walkInto(centreOf(5, 5), input({ right: true }), worldOf([6, 5]), 10);
    expect(after.facing).toBe('right');
  });

  it('lets a player already inside a solid tile walk out again', () => {
    // Reachable for real: buy a Deluxe barn while standing where its wall lands.
    // Trapping the player there would need a support ticket to undo.
    const inside = centreOf(5, 5);
    const world = worldOf([5, 5]);
    const after = step(inside, input({ right: true }), MAX_STEP_MS, BOUNDS, world);
    expect(after.x).toBeGreaterThan(inside.x);
  });

  it('fits through a one-tile gap between two solid tiles', () => {
    // A 10px collider through a 16px gap. This is what PLAYER_COLLIDER.halfWidth
    // is sized for; widening it to 8 makes this fail.
    const start = centreOf(5, 6);
    const world = worldOf([4, 5], [6, 5]); // gap at x=5
    const after = walkInto(start, input({ up: true }), world, 20);
    expect(after.y).toBeLessThan(5 * TILE);
  });

  it('cannot tunnel: RUN_SPEED * MAX_STEP_MS < TILE_SIZE', () => {
    /*
     * Collision tests the move's ENDPOINT, not the segment swept to reach it,
     * which is only sound while a single frame cannot cross a whole tile.
     * 84px/s * 0.1s = 8.4px against a 16px tile. Pinned rather than trusted:
     * a future speed increase should fail a test here rather than let players
     * run through the barn.
     */
    expect((RUN_SPEED * MAX_STEP_MS) / 1000).toBeLessThan(TILE);
  });

  it('still respects the map bounds when a world is supplied', () => {
    const far = ONE_SECOND_FRAMES * 30;
    const after = walkInto(START, input({ right: true }), worldOf(), far);
    expect(after.x).toBe(BOUNDS.maxX);
  });
});
