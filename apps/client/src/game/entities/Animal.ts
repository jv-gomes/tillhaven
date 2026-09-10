import Phaser from 'phaser';
import { ANIMAL_SHEETS, CROP_POTATO, TILE_SIZE } from '@tillhaven/shared/config';
import type { AnimalView } from '@tillhaven/shared/types';
import { CONTACT_SHADOW, aboveGround, characterDepth, characterShadowDepth } from '../depth.js';
import {
  animationRowsFor,
  badgeFor,
  idleFrameFor,
  poseRowFor,
  sheetFor,
  type PosePlayback,
} from '../animalSprites.js';
import { seedFrom, stillPose, wanderPose, wanderTile } from '../animalWander.js';
import { prefersReducedMotion } from '../motion.js';

/**
 * A cow or a chicken on the farm.
 *
 * Everything it shows comes from `AnimalView`, which the server computed —
 * maturity, fed state and whether there is produce waiting are all resolved by
 * the same function the collect intent uses, so the icon over an animal's head
 * cannot promise something the server will refuse (§4.4).
 *
 * Two states have to be legible without pointing at anything:
 *
 *   **ready to collect** — the produce itself floats above the animal, bobbing.
 *     An egg over a chicken needs no legend.
 *   **unfed** — the animal is desaturated and its feed item hangs over it.
 *     Tint and icon together, because a tint alone is easy to miss on a busy
 *     map and an icon alone does not read as "this animal is unhappy".
 *
 * Both can be true at once — an animal that earned produce before its food ran
 * out — so they use different channels rather than competing for one.
 */

const IDLE_FPS = 3;

/** Greyed out, not hidden: an unfed animal is still very much there. */
const UNFED_TINT = 0x8a8f98;

const BOB_PIXELS = 2;
const BOB_MS = 900;

function animKey(sheetKey: string, row: number, play: PosePlayback): string {
  // Keyed by ROW, not by pose+facing: chickens map several facings onto one
  // row, and keying by the request would register the same frames four times
  // and then play whichever key happened to be asked for.
  //
  // The playback mode is part of the key because one row can be wanted both
  // ways (T-16.04): a cow's walk row loops while it ambles and holds a single
  // frame while it stands, and those are two different Phaser animations over
  // identical frames.
  return `animal-${sheetKey}-r${row}-${play}`;
}

/**
 * Registers one animation per (sheet, row, playback) an animal can be drawn in.
 *
 * Was one idle loop per sheet until T-15.13, then one loop per row. T-16.04
 * added the playback axis: the same cow walk row is a looping amble and a held
 * standing frame, and the chicken's lie-down row plays once rather than
 * cycling.
 *
 * Guarded, because Phaser's animation manager is global to the game rather than
 * to a scene: a scene restart would otherwise throw on a duplicate key.
 */
export function registerAnimalAnimations(scene: Phaser.Scene): void {
  // Every animal sheet in the manifest, not just the ones some variant
  // currently names: registration is cheap, and a sheet without an animation
  // is an animal that silently renders as a single frozen frame.
  for (const sheet of ANIMAL_SHEETS) {
    // (row, playback) pairs, deduplicated: several poses and facings collapse
    // onto one row, and a cow's walk row is wanted both looping and held. The
    // set itself lives in `animalSprites.ts` so it can be unit-tested.
    for (const { row, play } of animationRowsFor(sheet)) {
      const key = animKey(sheet.key, row, play);
      if (scene.anims.exists(key)) continue;

      const start = row * sheet.cols;
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(sheet.key, {
          // `hold` is a one-frame animation rather than a zero-repeat run of
          // the whole row: the point is a motionless animal, and playing four
          // frames once still shows the legs move before settling.
          start,
          end: play === 'hold' ? start : start + sheet.cols - 1,
        }),
        frameRate: IDLE_FPS,
        // `once` holds on its last frame, which for the chicken's lie-down row
        // is the settled pose — that is the whole reason it is not looped.
        repeat: play === 'loop' ? -1 : 0,
      });
    }
  }
}

