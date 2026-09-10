# @tillhaven/mapmaker

A drag-and-drop tile map editor for Tillhaven, in the repo, in the browser.

```bash
pnpm dev:mapmaker     # http://localhost:5174
```

It replaces the external **Tiled** application, but not Tiled's *file format*:
maps export as Tiled 1.10 JSON, so Phaser loads them with the stock
`load.tilemapTiledJSON` and the files still open in Tiled if you ever want them
to. CLAUDE.md §9 is satisfied by the artefact, not by the tool that made it.

## Why it exists

ROADMAP T-0.09 asked someone to open the tileset in Tiled and work out its
autotile layout by hand. That blocked T-1.10 (the farm map), which blocks the
player character and plot expansion. Building the editor unblocked all of it and
put map authoring in the same repo as everything else.

## What you can do

| Tool | Key | What it does |
|---|---|---|
| Paint | `B` | Stamp the palette selection onto the active tile layer |
| Terrain | `T` | Autotile brush — paint a region, edges resolve themselves |
| Rect | `R` | Drag a rectangle and fill it |
| Fill | `G` | Flood fill the contiguous region under the cursor |
| Pick | `I` | Drag a rectangle on the map to copy it as a stamp |
| Erase | `E` | Clear tiles |
| Object | `O` | Place, drag and delete free-positioned sprites |
| Plot | `P` | Mark which grid cells are farm plots, painting tillable ground under them |
| Anim | `A` | Stamp an animated ground cell; Alt-click clears |
| Collide | `C` | Paint collision at **sub-tile** resolution; Shift a whole tile, Alt erases |

Also: `F` fits the map to the view, `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo,
`Ctrl+S` saves, `Delete` removes the selected object. Middle-drag or hold
`Space` to pan; the wheel zooms in integer steps.

Dragging a rectangle **in the palette** selects a multi-tile stamp — the fastest
way to lay a fence run or a stretch of road.

**Two of these do not work in tiles.** The Collide brush works in *cells* —
three per tile on each axis, the grid the game actually collides on — so where
in a tile you click matters. The others all snap to the tile.

Two panels feed two different tools, which is easy to trip over: the **Tileset**
palette feeds Paint / Rect / Fill, and the **Terrain brush** dropdown feeds the
Terrain tool only. Choosing a terrain therefore switches you to the Terrain tool
automatically. If a tile tool would do nothing — empty brush, no tile layer
selected, or an object-only sheet — the status bar says which, rather than
swallowing the click.

## Getting a map into the game

**Save to project** writes `apps/client/public/tilemaps/<name>.json` and the game
picks it up on reload. **Download** does the same thing as a file if you would
rather move it yourself.

The save endpoint is a Vite middleware declared inside `configureServer`, so it
exists only under `vite dev`. There is no build in which it exists, and
`apps/server` — the thing that actually faces the internet — is not involved.

**Saving is not the whole trip.** The map is the source of truth for the farm's
shape, and three bakes carry it into shared config so the *server* sees it too:

```bash
pnpm plots      # after moving, adding or reordering plots
pnpm collision  # after painting collision
pnpm layout     # after moving any object, or repainting the shoreline
```

`pnpm layout` bakes the water and the object positions — trees, chest, shipping
box, mailbox, stall. Skip it and the game draws the chest where you put it while
the server's trap-guard keeps a path open to the old spot;
`farmLayoutBake.test.ts` fails if you forget.

The house, coop and barn are **not** map objects: their art depends on a tier the
player owns, so they are drawn from `buildings.ts` and anchored by config. The
merchant NPC is a constant for the same reason.

> **`generate-farm.ts` rebuilds farm.json from config and needs `--force`.**
> It is scaffolding for a fresh map — a new size, a new season, a restart. On an
> authored map it discards every hand-painted tile.

The server never reads the map file at runtime — it reads the generated shared
config. Animated ground needs neither: it is purely visual and the client reads
the map directly.

## Terrain sets

`src/tilesets/terrain-sets.json` maps nine-slice roles to tile indices. The
engine (`roleFor`/`blockFrame`/`frameForRole` in `src/tilesets/terrain.ts`)
supports a full nine-slice-plus-inner-corners layout, one 4×4 tile block per
terrain:

```
        c0        c1          c2          c3
   r0   NW         ·          N           NE
   r1   W        inner\       ·           ·
   r2   ·        FILL       inner/        E
   r3   SW        S          ·            SE
