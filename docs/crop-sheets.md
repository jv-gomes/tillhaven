# Crop sheet measurements

Every crop sheet the MVP can use, measured rather than assumed. **Regenerate
with `node scripts/measure-crops.mjs --md`** — the table below is that command's
output, pasted, so a hand-typed frame index cannot become a crop that renders
its produce icon as a growth stage.

**Spring only.** The MVP has one season, so the script reads
`assets/Crops/Spring/` and the summer and fall folders are out of scope. The
combined atlas `Spring Crops.png` is skipped too: it is a contact sheet of the
whole season, and `assets.ts` points at the per-crop files.

## Why this task existed, and what it overturned

The brief that ordered this measurement said *"spring and fall sheets are
128x16 (8 frames); summer sheets are 160x16 (10)"* and told the task to
**confirm that rather than take it from the brief**. It was right to — measured
across all thirty sheets in the pack, three of the four claims were wrong (fall
was mixed, one spring sheet was 128x32, one summer sheet had eleven frames, and
eight sheets were 16x32 rather than 16x16).

Only the spring findings still matter, and they are enough to keep the lesson:

- **`Blueberry.png` is 128x32**, not 128x16 — a short plant drawn on a tall
  canvas.
- **Stage counts run from five to seven**, not a flat six.

`CropDef.stageFrames` is an explicit list rather than a computed range
(`crops.ts`) precisely so this costs nothing, and that decision is load-bearing
rather than theoretical. `frameHeight` is per-sheet in `SheetSpec`, which is
what a tall sheet would need.

## How each column is decided

- **Frames / frame size** — width and height divided by 16. A 32px-tall sheet
  is ambiguous (8 tall frames, or 16 short ones in two rows?) and is resolved
  by evidence, not by preference: either the art **crosses the horizontal
  seam** — which two independent 16x16 cells cannot do — or the **top band is
  entirely transparent**, which is headroom, because a row of eight blank
  frames is not a sequence. Both readings are printed with their evidence.
- **Growth stages** — every non-empty frame that is not the produce icon.
- **Produce** — the last non-empty frame whose art does **not** reach the
  bottom row of its frame. A growth stage stands in soil and is grounded; the
  picked produce floats. Stated as a rule so the output can be argued with.
- **Blank** — frames the pack left fully transparent. Trailing blanks are
  padding; a blank *inside* the growth run is flagged separately.

**The classifier checks itself.** The crops already in the game are measured
alongside the candidates, and the script asserts it reproduces what `crops.ts`
records for them (8 frames, stages 0-5, produce 7). Until they passed, none of
its answers about the other sheets were worth reading.

## The measurements

| Sheet | Size | Frames | Frame | Growth stages | Produce | Blank |
|---|---|---|---|---|---|---|
| `Spring/Asparagus.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4]` (5) | 7 | `[5,6]` |
| `Spring/Blueberry.png` | 128x32 | 8 | 16x32 **tall** | `[0,1,2,3,4,5]` (6) | 7 | `[6]` |
| `Spring/Broccoli.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4]` (5) | 7 | `[5,6]` |
| `Spring/Cabbage.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4,5,6]` (7) | 7 | — |
| `Spring/Carrot.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4,5]` (6) | 7 | `[6]` |
| `Spring/Cauliflower.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4,5]` (6) | 7 | `[6]` |
| `Spring/Onion.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4,5]` (6) | 7 | `[6]` |
| `Spring/Parsnip.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4]` (5) | 7 | `[5,6]` |
| `Spring/Potato.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4,5]` (6) | 7 | `[6]` |
| `Spring/Rice.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4,5]` (6) | 7 | `[6]` |
| `Spring/Spring Onion.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4,5]` (6) | 7 | `[6]` |
| `Spring/Strawberry.png` | 128x16 | 8 | 16x16 | `[0,1,2,3,4,5]` (6) | 7 | `[6]` |

Shapes seen:

- `8×16x16` — 11 sheet(s)
- `8×16x32` — 1 sheet(s)

Flagged (5):

- `Spring/Asparagus.png` — 5 growth stages, not the 6 every shipped crop has
- `Spring/Blueberry.png` — TALL frames 16x32 (empty top band (headroom))
- `Spring/Broccoli.png` — 5 growth stages, not the 6 every shipped crop has
- `Spring/Cabbage.png` — 7 growth stages, not the 6 every shipped crop has
- `Spring/Parsnip.png` — 5 growth stages, not the 6 every shipped crop has

## The one sheet that needs a human before it is used

**`Spring/Blueberry.png` is the only tall sheet left**, and it stays out for the
reason T-31.02 gave: the crop sprite is centred on its tile (`Farm.ts`), so a
32px-tall frame hangs half into the tile below. Tall crops need a per-crop
anchor, which is code.

**Stage counts vary from five to seven** across the eleven usable sheets, which
is why `stageFrames` is an explicit list rather than a computed range.

That leaves **eleven usable spring crops**: Asparagus, Broccoli, Cabbage,
Carrot, Cauliflower, Onion, Parsnip, Potato, Rice, Spring Onion (the game's
*leek*) and Strawberry.

## One false alarm worth recording

An earlier version keyed "are these two frames identical art?" on **alpha sum
plus bounding box** and flagged repeated frames in three sheets. All were wrong:
checked byte-for-byte, `Wheat` frames 4 and 5 differed in **353 of 1,024
bytes** (wheat is a summer crop and out of scope now, but the lesson stands) — same silhouette, different colour, which is exactly what a ripening
crop looks like. The script now hashes the frame's RGBA bytes.

**A silhouette is not an identity**, and a measurement tool that reports a false
anomaly is worse than one that reports none.