export class Animal {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly badge: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private view: AnimalView;
  /** What is currently drawn, so a redraw every frame costs nothing. */
  private sheetKey = '';
  private badgeKey = '';
  /** The (sheet, row) currently playing, so update() is cheap per frame. */
  private rowKey = '';
  /** Stable per-animal wander seed, from its id — never its slot index. */
  private readonly seed: number;

  /**
   * The yard slot this animal was assigned, in world pixels.
   *
   * Distinct from where the sprite is drawn: the slot is what the animal
   * *belongs to* and what its wander is measured from. It is no longer what
   * targeting hit-tests — since T-16.06 that is `lastTile`, because a cow
   * roams off its slot and must answer on the tile you can see it on.
   */
  readonly homePosition: { readonly x: number; readonly y: number };

  /**
   * The tile the last drawn frame put this animal on — what `bounds()` answers.
   *
   * Seeded from the home slot so an animal is targetable in the window between
   * being constructed and its first `update()`, which is a real frame: the
   * scene builds animals on a poll and only drives them on the next tick.
   */
  private lastTile: { tileX: number; tileY: number };

  constructor(scene: Phaser.Scene, view: AnimalView, position: { x: number; y: number }) {
    registerAnimalAnimations(scene);
    this.view = view;
    this.homePosition = { x: position.x, y: position.y };
    this.seed = seedFrom(view.id);
    this.lastTile = wanderTile({
      x: position.x,
      y: position.y,
      facing: 'left',
      pose: 'idle',
      phase: 0,
    });

    // Under the animal, and under nothing else (T-15.29).
    this.shadow = scene.add
      .ellipse(
        position.x,
        position.y,
        CONTACT_SHADOW.radiusX * 2,
        CONTACT_SHADOW.radiusY * 2,
        CONTACT_SHADOW.colour,
        CONTACT_SHADOW.alpha,
      )
      .setDepth(characterShadowDepth(position.y));

    const sheet = sheetFor(view);
    this.sprite = scene.add
      .sprite(position.x, position.y, sheet.key, idleFrameFor(sheet))
      // Bottom-anchored so it stands on its tile and depth-sorts on its feet,
      // like the trees and the player.
      .setOrigin(0.5, 1)
      .setDepth(characterDepth(position.y));

    this.badge = scene.add
      // Placeholder initial texture — invisible until `apply()` sets the real
      // badge, but Phaser still needs a valid, loaded key to create the
      // sprite from (see items.ts's icon placeholders, T-7.07).
      .sprite(position.x, position.y - TILE_SIZE, CROP_POTATO.key, 0)
      .setOrigin(0.5, 1)
      .setDepth(aboveGround(position.y))
      .setVisible(false);

    this.apply(view);
  }

  get id(): string {
    return this.view.id;
  }

  /**
   * World-space rectangle for hit-testing — **the tile the animal is on**
   * (T-16.06, D-16).
   *
   * The rule is "whatever tile the player can see it standing on", and for the
   * two kinds that resolves differently only because they move differently:
   *
   *   - A **chicken** never leaves its slot (`roamTilesUp/Down` are 0, D-15),
   *     so its box is its home tile and never moves. This is exactly T-15.13's
   *     behaviour, unchanged.
   *   - A **cow** roams a tile up or down, so its box follows it. Pinning a
   *     roaming cow's box to its home slot — which is what T-15.13 did, and
   *     rightly, when nothing roamed — would mean facing a cow you are standing
   *     next to and being told about a tile two rows away.
   *
   * **Why following is safe here and would not be in general.** The roam is
   * vertical only, and cow slots are 2 tiles apart horizontally, so no two cows
   * can ever answer on the same tile however they drift. That is not a
   * coincidence to rely on quietly — it is why `roamTilesUp` is documented as
   * vertical-only, and `pasture.test.ts` asserts both halves: distinct tiles at
   * full occupancy, and every reachable tile clear of solid terrain so a cow
   * can never roam somewhere the player cannot stand beside.
   *
   * `lastTile` is written by `update()` each frame rather than recomputed here,
   * because `facedAnimal()` asks every animal on every action and the answer
   * must be the tile the frame actually drew.
   */
  bounds(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(
      this.lastTile.tileX * TILE_SIZE,
      this.lastTile.tileY * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
    );
  }

