# Art measurements for the Spring MVP

Every number here is measured from `assets/` (the licensed pack), not read off
a spec. Regenerate the terrain half with:

```
node scripts/measure-terrain.mjs        # human-readable
node scripts/measure-terrain.mjs --json # machine-readable
```

The crop, UI and clock findings below were measured with one-off probes and are
recorded rather than regenerated — they are structural facts about the sheets,
not numbers that drift.

---

## The finding that unblocks the whole re-scope

**T-7.05's conclusion is no longer true.** It measured the pack's tilesets,
found only *self-contained rounded patches — never art that fills its cell edge
to edge*, and concluded the game had to draw its own flat ground tiles
(`scripts/draw-ground-tiles.py`, and the `GROUND_*` entries in `assets.ts`).

That was measured on the **incomplete** copy of the pack. The complete one has
whole bands of fully-opaque tiles and pure single-colour fills. The ground can
come from the pack, and the first-party stand-ins can go.

This is worth stating plainly because the old comment is still in `assets.ts`
and reads as a settled fact.

---

## `Tileset Grass Spring.png` — 384x640 (24x40 tiles)

Two identical 12-column halves. **Left half (cols 0-11) is light grass, right
half (cols 12-23) is deep grass** — the same layout twice in two tones.

Vertically, four bands:

| Rows | Material | Opaque? |
|---|---|---|
| 0-7 | grass terrain set | partial — edge pieces meant to sit on something |
| **8-15** | **orange dirt `#ee9d51`** | **fully opaque** |
| 16-23 | grass with detail variants (flowers, pebbles) | partial |
| 24-27 | near-black `#0d0e13` | fully opaque |
| 28-35 | grass, duplicate of 16-23 | partial |
| 36-39 | near-black, duplicate of 24-27 | fully opaque |

**Flat fills** (fully opaque, one or two colours — the tile a large area is
painted with):

| Tile | Frame | Colour | Use |
|---|---|---|---|
| (9,2) | 57 | `#79bf56` light grass | the farm's base ground |
| (21,2) | 69 | `#32ad53` deep grass | second grass tone |
| **(9,14)** | **345** | **`#ee9d51` orange** | **the tillable area** |
| (21,14) | 357 | `#ee9d51` | same colour, right half |
| (9,26), (21,26) | 633, 645 | `#0d0e13` | near-black, unused |

`#79bf56` is exactly the colour `GROUND_GRASS` was hand-drawn as, which is a
useful cross-check: the stand-in was sampled from this sheet in the first place.

**The orange section is rows 8-15**, and it is the only fully-opaque *coloured*
band in the sheet. That is the "more orange-hued part" the tillable area uses.

## `Tileset Grass Cliff Tileset Spring.png` — 320x192 (20x12 tiles) — NOT USED

Two 6-row halves, cols 0-11 used and cols 12-19 mostly empty. Flat fills at
(9,2) `#79bf56` and (9,8) `#32ad53` — **the same two grass tones and the same
flat-fill position as `Tileset Grass Spring`**, so it adds no ground the farm
does not already have.

It was added to the manifest and removed the same day. Its edge pieces are the
transition from a grass top to a cliff FACE — they edge a change in *height*,
and the farm is flat, so there is nothing for them to edge. Shipping it unused
would have been inert art, which the roadmap's own rule forbids. It comes back
the day the map gains elevation.

## `Tilled Soil and wet soil.png` — 384x128 (24x8 tiles)

**Four blocks, and only the two brown ones are used.**

| Cols | Rows | Colour | Use |
|---|---|---|---|
| **0-11** | **0-3** | **`#be6d47` brown** | **dry tilled soil** |
| **12-23** | **0-3** | **`#9d4c46` dark brown** | **wet tilled soil** |
| 0-11 | 4-7 | `#767ede` blue | unused |
| 12-23 | 4-7 | `#4b5096` dark blue | unused |

**Why the blue rows are unused, independently confirmed twice.** The pack's own
"wet soil" is a blue-violet. T-15.29 tried it, found it *"read as shallow water
on a watered plot"*, and hand-darkened the dry soil instead. The pack also
ships a **darker brown** set, which is the same answer the pack's own artist
reached — so wet soil is `#9d4c46` and no hand-drawn tile is needed.

