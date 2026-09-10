import Phaser from 'phaser';
import {
  CHAR_FRAME,
  CHAR_ORIGIN,
  NPC_MERCHANT_IDLE_FPS,
  NPC_MERCHANT_IDLE_FRAMES,
  TILE_SIZE,
  VILLAGERS,
  type NpcId,
  type TilePoint,
  type VillagerDef,
} from '@tillhaven/shared/config';

/**
 * Re-exported so a scene reaches for the roster through the module that draws
 * it, the same convention `farmLayout.ts` uses for the generated bakes.
 */
export { VILLAGERS };
export type { VillagerDef };
import { CONTACT_SHADOW, belowGround, groundDepth } from '../depth.js';
import { prefersReducedMotion } from '../motion.js';

/**
 * A villager standing at a fixed tile (T-18.02, generalised by T-33.03).
 *
 * This was `MerchantNpc`, hardcoded to one strip and one tile. T-33.03's whole
 * claim is that **a second NPC is content, not code** — the dialogue tables
 * already made that true for what a character SAYS, and this makes it true for
 * how one is drawn. Adding a villager is now an entry in `VILLAGERS` plus lines
 * in `config/dialogue.ts`.
 *
 * **Deliberately not a `Player`.** These characters have no appearance to
 * composite, no walk cycle, no input and no server state — one looping idle pose
 * at a fixed tile. Reusing the layered renderer would mean loading five strips
 * per animation to draw a single one, and `characterLayers.ts` builds its
 * texture keys from the player's own naming convention.
 *
 * The art is a whole-image `ImageSpec` cropped into named frames, exactly the
 * technique `registerDecorFrames` and `registerCoopFrames` use.
 *
 * **They sort as scenery, on the plain `groundDepth`, not as characters.** The
 * `CHARACTER_BIAS` exists to break exact ties in the player's favour; giving it
 * to a fixed NPC as well would restore the tie it was added to remove, and the
 * player walking up to the counter would sometimes vanish behind the vendor.
 * Unbiased means the player always wins that line, which is right: an NPC is a
 * thing you walk up to, like the stall behind it.
 */

/** Feet position in world (map) pixels — the bottom edge of the anchor tile. */
export function villagerPosition(tile: TilePoint): { x: number; y: number } {
  return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: (tile.y + 1) * TILE_SIZE };
}

function frameName(id: NpcId, index: number): string {
  return `${id}-idle-${index}`;
}

function animKey(id: NpcId): string {
  return `npc-${id}-idle-down`;
}

/**
 * Crops the `down` block's frames out of a strip, once per texture.
 *
 * Guarded on the frame already existing: Phaser's texture manager outlives a
 * scene, so a restart would otherwise add them twice and throw.
 *
 * Block 0 only — the measurement behind that choice is recorded on
 * `NPC_MERCHANT_IDLE` and re-taken for `NPC_CHEF_IDLE`. Frames run left to right
 * from x=0 at 32px each. Both strips share the geometry, which is checked in
 * `assets.ts` rather than assumed here.
 */
export function registerVillagerFrames(scene: Phaser.Scene, def: VillagerDef): void {
  if (!scene.textures.exists(def.artKey)) return;
  const texture = scene.textures.get(def.artKey);

  for (let i = 0; i < NPC_MERCHANT_IDLE_FRAMES; i++) {
    const name = frameName(def.id, i);
    if (texture.has(name)) continue;
    texture.add(name, 0, i * CHAR_FRAME.width, 0, CHAR_FRAME.width, CHAR_FRAME.height);
  }

  const key = animKey(def.id);
  if (scene.anims.exists(key)) return;
  scene.anims.create({
    key,
    frames: Array.from({ length: NPC_MERCHANT_IDLE_FRAMES }, (_, i) => ({
      key: def.artKey,
      frame: frameName(def.id, i),
    })),
    frameRate: NPC_MERCHANT_IDLE_FPS,
    repeat: -1,
  });
}

export class VillagerNpc {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, def: VillagerDef) {
    registerVillagerFrames(scene, def);

    const { x, y } = villagerPosition(def.tile);

    // Created before the sprite so a tie can never draw it on top, the same
    // ordering `Player` relies on for its own shadow.
    this.shadow = scene.add
      .ellipse(
        x,
        y,
        CONTACT_SHADOW.radiusX * 2,
        CONTACT_SHADOW.radiusY * 2,
        CONTACT_SHADOW.colour,
        CONTACT_SHADOW.alpha,
      )
      .setDepth(belowGround(y));

    this.sprite = scene.add
      .sprite(x, y, def.artKey, frameName(def.id, 0))
      // Feet on the position, not the frame's blank bottom rows — every strip's
      // alpha bottom is row 25, same as the player's.
      .setOrigin(CHAR_ORIGIN.x, CHAR_ORIGIN.y)
      // Unbiased, so the player standing on the same ground line passes in
      // front. See the module comment.
      .setDepth(groundDepth(y));

    /*
     * A breathing villager is exactly the kind of small perpetual movement
     * `prefersReducedMotion` exists for — the same call the maple leaves and
     * the animals make. Held on frame 0 rather than hidden: the character still
     * has to be there to walk up to.
     */
    if (!prefersReducedMotion()) this.sprite.play(animKey(def.id));
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
