/**
 * Asset manifest — the single place any asset path or frame size is written
 * (CLAUDE.md §9: "Keep a single assets.ts manifest ... so nothing is loaded by
 * magic string").
 *
 * Every number here was measured from the source PNGs in /assets. Do not guess
 * frame sizes; re-measure and update this file.
 *
 * Paths are relative to the client's public root. `pnpm assets` copies the
 * sources out of /assets under these kebab-case names — the originals are never
 * modified in place.
 */

import type { Appearance } from '../schemas/index.js';

export const ASSET_BASE = '/assets' as const;

export interface SheetSpec {
  readonly key: string;
  readonly path: string;
  /** Source image size, px. */
  readonly width: number;
  readonly height: number;
  /** Frame size for spritesheet slicing, px. */
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly cols: number;
  readonly rows: number;
  readonly note?: string;
}

export interface ImageSpec {
  readonly key: string;
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly note?: string;
}

/* ------------------------------------------------------------------ *
 * Tileset — new pack (T-7.04)
 *
 * Unlike the old pack's single cropped/keyed sheet, these copy straight out
 * of `new_assets/Tileset/` with no transform (T-7.02) — clean transparent
 * PNG, uniform 16x16 grid, verified by grid-overlay inspection rather than
 * assumed from file size. T-7.05 groups these into `TILESET_RUNS`-backed
 * autotile sets for the mapmaker; this block is geometry only.
 * ------------------------------------------------------------------ */

export const TILESET_GRASS_SPRING: SheetSpec = {
  key: 'tileset-grass-spring',
  path: `${ASSET_BASE}/tileset-grass-spring.png`,
  width: 384,
  height: 640,
  frameWidth: 16,
  frameHeight: 16,
  cols: 24,
  rows: 40,
  note: 'Spring grass autotile blocks. Confirmed 16x16 by grid-overlay inspection — see T-7.04 write-up.',
};

export const TILESET_SOIL: SheetSpec = {
  key: 'tileset-soil',
  path: `${ASSET_BASE}/tileset-soil.png`,
  width: 384,
  height: 128,
  frameWidth: 16,
  frameHeight: 16,
  cols: 24,
  rows: 8,
  note: 'Tilled and wet-soil autotile blocks (D-1 / §5.2 watering model).',
};

export const TILESET_GRASS_WATER_SPRING: SheetSpec = {
  key: 'tileset-grass-water-spring',
  path: `${ASSET_BASE}/tileset-grass-water-spring.png`,
  width: 768,
  height: 256,
  frameWidth: 16,
  frameHeight: 16,
  cols: 48,
  rows: 16,
  note: 'Grass/water shoreline transition autotiles — distinct from the plain water-tile fill.',
};

/**
 * NOT an autotile block, despite the name (T-7.05 finding, corrected from
 * T-7.04's initial guess): grid-overlay AND pixel-sampling both confirm this
 * is a "framed rug" kit — bordered stone/plank floor pieces at several
 * fixed sizes, like the house/coop/barn kits, not a repeating texture with
 * straight connecting edges. `GROUND_PATH` below is a flat colour sampled
 * from its dominant fill instead. This sheet stays registered (a real gid,
 * real geometry) for whoever eventually wants to place one of its framed
 * rug pieces as a decoration.
 */
export const TILESET_PATHS: SheetSpec = {
  key: 'tileset-paths',
  path: `${ASSET_BASE}/tileset-paths.png`,
  width: 384,
  height: 256,
  frameWidth: 16,
  frameHeight: 16,
  cols: 24,
  rows: 16,
};

/** A single flat water fill tile — already exactly what T-7.05 needed to
 *  synthesize for grass/soil/path (see `GROUND_*` below): a plain colour,
 *  no border, tiles edge-to-edge with itself perfectly by construction. */
export const WATER_TILE: ImageSpec = {
  key: 'water-tile',
  path: `${ASSET_BASE}/water-tile.png`,
  width: 16,
  height: 16,
};

/**
 * Flat ground-fill tiles, original work (T-7.05) — `scripts/draw-ground-tiles.py`
 * draws these from colours sampled out of the pack's own patch art, tracked
 * in `original-assets/ground/` and copied in by `prepare-assets.mjs` like
 * everything else.
 *
 * Why they exist: `TILESET_GRASS_SPRING`, `TILESET_SOIL` and `TILESET_PATHS`
 * turned out to hold only self-contained rounded patches / framed rug
 * pieces (verified by grid-overlay and connected-component inspection, see
 * the T-7.05 write-up in ROADMAP.md) — never art that fills its cell edge to
 * edge. Tiling a patch repeatedly leaves visible gaps between its rounded
 * borders. `WATER_TILE` above is the one surface the pack already ships as
 * a flat fill, which is what confirmed a flat tile is the right answer for
 * the other three, not a guess.
 *
 * The mapmaker paints these as ordinary single-tile terrain sets (`roles: {
 * c: 0 }` in `DEFAULT_TERRAIN_SETS`); the rounded patch art becomes
 * decoration stamped on top via the existing stamp tool, never the base fill.
 */
export const GROUND_GRASS: ImageSpec = {
  key: 'ground-grass',
  path: `${ASSET_BASE}/ground-grass.png`,
  width: 16,
  height: 16,
  note: 'Sampled from Tileset Grass Spring.png, #79bf56.',
};

export const GROUND_SOIL_DRY: ImageSpec = {
  key: 'ground-soil-dry',
  path: `${ASSET_BASE}/ground-soil-dry.png`,
  width: 16,
  height: 16,
  note: 'Sampled from Tilled Soil and wet soil.png (dry band), #be6d47.',
};

export const GROUND_SOIL_WET: ImageSpec = {
  key: 'ground-soil-wet',
  path: `${ASSET_BASE}/ground-soil-wet.png`,
  width: 16,
  height: 16,
  note: 'Sampled from Tilled Soil and wet soil.png (wet band), #767ede.',
};

export const GROUND_PATH: ImageSpec = {
  key: 'ground-path',
  path: `${ASSET_BASE}/ground-path.png`,
  width: 16,
  height: 16,
  note: 'Sampled from Path tiles.png dominant terracotta brick fill, #662623.',
};

/* ------------------------------------------------------------------ *
 * Characters and animals
 *
 * The old pack's `Facing`/`PLAYER_IDLE`/`PLAYER_WALK`/`PLAYER_ART`/
 * `COW_FEMALE`/`CHICKEN_RED`/etc. are retired by T-7.07 along with the rest
 * of the old pack — see ROADMAP.md's T-7.07 write-up. Animal row semantics
 * (which row is idle, which is the sleep/peck/egg-hatch row) are measured
 * and recorded next to the sheets themselves, further down this file.
 * ------------------------------------------------------------------ */

