# CLAUDE.md

Project guide for AI-assisted development. Read this file before writing any code.

---

## 1. Project Overview

**Working title:** Tillhaven

A browser-based **idle farming game** with Stardew Valley-inspired pixel art. Players own a farm, plant and harvest crops, raise animals, upgrade their house and storage, and trade items with other players.

**Core pillars:**
- **Idle-first:** progress continues while the player is offline. Sessions are short and frequent, not long and grindy.
- **Server-authoritative:** the client never decides anything that matters. It renders state and sends intents.
- **Player-driven economy:** items have real scarcity and a safe in-game trade system. Real-money trading happens informally outside the game; the game's job is to make in-game trades atomic and auditable, not to facilitate or process external payments.
- **One-time VIP purchase:** monetization is a single non-recurring Stripe purchase, not a subscription.

---

## 2. Tech Stack

### Client
- **Phaser 3** with **TypeScript**
- **Vite** for bundling and dev server
- **Tiled** (external editor) for authoring tilemaps; export as JSON and load in Phaser
- State handling: plain TypeScript stores. No heavy framework needed for the game canvas. If UI panels (inventory, shop, trade) get complex, use a lightweight React layer rendered **over** the canvas, not inside it.

### Server
- **Node.js** with **TypeScript**
- **Fastify** for HTTP/REST
- **Socket.IO** (or `ws`) for realtime push (trade requests, notifications, live state sync)
- **PostgreSQL** as the source of truth
- **Prisma** or **Drizzle** as ORM/query builder (pick one, do not mix)
- **Redis** for sessions, rate limiting, and short-lived locks
- **Zod** for validating every inbound payload

### Infrastructure
- Monorepo with a shared `packages/shared` for types, constants, and game config used by both client and server
- Docker Compose for local Postgres + Redis
- Environment config via `.env`, never committed

---

## 4. Core Architecture Rules

These are non-negotiable. Any code that violates them must be rejected in review.

### 4.1 The client is never trusted
- The client sends **intents**, not results. `harvest(plotId)` is valid. `addGold(500)` is not.
- Every intent is validated server-side against current database state before anything is written.
- The client may optimistically render an action, but must reconcile with the authoritative response and roll back on mismatch.
- Never send secret or exploitable data to the client (exact RNG seeds, other players' inventories, internal balancing multipliers that aren't already public).

### 4.2 Time is computed, not ticked
Do **not** run a global loop that simulates every farm every second. That does not scale and it is not needed.

Instead, store timestamps and derive state on read:

```ts
type Plot = {
  id: string;
  farmId: string;
  cropId: string | null;
  plantedAt: number | null;      // epoch ms
  growthDurationMs: number | null;
  wateredAt: number | null;
  harvestedAt: number | null;
};
```

When a player requests farm state, the server computes growth stage from `Date.now() - plantedAt`. This gives **offline progression for free** and makes the system stateless between requests.

Scheduled jobs are only for things that genuinely need to happen without a player present (e.g. crop withering deadlines, weekly economy snapshots). Keep them minimal.

### 4.3 All mutations are atomic
Any operation that touches more than one row (trading, buying, crafting, selling) must run inside a single database transaction. If any step fails, the whole thing rolls back. There must be no code path that can create or destroy items outside a transaction.

### 4.4 Shared game config
Crop growth times, prices, animal production intervals, and VIP multipliers live in `packages/shared/config/`. The client reads them for display only. The server reads them for authoritative calculation. **They must never diverge.**

### 4.5 Idempotency
Every state-changing endpoint accepts an idempotency key. Double-submitting `harvest` due to a flaky connection must not yield double rewards.

---

## 5. Game Systems (MVP Scope)

> **Pivot note (2026-08-24):** the MVP became Stardew-Valley-like to *play*
> while staying idle-first and server-authoritative. The character does the
> farming with tools; an **idle mode** switch makes the server-simulated
> farmer do it autonomously. Details below reflect the pivot; the task
> breakdown lives in `ROADMAP.md` (v1 is archived at `docs/ROADMAP-v1.md`).

