import Phaser from 'phaser';
import {
  COLLISION_CELL,
  PLAYER_COLLIDER,
  SUBTILE_RESOLUTION,
  TILE_SIZE,
} from '@tillhaven/shared/config';
import { DEPTH } from '../depth.js';
import type { BlockLayerId, BlockMap } from '../collision.js';

/**
 * The collision overlay (T-23.01) — dev only.
 *
 * **`collision.ts` has said this should exist since T-15.05.** `BlockLayerId`
 * and `BlockMap.reasons()` are documented as being named *"so a debug overlay
 * can say why a tile is solid"*, and then no overlay was ever built. The
 * bookkeeping was there; the picture was not.
 *
 * That gap is not cosmetic. Collision in this game is assembled from five
 * independent sources on four different clocks, and the only way anyone could
 * check the result was to walk into things and guess. A QA pass on collision
 * without a way to SEE it is a QA pass on the code, not on the game.
 *
 * Draws three things a player cannot otherwise distinguish (§ the QA brief):
 *
 *   - **solid tiles**, tinted by which layer makes them solid — so
 *     `sprite ≠ collision` is visible at a glance, and a tile blocked by two
 *     layers is visibly different from one blocked by a single source;
 *   - **the player's collider**, which is a 10x6 box around the feet, not the
 *     19px silhouette;
 *   - **the faced tile**, which is the whole of the interaction range.
 */

/**
 * One colour per source. Chosen to survive over grass and over soil rather than
 * to be pretty, and deliberately far apart in hue: the point of the overlay is
 * telling two adjacent solid tiles apart by WHY they are solid.
 */
const LAYER_COLOUR: Record<BlockLayerId, number> = {
  terrain: 0x3aa0ff,
  objects: 0xffc83a,
  buildings: 0xff4d6d,
  animals: 0xb06dff,
  decor: 0x3ce08a,
};

const FILL_ALPHA = 0.38;
const PLAYER_COLOUR = 0x00ffe1;
const FACED_COLOUR = 0xffffff;

export class CollisionOverlay {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private visible = false;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(DEPTH.overlay).setVisible(false);
  }

  get isOn(): boolean {
    return this.visible;
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.gfx.setVisible(this.visible);
    if (!this.visible) this.gfx.clear();
    return this.visible;
  }

  destroy(): void {
    this.gfx.destroy();
  }

  /**
   * Redraws for one frame.
   *
   * Cheap enough to run every frame while ON and skipped entirely while OFF —
   * a dev tool that costs the shipping game anything is a dev tool that gets
   * disabled and then rots.
   */
  draw(
    blocks: BlockMap,
    /** In TILES. Multiplied up inside, because the caller thinks in map size. */
    width: number,
    height: number,
    player: { readonly x: number; readonly y: number } | null,
    faced: { readonly tileX: number; readonly tileY: number } | null,
  ): void {
    if (!this.visible) return;

    this.gfx.clear();

    /*
     * **Drawn per CELL, not per tile.** The whole point of the overlay is to
     * show what the character will actually be stopped by, and since sub-tile
     * collision that is a grid three times finer than the map's. A tile-grained
     * overlay would draw a square where the collision is an L and send the next
     * person hunting a bug in the wrong file.
     */
    for (let cy = 0; cy < height * SUBTILE_RESOLUTION; cy++) {
      for (let cx = 0; cx < width * SUBTILE_RESOLUTION; cx++) {
        const reasons = blocks.reasons(cx, cy);
        if (reasons.length === 0) continue;

        /*
         * The FIRST reason picks the fill and the rest are drawn as inset
         * rings, so a tile that is solid for two reasons — a building over
         * water, say — reads as two colours rather than silently as one. That
         * distinction is exactly what `reasons()` returns a list for.
         */
        this.gfx.fillStyle(LAYER_COLOUR[reasons[0]!], FILL_ALPHA);
        this.gfx.fillRect(
          cx * COLLISION_CELL,
          cy * COLLISION_CELL,
          COLLISION_CELL,
          COLLISION_CELL,
        );

        /*
         * A cell is 5.33px, so the inset is one pixel per extra reason rather
         * than two — at the old spacing the second ring would be a dot and the
         * third would be inside out.
         */
        for (const [depth, layer] of reasons.slice(1).entries()) {
          const inset = 1 + depth;
          this.gfx.lineStyle(1, LAYER_COLOUR[layer], 0.9);
          this.gfx.strokeRect(
            cx * COLLISION_CELL + inset,
            cy * COLLISION_CELL + inset,
            COLLISION_CELL - inset * 2,
            COLLISION_CELL - inset * 2,
          );
        }
      }
    }

    // The interaction range: one tile in front of the feet, and nothing else.
    if (faced) {
      this.gfx.lineStyle(1, FACED_COLOUR, 0.95);
      this.gfx.strokeRect(faced.tileX * TILE_SIZE, faced.tileY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }

    /*
     * The collider, drawn from the same constants `movement.step` resolves
     * against — `halfWidth` either side of the position, `height` measured UP
     * from the feet. Anything else here would be a second description of the
     * box, and a debug view that lies is worse than none.
     */
    if (player) {
      this.gfx.lineStyle(1, PLAYER_COLOUR, 1);
      this.gfx.strokeRect(
        player.x - PLAYER_COLLIDER.halfWidth,
        player.y - PLAYER_COLLIDER.height,
        PLAYER_COLLIDER.halfWidth * 2,
        PLAYER_COLLIDER.height,
      );
      // A cross on the feet position itself: the collider is anchored there and
      // it is the value every collision question is asked about.
      this.gfx.lineBetween(player.x - 3, player.y, player.x + 3, player.y);
      this.gfx.lineBetween(player.x, player.y - 3, player.x, player.y + 3);
    }
  }
}
