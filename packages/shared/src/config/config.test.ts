import { describe, it, expect } from 'vitest';
import { CROPS, CROP_IDS, WATER_DURATION_MS, WATERING_ENABLED, cropForSeed } from './crops.js';
import {
  ANIMALS,
  ANIMAL_BUILDINGS,
  ANIMAL_KINDS,
  ANIMAL_VARIANTS,
  BARN_TIERS,
  BUILDING_TIERS,
  COOP_TIERS,
  buildingCap,
  nextBuildingCost,
} from './animals.js';
import { ITEMS, ITEM_IDS, ItemCategory, getItem } from './items.js';
import {
  plotUnlockCost,
  STARTING_PLOTS,
  CHEST_TIERS,
  BASE_INVENTORY_SLOTS,
  GOLD_IS_TRADEABLE,
  HOTBAR_SLOTS,
  HOUSE_TIERS,
  STARTING_ITEMS,
  TRADE_MIN_FARM_LEVEL,
} from './economy.js';
import { FARM_LEVEL_XP, MAX_FARM_LEVEL, xpForHarvest } from './level.js';
import { VIP_BENEFITS, FREE_BENEFITS, applyDurationPercent, benefitsFor, isVipActive } from './vip.js';
import { CREDITS } from './credits.js';
import {
  SHEETS,
  IMAGES,
  ASSET_BASE,
  CHAR_PROMO_IDLE,
  CHAR_PROMO_WALK,
  CHAR_FRAME,
  CHAR_ANIMS,
  CHAR_ART,
  CHAR_ORIGIN,
  CHAR_DIRECTION_ORDER,
  CHAR_LAYER_ORDER,
  charTotalFrames,
  charDirectionStart,
  charLayerPath,
  charLayerVariant,
  charLayerPaths,
  OBJ_TINY_HOUSE,
  OBJ_TINY_HOUSE_LOOK,
  COOP_TIER_ART,
  BARN_TIER_ART,
  OBJ_SHIPPING_BOX,
  OBJ_SHIPPING_BOX_LOOK,
  OBJ_MAPLE_TREE,
  OBJ_MAPLE_TREE_ANIM,
  MAPLE_TREE,
  MAPLE_TREE_ANIM_FRAMES,
  TOOL_ANIMS,
  UI_INVENTORY_SLOTS,
  UI_SLOT,
  charAnimDurationMs,
  charToolPath,
} from './assets.js';

/**
 * These are invariant tests, not behaviour tests. They exist so a careless
 * config edit fails CI instead of quietly breaking the economy or shipping a
 * crop that references a nonexistent item.
 */