### 5.1 Player & Character
- Account creation, login, session management
- Each player owns exactly one farm
- **Character creator** at first login: skin tone, eyes, hair style + color,
  clothes color — rendered as stacked sprite layers from the asset pack.
  Appearance is stored server-side (`players.appearance`) but is purely
  cosmetic.
- **Stardew-style manual control:** WASD/arrows walk (Shift runs); the tile
  the character faces is highlighted; an action key uses the equipped hotbar
  item on it. **Only the character performs farm actions** — there is no
  click-a-plot-from-anywhere path.
- **Character position remains cosmetic to the server** (§4.1): adjacency,
  facing, and tool checks are client-side UX gates. The server validates
  ownership and state, never position. Never add a position field to any
  payload.

### 5.2 Farming loop (till → plant → water → harvest)
- Farm is a tile grid; a fixed set of authored tiles are **plots**
- A plot must be **tilled** (hoe) before planting; harvesting leaves soil
  tilled
- Seed is planted into a tilled empty plot → consumes seed from inventory
- **Watering is required (decided):** a crop only grows while its soil is
  wet. Watering (watering can) wets soil for `WATER_DURATION_MS`. A dry crop
  **pauses** — it never dies from drought. Growth accumulates in
  `plots.grown_ms`, settled on each watering; effective growth is computed on
  read (§4.2 still holds — no jobs).
- **Tools are items** (category `tool`, stack 1, unsellable, untradeable)
  equipped via the hotbar. MVP tools: wood hoe, wood watering can. Harvest is
  by empty hand.
- Harvest yields produce into the backpack; the plot returns to empty tilled
  soil
- Plot count expands via in-game currency (unchanged)

### 5.3 Idle mode (the headline feature)
- A switch: when ON, the player stops controlling the character and the
  farmer works autonomously. The player configures **which tasks** (MVP:
  till, plant, water, harvest — designed to grow into chop/mine later) and
  which crop to plant.
- **Offline-first:** idle work is simulated **server-side from timestamps**
  (a pure, deterministic simulator + a watermark `idle_processed_at`),
  applied transactionally on read — so the farm keeps working with the tab
  closed, exactly like §4.2 growth. One action per `IDLE_ACTION_MS`.
- **The client's animation is replay, never authority:** while watching, the
  character walks to the next planned action and plays the tool animation,
  purely cosmetically, reconciling from polls.

### 5.4 Animals
- Purchasable animals: cow (milk), chicken (eggs); many cosmetic color
  variants from the asset pack.
- Baby chicken **growth stage** matures into an adult before producing.
- Production is timestamp-based: `lastCollectedAt + productionIntervalMs`
- Animals require feeding; unfed animals stop producing (never kill animals)
- Animal caps come from **coop tier** (chickens) and **barn tier** (cows),
  purchased at the merchant; the buildings render on the farm
- Collect/feed happen via the character (action key facing the animal)

### 5.5 Inventory & Storage
- **Hotbar** (Stardew-style): the first 12 backpack slots, shown as a strip;
  number keys / wheel / click select the equipped item. Selection is
  client-side state.
- **Backpack** is slot-based with a hard cap; capacity comes from the
  **purchased backpack tier** (12 → 24 → 36 slots, bought at the merchant)
  plus the VIP bonus. House tiers no longer grant slots.
- **Chest** provides additional storage, upgradeable, opened by using the
  action key at the chest object on the map
- One Stardew-style panel: **chest grid on top, backpack at the bottom**,
  items arranged freely by drag-and-drop — within either container and
  across them (slot→slot, server-validated)
- Stack limits per item type; any operation that would overflow fails
  cleanly with a clear error, never silently deletes items

### 5.6 Selling & buying
- Items are **bought only from the merchant** (an NPC on the map; action key
  opens the shop)
- Items are **sold only two ways**: to the merchant, or via the **shipping
  box** — deposit items, they convert to gold after `SHIPPING_PAYOUT_MS`
  (timed payout, settled on read; no jobs)
- NPC prices are fixed; the shop buys lower than player-to-player value so
  trading stays meaningful (unchanged)

