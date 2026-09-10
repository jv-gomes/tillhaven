#!/usr/bin/env node
/**
 * Copies game art out of /assets (the licensed EmanuelleDev pack — see
 * ATTRIBUTION.md) into apps/client/public/assets under kebab-case names.
 *
 * Run with `pnpm assets`. Idempotent — safe to re-run; output is a pure
 * function of the source pack and the lists below.
 *
 * Adding art = adding one line to COPIES (single sheets) — or, for character
 * layers, nothing: whole layer folders are walked automatically.
 *
 * **This is no longer a pure copier, and the header used to say it was.**
 *
 * The v1 script carried a hand-rolled PNG codec to crop and colour-key the old
 * pack's broken tileset. T-7.02 dropped it, because the new pack is clean
 * transparent PNG throughout, and left a note: if a transform is ever needed
 * again, resurrect the codec rather than reaching for a native dependency.
 *
 * Phase U needed one. `border-image` slices a nine-slice from the source
 * image's own outer edges, so the pack's 48x16 button plate — a sub-region of
 * an 848x544 atlas — cannot be sliced where it sits, and `hud.css` spent a
 * release drawing button bevels by hand because of it. Cutting each frame into
 * its own file is the entire fix.
 *
 * So there are now TWO stages, and they are kept apart on purpose:
 *   - COPIES / character layers — byte-for-byte, unchanged, still the default;
 *   - UI_CROPS (`lib/ui-crops.mjs`) — rectangles cut with `lib/png.mjs`.
 *
 * Every crop is **verified by decoding it back** and comparing to the source
 * rectangle before it counts as written. That is not belt-and-braces: it is the
 * only automated check on the codec (`scripts/` belongs to no package and the
 * repo has no root test runner), and it also catches a crop rectangle that has
 * gone stale against a reorganised pack — which has happened twice to the paths
 * in this file already.
 *
 * Character layers land at:
 *   public/assets/character/<anim>/<layer>/<variant>.png
 * where <anim> ∈ idle|walk|run|hoe|watering, <layer> ∈ skin|eyes|hair|
 * clothes|tool, and <variant> is kebab-case (`male-black`, `fawn-ginger`,
 * `blue`, `1`…). This layout is a CONTRACT: the character creator (T-8.02)
 * and the layered renderer (T-8.03) build URLs from it. Change it in one
 * place only — here — and update those call sites in the same commit.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, cropPng } from './lib/png.mjs';
import { UI_CROPS } from './lib/ui-crops.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * **The pack moved from `new_assets/` to `assets/`.**
 *
 * The incomplete copy of the pack was deleted and the complete one took the
 * `assets/` name — which used to be the v1 pack's home until T-7.07 deleted
 * it. So `assets/` means something different from what it meant in Phase 7,
 * and `new_assets/` no longer exists at all.
 *
 * Nothing here transforms; the pack is clean transparent PNG throughout.
 */
const SRC = join(ROOT, 'assets');
const OUT = join(ROOT, 'apps', 'client', 'public', 'assets');

/*
 * **The first-party ground fills are gone, deliberately.**
 *
 * `original-assets/ground/*.png` — flat grass, path and soil tiles drawn by
 * `scripts/draw-ground-tiles.py` (T-7.05) — existed because the v1 pack had
 * no usable ground. The complete pack does: the MVP re-scope paints ground
 * from `Tileset Grass Spring` and tilled soil from `Tilled Soil and wet
 * soil`, so the stand-ins have nothing left to stand in for. Both the source
 * directory and the generator are removed; resurrect them from git history if
 * a first-party tile is ever needed again.
 */

/* ------------------------------------------------------------------ *
 * Single-sheet copies: [source path relative to /assets, output name].
 * Every sheet the asset manifest (packages/shared/src/config/assets.ts)
 * references must appear here.
 * ------------------------------------------------------------------ */
