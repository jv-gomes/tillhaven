# Tillhaven — Roadmap v1 (ARCHIVED)

> **Superseded by [/ROADMAP.md](../ROADMAP.md) on 2026-08-24.** The project
> pivoted to Stardew-style gameplay with a new licensed asset pack. This file
> is kept as the record of Phases 0–5 (auth, crops, animals, inventory,
> trading, VIP) — all of which remain in the codebase — and of every design
> decision made along the way. Do not add tasks here.

Every task below is sized for one focused session. Work them in order; each one
names the files it touches, what to do, and what "done" means.

Read [CLAUDE.md](./CLAUDE.md) before starting any task. Section references like
`§4.3` point there.

---

## How to use this file

**Pick the lowest-numbered unchecked task whose dependencies are done.** Tasks
within a phase are ordered so nothing is blocked by something further down.

Each task looks like this:

```
### T-1.04 — Short imperative title
Depends: T-1.03 · Size: S | M | L
Files:   the exact paths this task creates or edits
Do:      what to build, and any decision already made for you
Done:    checkboxes that must all be true
Not now: things that look in scope but belong to a later task
```

**Size** is rough effort, not lines: `S` ≈ one file and its test, `M` ≈ a
feature slice, `L` ≈ split it if it grows.

### Rules that apply to every task

Do not mark a task done until all of these hold for the code it touched:

1. **The server decides.** The client sends intents. If a payload contains an
   amount of gold, an item grant, a growth stage, or a timestamp the server
   could compute itself, the design is wrong. (§4.1)
2. **Multi-row writes are transactional.** Anything touching two rows runs in
   one `db.transaction`. There is no path that creates or destroys items outside
   one. (§4.3)
3. **Every endpoint: Zod, rate limit, ownership.** Parse the body with a schema
   from `packages/shared/src/schemas`. Attach a per-account limit. Verify the
   caller owns the farm/plot/animal/item — never trust an id alone. (§8)
4. **Errors carry codes.** Throw `GameError` with a code from
   `packages/shared/src/errors.ts`. The client must never string-match English.
5. **Types live in `packages/shared`.** Defined once, imported by both sides.
6. **Integers and epoch-ms UTC.** No floats for gold or quantities. No local
   time in the data layer. (§10)
7. **Tests cover the failure paths**, not just the happy one. (§11)

### Testing shape

Pure logic is always split into its own task *before* the endpoint that uses it,
so it can be unit-tested without a database. Pure functions take `now` as a
parameter — never call `Date.now()` inside one, or the test cannot be
deterministic.

---

## Open decisions

These are **not decided**. Do not settle them in code. When one is decided,
record it here, update the relevant config constant, and unblock its tasks.

| # | Question | Status | Blocks |
|---|---|---|---|
| D-1 | **Watering** — required mechanic, or optional speed boost? | Open. `WATERING_ENABLED = false` in `config/crops.ts`. `plots.watered_at` exists and stays null. | T-2.12 |
| D-2 | **Withering** — do ripe or unharvested crops rot? | Open. `WITHERING_ENABLED = false`. `plots.withered_at` exists and stays null. Leaning no: it contradicts the idle-first pillar. | T-2.13, T-6.03 |
| D-3 | **Is gold tradeable between players?** | Open. `GOLD_IS_TRADEABLE = false` in `config/economy.ts`. Trade rows carry gold columns so flipping it needs no migration. | T-4.09 |
| D-4 | **VIP price point.** | Open. Never hardcode an amount — it lives in the Stripe dashboard behind `STRIPE_VIP_PRICE_ID`. | T-5.02 |

Decided:

- **Trade eligibility** — account age ≥ 24h **and** farm level ≥ 5.
  `TRADE_MIN_ACCOUNT_AGE_MS`, `TRADE_MIN_FARM_LEVEL` in `config/economy.ts`.

---

# Phase 0 — Foundation

Mostly complete. What remains is listed.

- [x] **T-0.01** Monorepo, pnpm workspaces, TypeScript strict, Docker Compose
- [x] **T-0.02** `packages/shared` — config, types, Zod schemas, error codes
- [x] **T-0.03** Asset pipeline (`pnpm assets`) and the asset manifest
- [x] **T-0.04** Fastify skeleton, health check, extensionless route serving
- [x] **T-0.05** Landing page at `/`
- [x] **T-0.06** `/login` and `/register` shells with shared Zod validation
- [x] **T-0.07** `/play` Phaser boot with a preloader over the full manifest

### T-0.08 — Icons for animal produce and feed  ✅ **DONE**
Depends: — · Size: S
Files: `apps/client/public/assets/`, `packages/shared/src/config/items.ts`, `ATTRIBUTION.md`

**Do:** Egg, milk, hay and chicken feed currently reuse the chest sprite as a
placeholder — there is no egg or milk art in the pack. Source or draw four
16×16 icons, add them to the manifest, and point the four `ItemDef.icon`
entries at them.

**Done:**
- [x] Four icons exist as real files; no item still points at `chest`
- [x] The `TODO(assets)` comment at the bottom of `items.ts` is deleted
- [x] `ATTRIBUTION.md` records the source and licence of anything new

### T-0.09 — Tiled terrain sets for the spring tileset  🔁 **SUPERSEDED by T-0.12**
Depends: — · Size: M

**Why it was dropped:** this task assumed the external Tiled editor. T-0.12
built an in-repo editor instead, which carries its own terrain sets in
`apps/mapmaker/src/tilesets/terrain-sets.json` and exports Tiled-format JSON —
so the artefact §9 asks for still exists, without the external dependency.

The tileset layout the task asked someone to work out visually has been worked
out and is recorded in `apps/mapmaker/src/tilesets/terrain.ts`. No `.tsx` file
was ever needed: the exporter embeds tilesets in the map JSON.

### T-0.12 — Map editor (`apps/mapmaker`)  ✅ **DONE**
Depends: — · Size: L
Files: `apps/mapmaker/`, root `package.json`

**Do:** An in-repo canvas map editor that exports Tiled-format JSON straight
into `apps/client/public/tilemaps/`. Palettes are derived from the shared asset
manifest so nothing is loaded by magic string (§9). Terrain sets are data, not
code, and are calibrated in the UI.

**Done:**
- [x] Paint, erase, rect fill, flood fill, stamp, terrain brush, undo/redo
- [x] Objects on an object layer, bottom-anchored; plot cells in unlock order
- [x] Export round-trips — a saved map reloads byte-identical
- [x] The dev save endpoint exists only in `configureServer`, never in a build,
      and `apps/server` is untouched
- [x] Terrain roles verified against the real PNG, not guessed

**Notes for whoever picks up T-1.10:** the spring tileset is five stacked 4×4
blocks with an identical layout each — nine-slice around the border (NW 0, N 2,
NE 3, W 4, E 11, SW 12, S 13, SE 15), fill at 9, and two inner-corner tiles at 5
and 10 covering opposite diagonals. Locals 1, 6, 7, 8 and 14 are blank in every
block. Blocks are: 0 grass, 1 grass border overlay (transparent centre), 2
textured dirt, 3 plain tilled soil, 4 grass cliff with a rock face.

**Not now:** rendering the map in the game — that is T-1.10.

### T-0.10 — Real Terms of Service and Privacy Policy
Depends: — · Size: M
Files: `apps/client/terms.html`, `apps/client/privacy.html`

**Do:** Both pages exist and are routed, but their contents are **drafts that
have not been legally reviewed** and each says so in a red banner. The RMT
clause (§6) and a description of what the code actually stores are written; the
rest is not.

**This blocks public launch.** Shipping a page headed "Terms of Service" that
nobody qualified has read is worse than having no page.

**Done:**
- [ ] A lawyer has reviewed both, or they have been replaced with reviewed text
- [ ] Terms covers: acceptable use, termination, limitation of liability,
      governing law, dispute resolution, amendment, contact
- [ ] Privacy covers: legal basis, retention periods, export and deletion
      requests, sub-processors (Stripe at minimum), international transfers,
      and a privacy contact address
- [ ] The RMT clause survives review intact and unambiguous
- [ ] The draft banners are removed only once the above is true
- [ ] `noindex` removed from both pages

---

# Phase 1 — Auth and the first crop

Goal: register, log in, plant one seed, come back later, harvest it.

### T-1.01 — First migration  ✅ **DONE**
Depends: — · Size: M
Files: `apps/server/drizzle/`, `apps/server/src/db/schema.ts`

**Do:** Generate and apply the initial migration from the existing schema.
Verify it runs against a clean database from `docker compose up`.

**Done:**
- [x] `pnpm db:generate` produces a migration; `pnpm db:migrate` applies it
- [x] Applying it twice is a no-op
- [x] `/api/health` reports `db: true`
- [x] The reserved-but-unused columns (`watered_at`, `withered_at`, trade gold)
      are present and nullable, per the open decisions above

### T-1.02 — Password hashing  ✅ **DONE**
Depends: — · Size: S
Files: `apps/server/src/modules/auth/password.ts`, `password.test.ts`

**Do:** `hash(plain)` and `verify(hash, plain)` over argon2**id**. No other
module imports argon2 directly.

**Done:**
- [x] Round-trips correctly; a wrong password returns false
- [x] A malformed or empty stored hash returns false instead of throwing
- [x] Hashes are salted — the same input twice produces different output
- [x] No plaintext password is ever logged, including on the error path

### T-1.03 — Session tokens  ✅ **DONE**
Depends: T-1.01 · Size: M
Files: `apps/server/src/modules/auth/session.ts`, `session.test.ts`

**Do:** Create, look up, and revoke sessions. The token goes to the client in an
**httpOnly, secure, sameSite** cookie named `th_session`; the database stores a
**hash** of it, so a leaked database dump is not a pile of live sessions.

**Done:**
- [x] Token is ≥ 32 bytes from `crypto.randomBytes`, never `Math.random`
- [x] The raw token appears only in the cookie, never in a table or a log
- [x] Expired and revoked sessions fail lookup
- [x] Revoke is idempotent
- [x] Cookie flags follow `COOKIE_SECURE`

### T-1.04 — Auth middleware  ✅ **DONE**
Depends: T-1.03 · Size: S
Files: `apps/server/src/middleware/auth.ts`

**Do:** A preHandler that resolves the cookie to a player and attaches it to the
request, plus a `requireAuth` that throws `UNAUTHENTICATED` when it cannot.

**Done:**
- [x] Missing, malformed, expired, and revoked cookies all give
      `UNAUTHENTICATED` — and are indistinguishable to the caller
- [x] The resolved player is typed on `FastifyRequest` via module augmentation
- [x] `flaggedAt` accounts resolve but are marked, not silently allowed

### T-1.05 — Register endpoint  ✅ **DONE**
Depends: T-1.02, T-1.04 · Size: M
Files: `apps/server/src/modules/auth/routes.ts`, `service.ts`, `service.test.ts`, `apps/client/src/pages/register.ts`

**Do:** `POST /api/auth/register`. In **one transaction**: create the player
with `STARTING_GOLD`, create their farm, and create `STARTING_PLOTS` unlocked
plots plus the locked remainder. Then open a session. Wire up the client — the
`onSubmit` stub in `register.ts` marks the spot.

**Done:**
- [x] Body parsed with `registerSchema`
- [x] Username and email uniqueness are **case-insensitive**
- [x] Duplicate registration returns `EMAIL_TAKEN` / `USERNAME_TAKEN`
- [x] Player, farm and plots are created atomically — a failure part-way leaves
      no orphan player
- [x] Rate limited per IP (registration is the cheapest thing for a bot to spam)
- [x] Response never contains the password hash
- [x] Client redirects to `/play` on success and shows the code-mapped message
      on failure

### T-1.06 — Login and logout  ✅ **DONE**
Depends: T-1.05 · Size: S
Files: `apps/server/src/modules/auth/routes.ts`, `apps/client/src/pages/login.ts`

**Do:** `POST /api/auth/login` (accepting email **or** username) and
`POST /api/auth/logout`.

**Done:**
- [x] Wrong password and unknown account both return `INVALID_CREDENTIALS`,
      with **no observable timing or message difference** — otherwise the
      endpoint is an account-enumeration oracle
- [x] Rate limited per IP *and* per identifier
- [x] Logout revokes server-side and clears the cookie; calling it twice is fine
- [x] Failed logins are written to `security_log`

### T-1.07 — Growth calculation  ✅ **DONE**
Depends: — · Size: S
Files: `apps/server/src/modules/farm/growth.ts`, `growth.test.ts`

**Do:** Pure functions over a plot: `stageAt(plot, now, durationPercent)` →
index into `stageFrames`, and `isRipe(plot, now, durationPercent)`. No database
access, no `Date.now()` inside — `now` is a parameter.

**Done:**
- [x] Tests cover: t=0, mid-stage, the exact boundary between two stages,
      long past ripe, an empty plot, and the VIP multiplier applied
- [x] Never returns an index outside `stageFrames` — including for potato,
      which has 7 stages where every other crop has 6
- [x] Integer millisecond arithmetic only
- [x] Uses the `growthDurationMs` **snapshotted on the plot**, not the current
      config value, so retuning a crop never changes one already in the ground

**Not now:** watering. Blocked on **D-1**.

### T-1.08 — Farm state endpoint  ✅ **DONE**
Depends: T-1.04, T-1.07 · Size: M
Files: `apps/server/src/modules/farm/routes.ts`, `service.ts`

**Do:** `GET /api/farm` returns the `FarmState` shape from
`packages/shared/src/types`, computing every plot's stage on read. This will be
the hottest path in the game — one query for plots, one for animals, no N+1.

**Done:**
- [x] Returns only the caller's own farm
- [x] `serverNow` included so the client can measure its clock offset
- [x] Nothing exploitable is exposed: no other players' data, no RNG seeds, no
      internal multipliers (§4.1)
- [x] Query count is constant regardless of plot count

### T-1.09 — Plant and harvest  ✅ **DONE**
Depends: T-1.08 · Size: L
Files: `apps/server/src/modules/farm/service.ts`, `service.test.ts`, `apps/server/src/modules/inventory/service.ts`

**Do:** `POST /api/farm/plant` and `POST /api/farm/harvest`. Plant consumes a
seed and stamps `plantedAt` + `growthDurationMs`. Harvest grants produce and
clears the plot. Both in one transaction.

**Done:**
- [x] Planting into an occupied plot → `PLOT_OCCUPIED`
- [x] Planting into a locked plot → `PLOT_LOCKED`
- [x] Planting without the seed → `INSUFFICIENT_ITEMS`
- [x] Harvesting an empty plot → `PLOT_EMPTY`; an unripe one → `CROP_NOT_READY`
- [x] Harvesting into a full inventory → `INVENTORY_FULL` **and the crop stays
      in the plot**. Never silently destroy produce (§5.4)
- [x] Both endpoints honour the idempotency key: a replay returns the stored
      response and does not grant twice (§4.5)
- [x] A test proves two concurrent harvests of the same plot yield one payout

### T-1.10 — Farm map and rendering  ✅ **DONE**
Depends: T-0.12, T-1.08 · Size: L
Files: `apps/client/src/game/scenes/Farm.ts`, `apps/client/src/game/scenes/Preload.ts`,
`apps/client/public/tilemaps/farm.json`, `scripts/generate-plot-layout.mjs`,
`packages/shared/src/config/{tilesets,plots.generated}.ts`,
`apps/server/src/modules/farm/layout.ts`

**Do:** Author the starting farm in `apps/mapmaker` (`pnpm dev:mapmaker`), load
the exported JSON in Phaser, and render plots from `/api/farm`.

