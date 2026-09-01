import Phaser from 'phaser';
import { BARN_ANCHOR, BARN_TIER_ART, TILE_SIZE } from '@tillhaven/shared/config';
import { DEPTH } from '../depth.js';

/**
 * The barn, in the three sizes the player can buy (T-12.02b).
 *
 * Structurally identical to `Coop.ts` — see that file for why the buildings
 * are custom texture frames rather than map objects, and why the tiers share a
 * bottom-left corner. Deliberately a second small class rather than one
 * parameterised `Building`: the two differ only in their art table today, but
 * the barn is the one that will grow a hayloft interaction, and a shared class
 * would have to sprout a discriminator the moment either does.
 */

export const BARN_POSITION = {
  x: BARN_ANCHOR.x * TILE_SIZE,
  y: BARN_ANCHOR.y * TILE_SIZE,
} as const;

function frameName(tier: number): string {
  return `barn-${tier}`;
}

/** Registers one frame per tier, once per texture (see `registerCoopFrames`). */
export function registerBarnFrames(scene: Phaser.Scene): void {
  BARN_TIER_ART.forEach((art, tier) => {
    const texture = scene.textures.get(art.sheet.key);
    const name = frameName(tier);
    if (texture.has(name)) return;

    const { x, y, width, height } = art.look;
    texture.add(name, 0, x, y, width, height);
  });
}

export class Barn {
  private readonly sprite: Phaser.GameObjects.Image;
  private tier = -1;

  constructor(scene: Phaser.Scene, tier: number) {
    registerBarnFrames(scene);

    this.sprite = scene.add
      .image(BARN_POSITION.x, BARN_POSITION.y, BARN_TIER_ART[0]!.sheet.key, frameName(0))
      // Bottom-anchored and depth-sorted on its base, like every other thing
      // that stands on the ground here.
      .setOrigin(0, 1)
      .setDepth(DEPTH.world + BARN_POSITION.y);

    this.setTier(tier);
  }

  /** Swaps the picture when the tier changes — texture and frame, see `Coop`. */
  setTier(tier: number): void {
    if (tier === this.tier) return;

    const art = BARN_TIER_ART[tier];
    if (!art) return;

    this.tier = tier;
    this.sprite.setTexture(art.sheet.key, frameName(tier));
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
