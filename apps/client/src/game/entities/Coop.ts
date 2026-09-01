import Phaser from 'phaser';
import { COOP_ANCHOR, COOP_TIER_ART, TILE_SIZE } from '@tillhaven/shared/config';
import { DEPTH } from '../depth.js';

/**
 * The chicken coop, in the three sizes the player can buy (T-12.02b).
 *
 * Same technique as `House.ts`: each tier's sheet is a whole, uncropped kit
 * and `COOP_TIER_ART[tier].look` is the one fully-assembled building it
 * contains, registered as a **custom texture frame** over that measured crop
 * window rather than a gid — a multi-cell building is not addressable on the
 * 16px tile grid the rest of the map uses.
 *
 * Not placed as a map object, for the reason `House.ts` documents: the
 * mapmaker places tile-objects by gid, and `Farm.ts`'s `buildMapObjects`
 * renders whatever gid it is given at native pixel size with no scaling — a
 * 720x544 kit sheet would bury the farm. The anchor is a shared-config
 * constant instead (`COOP_ANCHOR`), so the map generator can keep paths and
 * trees out from under it.
 *
 * **The three tiers share a bottom-left corner and grow up and to the right**,
 * so the door stays roughly where the player last walked to, and the ground a
 * coop reserves is the Deluxe footprint at every tier.
 */

export const COOP_POSITION = {
  x: COOP_ANCHOR.x * TILE_SIZE,
  y: COOP_ANCHOR.y * TILE_SIZE,
} as const;

function frameName(tier: number): string {
  return `coop-${tier}`;
}

/**
 * Registers one frame per tier, once per texture.
 *
 * Guarded on the frame already existing: Phaser's texture manager outlives a
 * scene, so a restart would otherwise add them twice.
 */
export function registerCoopFrames(scene: Phaser.Scene): void {
  COOP_TIER_ART.forEach((art, tier) => {
    const texture = scene.textures.get(art.sheet.key);
    const name = frameName(tier);
    if (texture.has(name)) return;

    const { x, y, width, height } = art.look;
    texture.add(name, 0, x, y, width, height);
  });
}

export class Coop {
  private readonly sprite: Phaser.GameObjects.Image;
  private tier = -1;

  constructor(scene: Phaser.Scene, tier: number) {
    registerCoopFrames(scene);

    this.sprite = scene.add
      .image(COOP_POSITION.x, COOP_POSITION.y, COOP_TIER_ART[0]!.sheet.key, frameName(0))
      // Bottom-anchored and depth-sorted on its base, like every other thing
      // that stands on the ground here.
      .setOrigin(0, 1)
      .setDepth(DEPTH.world + COOP_POSITION.y);

    this.setTier(tier);
  }

  /**
   * Swaps the picture when the tier changes.
   *
   * Both the texture AND the frame, not just the frame: every tier is a
   * separate sheet, so a `setFrame` alone would look for `coop-2` in the basic
   * coop's texture and find nothing. An unknown tier keeps the basic look
   * rather than blanking the building — the server is the authority on which
   * tier a farm has, and a picture the client does not have is not a reason to
   * draw a hole in the farm.
   */
  setTier(tier: number): void {
    if (tier === this.tier) return;

    const art = COOP_TIER_ART[tier];
    if (!art) return;

    this.tier = tier;
    this.sprite.setTexture(art.sheet.key, frameName(tier));
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
