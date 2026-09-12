import Phaser from 'phaser';
import {
  HOUSE_ANCHOR,
  HOUSE_CHIMNEY,
  HOUSE_TIER_ART,
  TILE_SIZE,
} from '@tillhaven/shared/config';
import { CHIMNEY_OFFSET_Y, CHIMNEY_SMOKE } from '../ambient.js';
import { groundDepth } from '../depth.js';
import { prefersReducedMotion } from '../motion.js';
import { particleTexture } from '../particleTexture.js';

/**
 * The farmhouse.
 *
 * A house spans many cells rather than sitting in one, so it cannot be a frame
 * from the 16px grid the rest of the sheet is sliced on. It is registered as a
 * **custom texture frame** over its measured crop window — Phaser is happy to
 * carry frames that do not line up with the sheet's grid, and it keeps the
 * manifest as the single place those numbers live (§9).
 *
 * **A real house since T-15.29.** It was drawn from `OBJ_TINY_HOUSE` — a
 * construction kit whose only complete looks are doorless, windowless
 * silhouettes — and looked it: a striped shape with no way in. T-7.11 measured
 * that kit honestly and recorded the result as "plainer than the old pack's",
 * but the pack also ships twelve fully assembled houses in
 * `Objects/Exterior/Houses/`, which nothing had ever looked at.
 * `OBJ_FARMHOUSE` is the third of those: tile roof, cream walls, a door, two
 * windows and a chimney.
 *
 * **A look per tier since T-17.06.** `HOUSE_TIER_ART` is `3.png`, `7.png` and
 * `8.png` — the only three of the pack's twelve houses that form an upgrade
 * ladder rather than a seasonal or themed variant. This comment used to claim
 * the upper tiers were "waiting on art", which was simply false; what actually
 * blocked the swap was that the door moves one tile left at tier 1 and tier 2
 * is a row taller than the map's roof clearance. Both are now handled —
 * `HOUSE_DOOR_ART` is per-tier, and D-20 decided the taller roof may take the
 * border row.
 *
 * The point is not decoration: `HOUSE_TIERS` is a declared gold sink the shop
 * did not even offer, because there was nothing to see for the money.
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
 * Registers one house frame per tier, once per texture.
 *
 * Each tier is its own file, so each gets its own texture and its own crop —
 * the frame NAME is shared because it is unique within a texture. Guarded on
 * the frame already existing and on the texture being loaded: Phaser's texture
 * manager outlives a scene, so a restart would otherwise add them twice.
 */
export function registerHouseFrames(scene: Phaser.Scene): void {
  for (const { sheet, look } of HOUSE_TIER_ART) {
    if (!scene.textures.exists(sheet.key)) continue;
    const texture = scene.textures.get(sheet.key);
    if (texture.has(FRAME_NAME)) continue;
    texture.add(FRAME_NAME, 0, look.x, look.y, look.width, look.height);
  }
}

/** The art for a tier, clamped — a tier with no picture must still draw one. */
function artFor(tier: number) {
  return HOUSE_TIER_ART[tier] ?? HOUSE_TIER_ART[0]!;
}

/** The chimney mouth in world pixels, or null for a tier that has none. */
function chimneyAt(tier: number): { x: number; y: number } | null {
  const mouth = HOUSE_CHIMNEY[tier];
  if (!mouth) return null;

  // The sprite is bottom-anchored (`setOrigin(0, 1)`), so its top edge is a
  // whole look-height above the anchor row. The offsets are measured from the
  // look window's top-left.
  const { look } = artFor(tier);
  return {
    x: HOUSE_POSITION.x + mouth.x,
    y: HOUSE_POSITION.y - look.height + mouth.y + CHIMNEY_OFFSET_Y,
  };
}

export class House {
  private readonly sprite: Phaser.GameObjects.Image;
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private tier: number;