**How it turned out.** World space is now map space: everything is positioned in
the tilemap's own pixel coordinates and the camera does all scaling with an
integer zoom. Both landmines named in the old version of this task are gone —
`CELL = TILE_SIZE * PLOT_SCALE * 2` (which treated a plot as 2×2 tiles) and the
`min(plot.x)` re-centring (which discarded the field's absolute position).

Plots are drawn as **outlines, not filled squares**: the soil under them is
painted in the map, and an opaque rectangle would hide the art the map exists to
show. Fill is used only to dim locked plots. The countdown is one label on the
hovered plot rather than forty — a Text object is rasterised at its font size
and then magnified by the camera, so it is rendered at `fontSize × zoom` and
scaled back by `1 / zoom` to land crisp at 1:1.

**Plot positions come from the map.** `pnpm plots` reads the `plots` object
layer and generates `packages/shared/src/config/plots.generated.ts`;
`newFarmPlots()` walks that, and `MAX_PLOTS` is derived from its length. The
server still never reads the client's map file at runtime — it reads shared
config. Re-run `pnpm plots` after moving plots in the editor.

**Done:**
- [x] `Preload.ts` loads every entry in `TILEMAPS` and verifies each parsed
- [x] The map is authored in the editor and exported, not hand-placed in code (§9)
- [x] `CELL` and the `min()` recentring are gone; plots align with the tilemap
- [x] Map objects (trees, chests) render bottom-anchored and depth-sort by Y
- [x] Plot sprites match the stage the server reported
- [x] Locked plots are visibly distinct — dimmed rather than hidden
- [x] Camera zoom is an integer; no sprite is blurred or shimmering
- [x] Nothing is loaded by magic string — every key comes from the manifest

**Known gap, deliberately left:** the current map marks two plots (indices 18
and 19, at 17,6 and 18,6) on **grass** rather than soil. They are the last two
unlocks, so it is cosmetic and late — paint soil under them in the editor and
re-run `pnpm plots`. Nothing enforces "a plot stands on soil"; if that should be
a hard rule, the check belongs in `scripts/generate-plot-layout.mjs`.

### T-1.11 — Player character  ✅ **DONE**
Depends: T-1.10 · Size: M
Files: `apps/client/src/game/entities/{Player,movement,movement.test}.ts`,
`apps/client/src/game/depth.ts`, `apps/client/src/game/scenes/Farm.ts`,
`packages/shared/src/config/assets.ts`

**Do:** Idle and walk animations from the 3-facing sheets, with left as the
side frames flipped. Movement is cosmetic and gates nothing (§5.1).

**How it turned out.** WASD and the arrow keys, both. The movement maths is a
pure `step(state, input, deltaMs, bounds)` in `movement.ts` with no Phaser in
it, so the failure paths are unit-tested without a canvas — diagonals are
normalised, opposing keys cancel, and a delta is capped at `MAX_STEP_MS` so a
tab that was backgrounded for a minute does not teleport the character across
the farm on its first frame back. `apps/client` gained a `test` script for this;
it is picked up by the root `pnpm test` automatically.

**The sheet's row order is down, up, side** — not the down, side, up the
manifest originally claimed, and not what the row order looks like it should be.
Shipped that way it showed the player's back while walking sideways and a side
view while walking away. Row 1 is the back of the head; row 2 is the
three-quarter side view. `Facing` in `assets.ts` is the one place that mapping
is written down, and nothing indexes the rows positionally any more — a
`['down', 'side', 'up']` array indexed by facing is exactly how the two got
swapped. Only the side row is ever mirrored; the remembered sideways direction
must not flip the front and back frames.

**Which way the side row faces was then got wrong too**, in both directions,
before landing on: the art is drawn facing **right**, so left is the mirrored
one (`PLAYER_MIRROR_FACES_RIGHT = false`). Do not try to settle this by looking
at the PNG — the character is twelve pixels wide, and the hair mass, the eye and
the leading foot each suggest a different answer. Walk left in `/play` and see
whether it moonwalks. One constant, one file, one line to flip.

Two measured facts about the sheets are now in `assets.ts` as `PLAYER_ART`,
because both are invisible until they look wrong: the **feet are at y = 26 of a
32px frame** (anchoring at the frame's bottom edge floats the character six
pixels above the ground and sorts its depth six pixels too low), and the **side
row is drawn one pixel right of centre**, so mirroring it for left-facing shifts
the art two pixels — a visible sideways nudge every time the player turns.
`PLAYER_FLIP_OFFSET` cancels it and is derived from the measurements rather than
typed in.

`DEPTH` moved out of `Farm.ts` into `game/depth.ts` now that entities need it
too. The player sorts by its feet, exactly like map objects, so it walks behind
a tree above it and in front of one below.

The camera does **not** follow the player: the whole farm fits on screen at an
integer zoom, so following would only fight `fitCamera()`.

**Done:**
- [x] Idle and walk play in all four directions
- [x] No action anywhere requires the character to be standing near anything
- [x] Movement is not sent to the server

**Notes:** the spawn is derived from `PLOT_POSITIONS` — one row below the
deepest plot, in the first plot's column — so re-authoring the field and
re-running `pnpm plots` moves the spawn with it instead of stranding it in the
soil. Keyboard capture is deliberately **off** (`addKey(code, false)`), and
input is ignored while a DOM element has focus: the HUD is real elements over
the canvas, and typing a quantity into the shop must not also walk the
character.

### T-1.12 — Client reconciliation  ✅ **DONE**
Depends: T-1.09 · Size: M
Files: `apps/client/src/game/{plots,plots.test}.ts`,
`apps/client/src/game/scenes/Farm.ts`, `apps/client/src/net/farm.ts`

**Do:** Optimistically render plant and harvest, then reconcile against the
authoritative response and **roll back on mismatch** (§4.1). Interpolate growth
locally between polls using the server's timestamps and the measured offset.

**How it turned out.** A click now takes a snapshot of the tile, draws the
expected outcome immediately, and then does one of three things: on success it
replaces the guess with the server's own timings (which may differ — the VIP
multiplier is not exposed to the client, so the prediction uses the config
duration and is always corrected); on rejection it restores the snapshot and
shows the code-mapped message; and either way a full `GET /api/farm` follows,
which is the real reconcile.

The prediction decides **pixels, never items**. No optimistic path grants
produce, moves gold, or touches a bag slot — the bag deliberately does not
change until the response lands. A harvest is only predicted when the local view
already believes the plot is ripe, since predicting one the server is certain to
refuse would just flash the plot empty and put the crop straight back.

Two things had to change underneath. `readyInMs` is only meaningful relative to
the `serverNow` of the response it arrived in, and an optimistic view invented
between two polls has a different reference point — so it is resolved once, at
the moment the view is set, into an absolute `readyAt` on the tile. And the
"hide the crop sprite" branch is now guarded on the sprite's own visibility
rather than on the `lastFrame` cache, which an optimistic update can reset while
the sprite is still on screen; the old guard would have left a harvested crop
drawn in an empty plot.

The rules themselves live in `game/plots.ts` as pure functions taking `now`, so
they are unit-tested without a canvas: that an optimistic plant can never render
ripe, that server timings override the prediction rather than merging with it,
that a prediction never mutates the view a rollback has to restore, and that
interpolation does not drift when the view it was handed is minutes stale.

**Done:**
- [x] Plant and harvest render optimistically before the server replies
- [x] A rejected intent leaves the view showing the truth, with the error code
      surfaced as a message
- [x] Local interpolation never lets a plot appear ripe before the server agrees
      — only the server can grant the item
- [x] One idempotency key per user action, reused across retries of that action
- [x] A clock skewed by minutes does not break rendering (offset is measured
      against `serverNow`, never assumed)

**Verified against the running game**, with plant and harvest responses
artificially delayed: the crop appears on the click and survives the wait; an
`INSUFFICIENT_ITEMS` rejection puts the plot back to empty; a harvest predicted
from a locally-ripe plot that the server refuses with `CROP_NOT_READY` restores
the crop.

### T-1.13 — Offline progression test  ✅ **DONE**
Depends: T-1.09 · Size: S
Files: `apps/server/src/modules/farm/offline.test.ts`

**Do:** Prove the whole point of the game. Plant at `t`, advance the clock past
the growth duration with no requests in between, and harvest.

**Done:**
- [x] A crop planted and left for its full duration is harvestable with no
      intervening request
- [x] Eight hours away yields exactly eight hours of growth
- [x] No scheduled job is required for any of it

---

# Phase 2 — The core loop

### T-2.01 — Inventory service  ✅ **DONE**
Depends: T-1.09 · Size: L
Files: `apps/server/src/modules/inventory/service.ts`, `service.test.ts`

**Do:** Slot-based add, remove, move, and stack, with capacity from base +
house tier + chest tier + VIP.

**How it turned out.** Add, remove, stack and capacity already existed — they
had to, for plant/harvest and the shop. What this task added is `moveItem` and
the test suite that pins all of it down.

`moveItem` has three outcomes decided by the destination: empty → the stack
moves; the same item → merge up to the stack limit with any remainder left
behind; a different item (or a destination stack already full) → the two slots
swap. **Nothing is ever destroyed and the total held is identical before and
after** — a "move" that ate the destination stack would be an item sink nothing
in `docs/economy.md` accounts for. Slot indices are validated against the
container's real capacity rather than trusted: an index is a client-supplied
number like any other, and one past the cap is storage the player has not bought.
The swap parks a row on slot −1 for an instant because
`(player, container, slot_index)` is unique; that is only ever observable inside
the transaction, and negative indices are unreachable from outside.

Deliberately **within one container only**. Bag-to-chest is T-3.01 and is a
different operation — two capacities to satisfy, not one.

**Done:**
- [x] Adding respects per-item `stackLimit` and spills into new slots
- [x] A partial add that would overflow fails whole — never partially applied
- [x] Removing more than held → `INSUFFICIENT_ITEMS`, nothing mutated
- [x] Capacity recomputes when a tier or VIP changes
- [x] Every mutation is transactional and callable from inside a larger one

**Notes:** 33 tests, most of them failure paths. Two assertions run through the
whole file — a failed operation writes *nothing*, and the total held never
changes across a failure. The composability test is the one that proves the `Tx`
parameter earns its keep: a caller that spends gold and then cannot fit the item
ends up having spent nothing, which is the harvest and shop paths in miniature.
An unknown tier falls back to tier 0 rather than reading as unlimited.

### T-2.02 — Inventory endpoints and UI  ✅ **DONE**
Depends: T-2.01 · Size: M
Files: `apps/server/src/modules/inventory/{routes,service,inventory.integration.test}.ts`,
`apps/client/src/game/inventoryPanel.ts`, `apps/client/src/net/inventory.ts`,
`apps/client/src/game/hud.ts`, `apps/client/src/styles/hud.css`

**Done:**
- [x] `GET /api/inventory` returns only the caller's own
- [x] Move/swap is validated server-side; the client cannot invent a slot index
- [x] Panel renders over the canvas, not inside it
- [x] `INVENTORY_FULL` renders as a clear message, not a silent failure

**How it turned out.** `GET /api/inventory` returns `{ slots, capacity }`, and
`POST /api/inventory/move` takes two slot indices — nothing else. There is no
player id in either payload, so there is nothing to substitute: the shape of the
endpoint is what stops one player reading or rearranging another's bag, rather
than a check someone could forget. The move response carries the whole container
back, so the client re-renders from the server's answer instead of replaying the
swap locally and hoping the two agree — which is also why a rejected move needs
no rollback.

`slotIndexSchema` caps the index at a sane 999, but that is **not** the real
bound: how many slots a player has depends on house tier, chest tier and VIP,
so the service re-checks against the true capacity before touching a row.

Capacity computation moved into the inventory module as `capacityForPlayer`.
Farm and shop each had their own copy of "read the farm tiers, add the VIP
bonus" — with the routes needing a third, that was three chances to drift.

`/api/farm/inventory` is **gone**, not deprecated: it returned the same rows
without the capacity, and two endpoints for one thing is how they diverge.

**Deviation from the file path above:** the panel is
`apps/client/src/game/inventoryPanel.ts`, next to `shopPanel.ts`, rather than a
new `src/ui/` directory. The task named `src/ui/InventoryPanel.ts`, but the
codebase already settled this layout, and one panel in a different place for no
reason is worse than a stale path in a roadmap.

**Notes:** the grid draws every slot the player owns including the empty ones —
the empties are what you drag into, and seeing them is how a capacity upgrade
looks like it did something. Two ways to rearrange, because they cost nearly the
same and cover different people: drag one slot onto another, or click to pick up
and click to place. The click path is what makes it work on a touchscreen and
from the keyboard, since every slot is a real `<button>`. Escape cancels a
pick-up before it closes the panel — otherwise there is no way to put something
back down. Two error codes are re-worded locally: from a move,
`INSUFFICIENT_ITEMS` means "that slot is empty" and `VALIDATION_FAILED` means
"you do not have a slot there yet", neither of which the shared map can say
without being wrong everywhere else.

**Verified in the running game:** click-to-move and drag-and-drop both round-trip
through the server and persist; a drop carrying a slot index the player does not
own is refused and renders "You do not have a slot there yet." with nothing
moved.

### T-2.03 — All four crops  ✅ **DONE**
Depends: T-1.09 · Size: S
Files: `packages/shared/src/config/{crops,config.test}.ts`,
`apps/client/src/game/plots.test.ts`,
`apps/server/src/modules/farm/farm.integration.test.ts`

**Do:** The config already has four. Verify each renders correctly end to end,
and confirm the crop **names** match the artwork — they were read off the sprite
sheet and one may be a different vegetable than labelled.

**Done:**
- [x] All four plant, grow through every stage, and harvest
- [x] Potato's 7th stage renders; no crop indexes past its own frames
- [x] Names match the art, or the config is corrected

**How it turned out.** No config was wrong, but nothing had actually *checked*
it. The names hold up: each row's produce icon in column 8 is unambiguous —
red berries with a calyx, long green blades with a pale root, a brown oval
tuber, a golden bulb with a green sprout. That is now written into `crops.ts`
so the next person does not re-litigate it from scratch.

**Potato's 7th stage is real**, and worth stating because the sheet has a
near-identical trap in it. Column 6 of row 2 is the only cell in column 6 drawn
at all, and the sprite heights across that row run 5, 5, 8, 9, 11, 12, 13 px —
still climbing. `Maple_Tree` frame 4 looks like a fifth stage the same way and
is a stump: its heights run 4, 12, 33, 46, **12**. Measure, do not assume.

Three gaps in coverage, all closed:
- The integration tests exercised potato and onion; strawberry and leek were
  never planted through the API at all. A crop with a typo in its seed item id
  passes every other test in the suite and fails the first time a player picks
  it. Now every crop is walked plant → every stage → harvest through the real
  endpoints.
- `plots.test.ts` only ever rendered leek, so the client's stage interpolation
  had never seen a 7-stage crop. It now walks all four.
- `config.test.ts` checked stage frames were "inside the sheet", which is too
  weak: the columns have meanings (0–6 stages, 7 seed packet, 8 produce), so a
  stage list one column long is still a valid frame index and would render a
  seed packet growing out of the soil. Frames are now pinned to their own row
  and their own columns, and the 7-vs-6 stage counts are asserted outright.

**Verified**: temporarily cutting potato to six stages fails both the config
test and the integration test, by name. And every frame the config points at was
drawn on screen through Phaser's own slicing of `spring-crops.png` — four rows,
each ending in its produce icon, potato visibly one longer than the rest.

### T-2.04 — Animal production calculation  ✅ **DONE**
Depends: — · Size: S
Files: `apps/server/src/modules/animals/{production,production.test}.ts`,
`apps/server/src/modules/farm/service.ts`, `packages/shared/src/config/vip.ts`

**Do:** Pure: is this animal mature, is it fed, and how many production cycles
are owed? `now` is a parameter.

**Done:**
- [x] Tests cover: immature, mature-but-unfed, mature-and-fed, exactly at the
      interval boundary, and many cycles owed after a long absence
- [x] An unfed animal accrues **nothing** — it does not bank cycles for later
- [x] VIP multiplier applied to the interval
- [x] Never returns a negative or fractional count

**How it turned out.** The productive window runs from the later of "last
collected" and "grew up" to the earlier of "now" and "fed until". Both ends earn
their keep: clipping the start at `maturesAt` stops a chick paying out for the
hours it spent as a chick, and clipping the end at `fedUntil` stops an unfed
animal accruing.

