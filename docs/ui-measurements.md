# UI measurements

Every UI sheet in the pack, measured rather than assumed. **Regenerate with
`node scripts/measure-ui.mjs --md`** — the tables below are that command's
output, pasted, so a hand-typed nine-slice inset cannot become a smeared corner
on every panel in the game.

## Why this task existed

`hud.css` carried this note for three phases:

> The pack's plate WAS tried as a `border-image` 9-slice and does not work:
> `border-image` slices from the source image's own outer edges, and the plate
> is a 48x16 region at (0,16) of an 848x544 sheet, so a 5px slice takes pixels
> from four unrelated corners of the sheet.

That diagnosis was right, and the conclusion drawn from it — draw the bevel in
CSS instead — was the expensive part. The fix is to give each frame its own
file, which needs an encoder (`scripts/lib/png.mjs`) and a table of rectangles
(`scripts/lib/ui-crops.mjs`). This document is the evidence that the table is
correct.

## How each number is decided

- **Pieces** — rectangles of art separated by fully transparent gutters, found
  by decomposing into non-empty row runs and then non-empty column runs inside
  each. Two sheets have **no gutters at all** (`0.2.png`, `dialogue box.png`)
  and report a single piece; their crops are hand-read and flagged `handCut`.
- **Frame grid** — reported only when every piece is the same size *and* the
  spacing between origins is constant on both axes. `Bars.png` has equal-width
  bars at unequal spacing, and calling that a grid would misplace every frame
  after the first.
- **Slice** — the distance from each edge to the first pair of identical
  adjacent rows (or columns). This is the definition rather than a heuristic:
  `border-image` stretches the middle band, and stretching is lossless exactly
  where consecutive lines repeat. A frame whose middle never repeats is
  reported as **not sliceable** instead of being given a plausible number.

## What the measurement overturned

- **The button plates are a uniform grid, and nobody had said so.** Eleven
  colour families at pitch 48, each with an "up" plate at `y=16+48k` and a
  pressed plate 17px below. Every up plate is exactly 764 opaque pixels and
  every pressed plate 716 — that uniformity is what makes the grid real rather
  than a pattern imposed on the art.
- **The pressed plate is 15 tall, not 16.** The art drops the button by a pixel
  rather than redrawing it, so `:active` shifts the element down 1px too.
  Faking the press with a transform would fight art that already contains it.
- **The plate fills ARE the HUD palette.** Plate 0 measures `#ae4924` — the
  exact value `hud.css` records as "the pack's signature rust… sampled
  `#ae4924`" before darkening it 4.5% for contrast — and plate 1 is `#c46120`,
  which is `--soil` verbatim. T-15.26 sampled the tokens off these plates, so
  putting the plates back under the buttons closes a loop rather than
  introducing a palette.
- **Exactly one frame in the pack is symmetric on all four sides**:
  `Inventory/inventory.png` at (0,64), 48x48, slice 6. That is why it is the
  panel frame for every window in the HUD — anything asymmetric develops a
  visible bias when stretched to panels of different shapes.
- **`Inventory/Book.png` is still not a panel background.** It measures
  238x144 of art on a 256x288 canvas with slice `19 14 24 14` — a fixed-size
  landscape two-page spread. `hud.css` already recorded that it cannot back
  stacked grids without stretching pixel art; the measurement agrees.

  **U3-8 re-derived this independently and can now name the mechanism.** The
  measured slice is correct — the middle band really is where stretching is
  lossless — but the middle band contains **the spine**, a one-pixel-wide
  feature that has to stay in the centre. `border-image` has no mode that
  keeps a centred feature centred: `stretch` smears the spine across the
  panel, and `repeat`/`round` tile it into several spines. That is the same
  shape of trap as `ui-well.png` (measured inset 4, body 16px thick) and the
  second member of a family worth naming: *a frame can measure sliceable and
  still not be a frame.*

  Cropping the left page alone (x1-119) **would** slice correctly, since the
  spine becomes an edge rather than a middle — but a one-page book puts the
  gilt ornaments down one side only, which reads as a panel missing half its
  art rather than as a book.

  So `.pack` keeps drawing the book in CSS from colours sampled off this file
  (`--page`, `--cover`, `--gilt` in `hud.css`), which is the right answer and
  was already the answer. `UI_INVENTORY_BOOK` stays declared in `assets.ts`
  and unused: removing it from `IMAGES` would save one texture load and risk
  shifting Tiled `firstgid`s, which is a bad trade for a phase that is not
  otherwise touching the manifest.