### The 16-mask autotile

**Cols 0-3 x rows 0-3 is a complete 4x4 wang set** — all sixteen neighbour
masks, no gaps. The wet set is the identical layout at **cols 12-15**, i.e.
dry + 12 columns. Cols 4-11 are decorated variants of the same masks.

Bit order `N E S W` (bit 3 = north). Frame numbers are into the full 24-wide
sheet:

| Mask | N E S W | Dry frame | Wet frame |
|---|---|---|---|
| 0 | — | 72 | 84 |
| 1 | W | 75 | 87 |
| 2 | S | 0 | 12 |
| 3 | S W | 3 | 15 |
| 4 | E | 73 | 85 |
| 5 | E W | 74 | 86 |
| 6 | E S | 1 | 13 |
| 7 | E S W | 2 | 14 |
| 8 | N | 48 | 60 |
| 9 | N W | 51 | 63 |
| 10 | N S | 24 | 36 |
| 11 | N S W | 27 | 39 |
| 12 | N E | 49 | 61 |
| 13 | N E W | 50 | 62 |
| 14 | N E S | 25 | 37 |
| 15 | all | 26 | 38 |

Derived by sampling each tile's four edge midpoints and asking whether the fill
colour reaches the edge — an open edge means a soil neighbour on that side.

This replaces `GROUND_SOIL_TILES`, which encoded the same 16 masks in a
generated 2-row strip.

## Water — `Water Ground animations tiles.png` and `Water tile.png`

`Water tile.png` is a single fully-opaque tile of **`#0092dd`**.

`Water Ground animations tiles.png` is 384x256 (24x16) and holds **four
animation frames stacked vertically**, four rows each.

**The flat fill is the one thing that does NOT animate.** Comparing every cell
against its counterpart in the other three blocks: **92 cells change and the
flat `#0092dd` fill at (21,2) is not one of them** — it is a solid colour in
all four frames. The obvious pick for a water backdrop was therefore the one
tile that renders four identical images.

The backdrop uses **cell (18,1)** instead — open water with a moving sparkle,
fully opaque, six colours, frames **42, 138, 234, 330**. Forty-six animated
cells are fully opaque; this one is in the middle of the open-water region with
no shoreline detail, so it repeats across a screen without reading as a
pattern.

The static `Water tile.png` matches the animation's base colour exactly, so a
still tile and an animated one cannot disagree about what water looks like.

---

## `Crops/All Crops.png` — 416x288 (26x18 tiles)

**Three column-groups of 8, separated by an empty column** (cols 0-7, 9-16,
18-25). One crop per row.

Within a group, the columns are:

