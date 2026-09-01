# Tillhaven — Roadmap v2: the Stardew pivot

Every task below is deliberately **tiny** — sized so a single focused session
finishes it completely: implement, test, verify, document. Work them in order;
each one names the files it touches, what to do, and what "done" means.

Read [CLAUDE.md](./CLAUDE.md) before starting any task. Section references like
`§4.3` point there. Phases 0–5 (auth, crops, animals, inventory, chest,
trading, VIP/Stripe) are complete and archived with full write-ups in
[docs/ROADMAP-v1.md](./docs/ROADMAP-v1.md) — **all of that code stays**; this
roadmap builds the new gameplay on top of it.

---

## The pivot, in one paragraph

The game becomes Stardew-Valley-like to play: you control a customizable
character with WASD, face a tile, and use the equipped tool on it — hoe to
till, watering can to water, seeds to plant, empty hand to harvest. Crops only
grow while their soil is wet. Items live in a hotbar + backpack (purchasable
upgrades) and a chest, arranged by drag-and-drop in one Stardew-style panel.
Selling happens at the merchant or via a shipping box with a timed payout;
buying only at the merchant. And the headline feature: an **idle mode**
switch — the character farms by itself (server-simulated from timestamps, so
it works while you're offline; when you're watching, the character visibly
does the work).

All art comes from the licensed `new_assets/` pack (EmanuelleDev — credit
mandatory, see `ATTRIBUTION.md`). The old `assets/` art is deleted during
Phase 7.

## What is deliberately NOT in this roadmap

- **Trading UI and VIP UI** — server code and tests stay green and untouched;
  the buttons come off the HUD (T-11.05) and re-enabling is a Phase 14 item.
- **Furniture / the Interior scene** — hidden for MVP; server code stays.
- **Chopping, mining, fishing, combat, energy, day/night, seasons** — the art
  supports all of them; none are MVP. Idle mode's task list is designed to
  grow into them later.

---

## Open Decisions

Track these; do not let them be silently decided in code. (Numbering
continues from v1; D-1 is now decided.)

| # | Decision | Status | Where it lives |
|---|---|---|---|
| D-1 | Watering mechanic | **DECIDED and LIVE** since T-9.03b: required; growth pauses while soil is dry; watering wets soil for `WATER_DURATION_MS`; never kills a crop | `packages/shared/src/config/crops.ts` (`WATERING_ENABLED = true`; kept as a one-line revert, both branches tested) |
| D-2 | Withering (crops rot if unharvested?) | Open. Punishing for an idle game; would need the first scheduled job (§4.2) | `WITHERING_ENABLED = false`; `plots.withered_at` stays reserved |
| D-3 | Is gold tradeable between players? | Open. Cleanest RMT vector; safe default off | `GOLD_IS_TRADEABLE = false` in `config/economy.ts`; a test pins it |
| D-4 | Tool tiers | Open. Art has 9 tiers (Wood→Obsidian); MVP uses Wood only. What do better tiers do — speed, area, less idle time per action? | Only `*_wood` tool items exist until decided |
| D-5 | Energy/stamina | Open. Stardew has it; MVP does not. Would gate both manual and idle actions | Nothing in code; note here only |
| D-6 | Chest placement | Open. MVP has one fixed chest on the map. Placeable/multiple chests later? | Single chest object in `farm.json` |

---

## Rules that apply to every task

Do not mark a task done until all of these hold for the code it touched:

1. **The server decides.** The client sends intents. Character position is
   COSMETIC and never leaves the browser — adjacency/facing/tool checks are
   client-side UX gates, never server authority. If a payload contains gold,
   an item grant, a growth stage, or a timestamp the server could compute,
   the design is wrong. (§4.1)
2. **Multi-row writes are transactional.** (§4.3)
3. **Every endpoint: Zod, rate limit, ownership.** Schemas live in
   `packages/shared/src/schemas/`, never inline. (§8)
4. **Idempotency keys on every state-changing endpoint** via `runIdempotent`
   (`apps/server/src/lib/idempotency.ts`). (§4.5)
5. **Shared config, never duplicated.** Durations, prices, tiers, frame data
   in `packages/shared/src/config/`. (§4.4)
6. **Tests cover failure paths, and every guarded behaviour is break-tested**:
   after the test passes, deliberately break the behaviour it guards, confirm
   the test fails, restore. A test that cannot fail is not evidence. (v1
   discipline — see any "How it turned out" entry in docs/ROADMAP-v1.md)
7. **Machine-readable error codes** (`packages/shared/src/errors.ts`), with a
   player-facing message added to `apps/client/src/net/errors.ts`.
8. **After every task**: `pnpm -r typecheck` and `pnpm test` fully green, then
   write the "How it turned out" entry under the task before checking it off.

**Migrations note:** the game is pre-launch; migrations must apply cleanly to
an empty database (`pnpm --filter @tillhaven/server db:generate` then
`db:migrate`). Wiping the dev database is acceptable when a migration would
otherwise need a backfill.

---

# Phase 7 — Asset migration

The new pack replaces everything visual. Order matters: the manifest defines
tileset gids deterministically (`packages/shared/src/config/tilesets.ts`), so
`farm.json` must be re-authored AFTER the manifest changes, and everything
that renders must follow the map.

### T-7.01 — License and attribution  ✅ **DONE**
Depends: — · Size: S
Files: `ATTRIBUTION.md`, `packages/shared/src/config/credits.ts` (new),
`packages/shared/src/config/{index,config.test}.ts`, `.gitignore`
**Do:** Rewrite `ATTRIBUTION.md` from `new_assets/Documentation.txt`: the pack
is by **EmanuelleDev** (emanuelledev.itch.io), commercial use permitted,
modification permitted, resale/redistribution forbidden, **credit mandatory**.
Add an exported `CREDITS` constant to shared config (author name + URL) so a
future credits screen reads config, not a hardcoded string. Delete no files
yet.
**Done:**
- [x] ATTRIBUTION.md quotes the license terms and names every `new_assets`
      subfolder actually planned for use
- [x] Old unconfirmed-asset table removed (those files are deleted in T-7.07)
- [x] `CREDITS` exported from shared config with a test asserting it is
      non-empty

**How it turned out.** `ATTRIBUTION.md` was rewritten during the pivot's doc
pass: the licence terms are quoted **verbatim** from `Documentation.txt`
(paraphrasing licence text is how obligations get lost), a per-subfolder
usage table names everything the MVP touches, and the removed-art section
records why the old `assets/` directory may never ship. One consequence of
actually reading the licence made it into `.gitignore` in the same pass:
redistribution is forbidden *even modified*, so `new_assets/` itself must
never be committed to a repo that could go public — the pack is ignored, and
ATTRIBUTION.md documents that a fresh clone needs the pack copied in by hand.

**`CREDITS` is a typed list, not a string.** `credits.ts` exports
`Credit { work, author, url }[]` — a future credits screen iterates it, and
a second licensed pack later is an append, not a refactor. It lives in its
own config file rather than `economy.ts` because it has nothing to do with
the economy; the barrel re-exports it like every other config module.

**The test pins the exact name and link, not just non-emptiness.** The
checkbox asked for "non-empty", but an empty-check passes equally well with
a reworded author — and the licence's whole demand is the *specific* credit
"EmanuelleDev" linking to *specifically* emanuelledev.itch.io. So one test
asserts those two strings verbatim, and a second checks structural
completeness of every entry. Verified both are load-bearing by breaking each
separately: rewording the author to "Emanuelle Dev" (exactly the kind of
harmless-looking cleanup that would put the project in breach) fails the
verbatim test; emptying the list fails both. Restored, full 712-test
monorepo suite green.

### T-7.02 — Asset copy pipeline v2  ✅ **DONE**
Depends: T-7.01 · Size: M
Files: `scripts/prepare-assets.mjs`
**Do:** Rewrite the script to copy from `new_assets/` into
`apps/client/public/assets/` under kebab-case names. Drive it from an explicit
copy list (array of `{from, to}` at the top of the script) so adding art =
adding one line. The new pack is clean transparent PNG — delete the
black-keying/cropping transform and the hand-rolled PNG codec unless a
transform is still genuinely needed. Character layer strips copy into
`public/assets/character/<anim>/<layer>/<variant>.png` (whole folders for the
5 MVP animations: `1. Idle`, `2. Walk`, `3. Run`,
`4. Pickaxe, Hoe and Catching insects`, `7. Watering`).
**Done:**
- [x] `pnpm assets` copies every sheet T-7.04 will reference, plus the
      character layer folders
- [x] Idempotent — running twice produces identical output
- [x] Old public assets NOT deleted yet (T-7.07 does that, after the client
      stops referencing them)

**How it turned out.** 256 files per run: 30 single sheets from an explicit
`COPIES` list, plus the character layer tree walked automatically —
`Skins/`, `Eyes/<Sex>/`, `Hair's/<Style>/`, `Clothers/Farm/` for all five
MVP animations, landing at `character/<anim>/<layer>/<variant>.png`
(`skin/1.png`, `eyes/male-black.png`, `hair/fawn-ginger.png`,
`clothes/blue.png`). That layout is called out in the script as a
**contract** — T-8.02's creator and T-8.03's renderer build URLs from it.

**The PNG codec is gone.** The v1 script existed half for renaming and half
for surgically cropping and colour-keying the old pack's broken tileset; the
new pack is clean transparent PNG throughout, so this is now a plain copier
with a note pointing at git history should a transform ever be needed again.

**A discovery worth recording: the pack ships tool OVERLAY strips.**
`4. Pickaxe, Hoe.../Weapons/Hoe/1.png` through `10.png` (and the same for
`Watering`) are per-tier strips of the tool in the character's hands,
dimension-identical to the character layers — so the swing animation can
show the actual equipped tool as just one more stacked layer. Tier 1 (wood)
is copied to `character/<anim>/tool/wood.png`; the other nine tiers wait on
D-4. T-8.09 should use this.

**A collision bug was caught during verification, not after.** Six new
sheets initially copied under bare names (`chest.png`,
`chicken-red.png`, …) that the OLD pack also uses in the same output
directory — with different geometry (old chest 32×32, new 256×32; old
chicken 64×32, new 64×112). The first run silently overwrote the old files,
which would have broken Preload's frame verification for the still-live v1
manifest — exactly what the third checkbox forbids. Fixed by namespacing
every new object (`obj-`) and animal (`animal-`) output — consistent with
the `crop-`/`tool-`/`ui-`/`tileset-` prefixes already chosen — restoring the
seven clobbered files byte-identical from `assets/`, and asserting zero
overlap between the script's output names and the v1 manifest's. The
prefixes are permanent, not a workaround: they are the names T-7.04's
manifest uses.

**Verified:** double-run md5 comparison over all 256 outputs — identical
(idempotent); a deliberately broken source path exits 1 with a `MISSING`
line (the guard is real); old-name files match their `assets/` sources
byte-for-byte; full 712-test monorepo suite green.

### T-7.03 — Measure the character strips  ✅ **DONE**
Depends: T-7.02 · Size: S
Files: `scripts/measure-character.mjs` (new, throwaway-quality is fine),
`packages/shared/src/config/assets.ts` (constants only)
**Do:** The character animations are single-row 32px-tall strips (Idle
512×32, Walk 768×32, Run 1024×32, Hoe 768×32, Watering 1024×32). Determine by
measurement/inspection: frame width (expect 32), frames per direction, and
the direction order within the strip (down/up/left/right?). Record the
findings as named constants (`CHAR_FRAME`, `CHAR_ANIMS = {idle: {frames,
row...}}`) following the existing measured-geometry pattern (`PLAYER_ART` in
assets.ts). Every later character task reads these constants.
**Done:**
- [x] Constants for all 5 animations: frame count per direction, direction
      order, fps suggestion
- [x] A shared config test asserts strip width = frameWidth × totalFrames for
      each (guards against a wrong measurement silently breaking animations)

**How it turned out.** All 5 strips confirmed by `identify` at the stated
sizes and 32×32 square frames throughout (unlike the old pack's 32×32-idle/
16×32-crop mixed geometry). Frame counts: Idle 4/dir, Walk 6/dir, Run 8/dir,
Hoe 6/dir, Watering 8/dir — always 4 direction blocks, so `charTotalFrames`
is `framesPerDirection × 4` and the width guard is
`CHAR_FRAME.width × charTotalFrames(anim) === anim.width`.

**Direction order is down, up, left, right — a real block order, not the v1
pack's 3-row-plus-mirror.** Verified two ways, and they disagreed at first:
`scripts/measure-character.mjs` composites the Skins + Eyes layers per frame
and classifies each of the 4 blocks by eye-pixel count (zero → up, present
and centred → down) and, for the remaining two, by the eyes' x-centroid
sign. That heuristic's first version labelled the block whose face visibly
leads *left* as `"right"`, because that block's handful of eye pixels
happened to sit right of the *frame's* horizontal centre — walking stride
and tool-swing reach shift the art within its 32px cell frame-to-frame, so
frame-centre-relative sign is not the same signal as which side of the
*head* the eye sits on. Caught by rendering composited skin+eyes+hair
frames at 20x scale for both candidate blocks side by side and reading
which way the hair mass trails (opposite the face) — exactly the class of
mistake `PLAYER_MIRROR_FACES_RIGHT`'s comment already warns about for this
codebase. Fixed the script's sign mapping and re-ran; it now agrees with
the visual read on all 5 animations, and both are recorded as evidence in
the script's docstring so a future re-run doesn't quietly regress if the
pack's frame padding shifts again.

**`CHAR_ANIMS` deliberately omits `PLAYER_ART`-style art-box measurements**
(feetY, per-direction art span) — T-8.03 owns re-measuring those for the new
32×32 frames when it replaces `PLAYER_ART`; T-7.03's job is strip geometry
only, and probing the idle skin layer's alpha bounds along the way showed
`feetY = 26` holds unchanged from the old pack (7 empty px below the feet,
same as `PLAYER_ART.feetY`), which is a useful cross-check for that task but
not asserted here since it wasn't measured for anything but the idle frame.

**Verified:** break-tested both new guards (a wrong `framesPerDirection`
fails the width assertion; a duplicated direction in `CHAR_DIRECTION_ORDER`
fails the 4-directions assertion), restored, full 716-test monorepo suite
green (`pnpm -r typecheck` and `pnpm test`, Postgres/Redis up via
`docker compose up -d`).

> **Correction (2026-08-31, during T-13.05).** The direction order above is
> **wrong**: it is `down, up, RIGHT, left`. The write-up's confidence was
> misplaced — reading hair mass and face shape in a 32px profile is not a
> reliable signal, and "verified two ways" was really one signal read twice.
> `assets.ts` had already been corrected (2026-08-28) but `config.test.ts` and
> `measure-character.mjs` were left behind, so two shared tests sat red and the
> script kept printing the old answer from an inverted sign convention. All
> three now agree.
>
> **The check that settles it, and the only one worth using:** composite the
> `tool` layer of Watering onto skin + clothes and look at a late frame — the
> can is held out and the water pours in the direction faced. Block 2 pours
> right, block 3 pours left. No interpretation required, unlike every signal on
> the head.

