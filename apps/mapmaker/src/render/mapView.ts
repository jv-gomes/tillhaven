/**
 * The map canvas.
 *
 * Everything is drawn with `drawImage` at an INTEGER zoom. Fractional zoom on
 * 16px pixel art resamples it into mush regardless of `image-rendering`, which
 * is the same rule the game follows (`PIXEL_SCALE` in the shared manifest).
 */

import type { MapDoc, PlacedObject } from '../model/doc.js';
import {
  RESERVED_GROUND,
  SUBTILE_RESOLUTION,
  fromGid,
  getGroundAnimation,
  runByKey,
  sheetAnimationFrames,
} from '@tillhaven/shared/config';
import { frameRect } from '../tilesets/palettes.js';
import { crisp, imageFor } from './images.js';
import type { Rect } from '../tools/fill.js';

export interface Viewport {
  /** Integer zoom. */
  zoom: number;
  /** Pan offset in screen px. */
  panX: number;
  panY: number;
}

export interface Overlay {
  showGrid: boolean;
  showPlots: boolean;
  /**
   * Hatch the ground the house, coop and barn stand on.
   *
   * **On by default, because the alternative is authoring blind** (M6). Those
   * three are the only things in the game that occupy farm ground without being
   * in the map file — their art depends on a tier the player owns, so they are
   * drawn from `buildings.ts` and this canvas has nothing to draw. A crop field
   * was authored on top of the farmhouse precisely because the ground looked
   * empty here, and it looked empty because it IS empty; the map is not wrong,
   * it is incomplete, and this is the missing part shown rather than remembered.
   */
  showReserved: boolean;
  /** Cell under the cursor, or null when the pointer is off-canvas. */
  hover: { x: number; y: number } | null;
  /** Live rectangle while dragging the rect tool. */
  marquee: Rect | null;
  /** Brush footprint at the hover position, in tiles. */
  brushW: number;
  brushH: number;
  /** Object currently selected on the object layer. */
  selectedObjectId: number | null;
  /**
   * Draw the sub-tile grid. On only while the collision brush is in hand —
   * a 90x66 lattice over the whole map is unreadable the rest of the time, and
   * a grid you cannot turn off stops being information.
   */
  showCells: boolean;
  /** Id of the layer being edited; others dim. */
  activeLayerId: string;
  dimInactive: boolean;
  /**
   * Which frame the animated sheets are showing (`ANIMATED_SHEETS`).
   *
   * Passed in rather than read from a clock in here, because the renderer has to
   * stay a pure function of what it is handed — that is what lets the map be
   * drawn identically for a screenshot or a test. The editor owns the timer.
   */
  animStep: number;
}

const COLOR = {
  background: '#1b1b22',
  outside: '#121216',
  grid: 'rgba(255,255,255,0.10)',
  gridMajor: 'rgba(255,255,255,0.22)',
  hover: 'rgba(255,255,255,0.85)',
  marquee: 'rgba(120,200,255,0.9)',
  marqueeFill: 'rgba(120,200,255,0.18)',
  plot: 'rgba(238,157,81,0.85)',
  plotFill: 'rgba(238,157,81,0.28)',
  plotInk: '#2a1018',
  /* Red for solid, because that is what a collision overlay is everywhere. */
  collision: 'rgba(235,38,46,0.55)',
  collisionEdge: 'rgba(255,120,120,0.9)',
  /* The sub-tile grid, drawn only while the collision brush is in hand. */
  cellGrid: 'rgba(255,255,255,0.16)',
  anim: 'rgba(46,175,199,0.9)',
  animFill: 'rgba(46,175,199,0.22)',
  selected: 'rgba(255,220,90,0.95)',
  /*
   * Violet, deliberately unlike anything else on this canvas: the reserved
   * ground is not a layer, not a tool and not selectable, so it must not be
   * mistakable for the orange plots or the red collision cells.
   */
  reserved: 'rgba(168,120,255,0.85)',
  reservedFill: 'rgba(168,120,255,0.16)',
  reservedInk: '#1a1024',
} as const;

