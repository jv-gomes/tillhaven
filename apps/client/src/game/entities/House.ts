import Phaser from 'phaser';
import {
  HOUSE_ANCHOR,
  OBJ_TINY_HOUSE,
  OBJ_TINY_HOUSE_LOOK,
  TILE_SIZE,
} from '@tillhaven/shared/config';
import { DEPTH } from '../depth.js';

/**
 * The farmhouse.
 *
 * A house spans many cells rather than sitting in one, so it cannot be a frame
 * from the 16px grid the rest of the sheet is sliced on. It is registered as a
 * **custom texture frame** over its measured crop window — Phaser is happy to
 * carry frames that do not line up with the sheet's grid, and it keeps the
 * manifest as the single place those numbers live (§9).
 *
 * **One look for every tier (T-7.07), not the old pack's two-looks-for-three.**
 * `OBJ_TINY_HOUSE`'s kit has exactly one complete, ready-to-use house
 * silhouette (`OBJ_TINY_HOUSE_LOOK` — see its doc comment in the shared
 * config); the old pack's `plain`/`built` tier art it replaces is gone with
 * the rest of the old pack. `setTier` below is kept as the entry point (the
 * server's tier still arrives with farm state, and nothing here decides
 * which house a player has) but it is currently a no-op picture-wise — a
 * documented regression, same shape as the old pack's own "only two
 * buildings for three house tiers" gap, and T-7.11's job to give tiers a
 * real visual difference again.
 */

/**
 * Where the house stands, in map pixels, anchored at its BOTTOM-LEFT.
 *
 * Above the crop field and clear of both map trees. Presentational, so it lives
 * on the client: the server has no opinion about where a house is, and a
 * coordinate it did not need would be one more thing to validate (§4.1). It is
 * not authored in the map because the editor places tile-objects by gid, and a
 * multi-cell crop window is not a gid — worth revisiting if the editor ever
 * learns about them.
 *
 * The tile itself moved to shared config in T-12.02b (`HOUSE_ANCHOR`, which
 * carries the same roof-stays-on-the-map nudge it always had): it was written
 * here AND as a comment in the map generator, which is how two coordinates
 * that must agree stop agreeing.
 */
export const HOUSE_POSITION = {
  x: HOUSE_ANCHOR.x * TILE_SIZE,
  y: HOUSE_ANCHOR.y * TILE_SIZE,
} as const;

const FRAME_NAME = 'house';

/**
 * Registers the one house frame, once per texture.
 *
 * Guarded on the frame already existing: Phaser's texture manager outlives a
 * scene, so a restart would otherwise add it twice.
 */
export function registerHouseFrames(scene: Phaser.Scene): void {
  const texture = scene.textures.get(OBJ_TINY_HOUSE.key);
  if (texture.has(FRAME_NAME)) return;

  const { x, y, width, height } = OBJ_TINY_HOUSE_LOOK;
  texture.add(FRAME_NAME, 0, x, y, width, height);
}

export class House {
  private readonly sprite: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, tier: number) {
    registerHouseFrames(scene);

    this.sprite = scene.add
      .image(HOUSE_POSITION.x, HOUSE_POSITION.y, OBJ_TINY_HOUSE.key, FRAME_NAME)
      // Bottom-anchored and depth-sorted on its base, like every other thing
      // that stands on the ground here.
      .setOrigin(0, 1)
      .setDepth(DEPTH.world + HOUSE_POSITION.y);

    this.setTier(tier);
  }

  /**
   * The doorway, in world pixels.
   *
   * Deliberately the bottom-centre of the building rather than the exact door
   * art: there is currently one look for every tier (see the class doc
   * comment), so there is no tier-specific box to key off any more.
   */
  doorway(): Phaser.Geom.Rectangle {
    const width = TILE_SIZE * 2;

    return new Phaser.Geom.Rectangle(
      HOUSE_POSITION.x + OBJ_TINY_HOUSE_LOOK.width / 2 - width / 2,
      HOUSE_POSITION.y - TILE_SIZE * 2,
      width,
      TILE_SIZE * 2,
    );
  }

  /**
   * Swaps the picture when the tier changes.
   *
   * Currently a no-op picture-wise — see the class doc comment — but kept as
   * the entry point so callers (and the server's tier value) do not need to
   * change when T-7.11 gives tiers a real visual difference again.
   */
  setTier(_tier: number): void {
    // No-op until T-7.11.
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