**"Does not bank cycles" needed more than that clip.** Bounding the window by
`fedUntil` is not enough on its own, because *extending* `fedUntil` sweeps the
neglected days back inside it — an animal left a fortnight and then fed would
pay out for the fortnight. So `feedAt` re-bases `lastCollectedAt` to the moment
of feeding when reviving a lapsed animal, minus exactly the cycles already owed.
Nothing earned before the food ran out is lost; nothing is conjured for the gap.
Only the part-finished cycle that stopped advancing is discarded. Feeding a
still-fed animal leaves the production clock alone entirely and just extends the
cover, so topping up early is never punished.

`readyInMs` is deliberately not one subtraction. "Not ready" has three different
reasons, and an unfed animal's productive clock stopped in the past — subtracting
from it reports "ready now" for produce that is never coming. A baby reports the
wait to grow up plus a cycle; an unfed adult reports a full interval, matching
what feeding will actually give it.

**A latent duplication bug fixed on the way.** `applyDurationPercent(x, 0)`
returned 0, and both crops and animals *divide* by that result — an instantly
ripe crop, or an animal owing `Infinity` eggs. No configured percentage is 0
today, but "the only caller passes a safe value" is not something that function
can check, and the failure it prevents is item duplication. It now floors at
1ms, asserted across a range of percentages.

**Notes:** `GET /api/farm` now resolves animals through this same function
instead of the `hasProduce: false` placeholder it was carrying, so what the
client is shown and what a collect will actually hand over cannot disagree
(§4.4). The long-absence case is bounded by design: a day of chicken feed at 90
minutes a cycle is sixteen eggs and no more, however long the player stays
away — feeding is the sink that keeps animals a running cost rather than a
one-off purchase.

### T-2.05 — Animal purchase, collection, feeding  ✅ **DONE**
Depends: T-2.01, T-2.04 · Size: L
Files: `apps/server/src/modules/animals/{service,routes,animals.integration.test}.ts`,
`apps/server/src/modules/animals/production.ts`, `apps/server/src/modules/farm/tiers.ts`,
`apps/server/src/app.ts`

**Done:**
- [x] Buying checks gold **and** the animal cap, and is transactional
- [x] Collecting from an immature animal → `ANIMAL_NOT_MATURE`
- [x] Collecting with nothing ready → `NOTHING_TO_COLLECT`
- [x] Collection into a full inventory → `INVENTORY_FULL`, and
      `lastCollectedAt` is **not** advanced — the produce is still there
- [x] Feeding extends `fedUntil` from `max(now, fedUntil)`, so feeding early
      does not waste the remainder
- [x] No code path anywhere deletes an animal
- [x] All three endpoints are idempotent

**How it turned out.** Three endpoints under `/api/animals`, all idempotent and
rate limited. Every piece of timestamp arithmetic stayed in `production.ts` and
pure — `collectAt` joined `feedAt` there — so this service only locks rows,
checks ownership, moves gold and items, and writes back what the pure functions
worked out.

**The cap is enforced by the gold lock.** `lockPlayerGold` is taken first, in
the same order the shop takes it, which serialises a player's purchases against
each other; without that, two simultaneous buys would each read "five of six"
and both succeed. A test races two purchases at the boundary and asserts exactly
one lands.

Collecting distinguishes **`ANIMAL_UNFED` from `NOTHING_TO_COLLECT`**, because
the player can act on the difference — one needs feeding, the other needs time.
`lastCollectedAt` advances by exactly what was handed over rather than to `now`,
so collecting a little early does not throw away progress toward the next egg.

**A new animal arrives unfed.** It produces nothing until the player buys feed,
which keeps animals a running cost rather than a one-off purchase and avoids a
free-feed grant that `docs/economy.md` would have to account for. If onboarding
shows this reads as broken, a starting `fedUntil` is the kinder alternative —
a balance decision (T-6.01), not a mechanical one.

`farmTiers` moved into `modules/farm/tiers.ts`: inventory, animals and farm each
needed "read this player's farm id and tiers", and three copies of that select
is three chances for one to drift.

**Notes:** the "no code path deletes an animal" rule is asserted as a rule, not
as an absence of tests — the suite walks the source tree and fails on any
`delete(schema.animals)` outside the test helpers. Verified by planting one:
it fails.

**A comment corrected while verifying.** The full-bag test passes whether the
produce is added before or after the clock is advanced, because both writes are
on the same `tx` and the rollback is what actually protects the produce — the
ordering is only reading order. The code said "order matters"; it does not, and
now says what does. (Writing that update through `db` instead of `tx` deadlocks
against the row lock rather than corrupting anything — a second guard, but not
one to rely on.)

### T-2.06 — Animal rendering and maturation  ✅ **DONE**
Depends: T-2.05, T-1.10 · Size: M
Files: `apps/client/src/game/entities/Animal.ts`,
`apps/client/src/game/{animalSprites,pasture}.ts` (+ tests),
`apps/client/src/game/{scenes/Farm,shopPanel}.ts`, `apps/client/src/net/animals.ts`,
`packages/shared/src/config/assets.ts`

**Done:**
- [x] Chicks use the baby sheet and switch to the adult sheet at maturity
- [x] Variants are cosmetic only and never affect displayed output
- [x] "Ready to collect" and "unfed" are both visible at a glance

**How it turned out.** The two rules that matter live in `animalSprites.ts` as
pure functions — `sheetFor` and `badgeFor` — so they are provable without
standing up a Phaser scene. Maturing *is* `sheetFor` changing its answer.

**The two states use different channels, because both can be true at once.** An
animal that earned produce before its food ran out is hungry *and* has eggs
waiting. So: produce floats above the animal as the item itself (an egg over a
chicken needs no legend) and takes priority for the badge, while unfed
desaturates the sprite. A tint alone is easy to miss on a busy map; an icon
alone does not read as "unhappy".

**Animals have no position in the database**, and giving them one would mean a
coordinate to validate for no gameplay gain (§4.1). Placement is presentational:
`pasture.ts` assigns slots by the animal's index in the server's own ordering,
which is by `acquiredAt` and therefore stable — a cow does not wander the field
between polls. Fourteen slots, which covers the largest herd the game can reach
(base 6 + top house tier 4 + VIP 3), asserted by a test.

**Measured asset facts, recorded.** The animal sheets do **not** use the
player's row order: they lead with the side view (`ANIMAL_SIDE_ROW`), and every
animal is drawn from it since animals do not walk in the MVP. And row 2 of the
baby-chicken sheet is four **egg** frames, not a third growth stage — the same
trap as `Maple_Tree` frame 4, given away by sprites *smaller* than the row
above. It is named as `CHICK_EGG_ROW` rather than merely warned about.

**Scope I added deliberately, and why.** Nothing could buy an animal: the shop
sold items only, so this task's rendering would have had nothing to render. The
shop panel gained an **Animals** tab. It is small, but it is beyond the task as
written — flagged rather than slipped in.

**Notes:** clicking an animal does whatever it is asking for — collect if there
is produce, feed if it is hungry — which needs no legend because the animal
already shows which. Not optimistic, unlike planting: a collection's outcome is
an item count, and inventing item counts is what §4.1 forbids.

**A bug caught in the browser, not by a test:** the first version refused to
feed a baby ("still too young"), when feeding a chick is exactly what makes it
productive the moment it grows up. The server allowed it; the client was wrongly
gating. Now only a fed, mature, not-yet-ready animal declines the click.

**Verified end to end in the running game:** bought a chicken (gold 460 → 60),
which arrived as a greyed-out chick with a feed bag over it; fed it; aged it in
the database to watch the sheet swap to `chicken-red` at maturity and an egg
appear above it; collected three eggs into the bag and watched the badge clear.

### T-2.07 — NPC shop  ✅ **DONE**
Depends: T-2.01 · Size: M
Files: `apps/server/src/modules/shop/service.ts`, `routes.ts`, `service.test.ts`

**Do:** Buy and sell at the fixed prices in `items.ts`. Prices come from config
server-side; the client's copy is for display only (§4.4).

**Done:**
- [x] Buying with insufficient gold → `INSUFFICIENT_GOLD`, nothing mutated
- [x] Selling something not held → `INSUFFICIENT_ITEMS`
- [x] Items with a null price are not tradeable in that direction
- [x] Gold and item movement are in one transaction
- [x] A test asserts buy-then-sell **loses** gold — round-tripping must never be
      a faucet (the invariant is already asserted in `config.test.ts`)
- [x] Rate limited; idempotent

### T-2.08 — Shop UI  ✅ **DONE**
Depends: T-2.07 · Size: M
Files: `apps/client/src/ui/ShopPanel.ts`
**Done:**
- [x] Buy and sell tabs; quantity selector clamped to what is affordable/held
- [x] Gold updates from the server response, never computed locally
- [x] Every error code renders as a specific message

### T-2.09 — Farm level and progression  ✅ **DONE**
Depends: T-1.09 · Size: M
Files: `packages/shared/src/config/level.ts`,
`apps/server/src/modules/farm/{level,level.test}.ts`,
`apps/server/drizzle/0001_*.sql`, `0002_*.sql`, `apps/server/src/db/schema.ts`,
`apps/server/src/middleware/auth.ts`, `apps/server/src/modules/player/view.ts`

**Do:** Define what raises farm level — this is a prerequisite for trade
eligibility (level ≥ 5), so it must exist before Phase 4.

**Done:**
- [x] Level is derived from recorded activity, not a client-supplied number
- [x] The curve is in `packages/shared/src/config`, not inline
- [x] Level never decreases
- [x] Tests cover the boundary at level 5 specifically

**How it turned out.** **The level is not stored.** `players.farm_level` is
gone; `players.experience` replaced it, and the level is `levelForXp(experience)`
computed wherever it is needed — the same shape as a crop's stage being computed
from its planting timestamp rather than ticked into a column (§4.2).

That is not tidiness. Farm level gates trading, so a stored level would be a
second source of truth that could be *written to* — by a bug, a migration, or a
support script. Deriving it means the only way to raise a level is to have
earned the experience.

**Experience is bought with time, never with gold.** It is granted only for
harvesting a crop and collecting from an animal, both gated on real elapsed
time, and neither repeatable faster by spending. There is deliberately no XP for
buying, selling or upgrading: a gold-driven source would let one funded account
mint eligible alts on demand, which is precisely what the trade gate exists to
prevent. It is also granted at **harvest**, not at planting, so it cannot be
farmed by planting and immediately clearing.

The award is one point per five minutes of the wait that earned it, so every
crop is worth the same experience per hour (asserted to within 10%) and there is
no "levelling crop" to look up on a wiki. Animal collections pay per production
*cycle*, not per unit — a cow yielding three of something is not three times the
wait.

**The curve** is generated from an integer recurrence in `config/level.ts`
(80 XP for level 2, each step 30% larger) and frozen at load. Level 5 is 494 XP
≈ **7 hours** of ordinary play on the starting plots — asserted to be between 2
and 24 hours, so retuning it into "minutes" fails a test. The first six
thresholds are pinned exactly, because changing them silently changes how hard
scam accounts are to manufacture.

**Two migrations, not one.** `drizzle-kit` asks interactively whether a column
was renamed, and this environment has no TTY, so the change is split: 0001 adds
`experience`, 0002 drops `farm_level`. Both are unambiguous and generate without
a prompt.

**Notes:** `grantXp` writes `experience + n` in SQL rather than
read-modify-write, so two harvests landing together cannot lose one — a player
quietly failing to reach trade eligibility is a bug nobody would report
clearly. It refuses a negative or fractional amount outright.

**Not done, deliberately:** nothing shows the player their level or progress
yet. The task has no UI criterion and I did not want to widen it twice in a row;
`SelfPlayer.farmLevel` is already on the wire, so the HUD needs one line
whenever a task claims it. T-4.11 (trade UI) has to explain eligibility anyway.

### T-2.10 — Economy ledger  ✅ **DONE**
Depends: T-2.07 · Size: S
Files: `docs/economy.md`, `apps/server/src/docs.test.ts`

**Do:** One table of every gold faucet and every sink, with amounts, cross-
checked against `config/`. §5.6: an idle economy dies from unlogged faucets.

**Done:**
- [x] Every source and sink in the codebase appears, with its config constant
- [x] Estimated gold-per-hour for a new player and a mature player
- [x] A note that this file must be updated whenever a price changes

**How it turned out.** The ledger is now **enforced by a test**, not by good
intentions. `docs.test.ts` scans the server source for anything that *writes*
`players.gold` — as opposed to the many places that merely read it — and fails
the build if a file moves gold without being named in the document. It also
pins every shop price, every animal price and the upgrade-track totals, so
retuning a number without updating the ledger fails CI rather than being
discovered once the economy is already inflating. Verified by planting an
undocumented faucet and a changed price: both fail, with a message that says
what to do.

Every figure is **modelled from config**, and the document says so in its own
words — there is no play data yet, and a reader who mistakes a model for a
measurement will tune against fiction. T-6.01 replaces them.

**Two balance findings, recorded rather than quietly fixed:**

1. **The cow is strictly dominated by the chicken.** It costs 5× more and earns
   *less*: 30.0 g/h against 39.4, payback 66.7h against 10.2h, and at one visit
   a day 720g against 945g. Even per animal-cap slot — the actually scarce
   resource — the chicken wins. Its only distinguishing feature is 190g per
   collection versus 60g, which is no advantage when one daily visit collects a
   whole feed window either way. **There is currently no reason to ever buy a
   cow**, which makes the milk half of the game dead content. Milk at ~300g
   would level them per hour while keeping the cow the low-attention option —
   but that is a balance call for T-6.01, not an edit to sneak in here.

2. **Animals dwarf plots as an investment**, by 84× per gold. Six chickens
   (2,400g) return ~236 g/h; all fourteen purchasable plots (253,750g) return
   ~298 g/h. The animal cap is the only thing stopping animals being the whole
   game, which may be exactly what a cap is for — but it means plot expansion is
   a prestige sink rather than an economic choice. Worth confirming that is the
   intent when T-3.03 wires plot buying up.

**Notes:** the ledger marks which sinks are actually **wired** — plot, chest and
house upgrades have prices in config but no endpoint until Phase 3, and a table
that does not distinguish those two states reads as a promise the game does not
keep.

### T-2.11 — Load test the farm endpoint  ✅ **DONE**
Depends: T-1.08 · Size: M
Files: `apps/server/test/load/farm.ts`,
`apps/server/src/modules/farm/farm.queries.test.ts`,
`apps/server/src/db/client.ts`, `apps/server/src/app.ts`
**Done:**
- [x] p95 latency measured against a realistic farm (40 plots, 10 animals)
- [x] Query count confirmed constant as plot count grows
- [x] Results and the hardware they came from recorded in the file

**How it turned out.** Two pieces, because the two criteria want different
things. Latency is a **script** (`pnpm --filter @tillhaven/server load:farm`):
it depends on the machine, and a latency threshold in CI is either so loose it
proves nothing or so tight it fails on a busy laptop. Query count is a **test**,
because it is machine-independent and it is the thing that actually rots.

**Query count is now asserted, not eyeballed.** `db/client.ts` gained an
optional per-query observer and a `countQueries()` helper, and the test walks
the farm from 6 plots to 80 and from 0 animals to 30, asserting the count never
moves. `GET /api/farm` needs exactly **five** queries — session, player, farm,
plots, animals — and that five is pinned. Verified by planting an N+1: the test
fails with *"34 plots issued 39 queries, baseline was 25 — something is querying
per plot"*.

**Measured, at 40 plots and 10 animals:**

| | sequential | concurrency 50 |
|---|---|---|
| p50 | 1.50 – 1.64 ms | 31.7 – 35.2 ms |
| p95 | **1.89 – 2.00 ms** | 45.4 – 47.2 ms |
| p99 | 2.85 – 3.90 ms | 51.9 – 53.7 ms |
| throughput | 577 – 628 req/s | 1156 – 1273 req/s |