  /** Replaces the view with the server's latest. */
  apply(view: AnimalView): void {
    this.view = view;

    const sheet = sheetFor(view);
    if (sheet.key !== this.sheetKey) {
      // Maturing is exactly this: the chick sheet is swapped for the adult one.
      this.sheetKey = sheet.key;
      this.sprite.setTexture(sheet.key, idleFrameFor(sheet));
      // Force the next update() to re-pick a row: the cached row belongs to the
      // sheet we just replaced, and a chick and a hen do not share a layout.
      this.rowKey = '';
    }

    if (view.isFed) this.sprite.clearTint();
    else this.sprite.setTint(UNFED_TINT);

    const badge = badgeFor(view);
    const key = badge ? `${badge.sheet.key}:${badge.frame}` : '';
    if (key !== this.badgeKey) {
      this.badgeKey = key;
      if (badge) this.badge.setTexture(badge.sheet.key, badge.frame).setVisible(true);
      else this.badge.setVisible(false);
    }
  }

  /**
   * Drifts the animal around its slot, and bobs its badge (T-15.13).
   *
   * `now` is the SERVER clock, which is what makes this safe to run from a
   * position derived purely from time: two tabs open on the same farm see the
   * same animals in the same places, and a tab that slept through a hundred
   * legs picks up exactly where it should rather than lurching.
   */
  update(now: number): void {
    const sheet = sheetFor(this.view);
    // Read every frame rather than captured at construction: the cache behind
    // it is one boolean, and the setting can be changed with the tab open.
    const still = prefersReducedMotion();
    const pose = still
      ? stillPose(this.homePosition)
      : wanderPose(this.view.kind, this.seed, this.homePosition, now);
    const resolved = poseRowFor(sheet, pose.pose, pose.facing);
    const { row, flipX } = resolved;
    // A held frame, not the resolved playback: a chicken's idle row still
    // CYCLES, and a bird that does not travel but never stops moving is not
    // what the setting asked for.
    const play: PosePlayback = still ? 'hold' : resolved.play;

    // Recorded before anything is drawn: `bounds()` must describe the frame
    // that is about to appear, not the one before it (T-16.06).
    this.lastTile = wanderTile(pose);

    this.sprite.setPosition(pose.x, pose.y);
    this.shadow.setPosition(pose.x, pose.y).setDepth(characterShadowDepth(pose.y));
    // Re-sorted every frame: an animal that drifts down must pass in front of
    // one behind it, the same rule the player and the trees follow.
    this.sprite.setDepth(characterDepth(pose.y));
    this.sprite.setFlipX(flipX);

    // Switching animation only when the ROW changes, not when the pose does:
    // a chicken's idle and pecking facings collapse onto the same rows, and
    // restarting an animation every frame freezes it on frame 0.
    const rowKey = `${sheet.key}:${row}:${play}`;
    if (rowKey !== this.rowKey) {
      this.rowKey = rowKey;
      this.sprite.anims.play(animKey(sheet.key, row, play), true);
    }

    if (!this.badge.visible) return;

    // Follows the sprite, not the slot — a badge left behind at the home
    // position would drift off its own animal.
    // The badge bobs for the same reason the leaves fall — to catch the eye —
    // so it is the same thing reduced motion is switching off. It stays fully
    // visible, parked at the top of its arc.
    const phase = still ? 1 : Math.sin((now / BOB_MS) * Math.PI * 2);
    this.badge.setPosition(pose.x, pose.y - TILE_SIZE - BOB_PIXELS + phase * BOB_PIXELS);
    this.badge.setDepth(aboveGround(pose.y));
  }

  destroy(): void {
    this.sprite.destroy();
    this.badge.destroy();
    this.shadow.destroy();
  }
}
