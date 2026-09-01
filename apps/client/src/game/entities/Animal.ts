import Phaser from 'phaser';
import { ANIMAL_SHEETS, CROP_POTATO, TILE_SIZE } from '@tillhaven/shared/config';
import type { AnimalView } from '@tillhaven/shared/types';
import { DEPTH } from '../depth.js';
import { badgeFor, idleFrameFor, sheetFor } from '../animalSprites.js';

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

function animKey(sheetKey: string): string {
  return `animal-idle-${sheetKey}`;
}

/**
 * Registers one idle loop per animal sheet, from its measured idle row
 * (`idleFrameFor`, T-7.10 — chickens and cows use different rows of
 * different sheets, not one shared "side row" index).
 *
 * Guarded, because Phaser's animation manager is global to the game rather than
 * to a scene: a scene restart would otherwise throw on a duplicate key.
 */
export function registerAnimalAnimations(scene: Phaser.Scene): void {
  // Every animal sheet in the manifest, not just the ones some variant
  // currently names: registration is cheap, and a sheet without an animation
  // is an animal that silently renders as a single frozen frame.
  for (const sheet of ANIMAL_SHEETS) {
    const key = animKey(sheet.key);
    if (scene.anims.exists(key)) continue;

    const start = idleFrameFor(sheet);
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(sheet.key, {
        start,
        end: start + sheet.cols - 1,
      }),
      frameRate: IDLE_FPS,
      repeat: -1,
    });
  }
}

export class Animal {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly badge: Phaser.GameObjects.Sprite;
  private view: AnimalView;
  /** What is currently drawn, so a redraw every frame costs nothing. */
  private sheetKey = '';
  private badgeKey = '';

  constructor(
    scene: Phaser.Scene,
    view: AnimalView,
    private readonly position: { x: number; y: number },
  ) {
    registerAnimalAnimations(scene);
    this.view = view;

    const sheet = sheetFor(view);
    this.sprite = scene.add
      .sprite(position.x, position.y, sheet.key, idleFrameFor(sheet))
      // Bottom-anchored so it stands on its tile and depth-sorts on its feet,
      // like the trees and the player.
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.world + position.y);

    this.badge = scene.add
      // Placeholder initial texture — invisible until `apply()` sets the real
      // badge, but Phaser still needs a valid, loaded key to create the
      // sprite from (see items.ts's icon placeholders, T-7.07).
      .sprite(position.x, position.y - TILE_SIZE, CROP_POTATO.key, 0)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.world + position.y + 1)
      .setVisible(false);

    this.apply(view);
  }

  get id(): string {
    return this.view.id;
  }

  /** World-space rectangle for hit-testing, matching what is drawn. */
  bounds(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(
      this.position.x - TILE_SIZE / 2,
      this.position.y - TILE_SIZE,
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
      this.sprite.anims.play(animKey(sheet.key), true);
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

  /** Bobs the badge so a ready animal catches the eye without an animation. */
  update(now: number): void {
    if (!this.badge.visible) return;

    const phase = Math.sin((now / BOB_MS) * Math.PI * 2);
    this.badge.y = this.position.y - TILE_SIZE - BOB_PIXELS + phase * BOB_PIXELS;
  }

  destroy(): void {
    this.sprite.destroy();
    this.badge.destroy();
  }
}
