/**
 * How big to draw the world (T-18.03).
 *
 * Pure, and separate from the scenes, because this is arithmetic that has been
 * quietly wrong twice. T-15.27 found the camera reserving 56px for a 71px HUD
 * bar, so the top of the farm sat underneath it. The 2026-09-03 audit found the
 * fit demanding the whole 480x352 map — decorative grass fringe included — which
 * made a 1366x768 laptop compute 1.988 and floor to **zoom 1**: the game
 * rendering at native size in the middle of a dark blue screen, missing zoom 2
 * by four pixels of viewport height.
 *
 * Both were one expression inside a scene method that nothing could test. This
 * is that expression, with the two rules it has to obey written down:
 *
 *   - **Integer zoom only.** 16px art resampled by 2.3x is mush regardless of
 *     `pixelArt: true`, so the answer is always a whole number.
 *   - **Reserve the chrome you actually have**, top and bottom. The hotbar
 *     covers the world as opaquely as the bar does, and a zoom that ignores it
 *     puts the bottom rows — the southern path, the barn's door — underneath it.
 */

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Space the HUD occupies at the top and bottom of the viewport, in CSS px. */
export interface Chrome {
  readonly top: number;
  readonly bottom: number;
}

/** The rectangle that MUST be visible, in world pixels. */
export interface FitTarget {
  readonly width: number;
  readonly height: number;
}

/**
 * The largest whole-number zoom that shows all of `target` between the bars.
 *
 * Never returns less than 1: at that point the viewport is smaller than the
 * thing it is drawing and something has to be cropped, but drawing at a
 * fraction of native size would be a blur on top of a crop.
 */
export function fitZoom(
  viewport: Viewport,
  target: FitTarget,
  chrome: Chrome,
  maxZoom: number,
): number {
  const usableHeight = Math.max(1, viewport.height - chrome.top - chrome.bottom);
  const fit = Math.min(viewport.width / target.width, usableHeight / target.height);
  return Math.max(1, Math.min(maxZoom, Math.floor(fit)));
}

/**
 * How far to move the camera's focus off the world's centre, in world pixels.
 *
 * Centring on the viewport's middle would tuck the top of the world under the
 * HUD bar; centring on the middle of the band *between* the bars is what keeps
 * both edges clear. Positive chrome at the top pushes the world down, chrome at
 * the bottom pushes it back up, and equal chrome cancels out.
 *
 * Subtract this from the world-centre Y before handing it to `centerOn`.
 */
export function centreOffset(chrome: Chrome, zoom: number): number {
  return (chrome.top - chrome.bottom) / (2 * zoom);
}