/**
 * Layered character strips from the new pack
 * (`new_assets/Character/Character/PNG/<folder>/<layer>/<variant>.png`).
 *
 * These are **not** in `SHEETS` — unlike every other sheet, a character strip
 * is not one fixed asset: it is picked per-player from four layers (skin,
 * eyes, hair, clothes) and loaded dynamically once appearance is known
 * (T-8.02/T-8.03). `pnpm assets` copies whole per-animation layer folders into
 * `public/assets/character/<CharAnims[x].key>/<layer>/<variant>.png` — see
 * `scripts/prepare-assets.mjs`.
 *
 * Every strip is a single row, 32px tall, `framesPerDirection` frames per
 * direction block, direction blocks in `CHAR_DIRECTION_ORDER`.
 */
export const CHAR_FRAME = {
  width: 32,
  height: 32,
} as const;

/**
 * Where the character is actually DRAWN inside its 32×32 frame — the
 * replacement for the old pack's `PLAYER_ART` (T-8.03).
 *
 * **Measured, not guessed** (CLAUDE.md §9): all four layers were composited
 * and the alpha bounding box read for every frame of every MVP animation. The
 * result is remarkably uniform — `top`/`bottom` are identical in all 104
 * frames of Idle, Walk, Run, Hoe and Watering, and `left`/`right` hold for
 * every Idle and Walk frame (Run and the tool swings reach out to x∈[9,24) as
 * a limb or a tool extends, which is why this box describes the LOCOMOTION
 * silhouette and nothing clamps on a swing).
 *
 * `right` and `bottom` are EXCLUSIVE edges, like a bounding box. `bottom` is
 * the ground line: the frame carries six blank rows beneath the feet, which is
 * exactly the trap this constant exists to avoid — anchoring the sprite by its
 * frame bottom (origin y = 1) floats the character six pixels above whatever
 * it is standing on, and at PIXEL_SCALE zoom that reads as hovering.
 */
export const CHAR_ART = {
  left: 11,
  top: 7,
  right: 22,
  bottom: 26,
} as const;

/**
 * Sprite origin that puts the character's FEET on its position.
 *
 * Y is `CHAR_ART.bottom / CHAR_FRAME.height` — 0.8125, which lands on a whole
 * pixel, so it costs nothing against `roundPixels`.
 *
 * X stays a plain 0.5 even though the art measures 11px wide centred on 16.5,
 * half a pixel right of the frame's own centre. An 11px silhouette cannot be
 * centred in a 32px frame; correcting for it would mean a fractional origin
 * that puts every character sprite on a half-pixel and defeats the
 * nearest-neighbour rendering the whole game is set up for. Half a pixel of
 * asymmetry is invisible; shimmering pixel art is not.
 */
export const CHAR_ORIGIN = {
  x: 0.5,
  y: CHAR_ART.bottom / CHAR_FRAME.height,
} as const;

/**
 * Direction-block order within every character strip, **verified against the
 * art, not assumed**: the v1 pack laid rows out down/up/side (3 rows, side
 * mirrored for the 4th direction — see `PLAYER_ART`); this pack draws all
 * four directions explicitly, in this order, as separate frame blocks within
 * one row.
 *
 * The first two are easy: block 0 shows both eyes, block 1 shows none (the
 * back of the head). **The last two are the pair that keeps getting swapped**,
 * and the head alone cannot settle it — in a 32px profile the visible eye, the
 * exposed face and the hair mass each appear to point a different way, which is
 * how T-7.03 first recorded `left, right` and how `measure-character.mjs` came
 * to enshrine an inverted centroid rule to match.
 *
 * Verification method, the one that is not ambiguous: composite the **`tool`
 * layer** of Watering onto skin + clothes and look at a late frame. The can is
 * held out and the water pours in the direction the character faces — a dozen
 * bright pixels, no interpretation required. Block 2 pours RIGHT, block 3 pours
 * LEFT. Re-check it that way if it ever comes up again; do not re-derive it
 * from eyes or hair, and do not trust the script's label line.
 */
export const CHAR_DIRECTION_ORDER = ['down', 'up', 'right', 'left'] as const;
export type CharDirection = (typeof CHAR_DIRECTION_ORDER)[number];

export interface CharAnimSpec {
  /** Segment used under `public/assets/character/<key>/...` (see T-7.02). */
  readonly key: string;
  /** Folder name under `new_assets/Character/Character/PNG/`. */
  readonly sourceFolder: string;
  /** Frames per direction block (4 blocks total, see `CHAR_DIRECTION_ORDER`). */
  readonly framesPerDirection: number;
  /** Measured full strip width, px. Guards `framesPerDirection` — see the config test. */
  readonly width: number;
  /** Suggested playback fps. A starting point for Player.ts, not measured art. */
  readonly fps: number;
  /** Loops (idle/walk/run) vs. plays once per use (tool swings). */
  readonly loop: boolean;
}

/**
 * The 5 MVP animations. Frame counts and strip widths measured directly from
 * the source PNGs (`identify`); do not guess if art is re-exported — a wrong
 * `framesPerDirection` here misaligns the whole strip and desyncs directions
 * that the config test cannot catch by width alone if the miscount and the
 * strip width are wrong together, so read this from the art, not the total.
 */
export const CHAR_ANIMS = {
  idle: {
    key: 'idle',
    sourceFolder: '1. Idle',
    framesPerDirection: 4,
    width: 512,
    fps: 4,
    loop: true,
  },
  walk: {
    key: 'walk',
    sourceFolder: '2. Walk',
    framesPerDirection: 6,
    width: 768,
    fps: 8,
    loop: true,
  },
  run: {
    key: 'run',
    sourceFolder: '3. Run',
    framesPerDirection: 8,
    width: 1024,
    fps: 12,
    loop: true,
  },
  hoe: {
    key: 'hoe',
    sourceFolder: '4. Pickaxe, Hoe and Catching insects',
    framesPerDirection: 6,
    width: 768,
    fps: 10,
    loop: false,
  },
  watering: {
    key: 'watering',
    sourceFolder: '7. Watering',
    framesPerDirection: 8,
    width: 1024,
    fps: 10,
    loop: false,
  },
} as const satisfies Record<string, CharAnimSpec>;

export type CharAnimKey = keyof typeof CHAR_ANIMS;

/** Total frame count across all 4 direction blocks. */
export function charTotalFrames(anim: CharAnimSpec): number {
  return anim.framesPerDirection * CHAR_DIRECTION_ORDER.length;
}

/**
 * Index of the first frame of a direction's block within a strip.
 *
 * Blocks are laid out end to end in `CHAR_DIRECTION_ORDER`, so this is the
 * only arithmetic anything needs to address a direction — spelled out here
 * rather than repeated at each call site, because getting it wrong shows up
 * as a character facing the wrong way rather than as an error.
 */
export function charDirectionStart(anim: CharAnimSpec, direction: CharDirection): number {
  return CHAR_DIRECTION_ORDER.indexOf(direction) * anim.framesPerDirection;
}

