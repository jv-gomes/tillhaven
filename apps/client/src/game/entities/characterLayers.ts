import Phaser from 'phaser';
import {
  CHAR_ANIMS,
  CHAR_DIRECTION_ORDER,
  CHAR_FRAME,
  CHAR_LAYER_ORDER,
  TOOL_ANIMS,
  charDirectionStart,
  charLayerPath,
  charLayerVariant,
  charToolPath,
  type CharAnimKey,
  type CharDirection,
  type CharLayer,
  type ToolAnim,
} from '@tillhaven/shared/config';
import type { Appearance } from '@tillhaven/shared/schemas';

/**
 * Loading and animating the four strips that make up one player's character.
 *
 * Character strips are the one asset class NOT in the preload manifest
 * (CLAUDE.md §9): there are 45 per animation and a given player wants exactly
 * four of them, so they are loaded **at runtime**, once their appearance is
 * known, by the convention `charLayerPath` defines. Everything about which
 * file that is lives in the shared config (T-8.02); everything about getting
 * it into Phaser lives here.
 *
 * The texture key IS the path. That is not laziness — it is the property that
 * makes the cache correct: two appearances that share a layer share its
 * texture automatically, and a key can never disagree with the file it names.
 */

/**
 * The animations the farm loads, which is exactly the set `Player.draw()` can
 * ask for. T-8.09 adds the tool swings.
 *
 * `FarmAnim` is derived from this array rather than declared alongside it, and
 * `Player.draw()` is typed to return a `FarmAnim` — so asking for an animation
 * nobody loaded is a compile error rather than what it is otherwise, which is
 * NOTHING AT ALL: `anims.play()` on an unregistered key silently leaves the
 * previous animation running and logs no warning. Confirmed by dropping `run`
 * from this list — the character moved at run speed while still playing its
 * idle loop, with a clean console (T-8.04 break test).
 */
export const FARM_ANIMS = [
  'idle',
  'walk',
  'run',
  'hoe',
  'watering',
] as const satisfies readonly CharAnimKey[];
export type FarmAnim = (typeof FARM_ANIMS)[number];

/** Texture key for one layer strip. Identical to its URL, deliberately. */
export function layerTextureKey(
  anim: CharAnimKey,
  layer: CharLayer,
  appearance: Appearance,
): string {
  return charLayerPath(anim, layer, charLayerVariant(layer, appearance));
}

/** Texture key for a tool overlay strip. Also its URL, same as the layers. */
export function toolTextureKey(anim: ToolAnim): string {
  return charToolPath(anim);
}

/**
 * Every strip these animations need: the four appearance layers each, plus the
 * tool overlay for the two animations that have one (T-8.09).
 *
 * One list rather than two so `loadCharacter` and `registerCharacterAnimations`
 * cannot cover different sets — a tool strip that is loaded but unregistered
 * (or the reverse) fails silently, exactly like T-8.04's missing `run`.
 */
export function stripKeys(
  appearance: Appearance,
  anims: readonly CharAnimKey[] = FARM_ANIMS,
): { anim: CharAnimKey; key: string }[] {
  return anims.flatMap((anim) => {
    const layers = CHAR_LAYER_ORDER.map((layer) => ({
      anim,
      key: layerTextureKey(anim, layer, appearance),
    }));

    return isToolAnim(anim)
      ? [...layers, { anim, key: toolTextureKey(anim) }]
      : layers;
  });
}

function isToolAnim(anim: CharAnimKey): anim is ToolAnim {
  return (TOOL_ANIMS as readonly CharAnimKey[]).includes(anim);
}

/**
 * Animation key for one layer strip facing one way.
 *
 * Keyed by TEXTURE rather than by player, because Phaser's animation manager
 * is global to the game: two players in ginger hair must resolve to the same
 * animation, and one player changing shirt must not reuse the old one's.
 */
export function charAnimKey(textureKey: string, direction: CharDirection): string {
  return `char:${textureKey}:${direction}`;
}

/**
 * Queues any strips this appearance needs that are not already in the texture
 * cache, and resolves once they are all in.
 *
 * Phaser can load after boot, but only if something explicitly restarts the
 * loader — a `load.spritesheet()` call from inside a running scene otherwise
 * sits in the queue forever. Resolving on `COMPLETE` (which fires even when
 * individual files fail) rather than counting files keeps the caller's gate
 * simple: it never hangs waiting for a 404.
 */
export function loadCharacter(
  scene: Phaser.Scene,
  appearance: Appearance,
  anims: readonly CharAnimKey[] = FARM_ANIMS,
): Promise<void> {
  const missing = stripKeys(appearance, anims).filter(
    ({ key }) => !scene.textures.exists(key),
  );
  if (missing.length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    for (const { key } of missing) {
      scene.load.spritesheet(key, key, {
        frameWidth: CHAR_FRAME.width,
        frameHeight: CHAR_FRAME.height,
      });
    }

    scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      // A missing strip means the appearance enums and `pnpm assets` have
      // drifted apart. Name it — the character still renders, minus a layer.
      console.error(`[tillhaven] character layer failed to load: ${file.key}`);
    });
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    scene.load.start();
  });
}

/**
 * Registers one looping animation per (strip, direction) for this appearance.
 *
 * Guarded on `anims.exists`, because the animation manager is global to the
 * game rather than to a scene: a scene restart, or a second character in the
 * same shirt, would otherwise throw on a duplicate key.
 */
export function registerCharacterAnimations(
  scene: Phaser.Scene,
  appearance: Appearance,
  anims: readonly CharAnimKey[] = FARM_ANIMS,
): void {
  for (const { anim, key } of stripKeys(appearance, anims)) {
    const spec = CHAR_ANIMS[anim];
    if (!scene.textures.exists(key)) continue;

    for (const direction of CHAR_DIRECTION_ORDER) {
      const animationKey = charAnimKey(key, direction);
      if (scene.anims.exists(animationKey)) continue;

      const start = charDirectionStart(spec, direction);
      scene.anims.create({
        key: animationKey,
        frames: scene.anims.generateFrameNumbers(key, {
          start,
          end: start + spec.framesPerDirection - 1,
        }),
        frameRate: spec.fps,
        repeat: spec.loop ? -1 : 0,
      });
    }
  }
}
