import { describe, expect, it } from 'vitest';
import {
  CARDINAL_BAND_DEG,
  STICK_DEAD_ZONE,
  STICK_RUN_ZONE,
  mergeInput,
  stickToInput,
} from './touchInput.js';
import { NO_INPUT, type MoveInput } from './entities/movement.js';

/**
 * T-28.01, D-19 — the stick produces keyboard input, and nothing else changes.
 *
 * The whole argument for a virtual stick over tap-to-move is that it reuses the
 * existing pipeline exactly: five booleans in the same shape `bindKeys`
 * produces, so `movement.step`, facing, and `targeting.ts` are untouched. These
 * tests are therefore about the *conversion* — a thumb on glass is analogue and
 * noisy, and turning that into four crisp booleans is where the judgement is.
 */

/** A vector at `deg` (0 = right, 90 = down) and `magnitude` of the radius. */
function at(deg: number, magnitude = 0.6) {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.cos(rad) * magnitude, y: Math.sin(rad) * magnitude };
}

const dirs = (i: MoveInput) =>
  (['up', 'down', 'left', 'right'] as const).filter((k) => i[k]);

describe('the dead zone', () => {
  it('reads a resting thumb as no input at all', () => {
    expect(stickToInput({ x: 0, y: 0 })).toEqual(NO_INPUT);
    expect(stickToInput(at(45, STICK_DEAD_ZONE - 0.01))).toEqual(NO_INPUT);
  });

  /**
   * The failure this prevents is not a wrong direction, it is a character that
   * will not stand still — and on a touch device the thumb never fully leaves
   * the glass between movements.
   */
  it('starts moving once the push clears the zone', () => {
    expect(dirs(stickToInput(at(0, STICK_DEAD_ZONE + 0.01)))).toEqual(['right']);
  });
});

describe('direction', () => {
  it.each([
    [0, 'right'],
    [90, 'down'],
    [180, 'left'],
    [-90, 'up'],
  ])('reads %i° as %s', (deg, expected) => {
    expect(dirs(stickToInput(at(deg)))).toEqual([expected]);
  });

  /**
   * **The cardinal band is the load-bearing idea.** A thumb cannot hold 0°, and
   * a character permanently walking diagonally can never square up to a tile —
   * which is exactly what the action key needs, since §5.1 acts on the tile the
   * character FACES. Without the band, touch users would find the hoe hitting
   * the wrong plot and no obvious reason why.
   */
  it('treats a slightly-off push as purely cardinal', () => {
    for (const off of [-CARDINAL_BAND_DEG + 1, -10, 0, 10, CARDINAL_BAND_DEG - 1]) {
      expect(dirs(stickToInput(at(off))), `${off}° off right`).toEqual(['right']);
    }
  });

  it('still gives a real diagonal when one is meant', () => {
    expect(dirs(stickToInput(at(45))).sort()).toEqual(['down', 'right']);
    expect(dirs(stickToInput(at(-135))).sort()).toEqual(['left', 'up']);
  });

  /** Just past the band is a diagonal — the boundary is where it is claimed. */
  it('switches to diagonal immediately outside the band', () => {
    expect(dirs(stickToInput(at(CARDINAL_BAND_DEG + 1))).sort()).toEqual(['down', 'right']);
  });

  it('never reports two opposite directions at once', () => {
    for (let deg = -180; deg < 180; deg += 7) {
      const input = stickToInput(at(deg));
      expect(input.up && input.down, `${deg}°`).toBe(false);
      expect(input.left && input.right, `${deg}°`).toBe(false);
    }
  });
});

describe('running', () => {
  /**
   * A stick has no spare finger for Shift, so distance is the modifier. This
   * is the one place touch input is not a literal copy of the keyboard, and it
   * is a convention players already know from twin-stick games.
   */
  it('walks on a small push and runs on a hard one', () => {
    expect(stickToInput(at(0, 0.5)).run).toBe(false);
    expect(stickToInput(at(0, STICK_RUN_ZONE + 0.01)).run).toBe(true);
  });

  /**
   * A drag beyond the stick's circle is still just "hard over". Without the
   * clamp, `run` would depend on how far the finger wandered off the control,
   * which is not a thing the player can see or aim for.
   */
  it('clamps a drag past the edge rather than scaling with it', () => {
    expect(stickToInput({ x: 5, y: 0 }).run).toBe(true);
    expect(dirs(stickToInput({ x: 5, y: 0 }))).toEqual(['right']);
  });
});

describe('merging with the keyboard', () => {
  const only = (...on: (keyof MoveInput)[]): MoveInput => ({
    ...NO_INPUT,
    ...Object.fromEntries(on.map((k) => [k, true])),
  });

  /**
   * OR, not last-wins. A tablet with a keyboard is a real device, and a rule
   * where one input silently disables the other would make both feel broken.
   */
  it('lets either input move the character', () => {
    expect(mergeInput(only('up'), NO_INPUT).up).toBe(true);
    expect(mergeInput(NO_INPUT, only('up')).up).toBe(true);
  });

  it('lets Shift run a stick-driven walk', () => {
    expect(mergeInput(only('run'), only('right'))).toEqual(only('run', 'right'));
  });

  it('is a no-op when nothing is pressed', () => {
    expect(mergeInput(NO_INPUT, NO_INPUT)).toEqual(NO_INPUT);
  });
});
