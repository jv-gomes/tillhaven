import { CHAR_ART, CHAR_FRAME, CHAR_ORIGIN } from '@tillhaven/shared/config';

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

/** Is this tile solid? Supplied by the scene's `BlockMap` (T-15.07). */
export type Blocked = (tileX: number, tileY: number) => boolean;

/**
 * The player's collision box, in pixels around their FEET.
 *
 * Mirrors `PLAYER_COLLIDER` in shared config; passed in rather than imported so
 * this module stays free of everything but arithmetic, which is what makes it
 * testable without a canvas, a clock or a manifest.
 */
export interface Collider {
  readonly halfWidth: number;
  readonly height: number;
}

/**
 * What the player can bump into.
 *
 * Optional everywhere it is used: `step()` without a `world` behaves exactly as
 * it did before T-15.06, which is what let all of this module's existing tests
 * carry on unmodified, and what the idle replay falls back to when it gets
 * stuck (T-15.09).
 */
export interface World {
  readonly blocked: Blocked;
  readonly collider: Collider;
  /** Tile size in world pixels. */
  readonly tileSize: number;
}

/**
 * True when the collider, placed with its feet at (x, y), overlaps a solid tile.
 *
 * The tile range is computed by rounding OUTWARDS from the box's edges with an
 * exclusive right/bottom — the same convention `footprintOf` uses in
 * `buildings.ts`. Getting this off by one is the classic source of "I can stand
 * half inside the wall": using an inclusive right edge would test one tile too
 * many and stop the player a pixel short of every surface.
 */
function overlapsBlocked(x: number, y: number, world: World): boolean {
  const { collider, tileSize, blocked } = world;

  const x0 = Math.floor((x - collider.halfWidth) / tileSize);
  const x1 = Math.ceil((x + collider.halfWidth) / tileSize) - 1;
  const y0 = Math.floor((y - collider.height) / tileSize);
  const y1 = Math.ceil(y / tileSize) - 1;

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (blocked(tx, ty)) return true;
    }
  }
  return false;
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
 *
 * `world` is optional (T-15.06). Without it the character is stopped only by
 * the map's edges, exactly as before; with it, solid tiles stop it too.
 */
export function step(
  state: MoveState,
  input: MoveInput,
  deltaMs: number,
  bounds: Bounds,
  world?: World,
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

  const wantX = clamp(state.x + dx * distance, bounds.minX, bounds.maxX);
  const wantY = clamp(state.y + dy * distance, bounds.minY, bounds.maxY);

  const { x, y } = world
    ? resolve(state, wantX, wantY, world)
    : { x: wantX, y: wantY };

  return {
    x,
    y,
    // Horizontal wins a tie: a diagonal walk reads better from the side than
    // from behind.
    //
    // Deliberately taken from the INPUT, not from the distance actually
    // travelled: a player walking into a wall should keep facing the wall, so
    // the faced-tile action still targets it. Deriving facing from movement
    // would make the character look away from whatever it is standing against.
    facing: dx !== 0 ? (dx > 0 ? 'right' : 'left') : dy < 0 ? 'up' : 'down',
    moving: true,
    running: input.run,
  };
}

/**
 * Slide the move along whichever axes are free.
 *
 * **Per-axis, and the order matters.** X is resolved first against the OLD y;
 * Y is then resolved against the ALREADY-RESOLVED x. That asymmetry is the
 * whole trick: walking diagonally into a wall, one axis is refused and the
 * other still moves, so the character slides along the surface instead of
 * stopping dead. Testing the combined destination in one go — or testing both
 * axes against the original position — makes the character stick to every wall
 * it touches at an angle, which feels broken in a way players describe as "the
 * controls are bad".
 *
 * If the collider is ALREADY inside a solid tile, collision is skipped for this
 * frame and the move is allowed. Otherwise a player who ends up inside a wall
 * is stuck forever, and there is a real way to get there: buy a Deluxe barn
 * while standing where its wall is about to appear. Letting them walk out is
 * self-healing; trapping them needs a support ticket.
 */