Ranges across two runs, so the noise is visible. Hardware is recorded in the
file. **The concurrency figure is queueing, not work**: the pool is 10
connections, so fifty simultaneous requests leave forty waiting — throughput
roughly doubles while latency grows twenty-fold, which is the signature of a
saturated pool and the first thing to raise if a real deployment sees p95 climb.

**Two things the harness needed, both worth keeping.** The rate limiter
correctly refused a load test (120/min on this route), so `buildApp` now takes
`{ rateLimit: false }` — **ignored in production**, because a flag that could
disable rate limiting on a live server is a worse problem than the one it
solves. And the harness runs with `NODE_ENV=test` so request logging does not
drown the output and skew the timings.

**Note on the brief:** 40 plots and 10 animals is larger than the game can
currently produce — the map authorises 20 plots and the base animal cap is 6.
The harness inserts the rows directly, which is the point: it measures a farm
bigger than any real one so the numbers are a ceiling.

**A correction worth recording:** I wrote placeholder results into the file's
header before running anything, and they were invented. They are replaced with
the two real runs above. Numbers in a file that says RESULTS have to have been
measured.

### T-2.12 — Watering — **BLOCKED on D-1**
Do not start until watering is decided. `wateredAt` is already on the plot.

### T-2.13 — Withering — **BLOCKED on D-2**
Do not start until withering is decided. `witheredAt` is already on the plot.
If it ships, it is the first thing in the game that needs a scheduled job (§4.2)
— keep that job minimal.

---

# Phase 3 — Progression

### T-3.01 — Chest storage  ✅ **DONE**
Depends: T-2.01 · Size: M
Files: `apps/server/src/modules/inventory/{chest,chest.integration.test,routes}.ts`,
`apps/client/src/game/{chestPanel,slotGrid}.ts`, `apps/client/src/net/inventory.ts`,
`apps/client/src/game/hud.ts`, `apps/client/src/styles/hud.css`
**Done:**
- [x] Chest is a separate container with its own capacity
- [x] Transfers between bag and chest are transactional and cannot duplicate
- [x] A transfer into a full destination fails whole

**How it turned out.** `GET /api/inventory/chest` and `POST /api/inventory/transfer`.
The transfer is remove-then-add in one transaction, so if the destination cannot
take them `addItem` throws `INVENTORY_FULL` and the removal rolls back with it.
That is the property worth restating: a chest transfer is the **easiest place in
the game to build an accidental item sink**, because "took them out of the bag,
could not fit them in the chest" looks like success from the source side.

**The real work was the deadlock.** `removeItem` locks the container it takes
from and `addItem` locks the one it adds to, so a bag→chest transfer acquires
bag-then-chest while a simultaneous chest→bag transfer acquires chest-then-bag.
That is a textbook lock-order inversion, and it needs only one player with two
tabs. `lockBothContainers` takes every one of the player's inventory rows in a
**single statement** before either operation runs, which removes the ordering
question rather than answering it — there is no window between two acquisitions
because there are not two acquisitions.

**Verified by deleting it.** With the up-front lock removed, the
opposite-directions test fails with a 500 — Postgres detecting the deadlock and
killing one transaction. With it, sixteen simultaneous transfers in both
directions all resolve as game rules.

**Notes:** almost every test re-counts the total held across *both* containers
afterwards and expects it unchanged, including on every failure path. Ten racing
transfers against a bag holding exactly ten items move exactly what was there
and no more.

A click moves the **whole stack** — stashing a harvest is what the panel is for,
and a quantity prompt on every click would tax the common action to serve the
rare one. Splitting is already possible the other way round: rearrange within
the bag first. The two grids sit side by side so a transfer is one click between
two things you can both see.

`slotGrid.ts` now holds the shared *appearance* of a slot cell — only that. The
two panels interact differently (the bag rearranges itself by drag or
pick-up-and-place; the chest moves stacks across in one click), and sharing the
behaviour too would mean an options bag with a flag per difference, which is how
a helper ends up harder to read than the two copies it replaced. Both of the
bag's interaction paths were re-verified in the browser after the refactor.

**File path deviation**, same as T-2.02: the panel is
`apps/client/src/game/chestPanel.ts`, beside the other panels, not
`src/ui/ChestPanel.ts`.

### T-3.02 — Chest upgrades  ✅ **DONE**
Depends: T-3.01 · Size: S
Files: `apps/server/src/modules/inventory/{chest,routes}.ts`,
`packages/shared/src/{errors,schemas/index}.ts`,
`apps/client/src/game/{chestPanel,slotGrid}.ts`, `docs/economy.md`
**Done:**
- [x] Costs come from `CHEST_TIERS`; tiers must be bought in order
- [x] Gold deduction and tier bump are one transaction
- [x] Capacity increases immediately; no stored item is ever orphaned

**How it turned out.** `POST /api/inventory/chest/upgrade`, and the payload
carries **no target tier** — only an idempotency key. "Upgrade" means the tier
after the one you have, so *buying out of order is not expressible on the wire*.
That is a stronger guarantee than validating it, and it is the same trick as the
rest of the API: make the wrong request unrepresentable rather than rejected
(§4.1). New error code `UPGRADE_MAX_TIER`, which T-3.04 will reuse.

**The interesting half was "no stored item is ever orphaned".** An upgrade can
only *grow* a chest, so it cannot orphan anything — the criterion looks free.
But capacity is `tier.slots + VIP bonus`, and **VIP expiry shrinks it**. A VIP
stores something in slot 40 of a 48-slot chest, their VIP lapses, capacity drops
to 24, and slot 40 is past the end. A client drawing exactly `capacity` cells
would show them an empty chest and a stack of missing produce.

The rule settled on: **capacity limits what you can put in, never what you can
see or take out.** `buildSlotCells` renders `capacity` cells *or* as many as it
takes to show every stored item, whichever is more, marking the overflow
distinctly. Server-side this already held — `removeItem` and the transfer work
by item, not by slot index — so the fix was making it visible.

Verified in the browser: an onion parked in slot 40 of a 24-slot chest renders
41 cells with 17 marked over-capacity, the stack is visible and labelled, and
clicking it moves it back to the bag.

**Notes:** the upgrade locks the player row first, in the same order as the shop
and the animal purchase, so three simultaneous upgrades buy one tier for one
price — asserted. The panel takes the next tier's cost from the **server's**
chest view rather than its own copy of `CHEST_TIERS`: same config, but only one
of the two is authoritative, and a panel quoting a stale price is a panel that
lies.

**The economy ledger caught this task.** `docs.test.ts` failed the moment
`chest.ts` started writing gold, because the file was not listed in
`docs/economy.md` — which is exactly what T-2.10 built it to do. Ledger updated:
the chest track is now the first **wired** upgrade sink, 52,000g of the eventual
335,750g.

### T-3.03 — Plot expansion  ✅ **DONE**
Depends: T-1.09 · Size: M
Files: `apps/server/src/modules/farm/{expansion,expansion.integration.test,routes}.ts`,
`packages/shared/src/errors.ts`, `apps/client/src/game/scenes/Farm.ts`,
`apps/client/src/net/{farm,errors}.ts`, `docs/economy.md`
**Done:**
- [x] Cost from `plotUnlockCost`; server recomputes it, never trusts the client
- [x] Cannot exceed `MAX_PLOTS` (plus the VIP bonus)
- [x] Unlocking an already-unlocked plot → error, and no gold is taken
- [x] Transactional and idempotent

**How it turned out.** `POST /api/farm/unlock` takes a plot id and nothing else;
`GET /api/farm/expansion` prices what is left. The price comes from the plot's
place in the **authored unlock order** — each map marker carries an `index`
property that `pnpm plots` bakes into `PLOT_POSITIONS` — so a plot id is enough
to determine what it costs. A test sends a `cost` field anyway and asserts the
server charges its own number. New codes `PLOT_ALREADY_UNLOCKED` and
`PLOT_CAP_REACHED`.

**Order is deliberately not enforced.** Buying the twentieth plot before the
seventh is allowed and costs what the twentieth costs — the price follows the
plot, so there is nothing to gain by it, and a rule with no purpose behind it is
a rule someone has to explain later.

**The VIP-bonus-plots problem, resolved by clamping — and the clamp is
load-bearing.** `VIP_BENEFITS.bonusPlotSlots` grants four plots on top of
`MAX_PLOTS`, but every plot must stand on soil someone painted and the map marks
exactly `MAX_PLOTS` cells. So `plotCapFor` caps at what the map authorises
rather than inventing a coordinate. Nothing is broken today — VIP is not
purchasable until Phase 5 — but **T-5.06 must author `bonusPlotSlots` more cells
in `apps/mapmaker` and re-run `pnpm plots`**, or the bonus it advertises does
nothing at all. There is a test that says exactly that, and it changes behaviour
the day the map grows.

I chose clamping over authoring the cells now because the alternative needs
`MAX_PLOTS` to stop being derived from the map — it is currently
`PLOT_POSITIONS.length`, which the economy ledger and `newFarmPlots` both lean
on — and re-cutting that constant is a bigger change than this task, made for a
benefit nobody can buy yet.

**Notes:** the player row is locked first, in the same order as every other
purchase, so three clicks on one plot buy it once — asserted. A locked plot now
shows `Clear · 49,000g` on hover and buys on click, with the price coming from
the server rather than from the client's copy of `plotUnlockCost`.

**The ledger is up to date:** plot expansion is wired, so **305,750g of the
eventual 335,750g of sinks is now live**; only the house track waits on T-3.04.

**A false alarm worth recording:** a probe reported "14 locked plots, 13 priced",
which looked like a plot the pricing had dropped. It was the probe — a captured
`locked.length` from before the purchase serialised next to a live
`plotPrices.size` read after it. A clean read agrees at 13/13/13 against the
server. Worth the ten minutes: the same symptom from a real cause would be a
plot nobody could ever buy.

### T-3.04 — House upgrades  ✅ **DONE**
Depends: T-3.02 · Size: M
Files: `apps/server/src/modules/farm/{house,upgrades,house.integration.test,routes}.ts`,
`apps/server/src/modules/inventory/chest.ts`,
`apps/client/src/game/entities/House.ts`, `apps/client/src/game/scenes/Farm.ts`,
`packages/shared/src/config/assets.ts`, `docs/economy.md`
**Done:**
- [x] Costs from `HOUSE_TIERS`, bought in order
- [x] Bonuses apply to inventory capacity and animal cap immediately
- [x] The house sprite changes tier visibly (the sheet has two buildings:
      x 4..75 and x 148..219)

**How it turned out.** `GET /api/farm/house` and `POST /api/farm/house/upgrade`,
the latter carrying no target tier — same shape as the chest, so buying out of
order stays unexpressible.

**The shared spine.** Chest and house upgrades had the same twenty lines
— lock gold, lock farm, pick the next tier, check the price, charge — so those
moved into `farm/upgrades.ts` and the chest was refactored onto them. Its thirty
tests passed unchanged, which is the only reason the refactor was worth doing
during this task. Deliberately **three small functions rather than one generic
`buyNextTier(track)`**: passing a Drizzle column and a tier table generically is
harder to read than the code it would save.

**"Immediately" is tested against the rules, not the reply.** A tier that raises
a number in its own response but not in the rule it governs is worse than no
tier — the player paid for a promise the game does not keep. So the inventory
bonus is checked against `GET /api/inventory`, and the animal cap by filling the
base cap, confirming the refusal, upgrading, and buying one more.

**The house is now on the map**, above the crop field and clear of both trees.
Each building is registered as a **custom texture frame** over its measured crop
window — a house spans many cells, so it cannot be a frame from the 16px grid
the rest of the sheet is sliced on. Position is client-side: the server has no
opinion about where a house is, and a coordinate it did not need would be one
more thing to validate.

**A two-pixel problem worth the comment it got.** The grass strip above the
field is exactly six tiles — 96px — and the upgraded building is 98px tall, so
its roof rendered over the out-of-map background, where it reads as a bug. The
base is nudged down instead, burying two pixels under an opaque wall at the
field's edge. Derived from the tallest building rather than written as `+ 2`, so
taller art never silently reintroduces the overhang.

**Recorded, not faked: tier 2 has no art of its own.** The sheet holds two
complete buildings and `HOUSE_TIERS` has three tiers, so tier 0 draws the plain
shell and tiers 1 and 2 both draw the built one — **the 25,000g tier-2 upgrade
buys capacity and no visible change.** The sheet's loose parts (spare windows,
doors, a chimney) are at a different scale from the buildings and do not
composite into a convincing third look. Either tier 2 needs art or `HOUSE_TIERS`
should stop at tier 1; noted in `docs/economy.md` for T-6.01 / T-6.07.

**Every priced sink in the game is now wired** — the full 335,750g. The ledger
guard caught `farm/upgrades.ts` the moment `chargeGold` moved there, so the
table now names it as the shared deduction point both tracks go through.

### T-3.05 — Interior scene  ✅ **DONE**
Depends: T-3.04 · Size: L
Files: `packages/shared/src/config/furniture.ts`,
`apps/server/src/modules/house/{service,routes,house.integration.test}.ts`,
`apps/server/drizzle/0003_*.sql`, `apps/client/src/game/scenes/Interior.ts`,
`apps/client/src/net/house.ts`, `apps/client/src/game/{hud,entities/House}.ts`
**Done:**
- [x] Entering and leaving the house preserves farm state
- [x] Furniture placement is validated server-side — position, overlap, and
      ownership all checked
- [x] Placement is transactional

**How it turned out.** A new `furniture_placements` table, four endpoints under
`/api/house`, and an `Interior` scene reached by clicking the doorway.

**The farm sleeps, it does not stop.** `scene.sleep`/`wake` keeps the Farm
scene's objects, its cached state and its measured clock offset alive, so
stepping inside and back out is a doorway rather than a page load. Proved by
tagging a live tile container before leaving and finding the **same object**
afterwards — not an equal one, the same one — along with the same scene
instance, plot count, animal and player position. Waking re-fetches once, which
is what makes the returning view authoritative again.

**Three rules the server owns.** The piece must exist, it must fit **inside the
room**, and it must not **overlap** anything already there; ownership is the
fourth and comes from the cookie. The subtle one has its own test: a top-left
corner can be inside the room while the piece is wide enough to hang out of it,
so checking the corner alone would let a rug half-vanish through the wall.
Overlap is rectangle intersection, not corner equality, for the same reason.

**Footprint is `ceil(sprite / 16)`** — derived, not judged per piece. A tall
piece therefore occupies the cell its back covers, which is honest about what
the sprite hides. `fitsInRoom` and `overlaps` live in shared config and the
client's drag ghost calls the **same functions**, so a green ghost cannot
promise a placement the server is about to refuse (§4.4).

**Two things the art does not have**, both drawn rather than pretended:

- `Interior.png` is furniture only — no floor or wall tiles anywhere in the pack
  — so the room is a drawn rectangle with a chequered floor and a wall band. It
  is trivially replaced the day interior tiles exist.
- The plain house has no door on it at all, so the doorway hit area is the
  bottom-centre of the building rather than the door art. A door that only
  worked once you had upgraded would be a puzzle, not a feature.

**Notes:** every piece is a **custom texture frame** over its measured crop
window, like the houses — the furniture does not line up with the sheet's 16px
grid. Indoors the seed picker is hidden, since planting into a field behind a
wall is a confusing failure rather than a useful one. Furniture *stock* is
T-3.06's job; this task places pieces, and nothing is purchasable yet.

**Verified live:** six pieces placed from the database render at their cells;
moving a chair onto the fireplace returns `PLOT_OCCUPIED` and moving it out of
the room returns `VALIDATION_FAILED`, with the chair still at 3,1 both times.