### 5.7 House & Decoration (deferred)
- House renders on the farm; furniture/interior is **hidden for the MVP**
  (server code from v1 stays intact). Re-enablement is a Phase 14 backlog
  item.

### 5.8 Economy
- Single soft currency: **Gold**
- Gold sources: merchant sales, shipping-box payouts, one-time
  quest/milestone rewards
- Gold sinks: seeds, animals, feed, plot expansion, backpack tiers, chest
  upgrades, coop/barn tiers
- Document every source and sink in a single config file/ledger. An idle
  economy dies from unlogged faucets.

---

## 6. Trading System

Trading is the highest-risk system in the project. It is where duping, scamming, and exploits happen. Build it defensively.

**Full requirements live in the `trading-system` skill — load it before touching
any trade code.** Two prohibitions that apply even without it:

- **Never** execute a swap outside a single transaction with row-level locks on
  both inventories, and never trust offer state captured when the window opened
  — re-verify ownership at execution time.
- **Never** build escrow-for-cash, currency-for-cash listings, or any other
  real-money-trading integration. RMT is explicitly unsupported (see the skill).

---

## 7. VIP (One-Time Purchase)

Monetization is a **single non-recurring** Stripe purchase, 30-day on the
account.

**Full requirements live in the `vip-stripe` skill — load it before touching
VIP, purchases, or webhook code.** Three prohibitions that apply even without
it:

- **Never** grant VIP from the browser redirect to the success URL — that is
  trivially spoofable. Fulfillment happens **only** in the signature-verified
  `checkout.session.completed` webhook, idempotently.
- **Never** use Stripe Billing, recurring Prices, or subscription webhooks.
- **Never** give VIP raw power: benefits are convenience and cosmetic only,
  never exclusive tradeable items or gold grants (that would let paying players
  mint tradeable value and wreck the economy).

---

## 8. Security Requirements

- Passwords hashed with **argon2** (preferred) or bcrypt. Never store plaintext.
- Session tokens as **httpOnly, secure, sameSite** cookies. If using JWT, keep expiry short and support revocation.
- **Validate every input with Zod** at the boundary. No unvalidated body reaches business logic.
- Rate limit per account and per IP on all mutating endpoints. Idle games are heavily botted — assume automation and design so that automation gains little.
- Authorization check on every request: does this player actually own this farm/plot/animal/item? Never derive ownership from a client-supplied field alone.
- Parameterized queries only (the ORM handles this — do not write raw string-concatenated SQL).
- CORS locked to known origins.
- Secrets in environment variables. Never commit `.env`. Never expose the Stripe secret key or webhook secret to the client.
- Log security-relevant events (failed logins, trade executions, VIP grants, refunds).

---

## 9. Assets

All art comes from the **licensed pack in `new_assets/`** by **EmanuelleDev**
(emanuelledev.itch.io): commercial use permitted, modification permitted,
resale/redistribution forbidden, **credit mandatory** — the exact terms and
the credit line live in `ATTRIBUTION.md`. The old `assets/` directory is
unlicensed and gets deleted during the Phase 7 migration; never reference it
in new code.

Pack contents actually used by the MVP:
- `Tileset/Tileset Grass Spring.png`, `Tilled Soil and wet soil.png`,
  `Water tile.png`, `Path tiles.png` — terrain, soil states, water, paths
- `Crops/Spring/*.png` — crop strips (128×16, 8 frames each): Potato,
  Strawberry, Onion, Spring Onion (used as "leek"), plus 9 more for later
- `Character/Character/PNG/<anim>/<layer>/<variant>.png` — the **layered
  character**: single-row 32px strips per animation per layer (Skins, Eyes,
  Hair, Clothers/Farm, Acc). MVP animations: Idle, Walk, Run,
  Pickaxe/Hoe, Watering. Layers are loaded dynamically per player
  appearance, never all at once.
- `Objects/Exterior/` — Tiny House, shipping box, chest, mailbox; Farm
  Buildings (Chicken Coop, Barn, each with Big/Deluxe tiers)