export function drawMap(
  ctx: CanvasRenderingContext2D,
  doc: MapDoc,
  view: Viewport,
  overlay: Overlay,
): void {
  const { zoom, panX, panY } = view;
  const tw = doc.tileWidth * zoom;
  const th = doc.tileHeight * zoom;

  crisp(ctx);
  ctx.fillStyle = COLOR.outside;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.save();
  ctx.translate(panX, panY);

  ctx.fillStyle = COLOR.background;
  ctx.fillRect(0, 0, doc.width * tw, doc.height * th);

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const dim = overlay.dimInactive && layer.id !== overlay.activeLayerId;
    ctx.globalAlpha = layer.opacity * (dim ? 0.35 : 1);

    if (layer.kind === 'tile') {
      for (let y = 0; y < doc.height; y++) {
        for (let x = 0; x < doc.width; x++) {
          const gid = layer.data[y * doc.width + x] ?? 0;
          if (gid === 0) continue;
          drawGid(ctx, gid, x * tw, y * th, zoom, overlay.animStep);
        }
      }
    } else if (layer.kind === 'object') {
      // Sort by bottom edge so a tree in front of a house overlaps it correctly,
      // matching the depth order the game will use.
      const sorted = [...layer.objects].sort((a, b) => a.py + a.h - (b.py + b.h));
      for (const o of sorted) drawObject(ctx, o, zoom, overlay.animStep);
    }
    ctx.globalAlpha = 1;
  }

  drawAnims(ctx, doc, tw, th);
  drawCollision(ctx, doc, zoom);
  // Under the plots, so a field authored on reserved ground reads as a mistake
  // rather than as a plot layer with an odd tint.
  if (overlay.showReserved) drawReserved(ctx, tw, th);
  if (overlay.showPlots) drawPlots(ctx, doc, zoom);
  if (overlay.showGrid) drawGrid(ctx, doc, tw, th);
  if (overlay.showCells) drawCellGrid(ctx, doc, zoom);
  drawSelection(ctx, doc, overlay, zoom);
  drawHover(ctx, overlay, tw, th);
  drawMarquee(ctx, overlay, tw, th);

  ctx.restore();
}

/**
 * Draws one gid, stepping it if its sheet is one of the animated ones.
 *
 * **The editor shows what the game will show.** Water painted here animates
 * there, so it has to animate here too — a shoreline that only comes alive after
 * you save, alt-tab and reload is a shoreline you cannot judge while placing it.
 * A tile painted from a later block returns null and stays still, exactly as it
 * will in the game.
 */
function drawGid(
  ctx: CanvasRenderingContext2D,
  gid: number,
  dx: number,
  dy: number,
  zoom: number,
  animStep: number,
): void {
  const loc = fromGid(gid);
  if (!loc) return;
  const img = imageFor(loc.run.key);
  if (!img) return;

  const cycle = sheetAnimationFrames(loc.run.key, loc.frame);
  const frame = cycle ? cycle[animStep % cycle.length]! : loc.frame;

  const { sx, sy, sw, sh } = frameRect(loc.run, frame);
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw * zoom, sh * zoom);
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  o: PlacedObject,
  zoom: number,
  animStep: number,
): void {
  drawGid(ctx, o.gid, o.px * zoom, o.py * zoom, zoom, animStep);
}

/**
 * Whether anything on the map animates, so the editor can hold still if not.
 *
 * A 4fps repaint of a map with no water in it is a tool that never idles, for
 * nothing. Cheap enough to answer per tick — two tile layers of 660 cells — and
 * answering it per tick means it stays right as tiles are painted and erased.
 */
