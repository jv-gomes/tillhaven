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
| Plot | `P` | Mark which grid cells are farm plots |

Also: `F` fits the map to the view, `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo,
`Ctrl+S` saves, `Delete` removes the selected object. Middle-drag or hold
`Space` to pan; the wheel zooms in integer steps.

Dragging a rectangle **in the palette** selects a multi-tile stamp — the fastest
way to lay a fence run or a stretch of road.

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

Nothing checks that a plot stands on soil. Painting a plot marker on grass is
allowed and will render crops on grass.

## Notes on the format

- Tile layers are a plain array of global ids, no base64/zlib, so maps diff
  line-by-line in git.
- Every manifest tileset is embedded in a fixed order, used or not, so
  `firstgid` values never shift and editing two tiles produces a two-line diff.
- **Tile objects are anchored to their bottom edge** (Tiled's convention) while
  plot rectangles are anchored to their top. Both are in the same file. This is
  the single easiest thing to get wrong; `src/io/tiled.ts` handles it and
  `tiled.test.ts` pins it.

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
