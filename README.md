# Tillhaven

A browser-based idle farming game. Plant before work, harvest at lunch — crops
grow on real-world time, so a closed tab is just another few hours in the field.

- **[CLAUDE.md](./CLAUDE.md)** — architecture and the rules that cannot be broken
- **[ROADMAP.md](./ROADMAP.md)** — the task list; start with the lowest unchecked one
- **[docs/economy.md](./docs/economy.md)** — every gold faucet and sink

## Status

**Phases 1–6 of the original plan are complete** (see
[docs/ROADMAP-v1.md](./docs/ROADMAP-v1.md)): accounts, four crops with
offline growth, animals with maturation and feeding, slot inventory + chest,
NPC shop, plot/house/chest upgrades, player-to-player trading (atomic,
audited), and one-time VIP purchases via Stripe. 540+ server tests.

**Now in progress: the Stardew pivot** ([ROADMAP.md](./ROADMAP.md), Phases
7–13) — a new licensed art pack, a customizable character that farms with
tools (till → plant → water → harvest), a hotbar, Stardew-style
chest/backpack panel, merchant + shipping-box selling, and an **idle mode**
where the character farms autonomously, server-simulated so it works while
the tab is closed.

Offline progression needs no background job anywhere — state stores
timestamps and the server derives the rest on read.

### The map editor

Maps are authored in **`apps/mapmaker`**, an in-repo drag-and-drop tile editor,
rather than in the external Tiled application. It still exports Tiled-format
JSON, so Phaser loads it with `load.tilemapTiledJSON` and the file can be opened
in Tiled if you ever want to.

```bash
pnpm dev:mapmaker             # editor on :5174
```

Paint terrain, drag objects onto the map, mark which cells are farm plots, then
**Save to project** — it writes `apps/client/public/tilemaps/farm.json` directly.
After changing plot markers, run `pnpm plots` to regenerate the layout the
server builds new farms from. See [apps/mapmaker/README.md](./apps/mapmaker/README.md).

### Running the tests

`pnpm test` uses its **own** database (`tillhaven_test`), created and migrated
automatically. The suite truncates every table between tests, so it refuses to
run against any database whose name does not end in `_test` — your development
farm is safe.

## Getting started

```bash
pnpm install
cp .env.example .env          # then fill in SESSION_SECRET
pnpm assets                   # copy + clean art from assets/ into the client
docker compose up -d          # postgres + redis
pnpm dev                      # client on :5173, server on :3000
```

Then open http://localhost:5173.

| Route | What it is |
|---|---|
| `/` | Landing page |
| `/login` | Sign in |
| `/register` | Create an account |
| `/play` | The game |

The Vite dev server proxies `/api` to the Fastify server, so both run on one
origin and session cookies behave the way they will in production.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Client and server in watch mode |
| `pnpm build` | Production build of all packages |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | All tests |
| `pnpm assets` | Regenerate `apps/client/public/assets/` from `assets/` |
| `pnpm db:up` / `db:down` | Postgres + Redis via Docker |

## Layout

```
apps/client      Phaser 3 + Vite. Four HTML entries; Phaser loads only on /play
apps/server      Fastify + Drizzle + Postgres. The authority on everything
packages/shared  Config, types, Zod schemas, error codes — imported by both
assets/          Source art. Read-only; `pnpm assets` copies and cleans it
scripts/         Build tooling
```

## Two things that will trip you up

**`assets/` is the master copy and is never edited in place.** `pnpm assets`
writes to `apps/client/public/assets/` (gitignored). It also *cleans* the spring
tileset, whose left 128px are opaque black padding rather than transparency —
loaded raw it renders a black slab.

**Crop sprite frames are 16×32, not square.** The art sits in the bottom half so
plants grow upward out of their tile. Slice them at 32×32 and every frame shows
half of its neighbour. `packages/shared/src/config/assets.ts` has the measured
numbers for every sheet, and `config.test.ts` fails the build if a declared grid
stops matching its image.

## Architecture in one paragraph

The client sends intents, never results — `harvest(plotId)`, never
`addGold(500)`. The server validates every intent against the database before
writing anything. Growth is not ticked by a background loop: plots store
timestamps and the server derives the stage on read, which is what makes offline
progression exact and the farm endpoint stateless. Anything touching more than
one row runs in a single transaction. `CLAUDE.md` has the full set.
