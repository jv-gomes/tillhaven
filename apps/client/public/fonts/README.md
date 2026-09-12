# Bundled fonts

Three typefaces, all **SIL Open Font License 1.1**. Two pixel faces from Phase
U, and one text face added in Phase U3 for the things a pixel face cannot set.

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
| `bitter-latin.woff2` | Bitter | 400–700 (variable) | latin |
| `bitter-latin-ext.woff2` | Bitter | 400–700 (variable) | latin-ext |

108 KB total, of which **Bitter is 65 KB** — a text face carries far more glyph
outlines than a pixel display face, and that is the price of paragraphs that
are not `system-ui`. The cyrillic and vietnamese subsets Google also serves are
**not** bundled — the game ships no copy in either, and an unused subset is
bytes on every first load.

## What each one is for

Pixelify Sans and Silkscreen are drawn on fixed grids (10px and 8px) and stay
crisp only at integer multiples of them, which is why `ui.css` sizes them in
whole pixels. That makes them right for chrome and wrong for body copy, which
reflows at every viewport. **Bitter is the body face** — a low-contrast slab,
drawn for screens, whose rectangular serifs sit beside pixel stems without
fighting them.

## Provenance

Fetched from the Google Fonts CDN (`fonts.gstatic.com`): Pixelify Sans v3,
Silkscreen v6, Bitter v42. Licence texts are the upstream `OFL.txt` from
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
- **The Reserved Font Names may not be reused.** If any font here is ever
  modified — subsetted further, hinted, patched — the result must not be called
  "Pixelify Sans", "Silkscreen" or "Bitter Pro". Re-subsetting is the realistic
  case; rename the file *and* the `font-family` if it happens. Note that
  Bitter's reserved name is "Bitter Pro", not the family name it ships under.
- The fonts may not be sold on their own. Not a risk here.

## Replacing or updating one

Update the table above, the `@font-face` blocks in `styles/ui.css`, the row in
`ATTRIBUTION.md`, and the entry in `config/credits.ts` — in the same commit.
`config.test.ts` asserts every `.woff2` in this directory has both a `CREDITS`
row and a licence file, so a font added without its paperwork fails the build
rather than shipping unattributed.