describe('asset manifest', () => {
  /**
   * The one that matters. A frame size that does not divide the sheet exactly
   * still "works" — Phaser slices it, the browser renders it — but every frame
   * is offset, so sprites show halves of their neighbours. This was a real bug:
   * spring-crops.png was declared 32x32 when its cells are 16 wide by 32 tall,
   * and the only symptom was two crops appearing in every plot.
   */
  it('frame size times grid equals the source image exactly', () => {
    for (const s of SHEETS) {
      expect(s.frameWidth * s.cols, `${s.key} width`).toBe(s.width);
      expect(s.frameHeight * s.rows, `${s.key} height`).toBe(s.height);
    }
  });

  it('frame dimensions are positive integers', () => {
    for (const s of SHEETS) {
      for (const [label, n] of [
        ['frameWidth', s.frameWidth],
        ['frameHeight', s.frameHeight],
        ['cols', s.cols],
        ['rows', s.rows],
      ] as const) {
        expect(Number.isInteger(n), `${s.key}.${label}`).toBe(true);
        expect(n, `${s.key}.${label}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The old pack's "art box"/mirroring tests (`PLAYER_ART`, `PLAYER_ORIGIN_Y`,
   * `PLAYER_FLIP_OFFSET`) are retired with the rest of the old pack (T-7.07):
   * the new pack draws all 4 directions explicitly (`CHAR_DIRECTION_ORDER`),
   * so there is no mirroring math left to pin.
   *
   * `CHAR_PROMO_IDLE`/`_WALK` are what T-7.07's bare-skin stand-in BECAME once
   * T-8.03 built the real compositor: the landing and auth pages' art, drawn
   * as DOM sprites straight from `path`. They are intentionally out of
   * `SHEETS` — nothing asks Phaser for them — which is exactly why the
   * manifest-wide tests above no longer cover them and these do.
   */
  it('the promo character sheets share the character frame size', () => {
    expect(CHAR_PROMO_IDLE.frameWidth).toBe(CHAR_PROMO_WALK.frameWidth);
    expect(CHAR_PROMO_IDLE.frameHeight).toBe(CHAR_PROMO_WALK.frameHeight);
    expect(CHAR_PROMO_IDLE.frameWidth).toBe(CHAR_FRAME.width);
    expect(CHAR_PROMO_IDLE.frameHeight).toBe(CHAR_FRAME.height);
  });

  it('the promo character sheets are real layer strips, and stay out of SHEETS', () => {
    for (const sheet of [CHAR_PROMO_IDLE, CHAR_PROMO_WALK]) {
      expect(sheet.frameWidth * sheet.cols, `${sheet.key} width`).toBe(sheet.width);
      expect(sheet.frameHeight * sheet.rows, `${sheet.key} height`).toBe(sheet.height);
      // The same convention every other character strip is addressed by.
      expect(sheet.path).toBe(charLayerPath(sheet === CHAR_PROMO_IDLE ? 'idle' : 'walk', 'skin', '1'));
    }
    const keys = SHEETS.map((s) => s.key);
    expect(keys).not.toContain(CHAR_PROMO_IDLE.key);
    expect(keys).not.toContain(CHAR_PROMO_WALK.key);
  });

  /**
   * T-8.07's guards on the hotbar slot art. `ui-inventory-slots.png` is not a
   * uniform grid — it holds panels, whole bars and loose pieces — so these
   * sub-rects were found by connected-component analysis rather than by
   * dividing the sheet, and nothing else in the manifest can check them.
   */
  it('both hotbar slot rects sit inside the sheet and are the same size', () => {
    for (const [name, rect] of [['idle', UI_SLOT.idle], ['selected', UI_SLOT.selected]] as const) {
      expect(rect.x, `${name} x`).toBeGreaterThanOrEqual(0);
      expect(rect.y, `${name} y`).toBeGreaterThanOrEqual(0);
      expect(rect.x + UI_SLOT.size, `${name} right edge`).toBeLessThanOrEqual(
        UI_INVENTORY_SLOTS.width,
      );
      expect(rect.y + UI_SLOT.size, `${name} bottom edge`).toBeLessThanOrEqual(
        UI_INVENTORY_SLOTS.height,
      );
    }
  });

  it('the two hotbar slot states are different art', () => {
    // Same square lit and unlit; if these ever collapse to one rect, selection
    // becomes invisible and nothing else would notice.
    expect(UI_SLOT.idle).not.toEqual(UI_SLOT.selected);
    expect(UI_SLOT.size).toBeGreaterThan(0);
  });

  it('keys are unique and paths sit under the asset base', () => {
    const keys = [...SHEETS, ...IMAGES].map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of [...SHEETS, ...IMAGES]) {
      expect(a.path.startsWith(`${ASSET_BASE}/`), `${a.key} path`).toBe(true);
      // `pnpm assets` writes kebab-case names; a space here means someone
      // referenced a source filename directly.
      expect(a.path).not.toMatch(/[ '"]/);
    }
  });

  /**
   * T-7.03's guard: a strip's measured `width` must equal frameWidth times
   * the frame count implied by `framesPerDirection` × 4 directions. This is
   * the character-strip analogue of the SHEETS width test above, and it
   * catches the same class of bug — a miscounted `framesPerDirection` slices
   * every frame at the wrong offset instead of failing loudly.
   */
  it('character strip width equals frame width times total frame count', () => {
    for (const anim of Object.values(CHAR_ANIMS)) {
      expect(CHAR_FRAME.width * charTotalFrames(anim), `${anim.key} width`).toBe(anim.width);
    }
  });

  it('character anim keys and source folders are unique', () => {
    const anims = Object.values(CHAR_ANIMS);
    expect(new Set(anims.map((a) => a.key)).size).toBe(anims.length);
    expect(new Set(anims.map((a) => a.sourceFolder)).size).toBe(anims.length);
  });

  /**
   * The literal is pinned because the last two entries are the pair this pack
   * keeps getting swapped on — see `CHAR_DIRECTION_ORDER`'s comment for the one
   * check that settles it (the watering can pours in the direction faced).
   * Changing this line means having done that check, not having reasoned about
   * eye pixels.
   */
  it('character direction order has exactly the 4 directions, no duplicates', () => {
    expect(CHAR_DIRECTION_ORDER).toEqual(['down', 'up', 'right', 'left']);
    expect(new Set(CHAR_DIRECTION_ORDER).size).toBe(4);
  });

  it('every character anim has a positive frame count and fps', () => {
    for (const anim of Object.values(CHAR_ANIMS)) {
      expect(anim.framesPerDirection, `${anim.key} framesPerDirection`).toBeGreaterThan(0);
      expect(anim.fps, `${anim.key} fps`).toBeGreaterThan(0);
    }
  });

  /**
   * T-8.02's guards. The layer path is a CONTRACT with
   * `scripts/prepare-assets.mjs`; if either side is edited alone the character
   * silently renders as nothing at all, so both the folder layout and the
   * flattened variant names are pinned here.
   */
  it('direction blocks start where the previous one ends', () => {
    // Read off `CHAR_DIRECTION_ORDER` rather than naming a direction: what is
    // under test is that the blocks tile the strip end to end, which is true
    // whichever way round the two side-facing blocks turn out to be.
    const last = CHAR_DIRECTION_ORDER[CHAR_DIRECTION_ORDER.length - 1]!;

    for (const anim of Object.values(CHAR_ANIMS)) {
      expect(charDirectionStart(anim, CHAR_DIRECTION_ORDER[0]!), `${anim.key} first`).toBe(0);
      const end = charDirectionStart(anim, last) + anim.framesPerDirection;
      expect(end, `${anim.key} covers the whole strip`).toBe(charTotalFrames(anim));
    }
  });

  /**
   * T-8.03's guards on the measured art box. These do not re-measure the PNGs
   * — they pin the invariants a re-measurement must still satisfy, so a
   * transcription slip (swapped edges, a bottom past the frame) fails here
   * rather than as a character sunk into the soil.
   */
  it('the character art box sits inside its frame, with edges in order', () => {
    expect(CHAR_ART.left).toBeGreaterThanOrEqual(0);
    expect(CHAR_ART.top).toBeGreaterThanOrEqual(0);
    expect(CHAR_ART.right).toBeGreaterThan(CHAR_ART.left);
    expect(CHAR_ART.bottom).toBeGreaterThan(CHAR_ART.top);
    expect(CHAR_ART.right).toBeLessThanOrEqual(CHAR_FRAME.width);
    expect(CHAR_ART.bottom).toBeLessThanOrEqual(CHAR_FRAME.height);
  });

  it('the ground line is above the frame bottom — that gap is why CHAR_ART exists', () => {
    expect(CHAR_ART.bottom).toBeLessThan(CHAR_FRAME.height);
  });

  it('the feet origin lands the art bottom on the sprite position, on a whole pixel', () => {
    expect(CHAR_ORIGIN.y * CHAR_FRAME.height).toBe(CHAR_ART.bottom);
    expect(Number.isInteger(CHAR_ORIGIN.y * CHAR_FRAME.height)).toBe(true);
    expect(CHAR_ORIGIN.x).toBe(0.5);
  });

  /**
   * T-8.09's guards. The tool overlay shares its animation's frame layout
   * exactly (verified against the art: hoe 768×32, watering 1024×32, the same
   * as their character strips), which is what lets one sprite ride along with
   * no separate maths — so the set of tool animations must stay a subset of
   * the real ones, and the swing's duration must come from the same numbers
   * Phaser plays the strip at.
   */
  it('every tool animation is a real animation that plays once', () => {
    expect(TOOL_ANIMS.length).toBeGreaterThan(0);
    for (const anim of TOOL_ANIMS) {
      const spec = CHAR_ANIMS[anim];
      expect(spec, anim).toBeDefined();
      // A looping swing would never release the movement lock.
      expect(spec.loop, `${anim} loops`).toBe(false);
    }
  });

  it('tool overlay paths follow the prepare-assets layout', () => {
    expect(charToolPath('hoe')).toBe(`${ASSET_BASE}/character/hoe/tool/wood.png`);
    expect(charToolPath('watering')).toBe(`${ASSET_BASE}/character/watering/tool/wood.png`);
  });

  it('an animation lasts its frame count divided by its frame rate', () => {
    expect(charAnimDurationMs(CHAR_ANIMS.hoe)).toBe(600);
    expect(charAnimDurationMs(CHAR_ANIMS.watering)).toBe(800);

    for (const anim of Object.values(CHAR_ANIMS)) {
      const ms = charAnimDurationMs(anim);
      expect(ms, `${anim.key} duration`).toBeGreaterThan(0);
      expect(Number.isInteger(ms), `${anim.key} duration is whole ms`).toBe(true);
    }
  });

  it('character layers are stacked skin, clothes, eyes, hair', () => {
    expect(CHAR_LAYER_ORDER).toEqual(['skin', 'clothes', 'eyes', 'hair']);
  });

  it('layer paths follow the prepare-assets layout', () => {
    expect(charLayerPath('idle', 'skin', '1')).toBe(`${ASSET_BASE}/character/idle/skin/1.png`);
    expect(charLayerPath('watering', 'hair', 'lyria-ginger')).toBe(
      `${ASSET_BASE}/character/watering/hair/lyria-ginger.png`,
    );
  });

  it('an appearance resolves to its four flattened variant names', () => {
    const appearance = {
      skin: 3,
      eyes: { sex: 'female', color: 'blue' },
      hair: { style: 'sebastian', color: 'blonde' },
      clothes: 'purple',
    } as const;

    expect(charLayerVariant('skin', appearance)).toBe('3');
    expect(charLayerVariant('clothes', appearance)).toBe('purple');
    expect(charLayerVariant('eyes', appearance)).toBe('female-blue');
    expect(charLayerVariant('hair', appearance)).toBe('sebastian-blonde');

    expect(charLayerPaths('idle', appearance)).toEqual([
      `${ASSET_BASE}/character/idle/skin/3.png`,
      `${ASSET_BASE}/character/idle/clothes/purple.png`,
      `${ASSET_BASE}/character/idle/eyes/female-blue.png`,
      `${ASSET_BASE}/character/idle/hair/sebastian-blonde.png`,
    ]);
  });
});

describe('crops', () => {
  it('every crop references items that exist', () => {
    for (const id of CROP_IDS) {
      const crop = CROPS[id];
      expect(getItem(crop.produceItemId), `produce ${crop.produceItemId}`).toBeDefined();
      expect(getItem(crop.seedItemId), `seed ${crop.seedItemId}`).toBeDefined();
    }
  });

  /**
   * The hotbar turns "leek seeds are equipped" into a plant intent through this
   * (T-9.06), so a seed that answers null is a seed that cannot be planted.
   */
  it('maps every seed item back to exactly the crop that names it', () => {
    for (const id of CROP_IDS) {
      expect(cropForSeed(CROPS[id].seedItemId), `seed for ${id}`).toBe(id);
    }
    // One crop per seed, so the reverse map cannot have silently collapsed two.
    const seeds = new Set(CROP_IDS.map((id) => CROPS[id].seedItemId));
    expect(seeds.size).toBe(CROP_IDS.length);
  });

  it('answers null for anything that is not a seed', () => {
    // Produce, tools and nonsense all have to be distinguishable from seeds —
    // the control scheme asks this question of whatever is in hand.
    for (const itemId of ['leek', 'hoe_wood', 'watering_can_wood', '', 'leek_seedsx']) {
      expect(cropForSeed(itemId), itemId).toBeNull();
    }
  });

  it('growth durations are positive integers', () => {
    for (const id of CROP_IDS) {
      const { growthDurationMs, yieldAmount } = CROPS[id];
      expect(Number.isInteger(growthDurationMs)).toBe(true);
      expect(growthDurationMs).toBeGreaterThan(0);
      expect(Number.isInteger(yieldAmount)).toBe(true);
      expect(yieldAmount).toBeGreaterThan(0);
    }
  });

  /**
   * T-7.07: each crop now has its OWN 8-frame sheet (`crop.sheet`) instead of
   * a shared `CROPS_SHEET` with row/column meanings — see `crops.ts`'s module
   * comment. T-7.08 measured the real growth-stage/seed/produce frames; this
   * test just guards that whatever they are, they stay inside the sheet.
   */
  it('every stage/seed/produce frame is inside the crop\'s own sheet', () => {
    for (const id of CROP_IDS) {
      const crop = CROPS[id];
      const maxFrame = crop.sheet.cols * crop.sheet.rows - 1;
      expect(crop.stageFrames.length).toBeGreaterThanOrEqual(2);
      for (const f of crop.stageFrames) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(maxFrame);
      }
      expect(crop.produceFrame).toBeGreaterThanOrEqual(0);
      expect(crop.produceFrame).toBeLessThanOrEqual(maxFrame);
      expect(crop.seedFrame).toBeGreaterThanOrEqual(0);
      expect(crop.seedFrame).toBeLessThanOrEqual(maxFrame);
    }
  });

  /**
   * The old pack gave potato a seventh stage; the new pack (measured in
   * T-7.08, see `assets.ts`'s crop-section comment) does not — all four crop
   * strips share the identical 6-growth-stage/blank/produce layout. Pinning
   * the count here means a config edit that grows one crop's stage list
   * without re-measuring its sheet fails in one obvious place rather than as
   * a missing frame at runtime.
   */
  it('every crop has exactly six growth stages', () => {
    for (const id of CROP_IDS) {
      expect(CROPS[id].stageFrames, id).toHaveLength(6);
    }
  });

  it('every crop shares the measured T-7.08 frame layout', () => {
    for (const id of CROP_IDS) {
      const crop = CROPS[id];
      expect(crop.stageFrames, id).toEqual([0, 1, 2, 3, 4, 5]);
      expect(crop.seedFrame, id).toBe(0);
      expect(crop.produceFrame, id).toBe(7);
    }
  });

  it('each crop uses its own sheet, and every sheet is used once', () => {
    const sheetKeys = CROP_IDS.map((id) => CROPS[id].sheet.key);
    expect(new Set(sheetKeys).size).toBe(sheetKeys.length);
  });
});

describe('animals', () => {
  it('every animal references items that exist', () => {
    for (const kind of ANIMAL_KINDS) {
      const a = ANIMALS[kind];
      expect(getItem(a.produceItemId), `produce ${a.produceItemId}`).toBeDefined();
      expect(getItem(a.feedItemId), `feed ${a.feedItemId}`).toBeDefined();
    }
  });

  it('feeding outlasts one production cycle', () => {
    // Otherwise an animal can never actually produce between feedings.
    for (const kind of ANIMAL_KINDS) {
      const a = ANIMALS[kind];
      expect(a.feedDurationMs).toBeGreaterThan(a.productionIntervalMs);
    }
  });

  it('has at least one cosmetic variant each', () => {
    for (const kind of ANIMAL_KINDS) {
      expect(ANIMALS[kind].variants.length).toBeGreaterThan(0);
    }
  });

  /**
   * The T-12.01 guard. `ANIMAL_VARIANTS` names its art by string, so a typo
   * or a sheet that never made it into `prepare-assets.mjs` is invisible
   * until a player buys that colour and gets a blank square. Same shape as
   * the item-icon check below, for the same reason.
   */
  it('every variant draws from a sheet that is really in the manifest', () => {
    const sheets = new Map(SHEETS.map((s) => [s.key, s]));

    for (const variant of Object.values(ANIMAL_VARIANTS)) {
      expect(sheets.get(variant.sheet), `${variant.id} adult`).toBeDefined();
      if (variant.babySheet !== null) {
        expect(sheets.get(variant.babySheet), `${variant.id} baby`).toBeDefined();
      }
    }
  });

  it('registers each variant against the kind that sells it, exactly once', () => {
    const listed = ANIMAL_KINDS.flatMap((kind) => ANIMALS[kind].variants);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.length).toBe(Object.keys(ANIMAL_VARIANTS).length);

    for (const kind of ANIMAL_KINDS) {
      for (const id of ANIMALS[kind].variants) {
        expect(ANIMAL_VARIANTS[id]?.kind, id).toBe(kind);
      }
    }
  });

  /**
   * Two variants sharing a sheet would make the shop offer a choice that is
   * not one — the player picks "Pink" and gets the brown cow they could have
   * had for the same price.
   */
  it('gives every variant its own picture and its own label', () => {
    const defs = Object.values(ANIMAL_VARIANTS);
    expect(new Set(defs.map((v) => v.sheet)).size).toBe(defs.length);
    expect(new Set(defs.map((v) => v.label)).size).toBe(defs.length);
    for (const v of defs) expect(v.label.length, v.id).toBeGreaterThan(0);
  });

  /**
   * §5.3: a variant is decoration. Nothing that could be worth gold — price,
   * interval, yield, feed — is allowed to hang off one, and the type is where
   * that is enforced: `AnimalVariantDef` carries art and a label and nothing
   * else. Pinned as a field list so adding a fifth field is a deliberate act.
   */
  it('lets a variant carry art and a name, and nothing a player could measure', () => {
    for (const v of Object.values(ANIMAL_VARIANTS)) {
      expect(Object.keys(v).sort()).toEqual(['babySheet', 'id', 'kind', 'label', 'sheet']);
    }
  });

  /* ---------------------------------------------------------------- *
   * Coop and barn tiers (T-12.02)
   * ---------------------------------------------------------------- */

  it('houses every kind in a building that exists', () => {
    for (const kind of ANIMAL_KINDS) {
      expect(BUILDING_TIERS[ANIMALS[kind].building], kind).toBeDefined();
    }
    // And every building actually houses something — a tier track nothing is
    // capped by is a gold sink that buys nothing.
    for (const building of ANIMAL_BUILDINGS) {
      expect(
        ANIMAL_KINDS.some((k) => ANIMALS[k].building === building),
        building,
      ).toBe(true);
    }
  });

  it('numbers tiers from 0 upward with no gaps', () => {
    for (const building of ANIMAL_BUILDINGS) {
      const tiers = BUILDING_TIERS[building];
      expect(tiers.map((t) => t.tier), building).toEqual(tiers.map((_, i) => i));
    }
  });

  /**
   * Tier 0 is what a new farm has and must be free; every tier after it has to
   * cost more and hold more than the one before, or the shop is offering a
   * downgrade at a higher price.
   */
  it('makes each tier strictly bigger and strictly dearer', () => {
    for (const building of ANIMAL_BUILDINGS) {
      const tiers = BUILDING_TIERS[building];
      expect(tiers[0]!.cost, building).toBe(0);
      expect(tiers[0]!.cap, building).toBeGreaterThan(0);

      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i]!.cost, `${building} ${i}`).toBeGreaterThan(tiers[i - 1]!.cost);
        expect(tiers[i]!.cap, `${building} ${i}`).toBeGreaterThan(tiers[i - 1]!.cap);
      }
    }
  });

  it('reads a cap per building and adds VIP on top', () => {
    expect(buildingCap('coop', 0, 0)).toBe(COOP_TIERS[0]!.cap);
    expect(buildingCap('barn', 0, 0)).toBe(BARN_TIERS[0]!.cap);
    expect(buildingCap('coop', 0, 3)).toBe(COOP_TIERS[0]!.cap + 3);

    // Under-reporting is the safe direction for an unknown tier: the
    // alternative is room nobody bought.
    expect(buildingCap('coop', 99, 0)).toBe(COOP_TIERS[0]!.cap);
    expect(buildingCap('coop', -1, 0)).toBe(COOP_TIERS[0]!.cap);
  });

  it('quotes the price of the next tier, and null at the top', () => {
    for (const building of ANIMAL_BUILDINGS) {
      const tiers = BUILDING_TIERS[building];
      for (let i = 0; i < tiers.length - 1; i++) {
        expect(nextBuildingCost(building, i), `${building} ${i}`).toBe(tiers[i + 1]!.cost);
      }
      expect(nextBuildingCost(building, tiers.length - 1), building).toBeNull();
    }
  });

  /**
   * The house paid for animal room until T-12.02. Nothing should have inherited
   * that: a second, farm-wide source of cap would make "the coop is full" a
   * lie for anyone who happened to own a big house.
   */
  it('leaves the house with no say in how many animals fit', () => {
    for (const tier of HOUSE_TIERS) {
      expect(Object.keys(tier).sort()).toEqual(['cost', 'tier']);
    }
  });
});

describe('items', () => {
  it('ids are unique and self-consistent', () => {
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length);
    for (const id of ITEM_IDS) {
      expect(ITEMS[id]?.id).toBe(id);
    }
  });

  it('every icon points at a real sheet and a frame inside it', () => {
    // Guards the placeholder problem: four items used to point at the chest
    // sprite because no egg/milk/hay/feed art existed. A wrong sheet key or an
    // out-of-range frame renders as an invisible or garbled icon, which is easy
    // to miss by eye and trivial to catch here.
    // Kept as two maps rather than one: a sheet has a frame grid, a single
    // image has exactly one frame, and conflating them loses that distinction.
    const sheets = new Map(SHEETS.map((s) => [s.key, s]));
    const images = new Map(IMAGES.map((i) => [i.key, i]));

    for (const id of ITEM_IDS) {
      const { icon, name } = ITEMS[id]!;
      const sheet = sheets.get(icon.sheet);
      const image = images.get(icon.sheet);

      expect(
        sheet ?? image,
        `${name} references unknown sheet "${icon.sheet}"`,
      ).toBeDefined();

      const frameCount = sheet ? sheet.cols * sheet.rows : 1;
      expect(icon.frame, `${name} frame`).toBeGreaterThanOrEqual(0);
      expect(icon.frame, `${name} frame out of range for ${icon.sheet}`).toBeLessThan(
        frameCount,
      );
    }
  });

  it('no two items share an icon', () => {
    // Two items with the same icon is almost always a copy-paste placeholder.
    const seen = new Map<string, string>();
    for (const id of ITEM_IDS) {
      const { icon, name } = ITEMS[id]!;
      const key = `${icon.sheet}#${icon.frame}`;
      expect(seen.has(key), `${name} shares an icon with ${seen.get(key)}`).toBe(false);
      seen.set(key, name);
    }
  });

  it('all prices are non-negative integers', () => {
    for (const id of ITEM_IDS) {
      const it = ITEMS[id]!;
      for (const p of [it.shopBuyPrice, it.shopSellPrice]) {
        if (p === null) continue;
        expect(Number.isInteger(p), `${id} price ${p}`).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
      }
      expect(Number.isInteger(it.stackLimit)).toBe(true);
      expect(it.stackLimit).toBeGreaterThan(0);
    }
  });

  it('the shop never buys back at or above its own sale price', () => {
    // CLAUDE.md §5.6: vendoring must be strictly worse than player trading,
    // and buy/sell round-tripping must never be a gold faucet.
    for (const id of ITEM_IDS) {
      const it = ITEMS[id]!;
      if (it.shopBuyPrice === null || it.shopSellPrice === null) continue;
      expect(it.shopSellPrice, `${id} round-trips for profit`).toBeLessThan(it.shopBuyPrice);
    }
  });

  /**
   * T-8.06. The three tool rules are one rule — a tool has no scarcity, so it
   * has no economy — and each is enforced by a different subsystem
   * (`shop/service.ts` reads `shopSellPrice`, `trade/offer.ts` reads
   * `tradeable`). Pinning them here means a new tool cannot be added with a
   * price by copy-paste.
   */
  it('no tool can be bought, sold, or traded, and none stacks', () => {
    const tools = ITEM_IDS.map((id) => ITEMS[id]!).filter(
      (item) => item.category === ItemCategory.TOOL,
    );
    expect(tools.length, 'the MVP ships a hoe and a watering can').toBeGreaterThanOrEqual(2);

    for (const item of tools) {
      expect(item.shopBuyPrice, `${item.id} is purchasable`).toBeNull();
      expect(item.shopSellPrice, `${item.id} is sellable`).toBeNull();
      expect(item.tradeable, `${item.id} is tradeable`).toBe(false);
      expect(item.stackLimit, `${item.id} stacks`).toBe(1);
    }
  });

  it('the MVP tools exist under the ids the client and server both use', () => {
    for (const id of ['hoe_wood', 'watering_can_wood']) {
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id]!.category).toBe(ItemCategory.TOOL);
    }
  });

  /**
   * T-9.03a. `WATER_DURATION_MS` was chosen against these exact durations, and
   * the reasoning is written into its doc comment — so retuning a crop past
   * the window silently invalidates that comment and changes how the game
   * feels. This is what makes the choice re-checkable rather than a claim.
   */
  it('the wet window matches the crop durations it was chosen for', () => {
    expect(Number.isInteger(WATER_DURATION_MS)).toBe(true);
    expect(WATER_DURATION_MS).toBeGreaterThan(0);

    const fitsInOneWindow = (id: string) =>
      CROPS[id as keyof typeof CROPS].growthDurationMs <= WATER_DURATION_MS;

    // The early crops ripen without a second visit...
    for (const id of ['leek', 'potato', 'strawberry']) {
      expect(fitsInOneWindow(id), `${id} should ripen inside one watering`).toBe(true);
    }
    // ...and the long crop deliberately does not.
    expect(fitsInOneWindow('onion'), 'onion should need a second watering').toBe(false);
    expect(
      CROPS.onion.growthDurationMs,
      'onion should need exactly two windows, not three',
    ).toBeLessThanOrEqual(2 * WATER_DURATION_MS);
  });

  it('has watering switched on (D-1, flipped in T-9.03b)', () => {
    // Still pinned, for the same reason it was pinned to `false` before the
    // endpoint existed: this constant decides whether every planted crop in
    // the game grows on wall-clock time or only on wet soil. It moves in a
    // change that says so, never as a side effect of one.
    expect(WATERING_ENABLED).toBe(true);
  });

  it('growing a crop is worth more than the seed cost', () => {
    // A crop whose yield sells for less than its seed is a trap, not a choice.
    for (const id of CROP_IDS) {
      const crop = CROPS[id];
      const seed = ITEMS[crop.seedItemId]!;
      const produce = ITEMS[crop.produceItemId]!;
      const revenue = (produce.shopSellPrice ?? 0) * crop.yieldAmount;
      expect(revenue, `${id} sells for less than its seed`).toBeGreaterThan(
        seed.shopBuyPrice ?? 0,
      );
    }
  });
});