/**
 * The four layers of a character, **in draw order, bottom to top**.
 *
 * Skin is the body; clothes go over it; eyes are drawn on the bare face;
 * hair covers the forehead last. Any other order hides a layer that is meant
 * to show — the pack's art assumes exactly this stacking.
 */
export const CHAR_LAYER_ORDER = ['skin', 'clothes', 'eyes', 'hair'] as const;
export type CharLayer = (typeof CHAR_LAYER_ORDER)[number];

/**
 * Which file within a layer folder an appearance selects.
 *
 * This is the one place the flattened variant names are spelled — the same
 * names `scripts/prepare-assets.mjs` writes when it kebab-cases the pack's
 * `Eyes/<Sex>/<Color>.png` and `Hair's/<Style>/<Color>.png` trees into a
 * single folder per layer. Appearance enum values are already those names
 * lower-cased (T-8.01), so this is pure assembly, never a lookup table that
 * could drift.
 */
export function charLayerVariant(layer: CharLayer, appearance: Appearance): string {
  switch (layer) {
    case 'skin':
      return String(appearance.skin);
    case 'clothes':
      return appearance.clothes;
    case 'eyes':
      return `${appearance.eyes.sex}-${appearance.eyes.color}`;
    case 'hair':
      return `${appearance.hair.style}-${appearance.hair.color}`;
  }
}

/**
 * Path of one character layer strip.
 *
 * Character strips are the documented exception to "every asset has a
 * manifest entry" (CLAUDE.md §9): there are 45 of them per animation and only
 * four are ever wanted at a time, so they are addressed by convention. This
 * function IS that convention — a CONTRACT with `scripts/prepare-assets.mjs`,
 * which writes `public/assets/character/<anim>/<layer>/<variant>.png`. Nothing
 * may build one of these paths by hand.
 */
export function charLayerPath(anim: CharAnimKey, layer: CharLayer, variant: string): string {
  return `${ASSET_BASE}/character/${CHAR_ANIMS[anim].key}/${layer}/${variant}.png`;
}

/** The four strips an appearance resolves to for one animation, in draw order. */
export function charLayerPaths(anim: CharAnimKey, appearance: Appearance): string[] {
  return CHAR_LAYER_ORDER.map((layer) =>
    charLayerPath(anim, layer, charLayerVariant(layer, appearance)),
  );
}

/**
 * The animations that come with a TOOL OVERLAY strip — the implement in the
 * character's hands, drawn above all four appearance layers (T-8.09).
 *
 * Only these two have one. The overlay is not decoration: without it the hoe
 * animation is a character miming an empty swing, which is why
 * `scripts/prepare-assets.mjs` has copied these strips since T-7.02 and why
 * this task finally draws them. Verified against the art — each tool strip is
 * pixel-for-pixel the same geometry as its animation's character strips
 * (hoe 768×32, watering 1024×32), so it needs no separate frame maths.
 */
export const TOOL_ANIMS = ['hoe', 'watering'] as const satisfies readonly CharAnimKey[];
export type ToolAnim = (typeof TOOL_ANIMS)[number];

/**
 * Tool tier drawn in the character's hands. Wood only until D-4 decides what
 * the pack's other eight tiers mean (CLAUDE.md §14).
 */
export const TOOL_TIER = 'wood' as const;

/**
 * Path of a tool overlay strip. A CONTRACT with `scripts/prepare-assets.mjs`'s
 * `TOOL_OVERLAYS`, which writes `character/<anim>/tool/<tier>.png` — the same
 * rule `charLayerPath` follows one folder over.
 */
export function charToolPath(anim: ToolAnim, tier: string = TOOL_TIER): string {
  return `${ASSET_BASE}/character/${CHAR_ANIMS[anim].key}/tool/${tier}.png`;
}

/**
 * How long one pass of an animation takes, in ms.
 *
 * Derived from the SAME measured `framesPerDirection` and `fps` that Phaser
 * plays the strip at, so the movement lock during a tool swing (T-8.09) cannot
 * end before or after the swing it is covering. Writing the duration out as
 * its own constant would be a second number to keep in step, and the failure
 * — a character frozen mid-swing, or one that walks away holding a raised hoe
 * — is a good deal more confusing than it is obvious.
 */
export function charAnimDurationMs(anim: CharAnimSpec): number {
  return Math.round((anim.framesPerDirection / anim.fps) * 1000);
}

/**
 * A single-layer character strip — bare skin, fixed variant `1`, with no
 * eyes, hair or clothes on top.
 *
 * **No longer the player sprite.** It was T-7.07's stand-in until the layered
 * renderer existed; T-8.03 built that, and the farm now composites four
 * strips chosen from the player's own appearance (`charLayerPaths`,
 * `entities/characterLayers.ts`). These two survive as the LANDING and AUTH
 * pages' art, where a marketing silhouette wants one fixed sprite and there
 * is no logged-in player to have an appearance at all. They are drawn there
 * as DOM sprites (`lib/sprite.ts`, background-position stepping), which reads
 * `path` directly — which is why they are deliberately NOT in `SHEETS` any
 * more: nothing asks Phaser for these textures, and preloading a texture no
 * scene draws is exactly the dead weight the manifest exists to make visible.
 *
 * Unlike the old pack's 3-row-plus-mirror scheme (`Facing`,
 * `PLAYER_MIRROR_FACES_RIGHT`), the new pack draws all 4 directions
 * explicitly as separate blocks (`CHAR_DIRECTION_ORDER`) — no mirroring
 * math needed, which is why `Player.ts`/`movement.ts` shed that machinery
 * entirely rather than porting it.
 */
export const CHAR_PROMO_IDLE: SheetSpec = {
  key: 'char-idle-skin-1',
  path: `${ASSET_BASE}/character/idle/skin/1.png`,
  width: CHAR_ANIMS.idle.width,
  height: CHAR_FRAME.height,
  frameWidth: CHAR_FRAME.width,
  frameHeight: CHAR_FRAME.height,
  cols: charTotalFrames(CHAR_ANIMS.idle),
  rows: 1,
  note: 'Skin layer only, variant 1 — landing/auth page art only, not the in-game player (T-8.03).',
};

export const CHAR_PROMO_WALK: SheetSpec = {
  key: 'char-walk-skin-1',
  path: `${ASSET_BASE}/character/walk/skin/1.png`,
  width: CHAR_ANIMS.walk.width,
  height: CHAR_FRAME.height,
  frameWidth: CHAR_FRAME.width,
  frameHeight: CHAR_FRAME.height,
  cols: charTotalFrames(CHAR_ANIMS.walk),
  rows: 1,
  note: 'Skin layer only, variant 1 — landing/auth page art only, not the in-game player (T-8.03).',
};