const COPIES = [
  // Terrain
  ['Tileset/Tileset Grass Spring.png', 'tileset-grass-spring.png'],
  ['Tileset/Tilled Soil and wet soil.png', 'tileset-soil.png'],
  ['Tileset/Tileset Grass Water Spring.png', 'tileset-grass-water-spring.png'],
  ['Tileset/Water tile.png', 'water-tile.png'],
  // The animated water the map floats on (docs/art-measurements.md). The cliff
  // tileset is NOT copied — see the note in assets.ts: it edges a height
  // change and the farm is flat.
  ['Tileset/Water Ground animations tiles.png', 'tileset-water-anim.png'],
  ['Tileset/Path tiles.png', 'tileset-paths.png'],
  // Flat ground scatter for the farm's `decor` tile layer (T-18.09). The
  // sheet holds every season's props in bands; only the SPRING tufts and the
  // stones are used, and only the flat ones — see `GROUND_SCATTER`.
  ['Tileset/ALL props seasons.png', 'tileset-props-seasons.png'],

  // World objects. The `obj-` prefix is not decoration: several old-pack
  // files in the same output directory share bare names (`chest.png`,
  // `maple-tree.png`…) with DIFFERENT geometry, and they must survive
  // untouched until T-7.07 deletes them — a name collision here would
  // overwrite them and break the current client's frame verification.
  ['Objects/Tree/Common/Shadow/Maple Tree.png', 'obj-maple-tree.png'],
  ['Objects/Tree/Common/Shadow/Maple Tree Animation.png', 'obj-maple-tree-anim.png'],
  ['Objects/Exterior/Houses/Tiny House.png', 'obj-tiny-house.png'],
  // Three tiers of each animal building (T-12.02b). The tier suffix matches
  // the manifest key, which matches `COOP_TIER_ART` / `BARN_TIER_ART` index —
  // basic is tier 0 and keeps its unsuffixed name so nothing older moves.
  ['Objects/Exterior/Houses/Farm Buildings/Chicken Coop/Chicken Coop.png', 'obj-chicken-coop.png'],
  [
    'Objects/Exterior/Houses/Farm Buildings/Chicken Coop/Big Chicken Coop.png',
    'obj-chicken-coop-big.png',
  ],
  [
    'Objects/Exterior/Houses/Farm Buildings/Chicken Coop/Deluxe Chicken Coop.png',
    'obj-chicken-coop-deluxe.png',
  ],
  ['Objects/Exterior/Houses/Farm Buildings/Barn/Barn.png', 'obj-barn.png'],
  ['Objects/Exterior/Houses/Farm Buildings/Barn/Big Barn.png', 'obj-barn-big.png'],
  ['Objects/Exterior/Houses/Farm Buildings/Barn/Deluxe Barn.png', 'obj-barn-deluxe.png'],
  ['Objects/Exterior/chest.png', 'obj-chest.png'],
  ['Objects/Exterior/shipping box.png', 'obj-shipping-box.png'],
  ['Objects/Exterior/Mailbox.png', 'obj-mailbox.png'],
  // The merchant's stall (T-11.04). One pose, one image — see OBJ_NEWSSTAND.
  ['Objects/Exterior/Newsstand.png', 'obj-newsstand.png'],
  // The shopkeeper who stands at that stall (T-18.02). One idle strip, not the
  // whole layered NPC tree: this character never walks and never changes
  // clothes, so a premade pose is all of it.
  [
    "Character/NPC'S/Blacksmith/Premade/Alaric/Blacksmith Idle.png",
    'npc-merchant-idle.png',
  ],
  /*
   * The Chef (T-33.03), the second face in the village.
   *
   * **The pack ships exactly two premade townsfolk** — Alaric above and Gaston
   * here — and the shopkeeper is already wearing Alaric. That is why there is
   * no `npc-blacksmith-idle.png` beside this line; see D-28.
   */
  ["Character/NPC'S/Chef/Premade/Gaston/Chef Sprites Idle.png", 'npc-chef-idle.png'],

  /*
   * The river fish (T-34.04). Eighteen 64x16 strips of four 16x16 frames — the
   * pack ships eighteen, not the nine the phase brief assumed.
   *
   * They land in `ICON_SHEETS`, not `SHEETS`, so none of them consumes a gid
   * and `farm.json` is untouched. See the note on that list.
   */
  ['Icons/Fish/River/Carp.png', 'icon-fish-carp.png'],
  ['Icons/Fish/River/Chub.png', 'icon-fish-chub.png'],
  ['Icons/Fish/River/Perch.png', 'icon-fish-perch.png'],
  ['Icons/Fish/River/Sunfish.png', 'icon-fish-sunfish.png'],
  ['Icons/Fish/River/Shad .png', 'icon-fish-shad.png'],
  ['Icons/Fish/River/Bullhead Catfish.png', 'icon-fish-bullhead-catfish.png'],
  ['Icons/Fish/River/Large Mouth Bass.png', 'icon-fish-large-mouth-bass.png'],
  ['Icons/Fish/River/Walleye.png', 'icon-fish-walleye.png'],
  ['Icons/Fish/River/Pike Fish.png', 'icon-fish-pike.png'],
  ['Icons/Fish/River/Tiger Trout.png', 'icon-fish-tiger-trout.png'],
  ['Icons/Fish/River/Sturgeon.png', 'icon-fish-sturgeon.png'],
  ['Icons/Fish/River/Dorado.png', 'icon-fish-dorado.png'],
  ['Icons/Fish/River/Ghost Catfish.png', 'icon-fish-ghost-catfish.png'],
  ['Icons/Fish/River/Bone Fish.png', 'icon-fish-bone-fish.png'],
  ['Icons/Fish/River/Zombie Fish.png', 'icon-fish-zombie-fish.png'],
  ['Icons/Fish/River/Dynamite Fish.png', 'icon-fish-dynamite-fish.png'],
  ['Icons/Fish/River/Faeries Fish.png', 'icon-fish-faeries-fish.png'],
  ['Icons/Fish/River/Golden Fish.png', 'icon-fish-golden-fish.png'],
  /*
   * The farmhouse (T-15.29). A fully assembled house — roof, walls, door,
   * windows, chimney — unlike `Tiny House.png`, which is a construction kit
   * whose only complete looks are doorless silhouettes. T-7.11 measured the
   * kit honestly and recorded the result as "plainer than the old pack's";
   * it simply never found this file.
   */
  ['Objects/Exterior/Houses/3.png', 'obj-farmhouse.png'],

  /*
   * The upgrade ladder (T-17.06). `7.png` and `8.png` are the same
   * brick-and-timber family as `3.png`, progressively larger — the only three
   * of the twelve that form a ladder rather than a seasonal or themed variant.
   *
   * Not `Upgrade House.png`, which IS a genuine three-step ladder but in a
   * different style family and 9-11 tiles tall: adopting it would change tier 0
   * as well, so every existing farm's house would swap out from under its
   * owner, and every tier would overhang the map's border row rather than only
   * the top one.
   */
  ['Objects/Exterior/Houses/7.png', 'obj-farmhouse-t1.png'],
  ['Objects/Exterior/Houses/8.png', 'obj-farmhouse-t2.png'],

  /*
   * Placeable farm decoration (T-15.15).
   *
   * All kits rather than single sprites — `Scarescrow.png` is eight scarecrows,
   * `Village Signs.png` is twelve signs in summer and snow — so the catalogue
   * in `config/decor.ts` picks a window out of each rather than drawing the
   * whole file. Measured by `scripts/measure-decor.mjs`, never guessed.
   *
   * Named `decor-*` so they sort together and can never collide with the
   * `obj-*` map objects, which is the class of bug T-7.02 hit when six new
   * sheets landed under names the old pack also used.
   */
  ['Objects/Exterior/Fence and Bridge/Fence Wood.png', 'decor-fence-wood.png'],
  ['Objects/Exterior/Scarescrow.png', 'decor-scarecrow.png'],
  ['Objects/Exterior/Street Lamp.png', 'decor-street-lamp.png'],
  ['Objects/Exterior/Hay Bales.png', 'decor-hay-bales.png'],
  ['Objects/Exterior/Feed Trough.png', 'decor-feed-trough.png'],
  ['Objects/Exterior/Stone Statue.png', 'decor-stone-statue.png'],
  ['Objects/Exterior/Birdhouse.png', 'decor-birdhouse.png'],
  ['Objects/Exterior/Village Signs.png', 'decor-village-signs.png'],
  ['Objects/Exterior/Berry Piles.png', 'decor-berry-piles.png'],
  ['Objects/Exterior/Stacked Barrels.png', 'decor-stacked-barrels.png'],

  // Crops (Spring Onion doubles as the game's "leek" — closest art match)
  ['Crops/Spring/Potato.png', 'crop-potato.png'],
  ['Crops/Spring/Strawberry.png', 'crop-strawberry.png'],
  ['Crops/Spring/Onion.png', 'crop-onion.png'],
  ['Crops/Spring/Spring Onion.png', 'crop-spring-onion.png'],

  /*
   * Phase 31's crops (T-31.02), copied in ONE batch for the same reason they
   * are appended to `SHEETS` in one batch: every touch of `SHEETS` renumbers
   * every `IMAGES` firstgid and forces a `farm.json` regeneration, so the
   * phase pays that cost once.
   *
   * **Eleven sheets, measured** — see `docs/crop-sheets.md` and
   * `scripts/measure-crops.mjs`. `Blueberry` is the one spring sheet left out:
   * it is 16x32, and the crop sprite is centred on its tile (`Farm.ts`), so a
   * 32px-tall frame would hang half into the tile below. Tall crops need a
   * per-crop anchor, which is code.
   *
   * **Spring only** since the MVP re-scope: the nine summer and fall crops and
   * their sheets are gone. `docs/crop-sheets.md` lists the eleven that remain
   * and why `Blueberry` is not among them.
   */
  ['Crops/Spring/Asparagus.png', 'crop-asparagus.png'],
  ['Crops/Spring/Broccoli.png', 'crop-broccoli.png'],
  ['Crops/Spring/Cabbage.png', 'crop-cabbage.png'],
  ['Crops/Spring/Carrot.png', 'crop-carrot.png'],
  ['Crops/Spring/Cauliflower.png', 'crop-cauliflower.png'],
  ['Crops/Spring/Parsnip.png', 'crop-parsnip.png'],
  ['Crops/Spring/Rice.png', 'crop-rice.png'],

  // Animals — every variant in the pack (T-12.01). `animal-` prefix for the
  // same collision reason as `obj-`. Output names are `animal-<kind>-<slug>`
  // where <slug> matches the variant id in config/animals.ts minus its
  // `chicken_`/`cow_` prefix, so a variant id and its file name can be read
  // off each other. The pack's own file names are NOT that regular (double
  // spaces, "Female Cow Brown" vs the id's brown-female order), which is
  // exactly why the mapping is written out here rather than derived.
  ['Animals/Farm/Chicken/Chicken Black.png', 'animal-chicken-black.png'],
  ['Animals/Farm/Chicken/Chicken Black White.png', 'animal-chicken-black-white.png'],
  ['Animals/Farm/Chicken/Chicken Blonde.png', 'animal-chicken-blonde.png'],
  ['Animals/Farm/Chicken/Chicken Blonde  Green.png', 'animal-chicken-blonde-green.png'],
  ['Animals/Farm/Chicken/Chicken Brown Black.png', 'animal-chicken-brown-black.png'],
  ['Animals/Farm/Chicken/Chicken Brown White.png', 'animal-chicken-brown-white.png'],
  ['Animals/Farm/Chicken/Chicken Evil.png', 'animal-chicken-evil.png'],
  ['Animals/Farm/Chicken/Chicken Full.png', 'animal-chicken-full.png'],
  ['Animals/Farm/Chicken/Chicken Green.png', 'animal-chicken-green.png'],
  ['Animals/Farm/Chicken/Chicken Pink.png', 'animal-chicken-pink.png'],
  ['Animals/Farm/Chicken/Chicken Red.png', 'animal-chicken-red.png'],
  ['Animals/Farm/Chicken/Chicken Universe.png', 'animal-chicken-universe.png'],
  ['Animals/Farm/Chicken/Chicken White.png', 'animal-chicken-white.png'],

  // Chick sheets. The pack ships 10 of them for 13 adults, so several adults
  // share one — the pairing is by BODY colour and lives in config/animals.ts
  // (`babySheet`). `Baby Chicken Yellow` is the odd one out: no adult is
  // yellow, so no variant hatches into it, but it is the storybook chick the
  // landing page uses and it stays for that.
  ['Animals/Farm/Chicken/Baby Chicken Black.png', 'animal-chicken-baby-black.png'],
  ['Animals/Farm/Chicken/Baby Chicken Blonde.png', 'animal-chicken-baby-blonde.png'],
  ['Animals/Farm/Chicken/Baby Chicken Brown.png', 'animal-chicken-baby-brown.png'],
  ['Animals/Farm/Chicken/Baby Chicken Evil.png', 'animal-chicken-baby-evil.png'],
  ['Animals/Farm/Chicken/Baby Chicken Green.png', 'animal-chicken-baby-green.png'],
  ['Animals/Farm/Chicken/Baby Chicken Pink.png', 'animal-chicken-baby-pink.png'],
  ['Animals/Farm/Chicken/Baby Chicken Red.png', 'animal-chicken-baby-red.png'],
  ['Animals/Farm/Chicken/Baby Chicken Universe.png', 'animal-chicken-baby-universe.png'],
  ['Animals/Farm/Chicken/Baby Chicken White.png', 'animal-chicken-baby-white.png'],
  ['Animals/Farm/Chicken/Baby Chicken Yellow.png', 'animal-chicken-baby-yellow.png'],

  // Cows. "Highlighter Cow" is the pack's spelling of a Highland-cattle
  // breed (shaggy coat, long horns); the game calls it `highland` so the
  // variant id reads as an animal rather than a stationery item.
  ['Animals/Farm/Cow/Common Cow/Female Cow Black.png', 'animal-cow-black-female.png'],
  ['Animals/Farm/Cow/Common Cow/Male Cow Black.png', 'animal-cow-black-male.png'],
  ['Animals/Farm/Cow/Common Cow/Female Cow Blonde.png', 'animal-cow-blonde-female.png'],
  ['Animals/Farm/Cow/Common Cow/Male Cow Blonde.png', 'animal-cow-blonde-male.png'],
  ['Animals/Farm/Cow/Common Cow/Female Cow Brown.png', 'animal-cow-brown-female.png'],
  ['Animals/Farm/Cow/Common Cow/Male Cow Brown.png', 'animal-cow-brown-male.png'],
  ['Animals/Farm/Cow/Common Cow/Female Cow Pink.png', 'animal-cow-pink-female.png'],
  ['Animals/Farm/Cow/Common Cow/Male Cow Pink.png', 'animal-cow-pink-male.png'],
  ['Animals/Farm/Cow/Highlighter Cow/Female highlighter Black.png', 'animal-cow-highland-black-female.png'],
  ['Animals/Farm/Cow/Highlighter Cow/Male highlighter Black.png', 'animal-cow-highland-black-male.png'],
  ['Animals/Farm/Cow/Highlighter Cow/Female highlighter Brown.png', 'animal-cow-highland-brown-female.png'],
  ['Animals/Farm/Cow/Highlighter Cow/Male highlighter Brown.png', 'animal-cow-highland-brown-male.png'],

  // Tool icons (wood tier only until D-4 is decided)
  ['Icons/RPG icons/Weapons and Armor/1. Wood/Hoe.png', 'tool-hoe-wood.png'],
  ['Icons/RPG icons/Weapons and Armor/1. Wood/Watering can.png', 'tool-watering-can-wood.png'],
  // Chopping (T-20.02). Wood tier, like the other two — D-4 still owns what the
  // eight higher tiers mean.
  ['Icons/RPG icons/Weapons and Armor/1. Wood/Axe.png', 'tool-axe-wood.png'],
  ['Icons/RPG icons/Extras/Wood.png', 'icon-wood.png'],

  // Item icons for animal produce/feed (T-7.09) — see assets.ts's ICON_*
  // block for why Wheat stands in for "hay".
  ['Icons/Food Icons/Chicken Egg.png', 'icon-chicken-egg.png'],
  ['Icons/Food Icons/Small Cow Milk.png', 'icon-cow-milk.png'],
  ['Icons/Food Icons/Animal Feed.png', 'icon-animal-feed.png'],
  ['Icons/Food Icons/Wheat.png', 'icon-wheat.png'],

  // Seed packets (T-16.01). Seven 16x16 bags on one strip; each crop picks
  // one. The pack has no seed art anywhere — checked — so a coloured sack is
  // the closest honest stand-in for "seeds you have not planted yet", and it
  // is the ONLY icon in the game that must not look like a growth stage.
  ['Crops/All Crops.png', 'icon-all-crops.png'],

  // Interior (T-16.07). The floor/wall TILESET plus the furniture kits the
  // pieces in `furniture.ts` are cropped from. `Tileset House.png` is the file
  // whose absence T-3.05 recorded as "no floor or wall tiles anywhere in the
  // pack" — true of the OLD pack, which is why the interior was a drawn
  // rectangle for six phases.
  ['Tileset/Tileset House.png', 'tileset-house.png'],
  ['Tileset/carpet.png', 'interior-carpet.png'],
  ['Objects/Interior/Beds.png', 'interior-beds.png'],
  ['Objects/Interior/Tables and desks.png', 'interior-tables.png'],
  ['Objects/Interior/Chairs.png', 'interior-chairs.png'],
  ['Objects/Interior/Dressers.png', 'interior-dressers.png'],
  ['Objects/Interior/Fireplace.png', 'interior-fireplaces.png'],
  ['Objects/Interior/Doors, windows and curtains.png', 'interior-openings.png'],
  ['Objects/Interior/Others.png', 'interior-others.png'],
  // "Part 1 copiar" is the pack's unlabelled TRINKETS sheet — framed pictures,
  // a grandfather clock, potted plants, vases, lamps. Nothing in the pack is
  // named for any of those, which is why T-3.05 had to invent its own crops.
  ['Objects/Interior/Part 1 copiar.png', 'interior-trinkets.png'],

  /*
   * UI.
   *
   * Phase U brought over the whole `UI/` folder. It had been seven files of
   * twenty-five, and the eighteen it skipped were not leftovers — they were
   * the frames, bars and tags the HUD had spent three phases approximating in
   * CSS. `Bars.png` in particular: `assets.ts` records that the MVP re-scope
   * "asked for a HUD frame from this sheet, and there is not one", pointing at
   * `UI/Bars.png` as where the bar art actually lived, and then nothing copied
   * it, so the energy bar shipped as a hand-written three-stop gradient.
   *
   * These are whole sheets; CSS reads frames out of them by
   * `background-position`. The pieces that need to be their own file — the
   * nine-slices — are cut by UI_CROPS instead, below.
   */
  ['UI/Inventory/Book.png', 'ui-inventory-book.png'],
  ['UI/Inventory/Slots.png', 'ui-inventory-slots.png'],
  ['UI/HUD.png', 'ui-hud.png'],
  ['UI/Money.png', 'ui-money.png'],
  // The day/night clock (MVP re-scope): a 32x32 face and an 8-frame hand.
  ['UI/Clock/Clock.png', 'ui-clock.png'],
  ['UI/Clock/clock hand.png', 'ui-clock-hand.png'],
  ['UI/button.png', 'ui-button.png'],
  // Bars: hearts, stars, vertical tubes, and the horizontal tracks the energy
  // and XP bars now use instead of a gradient.
  ['UI/Bars.png', 'ui-bars.png'],
  // Slider rails and knobs.
  ['UI/Extras.png', 'ui-extras.png'],
  // 96 pill tags and ribbon banners on a 32x32 grid — tabs, badges, price chips.
  ['UI/Inventory/Extras.png', 'ui-tags.png'],
  // Panel frames, arrows, and the two bracket frames UI_CROPS cuts out.
  ['UI/Inventory/Banner.png', 'ui-banner.png'],
  // Rounded panel kit — the source of ui-panel.png.
  ['UI/Inventory/inventory.png', 'ui-inventory-kit.png'],
  // Scallop border trim for panel edging.
  ['UI/Inventory/Decor.png', 'ui-decor.png'],
  // 24 equipment-slot glyphs: empty-slot placeholder art.
  ['UI/Inventory/Slot Armor.png', 'ui-slot-glyphs.png'],
  // The dialogue box and ~20 speech bubbles.
  ['UI/dialogue box.png', 'ui-dialogue-sheet.png'],
  // 16x16 grid, 10x3 — weather row plus moon phases, for the HUD clock.
  ['UI/weather icons.png', 'ui-weather.png'],
  // 9x21 grid of emotes and reactions.
  ['UI/speech bubble, emojis, reaction.png', 'ui-emotes.png'],
  // Wooden plaques and signboards.
  ['UI/0.2.png', 'ui-plaques.png'],
  // Date/time plaques and banner frames.
  ['UI/Clock/Extras.png', 'ui-clock-plaques.png'],
  // Alternate clock faces: 18 day/night frames, and three smaller sets.
  ['UI/Clock/Others/clock.png', 'ui-clock-daynight.png'],
  ['UI/Clock/Others/Clock 2.png', 'ui-clock-standing.png'],
  ['UI/Clock/Others/Clock 3.png', 'ui-clock-alt3.png'],
  ['UI/Clock/Others/clock 4.png', 'ui-clock-alt4.png'],
  // Music-player widgets and social logos: not used by the MVP, brought over so
  // the folder is complete and the next person does not re-discover them.
  ['UI/UI music.png', 'ui-music.png'],
  ['UI/social network logos.png', 'ui-social.png'],
];