### T-3.06 — Decoration catalogue  ✅ **DONE**
Depends: T-3.05 · Size: M
Files: `packages/shared/src/config/furniture.ts`,
`apps/server/src/modules/house/{service,routes,house.integration.test}.ts`,
`apps/server/drizzle/0004_*.sql`, `apps/client/src/game/{hud,scenes/Interior}.ts`,
`apps/client/src/net/house.ts`, `docs/economy.md`
**Done:**
- [x] Decorations are purchasable with gold and stored per player
- [x] VIP-exclusive cosmetics are marked `tradeable: false` (§7)
- [x] No decoration grants any gameplay benefit

**How it turned out.** Fourteen pieces, 180g to 2,500g, bought through
`POST /api/house/buy` into a `furniture_owned` table. Storage is deliberately
**not** `inventory_items`: furniture has no stack limit, no sell price and no bag
slot, and forcing it through the slot system would mean a full bag could stop
you buying a rug.

**Placing and removing conserve furniture.** Placing takes one out of storage,
removing puts it back — so redecorating is free and a misplaced fireplace is not
2,500g gone, while a room still cannot be filled with pieces nobody bought. The
`where quantity > 0` in the decrement is what makes two simultaneous placements
of a single owned chair resolve to one; there is a test that races exactly that.

**§7, enforced rather than declared.** `tradeable` is *derived* from `vipOnly`
in the constructor rather than passed in, so a VIP exclusive cannot be marked
tradeable by forgetting an argument. Purchase requires live VIP, checked with
`isVip` — which already returns false for a flagged account, so a refund cannot
leave someone shopping the exclusive catalogue. That has its own test.

**"No gameplay benefit" is held two ways**, because it is exactly the rule that
is true when written and quietly false a year later:

1. The **definition cannot express a benefit** — a test pins the allowed field
   names, so adding `bonusStorage` to a wardrobe fails immediately.
2. The code that **computes** benefits cannot see furniture — a scan asserts
   that inventory capacity, the animal cap, production, growth, house tiers and
   levelling do not so much as reference the furniture config. A benefit it
   cannot see is a benefit it cannot grant.

**A message corrected during verification.** Buying a VIP piece without VIP
returned `FORBIDDEN`, which the shared map renders as "You cannot do that" —
true and useless. The player needs to know it is the star next to the name, not
something they did wrong. Reworded where the code path knows what `FORBIDDEN`
means there.

**Verified live:** the tray lists all fourteen with prices and ★ on the two
exclusives; buying a fireplace took 8,000g → 5,500g and turned its button into
"Place"; placing it emptied storage and restored the price; the curtains were
refused to a free account with gold untouched, then bought and placed once VIP
was active.

**Ledger updated:** furniture is the **only unbounded sink** in the game —
everything else caps, but nobody stops you buying a tenth rug. That makes
furniture prices the lever deciding whether late-game gold inflates, and they
are currently set by feel. Recorded as a fourth finding for T-6.01.

---

# Phase 4 — Trading

The highest-risk system in the project (§6). Build it defensively; every task
here is smaller than it looks because the failure modes matter more than the
happy path.

### T-4.01 — Trade eligibility  ✅ **DONE**
Depends: T-2.09 · Size: S
Files: `apps/server/src/modules/trade/{eligibility,eligibility.test}.ts`,
`apps/server/src/modules/player/view.ts`
**Do:** Pure check: account age ≥ `TRADE_MIN_ACCOUNT_AGE_MS` **and** farm level
≥ `TRADE_MIN_FARM_LEVEL`, and not flagged.
**Done:**
- [x] Tests cover both boundaries exactly, and a flagged account
- [x] Checked for **both** parties, at invite **and** again at execution
      — see the caveat below

**How it turned out.** `tradeEligibility` returns *why* a player is blocked, not
just whether: "come back tomorrow" and "grow four more levels" are different
problems, and a UI that can only say "you cannot trade" turns a temporary rule
into a mystery. Flagged is checked **first**, so a refunded account is told it
is flagged rather than sent off to farm for a level it will never be allowed to
use.

**Both boundaries are tested to the unit** — one millisecond either side of the
24 hours, one experience point either side of level 5. Verified by breaking
each: an off-by-one in the level comparison fails the exact-boundary test by
name.

**`assertBothCanTrade` deliberately does not say why the partner failed.** A
stranger's account age and farm level are not the caller's business, and leaking
them would turn a trade invite into a way to probe accounts. The caller's own
reason is safe to tell them; the partner's is `{ blockedBy: 'partner' }` and
nothing else. Also verified by breaking it — leaking the partner's reason fails
the privacy test.

`canTrade` had a **second implementation** in `player/view.ts` feeding the
display flag. That now delegates here: two implementations of one rule
eventually disagree, and the one that disagreed quietly would have been the
display.

**The caveat on the second checkbox.** The invite and execution paths are T-4.02
and T-4.05 and **do not exist yet**, so nothing calls the assertions today. What
does exist is a **forward guard**: a test scans `modules/trade/` for anything
defining an invite/accept/execute function and fails if it does not reference
the eligibility assertions. It passes vacuously now and starts biting the moment
a lifecycle appears without the check — verified by dropping in a `service.ts`
with an unguarded `invite`, which fails with the file named. That is worth more
than a note in a file nobody rereads: this rule is easiest to forget precisely
when the interesting work is the state machine around it.

**Notes:** a test asserts the gate cannot be cleared by money (a day-old account
with ten million experience is still refused), nor by patience alone (a
month-old account at level 1 is still refused). Both, or neither — which is the
whole point of the rule.

### T-4.02 — Trade session lifecycle  ✅ **DONE**
Depends: T-4.01 · Size: M
Files: `apps/server/src/modules/trade/{lifecycle,service,routes,trade.integration.test}.ts`,
`packages/shared/src/config/economy.ts`, `packages/shared/src/errors.ts`
**Done:**
- [x] Invite, accept, cancel, expire
- [x] Trading with yourself → `TRADE_SELF`
- [x] A player can be in at most one open trade at a time
- [x] Expiry is enforced on read, not only by a job

**How it turned out.** Five endpoints under `/api/trade`. The lifecycle owns
*whether a conversation exists*; what is in the offer and whether it executes
are T-4.03 to T-4.05, kept apart because the failure modes differ — a lifecycle
bug strands people, an execution bug duplicates items.

**Expiry is derived, never ticked.** `effectiveStatus` reads a stored `pending`
past its deadline as `expired`, so a trade dies the instant anyone looks at it.
A sweeper that runs every minute would leave a window where an abandoned trade
is still executable, and "it completed after I walked away" is the one complaint
a trading system cannot afford. A test asserts the *stored* column is still
`pending` while the endpoint reports `expired` — proof nothing wrote it.

Two deadlines, because they are different waits: an invite gets **2 minutes**
(it is an interruption on someone else's screen, and it blocks both parties from
trading with anyone else), an accepted session gets **10 minutes**, and the clock
restarts on accept.

**Cancelling always works and is never idempotency-keyed.** Walking away must
not fail, and a replayed key returning a stored response is precisely the wrong
behaviour for "get me out of this". Cancelling a trade that is already over
returns its state rather than an error — that is what a player does when they
are unsure, not a mistake to report at them.

Eligibility is re-checked **at accept**, not only at invite: an invite can sit
for two minutes and a chargeback can land in that time. Tested by flagging the
initiator between the two.

**Three attempts at one test, and the first two were worthless.** The
"one trade at a time" rule rests on a lock, and proving it took work:

1. One client firing two invites through `app.inject` — passed with the lock
   removed. The harness serialises those requests; the race never happened.
2. Two clients inviting the same third player — also passed with the lock
   removed, for the same reason.
3. Holding a `FOR UPDATE` on the target and asserting the invite blocks — passed
   with the lock removed too, because the foreign key from `trades.recipient_id`
   already takes a key-share lock on that row. It proved *a* lock existed, not
   mine.

What finally works is driving two overlapping `db.transaction` calls at the
service directly: under MVCC the second cannot see the first's uncommitted
insert, so without a lock both commit and one player ends up in two trades.
**With the lock removed that test fails**, which is the only reason to believe
the other thirty.

**The forward guard from T-4.01 caught a real gap in itself.** It tested for the
*names* `assertCanTrade`/`assertBothCanTrade` appearing in a file — which the
import line satisfies. A service that imported them and never called them passed
happily. It now matches a call, and fails as intended.

### T-4.03 — Offer mutation and the revision counter  ✅ **DONE**
Depends: T-4.02 · Size: M
Files: `apps/server/src/modules/trade/{offer,service,routes,trade.integration.test}.ts`
**Do:** Setting an offer bumps `revision` and **resets both confirmations**.
**Done:**
- [x] Any change to either side's offer clears both confirmed flags
- [x] `revision` increases monotonically and never reuses a value
- [x] A player can only modify their own side
- [x] Offering an item you do not hold is rejected at set time — the re-check at
      execution is T-4.05, see below

**How it turned out.** `POST /api/trade/offer` replaces the caller's side. Which
side that is comes from the **session**: there is no field for it in the
payload, so there is nothing to tamper with.

**Clearing both confirmations — including the editor's own — is the point.** The
classic trade scam is to confirm, wait for the other party to confirm, then swap
the gold bar for a pebble and let them complete out of habit. Clearing only the
*other* side leaves exactly that hole open, because the scammer's own
confirmation survives their edit. Verified by making that precise change: three
tests fail.

Every edit bumps `revision`, including one that sets the offer to what it
already was and one that empties it. "Nothing really changed" is not a judgement
the server should be making on a scam surface — if the offer was written, the
confirmations are stale. Verified by removing the bump: four tests fail.

**Duplicates are refused, not summed.** Two entries for one item is a client
bug, and quietly adding them means the offer a player confirms is not the offer
they were shown — the exact confusion this system exists to prevent.

**Gold is refused outright, never silently dropped** (D-3 is undecided). A
player who offered gold and watched it vanish from the window would have every
reason to cry scam, so `GOLD_IS_TRADEABLE = false` produces an error rather than
a filter. The columns still exist, so flipping the decision needs no migration.

**Items are offered from the bag, not the chest.** "Bring what you want to
trade" is a rule players already understand, and it keeps the execution lock to
one container per player — which T-4.05 will be glad of.

**On the fourth checkbox.** Holdings are checked at set time here; the re-check
at execution belongs to T-4.05, which does not exist yet. The set-time check is
only a courtesy that stops a player building an offer they cannot honour — items
can leave a bag in the minutes before execution, so the check that matters is
still to come. T-4.05 must add a holdings guard equivalent to the eligibility
one from T-4.01.

### T-4.04 — Dual confirmation  ✅ **DONE**
Depends: T-4.03 · Size: M
Files: `apps/server/src/modules/trade/{service,routes,trade.integration.test}.ts`
**Done:**
- [x] Confirming carries a revision; a stale one → `TRADE_OFFER_CHANGED`
- [x] Confirming twice → `TRADE_ALREADY_CONFIRMED`
- [x] Execution only when both are confirmed **at the same revision**

**How it turned out.** `POST /api/trade/confirm` takes the revision the player
was shown, and it is **required**. A confirmation is agreement to a *specific
offer*; one that meant "whatever is there now" would be the scam this endpoint
exists to prevent.

**"At the same revision" is unreachable rather than merely checked.** Every
offer edit clears both flags in the same statement that bumps the revision, so
two standing confirmations cannot straddle an edit. `bothConfirmed` is therefore
enough for T-4.05 to act on — there is no extra comparison to forget.

**A hole this task had to close first.** `setOffer` read the trade row without
locking it, so a confirmation and an edit could interleave: the confirm reads
revision N, the edit bumps to N+1 and clears both flags, and then the confirm
writes its flag back — leaving a confirmation standing against an offer nobody
agreed to. That is the scam arriving through the back door, and it was live in
T-4.03's code. Both paths now take `FOR UPDATE` on the trade row, and the
confirming UPDATE is *additionally* guarded on `revision = ?`, so even a
lock-free path could not apply it to an offer that moved underneath.

Verified by breaking each half separately: removing the lock and the guard fails
the interleaving test; accepting any revision fails four tests including the
end-to-end scam.

**The scam is tested end to end.** Bob confirms nine leeks, Alice swaps them for
one, and Bob's agreement is gone: his old revision is refused, and only the offer
he can now actually see is acceptable. That test is the reason the rest of this
subsystem exists.

**Notes:** confirming is idempotency-keyed, so a double-tapped button is not a
`TRADE_ALREADY_CONFIRMED` in the player's face — the replay returns the stored
response. A genuine second confirmation, with a fresh key, is still refused.

### T-4.05 — Atomic execution  ✅ **DONE**
Depends: T-4.04 · Size: L
Files: `apps/server/src/modules/trade/{service,routes,execution.integration.test}.ts`,
`apps/server/src/modules/inventory/service.ts`, `apps/server/src/db/client.ts`,
`packages/shared/src/{errors,schemas/index}.ts`
**Do:** The whole swap in one transaction with **row-level locks** on both
players' inventories, taken in a **consistent order** (e.g. sorted by player id)
so two simultaneous trades cannot deadlock.
**Done:**
- [x] Both inventories are `SELECT ... FOR UPDATE`-locked before any write
- [x] Locks are acquired in a deterministic order
- [x] Ownership of every offered item is **re-verified at execution time**, not
      taken from the state captured when the window opened
- [x] Either everything moves or nothing does
- [x] A full destination inventory fails the trade cleanly, nothing moved
- [x] The trade is marked completed inside the same transaction

**How it turned out.** `POST /api/trade/execute` is its own endpoint, not
folded into `confirm` — either party may call it once both are confirmed, and
it needs no `revision` in its schema: unlike `confirm`, which agrees to a
*specific* offer, execute just carries out whatever the trade row already
says both parties agreed to. There is nothing left to compare against.

**Three lock levels, one consistent order.** `execute` takes locks narrowest
scope first, each already using patterns earlier tasks established:
1. The **trade row itself** (`lockOwnTrade`, from T-4.01) — also re-confirms
   the caller is actually a party to it.
2. Both **player rows**, sorted by id (`lockPlayers`, the same helper and
   order `invite`/`accept` already use).
3. Both **inventory rows**, sorted by id — a new `lockContainer` export from
   `inventory/service.ts`, a thin wrapper around the private
   `loadSlotsForUpdate` that `addItem`/`removeItem` already used internally.
   Trade is the first caller that needs the lock held *before* its own
   writes, rather than as a side effect of one.

Sorting by id rather than by initiator/recipient role is what prevents
deadlock: two concurrent trades between the same pair, invited in opposite
directions, would otherwise each acquire the two locks in opposite order and
wait on each other forever. This matters today even though "one live trade
per player" means no two live trades currently share a player — a future
change that relaxed that rule must not silently reintroduce the deadlock, so
the order is enforced now rather than left as a TODO.