/* ------------------------------------------------------------------ *
 * Animals — new pack (T-7.04 geometry, T-7.10 row semantics)
 *
 * Geometry confirmed by grid-overlay inspection (chicken 16x16, cow 32x32 —
 * NOT the same cell size, unlike the old pack where both were measured
 * against a 16px grid).
 *
 * Row semantics measured for T-7.10 by cropping every row at 8-12x scale
 * (Pillow, nearest-neighbour) and cross-checking with a per-frame alpha/
 * colour diff — the same discipline T-7.03 used for the character strips.
 * Full method and per-row screenshots are in the T-7.10 write-up in
 * ROADMAP.md; the findings that matter for code are below.
 * ------------------------------------------------------------------ */

/**
 * Every chicken sheet in the pack — adult and chick alike — is 64x112: a 4x7
 * grid of 16x16 cells. Verified for all 23 of them by reading the PNG headers
 * (T-12.01), not assumed from the two T-7.10 measured. Row semantics are
 * therefore shared too — see ANIMAL_CHICKEN_IDLE_ROW below.
 */
const CHICKEN_GEOMETRY = {
  width: 64,
  height: 112,
  frameWidth: 16,
  frameHeight: 16,
  cols: 4,
  rows: 7,
} as const;

/**
 * Every cow sheet the game uses is 128x288: a 4x9 grid of 32x32 cells — a
 * different cell size from the chickens, which is why the two families never
 * share a constant. (The pack's `Baby Cow Blonde.png` is the one outlier at
 * 128x320; no baby-cow sheet is registered — see `maturityDurationMs` in
 * config/animals.ts — so nothing here has to accommodate it.)
 */
const COW_GEOMETRY = {
  width: 128,
  height: 288,
  frameWidth: 32,
  frameHeight: 32,
  cols: 4,
  rows: 9,
} as const;

function animalSheet(
  key: string,
  geometry: typeof CHICKEN_GEOMETRY | typeof COW_GEOMETRY,
): SheetSpec {
  return { key, path: `${ASSET_BASE}/${key}.png`, ...geometry };
}

/**
 * Adult chicken colours (T-12.01). The slug is the variant id in
 * config/animals.ts minus its `chicken_` prefix, and the sheet key is
 * `animal-chicken-<slug>` — that regularity is what lets a variant name a
 * sheet by string without a second lookup table.
 *
 * Two-word slugs are body-then-accent: `black_white` is a black hen with a
 * white wing, not a separate breed. That matters for pairing chicks — see
 * `babySheet` in config/animals.ts.
 */
export const ANIMAL_CHICKEN_SHEETS: readonly SheetSpec[] = [
  'black',
  'black-white',
  'blonde',
  'blonde-green',
  'brown-black',
  'brown-white',
  'evil',
  'full',
  'green',
  'pink',
  'red',
  'universe',
  'white',
].map((slug) => animalSheet(`animal-chicken-${slug}`, CHICKEN_GEOMETRY));

/**
 * Chick sheets. Ten for thirteen adults, so several adults share one; the
 * pairing lives in config/animals.ts. Same 4x7 layout as the adult sheets —
 * see ANIMAL_CHICKEN_BABY_HATCH_ROW below for the real egg-hatch row (row 4,
 * not the old pack's CHICK_EGG_ROW=2).
 */
export const ANIMAL_CHICKEN_BABY_SHEETS: readonly SheetSpec[] = [
  'black',
  'blonde',
  'brown',
  'evil',
  'green',
  'pink',
  'red',
  'universe',
  'white',
  'yellow',
].map((slug) => animalSheet(`animal-chicken-baby-${slug}`, CHICKEN_GEOMETRY));

/**
 * Cow variants: four coat colours x two sexes of the common breed, plus the
 * shaggy `highland` breed (the pack spells it "Highlighter") in two colours.
 * Slugs follow the variant ids, `<colour>-<sex>` — note that this is the
 * REVERSE of the pack's own file names, which is handled once in
 * scripts/prepare-assets.mjs.
 */
export const ANIMAL_COW_SHEETS: readonly SheetSpec[] = [
  'black-female',
  'black-male',
  'blonde-female',
  'blonde-male',
  'brown-female',
  'brown-male',
  'pink-female',
  'pink-male',
  'highland-black-female',
  'highland-black-male',
  'highland-brown-female',
  'highland-brown-male',
].map((slug) => animalSheet(`animal-cow-${slug}`, COW_GEOMETRY));

/** Every animal sheet, in manifest order. */
export const ANIMAL_SHEETS: readonly SheetSpec[] = [
  ...ANIMAL_CHICKEN_SHEETS,
  ...ANIMAL_CHICKEN_BABY_SHEETS,
  ...ANIMAL_COW_SHEETS,
];

function requireAnimalSheet(key: string): SheetSpec {
  const found = ANIMAL_SHEETS.find((s) => s.key === key);
  if (!found) throw new Error(`no animal sheet named ${key}`);
  return found;
}

/**
 * The three sheets the marketing pages and the sprite fallback name directly.
 * Everything in-game resolves its sheet from a variant id instead, so these
 * are the only animal sheets with a name of their own.
 */
export const ANIMAL_CHICKEN_RED = requireAnimalSheet('animal-chicken-red');
export const ANIMAL_CHICKEN_BABY_YELLOW = requireAnimalSheet('animal-chicken-baby-yellow');
export const ANIMAL_COW_FEMALE_BROWN = requireAnimalSheet('animal-cow-brown-female');

/**
 * Chicken row semantics (adult and baby share this 4x7 @ 16x16 layout).
 * Measured by cropping every row of `animal-chicken-red.png` at 12x scale and
 * cross-checking with a per-frame alpha/orange-pixel (foot) diff:
 *
 *   0 — upright idle, comb up, wing folded, tail a small green triangle.
 *       Frames 0/2 and 1/3 are pixel-identical but for a 1px vertical shift —
 *       a two-phase breathing bob, not a walk with moving limbs. Chosen as
 *       the row this game uses: the calmest, most legible "just standing"
 *       pose of the three near-identical upright rows.
 *   1 — upright idle, alternate look-angle (comb/eye tilted differently).
 *       Same bob as row 0. Not wired — no gameplay state selects it.
 *   2 — upright idle, third look-angle variant. Same bob shape as 0/1.
 *   3 — pecking/grazing: head drops toward the ground, wing spread; the
 *       orange foot-pixel count drops from 6-7 (rows 0-2) to 2, i.e. the feet
 *       are mostly hidden under the lowered body. Not wired.
 *   4 — pecking, deeper crouch (feet reduced to 2px, head lower still).
 *   5 — pecking/nesting, widest wing spread, only 1 foot pixel visible.
 *   6 — the lying/sleep row the T-7.10 Do calls out: frame 0's alpha bounding
 *       box is full height (y0-15, matching row 0's standing pose), but
 *       frames 1-3's bounding box starts 5-11px lower — i.e. this is a
 *       standing-to-lying TRANSITION baked into one row, not a static lying
 *       pose repeated four times. Not wired; not the old pack's row index.
 *
 * Only row 0 is wired (`ANIMAL_CHICKEN_IDLE_ROW`, via `idleRowFor` in
 * `apps/client/src/game/animalSprites.ts`) — the game has no peck/sleep
 * gameplay state to drive the other rows from yet.
 */