```

Locals 1, 6, 7, 8 and 14 are blank in every block.

**Nothing shipped today actually uses that layout.** The licensed art pack's
`tileset-grass-spring.png` / `tileset-soil.png` / `tileset-paths.png` turned
out to be self-contained rounded patches and framed-rug pieces, not
straight-edged art meant to connect edge-to-edge with a same-type neighbour
(verified by grid-overlay and connected-component inspection — see the
T-7.05 write-up in `ROADMAP.md`). So every shipped terrain set today is a
**flat single-colour fill** (grass, dry soil, wet soil, path, water) with
only the `c` (centre/fill) role calibrated — there is no edge art to draw,
so every role degrades to the same frame, which is exactly correct for a
flat tile. The nine-slice machinery stays in place for whenever a pack with
real connecting edge art shows up.

If you swap in a pack that DOES have real nine-slice autotile art, open
**Calibrate roles** in the Terrain panel, click a role, click the tile that
should serve it, and watch the preview. Then **Save terrain-sets.json**.

### Two limits worth knowing

- The two inner-corner tiles each cut **opposite** diagonals, so asking for one
  inner corner necessarily draws its opposite too. The art has no single-corner
  tile.
- There is no cap or corridor art, so a **1-tile-wide** run of terrain renders as
  unbordered fill. Paint at least 2 wide for a clean edge.

## Plot markers

Plots export as gid-less rectangles on a `plots` object layer, each with an
`index` property. **Array order is the unlock order** — plot *n* costs
`250 × n²` via `plotUnlockCost()` in `packages/shared`, and the panel shows the
price so reordering is an informed decision.

These markers are the real farm layout, not a hint. After moving, adding or
reordering plots, save and then run:

```bash
pnpm plots     # farm.json -> packages/shared/src/config/plots.generated.ts
```

`newFarmPlots()` on the server walks that generated file, and `MAX_PLOTS` is its
length — so **the map decides how many plots the game has** and how much gold
plot expansion can sink (see `docs/economy.md`). The server never reads the map
file at runtime; it reads the generated shared config.

**Marking a plot paints the ground under it.** The orange tillable fill goes
down with the marker and comes back off with it — restoring whatever was there
before, so a field crossing a path leaves the path behind. That coupling is not
cosmetic: `io/farmMap.test.ts` pins that the paint and the markers match
exactly, because a plot on plain grass is a tile the player can farm with
nothing on screen to say so.

## Flowers, grass and pebbles

They are ordinary tiles on the **decor** layer. To edit them:

1. Click **decor** in the Layers panel — the Erase tool only touches the active
   layer, so with `ground` selected it will look like nothing happens.
2. Pick `tileset-props-seasons` in the Tileset palette.
3. Paint (`B`) to add, Erase (`E`) to remove. Drag in the palette to take several
   props as one stamp.

**Ticked props are the ones the farm already scatters.** `decor` draws *below*
every world sprite, so anything with height is drawn behind the player from every
angle, permanently — which is why `GROUND_SCATTER` picked only flat tufts and
pebbles, and left the sheet's standing flowers, mushrooms and driftwood out. The
tick marks the eleven that were checked; the rest are unchecked rather than
forbidden.

> **Regenerating the map discards hand-placed decor.**
> `generate-farm.ts` repaints the whole layer from `scatterTiles()`. If you want
> your props to survive a regeneration, they have to go in `farmLayout.ts`
> instead.

## Three things called water

Worth getting straight before touching any of them:

| Thing | What it is | How to change it |
| --- | --- | --- |
| The **sea** | the backdrop behind everything, outside the farm | edit the **Rippling water** animation in the Animations panel |
| The **shore** | tiles you painted on the ground layer | paint from an animated sheet — see below |
| A **placed** animation | stamped cell by cell with the Anim tool | author one in the panel |

The sea is driven by the `water-ripple` animation, so overriding that animation
is how you change it: pick different frames, change the fps, or give it a single
frame for flat water. **Reset to built-in** puts the ripple back.

## Water animates itself

**Paint it and it moves — in the editor and in the game.** Two sheets in the pack
hold four frames of the same art as repeated blocks:

| Sheet | Layout |
| --- | --- |
| `tileset-grass-water-spring` | 4 frames of **12 columns** (the shoreline) |
| `tileset-water-anim` | 4 frames of **4 rows** (open water) |

So a painted tile is already one frame of a loop and the rest are derived. You do
not stamp anything, and there is no animation to author — that is what
`ANIMATED_SHEETS` is for, and it is a different mechanism from the placed
animations below.

Two things worth knowing, both of which cost real time to find:

- **The block you paint from is the phase, not a mistake.** A tile from block 2
  animates through the same loop starting at frame 2. Tiles from different blocks
  ripple out of sync with each other, which is fine for water; paint from one
  block if you want the shore in step.
- **The layout is animated; not every cell in it is.** Both sheets carry flat
  fills and pure-grass pieces that repeat unchanged in all four blocks — 20 of
  192 base cells on the shoreline sheet. **Cells that move have a dot in the
  palette**; the rest are static art and no amount of stamping will help. Remeasure
  with `node scripts/measure-tile-animation.mjs`.

## Animated ground

Stamp with the **Anim** tool (A); Alt-click clears. The map records *where*;
the frames and the rate live in shared config (`groundAnim.ts` for the built-ins,
`groundAnim.generated.ts` for the ones you author), so re-timing an animation is
a config edit rather than a map regeneration, and two maps stamping the same id
cannot disagree about how it looks.

Frames are an explicit ordered list and **may span sheets** — the panel shows
them left to right, numbered, because the order *is* the animation and a
dropdown of ids tells you nothing about what you are about to place.

Placed cells draw as their first frame with a play marker. Static on purpose:
the editor is for aiming at cells, and a canvas that never settles is one you
cannot work on.

### Making one

Open **Make an animation** in the same panel.

1. **+ New** and give it a name — the id is derived from it, and the id is the
   string every map file stores, so only the first name you give gets to be free.
2. **Pick a tile in the palette on the left**, then press **Add frame**. The
   palette *is* the frame picker: it already lists every sheet in the manifest,
   and switching the tileset dropdown between two Add-frame clicks is the whole
   gesture for a **cross-sheet animation**. A marquee is read as its top-left,
   not as a range — a frame list is one frame per entry.
3. Repeat a frame to **hold** on it; there are no per-frame durations.
4. Drag frames to reorder, **×** to remove, set **FPS**, and watch the box beside
   the notes — the strip tells you the order, only playback tells you whether the
   order reads.
5. **Save animations** writes
   `packages/shared/src/config/groundAnim.generated.ts`. The game's dev server
   reloads on it; this editor deliberately does not.

Built-ins (`water-ripple`) **are editable**. The first change forks one into an
override that **keeps its id**, so every cell already stamped with it follows the
edit; **Reset to built-in** puts the original back. The shipped version stays in
`assets.ts` as measured constants — the editor never rewrites that file, it
shadows it.

The **Id** is the one locked field on a built-in: renaming an override would
bring the built-in back under the old id *and* leave a stray animation under the
new one. **Duplicate** is the operation when you want a second animation rather
than a changed one.

Changing an **Id** repoints every cell on the map you have open, and says so.
Any *other* saved map that stamped the old id is orphaned — it is the one library
edit that can break a map, so it asks first.

Frames from sheets of different sizes are allowed and flagged: the scene draws
each frame from the cell's top-left corner, so a 32px frame in a 16px loop bleeds
down and right. That is how you animate something standing proud of its tile, and
also exactly what clicking the wrong sheet looks like.

## Collision

Paint with the **Collide** tool (C). Each tile is 3×3 cells — click a cell,
Shift-click a whole tile, Alt-click to erase. The sub-tile lattice appears only
while the tool is in hand.

**This is added to the art's own collision, not a replacement for it.** Building
silhouettes and shoreline shapes are measured from the sprites and live in
`packages/shared/src/config/collision.ts`; they are properties of the art and
apply everywhere it is stamped. The brush is for the shapes the art cannot
express because they are not about the art.

After saving, run:

```bash
pnpm collision  # farm.json -> packages/shared/src/config/collision.generated.ts
```

**Do not skip that step.** `modules/decor/reachability.ts` refuses a decor
placement that would wall the player out of their own farm, and it can only do
that if it knows every solid thing on the map. Painted collision that reached
the client and not the server would narrow a corridor invisibly — and then a
legal-looking fence completes a trap the guard cannot see.

## Notes on the format

- Tile layers are a plain array of global ids, no base64/zlib, so maps diff
  line-by-line in git.
- Every manifest tileset is embedded in a fixed order, used or not, so
  `firstgid` values never shift and editing two tiles produces a two-line diff.
- **Tile objects are anchored to their bottom edge** (Tiled's convention) while
  plot, animation and collision rectangles are anchored to their top. All four
  are in the same file. This is the single easiest thing to get wrong;
  `src/io/tiled.ts` handles it and `tiled.test.ts` pins it.
- Collision is stored as **one mask string per tile** — nine `#`/`.` characters,
  row-major — rather than a rectangle per cell. A cell is 16/3 = 5.33px, so
  cell-sized rectangles would put repeating fractions in every coordinate; a
  tile is a whole number of pixels.
- Animation and collision rectangles carry no gid, like plot markers, and their
  object ids start at 200000 and 300000 so the four object layers never
  collide.

## Layout

```
src/
  model/     doc, gid allocation, undo/redo
  tilesets/  palettes derived from the shared manifest, terrain roles
  tools/     paint, fill, stamp, autotile, objects, plots
  render/    map canvas, palette canvas, image cache
  io/        Tiled serialize/deserialize, saving, autosave
  ui/        layer/plot panels, terrain panel
```

Palettes come from `@tillhaven/shared/config` — adding a sheet to the manifest
makes it appear here with no change to this app.
