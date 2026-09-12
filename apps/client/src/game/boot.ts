import { prefersReducedMotion } from './motion.js';

/**
 * The boot curtain (U3-5).
 *
 * **The markup is in `play.html`, not here, and that is the whole design.**
 * The curtain has to be on screen before this module is parsed — before
 * Phaser exists, before any stylesheet it imports has been fetched — so it is
 * inline HTML and inline CSS that the browser paints on first pass. This file
 * only drives it.
 *
 * What it replaces was the most templated screen in the product: a
 * `ui-monospace` "TILLHAVEN" and a flat green `Phaser.GameObjects.Rectangle`
 * on a blue field, drawn by `Preload.buildProgressUi()` — which could not
 * appear until Phaser had booted, so the genuine first frame of `/play` was an
 * empty `#052a3a` rectangle for as long as the module graph took.
 *
 * It is also the seam. The landing page ends on the night register and the
 * curtain opens on it, so crossing into the game is a continuation rather than
 * a cut.
 *
 * **Every method is safe to call when the element is gone.** `Preload` runs in
 * a scene that can be restarted, and a boot screen that throws during teardown
 * would take the game with it.
 */

/** How long the dissolve runs. Must match `#boot`'s transition in `play.html`. */
const FADE_MS = 420;

class BootCurtain {
  private root: HTMLElement | null = null;
  private fill: HTMLElement | null = null;
  private label: HTMLElement | null = null;
  private failure: HTMLElement | null = null;
  private dismissed = false;

  private find(): void {
    if (this.root) return;
    this.root = document.getElementById('boot');
    this.fill = document.getElementById('boot-fill');
    this.label = document.getElementById('boot-label');
    this.failure = document.getElementById('boot-fail');
  }

  /** Loader progress, 0 to 1. */
  progress(value: number): void {
    this.find();
    if (this.dismissed) return;

    const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
    if (this.fill) this.fill.style.width = `${percent}%`;
    if (this.label) this.label.textContent = `Waking the farm · ${percent}%`;
  }

  /**
   * Loading finished. Dissolves the curtain and removes it.
   *
   * The asset count goes to the console rather than onto the curtain: it was
   * useful as a "did the manifest resolve" signal and it is not a thing to
   * show a player one frame before the farm appears.
   */
  done(assetCount: number): void {
    this.find();
    if (this.dismissed) return;
    this.dismissed = true;

    console.info(`[tillhaven] ${assetCount} assets loaded`);

    const root = this.root;
    if (!root) return;

    if (prefersReducedMotion()) {
      root.remove();
      return;
    }

    root.classList.add('is-done');
    window.setTimeout(() => root.remove(), FADE_MS);
  }

  /**
   * Something did not load. **The curtain stays up.**
   *
   * A player who cannot load the game needs a way back more than they need a
   * diagnostic, so the failure copy carries a link to the landing page and the
   * missing keys are named underneath it. The bar and the progress label hide
   * themselves in CSS once this is unhidden — a progress bar frozen at 94% next
   * to an error message is a worse message than either alone.
   */
  fail(detail: string): void {
    this.find();
    this.dismissed = true;

    if (this.failure) {
      this.failure.hidden = false;
      const note = document.createElement('span');
      note.textContent = ` ${detail}`;
      this.failure.append(note);
    }
    if (this.label) this.label.textContent = detail;

    console.error(`[tillhaven] boot failed: ${detail}`);
  }
}

export const boot = new BootCurtain();