export const ANIMAL_CHICKEN_IDLE_ROW = 0 as const;

/**
 * The baby chicken sheet's genuine egg-hatch sequence: row 4 is white egg →
 * cracking egg → chick emerging (with sparkle VFX) → chick fully out (still
 * sparkling). Confirmed by viewing the row at 12x scale — unmistakably an
 * egg, not a chick pose, in frames 0-1. This is NOT the old pack's
 * `CHICK_EGG_ROW = 2`; that index means nothing in this pack's layout.
 *
 * Recorded but not wired: the game has no "player is incubating an egg"
 * state (chicks are bought immature and simply mature into adults, CLAUDE.md
 * §5.4), so there is nothing that would ever play this row. Left here,
 * measured, for whichever future task adds a hatch cutscene rather than
 * making it re-measure this sheet from scratch.
 */
export const ANIMAL_CHICKEN_BABY_HATCH_ROW = 4 as const;

/**
 * Cow row semantics (4x9 @ 32x32, every variant). Measured the same way as
 * the chicken sheets above.
 *
 *   0 — walking, side view, facing left: a genuine 4-phase leg-alternation
 *       cycle (front leg forward, neutral, back leg forward, neutral) and a
 *       head bob that leans forward/back with it — unlike every chicken row,
 *       this one visibly moves its limbs frame to frame, not just a 1px
 *       body shift. This is the row this game uses.
 *   1 — walking, front view (facing the camera), same leg-alternation cycle.
 *   2 — walking, back view (facing away from the camera).
 *   3 — lying, side view (body lower, legs tucked, grazing height).
 *   4 — lying, front view.
 *   5 — lying, side view, alternate pose (sits higher off the ground than
 *       row 3).
 *   6 — lying, back view.
 *   7 — lying, side view with a small orange/yellow mark near the mouth
 *       (chewing detail) not present in row 3.
 *   8 — lying, back view, same mouth mark as row 7.
 *
 * Only row 0 is wired (`ANIMAL_COW_IDLE_ROW`) — no gameplay state
 * distinguishes a standing cow from a lying one yet.
 */
export const ANIMAL_COW_IDLE_ROW = 0 as const;

/* ------------------------------------------------------------------ *
 * Crops — new pack (T-7.04, frame semantics measured in T-7.08)
 *
 * One sheet per crop instead of one combined sheet: 128x16, 8 frames of
 * 16x16 each, confirmed square (unlike the old pack's bottom-anchored
 * 16x32 cells — no top padding here). All four crop strips share the exact
 * same layout (confirmed by grid-overlay inspection AND by summing each
 * frame's alpha channel — T-7.08): frames 0-5 are the six growth stages
 * (frame 0 is the just-planted look — scattered seeds/a small mound on
 * soil — and doubles as the seed-packet icon since the sheet has no
 * separate one), frame 6 is fully transparent (alpha sum 0 on every crop,
 * unused), and frame 7 is the harvested produce icon. `crops.ts` encodes
 * this as `stageFrames: [0..5]`, `seedFrame: 0`, `produceFrame: 7` for all
 * four. `Spring Onion.png` is the closest art match for the game's `leek`
 * item (T-7.08 keeps that item id) — named CROP_LEEK here for that reason,
 * not because the source file says "leek".
 * ------------------------------------------------------------------ */

export const CROP_POTATO: SheetSpec = {
  key: 'crop-potato',
  path: `${ASSET_BASE}/crop-potato.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
};

export const CROP_STRAWBERRY: SheetSpec = {
  key: 'crop-strawberry',
  path: `${ASSET_BASE}/crop-strawberry.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
};

export const CROP_ONION: SheetSpec = {
  key: 'crop-onion',
  path: `${ASSET_BASE}/crop-onion.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
};

export const CROP_LEEK: SheetSpec = {
  key: 'crop-spring-onion',
  path: `${ASSET_BASE}/crop-spring-onion.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
  note: "Source art is Spring Onion — closest match for the game's leek item (CLAUDE.md §9).",
};

/* ------------------------------------------------------------------ *
 * Objects — new pack (T-7.04)
 *
 * The old pack's `HOUSE`/`HOUSE_BUILDINGS`/`houseLookFor`/`INTERIOR`/
 * `FENCE`/`ROAD`/`CHEST`/`ITEMS_SHEET` are retired by T-7.07 along with the
 * rest of the old pack. `House.ts` now points at `OBJ_TINY_HOUSE`/
 * `OBJ_TINY_HOUSE_LOOK` directly (one look for every tier — a known,
 * documented regression, same shape as the old pack's own "only two
 * buildings for three tiers" gap, and T-7.11's job to improve).
 * `furniture.ts`'s `FURNITURE_SHEET` now points at `OBJ_TINY_HOUSE` too, as
 * a bounds-safe placeholder — Interior/furniture art has no owning task
 * anywhere in Phase 7, which is a real gap; see the T-7.07 write-up in
 * ROADMAP.md. Items that used to live on `ITEMS_SHEET` (egg, milk, hay,
 * chicken feed) got real icons from `Icons/Food Icons/` in T-7.09 — see the
 * `ICON_*` block below.
 *
 * Named with the `obj-` prefix the copy step uses (T-7.02's collision
 * guard), so a constant name and its file key always match at a glance.
 *
 * The maple tree and mailbox are clean uniform grids — gid-addressable like
 * any other sheet. The tiny house, chicken coop and barn are NOT: they are
 * "build your own exterior" kits (individual wall/roof/door parts at
 * irregular sizes — confirmed by connected-component analysis, not a
 * uniform frameWidth x frameHeight grid anywhere in the file), so they are
 * registered as whole-image `ImageSpec`s, the same pattern `HOUSE_BUILDINGS`
 * already uses for the old pack: a full source image plus separately
 * measured pixel crop-windows for the one complete look each sheet happens
 * to already contain fully assembled. T-7.11 is where those crop-windows
 * turn into `Phaser.Texture.add()` frames and an actual renderer, exactly
 * as `House.ts` does for `HOUSE_BUILDINGS` today.
 * ------------------------------------------------------------------ */

export const OBJ_MAPLE_TREE: SheetSpec = {
  key: 'obj-maple-tree',
  path: `${ASSET_BASE}/obj-maple-tree.png`,
  width: 288,
  height: 192,
  frameWidth: 32,
  frameHeight: 48,
  cols: 9,
  rows: 4,
  note:
    'Row 0 is a growth sequence in spring green then the other seasons ' +
    '(sprout, sapling, young tree, then colour variants); row 1 repeats them ' +
    'mature; row 2 is stumps and acorns; row 3 is white silhouettes. Measured ' +
    'in T-9.05.',
};