- `Objects/Tree/Common/` — Maple Tree + animation (the MVP's single tree)
- `Animals/Farm/` — chickens (13 colors + babies), cows (multiple variants)
- `Icons/RPG icons/Weapons and Armor/1. Wood/` — tool icons (9 tiers exist;
  MVP uses Wood only — see D-4)
- `Icons/Farm Animals`, `Icons/Food Icons` — item icons
- `UI/` — Inventory Book/Slots, HUD, Money, buttons, dialogue box

### Asset rules
- Load spritesheets via the manifest; define frame data in config
  (`packages/shared/src/config/assets.ts`), not hardcoded in scenes. Measured
  geometry (frame sizes, direction order, feet offsets) is recorded as named
  constants with tests — measure, never guess.
- Author tilemaps in the in-repo **mapmaker** (`apps/mapmaker`), export
  Tiled-JSON, load in Phaser. Do not hand-place tiles in code.
- Keep the single `assets.ts` manifest listing every key so nothing is loaded
  by magic string. (Exception: character layer strips are keyed by a naming
  convention because they load dynamically per appearance.)
- Every art addition to the client goes through `scripts/prepare-assets.mjs`
  (copies from `new_assets/` into `apps/client/public/assets/`).

---

## 10. Coding Conventions

- **TypeScript strict mode on.** No `any` without a written justification comment.
- Feature-folder structure on the server (`modules/farm`, `modules/trade`), not layer-folders.
- Business logic lives in services, not in route handlers. Route handlers only parse, authorize, call, and respond.
- Shared types are defined once in `packages/shared` and imported by both sides. Never duplicate a type definition.
- Errors: use a typed error class with a machine-readable code. The client should be able to react to `INVENTORY_FULL` without string-matching an English message.
- All timestamps are **epoch milliseconds, UTC**. No local time anywhere in the data layer.
- All currency and item quantities are **integers**. No floats for gold, ever.

---

## 11. Testing Requirements

- Unit tests for all growth/production time calculations
- Unit tests for economy math (buy, sell, upgrade costs)
- **Integration tests for trade** covering: happy path, offer changed after confirm, item removed mid-trade, concurrent trades with the same item, inventory full on receipt
- Integration tests for Stripe webhook: valid signature, invalid signature, duplicate delivery, refund
- Load/soak test the farm-state endpoint — it will be the hottest path

---

## 12. Development Phases

Phases 1–6 (auth, core loop, progression, trading, VIP, part of polish) are
**complete** — see `docs/ROADMAP-v1.md` for the full record. The live plan is
`ROADMAP.md`, which carries the live Phase 7–14 breakdown and every task.
Read it before starting work; do not restate its contents here.

---

## 13. Definition of Done (per feature)

A feature is not done until:
1. Server validates the action independently of the client
2. All multi-row mutations are transactional
3. Inputs are Zod-validated and the endpoint is rate limited
4. Ownership/authorization is checked
5. Types are shared, not duplicated
6. Tests cover the failure paths, not just the happy path
7. Errors return machine-readable codes
8. Nothing exploitable is exposed to the client

---

## 14. Open Decisions

Track these; do not let them be silently decided in code.

The live version of this list, with the tasks each one blocks, is the **Open
Decisions** table at the top of `ROADMAP.md`. Keep the two in step.

### Still open

D-1 through D-6 live **only** in the `ROADMAP.md` table — status, rationale,
and the constant each one pins. Do not copy them back here.

The two below are tracked here because `ROADMAP.md` does not carry them:

- **VIP price point.** Not set. The amount lives in the Stripe dashboard
  behind `STRIPE_VIP_PRICE_ID` and must never be hardcoded in this repo; the
  `purchases` row records what Stripe actually charged. The *multipliers* are
  set in `config/vip.ts` (`durationPercent: 80`) and are tunable, not
  blocking.

### Decided

- **Trade restrictions for brand-new accounts** — a player may not open or
  accept a trade until their account is at least **24 hours old** *and* their
  farm has reached **level 5**. Both conditions, checked for both parties, at
  invite time and again at execution. Constants: `TRADE_MIN_ACCOUNT_AGE_MS` and
  `TRADE_MIN_FARM_LEVEL` in `config/economy.ts`. Rationale: makes
  throwaway-account scamming expensive to run at any scale.
