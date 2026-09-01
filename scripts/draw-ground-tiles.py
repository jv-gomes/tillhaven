#!/usr/bin/env python3
"""
Draws flat 16x16 ground-fill tiles the asset pack does not contain as plain
tiles (T-7.05).

`Tileset Grass Spring.png`, `Tilled Soil and wet soil.png`, and
`Path tiles.png` turned out — on inspection, not assumption; see the T-7.05
write-up in ROADMAP.md — to hold only self-contained rounded "patch" stamps
and framed "rug" pieces, never a plain tile whose art fills its cell edge to
edge. Tiling a patch edge-to-edge leaves visible gaps between the rounded
borders. `Water tile.png` is the one exception: it is already a flat solid
fill, which is what confirmed the plain-fill approach was the pack's own
convention for open ground, just missing for grass/soil/path.

So: a plain flat tile per surface, in the SAME palette as the patch art
(sampled below, not invented), the same way `draw-item-icons.py` fills a gap
in the pack with original, licence-free work rather than guessing at art
that isn't there.

Output: original-assets/ground/{grass,soil-dry,soil-wet,path}.png — tracked
in git (first-party, tiny, no third-party licence attached), pulled into
apps/client/public/assets/ by scripts/prepare-assets.mjs like everything
else. Re-run if the sampled colours ever need revisiting.

Run with: python3 scripts/draw-ground-tiles.py
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "original-assets" / "ground"

SIZE = 16

# Sampled directly from new_assets/Tileset/ — flat interior colour of a patch,
# well clear of its border (verified: multiple sample points per colour agree
# exactly, confirming a true flat fill rather than a gradient or texture).
COLOURS = {
    # Tileset Grass Spring.png, block-0 patch interior.
    "grass": (121, 191, 86, 255),
    # Tilled Soil and wet soil.png, dry (top) band patch interior.
    "soil-dry": (190, 109, 71, 255),
    # Tilled Soil and wet soil.png, wet (bottom) band patch interior.
    "soil-wet": (118, 126, 222, 255),
    # Path tiles.png, dominant terracotta brick fill (mortar lines excluded).
    "path": (102, 38, 35, 255),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, colour in COLOURS.items():
        tile = Image.new("RGBA", (SIZE, SIZE), colour)
        path = OUT / f"{name}.png"
        tile.save(path)
        print(f"wrote {path.relative_to(ROOT)}  {SIZE}x{SIZE}  #{colour[0]:02x}{colour[1]:02x}{colour[2]:02x}")


if __name__ == "__main__":
    main()