  constructor(scene: Phaser.Scene, tier: number) {
    registerHouseFrames(scene);
    this.tier = tier;

    this.sprite = scene.add
      .image(HOUSE_POSITION.x, HOUSE_POSITION.y, artFor(tier).sheet.key, FRAME_NAME)
      // Bottom-anchored and depth-sorted on its base, like every other thing
      // that stands on the ground here.
      .setOrigin(0, 1)
      .setDepth(groundDepth(HOUSE_POSITION.y));

    this.lightTheFire(scene);
  }

  /**
   * Chimney smoke (U3-9, QA audit §G-6 — the last of its visual list).
   *
   * **Held to `prefers-reduced-motion`.** An ambient emitter is the purest case
   * the setting has: it moves continuously without being asked, and nothing is
   * lost by removing it. Under the setting there is simply no plume, which is
   * also why this returns rather than emitting once.
   *
   * Depth is the house's own row, one above it — the smoke belongs to the
   * building and must sort with it, so a player walking behind the house is
   * behind the smoke too. It is deliberately NOT interactive: like
   * `NightOverlay`, it is scenery, and a particle that swallowed a click would
   * be a bug nobody would think to look for here.
   */
  private lightTheFire(scene: Phaser.Scene): void {
    if (prefersReducedMotion()) return;

    const mouth = chimneyAt(this.tier);
    // Tier 2 is a brick house with no stack. Nothing to light.
    if (!mouth) return;

    this.smoke = scene.add.particles(mouth.x, mouth.y, particleTexture(scene), {
      tint: [...CHIMNEY_SMOKE.tints],
      frequency: CHIMNEY_SMOKE.frequencyMs,
      speed: CHIMNEY_SMOKE.speed,
      lifespan: CHIMNEY_SMOKE.lifespanMs,
      gravityY: CHIMNEY_SMOKE.gravityY,
      angle: CHIMNEY_SMOKE.angle,
      scale: CHIMNEY_SMOKE.scale,
      alpha: CHIMNEY_SMOKE.alpha,
    });

    this.smoke.setDepth(groundDepth(HOUSE_POSITION.y) + 1);
  }

  /**
   * The doorway, in world pixels — the building's bottom-centre 2x2.
   *
   * NOT the door art, and deliberately not: `houseDoorTile` in shared config is
   * what answers "is this the door", per tier and measured. This box is the
   * coarse region kept for callers that only need somewhere to aim.
   */
  doorway(): Phaser.Geom.Rectangle {
    const width = TILE_SIZE * 2;

    return new Phaser.Geom.Rectangle(
      HOUSE_POSITION.x + artFor(this.tier).look.width / 2 - width / 2,
      HOUSE_POSITION.y - TILE_SIZE * 2,
      width,
      TILE_SIZE * 2,
    );
  }

  /**
   * Swaps the picture when the tier changes.
   *
   * Guarded on the tier actually differing: this is called from every farm poll
   * (`Farm.applyState`), and `setTexture` on an unchanged texture is work for
   * nothing three times a minute.
   *
   * The depth does NOT change with the tier. It is `groundDepth(HOUSE_POSITION.y)`
   * — the anchor row, where the house meets the ground — and every tier shares
   * that row because they are all bottom-anchored to it. A taller house grows
   * upward, which is exactly what should not affect sorting.
   */
  setTier(tier: number): void {
    if (tier === this.tier) return;
    const scene = this.sprite.scene;
    this.tier = tier;
    this.sprite.setTexture(artFor(tier).sheet.key, FRAME_NAME);

    /*
     * The plume follows the roof, and stops entirely where there is no
     * chimney to follow. Upgrading to tier 2 must put the smoke out rather
     * than leave it hanging over a roof with no stack under it — and
     * downgrading (or a poll arriving before the first one did) must be able
     * to light it again, which is why this rebuilds rather than repositions.
     */
    this.smoke?.destroy();
    this.smoke = null;
    this.lightTheFire(scene);
  }

  destroy(): void {
    this.smoke?.destroy();
    this.smoke = null;
    this.sprite.destroy();
  }
}