export const OBJ_MAPLE_TREE_ANIM: SheetSpec = {
  key: 'obj-maple-tree-anim',
  path: `${ASSET_BASE}/obj-maple-tree-anim.png`,
  width: 128,
  height: 336,
  frameWidth: 32,
  frameHeight: 48,
  cols: 4,
  rows: 7,
  note:
    'One tree per row (young green, mature green/orange/white/deep-green, ' +
    'stump, bare); col 0 plain, col 1 a solid-WHITE silhouette, cols 2-3 the ' +
    'same tree with drifting leaves. Measured in T-9.05 — see MAPLE_TREE.',
};

/**
 * The maple's idle loop (T-9.05), measured pixel by pixel rather than guessed.
 *
 * **There is no sway.** The plan called this a "gentle sway", and the art is
 * not that: differencing the four columns of a row shows the canopy and trunk
 * are IDENTICAL in every frame, and the only changes are 27-odd detached leaf
 * pixels appearing in previously transparent space at different positions.
 * What the pack animates is leaves drifting off the tree, so that is what this
 * plays. (Same class of correction as T-7.05's "autotile blocks": the geometry
 * was right in the earlier note, the *usability* was assumed.)
 *
 * **Column 1 is skipped.** It holds the tree with its canopy filled solid
 * white — five distinct colours in the whole frame — which is a silhouette or
 * flash asset, not the shadow the manifest note used to claim. Playing it
 * would strobe the tree white once a second.
 */
export const MAPLE_TREE = {
  /**
   * The `OBJ_MAPLE_TREE` frame the authored map places (`farm.json`, T-7.06):
   * the YOUNG spring maple, third in the growth row. Frame 0 is a sprout and
   * frame 1 a sapling; the mature trees are a row further down.
   */
  stillFrame: 2,
  /**
   * The `OBJ_MAPLE_TREE_ANIM` row that is pixel-for-pixel identical to that
   * still frame — verified by an exact comparison, zero differing pixels, so
   * animating changes nothing about how the authored map looks at rest.
   */
  animRow: 0,
  /** Columns in loop order: plain, then the two leaf-drift frames. */
  animColumns: [0, 2, 3],
  /**
   * Deliberately slow. These are three fixed leaf positions, not an
   * interpolated fall; at any pace faster than this they read as flicker
   * rather than as a leaf letting go.
   */
  frameRate: 2,
} as const;

/** Absolute frame indices for `MAPLE_TREE`'s loop, in play order. */
export const MAPLE_TREE_ANIM_FRAMES: readonly number[] = MAPLE_TREE.animColumns.map(
  (col) => MAPLE_TREE.animRow * OBJ_MAPLE_TREE_ANIM.cols + col,
);

/**
 * The tiny house kit. Confirmed by connected-component analysis to hold no
 * complete pre-built house among its wall/roof/gable PARTS — those compose
 * a house rather than being one — except for a row of solid single-colour
 * house SILHOUETTES (roof+wall, no door/window) at y=190. `OBJ_TINY_HOUSE_LOOK`
 * is the first of those (a warm wood-grain colour), trimmed tight to its
 * alpha bounds. This is honestly a plainer look than the old pack's `built`
 * (which has a door and window drawn on it) — recorded rather than faked,
 * same as `HOUSE_BUILDINGS`'s own doc comment. Only one look exists here;
 * multi-tier variety is unresolved (still D-nothing — house tiers are a
 * cosmetic bonus, not blocking, per CLAUDE.md §7).
 */
export const OBJ_TINY_HOUSE: ImageSpec = {
  key: 'obj-tiny-house',
  path: `${ASSET_BASE}/obj-tiny-house.png`,
  width: 688,
  height: 368,
};

export const OBJ_TINY_HOUSE_LOOK = { x: 0, y: 190, width: 48, height: 48 } as const;

/**
 * Unlike the house kit, the coop and barn sheets each contain a fully
 * detailed, ready-to-use building (roof, walls, door, and for the barn a
 * lantern) at their top-left — no assembly needed. Crop windows trimmed
 * tight to alpha bounds (`convert -trim`, not eyeballed).
 */
export const OBJ_CHICKEN_COOP: ImageSpec = {
  key: 'obj-chicken-coop',
  path: `${ASSET_BASE}/obj-chicken-coop.png`,
  width: 480,
  height: 224,
};

export const OBJ_CHICKEN_COOP_LOOK = { x: 13, y: 2, width: 55, height: 78 } as const;

export const OBJ_BARN: ImageSpec = {
  key: 'obj-barn',
  path: `${ASSET_BASE}/obj-barn.png`,
  width: 496,
  height: 176,
};

export const OBJ_BARN_LOOK = { x: 7, y: 4, width: 78, height: 76 } as const;

/**
 * Big and Deluxe, the other two tiers of each animal building (T-12.02b).
 *
 * The crop windows come from the same flood-fill that reproduces
 * `OBJ_CHICKEN_COOP_LOOK` and `OBJ_BARN_LOOK` exactly — the opaque blob
 * nearest the top-left of each sheet, which in all six files is one complete,
 * ready-to-use building rather than a kit of parts.
 *
 * T-12.02 measured these and could not place them: the Deluxe coop needs 9x8
 * tiles and the Deluxe barn 8x8, and the authored 20x16 farm had **zero**
 * anchors where either footprint landed on free ground. T-12.02b grew the farm
 * to 30x22 for exactly this, so they are now real `IMAGES` entries with the
 * per-tier tables below.
 */
export const OBJ_CHICKEN_COOP_BIG: ImageSpec = {
  key: 'obj-chicken-coop-big',
  path: `${ASSET_BASE}/obj-chicken-coop-big.png`,
  width: 672,
  height: 288,
};

export const OBJ_CHICKEN_COOP_BIG_LOOK = { x: 0, y: 0, width: 98, height: 96 } as const;

export const OBJ_CHICKEN_COOP_DELUXE: ImageSpec = {
  key: 'obj-chicken-coop-deluxe',
  path: `${ASSET_BASE}/obj-chicken-coop-deluxe.png`,
  width: 720,
  height: 544,
};

export const OBJ_CHICKEN_COOP_DELUXE_LOOK = { x: 3, y: 16, width: 129, height: 128 } as const;

export const OBJ_BARN_BIG: ImageSpec = {
  key: 'obj-barn-big',
  path: `${ASSET_BASE}/obj-barn-big.png`,
  width: 592,
  height: 208,
};

export const OBJ_BARN_BIG_LOOK = { x: 5, y: 1, width: 98, height: 95 } as const;

export const OBJ_BARN_DELUXE: ImageSpec = {
  key: 'obj-barn-deluxe',
  path: `${ASSET_BASE}/obj-barn-deluxe.png`,
  width: 736,
  height: 272,
};

export const OBJ_BARN_DELUXE_LOOK = { x: 16, y: 0, width: 120, height: 128 } as const;