/* ------------------------------------------------------------------ *
 * Character layers.
 *
 * Each animation folder in the pack contains the same layer tree; every
 * file in it is a single-row strip with identical dimensions per animation,
 * which is what makes stacking them as sprites trivial. Copied wholesale so
 * the character creator can offer every option without this list needing an
 * update when the player picks something new.
 * ------------------------------------------------------------------ */
const CHARACTER_SRC = 'Character/Character/PNG';

/** Pack animation folder -> our kebab animation name. */
const CHARACTER_ANIMS = [
  ['1. Idle', 'idle'],
  ['2. Walk', 'walk'],
  ['3. Run', 'run'],
  ['4. Pickaxe, Hoe and Catching insects', 'hoe'],
  ['7. Watering', 'watering'],
  // Chopping (T-20.04). Measured before wiring: every layer file in the folder
  // is 768x32, identical to `4. Pickaxe, Hoe`, so it needs no special-casing.
  ['5. Axe and Sickle', 'axe'],
  // T-16.02. Every layer file inside each of these was measured and confirmed
  // to share one size before being wired; the folders carry the identical
  // Skins/Eyes/Hair's/Clothers tree the five above do, which is why they need
  // no special-casing in `characterCopies`.
  ['6. Shovel', 'plant'],
  ['13.3 Carrying - Pick Up', 'harvest'],
  ['20. Petting', 'pet'],
];