function resolve(
  state: MoveState,
  wantX: number,
  wantY: number,
  world: World,
): { x: number; y: number } {
  if (overlapsBlocked(state.x, state.y, world)) return { x: wantX, y: wantY };

  const { halfWidth, height } = world.collider;

  const x = slide(state.x, wantX, halfWidth, -halfWidth, world.tileSize, (v) =>
    overlapsBlocked(v, state.y, world),
  );
  const y = slide(state.y, wantY, 0, -height, world.tileSize, (v) =>
    overlapsBlocked(x, v, world),
  );

  return { x, y };
}

/**
 * Move along one axis as far as the blockers allow, stopping flush against them.
 *
 * Refusing the whole step when the destination is blocked is not good enough: a
 * frame covers up to 8.4px, so the character would halt up to 8px short of
 * every wall and — worse — could never close that gap, because every subsequent
 * frame proposes the same blocked destination. It reads as an invisible wall
 * standing off the real one.
 *
 * So when the destination is blocked, snap the LEADING EDGE of the collider to
 * the tile boundary it ran into. `leadPos`/`leadNeg` are the offsets from the
 * position to that edge in each direction — for X they are ±halfWidth; for Y
 * they are 0 going down (the feet are the bottom edge) and -height going up.
 * The snap is accepted only if it is genuinely free and genuinely forward, so a
 * bad case degrades to "did not move" rather than to a teleport.
 */
function slide(
  from: number,
  want: number,
  leadPos: number,
  leadNeg: number,
  tileSize: number,
  overlaps: (value: number) => boolean,
): number {
  if (want === from) return from;
  if (!overlaps(want)) return want;

  const forward = want > from;
  const lead = forward ? leadPos : leadNeg;
  const edge = want + lead;
  const snapped =
    (forward ? Math.floor(edge / tileSize) : Math.ceil(edge / tileSize)) * tileSize - lead;

  const progressed = forward ? snapped > from && snapped <= want : snapped < from && snapped >= want;
  return progressed && !overlaps(snapped) ? snapped : from;
}

/** Guards against a NaN or negative delta as well as a huge one. */
function clampDelta(deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  return Math.min(deltaMs, MAX_STEP_MS);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/* ------------------------------------------------------------------ *
 * Map bounds
 * ------------------------------------------------------------------ */

/** Where origin x = 0.5 puts the sprite's centre column within the frame. */
const CHAR_FRAME_CENTRE = CHAR_FRAME.width * CHAR_ORIGIN.x;

/**
 * Where the player's feet may be, so no drawn pixel leaves the map.
 *
 * Derived from `CHAR_ART`, the measured locomotion silhouette (T-8.03) — not
 * from the frame, which carries blank padding on every side. Clamping by the
 * frame would stop the character a visible tile short of the map edge.
 *
 * **Lives here rather than in `Player.ts` (moved in T-15.09).** It is pure
 * arithmetic over measured constants with no Phaser in it, which is this
 * module's whole remit — and `Player.ts` imports Phaser, so anything that
 * wanted these bounds in a test had to boot a browser environment to get them.
 * `reachability.test.ts` is exactly that caller.
 */
export function playerBounds(mapWidth: number, mapHeight: number): Bounds {
  // With origin (0.5, CHAR_ORIGIN.y) the art spans these many pixels either
  // side of, and above, the feet position.
  const left = CHAR_FRAME_CENTRE - CHAR_ART.left;
  const right = CHAR_ART.right - CHAR_FRAME_CENTRE;
  const above = CHAR_ART.bottom - CHAR_ART.top;

  return {
    minX: left,
    maxX: Math.max(left, mapWidth - right),
    minY: above,
    maxY: Math.max(above, mapHeight),
  };
}