describe('economy', () => {
  /**
   * `auth/service.ts` inserts the starter kit at `slotIndex: index`, and
   * T-8.07 makes the first twelve backpack slots the hotbar — so this array's
   * ORDER decides where a new player's tools land. Pinned because reordering
   * it is a silent change to every future account's hotbar, and because a kit
   * entry naming an item that does not exist would insert an unrenderable row.
   */
  it('the whole starter kit fits inside the hotbar window', () => {
    // The kit is inserted at slotIndex 0..n-1, and the hotbar shows 0..11. A
    // kit longer than the hotbar would grant items a new player cannot equip.
    expect(STARTING_ITEMS.length).toBeLessThanOrEqual(HOTBAR_SLOTS);
    expect(HOTBAR_SLOTS).toBeLessThanOrEqual(BASE_INVENTORY_SLOTS);
  });

  it('grants a real item in every starter-kit slot, tools first', () => {
    for (const entry of STARTING_ITEMS) {
      expect(ITEMS[entry.itemId], `${entry.itemId} is not a real item`).toBeDefined();
      expect(Number.isInteger(entry.quantity)).toBe(true);
      expect(entry.quantity).toBeGreaterThan(0);
      // A tool has stackLimit 1; granting two would overflow its own slot.
      expect(entry.quantity, `${entry.itemId} exceeds its stack limit`).toBeLessThanOrEqual(
        ITEMS[entry.itemId]!.stackLimit,
      );
    }

    expect(STARTING_ITEMS.map((e) => e.itemId).slice(0, 2)).toEqual([
      'hoe_wood',
      'watering_can_wood',
    ]);
  });

  it('starting plots are free and expansion is superlinear', () => {
    expect(plotUnlockCost(0)).toBe(0);
    expect(plotUnlockCost(STARTING_PLOTS - 1)).toBe(0);

    const first = plotUnlockCost(STARTING_PLOTS);
    const second = plotUnlockCost(STARTING_PLOTS + 1);
    const third = plotUnlockCost(STARTING_PLOTS + 2);
    expect(first).toBeGreaterThan(0);
    expect(second - first).toBeGreaterThan(0);
    expect(third - second).toBeGreaterThan(second - first);
  });

  it('plot costs are always integers', () => {
    for (let i = 0; i < 40; i++) {
      expect(Number.isInteger(plotUnlockCost(i))).toBe(true);
    }
  });

  it('chest tiers strictly increase in both cost and slots', () => {
    for (let i = 1; i < CHEST_TIERS.length; i++) {
      expect(CHEST_TIERS[i]!.cost).toBeGreaterThan(CHEST_TIERS[i - 1]!.cost);
      expect(CHEST_TIERS[i]!.slots).toBeGreaterThan(CHEST_TIERS[i - 1]!.slots);
    }
  });

  it('gold is not tradeable until that decision is made', () => {
    // Guards CLAUDE.md §14. Flipping this is a deliberate design decision, not
    // an incidental edit — update the roadmap's Open Decisions when it changes.
    expect(GOLD_IS_TRADEABLE).toBe(false);
  });
});

