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
 * of `assets/Tileset/` with no transform (T-7.02) — clean transparent
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

/**
 * Tilled and wet soil, as **self-contained rounded clod stamps** — NOT an
 * autotile set.
 *
 * The note here used to say "autotile blocks", and that sentence cost real
 * time twice. T-7.05 disproved it once; the wording survived, and the field was
 * later hand-painted with a 3x3 nine-slice out of cols 1-3 — which is exactly
 * what you would do if the description were true.
 *
 * **Measured, not argued.** Every cell carries the dark `#9d4c46`/`#6e3539`
 * outline on at least one edge, and the supposed centre tile (row 1, col 2) has
 * two outline pixels in each of its four corners. Butt four of those together
 * and the eight corner pixels meet at the junction, so a tiled field shows a
 * dark dot at every 16px intersection: all 31 internal seams of that 5x4
 * arrangement carried outline pixels. Two further checks agree — 14 distinct
 * quadrant images per corner position where a real set has about five, and
 * exactly one tile in 48 with all four edges flush.
 *
 * The sheet is fine for what it is: six rounded 64x64 patch stamps per band,
 * for the mapmaker's stamp tool. It cannot supply edges. Runtime soil is
 * `GROUND_SOIL_TILES` below, synthesised precisely because this cannot do it.
 */