## The measurements

## Sheets

| Sheet | Size | Pieces | Frame grid |
|---|---|---|---|
| `0.2.png` | 240x64 | 1 (one piece — hand-cut) | — irregular |
| `Bars.png` | 192x160 | 30 | — irregular |
| `Clock/Clock.png` | 32x32 | 1 (one piece — hand-cut) | — irregular |
| `Clock/Extras.png` | 224x128 | 7 | — irregular |
| `Clock/Others/Clock 2.png` | 160x144 | 15 | 5x3 @ 31x41 (pitch 32x48) |
| `Clock/Others/Clock 3.png` | 96x96 | 9 | 3x3 @ 31x30 (pitch 32x32) |
| `Clock/Others/clock 4.png` | 96x96 | 9 | 3x3 @ 30x29 (pitch 32x32) |
| `Clock/Others/clock.png` | 192x96 | 18 | 6x3 @ 30x29 (pitch 32x32) |
| `Clock/clock hand.png` | 256x32 | 8 | — irregular |
| `Extras.png` | 368x128 | 23 | — irregular |
| `HUD.png` | 416x96 | 101 | — irregular |
| `Inventory/Banner.png` | 112x256 | 39 | — irregular |
| `Inventory/Book.png` | 256x288 | 2 | — irregular |
| `Inventory/Decor.png` | 96x32 | 28 | — irregular |
| `Inventory/Extras.png` | 384x256 | 96 | — irregular |
| `Inventory/Slot Armor.png` | 384x64 | 24 | — irregular |
| `Inventory/Slots.png` | 224x288 | 12 | — irregular |
| `Inventory/inventory.png` | 112x112 | 12 | — irregular |
| `Money.png` | 96x16 | 6 | — irregular |
| `UI music.png` | 96x96 | 5 | — irregular |
| `button.png` | 848x544 | 51 | — irregular |
| `dialogue box.png` | 144x96 | 1 (one piece — hand-cut) | — irregular |
| `social network logos.png` | 192x32 | 2 | — irregular |
| `speech bubble, emojis, reaction.png` | 144x336 | 60 | — irregular |
| `weather icons.png` | 160x48 | 21 | — irregular |

## The crops