/**
 * Tool overlay strips: the tool in the character's hands, one strip per
 * tier, matching the animation's frame layout exactly. Only wood (tier 1)
 * ships until D-4 decides what other tiers mean.
 */
const TOOL_OVERLAYS = [
  ['4. Pickaxe, Hoe and Catching insects', 'Weapons/Hoe/1.png', 'hoe', 'wood.png'],
  ['7. Watering', 'Weapons/Watering/1.png', 'watering', 'wood.png'],
  // The axe in hand (T-20.04). The folder also ships `Weapons/Sickle` at the
  // same geometry, deliberately unused: there is no sickle item, and drawing
  // one would put an implement nobody owns in the player's hands — the same
  // rule that keeps the shovel out below.
  ['5. Axe and Sickle', 'Weapons/Axe/1.png', 'axe', 'wood.png'],
  // NOT `6. Shovel`, although it ships Weapons/Shovel/1.png at matching
  // geometry: there is no shovel item, so drawing one would put an implement
  // nobody owns in the player's hands. See `TOOL_ANIMS` in assets.ts.
];

const kebab = (name) => name.toLowerCase().replace(/\.png$/, '').replace(/[\s_]+/g, '-');

/** -> [ [srcRelPath, outRelPath], ... ] for one animation's layer tree. */
function characterCopies(packAnim, anim) {
  const base = join(CHARACTER_SRC, packAnim);
  const out = [];

  // Skins/1.png -> character/<anim>/skin/1.png
  for (const f of readdirSync(join(SRC, base, 'Skins'))) {
    out.push([join(base, 'Skins', f), join('character', anim, 'skin', kebab(f) + '.png')]);
  }

  // Eyes/<Sex>/<Color>.png -> character/<anim>/eyes/<sex>-<color>.png
  for (const sex of readdirSync(join(SRC, base, 'Eyes'))) {
    for (const f of readdirSync(join(SRC, base, 'Eyes', sex))) {
      out.push([
        join(base, 'Eyes', sex, f),
        join('character', anim, 'eyes', `${kebab(sex)}-${kebab(f)}.png`),
      ]);
    }
  }

  // Hair's/<Style>/<Color>.png -> character/<anim>/hair/<style>-<color>.png
  for (const style of readdirSync(join(SRC, base, "Hair's"))) {
    for (const f of readdirSync(join(SRC, base, "Hair's", style))) {
      out.push([
        join(base, "Hair's", style, f),
        join('character', anim, 'hair', `${kebab(style)}-${kebab(f)}.png`),
      ]);
    }
  }

  // Clothers/Farm/<Color>.png -> character/<anim>/clothes/<color>.png
  for (const f of readdirSync(join(SRC, base, 'Clothers', 'Farm'))) {
    out.push([
      join(base, 'Clothers', 'Farm', f),
      join('character', anim, 'clothes', kebab(f) + '.png'),
    ]);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function main() {
  if (!existsSync(SRC)) {
    console.error(
      `No asset pack at ${SRC}\n` +
        'The pack is licensed and never committed (see ATTRIBUTION.md) — ' +
        'copy it in manually before running `pnpm assets`.',
    );
    process.exit(1);
  }

  const jobs = [...COPIES.map(([from, to]) => [join(SRC, from), to])];

  for (const [packAnim, anim] of CHARACTER_ANIMS) {
    for (const [from, to] of characterCopies(packAnim, anim)) {
      jobs.push([join(SRC, from), to]);
    }
  }
  for (const [packAnim, srcRel, anim, outName] of TOOL_OVERLAYS) {
    jobs.push([
      join(SRC, CHARACTER_SRC, packAnim, srcRel),
      join('character', anim, 'tool', outName),
    ]);
  }
  let copied = 0;
  for (const [srcPath, to] of jobs) {
    if (!existsSync(srcPath)) {
      console.error(`  MISSING  ${srcPath}`);
      process.exitCode = 1;
      continue;
    }
    const outPath = join(OUT, to);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, readFileSync(srcPath));
    copied++;
  }

  console.log(`${copied}/${jobs.length} assets written to apps/client/public/assets/`);
  if (copied !== jobs.length) {
    console.error(`${jobs.length - copied} source file(s) missing — see above.`);
  }

  const cut = cropStage();
  console.log(`${cut}/${UI_CROPS.length} UI nine-slices cut to apps/client/public/assets/`);
}

/**
 * Cut every rectangle in UI_CROPS into its own file.
 *
 * Each source sheet is decoded once and reused — eleven plates come out of one
 * 848x544 atlas, and decoding it eleven times would be the slowest thing this
 * script does.
 *
 * **Every crop is read back before it counts.** The written file is decoded and
 * compared byte-for-byte against the rectangle it came from; a mismatch is
 * fatal rather than a warning, because a silently-wrong nine-slice does not
 * look wrong at the pixel that is wrong — it looks like a smeared corner on
 * every panel that uses it, three files away from the cause.
 */
function cropStage() {
  const sheets = new Map();
  let written = 0;

  for (const crop of UI_CROPS) {
    const srcPath = join(SRC, crop.src);
    if (!sheets.has(srcPath)) {
      if (!existsSync(srcPath)) {
        console.error(`  MISSING  ${srcPath}`);
        process.exitCode = 1;
        sheets.set(srcPath, null);
        continue;
      }
      sheets.set(srcPath, decodePng(readFileSync(srcPath)));
    }
    const sheet = sheets.get(srcPath);
    if (!sheet) continue;

    let piece;
    try {
      piece = cropPng(sheet, crop.x, crop.y, crop.w, crop.h);
    } catch (err) {
      console.error(`  BAD CROP ${crop.out}: ${err.message}`);
      process.exitCode = 1;
      continue;
    }

    const outPath = join(OUT, crop.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, encodePng(piece));

    const back = decodePng(readFileSync(outPath));
    if (back.width !== piece.width || back.height !== piece.height || !back.data.equals(piece.data)) {
      console.error(`  CORRUPT  ${crop.out} did not survive a decode round-trip`);
      process.exitCode = 1;
      continue;
    }
    written++;
  }

  return written;
}

main();
