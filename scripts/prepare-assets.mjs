#!/usr/bin/env node
/**
 * Copies game art out of /new_assets (the licensed EmanuelleDev pack — see
 * ATTRIBUTION.md) into apps/client/public/assets under kebab-case names.
 *
 * Run with `pnpm assets`. Idempotent — safe to re-run; output is a pure
 * function of the source pack and the lists below.
 *
 * Adding art = adding one line to COPIES (single sheets) — or, for character
 * layers, nothing: whole layer folders are walked automatically.
 *
 * The v1 script carried a hand-rolled PNG codec to crop and colour-key the
 * old pack's broken tileset. The new pack is clean transparent PNG
 * throughout, so this is now a plain copier — if a transform is ever needed
 * again, resurrect the codec from git history rather than reaching for a
 * native dependency.
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'new_assets');
const OUT = join(ROOT, 'apps', 'client', 'public', 'assets');

/**
 * First-party art the pack does not provide — tracked in git (unlike
 * `new_assets/`, which is licensed and gitignored), same reasoning as
 * `scripts/draw-item-icons.py`'s `assets/Objects/Items.png`. Currently just
 * `scripts/draw-ground-tiles.py`'s flat ground-fill tiles (T-7.05) — see its
 * docstring for why the pack needs them.
 */
const OWN_SRC = join(ROOT, 'original-assets');
const OWN_COPIES = [
  ['ground/grass.png', 'ground-grass.png'],
  ['ground/soil-dry.png', 'ground-soil-dry.png'],
  ['ground/soil-wet.png', 'ground-soil-wet.png'],
  ['ground/path.png', 'ground-path.png'],
];

/* ------------------------------------------------------------------ *
 * Single-sheet copies: [source path relative to /new_assets, output name].
 * Every sheet the asset manifest (packages/shared/src/config/assets.ts)
 * references must appear here.
 * ------------------------------------------------------------------ */
const COPIES = [
  // Terrain
  ['Tileset/Tileset Grass Spring.png', 'tileset-grass-spring.png'],
  ['Tileset/Tilled Soil and wet soil.png', 'tileset-soil.png'],
  ['Tileset/Tileset Grass Water Spring.png', 'tileset-grass-water-spring.png'],
  ['Tileset/Water tile.png', 'water-tile.png'],
  ['Tileset/Path tiles.png', 'tileset-paths.png'],

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

  // Crops (Spring Onion doubles as the game's "leek" — closest art match)
  ['Crops/Spring/Potato.png', 'crop-potato.png'],
  ['Crops/Spring/Strawberry.png', 'crop-strawberry.png'],
  ['Crops/Spring/Onion.png', 'crop-onion.png'],
  ['Crops/Spring/Spring Onion.png', 'crop-spring-onion.png'],

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

  // Item icons for animal produce/feed (T-7.09) — see assets.ts's ICON_*
  // block for why Wheat stands in for "hay".
  ['Icons/Food Icons/Chicken Egg.png', 'icon-chicken-egg.png'],
  ['Icons/Food Icons/Small Cow Milk.png', 'icon-cow-milk.png'],
  ['Icons/Food Icons/Animal Feed.png', 'icon-animal-feed.png'],
  ['Icons/Food Icons/Wheat.png', 'icon-wheat.png'],

  // UI
  ['UI/Inventory/Book.png', 'ui-inventory-book.png'],
  ['UI/Inventory/Slots.png', 'ui-inventory-slots.png'],
  ['UI/HUD.png', 'ui-hud.png'],
  ['UI/Money.png', 'ui-money.png'],
  ['UI/button.png', 'ui-button.png'],
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
];

/**
 * Tool overlay strips: the tool in the character's hands, one strip per
 * tier, matching the animation's frame layout exactly. Only wood (tier 1)
 * ships until D-4 decides what other tiers mean.
 */
const TOOL_OVERLAYS = [
  ['4. Pickaxe, Hoe and Catching insects', 'Weapons/Hoe/1.png', 'hoe', 'wood.png'],
  ['7. Watering', 'Weapons/Watering/1.png', 'watering', 'wood.png'],
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
  if (!existsSync(OWN_SRC)) {
    console.error(
      `No first-party art at ${OWN_SRC} — run \`python3 scripts/draw-ground-tiles.py\` first.`,
    );
    process.exit(1);
  }
  for (const [from, to] of OWN_COPIES) {
    jobs.push([join(OWN_SRC, from), to]);
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
}

main();