describe('vip', () => {
  it('grants no gold and no tradeable exclusives', () => {
    // CLAUDE.md §7: benefits are convenience and cosmetic only. If a `gold` or
    // `exclusiveItems` key ever appears on VipBenefits, this fails.
    expect(Object.keys(VIP_BENEFITS).sort()).toEqual(Object.keys(FREE_BENEFITS).sort());
    expect(VIP_BENEFITS).not.toHaveProperty('gold');
    expect(VIP_BENEFITS).not.toHaveProperty('exclusiveItems');
  });

  it('every tradeable item is obtainable without VIP', () => {
    // A VIP-only tradeable would let paying players mint economy value.
    for (const id of ITEM_IDS) {
      const it = ITEMS[id]!;
      if (!it.tradeable) continue;
      expect(it.category).not.toBe('decoration');
    }
  });

  it('speeds things up without making them instant', () => {
    expect(VIP_BENEFITS.durationPercent).toBeGreaterThan(0);
    expect(VIP_BENEFITS.durationPercent).toBeLessThan(FREE_BENEFITS.durationPercent);
    expect(applyDurationPercent(1000, 80)).toBe(800);
    // Rounds up: never returns 0 for a non-zero duration.
    expect(applyDurationPercent(1, 80)).toBe(1);
  });

  /**
   * Callers divide by this. A zero would mean an instantly ripe crop and an
   * animal owing `Infinity` cycles — item duplication out of an arithmetic
   * edge, so the floor is asserted rather than assumed.
   */
  it('never returns zero for a real duration, at any percentage', () => {
    for (const percent of [0, 1, 50, 80, 100, 1000]) {
      expect(applyDurationPercent(1, percent), `percent ${percent}`).toBeGreaterThan(0);
      expect(applyDurationPercent(60_000, percent), `percent ${percent}`).toBeGreaterThan(0);
    }
    // A zero duration is still zero: there is nothing to stretch.
    expect(applyDurationPercent(0, 80)).toBe(0);
  });

  it('resolves benefits from an expiry timestamp', () => {
    const now = 1_000_000;
    expect(benefitsFor({ vipUntil: null, flaggedAt: null }, now)).toBe(FREE_BENEFITS);
    expect(benefitsFor({ vipUntil: now - 1, flaggedAt: null }, now)).toBe(FREE_BENEFITS);
    expect(benefitsFor({ vipUntil: now + 1, flaggedAt: null }, now)).toBe(VIP_BENEFITS);
  });

  /**
   * T-5.01's actual guarantee: flagging wins over an otherwise-live expiry.
   * `vipUntil` in the far future is exactly the case a refund/chargeback
   * needs to override, so that is what this pins rather than a timestamp
   * that would pass even with the flagged check silently deleted.
   */
  it('gives a flagged account FREE_BENEFITS regardless of vipUntil', () => {
    const now = 1_000_000;
    expect(benefitsFor({ vipUntil: now + 1_000_000_000, flaggedAt: now - 1 }, now)).toBe(FREE_BENEFITS);
    expect(isVipActive({ vipUntil: now + 1_000_000_000, flaggedAt: now - 1 }, now)).toBe(false);
  });
});

