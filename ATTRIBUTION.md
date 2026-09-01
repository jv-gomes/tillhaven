# Attribution

Every third-party asset used in Tillhaven, and its licence.

## Art

All game art comes from one licensed pack, stored in `new_assets/` and copied
into `apps/client/public/assets/` by `scripts/prepare-assets.mjs`.

### Farm RPG Asset Pack — EmanuelleDev

- **Author:** EmanuelleDev
- **Source:** <https://emanuelledev.itch.io>
- **Contact:** farmrpgassetpack@gmail.com
- **Licence** (full version, from the pack's `Documentation.txt`, verbatim):

  > These asset packs can be used in any commercial or non-commercial
  > project. You are free to modify the assets as you like. However, these
  > asset packs cannot be resold or redistributed, even if modified.
  >
  > Credits are mandatory: You can credit me by linking to my Itch.io page:
  > emanuelledev.itch.io.
  >
  > You can be credited as "EmanuelleDev".

- **Credit requirement:** ✅ mandatory, and satisfied — the in-game credit
  string is exported as `CREDITS` from `packages/shared/src/config/` (added
  in T-7.01) and must appear wherever the game shows credits. This file is
  the canonical record.
- **Redistribution note:** because redistribution is forbidden, the
  `new_assets/` directory must **not** be committed to any public repository.
  Only the subset actually shipped inside the built client is distributed as
  part of the game, which the licence's commercial-use grant covers.

Subfolders in use (MVP):

| Folder | Used for |
|---|---|
| `Tileset/` | Terrain (spring grass, water, paths), tilled + wet soil |
| `Crops/Spring/` | Crop growth strips and produce/seed icons |
| `Character/Character/PNG/` | Layered player character (skins, eyes, hair, clothes) — Idle, Walk, Run, Hoe, Watering animations |
| `Objects/Exterior/` | House, chest, shipping box, mailbox, coop, barn |
| `Objects/Tree/Common/` | Maple tree (+ animation) |
| `Animals/Farm/` | Chickens (adult + baby, all colors), cows |
| `Icons/RPG icons/` | Tool icons (wood tier) |
| `Icons/Farm Animals`, `Icons/Food Icons` | Item icons (egg, milk, feed, …) |
| `UI/` | Inventory panel art, HUD, money icon, buttons |

### Removed art

The previous `assets/` directory (unknown provenance, unconfirmed licence —
see `docs/ROADMAP-v1.md` T-6.07) is replaced by the pack above and deleted in
roadmap task T-7.07. Nothing from it may ship.

## Sound

None yet. See the Phase 14 backlog in `ROADMAP.md`.

## Fonts

None bundled. The site uses system font stacks only (`ui-monospace` and
`system-ui`), so there is nothing to licence.

## Software

Dependencies and their licences are in `pnpm-lock.yaml`. The notable ones —
Phaser (MIT), Fastify (MIT), Drizzle (Apache-2.0), Zod (MIT), Socket.IO
(MIT), Stripe SDK (MIT) — are all permissive.
