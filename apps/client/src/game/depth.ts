/**
 * Draw order for everything in the farm scene.
 *
 * Tile layers sit below everything; anything that STANDS on the ground takes
 * its depth from its bottom edge, so a tree in front of a plot — or a player
 * walking below one — overlaps correctly.
 *
 * Shared between the scene and the entities in it: two files disagreeing about
 * what `world` means is exactly how a character ends up walking under the soil.
 */
export const DEPTH = {
  ground: -2000,
  decor: -1900,
  /**
   * Flat things PAINTED on the floor: tilled soil, the plot outline, a rug.
   *
   * They are not objects that stand somewhere — they *are* the ground, drawn
   * after the tile layers because they change at runtime and the tilemap does
   * not. Having no height, they can never occlude anything standing on them,
   * so they take one fixed depth instead of a feet-Y (T-18.01).
   *
   * This band exists because the plot container used to sort at the tile's
   * BOTTOM edge, `groundDepth(top + TILE_SIZE)`. A player standing on that
   * tile has feet anywhere in `(top, top + TILE_SIZE]`, so their depth was
   * always less than or equal to the soil's — and the character was drawn
   * under an opaque 16x16 square from every position on the tile. The visible
   * symptom was "crops render on top of the player"; the crop was the part you
   * noticed, the soil was the part that erased the legs.
   *
   * Decals never overlap each other (one per tile), so a single value is
   * enough and their relative order does not matter.
   */
  groundDecal: -1000,
  /**
   * The faced-tile highlight: above every decal, below everything that stands.
   *
   * It has to clear `groundDecal` or the outline vanishes under tilled soil —
   * which is the one moment it matters, since till, plant, water and harvest all
   * target a plot. It sat on `DEPTH.decor` until T-18.01 with a comment claiming
   * it was "above the ground and the soil"; the soil had been drawn over it ever
   * since the plot became a per-plot sprite.
   */
  targetOutline: -900,
  /** Added to an object's bottom Y so world sprites sort among themselves. */
  world: 0,
  /**
   * The night tint (MVP re-scope): over the whole world, under the overlay.
   *
   * It has to clear every sprite — a character lit at noon while the field
   * around them is dark is worse than no cycle at all — and it has to stay
   * below `overlay`, because the hint text and the collision debug are read
   * rather than looked at, and dimming them is not atmosphere.
   */
  night: 4000,
  overlay: 5000,
} as const;

/**
 * The depth a sprite standing at `feetY` sorts at (T-15.29).
 *
 * `DEPTH.world + feetY` was written out at fourteen separate call sites — the
 * player, animals, badges, trees, the house, the coop, the barn, decor and the
 * map objects. Every one of them agreed, which is exactly why it was worth
 * collapsing: a rule spelled out fourteen times is a rule that only has to be
 * mistyped once, and the symptom (a character walking *under* a fence) is the
 * kind of thing that gets noticed weeks later.
 *
 * FEET, never the sprite's centre or its top. Two things standing on the same
 * row must sort by where they touch the ground, or a tall sprite wins over a
 * short one purely for being tall.
 */
export function groundDepth(feetY: number): number {
  return DEPTH.world + feetY;
}

/**
 * How far a CHARACTER outranks static scenery standing on the same ground line
 * (T-18.01).
 *
 * Phaser stable-sorts, so at an exactly equal depth the tie goes to whichever
 * object was created later. That made the draw order depend on scene
 * construction order — the buildings are only in front of the player because
 * `Farm.create` happens to build them first, a rule written down in one comment
 * and enforced nowhere. Plots, animals and decor are all created *after* the
 * player, so they all won their ties.
 *
 * Half a pixel resolves it in the one direction that is always right: when a
 * character and a fence post touch the ground on the same line, the character
 * is the thing the player is looking at. Strictly less than 1, so the bias can
 * never push a character past the next pixel row and `aboveGround`/`belowGround`
 * keep bracketing their own sprite.
 */
export const CHARACTER_BIAS = 0.5;

/** The depth of a character (player, animal, NPC) whose feet are at `feetY`. */
export function characterDepth(feetY: number): number {
  return groundDepth(feetY) + CHARACTER_BIAS;
}

/** The contact shadow under a character at `feetY` — biased with its owner. */
export function characterShadowDepth(feetY: number): number {
  return characterDepth(feetY) - 1;
}

/**
 * Just above whatever stands at `feetY` — for a badge or label that belongs to
 * that sprite and must not be sorted behind it.
 */
export function aboveGround(feetY: number): number {
  return groundDepth(feetY) + 1;
}

/**
 * Just below — for a contact shadow, which has to sit under its own sprite but
 * over anything standing further back.
 */
export function belowGround(feetY: number): number {
  return groundDepth(feetY) - 1;
}

/**
 * Contact shadow geometry (T-15.29).
 *
 * A flat ellipse under a sprite's feet. It is the cheapest thing that makes a
 * pixel-art character look like it is standing ON the ground rather than
 * pasted over it — without one, a sprite and the grass behind it occupy the
 * same visual plane and the whole scene reads as a collage.
 *
 * Deliberately squat and faint: 4px tall against a 19px character. A shadow you
 * notice is a shadow that is wrong, because nothing here casts a real one and
 * the light has no direction.
 */
export const CONTACT_SHADOW = {
  /** Half-width in px. Roughly the character's own silhouette. */
  radiusX: 6,
  radiusY: 2,
  colour: 0x1c0a18,
  alpha: 0.22,
} as const;
