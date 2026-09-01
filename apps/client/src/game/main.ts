import Phaser from 'phaser';
import '../styles/hud.css';
import { PIXEL_SCALE } from '@tillhaven/shared/config';
import { Preload } from './scenes/Preload.js';
import { Farm } from './scenes/Farm.js';

/**
 * Phaser boots only on /play. The landing and auth pages never load it, which
 * is the whole reason this is a multi-page app rather than a single bundle.
 */

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#052a3a',
  // Nearest-neighbour sampling and no sub-pixel positioning. Without this,
  // every 16px sprite in the game blurs.
  pixelArt: true,
  roundPixels: true,
  scale: {
    // RESIZE makes the canvas track its parent exactly, so there is nothing
    // left to centre. Pairing it with autoCenter applies CSS margins Phaser's
    // input mapping does not account for — the two options contradict.
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  render: {
    antialias: false,
    powerPreference: 'low-power',
  },
  /*
   * `Interior` is deliberately absent (T-11.05). The house's inside is hidden
   * for the MVP (§5.7) — the scene, its furniture endpoints and their tests are
   * all intact, and T-14.04 re-registers it here with new-pack interior art.
   * Leaving it registered would mean a scene nothing can reach, loading art
   * nothing draws.
   */
  scene: [Preload, Farm],
});

// The fallback message is only for the case where this module never ran.
document.getElementById('fallback')?.remove();

// Dev-only handle for poking at scenes and input from the console. Stripped
// from production builds by the `import.meta.env.DEV` guard.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}

/** Integer camera zoom. Fractional zoom on pixel art produces shimmer. */
export const WORLD_ZOOM = PIXEL_SCALE;

export default game;
