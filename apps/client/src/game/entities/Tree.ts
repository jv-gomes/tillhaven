import Phaser from 'phaser';
import {
  MAPLE_TREE,
  MAPLE_TREE_ANIM_FRAMES,
  OBJ_MAPLE_TREE_ANIM,
} from '@tillhaven/shared/config';
import { DEPTH } from '../depth.js';

/**
 * The maple trees the authored map places (T-9.05).
 *
 * Decoration and nothing else: a tree has no server state, cannot be chopped,
 * and gates nothing. It exists so the farm reads as a place rather than a grid.
 *
 * The map places these as ordinary tile-objects on `OBJ_MAPLE_TREE`; this swaps
 * in the animated sheet, whose matching row is pixel-identical at rest
 * (`MAPLE_TREE.animRow`, verified in T-9.05). Nothing about the authored layout
 * changes — the same tree stands in the same cell, and now some of its leaves
 * come off.
 */

const ANIM_KEY = 'maple-leaves';

/**
 * Registers the leaf loop once.
 *
 * Guarded on `anims.exists` because Phaser's animation manager belongs to the
 * game rather than to a scene, so a scene restart would throw on the duplicate
 * key — same reason `registerAnimalAnimations` is guarded.
 */
export function registerTreeAnimations(scene: Phaser.Scene): void {
  if (scene.anims.exists(ANIM_KEY)) return;

  scene.anims.create({
    key: ANIM_KEY,
    frames: MAPLE_TREE_ANIM_FRAMES.map((frame) => ({
      key: OBJ_MAPLE_TREE_ANIM.key,
      frame,
    })),
    frameRate: MAPLE_TREE.frameRate,
    repeat: -1,
  });
}

/**
 * Plants a decorative maple with its FEET at (x, y) — map-object coordinates,
 * which Tiled anchors to the bottom edge (see `buildMapObjects`).
 *
 * Depth follows the map-wide `DEPTH.world + bottom edge` convention, so the
 * character walks behind a tree standing below it and in front of one standing
 * above it, exactly like every other object on the farm.
 */
export function addMapleTree(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Sprite {
  registerTreeAnimations(scene);

  const tree = scene.add
    .sprite(x, y, OBJ_MAPLE_TREE_ANIM.key, MAPLE_TREE_ANIM_FRAMES[0])
    .setOrigin(0, 1)
    .setDepth(DEPTH.world + y);

  /*
   * A random starting frame, so a row of maples does not shed its leaves in
   * lockstep — three trees pulsing on the same beat reads as a rendering
   * artefact rather than as weather.
   */
  tree.play({
    key: ANIM_KEY,
    startFrame: Phaser.Math.Between(0, MAPLE_TREE_ANIM_FRAMES.length - 1),
  });

  return tree;
}