describe('credits', () => {
  /**
   * The asset pack's licence makes credit MANDATORY (T-7.01, ATTRIBUTION.md).
   * This pins the exact name and link the licence asks for — an edit that
   * dropped or reworded them must be a deliberate act that fails here, not a
   * quiet cleanup that puts the project in breach.
   */
  it('carries the mandatory EmanuelleDev credit, verbatim', () => {
    const art = CREDITS.find((c) => c.author === 'EmanuelleDev');
    expect(art).toBeDefined();
    expect(art!.url).toBe('https://emanuelledev.itch.io');
    expect(art!.work.length).toBeGreaterThan(0);
  });

  it('is non-empty and every entry is complete', () => {
    expect(CREDITS.length).toBeGreaterThan(0);
    for (const credit of CREDITS) {
      expect(credit.author.length, credit.work).toBeGreaterThan(0);
      expect(credit.url, credit.work).toMatch(/^https:\/\//);
    }
  });
});

describe('farm level', () => {
  /**
   * Pinned, not just range-checked. The level-5 threshold is the trade gate
   * (§14), so retuning the curve must be a deliberate act that fails a test
   * rather than a quiet change to how hard scam accounts are to make.
   */
  it('holds the curve the trade gate was tuned against', () => {
    expect(FARM_LEVEL_XP.slice(0, 6)).toEqual([0, 80, 184, 319, 494, 721]);
    expect(FARM_LEVEL_XP).toHaveLength(MAX_FARM_LEVEL);
  });

  /**
   * The gate is only meaningful if reaching it takes real time. Measured
   * against the starting plots and the fastest crop — the best a new account
   * can do — it should be hours, not minutes.
   */
  it('takes hours of real time to reach the trade-eligible level', () => {
    const fastest = CROP_IDS.map((id) => CROPS[id]).sort(
      (a, b) => a.growthDurationMs - b.growthDurationMs,
    )[0]!;

    const xpPerHour =
      (xpForHarvest(fastest.id) * STARTING_PLOTS * 3_600_000) / fastest.growthDurationMs;
    const hours = FARM_LEVEL_XP[TRADE_MIN_FARM_LEVEL - 1]! / xpPerHour;

    expect(hours).toBeGreaterThan(2);
    expect(hours).toBeLessThan(24);
  });
});

/**
 * Building crop-windows (T-7.11).
 *
 * Each `*_LOOK` is a hand-measured rectangle into a whole-kit image. Nothing
 * else validates them: a window that runs off the edge, or one that quietly
 * spans two poses, renders wrong art with no error and no failing test —
 * which is exactly how T-7.11 first shipped a double-wide shipping box.
 */
describe('building crop windows', () => {
  const CASES = [
    { name: 'tiny house', img: OBJ_TINY_HOUSE, look: OBJ_TINY_HOUSE_LOOK },
    { name: 'shipping box', img: OBJ_SHIPPING_BOX, look: OBJ_SHIPPING_BOX_LOOK },
    // Read off the tier tables rather than listed by hand (T-12.02b), so a
    // fourth coop or barn is covered the day it is added rather than the day
    // someone remembers this file.
    ...COOP_TIER_ART.map((art, tier) => ({
      name: `chicken coop tier ${tier}`,
      img: art.sheet,
      look: art.look,
    })),
    ...BARN_TIER_ART.map((art, tier) => ({
      name: `barn tier ${tier}`,
      img: art.sheet,
      look: art.look,
    })),
  ] as const;

  it.each(CASES)('$name crop window stays inside its source image', ({ img, look }) => {
    expect(look.width).toBeGreaterThan(0);
    expect(look.height).toBeGreaterThan(0);
    expect(look.x).toBeGreaterThanOrEqual(0);
    expect(look.y).toBeGreaterThanOrEqual(0);
    expect(look.x + look.width).toBeLessThanOrEqual(img.width);
    expect(look.y + look.height).toBeLessThanOrEqual(img.height);
  });

  /**
   * Pinned as a literal. The closed crates in this sheet touch with no
   * transparent column between them, so re-deriving this from alpha bounds
   * gives 29 — two crates — and looks plausible. 16 is one crate.
   */
  it('crops the shipping box to a single 16px crate, not the adjacent pair', () => {
    expect(OBJ_SHIPPING_BOX_LOOK.width).toBe(16);
    expect(OBJ_SHIPPING_BOX_LOOK.height).toBe(16);
  });
});

/**
 * T-9.05's guards on the maple loop. These frame numbers came from differencing
 * the sheet, and nothing else in the manifest can tell a leaf-drift frame from
 * a white silhouette — an out-of-range index would just draw the wrong tree.
 */
describe('maple tree animation', () => {
  it('animates the same tree the map placed, from the row that matches it', () => {
    // The two sheets are different shapes, so this is the only thing keeping
    // "the tree the map draws" and "the tree that animates" the same tree.
    expect(MAPLE_TREE.animRow).toBeLessThan(OBJ_MAPLE_TREE_ANIM.rows);
    expect(MAPLE_TREE.stillFrame).toBeLessThan(OBJ_MAPLE_TREE.cols * OBJ_MAPLE_TREE.rows);
    // Both sheets draw at one tile wide by three tall, so swapping one for the
    // other cannot shift the tree on the map.
    expect(OBJ_MAPLE_TREE_ANIM.frameWidth).toBe(OBJ_MAPLE_TREE.frameWidth);
    expect(OBJ_MAPLE_TREE_ANIM.frameHeight).toBe(OBJ_MAPLE_TREE.frameHeight);
  });

  it('skips the white silhouette column', () => {
    // Column 1 is the tree with its canopy filled solid white. In the loop it
    // would strobe the tree once a second, which is why it is named here
    // rather than left as "the columns we happened to pick".
    expect(MAPLE_TREE.animColumns).not.toContain(1);
    expect(MAPLE_TREE.animColumns).toEqual([0, 2, 3]);
  });

  it('resolves to real frames of the animated sheet, in play order', () => {
    const total = OBJ_MAPLE_TREE_ANIM.cols * OBJ_MAPLE_TREE_ANIM.rows;

    expect(MAPLE_TREE_ANIM_FRAMES).toHaveLength(MAPLE_TREE.animColumns.length);
    for (const frame of MAPLE_TREE_ANIM_FRAMES) {
      expect(Number.isInteger(frame)).toBe(true);
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(total);
    }
    // Every frame comes from the one row: a loop that wandered into the next
    // row would change the tree's colour mid-animation.
    for (const frame of MAPLE_TREE_ANIM_FRAMES) {
      expect(Math.floor(frame / OBJ_MAPLE_TREE_ANIM.cols)).toBe(MAPLE_TREE.animRow);
    }
    expect([...MAPLE_TREE_ANIM_FRAMES]).toEqual([0, 2, 3]);
  });

  it('plays slowly enough to read as leaves rather than flicker', () => {
    expect(MAPLE_TREE.frameRate).toBeGreaterThan(0);
    expect(MAPLE_TREE.frameRate).toBeLessThanOrEqual(4);
  });
});
