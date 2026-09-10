import Phaser from 'phaser';
// Order matters: `ui.css` owns chrome (frames, plates, type) and `hud.css` owns
// layout. Equal specificity means the later file wins any overlap, so a panel
// that needs a special case says so in `hud.css` and gets it.
import '../styles/ui.css';
import '../styles/hud.css';
import { PIXEL_SCALE } from '@tillhaven/shared/config';
import { Preload } from './scenes/Preload.js';
import { Farm } from './scenes/Farm.js';
import { Interior } from './scenes/Interior.js';

/**
 * Phaser boots only on /play. The landing and auth pages never load it, which
 * is the whole reason this is a multi-page app rather than a single bundle.
 */

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  /*
   * The water's own colour, so nothing can ever show as void.
   *
   * The animated water backdrop (`Farm.createWater`) covers the camera's whole
   * visible rect, and this is belt and braces underneath it: a resize between
   * frames, a scene that has not built its water yet, or the character creator
   * before the farm exists all fall back to a colour that reads as more sea
   * rather than as a hole in the page. Matches `WATER_TILE`'s `#0092dd`
   * darkened for depth.
   */
  backgroundColor: '#0a6fa8',
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
   * `Interior` is registered again (T-16.12), after being deliberately absent
   * since T-11.05 — the house's inside was hidden for the MVP because its art
   * pointed at a deleted pack (§5.7). T-16.08 re-measured all fourteen pieces
   * against real art and T-16.10 authored the room; `Farm.enterHouse()` reaches
   * it through the door.
   *
   * Order matters only in that `Preload` runs first. `Interior` is never the
   * scene the game boots into: it is started by `scene.run` on the first trip
   * through the door and slept thereafter.
   */
  scene: [Preload, Farm, Interior],
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