export function hasAnimatedTiles(doc: MapDoc): boolean {
  for (const layer of doc.layers) {
    if (layer.kind === 'tile') {
      for (const gid of layer.data) {
        if (gid === 0) continue;
        const loc = fromGid(gid);
        if (loc && sheetAnimationFrames(loc.run.key, loc.frame)) return true;
      }
    } else if (layer.kind === 'object') {
      for (const o of layer.objects) {
        const loc = fromGid(o.gid);
        if (loc && sheetAnimationFrames(loc.run.key, loc.frame)) return true;
      }
    }
  }
  return false;
}

function drawGrid(ctx: CanvasRenderingContext2D, doc: MapDoc, tw: number, th: number): void {
  ctx.lineWidth = 1;
  for (let x = 0; x <= doc.width; x++) {
    // Every 4th line is brighter — counting tiles across the map by eye is
    // otherwise guesswork, and plot positions have to be exact.
    ctx.strokeStyle = x % 4 === 0 ? COLOR.gridMajor : COLOR.grid;
    ctx.beginPath();
    ctx.moveTo(Math.round(x * tw) + 0.5, 0);
    ctx.lineTo(Math.round(x * tw) + 0.5, doc.height * th);
    ctx.stroke();
  }
  for (let y = 0; y <= doc.height; y++) {
    ctx.strokeStyle = y % 4 === 0 ? COLOR.gridMajor : COLOR.grid;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y * th) + 0.5);
    ctx.lineTo(doc.width * tw, Math.round(y * th) + 0.5);
    ctx.stroke();
  }
}

/**
 * Authored collision, at the resolution it is actually authored at.
 *
 * Drawn per CELL rather than per tile because that is the whole point of the
 * layer — a tile-grained overlay would show a square where the collision is an
 * L, which is exactly the confusion the sub-tile grid exists to remove.
 */
function drawCollision(ctx: CanvasRenderingContext2D, doc: MapDoc, zoom: number): void {
  const layer = doc.layers.find((l) => l.kind === 'collision');
  if (!layer || layer.kind !== 'collision' || !layer.visible) return;

  const size = (doc.tileWidth / SUBTILE_RESOLUTION) * zoom;
  ctx.fillStyle = COLOR.collision;
  for (const cell of layer.cells) {
    ctx.fillRect(cell.cx * size, cell.cy * size, size, size);
  }

  // A one-pixel outline per cell, so two adjacent solid cells still read as two.
  ctx.strokeStyle = COLOR.collisionEdge;
  ctx.lineWidth = 1;
  for (const cell of layer.cells) {
    ctx.strokeRect(
      Math.round(cell.cx * size) + 0.5,
      Math.round(cell.cy * size) + 0.5,
      Math.max(1, Math.round(size) - 1),
      Math.max(1, Math.round(size) - 1),
    );
  }
}

/**
 * Animated ground, as its FIRST frame plus a marker.
 *
 * The first frame rather than a live animation: the editor is for placing
 * things, and a map full of independently ticking cells is a canvas that never
 * settles while you are trying to aim at it. The marker is what says "this one
 * moves in the game" — without it, a placed animation is indistinguishable from
 * a painted tile.
 */
function drawAnims(
  ctx: CanvasRenderingContext2D,
  doc: MapDoc,
  tw: number,
  th: number,
): void {
  const layer = doc.layers.find((l) => l.kind === 'anim');
  if (!layer || layer.kind !== 'anim' || !layer.visible) return;

  const zoom = tw / doc.tileWidth;

  for (const cell of layer.cells) {
    const animation = getGroundAnimation(cell.animId);
    const dx = cell.x * tw;
    const dy = cell.y * th;

    if (animation) {
      const first = animation.frames[0];
      const run = first ? runByKey(first.sheet) : undefined;
      if (run && first) drawFrame(ctx, run, first.frame, dx, dy, zoom);
    }

    ctx.fillStyle = COLOR.animFill;
    ctx.fillRect(dx, dy, tw, th);
    ctx.strokeStyle = COLOR.anim;
    ctx.lineWidth = 2;
    ctx.strokeRect(dx + 1, dy + 1, tw - 2, th - 2);

    // A play triangle in the corner. Small, because the tile underneath is the
    // information and this is only the label.
    const s = Math.max(4, Math.round(tw / 5));
    ctx.fillStyle = COLOR.anim;
    ctx.beginPath();
    ctx.moveTo(dx + 3, dy + 3);
    ctx.lineTo(dx + 3, dy + 3 + s);
    ctx.lineTo(dx + 3 + s, dy + 3 + s / 2);
    ctx.closePath();
    ctx.fill();
  }
}