export const TILESET_SOIL: SheetSpec = {
  key: 'tileset-soil',
  path: `${ASSET_BASE}/tileset-soil.png`,
  width: 384,
  height: 128,
  frameWidth: 16,
  frameHeight: 16,
  cols: 24,
  rows: 8,
  note: 'Rounded soil PATCH STAMPS, not autotile blocks — see the comment above.',
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

/**
 * Every season's ground props in horizontal bands (T-18.09).
 *
 * The farm's `decor` tile layer had been empty since the map was authored, and
 * the reason is in the note below `GROUND_GRASS`: `TILESET_GRASS_SPRING` holds
 * rounded autotile patches, never loose scatter. Measured here rather than
 * assumed — every one of its 264 cells was profiled for alpha coverage and
 * bounding box, and the spring tufts (row 0) and stones (row 6) are the only
 * bands that are both self-contained and FLAT.
 *
 * **Flat is the whole constraint.** The decor layer draws at `DEPTH.decor`,
 * below every world sprite, so anything with height put here is drawn behind
 * the player from every angle including in front of it. The sheet's standing
 * flowers, mushrooms and driftwood are therefore deliberately unused: they
 * would have to be `DecorPiece`s sorting on their own feet. `GROUND_SCATTER`
 * in `farmLayout.ts` is the list that was actually picked, with the reasoning.
 *
 * Appended at the END of `SHEETS` on purpose. `TILESET_RUNS` allocates
 * `firstgid` by walking `SHEETS` then `IMAGES` in declared order, so inserting
 * anywhere else renumbers every tileset after it — the failure that made maple
 * trees render as milk bottles in T-7.09 and the shipping box vanish in T-8.03.
 */
export const TILESET_PROPS_SEASONS: SheetSpec = {
  key: 'tileset-props-seasons',
  path: `${ASSET_BASE}/tileset-props-seasons.png`,
  width: 352,
  height: 192,
  frameWidth: 16,
  frameHeight: 16,
  cols: 22,
  rows: 12,
  note: 'Seasonal ground props. Only the flat spring tufts and stones are used — see GROUND_SCATTER.',
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

/* ------------------------------------------------------------------ *
 * Ground, painted from the pack (MVP re-scope)
 *
 * **This replaces five first-party tiles, and the reason is a measurement
 * that changed.** T-7.05 examined the pack's tilesets, found *"only
 * self-contained rounded patches — never art that fills its cell edge to
 * edge"*, and had the game draw its own flat ground instead
 * (`scripts/draw-ground-tiles.py` → `original-assets/ground/`). That was
 * measured on the INCOMPLETE copy of the pack. The complete one has whole
 * fully-opaque bands and pure single-colour fills, so the ground comes from
 * the pack and the stand-ins are gone.
 *
 * Every frame number below is measured — `node scripts/measure-terrain.mjs`,
 * recorded in `docs/art-measurements.md`. Nothing here is a guess about a
 * layout, which is what the deleted comment turned out to be.
 * ------------------------------------------------------------------ */

/**
 * The farm's base ground: the flat light-grass tile in `TILESET_GRASS_SPRING`.
 *
 * `#79bf56`, fully opaque and a single colour, at tile (9,2). That is exactly
 * the colour the hand-drawn `ground-grass.png` was sampled as — the stand-in
 * was taken from this sheet in the first place, which is a useful check that
 * this is the right tile rather than merely a green one.
 */
export const GRASS_FILL_FRAME = 57 as const;

/**
 * The tillable field, before a hoe touches it.
 *
 * The orange band of `TILESET_GRASS_SPRING` — rows 8-15, the sheet's only
 * fully-opaque *coloured* band — with its flat fill at tile (9,14), `#ee9d51`.
 * Drawn under the plots so a plantable tile reads as plantable before it is
 * tilled, rather than being grass that happens to accept a hoe.
 */
export const TILLABLE_FILL_FRAME = 345 as const;

/**
 * The path's flat fill, in `TILESET_PATHS` — `#9e8d70`, tile (9,2).
 *
 * **The same tile position as the grass fill**, which is not a coincidence:
 * the pack lays every 12-column terrain block out identically and puts the
 * centre fill at (9,2). Worth knowing before measuring the next one.
 */
export const PATH_FILL_FRAME = 57 as const;

/** Frames per state: one for each value of the 4-bit neighbour mask. */
export const SOIL_TILE_MASKS = 16 as const;

/**
 * Tilled soil, by neighbour mask, straight out of `TILESET_SOIL`
 * (`Tilled Soil and wet soil.png`).
 *
 * **The pack ships a complete 4x4 wang set** at cols 0-3, rows 0-3 — all
 * sixteen masks, no gaps — and the wet set is the identical layout twelve
 * columns to the right. So the whole edge system is the pack's own art, where
 * before it was sixteen frames generated by a Python script because the
 * incomplete pack appeared not to have them.
 *
 * Index is the mask, bit order `N E S W` (bit 3 = north), matching
 * `soilMask` in `plots.ts`. The mask is over "is tilled", NOT "is tilled and
 * equally wet", so a watered plot inside a dry field is a colour change with
 * no rim: the soil is continuous, the wetness is not.
 */
export const SOIL_DRY_FRAMES: readonly number[] = [
  72, 75, 0, 3, 73, 74, 1, 2, 48, 51, 24, 27, 49, 50, 25, 26,
];

/**
 * The wet set — **brown, not the pack's blue**.
 *
 * `Tilled Soil and wet soil.png` holds four blocks: brown `#be6d47` and dark
 * brown `#9d4c46` side by side, and a blue-violet pair below them. The blue is
 * the pack's own "wet soil" and it is **not used**: T-15.29 tried exactly that
 * colour and found it *"read as shallow water on a watered plot"*, and
 * hand-darkened the dry soil instead. The pack's darker brown is the same
 * answer its artist reached, so the hand-drawn tile is no longer needed.
 *
 * Same layout as dry, shifted twelve columns right.
 */
export const SOIL_WET_FRAMES: readonly number[] = [
  84, 87, 12, 15, 85, 86, 13, 14, 60, 63, 36, 39, 61, 62, 37, 38,
];

/**
 * Animated water, for the backdrop the map floats on.
 *
 * Four frames stacked four rows apart, each with a flat `#0092dd` fill — the
 * same colour as `WATER_TILE`, so a still tile and an animated one cannot
 * disagree about what water looks like.
 */
export const TILESET_WATER_ANIM: SheetSpec = {
  key: 'tileset-water-anim',
  path: `${ASSET_BASE}/tileset-water-anim.png`,
  width: 384,
  height: 256,
  frameWidth: 16,
  frameHeight: 16,
  cols: 24,
  rows: 16,
  note: 'Water Ground animations tiles.png — 4 frames of 4 rows each.',
};

/**
 * The four frames of one tile of **open water**, in order.
 *
 * **Not the sheet's flat fill, and that mistake is worth recording.** The
 * obvious pick was the flat `#0092dd` cell at (21,2) — the same tile
 * `WATER_TILE` is. But comparing each cell against its counterpart in the
 * other three blocks shows 92 cells animate and **the flat fill is not one of
 * them**: it is a solid colour in all four frames. Animating it renders four
 * identical images, which is exactly as still as not animating at all.
 *
 * This is cell (18,1) — open water with a moving sparkle, fully opaque and
 * only six colours, so it repeats across a whole screen without reading as a
 * pattern.
 */
export const WATER_ANIM_FRAMES: readonly number[] = [42, 138, 234, 330];

/** How fast the water loops. Slow: this is a backdrop, not a focal point. */
export const WATER_ANIM_FPS = 4 as const;

/*
 * **`Tileset Grass Cliff Tileset Spring.png` is deliberately NOT here.**
 *
 * It was added with the water and then removed the same day. Its art is the
 * transition from a grass top to a cliff FACE — it edges a change in height,
 * and the farm is flat, so there is nothing for it to edge. Measured, it also
 * carries the same two grass tones and the same flat fill position as
 * `TILESET_GRASS_SPRING`, so it adds no ground the farm does not already have.
 *
 * Listing it would have shipped it inert, which is the one thing this
 * roadmap's own rule forbids. It comes back the day the map gains elevation.
 */

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
 * (`assets/Character/Character/PNG/<folder>/<layer>/<variant>.png`).
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
  /** Folder name under `assets/Character/Character/PNG/`. */
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
 * The 8 MVP animations. Frame counts and strip widths measured directly from
 * the source PNGs (`identify`); do not guess if art is re-exported — a wrong
 * `framesPerDirection` here misaligns the whole strip and desyncs directions
 * that the config test cannot catch by width alone if the miscount and the
 * strip width are wrong together, so read this from the art, not the total.
 *
 * `plant`, `harvest` and `pet` joined in T-16.02. Until then `swingForKind`
 * returned null for planting and harvesting and animal actions swung nothing
 * at all, because the only strips wired were hoe and watering — the pack ships
 * ~45 animation folders and five had ever been looked at. All three were
 * measured the same way as the originals, and every layer file inside each
 * folder was confirmed to share one size before any number here was written.
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
  /*
   * Chopping (T-20.04). `5. Axe and Sickle`, WITH its `Weapons/Axe` overlay —
   * unlike `plant` below, the player really is holding the thing.
   *
   * Measured, not copied from `hoe`: every layer file in the folder is 768x32,
   * which is 24 frames over four directions, six per direction — the same
   * geometry the hoe happens to have. `fps: 10` matches the other two tool
   * swings so a chop reads as the same class of action.
   */
  axe: {
    key: 'axe',
    sourceFolder: '5. Axe and Sickle',
    framesPerDirection: 6,
    width: 768,
    fps: 10,
    loop: false,
  },
  /*
   * Planting (T-16.02). The pack has no "plant a seed" animation; `6. Shovel`
   * is the crouch-lean-rise that reads as putting something into the ground,
   * and it is used WITHOUT its `Weapons/Shovel` overlay on purpose — see
   * `TOOL_ANIMS`. Body only, so the character's hands stay empty and no
   * item the player does not own appears on screen.
   */
  plant: {
    key: 'plant',
    sourceFolder: '6. Shovel',
    framesPerDirection: 5,
    width: 640,
    fps: 9,
    loop: false,
  },
  /*
   * Harvesting. `13.3 Carrying - Pick Up` is bend, take, straighten, hold —
   * which is what harvesting by empty hand (§5.2) actually looks like. It has
   * no weapon folder at all, so there is nothing to suppress.
   */
  harvest: {
    key: 'harvest',
    sourceFolder: '13.3 Carrying - Pick Up',
    framesPerDirection: 4,
    width: 512,
    fps: 8,
    loop: false,
  },
  /*
   * Collecting from and feeding an animal. `20. Petting` is a kneel and a
   * reach — three frames, the shortest strip in the game, so `fps` is set low
   * enough that `charAnimDurationMs` yields a swing long enough to read as a
   * deliberate action rather than a twitch. That is the whole reason the
   * number is 6 and not the 10 the two tool anims use.
   */
  pet: {
    key: 'pet',
    sourceFolder: '20. Petting',
    framesPerDirection: 3,
    width: 384,
    fps: 6,
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
 *
 * **`plant` is the deliberate exception, and it stays out (T-16.02).** Its
 * source folder `6. Shovel` DOES ship a `Weapons/Shovel` strip of matching
 * geometry, so adding it here would work. It must not be added: there is no
 * shovel item, tools in this game are items you own and equip (§5.2), and the
 * hand holding a seed packet would sprout an implement that is in nobody's
 * backpack. `harvest` and `pet` have no weapon folder at all, so the rule is
 * only ever tempting for `plant` — which is exactly why it is written down.
 */
export const TOOL_ANIMS = ['hoe', 'watering', 'axe'] as const satisfies readonly CharAnimKey[];
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
 * Chicken pose rows, named (T-15.10).
 *
 * T-7.10 described these rows; this names them so `poseRowFor` can select one
 * without a caller writing `3` and hoping. The semantics are T-7.10's, above.
 */
export const ANIMAL_CHICKEN_POSE_ROWS = {
  idle: 0,
  idleAlt: 1,
  idleAlt2: 2,
  peck: 3,
  peckDeep: 4,
  nest: 5,
  lieDown: 6,
} as const;

/**
 * **D-10, decided by measurement (T-15.10): the chicken sheet has no facings.**
 *
 * `node scripts/measure-animal-rows.mjs` runs three mechanical tests, and all
 * three agree:
 *
 *   - MIRROR TEST — no row is any other row flipped horizontally (every pair
 *     differs by far more than the 2% "same image" threshold). If the sheet
 *     drew left and right explicitly, exactly one pair would have matched.
 *   - SELF-SYMMETRY — every row's frame 0 differs from its own mirror by
 *     70-75%. A front or back view is close to symmetric; these are all side
 *     views.
 *   - WIDTH — every row measures 13-14px wide. A head-on chicken would be
 *     visibly narrower than one seen side-on. (Contrast the cow sheet below,
 *     where this test separates 22px side views from 13px front/back views
 *     immediately.)
 *
 * So rows 0-2 are three cosmetic look-angle variants of the same side-facing
 * pose, not down/up/side. A chicken that needs to face right is the same row
 * with `setFlipX`, and one that needs to face up or down reuses the side pose —
 * which at T-15.12's wander radius of a few pixels is invisible anyway.
 */
export const ANIMAL_CHICKEN_MIRRORS_SIDE = true as const;

/**
 * Null, and that is the finding rather than a gap: see
 * `ANIMAL_CHICKEN_MIRRORS_SIDE`. Typed so a future sheet that DOES carry
 * per-direction rows has somewhere to put them.
 */
export const ANIMAL_CHICKEN_FACING_ROWS: Readonly<Record<string, number>> | null = null;

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

/**
 * Cow pose rows, named (T-15.10). Semantics are T-7.10's, above.
 *
 * **Unlike the chickens, the cow sheet really does carry front and back views**,
 * and the width test says so without ambiguity: rows 0/3/5/7 measure 22-25px
 * wide (side views) while rows 1/2/4/6/8 measure exactly 13px (head-on and
 * tail-on). That is the whole reason `poseRowFor` takes a facing at all.
 */
export const ANIMAL_COW_POSE_ROWS = {
  walkSide: 0,
  walkFront: 1,
  walkBack: 2,
  lieSide: 3,
  lieFront: 4,
  lieSideHigh: 5,
  lieBack: 6,
  chewSide: 7,
  chewBack: 8,
} as const;

/**
 * The cow's side views face LEFT, so drawing one facing right means flipping.
 *
 * Measured (T-15.10): no cow row is any other row mirrored, so the sheet does
 * not carry both side facings — there is exactly one, and T-7.10 read it as
 * left-facing. Right is `setFlipX`.
 */
export const ANIMAL_COW_MIRRORS_SIDE = true as const;

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
 * Crops — Phase 31 (T-31.02)
 *
 * Sixteen sheets in ONE append, which is the entire point of this task: gids
 * are a running sum over `SHEETS` then `IMAGES` (`tilesets.ts`), so every
 * touch of `SHEETS` renumbers every `IMAGES` firstgid and forces `farm.json`
 * to be regenerated. Adding these one crop at a time would pay that cost
 * sixteen times.
 *
 * **Every number below is measured, not typed** — `docs/crop-sheets.md`
 * (T-31.01) records all thirty candidate sheets and
 * `node scripts/measure-crops.mjs --md` regenerates it. What the measurement
 * overturned matters here: the pack is NOT uniformly 8-frame-per-season, so
 * `cols` varies (8 for spring and two fall sheets, 10 for summer and the rest
 * of fall) and `Bell Pepper` alone has 11.
 *
 * **Nothing references these yet.** T-31.04 writes the `CropDef`s. They are
 * loaded from the moment they are listed here, because `Preload` walks
 * `SHEETS` — that is the deliberate cost of the one-append rule, and it is
 * sixteen small PNGs.
 *
 * **Two exclusions, both deliberate and both from the measurement.** The eight
 * 16x32 sheets are out because the crop sprite is centred on its tile
 * (`Farm.ts`), so a 32px frame hangs half into the tile below — tall crops
 * need a per-crop anchor, which is code, and this phase is config and art.
 * `Bell Pepper` is out because no frame in it touches the bottom row, so its
 * baseline differs from every other sheet's.
 * ------------------------------------------------------------------ */

export const CROP_ASPARAGUS: SheetSpec = {
  key: 'crop-asparagus',
  path: `${ASSET_BASE}/crop-asparagus.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
};

export const CROP_BROCCOLI: SheetSpec = {
  key: 'crop-broccoli',
  path: `${ASSET_BASE}/crop-broccoli.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
};

export const CROP_CABBAGE: SheetSpec = {
  key: 'crop-cabbage',
  path: `${ASSET_BASE}/crop-cabbage.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
};

export const CROP_CARROT: SheetSpec = {
  key: 'crop-carrot',
  path: `${ASSET_BASE}/crop-carrot.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
};

export const CROP_CAULIFLOWER: SheetSpec = {
  key: 'crop-cauliflower',
  path: `${ASSET_BASE}/crop-cauliflower.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
};

export const CROP_PARSNIP: SheetSpec = {
  key: 'crop-parsnip',
  path: `${ASSET_BASE}/crop-parsnip.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
};

export const CROP_RICE: SheetSpec = {
  key: 'crop-rice',
  path: `${ASSET_BASE}/crop-rice.png`,
  width: 128,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 8,
  rows: 1,
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
 * The stump left behind by chopping (T-20.04).
 *
 * Frame 18 — the first cell of row 2, which `OBJ_MAPLE_TREE`'s note has
 * recorded as "stumps and acorns" since T-9.05. Verified rather than trusted:
 * frames 19, 20 and 21 are all distinct siblings (20 wears snow), and 18's art
 * spans crop x 9..22 — a 14px stump that lands squarely on the maple's measured
 * 12px trunk (`OBJ_COLLISION_BASE`), so the stump stands exactly where the
 * tree's base stood.
 *
 * On the STILL sheet, not the animated one: a stump has no leaves to drop.
 */
export const MAPLE_STUMP_FRAME = 18 as const;

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
 * The stall is the COUNTER; the shopkeeper who stands at it is
 * `NPC_MERCHANT_IDLE` below (T-18.02). T-11.04 shipped the stall alone and
 * argued a full walk cycle needed somewhere to walk and a reason to be there —
 * true of a villager with a schedule, but a vendor who stands at their own
 * stall all day needs neither, and one idle pose is all that costs.
 */
export const OBJ_NEWSSTAND: ImageSpec = {
  key: 'obj-newsstand',
  path: `${ASSET_BASE}/obj-newsstand.png`,
  width: 32,
  height: 48,
};

/**
 * The shopkeeper standing at the stall (T-18.02) — the pack's premade
 * blacksmith "Alaric", `Character/NPC'S/Blacksmith/Premade/Alaric`.
 *
 * **An `ImageSpec`, not a `SheetSpec`, and that is deliberate.** The file is a
 * 16-frame strip and would slice cleanly, but every `SheetSpec` gets a
 * `TILESET_RUNS` allocation, and inserting one shifts every `firstgid` after it
 * in a `farm.json` that must not be regenerated (D-13/T-15.00). Loaded as a
 * whole image and cropped into named frames — the same technique
 * `registerDecorFrames` and the per-tier coop art already use — it appends to
 * the END of `IMAGES` and moves nothing.
 *
 * **Geometry measured, not assumed** (§9): 512x32 = 16 frames of 32x32, four
 * per direction block. Block 0 shows both eyes head-on, block 1 the back of the
 * head; the alpha bbox bottom is row 26 in all sixteen frames — identical to
 * the player's `CHAR_ART.bottom`, so `CHAR_ORIGIN` puts this character's feet
 * on its position too.
 *
 * Only the DOWN block is used. The left/right blocks are the pair `assets.ts`
 * warns is routinely mis-labelled, and there is no tool frame here to settle it
 * the way the watering can settles it for the player — so rather than record a
 * guess, this registers the one block that is unambiguous. A vendor facing the
 * customer is also the only pose the interaction needs.
 */
export const NPC_MERCHANT_IDLE: ImageSpec = {
  key: 'npc-merchant-idle',
  path: `${ASSET_BASE}/npc-merchant-idle.png`,
  width: 512,
  height: 32,
};

/** Frames in the merchant's idle loop — the `down` block, measured above. */
export const NPC_MERCHANT_IDLE_FRAMES = 4 as const;

/** Playback rate for that loop. Slow: a shopkeeper shifting their weight. */
export const NPC_MERCHANT_IDLE_FPS = 4 as const;

/**
 * The Chef (T-33.03) — the second face in the village.
 *
 * **The same geometry as the shopkeeper, measured rather than assumed**: 512x32
 * = 16 frames of 32x32, four per direction block, and the alpha bottom is row 25
 * in all sixteen — identical to `NPC_MERCHANT_IDLE` and to the player's
 * `CHAR_ART.bottom`, so `CHAR_ORIGIN` puts this character's feet on its position
 * too. The top row is 2 rather than 5, which is the chef's hat and nothing else.
 *
 * Block 0 is the front view here as well: rendering blocks 0 and 1 side by side
 * shows a face in the first and the back of a head in the second, and blocks 2/3
 * measure 15px wide against block 0's 17 — the narrow pair being the side views,
 * which is the same signature the shopkeeper has.
 *
 * **There is no `NPC_BLACKSMITH_IDLE`, and that is a finding rather than an
 * omission** (D-28). The pack ships two premade townsfolk, Gaston and Alaric,
 * and `npc-merchant-idle.png` is already a copy of Alaric — so a blacksmith
 * placed today would be the shopkeeper's twin standing in a field.
 */
export const NPC_CHEF_IDLE: ImageSpec = {
  key: 'npc-chef-idle',
  path: `${ASSET_BASE}/npc-chef-idle.png`,
  width: 512,
  height: 32,
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

/**
 * Seed packets (T-16.01) — `Icons/RPG icons/Extras/Bags.png`, seven 16x16
 * sacks on one strip, one picked per crop via `CropDef.seedBagFrame`.
 *
 * **This is the one icon in the game that must NOT look like the thing it
 * becomes.** Until T-16.01 a seed's inventory icon was `CROPS[crop].seedFrame`,
 * which is the same number as `stageFrames[0]` — so the packet in the hotbar
 * and the sprout in the soil were literally the same frame of the same sheet,
 * and a full backpack of seeds looked like a row of tiny planted crops.
 *
 * The pack ships no seed art at all (searched: no file matching *seed* under
 * `assets/`), so a coloured sack is a stand-in rather than a match — the
 * same "closest match, keep the item id" reasoning `ICON_WHEAT` records for
 * hay. Unlike hay, though, the substitution here is doing real work: the value
 * is in NOT being the crop sheet, so any future swap must preserve that even
 * if it finds better art.
 */
/**
 * The pack's per-crop seed bags, produce icons and signposts, one crop per row
 * (`Crops/All Crops.png`).
 *
 * Replaces `ICON_SEED_BAGS` (`Bags.png`), which held **seven** sacks. That was
 * enough for four crops and not for twenty, and T-31.04 had to weaken "every
 * crop takes a distinct seed bag" into "no bag carries more than
 * `ceil(crops/bags)`". This sheet draws a bag for every crop, so the strong
 * invariant is back.
 *
 * Three column-groups of eight, separated by an empty column. Column 0 of a
 * group is the seed bag, column 2 the produce icon — see
 * `docs/art-measurements.md` for the whole layout and how the crop-to-row
 * mapping is derived rather than typed.
 */
export const ICON_ALL_CROPS: SheetSpec = {
  key: 'icon-all-crops',
  path: `${ASSET_BASE}/icon-all-crops.png`,
  width: 416,
  height: 288,
  frameWidth: 16,
  frameHeight: 16,
  cols: 26,
  rows: 18,
};

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

/**
 * The wood axe (T-20.02) — `Weapons and Armor/1. Wood/Axe.png`.
 *
 * Same 32x16 two-frame strip as the hoe and the can, and the same convention:
 * frame 0 is the plain icon, frame 1 the outlined variant, and `ITEM_ICON_FRAME`
 * picks 0 so tools do not become the only bordered icons in the grid.
 */
export const TOOL_AXE_WOOD: SheetSpec = {
  key: 'tool-axe-wood',
  path: `${ASSET_BASE}/tool-axe-wood.png`,
  width: 32,
  height: 16,
  frameWidth: 16,
  frameHeight: 16,
  cols: 2,
  rows: 1,
};

/**
 * Wood, the thing a tree drops (T-20.02) — `Icons/RPG icons/Extras/Wood.png`.
 *
 * **A 4x3 grid of 16x16, not a 2-frame strip**, and the frames are not what a
 * glance suggests. Measured: 0 and 1 are two plain logs (different shading, NOT
 * duplicates — rows 0 and 1 differ pixel-wise), 2/3/6/7 are the same logs plus
 * a white outline, and 8-11 are flat silhouettes for a shadow or mask pass.
 * Frame 2 is provably frame 0 plus 36 added pixels and nothing removed, which
 * is exactly the outline relationship the tool sheets have — so
 * `ITEM_ICON_FRAME` = 0 stays the right choice here too.
 */
export const ICON_WOOD: SheetSpec = {
  key: 'icon-wood',
  path: `${ASSET_BASE}/icon-wood.png`,
  width: 64,
  height: 48,
  frameWidth: 16,
  frameHeight: 16,
  cols: 4,
  rows: 3,
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

/*
 * **The MVP re-scope asked for a HUD frame from this sheet, and there is not
 * one.** The brief said *"use the HUD images to make the experience more
 * immersive"*; re-measured against the complete pack (which invalidated
 * T-7.05's terrain conclusion, so re-checking was warranted), the sheet is
 * still what T-11.05 found — 26x6 cells of 16x16 icons, every cell occupied,
 * no nine-slice, no bar chrome, no panel corners. The energy bar and the clock
 * therefore take their look from `UI/Bars.png` and `UI/Clock/`, which do hold
 * the art the re-scope described. Recorded here so the next reader does not
 * re-measure it a third time.
 */

export const UI_HUD: ImageSpec = {
  key: 'ui-hud',
  path: `${ASSET_BASE}/ui-hud.png`,
  width: 416,
  height: 96,
};

/**
 * The day/night clock (MVP re-scope).
 *
 * A 32x32 face and a separate 256x32 strip of **eight hand positions**,
 * measured rather than assumed: the opaque centroid of each frame sits at a
 * bearing of roughly 0, 45, 90 ... 315 degrees, going clockwise from straight
 * up. So the frame for a phase is simply the phase times eight, rounded — and
 * a face with only eight positions is why the clock reads as a sundial rather
 * than pretending to a minute hand it does not have.
 */
export const UI_CLOCK: ImageSpec = {
  key: 'ui-clock',
  path: `${ASSET_BASE}/ui-clock.png`,
  width: 32,
  height: 32,
};

export const UI_CLOCK_HAND: SheetSpec = {
  key: 'ui-clock-hand',
  path: `${ASSET_BASE}/ui-clock-hand.png`,
  width: 256,
  height: 32,
  frameWidth: 32,
  frameHeight: 32,
  cols: 8,
  rows: 1,
};

export const CLOCK_HAND_FRAMES = 8 as const;

/**
 * Which hand frame shows a phase of the day.
 *
 * Frame 0 points straight up, which is the top of the cycle — `timeOfDayAt`
 * puts phase 0 there too, so the two agree without an offset constant to get
 * wrong. Rounded, not floored: a hand that only reaches a position once it is
 * fully past it lags the sky it is describing by an eighth of a day.
 */
export function clockHandFrame(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  const wrapped = ((phase % 1) + 1) % 1;
  return Math.round(wrapped * CLOCK_HAND_FRAMES) % CLOCK_HAND_FRAMES;
}

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


/**
 * The farmhouse (T-15.29).
 *
 * A complete house: red-brown tile roof, cream walls, a wooden door, two
 * windows and a stone chimney. `OBJ_TINY_HOUSE` is kept — the furniture
 * catalogue still points its placeholder crops at it — but nothing draws the
 * farm's house from it any more.
 *
 * **Measured, not assumed** (§9): the file is 128x112 with its art in
 * x 2..125, y 13..99. The look below is the tight alpha box, so the sprite
 * carries no transparent margin and its bottom edge really is where the house
 * meets the ground.
 */
export const OBJ_FARMHOUSE: ImageSpec = {
  key: 'obj-farmhouse',
  path: `${ASSET_BASE}/obj-farmhouse.png`,
  width: 128,
  height: 112,
};

export const OBJ_FARMHOUSE_LOOK = { x: 2, y: 13, width: 124, height: 87 } as const;

/**
 * The upgraded farmhouses (T-17.06). `Houses/7.png` and `Houses/8.png`.
 *
 * **The tier gap was never about missing art.** `House.ts` said the upper tiers
 * were "still waiting on art" and that was simply wrong: the pack ships twelve
 * assembled houses, and three of them — 3, 7, 8 — are one brick-and-timber
 * family at increasing size. The other nine are seasonal or themed variants
 * (1 and 4 are the current house with a SNOW-covered roof; 5, 6, 12 are
 * candy-cane; 2 and 9 a forest cottage; 10 a shopfront), which is why "pick
 * three of the twelve" does not work.
 *
 * Measured as tight alpha boxes, like `OBJ_FARMHOUSE_LOOK`:
 *
 * | Tier | File | Look | Tiles |
 * |---|---|---|---|
 * | 0 | `3.png` | 124x87 | 8x6 |
 * | 1 | `7.png` | 124x93 | 8x6 |
 * | 2 | `8.png` | 128x109 | **8x7 — one row taller** |
 *
 * That extra row is what D-20 had to decide; see `HOUSE_ANCHOR`.
 */
export const OBJ_FARMHOUSE_T1: ImageSpec = {
  key: 'obj-farmhouse-t1',
  path: `${ASSET_BASE}/obj-farmhouse-t1.png`,
  width: 128,
  height: 96,
};

export const OBJ_FARMHOUSE_T1_LOOK = { x: 4, y: 3, width: 124, height: 93 } as const;

export const OBJ_FARMHOUSE_T2: ImageSpec = {
  key: 'obj-farmhouse-t2',
  path: `${ASSET_BASE}/obj-farmhouse-t2.png`,
  width: 128,
  height: 128,
};

export const OBJ_FARMHOUSE_T2_LOOK = { x: 0, y: 7, width: 128, height: 109 } as const;

/**
 * The house by tier. `HOUSE_TIER_ART[farm.houseTier]` is the whole lookup.
 *
 * Same shape and same reasoning as `COOP_TIER_ART` / `BARN_TIER_ART` above —
 * measurements of art, kept beside the windows they are built from, with
 * `config.test.ts` pinning that this list and `HOUSE_TIERS` in `economy.ts`
 * stay the same length. A tier with no picture would draw nothing at all.
 */
export const HOUSE_TIER_ART: readonly BuildingLook[] = [
  { sheet: OBJ_FARMHOUSE, look: OBJ_FARMHOUSE_LOOK },
  { sheet: OBJ_FARMHOUSE_T1, look: OBJ_FARMHOUSE_T1_LOOK },
  { sheet: OBJ_FARMHOUSE_T2, look: OBJ_FARMHOUSE_T2_LOOK },
];

/**
 * Where each tier's chimney mouth is, measured (U3-9) — `null` where a tier
 * has no chimney.
 *
 * Offsets from the look window's TOP-LEFT, in source pixels, so a caller adds
 * them to wherever it drew the house.
 *
 * **Two wrong measurements got here before this one, and both looked right.**
 * The first took the highest opaque column in the sprite, which is the ROOF
 * RIDGE — the chimney is shorter than the gable on both houses that have one,
 * so smoke came out of the peak of the roof. The second took the highest
 * *neutral* pixel in the stack's columns, which is four rows low, because a
 * chimney's top row is its dark outline rather than its brick. This one finds
 * the stack by colour (brick is the only near-neutral family on a sprite of
 * red roof, cream wall and cyan glass) and then takes the topmost **opaque**
 * row within those columns.
 *
 * **Tier 2 has no chimney.** `8.png` is a brick house with a round gable
 * window and no stack at all, so it is `null` rather than a guess — a house
 * that smokes from nowhere is worse than a house that does not smoke.
 * `House.ts` stops the plume when the tier changes to one.
 *
 * Indexed by tier like `HOUSE_TIER_ART`, and `ambient.test.ts` pins the two
 * lists the same length: a tier with no entry would smoke from its top-left
 * corner instead of failing.
 */
export const HOUSE_CHIMNEY: readonly ({ readonly x: number; readonly y: number } | null)[] = [
  { x: 12, y: 13 },
  { x: 12, y: 13 },
  null,
];

/* ------------------------------------------------------------------ *
 * Interior — the house (T-16.07)
 *
 * T-3.05 recorded that "`Interior.png` is furniture only — no floor or wall
 * tiles anywhere in the pack", drew the room as a chequered rectangle, and
 * left `FURNITURE_SHEET` pointing at a placeholder. That was true of the OLD
 * pack, deleted in T-7.07. This pack ships `Tileset/Tileset House.png`: 52x24
 * tiles of wall bands and plank floors in about thirteen colourways, one
 * directory over from where anyone looked — the same shape of miss as T-15.29's
 * twelve assembled houses.
 *
 * The tileset is a real tileset and goes in `SHEETS`, because the interior map
 * is painted from it. Everything else here is a KIT — a grid of assembled
 * furniture at varying sizes, like the house/coop/barn exteriors — so they are
 * `IMAGES` with measured crop windows per piece in `furniture.ts`, and being
 * `IMAGES` appended at the end they shift no gids.
 * ------------------------------------------------------------------ */

export const TILESET_HOUSE: SheetSpec = {
  key: 'tileset-house',
  path: `${ASSET_BASE}/tileset-house.png`,
  width: 832,
  height: 384,
  frameWidth: 16,
  frameHeight: 16,
  cols: 52,
  rows: 24,
};

export const INTERIOR_CARPET: ImageSpec = {
  key: 'interior-carpet',
  path: `${ASSET_BASE}/interior-carpet.png`,
  width: 224,
  height: 192,
};

export const INTERIOR_BEDS: ImageSpec = {
  key: 'interior-beds',
  path: `${ASSET_BASE}/interior-beds.png`,
  width: 384,
  height: 512,
};

export const INTERIOR_TABLES: ImageSpec = {
  key: 'interior-tables',
  path: `${ASSET_BASE}/interior-tables.png`,
  width: 512,
  height: 384,
};

export const INTERIOR_CHAIRS: ImageSpec = {
  key: 'interior-chairs',
  path: `${ASSET_BASE}/interior-chairs.png`,
  width: 304,
  height: 224,
};

export const INTERIOR_DRESSERS: ImageSpec = {
  key: 'interior-dressers',
  path: `${ASSET_BASE}/interior-dressers.png`,
  width: 256,
  height: 160,
};

export const INTERIOR_FIREPLACES: ImageSpec = {
  key: 'interior-fireplaces',
  path: `${ASSET_BASE}/interior-fireplaces.png`,
  width: 256,
  height: 256,
};

export const INTERIOR_OPENINGS: ImageSpec = {
  key: 'interior-openings',
  path: `${ASSET_BASE}/interior-openings.png`,
  width: 256,
  height: 256,
};

export const INTERIOR_OTHERS: ImageSpec = {
  key: 'interior-others',
  path: `${ASSET_BASE}/interior-others.png`,
  width: 144,
  height: 112,
};

/**
 * The pack's unlabelled trinket sheet (`Part 1 copiar.png`): framed pictures, a
 * grandfather clock, potted plants, vases and lamps. Nothing in the pack is
 * FILE-named for any of those, which is the whole reason T-3.05 could not find
 * them and invented its own crops instead.
 */
export const INTERIOR_TRINKETS: ImageSpec = {
  key: 'interior-trinkets',
  path: `${ASSET_BASE}/interior-trinkets.png`,
  width: 272,
  height: 192,
};

/**
 * Every interior furniture kit the catalogue draws from.
 *
 * `Sofa and armchair.png` and `Closet.png` are deliberately NOT here. They are
 * in the pack and they are good art, but no piece in `furniture.ts` crops from
 * them, and a registered sheet is a sheet every player downloads — 70KB for
 * nothing. Add the file back the same day a piece needs it.
 */
export const INTERIOR_KITS: readonly ImageSpec[] = [
  INTERIOR_CARPET,
  INTERIOR_BEDS,
  INTERIOR_TABLES,
  INTERIOR_CHAIRS,
  INTERIOR_DRESSERS,
  INTERIOR_FIREPLACES,
  INTERIOR_OPENINGS,
  INTERIOR_OTHERS,
  INTERIOR_TRINKETS,
];

/* ------------------------------------------------------------------ *
 * Placeable decoration (T-15.15)
 * ------------------------------------------------------------------ */

/**
 * Every kit the decor catalogue draws from.
 *
 * All ten are KITS rather than sprites — eight scarecrows, twelve signs, a
 * whole fence construction set — so `config/decor.ts` names a measured window
 * into each rather than drawing the file. Declared as `ImageSpec` and appended
 * to the END of `IMAGES` below, which is the one edit that shifts no gids
 * (see the ORDER IS LOAD-BEARING note there).
 */
export const DECOR_FENCE_WOOD: ImageSpec = {
  key: 'decor-fence-wood',
  path: `${ASSET_BASE}/decor-fence-wood.png`,
  width: 96,
  height: 160,
};

export const DECOR_SCARECROW: ImageSpec = {
  key: 'decor-scarecrow',
  path: `${ASSET_BASE}/decor-scarecrow.png`,
  width: 256,
  height: 32,
};

export const DECOR_STREET_LAMP: ImageSpec = {
  key: 'decor-street-lamp',
  path: `${ASSET_BASE}/decor-street-lamp.png`,
  width: 64,
  height: 48,
};

/**
 * The two lamps on that sheet, measured (U3-3).
 *
 * **The pack ships the lamp already lit, and that was worth checking for.** A
 * column-occupancy scan of the 64x48 image finds two sprites, not one — an
 * unlit lamp at x 4-28 and a lit one at x 36-60, both spanning y 1-37 — and
 * the lit one is the only place in the file with bright warm pixels (#ffeb47
 * at (38,9), #ffc71b at (39,13); the latter is where `base.css` samples
 * `--lamp`). So dusk on the landing band cross-fades the pack's own two frames
 * instead of laying a CSS glow over a dark sprite and hoping it reads.
 *
 * Same shape as `OBJ_TINY_HOUSE_LOOK`: a measured window onto an image the
 * loader treats as one picture, so a consumer crops rather than guessing. The
 * boxes are padded to a common 26x38 so the two can be stacked and
 * cross-faded without either moving a pixel.
 */
export const STREET_LAMP_LOOK = {
  off: { x: 3, y: 0, width: 26, height: 38 },
  lit: { x: 35, y: 0, width: 26, height: 38 },
} as const;

export const DECOR_HAY_BALES: ImageSpec = {
  key: 'decor-hay-bales',
  path: `${ASSET_BASE}/decor-hay-bales.png`,
  width: 96,
  height: 16,
};

export const DECOR_FEED_TROUGH: ImageSpec = {
  key: 'decor-feed-trough',
  path: `${ASSET_BASE}/decor-feed-trough.png`,
  width: 32,
  height: 16,
};

export const DECOR_STONE_STATUE: ImageSpec = {
  key: 'decor-stone-statue',
  path: `${ASSET_BASE}/decor-stone-statue.png`,
  width: 32,
  height: 48,
};

export const DECOR_BIRDHOUSE: ImageSpec = {
  key: 'decor-birdhouse',
  path: `${ASSET_BASE}/decor-birdhouse.png`,
  width: 32,
  height: 32,
};

export const DECOR_VILLAGE_SIGNS: ImageSpec = {
  key: 'decor-village-signs',
  path: `${ASSET_BASE}/decor-village-signs.png`,
  width: 192,
  height: 64,
};

export const DECOR_BERRY_PILES: ImageSpec = {
  key: 'decor-berry-piles',
  path: `${ASSET_BASE}/decor-berry-piles.png`,
  width: 96,
  height: 32,
};

export const DECOR_STACKED_BARRELS: ImageSpec = {
  key: 'decor-stacked-barrels',
  path: `${ASSET_BASE}/decor-stacked-barrels.png`,
  width: 48,
  height: 48,
};

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

/**
 * ORDER IS LOAD-BEARING. Read this before editing either array below.
 *
 * `TILESET_RUNS` (tilesets.ts) allocates global tile ids by walking `SHEETS`
 * and then `IMAGES` in their declared order, giving every entry a contiguous
 * run whether the map uses it or not. `apps/client/public/tilemaps/farm.json`
 * is a committed file full of gids written against one particular allocation,
 * and nothing renumbers it when this file changes.
 *
 * So:
 *
 *   - **Appending to the END of `IMAGES` shifts nothing.** That is the safe
 *     edit, and it is why new art should go there when it has the choice.
 *   - **Any insertion into `SHEETS`, or into the middle of `IMAGES`, shifts
 *     every firstgid after it.** The map does not fail to load — it loads and
 *     draws the wrong tiles, which is far worse. After such an edit you MUST:
 *
 *       node scripts/prepare-assets.mjs
 *       apps/mapmaker/node_modules/.bin/tsx apps/mapmaker/scripts/generate-farm.ts
 *       apps/mapmaker/node_modules/.bin/tsx apps/mapmaker/scripts/verify-farm.ts
 *
 * `apps/mapmaker/src/io/farmMap.test.ts` (T-15.01) enforces this: it compares
 * the firstgid table `farm.json` embedded against the one this manifest
 * currently produces, so the drift fails a test instead of shipping.
 */
/* ------------------------------------------------------------------ *
 * Icon sheets — the manifest's third list, and the reason it exists (T-34.04)
 * ------------------------------------------------------------------ */

/**
 * Spritesheets that are **never painted on a map**.
 *
 * `TILESET_RUNS` allocates a gid to every entry in `SHEETS` and then every entry
 * in `IMAGES`, so touching either renumbers the rest — and `farm.json` is a file
 * full of already-written gids that nobody renumbers with it. Four item icons
 * are stuck in `SHEETS` for that reason, each carrying a comment saying some
 * version of *"nothing places an item icon on a map; it is here because §9
 * requires one manifest listing every key"*, and each having cost a gid shift
 * and a map regeneration to add.
 *
 * **This list is the same manifest guarantee without the gid.** Nothing here is
 * gid-allocated, so appending to it — or inserting into the middle of it —
 * shifts nothing and no map has to be touched. §9's rule is satisfied: every
 * key is still listed in exactly one place, and `Preload` and `SHEETS_BY_KEY`
 * read all three lists.
 *
 * **The four already in `SHEETS` deliberately stay there.** Moving them would
 * shift every `IMAGES` firstgid *downward* — the same breakage as adding, in the
 * other direction — and since M5 the map is AUTHORED, so "regenerate it" is no
 * longer an available answer. They are paid for; this is where the next one
 * goes.
 *
 * **The rule, stated once so it can be quoted:** if a sheet can be painted on a
 * tilemap it belongs in `SHEETS`; if it can only ever appear in the HUD, it
 * belongs here.
 */
export const ICON_SHEETS = [
  {
    key: 'icon-fish-carp',
    path: `${ASSET_BASE}/icon-fish-carp.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-chub',
    path: `${ASSET_BASE}/icon-fish-chub.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-perch',
    path: `${ASSET_BASE}/icon-fish-perch.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-sunfish',
    path: `${ASSET_BASE}/icon-fish-sunfish.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-shad',
    path: `${ASSET_BASE}/icon-fish-shad.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-bullhead-catfish',
    path: `${ASSET_BASE}/icon-fish-bullhead-catfish.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-large-mouth-bass',
    path: `${ASSET_BASE}/icon-fish-large-mouth-bass.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-walleye',
    path: `${ASSET_BASE}/icon-fish-walleye.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-pike',
    path: `${ASSET_BASE}/icon-fish-pike.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-tiger-trout',
    path: `${ASSET_BASE}/icon-fish-tiger-trout.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-sturgeon',
    path: `${ASSET_BASE}/icon-fish-sturgeon.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-dorado',
    path: `${ASSET_BASE}/icon-fish-dorado.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-ghost-catfish',
    path: `${ASSET_BASE}/icon-fish-ghost-catfish.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-bone-fish',
    path: `${ASSET_BASE}/icon-fish-bone-fish.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-zombie-fish',
    path: `${ASSET_BASE}/icon-fish-zombie-fish.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-dynamite-fish',
    path: `${ASSET_BASE}/icon-fish-dynamite-fish.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-faeries-fish',
    path: `${ASSET_BASE}/icon-fish-faeries-fish.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
  {
    key: 'icon-fish-golden-fish',
    path: `${ASSET_BASE}/icon-fish-golden-fish.png`,
    width: 64,
    height: 16,
    frameWidth: 16,
    frameHeight: 16,
    cols: 4,
    rows: 1,
  },
] as const satisfies readonly SheetSpec[];

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
  // The interior floor/wall tileset (T-16.07). In SHEETS because the interior
  // map is painted from it; the furniture KITS are IMAGES, appended below.
  TILESET_HOUSE,
  // Appended at the END (T-16.01). It has to live in SHEETS rather than
  // IMAGES — it is a 7-frame strip and `runFromImage` allocates exactly one
  // tile — so it shifts every IMAGES firstgid, and the map was regenerated per
  // the procedure above. Nothing places an item icon on a map; it is here
  // because §9 requires one manifest listing every key.
  ICON_ALL_CROPS,
  // Appended at the END for the same reason `ICON_SEED_BAGS` was (T-18.09):
  // anywhere else renumbers every tileset that follows. The map WAS regenerated
  // afterwards, and `farmMap.test.ts` pins the result.
  TILESET_PROPS_SEASONS,
  // Chopping (T-20.02), appended for the same reason again. Both are item
  // icons; nothing places them on a map, and they are here only because §9
  // requires one manifest listing every key.
  TOOL_AXE_WOOD,
  ICON_WOOD,
  // Phase 31's crops (T-31.02). Appended at the END in one batch — see the
  // crop section above for why one batch, and `farmMap.test.ts` for what
  // happens if this is inserted anywhere else. `farm.json` WAS regenerated.
  CROP_ASPARAGUS,
  CROP_BROCCOLI,
  CROP_CABBAGE,
  CROP_CARROT,
  CROP_CAULIFLOWER,
  CROP_PARSNIP,
  CROP_RICE,
  /*
   * The MVP re-scope's ground art, appended in ONE batch at the end — the
   * water the map floats on and the cliff edges where land meets it. Touching
   * SHEETS renumbers every IMAGES firstgid, so this is deliberately a single
   * append and `farm.json` was regenerated with it.
   */
  TILESET_WATER_ANIM,
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
  /*
   * The five first-party ground fills used to sit here. They are gone: the
   * ground now comes from the pack's own tilesets (see "Ground, painted from
   * the pack" above). Removing IMAGES entries shifts every firstgid after
   * them, so `farm.json` was regenerated in the same change.
   */
  // The farmhouse (T-15.29) and placeable decoration (T-15.15).
  // Appended, never inserted — see the ORDER IS LOAD-BEARING note above.
  OBJ_FARMHOUSE,
  DECOR_FENCE_WOOD,
  DECOR_SCARECROW,
  DECOR_STREET_LAMP,
  DECOR_HAY_BALES,
  DECOR_FEED_TROUGH,
  DECOR_STONE_STATUE,
  DECOR_BIRDHOUSE,
  DECOR_VILLAGE_SIGNS,
  DECOR_BERRY_PILES,
  DECOR_STACKED_BARRELS,
  // Interior furniture kits (T-16.07). Appended, never inserted.
  ...INTERIOR_KITS,
  // The merchant NPC (T-18.02). Appended at the very END, which is the one edit
  // that shifts no firstgid — see the ORDER IS LOAD-BEARING note above. It is an
  // ImageSpec rather than a SHEETS entry precisely so it can go here.
  NPC_MERCHANT_IDLE,
  // The upgraded farmhouses (T-17.06). Appended, never inserted.
  OBJ_FARMHOUSE_T1,
  OBJ_FARMHOUSE_T2,
  // The Chef (T-33.03). Appended at the very END, the one edit that shifts no
  // firstgid — which is why `farm.json` is untouched by this task.
  NPC_CHEF_IDLE,
] as const satisfies readonly ImageSpec[];

/** World tile size in source pixels. Everything on the farm grid is 16px. */
export const TILE_SIZE = 16 as const;

/** Integer upscale used by the game camera. Never use a fractional zoom on pixel art. */
export const PIXEL_SCALE = 3 as const;
