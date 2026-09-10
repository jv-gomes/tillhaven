#!/usr/bin/env python3
"""
Finds the individual pieces inside each interior furniture kit (T-16.08).

    python3 scripts/measure-interior.py             # every kit, as a table
    python3 scripts/measure-interior.py --sheet OUT # also write labelled PNGs

Every file `furniture.ts` draws from is a KIT, not a sprite: `interior-beds.png`
is sixty-odd beds in four size classes, `interior-tables.png` is tables, stools,
benches and refrigerators together. So the catalogue has to name a window into
each file, and a window guessed from a clean-looking division of the file size is
exactly how T-3.05's crops ended up describing a pack that no longer exists.

Connected components rather than a grid: these kits are irregular (a bunk bed is
three times the height of a stool), and flood-filling the opaque pixels finds the
real pieces without anyone deciding what the cell size "should" be. Pieces that
touch would merge, so the labelled sheet is the check on that — look at it before
trusting a box.

**Python rather than a fourth `measure-*.mjs`.** The three existing ones each
carry their own ~150-line PNG decoder because Node has none; Pillow makes this
sixty lines, and `scripts/draw-ground-tiles.py` already establishes Python as the
language for asset work in this repo.
"""

import argparse
import os
import sys
from collections import deque

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - developer tooling
    sys.exit("Pillow is required: pip install pillow")

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ASSETS = os.path.join(ROOT, "apps/client/public/assets")
TILE = 16

KITS = [
    "interior-carpet",
    "interior-beds",
    "interior-sofas",
    "interior-tables",
    "interior-chairs",
    "interior-closets",
    "interior-dressers",
    "interior-fireplaces",
    "interior-openings",
    "interior-others",
]

# Below this many opaque pixels a "piece" is a stray dot or an antialiased edge,
# not furniture. 40px is about a quarter of one 16x16 tile.
MIN_PIXELS = 40


def components(img, min_pixels=MIN_PIXELS):
    """Every separate opaque blob, as (x, y, w, h, pixels), reading order."""
    w, h = img.size
    alpha = img.split()[3].load()
    seen = bytearray(w * h)
    out = []

    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx] or alpha[sx, sy] < 8:
                continue
            queue = deque([(sx, sy)])
            seen[sy * w + sx] = 1
            x0 = x1 = sx
            y0 = y1 = sy
            count = 0
            while queue:
                x, y = queue.popleft()
                count += 1
                x0, x1 = min(x0, x), max(x1, x)
                y0, y1 = min(y0, y), max(y1, y)
                # 8-connected: furniture legs meet the body diagonally often
                # enough that 4-connectivity splits a chair into three pieces.
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                            if alpha[nx, ny] >= 8:
                                seen[ny * w + nx] = 1
                                queue.append((nx, ny))
            if count >= min_pixels:
                out.append((x0, y0, x1 - x0 + 1, y1 - y0 + 1, count))
    return out


def footprint(w, h):
    """Cells a piece occupies. `ceil(size / 16)`, matching `furniture.ts`."""
    return (-(-w // TILE), -(-h // TILE))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kits", nargs="*", default=None)
    ap.add_argument("--sheet", help="directory to write labelled PNGs into")
    args = ap.parse_args()

    wanted = args.kits or KITS
    for key in wanted:
        path = os.path.join(ASSETS, f"{key}.png")
        if not os.path.exists(path):
            print(f"{key}: MISSING — run scripts/prepare-assets.mjs first")
            continue

        img = Image.open(path).convert("RGBA")
        pieces = components(img)
        print(f"\n=== {key}  ({img.size[0]}x{img.size[1]})  {len(pieces)} pieces ===")
        print("  idx      x     y     w     h   cells   px")
        for i, (x, y, w, h, n) in enumerate(pieces):
            fw, fh = footprint(w, h)
            print(f"  {i:4d} {x:6d}{y:6d}{w:6d}{h:6d}   {fw}x{fh}  {n:6d}")

        if args.sheet:
            os.makedirs(args.sheet, exist_ok=True)
            scale = 3
            big = img.resize(
                (img.size[0] * scale, img.size[1] * scale), Image.NEAREST
            ).convert("RGBA")
            bg = Image.new("RGBA", big.size, (40, 44, 52, 255))
            bg.alpha_composite(big)
            draw = ImageDraw.Draw(bg)
            for i, (x, y, w, h, _) in enumerate(pieces):
                box = (x * scale, y * scale, (x + w) * scale - 1, (y + h) * scale - 1)
                draw.rectangle(box, outline=(255, 96, 96, 255))
                draw.text((box[0] + 1, box[1] + 1), str(i), fill=(255, 255, 0, 255))
            bg.convert("RGB").save(os.path.join(args.sheet, f"{key}.png"))
            print(f"  -> {args.sheet}/{key}.png")


if __name__ == "__main__":
    main()
