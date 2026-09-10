# Bundled fonts

Two pixel typefaces, both **SIL Open Font License 1.1**. Added in Phase U.

**These are committed, unlike `public/assets/`.** The art pack forbids
redistribution, so it is gitignored and copied in by hand. The OFL explicitly
*permits* redistribution — it is the licence's whole purpose — so the fonts live
in the repo and a fresh clone renders correctly without a manual step.

| File | Family | Weight | Subset |
|---|---|---|---|
| `pixelify-sans-latin.woff2` | Pixelify Sans | 400–700 (variable) | latin |
| `pixelify-sans-latin-ext.woff2` | Pixelify Sans | 400–700 (variable) | latin-ext |
| `silkscreen-400-latin.woff2` | Silkscreen | 400 | latin |
| `silkscreen-400-latin-ext.woff2` | Silkscreen | 400 | latin-ext |
| `silkscreen-700-latin.woff2` | Silkscreen | 700 | latin |
| `silkscreen-700-latin-ext.woff2` | Silkscreen | 700 | latin-ext |

43 KB total. The cyrillic subsets Google also serves are **not** bundled — the
game ships no Cyrillic copy, and an unused subset is bytes on every first load.

## Provenance

Fetched from the Google Fonts CDN (`fonts.gstatic.com`), Pixelify Sans v3 and
Silkscreen v6. Licence texts are the upstream `OFL.txt` from
`github.com/google/fonts`, copied verbatim as `*-OFL.txt` beside the fonts —
the OFL requires the licence to travel with the font.

## They are self-hosted, and that is deliberate

Nothing at runtime touches `fonts.googleapis.com` or `fonts.gstatic.com`. A
`<link>` to Google Fonts would leak every player's IP and page visit to a third
party, need a CSP exception, and put a render-blocking request to someone else's
infrastructure in front of the game loading. `styles/ui.css` declares the
`@font-face` blocks against these local files.

## Obligations, and what they forbid

- The licence text ships alongside the fonts. ✅ (`*-OFL.txt`, served from
  `/fonts/` like the rest of this directory.)
- Credit is given. ✅ (`ATTRIBUTION.md`, and the in-game `/credits` page, which
  renders `CREDITS` from `packages/shared/src/config/credits.ts`.)
- **The Reserved Font Names may not be reused.** If either font is ever
  modified — subsetted further, hinted, patched — the result must not be called
  "Pixelify Sans" or "Silkscreen". Re-subsetting is the realistic case; rename
  the file *and* the `font-family` if it happens.
- The fonts may not be sold on their own. Not a risk here.

## Replacing or updating one

Update the table above, the `@font-face` blocks in `styles/ui.css`, the row in
`ATTRIBUTION.md`, and the entry in `config/credits.ts` — in the same commit.
`config.test.ts` asserts every `.woff2` in this directory has both a `CREDITS`
row and a licence file, so a font added without its paperwork fails the build
rather than shipping unattributed.
