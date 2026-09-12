import Phaser from 'phaser';
import { SHEETS, ICON_SHEETS, IMAGES, TILEMAPS } from '@tillhaven/shared/config';
import { hud } from '../hud.js';
import { boot } from '../boot.js';

/**
 * Loads every asset in the shared manifest and reports progress.
 *
 * This scene is deliberately the first thing built: reaching 100% here proves
 * every path in packages/shared/src/config/assets.ts resolves and every frame
 * size is right. An asset problem shows up as a failed load with a named key,
 * not as an invisible sprite three phases later.
 */
export class Preload extends Phaser.Scene {
  private readonly failures: string[] = [];

  constructor() {
    super('Preload');
  }

  preload(): void {
    for (const sheet of [...SHEETS, ...ICON_SHEETS]) {
      this.load.spritesheet(sheet.key, sheet.path, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }

    for (const image of IMAGES) {
      this.load.image(image.key, image.path);
    }

    // Maps are authored in apps/mapmaker and exported as Tiled JSON, so the
    // stock Phaser parser reads them with no custom loader (CLAUDE.md §9).
    for (const tilemap of TILEMAPS) {
      this.load.tilemapTiledJSON(tilemap.key, tilemap.path);
    }

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      boot.progress(value);
    });

    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.failures.push(file.key);
      console.error(`[tillhaven] asset failed to load: ${file.key} (${file.url})`);
    });
  }

  create(): void {
    /*
     * The failure path keeps the curtain up. A missing asset used to overwrite
     * a Phaser label on a blue screen; now it leaves the boot screen standing
     * with the key named on it and a way back to the landing page, because a
     * player who cannot load the game needs somewhere to go more than they need
     * a diagnostic.
     */
    if (this.failures.length > 0) {
      boot.fail(`Missing: ${this.failures.join(', ')}`);
      return;
    }

    this.verifyFrameCounts();
    this.verifyTilemaps();

    hud.mount();
    /*
     * A return from Stripe (T-18.20). Mounted-time rather than per-poll: the
     * `?vip=` is on the URL exactly once, and the message is about the
     * REDIRECT, not about the account's VIP state — which the farm poll
     * reports on its own once the webhook has landed (§7).
     */
    hud.announceVipReturn(window.location.search, (path) =>
      window.history.replaceState(null, '', path),
    );

    boot.done(SHEETS.length + ICON_SHEETS.length + IMAGES.length + TILEMAPS.length);
    this.scene.start('Farm');
  }

  /**
   * Cross-checks what Phaser actually sliced against what the manifest claims.
   * A silent mismatch here is the failure mode that costs a debugging session
   * later — a spritesheet whose frame size is wrong loads fine and renders
   * garbage.
   */
  private verifyFrameCounts(): void {
    // Both lists: an icon sheet whose frame count is wrong renders garbage in
    // the bag exactly as a terrain sheet renders garbage on the ground.
    for (const sheet of [...SHEETS, ...ICON_SHEETS]) {
      const texture = this.textures.get(sheet.key);
      // Phaser counts the __BASE frame alongside the sliced ones.
      const actual = texture.frameTotal - 1;
      const expected = sheet.cols * sheet.rows;
      if (actual !== expected) {
        console.warn(
          `[tillhaven] ${sheet.key}: manifest says ${sheet.cols}x${sheet.rows} = ` +
            `${expected} frames, Phaser sliced ${actual}. Re-measure the source PNG.`,
        );
      }
    }
  }

  /**
   * Confirms each map parsed and that every tileset it names is a texture we
   * actually loaded. A map referencing a tileset by a stale key parses fine and
   * then renders as blank tiles — the same silent-failure shape as a wrong
   * frame size, caught the same way.
   */
  private verifyTilemaps(): void {
    for (const tilemap of TILEMAPS) {
      const data = this.cache.tilemap.get(tilemap.key) as
        | { data?: { tilesets?: { name: string }[] } }
        | undefined;
      if (!data?.data) {
        console.error(`[tillhaven] tilemap ${tilemap.key} did not parse (${tilemap.path})`);
        continue;
      }
      for (const tileset of data.data.tilesets ?? []) {
        if (!this.textures.exists(tileset.name)) {
          console.warn(
            `[tillhaven] tilemap ${tilemap.key} references tileset "${tileset.name}", ` +
              'which is not in the asset manifest. Its tiles will be blank.',
          );
        }
      }
    }
  }
}