### T-7.04 — Asset manifest v2  ✅ **DONE**
Depends: T-7.03 · Size: M
Files: `packages/shared/src/config/assets.ts`
**Do:** Replace `SHEETS`/`IMAGES` with new-pack entries. Needed sheets:
spring grass tileset, tilled+wet soil, water, path tiles, maple tree (+
animation), tiny house, chicken coop, barn, chest, shipping box, mailbox,
the 4 crop strips (see T-7.08), chicken + baby chicken + cow sheets (one
variant each for now; more in T-12.01), tool icons (wood hoe + wood watering
can), and the UI sheets (Inventory Book, Slots, HUD, Money, button). Character
layers are **deliberately not in SHEETS** — they load dynamically per player
appearance (T-8.03). Keep `TILE_SIZE = 16`, `PIXEL_SCALE = 3`, the
`SheetSpec` shape, and the frame-count verification contract with Preload.
Delete old-pack entries and their measured-geometry constants (except what
T-7.03 added).
**Done:**
- [x] Every sheet has correct width/height/frame geometry (measure, don't
      guess — wrong numbers fail Preload's verifier)
- [x] `pnpm --filter @tillhaven/shared test` green (update config tests that
      referenced old keys)
- [x] Client typecheck still passes (fix imports of removed constants —
      renderers get properly rewired in their own tasks; stubbing frames to
      keep compiling is acceptable ONLY where a later task in this phase
      explicitly rewires it)

**How it turned out — one deliberate deviation from the "Do", recorded up
front.** The instruction says delete old-pack entries. Doing that literally
broke compilation today with no Phase 7 task to blame it on: `Player.ts` /
`movement.ts` still render from `PLAYER_IDLE`/`PLAYER_WALK`/`PLAYER_ART`
(rewired in T-8.03, Phase **8**), `animalSprites.ts`/`Animal.ts` still
render from `COW_FEMALE`/`CHICKEN_RED`/etc. (rewired in T-7.10, later in
*this* phase), `Farm.ts`/`hud.ts`/`landing.ts`/`legal.ts`/`auth-form.ts`
still render from `CROPS_SHEET` (T-7.08), and `House.ts`/`landing.ts` still
render from `HOUSE`/`HOUSE_BUILDINGS` — for which **no task anywhere in the
roadmap claims the rewire**. The "stubbing is acceptable only where a later
task in this phase explicitly rewires it" clause covers T-7.10 and T-7.08
cleanly, but not T-8.03 (different phase) or House (no task at all).

Rather than force a choice between "break Player.ts/House.ts today for no
reason" and "silently keep guessing constants nobody will revisit," every
old-pack entry stays exactly as-is, and every new-pack entry is added
alongside under a distinct name (`ANIMAL_CHICKEN_RED` next to the old
`CHICKEN_RED`, `CROP_LEEK` next to `CROPS_SHEET`, `OBJ_TINY_HOUSE` next to
`HOUSE`, …). Both old and new PNGs are still on disk (T-7.02 confirmed the
new pack's kebab names never collided with the old pack's bare names, and
T-7.07 — not yet run — is what deletes the old ones), so this is a real
working state, not a fiction: `pnpm -r typecheck` and the full 716-test
suite are green with **zero renderer files touched**. Each rewiring task
(T-7.08, T-7.10, T-8.03) now has its target constants already measured and
waiting, exactly like T-7.03 left `CHAR_ANIMS` waiting for T-8.03. Added
**T-7.11** below to give House/coop/barn/shipping-box exterior rendering the
explicit task it was missing, so this isn't a silently-dropped thread.

**Measurement approach.** `identify` for every sheet's outer dimensions,
then grid-overlay renders (a magenta 16×16 or 32×32 grid composited over an
8-hundred-percent scale-up, viewed as an image) to *confirm* alignment
rather than assume it from divisibility — 384×640 divides evenly by 16 in
infinitely many wrong ways too. This caught one real case: the cow sheets
looked like a 16×16 grid at a glance (128×288 divides by 16 cleanly) but the
art is actually 32×32 — a 16px grid overlay sliced every cow in half at
first render, only visible once actually drawn over the pixels.

**The house/coop/barn/shipping-box kits are not uniform grids — verified,
not assumed, by connected-component (flood-fill) analysis of the alpha
channel.** Chicken coop and barn each turned out to hold one fully-detailed,
ready-to-use building at a fixed offset (found by the flood-fill directly);
the tiny house kit does not — its components are individual wall/roof/door
*parts* meant to be composited, except for a row of solid-colour house
silhouettes that make a usable (if plainer than the old pack's `built` look)
single crop window. All four crop-window constants
(`OBJ_TINY_HOUSE_LOOK`/`OBJ_CHICKEN_COOP_LOOK`/`OBJ_BARN_LOOK`/
`OBJ_SHIPPING_BOX_LOOK`) were trimmed tight with `convert -trim` against a
generous search window rather than eyeballed, mirroring `HOUSE_BUILDINGS`'s
existing measured-crop-window pattern for the old pack — coop/barn/shipping-
box had no such pattern to extend, so this task establishes it for them.

**Left un-sliced on purpose: the 5 UI kit sheets.** Book/Slots/HUD/Money/
Button are each many differently-sized elements with no current or
Phase-7-scheduled consumer (T-10.04a and T-11.05, the tasks that pick
specific crops, are Phase 10/11). Registering them as whole-image
`ImageSpec`s is an accurate manifest entry, not a guess; inventing a frame
grid nobody asked for would have been the guess.

**Verified:** grid-overlay/component-analysis findings cross-checked
against a second measurement where practical (e.g. `convert -trim` bounding
boxes against the visually-read crop windows); break-tested the frame-size
guard on a new-pack entry specifically (not just an old one) by corrupting
`TILESET_GRASS_SPRING.cols`, confirmed `config.test.ts` fails with the
expected/received mismatch, restored; `pnpm -r typecheck` and the full
716-test monorepo suite green with Postgres/Redis up.

### T-7.05 — Tileset runs and mapmaker terrain  ✅ **DONE**
Depends: T-7.04 · Size: M
Files: `packages/shared/src/config/tilesets.ts`,
`apps/mapmaker/src/tilesets/terrain.ts` (and its test)
**Do:** `TILESET_RUNS` regenerates automatically from the new SHEETS order —
verify `toGid`/`fromGid` tests still hold. Update mapmaker's terrain
definitions (autotile groups) for: spring grass, water edges, path tiles,
tilled soil, wet soil (the soil autotiles matter later for pretty plot
rendering; minimum viable: single-tile variants). Keep `FARM_WIDTH/HEIGHT`
exported — T-7.06 may change their values.
**Done:**
- [x] Mapmaker opens, shows the new tileset, autotiling works for grass/water
- [x] `tilesets.test.ts` and mapmaker tests green

**How it turned out — the premise behind "autotile groups" didn't hold, so
the deliverable changed shape; user confirmed the direction mid-task rather
than this being decided silently.** `TILESET_RUNS`/`toGid`/`fromGid` needed
zero code changes — both are already fully generic over `SHEETS`/`IMAGES`
(`tilesets.test.ts`'s existing tests loop over the manifest, no hardcoded
counts), so T-7.04 growing the manifest to 40 sheets was already covered.
The real work was "update mapmaker's terrain definitions," and that's where
the premise broke: `tileset-grass-spring.png`, `tileset-soil.png` and
`tileset-paths.png` are **not** Wang-blob autotiles like the old pack's
`tileset-spring.png`. Confirmed by rendering ~30 of 40 grass-sheet rows and
the full soil sheet at high zoom: every cell in all three files is a
self-contained, rounded/scalloped "patch" or "framed rug" stamp — never
straight-edged art meant to butt against a same-type neighbour. Forcing
`terrain.ts`'s existing NW/N/NE/W/… 4x4-block role system onto them would
have compiled and looked fine in the calibration preview (one tile in
isolation) while painting visible gaps the instant the same patch repeated
edge-to-edge on the real map — the exact "measure, don't guess" failure
mode CLAUDE.md warns about, just one level up: the *geometry* would have
been measured correctly and the *usability* guessed.

Stopped and asked before picking a fix, since redesigning how ground
renders is a real project-wide decision, not a numbers question. Chosen
approach: a flat sampled colour for grass/soil-dry/soil-wet/path (patches
become stamp-tool decoration later, never the base fill), reusing
`water-tile.png` as-is since it already ships exactly that — a flat fill
with no border — which is what made "sample a flat colour from the pack's
own palette" the confirmed-not-guessed answer rather than an invented one.

**Implementation stayed inside the existing tile/gid machinery — no new
concept added to the doc model, Tiled export, or renderers.** A flat tile
is just an ordinary 16x16 PNG loaded like any other manifest entry; the
only wrinkle is `blockFrame`'s `block`-relative math against a 1x1 image
run (`runFromImage`'s `tileCount: 1`), which already worked with zero
`terrain.ts` code changes — `{ block: 0, roles: { c: 0 } }` resolves
correctly through the pre-existing generic path. New:
`scripts/draw-ground-tiles.py` (mirrors `draw-item-icons.py`'s precedent:
original, licence-free work filling a gap the pack doesn't cover, palette
sampled from the pack's own art) writes 4 flat tiles into a new tracked
`original-assets/ground/` — deliberately NOT under `apps/client/public/assets/`,
which is gitignored as "produced by `pnpm assets`"; `prepare-assets.mjs`
gained a second small `OWN_COPIES` list sourced from `original-assets/`
alongside the existing pack-sourced `COPIES`, so `pnpm assets` still
produces the complete output from a fresh clone. `GROUND_GRASS`/
`GROUND_SOIL_DRY`/`GROUND_SOIL_WET`/`GROUND_PATH` registered in `assets.ts`
(`IMAGES`), `DEFAULT_TERRAIN_SETS` and `terrain-sets.json` both gained 5 new
flat-fill sets (water + the 4 synthesized ones) alongside the untouched
old-pack sets — same "keep old, add new" pattern as T-7.04, since the old
sets are still what the mapmaker currently authors `farm.json` against
until T-7.06.

**`tileset-paths.png` corrected mid-task, not left wrong.** T-7.04's note
called it "path autotile blocks" from a plausible-looking grid check alone;
closer inspection (this task) found the same framed-rug-kit structure as
the house/coop/barn kits from T-7.04 — sized bordered floor pieces, not a
repeating texture. Comment corrected in `assets.ts`; `GROUND_PATH` covers
the immediate need, the framed pieces stay registered for whoever wants to
place one as decoration later.

**Verified:** break-tested the new terrain-set guard by corrupting
`ground-grass`'s `roles.c` from 0 to 1 (out of range for a 1x1 image run),
confirmed the new `frameForRole`/`terrain-sets.json`-sync tests fail exactly
as expected (3 failures, including the *existing* JSON-drift test catching
it independently), restored; `pnpm -r typecheck` and every workspace's test
suite green (mapmaker 63, shared 54, client 57 — server unaffected, not
run again). `pnpm assets` re-run clean, 260/260, idempotent.

### T-7.06 — Re-author the farm map  ✅ **DONE**
Depends: T-7.05 · Size: M
Files: `apps/client/public/tilemaps/farm.json` (authored via mapmaker),
`packages/shared/src/config/plots.generated.ts` (via `pnpm plots`),
`packages/shared/src/config/tilesets.ts` (if size changes)
**Do:** Author the new farm in the mapmaker: spring grass base, water along
one edge, paths, the Tiny House, chicken coop, barn, the chest object, the
shipping box, mailbox, a few maple trees, and a contiguous field area whose
cells become the plots layer (keep ~20 plots; same count as before is fine).
A larger map (e.g. 30×20) is allowed — the camera fits automatically; pick
what looks good. Regenerate `plots.generated.ts`.
**Done:**
- [x] `farm.json` valid, loads in mapmaker round-trip
- [x] `pnpm plots` regenerated; `STARTING_PLOTS` still ≤ plot count;
      `plots.test.ts` green
- [x] Object layer contains named objects for chest/shipping-box/mailbox (plus
      3 maple trees); house/coop/barn deliberately NOT placed as map objects —
      see the write-up for why, and their gids are recorded below for T-7.11

**How it turned out — authored programmatically, but through the mapmaker's
own code, not a hand-rolled JSON shape.** The mapmaker is a GUI and this
agent cannot click through one, so `apps/mapmaker/scripts/generate-farm.ts`
(throwaway, kept for the next re-author — same "throwaway quality is fine"
precedent as `measure-character.mjs`) builds a `MapDoc` and calls the exact
same `History` + `placeObject`/`togglePlot` + `serialize()` functions the
editor's own click handlers call, then writes the result through
`JSON.stringify(map, null, 2) + '\n'` — byte-identical in shape to what
"Save to project" would have written for the same clicks. A second throwaway,
`verify-farm.ts`, feeds the written file back through the mapmaker's own
`deserialize()` and prints every object's resolved gid/key/frame/tile
position, specifically to catch the failure mode `tiled.ts`'s own doc comment
warns about (bottom-edge vs top-edge anchoring getting swapped) — it came
back with **zero warnings** and every object landing on the intended tile.

**A real premise mismatch, resolved without a full stop.** The task's Do
says the object layer should carry house/coop/barn/chest/shipping-box/
mailbox, "found by gid." Chest, mailbox, the maple trees and (with one caveat
below) the shipping box are genuinely gid-clean per T-7.04's manifest work,
so those went in directly. House, coop and barn did not, and this is not a
stylistic call: `Farm.ts`'s `buildMapObjects` renders whatever gid an object
carries at native pixel size with no scaling — it doesn't read `width`/
`height` off the object at all — and `OBJ_TINY_HOUSE`/`OBJ_CHICKEN_COOP`/
`OBJ_BARN` are T-7.04's **whole uncropped kit sheets** (688×368, 480×224,
496×176 px). Placed as an ordinary tile-object at TILE_SIZE=16, the house
alone would be 43×23 tiles — more than twice the width of the entire 20×16
map — completely burying the farm under one wrong image, not "looks a bit
off until rewired" the way a mis-framed crop does. `House.ts` had already
hit exactly this wall for the old pack and picked the other fork: it does
not use a map object for the multi-cell building at all, computing
`HOUSE_POSITION` as a hardcoded client constant and saying so explicitly
("not authored in the map because the editor places tile-objects by gid, and
a multi-cell crop window is not a gid — worth revisiting if the editor ever
learns about them"). T-7.11 is already scoped to extend that exact technique
(`Texture.add()` over a measured crop-window) to Coop/Barn. Since modifying
`buildMapObjects` to scale/crop objects is out of T-7.06's file list, and
since the established, endorsed answer already exists in `House.ts`, this
was resolved as a documented deviation rather than a stop-the-task
escalation: house/coop/barn are **not** placed on the map; their gids are
recorded here for T-7.11 to hardcode positions from (`obj-tiny-house` → gid
3049, `obj-chicken-coop` → gid 3050, `obj-barn` → gid 3051, all frame 0 —
`toGid('obj-<key>', 0)`). The shipping box (48×64 = 3×4 tiles) is a
different case in kind, not just degree — its footprint is a normal building
size, and it went in directly as a single gid object at gid 3052, tile
(14,13). Its raw kit does render all four crate icons (closed+open ×
wide+narrow) stacked in one image rather than the one clean pose, confirmed
live in the browser (screenshotted below) — cosmetically rough in exactly
the "looks broken until its rewire task" way T-7.07 already sanctions for
crops/animals, not the map-breaking way house/coop/barn would have been. No
task in the roadmap currently claims cropping the shipping box's look
despite T-7.11's title naming it; flagging that gap for whoever picks up
T-7.11 or T-11.03, the same way T-7.04 added T-7.11 itself when it found an
unclaimed rewire.

**Layout.** 20×16 (unchanged from the old map — `tilesets.ts` untouched, the
"if size changes" clause didn't fire). Water down the whole west column
(x=0). A path skeleton — one vertical spine at x=8 running past the field's
west edge, one horizontal spine at y=13 — connects a mailbox (gid 3041, tile
(3,13)), a chest (gid 3025, tile (8,10)) and the shipping box (tile (14,13))
without ever crossing the field, so there's no dependency on paint order
resolving a conflict (though the ground painter stamps plot cells with soil
*last* regardless, for exactly that safety). Three maple trees (gid 2963,
frame 2 — picked by rendering a magenta grid overlay over `obj-maple-tree`
at 4x and reading which frame is a full mature green tree with its shadow,
not one of the season/stump/acorn frames the sheet also holds) sit in open
grass clear of the path, the field, and the house's hardcoded footprint
around `HOUSE_TILE` (6,6). The field itself is a clean contiguous 5×4 block
at (9,9)–(13,12), 20 plots, row-major unlock order — replacing the old map's
6×3 block plus two disconnected stray plots at (17,6)/(18,6), which was
never a deliberate design, just how the old editor session ended up.

**The plot cells are stamped with `ground-soil-dry`, not left as grass —
this was measured off the OLD map, not decided fresh.** Before writing
anything, the old `farm.json`'s ground layer was decoded at each of its 20
plot cells: every one carried gid 58, which resolves to `tileset-spring`
block 3 ("Tilled soil (plain)"), local index 9 (the block's fill role) —
i.e. the old map deliberately painted soil under every plot, distinct from
the grass elsewhere. That's also exactly what the `Tile.marker` doc comment
in `Farm.ts` assumes ("The soil under a plot is painted in the authored
map"). The new map reproduces that intent with the new flat `ground-soil-dry`
tile from T-7.05 instead of guessing that grass-under-plots would be fine.

**A live, undesigned side effect worth recording, not a bug in this task.**
Screenshotting an existing dev-DB test account (`qa_47281`) against the new
map showed two disconnected translucent smudges with no soil tile under
them, floating over plain grass. That's stale data, not a rendering bug:
that account's `plots` rows were created by `newFarmPlots()` at
*registration* time, off the OLD `PLOT_POSITIONS` (the scattered 6×3-plus-
two-strays layout) — changing `plots.generated.ts` does not move existing
rows, only where the *next* registration puts them. Confirmed by registering
a brand-new throwaway account (`t706mapcheck`) in a separate tab: its field
renders as one clean, connected soil-tilled block exactly on the new 5×4
plot layout, with the water/path/trees/mailbox/chest/shipping-box all
exactly where authored, and zero console warnings on load. Any dev account
that existed before this task will show the same stale-plot smudge until it
either re-registers or the dev DB is reset — consistent with the roadmap's
own "wiping the dev database is acceptable" migrations note, though this
wasn't a migration. Left the running dev DB alone rather than truncating
tables unilaterally, since another agent's browser session was actively
using it; noting it here so it isn't mistaken for a defect in this task.

**Verified:** `apps/mapmaker` test suite green (63/63, including
`tiled.test.ts`'s round-trip and bottom/top-edge-anchoring tests, unmodified
— this task added no new mapmaker code, only used its existing exports);
`pnpm plots` regenerated `plots.generated.ts` cleanly (20 plots, bounds
x 9..13/y 9..12); shared config suite green (54/54, `plots.test.ts` included
unmodified). Break-tested three separate guards this artifact has to satisfy:
(1) `generate-farm.ts`'s own field-bounds check, by moving the field origin
outside the map and confirming it refuses to write, restored; (2)
`plots.test.ts`'s "never puts two plots on the same cell" test, by hand-
editing a duplicate coordinate into the generated output and confirming it
fails with that exact assertion, restored via a clean `pnpm plots` re-run;
(3) `tiled.ts`'s firstgid-drift warning, by corrupting a copy of the real
`farm.json`'s first tileset entry and confirming `deserialize()` reports it
for THIS map specifically (not just the existing test's synthetic
`createDoc()`), then re-verified the real file still reports zero warnings.
Full monorepo `pnpm -r typecheck` and `pnpm test` green (719 shared+client+
mapmaker+server tests). Visually verified in the running client (both the
stale existing account and the fresh one above) — grass/water/path/soil
render as flat fills with no seams (confirming T-7.05's flat-fill decision
holds up at real map scale), trees/mailbox/chest sit at readable sizes on
their tiles, and the shipping box's rough-until-cropped look is the only
cosmetic issue, exactly as predicted before ever loading the page.

### T-7.07 — Preload v2 and old-asset deletion  ✅ **DONE**
Depends: T-7.06 · Size: S
Files: `apps/client/src/game/scenes/Preload.ts`, deletions
**Do:** Preload loads manifest v2 and the new map; frame verification passes.
Then delete: repo-root `assets/` directory, old PNGs in
`apps/client/public/assets/`, and `scripts/draw-item-icons.py`. `pnpm assets
&& pnpm dev` shows the new farm rendering (plots/crops/animals may look
broken until their rewire tasks — note what's expected in the write-up).
**Done:**
- [x] No file under `apps/client/public/assets/` comes from the old pack
- [x] `git grep` finds no reference to deleted asset keys outside
      docs/ROADMAP-v1.md
- [x] Client builds and boots to the Farm scene without load errors

**How it turned out — the frontier was already half-migrated, and not in a
working state.** `packages/shared/src/config/assets.ts` on disk at the start
of this task already had every old-pack `SheetSpec`/`ImageSpec` removed (no
`PLAYER_IDLE`, `CROPS_SHEET`, `HOUSE`, `COW_FEMALE`, etc. — T-7.04's "keep
old, add new" state was gone), but nothing that consumed those exports had
been updated to match, and `assets.ts` itself had a stray duplicated-comment
`*/` that made it a syntax error. None of that was committed (this whole
repo is one uncommitted "Initial commit" plus untracked working-tree files,
so there is no history to blame it on) — it reads as a previous attempt at
this exact task that stopped partway through. `pnpm -r typecheck` failed in
five different packages before any of this task's own work started. Fixing
that forward (rather than reverting to "keep both" and redoing T-7.04's
already-decided-against approach) is legitimately this task's job — Preload
loading "manifest v2" presupposes a manifest that only has v2 in it, and a
broken build is not a state to delete assets out from under.

**Fixed to get to a green baseline, in dependency order:**
1. `assets.ts`'s duplicated-comment syntax error (two comment blocks merged
   with a stray `*/` in the middle, above `OBJ_TINY_HOUSE`).
2. `crops.ts`: `CropDef` gained a `sheet: SheetSpec` field (each crop now
   owns its own 8-frame sheet, T-7.04) replacing the dead `sheetRow`/
   `cropFrame()` single-sheet math. `stageFrames`/`seedFrame`/`produceFrame`
   are placeholder indices (0/1) into each crop's own sheet — real frame
   selection is explicitly T-7.08's job, not this one's, per the Do's "may
   look broken until rewire tasks" allowance.
3. `items.ts`: `seed()`/`produce()` now take a `CropId` and read the icon
   straight off `CROPS[crop].sheet`/`.seedFrame`/`.produceFrame` — single
   source of truth instead of a second hardcoded frame number. Animal-
   produce/feed items (egg, milk, hay, chicken feed) have no sheet of their
   own since `ITEMS_SHEET` is retired and T-7.09 hasn't run yet; they borrow
   spare, currently-unused frames on `CROP_POTATO`/`CROP_ONION` as a named
   `ANIMAL_ITEM_ICON` placeholder table, exactly the kind of stopgap
   `assets.ts`'s own comment block already flagged as needed.
4. `config.test.ts`: deleted the old pack's player "art box"/mirroring tests
   (`PLAYER_ART`, `PLAYER_ORIGIN_Y`, `PLAYER_FLIP_OFFSET` — meaningless now
   that the new pack draws all 4 directions explicitly with no mirroring
   math) in favour of one frame-size-agreement test on the
   `PLAYER_PLACEHOLDER_IDLE`/`_WALK` stand-ins; rewrote the crop-sheet tests
   from "one shared `CROPS_SHEET` with row/column meanings" to "every crop's
   frames stay inside its own sheet."
5. Client-side consumers of the deleted exports — `hud.ts`, `Farm.ts`,
   `pages/auth-form.ts`, `pages/landing.ts`, `pages/legal.ts` — updated to
   the new-pack names (`ANIMAL_CHICKEN_RED`, `ANIMAL_COW_FEMALE_BROWN`,
   `PLAYER_PLACEHOLDER_IDLE`/`_WALK`, `OBJ_TINY_HOUSE`/`OBJ_TINY_HOUSE_LOOK`,
   `OBJ_MAPLE_TREE`) and to each crop's own `.sheet` instead of a shared
   `CROPS_SHEET`. `Farm.ts`'s plot-crop sprite now calls `setTexture()`
   whenever the plot's crop changes, not just `setFrame()` — a real
   consequence of "one sheet per crop" that a naive find-and-replace would
   have missed (the sprite would keep showing potato's sheet forever after
   the first planting). Landing page's maple tree lost its old
   `MAPLE_TREE_FRAMES.mature` constant; reused frame 2 (the exact frame
   T-7.06 already confirmed by grid-overlay to be a full mature tree with
   its shadow) rather than guessing a new one — real per-season frame
   selection stays T-9.05's job.
6. **`farm.json` was stale relative to the trimmed manifest and had to be
   regenerated, not just left alone.** It had been generated (T-7.06) back
   when `assets.ts` still had old+new pack entries coexisting, so its
   embedded `tilesets` array — and therefore every gid in the file — was
   built against a manifest that no longer matches what `TILESET_RUNS`
   computes today; deleting the old PNGs out from under it would have left
   every old-pack tile/object pointing at a 404 and every gid after them
   numbered wrong. `generate-farm.ts` (T-7.06's throwaway script) resolves
   every tile/object by manifest KEY via `toGid()`, never a hardcoded
   number, so simply re-running it against the now-trimmed manifest
   regenerated a byte-different but layout-identical `farm.json` with
   correct new-pack-only gids. Re-ran `verify-farm.ts` too: 0 warnings, all
   6 objects and 20 plots land on the exact tiles T-7.06 authored. Also
   re-ran `pnpm plots` — `plots.generated.ts` unchanged (same 20 plots,
   same bounds), confirming the regeneration only touched gid numbering.
7. `apps/mapmaker`'s autotile machinery (`terrain.ts`'s `DEFAULT_TERRAIN_SETS`,
   `terrain-sets.json`, and the tests in `terrain.test.ts`/`autotile.test.ts`)
   still had 5 entries built on the OLD pack's single `tileset-spring.png`
   (a genuine `TILESET` import that no longer resolves to anything). Per
   T-7.05's own finding, no NEW-pack sheet is actually built as connecting
   nine-slice art — so these weren't re-pointed at a new sheet (that would
   assert something T-7.05 already disproved), they were deleted.
   `SPRING_BLOCK_ROLES`/`roleFor`/`blockFrame`/`frameForRole` stay as
   generic, asset-agnostic machinery for whenever real autotile art shows
   up, now exercised in tests against a synthetic fixture (reusing
   `tileset-grass-spring.png` purely for its geometry, explicitly commented
   as not a claim that sheet is autotile-compatible) rather than against a
   shipped default. `terrain-sets.json` now ships only the 5 flat-fill sets.
   Two more test fixtures (`tiled.test.ts`, `history.test.ts`) referenced
   old-pack keys (`tileset-spring`, `maple-tree`, `house`, `road`) that no
   longer resolve via `toGid()`; swapped for real new-pack keys
   (`ground-grass`, `obj-maple-tree`, `obj-tiny-house`, `ground-path`).
8. Old-pack filenames leaking outside code: every `*.html` entry point's
   favicon pointed at `/assets/spring-crops.png` (an old-pack file, now
   404), fixed to `/assets/crop-potato.png`. `docs/economy.md`'s house-tier
   art gap note and `apps/mapmaker/README.md`'s Terrain sets section both
   described the OLD pack's art (`house.png`, `tileset-spring.png`) as
   current fact; rewritten to describe today's reality (the new pack has
   the *same* one-look-per-tier gap for a different reason; terrain sets
   ship flat-fill only). Comment-only mentions of retired names (in
   `assets.ts`'s own "here's what got retired" block, `crops.ts`,
   `Farm.ts`, `terrain.ts`, etc.) were left as-is — they are historical/
   explanatory prose about the migration, not live references, which is
   exactly what the "outside docs/ROADMAP-v1.md" carve-out is for.

**Deleted, exactly per the Do:** repo-root `assets/` (the old unlicensed
pack, 80K); `scripts/draw-item-icons.py` (drew into `assets/Objects/
Items.png`, an old-pack path, referencing the retired `ITEM_ICONS` config —
confirmed nothing else imports it before deleting); 16 stale old-pack PNGs
under `apps/client/public/assets/` (`chest.png`, `chicken-baby-yellow.png`,
`chicken-blonde-green.png`, `chicken-red.png`, `cow-female-brown.png`,
`cow-male-brown.png`, `fence.png`, `house.png`, `interior.png`, `items.png`,
`maple-tree.png`, `player-idle.png`, `player-walk.png`, `road.png`,
`spring-crops.png`, `tileset-spring.png` — confirmed by cross-referencing
against `prepare-assets.mjs`'s current `COPIES`/`OWN_COPIES` lists, which no
longer write any of those 16 names, so they were dead output from an older
version of the script, not files anything current still produces). Also
deleted a stale, gitignored `apps/client/dist/` left over from a build
before this task, which still embedded the old manifest in its JS output —
not a done-criterion, but leaving it would have kept the deleted keys
`git grep`-visible.

**Verified.** `pnpm -r typecheck` and `pnpm test` green across all 4
workspaces (51 shared + 57 client + 62 mapmaker + 545 server = 715 tests,
with Postgres/Redis up). `pnpm assets` re-run clean (260/260, idempotent —
confirms the copy pipeline never depended on repo-root `assets/`).
`pnpm --filter @tillhaven/client build` succeeds (production bundle, no
type or bundling errors). Every file under `apps/client/public/assets/`
(all 260) cross-checked against `SHEETS`/`IMAGES`/character-strip paths —
none are old-pack sourced. `git grep`-equivalent sweep (plain `grep -r`,
since this repo has no prior commit history to diff against) for every
retired export name and every deleted filename, outside `docs/ROADMAP-v1.md`:
the only hits left are either (a) explanatory prose naming what got retired
and why, or (b) substring false positives (e.g. `COW_FEMALE` matching inside
`ANIMAL_COW_FEMALE_BROWN`, `chest.png` matching inside `obj-chest.png`) —
none are a live reference to a deleted key or file.

**Browser verification: initially blocked by the MCP tool config, then
completed directly — the visual pass DID happen.** The Playwright MCP server
is registered (user scope) as bare `npx @playwright/mcp@latest` with no
`--browser` flag, so it defaults to the **`chrome` channel** and demands
`/opt/google/chrome/chrome`, which does not exist here. That is a tool-config
limitation, not a missing browser: Playwright's own Chromium builds are
present at `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`.
Driving that binary through `playwright-core` directly (throwaway script,
scratchpad-only) did the real pass — registered a brand-new account against
the live dev stack, landed on `/play`, and screenshotted the booted Farm
scene. Result: **Phaser 3.90 boots, the Farm scene renders, zero
`pageerror`s, zero failed requests, zero 4xx/5xx responses**; the only
console output is Vite HMR chatter and headless-GPU `ReadPixels` perf
warnings from the driver, neither of which is application output. The map
renders exactly as authored in T-7.06 — water down the west column, both
path spines, the house, chest at (8,10), mailbox, three maple trees, and the
5×4 soil-stamped plot block — with flat, seamless fills. Anyone re-running
this should either add `--browser chromium` to the MCP server args or use
`executablePath` as above, rather than concluding the environment has no
browser. Supporting evidence gathered before that pass still stands:
`pnpm dev` was run for real (Postgres/Redis up), and every asset the
manifest lists — all 260 files under `apps/client/public/assets/`, both
character strips, and `tilemaps/farm.json` — was fetched over HTTP from the
running Vite dev server and confirmed to return `200`, which is exactly what
`Preload`'s `FILE_LOAD_ERROR` listener guards against (a missing file, not a
wrong pixel). Every module this task touched (`Preload.ts`, `Farm.ts`,
`hud.ts`, `landing.ts`, `auth-form.ts`, `legal.ts`, `main.ts`) was also
fetched through Vite's transform pipeline and returned transpiled JS with no
esbuild error. `apps/mapmaker/scripts/verify-farm.ts` — which deserializes
`farm.json` through the mapmaker's own Tiled reader, the same code path
`Preload`'s `verifyTilemaps()` sanity-checks — reported 0 warnings and every
object/plot on its intended tile.

**Expected-broken vs. actually-broken — confirmed against the screenshot:**
expected-broken (owned by later tasks, not regressions): crop stage art
(placeholder frames 0/1, wrong bottom-anchored origin on now-square 16x16
frames — T-7.08); item icons for egg/milk/hay/chicken feed (borrowed crop-
sheet frames — T-7.09); animal row/animation semantics (T-7.10, though
basic geometry already renders); the player character (bare skin layer
only, no eyes/hair/clothes, no real idle/walk row semantics — T-8.03); the
shipping box (shows all 4 crate poses stacked, a T-7.06-documented gap with
no owning task yet — flagged there, not re-flagged here). Anything else —
missing textures, console errors, the map failing to load, plots not
appearing where `plots.generated.ts` says — would be an actual regression
from this task and is not expected. Every item on that expected-broken list
was observed in the screenshot exactly as predicted (blank-white player,
placeholder seed icons in the plant panel, the stacked-crate shipping box),
and **nothing off the list appeared** — no missing-texture magenta, no
console error, no misplaced plot.

**Follow-up surfaced, not fixed here (out of this task's file list):**
`docs/economy.md`'s house-tier note and the shipping-box cropping gap both
already point at T-6.01/T-6.07/T-7.11 — nothing new to add there. One new
item: `apps/client/dist/` and any future production build are gitignored,
so this task's deletions are invisible to a stale local build; anyone
testing against a pre-built `dist/` instead of `pnpm dev` should rebuild
first.

### T-7.08 — Crop art rewire  ✅ **DONE**
Depends: T-7.07 · Size: S
Files: `packages/shared/src/config/crops.ts`, `packages/shared/src/config/assets.ts`
(crop sheet entries), `apps/client/src/game/plots.ts` (+ test)
**Do:** The 4 crops map to `Crops/Spring/` strips (128×16 = 8 frames of
16×16): Potato→Potato, Strawberry→Strawberry, Onion→Onion, Leek→Spring Onion
(closest match; keep the item id `leek`). Determine which of the 8 frames are
growth stages vs seed-packet vs produce icons by inspection, update
`stageFrames`/`seedFrame`/`produceFrame`. Frames are square 16×16 now (old
sheet was 16×32 bottom-anchored) — adjust the renderer's origin accordingly.
**Done:**
- [x] All four crops render every stage from the new sheets (walk each stage
      via the dev backdate trick or a quick test page)
- [x] `plots.test.ts` and shared config tests green

**How it turned out.** Measured all four `Crops/Spring/*.png` strips two ways
— a 16x-zoom grid overlay (same technique as T-7.03/T-7.06) and a per-frame
alpha-channel sum in Python/Pillow, to have a number backing the pixels — and
found all four crops share the IDENTICAL layout, not the varied one the old
pack had: frames 0-5 are six growth stages (frame 0 is a just-planted look —
scattered seeds or a small soil mound — through a mature, bushy plant at
frame 5), frame 6 is fully transparent on every crop (alpha sum exactly 0,
confirmed by the script, not just "looked blank"), and frame 7 is the
harvested produce icon. There is no separate seed-packet icon anywhere in the
sheet, so frame 0 (the planted look) does double duty as `seedFrame` — this
is a real design fact about the art, not a placeholder choice, and it reads
fine in the plant panel (screenshotted below).

**The "potato has a 7th stage" assumption baked into T-7.07's placeholder
code (and the old pack it inherited the shape from) was wrong for the new
art — potato has six stages exactly like the other three.** That assumption
had leaked into more places than `crops.ts` itself: `config.test.ts`
(`'potato has seven stages and the others have six'`), a matching comment in
`plots.test.ts`, a comment in `landing.ts` claiming potato was picked for its
demo timeline "because it has a seventh stage," and — found only by running
the full suite, since it is outside this task's file list —
`apps/server/src/modules/farm/farm.integration.test.ts`'s
`'reports potato at its seventh stage before it is ripe'` test, which
hardcoded `toHaveLength(7)` and asserted stage 6 at the 6.5-of-7 mark. Fixed
all four forward to match reality: `config.test.ts` now has a generic
"every crop has exactly six growth stages" test plus a
"every crop shares the measured T-7.08 frame layout" test pinning
`stageFrames`/`seedFrame`/`produceFrame` exactly; the server test became a
per-crop loop (`stageCount - 0.5` fraction, generic on `stageFrames.length`)
so a future crop with a different count is still checked instead of quietly
falling outside a hardcoded assertion. Deliberately did NOT touch
`farm.integration.test.ts` beyond that one test — it wasn't in this task's
file list, and the roadmap's own "stop and say so" guidance applies, but
leaving a test hardcoding a fact this task just proved false would have
broken `pnpm test`, which the roadmap requires green; fixing it forward
(rather than reverting the crop data) was the only option that satisfies
both constraints. A break-test (temporarily setting potato's `produceFrame`
back to 1) confirmed the new `config.test.ts` guard actually fails when the
config regresses, then was reverted.

**The origin fix predicted by T-7.07's write-up turned out to be a
readability/robustness fix, not a pixel-visible one.** The bottom-anchored
`setOrigin(0.5, 1)` at local `(0, TILE_SIZE / 2)` and the new centred
`setOrigin(0.5, 0.5)` at `(0, 0)` produce IDENTICAL pixels for a frame whose
height equals `TILE_SIZE` (both are 16 here) — the old math's "anchor the
bottom edge at the tile's bottom edge" and the new math's "anchor the centre
at the tile's centre" only diverge when frame height and tile height differ,
which was true of the old 16x32 pack and is no longer true of the new 16x16
one. Fixed anyway, in `Farm.ts` (outside this task's file list — the
renderer's origin logic lives there, not in `plots.ts`, which is pure stage
arithmetic with no Phaser objects; `plots.ts` needed no change at all beyond
its test file's stale comment) because leaving code whose correctness
depends on frame height coincidentally matching tile height is exactly the
kind of latent bug the next crop or tile-size change would resurrect
silently.

**Browser-verified with the workaround the task description supplied**
(`playwright-core` + the cached Chromium binary at
`~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, since the
registered Playwright MCP server still defaults to the missing `chrome`
channel — same tool-config issue T-7.07 already worked around, not
re-investigated here). Registered a throwaway account against the live dev
stack, planted all four crops in adjacent plots via the real
`POST /api/farm/plant` endpoint (strawberry/onion seeds inserted directly
via `psql` since the starter kit only grants leek/potato — the same
DB-manipulation trick `farm.integration.test.ts`'s `backdatePlot` helper
uses, just driven from outside the test runner), then walked every growth
stage by backdating each plot's `planted_at` to the midpoint of that stage's
window and reloading. Screenshotted all 6 growth stages plus the ripe state
for all 4 crops side by side: stage 0 shows seeds-on-soil, stages 1-4 show
progressively fuller sprouts (a strawberry's shift from scattered red seeds
to a green sprout at frame 1 is the most visually obvious jump), stage 5
shows a mature bush per crop (visible ripe strawberries, a full onion top, a
tall leek, a dirt-mounded potato bush) sitting flush on the tilled soil with
zero vertical offset in every frame — confirming the origin fix holds in a
real render, not just in arithmetic. The ripe state adds the white
ready-outline without changing the sprite (by design — `displayAt` shows the
last growth-stage frame when ripe, not `produceFrame`; `produceFrame` is
only for icons). Also harvested the ripened leek through the real
`POST /api/farm/harvest` endpoint and opened the bag panel: the seed stack
(frame 0, black scattered seeds) and the harvested-leek stack (frame 7, a
recognizably different icon — a whole leek with a white bulb) render as
visibly distinct items in the same panel, which is the actual point of
having two different icon frames. Zero console errors or failed requests
across both scripted sessions. `pnpm -r typecheck` and `pnpm test` green: 719
tests total (52 shared + 57 client + 62 mapmaker + 548 server — up from
T-7.07's 715, the net new assertions above).

**Left alone, correctly out of scope, but worth flagging precisely for
whoever runs T-7.09:** `items.ts`'s `ANIMAL_ITEM_ICON` (egg/milk on
`CROP_ONION` frames 2/3, chicken_feed/hay on `CROP_POTATO` frames 2/3) is a
T-7.07 placeholder that borrows frames this task confirmed are REAL,
visible growth-stage sprites (index 2 and 3 of `stageFrames`, a young onion
sprout and a young potato sprout respectively) — not the one genuinely spare
frame each sheet has (frame 6, fully transparent, measured above). This task
did not touch `items.ts` and did not change what those frames look like, so
nothing regressed, but "spare frames" was the wrong mental model for that
placeholder even before this task; T-7.09 should give animal items real
icons from `Icons/Farm Animals`/`Icons/Food Icons` rather than assume frame
6 was ever a viable stand-in (it is blank, not spare-but-drawable). The
`landing.ts` growth-stage diagram and the
seed-picker icons both already consume `stageFrames`/`seedFrame` generically
and needed no logic change, only the one stale comment fixed above.

### T-7.09 — Item icon rewire  ✅ **DONE**
Depends: T-7.08 · Size: S
Files: `packages/shared/src/config/items.ts`, `packages/shared/src/config/assets.ts`
**Do:** Every item's `icon: {sheet, frame}` points at new-pack art: seeds and
produce from the crop strips; egg, milk, hay, chicken feed from
`Icons/Farm Animals` / `Icons/Food Icons` (add those sheets to the manifest;
measure frames). The HUD's `iconFor` needs no change — it already resolves
through the manifest.
**Done:**
- [x] Every `ITEM_IDS` entry renders an icon in the bag panel
- [x] Config test asserting every item's icon sheet exists in SHEETS still
      green

**How it turned out.** Measured every file in `Icons/Food Icons/` (and the
one sheet in `Icons/Farm Animals/`, `Animals farm icons.png`) by inspection
before wiring anything: `Icons/Farm Animals/` turned out to hold nothing
usable — its only multi-icon sheet is a 6-row grid of animal-identity face
portraits (cow/bull/pig/duck/chicken/rooster/sheep, by colour variant), no
produce or feed icons anywhere in the folder, confirmed by viewing the full
sheet at 4x zoom rather than assumed from the folder name. Every file under
`Icons/Food Icons/` turned out to be a uniform 32x16 PNG — two 16x16 frames —
and a per-frame alpha-mask diff (checked on Chicken Egg, Small Cow Milk,
Animal Feed, Wheat, and two unrelated icons — Apple, Broccoli — as a cross-
check that this wasn't coincidence) showed the same pattern on every one:
frame 1 is the same subject as frame 0 but **with a white outline drawn
around it** — a highlight/selected variant, not a second pose. (An earlier
draft of this entry called it a one-pixel "idle bob" pair; that was wrong and
is corrected here. The giveaway is the alpha mass, not the bounding box:
frame 1 carries ~35-55% more opaque pixels than frame 0 on every icon
measured — e.g. Chicken Egg 9180 → 14280 — which a mere shift could not
produce.) Frame 0 is therefore the correct canonical static icon, recorded as
`ITEM_ICON_FRAME = 0` (a named, shared constant rather than a bare `0`
repeated four times) and used for every new icon. **Frame 1 is not dead
weight — it is the ready-made hover/selected state** for whoever builds the
Stardew inventory panel in T-10.04a/b; use it rather than synthesising an
outline in code.

**No file anywhere in the pack is literally named "Hay"** — checked with a
recursive filename search across all of `new_assets/`, not just the two
folders this task's Do names. `Objects/Exterior/Hay Bales.png` exists and is
a real hay bale, but it lives outside `Icons/Farm Animals`/`Icons/Food
Icons`, so per the Do's instruction to source from those two folders, `hay`
uses `Icons/Food Icons/Wheat.png` instead — the same "closest match, keep
the game's item id" reasoning `CROP_LEEK` already established for Spring
Onion standing in for leek. `egg` → Chicken Egg, `milk` → Small Cow Milk,
`chicken_feed` → Animal Feed all matched directly with no substitution
needed. Four new `SheetSpec`s (`ICON_CHICKEN_EGG`, `ICON_COW_MILK`,
`ICON_ANIMAL_FEED`, `ICON_WHEAT`) were added to `assets.ts` and to `SHEETS`,
and `scripts/prepare-assets.mjs` gained the four matching `COPIES` entries
(`icon-chicken-egg.png`, `icon-cow-milk.png`, `icon-animal-feed.png`,
`icon-wheat.png`); `pnpm assets` copies them into
`apps/client/public/assets/` alongside everything else. `items.ts`'s
`ANIMAL_ITEM_ICON` now points at these four sheets instead of the T-7.07
placeholder that borrowed real, visible onion/potato growth-stage frames
(indices 2 and 3) — those frames were never "spare," a point T-7.08's
write-up already flagged for this task specifically.

**⚠️ Adding sheets to `SHEETS` silently broke the map, and the fix is part of
this task.** `tilesets.ts` allocates every tileset's `firstgid` by walking the
manifest **in declared order**, so inserting the four `ICON_*` sheets at
lines 785-788 — i.e. *above* `OBJ_MAPLE_TREE`/`OBJ_CHEST`/`OBJ_MAILBOX` and
above all of `IMAGES` — shifted every later run's firstgid by exactly 8
(4 sheets × 2 frames). `farm.json`'s baked object gids then resolved to the
wrong art entirely: the three maple trees rendered as **milk bottles**, the
chest as a maple-tree animation frame, the mailbox as a chest frame, and the
shipping box as a *character walk frame*. Nothing failed loudly — no console
error, no missing texture, no failing test; the map just quietly rendered the
wrong objects, which is precisely why the bag-panel screenshot this task's
Done criterion asks for is not sufficient evidence on its own. Fixed by
re-running `apps/mapmaker/scripts/generate-farm.ts` (which reads the current
manifest) and confirming with `verify-farm.ts`: **warnings 0**, and all six
objects back on their intended keys — `maple-tree → obj-maple-tree` frame 2,
`chest → obj-chest`, `mailbox → obj-mailbox`, `shipping-box →
obj-shipping-box`, all on their authored tiles, 20 plots unchanged at
(9,9)-(13,12).

**Standing rule this establishes for every later task: adding or reordering
anything in `SHEETS`/`IMAGES` invalidates `farm.json`.** Always re-run
`generate-farm.ts` + `verify-farm.ts` afterwards and check for `warnings: 0`.
T-7.06 stated the ordering dependency; this is the first task to actually
trip it, so it is restated here as an action item rather than a note. T-7.10
(new animal sheets) and T-8.03 (character layer sheets) will both hit this.
Appending new sheets at the **end** of `SHEETS` would avoid the drift, but is
not sufficient on its own — `verify-farm.ts` is the check that actually
proves it.

No code in `hud.ts` changed, per the Do — `iconFor` already resolves any
item through `SHEETS` by key and was never crop-specific. Its doc comment
still says "until T-7.09 gives them real icons," which is now stale, but
that file is explicitly out of this task's file list and the roadmap's own
"stop and say so" rule applies more to scope creep than to one stale
comment; left alone rather than editing a file the Do said not to rewrite.

**Break-tested the guard, not just the happy path**: temporarily set
`egg`'s frame to `99` (out of the 2-frame sheet's range) and confirmed
`config.test.ts`'s "every icon points at a real sheet and a frame inside it"
test fails with `Egg frame out of range for icon-chicken-egg: expected 99 to
be less than 2`, then reverted. `pnpm -r typecheck` and `pnpm test` are both
green: 719 tests, unchanged from T-7.08's count — this task added no new
test files, only pointed existing generic config assertions (icon-points-
at-a-real-sheet, no-two-items-share-an-icon) at new, correct data, which is
exactly what those tests were written generically enough to cover.

**Browser-verified** with the same `playwright-core` + cached-Chromium
workaround as T-7.07/T-7.08 (the registered Playwright MCP server still
defaults to a missing `chrome` channel in this environment). Registered a
throwaway account through the real `/register` page, then granted one of
each of all 12 `ITEM_IDS` directly via `psql` into that player's `inventory`
container (slots 0-11) — the fastest way to populate every item at once
without playing through the full farm/animal loop, and no different in kind
from `farm.integration.test.ts`'s own DB-manipulation test helpers. Logged
back in and opened the bag panel (`[data-bag]`): all 12 slots render a
distinct, correct-looking icon — black scattered leek seeds, a small brown
potato seed, red strawberry seeds, a tan onion-seed mound, a green leek, a
brown potato, a red strawberry, a golden onion bulb, a plain white egg, a
white milk bottle, a brown feed bowl, and a golden wheat/hay bundle — with
zero console errors and zero broken-image glyphs. This is the concrete
evidence for "every `ITEM_IDS` entry renders an icon": egg/milk/feed/hay no
longer show onion/potato crop sprouts, which is exactly the regression this
task existed to fix.

### T-7.10 — Animal reskin  ✅ **DONE**
Depends: T-7.07 · Size: M
Files: `packages/shared/src/config/assets.ts` (row/direction semantics only —
dimensions already measured), `apps/client/src/game/animalSprites.ts` (+
test), `apps/client/src/game/scenes/Farm.ts` (animal rendering only)
**Do:** T-7.04 already measured and registered `ANIMAL_CHICKEN_RED`,
`ANIMAL_CHICKEN_BLONDE_GREEN`, `ANIMAL_CHICKEN_BABY_YELLOW`,
`ANIMAL_COW_FEMALE_BROWN`, `ANIMAL_COW_MALE_BROWN` (chicken 16×16 grid, 4×7;
cow 32×32 grid, 4×9 — dimensions confirmed by grid-overlay, NOT the same
cell size as each other). What's still unresolved is what each ROW means —
this pack has far more animation per animal than the old one (multiple
idle/walk/peck frames plus a lying/sleep row for chickens; multiple
front/back/side/lying rows for cows, and a genuine egg-hatch row for baby
chickens, not at the old pack's row index). Determine the row semantics by
inspection (same discipline as T-7.03's direction-order verification — do
not assume a row means what it meant in the old pack) and rewire
`animalSprites.ts` to the new geometry. Keep the existing kinds/variants
working with one sheet each; full variants are T-12.01.
**Done:**
- [x] Chickens (adult + baby) and cows animate on the farm with new art
- [x] `animalSprites.test.ts` updated and green

**How it turned out.** Measured every row of `Chicken Red.png` (4x7 @
16x16), `Baby Chicken Yellow.png` (same layout), and `Female Cow Brown.png`
(4x9 @ 32x32) by cropping each row at 8-12x scale with Pillow and
cross-checking with a per-frame alpha/orange-pixel (foot) diff — the same
discipline T-7.03 used for the character direction strips. Full row-by-row
findings are recorded as doc comments on `ANIMAL_CHICKEN_IDLE_ROW` and
`ANIMAL_COW_IDLE_ROW` in `assets.ts`; the short version: chicken rows 0-2 are
three near-identical "upright idle" bob variants (frames 0/2 and 1/3 are
pixel-identical but for a 1px vertical shift — a breathing bob, not a walk
with moving limbs), rows 3-5 are progressively deeper pecking/nesting crouches
(foot-pixel count drops from 6-7 to 1-2), and row 6 is a genuine
standing→lying TRANSITION baked into one 4-frame row (frame 0's alpha
bounding box is full height, frames 1-3's starts 5-11px lower) — this is the
"lying/sleep row" the Do called out. The baby sheet's row 4 is the actual
egg-hatch sequence (white egg → cracking → chick emerging with sparkle VFX →
chick out, still sparkling) — confirmed unmistakably by eye at 12x zoom, and
NOT the old pack's `CHICK_EGG_ROW = 2`. The cow's row 0 is qualitatively
different from every chicken row: a genuine 4-phase leg-alternation walk
cycle with a forward/back head bob, not a body-shift bob; rows 1/2 are the
same walk from front/back, and rows 3-8 are lying poses (side/front/back,
plus two with a chewing-mouth mark) — see the manifest for the full 9-row
table.

**The surprise: after all that measurement, the correct answer for both
animal families turned out to be row 0 — the same value the old, unverified
`ANIMAL_SIDE_ROW = 0` default already used.** This was not assumed going in
(the Do's framing, and the genuinely much richer row layouts, argued against
it) — it was confirmed independently for each sheet family, and it is a real
coincidence rather than a shared design: chicken row 0 is an idle breathing
bob and cow row 0 is a walking-in-place cycle, two different kinds of
animation that simply both happen to live at index 0. Verified live in the
browser before making any changes (via `playwright-core` + the cached
Chromium at `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
same workaround as every T-7.0x task — the registered Playwright MCP server
still fails demanding `/opt/google/chrome/chrome` in this environment):
inserted one of every registered variant (`chicken_red`, `chicken_blonde`, an
immature baby chicken, `cow_brown_female`, `cow_brown_male`) directly into
`animals` via `psql -v ON_ERROR_STOP=1` for a throwaway farm, logged in
through the real `/login` page, and screenshotted the pasture 6 times at
700ms intervals both before and after the code change. A crop-region pixel
diff between consecutive screenshots showed the expected two-phase
alternation pattern (`diff, 0, 0, diff`) for the chickens and continuous
motion for the cows in both the "before" and "after" runs — i.e. the art was
already animating correctly, and the task's real deliverable turned out to be
proving that rigorously and giving it a defensible, documented home rather
than changing which frame renders.

**Rewired `animalSprites.ts` to own the geometry anyway, per the Do**, even
though the numeric answer didn't change: `ANIMAL_SIDE_ROW` (one constant
shared across every sheet regardless of kind, explicitly flagged as
"unverified" since T-7.04) is retired. In its place, `assets.ts` exports
`ANIMAL_CHICKEN_IDLE_ROW` and `ANIMAL_COW_IDLE_ROW` as independently-measured
per-family constants (plus `ANIMAL_CHICKEN_BABY_HATCH_ROW = 4`, recorded but
deliberately not wired — the game has no incubating-egg state, chicks are
bought immature per CLAUDE.md §5.4, so nothing would ever play it; left
measured for whichever future task adds a hatch cutscene). `animalSprites.ts`
gained `idleRowFor(sheet)` / `idleFrameFor(sheet)`, which dispatch by sheet
key (a `COW_SHEET_KEYS` set) rather than by shape, so a future sheet whose
idle row genuinely isn't 0 only needs a change in this one function, not in
every caller. `Animal.ts` — **not in this task's file list, but required to
consume the removed constant** — now imports `idleFrameFor` instead of doing
`ANIMAL_SIDE_ROW * sheet.cols` itself; flagged here explicitly rather than
silently expanding scope, per the roadmap's own instruction. `Farm.ts`
needed no change at all: it only positions `Animal` instances via
`pastureSlot`, and never touched the row constant directly — the "animal
rendering only" file-list entry turned out to name a file that already had
nothing to fix.

**A real test-design trap, caught and fixed before it shipped**: the first
draft of the "cow sheets get the cow row" test compared
`idleRowFor(cowSheet)` against the live `ANIMAL_COW_IDLE_ROW` import — which
passes trivially no matter what that constant is edited to, since both sides
of the assertion read the same (possibly-wrong) value. Caught by actually
running the break-test discipline (CLAUDE.md rule 6): edited
`ANIMAL_COW_IDLE_ROW` to `2` and the self-referential test kept passing.
Fixed by adding a literal, hardcoded assertion (`expect(ANIMAL_COW_IDLE_ROW).
toBe(0)`) as the real regression guard, plus a fallback-dispatch test using a
synthetic `SheetSpec` with an unregistered key to prove `idleRowFor` checks
sheet identity rather than shape. Both were then genuinely broken and
confirmed red (editing the constant broke the literal test; short-circuiting
`idleRowFor` to always return `ANIMAL_COW_IDLE_ROW` broke the dispatch and
fallback tests) before being restored — one honest limitation noted in the
test file's own comments: because the two measured constants are both
numerically 0, no black-box value comparison can fully distinguish "correctly
dispatches per sheet" from "coincidentally returns the right number for a
wrong reason" — the literal-value test is what actually protects against a
config drift, and the dispatch tests protect the code-reads-from-config
invariant instead.

`pnpm -r typecheck` and `pnpm test` are green: 723 tests total (52 shared +
61 client + 62 mapmaker + 548 server), up from 719 at T-7.09 — 4 new tests in
`animalSprites.test.ts` (17 there now, up from 13), no changes needed
anywhere else.

**Gid-drift check run per the standing rule (T-7.09), even though nothing in
`SHEETS`/`IMAGES` was added, removed, or reordered this task** (only new row
*value* constants, which are not manifest entries): `generate-farm.ts` +
`verify-farm.ts` from `apps/mapmaker/` both ran clean —
`warnings: 0`, all six baked objects still resolving to their intended keys
(`maple-tree → obj-maple-tree` frame 2 ×3, `mailbox → obj-mailbox`,
`chest → obj-chest`, `shipping-box → obj-shipping-box`), and
`git diff --stat` on `farm.json` was empty, confirming the manifest ordering
genuinely didn't move.

**Left out, flagged for a follow-up rather than fixed here (out of this
task's file list):** `apps/client/src/game/pasture.ts`'s
`PASTURE_SPACING` comment — "A cow is 22px wide, so one tile apart
overlaps" — is now stale. The new cow art is exactly 32px wide, the same as
one tile of `PASTURE_SPACING.x`, so neighbouring cows now render edge-to-edge
with zero gap (visible in the browser screenshots as the two cows'
silhouettes touching). This does not block "animals animate with new art"
and `pasture.ts` isn't in T-7.10's file list, so it was left alone rather
than quietly expanding scope; whoever next touches animal layout should
either widen `PASTURE_SPACING.x` or shrink cow rendering to fit.

### T-7.11 — House/coop/barn/shipping-box exterior rewire  ✅ **DONE**
Depends: T-7.06 · Size: M
Files: `apps/client/src/game/entities/House.ts`, `apps/client/src/game/entities/Coop.ts`
(new), `apps/client/src/game/entities/Barn.ts` (new), `apps/client/src/game/scenes/Farm.ts`,
`apps/client/src/pages/landing.ts`, `packages/shared/src/config/assets.ts`
(house-tier look mapping only — geometry already measured in T-7.04)
**Do:** Not in the original task breakdown — added because T-7.04 found no
existing task claims this rewire (unlike Player/animals/crops, which have
T-8.03/T-7.10/T-7.08). T-7.04 already measured and registered `OBJ_TINY_HOUSE`
+ `OBJ_TINY_HOUSE_LOOK`, `OBJ_CHICKEN_COOP` + `OBJ_CHICKEN_COOP_LOOK`,
`OBJ_BARN` + `OBJ_BARN_LOOK`, `OBJ_SHIPPING_BOX` + `OBJ_SHIPPING_BOX_LOOK` —
each a whole-kit `ImageSpec` plus one measured crop-window. Point `House.ts`
at the new constants (mirrors its existing `registerHouseFrames`/
`Texture.add()` pattern exactly — just new pixel numbers and, for now, a
single look regardless of tier: only one clean crop-window exists in the new
kit, so `houseLookFor` collapses to always returning it, documented as a
known regression the same way `HOUSE_BUILDINGS`'s own comment already
documents the old pack's two-looks-for-three-tiers gap). Add equivalent
`Coop`/`Barn` entities using the same crop-window-as-custom-frame technique,
positioned on the farm map (T-7.06 places their marker objects). Update
`landing.ts`'s `HOUSE_WINDOW` to the new crop. Multi-tier visual variety for
coop/barn is explicitly out of scope here — that is T-12.02.
**Done:**
- [x] House, coop and barn render on the farm with new-pack art
- [x] Landing page's house sprite uses the new crop, not the old one
- [x] `pnpm -r typecheck` and `pnpm test` green

**How it turned out — `House.ts` and `landing.ts` were already done; the real
work was Coop/Barn and the shipping box.** Reading the two files this task's
Do names before touching anything showed `House.ts` already pointing at
`OBJ_TINY_HOUSE`/`OBJ_TINY_HOUSE_LOOK` via `registerHouseFrames`/
`Texture.add()`, and `landing.ts`'s `houseSprite()` already reading
`OBJ_TINY_HOUSE_LOOK` directly — there is no `HOUSE_WINDOW` symbol anywhere in
the client any more. Some earlier session's scope evidently ran ahead of its
own task boundary and finished this slice without ticking the box; nothing
here contradicts the constants T-7.04 measured, so this was verified rather
than redone. `assets.ts`'s house-tier-look mapping needed no change either:
`OBJ_TINY_HOUSE_LOOK` is already the sole crop and its doc comment already
documents the one-look-for-every-tier regression the Do asked for. Cropped
each of `OBJ_TINY_HOUSE_LOOK`/`OBJ_CHICKEN_COOP_LOOK`/`OBJ_BARN_LOOK` out of
the real pack files at 6x nearest-neighbour and inspected them individually
before trusting them: the house crop is genuinely a plain roof+wall
silhouette with no door (matches its doc comment, not a mistake); the coop
and barn crops are each a complete, correctly-framed building with no
stray pixels from a neighbouring part — all three were correct as measured,
no fix needed.

**The stale premise flagged by the task brief was confirmed and resolved as
instructed.** `obj-tiny-house`/`obj-chicken-coop`/`obj-barn` gids recorded in
T-7.06's write-up (3049/3050/3051) do not exist in the current manifest at
all — `fromGid` on any of those now resolves into the crop-strip range, not
even close to an object tileset — confirming the note that they were stale
and should be re-derived, not copied. Since T-7.06's own `buildMapObjects`
argument still holds (`Farm.ts` renders a gid at native pixel size with no
scaling, and all three kits are still whole uncropped sheets — 688x368,
480x224, 496x176), map-object placement was not attempted for any of the
three; `Coop.ts`/`Barn.ts` were written as two new client entities mirroring
`House.ts` exactly: a hardcoded `{x, y}` tile constant, a `registerXFrames`
function that adds one named custom frame over the measured crop window
(guarded on the frame already existing, same as `House.ts`), and a thin class
with a `destroy()`. Neither needs a `doorway()` or `setTier()` — there is no
`coopTier`/`barnTier` column on `farms` anywhere in the schema (confirmed by
grep), so unlike the house there is no server value to react to yet, and no
interior scene to enter. Wired into `Farm.ts` next to `House` (`create()`
constructs both after the house, `shutdown()` destroys both) — no tier
argument, since there is nothing to pass.

**Placement was worked out by hand from `farm.json`'s actual tile grid, not
guessed.** Dumped the map's `ground`/`decor`/`objects` layers to find every
occupied tile: house at (96,96)-(144,48), two maple trees, the mailbox, the
chest, the plot block (144-224, 144-208), and the path spine down column 8 and
row 13. Picked `COOP_TILE = {x: 1, y: 11}` (world 16,176 bottom-anchored, a
55x78 footprint landing entirely on the plain-grass block west of the house,
clear of the mailbox below it) and `BARN_TILE = {x: 15, y: 9}` (world
240,144, a 78x76 footprint in the untouched grass strip east of the house and
south of the second maple tree, with its top edge landing exactly on the
tree's bottom edge — checked column-by-column against the dumped grid, not
eyeballed). Both are recorded as named tile constants with a comment pointing
back to this check, the same pattern `HOUSE_TILE` already uses in `House.ts`.
No dedicated bounds test was added (unlike `pasture.ts`'s `pastureFitsFarm`) —
these are two fixed constants with no runtime formula to regress, so a test
would only be re-asserting the literal numbers just written; if a later task
starts computing building position from something (a coop tier, e.g.), that
is the point to add one.

**The shipping box fix, which the task title names but which the Do text
never actually calls out as a step, was done in `Farm.ts` rather than as a
new entity.** T-7.06's write-up already placed it on the map as an ordinary
gid object (its footprint is normal-building-sized, unlike house/coop/barn),
so the fix lives in `buildMapObjects`: when the resolved key is
`OBJ_SHIPPING_BOX.key`, a `shippingBoxFrame()` helper registers (once,
guarded like every other frame here) a custom frame over
`OBJ_SHIPPING_BOX_LOOK` and that frame name is used instead of the gid's raw
frame 0, which would otherwise draw the whole 48x64 image — closed and open,
wide and narrow, all four poses stacked, exactly the "double-cluster of
crates" T-7.06 screenshotted and flagged as unclaimed.

**⚠️ Correction — the crop constant WAS wrong, and the first pass of this task
shipped a double-wide box.** An earlier draft of this entry concluded that
`OBJ_SHIPPING_BOX_LOOK`'s `{x:0, y:16, width:29, height:16}` "already grabbed
exactly the closed-wide cell, so the crop constant itself needed no
correction." It did not. 29 spans **two** crates — the wide closed pose *and*
the narrow one beside it — and the farm rendered them side by side, plainly
visible once the whole farm was screenshotted rather than just the buildings.

The reason the alpha analysis endorsed a wrong number is worth keeping,
because it will recur on any kit whose poses touch: **the closed crates sit
flush against each other with no transparent column between them**, so
"trim tight to alpha bounds" sees one contiguous opaque run from x=0 to x=28
and reports width 29. Presence-of-alpha cannot find that boundary. The alpha
*value* can — columns 0-15 sum to 3570/3825 each, columns 16-28 to 4080, a
clean step exactly on the 16px cell line, with the third crate a genuinely
separate run at x=35..47. Corrected to `{x:0, y:16, width:16, height:16}`;
the farm now draws one crate.

**Guarded so it cannot regress silently.** Nothing validated any `*_LOOK`
window before — a rectangle that runs off its image, or one that quietly
spans two poses, renders wrong art with no error and no failing test. Added
`describe('building crop windows')` to `config.test.ts`: a bounds check over
all four windows (house/coop/barn/shipping box), plus the shipping-box width
pinned as a **literal 16** with a comment saying why re-deriving it from
alpha bounds gives a plausible-looking 29. Break-tested: restoring 29 fails
with `expected 29 to be 16`, restoring 16 passes. Shared suite 52 → 57.

**Gid-drift check run per the standing rule, even though nothing in this
task touched `SHEETS`/`IMAGES`** — no sheet was added, removed or reordered.
`generate-farm.ts` + `verify-farm.ts` were still run to be sure: `warnings: 0`,
all six existing map objects resolved to their intended keys, and
`git diff --stat` on `farm.json` came back empty (byte-identical
re-generation), confirming firstgid allocation is unchanged.

**Browser-verified** with the `playwright-core` + cached-Chromium workaround
(`executablePath: ~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`)
against the already-running dev stack. Registered a throwaway account through
the real `/register` form and screenshotted `/play`: the house (wood-grain
silhouette), coop (heart-shaped gable, red walls) and barn (curved dark roof,
double doors, hanging lantern) all render as complete, correctly-cropped
buildings at their planned positions with no overlap with the plot field,
mailbox, chest, or either maple tree; the shipping box **initially still drew
two crates** (a partial fix — 4 poses down to 2) and drew a single clean crate
only after the width-29 → 16 correction above, re-confirmed by re-capturing
the same screen region. Zero
`pageerror`s and zero `console.error`s captured across the whole session.
Also loaded `/` and confirmed the landing page's "closer scene" section still
renders the house with the identical crop next to the maple trees and walking
character, with zero console errors. Ran into the registration endpoint's own
rate limit on a rapid third registration attempt from the same IP during
verification — expected behaviour per CLAUDE.md §8, not a regression, so not
retried once the first two runs had already produced full evidence.

`pnpm -r typecheck` and `pnpm test` are both green: 52 shared + 61 client + 62
mapmaker + 548 server = 723 tests, unchanged in count from T-7.10 — this task
added no test files (see the bounds-test note above) and touched no logic any
existing test exercises.

---

# Phase 8 — Character: appearance, control, tools

### T-8.01 — Appearance storage  ✅ **DONE**
Depends: T-7.03 · Size: S
Files: `apps/server/src/db/schema.ts` (+ migration),
`packages/shared/src/schemas/index.ts`, `apps/server/src/modules/player/routes.ts`
(new), `apps/server/src/app.ts`
**Do:** Add `players.appearance` (text, nullable — JSON). Shared
`appearanceSchema`: `{skin: 1-4, eyes: {sex: 'male'|'female', color:
black|blue|brown|green}, hair: {style: fawn|iridessa|josh|lyria|sebastian|
silvermist|standard, color: black|blonde|brown|ginger}, clothes:
blue|green|pink|purple|red}` (enum names from the actual folder names —
verify against `new_assets/Character/Character/PNG/1. Idle/`). New
`PUT /api/player/appearance` (requireAuth, zod, idempotent), plus expose
`appearance` in `toSelfPlayer`.
**Done:**
- [x] Migration applies to a fresh DB
- [x] Endpoint rejects an out-of-enum value with `VALIDATION_FAILED`
- [x] `GET /api/auth/me` returns the saved appearance
- [x] Integration tests incl. idempotency replay

**How it turned out.** Listed `new_assets/Character/Character/PNG/1. Idle/`
directly before writing anything: the task's provisional enum values turned
out to be **exactly right**, once lower-cased — `Skins/{1,2,3,4}.png`,
`Eyes/{Female,Male}/{Black,Blue,Brown,Green}.png`,
`Hair's/{Fawn,Iridessa,Josh,Lyria,Sebastian,Silvermist,Standard}/
{Black,Blonde,Brown,Ginger}.png`, `Clothers/Farm/{Blue,Green,Pink,Purple,
Red}.png`. No surprises this time — worth recording precisely because the
last few asset-adjacent tasks (T-7.08/7.09/7.11) all found the provisional
guess wrong, and "measure anyway, even when confident" is the discipline
that catches the exception, not the one that's usually needed.

`appearanceSchema`, `SkinId`, and the five enum-value arrays
(`SKIN_IDS`/`EYE_SEXES`/`EYE_COLORS`/`HAIR_STYLES`/`HAIR_COLORS`/
`CLOTHES_COLORS`) live in `packages/shared/src/schemas/index.ts` since that
is the file the task named — not a new `config/character.ts` — so T-8.02's
character creator and T-8.03's compositor should import the enum arrays from
there rather than re-deriving them. `Appearance` is exported as
`z.infer<typeof appearanceSchema>` from the same file and re-exported into
`SelfPlayer` (`types/index.ts`) via a type-only import; no runtime cycle
since `schemas/index.ts` never imports from `types/index.ts`.

The column is `text`, storing `JSON.stringify(appearance)` — validated JSON
in, so `middleware/auth.ts`'s new `parseAppearance()` only needs a defensive
try/catch (treats an unparseable row as `null`, i.e. "creator not run,"
rather than 500ing every request for that player). `AuthedPlayer` gained an
`appearance: Appearance | null` field, which meant every other place that
builds a full `AuthedPlayer` from a hand-picked column list needed the same
column and the same parse — found one: `trade/service.ts`'s `candidate()`
helper (used for the eligibility re-check and `capacityForPlayer`'s
`vipUntil`/`gold` lookup at invite/accept/execute). Exported `parseAppearance`
from `middleware/auth.ts` rather than duplicating the try/catch there.

**One file outside the task's list needed a small, unavoidable extension:**
`apps/server/src/test/app.ts`'s `TestClient` only had `get`/`post` helpers —
no route before this one used `PUT`. Added a `put()` method (and widened
`send()`'s method union) rather than hand-rolling `app.inject` calls in the
new test file; every future `PUT` route gets it for free.

The endpoint intentionally does **not** refuse a second call — nothing in
the Done checklist or CLAUDE.md §5.1 asked for "set once," and adding that
rule here would be inventing a constraint T-8.02 never asked for. T-8.02's
job is to show the creator only when `appearance` is `null`; re-customizing
later (if the game ever wants it) is a non-issue for this task either way.

Four break-tests, each confirmed to fail before being reverted: (1) loosened
`clothes` from `z.enum(CLOTHES_COLORS)` to `z.string()` — the "unknown
clothes color" case started passing invalid input through, caught by the
enum test; (2) called `setAppearance` directly in a `db.transaction` instead
of through `runIdempotent` — the idempotency-replay test failed because the
second call (same key, different body) actually applied; (3) dropped the
`.where(eq(schema.players.id, player.id))` filter in `setAppearance` — the
cross-player test failed because player B's save overwrote player A's row;
(4) removed the route's `requireAuth` hook and fed `currentPlayer`'s throw
with a fabricated guest identity instead of `request.player` — the
"requires a session" test failed (surfaced as `INTERNAL` rather than
`UNAUTHENTICATED`, since the fabricated id doesn't exist as a row — still a
failure, still caught). All four reverted immediately after confirming the
failure; `git diff` on `routes.ts`/`service.ts`/`schemas/index.ts` is clean
of break-test residue.

No new `ErrorCode` was needed — every failure mode the endpoint can produce
(`VALIDATION_FAILED`, `UNAUTHENTICATED`, `RATE_LIMITED`) already has a
`net/errors.ts` message, so that file is untouched.

Verified end-to-end against the running dev stack with `curl` (not
Playwright — the registered browser's `chrome` channel is missing in this
environment, the same issue T-7.07/7.08 hit): logged in as the existing
`t708chk42106` test account, confirmed `GET /api/auth/me` started with
`"appearance":null`, `PUT`'d a valid appearance and saw it echoed back and
then reflected in a fresh `/me`, sent `skin: 9` and got
`VALIDATION_FAILED` with `details: {"appearance.skin": "Invalid input"}`,
then replayed the same idempotency key with a different body and got back
the *original* appearance unchanged. Reset that account's `appearance` to
`NULL` via `psql` afterward so it doesn't interfere with future visual
verification of the (still unbuilt) character creator.

Migration `0005_handy_bullseye.sql` is a single additive nullable column
(`ALTER TABLE players ADD COLUMN appearance text`) — applied straight to the
dev database with `db:migrate`, no wipe, confirmed the existing test
accounts (`t706mapcheck`, `t707check21850`, etc.) are untouched with
`appearance` reading `NULL`.

`pnpm -r typecheck` and `pnpm test` are green: 743 tests total (57 shared +
61 client + 62 mapmaker + 563 server — the 15 new tests are all in the new
`apps/server/src/modules/player/player.integration.test.ts`).

### T-8.02 — Character creator UI  ✅ **DONE**
Depends: T-8.01 · Size: M
Files: `apps/client/src/game/characterCreator.ts` (new),
`apps/client/src/game/hud.ts`, `apps/client/src/styles/hud.css`,
`apps/client/src/net/player.ts` (new)
**Do:** When `/play` loads and `appearance` is null, show a blocking DOM
overlay (same DOM-over-canvas pattern as every panel): swatch rows for skin,
eyes (sex + color), hair (style + color), clothes color; a live preview
`<canvas>` that composites the chosen Idle strips' first down-facing frame
(draw layers in order skin→clothes→eyes→hair); Save calls the endpoint; a
"Randomize" and a default-accept button. Layer strip URLs follow the
`public/assets/character/...` layout from T-7.02.
**Done:**
- [x] New account sees the creator; saved account never does
- [x] Preview updates live per selection
- [x] Client typecheck/build green (no dedicated test file — panel
      convention, see v1 T-4.11 rationale)

**How it turned out.** The task's four named files were enough for the UI, but
three things outside them were unavoidable and each is small:

1. `net/api.ts` gained a `put()` verb and `'PUT'` in `request()`'s method
   union — no client route had used PUT before, exactly mirroring the
   `TestClient.put()` that T-8.01 had to add on the server side.
2. `packages/shared/src/config/assets.ts` gained the **layer-path contract**:
   `CHAR_LAYER_ORDER`, `charLayerVariant`, `charLayerPath`, `charLayerPaths`,
   and `charDirectionStart`. This is where it belongs rather than in the
   creator, because character strips are CLAUDE.md §9's documented exception
   to "every asset has a manifest entry" — they are addressed by *convention*,
   and a convention with two copies is a convention with two versions.
   T-8.03's `characterLayers.ts` should import these, not re-derive them.
   `assets.ts` now `import type`s `Appearance` from `../schemas/index.js`,
   which is safe for the same reason `types/index.ts` already does it: the
   import is fully erased (`verbatimModuleSyntax`), so the real
   schemas→config dependency stays one-directional.
3. `config.test.ts` gained four tests for the above (61 shared tests, was 57).

**The design decision worth recording: every swatch is the real art.** Each
one composites the player's *current* appearance with exactly one field
changed, through the same `drawAppearance` as the big preview — so picking a
hair style shows it in the hair colour already chosen, and the Clothes row is
five farmers in five outfits. The obvious cheaper design was CSS colour chips,
and it was rejected on measurement, not taste: T-7.03 recorded that the eyes
layer has an alpha mean of ~0.012 over a 32×32 frame, i.e. a "blue eyes" chip
would be a swatch of a colour occupying about one percent of what it claims
to preview. The cost is 27 canvases redrawn per click; a 32×32 draw is cheap
enough that this is not worth optimising.

**Two things that fell out of that choice.** Drawing had to stay
*synchronous*: `layerImage()` returns whatever is already decoded and
registers an `onLoad` that asks for a redraw, so a slow strip for an option
the player has already clicked past cannot land on a canvas that has moved
on. The async shape (await four images per canvas) needs a per-canvas
generation token to get the same guarantee, times 27. Redraw requests are
then coalesced through one `requestAnimationFrame` — 45 strips can decode in
the same tick on a warm cache, and un-coalesced that is 45 full passes for
one visible result.

**`this.saved` is not paranoia — break-tested.** The HUD calls
`creator.ensure()` from `setPlayer()`, which runs on every 20-second poll. A
poll response *generated before* the appearance write committed still carries
`appearance: null`. Removing the guard and replaying exactly that response
shape (`__hud.setPlayer({ ...player, appearance: null })`) reopened the
blocking overlay over a farm that already had a character; with the guard it
stays hidden. Confirmed, then reverted.

**Other break tests, each confirmed failing then reverted:** (1) reversing
`CHAR_LAYER_ORDER` to hair→eyes→clothes→skin rendered a naked, faceless
farmer and collapsed the Clothes row into five identical swatches — the draw
order is load-bearing, and the new config test pins it; (2) sending
`skin: 9` from `saveAppearance` produced the intended failure path rather
than a stuck panel — `VALIDATION_FAILED` toast, creator stays open, Save
re-enabled, `appearance` still `NULL` server-side. `git grep "BREAK TEST"`
is clean.

**Blocking was verified, not assumed.** `.creator` is `position: absolute;
inset: 0` inside the HUD root, appended last so it paints over the bar and
every panel; `document.elementFromPoint` at the Shop button, the seed picker
and bare canvas all return `SECTION.creator`. It deliberately has no close
button and no Escape handler, unlike every other panel — there is nothing to
go back to, and "Start farming" on an untouched default IS the task's
default-accept button.

**One layout bug caught only by looking at it.** The first pass sized the
card at 720px with the rows column capped at 420px: the seven hair styles
wrapped to a second line and pushed the *Clothes* row below a scroll fold —
a choice the player never learns they had. Widened to 820px (seven swatches
fit on one line) and capped at `min(70vh, 620px)`; measured
`scrollHeight === clientHeight === 579` afterwards, so nothing scrolls on a
normal viewport and the overflow is only the small-window fallback.

`hud.ts` also exposes a dev-only `window.__hud` handle (same
`import.meta.env.DEV` guard as `main.ts`'s `__game`) purely so
`openCharacterCreator()` is reachable. The creator is otherwise the one panel
in the game that shows once per account *ever* and can never be looked at
twice — and T-8.03's checklist explicitly needs "changing appearance via
creator re-open in dev" to re-render.

**Not fixed here, and not a regression:** after saving, the farm still draws
the T-7.07 single-layer `PLAYER_PLACEHOLDER_*` skin — a bare body with no
hair or clothes. Compositing the *world* character from the saved appearance
is T-8.03's whole job; this task ends at the overlay and the endpoint.

Verified in a real browser. The registered Playwright MCP is still unusable
here (it defaults to the `chrome` channel, which is not installed — the same
blocker T-7.07/7.08/8.01 hit), so this used the `playwright` npm package
driving the bundled Chromium from `~/.cache/ms-playwright` in a scratchpad
script: registered a fresh account and confirmed the creator appears
unprompted, that the preview canvas has real pixels and its digest changes
per selection and on Randomize, that Save closes it and `GET /api/auth/me`
echoes the exact chosen appearance, that a reload and a full 20-second poll
never bring it back, and that the dev re-open pre-selects all six saved
rows. No console errors, no failed layer loads.

`pnpm -r typecheck`, `pnpm --filter @tillhaven/client build` and `pnpm test`
are green: 747 tests (61 shared + 61 client + 62 mapmaker + 563 server). One
full-suite run showed a flaky failure in `house.integration.test.ts`'s
"cannot be raced into stacking two pieces on one cell" — unrelated to
anything this task touches, passed on its own and on a repeat full run.

### T-8.03 — Layered character rendering  ✅ **DONE**
Depends: T-8.02 · Size: M
Files: `apps/client/src/game/entities/Player.ts`,
`apps/client/src/game/entities/characterLayers.ts` (new),
`apps/client/src/game/scenes/Farm.ts` (spawn only)
**Do:** Replace single-sheet player rendering with a layered composite: from
the player's appearance, compute the 4 layer strip URLs per animation,
dynamically `this.load.spritesheet` them at Farm-scene start (Phaser supports
runtime loads; gate scene setup on the load completing), register per-layer
animations from T-7.03's constants, and render the character as a `Container`
of 4 stacked sprites that always play the same animation+frame. Keep pure
`movement.ts` untouched. Sprite origin/feet offset re-measured for the new
32×32 frames (replaces `PLAYER_ART`).
**Done:**
- [x] Character renders with chosen appearance, idles and walks in 4
      directions (side mirroring verified — no layer drift when flipped)
- [x] `movement.test.ts` untouched and green
- [x] Changing appearance (via creator re-open in dev) re-renders correctly

**How it turned out.** The three named files were the shape of the work, plus
two extensions that had to happen somewhere:

1. `packages/shared/src/config/assets.ts` gained `CHAR_ART` and `CHAR_ORIGIN`
   — the measured geometry this task's Do calls "replaces `PLAYER_ART`", and
   `PLAYER_ART` lived there. Five new tests in `config.test.ts` (65 shared
   tests, was 61).
2. `hud.ts` gained `onAppearance()`. The scene has to learn what the character
   looks like, and the HUD is already where that arrives — on every
   `setPlayer`, and again the instant the creator saves. Fetching the player a
   second time from the scene would have been a second source for one fact.
   (T-8.02 deliberately left this listener out as dead code; this is the task
   that needed it.)

**The measurement, and what it found.** Composited all four layers and read
the alpha bounding box of **every frame of every MVP animation** — 104 frames
across Idle, Walk, Run, Hoe and Watering. The art occupies `x∈[11,22)`,
`y∈[7,26)`: `top` and `bottom` are *identical in all 104 frames*, and
`left`/`right` hold for every Idle and Walk frame (Run and the tool swings
reach out to `x∈[9,24)` as a limb or tool extends, which is why `CHAR_ART`
documents the **locomotion** silhouette and `playerBounds` clamps on that
rather than on a swing).

The finding that mattered: **the frame carries six blank rows below the
feet.** Anchoring by the frame bottom — `setOrigin(0.5, 1)`, what the
placeholder did — floats the character six world pixels above whatever it
stands on, which at `PIXEL_SCALE` 3 is eighteen screen pixels of visible
hover. `CHAR_ORIGIN.y` is `26/32 = 0.8125`, which lands on a whole pixel so
it costs nothing against `roundPixels`. `CHAR_ORIGIN.x` stays a plain `0.5`
even though the art measures 11px wide centred on 16.5 — an 11px silhouette
cannot be centred in a 32px frame, and a fractional origin to chase half a
pixel would put every character sprite on a half-pixel and defeat the
nearest-neighbour rendering the whole game is built on. That trade is written
into the constant's doc comment, not left implicit.

**"Side mirroring verified" turned out to be a question with no subject.** The
Done item is a leftover from the old pack's 3-row-plus-mirror sheets. The new
pack draws all four directions as explicit frame blocks, so there is no
`setFlipX` anywhere in `Player.ts` — the browser check asserts
`anyFlipped === false` on all four layers in all four directions, which is
the honest way to satisfy "no layer drift when flipped": nothing is flipped.

**Two design calls worth recording.**

*The character is built in two stages, and the scene is not gated on it.* The
task's Do suggested gating scene setup on the load completing; that is worse
here. The constructor makes an empty `Container` that `movement.ts` can
already drive, and `setAppearance()` fills it once the strips arrive. The map,
the camera and the plots have nothing to do with the player's hair — and a
brand-new account sits on the character creator for as long as it likes before
there is an appearance to load at all, so "gate the scene" would mean "gate
the scene on a modal the player has not filled in yet." Verified both ways:
with the creator up the container has **0** layers and the farm renders
normally behind it; the instant Save returns it has **4**.

*The texture key IS the path.* Not laziness — it is the property that makes
the cache correct. Two appearances sharing a layer share its texture
automatically, and a key can never disagree with the file it names. Animation
keys are `char:<path>:<direction>`, keyed by texture rather than by player for
the same reason: Phaser's animation manager is global to the game.

**Break tests, each confirmed failing then reverted** (`git grep "BREAK TEST"`
clean):

1. `CHAR_ORIGIN.y = 1` (the pre-task frame-bottom anchor): screenshotted the
   idle character over the path and measured the lowest dark row of its
   shoes — 107 good vs 89 broken, **exactly 18 screen pixels = the measured
   6-row gap × PIXEL_SCALE 3**. The predicted magnitude, not just "it moved."
2. `charDirectionStart(...) → 0` in `registerCharacterAnimations`: the
   character walked left while drawn face-on, both eyes to camera. This is the
   single highest-risk arithmetic in the file and it fails silently — the
   animation key still says `:left`.
3. Playing the animation on `layers[0]` only and disabling `syncLayerFrames`:
   the skin walked (`walk/skin/4.png`, frame 13) while clothes, eyes and hair
   stayed frozen on `idle/...` frame 0 — a walking naked body under a floating
   still head. This corrected a comment: the per-layer `play` is **not** four
   copies of one call, it is how the upper layers change strip at all, since
   idle and walk are different files per layer. `syncLayerFrames` is the
   belt-and-braces on top of that, not the mechanism.

**The placeholder is properly retired, including its name.**
`PLAYER_PLACEHOLDER_IDLE/WALK` were removed from `SHEETS` — nothing asks
Phaser for those textures any more, and the network log confirms
`walk/skin/1.png` is no longer fetched on `/play` (`idle/skin/1.png` still is,
by the *login* page, which is correct). They are renamed
**`CHAR_PROMO_IDLE`/`CHAR_PROMO_WALK`**: they survive as the landing and auth
pages' art, drawn as DOM sprites straight from `path`, where there is no
logged-in player to have an appearance. Renaming touched two page files
outside this task's list, and that was the point — a constant still called
"PLACEHOLDER" asserts "temporary, delete me", and a future task acting on that
would break the landing page. Two new tests pin that they stay out of `SHEETS`
and still resolve through `charLayerPath`.

Verified in a real browser (same bundled-Chromium script approach as T-8.02 —
the Playwright MCP still defaults to the missing `chrome` channel). Inspected
the live scene through Phaser's display list rather than private fields:
four layer sprites with the saved appearance's textures, origin `(0.5,
0.8125)`, no flips; walking down/up/left/right plays the matching per-layer
animation and all four layers report the **same frame** (1, 7, 13, 19 — one
into each of Walk's four 6-frame direction blocks); releasing returns every
layer to its `idle/…` strip; a dev creator re-open with a randomized
appearance re-renders the container in place, still four layers, with new
textures. A full-screenshot pixel diff before/after confirms the **only**
thing that changed on the farm is the character itself (x 598–633, y 711–761)
— no depth or draw-order regression anywhere else. No console errors in any
run.

`movement.ts` and `movement.test.ts` are byte-identical to before the task
(md5 checked, not eyeballed). `pnpm -r typecheck`, the client build and
`pnpm test` are green: 751 tests (65 shared + 61 client + 62 mapmaker + 563
server).

### T-8.04 — Run  ✅ **DONE**
Depends: T-8.03 · Size: S
Files: `apps/client/src/game/entities/movement.ts` (+ test),
`apps/client/src/game/entities/Player.ts`
**Do:** Holding Shift runs: pure-function change (`RUN_SPEED`, input gains a
`run` flag) + the Run animation strips. Follow the existing pure-fn + Phaser
split exactly.
**Done:**
- [x] Run is faster than walk, diagonal still normalized — asserted in
      `movement.test.ts`
- [x] Run animation plays only while moving with Shift held

**How it turned out.** Small task, done exactly along the existing pure-fn /
Phaser seam: `movement.ts` gained `RUN_SPEED`, `MoveInput.run` and
`MoveState.running`; `Player.ts` binds Shift and picks the animation;
`characterLayers.ts` added `run` to `FARM_ANIMS`. Seven new tests (68 client
tests, was 61).

**`RUN_SPEED` is 84 — 1.75× walk, 5.25 tiles a second.** Doubling it (96) was
tried first and made the character overshoot the tile it was aiming at, which
stops being cosmetic the moment T-8.05 makes the *faced tile* the thing you
act on.

**`running` lives in `MoveState`, not in the renderer.** It means "moving AND
Shift held", not "Shift is down" — resolved once in the pure function so the
renderer looks it up instead of and-ing two flags and getting the standing-
still case wrong. Three tests pin that reading: Shift while moving is running;
Shift alone is not; Shift with two opposing keys that cancel is not.

**The `speed` parameter is gone.** `step()` had an unused fifth argument
defaulting to `WALK_SPEED` — no caller ever passed one. Keeping it alongside
`input.run` would have left two answers to "how fast is this character" with
no rule about which wins, so speed is now derived solely from the input.

**Break tests, each confirmed failing then reverted** (`git grep "BREAK TEST"`
clean):

1. Speed pinned to `WALK_SPEED` regardless of `input.run`: the browser's
   run/walk travel ratio collapsed from **1.72 to 1.01** while the run
   *animation* still played — the character sprinting on the spot. Two unit
   tests failed too, which is the point: this is a bug you cannot see in a
   screenshot.
2. `running` left set when input stops: caught by the unit test, invisible in
   the browser (the idle branch wins in `draw()` either way). Worth keeping —
   T-8.05 and T-8.09 will read `running`, and a character that is idle *and*
   running is a lie waiting to be believed.
3. Dropping `run` from `FARM_ANIMS`: the character moved at run speed while
   **still playing its idle loop, with a completely clean console**.

**Break test 3 was the one that changed the code.** It showed that
`anims.play()` on a key nobody registered does not warn, does not throw, and
does not stop the previous animation — it silently does nothing, so a missing
entry in `FARM_ANIMS` is invisible at runtime. `FARM_ANIMS` is now
`as const satisfies readonly CharAnimKey[]` with `FarmAnim` derived from it,
and `Player.draw()` is typed to return a `FarmAnim` — so asking for an
animation the farm never loads is a **compile** error. Verified by re-applying
the break: `tsc` fails with `Type '"run"' is not assignable to type '"idle" |
"walk"'`.

Verified in a real browser (bundled-Chromium script, as in T-8.02/8.03),
measuring travel over identical fixed key-holds rather than eyeballing:
run/walk ratio **1.72–1.85** across runs; the run strips load for all four
layers; mid-run all four layers report the same frame and the animation is
`run` with the right direction suffix; Shift alone reads `idle`; releasing
Shift mid-stride drops `run → walk` while the character keeps moving. The
mid-stride screenshot shows the real run pose — leaning forward, arms back,
hair flying — composited across all four layers. No console errors.

`pnpm -r typecheck`, the client build and `pnpm test` are green: 758 tests
(65 shared + 68 client + 62 mapmaker + 563 server). `house.integration.test.ts`'s
"cannot be raced into stacking two pieces on one cell" flaked once under the
parallel full-suite run and passed alone and on a repeat full run — the same
unrelated concurrency test that flaked during T-8.02.

### T-8.05 — Faced-tile targeting  ✅ **DONE**
Depends: T-8.03 · Size: M
Files: `apps/client/src/game/entities/targeting.ts` (new, pure, + test),
`apps/client/src/game/scenes/Farm.ts`
**Do:** Pure function: `(position, facing) → {tileX, tileY}` — the tile
directly in front of the character's feet. Farm scene renders a subtle
highlight rect on that tile every frame (reuse the plot-marker rectangle
style). Test like `movement.test.ts`: all four facings, tile boundaries,
map-edge clamping.
**Done:**
- [x] Highlight tracks the faced tile in all 4 directions
- [x] Pure tests cover boundary/edge cases

**How it turned out.** `targeting.ts` exports three pure functions —
`standingTile`, `facedTile`, `tileCentre` — with 13 tests; the Farm scene
moves one rectangle onto the target every frame. Two small additions to
`Player.ts` outside the named files: a `facing` getter (the scene has to aim
from somewhere) and a `ready` getter (below).

**The `- 1` is the whole task.** The feet position is a GROUND LINE — an
exclusive bottom edge, exactly like `CHAR_ART.bottom` (T-8.03) — so the tile
the character stands on is the one containing `y - 1`, the last pixel row it
actually covers. `Math.floor(y / TILE_SIZE)` looks correct and is wrong
whenever the feet land on an exact tile boundary, **which is precisely where
`spawnPoint()` puts them**: at spawn the character sits at y=224, a clean
multiple of 16, and dropping the offset moves the target a full tile down
(y=248 instead of 232) before the player has touched a key.

**Clamping, and what does not clamp.** `facedTile` clamps to the map so no
caller has to handle a null; at an edge the target collapses onto the standing
tile, which fails the same way an empty tile does for every caller from T-8.06
on. `standingTile` deliberately does **not** clamp — it reports where the
character is, `playerBounds` already guarantees that is on the map, and a
standing tile off it would be a bug worth seeing rather than hiding. There is
a test asserting exactly that asymmetry.

**`Player.ready`.** There is a real window where the scene has a player object
but nothing on screen: the container is built immediately, the strips only load
once the server reports an appearance, and a brand-new account holds that open
for the whole time it spends in the character creator. A highlight drawn
relative to the character has to vanish for exactly that window or it hovers
over an empty farm pointing at nobody. Verified both states directly —
creator open: `layers: 0, targetVisible: false`; the moment Save returns:
`layers: 4, targetVisible: true`.

The rectangle sits on `DEPTH.decor` — above the ground and the soil so it
shows on a plot, below `DEPTH.world` so the character, animals and buildings
pass in **front** of it rather than being outlined by it. Stroke alpha 0.55,
deliberately fainter than a hovered plot's 0.9: the target is on screen
constantly and must not compete with what the pointer is pointing at.

**A test of mine was wrong before the code was.** The first edge case used
`x: FARM_WIDTH * TILE_SIZE` as "bottom right", which is one pixel PAST the
last column — so it compared a clamped target against an unclamped standing
tile and failed. The code was right; the test now uses `- 1` and says why.

**Break tests, each confirmed failing then reverted** (`git grep "BREAK TEST"`
clean):

1. Dropping the `- 1` from `standingTile`: **5 unit tests** failed, and in the
   browser the spawn target sat at y=248 instead of 232 — a full tile below
   where the character is looking, in the state every session starts in.
2. Removing the clamp: 3 unit tests failed, and the browser put the highlight
   at world **x = -8**, floating off the left edge of the map.
3. Removing the `ready` guard: the highlight rendered with `layers: 0` — a
   target box on a farm with no character.

**One honest limitation of the browser check.** Its predicted target is
computed with the same formula it is checking, so `match=true` cannot
independently catch a formula error — break test 1 passed that comparison
while being wrong. What actually catches it is the unit tests plus the
absolute spawn observation, which is why both are recorded above rather than
just the green line.

Verified in a real browser (bundled-Chromium script, as in T-8.02–8.04):
target lands on the correct tile in all four facings, one tile away and never
diagonal; walking hard into the left edge clamps it to tile 0 (world x=8)
instead of leaving the map; the highlight is a 16×16 outline at depth −1900
with alpha 0.55, and the character draws over it. No console errors.

`pnpm -r typecheck`, the client build and `pnpm test` are green: 771 tests
(65 shared + 81 client + 62 mapmaker + 563 server).

### T-8.06 — Tool items  ✅ **DONE**
Depends: T-7.09 · Size: S
Files: `packages/shared/src/config/items.ts`, `packages/shared/src/config/economy.ts`
(STARTING_ITEMS), `packages/shared/src/config/assets.ts` (tool icon sheets)
**Do:** Add `hoe_wood` and `watering_can_wood`: category `tool`, `stackLimit:
1`, `shopBuyPrice: null`, `shopSellPrice: null`, `tradeable: false`, icons
from `Icons/RPG icons/Weapons and Armor/1. Wood/`. Add both to
`STARTING_ITEMS`. (Axe/others wait for D-4 and post-MVP chopping.)
**Done:**
- [x] Fresh registration grants both tools (registration test updated)
- [x] Tools cannot be sold (`ITEM_NOT_SELLABLE`) or traded (offer refused) —
      covered by existing config-driven tests; add assertions if not

**How it turned out.** Config-only task, and both refusals were already
config-driven — `shop/service.ts` reads `shopSellPrice === null`,
`trade/offer.ts` reads `!def.tradeable` — so no server logic changed. What was
missing was **tests**: `tradeable: false` had never been reachable from an
inventory item before (the only untradeable things were VIP furniture, which
is not an inventory item), so `offer.ts`'s guard had a branch no test could
enter. Four files gained assertions; one file outside the task's list —
`docs/economy.md` — had to change, see below.

**Tools are one rule, not three fields.** No buy price, no sell price, not
tradeable, `stackLimit: 1` — expressed as a `tool()` constructor rather than
four fields per item, so a future axe cannot be given a sell price by
copy-paste. The reasoning is that every account is *granted* the wood tier at
registration, so a tool has no scarcity to price and a tool market would be a
market in nothing.

**The icon frame was measured, not picked.** Both tool sheets have two frames
and T-7.04 explicitly deferred "which one is the inventory icon" to this task.
Compared all six 2-frame icon sheets in the pack pixel by pixel: frame 1 is
frame 0 plus a surrounding outline — **added pixels only, core identical,
nothing removed**, on every one of them. Since `ITEM_ICON_FRAME` (0) is what
the four food icons already use, tools use it too; frame 1 would have made
them the only two icons in the grid with a border. No new constant needed.

**Starter-kit order is now load-bearing, and is documented as such.**
`auth/service.ts` inserts `STARTING_ITEMS` at `slotIndex: index`, and T-8.07
makes the first twelve backpack slots the hotbar — so putting the tools first
lands a new player's hoe and watering can on keys 1 and 2 with no arranging.
That makes reordering the array a silent change to every future account's
hotbar, so both the constant's comment and a config test pin it.

**`docs/economy.md` had to change**, and that is the point of the file: the
ledger names the starter kit's exact contents, so granting two more items
without updating it would have made the economy document quietly false. The
row now lists the tools and states that they are worth **nothing** — the 180g
of goods figure is the seeds alone. (The docs test does not enforce this by
itself: it only checks non-null prices, and tools have none. Caught by reading
the ledger, not by CI.)

**Break tests, each confirmed failing then reverted** (`git grep "BREAK TEST"`
clean):

1. Giving tools `shopSellPrice: 50, tradeable: true` failed in **four
   independent places** — the shared config invariant, the shop integration
   test, the trade integration test, and `docs.test.ts`'s "records the current
   price of everything the shop trades" (an undocumented price). That
   defence-in-depth is exactly what the Done item was asking for.
2. Removing the tools from `STARTING_ITEMS` failed three tests across two
   suites, including the trade refusal test — which is a useful signal in
   itself: that test asserts the player *really holds* the tool it is being
   refused for, so it cannot pass by accident on an empty bag.

**One test of mine was wrong before the code was.** The shop suite's
`beforeEach` empties the bag, so my first draft's "the starter kit already
granted one" was false there and the `give()` helper defaults to `slotIndex 0`,
so granting two tools collided on the unique slot index. Both fixed: the test
now grants each tool into its own slot and says why.

Verified end to end in a real browser on a **genuinely fresh registration**
(not a reset account): the bag comes back as slots 0–3 =
hoe/watering can/leek seeds ×4/potato seeds ×2, and the Bag panel renders both
tool icons from `/assets/tool-hoe-wood.png` and
`/assets/tool-watering-can-wood.png` at frame offset `0px 0px`, each showing
×1. No failed asset requests, no console errors.

`pnpm -r typecheck` and `pnpm test` are green: 776 tests (68 shared + 81
client + 62 mapmaker + 565 server).

### T-8.07 — Hotbar UI  ✅ **DONE**
Depends: T-8.06 · Size: M
Files: `apps/client/src/game/hotbar.ts` (new), `apps/client/src/game/hud.ts`,
`apps/client/src/styles/hud.css`
**Do:** Bottom-center DOM strip showing the **first 12 backpack slots**
(slot indices 0–11), styled with `UI/Inventory/Slots.png` art (CSS
background-image + image-rendering pixelated). Selection via keys 1–9/0/-/=,
mouse wheel, and click; selected slot highlighted; selection state lives in
the hotbar module and is exposed via `getEquipped(): {slotIndex, itemId} |
null`. Re-renders on inventory changes (hook the existing `onSlotsChanged`
path in hud.ts).
**Done:**
- [x] Hotbar mirrors slots 0–11 live; number keys/wheel/click all select
- [x] Typing in an input never triggers selection (reuse the existing
      focused-input guard from `readInput`)

**How it turned out.** Three files as named, plus three small additions
elsewhere: `HOTBAR_SLOTS` in `economy.ts` (shared, because `STARTING_ITEMS`
order is chosen to land the tools inside this window — T-8.06), `UI_SLOT` in
`assets.ts` (measured, below), and a new `lib/focus.ts`.

**The hotbar is not a container.** It is a *window* onto backpack slot indices
0–11 — the rows the server already stores — so it needs no schema, no
endpoint and nothing validated. Rearranging the bag rearranges the hotbar
because they are the same rows, which the browser check proves directly:
moving the hoe from slot 0 to slot 5 through the existing
`POST /api/inventory/move` makes it appear in hotbar cell 6 with no hotbar
code involved. Selection is client-side state that gates nothing (§5.1).

**The slot art had to be measured, and the pack's own hotbars were unusable.**
`ui-inventory-slots.png` is not a uniform grid — panels, whole bars, loose
pieces — so no frame size slices it. Connected-component analysis of its alpha
channel found ten shapes; four are 18×18 squares in two colours (mean RGB
158,77,30 vs 175,108,64: the same square unlit and lit). Those two are exactly
a hotbar's states. The pack also ships **complete 8- and 9-slot bars**; both
are unused, because this hotbar is twelve slots, so it repeats the single
square rather than stretching art that says nine. Coordinates live in
`UI_SLOT` and reach CSS as custom properties set by `hotbar.ts` — the numbers
are written once, where two config tests can check them, and never retyped in
a stylesheet where nothing could.

**`isTypingInDom` moved to `lib/focus.ts`.** The task said to reuse the guard
from `readInput`, and it was a private function inside `Player.ts`. Two copies
would drift the moment one learned about a new kind of editable element.

**Keys are matched on `event.code`, not `event.key`.** `code` is the physical
key, so a layout that produces `&` on the 1 key still selects slot 1, and
Shift+1 keeps working now that Shift is the run modifier (T-8.04).

**Break tests, each confirmed failing then reverted** (`git grep "BREAK TEST"`
clean):

1. Removing the focus guard from `onKeyDown` — and this was **worse than the
   Done item implies**. Typing "3" into the shop's quantity field did not just
   also select slot 3: the handler's `preventDefault()` **swallowed the
   keystroke entirely**, so the field stayed at "1" instead of becoming "13".
   Without the guard, typing a quantity is broken, not merely accompanied by a
   stray selection.
2. Caching the equipped item at selection time instead of resolving it from
   the current slots. The display stayed correct — cell 0 empty, cell 6
   holding the hoe — while `getEquipped()` went on reporting a hoe in slot 0.
   Exactly the silent staleness that would have handed T-8.09 a tool that is
   not there.
3. Dropping the wheel's panel guard: wheeling over the shop's item list cycled
   the hotbar instead of scrolling the list. Re-verified after the revert at a
   short viewport so the list genuinely overflows — selection stays put and
   `scrollTop` moves 0 → 26. (The first re-check ran at 900px tall where the
   list did not overflow, which proved only half of it.)

**One thing fixed by looking at it.** The first pass drew the key-number hints
in `--ink` at 0.65 opacity, which is invisible against the orange slot art —
a shortcut hint nobody can read is not a hint. They now use the same cream-on-
dark-outline treatment as the quantity badge, and are legible in the
screenshot.

Verified end to end in a real browser: 12 cells labelled `1…9,0,-,=`; the
starter kit fills the first four; every number key selects the right index;
click selects; the wheel cycles over the canvas and **wraps** in both
directions (12 → 1); typing into the shop leaves selection alone and the field
receives the digit; and a live inventory move re-renders the strip and updates
`getEquipped()`. No console errors.

`pnpm -r typecheck`, the client build and `pnpm test` are green: 779 tests
(71 shared + 81 client + 62 mapmaker + 565 server).

### T-8.09 — Tool-use animations  ✅ **DONE**
Depends: T-8.05, T-8.07 · Size: S
Files: `apps/client/src/game/entities/Player.ts`,
`apps/client/src/game/entities/characterLayers.ts`
**Do:** A `playToolAnimation(kind: 'hoe' | 'water')` method: plays the
Hoe/Watering strips once in the current facing across all layers, locks
movement input for the animation duration, returns to idle. (Wired to real
actions in T-9.06; until then triggerable from a dev key for verification.)
**Done:**
- [x] Both animations play in all 4 facings without layer drift
- [x] Movement locked during the swing, released after

**How it turned out.** `playToolAnimation('hoe' | 'water')` on `Player`, plus
the two tool animations in `FARM_ANIMS`. Three additions to `assets.ts`
(`TOOL_ANIMS`, `charToolPath`, `charAnimDurationMs`) with five config tests,
because all three are measured-geometry facts and that is where those live.

**The character now holds an actual tool.** The pack ships a tool overlay
strip per tool animation and `prepare-assets.mjs` has copied them since T-7.02
— nothing had ever drawn them. Without it, the hoe animation is a character
miming an empty swing, so this task draws it: a **fifth sprite** above all four
appearance layers, visible only during a swing. Not a fifth entry in
`CHAR_LAYER_ORDER`, because only two of the five animations have one and the
character creator composites the same order with no tool in sight. Verified
the geometry rather than assuming it: each tool strip is pixel-for-pixel the
same layout as its animation's character strips (hoe 768×32, watering
1024×32), so it needs no separate frame maths and rides along in
`syncLayerFrames` — a hoe one frame out of step is not a subtle artefact, it
is a hoe that has left the character's grip.

**The lock is a deadline, not `ANIMATION_COMPLETE`.** A listener on a sprite
that an appearance change destroys mid-swing never fires, and the failure mode
of that is a character locked out of walking for the rest of the session.
`charAnimDurationMs` derives the deadline from the same measured
`framesPerDirection`/`fps` that Phaser plays the strip at, so the lock cannot
end before or after the swing it covers — measured in-page at 585ms/794ms
against computed 600/800.

**Break tests** (`git grep "BREAK TEST"` clean):

1. Feeding real input during a swing: the character walked out from under its
   own animation (x 152 → 162.9 mid-swing).
2. Shortening the lock to a fixed 200ms: the swing was cut off after **2 of 6**
   frames (hoe) and **2 of 8** (watering) — tool vanishing mid-air, character
   snapping to idle. This is the one that justifies deriving the duration
   instead of writing it down.
3. Removing `draw()`'s swing guard **did not reproduce**, and that is worth
   recording rather than hiding: `playToolAnimation` already clears
   `moving`/`running`, so `step` returns the same object and `draw()` is never
   reached from `update()` during a swing — even when the swing starts
   mid-walk, which is the case that looks like it should race. The guard is
   real but its actual job is `setAppearance`, which calls `draw()` directly
   and would otherwise drop a mid-swing character to idle the moment the
   creator saved a new shirt. The comment now says so.

**A note on how this was verified, because two of my own harnesses were wrong
before the code was.** Sampling the swing with per-frame screenshots gave a
nonsense sequence — screenshots cost 100–300ms each, so the "100ms" gaps were
nothing of the sort, and worse, the game loop kept running between `setFrame`
and the capture, so `settleSwing`/`draw` overwrote the frame being
photographed. Both were fixed by (a) tracing in-page on `requestAnimationFrame`
for timing and (b) `scene.scene.pause()` before stepping frames. With the
scene actually frozen, the in-game composite is **pixel-identical** to an
offline PIL composite of skin+clothes+eyes+hair+tool: 0 of 9216 pixels differ
on every one of the six hoe frames. (The earlier 7–16% "mismatch" was the
broken harness, not the renderer; a background-drift check confirmed the
scenery was byte-stable across captures, which is what ruled that out.)

Verified in a real browser: 5 sprites in the container; both animations play
in all four facings with the correct direction-block frames (hoe 2/8/14/20,
watering 2/10/18/26 — one block apart, as `charDirectionStart` intends); all
five sprites report the same frame in every case; every frame of the strip is
seen exactly once; movement refused during and restored after; tool visible
during and hidden after; both tool strips loaded. No console errors. Z and X
trigger the swings in dev builds only (`import.meta.env.DEV`), until T-9.06
gives the action key real intents.

`pnpm -r typecheck`, the client build and `pnpm test` are green: 782 tests
(74 shared + 81 client + 62 mapmaker + 565 server).

*(T-8.08 from the plan is folded into T-9.06 — action dispatch needs the
Phase 9 endpoints to exist first.)*

---

# Phase 9 — Farming loop v2: till, water, grow-while-wet

This resolves D-1. Model: `grown_ms` accumulates settled growth;
`watered_at` opens a wet window of `WATER_DURATION_MS`; growth advances only
inside wet windows. `effectiveGrowth(now) = grown_ms +
overlap(wetWindow, now)`. O(1), no jobs, pure §4.2.

### T-9.01 — Soil columns migration  ✅ **DONE**
Depends: — · Size: S
Files: `apps/server/src/db/schema.ts` (+ migration)
**Do:** Add `plots.tilled_at` (bigint, nullable) and `plots.grown_ms`
(bigint, NOT NULL default 0). Schema comments explain the growth-v2 model.
**Done:**
- [x] Migration applies cleanly; schema comments written
- [x] Existing farm tests still green (columns unused so far)

**How it turned out.** Two additive columns in one file, exactly as scoped —
`plots.grown_ms` (bigint NOT NULL default 0) and `plots.tilled_at` (bigint
nullable), migration `0006_lying_layla_miller.sql`. No service code touches
them yet; T-9.02 and T-9.03 do.

**The comment is the deliverable here.** The columns are trivial; the model
they encode is not, so `schema.ts` now carries the growth-v2 formula next to
the fields it governs — `effectiveGrowth(now) = grownMs + overlap(wet window,
elapsed)`, with `grownMs` meaning growth already BANKED from closed windows.
It also records the road not taken: **not** a `wateredUntil` instant, because
two fields that must agree about one window is a second thing to keep in step
and the window length is retunable config.

**`grown_ms` gets its own `durationMs()` helper**, not `epochMs()`. Identical
storage; named apart because reading a duration as an instant is precisely the
mistake this model invites, and the two sit three lines from each other.

**Break-tested the migration, not just the code.** Dropping `DEFAULT 0` while
keeping `NOT NULL` — the plausible slip — does not fail at migration time; it
fails at *registration*, because `newFarmPlots()` inserts plots without naming
the column. All 42 farm integration tests failed with a 500 on account
creation. The default is load-bearing, not decoration. Reverted and re-verified.

**"Applies cleanly" was checked two ways, because the suite only proves one.**
The test database persists between runs, so a normal `pnpm test` applies 0006
*incrementally* and says nothing about a fresh install. Dropped
`tillhaven_test` entirely and let `globalSetup` rebuild it from migration 0000
— `information_schema` then reports `grown_ms bigint NOT NULL DEFAULT 0` and
`tilled_at bigint NULL`, and the farm suite passes against it. Separately, on
the **development** database (440 real plots, 8 with crops in the ground), the
migration applied without a wipe and left every row intact with the new
columns defaulted.

`pnpm -r typecheck` and `pnpm test` are green: 782 tests (74 shared + 81
client + 62 mapmaker + 565 server) — unchanged, which is the point: the
columns are unused so far.

### T-9.02 — Till  ✅ **DONE**
Depends: T-9.01 · Size: M
Files: `apps/server/src/modules/farm/service.ts`, `routes.ts`,
`packages/shared/src/schemas/index.ts`, `packages/shared/src/errors.ts`,
`apps/server/src/modules/farm/farm.integration.test.ts`
**Do:** `POST /api/farm/till` (`tillSchema`: plotId + idempotencyKey).
Service: lock plot, must be unlocked (`PLOT_LOCKED`), empty (`PLOT_OCCUPIED`),
and untilled (new `PLOT_ALREADY_TILLED`) → set `tilled_at = now`. `plant` now
additionally requires `tilled_at !== null` (new `PLOT_NOT_TILLED`). `harvest`
leaves the soil tilled (does NOT clear `tilled_at`). New error codes + client
messages.
**Done:**
- [x] Happy path, double-till, plant-untilled, harvest-keeps-tilled all
      tested and break-tested
- [x] Ownership/idempotency follow the plant/harvest pattern exactly

**How it turned out.** `POST /api/farm/till` plus two new error codes, built
strictly on the plant/harvest pattern: `lockOwnedPlot` for ownership,
`runIdempotent` for replay, rate limit 60/min. Eight new tests (573 server
tests, was 565).

**The request carries a plot id and nothing else** — notably not which tool
was swung. The equipped hotbar item, the character's position and its facing
are all client-side UX (§5.1); a server that read a tool from the body would
be trusting the client to say it owns a hoe. That is written into
`tillSchema`'s comment so the next person does not "helpfully" add the field.

**Check order is load-bearing and is now pinned by a test.** Occupancy is
tested BEFORE tilled-ness. A plot with a crop in it is necessarily also
tilled, so the natural-looking order answers "already tilled" to someone
trying to hoe over a growing potato — true, but not the reason, and it reads
as "nothing to do here" when the answer is "there is a potato in the way".

**Harvest deliberately does not clear `tilled_at`.** That is what makes the
established loop plant → water → harvest with no hoe in it (§5.2), and the hoe
a tool for ground that has never been broken. Tested by harvesting and then
replanting with no till in between.

**The real work was the blast radius, not the endpoint.** Adding the
tilled-soil precondition broke **29 existing tests** at a stroke, because
`newFarmPlots()` creates plots untilled and 22 call sites went straight to
planting. Two decisions there:

- New farms start UNTILLED rather than pre-tilled. A brand-new player is given
  a hoe precisely so they can break ground, and pre-tilling the starter plots
  would make that gift pointless on day one.
- The 22 sites moved to a `tilledPlotId()` helper that stamps `tilled_at`
  **directly**, matching the file's existing convention (its header says the
  helpers "only ever move TIMESTAMPS — never a stage, never a result"). A
  planting test should keep testing planting; the till ENDPOINT gets its own
  describe block that uses the real route throughout. The one exception is the
  starter-kit test, which now tills and plants through the real endpoints —
  the claim it makes is that a new account can work its farm with what it was
  given, and a test that stamped the column itself would not be making it.

**A mistake worth recording:** the blanket find-and-replace that introduced
`tilledPlotId()` also rewrote the line inside the helper's own body, making it
call itself. Caught immediately by reading the diff, not by the tests — an
infinitely recursive helper and a correct one both fail loudly, but only one
of them tells you why.

**Break tests, each confirmed failing then reverted** (`git grep "BREAK TEST"`
clean): removing plant's tilled check; clearing `tilled_at` on harvest;
swapping the occupancy/tilled check order; dropping the `unlocked` check;
and breaking the idempotency scope key. Each failed exactly one test, and the
one it failed was the one written for it.

**Verified over real HTTP too**, not just `app.inject`: registered a fresh
account and walked the loop with `curl` — plant → `PLOT_NOT_TILLED` (409),
till → 200, replayed key → the identical body, new key → `PLOT_ALREADY_TILLED`
(409), plant → 200. Confirms the route is mounted, the schema parses, and both
new codes map to 409.

`pnpm -r typecheck` and `pnpm test` are green: 790 tests (74 shared + 81
client + 62 mapmaker + 573 server).

### T-9.03a — Growth v2 pure functions  ✅ **DONE**
Depends: T-9.01 · Size: M
Files: `apps/server/src/modules/farm/growth.ts` (+ `growth.test.ts`),
`packages/shared/src/config/crops.ts` (`WATER_DURATION_MS`, e.g. 4h)
**Do:** Extend the pure module: `effectiveGrowthMs(plot, now)` = `grown_ms` +
clamped overlap of `[watered_at, watered_at + WATER_DURATION_MS]` with
`[watered_at, now]` (zero when `watered_at` null); `settleGrowth(plot, now)` →
new `grown_ms` (called before re-watering or any read that writes);
`growthAt` reworked to derive stage/isRipe/readyInMs from effective growth
(`readyInMs` is `Infinity`-free: when dry and unripe, report `null`-like
"paused" via a new `isPaused` field). VIP `durationPercent` still applies to
the target duration. No DB, no Date.now — same discipline as today.
**Done:**
- [x] Unit tests: never watered, watered once and expired (dry gap),
      re-watered before expiry (no lost time), re-watered after expiry,
      ripe mid-window, paused reporting, VIP interplay
- [x] Every branch break-tested

**How it turned out.** `effectiveGrowthMs`, `settleGrowth` and an `isPaused`
field on `GrowthState`, plus `WATER_DURATION_MS = 4h`. 23 new growth tests and
2 new config tests; the 21 existing growth tests pass **unchanged**, which is
the point — the flag is still off, so live behaviour is byte-identical.

**One function reads the flag, so T-9.03b's flip really is one constant.**
`effectiveGrowthMs` returns `now - plantedAt` when `WATERING_ENABLED` is false
and `grownMs + openWindow` when it is true; `growthAt`, `settleGrowth`,
`isPaused` and the stage maths are all written once, on top of it. The
alternative — branching inside `growthAt` — would have left two code paths for
every later reader to keep in step.

**`settleGrowth` IS `effectiveGrowthMs`, deliberately.** To settle is to bank
exactly what has been earned, so they are one function called from two places
rather than two that could drift apart. A test asserts they agree at five
instants including both window boundaries, which is really an assertion that
nobody has "optimised" one of them later.

**`readyInMs` changed meaning, and that is the subtle part.** It used to be
wall-clock ms until ripe; a dry crop has no finite answer to that. It is now
**milliseconds of WATERED time still needed** — a real number in every state,
paired with `isPaused` to say whether it is currently ticking down. `Infinity`
and `null` were both rejected: they leak into arithmetic and into JSON badly.
T-9.04 has to render this as a paused countdown, not a running one.

**A ripe crop is never paused**, whatever its soil is doing. A finished crop
does not un-ripen when it dries out — §5.2 says a dry crop pauses, it never
dies — so the ripe branch returns `isPaused: false` unconditionally rather
than asking `isDry`.

**Why the second test file.** `WATERING_ENABLED` is a module-level constant
and `vi.mock` is per-file, so `growth.watering.test.ts` flips it there and
nowhere else. That keeps `growth.test.ts` honestly testing the v1 path that is
still live. Its **first test guards the mock itself**: a never-watered plot
must show zero growth after a day, which is only true if the flag really
flipped — verified by disabling the mock and watching that test fail first,
ahead of seven others.

**`WATER_DURATION_MS` was chosen against the crop table and the choice is now
pinned by a test.** Leek (45m), potato (2h) and strawberry (4h) ripen inside
one window; onion (8h) needs exactly two. Retuning a crop past the window
would silently invalidate that reasoning, so a config test asserts it rather
than leaving it as a comment nobody re-checks. Drafting that comment I first
wrote "onion, 6h" from memory — it is 8h; checked against `crops.ts` and
corrected before it became a false claim in the codebase.

`WATERED_GROWTH_MULTIPLIER` is deleted. It was the speed-boost design D-1
rejected, and its own comment said "if it ships as required, this constant is
deleted".

**Break tests, each confirmed failing then reverted** (`git grep "BREAK TEST"`
clean): uncapping the wet window (3 failures — dry plots grow forever);
settling without the open window (4 — re-watering destroys progress); `>` for
`>=` at the window boundary (1 — the off-by-one test); reporting a ripe crop
as paused (1); and ignoring `WATERING_ENABLED` (7 across both suites, proving
the v1 path is genuinely still covered). Every break failed the test written
for it and nothing else.

`pnpm -r typecheck` and `pnpm test` are green: 815 tests (76 shared + 81
client + 62 mapmaker + 596 server). `house.integration.test.ts`'s race test
flaked once under the parallel run and passed alone and on a repeat — the same
unrelated concurrency test as in T-8.02 and T-8.04.

### T-9.03b — Water endpoint + service integration  ✅ **DONE**
Depends: T-9.03a, T-9.02 · Size: M
Files: `apps/server/src/modules/farm/service.ts`, `routes.ts`,
`packages/shared/src/schemas/index.ts`, farm integration tests
**Do:** `POST /api/farm/water` (plotId + key): lock plot, must be planted
(`PLOT_EMPTY`); settle `grown_ms` via `settleGrowth`, then `watered_at = now`.
Re-watering while still wet is allowed and wastes nothing (settle-then-stamp
makes it so). `plant` resets `grown_ms = 0, watered_at = null` (a fresh seed
starts dry — first water starts growth). `harvest` requires
`effectiveGrowthMs ≥ effectiveDuration`. Flip `WATERING_ENABLED = true`.
**Done:**
- [x] Integration tests: growth genuinely pauses while dry (backdate trick:
      plant, water, let window lapse, verify stage frozen), resumes on
      re-water, ripens across multiple wet windows
- [x] `WATERING_ENABLED` test updated (v1 had a test pinning `false`)
- [x] Break-tested: remove the settle call → lost-growth test fails

**How it turned out.** `POST /api/farm/water`, `WATERING_ENABLED = true`, and
16 new integration tests. The service function is nine lines: lock, check
cleared, check planted, settle, stamp.

**Settle-then-stamp is the entire design.** `grownMs = settleGrowth(plot, now)`
runs before `wateredAt = now`, so the open window's elapsed time is banked
before it is overwritten. That one ordering is what makes re-watering early
free and watering late cost only the dry gap — there is no "is it still wet"
branch anywhere in the endpoint, because there does not need to be. Removing
the settle call fails four tests.

**Watering bare soil is refused; watering a ripe crop is not.** The empty case
looks like harmless no-op tidiness and is not: stamping `wateredAt` on an empty
plot would leave a window open that the next seed inherits, i.e. a free head
start for anyone who waters before planting. The ripe case genuinely is
harmless (a finished crop does not un-ripen), and refusing it would force a
client watering a whole row to know which plots are ripe first — so it returns
200 and changes nothing that matters. `PLOT_LOCKED` is checked before
`PLOT_EMPTY` for the reason till uses: a locked plot is empty too, but "not
cleared yet" is the answer the player can act on.

**Both `plant` and `harvest` zero `grown_ms`, and the break test proved one of
them was untested.** Deleting the reset from `plant` broke nothing — harvest
clears the bank first, so no endpoint sequence can reach a plot with banked
growth and no crop. The choice was to delete an unreachable guard or to prove
it; it is defence for exactly the case a later feature introduces (idle mode
clearing a crop, a manual fix), so it stays, with a test that constructs the
state directly and now fails when it is removed. An untested branch that a
future task silently relies on is the failure mode being avoided here.

**The flip swapped the mocks rather than deleting a suite.** `growth.test.ts`
now carries `vi.mock(..., WATERING_ENABLED: false)` and
`growth.watering.test.ts` lost its mock — the exact mirror of T-9.03a. Both
branches of the one `if` stay covered, which is what makes the constant an
actual one-line revert instead of a comforting-looking one. Its guard test was
inverted too: the watering suite now asserts `WATERING_ENABLED === true`
outright, so a revert says so in one line instead of through eight confusing
failures.

**`backdatePlot` had to change meaning, and that is the risky part of this
change.** Every pre-existing test that grows a crop moved `planted_at` back;
under D-1 that no longer grows anything. It now banks `grown_ms` as well —
still only the bookkeeping a real sequence of waterings would have produced,
never a stage or a ripeness. Tests that are *about* watering deliberately do
not use it: they call the real endpoint and age the window with `ageWatering`,
which shifts `watered_at` alone and leaves how much growth that earned to the
real calculation.

**"Offline progression" means offline POLLING now, not offline watering.** That
block was rewritten to water through the endpoint and then age the window, and
gained the assertion that matters most in the new model: reading farm state
across a *lapsed* window must not settle `grown_ms` (`mid.grownMs` is 0 after
five polls). A read that helpfully banks growth on the way past is the obvious
optimisation and would break §4.2 outright.

**Two assertions needed a tolerance and it is worth knowing why.** `ageWatering`
shifts `watered_at` relative to the *stamp*, but the read happens a few ms
later, so the open window is `HOUR + ε` and `readyInMs` lands just under the
round number. Exact-equality assertions passed locally at first and would have
flaked in CI.

**Known interim state, closed by the next two tasks.** The client cannot water
yet (T-9.06 wires the action key), so crops in the dev build sit at stage 0
until then; and `plots.ts` still interpolates a *running* countdown from
`readyInMs`, so a paused crop appears to keep growing between polls and may
draw itself ripe. Neither grants anything — the harvest intent is still
validated server-side and returns `CROP_NOT_READY` — and T-9.04 is what makes
the client render paused soil honestly.

**Break tests, each confirmed failing then reverted:** dropping the settle in
`water` (4 failures); dropping `grownMs: 0` from `harvest` (1); dropping it
from `plant` (1, after the test above was added — 0 before it); removing the
`PLOT_LOCKED` check (1); reverting `WATERING_ENABLED` to `false` (11
integration + 10 growth-watering + 1 shared config); and neutering
`growth.test.ts`'s new mock (8, its guard first).

`pnpm -r typecheck` and `pnpm test` are green: 831 tests (76 shared + 81 client
+ 62 mapmaker + 612 server), no flakes this run.

### T-9.04 — Farm-state view v2  ✅ **DONE**
Depends: T-9.03b · Size: S
Files: `apps/server/src/modules/farm/service.ts` (PlotView),
`packages/shared/src/types/index.ts`, `apps/client/src/game/plots.ts` (+ test)
**Do:** PlotView gains `tilled: boolean`, `isWet: boolean`, `wetUntil:
number | null`, `isPaused: boolean`; stage/readyInMs now come from growth v2.
Client plot rendering: soil underlay sprite per state (untilled = nothing /
tilled = dry soil tile / wet = wet soil tile from the T-7.05 soil sheet),
crop sprite on top as today.
**Done:**
- [x] All soil states render; wet visually reverts when the window lapses
      (client derives from `wetUntil` between polls)
- [x] `plots.test.ts` covers the state → frame mapping

**How it turned out.** `PlotView` gained the four fields the task named plus a
fifth, and `plots.ts` was rewritten around what the server now sends instead of
around `plantedAt`.

**The client's growth maths was quietly broken by T-9.03b and this is the fix.**
`displayAt` derived the crop's duration as `readyAt - plantedAt` and its
progress as `now - plantedAt` — wall-clock reasoning that watering invalidated.
A crop left dry for a day would have been drawn nearly ripe, and the countdown
would have ticked on a plot that was not growing at all. It now counts down
**watered** time from the moment the view was measured, truncated at
`wetUntil`, and takes the stage from the server's own formula.

**Hence the fifth field, `effectiveDurationMs`.** The stage formula needs the
VIP-adjusted duration; the client cannot derive it (`growthDurationMs` is the
pre-multiplier snapshot, and a *flagged* account gets no multiplier at all —
something the client is deliberately not told). The alternatives were to infer
it from timestamps (the exact class of guess that just broke) or to drop local
stage interpolation entirely. Sending it costs nothing: the multiplier is
public config and this is it applied to a number the view already carries, so
§4.1's "nothing exploitable" holds, and §4.4's "one formula, both sides" now
holds literally — the client runs the server's arithmetic on the server's
numbers. A break test pins it: computing the stage from the config duration
instead draws a freshly planted VIP crop as already sprouted.

**`Tile.readyAt` became `Tile.viewAt`.** v1 resolved "when does this ripen" to
an absolute instant once and drew from it. Under D-1 that is a promise a plot
cannot keep — the window may close first — so the tile now stores the instant
the view *describes* and the interpolation works forward from it. That is also
why the plant response's `readyAt` is no longer used: it is
`plantedAt + growthDurationMs`, which describes a crop watered continuously
from the moment it goes in, and a fresh seed is dry.

**Soil is drawn per plot, so the map stopped painting it.** The 20 plot cells
in `farm.json` were painted `ground-soil-dry`, which made every plot look
tilled before anyone had touched a hoe. They are now `ground-grass`, and the
scene draws a soil sprite per plot: hidden when untilled, dry, or wet
(T-7.05's sampled flat tiles). Soil state is server state, so exactly one thing
should own it — the alternative, drawing grass over the map's soil for untilled
plots, would have left two sources for the same pixel.

**`soilAt` reads `wetUntil`, never `isWet`.** Both are sent; the boolean is the
answer at the poll's `serverNow` and would leave a plot looking watered for up
to 20 seconds after it stopped growing. The absolute instant answers the same
question at any `now`, which is what lets soil dry out on screen unprompted.
Break-tested by swapping one for the other: 8 failures.

**The hover badge says `DRY · 45m 0s`.** A frozen countdown with no explanation
is a lie by omission — the number is not going down and the fix is a watering
can, not patience. A ripe crop still reads `READY` and is never labelled dry,
which is the same "ripe is never paused" rule the server keeps.

**Verified in the browser** (headless Chromium, screenshots): four plots
tilled, two planted, one watered — grass / brown / lilac render as three
distinct states in one frame; moving the page clock five hours forward reverts
the wet tile to dry *with no poll*, ripens the watered leek, and leaves the
unwatered one still at stage 0, which is the pause made visible. Hovering each
shows the live countdown on the wet plot and `DRY · 45m 0s` frozen on the dry
one. (Aside for whoever does art polish: `#767ede` reads more "shallow water"
than "damp earth" at flat fill. It is the pack's own sampled wet-band colour
from T-7.05, so it is left alone here.)

**Break tests, each confirmed failing then reverted:** soil from `isWet` (8);
growth not truncated at `wetUntil` (7); stage from the config duration (1,
after the test that pins it was added — 0 before, which is why it was added);
`isPaused` computed as "not wet" rather than from growth (2, including the ripe
case); `tilled` derived from a crop being present (1).

`pnpm -r typecheck` and `pnpm test` are green: 848 tests (76 shared + 93 client
+ 62 mapmaker + 617 server).

### T-9.05 — Trees  ✅ **DONE**
Depends: T-7.07 · Size: S
Files: `apps/client/src/game/scenes/Farm.ts`, `packages/shared/src/config/assets.ts`
**Do:** Maple trees from the map's object layer render with the pack's
animated maple frames (gentle sway loop). Decorative only — no chopping until
post-MVP.
**Done:**
- [x] Trees animate; depth-sort correctly against the character (existing
      `DEPTH.world + y` convention)

**How it turned out — there is no sway, so the trees drop leaves instead.**
The plan called for "the pack's animated maple frames (gentle sway loop)", and
measuring the sheet found no sway in it. Differencing the four columns of every
row: the leaf columns add ~27 pixels in previously transparent space and
recolour **zero** pixels of the tree. The canopy and trunk are byte-identical
in every frame. What the pack animates is leaves coming off the tree, so that
is what plays — a slow 3-frame loop at 2fps. (Same shape of correction as
T-7.05's "autotile blocks": the geometry in the old note was right, the
*usability* was assumed.)

**Column 1 is a white silhouette, not a shadow.** The manifest note claimed a
shadow column; it is the tree with its canopy filled solid white — five
distinct colours in the entire frame. Playing it would strobe each tree white
twice a second. `MAPLE_TREE.animColumns` is `[0, 2, 3]` and a test names the
excluded column rather than leaving it as "the ones we happened to pick".

**The swap is safe because the two sheets agree pixel for pixel.** The map
places `OBJ_MAPLE_TREE` frame 2; the client draws from `OBJ_MAPLE_TREE_ANIM`
row 0 instead. Those are the same 1536 pixels — verified by exact comparison,
zero differences — so the authored layout is untouched and only the leaves are
new. That equality is the load-bearing fact of the whole task, which is why it
is checked rather than eyeballed.

**`scripts/measure-maple.mjs` is the evidence, and it re-runs.** Following
`measure-character.mjs`'s precedent: findings become constants in `assets.ts`
with a config test on the arithmetic (indices in range, all from one row,
silhouette excluded), and the script checks the part a unit test cannot — the
actual pixels. It **reads `MAPLE_TREE` out of `assets.ts` rather than restating
it**, so it fails when the constants drift; a second copy of the numbers in the
checker would be a copy that goes stale silently. Exits non-zero, so it is also
a guard for a future pack update.

**Two false claims in the codebase were corrected, not left.** The manifest
described the still sheet as "season colour variants and stumps/acorns, not a
simple growth sequence" — row 0 is in fact sprout → sapling → young tree, then
colour variants. And `landing.ts` called frame 2 `MAPLE_TREE_MATURE_FRAME`,
which is the *young* maple; it now takes `MAPLE_TREE.stillFrame` from config,
so the number exists once and the name is true. No pixels changed on the
landing page.

**Trees are their own tiny entity** (`entities/Tree.ts`) rather than more code
in `buildMapObjects`, matching `Animal.ts`'s pattern down to the
`anims.exists` guard — Phaser's animation manager belongs to the game, not the
scene, so a restart would throw on the duplicate key. Each tree starts on a
random frame; three maples shedding in lockstep reads as a rendering artefact
rather than as weather.

**Verified in the browser**: screenshots 700ms apart show identical canopies
with the loose leaves in different positions (332 differing pixels, clustered
around the three trees). For depth, the character walked up to the south-east
maple — standing south of its base it draws over the trunk, standing north of
it the canopy hides everything below the character's shoulders. The rule was
already right (`DEPTH.world + bottom edge`, shared with `Player.ts`); this
confirms swapping the sheet did not disturb it.

**Break tests, each confirmed failing then reverted:** adding column 1 to the
loop (2 config-test failures, plus the measure script reporting the silhouette
in 7 rows); pointing `animRow` at the mature-orange row (1 config-test failure,
and the script exits 1 with "still frame 2 is not anim row 3").

`pnpm -r typecheck` and `pnpm test` are green: 852 tests (80 shared + 93 client
+ 62 mapmaker + 617 server). `house.integration.test.ts`'s race test flaked
once in the parallel run and passed on its own — the same unrelated
concurrency test noted in T-8.02, T-8.04 and T-9.03a.

### T-9.06 — Action dispatch (the controls come together)  ✅ **DONE**
Depends: T-9.03b, T-8.05, T-8.07, T-8.09 · Size: M
Files: `apps/client/src/game/scenes/Farm.ts`, `apps/client/src/game/actions.ts`
(new, pure dispatch logic + test), `apps/client/src/game/hud.ts`
**Do:** Action key (E / Space / click) routes by equipped hotbar item + the
faced tile: hoe on an unlocked untilled empty plot → till intent; watering
can on a planted plot → water intent; seeds on a tilled empty plot → plant
intent (crop from the seed item); empty hand on a ripe crop → harvest intent.
Wrong tool/target → local toast, nothing sent (client-side UX gate; the
server still validates everything). Plays the T-8.09 animation on send.
Remove the old click-to-act plot handlers and the HUD seed-picker rail
(seeds now live in the hotbar). Keep the 20s poll + reconciliation exactly
as-is; optimistic predictions may be dropped (poll is authoritative).
**Done:**
- [x] Full manual loop works end-to-end: till → plant → water → wait →
      harvest, all via character + tools
- [x] Pure dispatch function unit-tested (equipped × tile-state matrix)
- [x] Old seed picker and click-to-plant fully removed

**How it turned out.** `actions.ts` (109 lines, 23 tests) decides what the
action key sends; the scene is the plumbing around it. **Phase 9's loop is
playable**: hoe → seeds → can → empty hands, on the tile the character faces.

**The dispatch answers three things, not two.** `nothing`, `refused(message)`
and an intent. The silent case is the one worth defending: the character faces
open ground for most of the time it is moving, so a toast on every press there
would teach the player to ignore toasts — including the ones that matter. When
there IS a plot and it cannot be worked, the message is always the blocking
fact closest to them ("Something is already growing there"), never the first
rule that happens to fail, which is why the plot's state is checked before the
item in hand.

**Tools declare what they are; ids are never parsed.** `ItemDef` gained
`toolKind` (`ToolKind.HOE` / `WATERING_CAN`). Matching `itemId.startsWith('hoe')`
was written first and thrown away: D-4 adds eight more tiers, and a control
scheme that reads ids keeps working right up until someone names one
differently. `cropForSeed` joined `crops.ts` for the same reason — the seed →
crop mapping is config both sides may need, not a client lookup.

**Optimistic predictions are gone, and the swing replaced them.** `predictPlant`
and `predictHarvest` were deleted with their suites. Four intents would have
meant four guesses — soil, wetness, growth, produce — and four chances to draw
something the server then contradicts. The tool animation starts before the
request and runs ~600ms, which is far longer than the round trip, so the plot
changes under a swing that is already playing. It covers the latency *honestly*:
nothing is drawn until the server says it happened. The swing doubles as the
cooldown — `act()` refuses while `isSwinging`, so a held key cannot queue a
backlog.

**Planting and harvesting play no animation, deliberately.** `swingFor` returns
null for both. The pack ships hoe and watering strips and nothing for kneeling
or picking (T-8.09 measured what exists), and a hoe swing on a plant would be a
lie about what happened.

**Two mouse paths survived, and both are narrower than what they replace.**
Clicking a **locked** plot still buys it: that is the one action here that
spends gold, and putting it on the key the player taps a hundred times an hour
would eventually buy a plot by accident. Clicking the **faced** tile is the
action key by another name. Clicking any other plot now does nothing — the
cursor stops promising a pointer over those, since a pointer over a plot the
character cannot reach is an offer the game no longer honours.

**`addKey('KeyE')` binds nothing and fails silently.** Phaser wants its own
`KeyCodes.E`, not the DOM `event.code` string the hotbar matches on. The first
browser run did nothing at all with no error anywhere, which is exactly how
that mistake presents; the constant now carries the warning. T-8.09's dev-only
Z/X swing keys were removed in the same change — their comment said "until
T-9.06 gives the action key real intents to send", and it does.

**Harvest follows what the player can SEE.** The gate takes `isRipe` from the
client's own interpolation, not from the last poll, so a crop whose countdown
visibly finished can be picked immediately instead of being refused for up to
twenty seconds. The browser check caught the flip side of this: ripening a crop
directly in the database is invisible to the client until the next poll, and it
correctly refused the harvest until then.

**Verified in the browser, entirely through key presses** — the script sends no
mutating request of its own. `(9,10)` walked through
`T--- → TC-- (paused, dry) → TCW- → TCWR → T---`, with "Planted Leek." and
"Harvested 1 × Leek." toasts, a leek in the bag and the seed stack down from 4
to 3. The hoe on a growing crop toasted "Something is already growing there."
and left the plot untouched — the refusal really does send nothing. Separately:
clicking a locked plot bought it (6 → 7 plots, 250g), clicking the faced tile
tilled it, and clicking a distant plot did nothing.

**Break tests, each confirmed failing then reverted:** dropping the locked-plot
check (1); allowing harvest with something in hand (1); checking the soil before
the crop, so a hoe is offered over a growing plant (1); swinging the hoe on a
plant (1); making refusals silent (8).

`pnpm -r typecheck` and `pnpm test` are green: 868 tests (82 shared + 107 client
+ 62 mapmaker + 617 server).

---

# Phase 10 — Inventory v2: Stardew panel, backpack tiers

### T-10.01 — Chest rearrange (server)  ✅ **DONE**
Depends: — · Size: S
Files: `apps/server/src/modules/inventory/service.ts`, `routes.ts`,
`packages/shared/src/schemas/index.ts`, inventory tests
**Do:** `moveSlots` takes a `container` param (`'inventory' | 'chest'`,
default `'inventory'` for compatibility); `/api/inventory/move` schema gains
it. Capacity check uses the right container's capacity.
**Done:**
- [x] Chest move/merge/swap tested (mirror the bag cases) + break-tested
- [x] Bag behaviour unchanged (existing tests untouched and green)

**How it turned out.** Small, because `moveItem` already took a container —
T-3.01 built it that way and only `moveSlots` had the bag hardcoded. The change
is one parameter threaded through three places, plus 10 tests.

**The capacity is the point, and at tier 0 it is invisible.** Bag and chest both
start at 24 slots, so every chest test would pass against the bag's capacity by
coincidence. The test that actually pins this buys a **tier-1 chest** (48
slots) and moves into slot 30: real storage in the chest, imaginary in the bag.
Checking it against the bag's cap refuses a slot the player has paid for, and
that is now one failing test rather than a bug report later.

**The answer says which container it is.** `moveSlots` echoes `container` back
alongside the slots. T-10.04 puts the chest and the bag on screen together, and
a response that is just "here are some slots" is one a client can apply to the
wrong grid — the request said which, so the answer should too.

**The schema defaults to `inventory`.** Additive, so the existing client keeps
working untouched, which is what let the whole bag suite stay byte-identical.
`containerSchema` is exported for T-10.02 to build its `{from, to}` form on, so
the two containers are named in one place and match the `container` column.

**Break tests, each confirmed failing then reverted:** capacity always the bag's
(1 — the tier-1 test); the move applied to the bag whatever was asked (6);
the answer always showing the bag (1); the route dropping the container (6).
The bag block was untouched throughout and stayed green in all four.

`pnpm -r typecheck` and `pnpm test` are green: 878 tests (82 shared + 107 client
+ 62 mapmaker + 627 server).

### T-10.02 — Cross-container slot move (server)  ✅ **DONE**
Depends: T-10.01 · Size: M
Files: same as T-10.01, plus `apps/server/src/modules/inventory/chest.ts`
(`lockBothContainers` reuse)
**Do:** Extend the move schema to `{from: {container, slot}, to: {container,
slot}}` (keep the old flat shape working via zod union or migrate the client
in the same task). When containers differ: lock both via
`lockBothContainers`, then apply the same move/merge/swap semantics across
them, validating each side against its own capacity.
**Done:**
- [x] Cross moves: to empty, merge same item (stack-limit remainder stays),
      swap different items — tested + break-tested
- [x] Same-container behaviour byte-identical to before

**How it turned out.** `{from: {container, slot}, to: {container, slot}}`,
`moveAcross` beside `moveItem`, and 15 new tests. The client moved to the new
shape in the same change.

**The flat shape is gone rather than kept as a skin.** The roadmap allowed a
zod union; the only caller of `/inventory/move` is this repo's own client, and
a legacy shape whose sole user has already migrated is a second contract kept
working for nobody. Keeping it would also have meant the *shipped* path was the
compatibility path and the real one existed only in tests.

**Byte-identical is structural, not a promise.** `moveItem` keeps its exact
signature, so `service.test.ts` — 24 call sites, the real semantic suite — is
untouched and green. `moveSlots` routes same-container drags to it unchanged;
only differing containers reach `moveAcross`.

**`planMove` is the anti-drift move.** What a drag DOES (move / merge with the
remainder staying / swap) is now one pure function both writers call. They
write different columns — one changes a slot index, the other a container too —
but they cannot disagree about whether a drop merges or swaps, which is the
thing that would have rotted. `mergeInto` is shared for the same reason: break
test 4 (always deleting the source) failed on both paths at once, which is what
sharing it buys.

**Both containers come back on every drag**, even a bag→bag one. The panel
T-10.04 builds shows the chest above the backpack; an answer covering one grid
leaves the other to be re-fetched or replayed locally, and replaying is how the
two stop agreeing (§4.1). Named `bag`/`chest` to match `TransferResult`, which
already had exactly this shape.

**`lockBothContainers` moved from `chest.ts` into `service.ts`.** The
cross-container move became its second caller; it is about inventory rows, so
it belongs beside `lockContainer` rather than in the module that happened to
need it first. It is taken **before** either container is read — locking them
one at a time is the lock-order inversion it exists to prevent.

**The lock's break test needed 12 concurrent drags, and finding that mattered.**
Six alternating drags of the same two stacks caught the missing lock only 1 run
in 4; twelve fails 5 out of 5, and passes 5 out of 5 with the lock in place. A
guard that fails a quarter of the time is not a guard. The failure it exposes is
also worse than expected: 15 units out of 10 — unlocked reads **duplicate**
items, they do not merely lose them.

**Break tests, each confirmed failing then reverted:** the cross move not
changing the `container` column (3); both ends checked against the source's
capacity (1); the swap deleting the destination instead of moving it back (3);
the merge always deleting the source, so the remainder is discarded (4, across
both writers and `service.test.ts`); removing `lockBothContainers` (1, the
concurrency test, 5/5).

**Verified in the browser:** the bag panel still rearranges through the new
contract — hoe dragged from slot 0 to slot 8, no console errors.

`pnpm -r typecheck` and `pnpm test` are green: 889 tests (82 shared + 107 client
+ 62 mapmaker + 638 server).

### T-10.03 — Backpack tiers  ✅ **DONE**
Depends: — · Size: M
Files: `apps/server/src/db/schema.ts` (+ migration),
`packages/shared/src/config/economy.ts`, `apps/server/src/modules/inventory/service.ts`
(`capacityFor`), `apps/server/src/modules/shop/{service,routes}.ts`,
`packages/shared/src/schemas/index.ts`, tests
**Do:** `players.backpack_tier` int NOT NULL default 0. `BACKPACK_TIERS = [
{tier 0, 12 slots, cost 0}, {tier 1, 24, 2_000}, {tier 2, 36, 10_000}]`.
Inventory capacity = backpack tier slots + VIP bonus — **house-tier inventory
bonus removed** (house keeps its animal-cap bonus until T-12.02 replaces
that too; update `HOUSE_TIERS` comments + the affected capacity tests).
`POST /api/shop/backpack` buys the next tier (reuse the
`upgrades.ts` primitives: lock, afford, charge — same as chest tiers).
`STARTING_ITEMS` must fit in 12 slots (they do: 2 seed stacks + 2 tools).
**Done:**
- [x] Capacity math tests updated; over-capacity rendering path
      (`is-over-capacity`) still works for VIP-lapse
- [x] Purchase: happy, insufficient gold, already-max, idempotent replay,
      race (two concurrent buys charge once) — all tested
- [x] New-player capacity is 12

**How it turned out.** `players.backpack_tier`, `BACKPACK_TIERS` (12 → 24 → 36),
`POST /api/shop/backpack`, and the house out of the bag business entirely. A new
player carries 12 slots — exactly `HOTBAR_SLOTS`, so the whole starting backpack
is the strip along the bottom of the screen and the first upgrade is what
introduces the idea of a bag deeper than the hand can reach.

**The tier is on `players`, not `farms`, and that pays for itself twice.** The
backpack is carried rather than built, and the player row is already loaded by
the session — so `capacityForPlayer` now answers bag capacity with **no query
at all**, where it used to read the farm. The chest still reads the farm, and
only when the chest is what was asked for.

**The house lost its inventory bonus, including in its own view.**
`HOUSE_TIERS.bonusInventorySlots` is gone and `HouseView` no longer reports
`inventorySlots`/`nextInventorySlots` — a tier that advertises slots it does not
grant is worse than one that promises nothing. Its old capacity test was
inverted rather than deleted: "raises inventory capacity" became "does NOT raise
inventory capacity", so the independence is asserted rather than merely no
longer contradicted.

**The stale-snapshot bug, and why the obvious test could not catch it.**
`upgradeBackpack` must read the current tier from the LOCKED player row, never
from `player.backpackTier` — the session snapshot predates the transaction, and
a concurrent purchase can have moved the tier since, so the second buy pays full
price for a tier already owned. Over HTTP this is untestable: every request
re-reads the session, so a sequential second request always sees the new tier,
and the concurrent version passed 2 runs in 3. Two fixes, both kept:
1. **Structural.** `lockForUpgrade` now returns `backpackTier` alongside the
   gold, from the same locked read. The right value is simply what the context
   hands you, so reaching for the snapshot takes deliberate effort.
2. **Deterministic.** `backpack.test.ts` calls the service twice inside ONE
   transaction with the same player object — which is exactly what two
   concurrent requests hold — and asserts the second purchase is priced as
   tier 2. Reverting to the snapshot fails it 3 runs out of 3.

**Break tests, each confirmed failing then reverted:** the tier read from the
session snapshot (2, deterministic); the charge skipped (3); the house adding
bag slots again (1 — the "ignores the house entirely" test); capacity ignoring
the purchased tier (6). The HTTP race test funds exactly one tier and fires
three buys, mirroring the house's: exactly one 200, gold 0.

**Verified in the browser** for the VIP-lapse path the Done list calls out: a
new player shows 12 slots, 24 with VIP; with items parked in slots 15 and 20,
letting VIP lapse leaves capacity at 12 and the panel draws 21 cells — 9 of them
marked `is-over-capacity`, with both stranded stacks still visible and
takeable. Capacity limits what goes in, never what can be seen or taken out.

`docs/economy.md` gained the new sink (§5.8 — an idle economy dies from unlogged
faucets, and the same goes for sinks): 12,000g for both tiers, lifetime sink now
359,330g, and the house row corrected.

**Not done here, on purpose:** nothing in the client sells a backpack yet. The
shop panel is rebuilt as the in-world merchant in T-11.04, and adding a button
to the panel that task replaces would be work done twice.

`pnpm -r typecheck` and `pnpm test` are green: 904 tests (82 shared + 107 client
+ 62 mapmaker + 653 server).

### T-10.04a — Stardew inventory panel: layout  ✅ **DONE**
Depends: T-10.03 · Size: M
Files: `apps/client/src/game/inventoryPanel.ts` (rewrite),
`apps/client/src/game/hud.ts`, `apps/client/src/styles/hud.css`; delete
`apps/client/src/game/chestPanel.ts` usage (keep transfer API wrapper)
**Do:** One panel replacing bag+chest panels: **chest grid on top, backpack
grid at the bottom**, backpack's first row (hotbar slots 0–11) visually
distinguished. Styled with `UI/Inventory/Book.png` / `Slots.png` as
pixelated CSS backgrounds. The chest section renders only when opened at the
chest (T-10.05); the Bag key/button opens backpack-only. Chest upgrade button
moves into the chest section header.
**Done:**
- [x] Both grids render with pack art; hotbar row marked; capacity counts
      correct for both containers
- [x] Old chestPanel deleted; typecheck green

**How it turned out.** One `.pack` panel: chest section on top, backpack
underneath, both drawn with the pack's own slot art. `chestPanel.ts` is
deleted (244 lines) and `inventoryPanel.ts` rewritten; the net change is
smaller than what it replaced.

**A slot now behaves the same wherever it is.** The two old panels disagreed
about what a click meant — "pick this up" in the bag, "send the whole stack
across" in the chest — which is the kind of thing you only notice is wrong when
both grids are on screen at once. Every cell is now pick-up-and-place or drag,
in either container. (Dragging ACROSS the two is T-10.04b; the plumbing is
already container-aware, so what is left there is the HTML5 half and the
hotbar sync.)

**`Book.png` is deliberately not the panel's background, and that is a
measurement, not a preference.** The plan called for it. It is a fixed-size
**landscape open book** — two pages side by side, a spine down the middle, gilt
corners that cannot repeat — and the layout this task asks for is two grids
stacked vertically at whatever size the tiers make them. Backing that with the
book means stretching pixel art or cropping a page and losing its border. What
the panel takes from it instead is its palette, sampled from the file: page
`#f7dbc6`, cover `#4a2123`, gilt `#ae4924`. The *cells* are real pack art —
`ui-inventory-slots.png`, the same measured 18px squares the hotbar uses
(T-8.07), so the panel and the strip along the bottom of the screen are
visibly the same game.

**The grid is exactly `HOTBAR_SLOTS` columns wide**, which is what makes "the
first row is your hotbar" true rather than approximately true: at tier 0 the
whole backpack is that one row, and at tier 1 it is 24 slots in two rows with
only the first marked (verified: 24 cells, 12 marked, all in row one).

**A `position: sticky` header painted a black band over the game.** The panel
header was sticky; over the WebGL canvas Chromium promoted it to its own layer
and filled a 694×32 rectangle above the hotbar with solid black — visible in
the game, not only in screenshots. It took a while to find because it is
invisible to `elementFromPoint` (nothing DOM is there), absent from every
scene's display list (nothing Phaser is there), and survives a forced repaint.
What identified it was that the shop and trade panels — untouched, and not
sticky — do not do it. The header does not need to be pinned: twelve columns is
not a wide panel, and a deep chest scrolls its own section. The reason is
recorded above the rule so it does not get added back.

**Verified in the browser:** Bag opens the backpack alone (12 cells, 12 marked,
`4 / 12`, chest section absent); Chest opens both with the chest above the
backpack (`2 / 24` and `4 / 12`, the two stored stacks in the right chest
slots, "Enlarge — 2,000g" in the chest header and correctly disabled at 500g);
cells carry the slot sheet as their background; the grid computes 12 columns.

`pnpm -r typecheck` and `pnpm test` are green: 904 tests (82 shared + 107 client
+ 62 mapmaker + 653 server) — unchanged, since this task moved DOM and CSS
rather than rules.

### T-10.04b — Drag-and-drop everywhere  ✅ **DONE**
Depends: T-10.04a, T-10.02 · Size: M
Files: `apps/client/src/game/inventoryPanel.ts`, `apps/client/src/game/slotGrid.ts`,
`apps/client/src/net/inventory.ts`
**Do:** HTML5 drag-and-drop plus click-pick-up fallback (port both from the
old panels) across all four directions: within backpack, within chest,
backpack↔chest — all through the v2 move endpoint (slot→slot; the old
item+qty `transfer` stays for programmatic use but the UI stops using it).
Server response re-renders both grids; no local replay.
**Done:**
- [x] All four drag directions work incl. merge and swap outcomes
- [x] Hotbar reflects backpack row 0 changes instantly

**How it turned out — most of it already worked, so the task became finding
what did not.** T-10.04a's cells were written container-aware (each carries a
`{container, slot}` reference through the drag payload), so all four directions
went through the v2 endpoint on the first try. Rather than tick the boxes on
that, the time went into the edges around it.

**Verified by driving real drags, not by reading the code** (headless Chromium,
`page.dragAndDrop`, which dispatches the browser's own drag events): backpack →
empty backpack slot moves; chest → chest swaps two different items; backpack →
chest merges into a 995 stack and leaves the 6 that did not fit behind; chest →
backpack swaps across the two. The click-pick-up fallback carries across
containers too, with the highlight showing. And the hotbar strip follows
backpack row 0 with no reload — `0:Leek ×5` becomes `4:Leek ×5` the moment the
drag lands, because the panel hands the server's answer to the HUD rather than
re-fetching.

**A cancelled drag used to leave a cell lit.** `dragleave` clears the drop
highlight, but a drag cancelled with Escape — or let go over nothing — fires
only `dragend`, on the SOURCE, so whichever cell was last hovered stayed
highlighted with no drag in progress. `dragend` now clears every highlight in
both grids. (One lit during the drag, zero after the cancel — asserted in the
browser, since this is a DOM-event ordering question that a unit test would be
mocking rather than exercising.)

**A grid accepts drops from anywhere, and now says no to them.** The browser
will deliver a file from the desktop, a link from another tab or a paragraph of
selected text to a cell as a `drop` with a `text/plain` payload the panel never
wrote. `parseRef` is the boundary; it is exported and tested, because "can
something the panel did not write become a move request" is a question worth
answering with assertions. Dropping a link onto a slot in the running game
changes nothing.

**The test found a real gap while being written: `-1` was accepted.** A
negative index is not merely out of range — **-1 is where the server's swap
parks a row mid-transaction** (`moveItem`/`moveAcross`), so it is precisely the
index that must never arrive in a payload. How MANY slots the player owns stays
the server's business, since capacity depends on tiers and VIP and a client
deciding for itself would be a second answer to what they own (§4.1); a
9,999 index is passed along and refused there. Negatives are refused here.

**Break tests, each confirmed failing then reverted:** trusting the dropped
container string (1); dropping the whole-number check so a link's fields would
pass (2).

`pnpm -r typecheck` and `pnpm test` are green: 909 tests (82 shared + 112 client
+ 62 mapmaker + 653 server).

### T-10.05 — World-object opening  ✅ **DONE**
Depends: T-10.04a, T-8.05 · Size: S
Files: `apps/client/src/game/scenes/Farm.ts`, `apps/client/src/game/actions.ts`
**Do:** Action key facing the chest map-object opens the full panel (chest +
backpack); facing nothing relevant with a non-tool equipped does nothing. HUD
keeps a Bag button (backpack-only view) and `I`/`Tab` as shortcut. Remove
the HUD Chest button.
**Done:**
- [x] Chest only opens at the chest; Escape closes; Bag view never shows the
      chest grid

**How it turned out.** The chest opens by standing at it and pressing the
action key. The HUD's Chest button is gone; Bag stays, with `I` and `Tab` as
shortcuts to the same backpack-only view.

**`Target` became a union, and that is the real change.** It was
`{view, isRipe}` — a plot, always. The faced tile is exactly ONE thing, so it
is now `{kind: 'plot', …} | {kind: 'chest'}`. Passing the chest as a second
parameter alongside the plot would have made "a plot that is also the chest"
expressible, and then every caller has to decide which wins. The whole control
scheme stays in one tested function.

**Opening is not a `FarmIntent`, and the type says so.** `{kind: 'open'}` is
its own arm: nothing is sent, nothing is validated, no swing plays. Standing
next to the box is UX — what is IN the chest is guarded by the inventory
endpoints on their own terms, so the position never leaves the browser (§5.1).
A break test that made opening answer as a `harvest` fails.

**The chest opens whatever is in hand.** Refusing while holding a hoe would be
a rule with nothing behind it: the panel is a view of two containers, not an
action on the world. Break-tested — restricting it to empty hands fails two
tests.

**The chest's tiles come from the authored map, not a constant.** The scene
records which tiles the chest object covers while it is placing map objects.
Writing `(8,10)` down in config would be a second copy of a position the map
editor owns, stale the first time someone drags the chest somewhere else (§9).
The subtlety is that Tiled anchors a tile-object to its BOTTOM-left corner, so
the rows run UP from `object.y` — the same convention `buildMapObjects` already
draws with; getting it backwards puts the interactable tiles an object-height
below the art, which looks fine until nobody can open anything.

**Closed now means closed.** `hide()` also drops the chest half, so a hidden
panel does not sit there claiming to show a chest, and walking away and pressing
Bag can never flash the chest's grid. Found by reading the verification output
rather than the code — the panel was closed and correct on screen, but its DOM
still said `chestVisible: true`.

**Verified in the browser**: the HUD bar reads `Bag, Shop, Trade, …` with no
Chest button; Bag, `I` and `Tab` each open the backpack alone; Escape closes;
the action key on open ground does nothing; walking north to the chest and
pressing it opens the panel titled Chest with both grids; **standing on the same
tile but facing away leaves it shut**; and opening Bag afterwards shows the
backpack alone again.

`pnpm -r typecheck` and `pnpm test` are green: 912 tests (82 shared + 115 client
+ 62 mapmaker + 653 server).

---

# Phase 11 — Selling surfaces and UI cleanup

### T-11.01 — Shipments table  ✅ **DONE**
Depends: — · Size: S
Files: `apps/server/src/db/schema.ts` (+ migration)
**Do:** `shipments(id uuid PK, player_id → players cascade, item_id text,
quantity int, deposited_at bigint, paid_at bigint null, payout int null)`
+ index on player_id. `payout` records what was actually credited (price at
settlement time), for the ledger.
**Done:**
- [x] Migration applies; schema comments explain settle-on-read

**How it turned out.** The table, the index, and the comments that say why the
columns are shaped this way — `0008_smiling_yellowjacket.sql`.

**`paid_at` is the exactly-once guard, and the comment says so** because
T-11.02 depends on it. Settlement will be a single UPDATE whose WHERE clause
requires `paid_at IS NULL`; two concurrent reads cannot both credit a row,
because the second matches nothing. There is no separate "already paid?" check
to forget — the write IS the check (the v1 T-5.04 pattern).

**`payout` records what was actually credited, not what the item is worth
today.** Prices are config and config moves; a ledger that recomputed value
would quietly rewrite history, and §5.8 wants every faucet accounted for by
what it actually paid.

**Verified against an EMPTY database, not just the one already migrated.**
CLAUDE.md's migrations note asks for exactly that, and an incremental apply
proves nothing about a fresh clone: created `tillhaven_migcheck`, ran all eight
migrations from zero, confirmed 14 tables and the shipments columns/index/FK,
dropped it.

**`resetDb()` no longer keeps a hand-written list of tables.** It listed them
literally, so a new table was one somebody had to remember to add — and rows
that survive a reset leak into the next test and fail it somewhere else
entirely. `shipments` was going to be the third such table, so the helper now
asks `pg_tables` for the `public` schema instead (order does not matter,
`cascade` handles the keys) and throws if it finds none, since an empty list
would make the reset a silent no-op. Not strictly this task's scope, but the
alternative was writing T-11.02's tests on top of a table nobody truncates.

`pnpm -r typecheck` and `pnpm test` are green: 912 tests (82 shared + 115 client
+ 62 mapmaker + 653 server) — unchanged, since this task adds storage rather
than behaviour.

### T-11.02 — Shipping box service  ✅ **DONE**
Depends: T-11.01 · Size: M
Files: `apps/server/src/modules/shipping/{service,routes}.ts` (new module),
`packages/shared/src/schemas/index.ts`, `packages/shared/src/config/economy.ts`
(`SHIPPING_PAYOUT_MS`, e.g. 10 min), `apps/server/src/app.ts`, tests
**Do:** `POST /api/shipping/deposit` (itemId, quantity, key): item must be
sellable (`shopSellPrice !== null`, else `ITEM_NOT_SELLABLE`); removes from
backpack, inserts a shipment row. Settlement on read: `GET /api/shipping`
(and the farm-state read via a shared `settleShipments(tx, playerId, now)`)
credits every row with `paid_at IS NULL AND deposited_at + SHIPPING_PAYOUT_MS
≤ now` — the UPDATE's own WHERE clause is the idempotency guard (v1 T-5.04
pattern), `payout = quantity × shopSellPrice`, gold credited in the same
transaction. Response lists pending (with `paysOutInMs`) and recently paid.
**Done:**
- [x] Deposit: happy, unsellable item, insufficient items, idempotent
- [x] Settlement: exactly-once under concurrent reads (break-test the WHERE
      guard), correct payout, gold credited atomically
- [x] Depositing tools impossible (they're unsellable — asserted)

**How it turned out.** A `shipping` module, `SHIPPING_PAYOUT_MS = 10 min`, and
21 tests. Deposit takes the items and writes a row; nothing is credited until
somebody looks.

**Tools are undepositable because they are unsellable**, not because anything
here knows what a tool is. The deposit uses the merchant's own rule
(`shopSellPrice === null` → `ITEM_NOT_SELLABLE`), so there is no "tools are
special" branch to forget. The test walks **every** tool in the game and
asserts both halves — no sell price, and refused — so a future tool cannot
arrive with a price by accident.

**The break test that mattered could not be written over HTTP.** Removing the
`AND paid_at IS NULL` guard from the settlement UPDATE left all 18 endpoint
tests green, including eight concurrent `GET /api/shipping` calls: they
serialize enough that the second SELECT sees the committed row and skips it, so
the guard is never reached. `settlement.test.ts` opens **two transactions by
hand** — the first settles and is then held open, uncommitted, while the second
selects — which is the interleaving that actually exists. At READ COMMITTED the
second UPDATE blocks on the row lock and then re-evaluates its WHERE against
the committed row, and that re-evaluation is the entire mechanism. Deleting the
guard now fails it 3 runs out of 3, with the gold doubled.

**The hot path cost three round trips and now costs one.** Settling on the farm
poll is what makes an offline player's gold arrive while they stand in their
field rather than when they walk to the box — but a transaction that settles
nothing still pays for a BEGIN and a COMMIT, and nothing is due on almost every
poll. `hasDueShipments` is one indexed lookup with no transaction; the
transaction only opens when it says yes. `farm.queries.test.ts` went from
pinning five queries to pinning **six**, with a second test pinning that the
settling path is the rare one — so the cheap case cannot quietly acquire the
transaction's cost later.

**`docs.test.ts` caught the ledger before I did.** It asserts that every file
writing player gold is named in `docs/economy.md`, and the new module was not.
The box is recorded as a faucet that **changes when gold arrives, never how
much** — it pays the merchant's price, moved ten minutes into the future.

**Break tests, each confirmed failing then reverted:** the `paid_at` guard (1,
deterministic, ×3); crediting gold outside the settlement transaction (1 — the
rollback test); dropping the due filter so a deposit pays instantly (4);
allowing unsellable items in (2).

`pnpm -r typecheck` and `pnpm test` are green: 934 tests (82 shared + 115 client
+ 62 mapmaker + 675 server).

### T-11.03 — Shipping box client  ✅ **DONE**
Depends: T-11.02, T-10.05 · Size: S
Files: `apps/client/src/game/shippingPanel.ts` (new),
`apps/client/src/net/shipping.ts` (new), `apps/client/src/game/actions.ts`,
`apps/client/src/styles/hud.css`
**Do:** Action key at the shipping-box object opens a small panel: click an
item in the backpack list to deposit (quantity input), pending shipments
with countdowns, recent payouts. Toast when a sync brings settled gold.
**Done:**
- [x] Deposit → countdown → payout visible end-to-end against a dev
      `SHIPPING_PAYOUT_MS` note in the write-up

**How it turned out.** A panel that opens at the box: what you can ship, what is
waiting with a live countdown, what it paid. Verified end to end in the browser
— shipped 4 leeks, watched `10m 00s` tick down, backdated the row by
`SHIPPING_PAYOUT_MS + 1s` (the same one-timestamp trick the integration tests
use, since the real wait is ten minutes), re-opened, and saw
`Leek ×4 +140g`, gold 500 → 640, and the toast.

**Finding the box took longer than building the panel, because it was not
there.** `fromGid` returned null for the shipping box, so `buildMapObjects` had
been skipping it — with a `console.warn` nobody reads — since **T-8.03 moved
the character strips out of `SHEETS`**. That shifted every later `firstgid` by
40, and `farm.json` keeps the numbers it was authored with: 16 of its 39
tilesets had drifted. The farm still looked right because tile LAYERS resolve
through the map's own tileset table; only the object layer went through the
manifest.

Fixed at both ends, deliberately:

1. **The reader.** `Farm.ts` now resolves an object through the map's own
   tileset table (`locateInMap`) instead of the manifest's global allocation.
   A Tiled map carries that table precisely so it can be read on its own terms,
   and the editor writes `name: run.key`, so the name IS the texture key —
   `buildMap` already relied on that. Drift can no longer make an object vanish.
2. **The data.** `generate-farm.ts` re-authored the map with today's gids;
   `verify-farm.ts` goes from **16 warnings to 0**. Regenerating would have
   silently undone T-9.04 — the generator still stamped plot cells with
   dry-tilled soil — so the generator was corrected first, and the regenerated
   map is cell-for-cell identical to the old one by tileset:frame (0 differing
   cells in both layers, same objects, same 20 plots). The map's design lives
   in the generator, not in the JSON.

**`shippingPaid` on the farm state, and why it belongs there.** The ten minutes
almost always run out while the player is standing in a field, so the poll is
what settles the box — and a balance that changes in the corner of the screen
with nothing to explain it is worse than no notification. The response reports
what THAT request credited; the HUD says it out loud. 0 on almost every poll.

**Unsellable items are simply absent from the ship list.** Not shown and
refused: the server would answer `ITEM_NOT_SELLABLE`, and a row that exists only
to say no should not be a row. Tools disappear for free, because they have no
sell price.

**Countdowns tick locally, from the moment the view was read** — `paysOutInMs`
is measured against that response, so subtracting elapsed time is exact until
the next read corrects it. A row whose countdown reaches zero says `selling…`
rather than claiming a payout: settlement happens on the next read, and the
panel does not get to decide it has.

`pnpm -r typecheck` and `pnpm test` are green: 934 tests (82 shared + 115 client
+ 62 mapmaker + 675 server).

### T-11.04 — Merchant in the world  ✅ **DONE**
Depends: T-10.05 · Size: S
Files: `apps/client/src/game/scenes/Farm.ts`, `apps/client/src/game/actions.ts`,
`apps/client/src/game/shopPanel.ts`, `packages/shared/src/config/assets.ts`
**Do:** A merchant stand/NPC object on the map (pick art:
`Objects/Exterior/Newsstand.png` or an NPC sheet); action key facing it opens
the existing shop panel; HUD Shop button removed. Add the backpack upgrade
as a line in the shop UI (calls `POST /api/shop/backpack`).
**Done:**
- [x] Shop only opens at the merchant; backpack upgrade purchasable from it
- [x] Buy/sell flows otherwise unchanged and green

**How it turned out.** A stall on the path (`Objects/Exterior/Newsstand.png`,
one 32×48 pose, registered as an `ImageSpec`), placed by the map generator at
tiles (5–6, 11–13) — between the mailbox and the field, so it is passed on the
way to and from the crops. The HUD's Shop button is gone.

**A stall, not an NPC, and that is the whole argument.** The pack's NPC sheets
are full walk cycles for characters who would need somewhere to walk, a
schedule and a reason to be there. A stall is a thing you stand at, which is
exactly the interaction the action key already does — the same one the chest
and the shipping box use.

**Adding one image to the manifest shifted every later gid**, which is the trap
T-11.03 just cleaned up after. This time the workflow was followed as a matter
of course: regenerate the map, run `verify-farm`, confirm **0 warnings** and
seven objects resolving to their intended keys. The reader is drift-proof since
T-11.03, but the map data still has to be regenerated or the mapmaker and the
verifier disagree with it.

**The Gear tab quotes the server's price, never the client's config.**
`GET /api/inventory` now carries `tier` and `nextCost`, exactly as
`GET /inventory/chest` already did — same config on both sides, but only one of
them is authoritative, and a shop quoting a stale price is a shop that lies
(§4.4). Break-tested: making the view quote the CURRENT tier's cost instead of
the next one fails two tests.

**The panel host gained `backpack()` rather than a second fetcher.** The
inventory panel already fetches the bag; its `onSlotsChanged` now carries the
full view when it FETCHED one, and omits it when the payload came from a move
response — which has the slots but no tier or price. Inventing those two
numbers on a move would be worse than leaving the last known ones alone.

**Verified in the browser**: the HUD bar reads `Bag, Trade, Log out` with no
Shop button; the action key on open ground does nothing; walking west to the
stall and pressing it opens the shop; the Gear tab reads `Bigger backpack — 12
slots now · 2,000g`, buying it toasts `Backpack enlarged to 24 slots`, gold
5,000 → 3,000, tier 0 → 1, and the row re-reads itself as `24 slots now ·
10,000g`; buying leek seeds afterwards still works (3,000 → 2,980).

**Break tests, each confirmed failing then reverted:** the merchant opening the
chest's panel (2); the bag view quoting the wrong tier's price (2).

`pnpm -r typecheck` and `pnpm test` are green: 941 tests (82 shared + 120 client
+ 62 mapmaker + 677 server).

### T-11.05 — HUD cleanup and reskin  ✅ **DONE**
Depends: T-11.04 · Size: S
Files: `apps/client/src/game/hud.ts`, `apps/client/src/styles/hud.css`,
`apps/client/src/game/scenes/Interior.ts` (unmount), `apps/client/src/game/main.ts`
**Do:** Remove from the HUD: Trade button, decoration tray, Leave-house
button; unregister the Interior scene from the game config (file stays).
Reskin the top bar with `UI/HUD.png`/`UI/Money.png` art (gold shows the coin
icon). Keep username, gold, Bag, Log out. Trade/VIP/furniture server code and
tests remain untouched and green.
**Done:**
- [x] No dead buttons; `pnpm test` fully green including all trade/VIP tests
- [x] Top bar uses pack art

**How it turned out.** The bar is `TILLHAVEN · name · 🪙 500g · 🎒 BAG · LOG
OUT` and nothing else. Trade, the decoration tray and Leave-house are gone from
it; `Interior` is no longer in the scene list.

**`UI/HUD.png` is not a bar frame, and pretending otherwise was the only way to
fail this task.** The plan said "reskin the top bar with HUD.png". The file is
**26×6 cells of 16px icons** — cursors, arrows, books, speakers, ticks — with
nothing in it that frames anything. Grid alignment was verified rather than
assumed (of the 25 vertical seams between cells, exactly one has opaque pixels
on both sides), so a cell can be addressed by multiplying, and the bar takes
what the sheet actually offers: **the satchel from row 2, column 3 on the Bag
button**.

**`UI/Money.png` turned out to be an animation.** Six 16px frames whose opaque
pixel counts run 52, 44, 36, 28, 36, 44 — that is one coin turning edge-on and
back, not six coins. So the gold total wears a **spinning coin**, stepped
across the strip by a CSS `steps(6)` animation rather than interpolated (16px
art has no sub-pixel positions to interpolate through), and it holds still
under `prefers-reduced-motion`.

**Removed from the bar, kept in the tree.** The trade panel is simply not
mounted and `Interior` is not registered: the scenes, panels, endpoints and
tests are all intact for T-14.03/T-14.04, and 203 trade/VIP/furniture server
tests are green. Registering a scene nothing can reach would mean loading art
nothing draws.

**The house's controls now build their own DOM.** `setInsideHouse` and
`setDecorations` used to poke at markup baked into the bar, which is exactly
what "no dead buttons" forbids — so the Leave button and the decoration tray are
created on first use instead. Nothing calls them today, and DOM that only
exists once someone is indoors cannot be dead. It also means T-14.04
re-registers a scene rather than re-authoring a HUD.

**The doorway no longer takes you anywhere**, so `enterHouse` went with it. The
house still stands on the farm and still shows its tier — it is a building
again rather than a door to a room that is hidden for the MVP (§5.7).

**Verified in the browser**: the bar's buttons are exactly `Bag` and `Log out`;
the coin's computed style is the pack sheet running `hud-coin-spin`; the bag
icon resolves to the measured cell; the game's scene list is `[Preload, Farm]`;
the DOM holds shop, pack, shipping and creator panels and no trade panel; and
`pnpm --filter @tillhaven/client build` succeeds with the unreferenced scene
dropped from the bundle.

`pnpm -r typecheck` and `pnpm test` are green: 941 tests (82 shared + 120 client
+ 62 mapmaker + 677 server).

---

# Phase 12 — Animals expanded

### T-12.01 — All animal variants  ✅ **DONE**
Depends: T-7.10 · Size: S
Files: `packages/shared/src/config/animals.ts`, `packages/shared/src/config/assets.ts`,
`apps/client/src/game/animalSprites.ts`
**Do:** Register every chicken color (13 adult + matching babies) and cow
variant from the pack as cosmetic variants; shop's variant picker lists them.
**Done:**
- [x] Each variant renders from its own sheet (spot-check via test on the
      variant → sheet mapping)
- [x] Config test: every variant's sheet exists in SHEETS

**How it turned out.** The shop went from 4 colours to **25**: 13 chickens and
12 cows. Four variants became twenty-five without a single new field on
`AnimalDef`, because everything a player can measure — price, interval, yield,
maturity, feed — is per KIND, and a variant only ever names a picture.

**A variant is now a thing, not a string.** `ANIMAL_VARIANTS` maps each id to
an `AnimalVariantDef` (`id`, `kind`, `label`, `sheet`, `babySheet`) and
`ANIMALS[kind].variants` is derived from it, so a colour is registered in one
place instead of three. The client's `VARIANT_SHEET`/`BABY_SHEET` are now
*resolved* from it against `SHEETS` rather than hand-written — which is what
made adding 21 colours a data edit. Sheets are named by KEY here, the way item
icons already are, keeping `animals.ts` free of the asset manifest; a config
test cross-checks every key against `SHEETS`, so a typo fails a test instead of
rendering a blank square for whoever buys that colour. A fourth test pins the
def's field list, so adding a fifth field — the one that could make a colour
worth gold — has to be deliberate.

**Chicks now match the hen they grow into.** `BABY_SHEET` used to be keyed by
KIND: one yellow chick stood in for every chicken. Fine with two variants, a
visible lie with thirteen — buy a black hen, watch a yellow chick, get a black
hen back. It is keyed by VARIANT now. The pack ships 10 chick sheets for 13
adults, so the pairing was **measured, not guessed** (§9): each adult's frame-0
opaque-pixel palette was compared against every chick's by nearest-colour
distance. Name-matching and palette-matching agree on 11 of 13. The two
disagreements are both instructive and both went to the name:
`Chicken Black` scored closer to `Baby Chicken Evil` (8.3) than to
`Baby Chicken Black` (11.0) — the Evil chick is the same black bird with red
eyes — and `Chicken Brown White` scored closest to `Baby Chicken White`,
because a palette average cannot tell a body from a wing. Hence the rule the
code and tests now state: **two-word slugs are body-then-accent, and the chick
inherits the body.** `Baby Chicken Yellow` pairs with no adult (nothing in the
pack is a yellow hen) and stays only because the landing page uses it.

**"Highlighter Cow" is Highland cattle.** The pack's folder name is an apparent
typo — the art is unmistakably shaggy, long-horned Highland cows. The variant
ids say `highland` so the shop does not offer a stationery item; the pack's
real path stays in `prepare-assets.mjs`, which is where source fidelity
belongs.

**Baby cow art exists and is still not used.** The pack ships four Baby Cow
sheets, which retires the old `// No baby-cow sprite exists` comment — cows
being bought adult is a *design* choice (2000g and a slow payback is already a
long wait) and the comment now says so, plus what flipping it would take.

**Two sheet consts became three lists.** 25 hand-written `SheetSpec` blocks
would be 250 lines of copy-paste, so `ANIMAL_CHICKEN_SHEETS`,
`ANIMAL_CHICKEN_BABY_SHEETS` and `ANIMAL_COW_SHEETS` are built from slug lists
over two measured geometries. Uniform geometry was **verified, not assumed** —
all 23 chicken PNGs are 64×112 and all 12 registered cow PNGs 128×288 by header
read. (`Baby Cow Blonde.png` is the lone outlier at 128×320; it is not
registered, so nothing has to accommodate it.) `SHEETS` spreads the three
lists, `registerAnimalAnimations` walks them instead of a hand-kept array, and
`idleRowFor` builds its cow-key set from `ANIMAL_COW_SHEETS` — so it still
dispatches on identity rather than on shape, and the impostor test still holds.

**`SHEETS` grew from 23 to 53 entries, so `farm.json` was regenerated** —
`generate-farm.ts` then `verify-farm.ts` (warnings: 0), per the gid-drift rule
that has now bitten this project twice. Two renamed cow PNGs
(`animal-cow-female-brown` → `animal-cow-brown-female`) were deleted by hand;
`prepare-assets.mjs` copies but never prunes.

**One cosmetic drift, deliberately.** `chicken_blonde` used to draw the pack's
*Blonde Green* sheet because it was the only blonde registered. It now draws
*Blonde*, and the green-tailed bird is `chicken_blonde_green`. Existing
chickens keep their ids and just lose a green tail.

**Verified in the browser** (Playwright — the MCP server's Chrome channel is
missing on this machine, so the bundled `chromium-1234` was driven by script
instead): a fresh account walked to the merchant and opened the shop, whose two
pickers list exactly 13 and 12 options with their written labels; buying a
`chicken_green` produced a **green** chick on the farm, not a yellow one; and
eight assorted variants seeded straight into the DB (pink/black/blonde/highland
cows, universe/pink/black-white/crimson chickens) each rendered as their own
distinct animated sprite, with the whole farm — house, coop, barn, chest,
shipping box, merchant, mailbox, trees — intact after the regeneration.

`pnpm -r typecheck` and `pnpm test` are green: 947 tests (86 shared + 122
client + 62 mapmaker + 677 server).

### T-12.02 — Coop and barn tiers  ✅ **DONE** (art split out to T-12.02b)
Depends: T-12.01, T-10.03 · Size: M
Files: `apps/server/src/db/schema.ts` (+ migration: `farms.coop_tier`,
`farms.barn_tier`, int NOT NULL default 0), `packages/shared/src/config/animals.ts`
(`COOP_TIERS`/`BARN_TIERS`: caps + costs), `apps/server/src/modules/animals/service.ts`
(cap logic), `apps/server/src/modules/shop/{service,routes}.ts` (upgrade
endpoints), tests
**Do:** Chicken cap = f(coop tier), cow cap = f(barn tier) — replaces
`BASE_ANIMAL_CAP` + house-tier animal bonus entirely (house tiers become
purely cosmetic; note it in economy.ts comments and update house tests).
Upgrades purchased at the merchant (reuse `upgrades.ts` primitives). Client:
coop/barn sprites on the map upgrade visually per tier (pack has
Basic/Big/Deluxe sheets).
**Done:**
- [x] Cap math per-kind tested (chickens don't consume cow cap and vice
      versa); purchase happy/poor/max/race/idempotent tested
- [x] Buying an animal over its building's cap → `ANIMAL_CAP_REACHED`

**How it turned out.** One farm-wide animal number became two building caps.
`ANIMALS[kind].building` says where a kind lives, `COOP_TIERS`/`BARN_TIERS` say
how many fit at each tier, and `buildingCap(building, tier, vipBonus)` is the
one function that answers "how many". `BASE_ANIMAL_CAP` and
`HOUSE_TIERS[].bonusAnimalCap` are both gone.

**The bug it fixes is that a full coop used to be a full farm.** Six chickens
made a 2,000g cow unbuyable — a decision no player ever meant to make, and one
they could only undo by never buying the sixth chicken. Chickens and cows are
counted separately now (`countAnimals` takes a kind), and the refusal names the
building rather than the farm: `There is no room in your coop.` with
`details.building`, so the UI can point at the upgrade instead of the shrug.
Two integration tests pin exactly this — filling the coop, being refused, then
filling the barn to *its* own cap regardless.

**Tier 0 adds up to the old cap on purpose.** 4 chickens + 2 cows = 6, which is
what `BASE_ANIMAL_CAP` was, so a farm that buys no building is no worse off
than before — it just cannot spend all six on cows. Coop goes 4/8/12 for
0/4k/20k, barn 2/4/6 for 0/10k/40k; the barn is dearer per animal because a cow
costs five chickens and produces on a six-hour cycle.

**The upgrades reuse the existing spine rather than growing a fourth one.**
`BuildingTier` is shaped like `farm/upgrades.ts`'s `Tier`, so `lockForUpgrade` /
`nextTier` / `assertAffordable` / `chargeGold` / `costAfter` all apply
unchanged — player row locked before the farm row, same order as every other
purchase, so nothing can deadlock and two clicks cannot buy one tier twice
(both pinned by tests). The building is in the PATH (`POST /api/shop/coop`,
`/barn`), not the body: like the missing target tier, it is then not a value
anything has to validate. One service, two thin routes registered in a loop.

**The house is now a sink that buys nothing, and that is worth saying out
loud.** T-10.03 took its bag slots and this task took its animal cap, leaving
30,000g of price with no effect — and the house still renders with one look at
every tier (the T-7.11 art gap). The endpoint, tiers and tests stay and
`docs/economy.md` gained a new gap entry for it; the shop deliberately does not
list it. The old `raises the animal cap, provably` test was **inverted** rather
than deleted — it now fills the coop, upgrades the house, and asserts the
refusal is unchanged, because a house that still quietly made room would pass
every other test in that file.

**VIP's `bonusAnimalCap` now applies per building**, so it is worth +3 in the
coop AND +3 in the barn where it used to be +3 in total. That follows from the
cap it modifies being per building, and it mints no tradeable value (§7), but
it is a real buff and is flagged here for the balance pass rather than left to
be discovered.

**The pasture became two yards, because the cap did.** A single grid could no
longer be sized against "the largest herd" once that was two numbers, and the
two kinds want different spacing anyway — a chicken is 16px and packs one per
tile, a cow is 32px and needs two. `COOP_YARD` is 5x3 on the grass north of the
coop (15 slots, exactly the top coop tier plus VIP); `BARN_YARD` is one row of
9 along the band below the path, which is what pins `BARN_TIERS`' top cap at 6.
`pasture.test.ts` reads both sides from config, so retuning a tier fails there
instead of silently stacking sprites. Two smaller fixes came with it: animals
are indexed **within their own kind** (using the combined index left a
permanent hole in the coop yard for every cow bought first), and the counter
advances for animals already on screen — skipping them would hand an occupied
spot to the next arrival.

**The per-tier building art does not fit this farm, and that is measured, not
assumed.** The crop windows for all four Big/Deluxe sheets were found by the
same flood-fill that reproduces `OBJ_CHICKEN_COOP_LOOK` and `OBJ_BARN_LOOK`
exactly, and then every anchor on the authored 20x16 map was searched for one
where the footprint lands on free ground:

| sheet | footprint | free anchors |
|---|---|---|
| coop basic (live) | 4x5 | 33 |
| coop big | 7x6 | 4 |
| coop deluxe | 9x8 | **0** |
| barn basic (live) | 5x5 | 23 |
| barn big | 7x6 | 4 |
| barn deluxe | 8x8 | **0** |

Both Deluxe sheets have nowhere to stand, and the two Big sheets' four anchors
are all the same spot — which they cannot share. On a 320x256px farm the Deluxe
coop alone is 40% of the width and half the height. Placing them needs the farm
re-authored or enlarged, which is a map task; it is now **T-12.02b**. The
measurements are recorded in `UNPLACED_BUILDING_LOOKS` in the manifest so that
task starts from numbers rather than a ruler, and the art is deliberately
neither copied nor added to `IMAGES` — adding it would shift every later
`firstgid` and load sheets nothing draws. *(T-12.02b enlarged the farm to
30x22 and wired all four in; `UNPLACED_BUILDING_LOOKS` is gone, replaced by
`COOP_TIER_ART`/`BARN_TIER_ART`.)*

**Verified in the browser.** The Gear tab lists Bigger backpack / Bigger coop
(`holds 4 chickens now · 4,000g`) / Bigger barn (`holds 2 cows now · 10,000g`),
and at max tier both read `as big as it gets` with a dead Bought button. Against
the live endpoints: a full coop refused a chicken with `ANIMAL_CAP_REACHED` and
`details.building: "coop"`, a full barn refused a cow the same way,
`POST /api/shop/coop` returned `{tier: 1, cap: 8, goldDelta: -4000, nextCost:
20000}`, the very next chicken purchase succeeded — and the very next COW was
still refused, which is the whole point. Nine cows and five chickens then
rendered in their own yards, inside the farm and clear of the water column, no
console errors.

`pnpm -r typecheck` and `pnpm test` are green: 974 tests (92 shared + 123
client + 62 mapmaker + 697 server).

### T-12.02b — Per-tier coop and barn art  ✅ **DONE**
Depends: T-12.02 · Size: M
Files: `apps/mapmaker/scripts/generate-farm.ts`, `packages/shared/src/config/assets.ts`,
`scripts/prepare-assets.mjs`, `apps/client/src/game/entities/{Coop,Barn}.ts`,
`apps/client/src/game/pasture.ts`
**Do:** Make the farm hold the Big and Deluxe buildings, then wire them. The
crop windows are already measured (`UNPLACED_BUILDING_LOOKS`); what is missing
is somewhere to put them — see the anchor table in T-12.02. Either enlarge the
farm (`FARM_WIDTH`/`FARM_HEIGHT`, which moves `PLOT_POSITIONS` and the camera
fit) or re-author the 20x16 layout to free a 9x8 and an 8x8 rectangle. Add the
four sheets to `COPIES` and `IMAGES` (**regenerate `farm.json` afterwards** —
gid drift), give `Coop`/`Barn` a `setTier` like `House`'s, and feed it from
`state.farm.coopTier`/`barnTier`, which the farm view already carries.
**Done:**
- [x] Each tier draws its own building, on free ground, at every tier
- [x] `verify-farm` prints `warnings: 0` after regeneration
- [x] Yard slots still fit their caps (`pasture.test.ts`) after any layout move

**How it turned out — the farm grew rather than being rearranged, and the
extra land is all east and south so nothing already on it moved.** The two
options in the Do are not close: a Deluxe coop and a Deluxe barn want 9x8 and
8x8 of contiguous free ground, and the old map had 320 tiles in total with a
house, a field, two yards, four objects and a path skeleton already on them.
`FARM_WIDTH`/`FARM_HEIGHT` are 30x22. Because every new tile has x >= 20 or
y >= 16, `pnpm plots` regenerated `plots.generated.ts` **byte-identical apart
from its `Source map:` header** — so no existing farm's plot rows go stale, and
`spawnPoint()` (which derives from `PLOT_POSITIONS`) did not move either. The
one thing that does go stale is `farms.width`/`height` on rows written before
this task; nothing reads them back — the client renders from `farm.json`, and
the `width`/`height` the farm view carries has no consumer — so this is a note
rather than a migration.

**On screen the farm is the same size it was**, which is not a coincidence:
480x352px at the integer zoom 2 that `fitCamera` now picks is 960x704, against
320x256 at zoom 3 = 960x768. The map got half again as big and the art did not
get smaller.

**A deliberate deviation from the file list: the anchors moved into shared
config.** The task lists `Coop.ts`/`Barn.ts`, where the tiles were hardcoded.
That could not stay: the buildings are not map objects (their crop windows are
not gids — `Coop.ts` explains why), so nothing in `farm.json` records that
their ground is taken, and `generate-farm.ts` has to know where they stand to
avoid painting a path or planting a tree underneath. The house had already
shown how that goes wrong — its `(6,6)` was written once in `House.ts` and
once as a prose comment in the map generator. New
`packages/shared/src/config/buildings.ts` holds `COOP_ANCHOR`/`BARN_ANCHOR`/
`HOUSE_ANCHOR` and the footprint arithmetic; this is the same reasoning that
moved `FARM_WIDTH` out of the server in an earlier task, and it is config, not
a payload — §4.1 is about what the client may *tell* the server, and the server
still has no opinion about where a barn is.

**That guard immediately found a real defect that had survived three tasks.**
`assertGroundClearOfBuildings` refused the first generation run:
`path at (8,3) is inside a building footprint (6,3)-(8,5)`. The west-of-field
path spine ran `y=1..13`, and its top five tiles were underneath the house,
where the building simply drew over them. Nothing looked wrong, which is
exactly why nobody caught it. The spine now starts at `y=6`, one row below the
front door — which is also the walk it was always meant to be.

**The footprint is rounded outwards, and reserved at the largest tier.** A
129px-wide coop covers eight whole tiles and one pixel of a ninth, and a
half-covered tile is still a tile nothing else may stand on. Reserving the
*Deluxe* box at every tier is what stops a 20,000g upgrade from dropping a roof
onto a tree that was placed while the player still had the basic coop; a test
pins that every smaller tier fits inside that box, which only holds because the
tiers share a bottom-left corner.

**`setTier` swaps the texture, not just the frame.** Each tier is its own sheet
(`Big Chicken Coop.png` etc. are separate files), so a `setFrame('coop-2')`
against the basic coop's texture finds nothing and draws nothing. This is the
same trap `Farm.ts`'s per-crop sheets hit in T-7.07, one level up. An unknown
tier keeps the basic look rather than blanking the building: the server is the
authority on tiers, and a picture the client does not have is not a reason to
draw a hole in the farm.

**Layout.** Coop anchored at (21,12) → Deluxe covers x 21-29, y 4-11; barn at
(21,21) → x 21-28, y 13-20, with a row of grass between them. Column 20 is a
new north-south path lane serving both, hung off the horizontal spine which now
runs to x=20; a second new run along y=20 borders the southern pasture. The
chicken yard moved with the coop (origin (21,1), still 5x3 = 15 slots) and the
cow row to the new southern band (origin (2,18), still 9 slots at 2-tile
spacing, ending at x=18 one lane short of the barn). Two more maple trees so
the new land does not read as a blank green rectangle. `verify-farm` reports
**0 warnings**, 9 objects, 20 plots, 30x22.

**`UNPLACED_BUILDING_LOOKS` is gone**, replaced by `COOP_TIER_ART`/
`BARN_TIER_ART` — tables indexed by tier, so `COOP_TIER_ART[farm.coopTier]` is
the whole lookup and `config.test.ts`'s crop-window check now reads them
instead of a hand-written list (a fourth tier is covered the day it is added).
All four measurements were re-derived from scratch with an independent
flood-fill before being trusted, and the same script reproduced the two
*already-live* windows exactly — which is what makes it a check rather than a
restatement.

**One more piece of drift fixed on the way past:** `apps/mapmaker`'s
`DEFAULT_WIDTH`/`DEFAULT_HEIGHT` were literal `20`/`16`, so opening the editor
to author a new farm would have handed you a canvas too small for the map it
was for. They read shared config now.

**Verified — seven break-tests, each restored:** (1) coop anchor moved onto the
crop field → 4 failures including `'coop tier N' covers no plot`; (2) barn
anchor pushed east → `stands entirely inside the farm` fails at all three
tiers; (3) `OBJ_BARN_DELUXE_LOOK.height` inflated past its sheet → the crop
window test fails *for the new tier specifically*, not just an old one; (4) the
Deluxe barn removed from `BARN_TIER_ART` → `gives every coop and barn tier
exactly one look` fails; (5) a maple tree moved to (24,17) → the generator
refuses to write with `tree at (24,17) is inside a building footprint
(21,13)-(28,20)`; (6) cow yard pushed to y=25 → the pre-existing
`keeps every slot inside the farm` fails; (7) chicken yard moved to y=6 → the
new `keeps every slot out from under a building, at every tier` fails.

**Browser-verified** against the live dev stack (registered a fresh account,
same `playwright-core` + cached-Chromium workaround T-7.07 documented — the
registered Playwright MCP server still defaults to the missing `chrome`
channel). Screenshotted all three tiers of both buildings by setting
`coop_tier`/`barn_tier` in the dev DB and waiting one full 20s poll: basic,
Big and Deluxe each draw a visibly different, complete building, all on free
ground inside the farm, with the paths reaching both. A second session filled
both buildings to their top caps — 12 chickens and 6 cows — and every animal
landed in its own slot, inside the farm and clear of the walls. Zero
`pageerror`s, zero console errors, zero 4xx/5xx across both runs.

`pnpm -r typecheck` and `pnpm test` are green: 1020 tests (124 shared + 137
client + 62 mapmaker + 697 server).

### T-12.03 — Animal interaction via character  ✅ **DONE**
Depends: T-12.02, T-9.06 · Size: S
Files: `apps/client/src/game/actions.ts`, `apps/client/src/game/scenes/Farm.ts`
**Do:** Action key facing an animal: empty hand → collect; feed item
equipped → feed (consumes via the existing endpoint). Remove click-to-collect
handlers. Petting/product badges stay as they are.
**Done:**
- [x] Collect and feed work via the character; click path removed
- [x] Dispatch matrix test extended for animal targets

**How it turned out.** Animals joined the same control scheme as everything
else: `Target` gained an `animal` arm, `actionFor` gained an `animalAction`
branch, and `Dispatch` gained `AnimalIntent` (`collect` | `feed`). The last
act-at-a-distance in the game is gone — you could milk a cow from across the
farm until this task.

**What is in hand now decides which of the two things happens**, and that is
the real change. The click path did "collect if you can, otherwise feed" from
one input, so a player who meant to collect spent a bag of feed instead.
Empty hand collects; the right feed feeds. Feeding is a purchase being spent,
and spending it should take saying so.

**The feed has to be the right feed.** The server picks which item to consume
from the animal's KIND, so holding hay at a chicken would quietly eat chicken
feed. The gate refuses and **names the food they need** — the shop sells both
and the two bags look nearly identical in a hotbar slot. A test pins that the
message contains the item's configured name rather than its id.

**Targeting reuses the sprite's own `bounds()`**, which is one tile whatever
the art's width — so a cow, 32px wide, is worked from the one tile it visibly
stands on, and the tile you can walk up to is the tile you can see it on. The
view is then re-read out of `this.state` rather than off the sprite, so the
gate reads the same snapshot every other decision in the scene does.

**`sendAnimal` is `send`'s mirror, deliberately duplicated rather than
generalised.** Every plot intent carries a `plotId` and `send` leans on that;
an animal intent carries an `animalId`. One function taking `plotId | animalId`
would need a discriminator at every use. `isAnimalIntent` is the narrowing, and
it is tested against plot intents, open intents and null so it cannot quietly
start swallowing them. No swing plays: the pack ships hoe and watering strips
and nothing for kneeling at a cow (T-8.09 measured what exists).

**A chick falls out of the ordinary branches** rather than needing a case: it
can be fed (which is how it starts producing the moment it matures) and cannot
be collected from, because `hasProduce` is false and feeding is its own branch.
"Still growing" and "Nothing ready yet" are different sentences, and a test
asserts they stay different — they are the two questions a player actually
has.

**Verified in the browser**, walking the character to the coop yard and
pressing the action key at two hens:

| in hand | facing | result |
|---|---|---|
| empty | hen with an egg | `Collected 1 × Egg.` |
| hoe | hen with an egg | `Hold Chicken Feed to feed it, or empty your hands to collect.` |
| empty | hungry hen | `Hungry. Hold Chicken Feed to feed it.` |
| chicken feed | hungry hen | `Fed. Chicken Feed used.` |
| chicken feed | the same hen, now fed | `Your chicken is not hungry.` |

Clicking directly on both hens afterwards produced **no** `/api/animals/*`
request and no message at all, which is the click path being gone rather than
merely unused.

One debugging note worth keeping: an early run looked like "empty hands is not
empty", and it was not a bug — the egg collected a probe earlier had landed in
the hotbar slot the script was using to mean "empty". Instrumenting the
scene's actual `equipped` value settled it in one run; the fixture was wrong,
not the gate.

`pnpm -r typecheck` and `pnpm test` are green: 987 tests (92 shared + 136
client + 62 mapmaker + 697 server).

---

# Phase 13 — Idle mode

The headline. Server-simulated standing orders (§4.2 taken to its logical
end): enable idle, pick tasks + a crop, and the character farms — including
while the tab is closed. The client's animation is replay, never authority.

### T-13.01 — Idle columns + config  ✅ **DONE**
Depends: T-9.03b · Size: S
Files: `apps/server/src/db/schema.ts` (+ migration),
`packages/shared/src/config/idle.ts` (new)
**Do:** `farms.idle_enabled` bool NOT NULL default false; `farms.idle_tasks`
text NOT NULL default `'[]'` (JSON array ⊆ `["till","plant","water",
"harvest"]`); `farms.idle_crop_id` text null; `farms.idle_processed_at`
bigint null. Config: `IDLE_ACTION_MS = 10_000` (one action per 10s — walking
included), `IDLE_MAX_CATCHUP_ACTIONS = 5_000`, `IDLE_TASK_TYPES` const.
**Done:**
- [x] Migration applies; config exported with a shape test

**How it turned out.** Four columns on `farms` (migration `0010`) and a new
`packages/shared/src/config/idle.ts`. Nothing is wired to anything yet — this
is the vocabulary the next seven tasks are written against, so most of the work
was deciding what shape each field has to be and writing down why.

**`idle_tasks` is a JSON array in a `text` column, not a Postgres array and not
four booleans.** The set is designed to grow — chop and mine are the named next
two (§5.3) — and adding a member to a JSON array is a config change while
adding a column is a migration. The server is its only reader and will validate
it against `IDLE_TASK_TYPES` with Zod at the boundary (T-13.02), so nothing
downstream trusts what is in the column. Default `'[]'`: enabling idle having
chosen no chores does nothing, which is the honest reading of that state rather
than an error to report.

**`idle_crop_id` is nullable and is not a foreign key.** Crops live in shared
config, not in a table, so there is nothing to reference; null is a real
setting, not a missing one — a player who wants watering and harvesting done
but nothing new sown. The columns went on the FARM rather than the player
because every one of them is an instruction about a farm: which of its plots to
work, and what to sow in them.

**Three things beyond the Do's literal list, each because the constant is
useless without them.** `IDLE_MAX_CATCHUP_ACTIONS` only means something if
something applies it, and if T-13.03 and T-13.04 each write their own
`Math.floor(elapsed / IDLE_ACTION_MS)` they will eventually disagree about
rounding. So `idle.ts` also exports `idleActionsIn(elapsedMs)` — the whole time
model in one function — plus `IDLE_MAX_CATCHUP_MS` derived from the two
constants rather than written down, and an `isIdleTask` narrowing for the
endpoint to lean on. All three are pinned by tests.

**Two decisions recorded now so they are not made by accident later.** First,
**floor, not round**: an action that has not finished has not happened, and
rounding up hands out a tenth of an action's work for free on every read.
Second, **exceeding the catch-up cap is not an error and costs the player
nothing** — the applier will advance the watermark by the actions it actually
ran, so a farm left for two weeks catches up over several polls instead of one
very slow one. That is what makes a bounded cap safe on the hottest path in the
game (§11); without it a year-old farm asks for three million simulator steps
inside an open transaction. 5,000 actions is ~14 hours, comfortably past the
night's sleep this feature is actually for, and a test pins it between 8 and 48
hours rather than pinning the literal — the number is tunable, the property is
not.

**`idleActionsIn` returns 0 for a window that has not happened**, including a
negative one. That is not hypothetical: a watermark ahead of `now` is what a
server clock adjustment produces, and a negative count would run the simulator
backwards. Non-finite input also yields 0 — on garbage, doing nothing is the
safe answer, not doing the maximum.

**`IDLE_TASK_TYPES` order is dependency order, and that is load-bearing**, not
presentation: the simulator works down the list, and you cannot plant ground
you have not tilled or water a seed you have not planted. It is deliberately
not a priority the player configures — one fixed legible order beats a
configurable one whose result nobody can predict.

**Verified.** The migration was applied to the dev database AND, separately, to
a freshly created empty one (`tillhaven_migcheck`, dropped afterwards) so the
full 11-migration chain is known to apply from nothing — which is what the
roadmap's migrations note actually asks for, and is not what running
`db:migrate` against the dev database proves. All four columns land with the
intended types, nullability and defaults. Four break-tests, each restored:
dropping the clamp fails the catch-up-cap test; `round` for `floor` fails
"counts only actions that finished"; removing the `<= 0` guard fails "is zero
for a window that has not happened"; and swapping `till` and `plant` in
`IdleTask` fails both order tests.

`pnpm -r typecheck` and `pnpm test` are green: 1030 tests (134 shared + 137
client + 62 mapmaker + 697 server).

### T-13.02 — Idle settings endpoint  ✅ **DONE**
Depends: T-13.01 · Size: S
Files: `packages/shared/src/schemas/index.ts`,
`apps/server/src/modules/farm/{service,routes}.ts`, tests
**Do:** `PUT /api/farm/idle` (`{enabled, tasks, cropId?, idempotencyKey}`):
zod validates tasks ⊆ allowed and cropId ∈ CROP_IDS; enabling stamps
`idle_processed_at = now` (never backdates); disabling first applies pending
simulation (via T-13.04's applier once it exists — until then just stamps).
**Done:**
- [x] Validation rejects unknown tasks/crops; idempotent; ownership from
      session
- [x] Enable→disable→enable never double-counts time (watermark tests)

**How it turned out.** `GET`/`PUT /api/farm/idle`, a new
`apps/server/src/modules/farm/idle.ts`, `idleSettingsSchema` in shared schemas,
an `IdleSettings` view type, and one new error code. The GET was not in the Do
and is one line: a settings endpoint the client can only write to is one the UI
has to guess the state of, and T-13.05 does not put idle in the farm view until
later.

**It is a PUT, and a PUT replaces.** An omitted `cropId` means "sow nothing",
not "leave it as it was". A partial update needs a way to say *clear the crop*
that is distinct from *don't mention it*, and every API that grows one
eventually gets it wrong. A test pins the replacement semantics directly, by
setting a crop and then submitting a body without one.

**The watermark is the only piece of state this endpoint moves, and it is
where the exploit would be.** `idle_processed_at` is settled to `now` on
**every** successful write — not only on enable, but on disable and on a change
of tasks while already enabled. Otherwise the column can be left pointing at a
moment before the settings currently in force, and once T-13.04's applier
exists it would pay out a backlog earned under rules the player did not have —
in the worst case a month of work for a farm that was idle-*disabled* the whole
time. Settling forward makes "you cannot mint idle work out of time you were
not idling" true by construction rather than true as long as every future
caller remembers. `Math.max` against the stored value so a clock adjustment
cannot reopen a settled window. Two tests pin exactly these, and both were
confirmed to fail when the rule is weakened.

**The cost of that rule, stated rather than buried:** until T-13.04 lands, this
endpoint DISCARDS at most one un-applied window — the stretch since the last
read. That is the deliberate side of the trade, and there is a `TODO(T-13.04)`
at the exact line where the applier goes, before the watermark moves. Losing up
to one poll's work is a rounding error; replaying a month a farm never idled
for is not.

**Planting with nothing to plant is refused, not ignored** —
`IDLE_CROP_REQUIRED` (400), with `details.task` so the UI can point at the row
rather than the form. Accepted-and-ignored would leave a farmer tilling a field
and sowing nothing, which a player cannot tell from a broken feature. Checked
before the row is locked; nothing about it needs the database. The mirror case
is deliberately allowed: a crop chosen with no `plant` task is simply unused.

**Tasks are stored canonically — `IDLE_TASK_TYPES` order, no duplicates.** The
set is the player's; the order is the config's, and the simulator walks it in
dependency order. Storing whatever order the request arrived in would make the
column's meaning depend on a client's array literal. Duplicates are refused at
the schema rather than silently deduplicated: `["till","till"]` is a client bug,
and accepting it means the bug ships.

**Reading the column is deliberately tolerant, and that is not the same
decision as writing it.** `idle_tasks` is `text` and `idle_crop_id` is not a
foreign key (crops are config, not a table), so neither is guaranteed by the
type system — a bad migration, a manual `UPDATE`, or a **newer build writing a
task this one has never heard of** all land in the same place. Writes are
strict (Zod refuses anything unknown); reads drop what they do not recognise
and keep the rest. Taking a farm away from a player because one word in a
settings column is unfamiliar would be the wrong trade, and the forward-compat
case is real the first time two versions run at once. Six tests cover it: not
JSON at all, JSON that is not an array, an array of numbers, a task from a
later version, a mixed list (the known ones survive), and an unknown crop
(reads as "sow nothing").

**Verified.** 30 new integration tests through the real stack (`app.inject`, so
routing, Zod, the error handler and cookies are all exercised) covering the
happy path, every validation refusal, the watermark rules, idempotency,
ownership and the tolerant reads. Two of them are worth naming: *"writes
nothing when it refuses"* compares the whole farm row before and after a
rejected request, and the idempotency test replays a **different** intent under
the same key — a retry that raced a real change must not apply the change.

Six break-tests, each restored: `now` instead of `Math.max` fails "never moves
backwards"; stamping only when the watermark was null fails "cannot be left
pointing at a moment before the settings that are in force"; removing the
crop-required check fails its test *and* "writes nothing when it refuses";
returning tasks in request order fails four tests; and dropping the Zod
duplicate refinement fails "refuses a duplicated task".

**One break-test did not fail, and that was the useful one.** Deleting
`parseIdleTasks`'s `isIdleTask` filter changed nothing — because
`canonicalTasks` builds its result *from* `IDLE_TASK_TYPES` and so already
drops anything unrecognised. Two mechanisms enforcing one rule, and the tests
could only see one of them; that is how the other quietly stops being true.
`canonicalTasks` now takes `string[]` and owns dropping unknown tasks alone,
the redundant filter is gone, and breaking the surviving guard fails the
tolerant-read tests as it should.

`pnpm -r typecheck` and `pnpm test` are green: 1060 tests (134 shared + 137
client + 62 mapmaker + 727 server).

### T-13.03a — Simulator core: till + plant  ✅ **DONE**
Depends: T-13.01 · Size: M
Files: `apps/server/src/modules/farm/idleSim.ts` (new, PURE — no DB, no
Date.now), `idleSim.test.ts`
**Do:** `simulate(input): {actions, plots, inventory, stoppedReason}` where
input = plots snapshot, inventory counts (seeds by item), task set, cropId,
window `{from, to}`, and constants. Event loop: virtual clock starts at
`from`; every `IDLE_ACTION_MS` pick ONE action by priority (this task: till
an untilled unlocked plot; plant the chosen crop into a tilled empty plot if
a seed remains — consuming it); if nothing to do, advance to the next time
anything becomes possible or exit. Deterministic plot order (by plot index).
Emit an ordered action log `{at, kind, plotId}`.
**Done:**
- [x] Unit tests: tills then plants in order, stops when out of seeds,
      respects task subset (till-only never plants), empty window = no
      actions, determinism (same input twice ⇒ deep-equal output)
- [x] Break-tested per behaviour

**How it turned out.** `apps/server/src/modules/farm/idleSim.ts` and 27 unit
tests. Pure as specified — it imports config and nothing else, so there is no
database to stub and no clock to freeze, and every case is arithmetic.

**Priority is `plant > till`, not the order the Do lists them in.** T-13.03b
states the final order as `water > plant > till` (with harvest above), so
building till-first today would mean reshuffling next task for no reason. It is
also the better behaviour on its own: a farmer that broke the whole field
before sowing anything leaves every seed in the bag for an hour on a twenty-plot
farm, and only growing crops pay. The observable result is that it tills a plot,
sows it, and moves on — which still satisfies "tills then plants in order".

**The first action lands one full cadence into the window, not at `from`.** An
action that has not finished has not happened. That is what makes the sim agree
with `idleActionsIn` from T-13.01 — a window of exactly one `IDLE_ACTION_MS`
yields exactly one action — and the agreement is asserted rather than assumed:
one test runs five different window lengths and checks
`actions.length <= idleActionsIn(to - from)`. The applier will watermark with
this module's `processedTo` and size its expectations with that function, so a
disagreement between them is either lost work or work paid twice.

**`processedTo` distinguishes "nothing happened" from "we ran out of budget",
and that distinction is the whole reason it exists.** Stopping because there
was nothing to do settles the *entire* window — otherwise an idle farm with an
empty bag would re-simulate the same dead stretch on every poll, forever.
Stopping at the action cap settles only up to the last action, so the next read
continues from there. It is also clamped never to precede `from`: a window that
runs backwards (what a clock adjustment produces) settles nothing rather than
handing the applier a watermark pointing into the past.

**Two things came in early, deliberately.** The action cap and `processedTo`
are formally T-13.03c's, but the alternative was writing an event loop I already
knew was wrong and restructuring it next task. The cap is three lines around a
constant T-13.01 already settled; T-13.03c still owns the thorough tests for
the capped path. Conversely, the "no action possible — advance the clock to the
next opportunity" branch is *not* here, because with only till and plant it
would be dead code: nothing in this task's state changes with time, only with
an action, so if nothing is possible now then nothing ever will be. T-13.03b's
drying soil is what makes that branch real, and the comment says so at the line
where it goes.

**A sown plot is byte-identical to what `plant()` writes**, including the
resets — `growthDurationMs` snapshotted from config (never the VIP-adjusted
one; that is applied at read time), `wateredAt: null` and `grownMs: 0` so a
fresh seed inherits nothing from whatever was there before (D-1), and `tilledAt`
left alone because soil stays hoed. A test plants into a plot carrying stale
`wateredAt`/`grownMs` values specifically to catch inheritance.

**Verified.** 27 tests, and nine break-tests each restored: reversing the
priority fails 4; ignoring the task selection fails 4; planting without holding
a seed fails 2; landing the first action at `from` fails 8; settling the whole
window even when capped, letting the watermark run backwards, mutating the
caller's arrays in place, working locked plots, and letting a sown plot inherit
the previous crop's progress each fail their own.

`pnpm -r typecheck` and `pnpm test` are green: 1087 tests (134 shared + 137
client + 62 mapmaker + 754 server).

### T-13.03b — Simulator: water  ✅ **DONE**
Depends: T-13.03a · Size: M
Files: same
**Do:** Add the water action using growth-v2 semantics inside the sim:
watering settles `grown_ms` and stamps `watered_at` at the virtual time.
Priority (full order now: water-dry-planted > plant > till; harvest comes in
13.03c above water). A crop about to dry is re-watered on the first action
slot at-or-after expiry — growth pauses only for the gap the action cadence
forces (that's the honest cost of one action per 10s).
**Done:**
- [x] Tests: keeps one crop wet across a long window (total growth ≈ window
      minus cadence gaps, asserted with exact arithmetic); juggling more
      plots than cadence allows loses growth deterministically; water-only
      task set never plants
- [x] Sim's growth arithmetic cross-checked against `growth.ts` functions
      (import and reuse them — never reimplement)

**How it turned out.** 18 more tests (45 in the file) and three additions to
`idleSim.ts`: the water action, the clock-jump branch T-13.03a deliberately
left marked, and `durationPercent` so the sim knows when a crop is ripe.

**"Never reimplement" turned out to be stronger than expected: the whole
watering predicate is one existing function.** `growthAt(...).isPaused` is
*defined* as "planted, not ripe, and the soil is dry" — which is exactly when a
watering can converts an action slot into growth. So `canWater` is that call
and nothing else, and two behaviours come free rather than being written: a
**ripe** crop is never watered (so one finished plot cannot eat every slot
forever while waiting for T-13.03c's harvest), and with `WATERING_ENABLED` off
the farmer simply never waters — `growth.ts` stays the only file that reads
that flag. Applying a watering is likewise `settleGrowth` then re-stamp, the
same two writes in the same order as `water()` in `service.ts`.

**The exact-arithmetic test asserts through `effectiveGrowthMs`, not against a
number typed into the test.** One onion over its full 8h: the farmer waters at
the first slot, re-waters the instant each 4h window expires, and the only
growth lost is the single cadence gap before the first watering — so
`effectiveGrowthMs(plot, to) === (to - from) - IDLE_ACTION_MS`, exactly. A
second test uses a 7-minute cadence, which does not divide the 4h wet window,
to show the gap is always strictly less than one slot.

**The clock jump is what makes a three-day catch-up cheap.** A farmer with a
wet crop and nothing else to do skips straight to the expiry slot instead of
walking the clock forward 1,440 times per wet window. Termination is not by
luck: each jump either finds work or retires the plot whose deadline it jumped
to, and `Math.max(slot + 1, …)` guarantees forward progress regardless.

**A break-test found a comment that was claiming more than the code did.**
Replacing `Math.ceil` with `Math.floor` in the jump changed no output at all —
landing early is harmless, because the plot is still wet, `chooseAction`
returns null again, and the next jump lands on the right slot. `ceil` is intent
and one saved iteration; the *guard* is `Math.max(slot + 1, …)`. The comment
said otherwise and now says this. Same class of finding as T-13.02's redundant
filter, and the same reason it matters: a line believed to be load-bearing is
one nobody re-checks.

**Contention is pinned exactly, and the behaviour is not what you would guess.**
Under a forced-slow cadence the first four plots take every contested slot —
and then *ripen and stop asking*, at which point the queue reaches the back. So
the later plots finish last rather than never. The test asserts the whole
twelve-hour sequence hour by hour. This state is unreachable with the shipped
constants (4h windows against a 10s cadence would need over a thousand plots;
`MAX_PLOTS` is 20), which is exactly why a fairness heuristic would have been
the wrong build: simple and total beats fair and untriggerable.

**Four of the first five test failures were mine, not the code's** — the
default task set in the test helper omits `water`, and two premises had bad
arithmetic (a crop I claimed was mid-growth was already ripe; a second watering
I expected never happens because the crop ripens at that exact instant). The
fifth, the contention sequence, was a wrong prediction about starvation being
permanent. Worth recording because in each case the simulator was right and the
expectation was wrong — the temptation with a fresh test suite is to assume the
new code is at fault.

`pnpm -r typecheck` and `pnpm test` are green: 1105 tests (134 shared + 137
client + 62 mapmaker + 772 server).

### T-13.03c — Simulator: harvest + bounded catch-up  ✅ **DONE**
Depends: T-13.03b · Size: M
Files: same
**Do:** Harvest ripe plots (top priority), adding produce to the simulated
inventory (respecting stack limits + backpack capacity — reuse `planAdd`
logic or its pure parts); when the backpack cannot fit a harvest, skip
harvesting that plot and record `stoppedReason: 'inventory_full'` once
nothing else is doable. Cap total actions at `IDLE_MAX_CATCHUP_ACTIONS`;
return the virtual time actually reached (`processedTo`) so the applier can
watermark short and continue next read.
**Done:**
- [x] Full-cycle test: till→plant→water→…→harvest→replant across a
      multi-hour window, exact final counts asserted
- [x] Inventory-full and action-cap paths tested; `processedTo < to` when
      capped
- [x] Long-gap determinism (3-day window, 45-min crop) — same output twice

**How it turned out.** Harvest, `inventory_full`, the ripening clock, and a
model change the task did not ask for but could not be done without.

**The simulator's bag had to become SLOTS, not counts.** T-13.03a modelled the
inventory as `Record<itemId, number>`, which is fine for "do I hold a seed?"
and a lie for "does this harvest fit?": how much room a bag has depends on how
its stacks are packed, and a real bag can be fragmented (two half-stacks of one
item, after a drag-and-drop). A count model over-reports room, so the simulator
would decide a harvest fits, pay it out, and the applier's `addItem` would then
refuse it — the simulator being wrong about the one thing it exists to compute.
So `SimItems` is now `SlotContents[]`, the same shape the inventory uses.

**"Reuse `planAdd` logic or its pure parts" became: extract them and share the
identical function.** `inventory/service.ts` gained `planAddToSlots` (the old
private `planAdd`, generalised off database ids), plus `addToSlots`,
`removeFromSlots` and `countInSlots`. The DB-facing `planAdd` is now a thin
mapper from slot index to row id over the same result, so the two paths cannot
drift — the simulator answers "does it fit?" with the exact code the applier
will use to write it. `removeFromSlots` drops emptied slots the way the real
removal deletes their rows, which matters more than it looks: a spent seed
stack frees a slot the next harvest can use, and a simulator that kept the
empty row would under-report the room the farm really has.

**Every ripe plot is tried, not just the first.** A bag with one slot left may
have no room for a stack of onions and plenty for a single potato. Giving up at
the first refusal would strand a harvest that fits — a test with two crops and
one partial stack pins it.

**`inventory_full` is a stop reason of its own**, deliberately not folded into
`nothing_to_do` even though both settle the whole window. It is the only stop a
player can act on, and T-13.08's offline summary needs to say so. It is
reported only when a ripe crop was actually left standing because of the bag; a
farmer who simply ran out of work still reports `nothing_to_do`.

**The full-cycle test failed first time, and the cause was a genuine gap.** The
farmer tilled, sowed, watered — and stopped. `nextOpportunity` only knew that
soil dries; it did not know that a crop RIPENS at a computable time, so with
nothing to do at that instant the simulation declared the window finished 45
minutes before the leek was ready. This is exactly the second branch
T-13.03b's own comment predicted this task would add. Fixed by reading
`growthAt(...).readyInMs` — which is already defined as "watered ms still
needed" — and offering `at + readyInMs` when it lands inside the current wet
window. Past that the soil is dry and the crop is not accruing, so the real
next event is the watering, which the other branch already offers. Same rule as
everywhere else in the file: ask `growth.ts`, never re-derive.

**Resuming from a capped run lands exactly where one long run would have.**
That is the property that makes watermarking short safe, and it is asserted
directly: run to the cap, feed the result back in from `processedTo`, and the
concatenated action logs and final state equal the single-pass run.

**Verified.** 59 tests in the file (14 new), including the full leek cycle with
exact counts — one tilling for three harvests, because harvesting leaves the
soil tilled (§5.2) — and three-day determinism on a 45-minute crop. Seven
break-tests, each restored: harvesting into a bag with no room; giving up at
the first plot that does not fit; folding `inventory_full` into
`nothing_to_do`; demoting harvest below till; clearing `tilledAt` on harvest;
removing the ripening opportunity; and not consuming the seed on plant.

`pnpm -r typecheck` and `pnpm test` are green: 1119 tests (134 shared + 137
client + 62 mapmaker + 786 server).

### T-13.04 — Simulation applier  ✅ **DONE**
Depends: T-13.03c, T-13.02 · Size: M
Files: `apps/server/src/modules/farm/idleApply.ts` (new),
`apps/server/src/modules/farm/service.ts` (hook into farm-state read),
integration tests
**Do:** `applyIdleWork(tx, player, now)`: when `idle_enabled` and
`idle_processed_at < now`, lock farm + plots + inventory (deterministic
order — farm, plots, container; same discipline as trade execution), load
snapshots, run the sim from watermark→now, apply diffs (plot fields,
seed/produce inventory via real `addItem`/`removeItem`, XP via `grantXp` per
harvest), set `idle_processed_at = processedTo`. Called inside a transaction
at the top of the farm-state read and before any farm mutation
(plant/till/water/harvest/idle-settings), so manual and idle work never
interleave stale state. Returns the action summary for T-13.08.
**Done:**
- [x] Integration: state read after N hours shows the sim's exact result;
      concurrent reads apply once (watermark + lock, break-tested);
      mutation-then-read consistency
- [x] Farm read query count still bounded (extend the T-2.11 query-count
      test if it applies)

**How it turned out.** `idleApply.ts`, hooked into the farm read and every farm
mutation, 13 integration tests, and three query-count tests. This is where the
simulator stops being a projection and becomes the farm.

**One deliberate deviation from the Do, and it came from a failing test rather
than from taste.** The task says to call the applier "inside a transaction at
the top of the farm-state read and before any farm mutation". Folding it into
the *same* transaction as the mutation is what I built first, and the
manual-harvest test caught what that produces: the farmer picks a plot during
the catch-up, the player's manual harvest then fails with `PLOT_EMPTY`, and the
failure rolls the catch-up back with it — so the error describes a plot that,
once the dust settles, still has a crop in it and produce that never arrived.
`catchUpIdle` now runs in its own committed transaction immediately before the
action. Nothing is lost by splitting: the ordering that matters is that the
catch-up lands *before* the manual action reads anything, and a committed
transaction is more firmly before than an uncommitted one. A request slipping
in between is fine — the applier is idempotent against its own watermark and
the manual action locks whatever row it touches.

**Idle mode is free for players who have not switched it on, and that is
pinned.** `idleWorkPending` is answered from the farm row `getFarmState`
already reads, so the poll stays at exactly six queries. The obvious
implementation would have added a lookup, which is why there is now a test
asserting the idle-disabled count is unchanged, one asserting the applying path
*does* open a transaction, and one asserting that a farmer with nothing to do
settles its window and the next poll is back to six. That last one matters: a
watermark that only moved when work happened would mean an idle-enabled farm
paying for a transaction on every single poll forever.

**Items move through the real `addItem`/`removeItem`, never by writing the
simulated bag down.** The simulator's slot layout exists to answer "does it
fit"; replaying it as truth would make the simulator the authority on how much
a player owns, and any disagreement with the live rules would be a dupe. Going
through the real functions enforces capacity and stack limits once, in the code
that owns them — and because the simulator asked the same `addToSlots` before
deciding, the two agree. Seeds are removed before produce is added, which is
the order the simulator assumed when it decided a harvest fit a nearly-full bag.

**Quantities are priced from config using the crop each action recorded**,
which required a small change to the simulator: `SimAction` now carries the
crop it moved. Reconstructing it in the applier was the first attempt and is
wrong for the case the whole feature exists for — over a long window a plot is
harvested, replanted and harvested again, and an applier reading the plot's
final state would price the first harvest as whatever was growing at the end.

**Lock order is farm → plots → inventory**, the same discipline trade execution
follows, with the inventory taken as both containers in one statement
(`lockBothContainers`) so there is no ordering question inside it. The farm row
is re-read under its own lock rather than trusted from the caller's earlier
look, because between that read and this lock another request may already have
done the work — and its watermark is the one that counts. The watermark is
written LAST, so a failure anywhere above rolls the whole shift back and the
window is simply re-simulated on the next read.

**Three of my own tests were too weak to be evidence, and the break-tests are
what said so.** Recorded because each failure mode is one that looks fine in
review:

1. *A tautological concurrency assertion.* It checked `seeds === 10 - sown`,
   which balances whether the shift ran once or twice. Replaced with one ripe
   crop and harvest-only orders, where a double-apply means double produce and
   double experience.
2. *A cap test that never reached the cap.* Sowing runs out of seeds long
   before 5,000 actions, so `processedTo` and `now` were indistinguishable and
   swapping them broke nothing. The replacement uses recurring work — plots
   whose snapshotted duration means they never ripen, watered across ninety
   days — and now fails when the watermark is written as `now`.
3. *Fixtures picking plots from an unordered `SELECT`.* `const [plot] = await
   plots()` was sometimes landing on a LOCKED plot, which the simulator
   correctly ignores; a fixture that picks at random tests something different
   every run. There is now a `workablePlots()` helper that orders by (y, x).

**And a measured finding that contradicted my guess.** Breaking either lock
alone left all sixteen tests passing, which first looked like the tests being
weak again. It is not: the farm-row lock and the plot lock are **individually
redundant and jointly necessary**. Whichever survives serialises the two
transactions on its own, and the loser then re-reads a farm whose watermark has
moved or a plot whose crop is gone. Removing BOTH fails four tests with the
crop paid out twice. I had predicted the plot lock was the load-bearing one;
it is more accurate to say neither is, individually. Both stay — the redundancy
is free — and the code and test now say this explicitly, because "no test
covers this lock" is exactly the observation that gets one deleted.

Proving it also needed a better test: two `inject`ed polls do not reliably
overlap inside the critical section, so the HTTP-level concurrency tests could
not see a missing lock at all. Driving `applyIdleWork` from two `db.transaction`
calls guarantees the overlap, and that is the test the break registers against.

**Verified.** 16 integration tests through the real endpoints plus the direct
concurrency one: the read shows the post-shift state, four hours away turns
into produce and experience in exactly the amounts the crop table prices,
harvested soil stays tilled, a full bag leaves the crop standing, a ninety-day
absence stops at the cap and resumes next read, and a six-way stampede pays out
once. Break-tests, each restored: both locks (together and separately), writing
`now` instead of `processedTo`, not writing the watermark at all, skipping the
XP grant, not calling the applier from the farm read, and never removing the
seeds.

`pnpm -r typecheck` and `pnpm test` are green: 1138 tests (134 shared + 137
client + 62 mapmaker + 805 server).

### T-13.05 — Idle state in the view  ✅ **DONE**
Depends: T-13.04 · Size: S
Files: `apps/server/src/modules/farm/service.ts`,
`packages/shared/src/types/index.ts`
**Do:** Farm state gains `idle: {enabled, tasks, cropId, nextAction:
{kind, plotId, at} | null}` — `nextAction` computed by running the sim one
step forward from now (pure, cheap).
**Done:**
- [x] `nextAction` matches what the next applier run will actually do
      (asserted by advancing time in a test)

**How it turned out.** `nextIdleAction` in `idleSim.ts` is the whole feature:
`simulate` with `maxActions: 1`, taking `actions[0]`. Running the real
simulator rather than a "what looks doable" re-derivation is the point — a
second opinion about the farm would have the client animate a tool swing the
applier then declined (§4.4).

**Two clocks, not one, and they are different clocks.** `from` is the
watermark, because action slots sit on a grid anchored there (`from +
k·IDLE_ACTION_MS`); predicting off anything else puts every `at` on the wrong
phase, which is exactly what T-13.07 will animate against. The lookahead
*window*, though, is measured from `now`: a farm with a long backlog has a
watermark days behind, and measuring four hours from there would spend the
whole horizon on time that has already happened. Both are pinned by tests, and
both fail when broken.

**The watermark is read AFTER the shift the same request applied.**
`getFarmState` already runs the catch-up before reading plots, so it now keeps
the watermark that shift left (`summary.to`) instead of the pre-shift value it
read a moment earlier. The one case that cannot be resolved cheaply is a race —
a concurrent request having already done the work makes `applyIdleWork` return
`NOTHING` with `to: 0` — and there the stale watermark stands: the plots are
still post-shift so the *action* is right, only its `at` is off, and the next
poll corrects it. Documented at the call site rather than papered over.

**`LOOKAHEAD_MS = WATER_DURATION_MS + IDLE_ACTION_MS`, and that bound is
provable rather than picked.** `nextOpportunity` offers exactly two kinds of
instant — soil drying, and a ripening that lands inside the same wet window —
and because the search stops at the first action, no plot's `wateredAt` moves
while it runs, so the candidate set is fixed at the start. One wet window plus
the slot the cadence rounds up to therefore cannot hide an answer. A test pins
that the action found is genuinely the one a full `simulate` over that span
returns.

**Cost: one query, charged only to a farmer with orders.** The lookahead needs
the backpack (a plant needs a seed, a harvest needs somewhere to put the
produce) and that is the only thing the farm read did not already have — the
farm row and the plot rows are reused, and `capacityForPlayer` is free for the
bag since T-10.03. Idle-off and no-chores short-circuit before the query, so
the hottest path in the game stays at six for anyone who never touches the
feature; a working farmer is seven. All three numbers are pinned in
`farm.queries.test.ts`.

`IdleView` is deliberately not `IdleSettings`: the watermark is the catch-up's
business, and `nextAction` is narrowed to `{kind, plotId, at}` — the simulator
also knows which crop an action moves, and that is a plan the player has not
acted on (§4.1). Asserted over the wire, not just off `getFarmState`.

**Verified:** break-tested all three new guards, each restored — predicting
from the pre-shift watermark fails the grid-phase test, measuring the horizon
from `from` instead of `now` fails the backlog test, and dropping the
no-chores short-circuit fails the query count. `pnpm -r typecheck` and
`pnpm test` green: 1156 tests (134 shared + 137 client + 62 mapmaker + 823
server), up 18.

**Found and fixed en route, unrelated to this task:
`CHAR_DIRECTION_ORDER` was red.** `config.test.ts` pinned `[down, up, left,
right]` while `assets.ts` held `[down, up, right, left]`; two shared tests had
been failing. See the correction appended to T-7.03 — `assets.ts` was right
and this roadmap's own write-up was wrong.

### T-13.06 — Idle toggle UI  ✅ **DONE**
Depends: T-13.05 · Size: M
Files: `apps/client/src/game/idlePanel.ts` (new), `apps/client/src/game/hud.ts`,
`apps/client/src/net/farm.ts`, `apps/client/src/styles/hud.css`
**Do:** HUD switch + popover: enable toggle, task checkboxes, crop dropdown;
calls `PUT /api/farm/idle`. While enabled: movement keys ignored, banner
"Idle mode — your farmer is working", switch turns it off instantly.
**Done:**
- [x] Toggle round-trips; manual input dead while enabled; settings persist
      across reload

**How it turned out.** An `Idle` button on the bar opens a popover — the
switch, the four chores, a crop dropdown with a "Nothing" row — and every
change PUTs the *complete* settings, because the endpoint replaces rather than
merges. A green banner under the bar carries the message and a **Stop**, which
is the "turns it off instantly" path: the farm is not the player's while idle
runs, so giving it back must never be more than one click away and must not
require opening anything.

**The lock follows the server, never the checkbox — the one rule this task is
really about.** Switching idle on takes the character away from the player, so
`enabled` in the panel is only ever assigned from a server response: the PUT's
own answer, or the farm poll's. The optimistic version was written first and is
wrong in a way that has no recovery inside the game — a refused or dropped
request would lock a player out of their own farm with no farmer working to
show for it, and only a reload would clear it.

**Settings survive a reload with no fetch of their own.** T-13.05 put the
standing orders on every farm read, so the poll the game already makes is what
seeds the panel *and* re-applies the lock, before the player has touched
anything. Break-tested: drop `hud.setIdle(state.idle)` from the poll and a
reload comes back with every box clear and no banner.

**Manual input dies in two different places, deliberately.** Movement is
`readInput()` returning `NO_INPUT` — the same shape as the existing typing
guard, feeding `step` rather than skipping it so a character caught mid-stride
is brought to a stop instead of freezing. The action key is refused in `act()`
with a toast, rather than by unbinding: one handler serves both the key and a
click on the faced tile, and a player who taps it deserves to be told why
nothing happened. Both are UX gates only — the endpoints stay open, and manual
and simulated work still cannot interleave, because every farm mutation runs
the catch-up first in its own committed transaction (T-13.04).

`idleBody` is the pure half and the only unit-testable one: it rebuilds the
task list from `IDLE_TASK_TYPES` rather than from checkbox order, which gets
config order and **deduplication** for free — `idleSettingsSchema` refuses a
repeated task outright rather than collapsing it, so a form that could emit one
would fail the whole save.

**Verified:** driven end to end in a real browser (register → walk → enable →
try to walk → try the action key → reload → Stop → walk again): banner up, bar
reads `Idle · on`, feet do not move, action key answers "Your farmer is
working…", the reload comes back enabled with till+water still ticked and the
character still locked, Stop clears it and walking works again, no console
errors. Break-tested both guards and restored each — removing the `readInput`
lock lets the character walk while idle runs; removing the poll's `setIdle`
loses the settings across a reload. `pnpm -r typecheck` and `pnpm test` green:
1163 tests (134 shared + 144 client + 62 mapmaker + 823 server), up 7.

**Note on browser verification.** The Playwright MCP server is configured
without a `--browser` argument, so it defaults to the `chrome` channel, which is
not installed here (only `/usr/bin/chromium` and Playwright's own bundled
chromium are). Verification ran through Playwright's Node API against the
bundled chromium instead — `scripts/` was left alone; the driver lived in the
session scratchpad. Also worth knowing for the next task: `POST
/api/auth/register` is capped at **5 per hour per IP**, which a few
verification runs exhaust — log in to an existing account rather than
registering a fresh one each time.

### T-13.07 — Visual replay  ✅ **DONE**
Depends: T-13.06, T-8.09 · Size: M
Files: `apps/client/src/game/entities/idleReplay.ts` (new, pure walk-plan +
test), `apps/client/src/game/scenes/Farm.ts`
**Do:** While idle is on, the client drives the character cosmetically: walk
(straight-line, existing speed) to `nextAction.plotId`, arrive before
`nextAction.at`, play the matching tool animation at `at`, then poll/refresh
picks up the new state and the next action. Late/desynced? — snap by walking
to the newest `nextAction`; the server is always right (§4.1). Pure module
computes the walk plan (departure time from distance/speed) and is tested;
the scene just executes it.
**Done:**
- [x] Watching idle mode shows the character continuously working the field
- [x] Tab-hidden → return resyncs without drift (state came from the server
      the whole time)

**How it turned out.** `idleReplay.ts` is pure and Phaser-free, and the scene
does nothing but execute it: plan when the named action changes, feed the
character four booleans each frame, swing at `at`.

**The character is driven through `MoveInput`, not moved directly.** The replay
returns the same shape a keyboard produces and `Player.readInput` returns it
*instead of* the keys while locked — so there is never a frame where the player
and the farmer are both steering, and the walk gets `step`'s speed, diagonal
scaling, facing rule and bounds clamping for free rather than a second way to
move a character. Two small additions carry it: `setDrive`, and `face()` for
the arrival, because `step` only updates facing while there is input.

**Travel time is the OCTILE distance, not the Euclidean one.** Boolean steering
means the character moves diagonally while both axes have ground to cover and
straight after that, and `step` scales a diagonal by `SQRT1_2` per axis — so a
dog-leg costs `(√2·min + |Δ|)/speed`. Timing it as a straight line would send
the farmer off late every time it had to turn a corner. Asserted by walking the
route for real through `step` and comparing, not by trusting the algebra.

**The stopping threshold is the frame's own travel distance, passed in.** This
is the one that had to be got right rather than reasoned about: a fixed epsilon
smaller than one frame's step makes the character overshoot, get told to come
back, overshoot again — jittering on the spot forever — and one larger stops it
visibly short. Comparing against `frameDistance(delta)` stops it within a
fraction of a pixel at any frame rate, and `frameDistance` reuses `step`'s own
`MAX_STEP_MS` cap so a backgrounded tab's multi-second delta cannot produce a
threshold wider than the farm.

**The farmer works from BESIDE a plot, never on top of it**, because that is
what the manual loop does — `facedTile` acts on the tile in front, so a
character stood on its own plot would be hoeing its feet. The side is whichever
one it is already nearest, chosen once when the job changes: re-planning every
frame lets the chosen side flip as the character walks past, and the farmer
orbits its target instead of reaching it.

**Departure is derived backwards from the deadline** (`at - travel - 250ms`),
per the task. Worth being honest about what that looks like: with
`IDLE_ACTION_MS` at 10s and plots adjacent, the character is stationary about
93% of the time either way — the pause is the cadence, not the plan. Deriving
the departure at least puts the walking immediately before the work instead of
leaving the character parked on a plot for eight seconds. A past `departAt` is
not an error: a backlogged farm has actions dated behind `now`, and the honest
answer is "set off now and arrive when you arrive".

**Tab-hidden is trivial rather than hard, and that is the design paying off.**
There is no local simulation to drift — the client keeps no score at all. A tab
that slept polls on wake and is handed a fresh `nextAction` describing a farm
the server advanced on its own; the character walks to whatever that says.
"Snap to the newest action" falls out of rebuilding the plan when the action
changes, with no reconciliation code.

`swingFor` grew a `swingForKind` sibling so the replay can ask "which strip
does this verb have" without assembling a fake `FarmIntent` or keeping a second
copy of the answer. Plant and harvest still have no animation (T-8.09 measured
what the pack ships); the character walks over and the plot changes.

**Verified:** watched in a real browser for a full minute. The character visits
four distinct jobs, never once stands on the plot it is working (0 of 250
samples) and stands beside it facing it (35 samples), plots go untilled →
tilled → planted, and sampling five times a second catches it mid-swing 10
times and mid-walk 8. Tab hidden for 25s then focused: the resync comes back
with a new server-named action and the plot counts moved while the tab was
dark. Clock offset within 5s, no console errors. Screenshots confirm the
faced-tile highlight sits on the plot above the character.

Break-tested three guards, each restored: a fixed epsilon instead of the
frame's travel (the character oscillates forever), Euclidean instead of octile
travel time (the walk and its prediction disagree), and `tileCentre` instead of
the tile's ground line. **The third one exposed a weak test rather than a
bug** — `standingTile` reports the same tile for either point, so the
round-trip assertion passed under the break. The geometry is now pinned
exactly, with a note saying why the round-trip is necessary and not sufficient;
the doc comment that claimed the wrong failure mode was corrected too.

`pnpm -r typecheck` and `pnpm test` green: 1188 tests (134 shared + 169 client
+ 62 mapmaker + 823 server), up 25.

### T-13.08 — Offline progress summary  ✅ **DONE**
Depends: T-13.04 · Size: S
Files: `apps/server/src/modules/farm/service.ts` (surface the applier
summary on the read that applied it), `apps/client/src/game/scenes/Farm.ts`
**Do:** When a farm-state read applies > 0 idle actions, the response
includes `idleSummary: {harvested: {itemId: n}, planted: n, watered: n,
tilled: n, window: {from,to}}`. Client toasts it once ("While you were away:
…") when the gap exceeds ~a minute.
**Done:**
- [x] Summary exact against a seeded scenario; shown once, not on every poll

**How it turned out.** `FarmState.idleSummary` is null on almost every poll and
carries `{tilled, planted, watered, harvested, window, bagWasFull}` on the one
read that applied a shift. The client turns it into a toast through
`idleSummaryMessage`, a pure function with the wording and the threshold in it.

**"Shown once" is a property of the protocol, not a flag.** The read that
applies the shift settles the watermark, so the next read has nothing pending
and nothing to report — there is no "already shown" state on either side to get
out of step. Break-tested by removing the watermark write: the once-only test
fails alongside three older ones, which is the right blast radius for deleting
the thing the whole feature rests on.

**The client's minute-long threshold is what stops it becoming a nag.** The
catch-up fires whenever a whole `IDLE_ACTION_MS` has passed, so a player
sitting and *watching* their farmer generates a summary on every twenty-second
poll. Those are not absences. The gate lives on the client because it is a
presentation decision — the server's answer stays factual and the client
decides what is worth interrupting someone about.

**Two things the tests found rather than confirmed.** First: `harvested` came
back empty from a forty-minute seeded scenario, because a leek needs
forty-five. The fixture now uses four hours, which is the absence the feature
is actually for. Second, and a real gap: the summary was gated on
`actions > 0`, so a shift that did **nothing because the bag was full** was
silent — the single case where the player could have done something about it,
and the reason `idleSim` distinguishes `inventory_full` from `nothing_to_do` at
all. The gate is now `actions > 0 || stoppedReason === 'inventory_full'`, and
`bagWasFull` is reported as a boolean rather than leaking the simulator's stop
vocabulary.

Harvests are named and chores are counted, deliberately: plots watered is
progress, things picked is loot, and the player wants to know it was four leeks
rather than four somethings. Item names come from config, sorted by id so the
same haul reads the same way twice.

**Verified:** in a real browser with a four-hour backdated watermark, a
`MutationObserver` watching every toast for the whole session — one toast on
load ("While you were away: tilled 6, planted 18, watered 18, picked 18 ×
Leek."), then three further polls over 65s with **no repeat**. Total summary
toasts: 1. No page errors.

Break-tested four guards, each restored: gating on `actions > 0` alone (the
full-bag case goes silent), skipping the applier's `idleWorkPending` check,
dropping the client's minimum gap (a watching player gets toasted), and
removing the watermark write.

`pnpm -r typecheck` and `pnpm test` green: 1206 tests (134 shared + 181 client
+ 62 mapmaker + 829 server), up 18.

---

## Phase 13 complete — and with it, this roadmap

T-7.01 through T-13.08 are all done. Every task in this file is ticked; the
Stardew pivot is finished, idle mode included.

What is deliberately still off is listed at the top of this file and unchanged:
the trade and VIP UIs (server code green and untouched), furniture and the
Interior scene, and every system the art supports but the MVP does not
(chopping, mining, fishing, combat, energy, day/night, seasons). Those were
sketched as "Phase 14" in prose but were never broken into tasks, so there is
nothing here to pick up next — re-enabling any of them starts with writing the
tasks.

---

# Phase 14 — Backlog (carried from v1)

Not scheduled; pull items up when the MVP above is done.

- **T-14.01** — VIP benefits applied to the new loop (bulk actions,
  idle-speed?) — old T-5.06, needs redesign against idle mode
- **T-14.02** — VIP UI (buy button, expiry display) — old T-5.07
- **T-14.03** — Re-enable Trade UI on the new HUD (server never stopped
  working)
- **T-14.04** — Re-enable furniture/Interior with new-pack interior art
- **T-14.05** — Chopping (axe tool, maple drops wood) + idle task `chop`
- **T-14.06** — Economy tuning from real data — old T-6.01
- **T-14.07** — Anti-bot measures — old T-6.02
- **T-14.08** — Scheduled jobs (only if D-2 decides withering on) — old T-6.03
- **T-14.09** — Sound — old T-6.04
- **T-14.10** — Onboarding/tutorial — old T-6.05
- **T-14.11** — Accessibility & polish pass — old T-6.06
- **T-14.12** — Real ToS/Privacy (RMT-unsupported clause) — old T-0.10
- ~~License audit~~ — resolved by T-7.01 (licensed pack + attribution)
