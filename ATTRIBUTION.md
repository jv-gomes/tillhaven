# Attribution

Every third-party asset used in Tillhaven, and its licence.

## Art

All game art comes from one licensed pack, stored in `assets/` and copied
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
  `assets/` directory must **not** be committed to any public repository.
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
| `UI/` | **The whole folder** (Phase U): panel and slot frames, the timber plank, button plates, bars, tags, the dialogue box, clocks, weather and emotes |
| `UI/Inventory/`, `UI/Clock/` | Nine-slice sources cut by `scripts/lib/ui-crops.mjs` |

### Removed art

The previous `assets/` directory (unknown provenance, unconfirmed licence —
see `docs/ROADMAP-v1.md` T-6.07) is replaced by the pack above and deleted in
roadmap task T-7.07. Nothing from it may ship.

## Sound

None yet. See the Phase 14 backlog in `ROADMAP.md`.

## Fonts

Three bundled typefaces, all **SIL Open Font License 1.1**. Two were added in
Phase U; Bitter joined them in Phase U3, when the site stopped using system
fonts.

Until then the answer here was "none bundled — the site uses system font stacks
only, so there is nothing to licence", and `hud.css` recorded the reason: adding
a face "would mean a second licence in ATTRIBUTION.md for a decision nobody has
taken yet". The decision was taken; this is that second licence.

The files live in `apps/client/public/fonts/` and — unlike the art pack — **are
committed**. The OFL exists to permit redistribution, so there is no reason to
make a fresh clone fetch them by hand. See that directory's `README.md` for
provenance and subsetting notes.

### Pixelify Sans — interface text

- **Author:** The Pixelify Sans Project Authors
- **Source:** <https://github.com/eifetx/Pixelify-Sans>
- **Licence:** SIL Open Font License 1.1, shipped verbatim as
  `apps/client/public/fonts/pixelify-sans-OFL.txt`
- **Files:** `pixelify-sans-latin.woff2`, `pixelify-sans-latin-ext.woff2`
  (variable, weights 400–700)

### Silkscreen — labels and buttons

- **Author:** The Silkscreen Project Authors
- **Source:** <https://github.com/googlefonts/silkscreen>
- **Licence:** SIL Open Font License 1.1, shipped verbatim as
  `apps/client/public/fonts/silkscreen-OFL.txt`
- **Files:** `silkscreen-{400,700}-latin.woff2` and their `-ext` pairs

### Bitter — body text

- **Author:** The Bitter Project Authors
- **Source:** <https://github.com/solmatas/BitterPro>
- **Licence:** SIL Open Font License 1.1, shipped verbatim as
  `apps/client/public/fonts/bitter-OFL.txt`
- **Files:** `bitter-latin.woff2`, `bitter-latin-ext.woff2` (variable, weights
  400–700)
- **Reserved Font Name:** "Bitter Pro" — note that this differs from the family
  name, so the caveat below applies to that string, not to "Bitter".

### The obligations, and what they forbid

- The licence text ships alongside the fonts. ✅
- Credit is given. ✅ — `packages/shared/src/config/credits.ts` is the canonical
  list, rendered at `/credits`. `config.test.ts` fails the build if a `.woff2`
  in `public/fonts/` has no credit row or its licence file is missing.
- **Reserved Font Names may not be reused on a modified copy.** If any of the
  three is ever re-subsetted, hinted or patched, the result must not be called
  "Pixelify Sans", "Silkscreen" or "Bitter Pro" — rename the file *and* the
  `font-family`.
- The fonts may not be sold on their own.
- They are **self-hosted**; nothing at runtime requests `fonts.googleapis.com`
  or `fonts.gstatic.com`, so no player's IP is handed to a third party.

## Software

Dependencies and their licences are in `pnpm-lock.yaml`. The notable ones —
Phaser (MIT), Fastify (MIT), Drizzle (Apache-2.0), Zod (MIT), Socket.IO
(MIT), Stripe SDK (MIT) — are all permissive.