| Output | Source | Rect | Slice (t r b l) | What it is |
|---|---|---|---|---|
| `ui-plate-rust.png` | `button.png` | 48x16 @ (0,16) | 3 3 5 3 | the signature plate — primary actions (fill #ae4924) |
| `ui-plate-rust-down.png` | `button.png` | 48x15 @ (0,33) | 3 3 4 3 | rust, pressed — 15 tall, the art drops it a pixel |
| `ui-plate-soil.png` | `button.png` | 48x16 @ (0,64) | 3 3 5 3 | = --soil; secondary actions (fill #c46120) |
| `ui-plate-soil-down.png` | `button.png` | 48x15 @ (0,81) | 3 3 4 3 | soil, pressed — 15 tall, the art drops it a pixel |
| `ui-plate-sand.png` | `button.png` | 48x16 @ (0,112) | 3 3 5 3 | light neutral; quiet/disabled actions (fill #d9a88a) |
| `ui-plate-sand-down.png` | `button.png` | 48x15 @ (0,129) | 3 3 4 3 | sand, pressed — 15 tall, the art drops it a pixel |
| `ui-plate-cyan.png` | `button.png` | 48x16 @ (0,160) | 3 3 5 3 | the one cool family in the pack (fill #2eafc7) |
| `ui-plate-cyan-down.png` | `button.png` | 48x15 @ (0,177) | 3 3 4 3 | cyan, pressed — 15 tall, the art drops it a pixel |
| `ui-plate-moss.png` | `button.png` | 48x16 @ (0,208) | 3 3 5 3 | confirm / positive (fill #a4c93c) |
| `ui-plate-moss-down.png` | `button.png` | 48x15 @ (0,225) | 3 3 4 3 | moss, pressed — 15 tall, the art drops it a pixel |
| `ui-plate-lime.png` | `button.png` | 48x16 @ (0,256) | 3 3 5 3 | confirm, brighter (fill #c0d83c) |
| `ui-plate-lime-down.png` | `button.png` | 48x15 @ (0,273) | 3 3 4 3 | lime, pressed — 15 tall, the art drops it a pixel |
| `ui-plate-blush.png` | `button.png` | 48x16 @ (0,304) | 3 3 5 3 | soft warning (fill #ffb8a8) |
| `ui-plate-blush-down.png` | `button.png` | 48x15 @ (0,321) | 3 3 4 3 | blush, pressed — 15 tall, the art drops it a pixel |
| `ui-plate-pink.png` | `button.png` | 48x16 @ (0,352) | 3 3 5 3 | destructive / cancel (fill #ffaab0) |
| `ui-plate-pink-down.png` | `button.png` | 48x15 @ (0,369) | 3 3 4 3 | pink, pressed — 15 tall, the art drops it a pixel |
| `ui-plate-amber.png` | `button.png` | 48x16 @ (0,400) | 3 3 5 3 | gold and currency (fill #ff9d0e) |
| `ui-plate-amber-down.png` | `button.png` | 48x15 @ (0,417) | 3 3 4 3 | amber, pressed — 15 tall, the art drops it a pixel |
| `ui-plate-honey.png` | `button.png` | 48x16 @ (0,448) | 3 3 5 3 | gold, softer (fill #eea841) |
| `ui-plate-honey-down.png` | `button.png` | 48x15 @ (0,465) | 3 3 4 3 | honey, pressed — 15 tall, the art drops it a pixel |
| `ui-plate-clay.png` | `button.png` | 48x16 @ (0,496) | 3 3 5 3 | warm neutral (fill #e6965b) |
| `ui-plate-clay-down.png` | `button.png` | 48x15 @ (0,513) | 3 3 4 3 | clay, pressed — 15 tall, the art drops it a pixel |
| `ui-panel.png` | `Inventory/inventory.png` | 48x48 @ (0,64) | 6 6 6 6 | THE panel frame — rounded, warm, and the only piece in the pack whose insets are symmetric on all four sides, so it scales to any panel shape without a visible bias. Every window in the HUD is this. |
| `ui-well.png` | `Inventory/Banner.png` | 48x48 @ (0,48) | 4 4 4 4 | A frame with a transparent middle — an inset well for grids and lists to sit in, so a panel can have depth without a second background colour. |
| `ui-slot.png` | `Inventory/inventory.png` | 18x18 @ (7,41) | 3 3 3 3 | Inventory cell. Symmetric, unlike the Slots.png strip the HUD uses today. |
| `ui-slot-tight.png` | `Inventory/inventory.png` | 18x18 @ (39,41) | 2 2 2 2 | The same cell with a thinner border — the hotbar, where 12 sit in a row. |
| `ui-select.png` | `Inventory/Banner.png` | 42x42 @ (67,3) | 5 5 5 5 | Corner brackets on a transparent middle: the selected hotbar slot, and the focus ring. It overlays a cell rather than replacing it, so selection and contents are separate layers. |
| `ui-focus.png` | `Inventory/Banner.png` | 42x42 @ (67,211) | 5 5 5 5 | The dashed variant of the above — keyboard focus, distinct from selection. |
| `ui-dialogue.png` | `dialogue box.png` | 48x48 @ (0,0) | 5 5 5 5 | The scalloped box. HAND-CUT: this sheet has no transparent gutters at all, so the 48x48 rectangle cannot be recovered by decomposition — it was found by sweeping candidate sizes and taking the one whose insets come out symmetric (40 and 46 do not; 48 does). Used for dialogue and for the item tooltips, which is why it is worth the hand-cut. |
| `ui-rail.png` | `Inventory/Slots.png` | 164x28 @ (6,105) | 10 8 5 8 | The dark bar: panel headers and the HUD strip. Asymmetric on purpose — the art is lit from above, so the top inset is twice the bottom. |

