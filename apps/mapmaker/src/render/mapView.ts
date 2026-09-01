/**
 * The map canvas.
 *
 * Everything is drawn with `drawImage` at an INTEGER zoom. Fractional zoom on
 * 16px pixel art resamples it into mush regardless of `image-rendering`, which
 * is the same rule the game follows (`PIXEL_SCALE` in the shared manifest).
 */

import type { MapDoc, PlacedObject } from '../model/doc.js';
import { fromGid } from '@tillhaven/shared/config';
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
  /** Cell under the cursor, or null when the pointer is off-canvas. */
  hover: { x: number; y: number } | null;
  /** Live rectangle while dragging the rect tool. */
  marquee: Rect | null;
  /** Brush footprint at the hover position, in tiles. */
  brushW: number;
  brushH: number;
  /** Object currently selected on the object layer. */
  selectedObjectId: number | null;
  /** Id of the layer being edited; others dim. */
  activeLayerId: string;
  dimInactive: boolean;
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
  selected: 'rgba(255,220,90,0.95)',
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
          drawGid(ctx, gid, x * tw, y * th, zoom);
        }
      }
    } else if (layer.kind === 'object') {
      // Sort by bottom edge so a tree in front of a house overlaps it correctly,
      // matching the depth order the game will use.
      const sorted = [...layer.objects].sort((a, b) => a.py + a.h - (b.py + b.h));
      for (const o of sorted) drawObject(ctx, o, zoom);
    }
    ctx.globalAlpha = 1;
  }

  if (overlay.showPlots) drawPlots(ctx, doc, zoom);
  if (overlay.showGrid) drawGrid(ctx, doc, tw, th);
  drawSelection(ctx, doc, overlay, zoom);
  drawHover(ctx, overlay, tw, th);
  drawMarquee(ctx, overlay, tw, th);

  ctx.restore();
}

function drawGid(ctx: CanvasRenderingContext2D, gid: number, dx: number, dy: number, zoom: number): void {
  const loc = fromGid(gid);
  if (!loc) return;
  const img = imageFor(loc.run.key);
  if (!img) return;
  const { sx, sy, sw, sh } = frameRect(loc.run, loc.frame);
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw * zoom, sh * zoom);
}

function drawObject(ctx: CanvasRenderingContext2D, o: PlacedObject, zoom: number): void {
  drawGid(ctx, o.gid, o.px * zoom, o.py * zoom, zoom);
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