/** The sub-tile lattice, so a cell can be aimed at rather than guessed. */
function drawCellGrid(ctx: CanvasRenderingContext2D, doc: MapDoc, zoom: number): void {
  const size = (doc.tileWidth / SUBTILE_RESOLUTION) * zoom;
  // Below a couple of pixels a cell line is noise, not a guide.
  if (size < 3) return;

  ctx.strokeStyle = COLOR.cellGrid;
  ctx.lineWidth = 1;

  for (let cx = 0; cx <= doc.width * SUBTILE_RESOLUTION; cx++) {
    if (cx % SUBTILE_RESOLUTION === 0) continue; // the tile grid already drew it
    ctx.beginPath();
    ctx.moveTo(Math.round(cx * size) + 0.5, 0);
    ctx.lineTo(Math.round(cx * size) + 0.5, doc.height * doc.tileHeight * zoom);
    ctx.stroke();
  }
  for (let cy = 0; cy <= doc.height * SUBTILE_RESOLUTION; cy++) {
    if (cy % SUBTILE_RESOLUTION === 0) continue;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(cy * size) + 0.5);
    ctx.lineTo(doc.width * doc.tileWidth * zoom, Math.round(cy * size) + 0.5);
    ctx.stroke();
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  run: { key: string; columns: number; tileWidth: number; tileHeight: number },
  frame: number,
  dx: number,
  dy: number,
  zoom: number,
): void {
  const img = imageFor(run.key);
  if (!img) return;
  const { sx, sy, sw, sh } = frameRect(run as never, frame);
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw * zoom, sh * zoom);
}

/**
 * The ground the buildings stand on, which is in no layer of this document.
 *
 * **Hatched rather than filled**, because a solid block would hide the terrain
 * underneath and the whole reason to see this is to judge what you are painting
 * near it. The diagonals are drawn in a clipped region per box so a hatch never
 * bleeds past the footprint it describes.
 *
 * Read out of `RESERVED_GROUND` at its LARGEST tier, which is the same rule the
 * footprint tests use: a player who upgrades has already paid, so the ground a
 * Deluxe barn will need is taken from the day the map is authored, not from the
 * day the barn appears.
 */
