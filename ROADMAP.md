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

All art comes from the licensed pack at **`assets/`** (EmanuelleDev — credit
mandatory, see `ATTRIBUTION.md`). **Phase 7-31 write-ups below say
`new_assets/`; that is this same directory under its old name.** The pack was
reorganised before the MVP re-scope and took back the `assets/` path, which in
v1 held an unlicensed stand-in set that Phase 7 deleted. See CLAUDE.md §9.

## What is deliberately NOT in this roadmap

- **Trading UI and VIP UI** — server code and tests stay green and untouched;
  the buttons come off the HUD (T-11.05) and re-enabling is a Phase 14 item.
- **Furniture / the Interior scene** — hidden for MVP; server code stays.
- **Chopping, mining, fishing, combat, seasons** — the art supports all of
  them; none are MVP. Idle mode's task list is designed to grow into them
  later. **Energy and day/night were on this list until the MVP re-scope
  (2026-09-08) moved them into it** — see Phase R at the end of this file.

---

## Open Decisions

Track these; do not let them be silently decided in code. (Numbering
continues from v1; D-1 is now decided.)

| # | Decision | Status | Where it lives |
|---|---|---|---|
| D-1 | Watering mechanic | **DECIDED and LIVE** since T-9.03b: required; growth pauses while soil is dry; watering wets soil for `WATER_DURATION_MS`; never kills a crop | `packages/shared/src/config/crops.ts` (`WATERING_ENABLED = true`; kept as a one-line revert, both branches tested) |
| D-2 | Withering (crops rot if unharvested?) | Open. Punishing for an idle game; would need the first scheduled job (§4.2) | `WITHERING_ENABLED = false`; `plots.withered_at` stays reserved |
| D-3 | Is gold tradeable between players? | Open. Cleanest RMT vector; safe default off | `GOLD_IS_TRADEABLE = false` in `config/economy.ts`; a test pins it |
| D-4 | Tool tiers | Open, and **scheduled to be answered by T-36.07**, which is the first task that gives tiers a way to be *made* rather than bought. Art has 9 tiers (Wood→Obsidian); only Wood exists. The question is unchanged — what does a better tier do? **The recommendation carried into T-36.07 is area (a 3x3 watering can) plus an `IDLE_ACTION_MS` reduction, and explicitly NOT speed**: the swing animation is the client's only action cooldown and the thing covering request latency, so shortening it makes the game feel worse rather than better. Must be recorded as decided before it is built | Only `*_wood` tool items exist until decided; T-36.07 |
| D-5 | Energy/stamina | **DECIDED (MVP re-scope, 2026-09-08): YES**, live since R-5. The Phase 30 recommendation below was to close it as "no"; it is kept because the reasoning is what sized the bar — a new farm can work every starting plot exactly once, and recovery is ten real minutes, not a real day, so the bar ends a session rather than a day. Idle mode spends it too — and **since U7-2 sleeps to refill it rather than stopping**, so for the idle farmer the bar is a ~25% duty cycle, not a wall. *The superseded recommendation:* The gameplay overhaul's whole premise is that active play should be where depth lives, and a stamina bar is a mechanic for *stopping* people playing — in a game whose §1 pillar is short frequent sessions, it punishes the exact behaviour the overhaul is trying to encourage. Fishing (Phase 34) and mining (Phase 36) make this sharper, not softer | `packages/shared/src/config/energy.ts`; `players.energy_spent` / `sleeping_since` |
| D-29 | Does the game bundle a typeface? | **DECIDED (Phase U): YES** — **three since Phase U3**, all SIL OFL 1.1, self-hosted. `hud.css` had refused one on the grounds that it "would mean a second licence in ATTRIBUTION.md for a decision nobody has taken yet"; the decision was taken. Pixelify Sans for body, Silkscreen for uppercase labels, and **Bitter for paragraphs** — U3 put the faces on the marketing pages too, and neither pixel face can set body copy: both are drawn on fixed grids (10px and 8px) and only stay crisp at integer multiples, while a landing-page paragraph reflows at every viewport. A slab was chosen because a slab's serifs are rectangles and so are pixels. Self-hosted rather than linked: a Google Fonts `<link>` hands every player IP to a third party and puts a render-blocking request in front of the game | `apps/client/public/fonts/` (+ `README.md`, both `OFL.txt`); `@font-face` in `styles/ui.css`; `config/credits.ts` |
| D-30 | Where does nine-slice geometry live? | **DECIDED (Phase U): in `scripts/lib/ui-crops.mjs`, and nowhere else.** Not in `assets.ts` — every UI frame is consumed by CSS, never by Phaser's loader, so adding them to `IMAGES` would burn Tiled `firstgid`s for assets Phaser never draws. Three checks keep the one copy honest: `measure-ui.mjs --check` re-derives every inset from the pixels, `prepare-assets.mjs` decodes each crop it writes, and `uiSlices.test.ts` compares the stylesheet to the table | `scripts/lib/ui-crops.mjs`; `docs/ui-measurements.md` |
| D-6 | Chest placement | Open. MVP has one fixed chest on the map. Placeable/multiple chests later? | Single chest object in `farm.json` |
| D-7 | Doorways: walk-through gap, or faced-tile trigger? | **DECIDED (Phase 16): trigger**, as proposed. Buildings stay solid at every tier, no gap — a gap in a building is a hole you can walk into and not leave, which is worse than no door. The door becomes a `facedTarget()` entry like the chest. Opened by T-15.05, settled by T-16.11 | `config/collision.ts` — `HOUSE_DOOR` |
| D-8 | Does the idle farmer get real pathfinding? | **Proposed: no.** Straight-line octile + a test proving every plot approach is reachable through the real block map + a runtime unstick. Replay is cosmetic (§4.1), so the honest failure is "the farmer clipped a corner", not "the farm stopped". Opened by T-15.09 | `reachability.test.ts`, `REPLAY_STUCK_MS` in `Farm.ts` |
| D-9 | Is placed decor solid? | **Proposed: per-def `solid`**, guarded server-side by two rules — no solid piece orthogonally adjacent to a plot, plus a flood-fill reachability check. Without the flood fill, everything should be non-solid. Opened by T-15.16 | `DecorDef.solid`, `modules/decor/reachability.ts` |
| D-10 | Do chicken sheet rows 0–2 encode facing, or cosmetic variation? | **DECIDED by measurement (T-15.10): cosmetic variation.** Three independent tests agree — no row is any other row mirrored, every row's frame 0 differs from its own mirror by 70–75%, and every row measures 13–14px wide. They are three look-angle variants of one side-facing pose. A chicken facing right is that row with `setFlipX`; facing up or down reuses it. **Cows are the opposite** and the same width test proves it: rows 1/2 measure 13px against row 0's 22px, so they carry real front and back views | `ANIMAL_CHICKEN_MIRRORS_SIDE = true`, `ANIMAL_CHICKEN_FACING_ROWS = null`, `ANIMAL_COW_POSE_ROWS`; `poseRowFor` is the only reader |
| D-11 | One placement table with a `surface` column, or two? | **Proposed: two.** Pre-launch migrations are free; the house module is dead code (unregistered since T-11.05) and its 203 tests prove the transactional *shape*, which T-15.18 copies, not the *config*, which is a known-broken placeholder | `decor_placements` vs `furniture_placements` in `db/schema.ts` |
| D-12 | Camera: fit-whole-map, or follow-with-deadzone? | Open for the FARM. Fit-map today. An idle game benefits from seeing the whole farm; a follow camera is a bigger feel change than it looks. **T-16.12 gives the interior its own rule** — `fitCamera()` picks an integer zoom from the map size, and a one-room map would zoom enormously — but that is a second map's camera, not an answer for this one. **T-18.03 (2026-09-04) made the fit honest without answering this**: it targets the map minus its decorative frame and reserves both HUD bars, which recovers zoom 2 on 1366x768. Still fit-map, so the question is unchanged — and 1280x720 is the case that now needs it, since twenty tile rows cannot fit above a hotbar on a 720px screen at zoom 2 no matter how small the chrome gets | `Farm.fitCamera()`, `game/camera.ts` |
| D-14 | Are animals solid? | **DECIDED (T-15.08): no — livestock is walk-through.** The plan said they should block their home tile. They must not: the coop yard is 5x3 on 1x1 spacing and the largest possible flock is exactly 15, so a full coop fills every slot and the three chickens in the middle row would be enclosed by other chickens — unreachable, therefore permanently unfeedable, with nothing the player could do. Cows are fine (2-tile spacing), which is precisely the trap. Costs a little realism; buys a farm that cannot lock you out of your own animals | `Farm.syncAnimals` populates no `animals` block layer; the `D-14` block in `collision.test.ts` pins the finding |
| D-15 | Do chickens roam tile-to-tile like the cows will? | **DECIDED (Phase 16): no — chickens stay in their tile and get a behaviour routine instead.** The same measurement that settled D-10 settles this: every chicken row is an upright idle with a 1px breathing bob, so the sheet carries **no walk cycle** and a translating chicken would be *sliding*, not walking. What it does carry is peck, deep-peck, nest and lie-down rows that nothing has ever played. Cows are the opposite — row 0 is a genuine 4-phase leg alternation with separate front and back views — so they roam and the chickens get a routine. A yard where some birds peck, one settles and two look around reads as alive without a single frame of dishonest motion | `ANIMAL_CHICKEN_POSE_ROWS` drives a state machine in `animalWander.ts`; `ANIMAL_COW_POSE_ROWS` drives a walk. T-16.04 and T-16.05 |
| D-16 | Does facing a roaming cow target the sprite, or its home tile? | **DECIDED (T-16.06): the sprite.** The rule is "the tile the player can see it on", which is unchanged for a chicken (it never leaves its slot) and follows a cow. Safe only because the roam is VERTICAL: cow slots are 2 tiles apart horizontally and no cow moves sideways by a whole tile, so two can never answer on one tile — proved at full occupancy against the worst-case world, not argued. D-14 still stands, so a roaming cow cannot pen the player in | `Animal.lastTile`, written by `update()` and read by `bounds()`; the three guards live in `reachability.test.ts` |
| D-17 | Where do the interior room bounds come from? | **DECIDED (T-16.10): the authored map.** `interiorLayout.ts` holds the room the way `farmLayout.ts` holds the farm, `generate-interior.ts` paints from it, and `interiorMap.test.ts` pins the committed map to it. The old reason for a drawn rectangle — "no floor or wall tiles anywhere in the pack" — was true of the OLD pack only; `TILESET_HOUSE` is 52x24 tiles of walls, floors and door frames. `INTERIOR_ROOM` still exists as the server's validation bound and T-16.13 derives it | `packages/shared/src/config/interiorLayout.ts`; `apps/client/public/tilemaps/interior.json` |
| D-13 | Is `generate-farm.ts` the authority for `farm.json`, or is the committed map? | **DECIDED (T-15.00): the generator wins.** It is taught to paint the shoreline and grass variation it could not, using the mapmaker's own autotile/terrain tools, and then reproduces the committed map. Rationale: T-15.28 has to author the map from code anyway, and a map only editable by clicking is a map this project cannot regenerate. The stray painted soil field at (12..16, 4..7) is **deleted** rather than kept — T-9.04 already decided plot cells are grass and soil is server state, so it was a pre-T-9.04 leftover with no plots under it | `apps/mapmaker/scripts/generate-farm.ts` is the source of truth; `farmMap.test.ts` pins the result |
| D-18 | Does the first session need more than an explanation? | **DECIDED (2026-09-08, T-31.05): option (a), a fast starter crop.** F-1 measured a **42-minute hole at 0:03** — six plots planted in three minutes, then nothing until leek ripened at 0:45. Three fixes were costed: **(a) a fast starter crop**, **(b) a mature starting hen** (a 400g gift and a new faucet), **(c) a first-harvest milestone reward** (also a faucet, and it pays at 0:45 when the hole has already passed). (b) and (c) both add gold to a problem that is not about gold, so the recommendation was (a) or nothing. **The objection to (a) was never the crop — it was the `SHEETS` entry, gid shift and map regeneration it dragged behind it, and T-31.02 paid that cost once for sixteen crops.** `STARTING_ITEMS` is now 4x parsnip (12 min) + 2x leek (45 min): the loop closes at **0:15**, so the hole is **12 minutes**, and the leeks are the first reason to come back. Two things the decision also settled: the opening is deliberately **poorer in gold** (kit goods 180g -> 64g, one-hour position 746g) because the constraint is plots and time, not gold; and the hole **cannot be closed entirely** — `xpForDuration` pays a whole XP for any crop under `XP_PER_UNIT_MS`, so a sub-5-minute crop would beat every other crop on XP per hour and XP is the anti-alt control behind `TRADE_MIN_FARM_LEVEL`. `level.test.ts` enforces that floor. The attention half was answered separately by Phase 30's goal board | `docs/economy.md` "The first session, minute by minute"; `STARTING_ITEMS`; `level.test.ts`; T-31.05, T-30.09 |
| D-19 | Is mobile in scope? | **OPEN — the layout half is fixed, the input half is a product call (T-18.23).** Measured at 390x844: the HUD bar needed **842px of content in a 390px viewport**, putting *Bag, Decorate, Idle, VIP, Sound* and *Log out* off screen — including the only way to log out — and it overflowed a **768px tablet** too. That was a bar that did not fit its own viewport, not a mobile question, and it now wraps. What remains is structural: **the game is keyboard-only.** `bindKeys` drives movement, `E`/`Space` act, number keys pick a hotbar slot, and the single `POINTER_DOWN` handler in the whole client buys a plot — so on a touch device the character cannot be moved at all. Supporting mobile means designing a **new input mode** (virtual stick or tap-to-move, an action button, tap hotbar selection), which also has to answer §5.1's rule that actions happen on the tile the character FACES — tap-to-move and face-to-act are not obviously compatible. **Note the tension:** `index.html` markets *"plant before work, harvest at lunch"*, which invites exactly the device that cannot play. Until it is settled, a coarse-pointer narrow viewport is told the game needs a keyboard rather than left to conclude it is broken | `.hud__needskeys` in `hud.css`; `Player.bindKeys`; `Farm` POINTER_DOWN |
| D-23 | The VIP bulk actions were advertised and unimplemented — build, or withdraw the claim? | **DECIDED (Phase 24): build them.** §5.1's "only the character farms" rule is about where the game's verbs live and is a client-side UX gate in any case (§4.1); a paid convenience button is the same intents, batched, not a second farming path. Withdrawing the claim was the alternative — idle mode already harvests and collects free for everyone — but that resolves a broken promise by taking it away, which is right only when the promise was a bad idea | `VIP_BENEFITS.bulkHarvest`/`autoCollect`; `farm/harvest-all`, `animals/collect-all`; the `Gather all` button |
| D-24 | What is the touch input model? | **DECIDED (Phase 28): a virtual stick, not tap-to-move — and the reason is that a stick changes nothing else.** `Player.readInput` returns five booleans, and every rule downstream is built on them: `movement.step` resolves per axis, facing derives from the direction walked, `targeting.ts` aims from facing. A stick produces exactly those five booleans, so a finger and a keyboard arrive at the same place and §5.1's "acts on the tile the character FACES" holds with no new rule. Tap-to-move cannot say that: it needs a path (D-8 chose no pathfinding) and must invent an answer for what the character faces on arrival — a second targeting model, for touch users only, which is how a game gets a bug that exists only on phones | `game/touchInput.ts` (pure, tested), `game/touchControls.ts` (DOM), one merge in `Player.readInput` |
| D-20 | How does a tier-2 house fit above the border row? | **DECIDED (2026-09-04): (a) — the anchor stays where it is and the tier-2 roof may take the border row.** The alternatives both cost more than the row is worth: a shorter tier-2 house removes the only size step in the ladder (tiers 0 and 1 are both 8x6; only `8.png` is 8x7), and growing the map a row at the TOP renumbers every Y coordinate, moving every plot on every existing farm — the landmine T-15.00 found. Keeping the anchor costs the border row **only at the top tier**, and in practice barely that: 109px bottom-anchored at y=112 uses 3 of row 0's 16 pixels, so the fringe still reads. Implemented in T-17.06 |
| D-25 | What is a season worth? | Open, and it has two halves. **(a) `SEASON_LENGTH_MS`.** Too short and a season is a costume change nobody plans around; too long and a player whose best crop is out of season spends weeks on a worse farm. T-35.09 produces the number this needs by modelling the worst-case rotation — if a boundary halves a player's g/hr, the length is wrong or the season sets are too narrow. **(b) do out-of-season seeds stay tradeable?** The safe default is yes, and T-35.04 ships that: taking held seeds away at a boundary would be destruction by absence, which is the one thing this game's design language (D-1, `WITHERING_ENABLED = false`, the feed rules) consistently refuses. The argument for no is that seasonal scarcity is most of what makes seasons interesting to a trade economy — which is a real point, and exactly why it belongs here rather than in a config edit | `packages/shared/src/config/season.ts`; opened by T-35.01, fed by T-35.09 |
| D-28 | The shopkeeper is wearing the blacksmith's clothes — who gets re-skinned? | Open, and it blocks the second half of T-33.03. `npc-merchant-idle.png` is a copy of `Blacksmith/Premade/Alaric`, and the pack ships exactly **two** premade townsfolk (Alaric and Gaston the Chef, both 512x32, measured identical). A third face needs one of: **(a) compose an NPC at runtime from the layered strips** the pack does ship — Skins/Hair/Eyes/Clothers/Beard — which `characterLayers.ts` already does for the player, giving the merchant a distinct look and freeing Alaric to be the actual blacksmith; **(b)** accept two identical villagers; **(c)** drop the Blacksmith until Phase 36 needs him. Recommendation: **(a)**, because the merchant looking like a blacksmith is wrong *today* and the layered path is the pack's own design — but it changes the appearance of a character the player already knows, which is why it is a decision rather than a commit | `scripts/prepare-assets.mjs`; `VILLAGERS` in `config/farmLayout.ts`; `entities/VillagerNpc.ts`; T-33.03 |
| D-27 | Where do you fish, and does a fish have anywhere to go? | Open, and it blocks **T-34.05 and T-34.06 only** — narrower than first recorded. T-34.02 and T-34.03 are server tasks and the server never validates position (§4.1/§5.1), so they shipped without it; T-34.01's table shipped without it, because a fish table does not care where the water is. **Half (b) is now half-answered**: Phase 33 built quests, so a fish CAN be asked for by the Chef. Two halves. Two halves. **(a) The place.** Phase 34's cost argument rests on `WATER_COLS`/`SHORE_COL` describing a walkable shoreline with water beside it; measured on 2026-09-09, `waterTiles()` returns **one tile, (0,0)** — the re-scope made the sea a backdrop behind the map and M5 made `waterTiles()` read the map rather than the constants. Recommendation: **author a pond into `farm.json`**, because every other verb in this game aims at a TILE and the alternative needs an exception to §5.1's facing rule. **(b) The sink.** T-34.07 routes fish into machines (superseded) and quests (unbuilt), so today a fish can only be sold — which Phase 20's "nothing ships inert" rule forbids. Phase 33 shipped the quest half, so the remaining question is only whether that is *enough* of a sink to satisfy "nothing ships inert", or whether fish also need a cooking use | `farmLayout.ts` `WATER_COLS`/`SHORE_COL` (read by nothing at runtime); T-34.02, T-34.07 |
| D-26 | Are placed machines solid? | Open. Artisan machines (Phase 32) are placed on the farm through the decor path, so they inherit **D-9**'s shape — a per-def `solid` flag guarded by "no solid piece orthogonally adjacent to a plot" plus a flood-fill reachability check. What makes it a separate decision is that machines are **load-bearing in a way decoration is not**: a player must be able to reach one to load and collect it, so a machine that walls off *another machine* costs real income rather than a little inconvenience, and a player who has spent wood and gold on it cannot simply be told to move it. D-14's lesson applies — the coop trap was exactly a case where the obvious answer ("things block their tile") produced a farm that could lock the player out of their own content | `MachineDef.solid`; opened by T-32.06; `modules/decor/reachability.ts` is the precedent |

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

## Phase 13 complete — the Stardew pivot is finished

T-7.01 through T-13.08 are all done. The pivot is finished, idle mode included.

What is deliberately still off is listed at the top of this file and unchanged:
the trade and VIP UIs (server code green and untouched), furniture and the
Interior scene, and every system the art supports but the MVP does not
(chopping, mining, fishing, combat, energy, day/night, seasons). Those were
sketched as "Phase 14" in prose but were never broken into tasks — re-enabling
any of them starts with writing the tasks.

**Phase 15 (below) is the live plan.** It was authored after Phase 13 closed,
because playing the finished pivot made four gaps obvious that no task in this
file covers: the world has no collision, the animals never move, the farm
cannot be decorated, and the HUD looks like a different product from the game
it sits on. Work Phase 15 in order.

---

# Phase 14 — Backlog (carried from v1)

Not scheduled; pull items up when the MVP above is done.

**Reconciled 2026-09-04**, when Phases 7-19 closed and this was the only list
left. Four of the twelve had quietly been delivered by later phases and were
still sitting here as open work — a backlog that lies about what is left is
worse than no backlog, because it is what you read when deciding what to do
next.

- ~~**T-14.01** — VIP benefits applied to the new loop (bulk actions,
  idle-speed?)~~ — **done by Phase 24**. Idle-speed was already correct;
  `bulkHarvest`/`autoCollect` were sold on the landing page and read by nothing
- ~~**T-14.02** — VIP UI (buy button, expiry display)~~ — **done by T-18.20**,
  which found the checkout endpoint had existed and been correct since T-5.02
  with **no client caller anywhere**: `net/vip.ts` and the HUD button are the
  client half
- ~~**T-14.03** — Re-enable Trade UI on the new HUD~~ — **done by Phase 22**,
  four tasks: the mailbox door, the protocol test, `SelfPlayer.canTrade` gaining
  a reader, and the socket that had never connected in dev. This entry still
  read "still open" when Phase 24 came to pick the next item
- ~~**T-14.04** — Re-enable furniture/Interior with new-pack interior art~~ —
  **done by Phase 16** (`scenes/Interior.ts`, `INTERIOR_KITS`, placement,
  reachability guards, `STARTING_FURNITURE`)
- ~~**T-14.05** — Chopping (axe tool, maple drops wood) + idle task `chop`~~ —
  **done by Phase 20**, all six tasks
- **T-14.06** — Economy tuning from real data — old T-6.01
- ~~**T-14.07** — Anti-bot measures — old T-6.02~~ — **done by Phase 21**
- **T-14.08** — Scheduled jobs (only if D-2 decides withering on) — old T-6.03
- ~~**T-14.09** — Sound~~ — **done** (`game/audio.ts` + tests, wired through
  `actions.ts`, with the HUD's Sound on/off toggle)
- ~~**T-14.10** — Onboarding/tutorial~~ — **done in part**: the coach-hint strip
  in `hud.ts` teaches walking, the hoe, seeds and watering in context. No
  scripted first-run sequence; reopen as a smaller task if one is wanted
- **T-14.11** — Accessibility & polish pass — old T-6.06. **Overlaps D-19**:
  the game is keyboard-only, which is both the mobile blocker and the largest
  accessibility gap. Phase 27 did the measurable half — an axe audit of all
  seven views found contrast faults and nothing else, and all of them are
  fixed and pinned by `contrast.test.ts`. What remains IS D-19
- **T-14.12** — Real ToS/Privacy (RMT-unsupported clause) — old T-0.10.
  **The only non-engineering item, and the one with outside exposure.** Still
  open and **needs a lawyer, not a commit**. Phase 26 did the engineering half:
  the privacy page is now checked against the schema every CI run, so it can no
  longer quietly become false — but it is still unreviewed, and still says so
- ~~License audit~~ — resolved by T-7.01 (licensed pack + attribution)

---

# Phase 15 — Presence: collision, living animals, decoration, design

The pivot shipped a farm that works. This phase gives it **presence**: a world
that pushes back, animals that move, a farm you can make yours, and a UI that
looks like it belongs to the game underneath it.

Four gaps, none of them covered by any task above:

- **Collision does not exist.** `movement.ts:119` clamps the player to a
  rectangle around the map and nothing else — no Phaser physics is enabled
  anywhere, and `farm.json` has no collision layer and no tile properties. You
  walk through the house, the coop, the barn, every tree, the chest, the
  merchant, the shipping box, the water and the animals.
- **Animals are furniture.** `Animal.update()` bobs a *badge*; the animal never
  moves. Chickens and cows sit on fixed `pastureSlot()` tiles playing row 0
  forever, while measured-but-unwired peck/lying/hatch rows sit in the sheets
  (T-7.10 flagged them as "no gameplay state to drive them from yet").
- **The farm cannot be decorated.** `new_assets/Objects/Exterior/` has fences,
  scarecrows, lamps, hay bales, signs, barrels, troughs and statues, none of it
  reachable. The furniture system from v1 is interior-only, unregistered since
  T-11.05, and its art is an acknowledged placeholder.
- **The HUD is a different product.** `hud.css` is 1700 lines of paper-and-ink
  sans-serif inherited from the marketing site, sitting over a pixel-art
  canvas, while `UI/Inventory/{Banner,Decor,Extras}.png`, `dialogue box.png`
  and `Bars.png` go unused.

## What is deliberately NOT in this phase

Everything Phase 14 already defers, unchanged — trade UI, VIP UI, the Interior
scene, chopping, mining, fishing, combat, energy, day/night, seasons. **Outdoor
decoration is not the interior furniture system** and does not re-enable it;
T-14.04 stays where it is.

## Three calls worth defending

Each of these is a thing a reviewer would otherwise try to "fix":

1. **Decor gets its own server module, not a `surface` flag on the furniture
   one** (D-11). The farm's placement predicate is not "a rectangle with
   different numbers" — it is *inside the farm AND not on a plot AND not under
   a building at its current tier AND not on water AND not on a map object AND
   not on a yard slot*, and it needs a `farms` row read inside the transaction.
   Bolting that onto the house module means editing three `.for('update')` lock
   statements in code the running game never reaches. Share `overlaps()` (8
   lines); copy the service *shape* deliberately.
2. **Animals wander sub-tile and never leave their home tile.** The chicken
   sheet, as measured in T-7.10, has **no walk cycle** — rows 0–2 are upright
   idles with a 1px breathing bob — so tile-scale translation would be
   *sliding*, not walking. Staying in-tile also means `Animal.bounds()` and
   `Farm.facedAnimal()` need zero changes, and there is no moving target to
   chase when you want to feed something.
3. **Decor is placed at the character's faced tile with the action key**, not
   dragged with the pointer. A pointer-drag would be the only mouse-primary
   interaction in the game and would contradict §5.1's "only the character
   performs farm actions". It reuses `facedTile`, `buildTarget`,
   `bindActionKeys` and `act()`'s dispatch — no new input paradigm.

**Rejected:** a `collision` tilelayer in `farm.json` (cannot express
tier-dependent building footprints, animals, or placed decor — you would need
the dynamic path anyway and then have two mechanisms); folding decor into the
farm-state view (§11 — that is the hottest path).

---

## Section A — foundations

These de-risk everything after them. Do them first.

### T-15.00 — Decide who owns `farm.json`  ✅ **DONE**
Depends: — · Size: M

**Found while doing T-15.01, not suspected beforehand.** `generate-farm.ts` and
the committed `apps/client/public/tilemaps/farm.json` have diverged, and two
separate landmines fall out of it:

1. **120 ground tiles would be flattened.** The committed map draws from six
   tilesets; the generator paints only `ground-grass` / `water-tile` /
   `ground-path`. The extra 120 tiles are real authored detail — a
   grass/water shoreline down column 1 (21 tiles of
   `tileset-grass-water-spring`), scattered grass variation from
   `tileset-grass-spring`, and a 5x4 tilled-soil field. Re-running the
   generator replaces all of it with flat grass.
2. **`pnpm plots` would move every plot.** The committed map's `plots` object
   layer marks tiles **(12..16, 4..7)**. `PLOT_POSITIONS` in
   `config/plots.generated.ts` — which the server and client actually use —
   says **(9..13, 9..12)**. They are different fields. `plots.generated.ts`
   carries the warning "to change the farm's shape, move the markers in the map
   editor and re-run `pnpm plots`"; doing exactly that today would silently
   relocate every plot on every existing farm.

There is also a visible consequence: the painted soil field sits at (12..16,
4..7) where there are **no plots**, and the real plots at (9..13, 9..12) sit on
plain grass. That is very likely part of what "the design looks wrong" means.
(T-9.04 decided plot cells should be grass and soil should be server state, so
the painted field is a pre-T-9.04 leftover that should not exist at all.)

**Do:** pick an authority (D-13) and make the other side match.
- If the **generator** wins: teach it to paint the shoreline and grass
  variation it currently cannot (the mapmaker's autotile/terrain tools already
  do this — `src/tilesets/terrain.ts`, `src/tools/autotile.ts`), then regenerate
  and confirm `pnpm plots` is a no-op against `PLOT_POSITIONS`.
- If the **committed map** wins: retire `generate-farm.ts` to
  `docs/`, and make `verify-farm.ts` the only script that touches the map.

Either way the end state is: regenerating is safe, and `pnpm plots` produces
`PLOT_POSITIONS` byte-identical to what is committed.

**Done:**
- [x] D-13 decided and recorded in the table above — **the generator wins**
- [x] The generator paints the border it previously could not
- [x] `pnpm plots` is now a **no-op** against the committed `plots.generated.ts`
- [x] `farmMap.test.ts` asserts the map's `plots` layer and `PLOT_POSITIONS`
      name the same tiles, so they can never drift again
- [x] The stray painted soil field is gone
- [x] `verify-farm` prints `warnings: 0`; both new assertions break-tested

**How it turned out.**

**The 120 "hand-authored" tiles were a border frame, and they are good.** I
assumed decorative scatter; they are structural. Cropping each frame out of the
tileset at 8x and reading the pixels (§9) showed exactly four fringe tiles —
`tileset-grass-spring#10` fringed along its top, `#59` along its right, `#81`
along its bottom, and `tileset-grass-water-spring#92`, grass with a strip of
water down its left edge, plus `#8` as the rounded north-west corner. Laid along
the map edges they stop the farm ending in a hard rectangle at the viewport
edge. That is real design and the generator now reproduces all 96 of them.

**One of the six tilesets was drawing nothing.** `tileset-grass-spring#57`, used
for four tiles at (2..5, 1), turned out to be **pixel-identical** to
`ground-grass` — both a single flat `#79BF56` square, confirmed by a numpy array
comparison. Four tiles of pure noise in the map file. Dropped.

**The soil rug was the old field.** The 20 `tileset-soil` tiles at (12..16, 4..7)
sat exactly where the map's stale `plots` layer marked its field — i.e. it was
the pre-T-12.02b field's painted soil, left behind when the field moved and the
map was never regenerated. It had no plots under it, and T-9.04 had already
decided plot cells are grass because soil is server state. Deleted; the ground
layer went from six tilesets to five.

**The plots landmine was the dangerous half, and it was invisible.** Nothing at
runtime reads the map's `plots` layer, so the map could disagree with
`PLOT_POSITIONS` indefinitely without a symptom — while
`plots.generated.ts`'s own header invites the next person to run `pnpm plots`,
which would have rewritten `PLOT_POSITIONS` from (9..13, 9..12) to (12..16, 4..7)
and relocated every plot on every farm. After regeneration `pnpm plots` is a
byte-for-byte no-op, and the new test is the only thing in the repo that looks
at both sides.

**Break-testing caught a weak test.** The first attempt at breaking the plots
assertion — bumping `FIELD_X0` — did **not** fail it, because `FIELD_X0` is
upstream of both sides and moves them together. Breaking it the way the real
hazard works (move the field, regenerate the map, leave `plots.generated.ts`
stale) does fail it. Worth recording: a break-test that does not break is
evidence about the break-test, not the code.

**Regeneration is now provable.** The regenerated map differs from the old
committed one by exactly 24 ground tiles — the 20 deleted soil tiles and the 4
invisible stubs — with objects, plots and tilesets byte-identical. That is the
whole reason the border was reproduced faithfully rather than "improved" in the
same pass: a small provable diff beats a large plausible one. Closing the
frame's two unmitred corners is left to T-15.28, noted in `BORDER`'s comment.

### T-15.02 — Farm layout constants move to shared  ✅ **DONE**
Depends: T-15.00, T-15.01 · Size: M

### T-15.01 — Pin the map's gids with a test  ✅ **DONE**
Depends: — · Size: S

**Do:** `TILESET_RUNS` allocates gids by walking `SHEETS` then `IMAGES` in
declared order, so inserting anything into `SHEETS` shifts every firstgid after
it — and `farm.json` is a committed file full of gids that nothing renumbers.
The map does not fail to load; it loads and draws the wrong tiles. Make that
loud.

**Done:**
- [x] `apps/mapmaker/src/io/farmMap.test.ts` compares the firstgid table
      `farm.json` embedded against the one the manifest currently produces
- [x] Every object gid is pinned to its expected `(key, frame)`
- [x] The ground layer is pinned to the six tilesets it draws from, and
      asserted to have no empty cells
- [x] The append-to-`IMAGES`-only rule is documented on `SHEETS` in `assets.ts`
- [x] Break-tested; `pnpm test` green

**How it turned out.**

**The map embeds a frozen copy of `TILESET_RUNS`**, which turned out to be a
much sharper instrument than checking individual gids. A Tiled map carries its
own firstgid table, so the committed map *is* a snapshot of the manifest at the
moment it was generated. Comparing the two tables directly means the failure
message names the tileset that moved rather than the tile that broke, and it
fires before any gid has to be resolved. All 72 runs matched exactly.

**The break-test fired three ways, not one.** Inserting a dummy `SheetSpec`
after `TILESET_PATHS` failed the firstgid comparison *and* the object-gid
assertion (the maple tree resolved to a chicken sheet) *and* the ground-tileset
assertion. That is the corruption made concrete: it is not a load error, it is
a farm drawn out of the wrong pixels.

**The ground layer draws from six tilesets, not three.** The obvious guess —
`ground-grass`, `water-tile`, `ground-path`, the three flat fills the generator
paints — is wrong. The committed map also uses `tileset-grass-spring`,
`tileset-grass-water-spring` and `tileset-soil`. Measuring that instead of
assuming it is what surfaced T-15.00 immediately afterwards.

**Lives in the mapmaker, not in `packages/shared`.** The mapmaker is the package
that owns `farm.json` — it writes it, and `verify-farm.ts` already reads it back
— so it is the one place entitled to hold the manifest and the artefact in its
head at once. `pnpm test` runs it regardless of which package you were editing.
Mapmaker went 62 → 67 tests.

**Do:** lift `WATER_COLS`, `TREES`, `MAILBOX_TILE`, `MERCHANT_TILE`,
`CHEST_TILE`, `SHIPPING_BOX_TILE`, `FIELD_*` and `PATHS` out of
`generate-farm.ts` into `packages/shared/src/config/farmLayout.ts`; the
generator imports them. This is the fix `buildings.ts`'s own doc comment argues
for ("two copies of a tile coordinate is one too many"), and the server needs
these to validate decor placement — it cannot read `farm.json`.

**Done:**
- [x] The generator declares no tile coordinates of its own
- [x] `farmLayout.ts` also owns `borderTiles()`, `waterTiles()`, `pathTiles()`
      and `fieldTiles()` as functions, not just the raw constants
- [x] Exported from `config/index.ts`; typecheck and tests green

**How it turned out.**

**Done in the same pass as T-15.00, because it had to be.** Teaching the
generator the border meant writing the border down somewhere, and writing it
into the generator would have been a third copy of the map's geometry — the
exact thing this task exists to remove. So `farmLayout.ts` was created once,
with the lifted constants *and* the new border spec together.

**The helpers moved too, not just the values.** `pathTiles()`, `fieldTiles()`
and `waterTiles()` were private functions in the generator; the collision work
(T-15.05/T-15.08) and the decor placement rules (T-15.16) need the expanded tile
lists, not the compressed run definitions. Moving the functions rather than
re-deriving them on each side is the same reasoning that put `footprintOf` in
`buildings.ts`. `pathTiles()` now throws on a diagonal run instead of calling
the generator's `fail()`, so it is usable from the server.

**`waterTiles()` grew a tile the constant could not express.** The water is
`WATER_COLS` for every row *plus* one extra at the foot of the shoreline column:
the shore tile draws its own strip of water, and on the last row there is
nothing below it, so leaving grass there ends the river in mid-air. That single
tile was in the committed map and would have been lost to a naive lift of
`WATER_COLS` alone.

### T-15.03 — `pasture.ts` moves to shared  ✅ **DONE**
Depends: — · Size: S

**Do:** move `apps/client/src/game/pasture.ts` (and its test) to
`packages/shared/src/config/pasture.ts`. It already imports only shared config,
so this is a straight move. The server needs `pastureSlot`/`YARDS` to keep decor
off yard tiles.

**Done:**
- [x] Moved with `git mv` so the history follows the file
- [x] Tests moved and stayed green: shared 134 → 143, client 181 → 172, total
      unchanged — the same 9 assertions, on the other side of the boundary
- [x] No client file declares yard geometry; `Farm.ts` imports `pastureSlot`
      from `@tillhaven/shared/config` like every other layout constant

**How it turned out.**

**The only real work was the import style.** Both files imported from the
package's own barrel (`@tillhaven/shared/config`), which is fine from the client
and a self-import once the file lives inside the package. They now import from
the four modules the symbols actually live in — `animals.js` (`ANIMALS`,
`BUILDING_TIERS`, the two kind types), `assets.js` (`TILE_SIZE`),
`tilesets.js` (`FARM_WIDTH`/`FARM_HEIGHT`) and `vip.js` (`VIP_BENEFITS`) —
matching how every other file in `config/` imports its neighbours. No cycle:
nothing in those four reaches back to `pasture.js`.

---

## Section B — collision

### T-15.04 — Measure object collision bases  ✅ **DONE**
Depends: — · Size: S

**Do:** `farm.json` declares boxes far larger than the art — the shipping box is
48x64 for a 16x16 look, the maple 32x48 for a roughly 1-tile trunk — so
footprints **cannot** be read off the object layer. Write
`scripts/measure-object-bases.mjs` (throwaway, `measure-character.mjs`
precedent) that emits an 8x upscale plus a per-row alpha-density profile for
`obj-maple-tree` (frame 2), `obj-chest`, `obj-mailbox`, `obj-newsstand` and
`obj-shipping-box`, and read off the ground-contact base — the widest opaque
band in the bottom quarter. Record as `OBJ_COLLISION_BASE` in
`packages/shared/src/config/collision.ts` with the measured numbers in the doc
comment (§9: measure, never guess).

**Done:**
- [x] `scripts/measure-object-bases.mjs` prints a per-row alpha profile, the
      base rect and the tile footprint for all five objects
- [x] Every key exists in `SHEETS`/`IMAGES` (asserted in `collision.test.ts`)
- [x] The maple's base is 12px, not its declared 32px

**How it turned out.**

**The first run was wrong, and the manifest said why.** Measuring
`obj-shipping-box` over its whole 48x64 file reported a **3x1 tile** base — but
the file is a kit of three crates and the scene draws only
`OBJ_SHIPPING_BOX_LOOK`, cell 0, a single 16x16 crate. `assets.ts` already
carried a warning about this exact trap ("the window is 16 wide, NOT 29 — do
not re-trim it to alpha bounds", after T-7.11 shipped a double-wide box for a
moment). Teaching the script to honour a `look` window took the shipping box
from 3 tiles to 1. Without it the crate would have walled off the path it
stands beside.

**Measured bases, all five:** maple trunk 12px (x 11..22 of a 32px frame),
chest 15px, mailbox post 10px, newsstand 15px, shipping crate 16px. Against the
cells `farm.json` declares — 32x48, 32x16, 16x32, 32x48, 48x64 — that is the
whole argument for measuring: the declared box is not the object.

**"Base" had to be defined, not just found.** The alpha bounding box is the
wrong answer, because it includes a tree's canopy, which the player walks
*behind*. The script takes the bottom 25% of the art's alpha box and reports the
opaque columns in that band — the trunk, the post, the crate's front face. The
band fraction is a judgement, so the script also prints the full row profile;
the maple's is unmistakable, dropping from ~20 opaque pixels of canopy to 12 of
trunk.

### T-15.05 — Shared collision config  ✅ **DONE**
Depends: T-15.04, T-15.02 · Size: S

**Do:** add `PLAYER_COLLIDER = { halfWidth: 5, height: 6 }` — a **feet box**,
not the silhouette: `CHAR_ART` is 11x19, and a 19px-tall collider would let a
tree block the player's *head*, which is wrong for top-down. Plus
`objectFootprint(anchor, base)` and `currentBuildingFootprints({coop, barn})`,
the latter built from `coopFootprint(tier)`/`barnFootprint(tier)`. Document why
this is not `BUILDING_FOOTPRINTS` — that is each building's reserved *maximum*,
for the map generator; this is what you actually bump into. Opens D-7.

**Done:**
- [x] `PLAYER_COLLIDER.halfWidth * 2 < TILE_SIZE` pinned by a test
- [x] `currentBuildingFootprints` proven smaller than `BUILDING_FOOTPRINTS` at
      tier 0 and exactly equal to it at the top tier
- [x] **No plot is inside any building footprint at any tier** — the most
      important assertion in the file
- [x] `packages/shared` 143 → 155 tests

**How it turned out.**

**Two footprint functions, on purpose.** `BUILDING_FOOTPRINTS` is each
building's *largest* footprint and exists so the map generator never puts a tree
where a Deluxe barn will one day stand — it reserves ground, and it is right to
be pessimistic. Collision asks the opposite question: a player with a tier-0
coop must be able to walk over grass a Deluxe coop would later cover, because
right now there is nothing there. Using the reserved maximum for collision
would put invisible walls around buildings nobody has bought. Two named exports
rather than a flag, with the distinction spelled out in both doc comments, and a
test pinning each end of it.

**`CHAR_FRAME_CENTRE` turned out to be the wrong thing to reach for.** The
collider-vs-art check first imported it, then failed to compile: it is a private
const in `Player.ts`, derived from `CHAR_ORIGIN`, and it describes the art's
*offset within its frame*. What the check needs is the art's *width*, which
`CHAR_ART` already gives directly (x 11..22, so half-width 5.5 against the
collider's 5). Importing it would also have meant shared config depending on a
client file.

**A test suite run lied, and it was my fault.** After this task the full suite
showed 7 failures in `farm.integration.test.ts` — till, water and harvest.
Every one passed in isolation, and the file passed 70/70 on its own. The cause
was the `pnpm dev` server I had left running against the **same docker
Postgres** the integration tests use. Killing it returned 829/829. Recorded here
because the symptom points squarely at whatever you just changed and the cause
is somewhere else entirely: **stop `pnpm dev` before `pnpm test`.**

### T-15.06 — `step()` grows a per-axis sweep  ✅ **DONE**
Depends: T-15.05 · Size: M

**Do:** give `step()` an optional fifth argument
`world?: { blocked: (x, y) => boolean; collider }`, so all 197 existing test
lines compile untouched. Resolve X first (revert to `state.x` if the collider at
the new X overlaps a blocked tile), then resolve Y against the **already
resolved** X — that asymmetry is what produces sliding along a wall instead of
sticking on a diagonal. Tile ranges round outwards with an exclusive end, the
same rule `footprintOf` uses. If the collider *already* overlaps, skip collision
for that frame, so "bought a Deluxe barn while standing where its wall will be"
self-heals.

**Done:**
- [x] All 20 existing `movement.test.ts` cases green, unmodified
- [x] New tests: head-on stop; diagonal **slides** on the free axis; **flush
      contact**; a corner between two blockers stops; already-inside escapes;
      one-tile gap passable; facing preserved; diagonal corner-cut refused;
      bounds still respected
- [x] `it('cannot tunnel: RUN_SPEED * MAX_STEP_MS < TILE_SIZE')` — 84px/s x
      100ms = 8.4px < 16
- [x] Three break-tests, all confirmed (below); client 172 → 183 tests

**How it turned out.**

**Reverting a blocked step is not good enough, and a test caught it.** The first
implementation refused the move outright when the destination overlapped. The
head-on test failed with `expected 88 to be greater than 88`: a frame covers up
to 8.4px, so the character halted 8px from the wall and — worse — could never
close the gap, because every subsequent frame proposed the same blocked
destination. It reads as an invisible wall standing off the real one. The fix is
`slide()`, which snaps the collider's **leading edge** to the tile boundary it
ran into. `leadPos`/`leadNeg` encode that the leading edge differs by direction
*and* by axis: ±`halfWidth` for X, but `0` going down (the feet **are** the
bottom edge) and `-height` going up.

**Facing comes from the input, not from the distance travelled.** A player
walking into a wall must keep facing the wall, or the faced-tile action stops
targeting the thing they are pressed against.

**Two break-tests, and the first one I wrote was worthless.** Swapping the Y
sweep to test the original x rather than the resolved x changed nothing —
the case I had built did not distinguish them. Tracing the arithmetic by hand
gave one that does: moving right+down with only the *diagonal* tile solid, the X
slide moves the collider into column 6, and Y must be judged from there. Judged
from the old column it sees no blocker and the character finishes the frame
**standing inside the wall**.

**That test then failed to fail for a second, better reason.** `resolve`'s
"already inside → skip collision" escape hatch — there so nobody is ever trapped
— let a 12-frame walk carry the character back out, washing away the evidence.
Asserting on the **first** frame fixes it. Two different causes of a silent
break-test in one task is the strongest argument yet for rule 6.

**The break-test that mattered most:** replacing the per-axis sweep with joint
resolution (revert both axes when the destination is blocked) fails three tests
at once — head-on, slide and flush. That is the implementation someone would
actually write instead, and it is the one that makes every wall sticky.

### T-15.07 — The `BlockMap`  ✅ **DONE**
Depends: T-15.05 · Size: M

**Do:** `apps/client/src/game/collision.ts` — pure and Phaser-free, beside
`plots.ts`. A `Map<BlockLayerId, Set<string>>` over
`'terrain' | 'objects' | 'buildings' | 'animals' | 'decor'` with a derived union
recomputed on `set()`, plus `waterTiles()`, `objectTiles()` and
`footprintTiles()` builders. Rebuilt on poll, not per frame — it is a few
hundred tiles.

**Done:**
- [x] `it('never blocks a plot tile, even at the top building tiers')` over
      `PLOT_POSITIONS`, against a worst-case map — plots must stay
      stand-on-able, because you act on the FACED tile
- [x] `it('blocks the water column and nothing else on that side')`
- [x] `it('keeps a walkable tile between adjacent cows in the barn row')`
- [x] Layer isolation, `reasons()`, and the pre-bound `blocked` all covered
- [x] Two break-tests confirmed; client 183 → 204 tests

**How it turned out.**

**The shoreline is not water, and calling it water is the easy mistake.**
`tileset-grass-water-spring` is mostly *grass* with a strip of water down its
left edge — it is the bank, and the player stands on it. Blocking it would put
an invisible wall one tile inside the visible waterline for the whole height of
the farm. `isWaterKey` is a named predicate rather than an inline string
comparison precisely so that distinction has somewhere to live, and the
break-test (make it match the shoreline too) fires.

**Unmeasured art is walk-through, not solid.** `objectTiles` skips any key with
no entry in `OBJ_COLLISION_BASE`. The alternative — falling back to the
object's declared cell — would wall off a 2-4 tile patch of grass the moment
someone adds art and forgets to measure it, with no visible cause. A missing
measurement should look like nothing happened.

**Layers are named rather than flattened on the way in**, because the sources
run on different clocks: terrain and objects are fixed at load, buildings change
when a tier is bought, animals on every poll, decor on every placement. One flat
set would have to be recomputed from all five whenever any one moved, and would
silently drop a layer whose source had not been consulted. A test pins it:
rebuilding `buildings` must not make the water walkable.

**`blocked` is a bound property, not a method.** `step()` receives it detached
(`const { blocked } = map`), and a method would crash on a missing `this` at
60fps. The test destructures it deliberately, the same way the caller does.

**`feetTiles` needs the `-1`.** A sprite's feet sit on the tile's *bottom* edge,
so the y coordinate is exclusive — feet at y=16 stand on tile row 0, not row 1.
It is the same off-by-one `rememberObjectTiles` already documents in `Farm.ts`,
and dropping it puts every animal's blocked tile one row below the animal.

### T-15.08 — Wire collision into the scene  ✅ **DONE**
Depends: T-15.06, T-15.07 · Size: M

**Do:** `Player.setWorld()` passes the world into `step`. In `buildMap()`, walk
the ground layer resolving each tile through `fromGid` (falling back to
`locateInMap`, which `buildMapObjects` already uses, if Phaser remapped the
index) into the `terrain` layer. In `buildMapObjects()`, accumulate `objects`
from `OBJ_COLLISION_BASE`. In `refresh()`, after the `setTier` calls, rebuild
`buildings`. Dev-only: assert the derived tiles match `farmLayout.ts` and warn
on mismatch, so the map and the config cannot drift silently.

**Done:**
- [x] `Player.setWorld()`; terrain, objects and buildings layers wired
- [x] Water, tree trunks, the chest, the merchant, the shipping box and all
      three buildings are solid; canopies remain walk-behind
- [x] Building walls follow the CURRENT tier, rebuilt on each poll
- [x] Dev-only warning when the map's water and `farmLayout.ts` disagree
- [x] **Every plot walkable and actionable** — proven against the real map
- [x] Two real bugs found and fixed (below); client 204 → 207 tests
- [x] Browser verification — **unblocked and done in T-17.02**; the note at the
      end of this task is kept as the record of why it waited

**How it turned out.**

**Two bugs, and neither would have been found by the unit tests as first
written.** After wiring, I rendered the computed block map as a red overlay on
the real `farm.json` (offline, with PIL — no browser needed) and read it.

**Bug 1: the chest made a plot unreachable.** `CHEST_TILE` was `(8,10)`. The
chest's art is 15px wide inside a 32px frame, offset far enough right that its
footing straddled a tile boundary and covered tiles **8 and 9** — and `(9,10)`
is a plot. It also severed the north-south path spine at y=10. Invisible before
anything was solid: the chest was simply drawn over the corner of the field and
nobody could tell. Moved to `(6,10)`, west of the spine, clear of the field
(x≥9), the path (x=8) and the house footprint (x 6-8, y 3-5).

The unit test that should have caught this **passed**, because `worstCase()`
layered water, buildings and animals but not map objects. Adding them made it
fail with `plot (9,10) is blocked` — then pass after the move. A test that
omits a whole layer is not a weak test, it is a test of something else.

**Bug 2 (worse): solid animals make three chickens unfeedable.** The plan for
T-15.14 said animals block their home tile. The coop yard is 5x3 on 1x1 spacing
and `maxHerd('coop')` is exactly 15, so a full flock fills every slot — and the
three chickens in the middle row end up enclosed by other chickens. You could
never stand adjacent, never face them, never feed them, and an unfed animal
stops producing forever (§5.4). **Cows are fine** (2-tile spacing), which is
exactly the trap: block animals, test with two cows, ship it, and the farm only
breaks for a player who fills their coop. Resolved as **D-14: livestock is
walk-through**, with the arithmetic pinned in a `D-14` test block so that if a
future yard is ever spaced out, the test says so by failing.

**Terrain resolves through the map's own tileset table**, not `fromGid` —
Phaser renumbers tile indices as it loads, so the index on a placed tile is not
necessarily the gid it was authored with. `locateInMap` was already there for
`buildMapObjects` for the same reason.

**The shoreline is not water.** Only the flat `water-tile` fill blocks;
`tileset-grass-water-spring` is the bank and you stand on it.

> **Browser verification is blocked and this task is not fully closed.**
> Playwright MCP is pinned to the Chrome channel, Chrome is not installed
> (this machine has chromium and brave), and `npx playwright install chrome`
> needs a sudo password it cannot prompt for. Run it as
> `! npx playwright install chrome`, or add `--browser chromium` to the
> playwright MCP args in `~/.claude.json`. Everything above is verified by
> tests plus an offline render of the real map; the walk-into-it-and-see check
> still owes a pass.

### T-15.09 — Idle replay stays reachable  ✅ **DONE**
Depends: T-15.08 · Size: M

**Do:** `idleReplay.ts` walks straight octile lines with no obstacle avoidance,
which was fine when nothing obstructed. Rather than add A* (D-8), prove the map
cannot trap the farmer: build the worst-case `BlockMap` (max-tier buildings, all
trees, water, every yard slot occupied) and drive `replayInput` → `step` for
every plot x every approach side from several starts, asserting arrival. A
failure means moving a map object, which makes "reachable by construction"
mechanical. Then add a runtime unstick: after `REPLAY_STUCK_MS = 2000` with no
progress, drop `world` for the rest of that plan and warn — the replay is
cosmetic (§4.1), so the honest failure is a clipped corner, not a stalled farm.

**Done:**
- [x] `reachability.test.ts` drives the real `replayInput` → `step` loop to
      **every plot from all four compass directions plus the path spine**,
      through the worst-case farm (top-tier coop and barn, water, every map
      object) — 100 walks, all arrive
- [x] A control test proves a genuinely sealed map DOES trap the farmer, and
      that the same walk succeeds without the wall
- [x] A guard test asserts every start tile is actually free, so a pass cannot
      come from the escape hatch firing on frame one
- [x] `REPLAY_STUCK_MS = 2000` unstick in `Farm.checkReplayStuck`
- [x] Break-tested; client 207 → 211 tests

**How it turned out.**

**The current map passes as authored** — 20 plots x 5 start positions, every
walk arrives. So no map changes were needed beyond T-15.08's chest move, and
D-8 stands: no pathfinder.

**`playerBounds` moved from `Player.ts` to `movement.ts`.** The test could not
even load: importing `playerBounds` pulled in `Player.ts`, which imports Phaser,
which wants `window`. But `playerBounds` is pure arithmetic over `CHAR_ART`
with no Phaser in it — which is `movement.ts`'s entire stated remit ("split out
so it can be unit-tested without a canvas, a clock or a game loop"). It was in
the wrong file; the test is just what made that visible.

**Two of my own tests were wrong, and both said so out loud.** The free-tile
guard caught a start position sitting inside the north-west maple's trunk. And
the control test — a wall meant to prove collision was doing something —
**passed while proving nothing**: I walled the plot's west side, but the farmer
approaching from the east stops on the plot's EAST side and arrived without
ever meeting the wall. `approachFor` picks the near side, so "put a wall beside
the plot" is not the same as "put a wall in the way". The wall is now derived
from the actual approach tile, with assertions that it really does lie between
start and target, plus a check that the same walk succeeds without it.

**The unstick measures movement, not distance-to-target.** A farmer sliding
along a wall is moving and will get there; one pressed into a corner is not.
Timing out on "distance stopped shrinking" would fire on every wall slide.

**Why an unstick at all, when the test proves the map is fine:** the proof
covers the map *as authored*. Once T-15.24 lets players place solid decor, the
farm stops being something a test can enumerate in advance. The replay is
cosmetic (§4.1) — the server already decided what was farmed — so a farmer that
clips a corner is a far better failure than a farm that appears frozen because
a fence went down badly.

---

## Section C — animal wander

### T-15.10 — Measure the animal rows properly  ✅ **DONE**
Depends: — · Size: M

**Do:** T-7.10 asked "which row is idle", not "which row is which facing", so
the direction mapping is genuinely unmeasured for chickens. Write
`scripts/measure-animal-rows.mjs` and, for `animal-chicken-red`,
`animal-chicken-baby-red` and `animal-cow-brown-female`, emit per row a 12x
strip plus a numeric table (alpha bbox, pixel count, comb/beak centroid offset).
Two decisive tests: a **mirror test** (is row N pixel-identical to flipX of row
M? then the sheet encodes left/right explicitly and `setFlipX` is wrong) and a
**width test** (a front/back view is narrower than a side view). Record
`ANIMAL_CHICKEN_POSE_ROWS`, `ANIMAL_CHICKEN_FACING_ROWS`,
`ANIMAL_CHICKEN_MIRRORS_SIDE` and `ANIMAL_COW_POSE_ROWS` with the method and
the numbers in the comment. Resolves D-10.

**Done:**
- [x] `scripts/measure-animal-rows.mjs` runs the mirror, self-symmetry, width,
      row-distinctness and bob-or-walk tests over all three sheets
- [x] `ANIMAL_CHICKEN_POSE_ROWS`, `ANIMAL_COW_POSE_ROWS`,
      `ANIMAL_CHICKEN_MIRRORS_SIDE`, `ANIMAL_COW_MIRRORS_SIDE` recorded with the
      numbers in their doc comments
- [x] `ANIMAL_CHICKEN_FACING_ROWS = null` — the finding, not a gap
- [x] Row bounds asserted and break-tested (T-15.11's test)
- [x] **D-10 decided**

**How it turned out.**

**The chicken sheet has no facings, and three tests say so independently.** No
row is any other row mirrored (every pair differs far beyond the 2%
"same image" threshold); every row's frame 0 differs from its own mirror by
70-75%, so they are all side views rather than head-on ones; and every row
measures 13-14px wide, where a head-on chicken would be visibly narrower. Rows
0-2 are three look-angle variants of one pose.

**The same width test settles the cow in the opposite direction, immediately.**
Rows 0/3/5/7 measure 22-25px; rows 1/2/4/6/8 measure exactly 13px. That is a
side view next to a front and a back view, and it is why `poseRowFor` takes a
facing at all. T-7.10 had read this correctly from the art; the width numbers
turn a description into a measurement.

**My first "does it animate" test was unsound, and the numbers looked
convincing anyway.** Comparing consecutive frames pixel-for-pixel reported that
every chicken row "animates" at 50-70% — but shifting a whole 14px sprite down
one pixel moves *every* pixel in it, and reads identically to a leg cycle. The
fixed version asks whether some translation within ±2px explains the delta,
and reports the residual. That reordered everything: the cow's static lying
rows fall to 7%, chicken idles to 15-19%, peck rows to 30-60%.

**And then I stopped trusting even that.** The residuals are a spectrum, not two
clusters, and consecutive frames of a 4-phase cycle differ by more than a shift
even when the cycle overall is a bob — T-7.10 found the chicken's frames 0/2
and 1/3 identical bar 1px, which is a 0-vs-2 relationship that a 0-vs-1
comparison never sees. So the script now prints the number and only calls the
clear-cut cases below 10%. A measurement that needs a paragraph of caveats to
support a verdict should not be reporting a verdict.

### T-15.11 — `poseRowFor` in animalSprites  ✅ **DONE**
Depends: T-15.10 · Size: S

**Do:** `poseRowFor(sheet, pose, facing) → { row, flipX }`, with `idleRowFor`
delegating to it. This is the "one place that distinction is looked up" its
existing doc comment already promises.

**Done:**
- [x] `poseRowFor(sheet, pose, facing) -> { row, flipX }`; `idleRowFor`
      delegates to it and no longer branches on sheet kind itself
- [x] Table-driven tests: both kinds x all poses x all facings, all in bounds
- [x] Two break-tests confirmed — a row past the end of its sheet, and giving
      chickens a per-facing row in contradiction of D-10
- [x] Client 211 -> 219 tests

**How it turned out.**

**`idleRowFor` became a one-line wrapper.** It had carried its own
`COW_SHEET_KEYS` branch since T-7.10, with a comment promising it was "the one
place that distinction is looked up". That promise was cheap to keep while
there was one pose and impossible to keep with four, so the branch moved into
`poseRowFor` and `idleRowFor` now asks it. Two functions answering "which row"
is one too many.

**The chicken's `flipX` is set regardless of pose, and the cow's is not.** Every
chicken row is a left-facing side view, so mirroring is always the right way to
face right. A cow facing up or down is drawn from its own row and must NOT be
flipped — mirroring a head-on cow mirrors something with no left or right to
mirror. Both halves are pinned by tests, because the wrong one is invisible
until you watch a cow turn round.

### T-15.12 — The wander function  ✅ **DONE**
Depends: T-15.03 · Size: M

**Do:** `apps/client/src/game/animalWander.ts` — pure, tested without a canvas,
like `plots.ts` and `idleReplay.ts`. Position is a **pure function of absolute
time**: `legIndex = floor(now / legMs)`, destination from `hash(seed, legIndex)`
into a sub-tile radius, lerped from the previous leg's destination over
`moveFraction`, then holding a pose. No RNG object and no accumulated state, so
a 20s poll, a slept tab and a scene wake all land on the same continuous curve.
**Seed from `view.id`, not the slot index** — the index can shift, and a
re-seeded animal would visibly jump. Tuning (`radiusX` 6/10, `legMs` 2600/4200)
lives in `config/animals.ts`.

**Done:**
- [x] Determinism, and independence from being asked about every instant
      in between — the property that makes a slept tab safe
- [x] Continuity across a leg boundary (< 1px)
- [x] **Never leaves the home tile** — every yard slot, 40 legs x 8 samples,
      both kinds — and **break-tested twice**
- [x] Radii pinned against both the tile and the yard spacing
- [x] Client 219 -> 232 tests

**How it turned out.**

**The guard caught a real bug on its first run, which is the best possible
outcome for a guard.** Chicken #0 left its tile immediately. The cause is that
an animal's position is its FEET, and `pastureSlot` puts those feet on the
**bottom edge** of its tile — deliberately, so the sprite stands on the tile
rather than floating in it. That means the tile boundary is directly beneath
the animal, and a symmetric vertical drift spends half of every leg on the next
tile down. Vertical drift is now upward only, which is both correct and reads
better: the animal wanders back into its patch rather than out of it.

**The cow's radius is bound by the TILE, not by its neighbour.** I had sized it
at 10px on the reasoning that the barn row is spaced two tiles apart, so cows
have room. They do — but a cow is *targeted* on one tile however wide it is
drawn (T-12.03), so the binding constraint is half a tile, not half the
spacing. Both radii are now under 8px and a test pins each constraint
separately, since they fail for different reasons.

**Position is a pure function of absolute time**, with no accumulated state and
no RNG object. A test asserts that asking about t=60000 directly gives the same
answer as walking there in 137ms steps. That is what makes a 20-second poll, a
backgrounded tab and a scene wake all land on the same curve instead of
lurching.

**The seed comes from the animal's id, never its slot index.** The index is the
animal's position in the server's `acquiredAt` ordering within its kind — buy
one chicken and every later chicken's index shifts, which would re-seed them all
and make the whole flock visibly jump on the next poll.

### T-15.13 — Wire the wander into `Animal`  ✅ **DONE**
Depends: T-15.11, T-15.12 · Size: M

**Do:** `update(now)` sets position, depth and flip, and switches animation only
when the pose *row* changes (cached like `sheetKey`). The badge tracks the
sprite, not the home. **`bounds()` keeps returning the box at `home`** — comment
that loudly, because it looks like a bug and is the entire reason targeting
stays fair.

**Done:**
- [x] `Farm.facedAnimal()` untouched — `bounds()` still answers on the home slot
- [x] Animations registered per (sheet, ROW) rather than per pose
- [x] Sprite and badge both follow the drift; both re-sort their depth per frame
- [x] `update()` now takes the SERVER clock (see below)
- [x] Feeding a wandering animal from an adjacent tile — **done in T-17.04**,
      with a real cow: the first attempt missed because the cow had moved
      during the approach, the second landed once the character re-aimed

**How it turned out.**

**`update()` was being handed the wrong clock, and it had never mattered
before.** The scene called `animal.update(_time)` — Phaser's milliseconds since
*this tab* booted. Harmless while `update` only bobbed a badge; not harmless
once it derives an animal's POSITION, because every reload would teleport the
flock and two tabs on the same farm would disagree about where the cows are.
Now `this.serverNow()`, which is the same shared clock `redraw` already uses.

**Animations are keyed by ROW, not by (pose, facing).** A chicken maps all four
facings and both of idle/walk onto one row (D-10), so keying by the request
would register the same frames several times under different names and then
play whichever key happened to be asked for — a subtly different animation
object each time the facing changed, restarting the loop from frame 0. Keying by
row means "the drawing did not change" is a string comparison that is actually
true.

**`bounds()` deliberately does NOT follow the sprite**, and it now carries a
comment saying so at length, because it looks exactly like a bug someone would
"fix". Targeting answers on the home slot; the wander is bounded strictly inside
that tile, so the sprite is always somewhere inside the rectangle `bounds()`
returns. Making the box follow the drift would mean walking up to an animal,
facing the tile you can plainly see it on, and having the game answer about a
different one.

**A maturing chick had to invalidate the cached row.** `apply()` swaps the
sheet when a chick matures, and the cached `rowKey` belongs to the sheet just
replaced — a chick and a hen do not share a layout, so the row index does not
carry over. It resets the cache rather than guessing.

### T-15.14 — ~~Animals block their home tile~~  🔁 **SUPERSEDED by D-14**
Depends: T-15.08, T-15.13 · Size: S

**This task was wrong and is not being done.** It called for animals to block
their home tile. Doing so makes three chickens permanently unfeedable in a full
coop — the yard is 5x3 on 1x1 spacing and the largest flock is exactly 15, so
the middle row ends up enclosed by other chickens, unreachable and therefore
never fed again (§5.4).

Resolved in T-15.08 as **D-14: livestock is walk-through**. The `animals` block
layer still exists in `BlockMap` and nothing populates it. The arithmetic is
pinned by the `D-14` block in `apps/client/src/game/collision.test.ts`, which
asserts both halves — a full coop strands exactly three chickens, a full barn
strands none — so if a future task ever gives the coop yard more room or wider
spacing, that test fails and tells you animals *could* now be solid.

**Done:**
- [x] Decision recorded as D-14 with its evidence; no animal blocks anything
- [x] `Animal.homePosition` still exists — T-15.13 needs it as the wander
      anchor, and targeting still uses the slot rather than the drifted sprite

---

## Section D — outdoor decoration

### T-15.15 — Decor art into the pipeline  ✅ **DONE**
Depends: T-15.01 · Size: M

**Do:** copy fences, scarecrow, lamps, birdhouse, hay bales, picnic, signs,
barrels, trough, plates, notice boards, statue and berry piles from
`new_assets/Objects/Exterior/` via `scripts/prepare-assets.mjs`. Declare each as
an `ImageSpec` **appended to the END of `IMAGES`** (T-15.01's rule). Measure each
look window and its ground-contact footprint with T-15.04's script.

**Done:**
- [x] Ten kits copied as `decor-*.png`; 309 assets written
- [x] Declared as `ImageSpec` appended to the END of `IMAGES`
- [x] `scripts/measure-decor.mjs` finds each piece and its ground contact
- [x] Map regenerated: **72 → 82 tilesets, zero existing firstgids moved,
      zero ground/decor/object/plot tiles changed**
- [x] `farmMap.test.ts` green

**How it turned out.**

**The append-only rule was tested in anger and held exactly as advertised.**
Adding ten images grew `TILESET_RUNS` from 72 to 82, so `farmMap.test.ts` failed
until the map was regenerated — which is the point of it. After regenerating,
a tile-by-tile diff confirms **no existing tileset's firstgid moved and not one
ground, decor, object or plot entry changed**. The map file grew by ten tileset
declarations and nothing else.

**Every one of the ten files is a kit, not a sprite.** `Scarescrow.png` is eight
scarecrows; `Village Signs.png` is twelve signs, six plain and six snow-topped;
`Fence Wood.png` is a whole construction set drawn twice over. So the catalogue
had to name a measured window into each, and `measure-decor.mjs` needed two
modes to find them: a **grid** split for the evenly-spaced kits, and
**connected-component flood fill** for the fence, whose pieces are four
different sizes with no grid to divide by. The fence resolved into ten
components — the plain set on top (y 0-78) and the snow set below (y 80-158).

### T-15.16 — Shared decor config and placement rules  ✅ **DONE**
Depends: T-15.15, T-15.02, T-15.03, T-15.05 · Size: M

**Do:** lift `overlaps()` out of `furniture.ts` into a generic `placement.ts`.
Then `decor.ts` with `DecorDef`, `decorFootprint`, `reservedFarmTiles({coop,
barn})` and `canPlaceDecor(...) → { ok } | { ok: false, reason }`.

`DecorDef.footprint` is **authored, not derived** — unlike `FurnitureDef`, whose
footprint is `ceil(size/16)`. A 48px street lamp *stands on* one tile and
overhangs two; deriving it would reserve three tiles of ground so you could not
stand beside it. Outdoors, vertical overlap is the norm — that is what
`DEPTH.world + y` is for. **Comment this divergence loudly**; it is the most
likely thing a future reader "fixes" back into a derivation. Fence orientations
are separate catalogue ids, not a rotation column. Opens D-9.

**Done:**
- [x] `placement.ts` holds the shared rectangle arithmetic; `furniture.ts`
      delegates to it and its 203 tests are untouched
- [x] `decor.ts`: 11 pieces, `canPlaceDecor`, `reservedFarmTiles`,
      `solidDecorTiles`
- [x] A test per refusal reason (`off_map`, `reserved`, `occupied`,
      `blocks_plot`)
- [x] Every sheet key pinned against `IMAGES`, every look inside its bounds
- [x] Two break-tests confirmed; shared 155 → 180 tests

**How it turned out.**

**The shared function had to be renamed to be shareable.** `furniture.ts`
already exports `overlaps` over its own type, and both modules are re-exported
from `config/index.ts`, so lifting it as `overlaps` collided in the barrel. It
is `placementsOverlap` — matching `buildings.ts`'s `footprintsOverlap` — and
`furniture.ts` keeps its own `overlaps` as a thin adapter so no existing caller
or test changed.

**The plot ring is what makes solid decor defensible**, and it is blunter than
it first looks. A plot is worked from one of its four orthogonal neighbours, so
walling all four leaves a plot that still grows and can never be harvested — by
hand or by the idle farmer. Working out *which* neighbours are still free would
have to be redone on every placement and every removal; instead a solid piece
simply never enters the ring. Non-solid pieces may sit right beside a plot,
because you can stand on them.

**`footprint` is authored, and a test now guards the divergence.** Deriving it
from the art — as `FurnitureDef` correctly does indoors — would reserve three
tiles of ground under a street lamp whose post is 17px wide, and the player
would meet an invisible wall two tiles above a lamp. A test asserts that at
least one piece still overhangs its footprint, so the divergence cannot quietly
be "fixed" back into a derivation.

**`reservedFarmTiles` takes the CURRENT tiers**, not the reserved maximum — the
same distinction `currentBuildingFootprints` draws for collision, and for the
same reason: a tier-0 player should be able to decorate ground a Deluxe coop
would one day cover.

### T-15.17 — Migration  ✅ **DONE**
Depends: T-15.16 · Size: S

**Do:** `decor_placements` and `decor_owned`, mirroring the furniture tables.
Two tables, not a `surface` column (D-11).

**Done:**
- [x] `decor_placements` + `decor_owned`, mirroring the furniture pair
- [x] `0011_supreme_mister_sinister.sql` generated and applied; both tables and
      both indexes verified in Postgres

### T-15.18 — Decor service  ✅ **DONE**
Depends: T-15.17 · Size: M

**Do:** copy the *shape* of `modules/house/service.ts` deliberately —
`decorView`, `buyDecor` (lock the player row, gold check, SQL-side quantity
arithmetic), `placeDecor` (lock placements, assert placeable, take from owned
`where quantity > 0`), `moveDecor`, `removeDecor`. The one real difference:
`assertPlaceable` reads `farms.coopTier/barnTier` **inside the transaction**.

**Done:**
- [x] All five operations, transactional, mirroring the house module
- [x] `assertPlaceable` reads the farm's tiers inside the transaction
- [x] The flood fill runs only for SOLID pieces — a walk-over piece cannot cut
      anything off, so it is not worth 660 tiles of BFS
- [x] `docs/economy.md` updated (the repo's own ledger test demanded it)

**How it turned out.**

**The repo caught me before I could forget.** `docs.test.ts` failed with
*"these files move gold but are not listed in docs/economy.md"* — CLAUDE.md
§5.8's "an idle economy dies from unlogged faucets", enforced. Adding the row
also prompted a correction to the line above it: the interior furniture sink is
listed as live, but has been **unreachable in-game since T-11.05** unregistered
the Interior scene. Farm decoration is the first cosmetic sink a new player can
actually spend into, which is why it is priced at 15-400g rather than the
interior catalogue's 180-2,500 — it should compete with seeds, not with a barn.

**`details` on a `GameError` is flat `string | number`.** The reachability
failure wanted to hand back the list of everything it stranded; a fence across
the field strands all twenty plots. It reports the first three, joined — enough
for the player to understand, short enough to read.

### T-15.19 — Reachability guard  ✅ **DONE**
Depends: T-15.18 · Size: M

**Do:** a pure BFS from the spawn tile across walkable ground. Refuse the
placement if any plot approach ring, the chest, the merchant, the shipping box
or either yard becomes unreachable. New error code `DECOR_BLOCKS_PATH`. **This
is what makes solid decor defensible** — a player must not be able to fence
themselves out of their own field.

**Done:**
- [x] A wall across the farm is refused; the same wall with a gap is allowed
- [x] Sealing a plot's approach ring is refused even though the plot tile
      itself stays walkable
- [x] Walling the player in at spawn is refused
- [x] Any amount of walk-over decoration is always fine
- [x] Break-tested through the endpoint; 10 unit + 28 integration tests

**How it turned out.**

**Plots are represented by their approach RING, not by the plot tile.** You work
a plot by standing beside it and facing it, so a plot whose four neighbours are
sealed is unusable while remaining perfectly walkable. A naive "can I reach the
plot tile" check passes straight through that, which is why the goal is "any one
of these four neighbours".

**"Walkable" here is deliberately looser than the client's collision.** Plots
and yard slots are in `reservedFarmTiles` because nothing may be *placed* on
them — but the player may *stand* on them, so they must not block the fill. Two
different questions about the same tiles, and conflating them would refuse
placements that are actually fine.

**A gap that opens onto a building is not a gap**, and I learned that from my
own failing test. The "wall with a one-tile gap is allowed" case originally left
its gap at y=10 — directly onto the tier-0 coop's footprint (rows 7-11) — and
was refused. Correct behaviour, and now pinned as its own test: the fill reasons
about where you can walk, not about how many fence tiles you left out. A player
who puts their gate against the barn has still sealed the farm.

### T-15.20 — Routes, schemas, wiring  ✅ **DONE**
Depends: T-15.19 · Size: S

**Do:** `GET /`, `GET /catalogue`, `POST /buy|/place|/move|/remove` at
`/api/decor` — all Zod, all `runIdempotent`, rate limits mirroring house.
`move` ships as an endpoint the client does not yet call (the UI does
remove-then-place); recorded as a choice, not an oversight.

**Done:**
- [x] Five routes at `/api/decor`, all Zod, all idempotent, all rate limited
- [x] `farmTileSchema` bounds coordinates to the map at the boundary, so a
      hostile payload never reaches the flood fill
- [x] `move` shipped but uncalled by the client — recorded as a choice

### T-15.21 — Integration tests  ✅ **DONE**
Depends: T-15.20 · Size: M

**Do:** mirror `house.integration.test.ts`'s failure-path coverage, plus:
buy without gold; place without owning; place on a plot; place under the coop at
the tier the farm actually has, then upgrade; place on water; overlap another
piece; solid piece adjacent to a plot; a placement that fails reachability; a
replayed idempotency key; another player's placement id on move/remove.

**Done:**
- [x] 28 integration tests: buy without gold, place without owning, on a plot,
      on water, overlapping, beside a plot, sealing the farm, another player's
      placement on move/remove, replayed idempotency keys on all four mutations
- [x] Every failure path returns a machine-readable code
- [x] Building tiers read at placement time, both directions
- [x] Three break-tests, one of which found a hole (below)

**How it turned out.**

**A break-test found a test that was guarding nothing.** Removing
`takeOwned`'s `where quantity > 0` left the suite green — because the
"refuses a piece the player does not own" case *deletes* the storage row, so
the update matches nothing and throws for a different reason entirely. The
guard's actual job is the row that **exists at zero**, which is the real dupe
vector: without it the count goes negative and decoration is minted from
nothing, one placement at a time. That case is now its own test, and removing
the guard fails it.

**The sealing test drives the real endpoint rather than the pure function.** It
builds a fence down column 20 one piece at a time and asserts that some pieces
go down and the one that would close the wall is refused with
`DECOR_BLOCKS_PATH`. That exercises the whole path — schema, transaction, lock,
flood fill — and is the test that fails when the guard is skipped.

### T-15.22 — Client net and rendering  ✅ **DONE**
Depends: T-15.20 · Size: M

**Do:** `net/decor.ts` mirrors `net/house.ts`. `registerDecorFrames` follows the
`registerCoopFrames` pattern, guarded on `texture.has`. `DecorPiece` draws
bottom-anchored and sorts on ground contact. `Farm.syncDecor()` mirrors
`syncAnimals()`, fetched **once on create and after each mutation — never in the
20s poll** (§11: that is the hottest path).

**Done:**
- [x] `net/decor.ts`, `entities/Decor.ts`, `Farm.refreshDecor()`
- [x] One cropped frame per piece, the `registerCoopFrames` technique
- [x] Bottom-left anchored, depth-sorted on ground contact
- [x] Fetched on create and after each mutation — **never in the 20s poll**
- [x] `decorAnchorPx` unit-tested (5 cases)

**How it turned out.**

**`decorAnchorPx` had to move to shared, for the same reason `playerBounds`
did.** Its test would not load: `Decor.ts` imports Phaser, which wants `window`.
It is pure geometry over a `DecorDef`, so it now sits beside `decorFootprint` in
`config/decor.ts`. Second time this phase that a test refused to load and was
right to — a pure function living in a Phaser file is a pure function nobody can
test.

**The anchor is the bottom-left of the FOOTPRINT, not of the art.** A piece is
stored by its top-left cell, so the drawing anchor is one footprint-height
below, and the sprite then grows upward. That is what puts a 37px street lamp's
post on its own tile and its head over the tile above — the payoff for authoring
footprints instead of deriving them, and a test asserts the art really does
overhang upward rather than sinking.

**Decoration is fetched on its own clock.** Once on create, then on every
placement, pick-up and purchase — routed through `hud.onStateChange`, which
fires on player ACTIONS and never on the 20-second poll. Adding a join to the
farm-state endpoint so a fence could appear twenty seconds sooner would have
been a bad trade against §11.

### T-15.23 — Decor tab in the merchant shop  ✅ **DONE**
Depends: T-15.22 · Size: M

**Do:** a fifth tab using the existing `setMode`/`renderRow` machinery. Buying
puts the piece in decor storage, not the bag (§5.6: things are bought at the
merchant). Prices come from the catalogue endpoint, not the client's config copy.

**Done:**
- [x] Fifth tab beside Buy/Sell/Animals/Gear, reusing `setMode`
- [x] Catalogue loaded lazily on first open, from the server
- [x] Gold set from the purchase RESPONSE, never subtracted locally
- [x] Each row says whether the piece blocks the way

**How it turned out.**

**The row says `blocks the way` or `walk over it`, in the shop.** That is not
decoration on the label: `solid` decides where a piece may legally go, so a
player who buys three fences and finds they cannot ring their crops should have
been told before spending. It is the one catalogue field with gameplay in it.

### T-15.24 — Placement mode  ✅ **DONE**
Depends: T-15.23 · Size: M

**Do:** reuse the currently-dead `hud__decor` markup as a farm tray of owned
pieces; clicking one arms it. While armed, the faced-tile marker grows to the
footprint and tints valid/invalid from `canPlaceDecor`. The action key commits;
facing a placed piece empty-handed picks it back up; Escape disarms.

**Done:**
- [x] A `Decorate` tray in the bar; clicking a piece arms it
- [x] The faced-tile marker becomes the ghost: grows to the footprint, red where
      `canPlaceDecor` refuses
- [x] Action key places; empty-handed action key on a placed piece picks it up
- [x] Escape disarms; closing the tray disarms; placing the last one disarms
- [x] Place, pick up and re-place by keyboard alone

**How it turned out.**

**The ghost is drawn from the same function the server gates on**, so the two
agree — except for the reachability check, which is server-only and can refuse
a placement the ghost showed as green. That is the right way round: the client's
copy exists to catch the obvious mistake before a round trip, and a refusal it
could not predict still comes back with a readable message.

**Three separate ways to end up disarmed**, because leaving a piece armed is how
a player places a fence they had forgotten was selected: Escape, closing the
tray, and running out of that piece in storage. The last one is the subtle one —
`setDecorOwned` disarms when the armed id is no longer in stock.

**The pick-up is gated on an empty hand.** Holding a hoe and facing a fence
should still swing at the ground; silently pocketing the fence instead would
make the hoe unpredictable.

### T-15.25 — Solid decor joins the `BlockMap`  ✅ **DONE**
Depends: T-15.24, T-15.08 · Size: S

**Done:**
- [x] `refreshDecor` sets the `decor` block layer from `solidDecorTiles` —
      solid pieces only
- [x] The layer is rebuilt on the same call that redraws the sprites, so a
      picked-up fence stops blocking exactly when it stops being drawn
- [x] Walked into in the browser — **done in T-17.02**

---

## Section E — HUD and panel reskin

### T-15.26 — Pixel-art UI skin  ✅ **DONE**
Depends: — · Size: M

**Do:** T-11.05 proved the mechanism (pack art as `image-rendering: pixelated`
CSS backgrounds, custom properties fed from the shared manifest) but applied it
only to the coin and a few icons. Add `UI/Inventory/{Banner,Decor,Extras}.png`,
`dialogue box.png` and `Bars.png` to `IMAGES`, then define **one** panel
language — a 9-slice border from `Book.png`, a slot fill from `Slots.png`, a
`button.png` 9-slice for every button, `dialogue box.png` for toasts — applied
through shared `.panel` / `.btn` classes so the six panels stop each carrying
their own borders and radii. Self-host one pixel font under
`apps/client/public/fonts/` with an explicit fallback stack, and **record its
licence in `ATTRIBUTION.md`**; do not load a font from a CDN.

**Done:**
- [x] **The palette is sampled from the art**, not invented — every value read
      out of the pack with a pixel histogram, numbers recorded in the comments
- [x] Buttons carry the pack's rust with a hard-edged bevel that inverts when
      pressed
- [x] Focus rings survive; `prefers-reduced-motion` untouched
- [x] Verified in a real browser at 1280x800; console clean
- [x] 1920x1080 pass — **done in T-17.05**: panels clean, world small, and the
      reason is arithmetic rather than a bug
- [x] No webfont — **a decision, not a to-do.** Recorded below as deliberate
      since this task shipped; the box should never have been an empty one

**How it turned out.**

**The HUD was a near-miss, which is worse than a clear miss.** `--ink` was
`#2a1018` against the pack's actual `#1c0a18`; `--paper` was `#f2e3ce` against
`#f7dbc6`. Close enough to look deliberate, far enough that the bar never quite
sat with the inventory book beside it. Sampling the art — a pixel histogram over
the farmhouse, the button sheet and `ui-inventory-book.png` — gave the real
values, and `--barn: #ae4924` turned out to have been exactly right all along:
it is the pack's signature rust, used on the button plates, the barn and the
book's spine.

**`border-image` cannot slice a sub-region, and I found that out the hard way.**
The plan was to 9-slice the pack's own button plate. `ui-button.png` is an
848x544 sheet and the plate is a 48x16 region at (0,16) — but `border-image`
slices from the source image's OUTER edges, so a 5px slice took pixels from four
unrelated corners of the sheet and rendered the bar as green tiled garbage. The
screenshot was unambiguous. Using it properly would mean cropping it into its
own file, which `prepare-assets.mjs` deliberately does not do — it is a pure
copier, and its header says to resurrect the old codec from git history rather
than reach for a transform. Two hard-edged `box-shadow` insets give the same
chunky read at whole pixels, with no new asset and no new pipeline step.

**No webfont, deliberately.** T-15.26 called for a self-hosted pixel font. That
means a second licence in `ATTRIBUTION.md`, and it is a decision nobody has
taken — so the HUD stays on the system mono stack and does its work with colour
and edges. Adding a font later changes one `@font-face` and one variable.

### T-15.27 — HUD bar and hotbar composition  ✅ **DONE**
Depends: T-15.26 · Size: S

**Do:** replace the bar's two emoji with `UI_ICON` frames already in the
manifest, give the hotbar the `Slots.png` treatment with a visible selection
cursor, and deal with `HUD_MARGIN = 56` in `Farm.ts:115` — it is hardcoded, the
camera fit depends on it, and a reskin will drift it.

**Done:**
- [x] `hud.barHeight()` measures the rendered element; `HUD_MARGIN` is now only
      a pre-mount fallback
- [x] Camera fit verified clear of the bar at 1280x800 **and** 1920x1080
- [x] Emoji were already gone (T-11.05 replaced them with `UI_ICON` frames)

**How it turned out.**

**The constant had already drifted, by 15px.** `HUD_MARGIN = 56` against a bar
that renders at **71px** — so the camera reserved too little and the top of the
farm sat underneath the bar. It was wrong before this phase touched anything;
the reskin would only have made it worse. Measuring the element is the one
version that cannot go stale, and the fallback is kept purely for the frames
before the HUD mounts.

**Verified at both resolutions**, which the earlier pass had not done: the map's
top edge now lands at y=484 (1280x800) and y=764 (1920x1080), both clear of the
71px bar.

---

## Section F — farm map re-author

### T-15.28 — Re-author `farm.json`  ✅ **DONE (reduced scope)**
Depends: T-15.00, T-15.02, T-15.04, T-15.15 · Size: M

**Scope cut, deliberately and on the user's call.** The task as written called
for a full re-author: decor-layer scatter, a widened shoreline, paths re-routed
so every door and interactable sits on one, and authored fences and lamps so a
new farm is not bare. The user chose "re-route around the new house only", so
what shipped is the minimum the farmhouse forced and nothing more.

**Done:**
- [x] Path spine moved from y=6 to y=7, clear of the 8x6 farmhouse and running
      straight down from its front door
- [x] `verify-farm` clean, `farmMap.test.ts` green, `PLOT_POSITIONS` unchanged
- [x] Reachability still passes — no plot lost an approach

**Not done, and still worth doing:** the `decor` tile layer is **completely
empty** (0 non-zero tiles), so the farm is a flat green field with no grass
tufts, flowers or stones anywhere. The water is still a single hard column
rather than a widened shoreline. Those are the two changes that would most
change how the farm reads, and neither is blocked by anything — they just were
not in this pass's scope.

**Blocked by T-15.00 for a concrete reason:** until the generator and the
committed map agree, "extend the generator" means "destroy 120 authored tiles".

**Do:** with collision landed, the map's shape finally matters. Author through
the mapmaker, never by hand-editing JSON (§9): more terrain variety in the
`decor` layer (currently **completely empty** — 0 non-zero tiles), a proper
shoreline rather than a single hard water column, paths routed so every
building door and interactable sits *on* a path tile and T-15.09's reachability
passes by construction, and a few new decor images placed as authored,
unremovable map objects so a fresh farm does not read as empty before the
player buys anything.

**Original acceptance criteria, for whoever picks the rest up:**
- [x] `verify-farm` passes; `farmMap.test.ts` passes; T-15.09 passes
- [x] `PLOT_POSITIONS` unchanged

---

## Section G — world polish

### T-15.29 — House, plots, depth and shoreline  ✅ **DONE**
Depends: T-15.08, T-15.13 · Size: M

**Done:**
- [x] **The farmhouse is a real house.** `Objects/Exterior/Houses/3.png` —
      tile roof, cream walls, a door, two windows, a chimney — replaces the
      doorless silhouette cropped from the Tiny House construction kit
- [x] `HOUSE_ANCHOR` re-derived; the path spine re-routed to start below the door
- [x] **Locked plots are outlined, not blacked out**
- [x] Map regenerated, `verify-farm` clean, all tests green
- [x] `groundDepth()` centralisation — 14 call sites collapsed to one rule
- [x] Contact shadows under the player and every animal
- [x] Wet soil no longer reads as water (the `#767ede` note)
- [x] Depth rule unit-tested; client 232 → 237 tests

**How it turned out.**

**The pack ships twelve fully assembled houses and nothing had ever looked at
them.** `Objects/Exterior/Houses/1-12.png` — doors, windows, chimneys, complete
buildings. T-7.11 measured `Tiny House.png` carefully, found its only complete
looks were doorless silhouettes, and recorded that honestly as "plainer than the
old pack's" — but `Tiny House.png` is a **construction kit** (roof pieces, wall
frames, flat coloured shapes), and the finished houses are separate files one
directory up. The farm had been drawing a striped shape with no way into it for
six phases.

**Two candidate windows were tried and rejected before the right file turned
up.** Row 4 of the kit has a log cabin whose "log ends" resolve, at full size,
into dark blobs that read as holes in the wall; the two-tone shapes beside it
are clean but completely flat — no door, no window, no texture. Neither was
clearly better than what was there. Looking one directory up was the answer.

**The bigger house broke exactly one thing, and the generator said so.** At
8x6 tiles instead of 3x3 it covers (8,6), where the north-south path spine
started — `assertPathsClearOfBuildings` refused to write the map. The spine now
starts at y=7, directly below the front door, which is a better walk anyway.
Nothing else moved: plots, chest, trees, merchant and mailbox were all already
clear.

**The dark rectangle over the field was locked plots.** Sixteen of twenty plots
were filled near-black at 0.45 alpha, which painted one mud-coloured block over
the middle of the farm — easily the most conspicuously broken thing on screen,
and pure styling. A faint 0.16 wash plus a permanent outline says the same thing
per plot: you can count them, and each reads as a cell you could clear.

**Fourteen copies of one depth rule.** `DEPTH.world + feetY` was written out at
every call site — player, animals, badges, trees, house, coop, barn, decor, map
objects, plot containers. All fourteen agreed, which is exactly why collapsing
them was worth doing: a rule spelled out fourteen times only has to be mistyped
once, and the symptom (a character walking *behind* a fence they are standing in
front of) surfaces weeks later. `groundDepth()` / `aboveGround()` /
`belowGround()` now say it once, with a test pinning the tree case.

**The `#767ede` note was about wet SOIL, not water — and the pack really does
draw it that way.** T-9.05's aside read as a sampling mistake; it is not. Rows
4-7 of `Tilled Soil and wet soil.png` are genuinely blue-violet. But
`ground-soil-*.png` are **first-party** tiles, synthesised by
`scripts/draw-ground-tiles.py` precisely because the pack ships no flat fills —
so this is a choice we are entitled to make rather than a correction to the
artist. A watered plot turned the same blue as the river down the west edge: the
one surface that has to say "this crop is growing" was saying "this is a
puddle". Wet earth is dark earth, so it is now the dry colour at ~62%
luminance, `#76422a`, revertible by one tuple.

**Shadows are their own game objects, not children of the sprite.** A child
would inherit the container's depth and sort level with the character instead of
beneath it. That also means they have to be destroyed explicitly — the container
does not take them with it.

**Do:**
- **One sort rule, asserted.** The player, animals, trees, buildings and decor
  each compute `DEPTH.world + feetY` locally today. Centralise as
  `groundDepth(feetY)` in `depth.ts` and use it everywhere.
- **Contact shadows.** A 2px dark ellipse under the player and each animal, one
  below its own depth. This is the highest-value pixel-art read there is: it is
  what makes a sprite look *on* the ground rather than pasted over it.
- **Shoreline colour.** `assets.ts:157` records the sample `#767ede` taken from
  the wet-soil band, and T-9.05's write-up already flags that it reads as
  "shallow water". Sample the actual water tile instead.
- Confirm tree sway and animal wander both hold still under
  `prefers-reduced-motion`.

**Done:**
- [x] A test that the player sorts in front of a tree one tile north and behind
      one a tile south — `depth.test.ts`, listed above as "depth rule
      unit-tested"; this box was a duplicate of it and was never ticked
- [x] Reduced motion freezes sway, wander and the coin — the coin landed here
      (CSS, T-15.26); **sway and wander did not, and were closed by T-17.01**

---

## Phase 15 complete

T-15.00 through T-15.29 are done. The farm has collision, the animals move, the
farm can be decorated, and the HUD is in the same palette as the art it sits
over. Final state: **1,359 tests** (185 shared + 70 mapmaker + 237 client + 867
server), up 153 from Phase 13's 1,206.

**Verified in a real browser**, not only by tests. The Playwright MCP is pinned
to the Chrome channel and Chrome is not installed on this machine, so the checks
drive `playwright-core` directly against the chromium Playwright already ships,
with an explicit `executablePath`. Scripts live in the session scratchpad; the
pattern is four lines and worth keeping.

### What this phase found that nobody was looking for

Five of these were pre-existing and none had a symptom anyone had reported:

1. **`generate-farm.ts` and `farm.json` had diverged** (T-15.00). Regenerating
   would have flattened 120 tiles of border art, and `pnpm plots` — which
   `plots.generated.ts` invites you to run — would have relocated **every plot
   on every farm**.
2. **The chest made a plot permanently unreachable** (T-15.08). Its footing
   straddled a tile boundary onto plot (9,10) and severed the path spine.
   Invisible until something was solid.
3. **Solid animals would have made three chickens unfeedable** (D-14). A full
   coop fills every yard slot; the middle row ends up enclosed by other
   chickens. Cows are fine, which is the trap.
4. **The farmhouse had no door** (T-15.29). The pack ships twelve assembled
   houses in `Objects/Exterior/Houses/`; nothing had ever opened them.
5. **`HUD_MARGIN` was 15px short** (T-15.27), so the top of the farm sat under
   the bar.

Plus one introduced and caught the same day: every decor request went to
`/api/api/decor`, because the `api` helper already prefixes `/api`. No unit test
touches the network, so only a browser could find it.

### Open decisions this phase added

D-7 (doorways as faced-tile triggers), D-8 (no A* for the idle farmer), D-9
(per-def solid decor + flood fill), D-10 (**decided** — chicken sheets carry no
facings), D-11 (two placement tables), D-12 (**still open** — camera fit vs
follow; at 1920x1080 the farm occupies about half the screen), D-13
(**decided** — the generator owns the map), D-14 (**decided** — livestock is
walk-through).

### What is deliberately still not done

- **The `decor` tile layer is empty.** Zero non-zero tiles: no grass tufts, no
  flowers, no stones anywhere on the farm. The single biggest remaining visual
  win, and T-15.28's scope was cut before reaching it.
- **The water is one hard column**, not a widened shoreline.
- **No webfont.** The HUD is on the system mono stack; adding a typeface means a
  second licence in `ATTRIBUTION.md` and is a decision nobody has taken.
- **House tiers still buy nothing visible.** `setTier` remains a no-op
  picture-wise — one look for three tiers, unchanged since T-7.11.
- Everything Phase 14 already defers: trade UI, VIP UI, the Interior scene,
  chopping, mining, fishing, combat, energy, day/night, seasons.

---

# Phase 16 — Rooms, routines and the right icons

Phase 15 gave the farm presence. Playing *that* surfaced five more gaps — and
three of the five turned out to be partly or wholly built already. This phase is
as much about **not rebuilding** as about writing new code.

| Ask | State when Phase 16 opened |
|---|---|
| The player starts with the tools he needs | ✅ **Already ships.** `STARTING_ITEMS` grants `hoe_wood`, `watering_can_wood`, 4x `leek_seeds`, 2x `potato_seeds` at `slotIndex: index`, so the tools land on hotbar keys 1 and 2. Order is load-bearing and test-pinned. **Verify only, no work.** |
| A door that leads to an interior map | ❌ The whole subsystem exists and is unreachable. `House.doorway()` has **zero callers**; `scenes/Interior.ts` (485 lines) is written, tested and left out of `main.ts`; `/api/house` plus `furniture_placements`/`furniture_owned` are green with 203 tests. The blocker is **art**, not code |
| The animals walk around | ⚠️ Half-built. `animalWander.ts` drifts each animal a few pixels inside its own tile. Nothing translates, and no animal has ever played its peck/nest/lie rows |
| Animations when the player uses tools | ⚠️ Half-built. `playToolAnimation('hoe' \| 'water')` is complete — four layers plus a tool overlay, duration-locked from measured frame data. `swingForKind` returns `null` for **plant and harvest**, and collect/feed deliberately swing nothing |
| A seed bag to plant with; the seed sprite once planted | ❌ Backwards. `items.ts:seed()` sets the inventory icon to `CROPS[crop].seedFrame`, which **is** `stageFrames[0]` — the bag in your hand and the sprout in the soil are literally the same 16x16 frame |

## The art finding that unblocks the interior

`furniture.ts`'s own header says the room is a drawn rectangle because
*"`Interior.png` is furniture only — no floor or wall tiles anywhere in the
pack"*. That was true of the **old, deleted** pack. It is not true now, and
nobody had looked:

- `Tileset/Tileset House.png` — 832x384 (52x24 tiles): wall bands and plank
  floors in ~13 colourways. A real interior tileset.
- `Tileset/carpet.png` — 224x192.
- `Objects/Interior/` — `Beds`, `Sofa and armchair`, `Tables and desks`
  (refrigerators included), `Chairs`, `Closet`, `Dressers`, `Fireplace`,
  `Doors, windows and curtains`, `Others` (bookshelves, windows, trunks), and
  six candle sheets.

This is the same shape of miss as T-15.29's twelve assembled houses: the art was
always there, one directory over from where anyone looked.

**There is no TV in the pack** — it is a cottage set with a few modern pieces.
The signature interior pieces are the fireplace, bookshelf, bed, table and rug.
Recorded because the ask named a TV specifically.

## What is deliberately NOT in this phase

Everything Phase 14 defers, minus the two items this phase pulls up (T-14.04's
interior, and the furniture art gap `furniture.ts` flagged for itself). Trade UI,
VIP UI, chopping, mining, fishing, combat, energy, day/night and seasons all stay
where they are. **No coop or barn interior** — those would reopen the pasture
slot system by asking where animals render, and the animals are the other half of
this phase.

## Two calls worth defending

1. **Chickens do not walk, and that is the art telling us so** (D-15). The
   temptation is to translate every animal because "the animals walk around" was
   the ask. The chicken sheet has no walk cycle — three independent measurements
   in T-15.10 say every row is an upright idle with a 1px bob. Moving one across
   tiles is sliding a decal. The rows it *does* have (peck, deep peck, nest, lie
   down) have never been played by anything, and a routine built from them reads
   as more alive than motion the art cannot support.
2. **The furniture system is revived, not replaced.** A hand-authored fixed room
   would be faster to a walkable house and would throw away a complete,
   transactional, 203-test server module over an art problem. The server never
   stopped working; only its crop windows point at a deleted file.

---

## Section A — Seed bags

### T-16.01 — Seeds look like seed packets  ✅ **DONE**
Depends: — · Size: S

**Do:** `Icons/RPG icons/Extras/Bags.png` is 112x16 — **seven frames of 16x16**,
one per bag colour. Add it to `scripts/prepare-assets.mjs` and to `SHEETS` in
`config/assets.ts` as `ICON_SEED_BAGS`.

**Append it at the END of `SHEETS`.** `allocate()` in `config/tilesets.ts` hands
out `firstgid`s in `SHEETS`-then-`IMAGES` order, so inserting anywhere else
shifts every later tileset's gids and silently repaints `farm.json`. That is the
T-15.00 failure mode exactly; `apps/mapmaker/src/io/farmMap.test.ts` is the guard
that catches it, and it must be run.

Then give `CropDef` a `seedBagFrame` and point `items.ts:seed()` at it. **Leave
`seedFrame` and `stageFrames[0]` alone** — the sprout in the soil was always
right; only the item icon was wrong.

**Done:**
- [x] No seed item's icon sheet is a crop sheet — the exact confusion being
      fixed, asserted so a revert fails
- [x] The four crops use four distinct bag frames
- [x] Browser: hotbar 3 and 4 show bags; planting still puts the sprout on the plot
- [x] Both break-tests confirmed; shared 185 → 187 tests, suite 1,359 → 1,361

**How it turned out.**

**The bug was that two correct numbers were the same number.** `items.ts` built a
seed's icon from `CROPS[crop].seedFrame`, and `seedFrame` is 0, and
`stageFrames[0]` is also 0 — so the packet in the hotbar was pixel-identical to
the sprout it turns into. Every existing test passed, because each number was
individually right; nothing asserted they were supposed to *differ*. That is why
the new test asserts the separation (`no seed item is iconed with a crop sheet`)
rather than a frame number: a test pinning `frame === 3` would go green again the
moment someone re-picked the bag colours, and would say nothing about the actual
rule.

**`seedFrame` was kept, not deleted.** It looks redundant now that nothing reads
it for an icon, but it names a real thing the plot still draws — the
just-planted look — which a future crop could give its own frame. Both fields now
carry a comment saying which of the two sheets they index, because the whole
defect was two frame numbers on two different sheets that looked interchangeable.

**The pack has no seed art at all.** Searched: nothing matching `*seed*` anywhere
under `new_assets/`. `Icons/RPG icons/Extras/Bags.png` is seven 16x16 sacks —
brown, blue, blue/gold, red, red/gold, white, navy — so each crop takes the one
closest to its own colour (potato brown, strawberry red, leek white, onion navy).
That is a stand-in in the same sense `ICON_WHEAT` stands in for hay, with one
difference worth recording: here the *value is in not matching*. Any future swap
to better art must keep the seed off the crop sheet, which is what the test holds.

**`no two items share an icon` already existed and caught the duplicate**, which
is why the second break-test fired twice. The new distinctness test was kept
anyway — the old one reports it as a generic catalogue complaint, and this one
says what the rule is for.

**Two things found on the way, neither suspected.**

1. **Every plot cell had soil painted into `farm.json`'s ground layer.** The
   seed-bag sheet had to go in `SHEETS` (it is a 7-frame strip, and `IMAGES`
   allocates exactly one tile per entry), which shifts every `IMAGES` firstgid
   and forces the regeneration the manifest comment prescribes. Regenerating
   changed exactly 20 tiles — and those 20 tiles are exactly `PLOT_POSITIONS`.
   The committed map had soil baked under all twenty plots, so an **untilled plot
   looked tilled** and the hoe appeared to do nothing. T-9.04 decided plot cells
   are grass and soil is server state that `drawSoil()` renders; the generator has
   been painting grass there ever since, and D-13 made the generator the
   authority. The committed map was simply stale. This is the same divergence
   class T-15.00 found, and it had survived that task.
2. **`house.integration.test.ts`'s "cannot be raced into stacking two pieces on
   one cell" flakes under full-suite load.** It failed once in a full `pnpm test`,
   then passed six times in isolation on a stashed clean tree and again in a full
   re-run. Not caused by this task — it touches no server code — but worth
   recording here because **T-16.14 is the task that puts the house module back in
   front of players**, and a concurrency test that only fails under load is
   exactly the one not to dismiss when it fails again.

**Verified in a real browser** on a brand-new account (`playwright-core` driven
directly at the bundled chromium with an explicit `executablePath`, per Phase
15). Hotbar 1-4: hoe, watering can, **white sack x4**, **brown sack x2**. Tilled,
planted and watered one plot; `GET /api/farm` reports plot (9,10) planted with
leek and wet, `GET /api/inventory` reports `leek_seeds` down 4 → 3, and the plot
draws the scattered-seed frame on dark wet soil. No console errors, no 4xx.
That single run also discharges the starter-tools ask — the kit was already
correct, and this confirms it on a fresh registration.

---

## Section B — The rest of the tool animations

The pack ships every animation needed and none are wired. All three have the
same four layers as the live anims and the same four-direction layout, measured:

| Verb | Folder | Strip | Frames/dir | Tool overlay? |
|---|---|---|---|---|
| plant | `6. Shovel` | 640x32 | 5 | yes (`Weapons`) |
| harvest | `13.3 Carrying - Pick Up` | 512x32 | 4 | no — bare hands |
| collect / feed | `20. Petting` | 384x32 | 3 | no — bare hands |

### T-16.02 — Three animations into the pipeline  ✅ **DONE**
Depends: — · Size: M

**Do:** `prepare-assets.mjs` copies the layer strips to
`public/assets/character/<anim>/<layer>/<variant>.png`, matching `charLayerPath()`.
Extend `CHAR_ANIMS` with `plant`, `harvest` and `pet`, and `FARM_ANIMS` in
`entities/characterLayers.ts`. `TOOL_ANIMS` means "has a `Weapons` overlay" and
gains `plant` only. `Player.buildLayers()` hardcodes `toolTextureKey('hoe')` as
its invisible placeholder — harmless today, but it becomes the one place that
assumes a tool anim, so make it explicit.

**Done:**
- [x] `charAnimDurationMs` returns a sane lock per anim — a 3-frame pet at the
      wrong fps is a flicker, not an animation
- [x] `FarmAnim`'s derived union still stops `draw()` requesting an unloaded
      strip; an unregistered `anims.play` is a silent no-op, which is why the
      type exists at all
- [x] `plant` deliberately excluded from `TOOL_ANIMS`, with a test pinning it
- [x] Two break-tests confirmed; shared 187 → 189 tests; 311 → 446 prepared assets

**How it turned out.**

**The pack ships ~45 animation folders and five had ever been opened.** T-8.09
recorded that planting and harvesting had no animation and that "a wrong-looking
swing is worse than none" — sound reasoning on a false premise. `6. Shovel` is a
crouch-lean-rise, `13.3 Carrying - Pick Up` is bend-take-straighten, and
`20. Petting` is a kneel and a reach. Every one carries the identical
`Skins`/`Eyes`/`Hair's`/`Clothers` tree the wired five do, so
`characterCopies()` needed no special-casing at all — the work was three lines
in `CHARACTER_ANIMS` and three entries in `CHAR_ANIMS`.

**Nothing was guessed.** Every layer file inside each new folder was measured
and confirmed to share one size before a number went into config, the same
discipline `CHAR_ANIMS`'s comment demands. That is also why the existing width,
uniqueness, direction-tiling and integer-duration guards all passed on the first
run: they iterate `CHAR_ANIMS`, so three correct entries simply joined them.

**`plant` gets no shovel, and that is the call worth defending.** `6. Shovel`
ships `Weapons/Shovel/1.png` at exactly matching geometry, so wiring it into
`TOOL_ANIMS` would work and would look like the obviously-intended thing.
There is no shovel ITEM. Tools here are things you own and equip (§5.2), the
hand is holding a seed packet, and drawing an implement that is in nobody's
backpack is precisely the "wrong-looking animation" T-8.09 was right to avoid.
`harvest` and `pet` have no weapon folder at all, so `plant` is the only one
this is ever tempting for — hence a test, a comment in `TOOL_ANIMS`, and a
comment in `TOOL_OVERLAYS` where someone would go to add it.

**The duration floor is a gameplay constraint, not a visual one.** The swing
LOCKS MOVEMENT for its own length. `pet` is 3 frames against watering's 8, so
at the tool anims' 10fps it would last 300ms — close enough to a single frame of
hesitation that the action reads as not having happened. It runs at 6. The test
pins the property (400–1200ms) rather than the fps, so retuning a rate stays
free while making an action imperceptible does not.

### T-16.03 — Every verb swings  ✅ **DONE**
Depends: T-16.02 · Size: S

**Do:** widen `playToolAnimation` past `'hoe' | 'water'` and make `swingForKind`
total. Delete `Farm.act()`'s comment that collecting and feeding have no swing
because "a wrong-looking animation is worse than none" — true when the only
strips were hoe and watering, and `20. Petting` is exactly right for kneeling at
a cow. Route animal intents through a swing before `sendAnimal`.

`swingForKind` is also the idle replay's source of truth, so the autonomous
farmer starts planting and harvesting visibly for free.

**Done:**
- [x] `actions.test.ts` asserted `plant` and `harvest` return `null`. Inverted —
      they were the spec being changed
- [x] The movement lock still matches each animation's own length
- [x] Break-test confirmed (both mapping and totality tests fail); client
      237 → 239 tests, suite 1,361 → 1,365
- [x] All five swings verified frame-by-frame in a real browser

**How it turned out.**

**`swingForKind` became total, and that deleted more than it added.** It
returned `'hoe' | 'water' | null`, so both call sites read
`const swing = …; if (swing) player.playToolAnimation(swing)`. Both are now a
bare call. The function is a `switch` with **no `default`**, so adding a fifth
verb to `FarmIntent` fails to compile here rather than silently returning
`undefined` into `anims.play` — which does nothing and logs nothing, the T-8.04
finding that `FarmAnim` exists to prevent.

**The `'water'` → `'watering'` mapping is gone.** `playToolAnimation` took a
private two-value vocabulary and translated it to the real animation key inside
the method. The new `Swing` type IS the animation key, so the lookup disappears
rather than growing to five entries. Its only job had been to paper over two
names that had drifted apart.

**Hiding the tool sprite on a bare-handed swing is not optional.** The sprite
holds whatever it last played, so a plant immediately after a till showed a
floating hoe. `isToolAnim` is a narrowing guard over the shared `TOOL_ANIMS`
rather than `anim === 'hoe' || anim === 'watering'`, so the one list that decides
which overlay strips get copied is the same list that decides whether to draw
one — it stays right when D-4 adds tiers or T-14.05 adds an axe.

**The idle farmer started planting and harvesting for free.** `driveIdleReplay`
already asked `swingForKind`; making that total was the entire change. One list,
and it was already the one both paths consulted.

**Verified in a real browser, all five swings, frame by frame** (screenshots at
~95ms across each swing):

| Verb | What the frames show |
|---|---|
| till | hoe overlay visible mid-swing; the plot turns from outlined grass to soil |
| plant | crouch and place, **hands empty — no shovel**; the seed frame appears |
| water | can held, **blue water pixels pouring**; soil goes dry → wet |
| harvest | bend and straighten; the ripe leek leaves vanish, plot back to bare soil, 1 leek in the bag |
| pet | reach toward the chicken; `isFed` flips false → true |

Harvest needed a ripe crop, so `plots.grown_ms` was pushed forward directly in
the dev database rather than waiting 45 minutes for a leek.

**Three things the browser confirmed that no test covers.** None are bugs; all
three are systems working and worth having seen:

1. **Collision is real.** A straight run east from spawn stops dead against the
   farmhouse. Reaching the coop needs a path around it — which is what T-15.08
   built and what `reachability.ts` proves stays possible.
2. **The login rate limit fires.** Ten logins inside fifteen minutes returned
   429 and locked the verification out (§8). Cleared by restarting the dev
   server, since the HTTP limiter is in-memory rather than in Redis — worth
   knowing before someone goes looking in Redis for the key, as this did.
3. **You cannot equip an item the client has not polled yet.** Feed bought
   through the API is invisible to the hotbar for up to 20s, so its number key
   selects an empty slot and quietly leaves the previous tool equipped — and
   facing a chicken holding a hoe is a refusal, not a swing. Correct behaviour
   (a player buying at the merchant gets the update immediately), and it cost
   two runs to recognise.

---

## Section C — Animals that live

Keep `animalWander.ts`'s central design intact: **pose is a pure function of
`(animalId, absolute time)`** — no accumulated state, no RNG object, no per-frame
integration. That is what makes it survive 20s polls, backgrounded tabs and
scene sleep/wake identically. A roaming cow must not break it.

### T-16.04 — Cows walk the barn yard  ✅ **DONE**
Depends: — · Size: M

**Do:** extend `wanderPose` so a cow's `(x, y)` is a deterministic walk between
yard positions rather than a few pixels of drift, still derived from
`seedFrom(animalId)` and `now`. `BARN_YARD` is 9x1 on 2-tile spacing, so there is
real room without leaving the yard. Drive the row from `ANIMAL_COW_POSE_ROWS`
through the existing `poseRowFor`: `walkSide` (+`setFlipX` for right, per
`ANIMAL_COW_MIRRORS_SIDE`), `walkFront`, `walkBack` moving; `lieSide`/`chewSide`
at rest. All measured in T-15.10 — no new measurement.

**Done:**
- [x] `it('stays inside the band its kind is allowed')` over a long sweep, every
      animal id, at full occupancy — and never changes COLUMN
- [x] `it('a cow really does visit every row its band allows')`
- [x] Determinism across a simulated poll gap still holds (unchanged test)
- [x] Three break-tests confirmed; client 239 → 246 tests

**How it turned out.**

**A cow marching on the spot was the bug nobody had reported.** The cow sheet
has no standing-still row — rows 0/1/2 are the walk cycle, and `poseRowFor` also
hands them back for a stationary cow because they are the only source of a
facing. `registerAnimalAnimations` looped every row unconditionally, so from
T-15.13 until now a resting cow played its full leg-alternation cycle without
moving. That is why `PosePlayback` exists: `hold` is a deliberately one-frame
animation, not a zero-repeat run of the row, because playing four frames once
still shows the legs move before settling.

**The roam is vertical, and that is forced rather than chosen.** `BARN_YARD`
spaces cows 2 tiles apart and the cow sprite is 32px — exactly 2 tiles — so at
the barn's worst case (tier-2 cap 6 plus VIP 3 = 9 cows, every slot filled) two
neighbours abut with zero gap. Roaming sideways would overlap them, and once
`bounds()` follows the sprite that is not merely ugly: it is two cows answering
on one tile, which is D-14's trap in a new costume. Vertically there is room.

**Then a test found trees where a hand-check had found none.** The first version
let cows roam one tile UP as well as down, on the strength of my own scan of the
band saying it was empty. It was not: `reachability.test.ts` failed immediately
with `cow #0 can stand on blocked tile (2,17)`. Maple trees sit directly above
two of the nine cow columns, x=2 and x=18 — and the earlier scan had missed them
by anchoring tree footprints from the sprite's TOP edge instead of Tiled's
bottom-edge convention, which put them three rows too high. Nothing at runtime
would have caught it: animals are not solid (D-14) and the wander is pure
arithmetic that never consults the block map, so those two cows would simply
have spent part of their lives standing inside a tree, somewhere the player
cannot walk. The roam goes south only, into the band that really is clear.

**The whole-tile quantisation is load-bearing, not tidiness.** `roamOffsetFor`
returns a whole number of tiles, so a cow interpolates between two tile-aligned
destinations and only sits between tiles while it is visibly walking. An animal
parked on a half-tile has no tile, and `bounds()` has to name one.

### T-16.05 — Chickens get a routine (D-15)  ✅ **DONE**
Depends: — · Size: M

**Do:** chickens keep their home tile and gain a behaviour state machine on the
same seed-plus-time function: `idle → idleAlt → idleAlt2 → peck → peckDeep →
nest → lieDown`, weighted dwell times. Every row is already named in
`ANIMAL_CHICKEN_POSE_ROWS`, and per D-10 none carry facing, so `poseRowFor` needs
no change.

**Done:**
- [x] `it('an adult hen can reach every measured row of its sheet')` — all seven
- [x] `lieDown` plays once and holds on the settled frame rather than looping
- [x] `it('never draws a chick as anything but its idle row')`
- [x] Break-test confirmed on the chick guard

**How it turned out.**

**Seven measured rows, three reachable.** T-7.10 measured the whole chicken
sheet and T-15.11 named every row, but the four poses `AnimalPose` carried were
the ones a *cow* can be in — so `idleAlt`, `idleAlt2`, `peckDeep` and `nest` had
names, comments and no way to be selected. The routine is what spends them, and
it is what a chicken gets *instead* of walking (D-15), not a consolation for it.

**The weights are the design.** Pecking dominates at 45% because it is the most
legible "this is a live bird" read at 16 pixels. The three near-identical idles
share 35% between them, and their near-identity is exactly the point: rotating
them is most of what stops a row of chickens looking stamped from one die.
Settling down is 10%, because a yard where a third of the birds are lying down
looks asleep rather than alive.

**A chick turned back into an egg, and only a browser could have seen it.**
The chick sheet has the adult's 4x7 GEOMETRY and different row SEMANTICS:
`ANIMAL_CHICKEN_POSE_ROWS.peckDeep` is row 4, and row 4 of a chick sheet is
`ANIMAL_CHICKEN_BABY_HATCH_ROW` — white egg, cracking egg, chick emerging. So
every baby chicken in the coop periodically reverted to an egg on screen. Every
invariant a unit test could check still held: the row exists, it is in range, it
animates, the sprite stays on its tile. `assets.ts` even said the hatch row was
"recorded but not wired… there is nothing that would ever play this row" — true
when written, and quietly false the moment the routine widened.

Only row 4 of the chick sheet was ever measured, so every other chick row is a
guess. Chicks now hold their idle row and nothing else until someone measures
them: "measure, never guess" (§9), applied to the sheet that has not been.

### T-16.06 — Targeting stays fair (D-16)  ✅ **DONE**
Depends: T-16.04 · Size: S

**Do:** `Animal.bounds()` returns the home rect so a sub-tile drift stays fair to
target. A cow two tiles away inverts that problem. Decide and pin: `bounds()`
follows the roaming cow (feed what you see); chickens keep the home rect, which
they never leave anyway. `Farm.facedAnimal()` reads `bounds()` and changes either
way, so the decision lives entirely in `Animal.ts`.

**Done:**
- [x] `it('never roams onto a tile the world blocks')` — worst-case world, full herd
- [x] `it('always leaves a tile the player can face it from')`
- [x] `it('no two cows ever answer on the same tile')` — sampled over real
      wander output, 120 legs x 3 phases
- [x] Break-tests: roaming up, roaming sideways, and a roaming chicken all fail

**How it turned out.**

**D-16 decided: the box follows the animal.** `bounds()` returned the home slot,
and the comment explaining why called itself out as looking like a bug. It was
right for a sub-tile drift and became wrong the moment a cow could leave its
tile: you would face a cow you are standing beside and be told about a tile two
rows away. The rule is now simply "the tile the player can see it on", which is
the same answer as before for a chicken, because a chicken never leaves its slot.

**`lastTile` is written by `update()`, not computed in `bounds()`.**
`facedAnimal()` asks every animal on every action press, and the answer has to
be the tile the frame actually drew rather than one recomputed from a slightly
different `now`. It is seeded from the home slot in the constructor, because the
scene builds animals on a poll and only drives them on the next tick — an animal
untargetable for one frame is a keypress that silently does nothing.

**Three properties, all proved at FULL occupancy against the worst-case world**
— top-tier buildings, every object, the water. Half a barn proves nothing about
a full one, which is the entire lesson of D-14. The third property (no two cows
share a tile) is sampled from real wander output rather than argued from the
config, so a future horizontal roam fails here rather than in someone's barn.

**Verified in a real browser**, watching both yards over ~25 seconds with two
cows and three chickens, matured and fed directly in the dev database:

- Cows **change rows** — grass at y=18 down onto the path — and switch between
  the front view and the side view as they turn. One lies down mid-sequence.
  Standing cows hold still instead of marching.
- Chickens **never move** and visibly cycle poses: upright idles, a deep crouch,
  a peck with the head down. Three birds are in different states at the same
  instant.
- No console errors and no 4xx across the whole session.

**The house race test flaked a second time** under full-suite load, and passed
on its own immediately after — same test, same conditions as T-16.01 recorded.
Two sightings now. Still nothing this phase touches, and still the thing to look
at first when T-16.14 puts that module back in front of players.

---

## Section D — The house interior

The biggest section and mostly plumbing. Art and multi-map support first: the
scene cannot be tested without them.

### T-16.07 — Interior art into the pipeline  ✅ **DONE**
Depends: — · Size: M

**Do:** add to `prepare-assets.mjs` and `SHEETS`, **appended at the end** for
T-16.01's gid reason: `Tileset House.png`, `carpet.png`, and the interior object
sheets. Run `pnpm --filter @tillhaven/mapmaker test` after — `farmMap.test.ts` is
all that stands between an `assets.ts` edit and a silently repainted farm.

**Done:**
- [x] `TILESET_HOUSE` in `SHEETS`; nine furniture kits appended to `IMAGES`
- [x] Map regenerated; the resolved ART is byte-identical, only gids moved
- [x] Drift guard green

**How it turned out.**

**`Tileset House.png` is the file T-3.05 said did not exist.** Its comment —
"`Interior.png` is furniture only, no floor or wall tiles anywhere in the pack"
— was an accurate statement about the OLD pack, deleted in T-7.07, and it has
been quoted as a constraint ever since. This pack ships 52x24 tiles of wall
bands and plank floors in about thirteen colourways. Same shape of miss as
T-15.29's twelve assembled houses: right conclusion, wrong pack, nobody
re-checked.

**Only the tileset went into `SHEETS`; the furniture kits are `IMAGES`.** The
distinction is not cosmetic — `SHEETS` entries get a gid run each, so anything
added there renumbers everything after it, while `IMAGES` appended at the end
shift nothing. The tileset has to be a sheet because the interior map is painted
from it. The kits are irregular grids of assembled furniture, addressed by
measured crop windows exactly like the house and coop exteriors, so they have no
business in a gid table.

**The regeneration was checked for what it actually changed.** 565 ground tiles
came back with different numbers, which looks alarming and is not: resolving
both maps through their own `firstgid` tables gives byte-identical art. That
check is worth keeping — "the file changed a lot" and "the farm looks different"
are entirely different claims, and only the second one matters.

**Two kits were registered and then removed.** `Sofa and armchair.png` and
`Closet.png` went in with the rest before it was clear no catalogue piece would
crop from them. A registered sheet is a sheet every player downloads, so they
came back out — 70KB for nothing. They are in the pack the day a piece needs
them.

### T-16.08 — Re-measure the fourteen furniture pieces  ✅ **DONE**
Depends: T-16.07 · Size: L

**Do:** write `scripts/measure-interior.mjs` in the shape of
`measure-object-bases.mjs`. Then rewrite `config/furniture.ts`:

- **`FurnitureDef` gains `sheet: SheetSpec`** and the module-level
  `FURNITURE_SHEET` goes away — the new art is spread across ~9 files where the
  old pack had one. Mirrors `CropDef.sheet`, which solved this in T-7.04.
- All 14 crop windows replaced with measured values. Ids, names, prices and
  `vipOnly` unchanged — `docs/economy.md` and the §7 tests are keyed to them.
- `footprint = ceil(size/16)` stays derived, not judged.
- Delete the header comment calling the sheet a bounds-safe stand-in.

Consumers: `Interior.ts` and `hud.ts` read `FURNITURE_SHEET`; both become
`def.sheet.key`.

**Done:**
- [x] `scripts/measure-interior.py` — flood-fill components per kit, plus
      labelled contact sheets
- [x] All 14 crops replaced with measured values; `FurnitureDef.sheet` added and
      `FURNITURE_SHEET` deleted
- [x] `it('crops every piece from inside its own sheet')` — against each kit's
      real size, not one hardcoded number
- [x] `it('draws every piece from a registered image')`
- [x] The §7 scan still passes, with `sheet` admitted to the allowed-field list
      deliberately rather than the guard being relaxed
- [x] Two break-tests confirmed; server 867 → 868 tests

**How it turned out.**

**The old test could not have caught the old bug.** `crops every piece from
inside the sheet` compared all 14 windows against a hardcoded 192x144 — the
dimensions of a sheet that had already been deleted — so it stayed green while
every piece rendered as an arbitrary slice of a house roof. The bound is now the
piece's own kit's real size, which is the assertion that would have failed.

**Components find the pieces; the contact sheet is the check on components.**
Flood-filling opaque pixels finds real furniture in irregular kits without
anyone deciding what a cell "should" be. It gets one thing wrong — pieces that
touch merge — and that is exactly what happened: the first `dresser` was three
dressers in one box, and the first `chair` was an office chair on castors.
Looking at the labelled render caught both in seconds.

**Three pieces were renamed, because the art contradicted the label.**

1. "Bunk Bed" → **Four-poster Bed**. The pack has no bunk beds at all.
2. `window` / "Window" → `mirror` / **Standing Mirror**. This one is a finding:
   `Doors, windows and curtains.png` contains **nothing but curtains** despite
   its name, and the only wall-hung candidates anywhere are the arched panels in
   `Others.png`, which at 8x are unmistakably mirrors — oval glass, diagonal
   highlight. There is no window art in this pack. Renaming the ID is free
   because the house module has been unregistered since T-11.05, so
   `furniture_owned` and `furniture_placements` have no rows on any farm.
3. "Table" → **Round Table**, matching the piece chosen.

Prices are untouched, so `docs/economy.md`'s 11,580g total is unchanged; the
ledger records the renames rather than being silently out of step.

**Python, not a fourth `measure-*.mjs`.** The three existing measure scripts
each carry their own ~150-line PNG decoder because Node has none. Pillow makes
this sixty lines, and `scripts/draw-ground-tiles.py` already establishes Python
as the language for asset work here.

### T-16.09 — Multi-map plumbing  ✅ **DONE**
Depends: — · Size: M

**Do:** `FARM_WIDTH`/`FARM_HEIGHT` are consumed as ambient globals. Two consumers
become per-map: `facedTile` takes a `bounds` parameter (`standingTile` is
deliberately unclamped and stays), and `TILEMAPS` grows a second entry. Leave
`pasture.ts`, `decor.ts`, `reachability.ts` and `schemas/index.ts` on the farm
constants — farm-only systems, and parameterising them is churn with no caller.

**Done:**
- [x] `MapBounds` and `FARM_BOUNDS` in shared config; `INTERIOR_MAP` in `TILEMAPS`
- [x] `facedTile(position, facing, bounds?)`, clamping to whichever it is given
- [x] Three tests, including one asserting the farm default leaves all four
      existing call sites unchanged; client 246 → 249

**How it turned out.**

**One parameter, deliberately, and not four.** `FARM_WIDTH`/`FARM_HEIGHT` are
read as ambient globals in seven places. Only `facedTile` had to change: it is
the one that runs against whichever map the character is standing in, and it is
wrong the moment there are two. `pasture.ts`, `decor.ts`, `reachability.ts` and
the farm tile schemas stay on the constants — they are farm-only systems with no
second caller, and threading a bounds through them would make every signature
longer to express a generality nothing uses.

**Defaulted rather than required.** `facedTile(pos, facing)` still means the
farm, so the four farm call sites read exactly as before and the diff is one
function. A test pins that equivalence, because a default that silently drifts
from `FARM_BOUNDS` would be worse than no default.

**The bug it prevents is specific:** a character at the east wall of a
twelve-tile room, facing east, would have been told about column 29 — seventeen
columns outside the room, on a tile the interior has no object on. The action
key would have done nothing, with nothing on screen to explain why.

### T-16.10 — Author the interior tilemap (D-17)  ✅ **DONE**
Depends: T-16.07, T-16.09 · Size: M

**Do:** `apps/mapmaker/scripts/generate-interior.ts`, mirroring
`generate-farm.ts` — the generator is the authority (D-13), never a hand-clicked
map. `createDoc(w, h)` already takes a size; the `plots` layer stays empty, which
serializes as an empty objectgroup. Walls, plank floor, a door tile on the south
wall aligned with the exterior door. Room size sets the furniture bounds, so
`INTERIOR_ROOM` becomes derived rather than a hand-written 10x8.

**Done:**
- [x] `packages/shared/src/config/interiorLayout.ts` — the room, derived
- [x] `apps/mapmaker/scripts/generate-interior.ts`, through the same
      `MapDoc`/`History`/`serialize` machinery the editor uses
- [x] `apps/mapmaker/src/io/interiorMap.test.ts` — 7 assertions; mapmaker
      70 → 77 tests
- [x] Two break-tests confirmed (door out of the wall's bottom course; a wall
      column that never gets painted)

**How it turned out.**

**`Tileset House.png` is a wall ELEVATION, not a top-down wall**, and that is
what sets the room's shape. A wall is four tileset rows — upper panel, dado
rail, lower panel, skirting — so `WALL_ROWS = 4` comes from the art rather than
being a thickness anyone chose. The room is 12x10, leaving six walkable rows.

**The door dropped into the wall band with no alignment work**, because the door
art (`Tileset House.png` columns 1-3, rows 0-3) is exactly as tall as the wall
courses. It went in four columns wide on the first pass and rendered with a
black seam down its right-hand side: column 4 is the start of the NEXT door, not
this one's jamb. Caught by rendering the generated map rather than by any test —
a map that loads is not a map that looks right.

**The floor was picked against alternatives, not first-found.** Column 16's
planks tile into something that reads as brickwork at 16px; the pale options
wash out under furniture. The diagonal parquet at column 19 runs across tile
seams, so a floor of it shows no grid at all.

**Floor is painted under the wall as well as in front of it.** Not
belt-and-braces: the door's frame has transparent pixels, so a gid 0 behind it
would show the page background through the house. The test asserts the whole
rectangle rather than just the walkable part, for that reason.

**Three rules are enforced twice.** The generator refuses to write a map whose
door is not in the wall's bottom course, or whose spawn is inside the wall or
not directly below the door; the drift test refuses to let a committed map
disagree with the constants afterwards. Both, because this is a scene nobody
opens by accident during other work — a door in the wrong row is something you
would find by walking into it, weeks later.

### T-16.11 — The door is a faced target (D-7)  ✅ **DONE**
Depends: T-16.09 · Size: M

**Do:** define `HOUSE_DOOR` in `config/collision.ts` — the file carries a comment
saying it deliberately does not exist, and this task retires it.
`House.doorway()` already returns the bottom-centre 2x2 rect and has zero
callers; it gets its first. Then follow the chest, because the chest is the
proven pattern: a `'door'` variant on `Target`, a `doorTiles` set in
`facedTarget()`, and a new `enter` dispatch — **not** `open`, which means "show a
DOM panel". `act()` dispatches it before `send()`; nothing goes to the server,
because position is cosmetic (§4.1) and entering a room is not an intent.

**Buildings stay solid at every tier.** That is the substance of D-7.

**Done:**
- [x] `HOUSE_DOOR_ART_X0/X1` measured; `houseDoorTile` and `isHouseDoorTile`
- [x] `Target` gains `'door'`; `EnterIntent` is its own kind, not a fourth `open`
- [x] Facing it enters whatever is in hand; standing beside it does nothing
- [x] The door tiles are inside the house footprint and therefore solid
- [x] Break-test confirmed; shared 193 → 195, client 249 → 253

**How it turned out.**

**The door is not where `House.doorway()` said it was.** That method returns the
building's bottom-CENTRE 2x2, which was a fair guess when every tier shared one
doorless silhouette. The farmhouse art has a real door and it is off-centre:
profiling non-wall pixels across the bottom band gives one solid 16px block at
crop columns 40-55, with the flower-box window at 16-29 and the porch edge at
59-65.

**Then it took two wrong answers to notice the question was wrong.** The door is
sixteen pixels wide and sits with eight pixels either side of a tile boundary,
so "which tile is the door" has no single answer. The first attempt rounded to
column 9 (an off-by-one in the centre formula), the second to column 8 — and the
browser put the character on column 9, walked it up to a door plainly in front
of it, pressed the action key, and nothing happened. No unit test could have
caught either: both columns are individually defensible, and the mistake was
answering a question the art does not have one answer to.

**The door is two tiles.** `houseDoorTile` returns every tile the art overlaps,
and `isHouseDoorTile` is what the scene asks. Both approach tiles work, so it no
longer matters which half the player walks up to.

**The path is the independent check.** T-15.29 re-routed the spine to start
"directly below the front door", and it runs down x=8. The test asserts the
approach set intersects `pathTiles()` rather than asserting a hardcoded 8, so
the two cannot drift apart silently — if the house moves, either both move or
this fails. It is also what caught the original off-by-one: column 9 has no path
at that row at all.

**Buildings stay solid.** The door tiles are inside `HOUSE_FOOTPRINT` and the
test says so. That is the substance of D-7: a gap you can walk into is a pocket
you can end up standing in with the roof drawn over you.

### T-16.12 — Register and enter the scene  ✅ **DONE**
Depends: T-16.10, T-16.11 · Size: M

**Do:** add `Interior` to `main.ts`'s scene array — the file already carries the
comment predicting this. `scene.sleep()`/`scene.wake()`, **never `scene.start`**:
T-3.05 proved sleep/wake keeps the Farm's objects, cached state and measured
clock offset alive, so stepping inside is a doorway and not a page load. Read
that write-up in `docs/ROADMAP-v1.md` before touching it.

Care around `Farm.shutdown()` and the 20s poll: sleeping suspends it, waking
re-fetches once so the returning view is authoritative. Leaving is a door tile
inside, faced with the action key — symmetrical with entering; Esc stays as a
fallback. The interior needs its own camera rule (D-12 note).

**Done:**
- [x] `Interior` registered in `main.ts`; `Farm.enterHouse()` reaches it
- [x] The same Farm scene object AND the same plot container survive a round
      trip — object identity, not equality, as T-3.05 asserted
- [x] Verified in a browser, both directions

**How it turned out.**

**Almost all of this was already built.** `Interior.leave()` has used
`scene.sleep()`/`scene.wake('Farm')` since T-3.05, and `Farm` has re-fetched on
`Phaser.Scenes.Events.WAKE` just as long. The only thing missing for six phases
was a way in. `enterHouse()` is nine lines.

**`scene.run`, not `wake`.** The first trip through the door has no Interior
scene to wake — `run` starts it if it has never run and wakes it if it is
asleep, which is exactly the two cases there are.

**Sleeping stops the poll for free.** Phaser pauses a sleeping scene's clock, so
`pollTimer` does not fire indoors, and the existing `WAKE` handler re-fetches
once on the way back. Nothing had to be added for either.

**Verified by object identity, which is the only check that means anything
here.** Tagging the live Farm scene and one of its plot containers before
entering, and reading the tags back after leaving, both survive: it is the same
scene and the same container, not equal ones. The clock offset is re-measured by
the wake fetch and legitimately differs (-97 to -81) — it is a measurement, not
state.

### T-16.13 — The room is a tilemap, not a rectangle  ✅ **DONE**
Depends: T-16.10, T-16.12 · Size: M

**Do:** replace `Interior.ts`'s chequered `Graphics` with the authored tilemap.
Placement bounds come from the map. `fitsInRoom()` and `overlaps()` stay in
shared config and stay the **same functions the server validates with** — a green
ghost must never promise a placement the server is about to refuse (§4.4).

**Done:**
- [x] Hanging out of the room still returns `VALIDATION_FAILED`; overlapping
      still returns `PLOT_OCCUPIED` — pinned in `house.integration.test.ts`:
      out-of-room and negative/fractional cells give `VALIDATION_FAILED`,
      exact and PARTIAL overlap both give `PLOT_OCCUPIED`, and a piece
      immediately alongside another is allowed
- [x] Client ghost and server agree on every boundary case — structurally, not
      by coincidence: `updateGhost` calls the same `fitsInRoom` and `overlaps`
      imported from shared config that the service validates with (§4.4), so
      there is no second implementation to disagree

### T-16.14 — Furniture shop back on the HUD  ✅ **DONE**
Depends: T-16.08, T-16.13 · Size: M

**Do:** `setInsideHouse()`, `onLeaveHouse()`, `onDecorate()`, `setDecorations()`
and `houseControls()` all exist and are lazily built. Restyle to the T-15.26
pixel-art skin — they were written against the paper-and-ink CSS Phase 15
replaced.

**Done:**
- [x] The tray lists all 14 with prices and a coloured star on the two VIP pieces
- [x] Restyled to T-15.26's plate idiom; three states are visually distinct
- [x] `hud__decortitle` shared with the farm tray; `hud__btn--leave` given meaning
- [x] The armed-piece outline on the FARM tray fixed — it had never drawn

**How it turned out.**

**It was the last panel still wearing the old skin, and nobody could have seen
it.** T-15.26 resampled the palette and gave every button the pack's plate
bevel; this tray kept its pre-Phase-15 look because it had been unreachable
since T-11.05. Restyling it was mostly deleting differences: the panel's shadow
was 4px where `.shop` and `.pack` use 6px, the row buttons were flat `--soil`
with no bevel and no uppercase, and the heading used `hud__label` where the
farm's own decoration tray uses `hud__decortitle`. Two classes for one heading is
how they drifted apart in the first place.

**Three states, three reads.** A price you can afford is a rust plate; a price
you cannot is flat and drained; a piece you own says PLACE in green. The
unaffordable state is deliberately not an opacity fade — a faded control over a
busy pixel background reads as "still loading", and what the player needs to see
is that the price is the problem.

**And a bug in the FARM tray, found by reading the CSS this one shares.**
`.decorrow[aria-pressed='true']` sets `background` and `border-color`, and
`.decorrow` has never had a border — so since T-15.24 the armed piece has been
getting its fill and none of the outline. T-15.24's own comment says the armed
piece "has to be obvious from the farm, where the player is actually looking — a
subtle highlight is no use two metres away", and half of what it asked for was
silently doing nothing. A transparent 2px border gives the rule something to
colour. Verified by arming a scarecrow: fill and outline both.

**The VIP star is a span, not a character.** It was appended to the name text,
so it could not be coloured, and at 0.66rem an uncoloured star reads as
punctuation rather than a mark.

---

### T-16.15 — A character in the house  ✅ **DONE** (recorded late — see below)
Depends: T-16.13, T-16.14 · Size: M

**Do:** the room had no character. T-16.12 opened a door onto it and T-16.13
made it a real tilemap, but what stepped through was a camera — the player
appeared on the farm, vanished at the doorway, and reappeared when they left.
Everything indoors was therefore pointer-driven, which is the one interaction
§5.1 says the game does not have. Give the room a character, walls that stop it,
and furniture placed the way everything else in the game is placed: face the
tile, press the action key.

**Done:**
- [x] **The character exists indoors**, spawned on the tile below the door and
      wearing the appearance the Farm hands over — not re-fetched
- [x] **The wall band and the door are solid**; the floor is walkable
- [x] **Furniture is placed at the FACED cell**, with a ghost, replacing the
      search-the-room-for-a-gap placement
- [x] The ghost turns red on an illegal cell rather than disappearing
- [x] **Leaving is the action key at the door** — D-7 restated indoors
- [x] An armed piece is disarmed on the way out
- [x] `ACTION_KEYS` lifted into `keys.ts`, shared by both scenes
- [x] `Player.moveTo()` — the house has to return the character to the doorway
- [x] Interior collision covered in `collision.test.ts`

**How it turned out.**

**This task closes three of the four things Phase 16 signed off as "deliberately
still not done", and the roadmap did not say so for a whole phase.** It was
implemented, tested and left green without ever being written down — the exact
failure the "write it as it lands" rule exists to prevent, and it took reading
`interiorBlockedTiles`'s call sites in T-17.03 to notice. The Phase 16 closing
list below has been corrected. What is recorded here was reconstructed from the
code and its own comments, not from a plan.

**Furniture is walk-through, and that is D-14 again in a smaller room.** The
floor is twelve by six. A player could wall themselves off from the door with
three pieces — and unlike the farm's decoration there is no reachability guard
on the house module at all (`modules/decor/reachability.ts` has no counterpart
in `modules/house`). Solid furniture without that check is a player locked
inside their own house by a wardrobe with nothing they can do about it. Same
trap, same answer.

**The door is solid indoors for the same reason it is a trigger outdoors.** A
walk-through doorway puts the character in the wall band, where no floor is
drawn and nothing can say which room they are in. You leave by facing it and
acting.

**Searching for a free cell was the best available answer to the wrong
question.** With no character, the tray was the only thing that could decide a
position, so placement scanned the room for the first cell that fitted. The
player asks to put a chair *there*; on a furnished floor, "wherever it fits" is
rarely where they were looking.

**A ghost that vanishes reads as a broken game.** Facing the wall shows the
ghost red *on the faced tile* rather than hiding it, so "you cannot put it
there" and "the game stopped responding" do not look the same.

**Arming leaks across scenes if nothing clears it.** A fireplace armed indoors
was still armed when the next action key landed on a plot. `leave()` disarms.

---

## Verification for the phase

Every task: `pnpm -r typecheck` and `pnpm test` green, "How it turned out"
written, break-tests confirmed. Then end-to-end in a real browser:

1. **Register a brand-new account.** Hotbar 1-4 must hold hoe, watering can and
   two **seed bags** — this is the whole verification for the starter-tools ask
   and it also proves T-16.01.
2. Till, plant, water, harvest one plot: four distinct animations.
3. Buy a chicken and a cow, watch the yard a minute. The cow walks facing where
   it is going; the chickens cycle poses without leaving their tiles. Feed both —
   the target must be where the animal looks like it is.
4. Face the farmhouse door, press E. Place a bed and a fireplace. Leave by facing
   the inside door. The farm must be the *same* scene — crops kept growing.
5. Idle mode on: the replay plants and harvests visibly.

**Watch for:** every decor request in Phase 15 went to `/api/api/decor`, because
the `api` helper already prefixes `/api`. No unit test touches the network. The
house endpoints are about to be exercised for the first time in months — read the
network tab, not just the test output.

---

## Phase 16 complete

T-16.01 through T-16.14 are done. Seeds look like seeds, every verb has an
animation, the cows walk and the chickens live, and the farmhouse has a door
that opens onto a real room you can furnish.

Final state: **1,393 tests** (195 shared + 77 mapmaker + 253 client + 868
server), up 34 from Phase 15's 1,359. Every task verified in a real browser as
well as by tests, driving `playwright-core` against the bundled chromium with an
explicit `executablePath` — the pattern Phase 15 established.

### What this phase found that nobody was looking for

Every one of these was pre-existing, and none had a reported symptom:

1. **Every plot cell had soil painted into `farm.json`** (T-16.01), so an
   untilled plot looked tilled and the hoe appeared to do nothing. T-9.04
   decided plot cells are grass and soil is server state; the committed map had
   never caught up. Found because adding one 7-frame sheet forced a regeneration.
2. **`Tileset House.png` existed all along** (T-16.07). T-3.05 recorded "no
   floor or wall tiles anywhere in the pack" — true of the OLD pack, deleted in
   T-7.07, and quoted as a constraint for six phases. Same shape of miss as
   T-15.29's twelve assembled houses.
3. **The furniture catalogue's own guard test could not fail** (T-16.08). It
   compared all fourteen crops against a hardcoded 192x144 — the size of a
   deleted sheet — so it stayed green while every piece rendered as a slice of a
   house roof.
4. **A resting cow marched on the spot** (T-16.04). The cow sheet has no
   standing row, `poseRowFor` hands back the walk row for a stationary animal,
   and every row was registered as a loop.
5. **The armed-decoration outline had never drawn** (T-16.14).
   `.decorrow[aria-pressed]` sets a `border-color` on a rule with no border, so
   since T-15.24 half of what that highlight asked for did nothing.
6. **`Doors, windows and curtains.png` contains no doors and no windows**
   (T-16.08) — only curtains. There is no window art in this pack at all.

### What only a browser could have caught

Three defects passed every unit test and were found by looking:

- **A chick turned back into an egg** (T-16.05). The chick sheet has the adult's
  4x7 geometry and different row semantics: `peckDeep` is row 4, and row 4 of a
  chick sheet is the egg-hatch sequence. Every invariant a test could check
  still held — the row exists, is in range, animates, stays on its tile.
- **The door did nothing** (T-16.11). The art straddles a tile boundary with
  eight pixels either side, so "which tile is the door" has no single answer.
  Both roundings are individually defensible; the character stood on the other
  one. The door is now two tiles.
- **The generated interior had a black seam** (T-16.10) down the right of its
  door, because column 4 of the tileset is the start of the *next* door. A map
  that loads is not a map that looks right.

### Open decisions this phase settled

D-7 (the door is a faced-tile trigger), D-15 (chickens do not roam — their sheet
has no walk cycle), D-16 (a roaming cow's target follows it, safe only because
the roam is vertical), D-17 (the interior room's bounds come from the authored
map). D-12 is annotated but still open: the interior got its own camera rule,
which is not an answer for the farm. **T-17.05 measured what it costs** — at
1920x1080 the farm renders at exactly its 1280x800 size, because the fit is
2.87 and integer zoom floors it to 2.

### What is deliberately still not done

- ~~**The interior is one room with no collision.**~~ ~~**Furniture is still
  placed by pointer-drag.**~~ Both were fixed by **T-16.15**, which was
  implemented but not written down until T-17.03 went looking for
  `interiorBlockedTiles`'s call sites. The room now has a character, solid
  walls, a solid door you leave through with the action key, and furniture
  placed at the faced cell. Furniture itself stays walk-through, deliberately
  (D-14's reasoning, restated for a twelve-by-six floor).
- **Wall-hung pieces sit on the floor grid.** Pictures, the mirror and the
  curtains are placed in floor cells like a table, because there is one
  placement surface. Pre-existing from T-3.05.
- **No second interior.** The coop and barn have no inside; that reopens the
  pasture slot system by asking where animals render.
- **`House.setTier()` is still a no-op** — one look for three tiers, unchanged
  since T-7.11 and untouched by this phase.
- Everything Phase 14 defers: trade UI, VIP UI, chopping, mining, fishing,
  combat, energy, day/night, seasons.

---

# Phase 17 — the leftovers

Phase 16 closed the last task anybody had written down, and left behind a short
list of things that were *known* to be undone rather than *planned* to be done:
the unchecked boxes scattered through Phases 15 and 16, and the "what is
deliberately still not done" list at the end of Phase 16. This phase works that
list. There is no new system in it — every task here finishes something that was
started and honestly recorded as unfinished.

### T-17.01 — Reduced motion reaches the canvas  ✅ **DONE**
Depends: T-15.13, T-15.29 · Size: S

**Do:** T-15.29 asked to "confirm tree sway and animal wander both hold still
under `prefers-reduced-motion`" and shipped without it — the box was the only
one left open on that task. The CSS half has been honoured since T-15.26 (the
spinning coin, the toast slide), but **CSS cannot reach inside the canvas**, and
the two longest-running animations in the game are both in there: the maple
leaves on an endless loop and the animals drifting around their yards. Both run
forever, unprompted, in the player's peripheral vision — exactly the category
the setting exists for.

**Done:**
- [x] `motion.ts` — `prefersReducedMotion()`, cached with a `change`
      subscription; the pure `reducedMotionFrom()` beside it so the decision is
      testable without a DOM
- [x] `stillPose()` in `animalWander.ts` — an animal parks on its slot, idle,
      with no clock in the answer at all
- [x] `Animal.update()` forces `play: 'hold'`; the produce badge stops bobbing
- [x] `addMapleTree()` leaves the tree on its rest frame and never starts the
      loop
- [x] `animationRowsFor()` lifted out of `Animal.ts` into `animalSprites.ts`, so
      the set of animations the scene registers can finally be asserted
- [x] Client 253 → 267 tests; two break-tests confirmed
- [x] **Verified in a browser**, two contexts on one account, one with
      Playwright's `reducedMotion: 'reduce'`

**How it turned out.**

**A single before/after screenshot pair proves nothing here, and nearly said the
opposite.** The maple loop runs at a few frames a second, so two samples 1.4s
apart can land on the same frame and report "nothing moved" on a farm where
everything is moving — the first run measured 24 moving regions, the second run
of the same code measured 2. The check is only meaningful over eight frames
across five seconds, differenced against the first and unioned. At that
sampling: **28-31 moving regions with motion on, 3 with it reduced** — and all
three are the player's own idle animation, which is deliberately left alone. The
avatar is the thing the player is directly driving; freezing it would read as a
broken game rather than as a courtesy, and reduced motion is about ambient
movement, not about the character you are steering.

**Every row needs a `hold` variant registered, and nothing would have said so.**
Reduced motion forces `hold` onto whichever row `idle` resolves to — and a
chicken's idle row is only ever *requested* as a `loop`. `anims.play` on a key
that was never created does not throw and does not warn: it leaves the sprite on
whatever frame it was already showing. The bug would have existed only for
players who set the preference, which is the last group anyone would have looked
at. This is why `animationRowsFor` moved to `animalSprites.ts`: nothing inside a
Phaser scene is reachable from these tests (no jsdom), so the fact worth pinning
had to be lifted somewhere a test could get at it.

**`stillPose` returns the SLOT, not a frozen `wanderPose`.** Freezing the
existing curve would park half the animals mid-leg, permanently straddling a
tile boundary — and `wanderTile` then has to name a tile for a body that is
visibly between two. A slot is always exactly on a tile. The pose is `idle`
specifically because it is the only one every sheet resolves to something
motionless: a cow has no standing row and `poseRowFor` answers with a held frame
of the walk row, while `peck` would be a chicken pecking forever, which is the
animation being switched off.

**"No preference" is not "prefers stillness."** `reducedMotionFrom` tests
`=== true` rather than truthiness, so a missing `matchMedia` falls through to
full motion. The opposite default would render the game motionless in any
environment that cannot answer the query.

**The value is cached but not read-once.** `Animal.update()` asks per animal per
frame and `matchMedia` is not free enough for that; but the setting can be
changed with the tab open, so the cache subscribes to `change`. The trees read
it once at construction and take a reload to notice — a stated limit rather than
an oversight: subscribing every maple to a media query to catch a setting nobody
changes mid-session is more machinery than the case is worth.

**What the browser pass had to work around.** The camera never scrolls — the
whole farm fits the viewport — so the coop yard is not off-screen, it is *under
the hotbar*. Walking toward it achieves nothing; hiding the HUD is what brings
the animals into frame. (Registration is also rate limited per IP, so the script
takes an `ACCOUNT` env var and reuses the account it made on the first run.)

**Still moving, deliberately:** the player's idle animation, and the crop-growth
and tool-swing animations, which are responses to something the player did
rather than ambient motion.

### T-17.02 — The blocked browser verifications, unblocked  ✅ **DONE**
Depends: T-15.08, T-15.25 · Size: S

**Do:** T-15.08 closed with a note saying browser verification was blocked —
Playwright MCP is pinned to the Chrome channel, this machine has chromium and
brave, and `npx playwright install chrome` wants a sudo password it cannot
prompt for. T-15.25 inherited the same block. Phase 16 then quietly solved it
for its own tasks by driving `playwright-core` at the bundled chromium with an
explicit `executablePath`, and nobody went back for the two boxes that were
still open. Go back for them.

**Done:**
- [x] **Water is solid** — walked west along row 21 to (2,21); stopped against
      (1,21), `reasons: ['terrain']`
- [x] **Building walls are solid** — walked east along row 18 to (20,18);
      stopped against (21,18), `reasons: ['buildings']`
- [x] **Map objects are solid** — three separate stops, all `['objects']`: the
      chest at (6,10), and (5,13) and (17,11)
- [x] **Solid decor is solid** — a fence post placed at (7,13) turned the
      westward walk's stop from (6,13) into (8,13), with
      `reasons(7,13) === ['decor']`
- [x] **The character never once stood on a solid tile** — 66 distinct tiles
      across six routed walks, each sampled every 120ms and probed against the
      live `BlockMap`
- [x] **All 20 plots walkable on the running map**, not on a fixture
- [x] Zero console errors and zero page errors across every run

**How it turned out.**

**This is measured, not eyeballed.** `main.ts` exposes `window.__game` under
`import.meta.env.DEV`, which means a script can read the `BlockMap` the running
scene actually built from `farm.json` and ask it `reasons(x, y)` — so "did the
character stop because of the water, or because it happened to run out of
walk?" has a real answer rather than a screenshot and a guess. Every claim above
names the layer that did the blocking.

**The four cardinal walks prove less than they look like they do.** From spawn,
walking in any direction stops against a map OBJECT long before reaching the
river or a building — three of the four stops were the chest and its
neighbours. The water and the buildings needed *routed* walks that go round
first. A verification that had only done the obvious four would have reported
success while never testing two of the three layers.

**One false alarm, worth recording because it looks exactly like a bug.**
Placing decoration by raw `fetch` and waiting produced `decor` layer size 0 and
a character that walked straight through the fence. That is correct behaviour:
decoration is deliberately **not** in the 20-second farm poll (§11), and
`refreshDecor` runs on scene create, on a HUD state change, and after a
placement made through the tray — a raw POST reaches none of them. Reloading
takes the create path, which is the same function the tray calls, and the fence
was solid immediately. The lesson is about the harness, not the game: bypassing
the UI to set up a test also bypasses the code that reacts to the UI.

**Incidentally confirmed:** placing a second piece on an occupied tile returns
`409 PLOT_OCCUPIED` from the real server, which is the T-15.20 contract.

**Still open, and now for a different reason.** T-15.13's
"feeding a wandering animal from an adjacent tile" is *not* closed by this task.
It is only a meaningful test against a **cow** — chickens do not roam (D-15), so
feeding one is the same static hit-test it has always been, and the thing
T-16.06 (D-16) actually changed is a target that follows a moving animal. A cow
costs 2,000g and the verification account has 85g. The box now needs a funded
account rather than a browser.

### T-17.03 — The house tells the truth twice  ✅ **DONE**
Depends: T-16.15 · Size: S

**Do:** verify T-16.15 in a browser, since it was being recorded a phase late
and had never been driven end to end. Fix whatever that turns up.

**Done:**
- [x] **The whole round trip, in a real browser:** farm (9,13) → north to the
      door approach (9,7) → action key → inside at (5,4) → walk into the wall →
      arm a piece from the tray → place it at the faced cell → Escape to disarm
      → back to (5,4), face up, action key → out at (9,7) on the farm
- [x] **The wall is solid** — five seconds of holding `up` against it moved the
      character zero tiles; walking west reached (0,4) and stopped
- [x] **Escape disarms without leaving** — `aria-pressed` cleared, still indoors
- [x] **One real defect found and fixed** (below)
- [x] `placementProblem()` in shared config, with 9 tests mirroring
      `house.integration.test.ts`'s cases; break-test on the check ORDER
      confirmed. Shared 199 → 208; **1,420 monorepo tests**

**How it turned out.**

**The client posted placements its own ghost had already drawn red.** Standing
on the bottom floor row with a potted plant armed, the action key sent
`place plant at (9,5)` and the server answered `400 VALIDATION_FAILED — that
does not fit there`. The server is right: the plant's art is 17px tall, so its
footprint is **two** cells, and on the last row of a six-row room the second row
does not exist. The client knew — `updateGhost` runs the same `fitsInRoom` and
had painted the cell red — and `act()` posted anyway. Nothing was corrupt and
nothing was exploitable, because the server validates independently (§4.1); it
was a refusal the player could already see, fetched over the network and
delivered as a toast a round trip later.

**The fix is a shared rule, not a second copy.** `fitsInRoom` and `overlaps`
were already shared, so both sides always agreed on each *question*. What was
not shared was **the order they are asked in and what a failure means** — and
the order is load-bearing, because the two outcomes map onto two different error
codes. `placementProblem()` now answers `'DOES_NOT_FIT' | 'OCCUPIED' | null`
once, the service's ordering, and both the ghost's colour and the decision to
post read it. The break-test swaps the two checks and the ordering test fires.

**This does not make the client authoritative.** The server still runs both
checks inside the placement transaction and is the only thing that decides.
This is a client-side UX gate of exactly the kind §5.1 already sanctions for
adjacency and facing — it stops the client asking a question it can answer.

**Confirmed by absence.** The measurement after the fix is that
`/api/house/place` **is not called at all** from an illegal cell, where before
there was a 400 in the network log. A legal cell still posts and still returns
200.

**Three harness lessons, all of which first looked like game bugs.**

1. *Placing while facing the wall was correctly refused* — the first run walked
   into a corner and then tried to place. The game was right and the script was
   wrong.
2. *There are two `.hud__decor` panels*, one for the farm and one for the house,
   and the top bar's `[data-decor]` button belongs to the **farm's**. Clicking
   it indoors opens the wrong tray over the right one, and the piece armed is
   not the piece you can see. Scope to `[data-house]`.
3. *An armed piece never reaches the leave branch.* `act()` places before it
   leaves — deliberately, so facing the door with a fireplace in hand tells you
   "not in the doorway" rather than silently walking you outside. The script had
   to disarm first, which is also what a player does.

**And one about walking:** guessing at hold durations put the character on the
wrong column three runs in a row. Nudging in 200ms bursts until the tile index
matches is both shorter and deterministic.

### T-17.04 — Feeding something that will not stand still  ✅ **DONE**
Depends: T-15.13, T-16.06, T-17.02 · Size: S

**Do:** the last of the three verification boxes T-17.02 left behind. It was
never really blocked on the browser — it is blocked on a **cow**. Chickens do
not roam (D-15), so feeding one is the same static hit-test it has always been;
the thing T-16.06 (D-16) actually changed is a target that follows a moving
animal, and only a cow moves.

**Done:**
- [x] A real cow bought (2,000g), hay bought and equipped from the hotbar
- [x] The cow observed on tiles y=18, y=19 and y=20 across the session — the
      vertical roam D-16 is built on, seen rather than assumed
- [x] **Attempt 1 missed, and missed correctly** — see below
- [x] **Attempt 2 fed it**: `/api/animals/feed` 200, `isFed` false → true,
      `fedUntil` set 24 hours out
- [x] Exactly one feed request in the whole run

**How it turned out.**

**The failed attempt is the result.** The character walked to the tile beside
where the cow was standing when the walk was planned — (3,19) — and by the time
it arrived the cow had wandered to (2,18). Facing west from (3,19) faces (2,19),
which is now empty. The action key produced **no request at all**: not a 404,
not a refusal, nothing. That is the correct behaviour twice over — the client
does not ask about an animal it is not facing, and "the tile beside where it
used to be" is not adjacency.

Re-aiming to (3,18), where the cow now actually was, fed it on the next press.
That is precisely the loop D-16 describes, and it took a moving animal to see
it: a design where the cow's target stayed pinned to its home slot would have
fed it on the FIRST attempt, from a tile the player can see is empty, which is
the bug D-16 exists to prevent.

**A one-shot walk cannot verify this.** The first version of the script computed
the target tile once, walked there, and pressed the key — and reported failure.
The animal moves while you approach it, so the harness has to re-aim each
attempt, which is exactly what a player does: take another step and try again.

**Two harness notes.** The first run's cow filter did not filter (`a.view.kind
!== 'cow' && ...` with a second clause that was never false), so the character
set off across the farm toward a chicken. And a naive one-axis-at-a-time walker
parks against the first solid thing between it and the target and stays there —
now that collision actually works (T-17.02), a walker has to swap axes whenever
a nudge achieves nothing.

**The verification account** was funded by a direct `UPDATE players SET gold`
against the local dev database. It is a throwaway account created by these
scripts; nothing in the game grants gold that way.

### T-17.05 — The 1920x1080 pass  ✅ **DONE**
Depends: T-15.26, T-15.27 · Size: S

**Do:** T-15.27 checked the **camera** fit at 1920x1080 and T-15.26 never
checked anything there. The part of the skin that carries fixed pixel sizes is
the panels, and nobody had looked at them at that resolution.

**Done:**
- [x] **Nothing overflows.** Every element under `.hud` measured against the
      viewport at 1920x1080, bare and with the backpack, the idle panel and the
      decoration tray open: no horizontal document scroll, no offenders
- [x] The bar renders at **71px**, matching T-15.27's measurement exactly, so
      `hud.barHeight()` is still telling the truth at a second resolution
- [x] The hotbar is 684px, centred, 12px off the bottom; the backpack book is
      700x200 at y=72, directly under the bar
- [x] Console clean
- [x] The world's scale measured at three resolutions (below)

**How it turned out.**

**The panels are fine. The world is the same size it was at 1280x800, and that
is arithmetic rather than a defect.** `fitCamera` computes
`floor(min(width / mapWidth, usableHeight / mapHeight))`, clamped to
`PIXEL_SCALE`. Measured against the real map (480x352px):

| Screen | Fit would be | Zoom taken | World on screen |
|---|---|---|---|
| 1280x800 | 2.07 | **2** | 960x704 |
| 1920x1080 | 2.87 | **2** | 960x704 |
| 2560x1440 | 3.89 | **3** | 1440x1056 |

At 1920x1080 the fit is 2.87 and floors to 2 — so the farm renders at *exactly*
the size it does on a 1280x800 laptop, on a screen with 2.6x the area, and the
rest is letterbox. **The cap is not what bites here; the floor is.** 2560x1440
reaches zoom 3 only because 3.89 floors to 3.

**And there is no fix that respects the existing rule**, which is why this is
recorded rather than "fixed": integer zoom is correct — fractional zoom on pixel
art shimmers, and `main.ts` says so — and no integer is 2.87. The lever is not
the zoom, it is what the letterbox is for, which is **D-12** and still open. The
numbers above are what that decision was missing: 1920x1080 is the single most
common desktop resolution and it is the worst case in the table.

**The webfont box was never a task.** T-15.26's own write-up already records "no
webfont, deliberately" — a self-hosted pixel font means a second licence in
`ATTRIBUTION.md` and that decision has not been taken. An unchecked box for a
decision that was made reads as work outstanding for two phases. It is now
ticked with the decision attached.

### T-17.06 — Per-tier house art  ✅ **DONE**
Depends: T-15.29, T-16.11 · Size: L · **Unblocked by D-20, decided 2026-09-04**

**Why it is written up rather than done:** every checkbox in this roadmap is
closed, and this was the next real leftover on Phase 16's list —
"`House.setTier()` is still a no-op, one look for three tiers, unchanged since
T-7.11". Investigating it produced measurements worth keeping and a cost that is
not small, so it is specified here rather than half-built.

**The stated reason for the gap was wrong.** `House.ts` said the upper tiers were
"still waiting on art". They are not. The pack ships twelve assembled houses and
two of them are a clean upgrade ladder in the current farmhouse's own style
family. That comment has been corrected to point here.

**What the twelve houses actually are.** Not a tier ladder — **themed and
seasonal variants**:

| Files | What they are |
|---|---|
| 1, 3, 4 | The current farmhouse. **3 is spring; 1 and 4 are snow-roofed.** Identical crop window `(2,13,126,100)`, which is exactly `OBJ_FARMHOUSE_LOOK` |
| 2, 9 | Forest cottage — vines and mushrooms |
| 5, 6, 12 | Candy-cane / festive, with snow and holly |
| 10 | Orange shopfront with an awning |
| 7, 8 | **The upgrade ladder**: same brick-and-timber family, progressively larger |
| 11 | Mirrored large house, different crop origin |

So "pick three of the twelve" does not work: 1 and 4 are the only pixel-perfect
drop-ins and both would put a snowy roof on a spring farm.

**The ladder, measured.**

| Tier | File | Art | Footprint | Door |
|---|---|---|---|---|
| 0 | `3.png` | 124x87 | 8x6 tiles | x 40..55 (as recorded) |
| 1 | `7.png` | 124x93 | **8x6 — unchanged** | ~x 22..38, with a porch step |
| 2 | `8.png` | 128x109 | **8x7 — one row taller** | ~x 20..34, under an awning, on a full-width veranda |

**What that costs.**

1. **The door has to become tier-aware.** `HOUSE_DOOR_ART_X0/X1` are single
   constants measured on house 3, and `houseDoorTile(anchor)` takes only an
   anchor. Both need a tier. This is the T-16.11 door — the one that had to
   become *two* tiles because the art straddles a boundary — so its tests move
   with it.
2. **The path spine no longer meets the door.** T-15.29 deliberately routed the
   north-south spine to start at y=7 "directly below the front door". At tier 1
   and 2 the door is one to two tiles further left, so the approach tile is off
   the path. `farm.json` is static and the house is not.
3. **Tier 2 eats the map's border row.** `HOUSE_ANCHOR.y` carries a documented
   `+1` nudge whose entire purpose is to leave the fringed border row visible
   above the roof. A 7-tall house at that anchor reaches y=0 and takes it.
4. **The generator's guard has only ever seen tier 0.**
   `assertPathsClearOfBuildings` validates one footprint; with a growing house it
   must validate the **largest** tier, or a tier-2 upgrade silently overlaps the
   path it was checked against.

Collision itself is already fine: `refresh()` rebuilds the `buildings` layer
after `setTier`, so a changing footprint is picked up on the next poll (T-15.08).
And the art can be added safely — appended to the END of `IMAGES`, which is
T-15.01's rule and what T-15.15 did for decor, so no gid shifts.

**The decision this needs.** Tier 2 cannot both keep the border row and be a
row taller. Either the anchor drops a row (the roof sits against the border, and
T-15.29's reasoning about the farm reading as bounded land is given up), or tier
2 uses a different, shorter house and the ladder is less of a progression, or
the map grows a row at the top and `farm.json` is re-authored. That is a
design call, not an implementation detail.

**Worth doing, for a reason beyond looks:** `HOUSE_TIERS` is a declared gold
sink that the shop does not even offer, precisely because there is nothing to
see. Per-tier art is what turns it back into a purchase.

**How it turned out.**

**Everything above is the pre-work; this is what shipped.** D-20 went to the
user and came back **(a)**. The four costs the spec predicted turned out to be
one real one, two smaller than feared, and one that measured itself away.

**Cost 1 — the door — was real, and is now per-tier.** `HOUSE_DOOR_ART` is a
list of `{x0, x1}` and `houseDoorTile`/`isHouseDoorTile` take a tier.
**The measurement method self-checks**, which is the part worth keeping:
profiling the last opaque row of each look window gives tier 0 *exactly*
x 40..55 and tier 1 *exactly* x 18..33 — sixteen pixels each, one tile, because
on those two sprites the bottom row IS the doorstep and nothing else reaches the
ground. That reproduces T-16.11's original `HOUSE_DOOR_ART_X0/X1` from the art
alone. Tier 2 has a full-width foundation course so its last row says nothing;
profiling the dark door panel in its wall band gives x 21..30, centred on 25.5 —
**the same centre as tier 1's 18..33**, so tiers 1 and 2 share a door column.

**Cost 2 — the path spine — does not exist.** The spec expected the spine to
stop meeting the door, and it does not: tier 0's door is at `anchor.x + 2..3`
and tiers 1 and 2 at `anchor.x + 1..2`, so all three **overlap at x=8**, which
is the spine. A player walking up the path faces a door tile whatever house they
own. Pinned by a test that loops every tier rather than asserting the numbers,
so a future tier that moved the door off the spine would fail here instead of
shipping a house nobody can reach on foot. Confirmed in the browser: at tier 0
`(8,7)` answers `door` and `(7,7)` answers `null`; at tiers 1 and 2 both answer
`door`.

**Cost 3 — the border row — cost about three pixels.** `houseFootprint(2).y0` is
0, so on paper the roof takes row 0. In pixels, 109px bottom-anchored at y=112
spans 3..111 — **3 of row 0's 16 pixels** — and the fringe still reads in the
screenshot. The decision was made on the pessimistic reading and the result is
better than the decision required.

**Cost 4 — the generator's guard — came free**, because `HOUSE_FOOTPRINT` is now
`houseFootprint(HOUSE_TIER_ART.length - 1)` on exactly the pattern
`COOP_FOOTPRINT`/`BARN_FOOTPRINT` already used. Regenerating produced the same
67 scatter tiles and `assertPathsClearOfBuildings` stayed quiet.

**The two-questions split held.** `currentBuildingFootprints` now takes an
optional `house` tier and **defaults it to 0, the SMALLEST** — the direction
that matters if it is ever wrong, since walkable ground reported solid is an
invisible wall with no in-game remedy, while a roof you can walk under is merely
a picture. `reservedFarmTiles` deliberately keeps using the LARGEST house box
and says why: the tiers differ by one row and that row is the map border, while
the coop and barn grow three rows across the middle of the farm, which is what
the current-tiers rule was written for.

**Two tests failed on the change and were right to.** One was literally named
*"always includes the house, which has no tiers"*. Both now assert the tier they
mean, plus a new one pinning the safe default.

**`Upgrade House.png` exists and was rejected, with reasons.** Nothing in the
original T-17.06 investigation had opened it; it is a genuine three-step ladder
(measured: 10.6x11.6, 10.6x11.1 and 8.4x9.0 tiles, plus spare chimneys). It
loses to 3/7/8 on two counts: it is a different style family, so adopting it
would swap **tier 0** out from under every existing farm, and at 9-11 tiles tall
every tier would overhang the border row rather than only the top one.

**Verified in the browser across all three tiers.** Each swaps texture with the
measured crop (`obj-farmhouse` 124x87 → `obj-farmhouse-t1` 124x93 →
`obj-farmhouse-t2` 128x109), and **`y` and `depth` are identical at every
tier** — 112 and 112 — because all three are bottom-anchored to the same row, so
a taller house grows upward and cannot change sorting. Walking to the door at
tier 2 and pressing E puts the player inside. Zero console errors.

`setTier` is guarded on the tier actually differing: it runs from every farm
poll, and `setTexture` on an unchanged texture is work for nothing three times a
minute.

---

# Phase 18 — QA audit remediation

**Why this phase exists.** Phases 7–17 verified every task in isolation and each
one passed. The first end-to-end playthrough of the whole game — 2026-09-03,
recorded in `docs/qa-audit-2026-09-03.md` — found four things that only show up
when you actually play it for an hour. The engineering held up (zero console
errors, no leak, 61fps, every economic action correct); the *presentation* did
not.

The audit's own summary: "a well-built game with a serious presentation
problem". Read it before starting anything here — every task below cites the bug
ID it closes, and the audit carries the reproduction and the measurements.

Two tasks were finished during the audit itself and are written up below.

## The headline finding

**The character was being erased by its own farm.** Standing anywhere on a plot,
the opaque tilled-soil tile drew over the player — from every position, every
growth stage, every approach direction — reducing them to a floating head during
the game's core activity. Inside the house they disappeared completely behind
furniture. It read as "crops render on top of the player", which is how it was
reported, but the crop was the visible part and the soil was the part doing the
damage.

That is fixed (T-18.01). It was a category error in the depth model, not a crop
bug, and the same error reached decor and interior furniture.

---

### T-18.01 — Depth: a ground-decal band and a character tie-break  ✅ **DONE**

Depends: — · Size: M
Files: `apps/client/src/game/depth.ts`, `depth.test.ts`,
`apps/client/src/game/scenes/Farm.ts`, `scenes/Interior.ts`,
`apps/client/src/game/entities/Player.ts`, `entities/Animal.ts`

**Do:** Stop flat ground sorting as though it stands up, and stop exact depth
ties being decided by scene construction order. Closes BUG-01, BUG-02 and
BUG-03.

**Done:**
- [x] Player never occluded by soil, from any position on any plot
- [x] Player still draws behind a crop when standing further up the tile
- [x] Interior furniture no longer hides the player at its own ground line
- [x] Faced-tile outline visible on tilled soil
- [x] Collision untouched; 12 unit tests pin the invariants

**How it turned out.**

Three named bands, not a rewrite. The feet-Y model (`groundDepth`, T-15.29) was
right and stayed.

`DEPTH.groundDecal = -1000` holds flat things painted on the floor — tilled
soil, the plot outline. They have no height, so they cannot occlude anything
standing on them, and one fixed value is enough because decals never overlap
(one per tile). `Farm.syncTiles` now builds a `decal` container for soil +
outline and leaves the **crop out of it**: a plant stands up, so it sorts on its
own feet at `groundDepth(top + TILE_SIZE)` like a tree does.

`CHARACTER_BIAS = 0.5`, via `characterDepth`/`characterShadowDepth` in `Player`
and `Animal`. Strictly less than 1, so it can never push a character past the
next pixel row and the `aboveGround`/`belowGround` bracket still holds.

`DEPTH.targetOutline = -900` sits between them, which fixed a bug nobody had
filed: the faced-tile highlight was on `DEPTH.decor` (−1900) under a comment
claiming it was "above the ground and the soil". It had been drawn *under* the
soil ever since the plot became a per-plot sprite — so the one piece of feedback
telling you which tile the action key will hit was invisible on exactly the
tiles you use it on.

**The arithmetic, because it is the whole bug.** Plot row 9: `top = 144`,
container depth `160`. A player standing on that tile has feet in `(144, 160]`.
At y=150 the player is depth 150 and loses. At y=160 it is a tie, and Phaser
stable-sorts, so the plot — created in `syncTiles`, after `buildPlayer()` — wins
that too. There was no position on the tile where the character was in front.
Measured live at y = 151.5, 152.7, 152.7, 152.7 from south, north, west and
standing between two crops: `covered: true` every time.

**Why the bias rather than fixing the creation order.** Creation order already
"worked" for the buildings and that is the problem — it worked by accident, was
documented in one comment, and every later addition (plots, animals, decor) was
built after the player and silently lost its ties. Half a pixel states the rule
instead of relying on the order of ten lines in `create()`.

**What was deliberately NOT done.** No per-frame scene-wide sort pass — Phaser
already sorts by depth every frame and only three things need re-sorting (the
player, its shadow, animals), which they already do. No raising the player's
z-index, which is the fixed-layer thinking the feet-Y model exists to avoid.

**Residual, tracked as T-18.08.** A player standing on the *back* row of a
2-row-tall furniture piece is still hidden by it. That is correct for an upright
object and the real fix is making furniture base-rows solid, which is a design
call (D-9's flood-fill guard would be needed so nobody seals themselves in).

---

### T-18.02 — A shopkeeper at the merchant's stall  ✅ **DONE**

Depends: T-18.01 · Size: S
Files: `apps/client/src/game/entities/MerchantNpc.ts` (new),
`apps/client/src/game/scenes/Farm.ts`,
`packages/shared/src/config/assets.ts`, `config/farmLayout.ts`,
`config/collision.test.ts`, `apps/mapmaker/src/io/farmMap.test.ts`,
`scripts/prepare-assets.mjs`

**Do:** Put an NPC at the stall so buying and selling happen with a person.
`CLAUDE.md §5.6` has always described the merchant as "an NPC on the map";
T-11.04 shipped a stall and argued the NPC away. This closes that gap.

**Done:**
- [x] A shopkeeper idles beside the stall, animated, with a contact shadow
- [x] Facing them and pressing the action key opens the shop
- [x] Facing the stall still opens the shop — nothing existing broke
- [x] They are solid; the player walks up to them
- [x] No gid moved and `farm.json` was not regenerated

**How it turned out.**

The pack's premade blacksmith, "Alaric"
(`Character/NPC'S/Blacksmith/Premade/Alaric/Blacksmith Idle.png`), standing at
tile (7,12) — east of the counter, west of the path spine, north of the y=13
path run.

**T-11.04's argument was half right.** It rejected an NPC because "the pack's
NPC sheets are full walk cycles for people who would need somewhere to walk, a
schedule and a reason to be there". True of a villager. Not true of a vendor who
stands at their own stall all day: they need one idle pose, which is four frames
out of a sixteen-frame strip. The stall stays as the counter.

**The constraint that shaped the whole implementation: no gid may move.**
Adding a `SheetSpec` allocates a `TILESET_RUNS` entry and shifts every
`firstgid` after it, and D-13/T-15.00 means `farm.json` must not be regenerated
to compensate. So the strip is registered as an `ImageSpec` **appended to the
END of `IMAGES`** — the one documented safe edit — and cropped into named frames
with `texture.add`, exactly the technique `registerDecorFrames` and
`registerCoopFrames` already use. Verified: zero existing runs moved, only a new
trailing one appeared.

That trailing run did fail `farmMap.test.ts`, which asserted the map embeds
*exactly* the manifest's runs. That assertion was too strong and pointed the
wrong way — it made the safe edit fail identically to an unsafe one, pushing you
toward regenerating a map that must not be regenerated. It now asserts the real
invariant: **the map embeds a PREFIX of the manifest runs, at matching
firstgids**, may stop short, and may not contain anything the manifest does not.
A middle insertion or a removal still fails loudly.

**Geometry measured, not assumed** (§9). The strip is 512×32 = 16 frames of
32×32. Block 0 shows both eyes head-on, block 1 the back of the head; the alpha
bbox bottom is row 26 in all sixteen frames, identical to the player's
`CHAR_ART.bottom`, so `CHAR_ORIGIN` puts this character's feet on its position
too. **Only the DOWN block is registered** — left and right are the pair
`assets.ts` warns is routinely mislabelled, and unlike the player there is no
watering-can frame to settle it. Rather than record a guess, the NPC faces the
customer, which is the only pose the interaction needs.

**Zero new action-system surface.** The NPC's tile joins `merchantTiles`, so
`facedTarget` returns the existing `{ kind: 'merchant' }`, `actionFor` maps it
to the existing `{ kind: 'open', what: 'shop' }`, and `actions.test.ts:236`
already covered it. No new `Target` arm, no new `OpenIntent` value, no new
dispatch entry.

**It sorts as scenery, not as a character** — plain `groundDepth`, no
`CHARACTER_BIAS`. Giving the bias to a fixed NPC would restore the tie T-18.01
removed and the player walking to the counter would sometimes vanish behind the
vendor. Unbiased means the player always wins that line, which is right: the NPC
is a thing you walk up to, like the stall behind it. Verified live: player
208.5, NPC 208.

**Placement is a config anchor, not a map object**, like the house, coop and
barn — same reason, the map cannot be regenerated. `MERCHANT_NPC_TILE` is in
`OBJECT_TILES` so decor cannot be placed on the shopkeeper, and five assertions
in `collision.test.ts` pin the cell: beside the stall but not inside its art,
**off every path run** (it is solid, and BUG-07 shows what a solid object on a
drawn path does), clear of the field, buildings and water, and not sharing a
cell with any map object.

---

### T-18.03 — Camera: stop rendering at 1x on a 1366x768 laptop  ✅ **DONE**

Depends: — · Size: S (tolerance) / M (follow camera) · Closes BUG-04, unblocks BUG-05
Files: `apps/client/src/game/scenes/Farm.ts` (`fitCamera`), D-12

**The measurement.** `fit = min(width/mapW, (height − hudBar)/mapH)`, then
`Math.floor`. At 1366×768 that is `min(2.85, 1.988) → 1`. **It misses zoom 2 by
0.012** — about four pixels of viewport height — and the 480×352 map then fills
16% of the screen with flat `#123040` around it. 1920×1080 and 1440×900 get zoom
2; everything narrower gets 1.

**This is D-12 finally coming due.** Two options, and the audit recommends the
second:
- *Tolerance:* `Math.floor(fit + 0.05)` and a smaller HUD margin. Buys
  1366×768, changes nothing else, half an hour's work.
- *Follow camera with `setBounds`:* choose zoom to fill the viewport and track
  the player. Also fixes the mobile crop, and stops the farm being a postage
  stamp on a large monitor. It is what the genre does.

Do not ship a fractional zoom — `fitCamera`'s existing comment is right that
16px art resampled by 2.3× is mush regardless of `pixelArt: true`.

**Done:**
- [x] 1366x768 no longer renders the farm at native size
- [x] Nothing the game is played on is hidden behind either bar, at any size
- [x] The sizes that already worked are unchanged
- [x] The arithmetic is a pure, tested function

**How it turned out.** The tolerance option was not needed and the follow camera
was not taken, so **D-12 stays open**. Two changes, both about what "fits" means.

**It fits the CONTENT, not the map.** `FARM_CONTENT` is the map inset by
`BORDER_RING` — 448x320 instead of 480x352 — and the camera guarantees only that
rectangle. The ring is the decorative grass fringe and the water column, and
requiring it on screen is what made a 1366x768 laptop compute 1.988 and floor to
1. **Four pixels of viewport height, spent on a scalloped edge, cost an entire
zoom level.** The fringe is worth having and is not worth halving the game for,
so it is now allowed to clip.

**And it reserves BOTH bars.** `hud.chrome()` measures the top bar and the
hotbar; the old fit knew only about the top one, which meant the zoom it handed
back could put the southern path and the barn's door underneath the hotbar. That
is the same class of mistake T-15.27 fixed at the top of the screen — reserving
only the chrome you happen to remember.

Those two pull opposite ways on purpose: the first buys about a zoom level, the
second spends part of it on being honest about the bottom of the screen. The
shortfall is closed by **compact chrome on short viewports** — a
`max-height: 820px` block in `hud.css` plus `SLOT_SCALE_COMPACT` in `hotbar.ts`,
taking 151px of chrome down to 114px. The hotbar's slot goes 3x to 2x on an 18px
sprite, a whole-number step, so nothing blurs. 820px is chosen so a 900-tall
laptop and a 1080p desktop — both already clearing zoom 2 — are untouched.

**The slot size could not be a media query.** `--slot-size`, the sheet size and
both background offsets are multi-value and measured together from `UI_SLOT`;
CSS cannot rescale that set as a unit, so `hotbar.ts` rewrites all of them. It
also has to re-pick on resize, and **`hud.chrome()` syncs the scale before
measuring** rather than relying on listener order — the camera and the hotbar
both react to a resize and nothing sequences them, so a camera that fitted first
would reserve the height of a strip that was about to change.

Measured in the browser afterwards, content clearing both bars at every size:

| Screen | Before | After | Chrome |
|---|---|---|---|
| 1920x1080 | 2 | 2 | 151 |
| 1440x900 | 2 | 2 | 151 |
| **1366x768** | **1** | **2** | 114 |
| 1280x720 | 1 | 1 | 114 |
| 1024x600 | 1 | 1 | 114 |

**1280x720 honestly cannot reach zoom 2** and is left at 1: twenty tile rows need
640px, and 720 minus even the compact chrome is 606. The only ways to buy it are
hiding content behind the hotbar or a follow camera, and both are D-12's call.

The zoom arithmetic moved to `apps/client/src/game/camera.ts` as `fitZoom` and
`centreOffset`, with 13 tests — including one asserting the fit would still be
stuck at 1 without the compact chrome, so deleting that media query fails a test
instead of quietly costing the zoom level back.

**The Interior scene shares the change** (`fitZoom` with `PIXEL_SCALE * 2`),
which also stopped the hotbar sitting on the bottom row of the room.

### T-18.04 — Animals stand at their own buildings  ✅ **DONE**

Depends: — · Size: S · Closes BUG-06
Files: `packages/shared/src/config/pasture.ts`, `pasture.test.ts`

Chickens render in a row at tile y=1 — the top edge of the map, partly behind
the HUD — while a tier-0 coop occupies y=7–11, three empty rows south of them.

**`COOP_YARD`'s comment is right, which is the interesting part.** It says the
yard "sits in the three rows above the Deluxe coop's roof (`COOP_FOOTPRINT.y0`
is 4)", and `COOP_FOOTPRINT` really is the *Deluxe* box (x21–29, y4–11), so
rows 1–3 are the only band clear of the coop at **every** tier. The yard is
pinned to the largest tier's clearance, and the gap a tier-0 player sees is the
price of that. One fixed yard cannot hug a building that grows three sizes.

The first cow is worse and is not a stale constant: `BARN_YARD` is a 9-wide row
from x=2 filled left-to-right, so one cow stands at x=2 — the far bottom-left
corner, 19 tiles from its barn. That is the authored design and the design is
wrong.

**Do:** make the coop yard follow the **current** tier's roofline rather than the
largest tier's clearance, and fill both yards from the building outward instead
of from the map edge. Reserve the union of every tier's yard, so upgrading
cannot move a yard onto placed decor. `pastureFitsFarm()` only asserts the yards
are inside the map, which is why nine tests passed over a flock at the wrong end
of the farm — add the adjacency assertion.

**Done:**
- [x] Chickens stand on the coop's roofline at every tier, and move when it grows
- [x] The first cow stands beside the barn, not at the far end of the map
- [x] Decor is kept off every tier's yard, not just the current one
- [x] "Beside its building" is asserted, at every tier, for both yards

**How it turned out.** `COOP_YARD` and `BARN_YARD` are gone; `coopYard(tier)` and
`barnYard()` derive them from `coopFootprint`/`BARN_FOOTPRINT` instead.

**`Yard.spacing` is signed now, and that is the barn fix on its own.** The cow row
was nine slots filled left-to-right from x=2, so a player's *first* cow stood at
the map's western edge, nineteen tiles from the barn it lived in — the row only
arrived at the barn once the herd was full. Origin at `BARN_FOOTPRINT.x0 - 2`
with `spacing.x: -2` fills away from the building instead. The tiles are the same
set; only the order changed.

**The coop needed the tier**, because its yard was pinned above the *Deluxe*
footprint (y4-11) so one fixed band could clear every tier. That is sound, and it
is why a tier-0 player's chickens sat three empty rows north of their coop and
hard against the map's border. A yard that follows the roof cannot be tier-blind,
so `pastureSlot` takes one.

**The cost of a yard that moves is that reservation has to span every tier.**
`yardTilesAcrossTiers()` is the union, and it is what `reservedFarmTiles` and the
server's `checkReachable` now use — otherwise a statue placed on open grass
beside a small coop is standing in the flock after an upgrade, and an animal has
no coordinates the player could move it away from. Same argument
`BUILDING_FOOTPRINTS` already makes: reserve the ground the thing will ever need,
not the ground it needs today. Its tiles carry their `building`, so the
reachability error can still say *which* yard a bad placement stranded.

`Farm.syncAnimals` rebuilds an animal whose home moved rather than nudging it —
`homePosition` seeds the wander routine, so an animal keeping its old seed at a
new home would drift around a point it is no longer standing on. Verified live:
upgrading the coop mid-session moved the flock from row 6 to 5 to 3 as the roof
grew, with no duplicated or leaked sprites.

**The test that was missing.** Nine tests passed over a flock at the wrong end of
the farm because they asked "inside the map?" and "not under a building?" —
neither of which implies "near its building". There is now an explicit adjacency
assertion, per tier, for both yards, and it measures the gap in the yard's own
SPACING rather than in tiles: the spacing is the animal's width, so a chicken
stands against the wall and a cow, being two tiles wide and centred, cannot get
closer than two.

### T-18.05 — The drawn path must be walkable  ✅ **DONE**

Depends: — · Size: S–M · Closes BUG-07
Files: `packages/shared/src/config/farmLayout.ts`, `collision.test.ts`,
`apps/mapmaker/scripts/generate-farm.ts`,
`apps/client/src/game/entities/reachability.test.ts`,
`apps/client/src/game/collision.test.ts`,
`apps/client/public/tilemaps/farm.json`

Walking west along the y=13 path stops dead at tile 6; walking east stops at 13.
The mailbox (3,13), merchant stall (5,13) and shipping box (14,13) are all solid
and all sit **on** the run `[3,13,20,13]`. They were placed there deliberately so
the player passes them — but they block it, so the player detours onto grass and
the mailbox is unreachable along its own path.

`assertPathsClearOfBuildings` validates buildings only. Extend it to
`OBJECT_TILES` with their measured `OBJ_COLLISION_BASE` footings and move the
three objects one row off the run. **Careful:** this edits `farm.json` object
positions, which the generator owns (D-13) — do it through the generator, and
run `farmMap.test.ts` after.

**Done:**
- [x] Mailbox, stall and shipping box moved to the run's north verge
- [x] `assertPathsClearOfObjects` refuses to generate a map that repeats it
- [x] The lane is walkable end to end, both directions, in the real browser
- [x] Shop, chest and shipping box all still open from the path
- [x] The two hand-copied "worst case" object lists are now one shared list

**How it turned out.**

**Four checks looked straight at this and none of them could see it, because
they all asked about ANCHORS.** `assertGroundClearOfBuildings` compares
`OBJECT_TILES` — a list of anchor cells — against building footprints.
`reachability.test.ts` proves the idle farmer reaches every plot, and it did:
by going round. `MERCHANT_NPC_TILE`'s own test even asserts the shopkeeper is
"off every path run", and its comment says so while noting that "the mailbox,
stall and shipping box already interrupt the y=13 lane" — the bug is written
down, in a passing test, as an accepted condition. An anchor on a path is not
obviously wrong; a *footing* on a path is, and nothing computed footings against
`pathTiles()` until now. `objectFootings()` is that missing join, and
`objectsBlockingPaths()` is the one question worth asking of it.

**The objects went NORTH, and that is a depth decision, not a taste one.** Either
verge clears the lane. But an object's ground row draws in front of the row above
it, so a 48px stall at (5,14) would cover the player *completely* as they walked
past on y=13 — the art is three tiles tall and its ground line would be one row
below them. On the north verge the player walks in front of everything. The
mailbox and the crate followed for consistency, which also leaves the row
reading as one deliberate frontage rather than objects scattered on both banks.

**Moving the stall forced the chest to move, and the reason is nine pixels.**
The stall's art is 2 tiles wide with alpha bounds (1,5)-(30,40), so at (5,12) it
occupies cells 5-6 across rows 10-12 — and the chest at (6,10) drew its art in
cell (6,10) too, overlapping by about 7x11px with the stall (the lower ground
row) painted over the chest's corner. Not a collision failure and no test would
have caught it; just two sprites in one cell. One row north to (6,9) is open
grass, still faced from the spine at (8,9), still well clear of the house's
bottom edge at y=6. Verified in the browser: the chest opens from (8,9) facing
west.

**An accidental improvement fell out of the stall's move.** T-18.02 put the
shopkeeper at (7,12) and argued the cell "adds no further blocker to a lane the
mailbox, stall and shipping box already interrupt" — relaxed about exactly the
thing that was broken. With the stall's ground row now at y=12, the vendor is
standing level with the counter they work at instead of a row north of it. The
comment has been rewritten to say what actually holds.

**Two test files were keeping hand-written copies of the map's object list.**
`collision.test.ts` and `reachability.test.ts` each built the "worst case" farm
from a literal five-entry array of `{key, anchorPx}` — which means a worst case
that silently stops being the worst case the first time someone adds an object
and updates only one of them. Both now build from `MAP_OBJECTS`, and
`objectAnchorPx()` owns the `(tile.y + 1) * 16` conversion that had been
copy-pasted three times. A footing wrong by one tile is precisely this bug.

**Break-tested by reproducing the bug.** Putting `SHIPPING_BOX_TILE` back at
(14,13) fails the shared footing assertion (`obj-shipping-box blocks the path at
(14,13)`), fails three client walk tests, and makes the generator refuse to write
the map at all. Restored, all four are green. The client test also carries its own
control: the eastbound walk with a crate re-added on the lane must stop, and must
stop at tile 13 specifically — not merely somewhere.

**Verified in the browser** against the live stack, on a new account (Playwright
driven directly, per the T-7.07 note — the registered MCP server still wants a
`chrome` channel that does not exist here). Walking west from spawn now runs the
full lane past the mailbox and out to the shoreline; walking east runs it past
the shipping box to the map's edge. Before this task those two walks ended at
tiles 6 and 13. The live `BlockMap` dumped from the running scene shows row 13
clear from x=1 to x=23 and row 12 solid at exactly 3, 5, 7 and 14 — the four
things now standing on the verge. Shop, chest and shipping box each open from a
path tile.

### T-18.06 — Harvesting must not block on its own output  ✅ **DONE**

Depends: — · Size: S · Closes BUG-08
Files: `apps/client/src/game/actions.ts`, `actions.test.ts`

Harvest-by-hand requires an empty hand. Produce lands in the first free backpack
slot, which can be the equipped one — so harvesting a potato into the selected
empty slot makes the next hand-harvest fail with *"Empty your hands to harvest by
hand."* Confirmed end to end: slot 6 empty, harvest filled it, next harvest
refused with the plot left standing.

The check is really "not holding a tool", not "holding nothing". Either relax it
to allow harvestable produce, or place produce into the first free slot outside
the equipped one. The first is smaller and reads better.

**Done:**
- [x] `holdingTool()` replaces `held !== null` at both hand actions
- [x] The animal half of the same bug, which the audit did not reach, is fixed
- [x] Two tests that encoded the bug now assert the opposite, and break-test
- [x] Verified in the browser: a row of crops and a row of chickens, in one pass

**How it turned out.**

**The audit's recommendation was right and its scope was one animal short.**
`animalAction` has the identical branch — `if (held) { feed, or refuse }` — and
the identical failure, for the identical reason: the egg lands in the first free
backpack slot, which is routinely the equipped one, so collecting from the first
chicken refuses the second. A coop is a row of animals exactly the way a field is
a row of plots, and shipping "harvest works, collect doesn't" would have been
half of one bug. Found by fixing the crop half and reading the neighbour.

**Two tests had the bug written into them as the expected behaviour.** *"asks
for empty hands rather than harvesting with produce held"* and *"refuses a tool,
and any other item"* both passed for four phases while describing something
unplayable. That is the failure mode worth naming: the tests were not weak or
missing, they were **wrong**, and they were wrong because `held !== null` reads
so much like the rule that nobody asked what the action does to the hand it
tested. A test can only guard the rule it was told.

**`holdingTool` asks `toolKind`, not `category`.** They agree today, and one of
the new tests asserts they agree for every item in the table — which is the
useful assertion, because `toolKind` is what `actionFor` already switches on for
the hoe and the can. An item declared `category: TOOL` with no kind would be a
tool the control scheme cannot use, and that test says so before anyone finds
out in a hotbar. D-4's eight tiers are covered the day they are declared.

**The tool branch on a plot is defensive, and the tests say so rather than
faking an item to reach it.** Both MVP tools are answered earlier and better — a
can waters a planted plot, a hoe says what is in the way — so no equippable item
reaches `holdingTool` on the plot path today. The first attempt at a test
injected a fake `axe_wood` into `ITEMS`; mutating shared config to reach a
branch is a worse test than none. `holdingTool` is exported and pinned directly
against the real item table instead, and the plot path asserts the two real
tools still get their more specific answers.

**Verified in the browser** on the live stack. Crops: two ripe leeks, empty
hotbar slot 5 equipped, harvested one after the other — *"Harvested 1 × Leek"*
twice, both plots left as bare tilled soil, and slot 5 visibly holding 2 × Leek
at the end. Animals: four grown fed chickens with eggs waiting, collected in one
pass with no cycling — four *"Collected 14 × Egg"* toasts and 28 eggs in the
equipped slot. Both rows are exactly the sequence that refused before.

Two notes on the verification itself. Ripening a crop and maturing a chicken were
done with a direct `UPDATE`/`INSERT` on the dev database — the shortest crop is
45 minutes and a chick takes 12 hours, and this is a UX gate, not a growth-timer
test (which `growth.test.ts` covers on its own). And `/api/auth/register` started
returning **429** partway through, which is §8's per-IP rate limit doing its job;
the second script reuses T-18.05's account rather than working around it.

**Worth recording for the next browser pass:** `player.moveTo()` teleports but
does NOT set facing — `player.face(dir)` is a separate method, and `p.facing` is
a getter, so assigning to it fails silently and the action key then works the
wrong tile. Half an hour went into "the plot says it is not cleared" before that
turned out to be a *different* plot.

### T-18.07 — Idle mode cannot be on with nothing to do  ✅ **DONE**

Depends: — · Size: S · Closes BUG-09
Files: `packages/shared/src/schemas/index.ts`,
`apps/client/src/game/idlePanel.ts`, `idlePanel.test.ts`,
`apps/server/src/db/schema.ts`, `modules/farm/idle.integration.test.ts`,
`modules/farm/idleApply.integration.test.ts`

The server accepts `{enabled: true, tasks: [], cropId: null}`. The HUD then says
"Idle mode — your farmer is working", the player is input-locked out of walking
and using tools, and the farmer does nothing, indefinitely. The headline feature
can be switched on into a state where it provably cannot act.

Tick all four chores when the switch is first turned on — overwhelmingly the
intent — and disable the switch while `tasks` is empty.

**Done:**
- [x] `idleSettingsSchema` refuses `enabled` with an empty chore list
- [x] The switch fills in the chores instead of going on with none
- [x] Unticking the last chore is refused, with a message that says the way out
- [x] Legacy rows carrying the bad state still read and still do nothing
- [x] Both halves break-tested separately; verified in the browser

**How it turned out.**

**Fixed on the server as well as in the panel, and the audit only asked for the
panel.** Its file list is `idlePanel.ts` alone, which would have left a rule
that a stale build, a replayed request or a curl walks straight through — and
what it walks into is a real farm with no way out except the Stop button. §4.1
makes the panel a UX gate by definition, and "enabled with no chores" is not a
setting the server could act on; it is a contradiction. It is a `.refine()` on
the object rather than `tasks.nonempty()`, because switching idle **off** with
an empty list is perfectly ordinary: a farmer that is not working needs no
chores.

**The browser pass found a bug the whole unit suite was happy with, and it is
the interesting part of this task.** Defaulting to all four chores means
defaulting to `plant` — and T-13.06's endpoint refuses `plant` without a
`cropId` (`IDLE_CROP_REQUIRED`), on the entirely correct grounds that a farmer
told to sow and not told what is a farmer doing nothing. So the first version of
this fix made turning the switch on fail with *"Pick a crop for your farmer to
plant."* for every player who had not already chosen a crop, which is everyone,
the first time. Two rules, each right, whose intersection nobody had reason to
look at — and no test on either side could have found it, because each side's
tests are about its own rule. `defaultTasks(cropId)` drops `plant` when there is
no crop. Choosing a crop *for* the player was the alternative and is worse: it
spends seeds they did not choose to spend.

**Unticking the last chore is refused, not reinterpreted.** The two other
readings both have the control doing something it was not asked to: silently
re-ticking the box the player just cleared, or switching idle off as a side
effect of a checkbox. A refusal with *"Your farmer needs at least one chore.
Turn idle off instead."* names the way out, which matters because idle is still
ON at that moment — a bare "no" would leave the player stuck being told what
they cannot do. The undo path is `render()`, the same one a server refusal
already used.

**Two server tests were arming the bug on purpose, and they were right to.**
`idleApply.integration.test.ts` puts a farm into `enabled` with no chores twice
— to prove `nextAction` is null and that a shift of zero actions reports no
summary. Both went through the PUT, so both broke. The behaviour they guard
still matters: rows written before this rule exist, and a simulator that threw
on one would break the farm read for whoever has it. They now write the row
directly, with a note saying why, and the endpoint's refusal is asserted
separately.

**Verified in the browser.** Switch on with nothing ticked → *Till bare soil*,
*Water crops* and *Harvest what is ready* tick themselves, the banner appears
and no error is raised; *Plant seeds* stays clear because Sow reads "Nothing".
Unticking down to one leaves *Harvest* alone, and the next click is refused with
the box put straight back and the toast shown. The one 400 in the network log is
the script ticking *Plant seeds* with no crop chosen — `IDLE_CROP_REQUIRED`
doing its job, not a regression.

### T-18.08 — Furniture is solid  ✅ **DONE**

Depends: T-18.01 · Size: M · Finishes BUG-02
Files: `packages/shared/src/config/furniture.ts`, `furniture.test.ts`,
`packages/shared/src/errors.ts`, `apps/client/src/net/errors.ts`,
`apps/client/src/game/scenes/Interior.ts`,
`apps/server/src/modules/house/reachability.ts` (new), `reachability.test.ts`
(new), `modules/house/service.ts`, `house.integration.test.ts`

T-18.01 puts the player in front of a piece at its own ground line, but standing
on the *back* row of a 2-row-tall bed still hides them — correct for an upright
object, and the reason walk-through furniture is the wrong model indoors.

Make the base row solid. Reuse `modules/decor/reachability.ts`'s flood fill so a
player cannot wall themselves into a corner, the same guard D-9 built for
outdoor decor. Flat pieces (the rug) should instead move to `DEPTH.groundDecal`
— they are paint on the floor, exactly like tilled soil.

**Done:**
- [x] The whole footprint of an upright piece is solid, not just its base row
- [x] `modules/house/reachability.ts` refuses a placement that seals anything in
- [x] The rug is a floor decal: walked over, drawn under everything
- [x] `FURNITURE_BLOCKS_ROOM`, with a message that says what to do
- [x] Both halves break-tested; verified in the browser

**How it turned out.**

**The whole footprint is solid, not the base row, and the task as written would
not have closed the bug it names.** Its own statement of the residual is
"standing on the *back* row of a two-row bed still hides them" — and a solid
base row leaves exactly that: the back row stays walkable, the sprite still
sorts in front of anyone on it, and the player still vanishes. The footprint is
already defined in `furniture.ts` as *what the sprite hides* ("you cannot slide
a rug under the top half of a fireplace, because on screen you could not see
it"), which is precisely the set of cells where standing would hide the player.
Making that set solid is the rule the geometry was already carrying; "base row"
was a smaller change that happened not to work.

**The guard is what made this possible at all, and `Interior.buildWorld` said
so.** Its comment had been refusing to make furniture solid for two phases, and
the reason it gave was correct: twelve by six, three pieces wall off a corner,
removal requires walking up to the piece, and `modules/decor/reachability.ts`
has no counterpart on the house module. So the counterpart is what this task
mostly is. It guards two permanent losses: **the doorway cell**, which is both
where the player materialises and the only cell the door can be faced from, and
**every piece keeping a reachable neighbour**, since removal is the only way to
undo a placement. A flood fill over 72 cells inside the transaction.

**A test fixture turned out to be a trap, which is the best evidence the check
works.** The "heavily furnished room" case filled alternating columns at full
height and failed — correctly: alternating full-height columns cut the room into
vertical corridors that never meet, stranding most of the furniture behind a
solid column. *"Leave a gap between pieces"* is not the same rule as *"leave a
connected floor"*, and only the second one is true. The fixture now hangs its
columns off a corridor on the spawn row.

**`flat` is one flag and it does two things.** The rug blocks nothing and draws
at `DEPTH.groundDecal`, the same band tilled soil uses on the farm and for the
same reason: a thing with no height cannot occlude the thing standing on it.
Before this, a player standing on their own carpet was behind it. The flag is
also what lets the reachability check skip a piece entirely — a rug cannot cut
anything off, including when it is laid across the doorway, which is what a
doormat is.

**`house.integration.test.ts`'s field allowlist caught `flat` and that is the
guard working.** It exists so nobody adds `bonusStorage` to a wardrobe, and it
fails on *any* new field rather than on suspicious ones. Admitted deliberately
with the reasoning written next to it, which is the process that entry already
documents for `sheet` — the alternative, relaxing the test, is how a guard stops
being one.

**Verified in the browser.** A four-poster bed at room cell (2,2) and a rug at
(7,2): walking north into the bed stops the player one row below it, **fully
visible**, where before they were swallowed; standing on the rug draws them on
top of it. The interior block map reports 54 solid tiles — 48 wall, 4 bed, 2
stool, 0 rug. Through the API, a stool on the doorway and a stool completing a
corner box both return `FURNITURE_BLOCKS_ROOM`, and the same rug on the doorway
is accepted.

**Noticed while verifying, not fixed here:** the interior's floor hint ("E to
put a piece down · face the door…") renders at enormous size and runs off both
edges of the screen. It is a world-space `Text` scaled by the interior camera's
zoom, which T-16.12 made large because the room is small. Filed as **T-18.24**
below rather than folded in — it is a camera/UI question, not a collision one.

### T-18.09 — Ground scatter on the farm  ✅ **DONE**

Depends: — · Size: M · Closes G-3
Files: `scripts/prepare-assets.mjs`, `packages/shared/src/config/assets.ts`,
`farmLayout.ts`, `apps/mapmaker/scripts/generate-farm.ts`,
`apps/mapmaker/src/io/farmMap.test.ts`,
`apps/client/public/tilemaps/farm.json`

The map's `decor` tile layer had **zero** non-zero gids from the day it was
first authored, so the farm was a flat `#79BF56` field. `ROADMAP.md` already
called this "the single biggest remaining visual win".

**Done:**
- [x] 67 tufts, flowers and stones over the open grass
- [x] Every frame measured for flatness, not picked by eye
- [x] Nothing lands on a path, the field, a building, a yard or an object
- [x] Reproducible from the tile coordinate, so regenerating is a no-op

**How it turned out.**

**The registered tilesets could not do it, and finding that out took one
measurement.** Profiling all 960 cells of `tileset-grass-spring` for alpha
coverage found exactly three fully-opaque cells, all plain grass, and **zero**
cells containing a self-contained floating detail. `tileset-paths`,
`tileset-soil` and `tileset-grass-water-spring` gave two between them. That is
not bad luck — it is T-7.05's finding restated: these sheets hold rounded
autotile patches, which is also why `GROUND_GRASS` had to be drawn from scratch
as a flat colour. There was no scatter in the manifest to use, which is why the
layer was empty.

`Tileset/ALL props seasons.png` is the sheet that has it: 22x12 cells of
seasonal ground props in bands. Registered as `TILESET_PROPS_SEASONS`, appended
at the **end** of `SHEETS` — anywhere else renumbers every tileset after it,
which is the failure that made maple trees render as milk bottles in T-7.09 and
the shipping box vanish entirely in T-8.03. `farmMap.test.ts` caught the shift
within seconds of the append, before the map was regenerated, which is exactly
what T-15.01 built it for.

**Flatness is the whole selection rule, and it is a rule about DEPTH.** The
decor layer draws at `DEPTH.decor`, below every world sprite — so anything with
height put here is drawn behind the player from every angle, permanently,
including when the player is standing north of it. The sheet's standing flowers,
mushrooms and driftwood are all excluded for that reason; each would have to be
a `DecorPiece` sorting on its own feet. What is used is six spring tufts and
five loose stones, chosen from a per-cell profile of alpha coverage, bounding
box and whether the art runs into the cell edge.

**Two frames were rejected for a reason worth writing down.** Frames 0 and 4 are
in the same band as the tufts and look like tufts in a contact sheet — but each
carries a brown lump that, at farm zoom on green, reads as a hole in the lawn
rather than as grass. Rendering the candidates **on `#79BF56` rather than on
transparency** is what made that visible; the pack's own preview background
hides it.

**The scatter is a hash of the tile coordinate, not a seeded sequence.** The map
is committed and the generator owns it (D-13), so a scatter that reshuffled on
every run would make each regeneration a several-hundred-line diff and leave
`farmMap.test.ts` with nothing useful to say. `scatterTiles()` is pure in the
coordinate, so regenerating twice is byte-identical, and the test asserts the
committed map agrees with the function rather than merely having *something* on
the layer.

**What counts as "open grass" is the substance of the generator half**, and it
is pessimistic on every axis: the decorative frame, water, the shoreline, every
path tile, the crop field, every measured object footing, the shopkeeper's cell,
every yard slot **at every tier**, and `BUILDING_FOOTPRINTS` — the largest
footprint of each building rather than today's, so a flower cannot appear from
under a barn's eaves the moment someone upgrades it. Those are exactly
`reservedFarmTiles`' inputs, which is not a coincidence: "ground that is spoken
for" is one question, asked here about paint and there about placed decor.

**Verified in the browser.** The farm reads as a field now — tufts, white and
yellow flower clusters and brown stones across the open grass, with the paths,
the crop field, both yards and every building footprint clean. 67 scatter tiles
against 660 ground tiles, and the client needed no change at all: `buildMap`
already creates every tile layer and `Preload` already loads all of `SHEETS`.

---

### T-18.10 — Action-feedback particles  ✅ **DONE**

Depends: — · Size: S · Closes G-4, F-6
Files: `apps/client/src/game/effects.ts` (new), `effects.test.ts` (new),
`apps/client/src/game/scenes/Farm.ts`

`grep` found **zero** `add.particles` and **zero** `tweens.add` in the entire
client. Tilling, watering and harvesting each played a swing and raised a toast,
and nothing at all happened at the tile.

**Done:**
- [x] Dust on the hoe, a splash on the can, a pop on harvest
- [x] Held to `prefers-reduced-motion`, verified in a reduced-motion context
- [x] The idle farmer kicks up the same dust, for one line
- [x] Emitters destroy themselves; none left alive after the burst

**How it turned out.**

**The first version fired seven particles nobody could see, and every test
passed.** The emitter existed, `getAliveParticleCount()` returned 7, the depth
and position were right, and the screenshot showed bare soil. Two causes, both
mine:

- **2px particles at scale 1 on a 16px tile.** Two world pixels is an eighth of
  a tile; at the farm's zoom that is noise. They now start at 4px and travel
  clear of the tile they fire on.
- **Half the dust was tinted `#be6d47`, which is exactly `ground-soil-dry`.**
  The rule "sample the colour from the art" (§9) was right and I applied it to
  the wrong reference: I sampled the thing the burst lands *on* rather than
  something that contrasts with it. The dark under-soil `#76422a` leads now,
  weighted two-to-one, which is also what a hoe actually turns up.

Both are pinned by assertions that did not exist before: a burst must be at
least a fifth of a tile wide and must carry at least a tile clear of where it
fired. Neither is a rule about correctness — a burst that violates them still
"works" in every sense a unit test could previously see. That is exactly why
they are worth writing down: **this class of bug is invisible to tests that only
ask whether the code ran.**

**Reduced motion, and not as an afterthought.** T-17.01 stilled the maple loop
and the animal wander because they are ambient and endless. A burst is neither —
but it is a handful of objects darting outward in the player's focus, triggered
by their own keypress, which makes it *more* likely to be noticed rather than
less. `playBurst` returns before it builds anything. Verified in a Playwright
context with `reducedMotion: 'reduce'`: **1 emitter with motion on, 0 with it
reduced**, and 0 in both a second after the burst, so nothing leaks.

**The idle farmer got it for one line**, which is the payoff for `burstFor`
being keyed on `Swing` rather than on `FarmIntent['kind']`. The replay already
asks `swingForKind` what animation to play; asking the same value what burst to
throw means the autonomous farmer raises dust on a field the player is watching
with no second code path to keep in step. The tile it works is read back through
`facedTile` — the plan carries a plot UUID and an approach position, and the
farmer has just been turned to face the plot on the line above.

**The particle texture is generated, not shipped.** A particle here is one
tinted pixel scaled up, so an asset file would be a white dot plus a manifest
entry that renumbers every `firstgid` after it — the failure T-7.09 and T-8.03
both shipped. `this.make.graphics(...).generateTexture('fx-pixel', 2, 2)`, once,
guarded on existence because Phaser's texture manager outlives a scene.

**Fired before the request, deliberately.** The burst is a reaction to the
player's own input, not a report of the server's answer — the toast and the poll
already carry that. A refusal therefore leaves a puff of soil that meant
nothing, which is a much smaller lie than a 200ms gap between pressing a key and
anything happening at all.

---

### T-18.11 — The interior floor  ✅ **DONE**

Depends: — · Size: S · Closes G-5 (floor half)
Files: `packages/shared/src/config/interiorLayout.ts`,
`apps/mapmaker/scripts/generate-interior.ts`,
`apps/mapmaker/src/io/interiorMap.test.ts`,
`apps/client/public/tilemaps/interior.json`

"The room is 12x10 with nothing in it and a strong repeating stripe that reads
as placeholder. A rug on the floor by default, **or** a subtler floor tile,
would help a lot."

**Done:**
- [x] Three seamless plank tiles in a coordinate-hashed bond, measured
- [x] The map regenerates byte-identically; the test pins the exact bond
- [x] Break-tested by collapsing it back to one plank

**How it turned out.**

**The old floor's own comment claimed the opposite of what the pixels say, and
measuring settled it in one pass.** `INTERIOR_FLOOR_FRAME` was
`houseFrame(19, 0)` under a note reading "the parquet's diagonal runs across
tile seams, so a floor of it has no visible grid". Profiling all 1248 cells of
`TILESET_HOUSE` for whether each tile's left edge matches its own right edge
gives that tile **28.9 and 34.8** out of 255 — it does not tile with itself at
all, so every 16px boundary breaks the diagonal and a 12x10 room shows 120 of
them. That is the "strong repeating stripe". It was a reasonable guess written
in good faith, and it was wrong; the check took thirty seconds and did not exist.

**Three tiles, not one, and that is what makes it read as a floor.** The
surviving candidates were filtered to fully-opaque, warm, and seamless in both
axes, then rendered **tiled 4x4 at room scale** rather than inspected as single
cells — a floor tile can only be judged as a floor. `houseFrame(25, 0)` and its
two siblings measure **0.0 on all four edge comparisons**, against themselves
and each other, so any mix of them is seamless by construction. Two are the same
plank block rotated, which is why a random bond reads as parquet rather than as
noise: one tile is a hard grid, three laid in a bond is a laid floor.

Which plank goes where is a hash of the coordinate, the same argument
`scatterTiles` makes on the farm (T-18.09): the map is committed and the
generator owns it, so a floor that reshuffled every run would make each
regeneration a 120-line diff.

**The `or` in the audit's recommendation is load-bearing, and I took the floor
half deliberately.** "A rug on the floor by default" means granting furniture at
registration, and furniture costs gold, is marked `tradeable`, and would be a new
faucet §5.8 requires documenting — that is an economy decision, not a visual fix,
and it does not belong inside a task about a floor tile. Filed as **T-18.25**
with the question named. The room is still unfurnished; it no longer looks
*unfinished*, which is what G-5 was about.

---

### T-18.24 — The interior hint was three times too big  ✅ **DONE**

Depends: — · Size: S
Files: `apps/client/src/game/scenes/Interior.ts`

Filed during T-18.08's verification: the floor hint rendered at 30-40px and ran
off both edges of the viewport.

**How it turned out.**

**The arithmetic was inverted, and the fix exposed a second bug behind it.**
`fitCamera` ran `setScale(1 / zoom).setFontSize(10 * zoom)`, which cancels to a
constant ten **world** pixels — and a world object under a zoomed camera is
`fontSize x scale x zoom` on screen, so it was `10 * zoom`. At the zoom
`fitCamera` picks for a room this small that is 30-40px of monospace. Rendering
the glyphs at their final screen size and scaling by `1 / zoom` is the same
arithmetic the other way round: constant on screen, and crisp, because the
texture is generated at the size it is displayed.

That alone left it **1368px wide — wider than a 1366px viewport**, let alone the
768px room it sits under. Constant-but-still-overflowing is a different bug from
the one that was filed, and worth separating: the arithmetic was only half of
it. The copy is sixty characters at 12px now, about 430px, which clears the room
at every zoom.

**It moved onto the floor, and that was forced rather than chosen.**
`fitCamera` reserves both HUD bars and gives the room everything left over, so
on 1366x768 the room's bottom edge and the hotbar's top edge are **twelve pixels
apart**. There is no "below the room" to put anything in — the corrected hint
was simply behind the hotbar. Anchored bottom-origin just inside the room's last
row, it cannot be clipped at any viewport, and a hint about the floor belongs on
it.

**Recolouring it was mandatory, not cosmetic.** `#b59d84` was picked against the
diagonal hatch and is nearly invisible on the parquet T-18.11 replaced it with.
It is now `#63302e`, a step darker than the floor's own mortar line. A colour is
only readable relative to what it sits on, so replacing the floor made re-picking
the text colour part of the same change.

---

### T-18.12 — A modal panel takes input  ✅ **DONE**

Depends: — · Size: S · Closes BUG-10
Files: `apps/client/src/lib/focus.ts`, `focus.test.ts` (new),
`apps/client/src/game/entities/Player.ts`, and the five panel roots

Open the shop at the merchant and hold the right arrow: the character walks away
across the farm with the shop still open. The action key was guarded by
`isTypingInDom()`; movement was not guarded at all.

**How it turned out.**

**`isTypingInDom` was never enough, and the reason is worth naming.** It answers
"is a text field focused" — and a shop with nothing focused is still a shop the
player is reading rather than a farm they are walking around. `isModalOpen()` is
the second question, asked in the same place, and `readInput` is the only place
movement is read so there is exactly one answer to it.

**Declarative, not a registry.** A panel opts in by carrying `data-modal` on its
root; `isModalOpen` is `[data-modal]:not([hidden])`. A central list of "panels
that are modal" is a second thing to keep in step, and the failure mode of
forgetting the attribute is *visible* — the character walks out from under the
panel — where forgetting a registry entry is silent.

**Popovers deliberately do not carry it, and the decor tray is why.** Arming a
piece and then WALKING to where it goes is the entire interaction, so a tray
that froze the character would break the feature it belongs to. The rule is "a
dialog you are reading", not "any floating element".

**NOT `setInputLocked`, which the audit recommended.** That flag means something
else: locked hands the character to the idle farmer's `drive`, so opening a shop
during an idle shift would have frozen the farmer mid-stride rather than
stopping the player.

**Verified in the browser, both directions, plus a break-test.** With the shop
open, holding the right arrow for two seconds leaves the player on (6,13). Close
it and the same hold moves them to (10,13). Removing the guard and re-running
walks them from (6,13) to **(12,13) with the shop open** — six tiles from the
merchant, which is the bug exactly as filed.

---

### T-18.13 — One Escape, one layer  ✅ **DONE**

Depends: T-18.12 · Size: S · Closes BUG-11, BUG-12
Files: `apps/client/src/game/hud.ts`, `idlePanel.ts`, `inventoryPanel.ts`,
`shopPanel.ts`, `shippingPanel.ts`, `tradePanel.ts`,
`apps/client/src/game/scenes/Interior.ts`, `scenes/Farm.ts`

Escape closed the chest **and** returned the player to the farm in one press
(BUG-11), and the farm's chest panel stayed open after walking indoors
(BUG-12) — you could stand in your house operating a chest that is outside.

**How it turned out.**

**The first fix did not work, and finding that out took the browser.** Asking
`isModalOpen()` inside the scene's Escape handler is racy: every panel binds its
own `keydown` on `document`, so by the time the scene's handler runs the panel
has already closed itself and the answer is `false`. Measured — one Escape
still closed the bag *and* left the house. A guard that reads state another
listener has just mutated is not a guard.

**The panel has to CONSUME the press, and the DOM already gives the right
seam.** Phaser's keyboard plugin listens on `window`; the panels listen on
`document`, which is the last hop before it. `e.stopPropagation()` in each
panel's Escape handler stops the press reaching Phaser at all, so one press is
one layer by construction rather than by anybody checking. `stopPropagation`
and not `stopImmediatePropagation`: the other panels' listeners are on the same
node and are harmless (each checks its own `open`), and silencing them would
make the fix depend on registration order — which is the thing that made this
hard to see in the first place.

The `isModalOpen()` guard in both scenes stayed as the second line. It is
redundant while every panel consumes correctly, and it is what catches the next
panel that forgets to.

**BUG-12 is closed by closing everything, not the world-anchored ones.**
`hud.closePanels()` runs from `setInsideHouse`, which fires in both directions.
Curating "which panels belong to which scene" is a second thing to keep in step;
the panels that are *not* world-anchored are ones a player reopens from the bar
with one click. **Losing a panel across a scene change costs a click. Keeping
the wrong one open costs trust.**

**Verified in the browser, the audit's own repro.** Chest open on the farm →
walk indoors → chest closed. Bag open indoors → one Escape closes the bag and
**stays in the house** → a second Escape leaves. Before this, the first Escape
did both.

---

### T-18.14 — A dead Buy button says why  ✅ **DONE**

Depends: — · Size: S · Closes BUG-13
Files: `apps/client/src/game/shopPanel.ts`, `shopPanel.test.ts` (new),
`apps/client/src/game/hud.ts`, `scenes/Farm.ts`,
`apps/client/src/styles/hud.css`

With 100g, Shop → Animals showed two dead BUY buttons with no `title`, no
inline reason and no styling separating "cannot afford" from "coop full".

**How it turned out.**

**A disabled button with no explanation is worse than an enabled one that
fails**, because a failure at least tells you something. Two causes were being
collapsed into one dead control, and they have nothing in common: more gold
fixes one and nothing the player can do today fixes the other.

**The capacity is named first, and that ordering is the decision.** A full coop
is not fixed by earning gold, so quoting the price when the price is not the
problem sends someone off to sell crops for an hour to buy a chicken they still
cannot house. `purchaseBlocker` is pure and exported so every row asks the
question the same way and the wording is testable without a panel.

**It names the shortfall, not the price.** The player can already see the price;
what they cannot see is how far off they are, which is the number that decides
whether to go and sell something or forget it for today. `need 1,900g more`.

**The animal row was not checking capacity at all** — only gold — so a full coop
produced an enabled button and a server refusal. It now reads the same
`buildingCap` the server buys against (§4.4), which needed the herd count
threading through: the farm poll already carries the animals, so
`hud.setBuildings` counts them rather than anything fetching a second time.

**The CSS had the same shape of bug as the copy.** `.shoprow.is-disabled` set
`opacity: 0.45` on the ROW, and opacity on a parent cannot be undone by a child
— so the one part that has to stay readable was the one part guaranteed to be
greyed. The fade moved to the leaves (icon, name, quantity, button), leaving the
price line at full strength with the reason in a warm red.

**Verified in the browser with the audit's exact repro.** At 100g: *Chicken —
`coop full — 4/4`*, *Cow — `need 1,900g more`*. The chicken row proves the
ordering: gold is short there too, and the coop is what it says.

---

### T-18.15 — Upgrade labels name what the money buys  ✅ **DONE**

Depends: T-18.14 · Size: S · Closes BUG-14
Files: `apps/client/src/game/shopPanel.ts`, `shopPanel.test.ts`

"Bigger coop — holds 4 chickens now · 4,000g" puts the CURRENT capacity beside
the price of the NEXT one.

**How it turned out.**

**Both numbers were true and the sentence was not**, which is why it survived: a
tier-0 coop really does hold 4 and 4,000g really is the price. A reader joins
them into "4,000g buys a 4-chicken coop" — wrong, and wrong in the direction
that costs them money. `upgradeLabel` states the thing being bought:
`holds 4 → 8 chickens · 4,000g`.

The next capacity comes from the same shared tables the server buys from —
`buildingCap(building, tier + 1, …)` and `BACKPACK_TIERS` — never a local
formula, so the row cannot promise a jump the purchase does not deliver (§4.4).
The tests assert the label against those tables rather than against literals, so
a re-tuned coop re-tunes the assertion with it.

**Verified in the browser:** `12 → 24 slots · 2,000g`, `holds 4 → 8 chickens ·
4,000g`, `holds 2 → 4 cows · 10,000g`.

---

### T-18.16 — A thirsty crop says so  ✅ **DONE**

Depends: — · Size: S · Closes F-2
Files: `apps/client/src/game/plots.ts`, `plots.test.ts`,
`apps/client/src/game/scenes/Farm.ts`, `hud.ts`,
`apps/client/src/styles/hud.css`

D-1 made the whole farming loop turn on watering — a dry crop pauses forever —
and the only signal was the hover countdown reading `DRY · …`.

**Done:**
- [x] A watering-can badge over every paused plot
- [x] A `N thirsty` count in the HUD bar, hidden at zero
- [x] Break-tested; verified in the browser with two dry plots and one wet

**How it turned out.**

**This is the worst class of bug the game can have: it looks broken and the fix
is one keypress away.** A player who does not hover never learns that watering
is a requirement at all — they plant, wait, come back, and nothing has changed.
Every other unhelpful state in this audit costs a player some confusion; this
one costs them the mechanic.

**The soil tone was already there and was never going to be enough.** `drawSoil`
has swapped dry and wet sprites since T-9.04, and the audit's recommendation was
"a persistent visual on dry planted soil (the wet/dry sprites exist)". They
exist and they are drawn — but a *planted* tile is mostly covered by its crop
sprite, so the difference between wet and dry is a few pixels around the edge of
the thing you are actually looking at. The state that needs announcing is
exactly the state where the existing signal is most hidden.

**The badge shows the watering can, and that is the whole design.** Not a
droplet, not a warning triangle. The badge's job is not "something is wrong
here" — the player can see the crop is not growing — it is **"bring THIS"**, and
what it shows is the icon already sitting in their hotbar. It mirrors
`badgeFor` in `animalSprites.ts` deliberately: a plot that needs attention
should announce it the way an animal already does.

It is drawn ABOVE the crop rather than in the plot's decal container, which is
the same reasoning: a marker the plant grows over would fail at precisely the
stage where the crop is big enough to hide its own soil.

**The count is the half a badge cannot do.** A badge tells you about a plot you
are already looking at; the farm is thirty tiles across, and the question a
returning player has is "is there anything to do at all". It is **hidden at
zero** rather than showing `0 thirsty`: a farm with nothing to do should say
nothing, or the one number in the bar that means "go and act" is on screen
permanently and stops meaning it.

**Counted on the client, not sent by the server**, and that is not laziness:
"paused" is a function of `wetUntil` and the clock, which the client already
interpolates forward between polls (`displayAt`). A count measured at the poll
would be a whole interval stale at exactly the moment it changes — the moment
the water runs out. A test pins that: the same poll, read ten seconds later,
turns a plot thirsty with no new request.

**Building the fixture taught me the growth model.** Two attempts produced ripe
crops instead of dry ones, because backdating `watered_at` makes a plot **more**
grown, not less — the wet window RUNS from that stamp, so a stamp six hours ago
banks four full hours of growth (`WATER_DURATION_MS`) and then closes. A
part-grown-and-dry plot needs a crop longer than the window. Worth writing down:
the intuition "older watering means drier" is backwards, and the model is right.

**Verified in the browser:** two watering cans floating over the dry plots, none
over the watered one beside them, and `2 thirsty` in the bar.

---

### T-18.17 — The game names its own action key  ✅ **DONE**

Depends: — · Size: M · Closes F-5, and T-14.10 from the v1 backlog
Files: `apps/client/src/game/onboarding.ts` (new), `onboarding.test.ts` (new),
`apps/client/src/game/hud.ts`, `scenes/Farm.ts`,
`apps/client/src/styles/hud.css`

"There is no tutorial or first-run guidance. The action key is never named. A
new player is dropped onto a farm with a hoe and no prompt."

**Done:**
- [x] One line above the hotbar saying what to do next, always true
- [x] Every sentence names a key
- [x] Nothing persisted — it is derived, and it retires itself
- [x] Walked through the whole loop in the browser

**How it turned out.**

**Nothing is persisted, and that is the design rather than a shortcut.** A
scripted tutorial needs a cursor — "step 3 of 5" — which needs storage, which
needs to survive a reload, a second device, and a player who does things out of
order. Deriving the step from the farm the server already sends means the hint
is always *true*: it says "water" because something is dry, not because a
counter thinks the player has not been told about watering yet. Skip a step, do
them backwards, come back a week later, and it still says the right thing.
There is no state to migrate, reset, or get wrong.

**It retires itself with no checkbox.** One harvest is the whole loop — till,
plant, water, pick — so once any plot has `harvestedAt` the hint stops
appearing. No "don't show this again", and nothing ever stored the fact that
they ticked it.

**Ordered by what the farm needs, not by what a script would say next.** A ripe
crop outranks dry soil which outranks bare ground. A player who somehow reached
a ripe crop without ever seeing the "till" line should be told to pick it, not
sent back to the beginning — and that falls out of the ordering rather than
needing a special case.

**Every line names a key**, which is the whole of F-5. The player is not short
of motivation, they are short of the fact that `E` exists; a sentence that does
not name a key is flavour, not onboarding. A test asserts it for all five,
because "improve the copy" is exactly the change that would quietly drop the one
word that mattered.

**A fifth step nobody asked for, because the four leave a dead end.** Told to
plant with no seeds is unactionable, and a new farm reaches it by sowing all
four leeks and both potatoes before harvesting anything. `buy_seeds` points at
the merchant.

**Decided in the HUD, not the scene**, because the answer needs the plots (farm
poll) and the bag (inventory poll) and the HUD is the only object holding both.
Asking from the scene would have meant a second copy of the slots existing
purely to be read once.

**Two things this turned up.** `displayAt` deliberately ignores `plantedAt` —
growth stopped being wall-clock time when D-1 made it depend on watering — so my
first "ripe" test fixture backdated a plant date and produced nothing. And the
client keeps its own `InventorySlot` with `slotIndex` where the shared type has
`index`, which §10 says should not exist; `onboarding.ts` asks for a structural
`{itemId, quantity}` so it works with either, and the duplication is filed as
**T-18.26** rather than untangled inside an onboarding task.

**Verified in the browser**, driven through the whole loop on a one-plot farm:
bare → *"Walk with WASD. Face a plot and press E to break the soil with your
hoe."* → tilled → *"Pick seeds from the hotbar with the number keys…"* →
planted and dry → *"Crops only grow while the soil is wet — take the watering
can and press E."* → harvested → **hidden**.

---

### T-18.18 — Early progression: the facts, then the decision  ✅ **DONE** (opens D-18)

Depends: T-18.17 · Size: M · Closes F-1 as a *finding*; the balance call is D-18
Files: `apps/client/src/game/onboarding.ts`, `onboarding.test.ts`,
`docs/economy.md`, the Open Decisions table

"A new player has 500g. A chicken costs 400g and takes 12 hours to mature.
Buying one leaves 100g… three crops growing, one baby chicken, 100 gold and
nothing to do."

**How it turned out.**

**The economy is not broken, and I nearly "fixed" it.** The four crops read as
though two of them lose money — a strawberry seed is 100g and a strawberry sells
for 95g; an onion seed is 160g and an onion sells for 110g. Both are fine,
because `yieldAmount` is 2 and 3. The real curve is **20.0, 20.0, 22.5, 21.3
g/hr**, deliberately flat so the choice is about how often you can check in
rather than which crop is correct. `docs/economy.md` already says exactly that,
and `config.test.ts` already refuses a crop that sells for less than its seed.
Checking `yieldAmount` before touching a price is the whole lesson here.

**Two of F-1's facts are wrong, and the code says so.** `newFarmPlots()` creates
every plot **empty and untilled** — nothing is pre-planted, so "three already
have crops" was the auditor's own play state. And a new player holds **500g**;
100g is what remains *after* choosing to buy a chicken, which is a choice better
taken at 0:45 with 640g than at 0:00.

**What is real is a 42-minute hole at 0:03.** Six plots, six starting seeds,
tilled and planted and watered in about three minutes — then nothing until the
first leek at 0:45. `docs/economy.md` now carries that timeline minute by
minute, which the ledger had never had: it modelled rates per hour and never
asked what the first hour actually feels like.

**And that hole is §1 working.** "Idle-first… sessions are short and frequent,
not long and grindy." A first-timer standing on a fully planted farm with
nothing happening has not hit a dead end, they have hit the design — and
**nothing anywhere told them so**. T-18.17's onboarding gained a sixth step for
exactly that moment: *"All planted. Crops keep growing while you are away —
close the tab, or press Idle to let your farmer work."* It is the one moment
worth a sentence, because it is the moment a player would otherwise close the
tab believing the game is broken rather than believing it is idle.

**The rest is a balance decision and I did not take it.** §14 is explicit:
*"Track these; do not let them be silently decided in code."* The audit's three
suggestions — a fast starter crop, a mature starting hen, a first-harvest
reward — are each a real product choice with a real cost, and two of them are
new gold faucets that `docs/economy.md` would have to log. They are recorded as
**D-18** with those costs and a recommendation (**a fast starter crop, or
nothing** — the other two add gold to fix a problem that is not about gold),
for the owner of the game to settle rather than for a task about the first
hour to assume.

---

### T-18.19 — Sound, synthesised  ✅ **DONE**

Depends: T-18.10 · Size: L · Closes T-14.09
Files: `apps/client/src/game/audio.ts` (new), `audio.test.ts` (new),
`apps/client/src/game/sound.ts` (new), `scenes/Farm.ts`, `hud.ts`

"There is not one audio file in the repo."

**Done:**
- [x] Eight cues: till, water, harvest, plant, collect, buy, refused, open
- [x] Wired to the same `Swing` value the particles use, replay included
- [x] A mute toggle in the bar, remembered per device
- [x] No audio context until the player acts; never throws

**How it turned out.**

**There is no honest way to add an audio FILE, so there are none.** §9 says every
asset comes from the licensed pack, and that pack is art: searching
`new_assets/` for `.wav`, `.mp3`, `.ogg`, `.m4a` and `.flac` returns **zero**
files, and the whole repo returns zero. Sourcing audio elsewhere is a licensing
and procurement decision — the same class of decision D-18 was left open for,
and not one a task about sound effects takes on the owner's behalf.

So the cues are **synthesised**: an oscillator, an envelope, and a burst of
filtered noise for the two that need texture. That is not a stopgap. Short
synthesised blips are what this genre sounds like, they add no manifest entry
and therefore no `firstgid` shift (T-7.09, T-8.03), they cost nothing to ship,
and there is nobody to credit.

**Split pure table from thin player**, exactly as `effects.ts` is split from
`Farm.playBurst`, and for a sharper reason here: node has no `AudioContext` at
all, so the numbers are the only part that *can* be tested. What is asserted is
what actually goes wrong — every cue is under 250ms (they fire on a keypress,
and six plots in fifteen seconds turns anything with a tail into a drone), the
gains of simultaneous voices sum below clipping, and noise is always filtered.

**Keyed on `Swing`, so sound and particles cannot diverge.** The same value that
picks the burst picks the cue, which means the idle farmer got audio for free —
it already asks `swingForKind`. A test asserts the pairing both ways, including
the two cues that deliberately have **no** burst: planting a seed and kneeling
at a chicken are gentle actions where a spray of debris would read as damage.

**One cue, one place, for refusals.** `hud.toast(..., 'error')` is where every
refusal in the game arrives, so that is where `refused` plays. The alternative
is a `playCue` beside forty call sites, and the fortieth is the one that gets
forgotten.

**Mute is a device setting, not an account one.** Someone playing on a laptop in
an office and a phone at home wants different answers, so it lives in
`localStorage` and never reaches the server — it decides nothing about the farm
(§4.1). `readMuted` swallows the `localStorage` throw private-mode Safari
raises, defaulting to *unmuted*: a game that silently refuses to make sound is
harder to diagnose than one that makes it.

**Verified by instrumenting the audio graph rather than by listening.** Hooking
`AudioContext` before boot and counting nodes: three cues produce **5
oscillators and 2 buffers**, which is exactly what the table specifies (till =
noise + triangle, water = noise + sine, buy = three squares). Muting produces
**zero** new nodes on the next action; unmuting resumes.

**Worth recording: the one context present at boot is PHASER'S**, not this
module's — `WebAudioSoundManager2.createAudioContext`, created eagerly whether
the game uses sound or not. A first pass at verification blamed my own lazy
creation for it. `sound.ts` still makes its own rather than borrowing Phaser's,
which keeps it Phaser-free and testable; two contexts is well inside every
browser's limit.

---

### T-18.20 — VIP can be bought  ✅ **DONE**

Depends: — · Size: M · Closes BUG-18, and T-14.02 from the v1 backlog
Files: `apps/client/src/net/vip.ts` (new), `vip.test.ts` (new),
`apps/client/src/game/hud.ts`, `scenes/Preload.ts`,
`apps/client/src/styles/hud.css`

`POST /api/vip/checkout` had **no client caller anywhere** — no `net/vip.ts`, no
button, no mention of Stripe in `apps/client/src`. The product's only revenue
mechanism was unreachable from the product.

**Done:**
- [x] A VIP button in the bar, hidden once the SERVER says the account has it
- [x] `startVipCheckout()` → Stripe-hosted URL → full navigation
- [x] `?vip=success` says what actually happened and grants nothing
- [x] `vip-stripe` skill loaded before touching any of it (§7)

**How it turned out.**

**The server half was already right, and this task did not touch it.**
`createCheckoutSession` has been correct since T-5.02: `mode: 'payment'` and
never Billing, price from `STRIPE_VIP_PRICE_ID` and never the repo, eligibility
re-derived through `isVipActive`, `metadata.playerId` for the webhook, idempotency
key, rate limit. What was missing was a button.

**The client half is deliberately tiny, and that is the security property.** Its
whole job is *ask, then go where you are sent*. No response to
`startVipCheckout` can make anyone VIP — fulfilment happens only in the
signature-verified `checkout.session.completed` webhook — so there is nothing to
get wrong by changing what this file is passed.

**`?vip=success` means Stripe took the money, NOT that the account is VIP.**
Those are two events with a webhook between them, the webhook can land after the
browser does, and **anyone can type the query into the address bar**. So the
return handler picks a sentence and nothing else: *"Payment received — VIP will
switch on in a moment."* The grant arrives, if it arrives, on the ordinary poll.
`vipReturnFrom` is pure and tested for exactly this — including that its entire
output is a three-value enum with no grant in it.

**Its own button, not a shop tab.** The shop trades game gold; this trades real
money, and putting them side by side is the blurring §7's RMT hygiene exists to
avoid. Different colour for the same reason.

**Two bugs the browser found that the tests could not.** The first request went
to **`/api/api/vip/checkout`** — `api.post` already prefixes `/api`, and every
other net module passes a bare path. It surfaced as *"That is not on your farm"*,
a 404 wearing a farm error's clothes. The second was my own verification: the
`?vip=success` toast looked missing until I stopped waiting 4.5 seconds to read a
toast that fades in three.

**The demonstration that matters, in two lines of output.** With
`?vip=success` on the URL the VIP button is **still visible** — the client did
not grant anything. With a real `vip_until` in the database it **hides**. The
redirect cannot fake what the webhook decides.

**What is NOT verified, and cannot be here.** Clicking VIP in this environment
returns `INTERNAL` because `STRIPE_VIP_PRICE_ID` is unset — which is the
service's own deliberate branch for a misconfigured deployment, so the path is
proven end to end up to Stripe's door. Completing a real checkout needs a Stripe
test key, which is a deployment secret and not something to invent. The webhook
side already has integration tests for valid signature, invalid signature,
duplicate delivery and refund (T-5.03, `webhook.integration.test.ts`).

---

### T-18.21 — The trade UI was broken, not merely unwired  ✅ **DONE**

Depends: — · Size: S/M · Closes BUG-17; T-14.03 stays a Phase 14 item
Files: `packages/shared/src/types/index.ts`,
`apps/server/src/modules/trade/{lifecycle,service}.ts`,
`apps/client/src/net/trade.ts`, `trade.test.ts` (new),
`apps/client/src/game/tradePanel.ts`

"`tradePanel.ts` is 21 KB of unreachable code… it typechecks and will never
run, so any drift from the server contract is invisible. Either wire it up
(T-14.03) or move it out of the build."

**How it turned out.**

**It had already drifted, and the drift was fatal.** `TradeStatus` was declared
**four** times: in `packages/shared/src/types` (which *nothing imported*), in
the server's `lifecycle.ts`, in the `trades` table, and in
`apps/client/src/net/trade.ts`. The first three agree on
`'pending' | 'open' | …`. The client's said `'PENDING' | 'ACTIVE' | …`, and
`tradePanel.ts` branches on `status === 'ACTIVE'` and `case 'PENDING'`.

**Not one of those comparisons could ever be true.** Wire the panel up as it
stood and it would render "waiting for a reply" forever, never enable the offer
controls, and never notice a completed trade. That settles the audit's
either/or: *"wire it up"* was never size M, because what is there does not work.

`ACTIVE` is a **synonym** for `open`, which is why it survived review and failed
at runtime. The client's copy was written from the idea of the API rather than
from the API.

**Neither wired up nor deleted, and both for recorded reasons.** The
`trading-system` skill and T-11.05 both record that hiding the UI was
deliberate and that re-enabling is a Phase 14 item — so deleting contradicts a
decision already taken, and re-enabling takes one that is not mine. What T-18.21
fixes is the harm the audit actually named: **the drift, and its invisibility.**

- `TradeView`, `TradeSide`, `TradeOfferItem` and `TradeStatus` now live once in
  `packages/shared` and are imported by both sides (§10). `TradeView` had been
  written out by hand in the server's `service.ts` *and* the client's
  `net/trade.ts` — two hand-kept copies of a wire contract is the mechanism that
  produced this.
- The moment the client imported the real type, **tsc listed all six dead
  comparisons**. They are fixed.
- A test pins the status VALUES, not just the shape — a rename would not have
  caught this, and the strings are what the database stores and what six server
  integration test files assert against.

**Left standing on purpose:** the panel still has no importer, and T-14.03 still
owns the decision to give it one. It is now dead code that would *work* if
switched on, which is a materially different thing from dead code that would
not.

---

### T-18.22 — The creator gets the screen to itself  ✅ **DONE**

Depends: — · Size: S · Closes BUG-15
Files: `apps/client/src/styles/hud.css`,
`apps/client/src/game/characterCreator.ts`

"At 1440x900 the creator's panel is drawn under the gold counter and the BAG
button, which are clipped behind it."

**How it turned out.**

**Measuring found two faults where the audit reported one.** At **1440x900** the
card clears the bar geometrically (card top 83, bar bottom 71) — what covers the
bar is the overlay's own **82%-opaque scrim**, which spans the full viewport.
`elementFromPoint` at the bar's centre returns `creator`, so the gold counter
and the Bag button were legible enough to look broken and too dim to use. At
**1280x720** it is worse and different: the card measures **top 30 against a bar
ending at 58** — a real 28px overlap.

Both go away by taking the audit's first option. The creator is a **mandatory
modal with no close button**, so nothing in the bar applies to a player who is
in it; the bar and the hotbar now step aside while it is up.

**`visibility: hidden`, and NOT `display: none`.** `hud.barHeight()` measures the
bar with `getBoundingClientRect()` to tell the camera how much viewport the
chrome eats (T-18.03), and `display: none` collapses that box to zero — the farm
would have quietly refit itself larger behind the creator and been wrong at the
next `fitCamera`. Verified after the change: `barHeightStillMeasured` is 71 and
58 at the two viewports, unchanged, while both elements compute to
`visibility: hidden`.

**A third thing was checked and deliberately left alone.** The screenshot shows
the CLOTHES row cut off at 1280x720, which looks like a bug and is not:
`.creator__rows` is a scroll container with `max-height: min(70vh, 620px)` and a
comment saying the scroll is the small-window fallback. Measured rather than
assumed — at 1440x900 the rows do **not** scroll (client 579 = scroll 579, all
six rows fit); at 1280x720 they do (client 504, scroll 579), and scrolling to
the bottom leaves the Clothes row **fully visible**. Raising the cap would trade
that scroll for a scroll on the overlay instead. It works, it is documented, and
the audit did not report it.

---

### T-18.23 — The HUD fits; mobile becomes a decision  ✅ **DONE** (opens D-19)

Depends: — · Size: L · Closes BUG-05's layout half; the input half is D-19
Files: `apps/client/src/styles/hud.css`, `apps/client/src/game/hud.ts`,
the Open Decisions table

"Unplayable below ~1000px wide… `DECORATE`, `IDLE` and `LOG OUT` are off screen
and unreachable… There is no touch input of any kind. **Mobile may be
deliberately out of scope, but nothing in `ROADMAP.md` says so either way.**"

**How it turned out.**

**Two problems were wearing one bug number, and only one of them is about
mobile.** The HUD bar was `display: flex` with no wrap, so it needed **842px of
content** whatever the viewport gave it. At 390px that puts *Bag, Decorate,
Idle, VIP, Sound* and *Log out* off the edge — including the only way to log
out — and it overflowed a **768px tablet** too. A bar that does not fit its own
viewport at sizes a laptop window reaches is not a mobile question; it wraps
now, and `hud.barHeight()` measures the element rather than assuming, so the
camera reserves the taller bar with no other change (T-18.03).

Measured after: nothing off screen at 390, 768, 800 or 1366, and the bar is one
row on a laptop, two at 800px, three on a phone.

**The other half is structural and is not mine to decide.** `bindKeys` drives
movement, `E`/`Space` act, the number keys pick a hotbar slot, and the **single**
`POINTER_DOWN` handler in the entire client buys a plot. On a touch device the
character cannot be moved at all. Supporting mobile means designing a new input
mode — and it has to answer §5.1's rule that actions happen on the tile the
character FACES, which tap-to-move does not obviously respect. That is D-19.

**Recorded rather than assumed, because the product already disagrees with
itself.** `index.html` markets *"plant before work, harvest at lunch"*, which
invites precisely the device that cannot play. Writing "out of scope" into the
roadmap would have contradicted the landing page in the same commit.

**What the game says in the meantime is a fact, not a policy.** A coarse-pointer
narrow viewport gets *"Tillhaven needs a keyboard — WASD to walk, E to act."*
That is true under either answer to D-19, it stops a player concluding the game
is broken, and it is one CSS rule to delete if touch controls ever arrive.

**The discrimination is pointer, not width**, which the measurement confirms:
an 800px-wide **desktop window with a mouse** does not see the notice, while a
768px **tablet** does. Width alone would have lectured someone who had simply
made their browser narrow.

---

### T-18.25 — A house with something in it  ✅ **DONE**

Depends: T-18.08, T-18.11 · Size: S · Closes the rest of G-5
Files: `packages/shared/src/config/furniture.ts`,
`apps/server/src/modules/auth/service.ts`,
`apps/server/src/modules/house/reachability.test.ts`,
`house.integration.test.ts`

T-18.11 fixed the floor so the room stopped reading as *unfinished*. It was
still empty.

**How it turned out.**

**I filed this task myself with a worry that did not survive checking.** The
T-18.11 note called a starter grant "a new faucet §5.8 requires documenting" and
flagged that furniture is `tradeable`. Both true, neither decisive:

- §5.8 and `docs.test.ts` guard **gold**. This writes `furniture_placements`;
  no gold moves and no gold-writing file is added.
- `STARTING_ITEMS` already hands every new account **six tradeable seeds** and
  two tools. A one-off cosmetic grant is the same class of thing the project
  already ships — the precedent was sitting next to the concern the whole time.

Worth recording as a pattern: the hesitation was reasonable, and checking what
the codebase already does settled it in two greps. Escalating it would have been
the wrong call.

**Placed, not banked.** Four rows go into `furniture_placements` and **none**
into `furniture_owned`. Conservation stays exact — removing a starter piece
returns it to storage like any other — where granting both would let a player
remove one and end up owning two. Verified on a real registration: **4 placed
rows, 0 owned**.

**The layout is validated where nothing else would.** Registration does not go
through `placeFurniture`, so it never runs `assertPlaceable` — a starter room
that sealed the doorway would ship to **every account that ever existed** rather
than to one player who made a mistake. `reachability.test.ts` now runs
`checkInteriorReachable` over `STARTING_FURNITURE`, plus fits-in-room,
no-overlap, and a cap so a future rearrangement cannot fill the room the
Decorate tray exists to be used on.

**Twenty-two house tests broke, and they were right to.** They all assumed
`GET /api/house` starts empty — precisely the fact this changes. The
`beforeEach` now clears the starter room so each test's subject stays the rule
it is testing, and the starter room is asserted in its own test against a fresh
client whose cleanup has not run.

**Found while verifying, filed not fixed: the character is invisible indoors on
a new account.** `Interior.player` reports `ready: false` and zero visible
layers, so only the shadow draws — and it is **not** a poll race, because it
stays broken after `state.player.appearance` arrives. That is a
character-rendering bug that happens to be visible from a furniture task;
folding it in would have made neither change reviewable. **T-18.27**, with the
measurements and a hypothesis.

---

### T-18.26 — One `InventorySlot`  ✅ **DONE**

Depends: — · Size: S
Files: `packages/shared/src/types/index.ts`,
`apps/server/src/modules/inventory/service.ts`,
`apps/client/src/net/inventory.ts`, `inventory.test.ts` (new),
`apps/client/src/game/onboarding.ts`

The client declared its own `InventorySlot` beside the shared one. §10: a shared
type is defined once and imported.

**How it turned out.**

**Three declarations, and the wrong one was the one nobody used.** The server
selects `slotIndex`, the client's `net/inventory.ts` declared `slotIndex`, and
`packages/shared` declared **`index`** — with **zero importers**. The copy that
disagreed with the wire was the copy that was never exercised, which is exactly
why it survived: nothing could fail. The same shape as T-18.21's trade drift, on
a smaller blast radius only because nobody had reached for it yet.

Shared now carries `slotIndex` and both sides import it. `SlotRef` went the same
way — a hand-written client copy that happened to agree, re-exported from the
**schema**, which is what the server actually parses the request against.

**A near-miss worth recording.** Writing the test I "found" a third
inconsistency: the move schema names the field `slot`, not `slotIndex`. It is
not an inconsistency — a slot **row** the server sends back and a slot
**reference** the client sends are different DTOs, and `{container, slot}` reads
correctly. Two tests now pin that on purpose, including one asserting the schema
**refuses** a row where a reference belongs, so the next person does not
"fix" them into agreement.

**Break-tested by renaming the field back:** `slotIndex` → `index` in shared now
produces **7 compile errors** across both apps. That is a better guard than any
test — the drift that took this long to notice is no longer expressible.

**Found while running the suite, filed not fixed: `POST /api/house/place` can
be raced into stacking two pieces on one cell.** Its own test caught it,
intermittently, with *both* requests returning 200 — see **T-18.28**, which is
the most serious thing in this phase's remaining list and which `modules/decor`
shares.

---

### T-18.28 — `FOR UPDATE` cannot lock a row that is not there  ✅ **DONE**

Depends: — · Size: M
Files: `apps/server/src/modules/house/service.ts`,
`apps/server/src/modules/decor/service.ts`,
`house.integration.test.ts`, `decor.integration.test.ts`

Found while running the suite during T-18.26: `house.integration.test.ts`'s own
*"cannot be raced into stacking two pieces on one cell"* failed intermittently
with **both** requests returning 200.

**How it turned out.**

**The test was right and the code was wrong.** `placeFurniture` locks with
`SELECT … FROM furniture_placements WHERE player_id = ? FOR UPDATE`, and
**`FOR UPDATE` locks the rows it RETURNS**. An empty room returns none, so it
locks nothing: two concurrent placements both read "that cell is free", both
pass `assertPlaceable`, and both insert. A **phantom**, not a lost update —
which is exactly why row locks on the placements were never going to help, and
why it only bites when the room is empty or the pieces are elsewhere.

Both mutating paths in both modules now take a lock on the **player row** first,
before any read the decision rests on. That is the tool `trade/service.ts`'s
`lockPlayers` already uses to serialise two parties, applied to one: lock
something that always exists, so there is always something to queue on. A lock
taken *after* the read it protects protects nothing.

**`modules/decor` had the identical hole and is fixed in the same change.** Its
own header records that it copied the house module's `.for('update')` shape
deliberately (D-11) — so it inherited the bug with the shape. Fixing one of two
identical paths is how the other gets forgotten.

**I could not build a test that fails on the broken code, and the tests say
so.** This is the uncomfortable part and it is written into both test files
rather than papered over:

- The original two-request version caught it **twice in about six full-suite
  runs**, which is the worst possible frequency — real, and rare enough to read
  as a flake.
- Raising it to **eight concurrent requests changed nothing**: with the fix
  removed, three full server runs passed **890/890**.
- Forcing the interleaving explicitly — transaction A places and is held open
  uncommitted while B attempts the same cell — **also passed without the fix**,
  with B correctly refused (`PLOT_OCCUPIED`, one row). The pool is `max: 10`, so
  the two genuinely had separate connections; whatever serialises them is below
  this layer.

That forced test was **deleted rather than kept green**. This project's standard
is that a test which cannot fail is not evidence, and one sitting in the suite
looking like a concurrency guard would be worse than the gap it hides. What is
left in both files is an honest smoke test with a comment naming exactly what it
does and does not prove.

**So the fix rests on inspection plus two observed failures, not on a red
test**, and that is stated rather than implied. It is cheap (one extra locked
row per placement), it is the pattern the repo already uses for its
highest-risk system, and §4.3 requires the invariant it restores. Leaving a
known phantom in a mutation path because it is hard to reproduce is not a
trade this project makes.

---

### T-18.27 — The character nobody could see indoors  ✅ **DONE**

Depends: — · Size: M
Files: `apps/client/src/game/hud.ts`,
`apps/client/src/game/scenes/Interior.ts`

Found while verifying T-18.25: register, dismiss the creator, walk through the
front door — and only a shadow arrives. `Interior.player` reported
`ready: false` with **zero visible layers**.

**How it turned out.**

**Two faults compounding, and the second was a comment asserting something
untrue.**

1. `Farm.enterHouse()` hands over `this.state?.player.appearance`, which comes
   from the farm **poll**. On a brand-new account the poll that has landed
   predates the character creator's save, so the hand-over is `null` — and
   `init` guards with `if (data?.appearance)`, so null leaves the field null.
   The poll is 20 seconds; walking to the door takes about five.
2. The WAKE handler said *"`init` runs again on wake with the Farm's latest
   data"*. **It does not.** `scene.run` on a sleeping scene wakes it; `init`
   runs on START only. So the null handed over at first entry was the only
   value this scene would ever see, and no later poll could repair it — which
   is why the measurement showed it still broken *after* the appearance had
   arrived, and why calling it a race would have been wrong.

**The fix is to ask rather than be told.** The HUD already holds the server's
last word, written by the poll **and synchronously by the creator's `onSaved`**,
so it is right in both orderings. `Interior.currentAppearance()` prefers it and
keeps the handed-over value as a fallback, so T-16.15's contract still holds if
the HUD has not mounted. The Farm needs no change — it subscribes via
`hud.onAppearance` and always did.

**Measured before and after, on a real registration walked through the door:**

| | before | after |
|---|---|---|
| indoors, before a poll | `ready: false`, **0 layers** | `ready: true`, **4 layers** |
| indoors, after a poll | `ready: false`, **0 layers** | `ready: true`, **4 layers** |

The probe also reports `statePlayerAppearance: "null"` in the fixed
before-a-poll row, which is the point: it works *because* it no longer depends
on the poll. Break-tested by reverting `currentAppearance()` to the handed-over
value alone — both rows go straight back to zero layers.

**Noted, not fixed:** `hud.onAppearance` stores a **single** listener, so a
second subscriber would silently replace the Farm's. Nothing does that today —
this task deliberately pulls instead of subscribing, partly for that reason —
but an `onX` registration that quietly discards the previous handler is a trap
worth knowing about before something else reaches for it.

---

### The rest

T-18.09 through T-18.28 have their own entries above, written up like every
other task once they turned out to be more than a table row. The originals are
specified in `docs/qa-audit-2026-09-03.md` §I (Phases 2–5) with severity, size
and the bug ID each closes.

Everything the audit listed is now done. T-18.27 and T-18.28 were found *while*
working through it — one by walking into a house, one by reading a test failure
that had been passing for "flaky" — and both have entries above.

**Explicitly not scheduled: performance.** Measured at 61fps, 53 display
objects, 34.5MB heap, no leak across 10 scene transitions, 9 API calls per
minute. There is nothing to optimise, and optimising on spec would only add
risk. Re-measure after T-18.09 and T-18.10 actually add draw work.

---

# Phase 19 — the ground

## Open work found by the QA brief of 2026-09-04

The brief asked for two things and named a third as the symptom: object-bounds
collision, soil visuals synchronised with gameplay state, and *"fix the ground;
when you place another sprite, it doesn't seem to join up correctly."*

**Object-bounds collision was already done and is not a task here.**
`OBJ_COLLISION_BASE` (`packages/shared/src/config/collision.ts:81`) holds a
*measured* pixel footing per object, and `objectFootprint()` turns anchor + base
into tiles rounded outward — the maple blocks its 12px trunk, not its 32px cell;
the mailbox blocks a 10px post. T-18.05 added `objectFootings()` /
`solidObjectTiles()` and a generator assertion that no object footing may sit on
a drawn path. Verified before planning, then left alone.

### T-19.01 — Soil that joins up  ✅ **DONE**

Depends: — · Size: L
Files: `scripts/draw-ground-tiles.py`, `scripts/prepare-assets.mjs`,
`original-assets/ground/soil-tiles.png`, `packages/shared/src/config/assets.ts`,
`apps/client/src/game/plots.ts`, `apps/client/src/game/plots.test.ts`,
`apps/client/src/game/scenes/Farm.ts`,
`apps/client/public/tilemaps/farm.json`

**How it turned out.**

**Two faults, and the first one caused the second.**

**Fault 1 — `tileset-soil` is not a nine-slice, so it cannot tile.** The field
in `farm.json` had been hand-painted with a textbook 3x3 nine-slice out of cols
1–3 (frames 1/2/3, 25/26/27, 49/50/51), which is exactly what you would do if
the sheet were terrain art. It is not. Every cell is a self-contained rounded
clod with dark `#9d4c46`/`#6e3539` outline pixels in **all four corners** —
frame 26, the supposed centre, carries two outline pixels in each corner. Butt
four together and eight dark pixels meet at every 16px intersection. Measured:
**all 31 internal seams of that arrangement carry outline pixels.** That is the
dot grid.

Two further checks agree that it is stamp art: **14 distinct quadrant images**
per corner position where a real autotile set has about five, and exactly **one
tile in 48** with all four edges flush.

T-7.05 reached this conclusion once already. What invited a second attempt is
that the `TILESET_SOIL` note in `assets.ts` still said *"autotile blocks"* — so
the stale comment is part of the root cause, and rewriting it with the
measurement is part of the fix.

**Fault 2 — the map then disagreed with the runtime.** Soil is server state
drawn per plot (T-9.04). With soil *also* baked into the map, every plot looked
tilled before being touched, a hoed plot's flat `#be6d47` square exactly covered
the clod art (two different soil looks side by side), and
`farmMap.test.ts`'s *"the ground layer resolves cleanly"* was **failing** —
`tileset-soil` was back on the ground layer. `farm.json` is regenerated from
`generate-farm.ts` (D-13), which paints grass on `fieldTiles()`, so the field is
grass again and soil appears only where the hoe has been.

**The real fix: synthesise the edges, because nothing in the pack can supply
them.** `draw-ground-tiles.py` already synthesises the flat ground fills for
this exact reason, and now also writes
`original-assets/ground/soil-tiles.png` — **256x32, 16 mask columns x 2 state
rows**. Column index is the 4-bit neighbour mask (`N=1, E=2, S=4, W=8`); each
open edge gets a 2px rim at 72% luminance of the fill with hue held (the same
derivation `soil-wet` already documents), corners round where two open edges
meet, and a faint furrow keeps the fill from reading as paint.

**16 masks, not 9 nine-slice roles — deliberately.** `MASK_TO_ROLE` in the
mapmaker's `terrain.ts` collapses 16 masks onto 9 roles and has no art for masks
**0, 5 and 10**: an isolated tile and the two 1-wide strips, all three degrading
to the flat centre. Those are not corner cases on a farm — *the first plot
anyone tills is mask 0*, and working along a row makes strips constantly. Since
this file generates the art anyway, one frame per mask costs seven extra 16x16
cells and removes the degenerate cases entirely.

**Shipped as an `ImageSpec` with runtime-cropped frames, never a `SheetSpec`.**
Every `SheetSpec` takes a `TILESET_RUNS` allocation and shifts every later
`firstgid` — the failure behind T-7.09's milk-bottle trees and T-8.03's
vanishing shipping box. `GROUND_SOIL_TILES` is appended to the very **end** of
`IMAGES` and `registerSoilFrames` crops 32 named frames with `texture.add`,
which moves nothing. `pnpm --filter @tillhaven/mapmaker test` is green (82) both
before and after.

`soilMaskAt` / `soilFrameName` are pure and live in `plots.ts` beside `soilAt`,
with `tileKey` promoted there from `Farm.ts` — the scene builds the tilled set
that `soilMaskAt` consumes, so two spellings of a tile key would be two
spellings that silently have to agree. `redraw` builds that set **once per
frame, outside the loop** (it runs from `update`), and **excludes locked
plots**: a locked neighbour must not suppress a rim, or the field bleeds into
ground the player does not own.

**The mask is over "is tilled", never "is tilled and equally wet."** A watered
plot inside a dry field is a colour change with **no rim** — the soil is
continuous, the wetness is not — which keeps T-18.16's dryness signal readable
instead of chopping the field into fenced-off patches every time one plot's
window lapses.

**Verified in the browser through the actual actions, not a seeded database.**
Hoeing three plots in sequence, reading the frame off the sprite each time:

| after | (11,10) | (12,10) | (12,11) |
|---|---|---|---|
| hoe (11,10) | `dry-0` | — | — |
| hoe (12,10) | `dry-2` | `dry-8` | — |
| hoe (12,11) | `dry-2` | `dry-12` | `dry-1` |

The *neighbour* re-masks too, which is the whole behaviour: `dry-0` isolated,
then `dry-2`/`dry-8` facing each other with the seam between them gone, then a
clean L. Planting changed nothing; watering (12,10) took it `dry-12` → `wet-12`
— **same mask, only the state row moves**. Seeded shapes confirmed the rest: a
row reads `2,10,10,10,8`; the full 5x4 reads `dry-15` at the centre, `dry-6` at
the NW corner and `dry-9` at the SE; locking column 9 took (10,10) from
`wet-15` to `wet-7`, gaining exactly the west rim the locked-plot rule exists
for.

Break-tested by forcing `soilMaskAt` to `return 15` — 7 of the 8 mask tests
fail, the isolated/strip/corner/border cases all among them. Regression checks:
the character standing mid-field is drawn over the soil and the faced-tile
outline still draws on top of it (T-18.01 — soil stays an `Image` in the `decal`
container at `DEPTH.groundDecal`, and moving it would re-open that bug), and the
thirst badges still float above their crops (T-18.16). Whole suite green: 1,647
tests across shared/mapmaker/client/server, `pnpm -r typecheck` clean.

---

## Phase 19 complete — and with it the scheduled roadmap

T-19.01 fixed the ground; T-17.06, the last task in the whole plan, was
unblocked by D-20 and shipped in the same session. **Every scheduled task in
Phases 7-19 is done** — one is superseded (T-15.14, by D-14) and none are
outstanding.

What is left is deliberately not scheduled:

- **The Phase 14 backlog**, reconciled above. Eight real items remain; the
  substantial ones are Trade UI (T-14.03), chopping (T-14.05), anti-bot
  (T-14.07) and the ToS/Privacy text (T-14.12).
- **D-19 — is mobile in scope?** The only open decision. The layout half is
  fixed; the input half is a product call, and it overlaps T-14.11 because
  keyboard-only is both the mobile blocker and the biggest accessibility gap.

Both of the QA brief's stated requirements are satisfied and were verified
rather than assumed: object-bounds collision was **already correct**
(`OBJ_COLLISION_BASE` + `objectFootprint`, T-18.05) and was left alone, and the
soil visual states are now synchronised with gameplay state per plot, edges and
all (T-19.01).


---

# Phase 20 — Chopping (T-14.05, pulled up from the backlog)

**Why this one.** Phases 7-19 closed and Phase 14's own instruction is "pull
items up when the MVP above is done". Of the eight real items left, chopping is
the one the design already anticipates — §5.3 says the idle task list is
"designed to grow into chop/mine later" — and the only substantial one that
needs no product decision from the user first (Trade UI overlaps a hidden
feature, accessibility overlaps the open D-19, and the ToS is not engineering).

**The art exists**, checked before planning: `Icons/RPG icons/Weapons and
Armor/1. Wood/Axe.png` for the tool, and `Character/PNG/5. Axe and Sickle/` for
the swing — the same layered per-animation strips every other character
animation uses.

**What has to become real.** Trees are currently pure decoration:
`Tree.ts` says so in as many words — *"a tree has no server state, cannot be
chopped, and gates nothing"* — and the five `TREES` positions are static
constants baked into `farm.json` via `MAP_OBJECTS`. Chopping means a tree needs
state, and state means the server owns it (§4.1).

**Ordering rule for this phase:** no task may leave the game in a state where
something is buyable but useless, or visible but inert. So the server model
comes first, the mechanic second, the picture third, and the axe only becomes
purchasable once there is something to chop with it.

### T-20.01 — Tree state on the server  ✅ **DONE**
Depends: — · Size: M
Files: `packages/shared/src/config/trees.ts` (+ test),
`packages/shared/src/types/index.ts`, `apps/server/src/db/schema.ts`,
`drizzle/0012_*.sql`, `modules/auth/service.ts`, `modules/farm/service.ts`,
`farm.integration.test.ts`, `farm.queries.test.ts`

A `trees` table seeded from `TREES` at registration, `choppedAt` + a
`TREE_REGROW_MS` config constant, and `GET /api/farm` reporting a `TreeView[]`
computed on read (§4.2 — no jobs, exactly like crop growth). Nothing
user-visible changes; the client ignores the new field.

**How it turned out.**

**Rows, not a bitmask on `farms`.** Each tree needs its own `chopped_at` to
regrow independently, and rows are what let the chop intent name a tree by **id**
rather than by coordinates the server would have to trust (§4.1) — the same
shape plots already use. `x`/`y` are copied from `TREES` at registration and the
duplication is bounded on purpose: `farm.json` is static art shared by every
farm, while a chopped tree is a fact about *one* farm. `farmLayout.ts` stays the
only place a tree position is authored.

**Two tests caught me, which is the point of writing them first.**

**The faucet was wrong in a comment.** `TREE_REGROW_MS`'s doc claimed the five
trees yield "fifteen wood a day at most". The test multiplied it out — 5 trees x
3 wood x three 8h cycles — and got **45**. The comment was the thing that was
wrong, and §5.8's "an idle economy dies from unlogged faucets" is precisely
about numbers nobody has multiplied. The assertion now states 45 and T-20.02 is
told to price `wood` against that line rather than a guess. The regrow constant
itself is pinned as a **relation** (`TREE_REGROW_MS > WATER_DURATION_MS`), not as
`8 * HOUR`, so the reasoning survives a retune.

**The seventh query.** `farm.queries.test.ts` failed with *"expected 7 to be 6"*
— it pins the query count on the game's hottest path (§11) and its own doc says
*"if this changes it changes deliberately."* So: kept, and the reasoning
recorded in the test. The client draws trees every poll so the data is genuinely
needed; the read joins the same `Promise.all` as plots and animals so it adds no
serial latency; and it is five rows on `trees_farm_idx`. Folding it into the plot
query would union two unrelated shapes to save a round trip that is already
overlapped. **A new N+1 guard came with it** — *"is constant as the tree count
grows"*, matching the plot and animal ones — because trees are about to become
interactive, which is exactly when someone reaches for a per-tree lookup.

**Break-tested three ways**: making regrowth instant fails 3 unit tests and the
integration test; seeding only one tree fails the seeding test; replacing the
`map` with a per-tree query fails the N+1 guard (37 queries for 30 trees) *and*
the absolute count.

**Verified end to end in the browser**, not just in tests: registration writes 5
rows at exactly `3,2 16,3 17,11 2,17 17,17`; `GET /api/farm` returns them
standing; setting `chopped_at = now` makes all five stumps with an 8h countdown;
setting it 8h back makes them standing again **with nothing having run in
between** — offline regrowth for free, which is the whole §4.2 argument. The
client scene stays alive and error-free with a field it does not yet read.

### T-20.02 — Wood and the axe as items  ✅ **DONE**
Depends: T-20.01 · Size: S
Files: `packages/shared/src/config/items.ts`, `config/assets.ts`,
`config/config.test.ts`, `scripts/prepare-assets.mjs`,
`apps/client/public/tilemaps/farm.json`

`wood` (material: sellable, tradeable, stackable) and `axe_wood` (tool,
`ToolKind.AXE`, stack 1, unsellable) in the item catalogue, with icons wired
through the manifest. **Not yet purchasable** — see the ordering rule.

**How it turned out.**

**The art was measured, not assumed.** `Axe.png` is a 32x16 two-frame strip,
identical in shape to the hoe and the can, so `ITEM_ICON_FRAME = 0` applies
unchanged. `Extras/Wood.png` is **not** a two-frame strip — it is a 4x3 grid of
twelve 16x16 cells, and the frames are not what a glance suggests: 0 and 1 are
two plain logs (different shading, verified NOT duplicates), 2/3/6/7 add a white
outline, and 8-11 are flat silhouettes. Frame 2 is provably frame 0 plus **36
added pixels and nothing removed** — the same outline relationship the tool
sheets have — which is what confirms frame 0 is the right pick rather than a
guess.

**`MATERIAL` is a new `ItemCategory`, deliberately.** Wood is not `PRODUCE`: the
two answer differently to questions the game already asks — produce comes off a
plot and counts toward harvest XP, a material comes off a tree and does not.
Checked first that nothing switches exhaustively on the category (only filters),
so adding one is safe.

**The gid drift happened exactly as documented, and the procedure worked.** Both
icons are `SheetSpec`s, and appending to `SHEETS` renumbers every `IMAGES`
firstgid — `farmMap.test.ts` failed with three errors the moment the manifest
changed. Regenerating `farm.json` fixed it; 82 mapmaker tests green. This is the
third time that guard has paid for itself.

**The economy test caught the price, which is the second time this phase.**
Wood opened at 8g. `config.test.ts` multiplied out the faucet — 45 wood/day —
and compared it against one mature onion plot: **360g/day of chopping against
330g/day of farming.** Five chops beating a plot that has to be planted, watered
twice and harvested is precisely the outcome "a supplement, not an income" was
meant to prevent. **The price came down to 5g (225g/day); the assertion did not
move.** Comparing against ONE plot rather than a whole farm is deliberate — a
20-plot farm out-earns everything, so that comparison would prove nothing.

Both economy pins are **relations, not numbers**: wood must sell for less than
the cheapest crop, and the faucet must stay under one onion plot's day. Asserting
`5` would pass just as happily if every crop were retuned to 4g.

**The axe is declared but obtainable by no route**, and that is asserted rather
than assumed: not in `STARTING_ITEMS`, no `shopBuyPrice`. It exists only so
`ToolKind.AXE` is something `actionFor` can match on in T-20.03. Phase 20's
ordering rule is that nothing becomes buyable before it is usable, and this test
is what stops a later task quietly breaking it.

**Break-tested three ways**: putting the axe on sale fails 2 tests, filing wood
as `PRODUCE` fails the category test, and pricing wood at 40g fails both the
floor test and the faucet test.

**Verified in the browser**: both textures load at their measured sizes
(`tool-axe-wood` 32x16/2 frames, `icon-wood` 64x48/12 frames — a missing file
fails silently as a green box, so this is worth checking), and an axe and 12 wood
placed in the bag draw correctly in both the hotbar strip and the backpack panel.
Zero console errors.

### T-20.03 — `POST /api/farm/chop`  ✅ **DONE**
Depends: T-20.01, T-20.02 · Size: M
Files: `apps/server/src/modules/farm/trees.ts` (new), `farm/routes.ts`,
`packages/shared/src/schemas/index.ts`, `shared/src/errors.ts`,
`apps/client/src/net/errors.ts`, `farm.integration.test.ts`

The mechanic: Zod schema in `packages/shared/src/schemas/`, rate limited,
ownership checked, idempotency-keyed, one transaction that marks the tree
chopped and credits wood to the backpack — failing cleanly with
`INVENTORY_FULL` rather than destroying the drop.

**How it turned out.**

**This is the first action in the game gated on OWNING a tool, and that is the
whole design question.** Till and water check no tool at all, and `tillSchema`'s
comment explains why that is right: the hoe and the can are granted at
registration, so there is no state to verify, and a payload naming a tool would
just be the client asserting what it owns (§4.1). The axe is **not** granted, so
owning one is real state and a real gate. `chopSchema` still carries no tool
field — the server looks the axe up in the player's own inventory, which is the
only version of the check worth having.

**Axes are matched by `ToolKind.AXE`, never by the id `'axe_wood'`.** D-4 will
add eight more tiers, and a hardcoded id would leave someone holding an iron axe
unable to chop — the same argument `ToolKind` itself is documented with.

**Failure order is deliberate**: ownership (it decides whether the id resolves
at all), then the axe, then whether the tree is standing, then capacity last.
Capacity is the only one that depends on how much wood a tree drops, and telling
someone chopping a stump that their bag is full would be true and useless.

**A break-test proved a comment wrong, and the comment was the thing that
changed.** The code read *"the drop is credited BEFORE the tree is marked, so
there is no ordering in which the tree falls and the wood does not arrive."*
Swapping the two statements left **all 82 tests green** — because a throw after
the update rolls the update back too. The **transaction** is what makes chop
atomic; the ordering is readability only. Rather than invent a test to force a
distinction that does not exist (a test that cannot fail is not evidence), the
claim was corrected to say so.

**Break-tested four ways**: removing the axe check, the standing check, and the
ownership check each fail exactly one test; the ordering swap correctly fails
none, and that null result is recorded above rather than papered over.

**Nine failure paths tested**, including the two that would destroy value: a
full bag refuses the whole action with the tree left standing and no wood
created (§5.5 — never silently deletes items), and a repeated idempotency key
pays out once (§4.5). Another player's tree and a nonexistent tree give the
**same** `NOT_FOUND`, because telling them apart would confirm an id is real.

**Verified live against the running server**, every path: no axe → `403
TOOL_REQUIRED`; with an axe → `200`, 3 wood, `regrowsInMs: 28800000`; the stump
→ `409 TREE_NOT_READY` with `{regrowsInMs: 28799814}`; a repeated key → same
body, wood unchanged; another player's tree → `404 NOT_FOUND`.

**Found while verifying: 115 of 118 dev farms have no tree rows.** The T-20.01
migration creates the table but does not backfill farms that already existed, so
only accounts registered since have trees. Acceptable pre-launch — the roadmap's
migrations note says exactly this ("wiping the dev database is acceptable when a
migration would otherwise need a backfill") — but worth knowing, because it is
also why the first run of the live check hit a Zod `400` instead of the `404` it
was looking for: it had picked a tree id out of a farm that has none. The
integration test registers a fresh second player and was never affected.

**A test helper was renamed rather than duplicated.** `giveSeeds` was always
generic — `itemId`, `quantity` — and only its name was narrow; it is now
`giveItem` across all 34 call sites.

### T-20.04 — Chopping in the browser  ✅ **DONE**
Depends: T-20.03 · Size: L
Files: `apps/client/src/game/actions.ts` (+ test), `entities/Tree.ts`,
`entities/characterLayers.ts`, `entities/Player.ts`, `scenes/Farm.ts`,
`net/farm.ts`, `packages/shared/src/config/assets.ts`, `config/config.test.ts`,
`scripts/prepare-assets.mjs`

The axe swing (`5. Axe and Sickle`) as a hotbar tool on the faced tile, the
tree drawn as a stump while chopped, and the tree returning on regrowth.

**How it turned out.**

**Everything was measured before it was wired.** `5. Axe and Sickle` is 90 layer
files at a uniform **768x32** — 24 frames over four directions, six each,
identical geometry to `4. Pickaxe, Hoe`, so it needed no special-casing. The
folder ships `Weapons/Axe/1.png` at matching geometry for the wood tier, and
also `Weapons/Sickle/1.png`, **deliberately unused**: there is no sickle item,
and drawing one would put an implement nobody owns in the player's hands — the
same rule that has kept `6. Shovel`'s overlay out since T-16.02, now pinned for
both cases.

**The stump art already existed and nobody had used it.** `OBJ_MAPLE_TREE`'s
manifest note has said *"row 2 is stumps and acorns"* since T-9.05. Frame 18 is
the plain spring stump — verified rather than trusted, since 19, 20 and 21 are
distinct siblings and 20 wears snow — and its art spans crop x 9..22, a 14px
stump that lands squarely on the maple's measured 12px trunk. It is on the STILL
sheet, so `setTreeStanding` swaps texture as well as frame; a stump has no
leaves to drop.

**The bug worth the whole task: `playToolAnimation('axe')` was a silent no-op.**
The chop worked, the wood arrived, the tree fell, the console was clean — and
the character stood in its idle loop the entire time. The cause is that
`FARM_ANIMS` in `characterLayers.ts` is the explicit list of strips that get
loaded and registered, and `axe` was not on it. **That file's own comment
predicts this exact symptom**: *"an animation nobody loaded is ... NOTHING AT
ALL: `anims.play()` on an unregistered key silently leaves the previous
animation running and logs no warning"* — the T-8.04 finding, rediscovered by
hand in a browser.

The same comment promises the gap is *"a compile error rather than"* that. **It
was not.** So the fix is two things: `'axe'` on the list, and the compile error
the comment had been describing for twelve phases —

```ts
type SwingsAreLoadable = Exclude<Swing, FarmAnim> extends never ? true : never;
```

Adding a verb to `Swing` without loading its strip now fails `tsc`. Proven by
removing `'axe'` again: `error TS2322: Type 'true' is not assignable to type
'never'`. Confirmed fixed in the browser — sampling the character's animation
across a real keypress now reports `["char:axe:up", "char:idle:up"]` where it
previously reported only idle.

**Three maps, not one, for the trees**, because they are keyed by different
things and filled at different times: tile-faced → anchor tile (from the MAP),
anchor tile → sprite, anchor tile → the server's view (replaced every poll).
**The anchor tile is the join**: the server names trees by uuid and the map knows
nothing about uuids, and `TREES` in shared config is what makes both sides agree
— pinned by T-20.01's integration test asserting the rows land on exactly those
positions.

**Chop targets the TRUNK, not the 32x48 cell**, reusing `objectTiles` and the
measured `OBJ_COLLISION_BASE` rather than a second footprint calculation — the
same two solid tiles the player is already standing next to (T-18.05).

**`FarmIntent` gained its first non-plot member**, and the type system found
every site: `Swing` needed `'axe'`, `Player.isToolAnim`'s predicate widened, and
`send()` was destructuring `plotId` off the union. That last one mattered — the
busy-guard would have keyed on `undefined` and let a second chop through while
the first was in flight. It now reads whichever id the intent carries.

**Break-tested**: letting any tool chop fails 1 test; letting stumps be chopped
fails 2; removing `'axe'` from `FARM_ANIMS` fails the build. A stale test caught
the change honestly too — *"only the two real tools draw an implement"* asserted
the pair `['hoe','watering']`, and the axe belongs there where the shovel does
not, because `axe_wood` is an item a player owns and equips.

**Verified in the browser end to end**: facing the tree resolves `{kind:'tree',
standing:true}`; pressing E without an axe toasts *"You need an axe to chop
that."* and changes nothing; with the axe the swing plays, wood goes to 3, and
the sprite becomes `obj-maple-tree` frame 18 with its animation stopped; the
stump then toasts *"That tree is still growing back."*; and winding `chopped_at`
back eight hours brings the tree back on the next poll, animated again. Zero
console errors.

### T-20.05 — The axe goes on sale  ✅ **DONE**
Depends: T-20.04 · Size: S
Files: `packages/shared/src/config/items.ts`, `config/config.test.ts`,
`docs/economy.md`

**Split from what this task used to be.** It read *"the axe goes on sale, AND
idle chops"* — two independent things, and the second is not small: the
simulator is entirely plot-shaped (`SimPlot`, `SimAction`, `chooseAction`
scanning plots, `apply` writing plot rows), so chopping means threading a new
entity through `idleSim.ts`, `idleApply.ts` and their two large test files.
Bundling a config line with that would have made one task that could not be
finished in one go, which is exactly what this roadmap's discipline avoids. Idle
chopping is now **T-20.06**.

**How it turned out.**

**The axe forced a real change to a rule, not a special case.** `tool()` refused
a buy price by construction, and its comment gave the reason: *"every player is
granted the wood tier at registration, so a tool has no scarcity to price."*
That is true of the hoe and the can and **false of the axe**, which is granted to
nobody — and a tool that is neither granted nor sold cannot be obtained at all.
So `buy` became an explicit per-tool opt-in. Selling and trading stay banned
outright, for a reason that did not change: a tool the merchant restocks at a
fixed price has no scarcity, so a sell price would be a faucet with a buy-back
loop and a trade would be a market in nothing.

**The old invariant was replaced by a stronger one.** "No tool can be bought"
became **"every tool is obtainable exactly one way"** — granted at registration,
or sold, never both and never neither. Break-tested in both directions: giving
the hoe a price fails it, and taking the axe's away fails it.

**Two T-20.02 tests failed on this change and were meant to.** One was called
*"declares an axe that is not yet obtainable by any route"* — written precisely
so this moment could not arrive by accident. Phase 20's ordering rule held all
the way through: the axe became buyable only after it became usable.

**The price test moved the number, for the third time this phase.** 200g, not
the 150g it opened at, because `config.test.ts` rejected 150 for costing **less
than a packet of onion seeds** — the game's priciest consumable outpricing its
only permanent tool. Both halves of the price are pinned as relations: break
even in under two days of full chopping (200 / 225g per day), and dearer than
the dearest seed.

**`docs.test.ts` caught the ledger, which is §5.8 working as designed.** The
suite failed with *"prices changed without updating docs/economy.md: expected
['axe_wood buy 200']"*. Both new lines are now in the ledger — wood as a faucet
capped at **225g/day by regrowth rather than by effort**, and the axe as a sink
— and the starter-kit row was corrected, since it still claimed tools "cannot be
bought".

**No server or client code changed at all.** `shopCatalogue()` is derived from
`ITEMS`, so a price is the whole feature.

**Verified end to end in the browser**: the catalogue returns
`{itemId:'axe_wood', buyPrice:200, sellPrice:null}`; buying takes gold 500 → 300
and puts one axe in the bag; selling it back is refused with
`ITEM_NOT_SELLABLE`; and equipping the purchased axe and pressing E at a tree
yields 3 wood. A new account can now reach chopping entirely in-game.

### T-20.06 — Idle chopping  ✅ **DONE**
Depends: T-20.05 · Size: L
Files: `packages/shared/src/config/idle.ts` (+ test), `types/index.ts`,
`apps/server/src/modules/farm/idleSim.ts` (+ test), `idleApply.ts`
(+ integration test), `service.ts`, `apps/client/src/game/idlePanel.ts`
(+ test), `idleSummary.ts` (+ test), `entities/idleReplay.ts`, `scenes/Farm.ts`

`IdleTask.CHOP` joins the simulator with its own `chop` step, applied from
timestamps like every other idle action.

**How it turned out.**

**The simulator's whole vocabulary was plots, and that is what made this Size
L.** `SimInput`, `SimAction`, `chooseAction`, `apply` and `writeResult` all
assumed one entity. Trees now ride alongside: `SimTree` carries only
`choppedAt` (standing-ness is derived by the shared `treeStateAt`, never
stored), `SimInput.trees` is **optional** so every existing caller and test
keeps working, and `SimAction` gained `treeId` with `plotId` becoming optional.

**Chopping is LAST in `PRIORITY`, and that is its whole argument.** Everything
above it is on a clock the player loses by missing — a ripe crop blocks its
plot, dry soil is growth not happening. A standing tree loses nothing by
waiting, and its 8h regrow is slower than anything on the farm. Pinned by a test
that puts a thirsty crop and a standing tree in front of the same farmer.

**Three real bugs, each caught by a test written for it:**

**1. The bag lost the axe after one chop.** `chopInto` used `planAddToSlots`,
which returns only the slots it TOUCHED — for a caller about to turn them into
UPDATE statements. `harvestInto` next to it uses `addToSlots`, which returns the
whole bag. So the first chop replaced the farmer's inventory with a single slot
of wood, the axe vanished, and every later chop was skipped for having no axe.
Found by *"works down every tree"* — which is why that test exists rather than a
single-chop one.

**2. `LOOKAHEAD_MS` was unguarded after being widened.** Its comment justified
`WATER_DURATION_MS + IDLE_ACTION_MS` by **enumerating** the events time alone
can produce — "exactly two things" — so adding a third had to change the number.
It became `max(WATER_DURATION_MS, TREE_REGROW_MS) + IDLE_ACTION_MS`, since a
stump regrows in 8h against watering's 4h and the old horizon would report
"nothing next" to a farmer whose only pending job was a tree. **A break-test
reverting it passed everything** — every other test calls `simulate` with an
explicit `to`, and `nextIdleAction` is the only caller of the horizon. The new
test failed on its first fixture too, for a second reason worth recording: a
tree chopped six hours ago regrows at +2h, comfortably inside BOTH horizons.
Chopped one hour ago regrows at +7h, which is the only version that
distinguishes them.

**3. The offline summary said "picked 15 × Wood".** `IdleSummaryView.harvested`
is "what landed in the bag", and the client's loop hard-coded the verb — correct
while everything in it was a crop. The verb now comes from the item's
**category** (`MATERIAL` → "chopped"), so the next material is right without a
second list.

**Four existing tests failed and every one was right to.** `idle.test.ts`
listed `'chop'` among the values `isIdleTask` must REJECT; `idlePanel.test.ts`
listed it among the tasks the client must DROP; `idle task types` asserted the
list was "exactly the four verbs"; and the `ReplayPlan.plotId` rename rippled
into two replay test files. All four were written before chopping existed and
have been updated to say what is now true — `'chop'` moved from the reject list
to the accept list in both, which is the clearest possible record of the change.

**One over-broad `sed` of my own**, caught by the suite: renaming `plotId` →
`targetId` also hit the test factory that builds an `IdleNextAction`, which
still names a plot — it is `ReplayPlan` that became target-agnostic, not the
server's action. Nine replay tests failed with "Cannot read properties of null",
which is exactly what `planReplay` returns when an action names neither.

**The client walks to trees too.** `ReplayPlan.plotId` became `targetId` and
`Farm.ts` resolves the destination from either the plot map or the tree views,
so the idle replay walks to a maple and swings the axe rather than standing
still.

**Break-tested six ways**: removing the axe check, letting stumps be chopped,
not offering regrowth as an opportunity, reverting the lookahead, never writing
the felled tree rows, and never crediting the wood — each fails only the tests
that cover it.

**Verified in the browser end to end**: "Chop trees (needs an axe)" appears in
the idle panel; switching it on with an axe and backdating the watermark an hour
fells **all five trees for 15 wood** on the next poll, with the farm view
reporting five stumps and the rows agreeing. (The summary toast came back empty
in that run because the probe's own `fetch('/api/farm')` consumed it first —
"show it once" is a property of the protocol, so an out-of-band read takes it.
The message text is covered by unit tests instead.)

---

## Phase 20 complete — chopping

Trees went from decoration to a resource in six tasks: server state computed on
read, wood and an axe in the catalogue, a transactional endpoint, the swing and
the stump in the browser, the axe on sale, and the idle farmer doing it while
you are away.

**Three of the six were finished by a test moving a number, not by the number
moving a test** — the wood faucet (a comment claimed 15/day, it was 45), the
wood price (8g beat a whole onion plot), and the axe price (150g undercut a
packet of seeds). §5.8 says an idle economy dies from unlogged faucets; these
are what "logged" has to mean to be worth anything.

What is left on the Phase 14 backlog is unchanged apart from chopping, which is
now struck: Trade UI (T-14.03), VIP benefits (T-14.01), economy tuning
(T-14.06), anti-bot (T-14.07), scheduled jobs (T-14.08, blocked on D-2),
accessibility (T-14.11, overlapping D-19) and the ToS/Privacy text (T-14.12).


---

# Phase 21 — Anti-bot (T-14.07, pulled up from the backlog)

**Why this one next.** With chopping shipped, T-14.07 was the largest remaining
backlog item that needs no decision from anyone: §8 states it as a requirement
in the imperative — *"Rate limit per account and per IP on all mutating
endpoints. Idle games are heavily botted — assume automation and design so that
automation gains little."* Trade UI overlaps a feature hidden by decision,
accessibility overlaps the open D-19, economy tuning needs live data that does
not exist pre-launch, and the ToS is not engineering.

### T-21.01 — Rate limits that count the account, not the address  ✅ **DONE**
Depends: — · Size: M
Files: `apps/server/src/middleware/rateLimitKey.ts` (new, + test),
`middleware/rateLimit.integration.test.ts` (new),
`middleware/rateLimitCoverage.test.ts` (new), `app.ts`,
`modules/auth/routes.ts`

**How it turned out.**

**Audited before touching anything, and most of it was already right.** 37 of 38
mutating routes declared their own limit on top of the 300/minute global
backstop, and `/auth/login` had a properly composite `keyGenerator` — IP *and*
submitted identifier, so neither spraying one password across accounts nor
hammering one account from many addresses gets a free pass.

**The gap was the key, and it was the whole of §8's "per account" half.**
`@fastify/rate-limit` defaults to `request.ip`, and no route except login
overrode it — so every authenticated endpoint was IP-limited only. That is the
wrong half to have alone for this game: §8's own reasoning is that automation
should gain little, and **an IP-only limit is the one a script defeats most
cheaply**, because rotating residential proxies are a commodity while accounts
cost a registration. It also punished the wrong people — a household or campus
behind one NAT shared a single budget.

`keyGenerator` set once at plugin registration is inherited by every route-level
`config.rateLimit`, so one line moved all 37 onto a per-session budget. Login
keeps its own key, correctly: it is the one route with no session yet.

**Keyed on the session, not the player id, and the reason is the hot path.**
`requireAuth` is a **preHandler**; the limiter runs at `onRequest`, so
`request.player` does not exist yet. Resolving the token to an account would be
a database round trip on every request including the farm poll (§11). The
session cookie is already parsed by then — `@fastify/cookie` is registered
before the limiter — so it costs nothing.

**The limitation is stated rather than glossed:** a player can hold several
sessions, and each gets its own budget. It is bounded rather than open — minting
a session costs a login, and login is capped at 10 per 15 minutes per (IP,
identifier). Ten budgets per quarter hour beats the *unlimited* one an IP key
hands anyone who can change address.

**The token is hashed into the key, never used raw.** Rate-limit keys are
stored — in memory here, in Redis when clustered — and a session token is a
bearer credential. A limiter dump containing raw tokens would be an account
takeover. `resolveSession` already hashes for storage; this is the same
discipline one layer up, and it has its own test.

**A unit test would not have caught the bug this task fixes**, so there are
three kinds. The key function is unit-tested (same session across addresses →
same key; two sessions from one address → different keys; empty cookie is not an
identity; the raw token never appears). An **integration** test proves the
limiter actually *consults* it — a perfect key that `@fastify/rate-limit` never
reads would pass every unit test and leave every endpoint IP-limited, which is
exactly the state the audit found. And a **coverage** test scans the route
sources so the next `app.post` without a limit fails the build.

Two honest notes on those tests. `/api/vip/checkout` never returns 200 in the
suite (no Stripe key), so every assertion is deliberately *429 or not-429* — a
429 comes from the limiter's `onRequest` hook and anything else means it passed
the request through, which is the only distinction the subject needs; the
comment says so rather than leaving a reader to wonder. And the coverage scan
bounds a route's options by where the **handler** starts rather than by a
character count — a first draft used a fixed window and reported the freshly
documented `/logout` as uncovered, because its new comment pushed the
`rateLimit` past the cutoff.

**`/logout` was the one uncovered route** and now has a deliberately loose
60/minute: it is unauthenticated by design, writes one `revoked_at`, and takes
something away from the caller, so a tight limit would mostly obstruct a browser
retrying.

**Break-tested three ways**: removing the `keyGenerator` fails the
address-change test (the request from the second address comes back as the
route's own 401 — the limiter had handed it a fresh budget); stripping
`/logout`'s limit fails coverage; and the coverage scan has its own guard
against passing vacuously if the regex ever stops matching.

**Verified in the browser**, because this touches every request: register → in
game → **40 rapid farm reads, all 200** → log out → log back in, with zero
console errors.

**Not done, and deliberately:** §8 also says "log security-relevant events",
which `logSecurityEvent` already covers for logins, trades and VIP grants. What
is genuinely missing for anti-bot is *detection* — flagging an account whose
action cadence is inhumanly regular — and that needs live data to calibrate
against, which is T-14.06's problem and does not exist pre-launch.

---

# Phase 22 — Trading, reachable at last (T-14.03)

**The server never stopped working.** Phase 4 shipped the whole system —
invite, offer, dual confirmation with reset-on-change, row-locked atomic
execution, an immutable `trade_log`, eligibility gates — and six server
integration files still cover it. T-11.05 unmounted the **panel**, and said
exactly why: *"trading is a place-based interaction like everything else now,
and there is nowhere to do it yet — a button that opens a window onto an
unreachable feature is worse than no button."*

So this phase is not building a trade system. It is giving the one that exists
a door.

**D-21, decided (2026-09-04): the mailbox is the trade post.** It already
stands at `MAILBOX_TILE` (3,12) on the merchant frontage row, is already drawn
and solid, and is the **only object on that row that does not answer the action
key** — the shop, the chest and the shipping box all do. Mail is the natural
metaphor for messages from other players, and it costs no new art, no placement
decision and no map regeneration. The alternatives were a dedicated trade-post
object (a measuring-and-placement task before the feature even starts) and a
HUD button (which is what T-11.05 refused to do).

### T-22.01 — The mailbox opens the trade panel  ✅ **DONE**
Depends: — · Size: M
Files: `apps/client/src/game/actions.ts` (+ test), `scenes/Farm.ts`, `hud.ts`

A `mailboxTiles` set built from the map like the chest's, a `mailbox` faced
target, an `open` intent for it, and the panel mounted on the HUD.

**How it turned out.**

**This was wiring, not building, and the audit is what established that.**
`tradePanel.ts` is 21KB of finished panel — invite, offer builder, dual
confirmation with a reset banner, expiry countdown, history with a cursor, an
8s poll fallback — and every endpoint behind it has server integration tests
that never stopped passing. What it lacked was four lines: a set of tiles, a
target kind, an intent, and a `mount` call.

**The mailbox was the only object on its own row that did nothing.** The shop,
the chest and the shipping box all answer the action key from the frontage at
y=12; the mailbox was drawn, solid, and inert. D-21 picked it over a new
trade-post object (which would have needed art measured, a placement that clears
every path and building footprint, and a map regeneration *before* the feature
began) and over a HUD button (which is exactly what T-11.05 refused to do, in
writing).

**`rememberObjectTiles` from the MAP, not `MAILBOX_TILE` from config** — the
same rule the chest and the stall already follow. Moving the mailbox in the
editor moves the trade post with it, and a second copy of the coordinate here is
the drift §9 warns about.

**The panel opens with anything in hand**, like the other three, and the test
loops every held item to say so. A rule such as "put your hoe away to read your
post" would be a rule with nothing behind it — these panels are views of what
the player already owns, not actions on the world.

**`bagItems` deduplicates**, because the offer builder picks an *item*, not a
slot: a bag holding two half-stacks of leeks must offer "leeks" once. And
`onExecuted` re-fetches rather than patching — a completed trade moves items and
gold on both sides and the client computed none of it, which makes it the one
moment the bag changes without this tab having asked.

**Verified in the browser**, which is the only place this has ever run: standing
at (3,12) and facing up resolves `mailbox`; pressing E opens a panel reading
*"Invite a farmer to trade by their farm name"*; Escape closes it; and holding D
with it open moves the character **0 pixels** — the modal movement lock (T-18.12)
covers it for free because the panel already sets `MODAL_ATTR`. Zero console
errors.

Break-tested by removing the `mailbox` branch from `actionFor` — three tests
fail, and the panel becomes unreachable again.

### T-22.02 — A trade, end to end, between two players  ✅ **DONE**
Depends: T-22.01 · Size: M

The flow nothing has ever exercised in a browser: invite by username, both
sides offer, a change resets confirmations, both confirm, the swap lands.

**How it turned out.**

**No code changed. That is the result.** Two real browsers, two real accounts,
the whole §6 protocol driven through the panel — and every step worked first
time. The server has had integration tests for each step since Phase 4; what
had never been shown is that the *panel* drives them, which is exactly what
T-11.05 left unproven when it unmounted the thing.

| Step | Observed |
|---|---|
| A invites B by farm name | *"Waiting for beta… to accept"* |
| B accepts | both sides show the offer builder |
| A offers Leek x3, B offers Potato x2 | each side sees the other's offer |
| A confirms | A `✓ confirmed`, B `waiting` |
| **B changes the offer** | **A resets to `not confirmed`** + *"The offer changed — review it and confirm again."* |
| both confirm, A executes | items swap |

**The defensive rule is real, and it is the one that matters.** §6 requires that
any change to an offer after a confirmation resets *both* confirmations —
that is the entire anti-scam mechanism, and it fires with a banner explaining
why rather than silently un-ticking a box.

**Conservation checked against the database, not the UI**: A went leek 10→7 and
potato 0→2; B went potato 10→8 and leek 0→3. Ten of each before, ten of each
after. One `trade_log` row written, trade status `completed`. Zero console
errors on either page.

**Eligibility had to be satisfied to run this at all**, which incidentally
proved it works: both accounts needed `created_at` older than
`TRADE_MIN_ACCOUNT_AGE_MS` (24h) and 494 XP for `TRADE_MIN_FARM_LEVEL` (5). A
fresh account cannot trade — which is T-22.03's subject.

**Two things found, neither a bug:**

**An offer's quantity cannot be edited in place.** `renderAddPicker` filters out
items already offered, so a player who has offered 2 potatoes and wants to offer
3 must remove the stack and re-add it. Defensible — removing is one click and it
correctly triggers the reset rule — but worth knowing. P3, noted in T-22.03's
scope rather than fixed blind.

**The anti-bot limiter stopped the test harness**, which is the best evidence it
works: `POST /api/auth/register` is 5/hour per IP (T-14.07), and a day of
creating throwaway accounts hit it. Registration returned `429 RATE_LIMITED`
exactly as designed. Worth recording because the *next* person to write a
multi-account test will meet it too.

### T-22.03 — Eligibility, explained rather than refused  ✅ **DONE**
Depends: T-22.01 · Size: S
Files: `packages/shared/src/types/index.ts`,
`apps/server/src/modules/trade/eligibility.ts`, `modules/player/view.ts`,
`apps/client/src/game/tradePanel.ts` (+ new `tradeEligibility.test.ts`),
`hud.ts`, `styles/hud.css`

**How it turned out.**

**`SelfPlayer.canTrade` had been computed and sent on every poll since Phase 4,
and nothing on the client ever read it** — zero references in
`apps/client/src`. So a new player walked to the trade post, was shown the
invite form like anyone else, typed a friend's farm name, pressed Invite, and
got an error toast. On the one feature in the game with a *deliberate* waiting
period, that reads as a broken button rather than a rule.

The gate itself was never in question — §14 and `eligibility.ts` argue it
properly: 24 hours plus farm level 5 makes throwaway-account scamming expensive
to run at any scale, and neither cost can be bought. Only the silence was wrong.

**A boolean could not fix it, so the shape moved.** `TradeBlock` and
`TradeEligibility` now live in `packages/shared/src/types` because they are a
wire shape; the DECISION stays on the server, which is the only side that knows
about `flaggedAt`. `SelfPlayer.canTrade: boolean` became
`SelfPlayer.trade: TradeEligibility`, carrying the reason, the hours remaining
and the level reached. That is display data derived server-side — exactly what
`PlotView.readyInMs` already is — and it changed nothing about authority: both
gates are still re-checked at invite *and* at execution, for both parties.

**No input, rather than a disabled one.** When blocked, the panel renders the
sentence and nothing else. A greyed field the player can type into and not
submit is a politer version of the same dead end.

**The message logic is a free function**, not a method, so the branching is
testable without a DOM. Two of its eight tests are the ones that matter:

- **hours round UP.** `Math.floor` shows *"0 hours to go"* on a gate that has
  not opened — a lie the player will hold you to a minute later.
- **a flagged account stays vague.** *"Trading is unavailable on this
  account."* and nothing more; the details of a chargeback investigation are
  not the player's to read off a panel. Break-tested by leaking the word
  "chargeback" into it.

**Verified in the browser across all three states**, on a genuinely new account
rather than a doctored one:

| Account | Panel |
|---|---|
| brand new | *"New farms cannot trade for their first day — about 24 hours to go."* |
| 26h old, farm level 1 | *"Your farm reaches trading at level 5. It is level 1 — keep harvesting."* |
| 26h old, level 9 | the invite form returns |

Zero console errors.

### T-22.04 — Realtime, or an honest fallback  ✅ **DONE**
Depends: T-22.02 · Size: M
Files: `apps/client/vite.config.ts`, `apps/client/src/net/devProxy.test.ts` (new)

**How it turned out.**

**The socket had never connected in development, and it failed silently.**
`net/realtime.ts` calls `io()` with no URL, so it connects to the page's own
origin. In production that is Fastify, which serves the client and the socket
together, and it works — which is exactly why nothing ever caught this. In dev
the origin is Vite on :5173, and Vite proxied `/api` but **not** `/socket.io`.

What made it quiet rather than loud is the detail worth keeping: **Vite answered
`/socket.io/` with its HTML fallback and a 200**, not a 404. Socket.IO received
a page where a handshake should be, could not parse it, and retried forever in
polling mode. The console stayed clean. Confirmed by watching the network:
repeated `200 http://localhost:5173/socket.io/?EIO=4&transport=polling` with no
`sid` and no upgrade, ever.

Nothing *looked* broken because the panel has an 8-second fallback poll (T-4.10)
which had been quietly carrying the entire feature. The evidence was there in
T-22.02, unremarked: every cross-player check in that run needed a 9-second wait.

**One proxy entry, and `ws: true` is the whole point** — this is an upgrade, not
a request. Measured immediately after:

| Event | Before (poll) | After (socket) |
|---|---|---|
| invite reaches the other player | up to 8000ms | **75ms** |
| an offer change reaches them | up to 8000ms | **463ms** |

For a live two-party negotiation where a change resets both confirmations, that
is the difference between a conversation and a fax.

**The guard is a config scan** (`devProxy.test.ts`), asserting both paths are
proxied, that `/socket.io` carries `ws: true`, and that both point at the API.
Break-tested: dropping `ws: true` fails one test, removing the entry fails
three. A source scan rather than importing the config — `vite.config.ts` pulls
in Vite's plugin types, and standing that up inside vitest to read four literals
would be more machinery than the check is worth.

**A process note worth recording:** `git checkout apps/client/vite.config.ts`
during break-testing reverted the fix along with the deliberate break, because
the file had no other uncommitted changes. Caught by re-running the test rather
than by noticing. Break-tests that restore by `git checkout` are only safe on
files that are already dirty.

---

## Phase 22 complete — trading is reachable, explicable and live

Four tasks, and **three of them changed almost no code**. The trade system has
been complete and tested since Phase 4; what it lacked was a door, an
explanation, and a working socket.

- **T-22.01** gave it the mailbox — the only object on the merchant frontage
  that did not answer the action key (D-21).
- **T-22.02** proved the panel drives the protocol, including the reset-on-change
  rule that is the whole anti-scam mechanism. No code changed.
- **T-22.03** found `SelfPlayer.canTrade` had been sent on every poll since
  Phase 4 with **zero client readers**, so the 24-hour gate was discoverable
  only by being refused.
- **T-22.04** found the socket had never connected in dev, hidden by a fallback
  poll and a 200 where a 404 belonged.

**The pattern across all four is the same**: the server was right, and the
client never asked. That is the shape of every remaining "re-enable X" item on
the Phase 14 backlog, and worth remembering when picking the next one.

---

# Phase 23 — Collision QA: buildings collided with their roofs

## Where this came from

A player-oriented QA brief (2026-09-05): test the game the way a player meets
it — walk into everything from every side, compare what is solid against what is
drawn, and treat "the code is right but it feels wrong" as a bug. It asked
specifically that **roofs must not collide**.

**Most of the collision model was already right, and that is worth stating.**
Map objects use `OBJ_COLLISION_BASE`, a measured pixel footing per object — the
maple blocks its 12px trunk, not its 32px cell. `PLAYER_COLLIDER` is a 10x6 feet
box, deliberately narrower than the 11px silhouette so a 16px gap is passable.
`movement.step` resolves per axis with slide and snap-to-edge, so you stop flush
against a wall and slide along it rather than sticking. Interaction is one tile
in front of the feet, consistently, for every object. Livestock is walk-through
(D-14) and flat decor is walk-over (D-9), both for recorded reasons.

**Buildings were the exception**, and they were the only one.

### D-21 — where trading lives  *(carried from Phase 22)*
### D-22, decided (2026-09-05): what a building blocks

**The silhouette, not the bounding box.** `footprintOf` made every tile the
art's box touches solid. Measured per tile at tier 0: the farmhouse blocked 48
tiles and **six of them contained no drawn pixels at all** — row y=1 is a 20px
chimney cap, 10.6% covered, walling off eight tiles of visible grass. Walking
the north edge of the map met an invisible wall.

The first answer was **body only, roof walk-behind** — the most literal reading
of the brief, and the user chose it. `reachability.test.ts` then rejected it,
and the rejection is the interesting part: **the idle replay walks straight
octile lines with no avoidance** (D-8 chose that deliberately), so freeing the
roof opens a concave pocket behind the house. A greedy walker slides along a
wall only while it has a lateral component; once its x matches the target's it
wants pure south, is blocked, and wedges. Twenty plot approaches failed from one
start — and the north-west maple is an idle chop target, so the farmer would
have routed through there routinely, then had its collision dropped by the 2s
`REPLAY_STUCK_MS` unstick and walked visibly through the farmhouse.

So: **the roof mass stays solid; everything that is not the building does not.**
Ghost tiles, the yard in front of a set-back wing, and the tapered corners of a
roof apex all open up. The house stays a convex obstacle, which is the property
the reachability test exists to protect.

### T-23.01 — The collision overlay  ✅ **DONE**
Depends: — · Size: M
Files: `apps/client/src/game/entities/collisionOverlay.ts` (new),
`scenes/Farm.ts`

**`collision.ts` had said this should exist since T-15.05** — `BlockLayerId` and
`BlockMap.reasons()` are documented as being named *"so a debug overlay can say
why a tile is solid"* — and no overlay was ever built. The bookkeeping was
there; the picture was not, and a collision audit without a way to SEE collision
is an audit of the code rather than of the game.

F1 in dev builds draws every solid tile tinted by the layer that makes it solid,
the player's collider (the 10x6 feet box, not the silhouette), and the faced
interaction tile. A tile solid for two reasons draws the second as an inset
ring, because `reasons()` returns a list and the whole point is telling two
adjacent solid tiles apart by *why*. Constructed only under
`import.meta.env.DEV`, so production carries neither the Graphics object nor the
key binding.

### T-23.02 — Measure the buildings  ✅ **DONE**
Depends: — · Size: M
Files: `scripts/measure-building-bodies.mjs` (new), `scripts/lib/png.mjs` (new),
`scripts/measure-object-bases.mjs`

Prints a per-row alpha profile and a paste-ready tile mask for all nine building
arts, exactly as `measure-object-bases.mjs` does for map objects. The PNG
decoder was **extracted to `scripts/lib/png.mjs`** rather than copied — seventy
lines of hand-rolled bit-twiddling in two places is two decoders to keep
correct, and the second copy is the one nobody re-reads.

The script **proposes**; a human decides. That distinction earned its keep
twice: a bare threshold keeps the farmhouse chimney (correct — it sits on solid
roof) and would have kept it even when the roof beneath was freed (wrong — a
one-tile pillar in open grass).

### T-23.03 — Collision follows the building  ✅ **DONE**
Depends: T-23.01, T-23.02 · Size: L
Files: `packages/shared/src/config/collision.ts` (+ test),
`apps/mapmaker/src/io/buildingBodies.test.ts` (new), `apps/client/.../Farm.ts`,
`collision.test.ts`, `reachability.test.ts`

**How it turned out.**

`BUILDING_BODY_MASK` holds a reviewed tile mask per building art, written
top-down so each literal looks like the building it describes.
`currentBuildingFootprints` became **`currentBuildingTiles`** and returns tiles
rather than boxes — a building's solid region is not a rectangle. Every caller
already wrapped it in `footprintsTiles`, so the rename cost one call each and
made the shape honest. `footprintOf` and `BUILDING_FOOTPRINTS` are **unchanged**:
reservation is a different question and should stay pessimistic, so nothing may
be planted or built under a roof even where you can now walk.

| | tier 0 | tier 1 | tier 2 |
|---|---|---|---|
| farmhouse | 48 → 40 | 48 → 38 | 56 → 48 |
| coop | 20 → 18 | 42 → 33 | 72 → 51 |
| barn | 25 → 20 | 42 → 33 | 64 → 53 |

**A rectangle was tried first and the tests rejected it.** "The bottom N pixels
are solid" is wrong for buildings whose wing sits on a higher base:
`obj-farmhouse-t1` has **seven ground-level tiles with no art**, because in this
projection empty pixels BELOW a wall are the yard in front of it. Only a mask
can say that.

**The guards live in the mapmaker**, with `farmMap.test.ts`, for the reason that
file already gives: it is the package allowed to hold the manifest and the real
files in its head at once. `packages/shared` cannot read a PNG, and **arithmetic
over the config could never have found this** — the fault was in the pixels.
Five guards: no solid tile with zero art; none under a quarter covered; the body
never exceeds the reserved box; the ground row always solid (a building whose
collision floated would be walk-through at floor level, a worse failure); and
every art has a mask whose grid matches its own.

**Break-tested** by reverting `buildingBodyTiles` to the bounding box — two
tests fail in `shared` and two in the mapmaker.

**Verified in the browser** with the overlay on: the six ghost tiles report
`solid=false`, the roof mass still reports `["buildings"]`, and walking east
along row 1 now travels two tiles further and stops flush against the chimney
instead of against nothing. Zero console errors.

## Findings, prioritised

| | Finding | Status |
|---|---|---|
| **P1** | Buildings solid over their whole sprite box; 8 tiles at tier 0 blocked with **zero art** on them | **Fixed** (T-23.03) |
| **P2** | No way to see collision, though the data was shaped for it | **Fixed** (T-23.01) |
| **P2** | Idle replay wedges in concave pockets; the unstick then walks it through walls | **Avoided** — the fix keeps buildings convex. The underlying limit is D-8's and remains |
| **P3** | The maple blocks 2 tiles for a 12px trunk | **Left alone.** It straddles a tile boundary and `objectFootprint` argues the alternatives through: majority coverage blocks *neither* tile and you walk through the trunk |
| **P3** | `BlockLayerId` lists `animals`, which nothing ever populates | **Left alone.** D-14 made livestock walk-through; the layer is dead vocabulary, not a bug |
| **P3** | `measure-object-bases.mjs` reports a different newsstand base than `OBJ_COLLISION_BASE` holds | **Noted, not chased.** The config value is the reviewed one; the script measures the whole sheet rather than the drawn look. Worth a look if the stall ever feels wrong |

---

# Phase 24 — VIP delivers what it sells (T-14.01, pulled up from the backlog)

## Where this came from

Continuing the backlog after Phase 23, T-14.01 reads *"VIP benefits applied to
the new loop (bulk actions, idle-speed?)"*. Idle-speed turned out to be
**already done and correct**: `idleApply.ts:242` hands `benefits.durationPercent`
to the simulator, so a VIP's offline farmer runs on VIP timers, and every
`growthAt`/`productionAt` caller on the server takes the multiplier.

The bulk actions were not. `VIP_BENEFITS.bulkHarvest` and
`VIP_BENEFITS.autoCollect` have existed in `config/vip.ts` since T-5.01 and are
read by **nothing** — no route, no service, no client, not one test. Meanwhile
`pages/landing.ts:349` sells them by name: *"Harvest and collect in one go —
clear every ripe plot and every ready animal with a single action."*

**That is the finding, and it is the only one on this phase that involves real
money.** Every other dead flag in this codebase costs a reader some confusion.
This one is a paid product claim with no implementation behind it.

Audited at the same time, for completeness:

| benefit | state |
|---|---|
| `durationPercent` | **Live** — crops, animals, and the idle simulator |
| `bonusInventorySlots` / `bonusChestSlots` | **Live** — `inventory/service.ts:55` |
| `bonusPlotSlots` | **Live** — `farm/expansion.ts:60` |
| `bonusAnimalCap` | **Live** — per building, `animals/service.ts:130` |
| `cosmeticsUnlocked` | **Half** — two `vipOnly` furniture pieces exist; outdoor `DECOR`'s `piece()` helper hardcodes `vipOnly: false`, so no outdoor piece can be one |
| `bulkHarvest` | **Sold, absent** |
| `autoCollect` | **Sold, absent** |

### D-23, decided (2026-09-05): implement the bulk actions

Three ways to make the advertising true, and the user chose the first:

**(a) Implement both.** Delivers what is sold. The cost is a farm action the
character does not walk to, which cuts against §5.1's *"only the character
performs farm actions — there is no click-a-plot-from-anywhere path"*.

**(b) Delete the claim.** Idle mode already harvests and collects
autonomously, for free, for every account, so the benefit is close to
redundant; dropping it keeps §5.1 whole.

**(c) Both, plus outdoor VIP decor.**

**Chosen: (a).** §5.1's rule is about where the *game's* verbs live, and it is
enforced client-side as a UX gate in any case (§4.1 — the server has never
validated position and must not start). A VIP convenience button is not a
second farming path; it is the same intents, batched, behind a paid flag. And
(b) resolves a broken promise by withdrawing it, which is the right call only
when the promise was a bad idea — this one is fine, it was merely unbuilt.

### T-24.01 — Bulk harvest  ✅ **DONE**
Depends: — · Size: M
Files: `packages/shared/src/schemas/index.ts`,
`apps/server/src/modules/farm/{service,routes}.ts`,
`apps/server/src/modules/vip/bulkActions.integration.test.ts` (new),
`apps/client/src/net/farm.ts`

**How it turned out.**

`POST /api/farm/harvest-all` — Zod, rate limited at **10/min** rather than
`/harvest`'s 60 (one call does up to twenty-five plots' work, so keeping the
per-action budget would make the batch the cheap way to load the database),
idempotent under `farm.harvestAll`, and behind the same `afterIdleCatchUp` as
every other farm mutation. The gate is `benefitsFor(player, now).bulkHarvest`,
refused with `FORBIDDEN` — the code `decor/service.ts` already uses for
`vipOnly`, rather than a new one.

**The payload carries no plot list.** Which plots are ripe is the server's own
arithmetic over its own timestamps; a list in the body would be a second
opinion it has to ignore, so it would be nothing but attack surface (§4.1).

`harvestAll` **calls `harvest` in a loop** instead of reimplementing it. Bulk
harvest has to mean exactly N harvests or it becomes a second set of rules for
soil, `grownMs` and XP — and the day one of them changes, the paid path is the
one that silently keeps the old behaviour. Plots are taken in `id` order so two
batches lock in the same sequence.

**The savepoint claim was wrong the first time, and the correction is the
interesting part.** Each plot runs in `tx.transaction`, which nests as a
`SAVEPOINT`. Break-testing that by dropping to a flat `harvest(tx, …)` changed
**nothing** — all seventeen tests still passed. The reason is in a different
module: `addItem` builds a complete `planAdd` and throws `INVENTORY_FULL`
**before it issues a single write**, so a failed harvest leaves nothing behind
to roll back.

So the savepoint was measured properly instead: with the flat loop AND
`harvest`'s plot update moved above its `addItem`, a full bag **clears a plot
and adds no produce** — silent item destruction, on the paid path only. Putting
the savepoint back, with the reorder still in place, fixes it. That is what it
buys: the batch's atomicity stops depending on another module's statement
order. Both the code comment and the test say so in those terms.

Result shape is `{ harvested[], stoppedByFullBag, experience, farmLevel }` —
the client has to be able to tell "I cleared your farm" from "I cleared what
fitted", because only one of those asks the player to do something.

### T-24.02 — Bulk collect  ✅ **DONE**
Depends: T-24.01 · Size: S
Files: `apps/server/src/modules/animals/{service,routes}.ts`,
`packages/shared/src/schemas/index.ts`, `apps/client/src/net/animals.ts`

**How it turned out.**

`POST /api/animals/collect-all`, the twin of T-24.01 and deliberately shaped
identically — same gate (`autoCollect`), same 10/min limit, same loop over the
real `collect`, same savepoint, same `id` ordering.

**One difference, and it is the one that matters.** A plot is ripe or it is
not; an animal can be **too young, unfed, or merely early**, and all three mean
*this one has nothing for you right now* rather than an error. So all three are
skipped rather than fatal — an unfed cow in the barn must not stop the button
emptying the coop. `NOTHING_TO_COLLECT` is only raised when nothing at all was
collected.

Seventeen tests cover both endpoints in `modules/vip/bulkActions.integration.test.ts`
— one file for two modules, because what is under test is one benefit pair with
one gate and one partial-failure rule, and splitting it would write the
interesting property twice. Includes the flagged-account case: a refunded
account keeping its bulk button would be a paid feature surviving its own
refund.

### T-24.03 — The button, and the bug it uncovered  ✅ **DONE**
Depends: T-24.01, T-24.02 · Size: M
Files: `apps/client/src/game/hud.ts`, `apps/client/src/styles/hud.css`,
`apps/client/src/styles/hudHidden.test.ts` (new)

**How it turned out.**

**One button, not two.** The benefit was always sold as a single action — *"clear
every ripe plot and every ready animal with a single action"* — so *Gather all*
runs both batches **sequentially** (both write inventory rows for the same
player and both run the idle catch-up; firing them together would have two
transactions contending for the same rows to save a round trip nobody is
waiting on). "Nothing was ready" from one half is swallowed: a farm with ripe
crops and no ready animals is the ordinary case, and a refusal toast for the
half with nothing to do would make the working half look broken.

It is the mirror of the VIP button beside it — that one hides when the account
HAS VIP, this one appears. Off the same `player.isVip`, so the two can never
both be on screen.

**BUG-24, found by building it: `hidden` on a HUD button has never worked.**
The button carried `hidden=""` in the DOM and stayed fully visible. `.hud__btn`
sets `display: inline-flex`, and an author class rule outranks the user agent's
`[hidden] { display: none }`. Every panel in `hud.css` already carries its own
`[hidden]` rule for exactly this reason — `.shop[hidden]`, `.pack[hidden]`,
`.creator[hidden]`, nine others — and buttons were the one family that set
`display` and never got one.

**This was live, and it was not mine.** Since T-18.20, an account that already
owned VIP was still shown the button offering to sell it — precisely what that
button's own comment says must not happen. Measured in the browser both ways:
before the fix, a VIP account reported `vipHidden: true` and *VIP offer
visible: true* at the same time.

`.hud__coach` and `.hud__thirsty` set no `display`, which is why their `hidden`
has always worked and why nobody noticed.

Guarded by `hudHidden.test.ts`, which reads `hud.ts` and `hud.css` **as text**:
the fault lives in the interaction between markup and stylesheet, and jsdom
applies no stylesheet, so nothing that renders one without the other can see
it. It scans the markup for elements written `hidden`, and fails any of their
classes that sets `display` without a matching `[hidden]` rule — general enough
to catch the next button family, with a guard-on-the-guard so the assertions
cannot pass vacuously if the regex stops matching. Break-tested by changing the
new rule to `opacity: 0.5`: two of three tests fail.

**Verified in a real browser** (Playwright over the bundled Chromium; the
Chrome-channel binary the MCP server wants is not installed on this machine, so
verification ran through a direct `playwright-core` script):

| account | Gather all | VIP offer |
|---|---|---|
| VIP | visible | hidden |
| free | hidden | visible |

and the action itself, on a VIP farm with two ripe potatoes and one ready hen:
one click, toast **"Gathered 2 crops and 1 animal."**, both plots cleared in the
database, produce in the bag, **zero console errors**.

One note for whoever reads the network log: gathering on a farm with no ready
animals logs a 409 the client deliberately swallows. Pre-filtering it would
mean the client deciding what is ready, which is the server's call (§4.1), so
the 409 stays.

## Phase 24 complete — VIP delivers what it sells

Three tasks. The advertised benefit now exists, and two things turned up on the
way that were worth more than the feature:

- **A savepoint that guards something other than what it looked like.** The
  first break-test said it was dead weight. Measuring properly showed it
  prevents silent item destruction — but only against a change nobody has made
  yet, in a different module. Both were worth writing down.
- **BUG-24**, a paid-account bug live since T-18.20, found only because a
  second button needed the same trick and did not work either.

`cosmeticsUnlocked` remains **half true**: two `vipOnly` furniture pieces exist,
and outdoor `DECOR`'s `piece()` helper still hardcodes `vipOnly: false` so no
outdoor piece can be one. That is the remaining VIP gap and the natural
Phase 25 opener.

**Backlog reconciliation** (Phase 14 lies again, as it did before 2026-09-04):
- ~~**T-14.01** — VIP benefits applied to the new loop~~ — **done by Phase 24**.
  Idle-speed was already correct (`idleApply.ts` passes `durationPercent` to
  the simulator); the bulk actions were the missing half.
- ~~**T-14.03** — Re-enable Trade UI~~ — **done by Phase 22**, four tasks. The
  entry still said "still open".

Genuinely remaining: **T-14.06** (economy tuning from real data), **T-14.08**
(scheduled jobs, blocked on D-2), **T-14.11** (accessibility, overlaps D-19),
**T-14.12** (real ToS/Privacy — still the only non-engineering item and the
only one with outside exposure).

---

# Phase 25 — The last VIP gap: outdoor cosmetics

## Where this came from

Phase 24's own closing note: `cosmeticsUnlocked` was **half true**. The two
`vipOnly` furniture pieces indoors were real; outdoors, `DECOR`'s `piece()`
helper hardcoded `vipOnly: false`, so no outdoor piece could ever be one.

That made three separate pieces of correct code unreachable. The `vipOnly`
field on `DecorDef` had existed since T-15.16. The server's refusal in
`decor/service.ts:106` had existed since T-15.23 and **could never fire** —
there was nothing to refuse, so no test could reach the branch. And the
catalogue endpoint had been sending `vipOnly` to the client since the same
task, where it had **no reader at all**.

**The same shape Phase 22 named and Phase 24 hit again**: the server was right,
and nothing ever asked it a question it could answer.

### T-25.01 — The Winter set  ✅ **DONE**
Depends: — · Size: M
Files: `packages/shared/src/config/decor.ts` (+ `decor.test.ts`),
`apps/mapmaker/src/io/decorVipArt.test.ts` (new),
`apps/server/src/modules/decor/decor.integration.test.ts`

**How it turned out.**

`piece()` gained an options bag, and three VIP-only pieces landed: **Frosted
fence**, **Frosted fence post**, **Frosted signpost**.

**Every one is an exact cosmetic twin of a free piece** — same footprint, same
`solid`, same price, different art only. That is not a shortcut; it is what
makes §7 checkable. "VIP benefits are cosmetic" is a promise nobody can test.
"Identical in every field a rule reads, different only in `look`" is a
property, and `DECOR_VIP_TWIN` states the pairing explicitly so the test checks
an intention rather than pairing pieces by whatever happens to match today.

**The art cost nothing.** `decor-fence-wood` and `decor-village-signs` are each
drawn twice — plain on top, snow-topped below — and the catalogue's own comment
had said so since T-15.16 while using only the plain halves. Measured with
`scripts/measure-decor.mjs` like every other window: rail `#6`, post `#8`,
signpost `r1c2`. No new file, no manifest entry, no `prepare-assets.mjs` run.

They still cost gold. VIP unlocks the right to buy, exactly as it does for the
two furniture pieces — never a discount, never a grant.

**A third test was needed, and finding out why is the useful part.** Shared's
`decor.test.ts` can prove the fields match and the `look` coordinates differ.
Neither shows the art is actually different: **different coordinates into the
same sheet can still be the same picture**, and then the paid piece is the free
piece sold twice. So `decorVipArt.test.ts` compares the pixels, in the mapmaker
for the reason `buildingBodies.test.ts` gives — `packages/shared` cannot read a
PNG. Measured: 25% of the rail's pixels differ, 25% of the post's, 19% of the
signpost's.

**The signpost is why an alpha check would not have done.** It has the *same
silhouette* as its twin — 318 opaque pixels in both — because the snow is
painted onto the same shape rather than added to it. Coverage would have called
them identical; only a pixel comparison sees it.

Break-tested twice: pointing `fence_frost_h` at its twin's window fails the
pixel test with "draws all but 0 of fence_h's pixels", and giving the frosted
signpost a 2x1 footprint fails the twin test in shared.

Four server tests now reach a branch that had been unreachable for ten phases:
refused to a free account (nothing charged), sold to a VIP at the ordinary
price, refused to a **flagged** account with VIP time left, and still listed in
the catalogue rather than hidden. Break-tested by disabling the refusal — two
fail.

### T-25.02 — The shop row asks  ✅ **DONE**
Depends: T-25.01 · Size: S
Files: `apps/client/src/game/shopPanel.ts` (+ test)

**How it turned out.**

`renderDecorRow` read `entry.vipOnly` **not at all**, so with T-25.01 in place
it would have offered a working Buy button on a piece the server always refuses
with `FORBIDDEN` — a paid feature that looks free until you press it.

`decorRowState` is the new pure decision, exported and tested beside
`purchaseBlocker` and following its rule: **VIP is named before the wallet.**
No amount of gold unlocks a VIP piece, so reporting a shortfall would send the
player off to earn money that changes nothing — the identical argument
`purchaseBlocker` already makes for putting a full coop ahead of an empty
purse. Six tests, break-tested by deleting the VIP branch (two fail).

Locked pieces stay **listed**, greyed, labelled `VIP`, with the price still
visible and "VIP only" in the meta line. Hiding them would make VIP cosmetics
discoverable only by buying VIP, and knowing what is in the box is the point of
an exclusive. The same reasoning the furniture tray already used.

**Verified in the browser**, over the real session:

| | result |
|---|---|
| catalogue | 14 pieces, exactly the 3 frosted ones flagged `vipOnly` |
| free account `POST /decor/buy fence_frost_h` | **403 FORBIDDEN**, gold unchanged |
| VIP account, same call | **200**, 5,000g → 4,960g, one in storage |
| the six art windows | 58–75% opaque; each frost twin differs from its plain twin in 19–25% of pixels |

## Phase 25 complete — VIP is now entirely delivered

Every field of `VipBenefits` has a reader and a test:

| benefit | where |
|---|---|
| `durationPercent` | crops, animals, and the idle simulator |
| `bonusInventorySlots` / `bonusChestSlots` | `inventory/service.ts` |
| `bonusPlotSlots` | `farm/expansion.ts` |
| `bonusAnimalCap` | per building, `animals/service.ts` |
| `bulkHarvest` / `autoCollect` | Phase 24 |
| `cosmeticsUnlocked` | two furniture pieces (Phase 16) **and three outdoor pieces (Phase 25)** |

Nothing on the landing page is now sold and undelivered. Remaining backlog:
**T-14.06** (economy tuning), **T-14.08** (blocked on D-2), **T-14.11**
(accessibility, overlaps D-19), **T-14.12** (real ToS/Privacy — still the only
non-engineering item, and the only one with outside exposure).

---

# Phase 26 — The privacy policy stops being able to lie

## Where this came from

T-14.12 — *"Real ToS/Privacy (RMT-unsupported clause)"* — is the last
substantial backlog item and, as the backlog itself says, **the only
non-engineering one and the only one with outside exposure**.

**It is not closed by this phase, and could not be.** A real Terms of Service
and a compliant privacy policy need a lawyer: legal basis for processing,
retention periods, deletion rights, sub-processors, international transfers,
governing law, limitation of liability. Writing a longer draft and calling it
finished would be strictly worse than the honest stub already there, because
the failure mode is presenting an unreviewed document as a reviewed one.

What *is* engineering, and what was missing, is this: **nothing stopped the
privacy page becoming false.** It described what the code did on the day it was
written, and the very next migration could silently make it untrue. That is the
same argument `docs.test.ts` makes about the economy ledger — *a document
nobody is forced to update stops being true within a fortnight* — applied to
the document with the highest cost of being wrong.

### T-26.01 — The privacy policy is checked against the schema  ✅ **DONE**
Depends: — · Size: M
Files: `apps/server/src/privacy.test.ts` (new), `apps/client/privacy.html`,
`apps/client/terms.html`

**How it turned out.**

Every column of the five tables that hold data about a **person** — `players`,
`sessions`, `purchases`, `security_log`, `trade_log` — must be classified,
either as PERSONAL with a phrase the page must contain, or as NOT_PERSONAL with
a written reason. Columns are enumerated with drizzle's `getTableColumns`
rather than by parsing the file, so the guard reads the real schema.

Game-state tables are deliberately out of scope. They *are* personal data in
the legal sense, and the page covers them in one sentence, but listing forty
crop columns would bury the six that matter, and a guard nobody can read is a
guard nobody maintains.

**The phrase, not the column name.** `password_hash` appears on the page as
*"stored only as an argon2 hash"*, because the page is written for a reader. A
test demanding column names would push the policy toward being a schema dump.

**It found four undisclosed things on its first run, which is the whole
justification for writing it:**

| held | disclosed? |
|---|---|
| `players.appearance` | no — character appearance was stored and never mentioned |
| `players.createdAt` | no |
| `players.lastSeenAt` | no — **and I did not know this column existed until the test named it** |
| `purchases.refundedAt` | no — the page described purchases but not that a refund is recorded |

All four are now on the page, in a reader's language rather than a schema's:
`lastSeenAt` is described as what it actually is — the only behavioural record
of when you play, and the thing that makes offline idle progress possible.

**A second, smaller lie fixed.** Both legal pages said *"Tracked as `T-0.10` in
`ROADMAP.md`"*. `T-0.10` is a **v1 id**; it survives only in
`docs/ROADMAP-v1.md`, so anyone who followed the pointer into the live roadmap
found nothing and could reasonably conclude the work was done. Now `T-14.12`,
with a test that extracts whichever id each page claims and fails if the live
roadmap does not contain it.

Two guards-on-the-guards, because three of these assertions pass vacuously if
the inputs go empty: the schema must yield more than thirty columns and must
contain `players.email`, and the page must be over 1,000 characters. A fourth
test refuses to let either page drop its **"not legally reviewed"** stamp while
T-14.12 is open — the likeliest way the stamp disappears is somebody tidying
the page and reading it as finished.

Break-tested three ways: adding `phoneNumber` to `players` fails as
unclassified; pointing a page at `T-99.99` fails the roadmap check; and the
disclosure test had already failed for real on the four columns above before
they were written up.

**A note on `classifies nothing that does not exist`.** The reverse direction
matters as much: a classification left behind for a dropped column is a policy
describing data no longer held, which is untrue in the other direction and
reads as carelessness in exactly the document where it costs most.

## Phase 26 status — T-14.12 remains OPEN

Deliberately. This phase makes the privacy page **true and self-defending**; it
does not make it **lawful**, and the page still says so in its own first
paragraph. What a lawyer now receives is a document that accurately describes
the system, which is a far better starting point than one that does not — but
the review itself is outstanding and stays on the backlog.

Remaining backlog after this: **T-14.06** (economy tuning from real data),
**T-14.08** (scheduled jobs, blocked on D-2), **T-14.11** (accessibility,
overlaps D-19), **T-14.12** (legal review — needs a lawyer, not a commit).

---

# Phase 27 — Accessibility, measured

## Where this came from

Two backlog items were left that touch code. **T-14.06 — economy tuning from
real data — was not attempted, and the reason is in its own title.** The game is
pre-launch; there is no real data. What could be done from the config already
has been: `docs.test.ts` makes the ledger a build dependency, `config.test.ts`
refuses a crop that sells for less than its seed, and D-18 records that all four
crops sit at 20–22.5 g/hr by design. Inventing numbers and calling it tuning
would be worse than leaving it open, so it stays open.

**T-14.11 — accessibility & polish** could be done, and could be done the same
way every other claim in this repo is settled: by measuring instead of arguing.

### T-27.01 — The axe audit, and what it found  ✅ **DONE**
Depends: — · Size: M
Files: `apps/client/src/styles/{base,hud}.css`,
`apps/client/src/styles/contrast.test.ts` (new)

**How it turned out.**

axe-core over seven views — landing, login, register, terms, privacy, the game,
and the game with a panel open — against WCAG 2.1 A and AA.

**Every violation in the entire product was colour contrast.** Not one missing
label, ARIA error, unlabelled control, or heading-order fault. That is worth
stating plainly, because it means the `role="status"`, `aria-pressed`,
`aria-expanded` and `aria-label` work scattered through `hud.ts` from earlier
phases is *correct*, and the accessibility gap was somewhere nobody had thought
to look.

| where | measured | needed |
|---|---|---|
| `--ink-faint` on `--paper` (26 nodes on the landing page) | **3.12** | 4.5 |
| `--ink-faint` on `--paper-raised` (all three register hints) | **3.52** | 4.5 |
| `--paper` on `--barn` — every bar button, at rest | **4.21** | 4.5 |
| `--paper` on `--soil` — a hovered bar button | **3.13** | 4.5 |
| dark-theme `--ink-faint` | **3.28** | 4.5 |

**Contrast is the failure a stylesheet cannot feel.** Nobody looks at #9a7a63
on a good monitor in a lit room and sees 3.12:1. That is exactly why it
survived eighteen phases, and why the fix is arithmetic with a test rather than
a nicer-looking hex.

**Four judgement calls, each scoped to where the failure actually was:**

- **`--ink-faint` → #6f5847.** Same hue, darkened. Chosen to pass on **all
  three** paper tones — 5.27 / 5.94 / 4.51 — not just the two axe happened to
  exercise. `--paper-sunk` is a real background in four stylesheets and the
  pairing is one layout change away; a token safe only on the backgrounds it
  currently meets is a trap for whoever writes the fifth. The contrast test
  caught this, after axe did not.
- **`--barn` → #a64622, and this one knowingly bends T-15.26.** The HUD palette
  is *sampled from the art*, with pixel-histogram provenance in every comment.
  The sampled rust misses AA by 0.3. The alternatives were worse: text large
  enough for the 3:1 large-text threshold means 18.66px bold in a bar that
  already has to wrap at 390px, and switching the plate to `--frame` throws away
  the pack's signature colour to close a 0.3 gap. So it is darkened 4.5% — one
  channel, imperceptible — and **the sampled value stays recorded in the
  comment**, with a test that asserts it is still recorded.
- **`--soil-deep`, a new token rather than a change to `--soil`.** `--soil` is
  used ten times in `hud.css`, mostly behind `--ink`, where it passes
  comfortably. The single failing pair is `--paper` text on a hovered button.
  Changing the token would have restyled the gold pill to fix a problem the
  gold pill does not have.
- **`--faint` replaces `--muted` and three hardcoded copies.** Three colours
  were doing one job and two failed: the token `--muted` at 3.33, and a literal
  #9a7a63 pasted into three rules at **2.98** — the old site value, hardcoded,
  so darkening `base.css` never reached it. **axe found only one of those three
  rules**, because the other two were not on screen during the audit.

That last one changed the test. A guard that read only `:root` would have
declared the palette fixed while the actual text sat at 2.98:1, so
`contrast.test.ts` also sweeps **every literal `color: #xxxxxx` in `hud.css`**
and fails any that clears neither ground. (#6d4738, the other literal in the
file, measures 6.10 and was never the problem — it is left exactly as it is.)

Nineteen tests: the WCAG formula against its own reference extremes (21:1 and
1:1, plus symmetry), every token pair in both themes, and the literal sweep.
Break-tested by restoring `--faint` to the old `#ab6659` — two fail.

**Re-audited after the fix: zero violations on all seven views.**

## Phase 27 status

`contrast.test.ts` **does not replace an axe run** and says so in its own header
— it cannot see a nested override, a gradient, or a colour set in JavaScript.
What it pins is the palette, so a future "warm this up a bit" fails in CI rather
than in an audit nobody runs.

**T-14.11 is not closed.** Contrast was the measurable half. The rest of that
item is D-19's territory: the game is keyboard-only, which is simultaneously
the mobile blocker and the largest remaining accessibility gap, and it needs a
product decision about a new input mode rather than a commit.

Backlog after this phase — and every one of them is now blocked on a decision
or on data, not on effort:

- **T-14.06** — economy tuning. Blocked on *real data*, which needs players.
- **T-14.08** — scheduled jobs. Blocked on **D-2** (withering on or off).
- **T-14.11** — the rest of accessibility. Blocked on **D-19** (is mobile in
  scope, and what is the touch input model).
- **T-14.12** — legal review. Needs a lawyer. Phase 26 did the engineering half.

---

# Phase 28 — D-19 answered: the game is playable with a thumb

## Where this came from

Every remaining backlog item was blocked on a decision or on data rather than
on effort, so the question went back to the user: which to unblock. **D-19** —
*is mobile in scope* — was chosen, and it is the right one. It is the largest
single gap in the product: `bindKeys` drove movement, `E`/`Space` acted, and
the only `POINTER_DOWN` handler in the entire client bought a plot, so **on a
phone the character could not be moved at all**. It was simultaneously the
mobile blocker and, per T-14.11, the largest accessibility gap. And
`index.html` has been marketing *"plant before work, harvest at lunch"* the
whole time — inviting precisely the device that could not play.

T-18.23 had already fixed the layout half and, honestly, put a note on screen
telling coarse-pointer devices they needed a keyboard. Phase 28 replaces the
note with controls.

**D-24 records the model and the argument for it** (see the table above). The
short version: a stick is the only option that adds no second rule.

### T-28.01 — The input model  ✅ **DONE**
Depends: — · Size: M
Files: `apps/client/src/game/touchInput.ts` (new, + test)

**How it turned out.**

Pure module: vectors in, `MoveInput` out. The DOM lives elsewhere so the
interesting decisions are testable without a touchscreen — and they are all
decisions about **turning an analogue, noisy thumb into four crisp booleans**.

- **`STICK_DEAD_ZONE = 0.3`**, large by gamepad standards, because this is a
  thumb on glass with no spring to return it. Without one the character creeps,
  and on a touch device the thumb never fully leaves the control between moves.
- **`CARDINAL_BAND_DEG = 30`, and this is the load-bearing idea.** A thumb
  cannot hold 0°, so without a band a stick is diagonal nearly always — and a
  character permanently walking diagonally can never square up to a tile, which
  is exactly what §5.1's action needs. Four 60° cardinal bands and four 30°
  diagonal ones: diagonals stay reachable, but you have to mean it. Touch users
  would otherwise have found the hoe hitting the wrong plot with no visible
  reason.
- **`STICK_RUN_ZONE = 0.85`.** The keyboard runs on Shift; a stick has no spare
  finger, so distance is the modifier — the convention every twin-stick game
  already teaches. The vector is clamped to the unit circle first, so `run` is a
  position on the stick rather than a function of how far the finger wandered
  off it.
- **`mergeInput` ORs keyboard and touch** rather than letting one win. A tablet
  with a keyboard is a real device, and last-input-wins would make both feel
  intermittently dead.

Fifteen tests, including one that sweeps every 7° of the circle asserting the
stick never reports two opposite directions at once.

### T-28.02 — The controls, and the bug they exposed  ✅ **DONE**
Depends: T-28.01 · Size: M
Files: `apps/client/src/game/touchControls.ts` (new),
`apps/client/src/game/entities/Player.ts`, `scenes/Farm.ts`, `hud.ts`,
`styles/hud.css`

**How it turned out.**

A stick and an action button, constructed **only** where `(pointer: coarse)`
matches — the same query that used to show the "needs a keyboard" note, so the
devices that were told they could not play get controls instead and the two can
never both appear. A laptop builds nothing at all.

Pointer events rather than touch events, so one code path covers finger, stylus
and mouse; and `setPointerCapture`, so a thumb that slides off the stick keeps
driving it instead of leaving the character walking — the single most common way
a virtual stick goes wrong.

**The stick joins at exactly one line**: the merge inside `Player.readInput`,
which is already the one place movement is read. That is what lets touch reuse
`movement.step`, facing, collision and faced-tile targeting completely
unchanged. A touch path that moved the character by any other route would be a
second movement model, and two models drift.

The action button calls the same `act()` the keyboard's `ACTION_KEYS` call, on
`pointerdown` rather than `click` — a click waits for the release, which is a
visible delay on the one control that must feel instant, and the keyboard fires
on down too.

**BUG-28, found by looking at the screenshot rather than at the test.** The
first build mounted the controls on `document.body`, and they rendered
**unstyled**: a bare letter `E` where a rust plate belonged, and an invisible
knob inside a visible stick. The HUD palette — `--ink`, `--paper`, `--barn` —
is declared on `.hud`, deliberately shadowing the site tokens of the same names
that `base.css` puts on `:root`. Anything outside `.hud` resolves every one of
them to nothing.

Nothing would have caught this: typecheck passed, all tests passed, and the
element was present, visible and correctly positioned. It was wrong only in a
way you can see. `hud.element()` now exists for exactly this, with the reason
written on it, and `TouchControlsHost.parent` is documented as *must be the HUD
root*.

**Verified on an emulated iPhone** (390x844, `hasTouch`, coarse pointer):

| | |
|---|---|
| stick and button | present and visible |
| "Tillhaven needs a keyboard" | **gone** |
| knob while held right | `translate(52px, 0)` — hard over, clamped |
| knob after release | back to centre, character stops |
| character movement | **1.95% of the frame changed while the stick was held, against a 0.12% idle baseline** — 16x the animation noise, and the character is visibly gone from its start position in the after-shot |
| console errors | none |
| axe, all seven views | still zero violations |

**Not verified end-to-end:** a full action round trip through the button — the
character was not standing at an actionable tile. The button is wired to the
same `act()` the keys call and its press state was confirmed; the action itself
rests on that shared code path, not on a measurement.

## Phase 28 status — D-19 is answered, T-14.11's remainder is unblocked

The game is now playable with a thumb: walk, face, act, and a hotbar that was
already tappable DOM. `index.html`'s promise about playing at lunch is true for
the first time.

What this does **not** claim: that the game is *designed* for a phone. The
camera still fits the whole map (D-12), which on a 390px screen is small, and
no panel has been re-laid-out for a narrow viewport beyond T-18.23's wrapping.
Those are polish, and they are now polish on something that works rather than
decoration on something that does not.

Backlog: **T-14.06** (needs real players), **T-14.08** (needs D-2), **T-14.12**
(needs a lawyer). **T-14.11** is no longer blocked — its blocker was D-19.

---

# Phase 29 — The narrow viewport, now that it matters

## Where this came from

Phase 28 made the game playable with a thumb, which turned every narrow-screen
layout question from cosmetic into load-bearing. T-14.11's remainder was
unblocked, so the panels were measured at 390x844 the same way the contrast was:
by asking the browser, not by looking.

**Two claims came out of that audit and only one survived checking. The other
was mine, and it was wrong.**

### The one that did not survive

The first pass reported *"six of twelve hotbar slots off screen"* and called it
a P1 — half the hotbar unreachable, on the control that selects tools. **It is
not true.** `.hotbar` already carries `max-width: calc(100vw - 1rem)` and
`overflow-x: auto`; measured, it is `clientWidth 382` against `scrollWidth 678`,
it scrolls, and slot 12 becomes visible when it does. Off screen is not the same
as unreachable, and the difference is the whole finding.

What is fair to say is narrower: the strip gives **no visual cue that it
scrolls**, and on touch there are no number keys to reach slots 8-12 the other
way. That is a discoverability question, not a defect, and it is recorded here
rather than fixed on a guess.

### T-29.01 — Twelve columns do not fit a phone  ✅ **DONE**
Depends: — · Size: M
Files: `apps/client/src/styles/hud.css`, `game/inventoryPanel.ts`,
`styles/hudHidden.test.ts`

**How it turned out.**

**BUG-29, and this one is real, reproducible and worse than the one I withdrew.**
At 390x844 with the backpack open:

- `.pack` sits at x 8-372, inside the viewport, and reports
  `scrollWidth === clientWidth === 358` — **no horizontal overflow at all**.
- And yet **twelve `.slot` elements sit at x 359-525**, outside the panel and
  outside the screen.

Both are true because `.pack` is `width: max-content` capped by
`max-width: calc(100vw - 2rem)`, while `.pack__grid` asks for a **fixed**
`repeat(12, 54px)`. The panel gets clamped, the grid does not reflow, and the
excess is clipped with nothing to scroll. On a VIP's 24-slot bag that is **half
the inventory, silently gone** — no scrollbar, no cut-off edge, no way to know.

The grid now reflows below 900px. **Not a scroll**, deliberately: horizontal
scrolling inside a container whose entire purpose is drag-and-drop is two
gestures fighting over one finger, and on touch the drag wins about half the
time.

**What the twelve columns bought is kept where it fits.** The original comment
explains them: twelve columns make the top row *exactly* the hotbar, so the
marked row matches the strip on screen. Verified still true at 1440px — twelve
slots in the first row, nothing off screen. Where twelve do not fit,
`.slot.is-hotbar` still draws its gilt underline on each hotbar slot
individually, so which slots they are stays visible; they are simply not one
row any more.

**So the hint had to change, and that is the part worth noticing.** It said
*"The top row is your hotbar."* — true only while twelve columns fitted. Now it
names the marker instead: *"The slots with a gold line underneath are your
hotbar."* True at every width. A reflow without that copy change would have left
the panel confidently describing a layout it no longer had.

The two are pinned **together** in `hudHidden.test.ts`, because they have to
move together: one test for the reflow rule, one for the `width` override
without which a `max-content` container refuses to shrink and the reflow does
nothing, one asserting the copy no longer names a row, and one asserting the
marker the new copy points at is still drawn. Break-tested by deleting the
`auto-fill` line — the reflow test fails.

**Verified in the browser at 390x844**: twenty-four slots in a 6x4 grid, `0`
elements outside the viewport where there were `12`, and desktop unchanged.

### T-29.02 — Was the backpack the only one?  ✅ **DONE**
Depends: T-29.01 · Size: S

**How it turned out.**

A fix that lands on one panel is worth nothing if four others have the same
fault, so the rest were checked rather than assumed.

**Empirically**, at 390x844, with a scan deliberately stricter than the first
one: it ignores anything reachable through a scrollable ancestor, which is
exactly the check whose absence produced the withdrawn hotbar claim above. HUD
alone, Decorate and Idle — **nothing unreachable in any of them**.

**Statically**, for the three panels that open from the world rather than the
bar (shop, trade post, shipping box) and cannot be reached without walking
there: every one is `width: min(Npx, calc(100vw - 2rem))`, and
`.hud__decor` is a fixed 216px inside a 390px screen. All of them cap to the
viewport by construction.

**`.pack` was the only panel in the file using `width: max-content`, and the
only one using a fixed `repeat()` track list.** That is why it was the only one
that broke — the finding and its blast radius match, which is the thing worth
confirming before believing either.

## Phase 29 status

T-14.11 is in better shape than it has ever been — an axe audit with zero
violations (Phase 27), touch controls (Phase 28), and the panel that broke under
them fixed. It is still not "done", and the honest remainder is small and
specific:

- **The hotbar's scrollability is invisible.** Real, minor, and a design call
  rather than a bug.
- **D-12 is now sharper, not answered.** The camera fits the whole map, which on
  a 390px screen is a very small farm. Phase 28's screenshots are the first
  evidence that actually bears on that decision.

Backlog: **T-14.06** (needs real players), **T-14.08** (needs D-2), **T-14.12**
(needs a lawyer), **T-14.11** (two small items above, both design calls).

---

# The gameplay overhaul — Phases 30-36

## Where this came from

Phases 7-29 built a game that works. This one builds a game worth playing.

The verdict that opened these phases was blunt: *the game is not good for players
to play.* Checked against the code, it is four separate problems that happen to
arrive together:

- **Nothing to do.** 4 crops, 2 animals, 3 tools (one of the nine tiers the art
  ships), 16 items, 1 silent NPC, 2 maps, 5 idle tasks. Content is exhausted in
  about twenty minutes.
- **It feels dead.** A grep across `apps/client/src` finds **zero** `tweens.add`,
  **zero** `cameras.main.shake` and no floating text anywhere. Three particle
  bursts and eight synthesised cues are the entire feedback vocabulary; every
  reward lands as a DOM toast in a corner. There is not one audio file in the
  repo.
- **It is aimless.** No quests, no milestones, no achievements. Onboarding is one
  derived status line that disappears permanently after the first harvest.
- **The pacing is wrong.** `docs/economy.md` documents a **42-minute hole at
  minute 3** of the first session (D-18), and proves the **cow is strictly
  dominated by the chicken** — 30.0 g/h against 39.4, 66.7h payback against
  10.2h — which makes the milk half of the game dead content.

Three things found while planning decided the order, and all three cut the cost
of the plan rather than raising it.

**Progression already exists and the client throws it away.**
`modules/farm/service.ts:571,638-645` returns `{ experience, farmLevel }` on
**every harvest**, and `harvestAll` returns batch totals (`:658,772`).
`player/view.ts:20` already puts `farmLevel` on `SelfPlayer`. A grep for
`experience|farmLevel` across `apps/client/src` returns five hits, four of them
comments or test fixtures; the only real consumer in the entire client is a trade
panel refusal string (`tradePanel.ts:76`). `hud.ts` is 1,185 lines that render
gold and discard the rest. **Making progress visible is not new work — it is
wiring**, which is why it is Phase 30 and not Phase 34.

**Seasons are nearly free.** Measured from the PNG headers: `Tileset Grass
{Spring,Summer,Fall,Winter}.png` are **all 384x640**, and `Tileset Grass Water
{Spring,Summer,Fall}.png` are **all 768x256**. Geometrically identical, so a
seasonal re-skin is a **texture swap behind the existing asset keys** — no
`SHEETS` entry, no gid shift, no map regeneration. Only winter's water sheet
(400x384) is a special case. The premise that seasons would force the map work
was simply wrong.

**The pack contains an entire second game.** Unused today: a five-stage Fishing
Cast/Wait/Bite/Reel/Catch chain, SwordAttack/Archer/Pickaxe/Shovel/Sickle/Swim/
Sleep/Petting, **thirteen work benches** (Cheese Press, Jam Maker, Furnace,
Beehive, Fermentation Barrel...), cave and deep-forest tilesets, five NPC types,
nine river fish icons, enemies, a Clock UI and weather icons.

## The one pillar that moved

`CLAUDE.md` §1 says idle-first, and it still does. What relaxed, deliberately, is
the corollary: **idle mode keeps running the farm loop offline exactly as today,
but new verbs may be hands-on only.** Idle is the baseline that makes an absence
free; active play is where depth lives. T-34.08 records that in code by giving
fishing no `IdleTask` entry, so the decision is discoverable from the source
rather than only from this paragraph.

## What is deliberately NOT in these phases

- **Combat is cut, not deferred.** The art is there and it stays unused. Three
  reasons, the middle one structural: it needs health, damage, death, hit
  detection, enemy AI and respawn, none of which exist; **§4.1 makes it
  architecturally hostile**, because character position is cosmetic and never
  enters a payload, so the server *cannot* adjudicate a melee swing without
  inventing an auto-resolved abstraction that discards the very animations that
  motivated it; and it contradicts the design language running through D-1, the
  feed rules and `WITHERING_ENABLED = false` — **nothing in this game kills
  anything.** If the threat fantasy is wanted later, the shape is a **non-combat
  hazard**: crows that eat a plot's yield unless the already-catalogued
  `scarecrow` is within radius.
- **Scheduled jobs.** Phase 35 is designed so seasons need none (see T-35.03).
  T-14.08 stays blocked on D-2 and that is the correct state.
- **Stamina.** See D-5; the recommendation is now to close it as "no".

## Rules specific to these phases

Both are cost rules, learned the expensive way.

**Art routing.** `config/tilesets.ts` allocates `firstgid` as a running sum over
`SHEETS` then `IMAGES`. Appending to **`IMAGES` shifts nothing** — free at any
time. Appending to **`SHEETS` shifts every `IMAGES` firstgid**, forcing a
`farm.json` regeneration and a `farmMap.test.ts` update. Therefore: single images
go in `IMAGES`; multi-frame sheets go in `SHEETS`, **batched one append per
phase**, never scattered across tasks.

**Every new XP source is a security change, not a balance change.**
`config/level.ts:5-21` is explicit that XP exists primarily as the anti-alt
control behind `TRADE_MIN_FARM_LEVEL`: trading requires level 5 and a 24-hour-old
account so that minting a throwaway scam account is expensive. Milestones,
quests, fishing and artisan goods all shorten that. Every phase that adds one
carries an explicit re-measurement task, which is why T-33.08 and T-34.09 exist
rather than being assumed diligence.

---

# Phase 30 — Progression, made visible

The cheapest phase in the plan and the one everything else consumes. Three of
these tasks are **primitives** — `floatText.ts`, `tween.ts`, `grantReward` — used
by every phase from 31 to 36. Built now they cost one implementation; retrofitted
they cost five edits to five scenes.

**Why this is first.** The counter-argument is "juice on a thin game is polish on
a puddle", and it fails here for a reason specific to this repo: **this is not a
thin game, it is an illegible one.** Twenty plots, chopping, shipping, trading,
VIP, decoration, a house interior, 1,432 tests — and not one number telling the
player they are getting anywhere. Adding a fifth crop adds one more invisible
thing. The marginal value of making the existing 90% visible strictly exceeds the
marginal value of the next 10%.

Where that argument stops: **juice alone does not fix the 42-minute hole.** Minute
0-3 becomes great and minute 3-45 is still empty. That is why the milestone board
(T-30.06 to T-30.09) is in this phase and not a later one — a visible goal board
converts "nothing to do" into "here is what I am working toward", which is the
only cheap fix for a hole caused by design rather than by pricing, and D-18's own
diagnosis says the hole is not about gold.

**The condition: this must be ONE phase.** If polish sprawls across three, then
content-first was the right call after all and this ordering was wrong. Timebox it.

### T-30.01 — Ship the progress the server already computes  ✅ **DONE**
Depends: — · Size: S
Files: `apps/server/src/modules/player/view.ts`,
`packages/shared/src/schemas/index.ts`, `packages/shared/src/config/level.ts`
**Do:** Add a derived `levelProgress` to `SelfPlayer` — current level, XP into
the level, XP needed for the next, and whether the level is capped at
`MAX_FARM_LEVEL`. Derive it with `levelForXp`; store nothing. Nothing renders it
yet: this task exists so the shape is right before any UI depends on it.
**Done:**
- [x] `levelProgress` on `SelfPlayer`, derived from `players.experience`
- [x] A unit test covering level 1, a mid-level, and the level-30 cap where
      "XP to next" has no meaningful value
- [x] Break-tested: returning raw XP instead of the in-level remainder fails the test

**How it turned out.**

**The task assumed this needed writing. Almost none of it did.** `levelProgress`
and its `LevelProgress` interface already existed in
`packages/shared/src/config/level.ts:110-136` — level, experience,
`levelStartXp`, `nextLevelXp`, `toNextLevel` — already re-exported through
`modules/farm/level.ts`, and already covered by three tests in
`modules/farm/level.test.ts`. Somebody built the progress-bar derivation and
then nothing ever called it.

So the finding from the phase intro is **sharper than it was written**. The
claim was that the client discards `experience`/`farmLevel`. The truth is worse:
the server also computes the entire *bar* — the level's start, its end, and the
distance to it — and that was discarded too. The real change here is one line in
`toSelfPlayer` and a field on a type. Everything else was already paid for.

**What that changes for the phase.** T-30.02 is now the only task standing
between the player and a visible level, and it is pure client work — there is no
server-side blocker left. The phase's "this is wiring, not new work" argument
survives contact with the code, and if anything the estimate was too high.

**One decision worth defending: `progress.level` duplicates `farmLevel`.**
`farmLevel` is inherited from `PublicPlayer` and could not be removed without
touching the trade panel and `toPublicPlayer`; `progress.level` comes from the
same `levelForXp` through the same call and cannot disagree. Rather than
deduplicate the field — which would have widened a Size-S task into the trade
panel — the redundancy is **pinned by a test** that asserts the two agree across
seven experience values including both boundaries. If a future session ever
stores a level instead of deriving one, that test is what catches it.

**`toPublicPlayer` got a test it did not have.** Progress is self-only: another
player's exact distance to the trade gate is precisely what someone farming alt
accounts would shop for, and §4.1's view boundary exists so that a new field is
invisible until someone deliberately exposes it. The new test asserts
`progress`, `experience`, `gold` and `email` are all absent from the public
shape — so the boundary is now guarded by assertion rather than by the author
having remembered.

**Break-tested twice, as the rules require.** Replacing
`levelProgress(player.experience)` with `levelProgress(0)` fails **four** tests
(the mid-level, the cap, the agrees-with-`farmLevel` sweep and the trade-gate
check). Adding `progress` to `toPublicPlayer` fails the leak test alone. Both
restored; 6/6 pass.

`pnpm -r typecheck` clean across all four workspaces, `pnpm test` green at
**1,826 tests** (server 45 files / 961 tests, up 1 file and 6 tests). Worth
noting that the client typechecks unchanged despite `SelfPlayer` gaining a
**required** field — nothing in the client constructs one, it only reads them,
which is why a required field was safe here and would not have been on a shape
the client builds.

### T-30.02 — The HUD shows the player is getting somewhere  ✅ **DONE**
Depends: T-30.01 · Size: M
Files: `apps/client/src/game/{hud,levelBar,levelBar.test}.ts` (levelBar new),
`apps/client/src/styles/hud.css`, `apps/client/src/net/farm.ts`,
`apps/client/src/game/scenes/Farm.ts`
**Do:** An XP bar and level pip in the HUD, fed by `levelProgress` from the poll
and updated immediately from the `experience`/`farmLevel` the harvest response
**already returns** — no extra request. Contrast must clear the ratios pinned by
`styles/contrast.test.ts`, and the bar must survive the 390x844 layout Phase 29
fixed.
**Done:**
- [x] Level and XP visible without opening any panel
- [x] Harvest updates the bar from the harvest response, not the next poll
- [x] Contrast test extended to the new colours and passing
- [x] Verified at 1440x900 and 390x844, nothing overflows

**How it turned out.**

**The client's own type was discarding the data too, and that is a third layer
of the same fault.** T-30.01 found the server computing progress nobody read.
This task found that `net/farm.ts`'s `HarvestResult` declared only
`plotId`/`itemId`/`quantity` — so `experience` and `farmLevel` arrived on the
wire, were parsed, and were dropped by a type that never mentioned them. Adding
them was a **declaration, not a feature**: no server change, no new endpoint.
The HUD can now move the bar on the action that earned it instead of waiting up
to `POLL_MS` (20s), which matters because a bar that sits still through the
harvest and jumps twenty seconds later teaches the player the number is
unrelated to what they did.

**The bar's arithmetic was extracted to `game/levelBar.ts`.** Five lines inside
a 1,200-line DOM class cannot be tested without building a HUD, and the
interesting failures here are numeric: a divide-by-zero at the level cap, a
percentage that leaves the track, a label promising level 31. It follows
`effects.ts`'s precedent — pure spec beside the scene, 13 tests, no DOM.

**At the cap the bar fills rather than empties.** `nextLevelXp` is null at
`MAX_FARM_LEVEL`, so there is no denominator and any percentage is a fiction —
but 0% reads as "you have made no progress" to a player who has just finished
the game, which is the worse of the two available lies. The label carries the
truth (`Lv 30 · max`).

**A break-test found a test that could not fail, and the fix is the honest
one.** The "never leaves the track" case passed with the `Math.max`/`Math.min`
clamp deleted — because a level derived from an experience always contains that
experience, so the clamp is **unreachable through `levelProgress`**. Rather than
delete the clamp (it guards the case where the two disagree, which is one
`FARM_LEVEL_XP` retune away) or leave a test that guards nothing, the clamp is
now tested with a hand-built `LevelProgress` whose experience falls outside its
own level. That is the input that actually reaches it. Deleting the clamp now
fails.

**And the browser caught a CSS decision that was simply wrong.** The chip was
written `flex-shrink: 1` on the theory that giving up track was cheaper than
pushing a button off the bar. Measured at 1440x900 it rendered a **34px track**
— on a viewport with room to spare — because `.hud__bar` is `flex-wrap: wrap`
and a shrinkable item gets squeezed *before* the row wraps. A 34px progress bar
is a dash. `flex: none` makes it wrap like every other chip, and the track
measures **102px**. Nothing static would have caught this; the unit tests were
green throughout.

**A second measurement corrected a comment rather than code.** The trim added
for small screens went into `@media (max-height: 820px)` — which is the
SHORT-viewport rule from T-18.03 that buys camera rows back, not a narrow one.
So 1280x720 gets the 70px track and a 390x844 phone keeps the full 102px. The
code was right and the comment claimed "narrow widths"; the comment was fixed,
because a comment that misnames its own media query is how the next person puts
a width rule in a height block.

**Verified in a real browser**, over CDP rather than the MCP Playwright server —
that server wants a `chrome` channel binary this machine does not have, the same
gap Phase 24 recorded, while `chromium-1234` is present. A fresh account was
registered through the real API from the page origin so the session cookie
lands as a person's would.

| Viewport | Level | Track | Fill | Inside viewport | Unreachable HUD elements |
|---|---|---|---|---|---|
| 1440x900, 0 xp | `Lv 1` | 102px | 0% | yes | 0 |
| 1440x900, 120 xp | `Lv 2` | 102px | 38% (36px) | yes | 0 |
| 390x844 | `Lv 2` | 102px | 38% | yes | **0** |
| 1280x720 | `Lv 2` | 70px | 38% (24px) | yes | **0** |

38% is right: 120 xp with level 2 spanning 80→184 is 40/104. **The poll path was
proved separately** — experience was moved directly in the database and the bar
reconciled on its own next poll with no interaction, which is the path
`setExperience` is only an optimisation over. Console clean at every size.

`pnpm -r typecheck` clean, `pnpm test` green at **1,839 tests** (client 510 →
523).

**One thing deliberately not done.** A `private level` field was added to track
the last rendered level so T-30.05 could detect a level-up — and then removed,
because `noUnusedLocals` correctly flagged it as never read. Pre-building state
for the next task is how dead code gets in. T-30.05 adds it when it has a use.

### T-30.03 — `floatText.ts`, a pure spec  ✅ **DONE**
Depends: — · Size: S
Files: `apps/client/src/game/floatText.ts` (new),
`apps/client/src/game/floatText.test.ts` (new)
**Do:** A pure, Phaser-free, fully unit-tested spec module in the shape of
`effects.ts`'s `BURSTS`: given a kind (`gold`, `item`, `xp`, `refused`) and a
value, return text, rise distance, duration, tint and font size. No Phaser
import; the scene does the drawing. Honour `prefers-reduced-motion` by exposing a
reduced variant, the way `motion.ts` already does.
**Done:**
- [x] Zero Phaser imports — a test asserts it
- [x] Every kind has a spec, and a test pins each one's text formatting (`+180g`,
      `+2 Potato`, `+24 xp`)
- [x] Reduced-motion variant defined and tested
- [x] Break-tested: changing a duration fails its test

**How it turned out.**

Straightforward, and shaped directly on `effects.ts`: `FloatText` is data,
`floatFor` is a pure function, and `Farm.playFloat` (T-30.04) is the part that
knows Phaser exists. Three kinds — `gold`, `item`, `xp` — plus `floatLifetimeMs`
in the same shape as `burstDurationMs`.

**The tints are NOT sampled from the art, and that is the one place this
deliberately departs from `BURSTS`.** `effects.ts` argues at length that a
burst must be drawn in colours already on screen or it reads as a UI overlay.
A float is the opposite case: it *is* a readout, so it is tinted to match the
HUD element it is telling you about — gold in the gold chip's soil tone, XP in
the same green as T-30.02's level-bar fill, produce in panel cream. That lets
the eye follow a number from where it was earned to where it is counted, and
tinting it like the tile underneath would only make it harder to read.

**Zero returns null, and the case is real rather than theoretical.**
`xpForHarvest` returns 0 for an unknown crop id, so without the guard a harvest
could raise a `+0 xp` off a tile. A `+0` is not an event, and floats that
announce non-events are how a player learns to stop reading the numbers.
`NaN` and `Infinity` are refused by the same check.

**Reduced motion stops the travel, not the message.** `risePx` goes to 0 and
the label lingers 200ms longer — same words, same colour, same size. Deleting
the label instead would take information away from precisely the players most
likely to want it stated plainly, which inverts what the setting is asking for.
The tests assert the text/tint/size are unchanged, so a future "simplification"
that drops the label under reduced motion fails.

**`FLOAT_STACK_PX` exists because a harvest is three floats in one frame** —
produce, gold and XP, all at the same tile. Drawn at one offset they are one
smear. A test also asserts the spacing is at least as large as the biggest
font, so the constant cannot drift below the text it separates.

**The purity test failed on its own module's prose, and the fix is worth
recording.** The first version asserted `/\bPhaser\./` against the raw source
and failed — on the doc comment saying the scene "hands these to Phaser."
Describing the boundary is exactly what that comment is for, and a purity
check that cannot tell prose from code punishes a file for explaining itself.
Comments are now stripped before the check, with a third test asserting **the
stripper actually strips**, because otherwise the two checks above it would
pass vacuously.

**Break-tested five ways**, all of which fail as they should: changing the gold
duration (1), removing the zero guard (2), ignoring `reducedMotion` (1),
allowing fractions (1), and collapsing `FLOAT_STACK_PX` to 0 (2).

`pnpm -r typecheck` clean, `pnpm test` green at **1,857 tests** (client 523 →
541). Nothing draws these yet — T-30.04 wires them.

**BUG-30, found incidentally and not by looking for it.**
`modules/inventory/chest.integration.test.ts > POST /api/inventory/transfer >
survives simultaneous transfers in opposite directions` **failed once** during
a full-suite run and then passed 3/3 in isolation and on a second full run. It
is unrelated to this task, which touched only two new client files. A
concurrency test that fails one run in five is either a real race under load or
a test with a timing assumption, and both are worth knowing about before launch
— it is recorded here rather than dismissed as noise, and it is a good first
target for `qa-auditor`.

### T-30.04 — Rewards appear where they happen  ✅ **DONE**
Depends: T-30.03 · Size: M
Files: `apps/client/src/game/scenes/Farm.ts`, `apps/client/src/net/animals.ts`,
`apps/client/src/game/{levelBar,levelBar.test}.ts`,
`apps/client/src/game/floatText.ts`
**Do:** A `Farm.playFloat(kind, value, tileX, tileY)` beside the existing
`playBurst`, drawing the T-30.03 spec at the tile. Wire it to harvest (`+2
Potato`), gold (`+180g`) and XP (`+24 xp`). The corner toast stays for refusals
and errors — the point is that a *reward* now appears on the thing that produced
it rather than in the corner.
**Done:**
- [x] Harvest shows produce, gold and XP at the plot
- [x] Collecting from an animal shows the same at the animal
- [x] Multiple floats stagger rather than overlapping illegibly
- [x] Screenshotted — this is canvas, so the DOM snapshot proves nothing

**How it turned out.**

**The same omission, a third time.** `net/animals.ts`'s `CollectResult`
declared only `animalId`/`itemId`/`quantity`, while
`modules/animals/service.ts` has returned `experience` and `farmLevel` since
T-2.09. That is now three client types — `SelfPlayer` (T-30.01),
`HarvestResult` (T-30.02), `CollectResult` (here) — that dropped progression
the server was already sending. It is worth naming as a pattern rather than
three coincidences: **the wire was never the problem; the client's own type
declarations were**, and the fix each time was a declaration.

**Gold has exactly one place it can float, and it is not the plot.** The task
line says "wire it to harvest, gold and XP", but harvesting grants no gold —
gold arrives from selling (a DOM panel, no tile) and from the shipping box.
So the one gold float in the game rises off **the shipping box** when a payout
settles on a poll, which is the only gold event in the game with a real
location. The merchant's sales stay a toast, correctly: a panel is already
where the player is looking.

**`xpGained` exists because the server sends a lifetime total, not a delta** —
and that is the right thing for it to send, because a total is idempotent under
replay while a delta double-counts (§4.5). The delta is computed against
`lastExperience`, **seeded from the poll**, which is what stops the first
harvest of a session reading `+4,812 xp`. It also stops an idle-mode absence
— where the server grants XP with no client action at all — from surfacing as
one enormous float on the next manual harvest. It clamps at zero: with a
20-second poll, a response arriving after a poll that already counted it is
ordinary, and a negative float claiming the player *lost* experience describes
something the game has no mechanic to do.

**Only surviving floats are stacked.** The offset is indexed over the filtered
list, not the input, so a zero-XP action does not leave a gap where a label
would have been.

**Unlike `playBurst`, this runs under reduced motion.** A burst is decoration
and is suppressed outright; a float carries a number, so T-30.03's decision
applies — the travel goes, the label stays.

**The browser found a real quality defect that no test could.** The first run's
floats were visibly blurry against pixel art that is crisp everywhere else:
Phaser rasterises text at 1x and the camera then scales it by an integer zoom,
so an 8px label was being stretched over 24 screen pixels.
`setResolution(round(camera.zoom))` renders the glyphs at final size. The
difference between the harvest screenshot (before) and the animal one (after)
is obvious side by side.

**Verified through the real keyboard path, which took five attempts and every
one of them was informative.** Driving the harvest through `fetch` would have
proved nothing — the float is drawn inside `Farm.send()`, which only a real key
press reaches. Getting there required, in order: **`play.html`** is the game
(the root URL is the marketing page); **Phaser matches keys on `keyCode`**, so
a CDP dispatch with `windowsVirtualKeyCode: 0` reaches the page and moves
nothing (the digit keys worked the whole time, which is what made this
confusing — the hotbar reads `event.code`); plots need **`unlocked=true`**, as
a fresh account has 6 of 20; and a plot needs **`growth_duration_ms`** set, not
just `crop_id`, or `growthAt` reports `stage: -1` and the server refuses the
harvest. The last one is the useful finding: **`crop_id` alone does not make a
plot planted**, and anything writing plot state outside `plant()` must set both.

| Case | Result |
|---|---|
| Harvest, empty hand, ripe onion | toast `Harvested 3 × Onion`, floats `+3 Onion` and `+96 xp` at the plot, xp 500 → 596 |
| Collect, faced chicken | toast `Collected 18 × Egg`, floats `+18 Egg` and `+324 xp` at the bird, xp 596 → 920, **level 5 → 6 on the HUD bar** |

Console clean throughout. `pnpm -r typecheck` clean, `pnpm test` green at
**1,861 tests** (client 541 → 545).

**One `exactOptionalPropertyTypes` note for later tasks**: `floatFor`'s options
had to be declared `string | undefined` rather than `string`, or no caller
could forward an `itemId` it holds as possibly-undefined without narrowing
first. That flag is on across this repo and will bite the same way again.

### T-30.05 — `tween.ts` presets, and the first camera shake in the game  ✅ **DONE**
Depends: T-30.03 · Size: M
Files: `apps/client/src/game/{tween,tween.test}.ts` (new),
`apps/client/src/game/{scenes/Farm,hud}.ts`, `apps/client/src/styles/hud.css`
**Do:** Named tween presets — `pop`, `shake`, `flash` — as pure specs like
`floatText`, plus their first three uses: the plot pops on harvest, the gold
readout bounces when it changes, and the camera shakes on level-up. Every one
must collapse to nothing under `prefers-reduced-motion`. This is the client's
first `tweens.add` and first `cameras.main.shake`; keep them in this module so
they never get hand-rolled into a scene.
**Done:**
- [x] Three presets, each unit-tested as data
- [x] Reduced-motion disables all three, asserted by test
- [x] Level-up is unmissable — screenshot it
- [x] Break-tested: removing the reduced-motion guard fails a test

**How it turned out.**

**A correction to this task's own text: it is not the client's first
`tweens.add`.** T-30.04 added one for the float labels an hour earlier. It *is*
the first `cameras.main.shake` and the first `cameras.main.flash`, and the
module still earns its place for the reason given — motion invented at each
call site drifts, and the reduced-motion check gets remembered in two places
out of three.

**"Reduced motion disables all three" turned out to be the wrong requirement,
and the code deliberately does not do it.** The pop and the shake go to null;
**the flash does not.** The flash is the only thing that says *you levelled up*
at the moment it happens — a bar quietly resetting to empty is not an
announcement — so it is shortened to 120ms rather than deleted. A colour wash
is not the kind of movement `prefers-reduced-motion` is about, and removing it
would leave a reduced-motion player with no level-up feedback at all. The
checkbox is ticked against what the test asserts, which is that each effect
does the right thing rather than that all three vanish.

**The shake is deliberately gentle — `0.004`, tested with a ceiling.** A
level-up is good news and a hard shake is the vocabulary of damage. This is
also the only camera shake in the game, so it has no siblings to be consistent
with and the restraint has to be encoded in the number; the test pins it under
`0.006` so a future "make it punchier" is a decision rather than a drift.

**The flash is the same green as the XP float and the level bar**, asserted
against `FLOAT_TINTS.xp` rather than copied as a literal, so a level-up reads
as the existing system announcing itself louder rather than as a new effect
to learn. If someone retunes the XP colour, that test fails until both move.

**T-30.02's removed field came back, and this vindicates removing it.** `level`
was added there for exactly this and deleted the same task when
`noUnusedLocals` pointed out nothing read it. It now has a consumer, plus a
`levelSeen` flag — without which the first poll of every session would fire a
level-up for a player who was already level 12 when they opened the tab. The
comparison is `>` rather than `!==`: the only way a level can go *down* is a
poll landing behind an optimistic `setExperience`, and celebrating that would
be absurd.

**The gold bump is CSS, not a tween, and that is a real design call rather than
laziness.** The gold chip is DOM, so a stylesheet gets
`prefers-reduced-motion` for free with no branch in TypeScript to forget. It
scales without translating — a number that slides at the moment it changes is
briefly unreadable, which is exactly when the player is looking at it — and a
test reads the keyframes to assert there is no `translate`. It also needs the
`offsetWidth` reflow between removing and re-adding the class, or the browser
coalesces both changes and gold bumps once per session; that is pinned too.

**A cleanup that came out of it:** four separate places were writing
`this.gold` and `goldEl.textContent` by hand. They now all route through
`setGold`, so the bump cannot be forgotten at one site — and the duplication
that made that possible is gone.

**Break-tested five ways**, all failing correctly: pop ignoring reduced motion,
shake ignoring reduced motion, the shake intensity raised to 0.02, the flash
recoloured away from the XP green, and the CSS reduced-motion guard deleted.

**Verified in the browser** by seeding an account at 440 xp — one onion harvest
(96) crosses 494 into level 5 — and screenshotting 140ms into the frame. The
capture shows the whole canvas washed green, **the map visibly displaced by the
shake**, the `+96 xp` and `+3 Onion` floats rising, the toast, and the HUD
already reading `Lv 5`. Console clean.

`pnpm -r typecheck` clean, `pnpm test` green at **1,876 tests** (client 545 →
560).

### T-30.06 — `config/milestones.ts`  ✅ **DONE** (one checkbox honestly unmet — see below)
Depends: — · Size: M
Files: `packages/shared/src/config/milestones.ts` (new),
`packages/shared/src/config/milestones.test.ts` (new),
`packages/shared/src/config/index.ts`
**Do:** An ordered table of `{ id, requirement, reward }` covering the first
several hours — first till, first harvest, first sale, first animal, first
shipment, ten harvests, level 5. Requirements must be **derivable on read** from
counters that already exist; the only new state is which milestones have been
claimed. Rewards are small and mostly *items and seeds*, not gold — D-18 is clear
the first-session hole is not a gold problem.
**Done:**
- [x] Every requirement is computable from existing state; a test asserts no
      milestone needs a counter that does not exist
- [x] Rewards are integers, and no reward grants a tool tier or anything untradeable-but-valuable
- [x] Ordering is total and tested
- [ ] ~~The first three are reachable inside the first ten minutes~~ — **only two
      are, and it cannot be three until T-31.05.** See below.

**How it turned out.**

**The requirement list is short because most of the obvious counters are not
monotonic, and that is the finding.** The task says requirements must be
derivable from existing state; the sharper constraint turned out to be that a
requirement which can become **false again** is a milestone that appears, goes
unclaimed, and vanishes — worse than never offering it.

Checked against the schema, `plant()` resets **both** `harvested_at` and
`watered_at` to null (`modules/farm/service.ts`). So "has harvested a crop" is
not a lifetime fact at all — it means "is currently sitting empty", and a
milestone reading it would flicker off the moment the player replanted. Only
six facts survive: `plotsTilled` (`tilled_at` is deliberately never cleared —
harvest leaves workable soil), `experience`, `farmLevel`, `animalsOwned` (there
is no endpoint that removes an animal), `shipmentsMade` (rows persist after
payout) and `plotsUnlocked`. `experience` is the honest proxy for "has
harvested something", because harvesting and collecting are the only two things
that grant it.

A test walks five increasing progress states and asserts **no milestone ever
un-earns itself**, plus a second that asserts no requirement kind name matches
`/harvest|water/` — so the specific mistake above cannot be reintroduced by
someone who did not read this paragraph.

**The last checkbox is not ticked, and padding it would have been trivial.**
Two milestones are reachable in the opening minutes — till one plot, till all
six. A third is not: with the current crop table the fastest yield is a
**45-minute leek**, so nothing can land inside ten minutes until **T-31.05**
ships the sub-15-minute starter crop. Inserting a filler `plotsTilled: 3`
between them would have made the checkbox true and the board worse — three
consecutive "till more soil" goals. The test states the gap explicitly and
names T-31.05, so the box can be ticked when that lands.

Worth noting this cuts against the phase intro's claim that the milestone board
alone answers the attention half of D-18. It gives the player something to
*complete* at 0:30 and 0:04, and something to *watch* during the hole
(T-30.09's board shows the next goal), but the hole itself still needs the
fast crop.

**Rewards are seeds and feed, not gold** — D-18's finding applied directly: the
first-session problem is a wait, and gold does not shorten a wait. Seeds put
more in the ground, which is what makes the next session sooner. Exactly **one**
milestone pays gold (level 5, 250g), and it is the one that marks
`TRADE_MIN_FARM_LEVEL` — so it doubles as the only announcement a player gets
that trading has opened. A test asserts there is exactly one gold reward and
that it is that one, so a future "just add a little gold here" is a decision.

**No milestone may grant a tool.** Tools are `stackLimit: 1`, unsellable and
untradeable, so a free copy both duplicates something the game treats as unique
and undercuts `axe_wood`'s 200g price. `isGrantableItem` enforces it and is
tested against both a tool and an unknown id.

**Break-tested five ways**, all failing correctly: granting `axe_wood`, adding
a second gold reward, breaking the within-kind ordering, granting an unknown
item, and asking for a level past `MAX_FARM_LEVEL`.

`pnpm -r typecheck` clean, `pnpm test` green at **1,894 tests** (shared 265 →
283). Nothing reads this table yet — T-30.07 grants from it, T-30.09 draws it.

### T-30.07 — `grantReward`, the single place rewards move  ✅ **DONE**
Depends: T-30.06 · Size: M
Files: `apps/server/src/modules/progression/{service,service.integration.test}.ts`
(new), `apps/server/src/db/schema.ts`, `apps/server/drizzle/0013_*`,
`packages/shared/src/errors.ts`, `apps/client/src/net/errors.ts`,
`docs/economy.md`
**Do:** `grantReward(tx, playerId, reward)` — transactional, granting gold, items
and XP through one function. **Quests in Phase 33 use this unchanged**; if they
grow their own, every duplicate adds a `docs.test.ts` gold-writer row and a
`docs/economy.md` faucet entry for the same faucet. Plus a `milestone_claims`
table (playerId, milestoneId, claimedAt) with a uniqueness constraint that makes
double-claiming impossible at the database level, not merely unlikely.
**Done:**
- [x] One transaction; a partial failure grants nothing
- [x] A full backpack fails with `INVENTORY_FULL` and grants **no** gold either
- [x] Unique constraint on (playerId, milestoneId); a second claim is refused by the DB
- [x] Migration applies cleanly to an empty database
- [x] Break-tested: dropping the unique constraint fails the double-claim test

**How it turned out.**

**Insert first, then pay — and the order is the whole design.** The unique index
on `(player_id, milestone_id)` is the guard, not the service's "is it already
claimed?" read. Two concurrent requests can both read "not claimed" and both
proceed; only one `INSERT ... ON CONFLICT DO NOTHING` returns a row, and the
loser's whole transaction rolls back with its items and gold. Checking first and
trusting the check makes double-claiming *unlikely*; this makes it impossible,
which is the standard §4.3 sets for anything that mints value. The
`Promise.allSettled` test fires two claims at once and asserts exactly one
fulfils and the item count moved once.

**Inside `grantReward`, items are granted before gold, and that ordering is also
load-bearing.** Gold cannot fail — there is no cap — while `addItem` throws
`INVENTORY_FULL`. Doing the failing part first means the throw happens before
anything has been minted. A test fills all twelve slots and asserts the claim
raises `INVENTORY_FULL`, gold is unchanged, **and no claim row was written** —
so the reward is still there once room is made, rather than a milestone that
paid nothing and can never be claimed again.

**Read helpers take `Queryable`, writers take `Tx`.** `db/tx.ts` already
distinguishes them for exactly this reason and `exactOptionalPropertyTypes`
enforced it: passing the pool where a transaction handle was declared is a type
error, which is the right outcome — `progressFor` and `boardFor` never write and
are useful both standalone and inside a larger transaction.

**`docs.test.ts` did its job and failed the build.** The moment
`progression/service.ts` wrote `players.gold`, the ledger test went red until
`docs/economy.md` named it. That is the forcing function working exactly as
designed, and it is worth recording that it fired unprompted rather than being
remembered. The faucet row states the whole board's lifetime gold: **250g,
once** — the `level_5` milestone, which is the trade gate.

### The mistake, and what it cost

**I ran `git checkout apps/server/drizzle/meta` to clean up after the
break-test, and that directory had uncommitted changes.** `_journal.json` was
modified in the working tree (Phases 15-29 are not committed), so the checkout
reverted it to HEAD and **silently dropped the journal entries for migrations
0011, 0012 and 0013** — two of which predate this task entirely.

It was recoverable because the snapshot chain (`prevId` linking 0011 → 0012 →
0013) was intact and the `.sql` files were untracked, so they survived. The
journal was rebuilt from the snapshot chain with timestamps taken from file
mtimes, and the two stray artifacts my break-test had generated (0014 dropping
the index, 0015 re-adding it) were deleted. Verified by creating a **fresh
database and migrating it from 0000**: 18 tables, and
`milestone_claims_player_milestone_key` present.

**A second casualty took longer to spot.** The break-test had applied the
index-dropping migration to the **test** database, and the migration that
restored it was one of the strays I then deleted — so `tillhaven_test` was left
without the unique index. The two double-claim tests passed in isolation
(fresh DB) and failed in the full suite, which reads exactly like flakiness and
is not. Dropping `tillhaven_test` so `globalSetup` rebuilds it fixed it.

**The rule this earns:** never `git checkout` a path in this repo while Phases
15-29 are uncommitted — `git status` first, and prefer restoring from a copy
made before the edit, which is what every other break-test in this session did
correctly.

`pnpm -r typecheck` clean, `pnpm test` green at **1,906 tests** (server 961 →
973). No route yet — T-30.08 exposes it.

### T-30.08 — Progression endpoints  ✅ **DONE**
Depends: T-30.07 · Size: S
Files: `apps/server/src/modules/progression/{routes,service}.ts`,
`packages/shared/src/schemas/index.ts`, `apps/server/src/app.ts`,
`apps/client/src/net/progression.ts` (new), `apps/client/src/net/errors.ts`
**Do:** `GET /api/progression` (milestones with derived completion and claim
state) and `POST /api/progression/claim`. Zod schema in
`packages/shared/src/schemas/`, rate limited, ownership checked, `runIdempotent`,
machine-readable errors with player-facing lines.
**Done:**
- [x] Claiming an unearned milestone is refused with a code
- [x] Claiming twice grants once — tested concurrently, not just sequentially
- [x] Replayed idempotency key does not double-grant
- [x] Another player's id is refused

**How it turned out.**

Small, because T-30.07 did the hard part. `GET /` returns the board and `POST
/claim` takes a milestone id; both are 13 integration tests driven through
`app.inject`, so Zod, the rate limit, `requireAuth`, `runIdempotent` and the
error handler are all in the path — the layers a service-level test skips.

**Idempotency and the unique index are not redundant, and the distinction is
worth stating because it looks like belt-and-braces.** They catch different
failures. A **replayed key** is one flaky connection retrying: `runIdempotent`
returns the *first response*, so the player sees their reward rather than a
confusing `MILESTONE_ALREADY_CLAIMED` for something they did once. **Two
distinct keys arriving together** is two open tabs, and only the unique index
stops that double-paying. Both are tested separately, and the difference in
expected outcome — `200` with an identical body versus `409` — is the proof
they are doing different jobs.

**`GET` is a pure read, unlike shipping's.** Shipping's `GET` settles payouts on
the way past because settlement has no job behind it. Nothing here settles:
every `earned` flag is recomputed from counters that already exist. Rated at
120/min to match the farm poll it will be refreshed alongside; `POST /claim` is
30/min, because a board of ten one-time goals cannot legitimately be claimed
faster and the endpoint mints value.

**One break-test did not fail, and the reason is worth recording rather than
patching.** Deleting `app.addHook('preHandler', requireAuth)` left all 13 tests
green — because `currentPlayer()` throws `UNAUTHENTICATED` itself, so anonymous
callers get their 401 either way. The hook is real defence-in-depth (it rejects
before the handler body runs at all) and every other module has it, so it
stays; but the anonymous-caller tests pin the **behaviour**, not the hook, and
that is the right thing to pin. Removing Zod parsing and removing
`runIdempotent` both fail as they should.

**"Another player's id is refused" is not expressible, which is stronger than
refused.** Neither payload carries a player id — the only identity available is
the session cookie's. The test asserts the consequence instead: one account
claiming `break_ground` leaves a second account's board unclaimed and its
`milestone_claims` rows empty.

`nextGoals` in the client's net module puts **claimable milestones first**, then
unearned ones, and drops claimed ones entirely — a reward waiting to be
collected is the most useful thing a panel can point at, and a wall of ticks is
something the player has to read past. T-30.09 draws it.

`pnpm -r typecheck` clean, `pnpm test` green at **1,919 tests** (server 973 →
986).

### T-30.09 — The milestone board  ✅ **DONE**
Depends: T-30.08, T-30.02 · Size: M
Files: `apps/client/src/game/{milestonePanel,milestonePanel.test}.ts` (new),
`apps/client/src/game/hud.ts`, `apps/client/src/game/scenes/Farm.ts`,
`apps/client/src/styles/hud.css`
**Do:** A HUD panel showing the next three goals and a claim button on completed
ones, **open and useful from minute zero** — this is what a new player looks at
during the 42-minute hole. Reuse the existing panel styling; Phase 33's quest log
will share this panel, so shape it for two lists now.
**Done:**
- [x] Next three goals visible; completed ones claimable
- [x] Claiming plays the T-30.04 float text and refreshes state
- [x] Keyboard reachable, focus handled via `lib/focus.ts`
- [x] Fits 390x844 without overflow (the Phase 29 check)

**How it turned out.**

**"Open from minute zero" was read as a requirement, not a preference, and it
is the only interesting design call in the task.** The board opens itself —
the one panel in the game that does. A board behind a button a new player has
no reason to press does not fix F-1's 42-minute hole, because the player it is
for does not know there is a list of things to work toward. Closing it is
remembered per device in `localStorage` (`readBoardOpen`, the same reasoning as
mute in `sound.ts` — it decides nothing about the farm, and someone who knows
the game on their laptop is still new to it on their phone), so it asks once.

**A popover, not a modal, and `lib/focus.ts` is what says why.** It does not
carry `MODAL_ATTR`: reading *"till all six of your starting plots"* while
walking to the sixth plot is the whole point, and a board that froze the
character would break the feature it exists for. That is the rule `focus.ts`
already states — "a dialog you are reading takes input, not any floating
element" — with the decor tray as the precedent.

**The browser found a defect no test could have, and the FIRST fix for it was
wrong in an instructive way.** Opening the bag over the board and pressing
Escape closed both — and because the board persists "closed", one press over
the bag silenced it for every future session. `stopPropagation` cannot fix it,
which T-18.13 already knew: every panel listens on `document`, and stopping
propagation does not stop other listeners on the same node. So the board asked
`isModalOpen()` instead — and that still failed, because by the time the
board's bubble handler runs the bag's handler has already hidden the bag, so it
asks "is a modal open" a microsecond after the modal stopped being one and gets
a truthful "no". **The answer has to be read before any panel reacts.** A
capture-phase listener on `document` records `isModalOpen()` and the bubble
handler consults the recording. Worth stating generally: *any* panel deciding
"is this key mine" from live DOM state is reading state its siblings have
already mutated.

**Three panels want the left-hand column, so they are mutually exclusive.** The
decoration tray and the house controls both sit at `top: 72px; left: 1rem`, and
two overlapping popovers is something a player reads as broken. Exclusive
rather than repositioned, because the tray's height is its contents' — there is
no second slot that stays right as the catalogue grows. `closePanels()` closes
the board on the way indoors for the same reason.

**That made `hide()` need to distinguish two kinds of close**, which is not the
detail it looks like: the board persists "closed" off `onOpenChange`, so a board
that stayed shut forever because someone once opened their front door would be
the panel quietly deciding it was not wanted. `onOpenChange(open, remember)`
separates "the player closed it" from "it got out of the way"; `aria-expanded`
follows every change regardless, which is why it is one call and not two.

**The float rises off the character, and that is the first reward in the game
with no object of its own.** Every other float belongs to the thing that
produced it — the plot, the animal, the shipping box. A milestone is paid by a
panel for work done across the whole farm, so `standingTile` (not `facedTile` —
the reward is not aimed at anything) is the honest answer, and it is where the
seeds have just landed in the bag the player is carrying. **No toast**, which
is T-30.04's rule applied rather than forgotten: a toast is for a refusal, and
the float plus the `buy` cue is the reward.

**The phone screenshot changed a decision.** At 390x844 the board fits with no
overflow and no internal scrolling — the Phase 29 check passes — and it still
covers most of the farm, because most of the farm is not very much at that
size. So `boardAutoOpens` gates the *automatic* open at 700px, the same
breakpoint the stylesheet narrows the panel at, so "cramped here" and "should
not barge in here" cannot drift. A remembered *open* still opens at any width:
that is the player asking.

**One break-test did not fail, and the reason is worth recording rather than
patching** (the same shape as T-30.08's `requireAuth` note). Removing
`!view.claimed` from `claimable` left all tests green, because `nextGoals` has
already dropped every claimed goal — nothing reaching `goalRows` can be both.
It stays because the two cover each other: Phase 33's quest log is a plausible
surface that renders the whole board without going through that filter, and a
Claim button on an already-claimed goal is a button that only ever answers
`MILESTONE_ALREADY_CLAIMED`. Everything else broke as it should — the earned
short-circuit, the percentage clamp, the claim prompt, gold-before-items,
bypassing `nextGoals`, the open-by-default, and the width gate.

**Shaped for two lists as asked**, without dead markup: `BOARD_SECTIONS` is an
array the panel builds its lists from, holding one entry today. Phase 33's
quest log arrives as an entry plus a source for its rows — not as a second
panel with its own open state, its own Escape handler and its own place on
screen for the player to learn.

**Two things found on the way that were not this task's fault.** The dev
database had never had T-30.07's migration applied, so `GET /api/progression`
was a 500 in the browser while 986 server tests passed against the test
database — `pnpm --filter @tillhaven/server db:migrate` fixed it, and it is a
reminder that a green suite says nothing about the dev DB. And the Playwright
**MCP server is configured for `/opt/google/chrome/chrome`, which is not
installed on this machine**; the verification ran through `playwright-core`
driving the bundled chromium instead. Same engine, but the MCP tools are
unusable until Chrome is installed or the server is pointed at chromium.

| Case (1440x900 unless noted) | Result |
|---|---|
| Fresh account, first load | Board open unprompted: Break ground 0/1, A field of your own 0/6, First harvest 0/1, each with its reward named |
| One plot tilled, board re-read | `Break ground` jumps to the top on the rust plate, `Done — claim your reward`, Claim button; `A field of your own` moves to 1/6 |
| Claim clicked | Leek Seeds 4 → 6 in the bag and the hotbar, `+2 Leek Seeds` floats off the character, board advances to the next three |
| `G`, `G` | Closes, reopens; `aria-expanded` follows both |
| Escape, no modal | Closes; `tillhaven.goals` = `closed`; still closed after a reload |
| Escape, bag open | Bag closes, **board survives** (the fix above) |
| Typing `greenhollow` into a focused input | Input gets all 11 characters, board unmoved |
| Decorate opened over an open board | Board hides, tray shows; `G` reverses it exactly |
| Fresh player at 390 wide | Board does NOT open itself; Goals button in the bar is the way in |
| Fresh player at 1440 wide | Board opens itself |
| 390x844, board opened by hand | 228x397 at (16,72); `scrollWidth === clientWidth === 390`; no internal scroll |

Console clean throughout (one headless-GPU `ReadPixels` warning from WebGL,
unrelated). `pnpm -r typecheck` clean, `pnpm test` green at **1,946 tests**
(client 560 → 587).

### T-30.10 — Log the new faucet  ✅ **DONE**
Depends: T-30.07 · Size: S
Files: `docs/economy.md`
**Do:** Add `modules/progression/service.ts` to the gold-writers table and a
milestone row to the faucets table with the total gold and items the full
milestone list injects. `docs.test.ts` fails the build until this is done, which
is the intended forcing function. State the lifetime total explicitly — a
one-time faucet is still a faucet.
**Done:**
- [x] Gold-writer row added; `pnpm test` green
- [x] Faucet row states total gold and total item value across all milestones
- [x] The first-session table updated for the new opening

**How it turned out.**

**Half of it was already done, and the forcing function is why.** The
gold-writer row and the milestone faucet row both went in during T-30.07 —
because `docs.test.ts` would not let that task's `grantReward` land without
them. That is exactly the behaviour the ledger's test was built for: the row
appeared in the same commit as the code, not in a later cleanup task. What was
left was the part no test can check — whether the numbers are *true* and
whether the prose says anything.

**They were not true.** The faucet row's item list read *"5 leek seeds + 4 leek
+ 2+3 potato + 2 strawberry + 3 onion seeds + 13 chicken feed"* — arithmetic
left half-finished, and unreadable. Summed from `MILESTONES` rather than by
hand: **9 leek + 5 potato + 2 strawberry + 3 onion seeds + 13 chicken feed**,
which at the merchant's *buy* prices is **1,305g**, on top of the **250g** from
`level_5` — a lifetime total of **1,555g per account**.

**The distinction the number needs, or it will be misread.** Every milestone
item is `shopSellPrice: null`, so the 1,305g is gold a player never has to
*spend*, not gold they can extract. That matters twice: it is not inflation,
and it is not tradeable value, which is what keeps the board out of the trading
economy (§6). Recorded in the row rather than left for a reader to work out.

**The first-session table gained the thing the whole phase was for, and it does
not claim the hole is fixed.** The 42-minute wait is still 42 minutes — no
milestone shortens a growth timer, and none was meant to. What the table now
shows is a *named* wait: `break_ground` at ~0:01, `six_beds` at ~0:03, and a
board listing what is left. Being honest about that is more useful than
claiming a win the numbers do not support.

**Two second-order effects found while modelling it, both worth having on
paper.** First, **the early seeds arrive with nowhere to plant them** —
`break_ground` and `six_beds` pay 5 leek seeds by 0:03 and the starting seeds
already fill all six plots exactly, so the reward lands at 0:45 when a plot
frees up, or immediately if the player spends 250g on the 7th plot, which the
board has just given them a reason to do. That is a better outcome than
instantly-consumable seeds and it is an accident of the numbers, so the note
says to re-check it if `STARTING_PLOTS` ever grows.

Second, and this is the one the phase rules demand be stated: **it shortens the
trade gate slightly, and that is a security change, not a balance one.** The
board grants **no experience at all** — `claimMilestone` calls `grantXp(tx, id,
0)` purely to read the current total — so the effect is entirely indirect:
1,305g of free seeds is more crops planted, and more crops harvested is more
XP. It does not change what level 5 costs in *time*, and
`TRADE_MIN_ACCOUNT_AGE_MS` is untouched, so throwaway-account scamming is no
cheaper to run at scale. Phase 31's T-31.08 is where the number gets
re-measured properly.

**Break-tested:** deleting the `modules/progression/service.ts` row fails
`names every file that writes player gold` with that exact filename in the
message. `pnpm -r typecheck` clean, `pnpm test` green at **1,946 tests**
(unchanged — this task adds documentation, not behaviour).

---

## Phase 30 complete — progression, made visible

Ten tasks, one phase, which was the condition the phase set itself: *"if polish
sprawls across three, then content-first was the right call after all and this
ordering was wrong."* It did not sprawl.

**What the phase actually found.** The recurring discovery was not a missing
feature — it was that **the server had been sending progression the whole time
and three separate client type declarations dropped it on the floor**:
`SelfPlayer` (T-30.01), `HarvestResult` (T-30.02) and `CollectResult`
(T-30.04). The wire was never the problem. A player could cross the level-5
trade gate without a single number moving on screen, and the fix each time was
a declaration, not an endpoint.

**Three primitives now exist that Phases 31–36 consume unchanged**:
`floatText.ts`, `tween.ts` and `grantReward`. Built once here; retrofitted they
would have cost five edits to five scenes. `grantReward` in particular is the
only place a milestone or a quest moves value, which is what stops Phase 33
growing a second faucet `docs/economy.md` would have to carry twice.

**What is deliberately still not fixed.** The 42-minute hole is still 42
minutes long. The board names the wait; it does not shorten it. D-18 remains
open, and Phase 31's crops are the next thing that could move it.

---

# Phase 31 — More to grow

Content at the point of maximum reuse: every new crop inherits growth, watering,
idle mode, shipping, trading and Phase 30's juice with **zero new code**. Only
config and art.

### T-31.01 — Measure the crop sheets  ✅ **DONE**
Depends: — · Size: S
Files: `scripts/measure-crops.mjs` (new), `docs/crop-sheets.md` (new)
**Do:** Measure every candidate sheet in `Crops/{Spring,Summer,Fall}` — frame
width, frame count, and which frame is the produce icon. **Spring and fall sheets
are 128x16 (8 frames); summer sheets are 160x16 (10).** `CropDef.stageFrames` is
already an explicit list rather than a computed range precisely so a crop can
differ (`crops.ts:52`), so nothing breaks — but measure, never assume.
**Done:**
- [x] Every candidate sheet measured, with the numbers recorded
- [x] The 8-vs-10 frame difference confirmed rather than taken from this task
- [x] Any sheet whose layout does not match the others is flagged, not quietly dropped

**How it turned out.**

**"Measure, never assume" earned its keep on the first run: three of the four
claims in this task's own brief are wrong.** The brief says spring and fall are
128x16 and summer is 160x16. In fact:

- **Fall is mixed.** `Aloe`, `Corn`, `Eggplant` are 10-frame; `Beetroot`,
  `Grapes`, `Pumpkin` are 8-frame. There is no "fall shape".
- **`Spring/Blueberry.png` is 128x32**, not 128x16.
- **`Summer/Bell Pepper.png` is 176x16 — eleven frames**, a count no other
  sheet in the pack has.
- **Eight sheets are 16x32, not 16x16.** That is the finding with teeth:
  `frameHeight` is per-sheet in `SheetSpec`, so T-31.02 has to set it to 32 for
  those eight or the renderer slices a tall plant in half.

**And the growth-stage count is not 6.** It runs from **5 to 10** across the
pack — 16 sheets at 6, six at 7, five at 5, two at 8, one at 10. `stageFrames`
being an explicit list rather than a computed range (a T-7.08 decision that
read as defensive at the time) is now load-bearing rather than theoretical.

**The 32px-tall sheets are ambiguous and the script decides by evidence, not by
preference.** A 128x32 sheet is either 8 tall frames or 16 short ones in two
rows. Two independent signals settle it: the art **crosses the horizontal
seam**, which two independent 16x16 cells cannot do; or the **top band is
entirely transparent**, which is headroom, because a row of eight blank frames
is not a sequence. The second test exists because the first one **failed** —
`Blueberry` and `Adzuki Bean` are short plants on tall canvases, and seam-
crossing alone read them as eight blank frames followed by eight real ones.
Anything else — content in both bands that never meets — is flagged as
ambiguous rather than guessed at.

**The produce frame is found by a stated rule, not a lookup table**: a growth
stage stands in soil and its art reaches the bottom row of its frame; picked
produce floats. So produce is the last non-empty frame that is *not* grounded.

**The classifier checks itself against the four crops already shipped**, and
that is the only reason its answers about the other 26 sheets are worth
reading: it must reproduce `crops.ts`'s `stageFrames: [0..5]`, `produceFrame:
7` for Potato, Strawberry, Onion and Spring Onion. All four ✓.

**Three sheets flagged for a human rather than dropped.**
`Summer/Bell Pepper.png` has three independent anomalies — 11 frames, **no
frame touching the bottom row** (its baseline sits a pixel high, so the crop
would render floating over its soil), and consequently a produce index that is
not evidence. `Fall/Pumpkin.png` and `Fall/Grapes.png` both have frame 1
**genuinely blank** — alpha sum exactly 0, mid-run, on both. Not a threshold
artefact; `stageFrames: [0,2,3,4,5]` handles it exactly.

**One false alarm, found and killed, and it is the most transferable thing
here.** The first version keyed "are these two frames the same art?" on **alpha
sum plus bounding box**, and reported repeated frames in `Wheat`, `Grapes` and
`Bell Pepper`. All three were wrong: checked byte-for-byte, `Wheat` frames 4
and 5 differ in **353 of 1,024 bytes** — same silhouette, different colour,
which is exactly what a ripening crop looks like. The script now hashes the
frame's RGBA bytes. **A silhouette is not an identity**, and a measuring tool
that reports a false anomaly is worse than one that reports none, because the
next reader spends their afternoon on it.

**`docs/crop-sheets.md` is generated, not typed** — `node
scripts/measure-crops.mjs --md` emits the table verbatim. Thirty rows of frame
indices copied by hand is thirty rows with a typo in one of them, and that typo
is a crop rendering its produce icon as a growth stage.

**Break-tested, and one of the four breaks was a no-op, which is worth saying
rather than hiding.** Removing the seam-crossing test made `Corn` read as 12
stages across two rows — caught by the ambiguity flag. Removing the
empty-top-band test did the same to `Blueberry` and `Adzuki Bean` — also
caught. Corrupting the expected values proved the self-check can fail (✗, plus
`DISAGREES with crops.ts`). But **dropping the `grounded` condition from the
produce rule changed nothing on this pack**, because every sheet's last
non-empty frame happens to be the floating one. The condition is therefore not
currently *selecting* anything — its job is to make the script **refuse rather
than guess** on a sheet whose trailing frame is a growth stage, and it stays
for that. Claiming it as a passed break-test would have been false.

**One deliberate deviation from the other measure scripts**: this one reads
`new_assets/` rather than `apps/client/public/assets`, because it measures
*candidates* and only four crops have been copied into the client. T-31.02 is
the task that copies the chosen ones. The header says so.

`pnpm -r typecheck` clean, `pnpm test` green at **1,946 tests** (unchanged —
this task adds a developer script and a document, no shipped code).

### T-31.02 — One gid shift for the whole phase  ✅ **DONE**
Depends: T-31.01 · Size: M
Files: `packages/shared/src/config/assets.ts`, `scripts/prepare-assets.mjs`,
`apps/client/public/tilemaps/farm.json`
**Do:** Add **every** chosen crop sheet to `SHEETS` in a single append, run
`prepare-assets.mjs`, regenerate `farm.json` from `generate-farm.ts`, and update
`farmMap.test.ts`. One append means one gid shift for the phase. Adding sheets
one task at a time would pay this cost repeatedly, which is the whole reason this
is its own task.
**Done:**
- [x] All new sheets appended in one change
- [x] `farm.json` regenerated from the generator (D-13: the generator wins)
- [x] `farmMap.test.ts` and `tilesets.test.ts` green
- [x] Browser console clean — a missing texture is silent on screen

**How it turned out.**

**This task had to make a choice the roadmap assigned to T-31.04**, because
"add every *chosen* sheet in a single append" cannot be done before the choice
exists. So the selection is here, and it is made from T-31.01's measurements
rather than by taste: **sixteen of the thirty candidate sheets**, with two
categories excluded and both exclusions load-bearing.

**The eight 16x32 sheets are out, and this is the finding that shaped the
phase.** `Farm.ts` builds the crop sprite with `setOrigin(0.5, 0.5)` and places
it at the tile's centre — a decision T-7.07 made explicitly when the old pack's
bottom-anchored 16x32 frames were replaced by square ones. A 32px-tall frame
centred on a 16px tile hangs half into the tile below. Tall crops therefore
need a per-crop anchor, plus the depth-sort consequences of a sprite that
overlaps its neighbour — that is **code**, and Phase 31's stated premise is
"every new crop inherits growth, watering, idle mode, shipping, trading and
Phase 30's juice with **zero new code**. Only config and art." Corn,
Sunflower, Grapes, Cucumber, Green Beans, Pineapple, Blueberry and Adzuki Bean
are held for a later phase rather than smuggled in as a rendering change.

**Bell Pepper is out too**, for T-31.01's reason: no frame in it touches the
bottom row, so its baseline sits a pixel above every other sheet's and the crop
would float over its soil. One sheet is not worth a special case.

That leaves **16**, which is comfortably the "roughly fifteen" T-31.04 asks
for: seven spring (Asparagus, Broccoli, Cabbage, Carrot, Cauliflower, Parsnip,
Rice), six summer (Blackberry, Hot Pepper, Melon, Tomato, Watermelon, Wheat)
and three fall (Aloe, Beetroot, Eggplant).

**The sixteen `SheetSpec`s were generated from the PNGs, not typed.** `cols`
varies — 8 for the spring sheets and Beetroot, 10 for the rest — which is
exactly the thing T-31.01 found the brief was wrong about, and exactly the
thing a human copying sixteen blocks gets wrong on the fourteenth.

**The shift, measured: 144 tiles.** `water-tile`, the first entry in `IMAGES`,
moved from firstgid 5040 to **5184**, and every `IMAGES` run after it moved by
the same 144 — the total tile count of the sixteen appended sheets (8 sheets ×
8 frames + 8 sheets × 10). `farm.json` was regenerated with
`generate-farm.ts` (D-13: the generator owns the map) and `verify-farm.ts`
re-resolves every object gid to the art it was authored with.

**Break-tested, and the guard is loud.** Reverting `farm.json` to a version
generated against the old manifest fails **five** tests in `farmMap.test.ts`,
naming the drift entry by entry (`water-tile: map says 3507, manifest says
5184`, and so on down the list). Worth one correction so the number is not
misread: that revert went back to the last *commit*, which predates other
uncommitted map work in this tree, so the 1,677 in the failure message is not
this task's shift. **This task's shift is 144**, measured from `TILESET_RUNS`
directly.

**`farmMap.test.ts` and `tilesets.test.ts` needed no edit, which is the design
working.** Neither pins a literal gid: `tilesets.test.ts` re-derives the
running sum, and `farmMap.test.ts` compares the map's own embedded firstgid
table against `TILESET_RUNS`. A test that had hardcoded numbers would have
needed sixteen edits here and would have been edited into agreement rather than
consulted.

**Browser-verified, because a missing texture is silent on screen.** All 20
crop textures load, each sliced into exactly the frame count the manifest
declares — so `Preload.verifyFrameCounts` had nothing to warn about, and the
clean console is backed by a number rather than by silence. No failed requests.
The farm renders correctly after a 144-gid shift: trees, farmhouse, coop, barn,
chest, shipping box, merchant, mailbox, path, water and ground scatter all in
place. Screenshotted.

**One deliberate inefficiency, named rather than hidden:** all sixteen sheets
are *loaded* from the moment they are listed, because `Preload` walks `SHEETS`,
and nothing references them until T-31.04 writes the `CropDef`s. That is the
cost of the one-append rule, and it is sixteen PNGs of about a kilobyte each.

`pnpm -r typecheck` clean, `pnpm test` green at **1,946 tests**.

### T-31.03 — `season.ts`, defined and enforced by nothing  ✅ **DONE**
Depends: — · Size: S
Files: `packages/shared/src/config/season.ts` (new),
`packages/shared/src/config/season.test.ts` (new),
`packages/shared/src/config/{crops,index}.ts`
**Do:** A `Season` type and a `seasons: readonly Season[]` field on `CropDef`.
**Nothing reads it yet** — Phase 35 does. It ships here because adding a field to
~25 crop entries later means re-touching every crop config and test, re-deciding
each crop's season retroactively, and answering an awkward question about seeds
players already hold. One line per crop now; a migration-shaped problem later.
**Done:**
- [x] `Season` exported; every `CropDef` carries a non-empty season set
- [x] A test asserts every crop has at least one season
- [x] Nothing in `apps/` reads the field yet — asserted by grep in the write-up

**How it turned out.**

**The file deliberately contains no rule.** No `isInSeason`, no
`currentSeason`, no clock. A helper written now would be written against a
calendar that does not exist, and Phase 35 would rewrite it — so what ships is
the vocabulary (`Season`, `SEASONS`, `isSeason`) and the data (`seasons` on
every `CropDef`), and nothing that could be wrong about a system nobody has
designed yet.

**Winter is in the type and has no crops, and that is the finding.**
`new_assets/Crops/` contains **Spring, Summer and Fall only** — there is no
winter crop art anywhere in the pack. (It does ship winter *tilesets* and
winter props; T-25.01's VIP decor set uses those, which is what makes the
absence easy to miss.) So **Phase 35 owes a decision it does not yet know it
owes**: is winter a fallow season the player spends on animals, machines and
the cave, or a season with a small imported crop set? Recorded in `season.ts`
and pinned by a test that fails the moment somebody adds a winter crop —
`has no winter crop, which Phase 35 must decide what to do about`. A test
asserting the absence of something is unusual and is the right shape here: its
job is to make a future author read the note before the decision gets taken by
accident.

**A second thing Phase 35 will silently depend on is pinned: calendar order.**
`SEASONS` is spring → summer → fall → winter, and "the season after this one"
will be an index into it. An alphabetical sort — which puts fall first and
spring second — is the exact mistake, so it is asserted as a *property*
(`summer` is at `spring + 1`, and so on) rather than by restating the array,
which would let someone "fix" the test by updating both.

**All four shipped crops are `[Season.SPRING]`**, which is not a placeholder:
all four come from `Crops/Spring/`. It does mean the game currently has nothing
to plant in three of four seasons — T-31.04's sixteen crops, six summer and
three fall, are what makes the field meaningful, and they land in this same
phase.

**Break-tested, five ways, all failing as designed**: alphabetising `SEASONS`
(2 tests), removing the `Object.freeze` (1), an empty season set on a crop (1),
a repeated season (1), and a winter crop appearing (1).

**"Nothing in `apps/` reads it" — asserted, and the grep is the assertion.**
`grep -rin "season" apps/ --include=*.ts --include=*.html` returns **eight
hits and not one is this field**: prose on the landing and register pages
("Spring season · Free to play", "Four crops to start the season"), a
`landing.ts` crop blurb, a `House.ts` comment saying a tier is a ladder rather
than a seasonal variant, and their built copies under `dist/`. Inside
`packages/shared`, the only files mentioning `Season` outside `season.ts`,
`season.test.ts` and `crops.ts` are `assets.ts` (`'Seasonal ground props'` in a
note) and `milestones.ts` (a milestone titled `'Seasoned'`) — both English, not
the type.

`pnpm -r typecheck` clean, `pnpm test` green at **1,955 tests** (shared 283 →
292).

### T-31.04 — The crops themselves  ✅ **DONE**
Depends: T-31.02, T-31.03 · Size: L
Files: `packages/shared/src/config/{crops,items,config.test}.ts`,
`apps/server/src/modules/farm/level.test.ts`,
`apps/client/src/pages/landing.ts`, `docs/economy.md`,
`scripts/measure-crops.mjs`
**Do:** Roughly fifteen new `CropDef`s with their seed and produce items, each
carrying its season set. Extend the existing invariants across the whole table:
produce must outsell seed, and the g/hr band must stay coherent. Deliberately
give the new crops a **wider spread** of growth durations than the current flat
20-22.5 g/hr — flatness was right when there were four crops and is dull with
twenty. Say what band replaces it.
**Done:**
- [x] Every crop sells for more than its seed (the existing test, extended)
- [x] The g/hr band is documented and enforced by test
- [x] Every crop's stage frames match T-31.01's measurements
- [x] Break-tested: a crop priced below its seed fails the test

**How it turned out.**

**Sixteen crops, four to twenty**, each with a seed and a produce item and a
season set: Parsnip 12m, Wheat 20m, Carrot 30m, Rice 1h, Beetroot 1.5h,
Asparagus 2.5h, Broccoli 3h, Tomato 3.5h, Hot Pepper 5h, Cauliflower 6h,
Blackberry 7h, Aloe 9h, Cabbage 10h, Eggplant 12h, Melon 14h, Watermelon 16h.
Every duration is distinct, and every one is distinct from the original four.

**The config was generated, and `stageFrames` came from the sheets rather than
from a person.** `measure-crops.mjs` gained a `--json` mode so the generator
could read the measured stage list and produce frame per sheet. That is not
fastidiousness: twenty rows of frame indices is exactly the table where row
fourteen gets a digit wrong, and the symptom would be a ripe cabbage drawn as
a sprout. The generator also refused to emit a crop whose declared season
disagreed with the folder its art came from, or whose sheet was one of the tall
ones T-31.02 excluded.

**The band: 20-22.5 g/hr becomes 15-28 g/hr, rising with commitment.** 15 on
the 12-minute parsnip, 28 on the 16-hour watermelon. Flatness was right when
choosing a crop meant choosing how long to be away and nothing else; across
twenty crops it would have made nineteen of them interchangeable.

**But the invariant that actually keeps them all alive is not about the hour —
it is about the visit, and the existing table is what proved it.** The obvious
rule, "g/hr rises with duration", is *false of the game as shipped*: onion (8h,
21.25 g/hr) has always earned less per hour than strawberry (4h, 22.50).
Writing the obvious rule would have failed on a two-year-old balance decision
that is correct — onion is harvested once where strawberry is harvested twice,
and in an idle game (§1) **a visit is the scarce resource, not an hour**. So
the enforced rule is *a longer crop always pays more per harvest than every
shorter one*, which is what makes committing to sixteen hours a choice rather
than a penalty. Ties fail too: equal pay for a longer wait is strictly worse.

**Four invariants the pack's art forced to change, and one that quietly could
not survive.**

- *"Every crop has exactly six growth stages"* — true of four crops, false of
  twenty. T-31.01 measured five to eight. Replaced by the shape a config edit
  can still get wrong: the growth run is contiguous from frame 0, the produce
  icon is the sheet's last frame, and produce comes after every stage.
- *"Every crop shares the measured T-7.08 frame layout"* (`[0..5]`, produce 7)
  — same reason; produce is 7 on an 8-frame sheet and 9 on a 10-frame one, so
  it is asserted against `sheet.cols` per crop instead of as a literal.
- **The seed bags ran out.** `Icons/RPG icons/Extras/Bags.png` is 112x16 —
  **seven** sacks, and there is no other seed-packet art in the pack. Twenty
  crops cannot each have one. So *"every crop takes a distinct seed bag"* is
  replaced by the strongest rule seven bags can support: **no bag carries more
  crops than `ceil(crops / bags)`**, which still fails for the real mistake
  (someone giving ten new crops bag 0) while permitting the reuse the art
  forces. **The cost is real and is written down rather than discovered
  later**: two crops can now share a packet icon, distinguishable by name on
  hover and to a screen reader (`hotbar.ts` and `slotGrid.ts` both set `title`
  and `aria-label`) but not at a glance. Better art or a per-crop tint is a
  later phase's problem.
- *"No two items share an icon"* had to gain a **seed exception**, scoped to
  exactly that category — a tool sharing with a material still fails. And
  because an exception can hide things, produce got its own uniqueness test:
  it is unique for free (each produce icon is its own crop's last frame), and
  asserting it separately means a future crop borrowing another's sheet fails
  as *"two crops look identical"* rather than disappearing into the exemption.

**The XP test failed, and fixing it the obvious way would have been wrong.**
`level.test.ts` asserted every crop was worth the same XP per hour to within
10%. That held while every duration was a whole multiple of `XP_PER_UNIT_MS`
(5 minutes); parsnip is 12 minutes, so `floor(12/5)` pays 2 XP where the ideal
is 2.4 and the ratio went to 1.2. Rounding parsnip up to 15 minutes would have
restored the test and hidden the point, because **the two directions are not
equally dangerous**. `config/level.ts` is explicit that XP is primarily the
anti-alt control behind `TRADE_MIN_FARM_LEVEL`, so rounding *down* costs a
player a fraction of an XP, while rounding *up* mints trade-eligible alts
faster. The ceiling is now hard (no crop may beat the norm) and the floor is
loose (75%).

**That exposed a live cliff, now pinned before anyone falls off it.**
`xpForDuration` is `max(1, floor(ms / XP_PER_UNIT_MS))`, and the `max(1, ...)`
is a floor on the *award*, not on the *rate* — so a crop shorter than five
minutes still pays a whole XP. A 1-minute crop would pay **60 XP/hr against the
norm's 12**, five times the rate, and would be the only crop a scammer plants.
Nothing shipped is close, **but T-31.05 is next and D-18's brief says
"sub-15-minute"**, so there is now a test saying *no crop may be shorter than
`XP_PER_UNIT_MS`*. That task will hit a failing test rather than a live
exploit.

**Two more things broke that were not tests.** `landing.ts` typed its crop
blurbs as `Record<CropId, string>`, so twenty crops meant sixteen missing
entries — and rendering twenty cards under the heading *"Four crops to start
the season"* would have been a wall. It is now `Partial`, iterating the blurbs
rather than `CROP_IDS`: the page shows a curated four, a new crop is never
*required* to arrive with marketing copy, and the heading stays true because
those four are the level-1 stock T-31.06 will gate to. And `docs.test.ts`
failed on **32 undocumented prices** — the forcing function doing its job, so
`docs/economy.md` gains all sixteen seed sinks, all sixteen produce faucets and
a full priced crop table. T-31.08 still owes the rate re-model and the
trade-gate wall clock.

**Break-tested, six ways, every one failing as designed**: a crop priced below
its seed, a crop paying 300 g/hr, a longer crop that out-waits but under-pays,
two crops sharing a duration, a seed too cheap to matter, and ten crops given
the same bag. Several trip more than one invariant, which is the right kind of
overlap — the band and the domination rule catch different halves of the same
mistake.

**Browser-verified.** All **20 seed rows** in the merchant's Buy tab, priced
6g to 547g in order, every one with an icon; the landing page still shows its
curated four; and buying, tilling, planting and watering a **parsnip** all
round-trip 200 with the server reporting `stage: 0`, `isWet: true` and
`readyInMs: 715,539` — 11.9 minutes, which is the 12-minute crop counted from
the moment it was watered. Gold 500 → 494. Console clean, no failed requests.
Screenshotted.

**One thing the screenshot makes obvious and this task does not fix:** the shop
is now 23 rows and scrolls. That is precisely what T-31.06 exists for — gating
seeds behind farm level so a level-1 player sees a short list.

`pnpm -r typecheck` clean, `pnpm test` green at **2,075 tests** (shared 292 →
298, client 587 → 667, server 986 → 1,020 — most of the growth is existing
suites that iterate `CROP_IDS`).

### T-31.05 — The starter crop (D-18, option (a))  ✅ **DONE**
Depends: T-31.04 · Size: M
Files: `packages/shared/src/config/{economy,config.test}.ts`, `docs/economy.md`,
`ROADMAP.md` (D-18)
**Do:** A sub-15-minute crop in `STARTING_ITEMS`, closing the 42-minute hole with
the mechanic rather than with a gold gift. D-18 costed three options and
recommended this one; (b) and (c) both add gold to fix a problem that is not
about gold. The gid shift and map regeneration it needed are already sunk in
T-31.02, which is why it is cheap here and was expensive when D-18 was written.
**Done:**
- [x] A fresh account can complete a full till-plant-water-harvest cycle inside
      the first session
- [x] `docs/economy.md`'s first-session table rewritten; the hole is gone or
      measurably smaller
- [x] The crop is not so profitable it dominates the others (the T-31.04 band holds)
- [x] D-18 updated in the Open Decisions table to DECIDED

**How it turned out.**

**The cheapest task in the phase, and only because of the four before it.**
`crops.ts` and `items.ts` are not even touched: parsnip already exists at 12
minutes with its art copied, its sheet in the manifest, its prices inside the
band and its season declared. The whole change is **two lines of
`STARTING_ITEMS`**. That is the shape D-18 predicted — *"the objection to (a)
was never the crop, it was the `SHEETS` entry, gid shift and map regeneration
it dragged behind it"* — and T-31.02 paid that once for sixteen crops.

**The kit is 4× parsnip + 2× leek, and the split is the teaching.** Six of one
seed would teach the loop and nothing else. Four parsnips ripening at 0:15 is a
harvest that feels like one and closes the cycle inside the first sitting; the
two leeks at 0:45 are the first reason to come back, which is §1's idle pillar
demonstrated rather than explained. `config.test.ts` now pins both halves —
something faster than 15 minutes, and something slower — plus a third rule the
old kit satisfied silently: the seeds must fill the starting plots **exactly**,
because fewer is a new player staring at bare soil and more is seed they can
neither plant nor sell.

**Potato left the kit and still arrives in the first session**, as the
`first_yield` milestone reward for completing that first harvest. Verified in
the browser: the moment the parsnip came out of the ground, `first_yield`
flipped to `earned: true, claimed: false` with its two potato seeds waiting. A
reward for finishing the loop beats a two-hour plot a new player cannot check
on.

**The opening is deliberately poorer in gold, which is the trade D-18 asked
for.** Kit goods value drops 180g → **64g** (parsnip seed is 6g against
potato's 50g), and the one-hour position is 746g where the old kit reached 820g
at the two-hour mark. What that buys is a completed harvest at 0:15 instead of
an empty field until 0:45. The constraint on the opening is **plots and time,
not gold** — 500 starting gold already buys eighty-three parsnip seeds and
there are six plots.

**The hole is 42 minutes → 12, and it cannot go to zero.** That floor is a
*security* constraint, not a design preference, and it is the most useful thing
this task inherited: `xpForDuration` awards `max(1, floor(ms / XP_PER_UNIT_MS))`,
so any crop under five minutes still pays a whole XP and would beat every other
crop on experience per hour — and XP is the anti-alt control behind
`TRADE_MIN_FARM_LEVEL`. T-31.04 added the test that refuses such a crop
precisely so this task would meet a failing test rather than a live exploit.
It did not have to: 12 minutes clears it. But the number is now written down in
three places rather than being rediscovered by whoever next wants a faster
opening.

**The band holds without any adjustment.** Parsnip is the *cheapest* crop in
the game per hour — 15 g/hr, the floor of the 15-28 band — so the starter crop
is emphatically not a dominant strategy. It is the fastest loop and the worst
rate, which is the correct shape: it exists to teach, and a player who keeps
farming parsnip at hour ten is leaving money on the table.

**Verified end to end in the browser, on a real fresh account.**

| Check | Result |
|---|---|
| Minute zero | slots 0-3: `hoe_wood`, `watering_can_wood`, `parsnip_seeds ×4`, `leek_seeds ×2`; 500g; 6 unlocked plots |
| Till → plant → water | 200, 200, 200; `readyInMs` = **12.00 minutes** exactly; `isWet: true` |
| Harvest before it is ripe | refused, **409 `CROP_NOT_READY`** — the wait is real, not cosmetic |
| Harvest once ripe | 200, `+1 parsnip`, `+2 experience`; plot returns to `cropId: null, tilled: true` |
| Ripe stage index | 4 — parsnip has five stages `[0..4]`, matching T-31.01's measurement rather than the old six-stage assumption |
| `first_yield` after harvest | `earned: true, claimed: false`, 2 potato seeds waiting |

Console clean throughout (one deliberate 409 from the too-early harvest probe,
and the headless-GPU WebGL warning).

**Break-tested, three ways**: reverting the kit to the old leek+potato pair
fails with *"the fastest starter crop takes 45 minutes"*; making it six parsnip
fails *"every starter crop ripens at the same moment"*; five seeds for six
plots fails *"5 seeds for 6 plots"*.

**D-18 is now DECIDED** in the Open Decisions table, recording the option taken,
the two it beat and why, the measured before/after, and the security floor that
stops anyone closing the gap further.

`pnpm -r typecheck` clean, `pnpm test` green at **2,078 tests** (shared 298 →
301).

### T-31.06 — The shop reveals itself as you level  ✅ **DONE**
Depends: T-31.04 · Size: M
Files: `apps/server/src/modules/shop/{service,shop.integration.test}.ts`,
`packages/shared/src/config/{crops,config.test}.ts`,
`packages/shared/src/errors.ts`,
`apps/client/src/game/{shopPanel,shopPanel.test,hud}.ts`,
`apps/client/src/net/{shop,errors}.ts`,
`apps/client/src/pages/{cropBlurbs,cropBlurbs.test,landing}.ts`,
`docs/economy.md`
**Do:** Gate new seeds behind farm level. This is the **first use of farm level
for anything but the trade gate** — until now the level was earned, never shown
and never spent. Locked entries stay visible with their unlock level, following
the existing "why is this Buy button dead" tooltip pattern in `shopPanel.ts`.
**Done:**
- [x] Server refuses an under-level purchase; the client never relies on hiding it
- [x] Locked seeds visible with their requirement, not absent
- [x] Level 1 still has enough to do

**How it turned out.**

**Seven crops at level 1, thirteen unlocking up to level 13.** Level 1 is
parsnip 12m, wheat 20m, carrot 30m, leek 45m, rice 1h, beetroot 1.5h, potato 2h
— a twelve-minute crop, an overnight-ish one, and enough between them to make
day one a real choice. Then 2, 3, 5, 7, 9, 11, 13 in pairs, ending at
watermelon.

**A test caught my own first assignment, and the fix was the assignment rather
than the test.** I initially kept the original four (leek, potato, strawberry,
onion) at level 1 as the established, advertised opening, and gated only the
sixteen new crops. `unlocks crops in the order they take longer` failed with
four inversions — potato at 2h unlocking at level 1 while beetroot at 1.5h was
locked to level 3. The rule could have been weakened to "among gated crops
only"; it was not, because **the ordering is what makes the gate mean
anything.** T-31.04's invariant is that profit per harvest rises with duration,
so if the long crops are available on day one, levelling unlocks nothing
economically valuable and the whole feature is a shop filter with extra steps.
Under strict ordering every unlock is a better per-visit return. Strawberry
moved to level 3 and onion to level 7 to buy that.

**Which broke the landing page, silently, and nothing would have caught it.**
`/` advertises four crops under the heading *"Four crops to start the season"*
— and two of them were now behind levels 3 and 7. A shop window can only really
lie one way, and that is it. `CROP_BLURBS` moved out of `landing.ts` into its
own `cropBlurbs.ts` (the page calls `mount()` at module scope and reaches for
`document`, so it cannot be imported by a test) and `cropBlurbs.test.ts` now
pins that **every advertised crop is level-1 stock**, that there are four of
them, and that they span minutes to hours — because four crops that all ripen
in ten minutes advertises a clicker and four that all take a day advertises a
chore. Parsnip and carrot replaced strawberry and onion.

**The gate is on buying, never on planting or selling, and both exclusions are
load-bearing.** `first_yield` hands a level-1 player potato seeds; a seed you
hold and cannot sow would read as a bug. And produce must always be sellable —
a level gate on the sell side would strand a crop in a bag with no way to turn
it into gold. Both are tested.

**The server decides, from experience it derives itself.** `buy` calls
`levelForXp(player.experience)` — never a client-supplied value, never a stored
level — and refuses with **403 `SEED_LOCKED`** carrying `requiredLevel` and
`level` so the client can explain rather than guess. Checked *before* the gold
row lock, because there is no reason to take a lock for a purchase that cannot
happen. That derivation matters more than it looks: farm level also gates
trading, so a bug letting this read a writable level would be a bug in the
anti-alt control too.

**The catalogue deliberately does not hide locked rows.** A shop that silently
omits thirteen of twenty seeds tells a new player the game has seven crops.
`shopCatalogue()` carries `unlockLevel` per entry and stays a pure read of
config with no player argument — the same call T-18.14 made for a dead Buy
button, and the same one T-25.02 made for VIP decoration.

**A fourth instance of a pattern this repo has now named four times.**
`net/shop.ts`'s `ShopEntry` did not declare `unlockLevel`, exactly as
`SelfPlayer` (T-30.01), `HarvestResult` (T-30.02) and `CollectResult` (T-30.04)
each dropped progression the server was already sending. **The wire has never
been the problem; the client's own interfaces are.** Recorded in the type
itself this time, so the next person adding a server field reads it there.

**One live-update bug fixed before it shipped:** a level-up can *unlock* a
seed, and the shop only repainted when reopened. `renderProgress` now refreshes
it — guarded on an actual level change, because that function runs on every
poll and every harvest response, and repainting three times a minute would
fight the player's own quantity input.

**Break-tested, five ways.** Removing the server gate fails 4 integration
tests; `< requiredLevel - 1` fails the one-XP-short boundary test; making the
catalogue report `null` fails the locked-listing test; the two config
assignments (a starter-kit crop locked, a long crop unlocking early) fail their
own invariants. Two existing tests bought `onion_seeds` to test *gold* and now
hit `SEED_LOCKED` first — switched to `potato_seeds` with a note saying why,
rather than loosening the gate.

**Browser-verified at level 1.** Seven seed rows buyable, thirteen greyed with
`· farm level N` inline and `Unlocks at farm level N` on the button; a forced
`POST /api/shop/buy` for `watermelon_seeds` straight past the UI returns
**403 `SEED_LOCKED` `{requiredLevel: 13, level: 1}`**, `parsnip_seeds` returns
200, and `messageFor` renders *"Your farm is not experienced enough for that
seed yet."* Console clean apart from the two 403s the probe deliberately
caused.

**One thing the screenshot shows and this task leaves alone:** locked rows sit
*interleaved* with buyable ones, because the list is in `ITEM_IDS` order.
Sorting buyable first would read better; a stable order the player can learn is
worth more, and reordering the whole catalogue is not this task's call.

`pnpm -r typecheck` clean, `pnpm test` green at **2,102 tests** (shared 301 →
306, client 667 → 678, server 1,020 → 1,028).

### T-31.07 — New crops feed the milestone board  ✅ **DONE**
Depends: T-31.04, T-30.06 · Size: S
Files: `packages/shared/src/config/{milestones,milestones.test}.ts`,
`docs/economy.md`
**Do:** Milestones over the widened crop table — "grow one of each spring crop",
"harvest a crop that takes over four hours". **Nothing ships inert**: a phase
that adds content without giving the previous phase's systems something to point
at wastes both.
**Done:**
- [x] New milestones reference only crops that exist
- [x] The existing milestone ordering test still passes

**How it turned out.**

**Neither milestone this task suggested is expressible, and the reason is in
`milestones.ts`'s own header rather than in an oversight.** "Grow one of each
spring crop" needs a lifetime record of what has been harvested, and `plant()`
clears `harvested_at` — so "has harvested a leek" is not a monotonic fact, it
means "is currently sitting empty", and a milestone built on it would flicker as
the player replants. "Harvest a crop that takes over four hours" has the same
problem. Building either would mean a new counter, a migration and a table:
this task's file list is one config file, and inventing state to satisfy a
suggestion would have been the wrong trade.

**`farmLevel` is the honest proxy, and T-31.06 is what made it a good one.**
Until this phase, "reach farm level 3" had no answer to *why* except "so you
can trade at 5". Now every level from 2 to 13 opens seeds the merchant would
otherwise refuse — so each level milestone **names the crops it unlocks and
pays a handful of them**, and the board stops being a list of numbers and
becomes the only place the game explains what levelling is for. That is also
what stops T-31.04's sixteen crops shipping inert.

**Five new goals, ten to sixteen** — `level_2` (asparagus, broccoli), `level_7`
(blackberry, onion), `level_11` (aubergine, melon), `level_13` (watermelon, the
last seed in the shop), and `regular_shipper` at ten shipments. The shipping box
had exactly one milestone — *"put anything in it"* — which made it a thing you
try once; ten shipments is a habit, and it is the only counter on the board
rewarding repeated use of a system rather than reaching a number.

**A test I wrote failed on my own board, and the board was wrong.** `names every
farm level that unlocks a seed` came back with `[9, 11]`: levels 9 and 11 open
the shop and nothing pointed at them, while `level_10` celebrated a round number
that unlocks nothing. So `level_10` became **`level_9`** — where aloe and
cabbage actually arrive — and `level_11` was added. The seven level milestones
are now exactly the seven unlock levels: 2, 3, 5, 7, 9, 11, 13.

**Which let a second test get stronger rather than weaker.** It was written as
*"at most one level milestone that unlocks nothing"*, carving out `level_10` as
a permitted landmark. Once the board was fixed the exception was unnecessary, so
it now asserts **no level milestone unlocks nothing** — a stronger claim, and
the note records that it was tightened rather than pretending it was always
this.

**The invariant worth keeping past this phase**: a level milestone must not pay
a seed that level cannot buy. Planting is never gated, only buying (T-31.06), so
a locked seed given as a reward works *exactly once* and then the player walks
to the merchant and is refused — a reward that teaches them about a crop and
then takes it away. Break-tested by making `level_2` pay watermelon seeds.

**`level_10` → `level_9` renames a milestone id, and `milestone_claims` keys on
it.** Survivable only because the game is pre-launch; recorded in the config
next to the change rather than left for whoever finds an orphaned claim row.

**The faucet is recounted, because five new goals and two repriced ones moved
it a long way**: 1,555g → **5,247g** of lifetime purchasing power per account
(250g gold, unchanged, plus 4,997g of goods). The jump looks alarming and is
not — eight of those goods are seeds for crops costing 311-547g a packet, so
the number is large because the *crops* are dear, not because the board became
generous; it is still two or three packets per goal. And every item remains
unsellable, so it is gold a player never has to spend rather than gold they can
extract.

**One stale comment retired.** `milestones.test.ts` recorded that the third
milestone could not land inside ten minutes *"until T-31.05 ships a
sub-15-minute starter crop"*. It shipped. The assertion is unchanged — what it
pins is still worth pinning, that the third goal is earned by farming rather
than by tilling more dirt — but the note now says the wait it described is
gone.

**Break-tested, three ways**: a level paying an unbuyable seed, an unlock level
losing its milestone, and a level milestone moved out of per-kind order (which
trips two invariants at once, correctly).

**Browser-verified**: 16 milestones in the expected order, the board renders its
first three on a fresh account, console clean.

`pnpm -r typecheck` clean, `pnpm test` green at **2,105 tests** (shared 306 →
309).

### T-31.08 — Re-model the economy  ✅ **DONE**
Depends: T-31.04, T-31.05 · Size: M
Files: `docs/economy.md`, `packages/shared/src/config/config.test.ts`
**Do:** Extend the crop rate table across every new crop, re-verify the band, and
rewrite the first-session section against the starter crop. Re-measure the
wall-clock cost of reaching `TRADE_MIN_FARM_LEVEL` — more crops means more
harvests means faster XP, and that is a **security** number.
**Done:**
- [x] Rate table covers every crop
- [x] Trade-gate wall clock re-measured and compared to the previous figure
- [x] `pnpm test` green (`docs.test.ts` reads this file)

**How it turned out.**

**Two of the three checkboxes were already met, because the tasks that caused
the drift fixed it.** T-31.04 wrote the twenty-crop rate table when it set the
prices; T-31.05 rewrote the first-session section when it changed the starter
kit. Doing the doc work *in* the task that moves the number, rather than
batching it, is what `docs.test.ts` exists to force. The table gained one
column here — **when each crop unlocks** — because after T-31.06 "what does it
cost" is only half the answer to "should I plant this".

**So the real work was the security number, and the premise in this task's own
brief is wrong.** It says *"more crops means more harvests means faster XP"*.
It does not, and the reason is structural rather than lucky: `xpForDuration`
awards `floor(ms / XP_PER_UNIT_MS)`, so experience is paid for **time**, never
for the crop. Every crop in the game — 20 minutes to 16 hours — pays exactly
**12 XP/hr per plot**. So does every animal. Sixteen new crops moved the
ceiling by nothing at all.

Parsnip is the single exception, at **10 XP/hr**, and it errs the safe way: 12
minutes is not a whole multiple of the five-minute unit, so `floor` pays 2
where 2.4 was earned. That is the asymmetry T-31.04 built into `level.test.ts`
— hard ceiling, loose floor — paying off in the direction it was designed for.

**The gate costs cultivated slots, not crops**, and the numbers are now in the
ledger: 494 XP for level 5, which is **6.9 h of full cultivation** on the six
starting plots, 4.1 h with a full starting coop alongside, 2.1 h across all
twenty plots. "Full cultivation" is stated as the theoretical maximum, not a
session — it assumes every plot is replanted the instant it ripens.

**What did move, measured rather than asserted.** The 12-minute starter crop
raises *utilisation* for a player who is actually present: five complete cycles
in an hour where leek managed one. On the 6-plot starting farm, one hour of
uninterrupted attention goes **54 XP → 60 XP**, which is **+11%**, and shifts
the active-play cost of the gate from about **9.1 hours to about 8.2 hours**.
It stays under the 72 XP/hr theoretical maximum precisely because parsnip pays
10 rather than 12.

**The conclusion is the same as before Phase 31, which is the point of
measuring**: the **24-hour account age is the binding constraint, not the
experience**. Even at twenty plots the XP is two hours of work and no amount of
gold shortens a day. What the gate actually costs an attacker is **~8
human-hours of attention per account**, and this phase shaved roughly one hour
off that. Small, real, and now written down so the next phase compares against
8.2 h instead of rediscovering it.

**The ledger also records what *would* move it**, because that is the useful
half: more crops, no; higher prices, no (gold buys no XP anywhere); more plots
or animals, yes and linearly — which makes `VIP_BENEFITS.bonusPlotSlots` and
any future cap increase an XP change as well as a convenience one.

**Two numbers left a document and became tests**, since a figure in prose
drifts silently. `config.test.ts` now pins the gate's cultivation cost inside a
deliberately wide band — this asserts nobody has quietly made it an afternoon
or a fortnight, not a balance choice — and, separately, that **animals pay no
more XP per hour than crops**. That second one was genuinely unguarded:
`level.test.ts` pinned the crop ceiling and nothing pinned the animal one, and
an over-paying animal would be the same exploit by an easier route, because a
coop needs no replanting and so runs at full utilisation unattended.

**Break-tested, three ways**: dropping `XP_PER_UNIT_MS` to one minute makes the
gate 1.4 h and fails (also tripping the server's own gate test); doubling
animal XP fails the new animal ceiling at 24 XP/hr; quadrupling
`STARTING_PLOTS` fails both the gate band and the starter-kit seed count.

`pnpm -r typecheck` clean, `pnpm test` green at **2,107 tests** (shared 309 →
311).

---

## Phase 31 complete — more to grow

Eight tasks, four crops to twenty, and the phase's premise held: **the sixteen
new crops needed no new game code.** Growth, watering, idle mode, shipping,
trading and Phase 30's floats all took them unchanged. What the phase actually
spent its time on was the things config alone could not absorb.

**What the phase found that nobody was looking for.**

- **The brief's own facts were wrong, twice.** T-31.01 was told spring and fall
  are 8-frame and summer is 10; fall is mixed, one spring sheet is 128x32, one
  summer sheet has eleven frames, and eight sheets are 16x32 rather than 16x16.
  T-31.08 was told more crops means faster XP; XP is paid for time, so it means
  nothing at all. Both tasks were written with "measure, don't assume"
  instructions, and both instructions earned their keep.
- **The pack ran out of seed bags.** Seven sacks, twenty crops, and no other
  seed-packet art anywhere. The distinctness invariant could not survive and
  was replaced by the strongest rule seven bags support; the cost — two crops
  sharing a packet icon — is recorded rather than discovered later.
- **A rendering decision quietly bounded the content.** The crop sprite is
  centred on its tile, so the eight 16x32 sheets need a per-crop anchor. Tall
  crops are therefore *held*, not smuggled in, because the phase promised no
  new code.

**Three tests failed on my own work and were right each time**, which is worth
recording as a pattern rather than three incidents: the duration-ordering rule
caught a level assignment that kept the original four at level 1; the
unlock-coverage rule caught a milestone board celebrating level 10 while levels
9 and 11 opened the shop unremarked; and the landing page was advertising two
crops a new account could no longer buy. In all three the fix was the data, not
the rule — and in one the rule got *stronger* afterwards.

**What is deliberately still not done.** The eight tall crops (Corn, Sunflower,
Grapes, Cucumber, Green Beans, Pineapple, Blueberry, Adzuki Bean) wait on a
per-crop sprite anchor. Bell Pepper waits on someone looking at its baseline.
Winter has no crop art at all in the pack, which Phase 35 now owes a decision
about. And the shop's twenty rows sit in `ITEM_IDS` order with locked entries
interleaved — legible, but sorting buyable first would read better.

---

# Phase 32 — Artisan goods · **SUPERSEDED by the MVP re-scope (2026-09-08)**

> **Not finished — superseded.** Every task below assumes a twenty-crop table
> across four seasons and the economy modelled in T-31.08, both of which the MVP
> re-scope replaced (see Phase R at the end of this file). Nothing here was
> built. It is kept whole rather than deleted because the *design* survives the
> re-scope — machines, the dominated cow, wood's dead price and the
> animals-versus-plots ratio are all still real — but the recipes, prices and
> unlock levels would all have to be re-derived from the eleven spring crops
> before any of it could be built. Treat it as a proposal to redo, not a plan to
> resume.

The highest-value content phase, and the only one that attacks four problems at
once: economic depth, the dominated cow, wood's dead price, and the 84:1
animals-versus-plots ratio — **with no new map and no new verb.**

**The patterns already exist, but they come from two files, not one.**

- **Readiness** copies `modules/animals/production.ts` — a pure, DB-free function
  taking `now` as a parameter and returning `{ isReady, readyInMs, output }`,
  exactly like `productionAt` and `growthAt`. Nothing ticks (§4.2).
- **Claiming** copies the guard in `modules/shipping/service.ts` (~`:198-205`):
  `.where(and(eq(id), isNull(paidAt))).returning()`, where an **empty result means
  another request won the race**. No lock, no "was this already done" read.
- **Placement** reuses `modules/decor/` and its reachability flood-fill wholesale.

**But do not copy shipping's auto-settle-on-read.** Shipping credits gold
unconditionally because gold has no cap. Artisan output lands in the backpack,
which can be full — so collection must be an **explicit intent that can fail
cleanly** with `INVENTORY_FULL`. Silently dropping items is the one failure this
project must never have.

**The non-obvious win.** `docs/economy.md` finding 2 says animals out-return plots
84:1 per gold, leaving plot expansion a prestige sink nobody buys for profit.
Machines consume **crops** at a throughput cap. More plots means more machine
input means more artisan margin. **Artisan goods are the only lever in this plan
that makes plot expansion economically rational again.**

**Explicit call: do not patch milk's price in Phase 30 or 31.** T-32.08 is the
cow fix, and an interim price bump would have to be reverted.

### T-32.01 — `config/machines.ts`
Depends: — · Size: M
Files: `packages/shared/src/config/machines.ts` (new),
`packages/shared/src/config/index.ts`
**Do:** Machine kinds with footprints and **wood + gold build costs**, plus a
`RECIPES` table of `{ machine, input, qty, durationMs, output }`. Start with
Cheese Press, Jam Maker, Beehive, Butter Churn and Kitchen Pot; Furnace and Anvil
are defined but not purchasable until Phase 36 gives them ore, because nothing
ships inert.
**Done:**
- [ ] Machines and recipes defined; every output item exists
- [ ] Build costs consume wood as well as gold
- [ ] Furnace/Anvil recipes present but unpurchasable, with the reason in a comment

### T-32.02 — The invariants that keep processing worth doing but not free
Depends: T-32.01 · Size: S
Files: `packages/shared/src/config/config.test.ts`
**Do:** Every recipe's output must outsell its inputs; no recipe may beat raw
selling by more than a stated multiple **per hour** (a recipe that triples value
over eight hours is a different thing from one that triples it in ten minutes);
all gold integer.
**Done:**
- [ ] Output-beats-input asserted for every recipe
- [ ] A per-hour ceiling asserted, with the chosen multiple justified in a comment
- [ ] Break-tested: a recipe that outputs less value than it consumes fails

### T-32.03 — Tables
Depends: T-32.01 · Size: M
Files: `apps/server/src/db/schema.ts`, `apps/server/src/drizzle/`
**Do:** `machines` (owner, kind, x, y) and `machine_jobs` (machineId, inputItemId,
quantity, startedAt, collectedAt). Pre-launch, so the migration must apply cleanly
to an empty database; no backfill.
**Done:**
- [ ] Migration applies to an empty DB (`db:generate` then `db:migrate`)
- [ ] Ownership is expressible without trusting a client field
- [ ] Index supporting "this player's machines" exists

### T-32.04 — `jobStateAt`, pure
Depends: T-32.03 · Size: M
Files: `apps/server/src/modules/artisan/service.ts` (new),
`apps/server/src/modules/artisan/service.test.ts` (new)
**Do:** A pure `jobStateAt(job, now)` modelled directly on
`modules/animals/production.ts`. Readiness is computed on read; **nothing
ticks and nothing is scheduled.**
**Done:**
- [ ] Pure — no DB access, `now` passed in; a test calls it with three fixed clocks
- [ ] A job loaded and not collected stays ready indefinitely (it does not spoil —
      nothing in this game is destroyed by absence)
- [ ] Break-tested: reading `Date.now()` inside it fails the fixed-clock test

### T-32.05 — Load and collect
Depends: T-32.04 · Size: M
Files: `apps/server/src/modules/artisan/routes.ts` (new),
`packages/shared/src/schemas/index.ts`, `apps/server/src/app.ts`,
`apps/client/src/net/artisan.ts` (new), `apps/client/src/net/errors.ts`
**Do:** `GET /api/artisan`, `POST /api/artisan/load`, `POST /api/artisan/collect`.
Collect claims with `WHERE collected_at IS NULL RETURNING` — an empty result means
someone else won. Zod, rate limit, ownership, `runIdempotent`, machine-readable
errors.
**Done:**
- [ ] Loading a busy machine is refused with a code
- [ ] Collecting into a full backpack fails with `INVENTORY_FULL` and **leaves the
      output in the machine** — nothing is destroyed
- [ ] Two concurrent collects yield exactly one payout
- [ ] Another player's machine is refused

### T-32.06 — Machines are placed, and wood finally buys something
Depends: T-32.05 · Size: M
Files: `apps/server/src/modules/decor/`, `apps/server/src/modules/artisan/`,
`apps/client/src/game/scenes/Farm.ts`
**Do:** Buy and place machines through the existing decor placement path,
including the reachability flood-fill that stops a player walling themselves off.
Build costs consume **wood**, making it the game's first non-gold sink —
`docs/economy.md` priced wood at 5g precisely as "a crafting input... revisit when
there is something to build." Whether a machine is solid opens **D-26**; the decor
`solid` precedent (D-9) is the model.
**Done:**
- [ ] Placement refused where decor placement would be refused
- [ ] Wood is consumed and the sink is logged
- [ ] D-26 recorded in the Open Decisions table, not settled in code
- [ ] A machine cannot be placed such that a plot or animal becomes unreachable

### T-32.07 — Machines on screen
Depends: T-32.06 · Size: M
Files: `packages/shared/src/config/assets.ts`, `scripts/prepare-assets.mjs`,
`apps/client/src/game/scenes/Farm.ts`
**Do:** Machine sprites with idle / working / ready states. Work-bench art is
**single images**, so they append to `IMAGES` — **zero gid shift, no map
regeneration.** A ready machine must be readable at a glance from across the farm;
use Phase 30's float text on collect.
**Done:**
- [ ] Sprites in `IMAGES`; `farm.json` untouched — verified by `git diff`
- [ ] Ready state distinguishable in a screenshot, not only in the DOM
- [ ] Console clean after the asset change

### T-32.08 — The Cheese Press, which is the cow fix
Depends: T-32.05 · Size: S
Files: `packages/shared/src/config/{machines,items}.ts`, `docs/economy.md`
**Do:** Milk becomes the input to the highest-margin good in the game, **with no
change to milk's price.** The cow stops being dominated because its output is
worth more than its sale value, not because the sale value was raised — which
also keeps the chicken's egg economy untouched.
**Done:**
- [ ] `balance-analyst`'s dominated-strategy sweep no longer flags the cow
- [ ] The chicken is not dominated in turn — check both directions
- [ ] Egg processing exists too, so the fix is not "cows good, chickens obsolete"

### T-32.09 — Re-model, and close the cow finding
Depends: T-32.08 · Size: M
Files: `docs/economy.md`
**Do:** An artisan rate table (g/hr per machine per recipe, and per machine slot,
since machine count will be the scarce resource). Rewrite finding 1 as
**resolved-by-conversion rather than resolved-by-price**, and re-check finding 2
now that plots feed machines. Re-measure the trade-gate wall clock.
**Done:**
- [ ] Artisan rate table added
- [ ] Finding 1 rewritten with the new numbers
- [ ] Finding 2 re-checked: is plot expansion rational yet?
- [ ] Trade-gate wall clock re-measured

---

# Phase 33 — The village speaks

Milestones are a checklist; **quests are direction**. They need a rich item space
to ask for, which is exactly what Phases 31 and 32 just built — a quest board
over four crops and no recipes would ask for the same three things forever.

### T-33.01 — A dialogue box  ✅ **DONE**
Files: `packages/shared/src/config/{dialogue.ts,dialogue.test.ts}` (new),
`apps/client/src/game/{dialoguePanel.ts,dialoguePanel.test.ts}` (new),
`apps/client/src/styles/hud.css`, `packages/shared/src/config/index.ts`

**How it turned out.** Line trees keyed by NPC and state, a pure cursor
(`{nodeId, line}`) that the action key advances, and a DOM panel that renders
whatever the config says. Adding the Chef and the Blacksmith (T-33.03) is an
entry in one file.

**A node is a beat; a line is a press.** The first shape split on both axes — a
node per line, chained by `next` — and turned a two-sentence greeting into five
config objects with four ids nobody reads. `lines` being plural is what keeps
the table readable, and it puts one real bug within reach: advancing the NODE
first and then showing its first line silently drops the last line of every
node, which reads as a writing mistake rather than a code one. There is a test
named after exactly that.

**Modal, unlike the goal board, and the reason is the verb.** The board is a
popover because you read it *while walking to the sixth plot*; a conversation is
the one HUD element where the player is meant to be still. It carries
`MODAL_ATTR`, so `lib/focus.ts` freezes movement — verified by holding D through
a whole conversation and watching the character not move.

**The art was measured and then not used, on the existing precedent.**
`UI/dialogue box.png` is a 144x96 sheet holding two frames and a dozen speech
bubbles; the frame worth having is a 48x48 region at (0,48). `border-image`
slices from the source image's OUTER edges, so a 5px slice of that sheet takes
pixels from four unrelated corners — the identical trap hud.css records for the
button plate, whose fix was "draw it in CSS, crop nothing". The three colours
are measured out of that frame rather than eyeballed (#FFD2A1 fill, 2,058px;
#1C0A18 border, 188px; #D9884C shade, 54px), so if somebody does crop the art
later the box is already the right colour. The nine-`background-position`
alternative — a real 9-slice of a sub-region — is noted in the stylesheet so
nobody has to rediscover that it is possible.

**`DIALOGUE_MAX_LINE` was wrong, and measuring is what found it.** Reasoning
from the box width, the font and the padding gave "about 46 characters a row, so
132 is three rows". Growing a real sentence a word at a time inside the real box
at 390x844 gives **40 a row and 120 for three**: the arithmetic forgot that lines
break at WORDS, so the tail of every row goes on the break rather than on text.
The constant is 120 and the comment now says how it was obtained. The first
attempt to measure it was itself wrong in a way worth recording — it injected a
`.dialogue` into the LANDING page, which does not load `hud.css`, and dutifully
measured unstyled text at 17px.

**Done:**
- [x] Lines live in shared config — not one string in a scene
- [x] Advances by the action key (E and Space) and by clicking the box
- [x] Keyboard reachable; takes focus on open and returns it on close, before
      the callback runs so the shop it opens keeps the focus it takes
- [x] Escape closes and is consumed (T-18.13's rule)
- [x] Fits 390x844 — 358px wide, three rows reserved, measured in the browser
- [x] 24 tests; four break-tested (dangling `next`, a cycle, a 121-character
      line, an orphaned node)

### T-33.02 — The merchant finally talks  ✅ **DONE**
Files: `packages/shared/src/config/dialogue.ts`, `apps/client/src/game/hud.ts`,
`apps/client/src/game/scenes/Farm.ts`

**How it turned out.** Four states — first meeting, night, established, and a
plain greeting — chosen by a pure `dialogueStateFor` from the level the bar last
rendered, the segment `timeOfDayAt` computes from the wall clock, and a
localStorage flag for whether these two have met.

**The dialogue is a doorway, not a gate.** `show()` returns `false` when the
merchant has nothing to say, and then the shop opens exactly as it did before —
so deleting every line degrades this back to T-11.04's behaviour rather than
shutting the shop. That is what let the wiring be one line in `Farm.ts`'s
`open` table.

**The ordering of the states is the design, and it is tested.** A player meeting
the merchant for the first time at midnight gets the introduction, not the night
line, because the introduction is the only branch that plays once. Everything
below it is flavour and may be missed.

**`met` is a browser flag on purpose** (§4.1). An introduction that plays once is
flavour, not progress: clear your storage and you hear it twice and gain nothing,
which is the test for whether something may live client-side at all. The server
alternative is a column, a migration and an endpoint for a line of dialogue.

**Files differ from the plan.** The task named `entities/MerchantNpc.ts`; the
sprite has no part in this. The action key already resolves the stall to
`{kind: 'open', what: 'shop'}` in `actions.ts`, so the merchant learning to talk
is `shop: () => hud.talkToMerchant()` — one entry in one table.

**Done:**
- [x] Facing the merchant and acting opens dialogue, then the shop — verified
      end to end at 1366x768 and 390x844
- [x] Lines vary by state rather than repeating one string

### T-33.02b — The coach hint had to stand down  ✅ **DONE**
Files: `apps/client/src/styles/hud.css`

**Found in a screenshot, not in a test.** `.hud__coach` sits at `bottom: 4.6rem`
and the dialogue box lands on top of it, so *"Walk with WASD. Face a plot and
press E to break the soil with your hoe"* printed across the bottom edge of the
merchant's first line — two pieces of instructional text arguing over the same
forty pixels, one of them telling the player to press the key they are already
pressing.

`.hud:has(.dialogue:not([hidden])) .hud__coach { visibility: hidden }`.
**`visibility`, deliberately not `display` or the `hidden` attribute**: the strip
retires itself after the first harvest and `hud.ts` owns that through
`coachEl.hidden`. Taking it out of the layout here would give one element's
visibility two owners, which is precisely the collision BUG-24 and
`hudHidden.test.ts` are about. This suppresses paint only, and only while
somebody is talking.

### T-33.03 — Two more faces, and only one of them exists  ✅ **DONE (half — opens D-28)**
Files: `packages/shared/src/config/{assets.ts,farmLayout.ts,dialogue.ts}`,
`scripts/prepare-assets.mjs`, `apps/client/src/game/entities/VillagerNpc.ts`
(replaces `MerchantNpc.ts`), `apps/client/src/game/{actions.ts,hud.ts}`,
`apps/client/src/game/scenes/Farm.ts`,
`apps/client/src/game/entities/reachability.test.ts`

**The Chef is in. The Blacksmith cannot be, and the reason is the pack.**
`Character/NPC'S/` has five folders but only two **premade** townsfolk —
Gaston the Chef and Alaric the Blacksmith — and `prepare-assets.mjs` has been
copying *Alaric* to `npc-merchant-idle.png` since T-18.02. The shopkeeper has
been a blacksmith in a leather apron this whole time. Placing a blacksmith today
would put his identical twin in a field forty tiles away. See **D-28**.

The other three folders do not rescue it: Child is two action poses, Pirate is a
portrait plus a 128x128 sheet in a different layout, Mermaid is 128x32 and is a
mermaid. Everything else in those folders is the **layered** tree — Skins, Hair,
Eyes, Clothers, Beard as separate strips — which is a different renderer, not a
different file.

**Measured before use** (§9), and the measurement is what made the collision
obvious: chef and blacksmith strips are both 512x32, 16 frames of 32x32, alpha
bottom row 25 in all sixteen — identical to the merchant's and to the player's
`CHAR_ART.bottom`, so `CHAR_ORIGIN` places all three unchanged. Rendering blocks
0 and 1 side by side shows a face then the back of a head, so block 0 is the
front view for both; blocks 2/3 measure narrower, which is the side-view
signature. The merchant and "blacksmith" measured *byte-identically*, which is
how the duplication surfaced.

**`MerchantNpc` became `VillagerNpc`, and the phase's claim is now true of code
as well as content.** It was one hardcoded strip at one hardcoded tile. It takes
a `VillagerDef` now, and `VILLAGERS` lives in **shared config** rather than the
client — because `objectFootings()` reads it to make their tiles solid and the
scene reads it to draw them, and two lists means a villager who is drawn but
walk-through, or solid but invisible. Keeping it Phaser-free is also what lets
`reachability.test.ts` check it in node.

**A new `talk` dispatch, not a fifth `OpenIntent.what`.** The merchant stays an
`open`, because facing the vendor and facing their counter mean the same thing
there and the stall's arm already covers both. The Chef has no counter, so the
character *is* the target — and `talk` carries which villager, which no `what`
string could.

**Two things the tests caught that a screenshot would not have.**

- **(6,14) was the first choice and the ground scatter had it.**
  `farmMap.test.ts` refuses scatter on ground that is spoken for, and the
  authored map decorates x=3, 6, 8, 11, 14, 17 along that row. The villager
  moved to (5,14) rather than the map losing a flower: T-33.03 promises
  `farm.json` is untouched, and a task that quietly edits the map to make room
  for a constant is how the two drift apart again (M6).
- **The first reachability guard passed a Chef standing in the sea.** Break-tested
  at (0,0) — the farm's one water tile — and all three checks said fine: not a
  building, so `reservedBy` was silent, and the two dry neighbours were walkable.
  The gap is that a villager's own tile is solid *because of them*, so asking the
  real world "is this free" always answers yes. There is now a fourth check
  against a world built **without** the villagers, which is the only way to ask
  whether the ground was already taken.

**Done:**
- [x] The Chef placed, drawn, solid, and reachable
- [x] `farm.json` untouched — verified byte-identical, not just by `git diff`
- [x] Reachability test extended: four checks per villager, run against the
      worst-case world so a future Deluxe barn cannot wall somebody in
- [x] Break-tested: Chef inside the coop fails three, Chef in the sea fails the
      fourth
- [ ] **The Blacksmith — blocked on D-28**

**In the browser**: facing (5,14) resolves to `{kind:'villager', npc:'chef'}`,
the box says *Chef*, both first-meeting lines step through, **the shop stays
closed** — the Chef has nothing to sell — and walking south into him does not
move the character a pixel. No console errors.

### T-33.04 — `config/quests.ts`  ✅ **DONE**
Files: `packages/shared/src/config/{quests.ts,quests.test.ts}` (new),
`packages/shared/src/config/index.ts`

**How it turned out.** Six quests across the two givers who exist, typed
`{ id, giver, title, summary, requires, reward, unlockLevel }`. The reward type
is `MilestoneReward`, **reused rather than copied** — `grantReward`'s own comment
already anticipated this (*"this function is the boundary quests will also come
through"*), so quests inherit the tool guard, the `INVENTORY_FULL` rollback and
the single logged faucet without a line of new grant code.

**`unlockLevel` is the obtainability guarantee, not decoration.**
`PRODUCE_UNLOCK_LEVEL` is derived from `CROPS` rather than restated, and
`obtainableAtLevel` is what the test checks every requirement against. That is
what will let T-33.06 derive its board from `unlockLevel` alone instead of
re-deriving obtainability per request — "never offers an unreachable request"
becomes a property of the data.

**The economic invariant caught my own table on the first run**, which is the
whole reason it is written in terms of `shopSellPrice` rather than a hand-picked
fair figure: `chef_root_veg` asked for 396g of carrots and potatoes and paid
222g. A player would have shipped them instead and learned that quests are a
trap. Re-tuned to a deliberate 1.4–1.5x band across the five produce quests —
generous enough to be worth doing when you were growing the thing anyway, not so
generous that growing the quest crop becomes the only rational play. A second
test bounds the top end for the same reason.

**One quest breaks the band on purpose.** `merchant_restock` pays 3x for ten
wood, because `docs/economy.md` records wood's price as effectively dead at 5g a
log — Phase 32 was going to fix that by spending wood on machines and is
superseded. Until something does, this is the only thing in the game that makes
carrying the axe worth it, and ten logs cannot become anybody's income. The
reason is in the table, next to the number.

**Two guards the brief did not ask for and the game needs.** A quest must never
*ask for* a tool — tools are stack-1 and unique per player, so consuming one
would take the player's only hoe with no way back — and every giver must be
somebody `config/dialogue.ts` can speak for, or a board would offer a quest from
a character who cannot say a word about it.

**Done:**
- [x] Every required item exists and is obtainable at the quest's unlock level
- [x] A test asserts no quest asks for something the player cannot yet make
- [x] Rewards are integers and grant nothing untradeable-but-valuable
- [x] 67 tests; four break-tested (a level-1 cabbage quest, a quest demanding the
      player's hoe, a quest granting an axe, a giver with no dialogue)

### T-33.05 — Accept and turn in  ✅ **DONE**
Files: `apps/server/src/modules/quests/{service,board,routes,routes.integration.test}.ts`
(new), `apps/server/src/db/schema.ts`, `apps/server/drizzle/0015_regular_justice.sql`,
`apps/server/src/app.ts`, `packages/shared/src/{errors.ts,schemas/index.ts}`,
`apps/client/src/net/{quests.ts,errors.ts}`

**How it turned out.** `quest_progress` (playerId, questId, acceptedAt,
completedAt) with the same unique index `milestone_claims` has, three endpoints,
and a board derived on read. `grantReward` is used **unchanged**, so quests
inherited its tool guard, its items-before-gold ordering and its
`INVENTORY_FULL` rollback without a line of new grant code — the payoff for
T-33.04 reusing `MilestoneReward` rather than inventing a shape.

**The completion is claimed BEFORE anything is consumed.** An
`UPDATE … WHERE completed_at IS NULL RETURNING` either wins or returns nothing —
the guard `modules/shipping/service.ts` already uses — so of two concurrent
turn-ins only one gets past that line, and the loser has consumed nothing
because it never reached the consume. Doing it the other way round lets both
requests pass the "do you have the items" read and relies on the rollback to
save you, which is relying on the rollback rather than on the design.

**Break-testing found a claim I could not support, which is the entry worth
reading.** The comment said consuming before granting meant "a full backpack
cannot be exploited". Swapping `grantReward` ahead of `removeItem` **passed all
nineteen tests** — because the whole thing is one transaction and a failure at
either end unwinds both, so no value was ever at risk either way. The ordering
is real but it is about **playability, not safety**: hand over four leeks from a
full bag and the slot they vacate is exactly where the reward goes, so consuming
first makes room that granting first never sees. A player would be told their
bag is full while holding the goods that would empty it. There is now a
full-backpack turn-in test that fails on the reversed order, and the comment says
what the ordering actually buys.

**The level check lives on `accept`, not only on the board.** The board is a
suggestion; this is the gate. A client that posts a quest id it read from
somewhere else is refused by the same `questsForLevel` arithmetic that decides
what the board shows — and `farmLevelOf` is the function `toSelfPlayer` and the
trade gate already use, so a quest cannot be offered on one definition of level
and refused on another.

**"Another player's quest row is refused" is a property, not a check.** Neither
payload carries a player id, so the only row either endpoint can touch is the
session cookie's. The test proves the consequence: a second player turning in the
first player's accepted quest gets `QUEST_NOT_ACCEPTED`, and the first player's
row and leeks are untouched.

**Done:**
- [x] Turning in without the items is refused and consumes nothing — tested with
      the player holding *some* of the ask, since an empty bag cannot tell a
      careful refusal from a lucky one
- [x] Partial failure grants nothing and consumes nothing — and the completion
      claimed before the consume rolls back with it
- [x] Turning in twice grants once — tested concurrently, with two distinct
      idempotency keys so `runIdempotent` cannot collapse them, and enough leeks
      in the bag for a double-pay to be possible
- [x] Another player's quest row is refused
- [x] 20 integration tests; three break-tested (the `IS NULL` guard, the level
      check, and the consume/grant order — the third of which needed a new test
      written before it could fail)

### T-33.06 — A board that only asks for what you can make  ✅ **DONE**
Files: `packages/shared/src/config/{rng.ts (new),quests.ts,quests.test.ts}`,
`apps/client/src/game/animalWander.ts`,
`apps/server/src/modules/quests/{board.ts,service.ts,routes.ts,routes.integration.test.ts}`

**How it turned out.** The board has two halves now. The six authored quests are
one-time and permanent; on top sit **three derived requests that rotate every six
hours**, generated from the crops the player can already grow.

**"Only asks for what you can make" is a construction, not a filter.** The
generator draws from `growableAtLevel(farmLevel)`, so there is no code path that
could produce an unreachable request — the property is tested at eight levels
rather than spot-checked on the three a board happens to pick.

**Deterministic from `(playerId, rotationIndex)` and nothing else, which is both
required properties at once.** Refreshing cannot re-roll because the inputs did
not change; the rotation cannot be farmed because there is no term a player
controls. **No seed column** — the seed is derivable, which is the argument
`timeOfDayAt` already makes for the clock, and a stored seed would be a row to
migrate for something recomputable.

**The rotation index is IN the request id** (`daily:82777:0`). That is what lets
one `quest_progress` column and one unique index carry both halves of the board,
and it makes a stale offer refuse itself: an id from last rotation resolves to
nothing, with no stored history of what used to be offered. Verified from both
directions — an id one rotation in the past and one in the future are both 404.

**Six hours, and the reasoning is against the obvious alternative.** The in-game
day is twenty minutes, so a board rotating with it would turn over three times an
hour and a player who left to make tea would come back to different work. Six is
also deliberately not a divisor of 24: a daily boundary means the player who
plays at 8am meets the same slot forever.

**`seedFrom` and `noise` moved to shared rather than being copied.** They were
written for the animal wander; a second FNV-1a that drifted by one constant would
make the client and the server disagree about what a seed means, which is the
worst possible shape for this bug. `animalWander.ts` re-exports them so it stays
the one place the wander reaches for its randomness.

**A test of mine was wrong and the code was right**, which is worth recording
because it is the opposite of the usual entry: "the board is unchanged within a
rotation" was written as `NOW + QUEST_ROTATION_MS - 1`, which crosses the
boundary whenever `NOW` is mid-rotation — as nearly every timestamp is. The fix
was to align the fixture to a rotation start, and the comment now says that
"within a rotation" is a claim about the rotation's own span.

**Done:**
- [x] Offers are derived from unlocked content; tested at eight farm levels, and
      at the endpoint for a brand-new account
- [x] Rotation is deterministic and not re-rolled per request — proved through
      two identical HTTP calls, not only in the pure function, because a board
      that reseeded per request would pass a pure test that calls it once
- [x] The rotation cannot be farmed — accepting a request does not change what
      else is offered
- [x] Every derived request beats selling the goods, by construction; checked
      across 40 rotations at six levels
- [x] Three break-tests: seeding on the clock, dropping the level filter, and a
      margin below 1x each fail the guard that names them

### T-33.07 — The quest log  ✅ **DONE**
Files: `apps/client/src/game/{questPanel.ts,questPanel.test.ts}` (new),
`apps/client/src/game/{milestonePanel.ts,hud.ts}`,
`apps/client/src/net/quests.ts`, `apps/client/src/styles/hud.css`

**T-30.09's `BOARD_SECTIONS` paid off exactly as advertised.** The quest log
arrived as one entry in that list plus a source for its rows — no second panel,
no second open state, no second Escape handler, no second place on screen for the
player to learn. The declaration was written a phase early on the guess that this
would happen, and it was right.

**Tabs rather than two stacked lists**, which is a departure from how
`BOARD_SECTIONS` was first imagined. The board is a narrow left-hand column that
has to fit 390x844 above the hotbar; two lists of three rows each puts the second
below the fold on a phone, where it is a section nobody scrolls to. The active
tab is also the title, so the strip costs no vertical space at all.

**The rows are a pure function, tested in node**, split out for the reason
`goalRows` was. The interesting failure is a bar that lies: six carrots and three
potatoes, holding thirty carrots and no potatoes, is 6/9 — not "nearly there".
`questPercent` caps each requirement before summing, and the test is named after
that. `canTurnIn` is deliberately **not** `percent === 100`: rounding reaches 100
before the last item does on a large enough ask, and a Hand in button that
refuses is worse than one not offered.

**A real bug, found only in the browser.** Four leeks in the bag, an accepted
request, and no Hand in button — because the board renders requirement progress
against the BAG, and nothing told it the bag had changed. It was re-read on the
farm poll and nowhere else, so every harvest left the row stale for up to a poll
interval. `setSlots` now calls `goals.redraw()` alongside the `shop.refresh()` it
already made for the identical reason: one funnel, so a panel showing inventory
cannot disagree with the inventory. A redraw, not a re-fetch — nothing the server
knows has changed.

**Done:**
- [x] Both lists in one panel; the tab strip is keyboard reachable and was
      switched with Enter in the verification run, not a click
- [x] Turn-in from the log plays the Phase 30 float text — screenshotted mid-rise
      off the character
- [x] Fits 390x844 — 228px wide, bottom at 673 of 844, four rows legible
- [x] 15 new pure tests

**In the browser, end to end**: accept "Something green" from the log, four leeks
into the bag, the row turns to `4 / 4 Leek` with a **Hand in** button, the
turn-in consumes the leeks, grants four potato seeds, floats the reward off the
character, and the finished request drops off the list. No console errors at
either viewport.

### T-33.08 — Has the trade gate got cheaper?  ✅ **DONE — no change recommended**
Files: `docs/economy.md`,
`apps/server/src/modules/quests/routes.integration.test.ts`

**The premise in the task was wrong, and checking it was the task.** It says
"quest and milestone XP both shorten the wall-clock cost". Neither pays XP:
`claimMilestone` and `turnInQuest` both call `grantXp(…, 0)` — a read dressed as
a grant so every paying action returns the same shape. That is not a reason to
skip the measurement; it is the first thing the measurement had to establish, and
it now has a **test** rather than an argument behind it.

**The property is pinned and break-tested.** Two integration tests assert a
turn-in leaves `players.experience` untouched, for an authored quest and a
rotating request; making a quest pay 50 XP fails both. Quests are the first
system in this game that pays for an ACTION rather than for a wait, and
`config/level.ts` names exactly that as the thing that would break the anti-alt
control — so it needed to stop being a property that holds only because nobody
has argued the other way yet.

**The indirect path was measured, not dismissed.** Gold → plots → XP per hour is
real, and `docs/economy.md` already named it as the one lever that moves the gate
linearly. In 24 hours Phase 33 adds a **net 2,384g** (1,000g from the six
authored quests, 1,384g from four rotations of three requests, both net of what
the goods would have sold for). That funds **two extra plots** — the third is
1,116g out of reach.

**And two extra plots move the wrong number.** Reaching 494 XP costs the same
number of *harvest actions* whichever way the farm is shaped — 247 parsnip
harvests at six plots, 247 at eight — because `xpForHarvest` pays per crop. Plots
buy parallelism, not fewer actions. Elapsed time falls from 8.2 h to 6.2 h; the
attacker's **~8 human-hours of attention** is unchanged, and both are far under
the 24-hour account age that actually binds.

**Recommendation: `TRADE_MIN_FARM_LEVEL` stays at 5.** The gate did not get
cheaper in the currency it is denominated in, and raising it would cost every
legitimate new player real time to defend against a saving the attacker did not
make. `docs/economy.md` records what to re-measure next: the three-per-six-hours
cap and `DAILY_REQUEST_MARGIN` both scale the net gold above linearly, and
anything that lowers `plotUnlockCost` runs the whole indirect path again.

**Done:**
- [x] Wall clock to level 5 measured with all XP sources active — and the
      distinction that matters (actions vs elapsed) surfaced by measuring
- [x] Compared against the figure before this phase (T-31.08's 8.2 h)
- [x] A recommendation recorded: **unchanged, no action**, with the reason and
      the re-measurement triggers

---

## Phase 33 complete — the village speaks, and asks for things

Eight tasks. The phase's premise was that quests need a rich item space to ask
for, and that Phases 31 and 32 would provide it; 32 never shipped, and the phase
worked anyway — because a board derived from what the player can grow does not
care how much there is to grow.

**What this phase found that nobody was looking for.**

- **The shopkeeper has been wearing the blacksmith's clothes since T-18.02.**
  `npc-merchant-idle.png` is a copy of `Blacksmith/Premade/Alaric`, and the pack
  ships exactly two premade townsfolk. T-33.03 shipped at half scope and opened
  **D-28** rather than putting the merchant's twin in a field.
- **Three guards passed for the wrong reason and only break-testing found it.** A
  villager standing in the sea satisfied every reachability check; the
  consume-then-grant ordering in `turnInQuest` was not covered by any of nineteen
  tests; and a quest paying XP would have gone unnoticed. Each needed a *new
  test written before the break could fail* — which is the difference between
  break-testing and re-running the suite.
- **The quest log showed stale bag counts**, because it was re-read on the farm
  poll and nowhere else. Found in the browser with four leeks in the bag and no
  Hand in button.
- **A test of mine was wrong and the code was right** (T-33.06), which is worth
  recording precisely because it is rare: "unchanged within a rotation" asserted
  across a boundary that nearly every timestamp crosses.

**What T-30.09 bought.** `BOARD_SECTIONS` was declared a phase early on the guess
that a quest log would land in the same panel. It did, as one entry plus a source
for its rows — no second panel, no second open state, no second Escape handler.
Shaping for a second list before there was one cost three lines and saved a
window.

**What is deliberately still not done.** The Blacksmith waits on D-28. The Chef
asks for produce rather than cooked goods, because cooking does not exist and a
Chef offering to buy it would be a promise the game cannot keep. And T-34.07's
plan to route fish into machines and quests is now half-available: the quest half
exists, which is one of D-27's two open questions answered by this phase rather
than by Phase 34.

---

# Phase 34 — Fishing

**First among the new verbs, and the map argument is decisive.**
`config/farmLayout.ts:45,55` already defines `WATER_COLS = [0]` and `SHORE_COL = 1`
— **a walkable shoreline with water beside it exists on the live farm today.** No
new map, no new scene, no camera work, no collision work. The pack's five-stage
Cast/Wait/Bite/Reel/Catch chain maps onto the layered per-animation strips
`Player.ts` already drives. And fishing is the only candidate that is genuinely a
**skill-expression minigame**, which is what "active play is where depth lives"
actually requires.

### T-34.01 — `config/fish.ts`  ✅ **DONE**  *(unblocked by D-27 — the table does not care where you fish)*
Files: `packages/shared/src/config/{fish.ts,fish.test.ts}` (new),
`packages/shared/src/config/index.ts`

**Eighteen river fish, not nine.** `Icons/Fish/River/` holds eighteen, each a
64x16 strip of four 16x16 frames. **This is the third phase brief in a row that
was wrong about the pack** — T-31.01's frame counts, T-33.03's premade
townsfolk, and now this — which is the argument for every one of these tasks
opening with a count rather than a read.

**Rarity is a weight, never a probability**, so a level gate can remove a fish
without every other number needing re-tuning to keep a total at 1. `rollFish`
renormalises over whatever is actually available and walks cumulative weights —
break-tested against the obvious wrong implementation, `pick`, which is uniform
over a count and would make the Golden Fish as likely as a Carp.

**"Genuinely rare without being a slot machine" is now a number.**
`RAREST_MIN_ODDS = 1/250` and `RAREST_MAX_ODDS = 1/60`, with the Golden Fish at
**1 in 198** — a dedicated session reaches it, and it is still a thing that
happens to you rather than a thing you farm. Break-tested at weight 1 (1 in 790),
which fails as a lottery.

**Two invariants caught my own table on the first run**, which is the entry worth
reading. The Golden Fish was weight **6** — picked to land inside the odds band —
which made it *commoner* than the very-rare band while paying nearly twice as
much: exactly the rarity-and-value inversion that turns a rare drop into a
disappointment. It was also priced at 700g, above the dearest crop, putting the
whole fishing economy outside the band it is meant to sit in. Now weight 4 at
540g.

**And the test that caught it was itself too weak.** It walked the weight-sorted
list comparing neighbours, which only ever checks the pair either side of a band
boundary — a common fish priced like a rare one three bands away would sail
through. It caught the Golden Fish by luck of where that fish sat. Rewritten to
compare every cross-band pair.

**No season may be a dead pond.** The season field is unenforced until Phase 35,
so an empty season would surface only when somebody turned it on — by which point
the table would have drifted for two phases with nobody able to see it. Every
season holds at least six fish, and a level-1 farm can fish in all four.
Break-tested by emptying winter.

**Expected value per cast**: 32g at level 1 rising to 71g at level 9 — above a
single idle plot (14-57 g/hr) and well below a whole farm, which is the shape
active play should have. T-34.09 balances it properly against a real cast
duration; the test bounds it at 20-150g so a price edit cannot move it by an
order of magnitude in the meantime.

**Done:**
- [x] Weights sum to a tested total; every fish reachable (weight > 0, refused)
- [x] Season sets present and unenforced, with every season kept fishable
- [x] Sell prices sit inside the economy band — defined as the crops' own
      9-566g range, since that is what the player is choosing between
- [x] 130 tests; three break-tested (uniform draw, a lottery-rare fish, an empty
      winter)

### T-34.02 — The server rolls the fish  ✅ **DONE**  *(not blocked by D-27 after all — see below)*
Files: `packages/shared/src/config/{fishing.ts (new),energy.ts}`,
`packages/shared/src/{errors.ts,schemas/index.ts}`,
`apps/server/src/modules/fishing/{service,routes,routes.integration.test}.ts` (new),
`apps/server/src/db/schema.ts`, `apps/server/drizzle/0016_absurd_amphibian.sql`,
`apps/server/src/app.ts`

**A correction to my own last entry.** I recorded that everything left in Phase
34 was gated on D-27. That was wrong: **§4.1 and §5.1 say the server never
validates position**, so the fishing endpoints do not need to know where the
water is — standing at it is a client-side UX gate, exactly like facing a plot to
till it. This module would be identical wherever the pond ends up, which is the
strongest possible evidence that the rule is doing its job. D-27 blocks T-34.05
and T-34.06 only.

**The fish is rolled and stored at CAST time**, which makes the reel a judgement
about the clock rather than about the roll. Rolling on reel would make the
outcome depend on when the player clicked, and a client that could nudge that
timing could nudge its luck.

**The response is `{ castId, biteAt }` and nothing else.** The test asserts that
against the serialised body rather than field by field — a future addition
leaking the fish under a different key would slip past a named-field check. It
checks all eighteen fish ids, plus `seed`, `weight` and `window`. Break-tested by
returning `fishId`: two tests fail.

**Energy is the anti-bot control; the rate limit is the second line.** The task
asks that "a bot casting flat out gains nothing over a person" — a rate limit
alone cannot deliver that, because a bot at the limit out-fishes a person who
isn't. `EnergyAction.CAST` costs **3**, so a 40-point bar is thirteen casts for
anybody, script or not. At T-34.01's 32-71g that is 416-923g of fishing between
sleeps: a session's worth of alternative income, not a replacement for the farm.
Break-tested by removing `spendEnergy`.

**One line at a time is a partial unique index, not a read-then-write.** Two
casts arriving together cannot both open, and the loser is told rather than
silently replacing the first. The pre-read exists only to give a friendlier
message; the index is what actually holds.

**The bite delay is a range, not a constant**, and there is a test for it: a
fixed delay is a metronome, the player stops watching the water and starts
counting, and T-34.05's five-stage animation has nothing to say. Break-tested by
pinning it to `BITE_MIN_MS`.

**A refused cast costs nothing**, both ways round — no energy when the line is
already out, no line when there is no energy. One transaction, so a failure at
either end unwinds the other.

**Done:**
- [x] The response contains no seed, no rarity table and no fish identity before
      the reel — checked against the whole body, not named fields
- [x] Casting twice without reeling is refused, including concurrently
- [x] Rate limited, and energy is what makes a bot no better than a person
- [x] 14 integration tests; three break-tested (leaking the fish, dropping the
      energy charge, a fixed bite delay)

### T-34.03 — Reeling, judged by the server's clock  ✅ **DONE**  *(also not blocked by D-27)*
Files: `packages/shared/src/schemas/index.ts`,
`apps/server/src/modules/fishing/{service,routes,routes.integration.test}.ts`,
`apps/client/src/net/{fishing.ts (new),errors.ts}`

**`.strict()` is the whole task in one word.** Every other schema in this project
is permissive about extra keys, because extra keys are harmless when nothing
reads them. `reelSchema` refuses them — a client that helpfully includes
`reactionMs` gets a **400 saying the field is not accepted**, not a silent
success that leaves the sender believing it counted. This is the one measurement
in the game a player is directly rewarded for lying about, so ignoring the lie is
not good enough; the field must not exist.

Break-tested by dropping `.strict()`: `reactionMs`, `elapsedMs` and `now` are all
accepted and the exploit test fails.

**A miss consumes the cast**, and the reason is mechanical rather than
thematic: if an early reel left the line in the water, hammering the button would
be strictly better than watching for the bite, and the minigame would be a
formality attached to a lottery — exactly what T-34.01's difficulty ratings exist
to avoid. Break-tested by restoring the line on a miss: two tests fail.

**A miss tells the client nothing about what it lost.** `fishId` is `null` unless
the reel landed. Telling a player turns every miss into a specific regret;
telling a *script* tells it whether that cast was worth retrying. Break-tested by
returning the fish on a miss.

**The bag can refuse the fish, and that rolls the reel back with it.** `addItem`
throws `INVENTORY_FULL` after writing nothing, and because it runs inside the
same transaction as the reel claim, a player with a full bag still has a line in
the water and a clear error — rather than a fish that silently evaporated, which
§5.5 names as the one failure this project must never have.

**Two refusals share one message.** A cast that does not exist and a cast
belonging to somebody else both return `NO_LINE_OUT`. A distinct 404 for the
second would confirm the id is real, which is a small oracle nobody needs.

**Done:**
- [x] The payload carries no timing value; the schema **rejects** one rather than
      ignoring it, tested with three different field names
- [x] Reeling before the bite fails, and consumes the cast
- [x] Reeling long after the bite fails cleanly
- [x] Break-tested: dropping `.strict()` fails the exploit test — plus two more
      breaks on the miss behaviour
- [x] 24 integration tests across cast and reel, including concurrent reels
      landing exactly one fish

### T-34.04 — Fish as items  ✅ **DONE**  *(also unblocked by D-27)*
Files: `packages/shared/src/config/{assets.ts,items.ts,tilesets.test.ts,config.test.ts}`,
`scripts/prepare-assets.mjs`, `apps/client/src/game/{hud.ts,animalSprites.ts}`,
`apps/client/src/game/scenes/Preload.ts`, `docs/economy.md`

**The task's own premise was impossible as written**, and fixing it is the
valuable part of this entry. It says "single images, so **`IMAGES` append, zero
gid shift**" — but each fish icon is a 64x16 strip of four frames, so it is a
`SheetSpec`, and `SHEETS` entries **are** gid-allocated. Adding eighteen would
have renumbered every object gid in `farm.json`.

**And "regenerate the map" is no longer an available answer.** The three
previous times an item icon needed adding — `ICON_ALL_CROPS`, `TOOL_AXE_WOOD`,
`ICON_WOOD` — the fix was to append at the end of `SHEETS` and regenerate. M5
made the map **authored**, so that door is closed. Each of those three carries a
comment saying some version of *"nothing places an item icon on a map; it is
here because §9 requires one manifest listing every key"* — the manifest had
noticed the problem three times and worked around it three times.

**`ICON_SHEETS` is the third list, and it costs nothing.** `TILESET_RUNS`
allocates gids by walking `SHEETS` then `IMAGES`; a *new* array is walked by
neither, so appending to it — or inserting into the middle of it — shifts
nothing and no map is touched. §9 is still satisfied: every key is listed in
exactly one place, and `Preload`, `SHEETS_BY_KEY` and the icon test read all
three. **`farm.json` is byte-identical**, verified rather than asserted.

**The four already in `SHEETS` deliberately stay there.** Moving them would
shift every `IMAGES` firstgid *downward* — the same breakage in the other
direction — and they are already paid for. The rule is stated once on the new
list: if a sheet can be painted on a tilemap it belongs in `SHEETS`; if it can
only ever appear in the HUD, it belongs here.

**Break-tested, and the break shows both halves at once.** Moving one fish icon
into `SHEETS` fails the three new gid tests **and** immediately fails
`farmMap.test.ts` — the map notices, which is the damage the list prevents.

**Eighteen items generated from `FISH`, not written out**, so a fish cannot exist
in the rarity table and not in the bag, and its price cannot be one number in one
file and another in the other. New `ItemCategory.FISH`, for the reason `MATERIAL`
is its own category: produce comes off a plot and counts toward harvest XP, a
fish comes off a rod and does not.

**The economy ledger caught them.** `docs.test.ts` failed with sixteen unrecorded
prices the moment the items existed — §5.8 working exactly as intended. The
ledger now carries a fishing row and all eighteen prices, including the honest
caveat that **32-71g per *cast* is not yet a per-*hour* rate**, because that
needs a cast duration T-34.03 has not shipped.

**Done:**
- [x] Icons render — six spanning every rarity band verified in the browser at
      32x32 with correct names, no failed asset requests, console clean
- [x] `farm.json` untouched — byte-identical, not just "no visible diff"
- [x] Fish are tradeable and sellable like produce; never buyable, because a
      fish you can buy is a fish nobody needs to catch

### T-34.05 — The five-stage animation
Depends: T-34.03 · Size: L
Files: `packages/shared/src/config/assets.ts`,
`apps/client/src/game/entities/{Player,characterLayers}.ts`,
`apps/client/src/game/scenes/Farm.ts`
**Do:** Wire Cast, Wait, Bite, Reel and Catch as a chain driven by the server's
`biteAt`. Float text and a splash burst reuse Phase 30. **The bite must be
readable from the sprite alone** — if the player has to watch a DOM element to
know when to reel, the minigame is in the wrong place.
**Done:**
- [ ] All five stages play in order; measured frame data, not guessed
- [ ] The bite is visible in a screenshot
- [ ] Reduced motion still leaves the bite perceivable
- [ ] Console clean

### T-34.06 — The rod
Depends: T-34.04 · Size: S
Files: `packages/shared/src/config/items.ts`,
`apps/server/src/modules/shop/service.ts`, `apps/client/src/game/actions.ts`
**Do:** A fishing rod `ToolKind` sold by the merchant, following `axe_wood`'s
Phase-20 shape exactly: stack 1, unsellable, untradeable, and `actionFor` gains a
rod-facing-water case with a specific refusal for rod-facing-anything-else.
**Done:**
- [ ] Rod on water casts; rod on land refuses with a sentence that says why
- [ ] Anything else facing water refuses distinctly
- [ ] `actions.test.ts` extended for both

### T-34.07 — Fish are not a dead end  ⏸ **BLOCKED on D-27 (via T-34.06)** — but see T-34.07b
Depends: T-34.06, T-32.05, T-33.04 · Size: M
**Status.** `T-32.05` is superseded and `T-33.04` is done, so the quest half is
buildable *except* that a fish quest would be uncompletable until a rod exists —
which is `T-34.06`, which needs water, which is D-27. Checking that chain is what
found the invariant hole recorded in **T-34.07b**.
Files: `packages/shared/src/config/{machines,quests}.ts`
**Do:** Kitchen Pot recipes consuming fish, and Chef quests asking for them.
Phase 20's rule: **nothing ships inert.** A fish that can only be sold is a fish
that is just a differently-shaped crop.
**Done:**
- [ ] At least two recipes consume fish
- [ ] The Chef asks for cooked fish
- [ ] Cooked output outsells the raw fish (the T-32.02 invariant)

### T-34.08 — Fishing is hands-on, and the code says so  ✅ **DONE**  *(also not blocked by D-27)*
Files: `packages/shared/src/config/{idle.ts,idle.test.ts}`

**A decision recorded as a test, because the wrong change looks like a fix.**
Adding `FISH: 'fish'` to `IdleTask` is one line, and it reads like somebody
tidying up an obvious omission — the list already holds chopping, and fishing
looks like the same shape of thing.

It is not, and the difference is the whole premise of the gameplay overhaul.
Idle mode runs the farm LOOP: four verbs that are the same work every time, plus
chopping, which is a timer with an axe attached. Fishing is the first mechanic
in this game that rewards **attention** — the bite is drawn per cast and the reel
is judged against a two-second window. An idle farmer fishing either misses every
cast, which is pointless, or lands every one, which deletes the minigame and
hands the best income in the game to the tab nobody is watching.

**Break-tested, and the result was better than expected**: adding the entry fails
the new test *and three that were already there* — the dependency-order test, the
chop-outside-the-loop test, and the payload validation test. The list was already
load-bearing in ways worth knowing about.

**Done:**
- [x] A test asserts fishing is not an idle task, with the reason in the failure
      message and a pointer to reopen it in ROADMAP.md rather than in the test
- [x] Break-tested: adding the task fails four tests
- [x] The positive half too — the five real tasks are pinned, so the guard could
      not pass on an empty list

### T-34.07b — The hole T-34.07's dependencies exposed  ✅ **DONE**
Files: `packages/shared/src/config/{quests.ts,quests.test.ts}`

**Found by checking whether T-34.07 was blocked, not by a failing test** — which
is the only reason it was found at all.

T-33.04's headline invariant is *"no quest asks for something the player cannot
yet make"*, enforced by `obtainableAtLevel`. That function returned `true` for
any item it did not recognise as a crop. **Correct** for wood, eggs, milk and
feed, which are gated by gold rather than by level. **Quietly wrong** for the
eighteen fish T-34.04 had just added: a Chef quest asking for a Golden Fish would
have passed the invariant and shipped as a request nobody could fill, because
there is no rod.

Two gates now, both derived rather than declared:

- **A fish's own `unlockLevel`**, read from `FISH` exactly as crops are read from
  `CROPS`.
- **`FISHING_IS_REACHABLE`**, derived from whether `rod_wood` exists in `ITEMS`.
  T-34.06 flips it by shipping the item; nobody has to remember to come back
  here. Until then no farm level makes a fish obtainable, which is the truth.

**The lesson is about the DEFAULT branch**, and it is recorded next to it: an
unrecognised item falling through to "obtainable" was a reasonable default for
the four item kinds that existed when it was written, and every new *kind* of
item has to ask whether it belongs in a branch above instead of inheriting an
assumption made before it existed.

**Done:**
- [x] Fish respect their own level gate
- [x] No fish is obtainable while no rod exists
- [x] The gold-gated goods still pass, so the fix did not over-correct
- [x] Break-tested: restoring the permissive fall-through fails two tests

### T-34.09 — Re-model
Depends: T-34.07 · Size: S
Files: `docs/economy.md`
**Do:** Fishing rate table (per hour of *attention*, since this is the first
mechanic that rewards presence), and the trade-gate wall clock re-measured with
fishing XP active.
**Done:**
- [ ] Fishing g/hr recorded and compared against passive income
- [ ] Fishing does not dominate farming, nor is it pointless beside it
- [ ] Trade-gate wall clock re-measured

---

# Phase 35 — Seasons and the clock

**Not early, not cut — middle.** Seasons' value is a function of how many crops
exist: with four they *subtract*, with twenty across three seasons plus seasonal
fish they create rotation and anticipation. That is their only ordering
constraint, and T-31.03 already satisfied it by shipping the `seasons` field
unenforced.

**The clock is global wall time.** `seasonAt(now) = floor((now - SEASON_EPOCH) /
SEASON_LENGTH_MS) % 4` — pure, shared, zero storage, zero jobs, tested exactly
like `levelForXp`. Reject the per-farm alternative derived from `farms.createdAt`:
players desync, and seasonal pricing then becomes arbitrageable across a desynced
trade economy.

**And the design that avoids the project's first scheduled job: the season gates
PLANTING, not GROWING.** `plant()` refuses a seed whose crop's season set excludes
the current season — a read-time check inside validation that already exists. A
crop already in the ground finishes regardless. **There is nothing to kill, so
nothing must happen while the player is away, so there is no job.** This is not a
compromise; it is the same principle D-1 settled — an absence costs time, not a
harvest — and the one `WITHERING_ENABLED = false` encodes.

Do **not** add a reduced out-of-season growth rate. The growth computation is
deliberately the single place a mode flag is read, and a second one would undo
that.

### T-35.01 — One clock
Depends: T-31.03 · Size: M
Files: `packages/shared/src/config/season.ts`,
`packages/shared/src/config/season.test.ts`
**Do:** `SEASON_LENGTH_MS`, `SEASON_EPOCH`, `seasonAt(now)` and `timeOfDayAt(now)`
in **one module**, so the season and the day/night cycle can never disagree. If
day/night ships as its own later phase it will grow a second clock, and the HUD
clock and the season will drift the first time either is retuned. `SEASON_LENGTH_MS`
opens **D-25**.
**Done:**
- [ ] Both functions pure, `now` passed in, tested at boundaries and wrap-around
- [ ] A test asserts the two derive from the same epoch
- [ ] D-25 recorded in the Open Decisions table

### T-35.02 — The farm knows what season it is
Depends: T-35.01 · Size: S
Files: `apps/server/src/modules/farm/routes.ts`,
`packages/shared/src/schemas/index.ts`
**Do:** `GET /api/farm` reports the current season and ms remaining, **computed,
never stored** (§4.2).
**Done:**
- [ ] Season on the farm response; no column added
- [ ] ms-remaining correct across a boundary in a fixed-clock test

### T-35.03 — Planting is gated; growing is not
Depends: T-35.02 · Size: M
Files: `apps/server/src/modules/farm/service.ts`,
`packages/shared/src/errors.ts`, `apps/client/src/net/errors.ts`,
`apps/client/src/game/actions.ts`
**Do:** `plant()` refuses an out-of-season seed with a machine-readable code and a
player-facing sentence naming the season it *can* be planted in. **A crop already
growing finishes across a boundary** — assert it.
**Done:**
- [ ] Out-of-season planting refused with a code and a useful message
- [ ] A crop planted before a boundary harvests normally after it
- [ ] Idle mode's plant task skips out-of-season seeds rather than stalling
- [ ] Break-tested: killing crops at the boundary fails the survives-the-boundary test

### T-35.04 — The shop rotates
Depends: T-35.03 · Size: S
Files: `apps/server/src/modules/shop/service.ts`,
`apps/client/src/game/shopPanel.ts`
**Do:** Seed stock rotates by season. Seeds already held **stay in the bag and
stay tradeable** — confiscating them at a boundary would be destruction by
absence.
**Done:**
- [ ] Out-of-season seeds absent from the shop, shown as returning next season
- [ ] Held seeds are never removed; a test asserts it
- [ ] Out-of-season seeds remain tradeable (or D-25 says otherwise, deliberately)

### T-35.05 — Summer and fall, for free
Depends: T-35.02 · Size: M
Files: `apps/client/src/game/scenes/Preload.ts`,
`packages/shared/src/config/assets.ts`, `scripts/prepare-assets.mjs`
**Do:** Swap the texture behind the existing `tileset-grass-spring` and
`tileset-grass-water-spring` keys by season. Measured: the spring, summer and fall
grass sheets are **all 384x640** and their water sheets **all 768x256** —
geometrically identical, so this is a texture swap. **No `SHEETS` entry, no gid
shift, no map regeneration.**
**Done:**
- [ ] Summer and fall render correctly with `farm.json` byte-identical — verified
      by `git diff`
- [ ] Season change does not require a reload
- [ ] Console clean

### T-35.06 — Winter, the one that does not fit
Depends: T-35.05 · Size: M
Files: `packages/shared/src/config/assets.ts`, `apps/client/src/game/scenes/Preload.ts`
**Do:** Winter's grass sheet matches at 384x640 but its **water sheet is 400x384**
and does not map one-to-one. Decide: reuse spring water in winter, or add
`Frozen Water Ground tiles.png` as an **`IMAGES` append** (which shifts nothing).
Measure before choosing; record the choice.
**Done:**
- [ ] Winter renders without a gid shift
- [ ] The choice and its reason recorded in the write-up
- [ ] Whatever is chosen, `farm.json` is untouched

### T-35.07 — Day and night, cosmetic only
Depends: T-35.01 · Size: M
Files: `apps/client/src/game/scenes/Farm.ts`, `apps/client/src/game/camera.ts`
**Do:** A camera tint driven by `timeOfDayAt`. **Cosmetic, gating nothing** — no
mechanic may check the time of day. An idle game whose players log in after work
must not have a worse game at 9pm.
**Done:**
- [ ] Tint follows the clock; night is atmospheric and still readable
- [ ] A test or grep asserts no gameplay path reads `timeOfDayAt`
- [ ] Honours `prefers-reduced-motion` for the transition

### T-35.08 — The clock in the HUD
Depends: T-35.07 · Size: M
Files: `packages/shared/src/config/assets.ts`, `apps/client/src/game/hud.ts`,
`apps/client/src/styles/hud.css`
**Do:** `UI/Clock/` in the HUD showing time of day and season, reading **the same
clock** as everything else.
**Done:**
- [ ] Clock and season visible without opening a panel
- [ ] Reads `season.ts`, never its own time source
- [ ] Fits 390x844; contrast test extended

### T-35.09 — What a rotation costs
Depends: T-35.04 · Size: S
Files: `docs/economy.md`
**Do:** Model what happens to a player's g/hr when their best crop goes out of
season. If a rotation halves income, `SEASON_LENGTH_MS` is wrong or the season
sets are too narrow — that is the number D-25 needs.
**Done:**
- [ ] Per-season g/hr band recorded
- [ ] The worst-case rotation quantified
- [ ] A recommendation for `SEASON_LENGTH_MS` fed back into D-25

---

# Phase 36 — The cave

Mining is server-side the **cheapest** verb in the plan — it is chopping with a
different item table, and `modules/farm/trees.ts` with `TREE_REGROW_MS` is the
exact precedent for a respawning node. It is client-side the **most expensive**,
because it is really "a second location": tilesets, a generated map, a scene and a
transition. `Interior.ts` and `generate-interior.ts` (T-16.10) are the precedent,
so it is large rather than unprecedented.

It goes **after** artisan goods, or the Furnace and Anvil defined in T-32.01
arrive with nothing to smelt — and ore with no furnace is a dead item. Phase 20's
ordering rule forbids both.

### T-36.01 — Cave art in
Depends: — · Size: M
Files: `packages/shared/src/config/assets.ts`, `scripts/prepare-assets.mjs`,
`apps/client/public/tilemaps/`, `apps/mapmaker/src/io/farmMap.test.ts`
**Do:** The phase's one `SHEETS` batch — cave tilesets, measured not guessed.
Regenerate the maps and update the pinning tests in the same task.
**Done:**
- [ ] All cave sheets in one append
- [ ] Maps regenerated; `farmMap.test.ts` green
- [ ] Console clean

### T-36.02 — `generate-cave.ts`
Depends: T-36.01 · Size: L
Files: `apps/mapmaker/scripts/generate-cave.ts` (new),
`packages/shared/src/config/caveLayout.ts` (new),
`apps/mapmaker/src/io/caveMap.test.ts` (new)
**Do:** A cave map generated from a layout in shared config, exactly as
`interiorLayout.ts` and `generate-interior.ts` do (D-13, D-17: **a map only
editable by clicking is a map this project cannot regenerate**).
**Done:**
- [ ] Layout in shared config; generator reproduces the committed map
- [ ] A test pins the committed map to the layout
- [ ] Every ore node is reachable — the reachability flood-fill, reused

### T-36.03 — The Cave scene
Depends: T-36.02 · Size: L
Files: `apps/client/src/game/scenes/Cave.ts` (new),
`apps/client/src/game/main.ts`, `apps/client/src/game/scenes/Farm.ts`,
`packages/shared/src/config/{farmLayout,collision}.ts`
**Do:** A `Cave` scene and a faced-tile entrance, following `Interior.ts` and D-7
(a trigger, not a walk-through gap). A second location will force **D-12**: the
fit-whole-map camera cannot serve two maps of different sizes well, and the
interior already needed its own rule.
**Done:**
- [ ] Entering and leaving preserves player state; `scene.sleep()` as Interior does
- [ ] The entrance is a faced-tile trigger, never a hole to fall into
- [ ] D-12 addressed or explicitly deferred with a reason in the write-up

### T-36.04 — Nodes that come back
Depends: T-36.02 · Size: M
Files: `apps/server/src/modules/cave/` (new), `apps/server/src/db/schema.ts`,
`packages/shared/src/config/ore.ts` (new)
**Do:** An `ore_nodes` table with `minedAt`, and `NODE_REGROW_MS` — `trees.ts`
**copied, not reinvented**. Regrowth computed on read; no job.
**Done:**
- [ ] Regrowth derived from `minedAt`; nothing scheduled
- [ ] Verified by manipulating timestamps in tests, not by waiting
- [ ] Daily yield capped by regrowth and documented, as wood's is

### T-36.05 — Mining
Depends: T-36.04 · Size: M
Files: `apps/server/src/modules/cave/routes.ts`,
`packages/shared/src/schemas/index.ts`, `apps/client/src/game/actions.ts`
**Do:** `POST /api/cave/mine`, mirroring `/api/farm/chop` down to the rate limits.
Pickaxe on an intact node mines; every other combination refuses with its own
sentence.
**Done:**
- [ ] Mining an already-mined node is refused
- [ ] Full backpack fails cleanly and leaves the node intact
- [ ] `actions.test.ts` extended for the pickaxe cases

### T-36.06 — Ore has somewhere to go
Depends: T-36.05, T-32.01 · Size: M
Files: `packages/shared/src/config/{items,machines,quests}.ts`
**Do:** Ore items, the Furnace and Anvil made purchasable at last, and the
Blacksmith quests from T-33.03 given something to ask for. The recipes were
defined in T-32.01 precisely so this task only has to unlock them.
**Done:**
- [ ] Furnace and Anvil purchasable; their recipes consume ore
- [ ] The Blacksmith asks for ore or bars
- [ ] No ore item exists that nothing consumes

### T-36.07 — Tool tiers, and D-4 at last
Depends: T-36.06 · Size: L
Files: `packages/shared/src/config/{items,assets}.ts`,
`apps/server/src/modules/farm/service.ts`, `apps/client/src/game/actions.ts`,
`ROADMAP.md`
**Do:** The eight unused tool tiers in `Icons/RPG icons/` become a crafted
progression track. **D-4 asks what a better tier actually does** — speed, area, or
less idle time per action — and it must be answered in the table before it is
built. The recommendation: **area for the hoe and can** (a 3x3 watering can is the
classic and it makes a big farm manageable), and **`IDLE_ACTION_MS` reduction for
the idle farmer**, since that is the lever that makes a tier matter while offline
too. Not speed: the swing animation is the client's only action cooldown, and
shortening it makes the game feel worse, not better.
**Done:**
- [ ] D-4 recorded as decided, with the rejected options and why
- [ ] Tiers crafted at the Anvil, not bought
- [ ] Area effects validated **server-side** per tile — never a client-supplied region
- [ ] Idle simulation honours the tier; a test pins it
- [ ] `docs/economy.md` records the new sink

### T-36.08 — The idle farmer goes underground
Depends: T-36.07 · Size: M
Files: `packages/shared/src/config/idle.ts`,
`apps/server/src/modules/farm/{idleSim,idleApply}.ts`,
`apps/server/src/modules/farm/idleSim.test.ts`
**Do:** An optional `IdleTask.MINE`. §5.3 anticipated exactly this — *"designed to
grow into chop/mine later"* — and the simulator already has the shape from
chopping. Note the contrast with T-34.08: mining is a resource loop and idles
naturally; fishing is a reaction minigame and does not.
**Done:**
- [ ] Mining available as an idle task; catch-up respects `IDLE_MAX_CATCHUP_ACTIONS`
- [ ] Offline mining respects node regrowth — no more ore than a present player
- [ ] Break-tested: ignoring regrowth in the simulator fails a test
- [ ] The fishing contrast recorded in the write-up

---

# The MVP re-scope (Phase R)

**Dated 2026-09-08.** The MVP narrows: one season, no weather, a real energy
limit, a cosmetic day/night cycle, and art that comes from the pack's own
tilesets rather than first-party stand-ins. **Phase 32 (artisan goods) is
superseded, not finished** — its tasks assume a twenty-crop table and an economy
this re-scope replaces.

The brief, from the user, in the order it was given: keep only the complete
asset pack; Spring only; day and night but no rain; ground from
`Tileset Grass Spring` and the cliff sheet; the tillable area from that sheet's
orange band; tilled soil from the brown halves of `Tilled Soil and wet soil`;
a water border; the map filling the screen with water-only additions; the
`Clock` for the cycle; `Bars` for energy; the cap rising a little every ten
levels; *"at the start the player cannot do very much"*; sleeping the only
recovery, ten minutes for a full bar; `HUD` art for immersion; Spring crops
only, from `Crops/Spring`; seed bags from `All Crops`, not the backpack sheet.

Three decisions were taken before any code was written:

| Decision | Choice | Why |
|---|---|---|
| Water surround | **Backdrop**, not a bigger tilemap | An animated layer behind the existing 30x22 map costs no coordinate shift, no DB migration and no `farm.json` regeneration |
| Energy vs idle mode | **Idle spends energy too** | Energy must not be something idle mode routes around; the offline simulator stops when the budget runs out |
| Day/night | **Cosmetic** | Crops grow and actions work at any hour, and sleeping is available at any hour — the alternative locks players out by timezone |

**D-5 is now DECIDED: yes.** The Phase 30 recommendation was to close it as
"no", on the grounds that a stamina bar is a mechanic for stopping people
playing. The re-scope overrules it, and the reasoning that made "no" right is
what shapes the "yes": energy is sized so a new farm can work every starting
plot exactly once (`6 x (till 2 + plant 2 + water 2) = 36` against a cap of
40), and recovery is ten real minutes, not a real day. The bar ends a session;
it does not end a day.

---

### R-1 — Unblock the asset pipeline · **done**
Files: `scripts/prepare-assets.mjs`, `.gitignore`, `CLAUDE.md`, `ROADMAP.md`

Two things were broken by the folder move before any new work could be
verified, and neither was caused by the new requirements.

**How it turned out.** `prepare-assets.mjs` read `new_assets/`, which no longer
existed — `pnpm assets` failed outright, and the game only still ran because
the gitignored build output in `apps/client/public/assets/` was stale. It was
repointed at `assets/`. `original-assets/` was gone too, taking the five
first-party ground fills the script hard-exited without; that whole path was
deleted rather than restored, because the pack replaces those fills (R-3).

**The one that mattered more than either.** `assets/` was untracked but **not
gitignored** — `.gitignore` still listed `new_assets/`. `ATTRIBUTION.md` says
the licensed pack must never be committed, so the repo was one `git add -A`
away from a licence breach. Fixed and verified with `git check-ignore`.

A mechanical rename of `new_assets/` → `assets/` across the docs made CLAUDE.md
§9 self-contradictory ("art comes from `assets/` … the old `assets/` is
unlicensed and gets deleted"). §9 now explains that the path has meant two
different directories rather than pretending it always meant one.

---

### R-2 — Measure the new art · **done**
Files: `scripts/measure-terrain.mjs` (new), `docs/art-measurements.md` (new)

**How it turned out.** **T-7.05's foundational conclusion was wrong, and this
task overturned it.** T-7.05 concluded *"the pack has only rounded patches,
never edge-to-edge art"*, and every ground tile since has been first-party
because of it. That was measured on the **incomplete** pack. The complete one
has fully-opaque bands and a pure single-colour fill at tile **(9,2)** of every
12-column terrain block.

Also measured: `Tilled Soil and wet soil` columns 0-3 × rows 0-3 are a complete
4x4 wang set, with wet being dry plus twelve columns; and the water sheet's
flat fill is the one cell of ninety-two that does **not** animate.

---

### R-3 — Ground, soil and water from the pack · **done**
Files: `packages/shared/src/config/assets.ts`, `apps/client/src/game/plots.ts`,
`apps/client/src/game/scenes/Farm.ts`, `apps/client/src/game/main.ts`,
`apps/mapmaker/src/tilesets/terrain.ts`

**How it turned out.** Five first-party `GROUND_*` entries were replaced by
measured windows into the pack. The tillable area paints from the orange band
so a plot reads as plantable before it is hoed; tilled soil uses the two brown
colourways, which is also what *"one side for dry soil and the other for wet"*
resolves to — and independently matches T-15.29's finding that the pack's blue
"wet" band reads as shallow water.

Three things cost a round each.

- **`camera.worldView` is stale inside `fitCamera`** — Phaser recomputes it at
  preRender — so the water backdrop sat hundreds of pixels off at 390x844. The
  resize moved to `update()`.
- **`setFrame` does not animate a `TileSprite`**; it bakes the frame into an
  internal fill-pattern canvas. `setTexture` does.
- **The water animation was measured wrong twice, both times reporting
  "STILL".** First `readPixels` returned a cleared back buffer; then a
  screenshot crop landed behind the Goals panel. The working measurement hashes
  a crop of open water below the panel.

`TILESET_GRASS_CLIFF_SPRING` was added and then removed: a cliff sheet edges a
height change, the farm is flat, and shipping it would have been inert art.

---

### R-4 — Cut to Spring-only crops · **done**
Files: `packages/shared/src/config/{crops,items,milestones,season,assets}.ts`

**How it turned out.** Eleven crops survive; nine are removed with eighteen
items. Two milestones (`level_11`, `level_13`) went with them — they would have
unlocked nothing — and the board now ends on `wide_field`.

**T-31.04's weakened invariant is restored.** That task had to give up "every
crop takes a distinct seed bag" because the pack had seven sacks for twenty
crops. `Crops/All Crops.png` has one bag per crop, so the rule is a rule again.
The mapping was derived by **hashing** rather than transcribing: All Crops
column 2 is byte-identical to frame 7 of each crop strip.

---

### R-5 — Energy · **done**
Files: `packages/shared/src/config/energy.ts` (new) + tests,
`apps/server/src/modules/farm/energy.ts` (new),
`apps/server/src/modules/farm/{service,idleSim,idleApply,routes}.ts`,
`apps/server/src/db/schema.ts`, `drizzle/0014_hot_sugar_man.sql`

**How it turned out.** Derived from timestamps, never ticked (§4.2) — two
columns, `energy_spent` and `sleeping_since`, and everything else is
arithmetic. Every mutating farm action charges through one `spendEnergy`, always
**after** the state checks and **before** the first write, so a refused action
writes nothing and costs nothing.

**Concurrency is a `WHERE` clause, not a lock.** `where energy_spent = <what we
read>` means two tabs that saw the same balance cannot both succeed. A row lock
would work and would serialise every action on the farm behind one mutex.

**The race test was vacuous and break-testing caught it.** It asserted
`spent === successes × cost`, which is true whether or not the guard works.
Rewritten to leave exactly one action's worth of energy, so a double-spend is
decidable.

**Two pieces of code died here.** `spendEnergyUpTo` (batches let each item pay
for itself, and the helper duplicated the affordability rule); and
`IDLE_MAX_CATCHUP_ACTIONS` in practice, since a cap of at most 60 always binds
before 200 actions do. The idle integration test now asserts `out_of_energy`
and makes explicit that **a tired farmer stays tired** — it used to assert the
remainder resumes.

---

### R-6 — Sleeping in bed · **done**
Files: `packages/shared/src/config/furniture.ts` + test,
`packages/shared/src/schemas/index.ts`,
`apps/server/src/modules/farm/{energy,routes}.ts`,
`apps/client/src/game/{hud.ts,sleepBanner.ts,scenes/Interior.ts,scenes/Farm.ts}`,
`apps/client/src/net/farm.ts`, `apps/client/src/styles/{hud.css,contrast.test.ts}`

**Do:** `POST /api/farm/sleep` and `/wake`, triggered by the action key at the
bed, with the character input-locked and a HUD banner while asleep.

**How it turned out.** Ten real minutes for a full bar, settled on read like a
shipping payout: going to bed writes one timestamp and nothing is scheduled, so
a player who closes the tab mid-sleep still wakes rested. Waking early banks
its **fraction** — an all-or-nothing rule would punish coming back early, and
"you slept but gained nothing" is the kind of rule people remember as a bug.
Pressing sleep twice does not restart the clock, and waking while awake is a
no-op; a stray second press must not be an error the player has to understand.

**Facing the bed would have dismantled it.** Every piece of furniture answers
the empty-handed action key by going back into storage, so the bed needed its
own branch before that path. The cost is recorded rather than hidden: **a bed
cannot be moved**, because put-away is only reachable through the branch the
bed now takes. A "pick up" affordance in the decoration tray is what fixes it.

**The client is not allowed to decide whether it is asleep.** The first version
had the Interior scene set its own flag and show its own banner, which meant a
reload mid-sleep came back to a character that silently refused every action
with `ASLEEP` and offered no way out. Rewritten so the server's `energy.isSleeping`
drives it from every `setPlayer` poll, and the Get-up button lives on the HUD
rather than in the Interior scene — the banner outlives the scene it was
started from. Verified by reloading mid-sleep in the browser.

**Two independent reasons to take the character away.** `Farm.ts` set
`setInputLocked(idle.enabled)` in two places, so a poll reporting idle-off
would have handed the keys back to a sleeping player. Both now go through one
`lockInput()` that ORs the two. Scenes also *ask* on creation (`hud.isSleeping()`),
because the listener only fires on transitions.

**Two things the browser found that no test could.**

- The banner rendered **transparent** on the game page: `--night` is declared
  in `base.css`, which `play.html` does not load, so `var(--night)` resolved to
  nothing and the countdown appeared as cream text directly on the grass. The
  token now lives in `hud.css`, and a test pins that it does.
- At 390x844 the banner sat **behind the wrapped HUD bar**, its Get-up button
  overlapping the Bag button — the one control that gives the character back,
  unreachable. It moves to mid-field on narrow screens.

The countdown is arithmetic on `fullInMs`, not a poll: recovery is a pure
function of elapsed time on both sides, so a ticking client and a silent server
cannot drift, and a sleeping player costs no requests. `sleepBanner.ts` exists
so that maths is testable without a DOM.

**Break-tested:** `floor` for `ceil` in the countdown (1 failure); returning the
duration instead of the deadline (4); naming a bed that does not exist (2);
removing the bed from `STARTING_FURNITURE` (1); deleting `--night` from
`hud.css` (1); and lightening it below AA (1).

**Verified in the browser** with Playwright: faced the bed with the real
`act()` path — placements stayed at four (the bed was not put away), the banner
appeared and counted down, input locked, and the server reported `isSleeping`.
Backdating `sleeping_since` past the ten-minute boundary and getting up
restored a full bar (30/40 → 40/40), hid the banner and unlocked input. Console
clean at both 1440x900 and 390x844.

**Not done, and deliberately:** the character stands *beside* the bed rather
than lying in it. The pack has no lie-down frames for the layered character and
inventing one is art, not code.

**Done:**
- [x] `POST /api/farm/sleep` and `/wake`, Zod-validated, rate limited, idempotent
- [x] Sleeping refuses farm actions with `ASLEEP`
- [x] Waking early banks the proportional recovery
- [x] The bed is slept in, not put away
- [x] Input locked while asleep, in both scenes, surviving a reload
- [x] The banner and its button legible and reachable at 390x844
- [x] Break-tested; `pnpm -r typecheck` and `pnpm test` green

---

### R-7 — Day/night, the Clock, and the energy bar · **done**
Files: `packages/shared/src/config/{time,assets}.ts` + `dayNight.test.ts`,
`apps/client/src/game/{dayNight.ts,hud.ts,depth.ts,scenes/Farm.ts,scenes/Interior.ts}`,
`apps/client/src/styles/hud.css`, `scripts/prepare-assets.mjs`

**How it turned out.** `timeOfDayAt(now)` is a pure function of the wall clock
anchored to the epoch — no column, no round trip, and two players standing in
the same field see the same sky. The cycle is **twenty real minutes**, which is
exactly two sleeps, so "sleep through the night" is a sentence rather than a
coincidence; a cycle tied to the real day would have made the sky a fact about
the player's timezone, and someone who only plays after work would never see
daylight.

**Interpolated, not stepped.** Four discrete tints would snap four times every
twenty minutes, which on a pixel-art field reads as a rendering fault rather
than as dusk. `darknessAt` is a cosine, so the two twilights take the same shape
and neither has a corner in it. A test walks the whole cycle in thousandths and
fails if any two adjacent samples differ by more than 0.02.

**The cap is the important number.** `NIGHT_MAX_ALPHA = 0.55`: at full opacity a
tint is a black screen, and a player who logs in at the wrong moment of a
twenty-minute cycle is being locked out rather than given atmosphere. Verified
by screenshot — at midnight the character, the buildings, the plot outline and
the tilled soil are all still identifiable.

**Reduced motion snaps rather than fades, which is the right way round.** The
cycle moves the tint by about 0.003 a second, below anything a person reads as
motion; the only thing that moves fast is the *catch-up* when the target jumps —
entering a scene, or returning to a backgrounded tab twenty minutes on. So
`prefers-reduced-motion` suppresses the fade and applies the value directly,
rather than suppressing the cycle and leaving the fade.

**`worldView`, not `setScrollFactor(0)`.** The first version fixed the tint to
the camera and sized it `camera.width / camera.zoom`. On screen it covered about
a quadrant, with the field beyond it still at noon — a scroll-factor-0 object
still lives in world units and is still placed relative to the camera's centre.
The water backdrop had already learned this from the other direction. Caught by
screenshot, not by a test, because nothing testable was wrong.

**The clock is eight positions, measured.** Each frame of `clock hand.png` has
its opaque centroid at a bearing about 45 degrees on from the last, clockwise
from straight up — so the frame is the phase times eight, **rounded, not
floored**: a floored hand only reaches a position once the day is fully past it,
and lags the sky it describes by an eighth of a day. Painted on its own 75s
interval rather than on the farm poll, because the cycle asks the server
nothing.

**Energy takes the cyan bar, and that is not a taste decision.** `UI/Bars.png`
holds a green bar directly above a cyan one; green is already the XP bar, and
two green bars in one strip is one bar the player has to read twice to tell
apart. The fill, its highlight and its shadow are the pack's own values
(`#2eafc7` / `#a7fce6` / `#286ed0`). Empty turns red — the one state change in
the bar, because out of energy is the one condition that stops every action in
the game. The fraction is written out beside it: "can I till this?" has an exact
arithmetic answer the player is entitled to.

**The HUD frame the brief asked for does not exist.** *"Use the HUD images to
make the experience more immersive"* — `UI/HUD.png` was re-measured against the
complete pack (worth doing, since re-measuring is what overturned T-7.05) and it
is still what T-11.05 found: 26x6 cells of 16x16 icons, every cell occupied, no
nine-slice, no bar chrome, no panel corners. The energy bar and clock take their
look from `UI/Bars.png` and `UI/Clock/`, which do hold the art the brief
described. Recorded in `assets.ts` so it is not measured a third time.

**Break-tested:** dropping the negative-phase normalisation (1 failure);
stepping the darkness instead of interpolating (1); flooring the clock hand (2);
ignoring `reducedMotion` (1); raising the tint cap to 0.95 (1).

**Verified in the browser** at 1440x900 and 390x844, with the page clock pinned
before load so each screenshot is of a chosen hour: midday clear with hand
frame 3, midnight tinted with frame 7 and segment "night", dusk between them
with frame 6. The tint covers the whole viewport including the water backdrop.
Clock and energy bar both on screen at 390 with no sideways scroll. Console
clean.

**Done:**
- [x] `timeOfDayAt` pure and tested at every boundary, including before the epoch
- [x] Tint applied in both scenes; reduced motion honoured
- [x] Clock and energy bar survive 390x844 and pass `styles/contrast.test.ts`
- [x] Day and night screenshotted
- [x] The energy bar is not mistakable for the XP bar
- [x] Break-tested; `pnpm -r typecheck` and `pnpm test` green

---

### R-8 — Re-model the economy and document · **done**
Files: `docs/economy.md`, `ROADMAP.md`

**How it turned out.** The crop table is down to eleven; nine faucet rows and
nine seed-sink rows went with the removed crops; the four-crop summary table
that duplicated a subset of the full one was deleted rather than left to drift.
The milestone faucet was recounted: **2,873g of lifetime purchasing power per
account, down from 5,247g** — and the fall is entirely the removed crops, whose
94-547g seed packets four rewards used to point at. The board did not get
stingier; the expensive things it paid in stopped existing.

**The finding that matters: energy binds the opening and then dissolves.**
Supply is 40 energy per ten-minute sleep with no cooldown, which is **240 an
hour** at level 1. Demand for a full twenty-plot farm is 18-133 an hour for
anything slower than parsnip. The only case that even approaches the bar is
parsnip micro-farming on six plots (150/hr, 62% of supply) — and it still fits.

That is not a bug and it was not quietly retuned. It is exactly what the two
decisions in the brief produce together: *"at the start the player cannot do
very much"* and *"ten minutes in bed restores full energy"*. **The cap is on
burst, not on daily throughput.** What is recorded instead is the lever: if it
should bind harder, `SLEEP_DURATION_MS` is the knob and the cap is not — doubling
the cap doubles the burst and changes the sustainable rate not at all.

**The trade gate is unmoved, and that is now measured rather than assumed.**
`TRADE_MIN_FARM_LEVEL` is a security number, so a re-scope that adds an action
limit owes a re-measurement. XP is paid for elapsed time (12 XP/hr per
cultivated slot, from `xpForDuration`), so neither cutting nine crops nor adding
energy changes it; keeping six plots full costs 5-40 energy an hour against 240.
The gate still costs an attacker **~8 human-hours of attention per account**,
and the 24-hour account age is still the binding half of it.

**The first-session table now carries an energy column**, and the shape it shows
is the one the numbers were chosen for: 36 of 40 spent by 0:03, so the first
thing a new player does is go to bed — inside the twelve-minute parsnip wait
they already had. Energy is felt as *"I have done everything I can do"* at 0:03
rather than as *"I cannot do the thing I came here for"* at 0:20.

**Two questions handed to a playtest rather than answered by arithmetic**, both
added to the "still to measure" list: whether energy is felt at all after the
first session, and whether idle mode stopping at `out_of_energy` is the right
feel for a player who leaves overnight. The second is the single most likely
thing in this re-scope to be wrong.

**Phase 32 is closed as superseded**, with a note explaining that the design
survives but every recipe, price and unlock level would have to be re-derived
from the eleven spring crops.

**Done:**
- [x] Crop table down to eleven; every faucet and sink recounted
- [x] First-session model redone against the energy cap
- [x] Time-to-`TRADE_MIN_FARM_LEVEL` re-measured and recorded with its date
- [x] Phase 32 formally closed as superseded
- [x] New energy invariants listed alongside the price ones; `pnpm test` green

---

# Phase M — what the map is allowed to decide

**Dated 2026-09-08**, after the MVP re-scope. Three things the map could not
express, each of which forced the shape of the farm to be decided in code:

1. **Collision was whole-tile at runtime.** `Blocked` was
   `(tileX, tileY) => boolean`. Sub-tile masks already existed —
   `BUILDING_BODY_MASK` holds nine measured 3x-per-tile silhouettes — but
   `SUBTILE_SOLID_THRESHOLD` collapsed them back to whole tiles before movement
   ever saw them. **The measurement was taken and then thrown away**, and every
   building collided as a rectangle.
2. **Nothing on the ground could animate.** The one animated surface was the
   water backdrop in `Farm.ts`: a single camera-sized `TileSprite` behind
   everything, which no authored map could place.
3. **The plantable field was a rectangle in code** — `FIELD_X0/Y0/W/H` and a
   double loop, so the field's shape was a consequence of how it was stored.

**Decided before any code:** data and generator first (D-13 stands — the map
stays generated and diffable, GUI painting tools are a later task); 3x sub-tile
collision at runtime; ordered frames that may span sheets, one shared clock per
animation; arbitrary painted regions for the field.

---

### M-1 — Measure the terrain collision masks · **done**
Files: `scripts/measure-tile-masks.mjs` (new), `docs/art-measurements.md`

**How it turned out.** **Terrain masks are measured from COLOUR, not alpha, and
that is the whole difference from the building masks.** A building is drawn on
transparency, so "is there art here" and "is this solid" are the same question.
A shoreline tile is fully opaque across its whole cell — half grass, half water
— so alpha says "solid everywhere" and means nothing. What makes a terrain third
impassable is that it is *water*.

`#2d594f`, the dark band between the blue and the green, is a judgement call and
is recorded as one: counting it as water moves `BORDER.shoreCorner`'s middle row
and nothing else. It is counted as water because standing on the waterline looks
like standing *in* the water, while being stopped a pixel early on a bank at the
map's edge costs nothing. It appears in no other sheet the map paints with.

The thirds come out **6/5/5 pixels, not 5/5/5** — `TILE_SIZE / 3` is 5.33, so
each boundary is rounded rather than each width fixed. A fixed `floor(16/3)`
would leave the tile's last pixel in no third at all.

---

### M-2 — The collision grid · **done**
Files: `packages/shared/src/config/collision.ts` + `cells.test.ts` (new)

**How it turned out.** **The movement code already supported this and nobody
had noticed.** `overlapsBlocked` and `slide` are written entirely in terms of
`world.tileSize` with no hard-coded 16, so handing them `COLLISION_CELL` makes
collision sub-tile with **no change to the movement maths at all**. The work was
all in what feeds the grid.

**`CellPoint` is `{cx, cy}`, deliberately incompatible with `TilePoint`'s
`{x, y}`.** The two grids differ by 3x and a coordinate passed to the wrong one
is off by a factor of three — on a 30x22 farm that reads as "collision is in the
top-left corner". Making them structurally different rather than a shared shape
with different meanings turned every such mistake into a compile error, and the
first typecheck after the change found eleven of them.

**Two measurements stopped being thrown away**: building silhouettes, via
`maskToCells` (the same mask with the reduction step removed), and map objects'
pixel footings, via `pixelRectToCells` — `OBJ_COLLISION_BASE` was always in
pixels and `objectFootprint` always rounded it out to whole tiles.

`objectTiles` still exists beside `objectCells`, and that is not redundancy:
`Farm.ts` asks the tile version to answer *"which tiles do you chop a tree
from"*, which is a gameplay question on the gameplay grid. One measurement, two
grids, two functions.

---

### M-3 — BlockMap and both scenes · **done**
Files: `apps/client/src/game/collision.ts`, `scenes/{Farm,Interior}.ts`,
`entities/collisionOverlay.ts`, `entities/reachability.test.ts`

**How it turned out.** `BlockMap` keys cells; the five layers and the union
rebuild are unchanged. `playerWorld()` is the one place `tileSize` is decided.

**That helper exists because a break-test found nothing.** Setting the scenes'
`tileSize` back to `TILE_SIZE` left all 666 client tests green while collision
silently reverted to a third of the map — no test imports a Phaser scene. A
shared constructor gives the property somewhere node can reach, and now the
break fails.

**The bug this phase actually cost a round on: the farmhouse wedge.** Finer
collision let the character stand five pixels further into the house's west
wall, which the art insets near the top. The idle replay — straight octile
lines, no obstacle avoidance (D-8) — walked south-east into the step, found both
axes refused, and stopped. **Twenty plots became unreachable from one start
position**, and `reachability.test.ts` said so.

Three fixes were tried and two rejected, which is worth recording because the
rejected ones look right:

- **Fill concave corner cells at runtime.** Fixed the notch and created a new
  one a cell higher — the wall is a staircase, so filling from the bottom just
  moves the step.
- **Square every wall face at runtime.** Fixed the farmhouse and also squared
  the *shoreline*, shaving five pixels off the west bank for the map's whole
  height, because the water widens by one tile at the very bottom. A rule that
  fires over the union of five layers surprises somebody in a scene file.
- **Author the wall straight.** Shipped. A mask is a collision approximation,
  not a tracing of the art, and five pixels of standing room against a wall is
  not space a ten-pixel character can use.

A structural test for "no mask has a one-cell wall step" was written and then
**deleted**, in three increasingly narrow versions: flagging every step also
flagged the coop's tapered roof; restricting to downward ledges also flagged the
farmhouse's gable; requiring a two-row notch also flagged its chimney. The
difference between a notch and a chimney is *reachability*, which cannot be read
off a mask — and `reachability.test.ts` reads it off the farm, which is why it
caught this in the first place. The reasoning is recorded in `cells.test.ts` in
place of the test.

**Measured in the browser:** 666 solid cells against 972 for the same tiles at
whole-tile resolution — collision blocks **31% less** than it did, on the same
farm.

---

### M-4 — The server stays whole-tile, on purpose · **done**
Files: `apps/server/src/modules/{decor,house}/reachability.ts` (comments only)

**How it turned out.** Both flood fills stay tile-based. Sub-tile collision is a
strict **subset** of the whole-tile answer — a cell is only solid inside a tile
the fill already calls solid — so the server can only ever be *stricter* than
the client: it may refuse a placement that would have left a gap, and can never
approve one that traps the player.

`cells.test.ts` asserts that for every shipped building at every tier, rather
than leaving it as a comment claiming it. The gap is written down where the next
reader will find it: the server now **approximates** a client rule rather than
mirroring it, so "the server said no but I can see the way through" is possible
and acceptable, while "the server said yes and I am walled in" remains
impossible.

---

### M-5 — Animated ground · **done**
Files: `packages/shared/src/config/groundAnim.ts` (new),
`apps/mapmaker/src/{model/doc,model/history,io/tiled,tools/anim}.ts` + tests,
`apps/client/src/game/scenes/Farm.ts`

**How it turned out.** An animation is an id, an ordered frame list that may
span sheets, and an fps. **The map records WHERE, never WHAT** — so two maps
stamping `water-ripple` cannot disagree about how it looks, and re-timing one is
a config edit rather than a map regeneration.

Serialised as an objectgroup of plain rectangles carrying `animId`, the same
shape the plots layer already uses: no gid, so `y` is the top edge — the
opposite convention from a tile-object, in the same file. Valid Tiled, no custom
loader, diffs line by line.

**No new tilesets**, deliberately: frames index the existing manifest, so
`TILESET_RUNS` does not move and `farm.json`'s gids do not renumber.

**One timer per animation id, not per cell** — a field of ripples is dozens of
placements showing the same frame at the same moment, and drift between per-cell
clocks would read as the water tearing. `setTexture`, not `setFrame`, because
frames may span sheets.

**The river actually moves now.** The water column was the flat fill, with the
only motion coming from the backdrop *behind* the map — so the water beyond the
map's edge rippled and the water inside it sat still, a tile apart.

---

### M-6 — The field is a list · **done**
Files: `packages/shared/src/config/farmLayout.ts`,
`apps/mapmaker/scripts/generate-farm.ts`, `src/io/farmMap.test.ts`

**How it turned out.** `FIELD_X0/Y0/W/H` became `FIELD_CELLS`, an explicit list.
Everything downstream already followed `fieldTiles()`, so an L-shaped or split
field gets its orange tillable paint, its scatter exclusion and its plot markers
for free.

**Shipped holding exactly today's twenty cells in today's order**, and the
switch was proved to move nothing before anything else was touched: regenerating
`farm.json` added the `animations` layer and left ground, decor, objects, plots
and tilesets byte-identical; `pnpm plots` reproduced `plots.generated.ts`
unchanged.

**A list can express things a double loop could not, including mistakes**, so it
got the checks the loop never needed: no duplicate cell, and the tillable paint
matches the plot markers exactly — a player must never see a field that is not
where their plots are.

**`FIELD_CELLS` is a loaded gun, and the trigger is not in that file.**
`newFarmPlots()` writes each plot's x/y into the database at registration, so
existing farms keep the coordinates they were created with. Reshaping the field
does not move their plots; it leaves them on grass while the paint appears
somewhere else. That is recorded beside the constant.

---

### M-7 — Verified · **done**

**Break-tested**, all confirmed failing before restore: mask anchored at the top
instead of the bottom (12 failures); coarse masks no longer expanding (11); the
shore mask emptied (1); object cells overreaching (1); the world reverting to
the tile grid (1); terrain masks ignored (1); a duplicate field cell (3); the
field moved without regenerating (2); animation placements drifting from the map
(1).

**In the browser**, at 1440x900 and 390x844, console clean, no sideways scroll:

- `world.tileSize` is 5.33 — the collision grid, not the map grid;
- 666 solid cells against 972 whole-tile equivalent, and a plot tile entirely
  clear;
- walking east into the farmhouse stops flush at x=91, against the straightened
  wall;
- the collision overlay renders per cell, with the carve visible at the roof
  edges;
- the map-placed ripple cycles all four frames — verified by hashing a
  screenshot crop of the **lowest** animated cell, because the top-left ones sit
  behind the Goals panel, which is exactly how the water backdrop was twice
  measured as standing still. The first attempt here hashed only a PNG's first
  400 bytes and reported everything identical: a header hash, not a pixel hash.

**Not done, and deliberately:** no GUI painting tools. The mapmaker's editor can
load and save the new layer but has no brush for it, no sub-tile collision
brush, and no field brush — that is the next task, and it is the one that makes
these three things usable by someone who is not editing TypeScript.

---

# Phase M2 — the brushes

Phase M made the map able to *hold* sub-tile collision, animated ground and an
arbitrary field. It ended with an explicit gap: *"no GUI painting tools … that
is the next task, and it is the one that makes these three things usable by
someone who is not editing TypeScript."* This closes it.

---

### M2-1 — A collision layer the map can carry · **done**
Files: `packages/shared/src/config/collision.ts`,
`apps/mapmaker/src/{model/doc,model/history,io/tiled,tools/collision}.ts` + tests

**How it turned out.** Phase M's sub-tile collision came entirely from the ART —
building silhouettes and terrain frames, measured from the sprites. That covers
shapes that are *about* the art and nothing else. This layer is for the rest: a
fenced-off corner, a gap the player should not fit through, a ledge that reads
as walkable and is not. **Additive, never a replacement.**

**One mask string per TILE, not a rectangle per cell.** A cell is 5.33px, so
cell-sized rectangles would put repeating fractions in every coordinate of the
map file. A tile is a whole number of pixels and carries its nine cells as nine
characters — which is also how every other mask in the codebase reads, so the
same eyes work on both.

`resizeDoc` needed its own branch rather than joining the plots-and-animations
one: a clip written for tile space would have silently kept two thirds of the
cells that just fell off the map. The compiler caught it, because
`CollisionCell` is `{cx, cy}` and `PlotCell` is `{x, y}`.

---

### M2-2 — The server has to see it too · **done**
Files: `scripts/generate-collision.mjs` (new),
`packages/shared/src/config/collision.generated.ts` (generated),
`apps/server/src/modules/decor/reachability.ts`, `cells.test.ts`

**This is the part that would have been a bug.** Phase M-4 established that the
server's whole-tile flood fill is safe because sub-tile collision is a strict
SUBSET of it — every cell sits inside a tile the fill already calls solid.
**Authored collision breaks that argument**, because it is additive: it can
block a tile nothing else blocks. A brush that reached the client and not the
server would let someone narrow a corridor invisibly, and then a legal-looking
fence placement completes a trap `checkReachable` cannot see.

So `pnpm collision` bakes the map's layer into shared config, mirroring
`pnpm plots` exactly, and the flood fill reads it. `cells.test.ts` asserts the
two grids agree — written to hold whether or not the shipped map paints any, so
it starts working the moment somebody uses the brush. Break-tested by returning
an empty tile list from `authoredCollisionTiles` with one authored cell present:
the test fails, as it must.

`authoredCollisionTiles` returns every tile the cells TOUCH, not only tiles they
fill. Conservative on purpose — refusing a placement that would have been fine
is safe; approving one that walls the player in is not.

---

### M2-3 — Three brushes · **done**
Files: `apps/mapmaker/src/{main.ts,ui/panels.ts,render/mapView.ts}`,
`apps/mapmaker/index.html`, `src/styles/editor.css`

**Collision (C).** Click a cell, Shift-click a whole tile, Alt-click to erase.
Takes map PIXELS rather than tiles, because a tile coordinate has already thrown
away which third the pointer was in — every other tool here works in tiles,
which is exactly why this one says so loudly. The sub-tile lattice draws **only
while the brush is in hand**: a 90x66 grid over the whole map is unreadable the
rest of the time, and a grid you cannot turn off stops being information.

Dragging is sampled from the pointer rather than from `lineCells`, which
interpolates *tiles* — a cell brush driven from it would paint the top-left cell
of each tile crossed, a dotted diagonal instead of a stroke.

**Animation (A).** A dropdown plus a **frame strip**, and the strip is the point:
an animation is an ordered list of frames that may span sheets, and a dropdown of
ids tells you nothing about what you are about to stamp. Static, not playing —
the editor is for aiming at cells, and a panel that never settles is one you
cannot read while you work.

**Plot.** Already existed; it now paints `GROUND_FILL.tillable` under the marker
and puts back what was there on removal. Not cosmetic: `farmMap.test.ts` pins
that the orange paint and the plot markers match exactly, and a plot marked in
the editor without paint would break that the moment anybody saved. The symptom
in the game is a plot sitting on grass — a tile the player can farm with nothing
to say so. It restores the *previous* tile rather than assuming grass, so a
field crossing a path leaves the path behind.

**A real bug the browser found:** the layer list showed `collision`, `animations`
and `plots` all labelled "plots", because `layerKindLabel` ended in a default
return. It is a `switch` over every kind now, so a sixth layer is a compile
error rather than a third row saying the wrong thing.

---

### M2-4 — Verified · **done**

**Break-tested:** the server told about no authored tiles while the map authors
one (1 failure); a plot's paint not removed with the plot (2); the restore
assuming grass instead of what was there (1). Plus the encoding round-trip,
negative-cell normalisation and malformed-mask handling covered by 19 new tests
in `tools/collision.test.ts`.

**The no-op proof held again**: regenerating `farm.json` added only the
`collision` layer and left ground, decor, objects, plots, animations and
tilesets byte-identical; `pnpm plots` reproduced `plots.generated.ts` unchanged
even though `togglePlot` now writes to the ground layer.

**In the browser** (`pnpm dev:mapmaker`, Playwright, 1600x950):

- ten tools present; the animation panel lists `Rippling water — 4 frames, 4fps`
  and renders its four frames in order;
- collision: one click → 1 cell, Shift-click → 10, Alt-click → 9, Ctrl+Z → 10;
- the painted tile renders as a red 3x3 block with per-cell outlines, over a
  sub-tile lattice that disappears when the tool changes;
- animation: stamp → 24 cells, Alt-click → 23, drawn as its first frame with a
  play marker;
- plot: 20 → 21.

**The one console error is a pre-existing missing `/favicon.ico`** on a dev-only
tool — the browser requests it unprompted and `index.html` has never declared
one. Recorded rather than "fixed", because adding a favicon to hide a 404 is not
the same as the 404 having mattered.

**Still not done:** the editor cannot paint a *field region* as a region — the
plot tool is still one click per cell, and a twenty-cell field is twenty clicks.
A rectangle or flood mode for it is the obvious next convenience, and it is a
convenience rather than a capability, which is why it is not in this phase.


---

# Phase M3 — authoring animations

Phase M2 gave the editor a brush for animated ground. It could stamp exactly one
animation — `water-ripple` — because `GROUND_ANIMATIONS` was a hardcoded array in
shared TypeScript, and the panel was a dropdown over it plus a read-only frame
strip. Making a second animation meant editing TypeScript and restarting.

This closes that: the frames and the rate are now authored **in the editor**, and
the map still records only WHERE.

---

### M3-1 — The library is a file the editor writes · **done**
Files: `packages/shared/src/config/{groundAnim.ts,groundAnim.generated.ts}`,
`packages/shared/src/config/groundAnim.test.ts` (new)

**The invariant M2 hammered on had to survive being made editable.** The map
records WHERE, never WHAT — so an authored animation could not go into
`farm.json`, or two maps stamping the same id could disagree about how it looks
and re-timing one would become a map regeneration. It went into **shared config**
instead, which is the same answer §4.4 gives for everything both sides read.

`GROUND_ANIMATIONS` is now `BUILTIN` ∪ `AUTHORED`, and **authored entries win on
a shared id**. The alternative — refusing the override — means someone who
retimes `water-ripple` in the editor, saves, and sees no change has to work out
from nothing that a built-in silently shadowed their edit.

**Built-ins stay in TypeScript because they are DERIVED, not authored.**
`water-ripple` reads `TILESET_WATER_ANIM.key` and `WATER_ANIM_FPS` rather than
restating them, so re-measuring the water sheet moves the ripple with it. Baking
those numbers into the generated file would fork a measurement that
`docs/art-measurements.md` records two broken attempts at getting right, and the
fork would present as "the ripple looks slightly off" — the kind nobody finds.

Validation moved from "a test asserts the shipped array is fine" to "this is user
input": `animationProblems` now also checks the id against `ANIM_ID_PATTERN` and
the name for emptiness, `libraryProblems` catches duplicate ids (which a
per-entry check structurally cannot see — the later one silently wins the `Map`
lookup, so the symptom is an animation that plays as a different animation), and
`MAX_ANIM_FPS` catches the slipped decimal point and the fps field filled in with
a millisecond delay.

**Mixed frame sizes are a warning, not an error.** The scene draws every frame
from the cell's top-left corner, so a 32px frame in a 16px loop bleeds down and
right — which is how you animate something standing proud of its tile, and also
exactly what clicking the wrong sheet looks like. Refusing it would block the
thing the phase is for.

---

### M3-2 — The palette is the frame picker · **done**
Files: `apps/mapmaker/src/tools/animLibrary.ts` (new) + tests,
`apps/mapmaker/src/tools/anim.ts`, `apps/mapmaker/src/ui/panels.ts`,
`apps/mapmaker/index.html`, `src/styles/editor.css`, `src/main.ts`

**No second sheet browser.** The palette already lists every sheet in the
manifest and draws each at a readable size; a picker inside the animation panel
would be a second thing to keep in step with `assets.ts`. So "Add frame" appends
whatever the palette has selected — and *that* is what makes cross-sheet
animations work at all: switching the tileset dropdown between two Add-frame
clicks is the entire gesture.

It takes the **top-left of a marquee, not the rectangle**. A frame list is one
frame per entry, and quietly appending twelve because somebody still had a fence
stamp selected is worse than taking the corner they can see highlighted.

**The strip is editable now, and still does not play.** M2-3's reasoning holds —
a strip that never settles is one you cannot read while you work — so playback is
a *separate* box beside it. That box is not optional: the strip tells you the
order, only playback tells you whether the order reads. It owns its timer and is
constructed **once**, because these panels are rebuilt wholesale on every change
and a timer started during a render would be one timer per keystroke, all still
running.

**Library edits are deliberately not on the map's undo stack.** `History` records
layer snapshots for the document being authored; the library is a different file
with a different lifetime, and one stack for both would make Ctrl+Z after a save
undo something the game has already loaded.

**Renaming an id repoints the open map.** The map stores the id and only the id,
so a rename orphans every cell that stamped the old one — in the game, a console
warning and a bare patch of ground, a long way from the rename that caused it.
`renameAnimId` fixes the map on screen and the confirmation says plainly that any
*other* saved map is beyond reach.

Built-ins render **read-only rather than hidden**: they are the only worked
example in the tool, and Duplicate turns one into an editable copy, which is what
"let me edit the water" actually means. The copy is element-wise — a shared
frames array would make two animations that reorder together, which is the bug
you find last.

---

### M3-3 — Saving writes TypeScript, so the endpoint validates · **done**
Files: `apps/mapmaker/vite.config.ts`, `apps/mapmaker/src/io/save.ts`

Same shape as `/__save-terrain` — dev-only, in `configureServer`, fixed
destination, no name from the client — with one difference that matters: it emits
a `.ts` file the **game** imports. So `buildGroundAnimFile` checks every field
against a shape and a character set first, and builds the output from
`JSON.stringify` of values that already passed. **The request body is never
interpolated into the file.** The panel validates too, because the two failures
read differently: the endpoint refusing is "the tool is broken", the panel
refusing names the animation and what is wrong with it.

**A real problem the browser found: saving reloaded the editor.** The file lives
in `packages/shared`, which the editor imports, so writing it is a source change
and Vite full-reloads on it — throwing away the selection and the "saved" message
at the exact moment you wanted to read it. The first verification run recorded
`save status: "Loaded existing farm.json"`, a boot message, and the next step
failed because the panel had reset to the read-only built-in. Nothing was lost
(the map autosaves; the library had just been written from memory), but a tool
that reloads itself when you press Save reads as a tool that crashed. The file is
in `server.watch.ignored` now — safe precisely *because* the editor is the only
writer, so the in-memory library already equals what landed on disk. The game's
dev server is a different Vite instance and still reloads, which is the behaviour
you want.

The library is **not** autosaved, unlike the map: a save here rewrites a file the
game hot-reloads on, and autosaving would push a half-built animation with no
frames into the game every few seconds. `beforeunload` guards the unsaved case
instead.

---

### M3-4 — Verified · **done**

**49 new tests** (26 in `tools/animLibrary.test.ts`, 19 in
`config/groundAnim.test.ts`, 4 for `renameAnimId`). The ones worth naming: a
duplicated animation reordering independently of its source (the shared-array
bug); `moveFrame`'s `to` being the index **after** removal, tested rightwards and
leftwards separately because the two readings differ by one whenever you drag
right and the symptom is a frame landing one short of the drop; a repeated frame
being allowed, because a repeat is a hold; and a round-trip asserting that every
id the editor can *create* passes the shared validator — a panel that says
"saved" for everything except the thing you made is worse than one that never
worked.

**In the browser** (`pnpm dev:mapmaker`, Playwright, 1600x950):

- the built-in renders read-only — name, id, fps, Delete and Add-frame all
  disabled — with its four frames and `4 frames at 4fps — one loop is 1.00s`;
- New → `fountain`; three frames added from `tileset-grass-spring`, then the
  palette switched to `tileset-soil` and a fourth added — the strip reports
  `["tileset-grass-spring frame 0", "tileset-grass-spring frame 53",
  "tileset-soil frame 0"]`, which is the cross-sheet animation the phase exists
  for;
- × removes a frame, fps 6 → 12 updates both the note and the dropdown label
  live;
- Save writes `groundAnim.generated.ts` with exactly the frames on screen, and
  the editor does **not** reload;
- `Not A Valid Id` is refused and the field reverts; `fountain-blue` is accepted
  and repoints the 1 stamped cell;
- Duplicate on `water-ripple` gives `rippling-water-copy`, editable, 4 frames.

**The screenshot-hash trap caught us again, from a third direction.** The first
run reported the new animation's preview standing still. It was not: the two
frames picked (`tileset-grass-spring` 0 and 2) render as visually identical grass
tiles, so the base64 of the preview matched between samples. Re-probed by reading
`backgroundPosition` off the live element instead of hashing pixels — it cycles
`-320px -128px` → `-512px -192px` → `0px 0px` and back, all three frames. This is
the same failure mode M-7 recorded for the water backdrop (a header hash, not a
pixel hash) and M2-4 for the map-placed ripple (cells hidden behind a panel);
noting it here because the *cause* was new each time and only the symptom —
"the animation is not playing" — repeated.

**The one console error is still the pre-existing missing `/favicon.ico`**,
recorded in M2-4 and unchanged.

**Not done, and deliberately:** the panel cannot pick a frame *range* in one
gesture (a 12-frame strip is 12 Add-frame clicks — the marquee is deliberately
read as its top-left, see M3-2), there is no per-frame duration (a repeat is the
hold mechanism), and drag-to-reorder is covered by unit tests rather than a
browser assertion, because HTML5 drag events do not survive synthetic mouse
input reliably enough for the result to mean anything.

---

# Phase M4 — painted water animates

Phase M3 let an author *make* an animation and stamp it cell by cell. Building
the map with it exposed the thing it did not fix: **the water still stood
still.** Painting the shore from the palette gave static art, and the only way
to move it was to hand-author one animation per shoreline tile and stamp every
cell — the farm ended up with 3 authored animations, 7 stamped ids and 72
placements, still incomplete, to express one fact about the artwork.

---

### M4-1 — The sheets are animated by construction · **done**
Files: `packages/shared/src/config/groundAnim.ts`,
`scripts/measure-tile-animation.mjs` (new), `config/groundAnim.test.ts`

**Measured, not guessed** (`node scripts/measure-tile-animation.mjs`, which
crops every cell and compares it against its counterparts):

- `tileset-grass-water-spring` (48x16) is **four frames of twelve columns**;
- `tileset-water-anim` (24x16) is **four frames of four rows** — the layout
  `WATER_ANIM_FRAMES` already relied on for the backdrop, generalised from the
  one cell it named to the whole block.

The shoreline sheet being animated at all was not known when the water went in.
`TILESET_GRASS_WATER_SPRING`'s note called it *"distinct from the plain
water-tile fill"* and stopped there, so the shore was painted from its first
block and stood still while the backdrop behind it moved.

**The step is `dx`/`dy` in CELLS, not a flat frame offset.** Shoreline frame 44
is the last column of row 0; +12 frames lands on row 1 column 8 — a real tile and
the wrong one. As two axes the bound is checkable and the mistake is impossible;
there is a test pinning exactly that frame.

---

### M4-2 — A later block is a phase, not a mistake · **done**

The first version refused any tile outside the first block, reasoning that
standing still is a more visible failure than flickering through unrelated art.
**The map disproved it within the hour.** The farm's top row had been painted
from block 1 — not deliberately, just by picking the tile that looked right in
the palette — and 28 tiles of shore sat frozen while the other 92 moved.

Block 2 of a four-block sheet is the same art at frame 2 of the same loop, so the
honest reading is a rotation. `sheetAnimationFrames` winds back to the base and
rotates the cycle to **start at the frame that was painted**, so the renderer
never changes what the author placed and a paused game matches the map file. The
consequence — tiles from different blocks rippling out of phase — is what water
does anyway.

---

### M4-3 — The layout is animated; not every cell in it is · **done**

Fixing the phase did not make the top row move, and the reason is the part worth
recording: **that cell is byte-identical in all four blocks.** Both sheets carry
flat fills and pure-grass pieces with nothing to play — 20 of 192 base cells on
the shoreline sheet, 4 of 96 on the open-water one, the latter including the flat
`#0092dd` fill that `WATER_ANIM_FRAMES` already records picking *against*
("92 cells animate and the flat fill is not one of them" — the same finding,
now machine-checked).

So the mechanism was working perfectly and the art had nothing to show, which is
the worst shape a bug report can take. `staticFrames` is the measured list;
`sheetAnimationFrames` returns null for them rather than cycling four copies of
one image, and **the palette marks the cells that move with a dot** so the answer
is visible while picking rather than after a save and a reload.

---

### M4-4 — Tiles that stay tiles · **done**
Files: `apps/client/src/game/scenes/Farm.ts`,
`apps/mapmaker/src/render/{mapView,paletteView}.ts`, `src/main.ts`

In the game, `buildTileAnimations` mutates `tile.index` **in place**. The
alternative — an `Image` per animated cell, the way `buildGroundAnimations`
necessarily works — would be a few hundred sprites over the ground layer, each
needing its own depth answer. Tiles that stay tiles keep the depth, the culling
and the collision they already had. One timer per rate, for the reason the ground
animations give: dozens of clocks doing identical work, and drift between them
reads as the water tearing.

`locateInMap` was split so `tilesetOf` can hand back the `firstgid` — turning a
frame back into a map index needs it, and re-deriving it by searching a second
time is the duplication that ends up disagreeing.

**The editor animates too**, because a shoreline you can only judge after saving,
alt-tabbing and reloading is one you are placing blind. `drawMap` takes an
`animStep` rather than reading a clock, so the renderer stays a pure function of
what it is handed; the editor owns the timer and holds it still when the map has
nothing animated in it.

---

### M4-5 — Verified · **done**

**12 new tests.** The ones worth naming: frame 44's cycle staying inside row 0
(the wrap bug `dx`/`dy` exists to prevent); every cycle starting at the frame it
was painted from, checked across every tile of both sheets; and the accepted
count being exactly `tileCount - staticFrames.size`, which fails if either
measurement drifts.

**In the browser**, the honest way: five frames of the game canvas 125ms apart,
pixel-diffed and reduced to the farm's own 30x22 tile grid.

Before — **only the backdrop moved**, the farm's shoreline ring dark. After —
**73 tiles animate**: the left column, the right column and the whole bottom row.
Row 0 and column 1 stay still, and that is correct: both are painted with cells
that are identical in every block.

**The first two readings of this were both wrong, and in opposite directions.**
The first sampled a strip at the canvas edge and reported success — it was
measuring the backdrop, which was already animated before this change. The second
laid a 32px grid over the screenshot without aligning it to the farm origin, so
the ring smeared into cells the backdrop had already lit. Only the third —
aligned to `(240, 98)`, the farm's actual origin at zoom 2 — said anything. This
is the fourth time an animation in this project has been mismeasured (M-7, M2-4,
M3-4); the cause is different every time and only the symptom repeats.

**Pre-existing and NOT fixed here:** `farmMap.test.ts` fails 4 of 19 against the
working copy of `farm.json` — the map is being hand-edited in the editor while
`farmLayout.ts` still describes the generated one, so the pin between them is
broken in both directions. Against the *committed* map the same file fails 10 of
19, so the hand edits are moving toward agreement rather than away. The game says
the same thing at load: `water in farm.json does not match farmLayout.ts`. Left
alone deliberately — it is somebody's in-flight map, not a regression, and the
fix is theirs to choose (regenerate, or update `farmLayout.ts` to match).

**Also left alone:** the map still stamps 7 ground-animation ids of which 3
exist, so the console warns about `grass-top-right`, `grass-right`, `grass-bot`
and `grass-bot-right` on every load. Those placements are now redundant — painted
water animates on its own — and clearing them is a decision for whoever authored
them.

---

### M3-5 — Built-ins are editable after all · **done**
Files: `apps/mapmaker/src/tools/animLibrary.ts` + tests,
`apps/mapmaker/src/ui/panels.ts`, `src/main.ts`, `index.html`

**M3-2 got this wrong.** It made built-ins read-only, reasoning that they are
derived from measured constants and that Duplicate covered the need — "Duplicate
turns one into an editable copy, which is what *let me edit the water* actually
means." It does not. **The difference is the id.** A duplicate is a *second*
water under a new id, so every cell already stamped with `water-ripple` goes on
showing the animation you were trying to change. There was no way to change it.

The fix needed no new mechanism, because the mechanism was already there and
walled off: `mergeAnimations` resolves an id to the AUTHORED entry when there is
one, and its comment says why — *"someone who retimes `water-ripple` in the
editor, saves, and sees no change has to work out from nothing that a built-in
silently shadowed their edit."* The panel was that shadow.

**Editing a built-in now forks it into an override under the same id.**
`overrideAnimation` clones it into the library on the first keystroke —
`editableLibrary()` runs before every mutating handler, so there is no "make
editable" button whose only job is to ask whether you meant the thing you just
did. Deleting the override restores the built-in, since the merge falls back the
moment the authored entry is gone; the button says **Reset to built-in** there,
because the same operation deserves the name that is true where it is.

**The id stays locked for a built-in.** Renaming an override would resurrect the
built-in under the old id *and* leave a stray animation under the new one — two
surprises for one keystroke. Duplicate is the operation for that, and the field's
tooltip says so.

The dropdown grew a third state. An overridden built-in is still shipped under
that id but is no longer the shipped *version* of it, so it reads
**"(built-in, changed)"**; labelling it "(built-in)" left the list disagreeing
with the notes line directly below it.

**7 new tests**, the load-bearing ones being that an override keeps the id where
a duplicate does not, that it copies frames element-wise so editing it cannot
reach back into `BUILTIN_GROUND_ANIMATIONS`, and that it is a **no-op once
already authored** — every keystroke calls it, so a non-idempotent version would
throw away the previous character.

**In the browser**: `water-ripple` selected → all fields live except the id,
Reset disabled; fps 4 → 10 → notes read `Overrides the built-in`, dropdown reads
`(built-in, changed)`, Reset enabled; a `tileset-soil` frame appended to it, so
an override can gain frames the original never had; Reset → back to 4fps, four
frames, Reset disabled again; Duplicate still produces a separate
`rippling-water-copy` with an unlocked id.

**A real mistake in the verification, worth recording.** The first run of that
script clicked **Save**, and the save endpoint writes the *real*
`groundAnim.generated.ts` — so it overwrote three authored `grass-*` animations
that were not the script's to touch. They were restored by hand from the values
recorded earlier in the session, and the script no longer clicks Save. The
editor's dev-server endpoints write to the working tree; a verification script
driving them is not a read-only observer, and this one was written as though it
were.

**Housekeeping:** `apps/mapmaker/src/ui/panels.ts` had four stray NUL bytes
inside a template literal from an earlier edit in this session. Harmless at
runtime — they sat in a join separator — but they made `grep` treat the file as
binary and return nothing, which is a confusing way for a file to behave. Removed.

**A stale test the change exposed.** `anim.test.ts` asserted that every entry in
`GROUND_ANIMATIONS` has more than one frame — *"a single-frame animation is a
static tile with a timer attached"*. That was written when the array was a
shipped constant. It now includes whatever an author has made, so it asserted a
design rule over somebody's in-progress work and failed the build the moment they
saved an animation mid-edit. **A property of the shipped art belongs in a test; a
property of user data belongs in a warning the editor shows.** The test is scoped
to `BUILTIN_GROUND_ANIMATIONS` now, and `animationWarnings` reports the one-frame
case — a warning rather than a problem, because it is the legitimate state of
every animation just after the first Add frame, and refusing to save it would
mean an author could not stop halfway.

---

### M4-6 — The sea reads the animation named after it · **done**
Files: `packages/shared/src/config/groundAnim.ts`,
`apps/client/src/game/scenes/Farm.ts`, `apps/mapmaker/src/ui/panels.ts`,
`config/groundAnim.test.ts`

**Three things called "water", and editing one of them changed nothing.** By
M4-5 the editor could change `water-ripple` — and doing so still left the sea
exactly as it was, because `createWater` read `WATER_ANIM_FRAMES` and
`WATER_ANIM_FPS` out of the manifest directly and never consulted
`GROUND_ANIMATIONS` at all. So there was a built-in animation called "Rippling
water", *derived from the same two constants the backdrop used*, that the
backdrop ignored. Edit it, save, reload, watch nothing happen, with nothing
anywhere to explain why. The three water things, now distinguished:

| Thing | What it is | How to change it |
| --- | --- | --- |
| The **sea** | camera-sized `TileSprite` behind everything | edit `water-ripple` (this task) |
| The **shore** | painted tiles on the ground layer | paint from an animated sheet (M4-1) |
| A **placed** animation | stamped cell by cell with the Anim tool | author one in the panel (M3) |

`createWater` resolves `SEA_ANIMATION_ID` through `getGroundAnimation` now, so an
authored override reaches the backdrop. The built-in is the **fallback rather
than the source**, so a library that somehow lost the id still gets a sea instead
of a crash — and the built-in goes on deriving from the measured constants, so
re-measuring the water sheet still moves both.

Two behaviours fall out of going through the library. `setTexture` takes the
sheet **per frame**, so an overridden sea may draw from more than one — the old
form had the key hardcoded and could not. And a **one-frame sea is a still one**:
the timer is not started at all, because swapping a TileSprite's texture for
itself rebuilds the whole fill-pattern canvas four times a second for no change
on screen, and an author is allowed to want flat water.

The panel says **"This is the sea behind the farm."** on that entry. It is an
ordinary row in the list and looks like one; nobody hunting for "the water around
the grass" would guess that "Rippling water" is it.

**Verified in the browser** against a real override — two `water-tile` frames,
authored in the editor and saved from it. The sea region (everything outside the
farm rectangle) went from **50,118 changing pixels** across the loop to **184**,
which is edge noise: flat, still water, exactly as authored. The shoreline ring
inside the farm was unaffected at 76 tiles. Screenshot confirms solid blue where
the sparkling open-water tile used to cycle.

---

### M4-7 — Editing the ground scatter by hand · **done**
Files: `packages/shared/src/config/farmLayout.ts`,
`apps/mapmaker/src/render/paletteView.ts`, `src/main.ts`,
`config/scatter.test.ts` (new), `apps/mapmaker/README.md`

**The tools were already there and nothing was broken.** The grass tufts and
flowers are ordinary tiles on the `decor` layer, painted by `scatterTiles()` at
generation time — so selecting the `decor` layer, picking `tileset-props-seasons`
in the palette and painting or erasing works exactly as it does for any tile.
Verified rather than assumed: 66 decor tiles → 69 after painting three → 66 after
erasing them, read straight out of the editor's autosaved document.

What was missing was **two facts the editor had no way to tell you**, both of the
same shape as M4-3's static water cells: the mechanism works, the art or the
pipeline disagrees, and the symptom shows up somewhere far from the cause.

**`decor` draws BELOW every world sprite.** That is why `GROUND_SCATTER` holds
only flat tufts and pebbles — `farmLayout.ts` says so, and lists the standing
flowers, mushrooms and driftwood it excluded for exactly this reason. Paint a
tall flower there and the player walks *in front of* it from every angle,
permanently. The symptom is subtle enough to live on a map for months. The
palette hint says it now, and `isGroundScatterFrame` puts a green corner tick on
the eleven props the farm already vouches for — a **vouched-for list, not a
measurement**: the rest of the sheet is unchecked, not forbidden, and the comment
says which it is.

Marked with a tick rather than a second dot. Two dots would be two different
facts encoded the same way, on sheets where telling them apart is the point.

**`generate-farm.ts` repaints the decor layer from scratch**, so regenerating the
map discards hand-placed props. Recorded in the README next to the scatter, since
it is the kind of thing you only discover by losing an afternoon of placement.

**Verified in the browser** by reading the palette canvas's backing store rather
than a screenshot — the panel is narrow enough that CSS downscales an 18px cell
to 11px, and a mark can survive the resample or not depending on where it lands.
Probed at full resolution, exactly frames 1, 2, 3, 5, 6, 7, 132, 133, 134, 137
and 138 carry the tick and nothing else does. **The first probe reported 13
frames**, including 0 and 10 — a ±40 tolerance on the tick's green matching the
grass in the art underneath. Tightened to ±12 with a minimum run length, since a
2px stroke lays down a dozen near-exact pixels where green art gives scattered
ones. A looser check would have "passed" while proving nothing.

**5 new tests**, the load-bearing one being that every frame `scatterTiles` can
emit is a marked frame — otherwise the palette would call props unvouched-for
that the generator itself scatters across the map.

---

# Phase M5 — the map is the source of truth

**This reverses T-15.00 and settles D-13 the other way.** That task made
`generate-farm.ts` the authority for `farm.json` and moved every layout constant
into `farmLayout.ts` so the map could be painted from them. It was the right
answer while nobody authored maps by hand. Once somebody did, it inverted into a
trap: the editor wrote a map the SERVER did not believe in — the decor
trap-guard protecting a chest that had moved, registration seeding trees the map
no longer drew, four `farmMap.test.ts` failures that were the tool working, and a
dev-only console warning as the only thing that ever mentioned it.

---

### M5-1 — `pnpm layout`, the third bake · **done**
Files: `apps/mapmaker/scripts/generate-farm-layout.ts` (new),
`packages/shared/src/config/farmLayout.generated.ts` (generated),
`packages/shared/src/config/farmLayout.ts`, `package.json`

Reads `farm.json` and writes what the runtime needs out of it, exactly the way
`pnpm plots` and `pnpm collision` already do. The three together are the whole of
what the server knows about the farm's shape.

Two things are baked. `MAP_SOLID_TERRAIN` is the ground tiles the terrain art
makes impassable — **by the same rule the client renders with**: an authored mask
in `TILE_COLLISION_MASK` wins, otherwise a whole tile blocks if its key draws
open water. `MAP_PLACED_OBJECTS` is every gid-bearing object with the tile it
stands on, remembering that Tiled anchors a tile-object to its BOTTOM edge.

`TREES`, `CHEST_TILE`, `SHIPPING_BOX_TILE`, `MAILBOX_TILE`, `MERCHANT_TILE`,
`MAP_OBJECTS` and `waterTiles()` all read the bake now.

**What deliberately did NOT move.** The house, coop and barn are not on the
object layer at all — their art depends on a tier the player owns, so they are
drawn from `buildings.ts` and anchored by config. The merchant NPC is likewise a
constant. Baking a position for something the map does not hold would be
inventing agreement.

The bake **refuses a map missing any of chest, shipping box, mailbox or stall**.
Those are where the player interacts and the server reasons; a map without one is
not a variation on the farm, it is a farm with no way to sell anything. Failing
at bake time beats a null two layers away in the server.

---

### M5-2 — The pins turned round · **done**
Files: `apps/mapmaker/src/io/farmMap.test.ts`,
`apps/mapmaker/src/io/farmLayoutBake.test.ts` (new),
`apps/client/src/game/{collision.test.ts,scenes/Farm.ts}`,
`packages/shared/src/config/decor.test.ts`,
`apps/server/src/modules/decor/decor.integration.test.ts`

Four tests asserted `farm.json` matched what the generator would paint. Each
failed the moment somebody used the editor, which is the arrow backwards. They
are now about the map's own integrity instead: every animation placement lands on
the grid, every edge cell is painted, every gid resolves. **The exact-tileset-set
assertion went** — an authored map may draw from any sheet, and failing the build
over a new tileset is the tool arguing with its user. The half worth keeping is
the corruption check: a gid belonging to no tileset means the manifest moved
under the map.

`farmLayoutBake.test.ts` is the replacement arrow, and it catches the expensive
quiet failure: move the chest, save, forget `pnpm layout`, and the game draws it
in the new place while the server keeps a path open to the old one. It re-derives
rather than shelling out to the script — a test that ran the generator would pass
by rewriting the file it was meant to check.

**Three tests elsewhere assumed a map shape.** `waterTiles()[5]`, `[6]`, and a
client test asserting the water ran down x=0 for every row were all describing
the map the generator used to paint. How much water the farm has is the author's
decision now, so they test the rule — solid terrain is never placeable, and the
BlockMap blocks exactly what `waterTiles()` names — and a map with no impassable
terrain makes them vacuous rather than failing.

The client's drift warning is gone: `waterTiles()` is read out of the map, so it
could only ever compare the map against itself.

---

### M5-3 — `generate-farm.ts` is scaffolding now · **done**

It rebuilds `farm.json` from constants that are downstream of the map, so running
it discards everything authored in the editor. It requires `--force` and says
what it would destroy.

**The guard was added the hard way.** The `--force` check was appended by a
script whose own assertion failed *after* the module had been imported and run —
so the run that added the guard was the run that did the damage, overwriting an
authored map: the hand-cut shoreline replaced by the generated border, 72
animation stamps down to 1. The objects and plots survived only by luck of
ordering, because they had already been baked out of that same map minutes
earlier. Recovered from the editor tab's in-memory document, which had never been
reloaded.

Two things came out of that. The check now sits at the **top of the module**,
before anything can execute, rather than at the bottom next to `main()`. And the
editor no longer lets the file silently win: `loadInitialDoc` **offers** a
differing autosave instead of falling back to it only when the file is missing.
The old order — file first, scratch buffer as fallback — is right whenever the
file is the newer thing, and catastrophic in the one case where it is not, since
the reload that loads the stale file also overwrites the last copy of the good
one. Compared as serialised documents rather than by timestamp: the two come from
different clocks, and "which is newer" is exactly the question that was answered
wrongly.

---

### M5-4 — Verified · **done**

**11 new tests**, 7 of them in `farmLayoutBake.test.ts`. The load-bearing one is
that `TREES` equals the map's maple trees, because that list is what registration
writes into the database — a tree in config the map does not draw is a stump the
player can chop and never see.

**In the game**, with a freshly registered account: the server returns trees at
`3,2 / 16,3 / 17,11 / 2,17 / 17,17`, which is exactly what `farm.json` places.
The farm renders the authored shoreline rather than the generated border, and the
console is clean of errors.

**Still failing, and correctly: 1 of 184 in the mapmaker.** The map stamps seven
ground-animation ids and none of them exist — the authored library was replaced
by a `water-ripple` override in a later save. All 72 placements warn at load.
They are redundant anyway, since painted water animates on its own
(`ANIMATED_SHEETS`), so clearing the animations layer is the likely fix — but
that is 72 cells of somebody's authoring and not a decision to make for them. The
assertion collects every missing id with its cell count rather than dying on the
first, so the message is the to-do list.

---

# Phase M6 — the editor was drawing half the farm

**M5 made the map the source of truth. This is the first bill for that**, and it
arrived the way these always do: the tool was used, the tool was believed, and
three tests went red. The field had been moved in the editor to (8..12, 2..5),
saved, and nothing re-baked — so `farm.json` painted its orange tillable ground
in one place while `PLOT_POSITIONS` opened plots in another, `decor.ts` reserved
the wrong twenty cells from decoration, and seventy-two animation stamps named
seven animations that no longer existed.

Re-baking was the obvious fix and it was wrong, which is the finding. **All
twenty of the new plot markers were inside the farmhouse.** The house, coop and
barn are not in the map — their art depends on a tier the player owns, so M5-1
deliberately left them out of the bake and drew them from `buildings.ts` — and
the map editor therefore renders the ground they stand on as empty grass. The
field was not authored carelessly. It was authored blind, in a tool that showed
open land where a house was going to be.

### M6-1 — The field goes back, and stops being two things · **done**
Files: `apps/client/public/tilemaps/farm.json`,
`packages/shared/src/config/{farmLayout.ts,plots.generated.ts,farmLayout.generated.ts}`,
`apps/mapmaker/src/io/farmMap.test.ts`

The field is at (9..13, 9..12) again — markers and orange paint together, since
a map where those two disagree is the whole subject of this phase. That spot is
not nostalgia: the chest at (6,9) and the shipping box at (14,12) flank it, and
the path spine at x=8 was routed one column west of it on purpose.

**`FIELD_CELLS` is now `PLOT_POSITIONS`.** It had been a hand-written list of
the same twenty cells the bake already produces — two copies of one fact, kept
equal by a test, which is exactly the arrangement M5 spent a phase removing
everywhere else. The bake is the only copy now.

**The old failure message told the reader to do the wrong thing.** It said *"do
NOT run `pnpm plots` — regenerate the map instead"*, which was correct advice
under D-13 and became destructive advice the moment M5 reversed it: following it
would have discarded the authoring rather than baked it. It now says to re-bake,
and says the part that is easy to miss — `newFarmPlots()` writes coordinates at
registration, so moving the field means wiping the dev database, not just
re-running a script.

**One test was deleted rather than kept.** `keeps the array order the economy
prices by` compared `fieldTiles()` with `PLOT_POSITIONS`; with one derived from
the other it compares a value to itself and cannot fail. A test that cannot fail
is not evidence (rule 6), and the fact it defended is now defended by
construction.

### M6-2 — The buildings, drawn where the map cannot draw them · **done**
Files: `packages/shared/src/config/buildings.ts`,
`apps/mapmaker/src/render/mapView.ts`, `apps/mapmaker/src/main.ts`,
`apps/mapmaker/index.html`, `packages/shared/src/config/buildings.test.ts`

The editor hatches the house, coop and barn in violet, named, at their **largest
tier** — the same rule the footprint tests use, because a player who upgrades has
already paid and the ground a Deluxe barn will need is taken from the day the map
is authored. Hatched rather than filled, so the terrain underneath stays
judgeable; drawn under the plot layer, so a field on reserved ground reads as a
mistake rather than as a plot layer with an odd tint. On by default: this is the
only thing in the game that occupies farm ground without being in the map file,
which makes its absence a trap rather than a preference.

`RESERVED_GROUND` and `reservedBy()` are the new shared names. `BUILDING_FOOTPRINTS`
already existed and was enough to *fail* on, but not to *report* — a bare
rectangle cannot say it is a house. Two tests pin the pair together: the overlay
must show every box the invariants will fail an author for, because a building
in one list and missing from the other is this same bug wearing a different hat.

**The failure message was half the fix.** The test that caught this said
`plot (8,2): expected true to be false` — true of what, to a reader holding an
editor that drew that ground as grass? It now names the building, explains why
it is not in the map, and says which overlay to turn on.

Both new tests were break-tested: dropping the barn from `RESERVED_GROUND` fails
two, and making `reservedBy` always return null fails one.

### M6-3 — The bake refuses what the editor could not show · **done**
Files: `apps/mapmaker/scripts/generate-plot-layout.ts` (moved from
`scripts/generate-plot-layout.mjs`), `package.json`

`pnpm plots` did exactly what it is for and produced a farm where every plot was
inside a building, because a plain `.mjs` at the repo root could only check the
map against *itself* — duplicates, bounds, marker count. That family of check
cannot see a constraint held in config the map has never heard of.

It is TypeScript in `apps/mapmaker/scripts/` now, run under the same `tsx` as
`pnpm layout`, so it can import `reservedBy()`. A plot on reserved ground stops
the bake with the building's name and the overlay to switch on, and — the half
that matters — **nothing is written**, so the previous good
`plots.generated.ts` survives a bad map. Verified by putting a marker back at
(8,2): the bake fails with exit 1 and the generated file is byte-identical
afterwards.

Reserved ground is the largest tier of each building, matching the tests.

### M6-4 — The seven shoreline animations, re-derived · **done**
Files: `packages/shared/src/config/groundAnim.generated.ts`

Written through the editor's own validating endpoint rather than by hand, and
**derived rather than invented**: each of the seventy-two stamps was resolved to
the tile the map paints under it, every stamp of a given id agreed on one base
frame, and the loop came from `sheetAnimationFrames` — the same function the
Farm scene's tile animator uses, so overlay and tile cycle identical gids at an
identical rate.

**They are redundant and that is worth writing down.** All seven base frames are
on `tileset-grass-water-spring`, which is in `ANIMATED_SHEETS`, so those cells
already animated on their own since M4; the stamps add seventy-two `Image`
objects drawing the same four frames over tiles that were already cycling them.
Nothing tears — both timers are created in the same tick at the same rate — but
the honest description is that this restores what the map asks for, not that it
makes the shoreline move.

### M6-5 — The border the abandoned field left round the house · **done**
Files: `apps/client/public/tilemaps/farm.json`

Twenty-two cells of autotiled dirt edging at (7..13, 1..6), drawn by the terrain
brush around the field that was never going to work there. No plot marker and no
tillable-fill check ever looked at it, so every test passed while the game drew a
**dirt frame nailed to the farmhouse** — the top and right of the ring stand
clear of a tier-0 roof. Found in a screenshot, not in a test, which is the usual
way. Returned to grass by a script that refuses to touch any cell outside
`RESERVED_GROUND`, so the one run allowed to erase authored ground could only
erase ground a building stands on.

### M6-6 — Verified · **done**

`pnpm -r typecheck` clean; **2,329 tests green** across four packages (shared
452 -> 454, mapmaker 184 -> 183 with the vacuous one gone).

**In the browser, with three freshly registered accounts**: the server returns
plots at exactly the twenty cells `farm.json` marks, trees at the five the map
places, and the farm renders the field between the chest and the shipping box.
The console carries no errors and — the specific thing this phase was checking —
**no `map places unknown ground animation` warnings**. Screenshots before and
after M6-5 are the evidence for the house: dirt frame, then grass.

**Verification ran outside the Playwright MCP.** It is configured for the
`chrome` channel and `/opt/google/chrome/chrome` no longer exists on this
machine; the runs above used Playwright directly against the chromium already in
`~/.cache/ms-playwright`. Adding `--browser chromium` to the MCP's args in
`~/.claude.json` would fix it, and that is a user-scope config change rather than
something this phase should make.

## What this phase found that nobody was looking for

- **The sea is frozen, by an authored override.** `AUTHORED_GROUND_ANIMATIONS`
  contains a `water-ripple` entry of **two identical frames of `water-tile#0`**,
  and `Farm.createWater` resolves the backdrop through `getGroundAnimation`, so
  the override wins over the built-in four-frame ripple. An animation whose
  frames are all the same image is a still picture. This is almost certainly the
  save M5-4 described as having replaced the authored library, and deleting that
  one entry restores the moving sea — but a flat calm sea is also a thing
  somebody might have wanted, so it is reported rather than reverted.
- **A bake can be right and still be wrong.** `pnpm plots` did exactly what it
  is for and produced a farm where every plot was inside a building. The bakes
  validate the map against *itself* — duplicates, bounds, unresolved gids — and
  nothing in that family could see a constraint living in config the map has
  never heard of. That is now three defences at three distances: the editor
  shows the ground (M6-2), the bake refuses to write (M6-3), and the tests fail
  with a message that names the building (M6-2). The first is the only one that
  saves the author's time; the other two only save everyone else's.
- **The recovery advice in a test comment goes stale like any other comment.**
  `farmMap.test.ts` carried instructions written under D-13 that M5 had already
  reversed, in the one place a reader looks when they are already confused.

## What is deliberately still not done

The seventy-two animation stamps stay, redundant. The editor still cannot draw
the *art* of the house, coop and barn — only the ground they reserve — so an
author can still misjudge how a building will look against what they paint next
to it, just not whether it is there. `pnpm collision` and `pnpm layout` still
have no opinion about buildings either; only the plots bake gained one, because
only plots are a thing a player has to stand on.

---

# Phase U — the UI is the pack's

The farm was pixel art and the interface over it was a web app. Every panel drew
itself with `background: var(--paper); border: 3px solid var(--ink); box-shadow:
6px 6px 0` — that exact triple, thirty-eight times — and every label was
`system-ui` or a monospace stack. The seam was the whole complaint.

**The palette was not the problem, which is why fixing it again would have fixed
nothing.** T-15.26 had already sampled every token out of the art with a pixel
histogram. The mismatch was *shape and type*: flat CSS rectangles where the pack
draws timber, and a system font where the pack draws nothing at all.

## What unblocked it

`hud.css` carried this note for three phases:

> The pack's plate WAS tried as a `border-image` 9-slice and does not work:
> `border-image` slices from the source image's own outer edges, and the plate is
> a 48x16 region at (0,16) of an 848x544 sheet, so a 5px slice takes pixels from
> four unrelated corners of the sheet.

The diagnosis was right. The conclusion drawn from it — draw the bevel in CSS
instead — was the expensive part, because **that is a fact about the file, not
about the art.** Give each frame its own file and the objection is gone rather
than worked around.

`prepare-assets.mjs` had even left the instructions: *"if a transform is ever
needed again, resurrect the codec from git history rather than reaching for a
native dependency."* A decoder already existed (`scripts/lib/png.mjs`, extracted
in T-23.02); only an encoder was missing, and that is fifty lines of filter-0
scanlines, `deflateSync` and a CRC32 table.

### U-1 — a PNG encoder, and cropping in the pipeline · **done**

`encodePng` and `cropPng` in `scripts/lib/png.mjs`. `prepare-assets.mjs` gained
a second stage and lost its "pure copier" header, which had stopped being true.

**Every crop is decoded back and compared to its source rectangle before it
counts as written.** That is not belt-and-braces: `scripts/` belongs to no
package and the repo has no root test runner, so this is the only automated
check on the codec — and it re-proves it on every `pnpm assets` rather than once
in CI. It also catches a crop rectangle gone stale against a reorganised pack,
which has happened to the paths in that file twice.

### U-2 — measure before cutting · **done**

`scripts/measure-ui.mjs` + `docs/ui-measurements.md`, following the
`measure-crops.mjs` → `docs/crop-sheets.md` pattern exactly.

The slice inset is defined, not guessed: **the distance from each edge to the
first pair of identical adjacent rows or columns.** `border-image` stretches the
middle band, and stretching is lossless exactly where consecutive lines repeat.
A frame whose middle never repeats is reported as *not sliceable* rather than
given a plausible number.

`--check` re-derives every inset in the crop table from the pixels and exits 1
on drift.

### U-3 — the whole `UI/` folder · **done**

`prepare-assets.mjs` copied **7 of 25** UI files. The eighteen it skipped were
not leftovers; they were the frames, bars and tags the HUD had spent three
phases approximating. `Bars.png` especially: `assets.ts` pointed at it in prose
— *"the energy bar and the clock therefore take their look from `UI/Bars.png`"*
— and nothing ever copied it, so the energy bar shipped as a hand-written
three-stop gradient in colours belonging to nothing.

All 25 are copied now, plus **37 nine-slice crops** cut from them.

### U-4 — the typeface and the primitives layer · **done**

D-29. Two OFL faces, self-hosted, 43 KB. New `styles/ui.css` holds the
`@font-face` blocks, the tokens and the primitives; `hud.css` keeps layout. The
import order in `main.ts` is the contract — `ui.css` first, so `hud.css` wins
any overlap and a panel that needs a special case can still say so.

Type sizes moved from `rem` to whole **px**. A pixel face renders crisply only
on integer pixels, and every size in the file was a fraction of one: `0.72rem`
is 11.52px, which lands the stems between device pixels and hands back exactly
the softness the reskin was removing.

### U-5 — applied across twelve panels · **done**

113 chrome declarations deleted from `hud.css` across 38 rules; `ui.css` owns
them, grouped by treatment rather than by panel, so every window in the game is
one rule and they cannot drift apart.

**The design reference redirected this mid-phase, and it was right.** The first
pass used `ui-panel.png` — the pack's cream rounded frame. It is good, and it
reads as *paper*. The reference is carpentry: dark timber, light inset. The
trick that made it possible is **dropping `fill`**: with it, `border-image`
paints `ui-rail.png`'s dark plank into the box; without it, the middle is left
alone and the element's own background shows through the ring. One asset,
therefore, yields both — a dark bar (with `fill`: the top bar, panel headers,
the hotbar plank) and a framed light panel (without: every window).

68 `var(--mono)` became `var(--pixel-label)`, and the `letter-spacing: 0.1em`
that made monospace look deliberate came out with them — Silkscreen draws its
spacing into the face, so the tracking double-spaced it.

### U-6 — tooltips, and what the art unlocked · **done**

**There was no tooltip anywhere in this game.** Slots carried a native `title`:
OS font, half-second delay, and nothing at all for a keyboard user. `tooltip.ts`
is one delegated element on the HUD root, built on the scalloped dialogue box,
shown on `focusin` as well as hover — which is what the cells being real
`<button>`s was always for.

### U-7 — the credits page · **done**

`CREDITS` had existed since T-7.01 with a comment warning that a credit living
in markup is one that disappears in a redesign. It had never had a page. It has
`/credits` now, rendered entirely from the config, with a `kind` field and rows
for both fonts.

`config.test.ts` reads `public/fonts/` off disk: a `.woff2` with no `CREDITS`
row fails, and a font row whose `licenceFile` is missing fails. That is the OFL
compliance story, checked on every run rather than remembered.

### U-8 — verified · **done**

`pnpm -r typecheck` clean. **2,685 tests green** across four packages (shared
704→705, client 704→717, mapmaker 183, server 1080).

In the browser at 1920x1080 and at 390x844: no horizontal overflow at either,
**zero requests to `gstatic`/`googleapis`** (the fonts really are self-hosted),
and a clean console. The only network error in any run is `500
/api/vip/checkout`, which is Stripe being unconfigured in dev.

Verification ran **outside the Playwright MCP**, for the reason M6-6 recorded:
it is configured for the `chrome` channel and `/opt/google/chrome/chrome` does
not exist on this machine. The runs above drove the chromium in
`~/.cache/ms-playwright` directly.

## What this phase found that nobody was looking for

- **Darkening a background is invisible, and it broke three AA passes.** The
  panel interior went from `--paper` (#f7dbc6) to the pack's tan (#ffd2a1) — 6%
  darker, warmer, better — and quietly took `--faint` from 4.55:1 to **4.29**,
  `--barn` from 4.52 to **4.26** and `--grass-deep` from 4.30 to **4.06**. Three
  failures on the surface that carries almost all of the HUD's text, from a
  change nobody would think to re-audit. Fixed by darkening the three tokens
  4–7%, the same trade T-27.01 made for `--barn`; `contrast.test.ts` now checks
  a panel surface as well as the bar.
- **A test caught an unreadable warning badge before a human could.** The new
  literal sweep flagged `#a8442f` on `.hud__thirsty`: 4.24 on the old cream bar,
  **2.83** on the timber one. The text never changed — the surface under it did,
  and only the surface was being looked at. `.shoprow__reason` was the same
  story, and its own comment says it is "the one part of a disabled row that has
  to stay readable".
- **The inset that makes art sliceable is not the inset that makes it a frame.**
  `ui-well.png` measures 4 — correctly, that is where its rows start repeating —
  but its frame body is 16px thick around a transparent hole, so slicing at 4
  puts the hole in the stretched middle and renders four detached corner
  fragments. Nothing in the measurement can tell the two numbers apart. The
  `.ui-well` primitive was deleted rather than left as a loaded gun: it would
  have looked like the obvious choice for every inset panel added later, and
  been wrong every time.
- **The plate fills ARE the HUD palette, which closed a loop.** `button.png`'s
  first plate measures #ae4924 — the exact value `hud.css` records as "the
  pack's signature rust… sampled #ae4924" before darkening it for contrast — and
  the second is #c46120, `--soil` verbatim. T-15.26 sampled the tokens off these
  plates; putting the plates back under the buttons was returning them, not
  introducing a palette.
- **The pack's bar art cannot be a variable-width bar.** All four horizontal
  tracks in `Bars.png` are *finished* bars: baked-in round caps, a star ornament,
  and a fill already painted to a fixed percentage. There is no slicing of that
  which survives being 40% full at 96px and 100% full at 64px. The bars take the
  pack's colours instead — which is the part that carries, and #2eafc7 was
  already the energy token.
- **Registering an account per screenshot run trips the anti-bot limiter.**
  Phase 21 works. The harness logs in instead.

## What is deliberately still not done

The **auth and landing pages keep the paper-and-ink look** and the system font
stack. They are a different surface — a marketing site, not a HUD over pixel art
— and pulling Silkscreen onto them is a design decision nobody has asked for.
`/credits` follows them rather than the game, for the same reason.

`ui-well.png`, `ui-plaques.png`, `ui-emotes.png`, `ui-weather.png`,
`ui-music.png`, `ui-social.png` and the four alternate clock sheets are copied
and unused. They are inventory, not debt — the folder is complete now, so the
next person does not re-discover them.

The **icon-button vocabulary is barely touched**: `button.png` holds 43 columns
of 16x16 icons in eleven colours and both states, and the close buttons are
still the character `x`. `.ui-icon` exists and addresses that grid; nothing in
the HUD calls it yet.

---

## Phase U2 — the bar was the problem

Phase U reskinned the HUD and left its **shape** alone: a full-width `header`
pinned to `inset: 0 0 auto 0`, holding a brand, five readouts and nine labelled
buttons. Re-shown against the design reference, that was the thing still wrong.
The reference has no bar at all — a status cluster in one corner, a short stack
of icon buttons in the other, and farm everywhere else.

**The bar had been costing the top ~70px of the world across the entire screen,
and eight of its nine buttons were words where a glyph would do.**

### U2-1 — two corner clusters · **done**

`.hud__bar` is gone. In its place:

- `.hud__rail` — top-left, a vertical stack of nine 44px icon buttons.
- `.hud__status` — top-right, a fixed-width cluster: the day/night dial at 2x,
  then farm name, gold, level + XP, energy.

The dial leads the cluster because it is round and the reference's cluster is
anchored by exactly one round thing. It went 32px → 64px: **an integer step**,
so nearest-neighbour keeps it crisp, which 1.5x would not.

### U2-2 — icons instead of labels · **done**

`button.png` holds 43 columns of 16x16 glyphs in eleven colours and both
states, and Phase U shipped `.ui-icon` addressing that grid without a single
caller. The rail is the caller: trophy for Goals, house for Decorate, play for
Idle, star for VIP, speaker for Sound, heart for Credits, power for Log out.

**Two buttons were writing `textContent` to show state, and on an icon-only
button that deletes the icon and prints a word into a 44px square.** Sound now
swaps between the speaker and crossed-speaker columns the pack already drew —
the same "the artist drew both states" move the slots use. Idle shows its ON
state as a pressed plate plus `aria-pressed`, which is how every other toggle
in the HUD says it.

Every button gained an `aria-label` and a `title`. **The label text WAS the
accessible name**; an icon-only button without one does not exist to a screen
reader, and this was the single largest regression risk in the change.

### U2-3 — verified · **done**

`pnpm -r typecheck` clean; **2,689 tests green** (client 717 → 721).

Measured in the browser at 1920x1080, 1280x720 and 390x844: **no rail/status
overlap, no rail/hotbar overlap, and no horizontal overflow at any of them**,
console clean at all three.

### U2-4 — the rail was ragged, and one button was a different size · **done**

Reported as "why do the options on the left have different sizes?", and measured
rather than eyeballed: eight buttons at **44x44** and one at **50x52**.

The odd one was Credits — the rail's only `<a>`. **`<button>` is `box-sizing:
border-box` in every browser's UA stylesheet and `<a>` is not**, so its 3/3/5/3
border-image was added outside the declared width. Nothing else in the rail
could have exposed it, because nothing else in the rail is a link.

The same look also turned up a second thing nobody had reported: **no glyph was
centred.** `.hud__btn` sets `align-items` and no `justify-content`, so the
default `flex-start` pushed every icon against the left bevel — harmless while
the buttons had labels beside their icons, wrong the moment U2-2 removed them.

Fixed together, and all three fixes are pinned by `styles/railButtons.test.ts`:
`box-sizing: border-box`, `justify-content: center`, and a glyph size stated
outright rather than inherited from two different sheets' scale variables that
happen to agree at 32px today. The test was checked by reintroducing both bugs
and watching it fail — a stylesheet test that has never failed is a stylesheet
test that proves nothing.

`--rail-btn` also moved to the HUD root. It had been declared on the button,
which reads fine and is wrong: custom properties inherit **downward**, so
`--rail-clear` — the offset that keeps the goal board off the rail — could not
see it, and shrinking the buttons on a short viewport would have left the panels
where they were.

Measured after: eight buttons, all 44x44, all glyphs 32x32, horizontal offset
from centre **0.0px** on every one. The uniform **-1px** vertical offset is
deliberate — the plate's bevel is 3px top and 5px bottom, so centring in the
content box centres the glyph in the button's raised *face* rather than its
geometric box, which is the right read for art lit from above.

## What this phase found that nobody was looking for

- **Ink on the timber board measures 1.13:1, and it shipped three times.**
  Anything on the plank inherits `--ink` unless told otherwise. That is not low
  contrast, it is invisible text, and it reached a screenshot three separate
  times across Phase U and U2: the goal-board tab (dark-on-dark at 55%
  opacity), the thirsty badge (#a8442f, 2.83), and the energy fraction. Each was
  caught by *looking at a picture*, which is exactly the review step that does
  not scale. `--timber` is a token now and `contrast.test.ts` checks the surface,
  including a guard asserting ink on it still fails — so if someone lightens the
  plank enough to make ink work, the warnings get revisited rather than rot.
- **A new element in a corner silently ate another element's clicks.** `.board`
  and `.hud__decor` were both `left: 1rem`, which put them directly underneath
  the new rail. Nothing errored; the goal board simply intercepted every click
  meant for a rail button, and Playwright reported it as a timeout rather than
  as an overlap. `--rail-clear` is a shared token now so the next left-anchored
  panel cannot repeat it.
- **T-18.23/BUG-05 is retired, not fixed.** That task made the bar wrap because
  its 842px of content pushed six controls — including the only way to log out —
  off a 390px screen. A vertical rail of fixed-width squares has no horizontal
  sum to overflow, so the failure mode no longer exists. Recorded rather than
  silently dropped, because the *reason* it existed still applies to anything
  that goes back to being a row.
- **`box-sizing` is not `border-box` on the HUD.** The status cluster asked for
  17rem and measured 310px on a 390px screen: a 16px timber border on each side
  was being added outside the width. Worth knowing, because every panel in this
  file now has a 16–20px border-image and none of them declare box-sizing.
- **Backticks inside the HUD's template literal end it.** The file already warns
  about this in an existing comment — "No backticks in this comment: it lives
  inside a template literal" — and the new markup walked straight into it four
  times. The warning is in one comment, 200 lines from where it bites.

## What is deliberately still not done

The rail is **eight visible buttons and no grouping**. If a ninth arrives it
should probably become two groups with a gap, but five would be a fake problem
solved early.

The status cluster does not show **what idle mode is doing**, which is now the
only place a player could learn it without opening the panel — the button's
pressed state says on/off and nothing more.

---

# Phase U3 — the front door joins the game

## Where this came from

Phase U bundled two pixel faces, cut the pack's UI into nine-slices and reskinned
twelve panels — and then wrote down, deliberately, that the marketing pages were
staying as they were: *"pulling Silkscreen onto them is a design decision nobody
has asked for."* That was the right call to record and the wrong state to leave
standing, because the front door was the **archetypal generated-design default**:
cream paper `#f2e3ce`, terracotta `--soil`, `3px solid` rules, `5px 5px 0` hard
shadows, square corners, `system-ui` body text, and `ui-monospace` +
`letter-spacing: 0.16em` + `uppercase` standing in for a label face. Six pages of
it, in front of a game that looks nothing like it, using **none** of the two
fonts already in the repo — because `ui.css` was imported by `main.ts` and by
nothing else.

Somebody asked. This phase closes the item.

## The thesis: the page is a day

Two registers, and the split carries meaning rather than decorating. **Night** —
masthead, hero, closer, the boot curtain — is the farm working while you are
gone. **Paper** — the reading sections, legal, credits — is you reading about it.
The page opens at night, moves to daylight paper where there is prose, and
returns to night for the last call to action, so the final frame of the site and
the first frame of `/play` are the same colour and the seam disappears.

It is also why the answer was not "apply the HUD skin to a webpage". Nine-slice
timber at 2x around 17px/1.62 paragraphs is heavy and hard to read. The boldness
is spent on the hero, the auth card and the boot; everything else stays quiet.

### U3-1 — two registers, and a token that is not cream · **done**

`base.css` grew a night register beside the paper one: `--night-deep`,
`--night-ink`, `--night-ink-soft`, and `--lamp`.

**`--lamp` is sampled, not chosen.** `decor-street-lamp.png` at (39,13) — the
amber ring inside the lantern glass, read out with `scripts/lib/png.mjs`, the
same method that sampled `--panel-fill` off `Clock/Extras.png`. The flame's
hotter core (`#ffeb47`, 16px) reads lemon at text sizes; `#ffc71b` is what the
glass actually throws. 9.61:1 on `--night` as text, 11.33:1 the other way round
with `--ink` on it, so one token serves as both the accent and the lit CTA's
fill.

**The five night tokens do not flip in the dark theme, and that is the point.**
Every token above them is a reading colour and inverts; these are a depicted
night sky. `--paper` becomes `#0b1f2a` after dark, so a night panel written
`color: var(--paper)` paints dark-on-dark at **1.34:1** — the same shape of bug
`hud.css` hit from the other side when it borrowed `var(--night)` from a
stylesheet the game page never loads. `contrast.test.ts` gained a night block:
eight pairs, a guard that `--paper` cannot stand in for `--night-ink`, a guard
that the dark theme does not redefine the sky, and a guard that **timber on
night is 1.12:1** — as unreadable as ink on timber, and just as available a
mistake.

All three new guards were break-tested: dimming `--lamp` failed three pairs,
overriding it inside the dark block failed the sky guard, and deleting the
sampled-pixel comment failed the provenance guard.

### U3-2 — the site gets the game's letters · **done**

Bitter bundled as the third face (SIL OFL 1.1, variable 400-700, latin +
latin-ext, 65 KB), following `public/fonts/README.md`'s five-things-in-one-commit
rule — woff2, licence, `@font-face`, `ATTRIBUTION.md`, `credits.ts`. Removing
the credits row was break-tested and `config.test.ts` failed the build, as
designed.

**Why a slab.** Pixel faces are all stem and no contrast, because every stroke is
the same number of pixels wide. A high-contrast display serif fights that; a slab
agrees with it, because a slab's serifs are rectangles and so are pixels. It is
also deliberately not the fashionable pick — a high-contrast serif on cream is
precisely the look this phase removes.

`--font-display` became Silkscreen, `--font-sans` became Bitter, `--font-pixel`
(Pixelify Sans) was added for the night register only, and `--font-mono` was
added for the two places a label face is wrong — `.legal code` and the `/credits`
licence strings, which had been saying `var(--mono, …)`, a token Phase U deleted,
leaving them silently on the fallback argument.

`ui.css` is now imported by all four page entries, after `base.css` so the
primitives win at equal specificity. **`.ui-scope` has existed as the documented
hook since U-4 and nothing had ever used it.**

Every `letter-spacing` on a Silkscreen rule had to go in the same commit — the
spacing is drawn into the face — and every size had to move from `rem` to whole
pixels, since `0.72rem` is 12.24px and lands the stems between device pixels.
`siteType.test.ts` pins both, plus a whole-pixel-tracking rule for Pixelify, no
`font-weight: 800` (above Bitter's variable maximum, which synthesises a smeared
outline rather than a bolder one), and zero requests to `googleapis`/`gstatic`.

**The test found a rule nobody had looked at.** `.wordmark` — the site's own name
— was `ui-monospace` at `letter-spacing: 0.22em`, `font-weight: 800`, `0.95rem`:
three separate violations in one rule, on the brand mark. It is Pixelify Sans at
20px now, the same face the HUD writes "Tillhaven" in.

### U3-3 — the front door runs your clock · **done**

The hero grew a **band**: a full-bleed strip of real farm running the game's own
day/night cycle, off `darknessAt(timeOfDayAt(now).phase)` — the same two pure
functions `game/dayNight.ts` calls. No round trip, no column, no server state.

**The cycle is twenty real minutes, not twenty-four real hours** (`DAY_LENGTH_MS`),
and that is what makes it worth building: the sky visibly moves while the page is
read, rather than being a state a visitor happens to catch once a day. It is
epoch-anchored, so two people in different timezones see the same sky, and
someone who clicks through to `/play` arrives at the hour they were just looking
at.

`heroSky.ts` is pure with 13 tests, split from the DOM the way `touchInput.ts` is
split from `touchControls.ts`. It re-declares `HERO_NIGHT_MAX_ALPHA = 0.55`
rather than importing it — a marketing page must not reach into `game/`, which
type-imports Phaser — and **the test reads `dayNight.ts` off disk and pins the
two copies equal**, because two independent declarations of one number is exactly
how a site and a game start depicting different nights.

**The tint is on the band, not the hero.** Cycling the whole panel would put the
cream headline on a surface that is 11.9:1 at midnight and unreadable at noon.
Confined to the band it costs no legibility and the effect survives intact.
Polled at 4Hz rather than animated — the cycle moves 0.0008 of darkness a second
and rAF would repaint sixty times per invisible change — and frozen after the
first paint under `prefers-reduced-motion`, showing the correct sky rather than
an empty box.

### U3-4 — the auth card is a window · **done**

`/login` and `/register` moved onto the night register, and the card became a
**lit window** standing in it — the same relationship the hero's plot panel has
to the hero. It wears `ui.css`'s timber ring by joining the shared window rule
rather than copying it, which makes `.auth__card` the first selector in that
list that is not part of the HUD. That is what `.ui-scope` was declared for in
Phase U and had never been used for.

The card's header stopped being a flat `background: var(--soil)` band and became
**a small window onto the same farm at the same hour** — `auth-form.ts` drives
it from `heroSkyAt`, the same function the landing band uses. A visitor who
reads the pitch at dusk and clicks "Log in" does not walk into a different
afternoon. The interior stays paper, because inputs are for reading and typing
and that is the one place legibility outranks atmosphere.

The idle farmer got dressed here too, for the reason `landing.ts`'s did.

**One thing U3-2 got wrong and this task reverted.** `.field__error` was swapped
to Silkscreen along with the labels, which made "USERNAME MUST BE AT LEAST 3
CHARACTERS." an uppercase pixel-type sentence shouted at someone who has just
made a mistake. A label is one to three words and Silkscreen is right for it; an
error is a sentence explaining how to fix something, and it is back on the body
face.

### U3-5 — the boot curtain · **done**

The worst screen in the product is gone. `Preload.buildProgressUi()` drew
`ui-monospace` text and a flat green `Phaser.GameObjects.Rectangle` — and
because it was Phaser, it could not appear until Phaser had booted, so the
**genuine first frame of `/play` was an empty `#052a3a` rectangle** for however
long the module graph took.

`play.html`'s `#fallback` became `#boot`: inline markup and inline CSS that the
browser paints on first pass, carrying the wordmark, the pack's own bar art and
a Silkscreen progress line on the night register the previous page just ended
on. `boot.ts` drives it; `Preload` reports progress and dismisses it, and
`main.ts` deliberately does **not** remove it the way it removed `#fallback` —
that element's only job was to prove the module had not run, and this one has a
second job that is only just starting.

Verified at 80ms into a load: the curtain is up, in fallback fonts, with the bar
art already drawn. The failure path was exercised by blocking one asset at the
network layer (`Network.setBlockedURLs`, so nothing in the repo had to be
broken): the curtain **stays up**, the bar and progress line hide themselves in
CSS, and the missing key is named above a link back to the landing page. A
player who cannot load the game needs somewhere to go more than a diagnostic.

`boot.test.ts` pins the ordering — 17 source-text checks, since there is no
jsdom — including that `boot.fail` is immediately followed by `return`, which
was break-tested by deleting the return.

### U3-6 — the creator wears the pack · **done**

The first screen a new player ever touches had a flat `var(--ink)` rectangle for
a header and 2px CSS-border chips for swatches, inside a card that already had
timber around it. The header joined the shared panel-header rule; the swatches
became `.ui-slot`, the same cell the hotbar and backpack use, so "a thing you
can pick" looks the same in both places ten seconds apart.

**Selection is `.ui-select`, which had been cut, shipped and never used.** It
overlays rather than replaces — brackets outside the cell — so the swatch keeps
showing the character it exists to show you, which a fill could not do without
tinting it. Brackets alone proved too quiet in this context (six selected
swatches among twenty-eight near-identical neighbours, against the hotbar's one
in twelve), so selected also takes `ui-slot-lit.png`, the same pairing
`.slot.is-picked` uses.

The preview stopped being an untreated rectangle and became a square window
onto grass — `#79bf56`, the farm's own ground tile — so the farmer is previewed
standing where they will actually stand.

**`.hud__coach` joined the creator's hidden list.** The onboarding hint was
printing "Walk with WASD, face a plot and press E" across the clothes row:
advice about a farm the player cannot reach, covering the thing they are
choosing. Same bug as BUG-15, one element later.

## Six things this phase found that nobody was looking for

**The lamp was already lit.** A column-occupancy scan of `decor-street-lamp.png`
found *two* sprites in the 64x48 image, not one: an unlit lamp at x 4-28 and a
lit one at x 36-60. So dusk cross-fades the pack's own two frames
(`STREET_LAMP_LOOK`) instead of laying a CSS glow over a dark sprite and hoping
it reads. Measuring the file before styling it was worth the ten minutes.

**The promo farmer had no clothes.** `CHAR_PROMO_WALK`'s own note in `assets.ts`
says it: *"Skin layer only, variant 1"*. The landing page and the closer scene
have been showing a bare figure with no eyes, hair or clothes since T-8.03 — the
worst sprite on the page, standing in the hero. `promoFarmer()` stacks the four
layer strips the way the game composes a character, at one fixed appearance so
two screenshots of the page agree.

**The house was a shed.** `OBJ_TINY_HOUSE_LOOK` is documented three lines above
itself as the tiny-house kit's *"house SILHOUETTES (roof+wall, no door/window)"*,
and the landing page had been advertising a doorless box while the game drew a
farmhouse. `HOUSE_TIER_ART[0]` — the tier-0 farmhouse `Farm.ts` actually puts on
the map, chimney, door and flower-box windows included — is a two-line swap, and
it fixed the closer scene at the same time.

**`ui-bars.png` has no empty track.** `ui.css` described its two bands as
"empty" at y101 and "filled" at y116. A pixel scan says they are the same FULL
bar in two colours — green `#6ebd3c` and cyan `#2eafc7`, identical `#8a3625`
frame. The sheet is a colour catalogue, not a state pair, so layering them gives
a cyan bar creeping over a green one rather than a bar filling up. The comment
is corrected and `.ui-bar__fill` now says what it is not.

**`.ui-bar` let the caller decide its width, and the track is 42px.** A column
scan finds four tracks per row (x3-44, x54-80, x99-140, x147-188); the old
comment said "192 source px wide", which is the width of the *sheet*. Any
consumer wider than `42px * --ui-scale` silently reveals the next bar along, and
the boot curtain at 192 showed all four with their end caps interleaved. Nothing
had ever hit it because **`.ui-bar` had no callers** — written in Phase U, and
the HUD's own bars are hand-built in `hud.css`. The width is declared on the
primitive now, so the first real consumer was not also the first bug report.

**The plate vocabulary is unreachable from the HUD, and that is structural.**
`ui.css`'s APPLIED section re-implements `.ui-plate` under HUD class names
(`.hud__btn`, `.shop__close`, `.creator__btn`, …) and pins `--plate-src` itself.
Both that rule and `.ui-plate--sand` are one class of specificity, and APPLIED
is later in the file, so **adding a colour modifier to any HUD button does
nothing** — which is most of why Phase U's own notes say the button vocabulary
is "barely touched". It surfaced because the creator's two buttons stayed
identical no matter which modifier they were given: a second blanket rule was
forcing moss onto both, so "Surprise me" was as green as "Start farming" and a
player reading green as "yes" would hit the reroll looking for the way out.
`.creator__btn` is out of both lists and composes the primitive properly.
Converting the rest is a bigger change than the creator needed, and the note now
sits on the rule.

## Two bugs worth recording, because both were silent

**A too-short flex container deletes the top of a picture.** `.band__scene`'s
`min-height` was wrong twice — 96 clipped the farmhouse roof, 152 took the
chimney — because both numbers were guesses at the gap wanted underneath rather
than measurements of the sprite. Under `align-items: flex-end` with `overflow:
hidden` nothing overflows and nothing warns; the roof simply leaves, and what
remains reads as a grey striped box nobody can name. It is 208px, which is the
measured 87-source-pixel window at scale 2 plus headroom.

**`background-repeat` repeats the whole image, not the window.** The band's grass
first tried `background-position: -144px -32px` with `repeat` to tile
`GRASS_FILL_FRAME` out of the terrain atlas, and painted the sheet's decorative
autotile edges across the entire strip. CSS has no crop-then-repeat for one cell
of an atlas. The fix is a flat `#79bf56`, which `assets.ts` records as exactly
what that tile is — *"fully opaque and a single colour"* — so the rectangle is
pixel-identical to tiling it.

**And one that took two tries.** A paper `.panel` standing inside the night
register has to pin *both* halves of its palette. Letting the night overrides
cascade in made the plot demo vanish (cream ink, transparent fill); pinning only
the ink then broke the dark theme, where `--paper-raised` inverts to `#123040`
and the pinned `#2a1018` header landed on navy. The panel is a picture of the
daytime farm, the daytime farm has no dark mode, and `.plot__soil` was already
pinning its world colours one level down for the same reason.
`contrast.test.ts` has a "lit window" block now, checking literals rather than
tokens precisely because these must not follow the tokens.

---

# The forward plan, reconciled with the re-scope (2026-09-09)

Phases 32-36 were written before the MVP re-scope and Phase 32 was formally
closed as superseded by R-8. The other three were left standing, which makes this
the same situation Phase 14's backlog was in on 2026-09-04: **a plan that lies
about what is left is worse than no plan, because it is what you read when
deciding what to do next.** Each is checked against what actually shipped below.
No task is deleted — the designs survive; their premises are what moved.

| Phase | Status after the re-scope |
|---|---|
| 32 — Artisan goods | **SUPERSEDED** (R-8). Every recipe, price and unlock level assumes twenty crops across four seasons. Redo, do not resume |
| 33 — The village speaks | **IN PROGRESS.** Its premise is "Phases 31 and 32 built a rich item space"; 31 shipped and was then cut to eleven crops, 32 never shipped. The quest machinery needs none of that: **T-33.01 and T-33.02 are done** — the merchant talks — and T-33.06's board derives offers from unlocked content, so it works over whatever exists |
| 34 — Fishing | **BUILDABLE, and the next phase** — with one premise falsified, below |
| 35 — Seasons and the clock | **SUPERSEDED.** The re-scope is Spring-only, and R-7 already shipped the clock, the day/night cycle and the HUD clock that T-35.01/.07/.08 were for. What remains is a rotation there is nothing to rotate. D-25 is moot until a second season has crops |
| 36 — The cave | **BLOCKED, by its own ordering rule.** "It goes after artisan goods, or the Furnace and Anvil arrive with nothing to smelt." Artisan goods are superseded, so either a redone Phase 32 comes first or Phase 36 must ship ore with a sink of its own |

## The falsified premise, measured

Phase 34 opens by arguing fishing is cheap because
*"`WATER_COLS = [0]` and `SHORE_COL = 1` — a walkable shoreline with water beside
it exists on the live farm today. No new map, no new scene, no camera work, no
collision work."*

**`waterTiles()` returns exactly one tile: (0,0).** The re-scope decided the
water surround would be a **backdrop rather than a bigger tilemap**, and M5
turned `waterTiles()` round to read the map instead of the constants — so the
farm's sea is now an animated layer *behind* the map, and the map's own edge is
shoreline fringe that does not draw open water. `WATER_COLS` and `SHORE_COL` are
read by nothing at runtime; their only readers are `borderTiles()` and the
generator, which M5-3 reduced to `--force` scaffolding.

So the argument stands but the ground under it moved: fishing needs **somewhere
to fish**. Two ways, and the decision belongs above the code:

- **(a) Author a pond into `farm.json`.** Cheap now in a way it was not before —
  the editor has terrain brushes, the three bakes carry the result to the server,
  and M6 just made authoring safe by drawing the ground the author cannot see.
  It also gives the shoreline a purpose other than being the map's frame.
- **(b) Make the map's water edge fishable against the backdrop.** No map work,
  but it means the fishable thing is not a tile, which every other verb in this
  game targets. §5.1's "acts on the tile the character FACES" would need an
  exception, and D-24 records what exceptions like that cost.

Recommendation: **(a)**. The whole reason the collision, targeting and idle
systems are cheap to extend is that every verb aims at a tile.

## What the re-scope adds to Phase 34 that was not in it

- **Casting must charge energy.** R-5's rule is that every mutating farm action
  charges through one `spendEnergy`, after the state checks and before the first
  write. Fishing was designed before energy existed and has no task for it. This
  is also the phase's balance lever: T-34.09 asks whether fishing dominates
  farming, and the energy price is the answer, not the fish prices.
- **T-34.07 loses half its scope.** It depends on `machines.ts` (superseded) and
  `quests.ts` (unbuilt), so "fish are not a dead end" currently has no non-sale
  sink to point at. Either Phase 33's quest half comes first, or the shipping box
  and merchant are honestly all a fish can do at launch — which contradicts
  Phase 20's "nothing ships inert" rule and should be settled, not discovered.
- **Season sets stay unenforced**, exactly as T-31.03 left crops. Spring-only
  means the field is inert, not wrong.

**Opens D-27: where do you fish, and does a fish have anywhere to go?** Both
halves must be answered before T-34.01, because they decide whether the phase is
"one config file and a minigame" or "a map change and a dependency on quests".

## Phase U4 — the HUD stops covering the game

A design pass on the in-game screen. Client only: no server, no schema, no
endpoint, no config. The camera is deliberately untouched, so the ~40% of a
1440x900 viewport that is flat blue around the fitted map is still flat blue —
**D-12 stays open** and is now the largest visual problem left.

### U4-1 — nine panels were anchored to a bar that no longer exists · **done**

`grep 'top: 72px'` returned **nine** rules in `hud.css`. 72px was the height of
the full-width top bar **Phase U2 deleted**. Nothing failed, because a stale
constant is still a number.

What it cost, measured with `getBoundingClientRect` rather than inferred:

| viewport | `.idle__panel` x `.hud__status` |
|---|---|
| 1440x900 | **268 x 85** |
| 1280x720 | **268 x 76** |
| 390x844 | **294 x 81** |

`.idle__panel` is the only right-anchored panel in the game and the status
cluster is anchored top-right. Both are `z-index: auto` siblings, so which one
won was decided by DOM order, and `.idle` is declared last in `play.html`. What
it covered was exactly the level bar and the energy bar: a player opening idle
mode to decide whether to let the farmer work lost the two numbers that answer
it.

**`--rail-clear` was half a fix.** Phase U2 added it because two left-anchored
panels sat under the rail and swallowed its clicks. The vertical counterpart was
never built. It is `--chrome-top` now, and every panel's `--panel-lane-top`
derives from it.

**One lane, every width, no exceptions.** Letting centred panels stay high was
tried first and rejected: at 1440 a 520px panel centred at x460-980 does miss a
cluster starting at x1156, but that is true only above some width nobody has
written down, and at 390px the same panel spans the screen and lands on the
cluster. The lane is below the chrome always. It costs ~100px of panel height on
a 900px screen and buys the invariant that **no panel can cover the player's own
gold, level or energy** — the one readout that has to stay legible *while* a
panel is open, to know whether you can afford what you are looking at.

**Three numbers are measured and published by `hud.ts`, not declared in CSS:**
`--status-bottom` and `--chrome-top` from `barHeight()`, `--hotbar-clear` from
`chrome()`. Both already measured these boxes for the camera (T-18.03); this is
one measurement with two consumers.

### U4-2 — three constants that described a layout the layout had not agreed to · **done**

Each of these was found by the probe, not by reading:

**The rail wraps.** The first lane arithmetic was `cluster + one rail button`.
Right until 390px, where eight buttons need two rows, the rail measured 94px
instead of 44, and every panel landed on its second row. `hud.ts` measures the
rail's bottom edge instead — but only when it is a ROW, read back off
`flex-direction`. On a desktop it is a 400px column down the left edge and
panels clear it horizontally; folding that into a vertical lane would push
everything off the bottom of the screen. CSS decides the direction, the
measurement reads it.

**`.hud__coach` guessed `4.6rem`** and overlapped the hotbar at every viewport —
620x30 at 1440, 492x6 at 1280, 195x30 at 390 — straight across the slot numbers.
`.dialogue`, the same kind of strip in the same place, derives its clearance
instead. That derivation is `--hotbar-clear` now and both read it.

**And `.dialogue`'s derivation was itself 12px short**, which is why
`--hotbar-clear` ended up measured rather than copied. `0.75rem +
var(--slot-size) + 14px + 0.75rem` computes to 92px; the strip occupies 104. The
`14px` is padding plus a 6px border, and the plank's `border-image` is 5px at
`--ui-scale: 3`, so the real border is 30px. It had been wrong for as long as it
existed. `.dialogue` had enough slack to absorb it; a panel's `max-height` did
not.

**The hotbar overflowed its own `max-width`** — `x -12 → 402` in a 390px
viewport, slot 1 clipped off the left edge and slots 8-12 unreachable, with
`overflow-x: auto` scrolling a box already wider than the screen clipping it.
Missing `box-sizing: border-box`, so the plank's frame was added outside the
width. The same bug `.hud__status` already carried a note about.

On a phone the rail now lies down as a wrapping row under the cluster and the
panels take the full width, which is what this file's own "Narrow screens: the
side panels become bottom strips" heading has promised since Phase U2 and never
delivered — the panels kept private `top: 60px` overrides instead of moving the
lane. Those are gone too.

### U4-3 — the level and energy cluster · **done**

Eight rules described the same widget twice (`.hud__xp` + `.hud__level` +
`.hud__xpbar` + `.hud__xpfill` against `.hud__energy` + `.hud__energybar` +
`.hud__energyfill` + `.hud__energynum`), which is how they drifted. Measured:

- **The XP track started at x1318 and the energy track at x1249**, in a 272px
  cluster whose other three rows all began at x1249. Two bars meant to be
  compared, with a 69px step between them and no shared edge.
- **At Lv 1 the XP fill is 0% wide** and what showed through was a bare dark
  rectangle. A new player's first screen had what read as a broken widget.
- **The level pip wore `ui-tag-cyan.png`** directly above a cyan energy fill.
  The comment at `hud.ts:384` says energy took cyan *specifically* so two bars
  would not be confusable; the pip undid it.
- `.hud__name` was Silkscreen at 10px — the smallest type in the game spent on
  the player's own farm name. `--t-num: 18px` existed, annotated "the numbers a
  player reads at a glance", and **nothing in the game used it**.

One `.hud__meter` now, twice, `display: contents` into a three-column grid on
`.hud__readouts` — glyph, track, number — so both tracks share a left and right
edge. Told apart by **glyph** (star, heart, from the `.ui-icon` vocabulary the
rail already uses), with colour as the redundant channel rather than the only
one. The cluster widened 17rem → 21rem to hold two real tracks plus a glyph and
a number column.

**The bars are the pack's art, drawn the way the boot curtain draws it**
(`play.html:112-152`): the same `ui-bars.png` window painted twice, the lower
copy under a scrim as the groove, the upper clipped by width as the fill. An
empty bar then looks like an *unlit bar* rather than a hole. `ui-bars.png` ships
no empty track — U3-5 established it is a colour catalogue, not a state pair —
and drawing a groove by hand double-frames, because the bar art carries its own
frame at rows 2 and 7 of 9. 42 source pixels, whole multiples only: 126px at
`--track-scale: 3`, dropping to 2 on a short viewport instead of to a pixel
width (the old `width: 64px` would have shown half a bar and a slice of the next
one along).

**Empty energy tints the GROOVE, not the fill.** It used to recolour
`.hud__energyfill`, which at zero energy is zero pixels wide — the state that
most needed to be visible was the one state in which nothing was drawn.

The shared fill rule also needed `width: 0` putting back. Without it a block
element fills its track, so both bars painted FULL for the frame between the HUD
mounting and the first poll landing. `levelBar.test.ts` pins it.

### U4-4 — the orange wall, and a selection that read as disabled · **done**

**Every slot wore `--soil` (#c46120) whether or not it held anything.** A new
player's hotbar is four items and eight empties, so the strip along the bottom
was twelve equally loud orange squares — the largest single block of colour in
the game, most of it saying nothing. Empty cells are desaturated and darkened
now (not `opacity`: a transparent cell shows grass through it and reads as a
hole). The filled cells are the bright ones, which is the correct ordering.

**The selected creator swatch was the weakest cell in its row.** Measured at 3x:
every unselected swatch carries the pack's #1c0a18 outline and the selected one
carried none. The bracket ring sits at `inset: calc(-2px * var(--ui-scale))`,
exactly on the cell's own border, and the brackets are drawn in a pale tan very
close to `--panel-fill` — so the one swatch the player had chosen faded into the
panel while twenty-two they had not kept a crisp black frame. **The art is fine
and works in the hotbar**; it was being used on the one background it disappears
on. A `box-shadow` ring in the pack's outline black, spread to the bracket's own
bleed, gives the brackets the dark ground they have on the timber plank. An
`outline` was tried first and drew a strikethrough through every row label.

Also: `.hotbar__key` at 10px Silkscreen had strokes about as wide as the 1px ink
outline drawn around them on four sides, so the outline closed over the letter
and the shortcut numbers read as dark smudges. The rule already said "a shortcut
hint nobody can read is not a hint"; it was two points short of being true.

### U4-5 — prose stopped being set in the label face · **done**

Every sentence in the HUD was Silkscreen — the uppercase chrome face — at 10 or
12px with no line-height. Silkscreen is drawn on an 8px grid for short uppercase
labels and is the right face for "BACKPACK", "GOALS", "SOW". It is the wrong
face for "Drag a slot onto another, or click one and then the slot to move it
to", which is three lines of running text. `--t-body`/`--t-body-sm` are
annotated "Pixelify Sans, prose and lists" **and nothing in the game used
them.** Applied to `.pack__hint`, `.trade__hint`, `.shop__empty`,
`.trade__empty`, `.shipping__hint` and `.hud__coach`.

Two more in the goal board: `.goalrow__bar` asked for `height: 10px` without
`box-sizing`, and the trough's 3px ink border left **4px of channel**, so every
goal showed its progress as a hairline. And `--board-w: 236px` broke the reward
line inside its own phrase — "PAYS 2 x LEEK / SEEDS" — so 264px now holds the
longest string the seed list can produce.

The creator's actions moved into the preview's column: the left side was a 208px
square of grass above ~390px of empty panel, because the card's height is set by
six swatch rows and the preview is pinned square (U3-6 tried stretching it and
reverted — a column of grass is a wall). "Start farming" sits under the farmer
it commits now, and the card lost 62px of height.

### U4-6 — two things the probe could not see · **done**

Both found by **playing** the game after the probe went green, which is the
argument for doing both.

**The toasts landed on the coach hint.** The probe does not track the toast
container, because it is empty — and therefore zero-height — unless a message is
live. Walking into an untilled plot produced "That plot is not cleared yet."
printed across the top edge of "Walk with WASD…": two pieces of instructional
text arguing over the same pixels, which is the complaint `.dialogue` already
carries a note about. `6rem` cleared the hotbar and not the hint; deriving from
`--hotbar-clear` alone still landed 6px in, because the hint's height is not a
constant — it is one line at 1440 and three at 390. `--bottom-chrome` is the
measured reach of both, and the coach is skipped when hidden so the toasts move
back down once it retires.

**Every error toast in the game was unreadable.** `.toast--error` asks for
`#fbf1e2` on `background: var(--barn)` — a fine pair that has not reached the
screen since Phase U gave `.toast` the panel frame with `border-image-slice: 6
fill`. `fill` paints the source's middle over the element's own background, so
the background was never painted and cream text sat on the panel's tan interior
at **1.25:1**. Not "low contrast": invisible, on every refusal the game gives —
not enough gold, inventory full, plot not cleared.

This is the third time this exact failure has been recorded here and the first
time it has been about a `fill`: the text did not change, the surface under it
did, and nothing was looking at the surface (T-27.01 found it three times;
`.hud__thirsty` carries the note). `contrast.test.ts` checks the pair against
**the surface the frame actually paints**, not the one the rule believes it set,
and fails any `background` declared under a `fill` frame.

## How this phase was verified

A Playwright probe opens **every panel at once** — which is a reachable state,
since panels stay independently openable by design — and asserts zero overlap
between any panel and the chrome (`rail`, `status`, `hotbar`), plus no element
out of horizontal bounds, at 1440x900, 1280x720 and 390x844. It reported 10
failures before and **ALL CLEAN** after. `pnpm test` 2,836 green, `pnpm
typecheck` clean.

**And then the game was played**, which found two more (U4-6). A geometry probe
can only measure the elements that are on screen when it looks; a toast is on
screen for two seconds after an action it does not know how to take.

`railButtons.test.ts` gained two guards: the lane must derive from
`--chrome-top`, and **no rule in `hud.css` may anchor to a literal `top: <n>px`
at 24px or above**. That threshold is what keeps it honest rather than merely
strict — `.hotbar__key` pins its badge at `top: 1px` inside a slot, which is a
position within a component, not a claim on the viewport.

## One thing this phase looked for and did not find

**The white rectangle under the idle panel is not real.** A large white block
paints below `.idle__panel` in **headless** Chromium and does not reproduce
headed. Given `hud.css` already documents a genuine compositing bug of exactly
this shape — `.pack__head` as `position: sticky` painting a 700x32 black band
over the WebGL canvas — it looked like a second one. It is a headless GPU
artifact. **Screenshot compositing questions in a headed browser**; the headless
run will invent them.

## What is deliberately still not done

- **D-12, and it is now the biggest visual problem on the screen.** At 1440x900
  roughly 40% of the viewport is flat blue around the fitted map. This pass was
  scoped to the chrome and left the camera alone.
- `ui-plaque.png` is still uncalled. It was cut for "the gold counter and the
  level pip", and the level is a number inside its meter's row now rather than a
  pip, so half the reason is gone. Gold keeps the honey pill.
- The idle panel still does not say **what idle mode is doing** — Phase U2's
  note stands, and the status cluster is the obvious place for it now that the
  cluster is a grid with room.

## Phase U5 — the text pass

The brief was "the idle text isn't in a good colour", plus dialogue and general
game text. The idle complaint turned out to be the visible corner of one
systematic bug. Client only; no wording changed, only treatment.

### U5-1 — the ground a `fill` frame paints · **done**

**`border-image-slice: <n> fill` paints the source image's middle OVER the
element's own background.** So from Phase U onward — which put a nine-sliced
frame on almost every control in the HUD — a rule of the shape

```css
background: var(--barn);
color: var(--paper);
```

stopped describing anything real. The background is not painted; the colour is
sitting on whatever the PNG has in its middle. Nothing in the stylesheet reads
as wrong, which is why it survived.

Six controls had text that was **effectively invisible**, every ground sampled
from the shipped asset rather than read off the rule:

| rule | declared | real ground | ratio |
|---|---|---|---|
| `.idle__banner` | `--paper-raised` | `ui-panel.png` #f7dbc6 | **1.13** |
| `.goalrow__tag` | `--paper` | `ui-tag-grey.png` #d9d9d9 | **1.07** |
| `.goalrow__claim` | `--paper` | `ui-plate-moss.png` #a4c93c | **1.45** |
| `.idle__stop:hover` | `--paper` on `--barn` | `ui-plate-pink.png` #ffaab0 | **1.37** |
| `.trade__btn--danger` | `--barn` on `transparent` | `ui-plate-rust.png` #ae4924 | **1.15** |
| `.decorrow__btn:disabled` | `--faint` on `--paper-raised` | rust plate #ae4924 | **1.15** |

**`.idle__banner` is the reported bug**, and it is the worst place for it: the
banner shows the entire time idle mode runs — §5.3's headline feature — and is
the only control that stops it. `ui.css` frames `.toast, .idle__banner` in one
rule; **the toast was fixed for exactly this last phase and the banner beside it
was not.** One selector was fixed; the class was never swept.

Two of the six were *regressions in `hud.css`*: `ui.css` already pairs
`.goalrow__tag` and `.goalrow__claim` with `--ink` and has been right all along.
`hud.css` loads second and was overriding it with the colour that belongs on the
dark plank.

Four more were sub-AA rather than invisible — `--paper` on the rust plate is
**4.21**. The palette has been carrying a fix for that which cannot reach it:
T-27.01 darkened `--barn` by 4.5% specifically to get the button label to 4.52,
and `contrast.test.ts` still pinned that pair. `--barn` is a *background*, and it
has not been painted since Phase U. **The token was doing nothing and the test
was confirming it.** The art cannot be darkened — it is the licensed pack — so
the label moves up to `--paper-raised`, 4.76.

### U5-2 — the guard, landed before the fix · **done**

Written first and confirmed to report **all eleven** cases before anything was
changed, so the check is proven to catch this class rather than assumed to.

`describe('text on a frame that paints its own middle')` reads each selector's
**declared** colour out of the stylesheets — `ui.css` then `hud.css`, last
declaration wins, `var()` resolved — and checks it against the fill colour
**decoded from the PNG** with the same `decodePng` the asset pipeline uses. A
table of intended tokens would have passed happily while all six were invisible;
a pinned hex would be one more copy of a number that can drift from the art.

Two structural guards came with it:

- **No `background` under a `fill` frame.** That combination is always a lie, and
  every one of the six had it.
- **No `opacity` on a rule that also sets type.** See U5-3.

A state selector that declares no colour inherits its base — which is the
correct shape for one, and is what lets four of the six fixes be "delete the
line".

### U5-3 — six quiet browns, and a comment with the reasoning backwards · **done**

T-27.01 created `--faint` because **three** values were doing this job. It then
wrote, four lines below the fix:

> The other literal in this file, #6d4738, is left alone: it measures 6.10 and
> was never the problem.

That is why there were **six** by this phase. A second answer to a settled
question means every rule written afterwards picks one at random, and the
literal won **fourteen uses to five**. Three more arrived as `opacity` dimmings
— #493233, #604641, #654a44 — which are not colours at all.

`.board__tab`'s comment explained the technique:

> Half-strength rather than a lighter colour, so the contrast ratio the
> `contrast.test.ts` axe pass pins is not quietly reduced.

**It is exactly backwards.** `opacity` reduces the ratio — cream at 62% on the
plank is 5.63 rather than 12.75 — and the reduction is precisely what a test
reading `color:` cannot see. The pinned pair stayed green while the painted one
moved.

**The token is `#6d4738` now**, because the literal was also the better value:
5.74 on the panel tan against #875146's 4.55. Consolidating onto the weaker
number to preserve a token's value would have been the wrong way round.

Also fixed: `ui.css`'s `var(--faint, #8d5449)`. `--faint` is declared on `.hud`
only, so on the `.ui-scope` pages that load `ui.css` without `hud.css` **the
fallback is what applies** — and #8d5449 is the *previous* `--faint`, at 4.29. A
stale copy of a token escaping a token update, on the surface nobody checked,
which is the exact failure `--faint` exists to end.

### U5-4 — prose in the prose face, and an overflow it was hiding · **done**

`.dialogue__text` — the merchant's actual spoken lines — was set in **Silkscreen,
the uppercase chrome face**. Measured in the real box at 390x844:

| face | rows for a 117-character line |
|---|---|
| **Silkscreen 14px (was)** | **4** |
| **Pixelify Sans 14px** | **3** |
| Pixelify Sans 16px | 4 |

The box reserves three. **`DIALOGUE_MAX_LINE = 120` was already being violated by
the stylesheet** — its own note says it was measured against "0.82rem
monospace", the face changed later, and nobody re-measured. So moving prose to
the prose face *repairs* the constant rather than threatening it, and no shared
config changes.

`.idle__hint` and `.creator__hint` were the two rules last phase's prose
conversion missed, which is why the idle panel was the one panel still wearing
the old 12px label-face treatment. That is the visible half of the complaint.

`.dialogue__speaker` measured **4.54** on the box's tan — four hundredths above
AA, in the colour this HUD uses for warnings. A merchant's name is not a
warning; `--frame` reads as a name and measures 9.78.

### U5-5 — the hotbar digits · **done**

`--paper-raised` on the slot art is **3.54** on a filled cell and **2.38** on the
selected one. They stayed legible on a four-way ink `text-shadow` — a real
technique, and one WCAG does not model, so the number failed while the screen
looked fine. Neither "trust the outline" nor "darken the art" was available.

The digit brings its own ground instead: a chip in `--timber`, the plank the
hotbar is already made of, so no new colour enters the palette. **14.43:1**, and
the outline goes with it.

One consequence worth recording: the quantity span is created for every cell and
*emptied* rather than removed, which cost nothing until it had a background and
then painted a dark stub in every empty slot. `:empty` in the stylesheet, not a
change to the render path — the render path was already right; this stylesheet
gave a blank element something to draw.

## How this phase was verified

A painted-pixel audit screenshots every visible text element and computes its
ratio against **the colour actually painted behind it**, not the one its rule
declares. Zero below AA, across 32 elements with every panel open.

**Two artifacts in the audit tool had to be fixed before its output meant
anything**, and both flattered or accused wrongly:

- It measured boxes *before* the screenshot, so a panel rendering in between put
  the wrong pixels at an element's coordinates.
- It measured **occluded** elements. The audit opens every panel at once, which
  stacks them in one lane, so an element can be laid out correctly and have
  somebody else's pixels on top of it. That reported the shop's active tab at
  1.13 against the header behind the panel covering it; measured directly it is
  ink on orange at **6.9**. It skips anything `elementFromPoint` says is covered.

`pnpm test` 2,854 green, `pnpm typecheck` clean. The dialogue re-measured at
390x844: a 120-character line is three rows again.

## What is deliberately still not done

- **The `background`-under-`fill` guard only catches rules that declare both.**
  `.trade__btn--primary` and `.decorrow__btn--place` set
  `background: var(--grass-deep)` in one rule and inherit the plate from
  another, so **neither confirm button is green on screen** and no test says so.
  Catching that needs a cascade model, not a regex.
- **D-12.** Still the biggest visual problem on the screen, still untouched.
- The idle panel still does not say **what idle mode is doing** — Phase U2's note
  stands.

## Phase U6 — buttons that were not where they belonged

A placement pass on the panel headers. Client only, layout only — no colours, no
wording, no new controls. One of the findings is a trap rather than a blemish.

### U6-1 — the exit could be pushed off the screen · **done**

Panel headers were a single unwrapped flex row — `[title] [tabs] [close]` — with
no shrink, wrap or scroll strategy. A flex item's default `min-width: auto`
refuses to shrink below its content, so the tab strip would not give way and the
**last child was pushed out instead**. The last child is the way out.

Measured, opening one panel at a time so nothing was occluded:

| viewport | symptom |
|---|---|
| 1440x900, 1280x720 | `.shop__close` spilled **25px** past the panel's right edge |
| 390x844 | `.shop__close` rendered at **x 541-593 in a 390px viewport**; "Gear" spilled 64px and "Decor" 155px |
| 390x844 | `.board__close` covered **both** board tabs — 44x25 over "Requests" — making the tab unclickable |

**On a phone that is a trap.** Escape closes every panel and a touch device has
no Escape — D-24 gave it a stick and an action button, not a keyboard. A player
who opened the shop on a phone could not close it, and could not reach Gear or
Decor either. Confirmed in a touch context: the close button's centre was not
hit-testable because it was not on the screen.

Same failure as BUG-05 — *"at 390px its 842px of content pushed six controls,
including the only way to log out, off the screen"* — fixed for the top bar and
never swept into the panels.

### U6-2 — six headers, four ways of reaching the right edge · **done**

Only **two** of six close buttons anchored themselves. `.pack__close` and
`.shipping__close` carried their own `margin-left: auto`; `.shop__close` was
pushed by a *sibling's*, `.idle__close` by `flex: 1` on the title,
`.board__close` by `flex: 1` on the tabs, and `.creator__head` is not a flex
container at all. Four of six were right-aligned **by the accident of being the
last flex child** — which holds exactly until the row runs out of width.

They also carried three paddings (0.25/0.3/0.35rem) and three font sizes
(`--t-title`/`--t-num`/`--t-body`) for one control holding one 32px glyph, so
the plate art was framed differently on every panel.

One contract now, and it is three lines: the header is a flex row, the **exit**
is `flex: none` and anchors itself, and the **flexible middle** declares
`min-width: 0` so it is what gives way. Padding returns to `ui.css`'s shared
plate rule instead of six overrides.

Tabs `flex-wrap: wrap`. On a phone the shop's strip also takes its own row
(`flex-basis: 100%`), because wrapping alone put five tabs on **three** ragged
rows once the title and close had eaten the first row's width; given the full
366px they need two. The board is excluded from that — it has no title, so its
two tabs and close share a row comfortably, and forcing a second row there buys
an empty first row holding nothing but the ✕.

### U6-3 — the countdown floated at a shifting midpoint · **done**

`.trade__expiry` and `.trade__history-toggle` are siblings in `.trade__head` and
**both** declared `margin-left: auto` — the only place in the file where two
auto margins shared a flex line. Flexbox splits the free space equally, so the
countdown sat at an arbitrary midpoint with ~170px of gap on each side and
**moved as the string got shorter**: measured x 651-694 for "4m 59s", 661-684
for "59s", and a collapsed 672-672 hole when the trade had no expiry.

**The obvious fix reproduced the bug one element along.** Deleting the expiry's
auto margin worked until the header contract gave every close button one of its
own — and History still had its. Two again, splitting again. The expiry gets
`flex: 1` instead: growing its *box* leaves the text beside the title where it
belongs, sends History and the close right together, and leaves exactly one auto
margin on the line. Left edge now fixed at 492 across four string lengths.

### U6-4 — the exit could also scroll away · **done**

`.pack`, `.shipping` and `.idle__panel` are `overflow-y: auto` with a **static**
header, so scrolling took the close button with it. Measured on the idle panel
at 1280x560: scrolling to the bottom moved the ✕ from `top: 199` to `top: 113`,
**46px above the panel's own top edge**.

**This reverses a documented decision, with a re-test.** `.pack__head` carried:
*"NOT `position: sticky`. It was, and over the WebGL canvas Chromium promoted it
to its own layer and painted a black band across the compositing bounds — a
700x32 rectangle above the hotbar, in the game, not just in screenshots."* That
was a real observation, and the note's second half — "short enough not to need a
pinned header anyway" — is only true on a tall viewport.

So the artefact was re-tested rather than worked around: sticky headers, headed
Chromium, both panels scrolled to the bottom over the live canvas. **The band
does not reproduce.** It was a browser bug this Chromium no longer has. Re-check
headed if it returns; headless paints its own artefacts over this canvas and
cannot answer the question.

`.shop` and `.trade` need nothing — they are flex columns whose inner list
scrolls, so their headers never moved.

### U6-5 — a cascade bug wearing a placement bug's clothes · **done**

The board's header was crammed into 190px on a phone, which is what put its
close button on top of its tabs. The cause was not in the header: last phase's
narrow-screen lane block sat **near the top** of `hud.css`, and
`.board { width: min(var(--board-w), …) }` two thousand lines below simply won
on source order — a media query adds no specificity. `.hud__decor` had the same
shape.

The block lives at the end of the file now, after everything it overrides, which
is where an override block belongs. The board takes the full 366px lane and its
header fits on one row.

Also in this pass: `.touch__stick` / `.touch__act` moved off `bottom: 6.5rem` —
the one bottom-anchored pair not reading `--hotbar-clear`, the token that exists
because `.hud__coach` guessed `4.6rem` and overlapped the hotbar. 6.5rem is
104px and the token's fallback is also 104px, so they agreed **by coincidence**;
`hud.ts` republishes the token from a live measurement and the constant would
not have followed. And `.board__title` is deleted — nothing carried the class,
while its `flex: 1` made it read as the element doing the pushing.

### U6-6 — the shop is 584px wide, and the number is measured · **done**

With the contract in place the shop's tabs wrapped to two rows even at 1440,
which is correct and needless. The header needs **540px** of content: title 42 +
five tabs 400 + 22 of tab gaps + close 56 + two 9.6px header gaps. 520 gave it
520 — and those twenty pixels were what used to push the close button out.

Two guesses missed before the measurement did not: 560, and a "541 needed"
computed from widths read out of the stylesheet rather than off the rendered
header. Narrow screens still wrap deliberately.

## How this phase was verified

Three probes, all run at 1440x900, 1280x720 and 390x844:

- **`btnaudit.mjs`** opens one panel at a time and reports any control that
  spills outside its panel or overlaps a sibling's text. Six findings before,
  **zero** after.
- **`scrolltest.mjs`** scrolls every panel and every scroller inside it to the
  bottom and asserts the close button is still within the panel's box. **All
  exits reachable.**
- **`probe.mjs`** (Phase U4's) still **ALL CLEAN**, since U6-4 and U6-5 move
  panel boxes.

Plus a touch context at 390x844: the shop's close button is in the viewport and
hit-testable, and all five tabs are on screen.

**The two new stylesheet guards were proven by reintroducing the bugs.** With
the close button's anchor deleted, "makes the exit unshrinkable and
self-anchoring" fails; with the second auto margin restored, "leaves no second
auto margin in a panel header" fails. Both pass again on the real file. A guard
that has never been seen to fail is a guard nobody has tested.

`pnpm test` 2,859 green, `pnpm typecheck` clean.

## What is deliberately still not done

- **The auto-margin guard counts by selector, not by container.** A text test
  cannot know which elements share a flex parent, so it pins the specific
  siblings that sit in a header with a close button. A sixth header, or a new
  child, would need adding to that list.
- **D-12.** Untouched, and still the biggest visual problem on the screen.
- The `background`-under-`fill` guard from U5 still only catches rules declaring
  both, so `.trade__btn--primary` and `.decorrow__btn--place` are **still not
  green on screen**.

## Phase U7 — the bed nobody had, and a farmer who never woke up

Two halves of the same complaint: **energy is the only limit in the game, sleep
is the only way to get it back, and the bed was a 1,400g shop item.** So the
loop had a hole at both ends — a player could be permanently unable to act, and
an idle farm could permanently stop.

### U7-1 — a bed in every house, not a bed in the shop · **done**

`STARTING_FURNITURE` has placed a bed since T-18.25, so every account
registered *after* that walks into a furnished room. Every account registered
**before** it has nothing:

| accounts | beds (placed or in storage) |
|---|---|
| 134 | ≥ 1 |
| **103** | **0** |

Those 103 can work until the bar empties and then never again, unless they can
find 1,400g — which they cannot, because earning gold takes energy. Not a
difficulty curve; a dead account.

**Fixed as a self-healing check on `GET /api/house`, not as a data migration**,
and the reason is geometry. Choosing where a bed goes means asking
`fitsInRoom`, `overlaps` and `checkInteriorReachable` — three functions that
live in shared TypeScript and encode footprints derived from sprite sizes.
Reimplementing that in SQL would be a second authority on where furniture may
stand (§4.4) and would go stale the first time a crop window moved. Asking the
real code, on the one read that proves the player is standing in the room,
costs a single indexed query for everybody who already has a bed — which is
every account that will ever be registered from now on.

It also covers what a one-off migration would not: a restored backup, a bed
lost to some future bug, a catalogue change.

`ensureBed` takes `lockRoom` **first** (T-18.28's phantom-read fix) so two
concurrent house reads cannot each conclude "no bed" and grant one. It prefers
the starter corner, falls back to a row-major scan using `assertPlaceable` as
the predicate — so a granted bed is one the player could have placed
themselves, reachability included — and only if the room is genuinely full does
it go to storage.

**Both beds stay in the catalogue.** The free one is the plain bed; the
four-poster is still something to want.

### U7-2 — the idle farmer puts itself to bed · **done**

The simulator stopped at `out_of_energy` and stayed stopped. At 2 energy an
action against a 40-point bar that is **twenty actions — about three minutes** —
after which the farm stood still until a player walked indoors and pressed a
key. The original note defending that wall argued energy the offline farmer
ignored would be no limit at all. Right about the danger, wrong about the
remedy: an idle game whose headline feature needs manual intervention every
three minutes is not idle (§1).

**Energy is now a throttle, not a wall.** The farmer spends the bar, sleeps
`SLEEP_DURATION_MS`, and resumes.

It gives up nothing, because **sleep has no cooldown and never did**: a present
player has always been able to alternate work and bed exactly like this, so
auto-sleep gives the absent player the same deal and no better one. And in
practice it is *harsher* than the wall, which was routinely followed by a
player sleeping on demand and resetting it for free. The duty cycle:

| | |
|---|---|
| bar at level 1 | 40 |
| average action | ~2 energy → ~20 actions |
| work per bar | 20 x `IDLE_ACTION_MS` = **~3.3 min** |
| rest | `SLEEP_DURATION_MS` = **10 min** |
| **farmer is busy** | **~25% of the time** |

Verified against the running server — a 3-day absence on a 20-plot farm,
starting with the bar at zero:

```
watered: 360   slept: 18   (18 naps x 40 energy = 720 = 360 x 2, exactly)
```

Before: 0 actions, because the farmer was already flat out.

Three things the implementation turns on:

- **A nap that does not fit in the window is declined, not truncated.**
  `processedTo` stops at the last action either way, so a truncated nap would
  be re-simulated and credited twice on the next read. Declining keeps the
  simulator's one non-negotiable property — a window is worth the same however
  many times it is run. The rest is deferred, not lost: the next read covers a
  longer window and the nap fits.
- **A manual sleep is banked before the shift.** The recovery is derived from
  `sleeping_since` on every read, so spending it in a shift and leaving the
  timestamp set would hand the same rest out again on the next poll — a slow,
  silent energy dupe. `applyIdleWork` calls the existing `wake()` and gets the
  player up. Only a farm with idle mode **on** ever reaches that line, so it
  cannot wake someone merely having a lie-down; for one that has handed the
  farm over, a manual sleep underneath an autonomous one is two schedules
  fighting over one bar.
- **The energy write stayed relative** (`+ delta`, clamped in SQL to
  `[0, cap]`) even though the applier knows the absolute answer. The absolute
  form would clobber a manual action committing from another tab —
  `spendEnergy`'s conditional `WHERE` protects itself against the applier, and
  this is the other half of that bargain.

Termination is guarded rather than assumed: a bar too small to pay for the
cheapest available action refills to a bar that still cannot, so that case
keeps the old wall. `slot` also strictly advances across every nap.

`IDLE_MAX_CATCHUP_ACTIONS` goes back to being live code — energy had made it
unreachable, and it is what bounds a long absence again.

**The summary says so.** `IdleSummaryView.slept` rides the existing
while-you-were-away toast: *"Your farmer slept 18 times to keep going."* News,
not a nudge — but without it a player who left for a day and came back to four
hours of work has no way to tell a tired farmer from a broken one.

### Verification

`pnpm typecheck` clean. Server 1,100 green, client 884, shared 705.

The reversed test is worth naming: `idleApply.integration.test.ts`'s *"stops
when the farmer runs out of energy"* asserted the old wall, including the line
*"a tired farmer stays tired until the player sleeps"*. It now asserts the
opposite, and the part of it that was always the point — that a long absence is
not settled in full — survives as `action_cap` rather than `out_of_energy`.

The nap's real-time **cost** is pinned in `idleSim.test.ts`, not the
integration suite: a real farm runs out of things to do long before it runs out
of energy (soil stays wet four hours), so a short window stops at
`nothing_to_do` and proves nothing about sleep.

### What is deliberately still not done

- **No browser pass.** Chrome is not installed in this environment and
  `npx playwright install chrome` needs sudo. Both changes were verified end to
  end against the running dev server through the real HTTP endpoints instead.
- **The energy frame is still "now", not "window start".** The simulator is
  handed the bar as of `now` for a window that began in the past. Pre-existing,
  untouched, and conservative in the common case — but it is the next thing to
  look at if the numbers ever seem generous.
- **A bed that lands in storage** (only possible in a genuinely full room)
  needs the decoration tray to get out of. The scan makes it near-impossible;
  it is a fallback, not a path.