/** A crop window into a sheet, in source pixels. */
export interface LookWindow {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One building's picture: which sheet, and where in it the building is. */
export interface BuildingLook {
  readonly sheet: ImageSpec;
  readonly look: LookWindow;
}

/**
 * Which picture each coop/barn tier draws — **indexed by tier**, so
 * `COOP_TIER_ART[farm.coopTier]` is the whole lookup.
 *
 * Kept beside the windows they are built from rather than next to
 * `COOP_TIERS`/`BARN_TIERS` in `animals.ts`, because these are measurements
 * of art and that file is economy numbers; `config.test.ts` pins that the two
 * lists stay the same length, which is the coupling that actually matters (a
 * fourth tier with no picture would otherwise draw nothing at all).
 */
export const COOP_TIER_ART: readonly BuildingLook[] = [
  { sheet: OBJ_CHICKEN_COOP, look: OBJ_CHICKEN_COOP_LOOK },
  { sheet: OBJ_CHICKEN_COOP_BIG, look: OBJ_CHICKEN_COOP_BIG_LOOK },
  { sheet: OBJ_CHICKEN_COOP_DELUXE, look: OBJ_CHICKEN_COOP_DELUXE_LOOK },
];

export const BARN_TIER_ART: readonly BuildingLook[] = [
  { sheet: OBJ_BARN, look: OBJ_BARN_LOOK },
  { sheet: OBJ_BARN_BIG, look: OBJ_BARN_BIG_LOOK },
  { sheet: OBJ_BARN_DELUXE, look: OBJ_BARN_DELUXE_LOOK },
];

/**
 * 8 colour variants x 2 states (closed row 0, open row 1) — a clean 32x16
 * grid, unlike the house/coop/barn kits. Gid-addressable: T-7.06 can place
 * any (colour, state) pair directly by picking its frame index.
 */
export const OBJ_CHEST: SheetSpec = {
  key: 'obj-chest',
  path: `${ASSET_BASE}/obj-chest.png`,
  width: 256,
  height: 32,
  frameWidth: 32,
  frameHeight: 16,
  cols: 8,
  rows: 2,
};

/**
 * Not a uniform grid (a wide "main" crate beside a narrower crate, in a
 * closed pose over an open pose — confirmed by per-row alpha-column
 * analysis, not assumed from a clean division of the file size).
 * `OBJ_SHIPPING_BOX_LOOK` is the wide closed-box pose.
 *
 * **The window is 16 wide, NOT 29 — do not "re-trim" it to alpha bounds.**
 * The closed poses sit flush against each other with no transparent column
 * between them, so trimming this row to its alpha bounds yields a single
 * opaque run x=0..28 that silently contains TWO crates; T-7.11 shipped that
 * for a moment and the farm drew a double-wide box. The real boundary shows
 * up in the alpha VALUE, not its presence: columns 0-15 sum to 3570/3825 per
 * column and 16-28 to 4080, and the third crate is a separate run at
 * x=35..47. Cell 0 alone is the pose we want.
 */
export const OBJ_SHIPPING_BOX: ImageSpec = {
  key: 'obj-shipping-box',
  path: `${ASSET_BASE}/obj-shipping-box.png`,
  width: 48,
  height: 64,
};

export const OBJ_SHIPPING_BOX_LOOK = { x: 0, y: 16, width: 16, height: 16 } as const;

/** 2 frames (closed/open), a clean 16x32 grid — gid-addressable directly. */
/**
 * The merchant's stall (T-11.04) — where buying and selling happen now that
 * the shop is a place rather than a button.
 *
 * A single 32x48 pose, so an `ImageSpec` rather than a sheet: the file holds
 * one stand, not a grid (alpha bounds (1,5)-(30,40), i.e. the art fills two
 * tiles across and a little over two down, standing on the bottom edge like
 * every other map object).
 *
 * There is no merchant CHARACTER. The pack's NPC sheets are full walk cycles
 * for people who would need somewhere to walk; a stall is a thing you stand at,
 * which is exactly the interaction this needs.
 */
export const OBJ_NEWSSTAND: ImageSpec = {
  key: 'obj-newsstand',
  path: `${ASSET_BASE}/obj-newsstand.png`,
  width: 32,
  height: 48,
};

export const OBJ_MAILBOX: SheetSpec = {
  key: 'obj-mailbox',
  path: `${ASSET_BASE}/obj-mailbox.png`,
  width: 32,
  height: 32,
  frameWidth: 16,
  frameHeight: 32,
  cols: 2,
  rows: 1,
};

/* ------------------------------------------------------------------ *
 * Item icons — new pack (T-7.09)
 *
 * Every file under `Icons/Food Icons/` (and the animal-face sheet under
 * `Icons/Farm Animals/`, which turned out to hold only animal-identity
 * portraits — cows/pigs/ducks/chickens/sheep faces, no produce or feed icons
 * at all, checked by eye against the full sheet before ruling it out) is a
 * single-row 32x16 PNG: two 16x16 frames, confirmed by per-frame alpha-mask
 * inspection to be a near-identical "idle bob" pair (frame 1 is the same
 * artwork shifted down/out by ~1px from frame 0 on every icon checked —
 * Chicken Egg, Small Cow Milk, Animal Feed, Wheat, Apple, Broccoli), not two
 * distinct icons. Frame 0 is used throughout as the stack's static icon.
 *
 * `egg` and `milk` map directly (Chicken Egg, Small Cow Milk). Neither
 * `Icons/Food Icons/` nor `Icons/Farm Animals/` contains a file named "Hay"
 * anywhere in the pack (confirmed by a recursive filename search) — Wheat is
 * the closest in-folder match for the game's `hay` feed item, the same
 * "closest match, keep the game's item id" reasoning `CROP_LEEK` already
 * documents for Spring Onion. `Objects/Exterior/Hay Bales.png` (a literal
 * hay bale) exists but lives outside the two folders this task's Do
 * specifies, so it was not used.
 * ------------------------------------------------------------------ */

export const ICON_CHICKEN_EGG: SheetSpec = {
  key: 'icon-chicken-egg',
  path: `${ASSET_BASE}/icon-chicken-egg.png`,
  width: 32,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 2,
  rows: 1,
};

export const ICON_COW_MILK: SheetSpec = {
  key: 'icon-cow-milk',
  path: `${ASSET_BASE}/icon-cow-milk.png`,
  width: 32,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 2,
  rows: 1,
};

export const ICON_ANIMAL_FEED: SheetSpec = {
  key: 'icon-animal-feed',
  path: `${ASSET_BASE}/icon-animal-feed.png`,
  width: 32,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 2,
  rows: 1,
};

export const ICON_WHEAT: SheetSpec = {
  key: 'icon-wheat',
  path: `${ASSET_BASE}/icon-wheat.png`,
  width: 32,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 2,
  rows: 1,
  note: "Source art is Wheat — closest match for the game's hay feed item (CLAUDE.md §9); no file literally named Hay exists in Icons/Food Icons or Icons/Farm Animals.",
};

/** Frame index shared by every icon sheet above (see the module comment). */
export const ITEM_ICON_FRAME = 0 as const;

/* ------------------------------------------------------------------ *
 * Tools — new pack (T-7.04)
 *
 * Wood tier only (D-4 undecided — see CLAUDE.md §14). 2 frames each; T-8.06
 * picks which is the inventory icon.
 * ------------------------------------------------------------------ */

export const TOOL_HOE_WOOD: SheetSpec = {
  key: 'tool-hoe-wood',
  path: `${ASSET_BASE}/tool-hoe-wood.png`,
  width: 32,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 2,
  rows: 1,
};

export const TOOL_WATERING_CAN_WOOD: SheetSpec = {
  key: 'tool-watering-can-wood',
  path: `${ASSET_BASE}/tool-watering-can-wood.png`,
  width: 32,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 2,
  rows: 1,
};

/* ------------------------------------------------------------------ *
 * UI — new pack (T-7.04)
 *
 * Whole-image kits, not sliced: each is a sheet of many differently-sized
 * elements (button states, slot frames, HUD panel pieces), and no Phase 7
 * task needs a specific one yet. T-10.04a (inventory panel) and T-11.05
 * (HUD reskin) are where specific crop-windows get measured and named,
 * mirroring how the house/coop/barn kits work above.
 * ------------------------------------------------------------------ */

export const UI_INVENTORY_BOOK: ImageSpec = {
  key: 'ui-inventory-book',
  path: `${ASSET_BASE}/ui-inventory-book.png`,
  width: 256,
  height: 288,
};

export const UI_INVENTORY_SLOTS: ImageSpec = {
  key: 'ui-inventory-slots',
  path: `${ASSET_BASE}/ui-inventory-slots.png`,
  width: 224,
  height: 288,
};

/**
 * The two single-slot squares inside `UI_INVENTORY_SLOTS`, for the hotbar
 * (T-8.07).
 *
 * **Measured, not guessed** (CLAUDE.md §9): the sheet is not a uniform grid —
 * it holds framed panels, ready-made bars and a scatter of loose pieces, so
 * there is no frame size that slices it. Connected-component analysis of its
 * alpha channel found ten shapes; four of them are 18×18 squares, in two
 * colours at two slightly different bottom shadings. `idle` and `selected` are
 * the top pair: identical geometry, mean RGB (158,77,30) versus (175,108,64),
 * i.e. the same square lit and unlit. That is exactly a hotbar's two states.
 *
 * The pack also ships complete 8- and 9-slot bars (the two widest shapes on
 * the sheet). They are unused: the hotbar is **twelve** slots, so it is built
 * by repeating this one square rather than by stretching art that says nine.
 *
 * Coordinates are source pixels within the sheet. The hotbar multiplies them
 * by its own integer scale and hands them to CSS as custom properties — so
 * these numbers are written once, here, and never duplicated in a stylesheet.
 */
export const UI_SLOT = {
  size: 18,
  idle: { x: 151, y: 6 },
  selected: { x: 182, y: 6 },
} as const;

/**
 * The spinning coin beside the gold total (T-11.05).
 *
 * `ui-money.png` is 96x16: **six 16px frames of one coin turning**, measured
 * rather than assumed — the opaque pixel count runs 52, 44, 36, 28, 36, 44,
 * which is a coin rotating edge-on and back, not six different coins.
 */
export const UI_COIN = {
  size: 16,
  frames: 6,
  /** Slow enough to read as a glint rather than a fidget. */
  fps: 8,
} as const;

/**
 * Icons picked out of `ui-hud.png` (T-11.05).
 *
 * **The sheet is an icon GRID, not a bar frame.** The plan said "reskin the top
 * bar with UI/HUD.png"; the file is 26x6 cells of 16x16 — cursors, arrows,
 * books, speakers, coins, ticks — with nothing in it that frames a bar. Grid
 * alignment verified rather than assumed: of the 25 vertical seams between
 * cells, exactly one has opaque pixels on both sides, so the icons sit in their
 * cells and a cell can be addressed by multiplying.
 *
 * Coordinates are the cell's top-left in source pixels.
 */
export const UI_ICON = {
  size: 16,
  /** Row 2, column 3: a leather satchel. The Bag button's icon. */
  bag: { x: 48, y: 32 },
} as const;

export const UI_HUD: ImageSpec = {
  key: 'ui-hud',
  path: `${ASSET_BASE}/ui-hud.png`,
  width: 416,
  height: 96,
};

export const UI_MONEY: ImageSpec = {
  key: 'ui-money',
  path: `${ASSET_BASE}/ui-money.png`,
  width: 96,
  height: 16,
};

export const UI_BUTTON: ImageSpec = {
  key: 'ui-button',
  path: `${ASSET_BASE}/ui-button.png`,
  width: 848,
  height: 544,
};

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

export const SHEETS = [
  // New pack (T-7.04).
  TILESET_GRASS_SPRING,
  TILESET_SOIL,
  TILESET_GRASS_WATER_SPRING,
  TILESET_PATHS,
  ...ANIMAL_SHEETS,
  CROP_POTATO,
  CROP_STRAWBERRY,
  CROP_ONION,
  CROP_LEEK,
  ICON_CHICKEN_EGG,
  ICON_COW_MILK,
  ICON_ANIMAL_FEED,
  ICON_WHEAT,
  OBJ_MAPLE_TREE,
  OBJ_MAPLE_TREE_ANIM,
  OBJ_CHEST,
  OBJ_MAILBOX,
  TOOL_HOE_WOOD,
  TOOL_WATERING_CAN_WOOD,
] as const satisfies readonly SheetSpec[];

export const IMAGES = [
  // New pack (T-7.04).
  WATER_TILE,
  OBJ_TINY_HOUSE,
  OBJ_CHICKEN_COOP,
  OBJ_CHICKEN_COOP_BIG,
  OBJ_CHICKEN_COOP_DELUXE,
  OBJ_BARN,
  OBJ_BARN_BIG,
  OBJ_BARN_DELUXE,
  OBJ_SHIPPING_BOX,
  OBJ_NEWSSTAND,
  UI_INVENTORY_BOOK,
  UI_INVENTORY_SLOTS,
  UI_HUD,
  UI_MONEY,
  UI_BUTTON,
  // New pack (T-7.05) — first-party ground fills, see GROUND_GRASS's comment.
  GROUND_GRASS,
  GROUND_SOIL_DRY,
  GROUND_SOIL_WET,
  GROUND_PATH,
] as const satisfies readonly ImageSpec[];

/** World tile size in source pixels. Everything on the farm grid is 16px. */
export const TILE_SIZE = 16 as const;

/** Integer upscale used by the game camera. Never use a fractional zoom on pixel art. */
export const PIXEL_SCALE = 3 as const;