function drawReserved(ctx: CanvasRenderingContext2D, tw: number, th: number): void {
  const stripe = Math.max(6, Math.round(tw / 2));

  for (const { name, box } of RESERVED_GROUND) {
    const x = box.x0 * tw;
    const y = box.y0 * th;
    const w = (box.x1 - box.x0 + 1) * tw;
    const h = (box.y1 - box.y0 + 1) * th;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.fillStyle = COLOR.reservedFill;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = COLOR.reserved;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let d = -h; d < w; d += stripe) {
      ctx.moveTo(x + d, y + h);
      ctx.lineTo(x + d + h, y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = COLOR.reserved;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    // Named, because "something is here" is only half the information — which
    // building it is decides whether the author moves the field or the anchor.
    const label = name;
    ctx.font = `bold ${Math.max(10, Math.round(th / 2))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR.reservedInk;
    ctx.strokeText(label, x + w / 2, y + h / 2);
    ctx.fillStyle = '#efe4ff';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }
}

function drawPlots(ctx: CanvasRenderingContext2D, doc: MapDoc, zoom: number): void {
  const plots = doc.layers.find((l) => l.kind === 'plots');
  if (!plots || plots.kind !== 'plots' || !plots.visible) return;

  const tw = doc.tileWidth * zoom;
  const th = doc.tileHeight * zoom;
  ctx.lineWidth = 2;

  plots.cells.forEach((cell, index) => {
    const x = cell.x * tw;
    const y = cell.y * th;
    ctx.fillStyle = COLOR.plotFill;
    ctx.fillRect(x, y, tw, th);
    ctx.strokeStyle = COLOR.plot;
    ctx.strokeRect(x + 1, y + 1, tw - 2, th - 2);

    // The unlock index is the whole point of the plot layer, so it is always
    // legible rather than hidden behind a hover.
    const label = String(index);
    ctx.font = `bold ${Math.max(10, Math.round(th / 2.6))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR.plotInk;
    ctx.strokeText(label, x + tw / 2, y + th / 2);
    ctx.fillStyle = '#fbf1e2';
    ctx.fillText(label, x + tw / 2, y + th / 2);
    ctx.lineWidth = 2;
  });
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  doc: MapDoc,
  overlay: Overlay,
  zoom: number,
): void {
  if (overlay.selectedObjectId === null) return;
  const layer = doc.layers.find((l) => l.kind === 'object');
  if (!layer || layer.kind !== 'object') return;
  const o = layer.objects.find((obj) => obj.id === overlay.selectedObjectId);
  if (!o) return;

  ctx.strokeStyle = COLOR.selected;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(o.px * zoom, o.py * zoom, o.w * zoom, o.h * zoom);
  ctx.setLineDash([]);
}

function drawHover(ctx: CanvasRenderingContext2D, overlay: Overlay, tw: number, th: number): void {
  if (!overlay.hover) return;
  ctx.strokeStyle = COLOR.hover;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    overlay.hover.x * tw + 1,
    overlay.hover.y * th + 1,
    overlay.brushW * tw - 2,
    overlay.brushH * th - 2,
  );
}

function drawMarquee(ctx: CanvasRenderingContext2D, overlay: Overlay, tw: number, th: number): void {
  if (!overlay.marquee) return;
  const { x, y, w, h } = overlay.marquee;
  ctx.fillStyle = COLOR.marqueeFill;
  ctx.fillRect(x * tw, y * th, w * tw, h * th);
  ctx.strokeStyle = COLOR.marquee;
  ctx.lineWidth = 2;
  ctx.strokeRect(x * tw + 1, y * th + 1, w * tw - 2, h * th - 2);
}

/** Screen px -> tile coords. Floor, not round: a click anywhere in a cell is that cell. */
export function screenToTile(
  doc: MapDoc,
  view: Viewport,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return {
    x: Math.floor((sx - view.panX) / (doc.tileWidth * view.zoom)),
    y: Math.floor((sy - view.panY) / (doc.tileHeight * view.zoom)),
  };
}

/** Screen px -> map px, for object hit-testing which is not grid-locked. */
export function screenToMapPixel(
  view: Viewport,
  sx: number,
  sy: number,
): { px: number; py: number } {
  return { px: (sx - view.panX) / view.zoom, py: (sy - view.panY) / view.zoom };
}

/** Centre the map in the canvas at the largest integer zoom that fits. */
export function fitToCanvas(doc: MapDoc, canvas: HTMLCanvasElement): Viewport {
  const margin = 32;
  const zoomX = (canvas.width - margin * 2) / (doc.width * doc.tileWidth);
  const zoomY = (canvas.height - margin * 2) / (doc.height * doc.tileHeight);
  const zoom = Math.max(1, Math.floor(Math.min(zoomX, zoomY)));
  return {
    zoom,
    panX: Math.round((canvas.width - doc.width * doc.tileWidth * zoom) / 2),
    panY: Math.round((canvas.height - doc.height * doc.tileHeight * zoom) / 2),
  };
}
