import Phaser from 'phaser';
import { DECOR, DECOR_IDS, decorAnchorPx, type DecorDef } from '@tillhaven/shared/config';
import { groundDepth } from '../depth.js';

/**
 * A placed piece of farm decoration (T-15.22).
 *
 * Each catalogue piece is a WINDOW into a kit — `decor-scarecrow.png` holds
 * eight scarecrows, `decor-village-signs.png` twelve signs — so every piece
 * gets a named custom frame cropped out of its sheet, exactly the technique
 * `registerCoopFrames` uses for the per-tier buildings.
 */

function frameName(id: string): string {
  return `decor-${id}`;
}

/**
 * Registers one cropped frame per catalogue piece, once per texture.
 *
 * Guarded on the frame already existing: Phaser's texture manager outlives a
 * scene, so a restart would otherwise add them twice and throw.
 */
export function registerDecorFrames(scene: Phaser.Scene): void {
  for (const id of DECOR_IDS) {
    const def = DECOR[id]!;
    if (!scene.textures.exists(def.sheet)) continue;

    const texture = scene.textures.get(def.sheet);
    const name = frameName(id);
    if (texture.has(name)) continue;

    const { x, y, width, height } = def.look;
    texture.add(name, 0, x, y, width, height);
  }
}

export class DecorPiece {
  private readonly sprite: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    readonly id: string,
    readonly def: DecorDef,
    readonly tileX: number,
    readonly tileY: number,
  ) {
    registerDecorFrames(scene);

    const at = decorAnchorPx(def, tileX, tileY);
    this.sprite = scene.add
      .image(at.x, at.y, def.sheet, frameName(def.id))
      // Bottom-left anchored and sorted on its GROUND CONTACT, like the trees,
      // the buildings and the player — so the character walks in front of a
      // piece below them and behind one above them.
      .setOrigin(0, 1)
      .setDepth(groundDepth(at.y));
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