| Col | Contents |
|---|---|
| **0** | **the seed bag** — a sack silhouette, filled with the crop's own colours |
| 1 | the same bag with a white outline (the pack's usual "selected" variant) |
| 2 | the produce icon — byte-identical to frame 7 of the crop's own strip |
| 3-6 | per-crop, one distinct image each |
| 7 | a signpost/label board showing the crop |

Columns 0, 1 and 7 share one silhouette across every row; 2-6 differ per row.
That is what identifies 0 as the bag rather than a growth stage.

**Group 0, rows 2-13 are exactly the twelve `Crops/Spring/` crops**, identified
by hashing column 2 against frame 7 of each spring file:

| Row | Crop | Row | Crop |
|---|---|---|---|
| 2 | Strawberry | 8 | Parsnip |
| 3 | Spring Onion (the game's *leek*) | 9 | Cabbage |
| 4 | Potato | 10 | Cauliflower |
| 5 | Onion | 11 | Rice |
| 6 | Carrot | 12 | Broccoli |
| 7 | Blueberry | 13 | Asparagus |

The mapping is **derived, not typed** — the produce frame is a byte-exact
match, so the crop-to-row table can be regenerated rather than maintained.

**This retires a known defect.** `ICON_SEED_BAGS` (`UI/RPG icons/Extras/
Bags.png`) has seven sacks, and T-31.04 had to relax "every crop takes a
distinct seed bag" to "no bag carries more than `ceil(crops/bags)`" because
twenty crops could not have one each. With a bag per crop here, the
distinctness invariant can be restored.

---

## UI

### `UI/Clock/Clock.png` — 32x32

One piece, the full clock face.

### `UI/Clock/clock hand.png` — 256x32

**Eight 32x32 frames**, one hand position each, at x = 14, 46, 78, 110, 142,
170, 200, 234. Eight positions is a natural fit for eight phases of a day.

### `UI/Bars.png` — 192x160

Several bar tracks. The ones wide enough to be a progress bar:

| y | Size | Fill colour |
|---|---|---|
| 17 | 48x14 | `#eb262e` red |
| 49 | 48x15 | `#a7fce6` mint |
| 85 | 42x8 | `#80162b` dark red |
| 101 | 42x9 | `#1a8321` green |
| 116 | 42x9 | `#2eafc7` blue |
| 150 | 48x4 | `#eb262e` thin red |

**Green is already spoken for.** The XP bar fills with `--grass-deep`, and
`FLOAT_TINTS.xp` is `#79bf56`; an energy bar in `#1a8321` would read as more of
the same. The mint `#a7fce6` and blue `#2eafc7` are the candidates that stay
distinct from XP-green and from the gold chip's `#ee9d51`. Decided in the HUD
task, not here.

### `UI/HUD.png` — 416x96 (26x6 tiles)

Panel and frame pieces, all partially transparent. Not yet broken down —
measured when the HUD reskin needs it.

---

## Collision shapes — `scripts/measure-tile-masks.mjs`

Measured for the sub-tile collision work, which turns a tile's outline into
something a character can walk *into* rather than merely up to.

**Terrain masks are measured from COLOUR, not from alpha, and that is the whole
difference from `BUILDING_BODY_MASK`.** A building is drawn on transparency, so
"is there art here" and "is this solid" are the same question and alpha answers
both. A shoreline tile is fully opaque across its whole cell — half grass, half
water — so alpha says "solid everywhere" and means nothing. What makes a terrain
third impassable is that it is *water*, so the script counts pixels against a
water palette instead.

The palette is sampled from the pack: `#005ba7` (the shoreline sheet's blue),
`#8dfdff` (its foam), `#0092dd` (the flat `water-tile` fill) and `#2d594f`.

**`#2d594f` is a judgement call and is recorded as one.** It is the dark band
between the blue and the green — the shaded waterline. Counting it as water
changes `BORDER.shoreCorner`'s middle row from `...` to `#..`; nothing else
moves. It is counted as water because a character standing on the waterline
looks like a character standing *in* the water, while being stopped a pixel
early on a bank at the map's edge — outside `FARM_CONTENT`, where the player has
no reason to walk — costs nothing. It appears in no other sheet the map paints
with: `GRASS_FILL_FRAME` and `TILLABLE_FILL_FRAME` are single-colour cells
(`#79bf56` and `#ee9d51`, 256 pixels each), so there is no risk of it leaking
into ordinary ground.

The thirds are **6/5/5 pixels, not 5/5/5**. `TILE_SIZE / 3` is 5.33, so each
boundary is rounded rather than each width being fixed — a fixed
`floor(16/3) = 5` would leave the tile's last pixel in no third at all.

| Tile | Frame | Coverage per third | Mask |
|---|---|---|---|
| `BORDER.shore` (`tileset-grass-water-spring`) | 92 | 68/0/0 · 57/0/0 · 64/0/0 | `#..` `#..` `#..` |
| `BORDER.shoreCorner` (`tileset-grass-water-spring`) | 8 | 4/20/12 · 33/0/0 · 56/0/0 | `...` `#..` `#..` |
| `water-tile` flat fill | 0 | 100 everywhere | `###` `###` `###` |

**What this buys, concretely.** The shore tile is walkable today — the whole
cell, water included, because `isWaterKey` only calls the flat fill solid and
the bank is "somewhere you stand". With the mask, two thirds of it stay
walkable and the water strip does not. The flat fill measures all-solid, which
is exactly its current whole-tile behaviour: the change adds a shape where there
was none and takes nothing away.

