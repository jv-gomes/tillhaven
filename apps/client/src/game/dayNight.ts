/*
 * **Type-only.** A value import of Phaser touches `window` at module load, and
 * the client's tests run in node — importing it here would make the pure
 * arithmetic below untestable to buy nothing, since everything this file does
 * with Phaser goes through the `Scene` it is handed.
 */
import type { GameObjects, Scene } from 'phaser';
import { darknessAt, timeOfDayAt, type TimeOfDay } from '@tillhaven/shared/config';
import { DEPTH } from './depth.js';
import { prefersReducedMotion } from './motion.js';

/**
 * The night tint (MVP re-scope).
 *
 * **Cosmetic, by decision.** Crops grow, actions work and sleeping is available
 * at every hour; this changes how the farm looks and nothing else. That is why
 * it lives entirely on the client and asks the server nothing — `timeOfDayAt`
 * is a pure function of the wall clock, so both sides would compute the same
 * answer if the server ever needed one.
 *
 * **One rectangle, not a light system.** A blue-black overlay at a depth above
 * every sprite and below the HUD text. Per-object tinting would look better and
 * would mean touching every sprite the game creates, on a feature whose whole
 * point is that it changes nothing.
 */

/**
 * The colour night is made of, and how dark it is allowed to get.
 *
 * `#052a3a` is the deep blue the pack's own art carries (the same one
 * `base.css` names `--night`), so the dark end of the cycle stays inside the
 * game's world rather than fading to grey.
 *
 * **The cap is the important number.** At full opacity a tint is a black
 * screen; at 0.55 the farm is plainly night-time and every crop, animal and
 * plot outline is still identifiable. A player who logs in at the wrong moment
 * must still be able to play — the cycle is atmosphere, not a lockout.
 */
export const NIGHT_COLOUR = 0x052a3a;
export const NIGHT_MAX_ALPHA = 0.55;

/** The tint at a moment in the cycle, 0 (daylight) to `NIGHT_MAX_ALPHA`. */
export function nightAlphaAt(now: number): number {
  return darknessAt(timeOfDayAt(now).phase) * NIGHT_MAX_ALPHA;
}

/**
 * How fast the tint may move toward its target, per second of real time.
 *
 * **This is not the cycle's speed.** The cycle changes the tint by about 0.003
 * a second, far below anything a person reads as movement. This limit exists
 * for the two moments where the target JUMPS: entering a scene, and coming
 * back to a tab that was in the background while twenty minutes passed. Without
 * it the farm flashes from noon to midnight in one frame.
 *
 * Ignored entirely under `prefers-reduced-motion`, where the tint snaps
 * instead. That is the right way round: the setting asks for less movement, and
 * a slow fade across the whole screen is more movement than an instant change,
 * not less.
 */
export const NIGHT_FADE_PER_SECOND = 0.35;

/**
 * Moves `current` toward `target` by at most one frame's worth of fade.
 *
 * Pure, and separated from the scene for the usual reason: the interesting
 * behaviour is arithmetic, and the tests have no Phaser.
 */
export function approachAlpha(
  current: number,
  target: number,
  deltaMs: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return target;
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return current;

  const step = NIGHT_FADE_PER_SECOND * (deltaMs / 1000);
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}

/**
 * The tint overlay for one scene.
 *
 * Fixed to the camera (`setScrollFactor(0)`) and resized from `update`, so it
 * covers the viewport whatever the zoom and however the window is resized —
 * the same lesson the water backdrop learned, where sizing from `fitCamera`
 * read a `worldView` Phaser had not recomputed yet.
 */
export class NightOverlay {
  private readonly rect: GameObjects.Rectangle;
  private alpha: number;

  constructor(
    private readonly scene: Scene,
    now: number = Date.now(),
  ) {
    this.alpha = nightAlphaAt(now);
    this.rect = scene.add
      .rectangle(0, 0, 10, 10, NIGHT_COLOUR, this.alpha)
      .setOrigin(0, 0)
      .setDepth(DEPTH.night)
      // The tint is scenery: clicking through it must reach the farm.
      .setActive(false);
    this.rect.disableInteractive();
    this.resize();
  }

  /** Call from the scene's `update`. */
  step(deltaMs: number, now: number = Date.now()): void {
    this.alpha = approachAlpha(this.alpha, nightAlphaAt(now), deltaMs, prefersReducedMotion());
    this.rect.setFillStyle(NIGHT_COLOUR, this.alpha);
    this.resize();
  }

  /** What time the overlay currently depicts. For the HUD clock. */
  time(now: number = Date.now()): TimeOfDay {
    return timeOfDayAt(now);
  }

  destroy(): void {
    this.rect.destroy();
  }

  /**
   * Covers exactly what the camera can see.
   *
   * **`worldView`, not `scrollFactor(0)` and a viewport size.** The first
   * version fixed the rectangle to the camera and sized it
   * `camera.width / camera.zoom`; on screen it covered about a quadrant, with
   * the field beyond it still at noon. A scroll-factor-0 object still lives in
   * world units and is still placed by the camera's centre, so "the viewport
   * divided by the zoom" is not where it lands. `worldView` is the rectangle
   * the camera is actually looking at, in the units the object is measured in —
   * which is why the water backdrop uses it too, having learned the same
   * lesson from the other direction.
   *
   * The margin is for the frame after a resize, when `worldView` is one frame
   * behind the window: a tint an inch short of the edge is a bright stripe
   * down the side of the screen.
   */
  private resize(): void {
    const view = this.scene.cameras.main.worldView;
    const margin = 64;

    this.rect.setPosition(view.x - margin, view.y - margin);
    this.rect.setSize(view.width + margin * 2, view.height + margin * 2);
  }
}