**Ownership is re-verified against reality, under the lock** — `countItem` on
every offered item, for both parties, checked against what `setOffer` wrote
at the time the offer was made only as a courtesy (T-4.03's note on this).
Minutes can pass between confirming and executing; items don't wait around.
Re-checking both parties, not just the caller, matters because either side
can call execute — the caller re-checking only their own holdings would leave
the *other* party's stale offer unguarded whenever the caller happens to be
the one who still has everything.

**Eligibility is re-checked a second time**, here at execution, on top of the
check T-4.01 already does at invite — `assertBothCanTrade` again, for both
parties. An account can be flagged for a chargeback in the minutes a trade
sits open between confirmation and either party getting around to executing.

**Remove-before-add, on both sides, in that order.** A straight swap between
two full bags — "my only sword for your only shield" — must not spuriously
fail `INVENTORY_FULL` because the capacity check ran before the outgoing item
freed its slot. `addItem` reads occupied slots fresh at call time, so running
every removal first is what makes that freed room visible before anything
tries to land in it. If anything past this point throws, the whole
transaction — including the removals already applied — rolls back; there is
no path that leaves an item removed from one bag without landing in the
other.

**Gold does not move.** `initiatorGold`/`recipientGold` are always 0 while
`GOLD_IS_TRADEABLE` is false (D-3, still open) — `offer.ts` already refuses to
store anything else — so there is nothing to move yet. T-4.09 adds it once
that decision lands. A test asserts both gold columns stay at zero across a
real execution as a tripwire against this silently changing.

**Domain-level idempotency, not just key-level.** `runIdempotent` (T-?) already
makes a *replayed* idempotency key return the stored response. `execute` adds
a second, independent layer on top: if the trade is already `COMPLETED` —
because the *other* party's execute call already ran, with a different key —
the second call returns that same completed trade as success rather than an
error. The outcome is the same trade either of them agreed to; there is no
reason the second caller should see a failure for it.

**A test-setup bug produced two false-negative capacity tests.** The
"recipient has no room" and "the failure protects the other direction too"
tests both passed even with the capacity check silently deleted, which meant
they were not testing what they claimed. Root cause was in the test
helper, not the implementation: `give()` (test-only, bypasses real capacity
rules) places each new stack at the next free slot *index*, and the real
capacity scan only looks at indices `[0, capacity)`. Both tests built their
setup via `readyTrade()`, which gives the player's own offered item *first* —
landing it at index 0 — and then filled the rest of the bag *after*,
pushing the 24th filler stack to index 24, one past the valid window and
invisible to the check. When the trade later removed the item at index 0,
that freed a real slot inside the window, and the trade wrongly succeeded.
Fixed by rewriting both tests to build the trade manually, giving the filler
items *before* the player's own offered item, so the offered item's own slot
is the one that lands out of range — and removing it frees nothing.

**The first lock-order test didn't prove what it claimed to, either.** "Blocks
on a lock already held on a party's inventory" — hold `FOR UPDATE` on Alice's
inventory directly, assert `execute` blocks — passes identically whether the
deliberate sorted-order pre-lock exists or not, because `removeItem` takes
its own lock internally regardless. It's evidence *a* lock exists, not that
*this* lock, in *this* order, is what's running. Closing that gap needed
seeing the actual lock acquisition order, which needed the query observer
(`db/client.ts`) to stop discarding the query text and parameters it was
already intercepting for the T-2.11 query-count tests. With that extended,
a new test arranges the higher-id player as the *initiator* — so
sorted-order and invite-order predictions diverge — and watches the real
`FOR UPDATE` queries against `inventory_items` to confirm the lower id is
locked first regardless of who invited whom. Verified by removing the two
`lockContainer` calls: the new test fails with a real order mismatch, the
old one still passes either way. The old test's doc comment was corrected to
say honestly what it does and doesn't prove, rather than leaving the
stronger-sounding impression.

**All four guarded behaviours were confirmed load-bearing by deliberately
breaking each in turn and re-running the suite:** removing the ownership
re-check loops failed exactly the 3 tests that exercise it; swapping the
add/remove order to add-before-remove failed the full-bag-swap test with
`INVENTORY_FULL`; removing the second `assertBothCanTrade` call failed the
flagged-mid-trade test; removing the sorted `lockContainer` pair failed the
new lock-order test. Each break was reverted immediately after confirming
the failure, and the full 486-test server suite plus typecheck were re-run
clean afterward.

**Notes:** `trade_log` (the immutable audit table CLAUDE.md §6 requires) is
not written here — that's T-4.06, next.

### T-4.06 — Audit log  ✅ **DONE**
Depends: T-4.05 · Size: S
Files: `apps/server/src/modules/trade/{service,routes,audit.integration.test}.ts`
**Done:**
- [x] A `trade_log` row is written **in the same transaction** as the swap
- [x] It records both player ids, all items, gold, and the timestamp
- [x] Nothing in the codebase ever UPDATEs or DELETEs from `trade_log`
- [x] `security_log` also gets a `trade_executed` entry

**How it turned out.** Both tables already existed in `schema.ts` from the
first migration — `trade_log` with its own `initiator_items`/`recipient_items`
text columns and `completed_at`, `security_log` generic across every module
— so this task was pure service-and-route wiring, no migration.

**`trade_log` is written inside `execute()` itself**, right after the trade
row is marked `COMPLETED`, using `tx` — not `db` — so it shares the exact
transaction boundary as the swap and the status update. If anything later in
that function throws, the whole thing (swap, completion, audit row) rolls
back together; there is no path that completes a trade without a record of
it, or writes a record for a trade that didn't actually happen. Verified the
second half by deliberately dropping the leek out of Alice's bag after both
sides confirm: execution fails on the ownership re-check and the audit test
confirms zero `trade_log` rows for that trade.

**Written exactly once per trade, not once per caller.** Either party may
call `/execute` (T-4.05's domain-level idempotency), and the audit insert
sits on the branch that performs the real swap — the earlier `if (status ===
COMPLETED) return ...` branch, hit by whichever request loses the race, never
reaches it. Verified with the existing "either party may trigger it" pattern:
Alice executes, then Bob calls `/execute` on the same already-completed
trade, and the row count for that trade stays at exactly one.

**`security_log`'s `trade_executed` entry lives at the route, not the
service** — after `runIdempotent` resolves, using the same `logSecurityEvent`
helper and best-effort, non-blocking, fire-after-commit pattern the auth
module already established for `login_failed`/`account_created` (§8). This is
a deliberate asymmetry from `trade_log`: `security_log` is a lightweight
audit trail, not the anti-duping record, so it does not need to share
`trade_log`'s single-write-per-trade guarantee or its transactional boundary
— an audit write that failed here must not turn a successful trade into a
500, and it stays useful even logged once per successful caller rather than
once per trade.

**"Never UPDATEs or DELETEs" is enforced by a source scan, not a database
trigger.** A test walks every non-test `.ts` file under `apps/server/src` and
regex-matches for `.update(schema.tradeLog` / `.delete(schema.tradeLog`,
asserting none exist. Verified genuine by injecting exactly that call into
`cancel()` (a function nothing about audit logging should ever touch) and
confirming the scan catches it, then reverting.

**All four checkboxes were confirmed load-bearing by deliberately breaking
each and re-running the suite:** removing the `trade_log` insert failed the
3 tests that depend on it existing (row count, field contents, single-write
guarantee); removing the `security_log` call failed its one test; injecting
an UPDATE against `trade_log` into an unrelated function failed the source
scan. Each break was reverted immediately after confirming failure, and the
full 492-test server suite plus typecheck were re-run clean afterward.

### T-4.07 — Trade integration tests  ✅ **DONE**
Depends: T-4.05 · Size: L
Files: `apps/server/src/modules/trade/{trade,execution,audit}.integration.test.ts`
**Do:** §11 names these explicitly. All of them.
**Done:**
- [x] Happy path
- [x] Offer changed after one side confirmed → both confirmations reset
- [x] Item removed from inventory mid-trade → execution fails, nothing moves
- [x] **Two concurrent trades offering the same item → exactly one succeeds**
- [x] Recipient's inventory full → fails cleanly, nothing moves
- [x] Partner disconnects → trade expires, nothing moves
- [x] An ineligible account cannot open or accept
- [x] Total item count across both players is identical before and after every
      failure case — the anti-duping assertion

**How it turned out.** No new test code — this task is a consolidation, not
a build. §11's list turned out to already be satisfied by tests written
incrementally alongside T-4.02 through T-4.06, split across three files by
the same reasoning `execution.integration.test.ts`'s own doc comment gives:
"a lifecycle bug strands someone, an execution bug duplicates items" —
different failure modes deserve different files, not one file was ever
supposed to hold all of §11 at once. Mapping each requirement to where it
actually lives:

| §11 requirement | Covered by |
|---|---|
| Happy path | `execution...` › *swaps both offers and completes the trade* |
| Offer changed after confirm → both reset | `trade...` › *clears BOTH confirmations when either side edits* / *…RECIPIENT edits too* |
| Item removed mid-trade → fails, nothing moves | `execution...` › *refuses execution when an offered item has since left the bag* (asserts all four balances explicitly, not just the error code) |
| Two concurrent trades, same item → one succeeds | See below |
| Recipient's inventory full → fails cleanly | `execution...` › *refuses when the RECIPIENT of an item has no room, and moves nothing at all* / *the same failure protects the OTHER direction too* |
| Partner disconnects → expires, nothing moves | `execution...` › *refuses on an expired trade, and moves nothing* |
| Ineligible account cannot open or accept | `trade...` › *refuses an ineligible caller* / *…target* (invite), *re-checks eligibility at accept, not just at invite* |
| Total item count identical across every failure | `execution...` › *never changes the TOTAL item count…on any outcome* / *…when execution FAILS either* |

**On "two concurrent trades offering the same item."** Taken literally —
the same player racing the *same item* across *two different open trades*
— this is structurally unreachable, not merely untested: T-4.01 enforces
at most one live trade per player (`refuses a second trade while one is
live`), and that invariant is itself proven under a genuine race in
`cannot be raced into pulling one player into two trades` (two concurrent
invites for the same player, exactly one wins). A player physically cannot
have the same item standing in two live offers at once. The live version of
this risk — the same trade raced by both parties concurrently at the moment
it can actually spend an item — is `cannot be raced into spending the same
item twice` in `execution.integration.test.ts`, itself run against
`executeService` directly with a competing raw lock held on the row to force
the interleaving rather than hope for it.

**Nothing here needed a break-test of its own** — every row in the table
above points at a test already break-tested when its own task was done
(T-4.02's lifecycle races, T-4.03's revision/confirmation-reset logic,
T-4.05's ownership/capacity/lock-order guards). This task's only job was
confirming the checklist and recording where each line actually lives, so a
future reader doesn't have to re-derive it.

### T-4.08 — Trade rate limiting  ✅ **DONE**
Depends: T-4.05 · Size: S
Files: `apps/server/src/lib/accountRateLimit.ts`,
`apps/server/src/modules/trade/{routes,rateLimit.integration.test}.ts`
**Done:**
- [x] `TRADE_RATE_LIMIT` enforced per account, backed by Redis
- [x] Exceeding it → `TRADE_RATE_LIMITED`
- [x] Invites are limited separately from completions, so invite spam is capped

**How it turned out.** Every trade route already had a per-route
`@fastify/rate-limit` config, but that limiter is in-memory and keyed by IP —
a genuinely different defence from what CLAUDE.md §8 asks for ("per account
**and** per IP"). A bot spreading one account's traffic across a proxy pool
sails straight through an IP limiter; this task is the per-account half, and
it needed Redis specifically because it has to survive across the server's
process boundary the way an in-memory counter cannot.

**`assertUnderAccountLimit`, a new small helper in `lib/`,** does a fixed-
window `INCR`/`PEXPIRE` against `ratelimit:{scope}:{playerId}` — deliberately
generic (scope, playerId, limit, error code, message) rather than
trade-specific, matching how `idempotency.ts` and `securityLog.ts` already
sit in `lib/` as reusable cross-cutting infrastructure rather than living
inside one module. Fixed window over sliding: a burst can land two windows'
worth of calls right at the boundary, an acceptable imprecision for an
anti-bot backstop and far simpler than a sorted-set sliding window.

**Only `/execute` carries it.** §6 explicitly wants invites capped
*separately* from completions, and they already were — `/invite` has its own
10/min per-IP limit, structurally unrelated to this Redis counter, so a bot
cannot dodge the daily completions cap by hammering invites instead. Nothing
needed to change on the invite side; the task was confirming that separation
holds, not building it.

**The check runs *inside* `runIdempotent`'s callback, not before it.** This
is the one placement decision that actually matters: a replayed idempotency
key short-circuits before the callback ever runs (`idempotency.ts`), so
putting the limiter there means a client's retried-after-a-flaky-connection
request never burns a second unit of quota for the same logical action —
only genuinely distinct calls do. Every call that does reach the check
still counts, whether the trade underneath it succeeds or not, the same way
`@fastify/rate-limit` itself counts requests rather than outcomes.

**Tested against the real constant, not a stand-in.** Rather than fake a
small `max` to test cheaply, the test drives `TRADE_RATE_LIMIT.max` (20) real
calls to `/execute` on one ready trade — T-4.05's domain-level idempotency
means calling `/execute` again on an already-`COMPLETED` trade still succeeds
without re-swapping anything, and each such call is still a distinctly-keyed
request that has to clear the limiter, so 20 calls on one trade exercises the
exact same code path 20 real trades would, without the setup cost of 20 real
trades. The 21st is asserted to be `429 TRADE_RATE_LIMITED`.

**All three guarded behaviours were confirmed load-bearing by deliberately
breaking each and re-running the suite:** removing the `assertUnderAccountLimit`
call entirely failed the 3 tests that depend on the limit existing at all
(the cap itself, the per-account isolation, and — since there was nothing
left to short-circuit — the replay test too, since it could no longer
distinguish "correctly not counted" from "there was never a counter"); moving
the same call to *before* `runIdempotent` — the subtle-looking, still-correct-
seeming version — failed exactly the replay test, and only that one, which is
what proves the placement, not just the call's existence, is what the test is
checking. Both breaks were reverted immediately after confirming failure,
and the full 496-test server suite plus typecheck were re-run clean
afterward.

### T-4.09 — Gold in trades — **BLOCKED on D-3**
The columns exist. Do not enable until decided.

### T-4.10 — Realtime channel  ✅ **DONE**
Depends: T-4.03 · Size: M
Files: `apps/server/src/realtime/{socket,socket.integration.test}.ts`,
`apps/server/src/{app,modules/trade/routes}.ts`
**Do:** Introduce Socket.IO — the first thing in the project that genuinely
needs a push channel.
**Done:**
- [x] The socket authenticates from the session cookie; an unauthenticated
      socket is disconnected
- [x] A player only ever receives events for trades they are party to
- [x] The socket is a **notification** channel: no state-changing intent is
      accepted over it, and the client always re-fetches authoritative state
- [x] Reconnect resyncs rather than replaying

**How it turned out.** Everything else in the game is request/response —
the farm endpoint computes growth on read (§4.2), trades are polled — because
nothing else needed to tell a player something happened while their
attention was elsewhere. A trade invite does, so this is genuinely the first
thing that needs a push channel, not a "might as well" addition.

**One Socket.IO instance per Fastify app, not a module singleton.**
`attachRealtime(app)` creates its own `Server`, attached to `app.server` (the
underlying `http.Server`) and stored via `app.decorate('io', io)` — the same
pattern the codebase already uses for `AuthedPlayer` on `FastifyRequest`.
Attaching only adds listeners to the HTTP server; it needs no `.listen()`
call to be safe, so `buildApp()` calls it unconditionally and every
`app.inject`-only test in the other ~500 tests is unaffected — confirmed by
re-running the full suite before writing a single realtime-specific test.

**Auth happens in `io.use`, the handshake middleware**, by hand-parsing the
`th_session` cookie out of `socket.handshake.headers.cookie` and running it
through the exact same `resolveSession` the HTTP layer uses — one definition
of "is this session live," reused, not reimplemented. `next(new Error(...))`
inside that middleware is what Socket.IO surfaces to the client as
`connect_error`, before `connection` ever fires — the socket never completes
a handshake without a valid session. No `cookie` package pulled in for the
parsing: the token is an opaque, unsigned value with no characters that need
escaping (`setSessionCookie` never signs it), so splitting on `;`/`=` is
exactly as correct as a full parser here.

**Room scoping is the whole mechanism for "only the two parties."** Every
authenticated socket joins exactly one room, `player:{id}`, on connect —
nothing broader. `emitTradeChanged` targets `[player:initiatorId,
player:recipientId]` and nothing else; there is no broadcast path anywhere
in the file. `notify()`, a small closure inside `tradeRoutes`, wraps this and
is called after all six mutations (invite, accept, offer, confirm, execute,
cancel) once each returns its `TradeView` — every one of those already
carries `initiatorId`/`recipientId`, so no new lookup was needed to wire it
in.

**The channel carries no payload, on purpose.** Every emit is bare
`trade:changed` — not the trade id, not the new state. A player has at most
one live trade (T-4.01's invariant), so the client's only correct reaction is
already unambiguous: call `GET /api/trade/current`. Anything richer would be
a second copy of state that has to agree with the HTTP response, which is
exactly the kind of surface CLAUDE.md §4.1 exists to rule out for the
highest-risk system in the game — the socket tells the client to look, it
never tells the client what it would see.

**"Reconnect resyncs rather than replaying" became a concrete server
behaviour, not just a client instruction to trust:** `connectionStateRecovery`
is deliberately left unset (turning it on buffers and replays missed events,
which is precisely what's being avoided), and every `connection` — first
time or reconnect, the server cannot tell which and does not try to — fires
one `trade:changed` unconditionally. A client that was offline through three
trade changes and a client that missed nothing get the identical signal and
take the identical action.

**No inbound listener exists for anything mutating**, checked two ways: by
construction (there is no `socket.on(...)` anywhere in the file — only
`io.use`, `io.on('connection', ...)`, and outbound `socket.join`/`.emit`
calls), and by a source-scan test that would catch one being added later.

**Tested against a real listening server, not `app.inject`.** Every other
integration test in the suite uses `app.inject`, which never opens an actual
socket — it cannot exercise a handshake. This file's tests call
`app.listen({ port: 0 })` and connect with `socket.io-client` for real,
authenticating by registering a user via `app.inject` on the same app
instance and forwarding the resulting `Set-Cookie` as the socket's
`extraHeaders`.

**All four guarded behaviours were confirmed load-bearing by deliberately
breaking each and re-running the suite:** replacing the auth middleware with
one that always accepts failed 4 tests (both auth tests, plus two that
depend on room membership being tied to a real identity); broadcasting to
every connected socket instead of the two rooms failed exactly the
room-scoping test; deleting the on-connect emit failed exactly the two
resync tests; removing `notify()` from the invite/accept routes failed the
room-scoping test (its early "does everyone start quiet" wait timed out) and
the full-lifecycle test. Each break was reverted immediately after
confirming failure, and the full 504-test server suite plus typecheck were
re-run clean afterward.

**Not now:** the client half (opening the connection, wiring `trade:changed`
to a refetch) is T-4.11, Trade UI. This task is server-only, as scoped.

### T-4.11 — Trade UI  ✅ **DONE**
Depends: T-4.10 · Size: L
Files: `apps/client/src/net/{trade,realtime,errors}.ts`,
`apps/client/src/game/{tradePanel,hud}.ts`, `apps/client/src/styles/hud.css`
**Done:**
- [x] Both offers visible side by side with both confirmation states
- [x] A reset confirmation is unmissable — this is the anti-scam affordance
- [x] Countdown to expiry shown
- [x] Every trade error code has a specific message

**How it turned out.** Built as a DOM panel over the canvas, same as the
shop, bag, and chest — no React introduced. CLAUDE.md §2 only calls for it
once panels get complex enough to need it, and `shopPanel.ts` already showed
a plain `mount(host)`/`render()` class handles a stateful, multi-mode panel
fine; a fourth one in the same style was the smaller change than starting a
second UI paradigm partway through the game.

**The panel is a view over server state, never a place a decision gets
made.** Every button sends one intent (`invite`, `accept`, `setOffer`,
`confirm`, `execute`, `cancel`) and re-renders from whatever the response
says — `readyToExecute`, `you.confirmed`, the item lists, all read off the
`TradeView` the server returns, never computed client-side (§4.1). The one
place a diff happens locally is the reset-alert check below, and that diff
only decides whether to show a banner, never what the trade contains.

**"Both offers visible side by side" is a straight two-column render**
of `trade.you`/`trade.them`, each item row showing name, quantity, and icon
(icons reused from `hud.ts`'s existing `iconFor`, same sheet-lookup every
other panel already uses). Your own side gets an item picker sourced from
the bag (deduplicated by item id, via a new `bagItems()` host method) and a
remove button per row; their side is read-only, exactly matching what the
server actually holds for them — there is no "propose changing their side,"
which was never a real capability of the API either.

**The reset-confirmation banner is the one thing rendered from a diff, not
a raw response field** — because the server has nothing shaped like "this
just reset," only a `revision` and two `confirmed` flags at each fetch.
The panel remembers the revision and both confirmation flags it last
rendered; if a fresh `ACTIVE` fetch for the SAME trade shows a different
revision while at least one side had been confirmed a moment ago, that is
exactly T-4.03's "any edit clears both confirmations" firing, and the panel
flags it two ways at once — a toast (in case the player is not looking at
the panel) and a sticky, flashing banner inside the panel itself that
persists for 6 seconds rather than blending into the next quiet re-render.
Guarded by `trade.id === this.trade?.id` so switching to a genuinely
different trade never misreads as a reset of the one just left.

**Countdown to expiry** ticks from `expiresInMs` captured at fetch time,
redrawn every second locally — no polling once a second just to update a
clock the client can already derive, consistent with §4.2's "derive on read"
even in the client's own local rendering.

**Every trade error code got a specific message** in `net/errors.ts`,
alongside the existing farm/shop/inventory ones — the same table, the same
"the client reacts to the code, never the server's English" rule from §10.
`TRADE_OFFER_CHANGED` specifically is NOT just surfaced as a toast: the
confirm handler catches that one code and re-fetches instead, since showing
an error for "you were behind" when the fix is "look at what's current now"
would just make the player retry the same stale action.

**The realtime half (T-4.10's client side)** is a tiny wrapper,
`net/realtime.ts` — one lazily-opened `socket.io-client` connection,
same-origin so the session cookie rides along the way it already does for
`fetch`. `onTradeChanged` is the only export that matters: every
`trade:changed` event re-fetches `/trade/current` while the panel is open.
A polling fallback (8s) runs alongside it, since the socket is explicitly
best-effort — if it drops, the panel keeps working, just slightly slower to
notice a change, rather than going silently stale.

**Not tested with a dedicated test file** — matching `shopPanel.ts`,
`inventoryPanel.ts`, and `chestPanel.ts`, none of which have one either. The
client test suite covers pure game logic (movement, growth math, sprite
config); no DOM-testing harness (jsdom or otherwise) exists in this
workspace, and introducing one for a single panel would be a bigger
architectural decision than this task's scope. Verified instead the way
every other panel in this codebase is: `pnpm --filter @tillhaven/client
typecheck`, `pnpm --filter @tillhaven/client build` (catches bundling
issues typecheck alone would not), and the existing 57-test client suite,
all clean — plus the full 504-test server suite re-run once more since
`hud.ts`/`errors.ts` are shared surface area.

### T-4.12 — Trade history  ✅ **DONE**
Depends: T-4.06 · Size: M
Files: `apps/server/src/modules/trade/{service,routes,history.integration.test}.ts`,
`packages/shared/src/schemas/index.ts`, `apps/client/src/{net/trade,game/tradePanel}.ts`,
`apps/client/src/styles/hud.css`
**Done:**
- [x] A player sees their own completed trades, read from `trade_log`
- [x] Paginated; a player can never read a trade they were not party to
- [x] Serves as the light reputation signal described in §6

**How it turned out.** `GET /api/trade/history` reads exclusively from
`trade_log` — never `trades`, which only holds live sessions and is
overwritten the moment a player opens a new one. `trade_log` already existed
and was already being written to, one row per completion, by T-4.06; this
task is purely a read path over it.

**Ownership is the WHERE clause, not a check layered on after.** Every query
is scoped to `initiatorId = playerId OR recipientId = playerId` before
anything else runs — there is no code path that can return a row for a trade
the caller was not part of, because the query is structurally incapable of
producing one. That is stronger than "checked," which is what the checkbox
actually asks for.

**Keyset-paginated on `(completedAt, id)`, not offset.** An offset shifts
under a page boundary the instant a new trade completes between two
requests, silently skipping or duplicating a row depending on which way the
list moved. A cursor built from the last row actually shown does not have
that problem — it names a position, not a count. `id` (a UUID, so useless
for ordering on its own) exists purely as the tie-breaker for two trades
completing in the same millisecond, which real trade throughput will rarely
produce but which is worth guarding regardless. That guard is not
theoretical: a dedicated test inserts two `trade_log` rows with an
IDENTICAL `completedAt` directly (real completions essentially never
collide, so the test forces it) and confirms paging across them skips
nothing and repeats nothing; removing the `id` tie-breaker from the cursor
comparison — while every other test kept passing — makes exactly that test
fail with a real duplicate/missing row, which is what proves the guard does
something rather than existing for its own sake.

**The cursor is opaque and untrusted on the way in.** A garbled or
hand-edited cursor does not error — it just restarts at page one, since
there is nothing sensitive encoded in it and nothing a bad value could do
besides produce a wrong-but-harmless page.

**"Serves as the light reputation signal" is read literally against §6.**
§6 names this as a *property* the history should have — visible to a
player, for their own records, and usable as a reputation signal — not a
separate feature with its own checkbox. Nothing beyond "a player sees their
own trades" was built toward making it visible to OTHER players; that would
be a new, unscoped capability (whose trades can a stranger see, and does
that need consent) that T-4.12's checklist does not ask for and CLAUDE.md
never revisits. Noted here rather than silently expanded.

**Client: a "History" toggle inside the existing trade panel**, not a new
one — same DOM-panel pattern as the rest of T-4.11, switching the panel body
between the live trade view and a paginated list with a "Load more" button
that appends using the server's `nextCursor` verbatim. No dedicated test
file, matching every other panel in this codebase (see T-4.11's write-up for
why); verified via typecheck, build, and the existing client suite.

**All three guarded behaviours were confirmed load-bearing by deliberately
breaking each and re-running the suite:** dropping the ownership `WHERE`
clause failed exactly the cross-player test; dropping the `id` tie-breaker
from the cursor failed exactly the millisecond-collision test; reporting a
`nextCursor` even with nothing left to page to failed exactly the
pagination test's "null once exhausted" assertion. Each break was reverted
immediately after confirming failure, and the full 513-test server suite
plus typecheck across every workspace were re-run clean afterward.

---

# Phase 5 — VIP

### T-5.01 — Purchases table and VIP resolution  ✅ **DONE**
Depends: T-1.01 · Size: S
Files: `packages/shared/src/config/{vip,config.test}.ts`,
`apps/server/src/modules/player/view.ts`,
`apps/server/src/modules/{farm,animals}/service.ts`,
`apps/server/src/modules/farm/farm.integration.test.ts`
**Done:**
- [x] `benefitsFor(vipUntil, now)` is used everywhere; no ad-hoc VIP checks
- [x] Expiry is evaluated on read — no job needed to end VIP
- [x] A flagged account gets `FREE_BENEFITS` regardless of `vipUntil`

**How it turned out.** The `purchases` table already existed, correctly
shaped, from the first migration — player id, Stripe session/payment-intent
ids, amount, currency, status, timestamps, `refundedAt`. Nothing to do there.
The actual work was in the checklist's other two lines, and they turned out
to already be quietly violated.

**What was actually found.** `benefitsFor` took a raw `vipUntil: number |
null`, so "does this account count as VIP" was decided by whatever the
CALLER passed in, not by the function. Four call sites (two in
`farm/service.ts`, two in `animals/service.ts`) got it right by writing
`player.flaggedAt === null ? player.vipUntil : null` inline before every
call — correct today, but four independent copies of one rule, and nothing
stopped a fifth call site from forgetting the ternary and silently letting a
refunded account keep fast growth. Meanwhile five OTHER modules
(`inventory/chest.ts`, `farm/expansion.ts`, `farm/house.ts`,
`house/service.ts`, and even `animals/service.ts` itself for its animal-cap
check) already went through a *separate*, independently-correct function,
`isVip(player, now)` in `player/view.ts`. Two implementations of "flagged
means no VIP," agreeing today by coincidence rather than by construction —
exactly the drift CLAUDE.md §4.4 exists to rule out for shared config, even
though this is a derived boolean rather than a config value.

**The fix collapses both into one.** `isVipActive(player, now)` is now the
single definition, in `packages/shared/src/config/vip.ts` — shared, not
server-only, so both server-side checks and (once the client has any VIP UI)
client-side display logic can read the same rule. `benefitsFor` is rebuilt
on top of it and, critically, changed to take the PLAYER RECORD
(`{ vipUntil, flaggedAt }`) rather than a pre-computed timestamp — there is
no longer a "just pass a number" call shape that could skip the flagged
check, because the function does the nulling-out itself. `player/view.ts`'s
`isVip` is now a one-line re-export of the shared function instead of a
second copy of the same three lines. The four ad-hoc call sites collapsed to
`benefitsFor(player, now)`.

**"Evaluated on read" was already true and stays true** — `isVipActive` and
`benefitsFor` both take `now` as an argument and store nothing; there was
never a cached "isVip" boolean to go stale, and this task did not introduce
one.

**Verified at two levels, not just the shared-config unit tests.** A new
config test pins the flagged-overrides-`vipUntil` case with a `vipUntil` in
the far future specifically, so it cannot pass by coincidence the way a
near-past one might. More importantly, a new integration test plants a real
leek through `POST /api/farm/plant`, backdates it by a window that reads as
ripe under VIP speed (80% of 45 minutes) but not under free speed (100%),
and proves a flagged account with a `vipUntil` 30 days out still gets the
FREE timing — exercising the actual endpoint, not just the function in
isolation. Reverting `farm/service.ts`'s two call sites back to the
pre-refactor "pass a nulled timestamp" shape made exactly that test fail,
which is what confirms the fix closes a reachable bug and not just a
theoretical one. Removing the flagged check from `isVipActive` itself failed
the shared-config test the same way. Both breaks were reverted immediately
after confirming failure, and the full 515-test server suite, the 48-test
shared suite, and typecheck across every workspace were re-run clean
afterward.

### T-5.02 — Checkout session  ✅ **DONE**
Depends: T-5.01 · Size: M
Files: `apps/server/src/modules/vip/{stripe,service,routes,checkout.integration.test}.ts`,
`apps/server/src/{app,test/app}.ts`, `apps/server/vitest.config.ts`
**Do:** `POST /api/vip/checkout` creates a Stripe Checkout Session in
`mode: 'payment'`. **Not** Stripe Billing, not a recurring Price, not
subscription webhooks.
**Done:**
- [x] The session is built entirely server-side; the client sends no amount,
      price, or duration
- [x] `mode` is `'payment'` — asserted in a test
- [x] The player id is in the session metadata for fulfilment
- [x] Buying while VIP is active → `VIP_ALREADY_ACTIVE`
- [x] The secret key never reaches the client

**How it turned out.** `vipCheckoutSchema` (client sends only an idempotency
key) and both `VIP_ALREADY_ACTIVE`/`WEBHOOK_SIGNATURE_INVALID` error codes
already existed from earlier scaffolding — this task was the actual
`POST /api/vip/checkout` route and the Stripe wiring behind it.

**Tested against a hand-written mock, never the real Stripe SDK** — the
user's explicit choice for this task, since no Stripe credentials are
configured in this environment. `stripe.ts` defines
`CheckoutSessionClient`, the narrow slice of the SDK this module actually
touches (`checkout.sessions.create`, nothing else), the same "test against
an interface, not the concrete dependency" pattern `Tx`/`Queryable` already
use for Postgres. `app.ts` decorates every Fastify instance with a real
client by default and accepts a `BuildAppOptions.stripe` override; tests
call `createTestClient({ stripe: mockClient })` (a one-line extension to the
shared test harness) and get the REAL route — auth, Zod validation, rate
limiting, the `VIP_ALREADY_ACTIVE` guard, idempotency — exercised through
`app.inject` exactly like every other endpoint, with a mock standing in only
for the actual network call at the very end.

**The real client is lazy on purpose.** `STRIPE_SECRET_KEY` is empty by
default in dev and in the ~515 other tests that never touch this route, and
the Stripe SDK throws on construction with no key. Constructing it eagerly
at import time — the obvious way to wire this up — would have crashed the
whole server, and the whole test suite, over a feature nobody in most
requests is even touching. `defaultCheckoutClient`'s methods defer to
`realStripe()` at CALL time instead, so decorating with it is always safe;
the "unconfigured key" failure only ever surfaces if a real, un-mocked
checkout request actually arrives.

**Every field the client could try to influence is either rejected at the
schema or silently unreachable in the service.** `vipCheckoutSchema` accepts
only `idempotencyKey` — Zod strips anything else from the body by default,
so a `price`/`amount`/`durationDays` field never reaches the handler at all.
`createCheckoutSession` reads the price exclusively from
`env.STRIPE_VIP_PRICE_ID` and takes no price-shaped parameter it could be
tricked into using instead. Verified for real, not just by the schema: a
test POSTs a body carrying exactly those three bogus fields and asserts the
mock's captured `line_items` still names the server's configured price —
then, to make sure that assertion actually means something, the service was
temporarily changed to accept and honour a client-supplied price parameter,
which failed precisely that test.

**Eligibility is re-derived, not trusted.** `createCheckoutSession` calls
`isVipActive(player, now)` — the same T-5.01 function every other VIP check
uses — and refuses with `VIP_ALREADY_ACTIVE` before ever touching Stripe;
the mock's call count is asserted at zero in that case, so an already-VIP
account cannot even generate an unused checkout link. A flagged account with
a `vipUntil` far in the future is deliberately allowed through, matching
`isVipActive`'s own definition of "not currently VIP" — refusing here for
the wrong reason would trap a flagged player who genuinely wants to buy VIP
again.

**Idempotency reuses `runIdempotent` as-is**, even though this route writes
nothing to this database directly — a retried click after a flaky
connection must not hand the player two separate checkout links, and
`runIdempotent`'s existing "replay returns the stored response without
re-running anything" guarantee is exactly that, for free.

**The secret key never appearing in a response is checked directly**, not
assumed: the test environment sets a distinctive, obviously-fake
`STRIPE_SECRET_KEY`, and a test asserts that literal string never appears
anywhere in `JSON.stringify(response.body)`.

**All four guarded behaviours were confirmed load-bearing** by deliberately
breaking each and re-running the suite: removing the `VIP_ALREADY_ACTIVE`
check failed exactly that test; switching `mode` to `'subscription'` and
dropping `metadata` failed exactly those two tests; wiring a client-supplied
price through to Stripe failed the "ignores client price" test; bypassing
`runIdempotent` entirely failed the replay test. Each break was reverted
immediately after confirming failure, and the full 523-test server suite
plus typecheck across every workspace were re-run clean afterward.

**Not now:** fulfilment — actually granting VIP once payment succeeds — is
T-5.03, and stays exclusively in the webhook. This task cannot itself grant
anything; it only ever produces a URL to send the player to.

### T-5.03 — Webhook fulfilment  ✅ **DONE**
Depends: T-5.02 · Size: L
Files: `apps/server/src/modules/vip/{stripe,webhook,webhookRoutes,webhook.integration.test}.ts`,
`apps/server/src/app.ts`, `apps/server/vitest.config.ts`
**Do:** Grant VIP **only** from `checkout.session.completed`, after verifying
the signature. The success-URL redirect grants nothing — it is trivially
spoofable.
**Done:**
- [x] Signature verified with `STRIPE_WEBHOOK_SECRET` on **every** inbound call
- [x] An invalid signature → `WEBHOOK_SIGNATURE_INVALID`, nothing granted
- [x] The route reads the **raw body**; a JSON-parsed body breaks verification
- [x] Fulfilment is idempotent on `stripeSessionId` — Stripe retries, and a
      duplicate delivery must not extend VIP twice
- [x] A `purchases` row is written with amount, currency and status
- [x] Grant and purchase row are one transaction
- [x] `security_log` records `vip_granted`
- [x] **No code path anywhere grants VIP from a browser redirect**

**How it turned out.** `POST /api/vip/webhook` is a genuinely different
shape of route from everything else in the game, in two ways that both
needed their own plugin scope, `webhookRoutes.ts`, separate from
`vipRoutes.ts` (checkout):

1. **Not behind `requireAuth`.** Stripe calls this server-to-server; there
   is no session cookie to check, and authenticity comes entirely from the
   signature. Registering it as its own Fastify plugin instance — sharing
   the `/api/vip` prefix with `vipRoutes` but never nested inside it — is
   what keeps Fastify's hook encapsulation from applying `vipRoutes`'
   `requireAuth` preHandler to it.
2. **Needs the raw body.** Signature verification hashes the exact bytes
   Stripe sent; a body Fastify has already JSON-parsed and would re-serialize
   (different key order, different whitespace) fails verification for a
   perfectly legitimate event. `app.addContentTypeParser('application/json',
   { parseAs: 'buffer' }, ...)` is registered inside `webhookRoutes`' own
   scope specifically so it affects only this one route — every other
   endpoint in the app, including checkout, keeps ordinary JSON parsing.
   Verified this actually matters, not just plausible-sounding: removing the
   override failed 8 of the file's 11 tests at once, since nearly every
   assertion downstream of a valid signature depends on the signature
   verifying at all.

**Stripe's Node SDK, not a hand-rolled mock, does the actual verifying** —
`app.stripe.webhooks.constructEvent` (`stripe.ts`, extended from T-5.02's
`CheckoutSessionClient` into the broader `VipStripeClient`) is real, pure
local HMAC verification with no network call, so it needs no live API key
to exercise. Tests construct a genuine `Stripe` instance purely for its
`.webhooks` namespace and use the SDK's own documented
`generateTestHeaderString` helper (built for exactly this) to sign real,
valid test payloads. Only `checkout.sessions.create` — the one call that
WOULD need a real key — stays a hand-written stub. This means the signature
check in this task is tested against the actual verification code Stripe
ships, not a re-implementation of what verification is supposed to do.

**Idempotent on `stripeSessionId` via `onConflictDoNothing`, not
insert-then-catch.** A caught unique-violation error would leave the
surrounding transaction aborted in Postgres — any error inside a
transaction poisons it until rollback, so the `players.vipUntil` UPDATE
right after it would fail too, turning a harmless duplicate delivery into a
500. Silently inserting zero rows keeps the transaction healthy: a
redelivered event checks `inserted.length === 0` and returns early, grant
and all, with nothing written twice. A dedicated test replays the exact
same signed body Stripe genuinely does on retry and asserts `vipUntil` and
the purchases row count are unchanged after the second delivery.

**Grant and purchase row are one transaction** because `handleStripeEvent`
takes a `Tx` and both the `purchases` insert and the `players` update run
through it — the route wraps the whole call in one `db.transaction(...)`,
so either both happen or neither does, the same discipline every other
multi-row mutation in this codebase already follows (§4.3).

**Only `checkout.session.completed`, and only a `paid` one, grants
anything.** Every other event type Stripe might send — including
`charge.refunded`, before T-5.04 adds real handling for it — is
acknowledged with 200 and otherwise ignored, so Stripe never retries an
event this handler was never going to act on. A `completed` session whose
`payment_status` is not `'paid'` (an async payment method still settling)
is likewise a no-op rather than a grant.

**A missing `playerId` in metadata is treated as an anomaly, not a
signature problem.** A well-formed, correctly-signed event that simply was
not created by `createCheckoutSession` (which always sets it) has nothing
safe to grant to. Logged to stderr for visibility and acknowledged with 200
— there is no fix a retry could produce, so leaving Stripe to retry
forever would be pure noise.

**"No code path anywhere grants VIP from a browser redirect" is checked by
a source scan, not just by not having built one.** A test walks every
non-test `.ts` file under `apps/server/src` for anything that looks like a
`vipUntil` write and asserts exactly one exists — `webhook.ts`. Verified
genuine by injecting a second, fake grant site into `service.ts` (the
checkout module, reachable from the success-URL-adjacent code path) and
confirming the scan catches it.

**All seven guarded behaviours were confirmed load-bearing** by
deliberately breaking each and re-running the suite: skipping signature
verification entirely failed the two signature tests; removing the raw-body
content-type override failed 8 of 11 tests; removing the
`onConflictDoNothing` dedup failed the redelivery test; removing the
`payment_status` check failed the unpaid-session test; removing the missing-
metadata guard failed that test; removing the `security_log` write failed
its test; injecting a second grant site failed the source-scan test. Each
break was reverted immediately after confirming failure, and the full
534-test server suite plus typecheck across every workspace were re-run
clean afterward.

**Not now:** T-5.04 (refunds and chargebacks) adds real handling for
`charge.refunded` and `charge.dispute.created`, which this task's event
switch currently just acknowledges and ignores like any other unhandled
type.

### T-5.04 — Refunds and chargebacks  ✅ **DONE**
Depends: T-5.03 · Size: M
Files: `apps/server/src/modules/vip/{webhook,webhookRoutes,refund.integration.test}.ts`
**Done:**
- [x] `charge.refunded` and `charge.dispute.created` both flag the account and
      revoke VIP
- [x] `refundedAt` is recorded on the purchase
- [x] Revocation is idempotent
- [x] `security_log` records it

**How it turned out.** `webhook.ts`'s single `handleStripeEvent` switch grew
two more cases, both routed to one shared `handleFlagging` — `charge.refunded`
and `charge.dispute.created` resolve identically once you have a Charge or a
Dispute in hand: both carry a `payment_intent` reference, and from there the
work (find the purchase, mark it refunded, flag the account) is the same
regardless of which event triggered it. Every other event type, including
these two before this task, still just falls through to the existing
`default: return NOOP`.

**Revoking VIP needed no new column and no new logic of its own.**
`flaggedAt` already existed, and T-5.01's `isVipActive` already treats any
flagged account as never-VIP regardless of `vipUntil` — so `handleFlagging`
does exactly one thing to the player row, setting `flaggedAt`, and that
alone is the revocation. It is also the same column `eligibility.ts`
already reads to block trading (§7's own framing: "flag the account,"
singular, not "revoke VIP AND separately block trading") — a refunded or
disputed account loses both at once because there is structurally only one
flag to set, not two independent revocations that a future change could
make disagree.

**Idempotent the same way T-4.05's ownership guards are: the UPDATE's own
WHERE clause is the check, not a separate SELECT-then-branch.**
`refundedAt IS NULL` on the purchases update means "not already processed";
a redelivered event matches zero rows (the first delivery already set it)
and the whole thing is a no-op — no re-flagging, no re-timestamping,
`flaggedAt` stays at whatever it was set to on the FIRST delivery. That is
also what closes the race a SELECT-then-write would leave open between two
concurrent deliveries of the same event.

**`security_log` gets a new event name, `account_flagged`, not a second
`vip_granted`-shaped one** — flagging is a broader consequence than "VIP
went away," and the log entry should say what actually happened. Carries
`reason` (`'refund'` or `'dispute'`) in its detail, so the two triggers
stay distinguishable in the log even though the code path is shared.

**Tested through the same real route as T-5.03**, not the service function
directly — genuinely signed `charge.refunded`/`charge.dispute.created`
payloads via the real Stripe SDK's signing helper, against a player who was
actually granted VIP moments earlier through a real
`checkout.session.completed` delivery in the same test, so the purchase row
being refunded is the genuine one T-5.03's own code wrote, not a fixture
inserted directly.

**All four guarded behaviours were confirmed load-bearing** by deliberately
breaking each and re-running the suite: removing the `charge.refunded` case
from the switch (leaving `charge.dispute.created` alone) failed exactly the
refund-specific test; dropping the `refundedAt IS NULL` guard from the
WHERE clause failed the idempotency test; skipping the `players.flaggedAt`
update failed the "flags the account" test; removing the
`account_flagged` `security_log` write failed its test. Each break was
reverted immediately after confirming failure, and the full 541-test server
suite plus typecheck across every workspace were re-run clean afterward.

### T-5.05 — Webhook integration tests
Depends: T-5.03 · Size: M
**Done:**
- [ ] Valid signature grants exactly once
- [ ] Invalid signature grants nothing
- [ ] Duplicate delivery of the same session grants once, not twice
- [ ] Refund revokes
- [ ] Out-of-order delivery (refund before completion) leaves a sane state

### T-5.06 — VIP benefits applied
Depends: T-5.01 · Size: M
**Done:**
- [ ] The duration multiplier reaches crop growth and animal production
- [ ] Bonus slots and plots apply
- [ ] Bulk harvest and auto-collect exist and are transactional and idempotent
- [ ] A test asserts VIP produces **no item a free account cannot obtain**, and
      that VIP cosmetics are `tradeable: false` (§7)

### T-5.07 — VIP UI
Depends: T-5.06 · Size: S
**Done:**
- [ ] States "one-time purchase, 30 days" plainly — never implies a subscription
- [ ] Remaining days shown while active
- [ ] Post-purchase state comes from the server, never from the redirect

---

# Phase 6 — Balance and polish

### T-6.01 — Economy tuning from real data
Depends: T-2.10 · Size: L
**Done:** Gold-per-hour measured against real play; `docs/economy.md` updated
with before and after; no crop is strictly dominated by another.

### T-6.02 — Anti-bot measures
Depends: T-2.11 · Size: L
**Do:** §8 — assume automation and design so it gains little.
**Done:** Per-account limits on every mutating endpoint; anomalous patterns
logged; nothing added that punishes ordinary idle play.

### T-6.03 — Scheduled jobs — partly **BLOCKED on D-2**
**Do:** Keep to the minimum §4.2 allows: weekly economy snapshots, trade
expiry sweeps, idempotency-key pruning. Withering only if D-2 says so.
**Done:** Every job is idempotent and safe to run twice; none simulates farms.

### T-6.04 — Sound
**Done:** Effects for plant, harvest, collect, purchase; muted by default until
first interaction; a persisted mute control; `ATTRIBUTION.md` updated.

### T-6.05 — Onboarding
**Done:** First session gets a player to plant something in under a minute;
skippable; never blocks the UI.

### T-6.06 — Accessibility and polish pass
**Done:** Keyboard reachable; visible focus everywhere; `prefers-reduced-motion`
respected across the game as well as the marketing pages; contrast checked.

### T-6.07 — Licence audit before public release
Depends: — · Size: M
**Do:** §9 — confirm the licence of every asset pack **before** release.
**Done:**
- [ ] Every file in `assets/` has a confirmed licence recorded in
      `ATTRIBUTION.md`
- [ ] Anything that cannot be confirmed is replaced, not shipped
- [ ] The same for any sound or font added along the way

---

## Appendix — measured asset facts

Worth knowing before touching sprite code. Full detail in
`packages/shared/src/config/assets.ts`; the invariants are enforced by
`config.test.ts`.

- **`Tileset Spring.png` is unusable raw.** Columns 0–7 are `#000000` at alpha
  255 — not transparent — plus 20 further padding cells inside the right-hand
  strip. `pnpm assets` crops to the usable 64×320 region and keys black out.
  Always use the generated `tileset-spring.png`.
- **Crop frames are 16 wide × 32 tall, not square.** Art sits in the bottom 16px
  so plants grow upward out of the tile. Bottom-anchor them. Slicing at 32×32
  makes every frame show half of its neighbour — this was a real bug.
- **The player sheets' rows are down, up, side** — in that order. Verified
  against the pixels: row 1 has no face at all. `Facing` holds the mapping;
  never assume a row from its name's position. The side row faces **right**
  (`PLAYER_MIRROR_FACES_RIGHT = false`), which is only settleable by walking
  left in the game — the art is too small to read reliably.
- **The player's feet are at y = 26 of a 32x32 frame**, not at its bottom edge,
  and the side/up rows sit one pixel right of centre so mirroring them shifts
  the art two pixels. Both are in `PLAYER_ART`; anchor and flip through it.
- **Potato has 7 growth stages**; the other three have 6. Always iterate
  `stageFrames`, never assume a count.
- **Maple tree frame 4 is a stump, not a growth stage.** Stages are 0–3.
  Measured heights are 4, 12, 33, 46, 12 px — the drop at the end gives it away.
- **Houses span many cells.** The left building is x 4..75, y 3..88; the right
  one x 148..219. Crop a window, do not use a single frame.
- Six source filenames contain spaces and one an apostrophe. Never reference
  `assets/` directly from code — use the kebab-case output of `pnpm assets`.
