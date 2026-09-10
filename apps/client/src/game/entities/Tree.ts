import Phaser from 'phaser';
import {
  MAPLE_STUMP_FRAME,
  MAPLE_TREE,
  MAPLE_TREE_ANIM_FRAMES,
  OBJ_MAPLE_TREE,
  OBJ_MAPLE_TREE_ANIM,
} from '@tillhaven/shared/config';
import { groundDepth } from '../depth.js';
import { prefersReducedMotion } from '../motion.js';

/**
 * The maple trees the authored map places (T-9.05).
 *
 * **A resource since Phase 20, not decoration.** This comment used to say "a
 * tree has no server state, cannot be chopped, and gates nothing"; T-20.01 gave
 * it a row, T-20.03 gave it an axe, and `setTreeStanding` below is what makes
 * the two states visible. It still exists so the farm reads as a place rather
 * than a grid — that part was always true.
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
 * Depth comes from `groundDepth()`, the map-wide feet-sort rule, so the
 * character walks behind a tree standing below it and in front of one standing
 * above it, exactly like every other object on the farm.
 */
export function addMapleTree(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Sprite {
  registerTreeAnimations(scene);

  const tree = scene.add
    .sprite(x, y, OBJ_MAPLE_TREE_ANIM.key, MAPLE_TREE_ANIM_FRAMES[0])
    .setOrigin(0, 1)
    .setDepth(groundDepth(y));

  /*
   * Reduced motion leaves the tree on its REST frame and never starts the loop
   * (T-15.29). Frame 0 is the one that is pixel-identical to the static tile the
   * authored map places, so a farm with the preference set looks exactly like
   * the map — not like a tree caught mid-shed.
   *
   * Read at construction, so flipping the OS setting with the tab open takes a
   * reload to reach the trees. The animals honour it live because they are
   * asked every frame anyway; a tree is told once and then left alone, and
   * subscribing every maple to a media query to catch a setting nobody changes
   * mid-session would be more machinery than the case is worth.
   */
  if (prefersReducedMotion()) return tree;

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

/**
 * Switches a maple between standing and chopped (T-20.04).
 *
 * A stump is a frame on the STILL sheet, so this swaps texture as well as
 * frame: the animated sheet has nothing but full trees on it, and a stump has
 * no leaves to drop anyway.
 *
 * Idempotent, because `applyState` calls it on every poll — three times a
 * minute, for five trees, most of which have not changed. Restarting the leaf
 * loop on each of those would reset every tree to the same frame and undo the
 * random offset `addMapleTree` deliberately gives them.
 */
export function setTreeStanding(tree: Phaser.GameObjects.Sprite, standing: boolean): void {
  const isStump = tree.texture.key === OBJ_MAPLE_TREE.key;
  if (standing === !isStump) return;

  if (standing) {
    tree.setTexture(OBJ_MAPLE_TREE_ANIM.key, MAPLE_TREE_ANIM_FRAMES[0]);
    // Back to the loop it was on before it was felled — unless the player has
    // asked for stillness, in which case frame 0 IS the resting look.
    if (!prefersReducedMotion()) {
      tree.play({
        key: ANIM_KEY,
        startFrame: Phaser.Math.Between(0, MAPLE_TREE_ANIM_FRAMES.length - 1),
      });
    }
    return;
  }

  tree.stop();
  tree.setTexture(OBJ_MAPLE_TREE.key, MAPLE_STUMP_FRAME);
}
