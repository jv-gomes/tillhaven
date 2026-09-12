import type { Scene } from 'phaser';

/**
 * The one texture every particle in this game is drawn from.
 *
 * A 2x2 white square, tinted and scaled per emitter. It is generated rather
 * than loaded because a two-pixel dot is not worth a file, a manifest entry or
 * a `firstgid` — and because a particle that is white at source can be any
 * colour the art it lands on happens to be (§9, and the sampling note in
 * `effects.ts`).
 *
 * **Extracted from `Farm` in U3-9**, when the chimney became the second
 * caller. Phaser's texture manager outlives a scene and keys are global to it,
 * so two private copies of this would have raced to create the same key on a
 * scene restart — and the second one would have been the silent no-op that
 * looks like it worked.
 */
export const PARTICLE_TEXTURE_KEY = 'fx-pixel';

export function particleTexture(scene: Scene): string {
  if (!scene.textures.exists(PARTICLE_TEXTURE_KEY)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2);
    g.generateTexture(PARTICLE_TEXTURE_KEY, 2, 2);
    g.destroy();
  }
  return PARTICLE_TEXTURE_KEY;
}
