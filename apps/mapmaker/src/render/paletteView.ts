/**
 * The palette canvas.
 *
 * Drawn on a canvas rather than as DOM tiles so a marquee drag can select a
 * rectangle of frames in one gesture — that rectangle becomes a multi-tile
 * stamp, which is the fastest way to lay a fence run or a road.
 */

import type { Palette } from '../tilesets/palettes.js';
import { frameRect } from '../tilesets/palettes.js';
import { crisp, imageFor } from './images.js';
import type { Stamp } from '../tools/stamp.js';
import { isGroundScatterFrame, sheetAnimationFrames, toGid } from '@tillhaven/shared/config';

/** Gap between frames so adjacent tiles are visually separable. */
const GAP = 2;

/** Marks a cell that animates once painted. The same cyan the Anim tool uses. */
const ANIM_DOT = 'rgba(46,175,199,0.95)';

/** Marks a prop the farm's ground scatter already uses — safe on `decor`. */
const SCATTER_TICK = 'rgba(140,225,110,0.95)';

export interface PaletteSelection {
  /** Top-left frame cell of the selection, in palette grid coords. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export function paletteZoom(palette: Palette, cssWidth: number): number {
  const perTile = (cssWidth - GAP) / palette.run.columns - GAP;
  return Math.max(1, Math.floor(perTile / palette.run.tileWidth));
}

export function paletteSize(
  palette: Palette,
  zoom: number,
): { width: number; height: number } {
  return {
    width: palette.run.columns * (palette.run.tileWidth * zoom + GAP) + GAP,
    height: palette.run.rows * (palette.run.tileHeight * zoom + GAP) + GAP,
  };
}

export function drawPalette(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  zoom: number,
  selection: PaletteSelection | null,
): void {
  const run = palette.run;
  const cellW = run.tileWidth * zoom + GAP;
  const cellH = run.tileHeight * zoom + GAP;

  crisp(ctx);
  ctx.fillStyle = '#121216';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const img = imageFor(run.key);

  for (let row = 0; row < run.rows; row++) {
    for (let col = 0; col < run.columns; col++) {
      const frame = row * run.columns + col;
      if (frame >= run.tileCount) continue;
      const dx = GAP + col * cellW;
      const dy = GAP + row * cellH;

      // Checkerboard behind each frame so transparent tiles are distinguishable
      // from blank ones — the spring tileset has five blank cells per block and
      // clicking one would otherwise look like a broken editor.
      drawChecker(ctx, dx, dy, run.tileWidth * zoom, run.tileHeight * zoom);

      if (img) {
        const { sx, sy, sw, sh } = frameRect(run, frame);
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw * zoom, sh * zoom);
      }

      /*
       * A dot on cells that animate where they are painted.
       *
       * **The layout is animated; not every cell in it is.** Both water sheets
       * carry flat fills and pure-grass pieces that repeat unchanged across all
       * four blocks. Without this the two are indistinguishable in the picker,
       * and the farm's top row was painted from a static one — the mechanism
       * working perfectly, the art with nothing to show, and no way to tell
       * until after a save and a reload.
       */
      if (sheetAnimationFrames(run.key, frame)) {
        ctx.fillStyle = ANIM_DOT;
        ctx.beginPath();
        ctx.arc(dx + run.tileWidth * zoom - 4, dy + 4, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      /*
       * A corner tick on the props the farm's own ground scatter uses.
       *
       * Those eleven frames were chosen by hand for the `decor` layer against a
       * constraint the art does not advertise: decor draws BELOW every world
       * sprite, so anything with height is drawn behind the player forever. Grass
       * and pebbles have no height to get wrong. Marking them lets someone adding
       * flowers by hand match what is already there — and find what to erase.
       *
       * A tick rather than a second dot, in a different colour: two dots would
       * be two facts encoded the same way, and the sheets where both appear are
       * exactly the ones where telling them apart matters.
       */
      if (isGroundScatterFrame(run.key, frame)) {
        ctx.strokeStyle = SCATTER_TICK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(dx + 2, dy + run.tileHeight * zoom - 5);
        ctx.lineTo(dx + 5, dy + run.tileHeight * zoom - 2);
        ctx.lineTo(dx + 10, dy + run.tileHeight * zoom - 9);
        ctx.stroke();
      }
    }
  }

  // Block separators: the spring tileset is five stacked 4x4 autotile blocks and
  // knowing where one ends matters when calibrating terrain sets.
  if (run.rows % 4 === 0 && run.rows > 4) {
    ctx.strokeStyle = 'rgba(120,200,255,0.5)';
    ctx.lineWidth = 1;
    for (let row = 4; row < run.rows; row += 4) {
      const y = Math.round(GAP / 2 + row * cellH) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ctx.canvas.width, y);
      ctx.stroke();
    }
  }

  if (selection) {
    ctx.strokeStyle = '#ffdc5a';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      GAP + selection.x * cellW - 1,
      GAP + selection.y * cellH - 1,
      selection.w * cellW - GAP + 2,
      selection.h * cellH - GAP + 2,
    );
  }
}

function drawChecker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const s = 6;
  for (let yy = 0; yy < h; yy += s) {
    for (let xx = 0; xx < w; xx += s) {
      ctx.fillStyle = ((xx / s + yy / s) | 0) % 2 === 0 ? '#2a2a32' : '#33333d';
      ctx.fillRect(x + xx, y + yy, Math.min(s, w - xx), Math.min(s, h - yy));
    }
  }
}

export function paletteCellAt(
  palette: Palette,
  zoom: number,
  sx: number,
  sy: number,
): { x: number; y: number } | null {
  const run = palette.run;
  const cellW = run.tileWidth * zoom + GAP;
  const cellH = run.tileHeight * zoom + GAP;
  const x = Math.floor((sx - GAP) / cellW);
  const y = Math.floor((sy - GAP) / cellH);
  if (x < 0 || y < 0 || x >= run.columns || y >= run.rows) return null;
  return { x, y };
}

/** Turn a palette selection into a paintable stamp. */
export function stampFromSelection(palette: Palette, selection: PaletteSelection): Stamp {
  const run = palette.run;
  const gids: number[] = [];
  for (let dy = 0; dy < selection.h; dy++) {
    for (let dx = 0; dx < selection.w; dx++) {
      const col = selection.x + dx;
      const row = selection.y + dy;
      const frame = row * run.columns + col;
      gids.push(frame < run.tileCount ? toGid(run.key, frame) : 0);
    }
  }
  return { w: selection.w, h: selection.h, gids };
}
