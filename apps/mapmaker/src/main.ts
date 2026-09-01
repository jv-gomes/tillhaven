/**
 * Editor boot and input handling.
 *
 * This file owns the mutable editor state and translates pointer/keyboard
 * events into tool calls. Everything it calls into (model, tools, io, render)
 * is pure or takes its state explicitly, so the messy part is confined here.
 */

import { TILE_SIZE } from '@tillhaven/shared/config';

import {
  createDoc,
  createTileLayer,
  indexOf,
  inBounds,
  objectLayer,
  plotLayer,
  resizeDoc,
  tileLayers,
  type MapDoc,
  type TileLayer,
} from './model/doc.js';
import { History } from './model/history.js';
import { fromGid, toGid } from '@tillhaven/shared/config';

import { PALETTES, paletteByKey, type Palette } from './tilesets/palettes.js';
import {
  DEFAULT_TERRAIN_SETS,
  frameForRole,
  type Role,
  type TerrainSet,
} from './tilesets/terrain.js';
import terrainSetsJson from './tilesets/terrain-sets.json';

import {
  EMPTY_STAMP,
  applyStamp,
  isEmptyStamp,
  singleStamp,
  stampFromLayer,
  type Stamp,
} from './tools/stamp.js';
import { fillRect, floodFill, rectFromDrag, type Rect } from './tools/fill.js';
import { eraseTerrain, paintTerrain } from './tools/autotile.js';
import { deleteObject, moveObject, objectAt, placeObject, snapToGrid } from './tools/objects.js';
import { clearPlots, reorderPlot, togglePlot } from './tools/plots.js';

import { loadAllImages } from './render/images.js';
import {
  drawMap,
  fitToCanvas,
  screenToMapPixel,
  screenToTile,
  type Overlay,
  type Viewport,
} from './render/mapView.js';
import {
  drawPalette,
  paletteCellAt,
  paletteSize,
  paletteZoom,
  stampFromSelection,
  type PaletteSelection,
} from './render/paletteView.js';

import { deserialize, type TiledMap } from './io/tiled.js';
import { DEFAULT_MAP_NAME, downloadMap, saveTerrainSets, saveToProject } from './io/save.js';
import { loadAutosave, scheduleAutosave } from './io/autosave.js';

import { renderLayers, renderObjectInfo, renderPlots } from './ui/panels.js';
import { renderCalibrator, renderPreview } from './ui/terrainPanel.js';

const TOOLS = ['paint', 'terrain', 'rect', 'fill', 'pick', 'erase', 'object', 'plot'] as const;
type Tool = (typeof TOOLS)[number];

const MAX_ZOOM = 12;

interface DragState {
  tool: Tool;
  startX: number;
  startY: number;
  /** Last cell the stroke visited, so gaps between pointer events can be filled. */
  lastX: number;
  lastY: number;
  /** Cells the terrain brush has claimed during this stroke. */
  cells: Set<number>;
  /** Object being dragged, with the grab offset in map px. */
  objectId: number | null;
  grabDX: number;
  grabDY: number;
  moved: boolean;
}

/**
 * Cells on the straight line between two points, inclusive.
 *
 * Pointer events are sampled, not continuous: a quick drag across the map fires
 * a handful of moves and would otherwise leave a dotted trail instead of a
 * stroke. Bresenham fills the gaps so the brush behaves like a brush.
 */
function lineCells(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;

  for (;;) {
    cells.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

interface Editor {
  doc: MapDoc;
  history: History;
  view: Viewport;
  tool: Tool;
  activeLayerId: string;
  palette: Palette;
  paletteSelection: PaletteSelection | null;
  stamp: Stamp;
  terrainSets: TerrainSet[];
  terrainSetId: string;
  showGrid: boolean;
  dimInactive: boolean;
  hover: { x: number; y: number } | null;
  marquee: Rect | null;
  selectedObjectId: number | null;
  drag: DragState | null;
  panning: { x: number; y: number; panX: number; panY: number } | null;
  spaceHeld: boolean;
}

/* ------------------------------------------------------------------ *
 * DOM lookup
 * ------------------------------------------------------------------ */

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
}

const mapCanvas = el<HTMLCanvasElement>('map');
const paletteCanvas = el<HTMLCanvasElement>('palette');
const statusEl = el('status');
const coordsEl = el('coords');

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  return ctx;
}

const mapCtx = context2d(mapCanvas);
const paletteCtx = context2d(paletteCanvas);

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

function loadTerrainSets(): TerrainSet[] {
  // The JSON is the calibration of record; the TS defaults are the fallback if
  // it is missing or empty, so a bad edit can never leave the brush with nothing.
  const fromFile = terrainSetsJson as unknown as TerrainSet[];
  return Array.isArray(fromFile) && fromFile.length > 0
    ? fromFile.map((s) => ({ ...s, roles: { ...s.roles } }))
    : DEFAULT_TERRAIN_SETS.map((s) => ({ ...s, roles: { ...s.roles } }));
}

const firstPalette = PALETTES[0];
if (!firstPalette) throw new Error('Asset manifest is empty');

const initialDoc = createDoc();
const editor: Editor = {
  doc: initialDoc,
  history: new History(initialDoc),
  view: { zoom: 2, panX: 0, panY: 0 },
  tool: 'paint',
  activeLayerId: 'ground',
  palette: firstPalette,
  paletteSelection: null,
  stamp: EMPTY_STAMP,
  terrainSets: loadTerrainSets(),
  terrainSetId: loadTerrainSets()[0]?.id ?? 'grass',
  showGrid: true,
  dimInactive: false,
  hover: null,
  marquee: null,
  selectedObjectId: null,
  drag: null,
  panning: null,
  spaceHeld: false,
};

function setDoc(doc: MapDoc): void {
  editor.doc = doc;
  editor.history = new History(doc);
  editor.history.onChange(() => {
    refreshPanels();
    scheduleAutosave(editor.doc);
  });
  const first = tileLayers(doc)[0];
  editor.activeLayerId = first?.id ?? doc.layers[0]?.id ?? 'ground';
  editor.selectedObjectId = null;
}

function activeTileLayer(): TileLayer | undefined {
  const layer = editor.doc.layers.find((l) => l.id === editor.activeLayerId);
  return layer?.kind === 'tile' ? layer : undefined;
}

function currentTerrainSet(): TerrainSet | undefined {
  return editor.terrainSets.find((s) => s.id === editor.terrainSetId);
}

function status(message: string, kind: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = message;
  statusEl.className = kind;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function overlay(): Overlay {
  return {
    showGrid: editor.showGrid,
    showPlots: true,
    hover: editor.hover,
    marquee: editor.marquee,
    brushW: editor.tool === 'paint' || editor.tool === 'erase' ? editor.stamp.w : 1,
    brushH: editor.tool === 'paint' || editor.tool === 'erase' ? editor.stamp.h : 1,
    selectedObjectId: editor.selectedObjectId,
    activeLayerId: editor.activeLayerId,
    dimInactive: editor.dimInactive,
  };
}

let frameQueued = false;
function requestDraw(): void {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    drawMap(mapCtx, editor.doc, editor.view, overlay());
  });
}

function resizeCanvas(): void {
  // clientWidth/Height, not the attribute size: the canvas is absolutely
  // positioned at 100% of its wrapper (see editor.css), so this reads the
  // wrapper's size without the attribute size feeding back into layout.
  const width = Math.max(1, mapCanvas.clientWidth);
  const height = Math.max(1, mapCanvas.clientHeight);
  if (mapCanvas.width === width && mapCanvas.height === height) return;

  // Keep whatever the user was looking at under the centre of the canvas.
  // Without this the pan is left over from the old size and the map drifts
  // off-screen a little further with every resize.
  const oldCx = (mapCanvas.width / 2 - editor.view.panX) / editor.view.zoom;
  const oldCy = (mapCanvas.height / 2 - editor.view.panY) / editor.view.zoom;
  const hadSize = mapCanvas.width > 1 && mapCanvas.height > 1;

  // Backing store in CSS pixels: the art is upscaled by an integer zoom, so a
  // devicePixelRatio-scaled buffer would only add a resample step.
  mapCanvas.width = width;
  mapCanvas.height = height;

  if (hadSize) {
    editor.view.panX = Math.round(width / 2 - oldCx * editor.view.zoom);
    editor.view.panY = Math.round(height / 2 - oldCy * editor.view.zoom);
  }
  requestDraw();
}

function redrawPalette(): void {
  const wrap = paletteCanvas.parentElement;
  const width = wrap ? wrap.clientWidth : 240;
  const zoom = paletteZoom(editor.palette, width);
  const size = paletteSize(editor.palette, zoom);
  paletteCanvas.width = size.width;
  paletteCanvas.height = size.height;
  drawPalette(paletteCtx, editor.palette, zoom, editor.paletteSelection);
}

function refreshPanels(): void {
  renderLayers(el('layers'), editor.doc, editor.activeLayerId, {
    onSelect: (id) => {
      editor.activeLayerId = id;
      refreshPanels();
      requestDraw();
    },
    onToggleVisible: (id) => {
      const layer = editor.doc.layers.find((l) => l.id === id);
      if (layer) layer.visible = !layer.visible;
      refreshPanels();
      requestDraw();
    },
  });

  renderPlots(el('plot-list'), el('plot-count'), editor.doc, {
    onReorder: (from, to) => {
      const layer = plotLayer(editor.doc);
      if (!layer) return;
      editor.history.begin('reorder plot');
      reorderPlot(layer, editor.history, from, to);
      editor.history.commit();
      refreshPanels();
      requestDraw();
    },
    onFocus: (x, y) => {
      centreOn(x, y);
      requestDraw();
    },
  });

  renderObjectInfo(el('object-info'), editor.doc, editor.selectedObjectId);

  el<HTMLButtonElement>('undo').disabled = !editor.history.canUndo;
  el<HTMLButtonElement>('redo').disabled = !editor.history.canRedo;
  el<HTMLInputElement>('map-w').value = String(editor.doc.width);
  el<HTMLInputElement>('map-h').value = String(editor.doc.height);
}

function centreOn(x: number, y: number): void {
  const tw = editor.doc.tileWidth * editor.view.zoom;
  const th = editor.doc.tileHeight * editor.view.zoom;
  editor.view.panX = Math.round(mapCanvas.width / 2 - (x + 0.5) * tw);
  editor.view.panY = Math.round(mapCanvas.height / 2 - (y + 0.5) * th);
}

/* ------------------------------------------------------------------ *
 * Tool application
 * ------------------------------------------------------------------ */

/**
 * Guard the tile tools against the two ways a click can do nothing at all.
 *
 * Both were real traps: choosing a terrain set while the Paint tool is active
 * leaves the palette stamp empty, and selecting the plots layer leaves no tile
 * layer to write to. In both cases every click was silently discarded, which is
 * indistinguishable from the editor being broken.
 */
function canEditTiles(needsStamp: boolean): boolean {
  if (!activeTileLayer()) {
    status('Select a tile layer (ground or decor) before painting.', 'err');
    return false;
  }
  if (!needsStamp) return true;

  if (isEmptyStamp(editor.stamp)) {
    status(
      'The brush is empty — click a tile in the palette above, or use the Terrain tool for the terrain brush.',
      'err',
    );
    return false;
  }
  // A 32x48 tree does not belong in a 16x16 grid cell. Sheets whose frames are
  // not one cell are object-only, and stamping one onto a tile layer would
  // misalign it in the game rather than fail loudly.
  const oversized = editor.stamp.gids.find((gid) => {
    if (gid === 0) return false;
    const loc = fromGid(gid);
    return loc !== undefined && (loc.run.tileWidth !== TILE_SIZE || loc.run.tileHeight !== TILE_SIZE);
  });
  if (oversized !== undefined) {
    const loc = fromGid(oversized);
    status(
      `"${loc?.run.key}" frames are ${loc?.run.tileWidth}x${loc?.run.tileHeight}, not ${TILE_SIZE}x${TILE_SIZE} — place it with the Object tool instead.`,
      'err',
    );
    return false;
  }
  return true;
}

function paintAt(x: number, y: number, erase: boolean): void {
  const layer = activeTileLayer();
  if (!layer) return;
  const stamp = erase ? singleStamp(0) : editor.stamp;
  if (applyStamp(editor.doc, layer, editor.history, stamp, x, y, erase)) requestDraw();
}

/**
 * Claim cells for the terrain brush and re-resolve the whole stroke.
 *
 * The stroke is re-resolved from scratch on every event rather than
 * incrementally, because a cell painted early can need a different tile once a
 * later cell lands next to it. Re-running over the accumulated set is O(n^2) in
 * stroke length, which on a map of a few hundred cells is not worth optimising.
 */
function terrainAt(cells: Array<[number, number]>, drag: DragState, erase: boolean): void {
  const layer = activeTileLayer();
  const set = currentTerrainSet();
  if (!layer || !set) return;

  let added = false;
  for (const [x, y] of cells) {
    if (!inBounds(editor.doc, x, y)) continue;
    drag.cells.add(indexOf(editor.doc, x, y));
    added = true;
  }
  if (!added) return;

  if (erase) eraseTerrain(editor.doc, layer, editor.history, set, drag.cells);
  else paintTerrain(editor.doc, layer, editor.history, set, drag.cells);
  requestDraw();
}

function beginDrag(tool: Tool, x: number, y: number, px: number, py: number, alt: boolean): void {
  const drag: DragState = {
    tool,
    startX: x,
    startY: y,
    lastX: x,
    lastY: y,
    cells: new Set(),
    objectId: null,
    grabDX: 0,
    grabDY: 0,
    moved: false,
  };
  // Refuse before opening a history batch, so a rejected click leaves no trace.
  const needsStamp = tool === 'paint' || tool === 'rect' || tool === 'fill';
  if ((needsStamp || tool === 'erase' || tool === 'terrain') && !canEditTiles(needsStamp)) {
    return;
  }

  editor.drag = drag;
  editor.history.begin(tool);

  switch (tool) {
    case 'paint':
      paintAt(x, y, false);
      break;
    case 'erase':
      paintAt(x, y, true);
      break;
    case 'terrain':
      terrainAt([[x, y]], drag, alt);
      break;
    case 'rect':
    case 'pick':
      editor.marquee = { x, y, w: 1, h: 1 };
      break;
    case 'fill': {
      const layer = activeTileLayer();
      if (layer && floodFill(editor.doc, layer, editor.history, editor.stamp, x, y)) requestDraw();
      break;
    }
    case 'plot': {
      const layer = plotLayer(editor.doc);
      if (layer) {
        togglePlot(editor.doc, layer, editor.history, x, y);
        refreshPanels();
        requestDraw();
      }
      break;
    }
    case 'object': {
      const layer = objectLayer(editor.doc);
      if (!layer) break;
      const hit = objectAt(layer, px, py);
      if (hit) {
        editor.selectedObjectId = hit.id;
        drag.objectId = hit.id;
        drag.grabDX = px - hit.px;
        drag.grabDY = py - hit.py;
      } else if (editor.paletteSelection) {
        const frame =
          editor.paletteSelection.y * editor.palette.run.columns + editor.paletteSelection.x;
        if (frame < editor.palette.run.tileCount) {
          const placed = placeObject(
            editor.doc,
            layer,
            editor.history,
            toGid(editor.palette.run.key, frame),
            x,
            y,
            editor.palette.run.key,
          );
          editor.selectedObjectId = placed?.id ?? null;
        }
      }
      refreshPanels();
      requestDraw();
      break;
    }
    default:
      break;
  }
}

function continueDrag(x: number, y: number, px: number, py: number, alt: boolean): void {
  const drag = editor.drag;
  if (!drag) return;
  drag.moved = true;

  // Fill in the cells the pointer skipped over since the last event, so a fast
  // drag paints a continuous stroke rather than a dotted line.
  const path = lineCells(drag.lastX, drag.lastY, x, y).slice(1);
  drag.lastX = x;
  drag.lastY = y;

  switch (drag.tool) {
    case 'paint':
      for (const [cx, cy] of path) paintAt(cx, cy, false);
      break;
    case 'erase':
      for (const [cx, cy] of path) paintAt(cx, cy, true);
      break;
    case 'terrain':
      terrainAt(path, drag, alt);
      break;
    case 'rect':
    case 'pick':
      editor.marquee = rectFromDrag(drag.startX, drag.startY, x, y);
      requestDraw();
      break;
    case 'object': {
      const layer = objectLayer(editor.doc);
      if (!layer || drag.objectId === null) break;
      const object = layer.objects.find((o) => o.id === drag.objectId);
      if (!object) break;
      const snapped = snapToGrid(editor.doc, object, px - drag.grabDX, py - drag.grabDY);
      moveObject(layer, editor.history, object.id, snapped.px, snapped.py);
      refreshPanels();
      requestDraw();
      break;
    }
    default:
      break;
  }
}

function endDrag(): void {
  const drag = editor.drag;
  editor.drag = null;
  if (!drag) return;

  if (drag.tool === 'rect' && editor.marquee) {
    const layer = activeTileLayer();
    if (layer) fillRect(editor.doc, layer, editor.history, editor.stamp, editor.marquee);
  }

  if (drag.tool === 'pick' && editor.marquee) {
    const layer = activeTileLayer();
    if (layer) {
      const { x, y, w, h } = editor.marquee;
      editor.stamp = stampFromLayer(editor.doc, layer, x, y, w, h);
      editor.paletteSelection = null;
      redrawPalette();
      setTool('paint');
      status(`Picked up a ${w}x${h} stamp — switched to Paint.`, 'ok');
    }
  }

  editor.marquee = null;
  editor.history.commit();
  refreshPanels();
  requestDraw();
}

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

function setTool(tool: Tool): void {
  editor.tool = tool;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('button.tool')) {
    btn.setAttribute('aria-pressed', String(btn.dataset['tool'] === tool));
  }
  // The plot layer is not a tile layer, so painting while it is active would
  // silently do nothing. Snap to a sensible layer instead of failing quietly.
  if (tool !== 'plot' && tool !== 'object') {
    if (activeTileLayer() === undefined) {
      const first = tileLayers(editor.doc)[0];
      if (first) editor.activeLayerId = first.id;
    }
  }
  refreshPanels();
  requestDraw();
}

mapCanvas.addEventListener('pointerdown', (ev) => {
  mapCanvas.setPointerCapture(ev.pointerId);

  // Middle button or space+drag pans, matching every art tool the user has ever
  // touched. Neither disturbs the current tool.
  if (ev.button === 1 || editor.spaceHeld) {
    editor.panning = {
      x: ev.offsetX,
      y: ev.offsetY,
      panX: editor.view.panX,
      panY: editor.view.panY,
    };
    mapCanvas.classList.add('panning');
    ev.preventDefault();
    return;
  }
  if (ev.button !== 0) return;

  const tile = screenToTile(editor.doc, editor.view, ev.offsetX, ev.offsetY);
  const pixel = screenToMapPixel(editor.view, ev.offsetX, ev.offsetY);
  beginDrag(editor.tool, tile.x, tile.y, pixel.px, pixel.py, ev.altKey);
});

mapCanvas.addEventListener('pointermove', (ev) => {
  if (editor.panning) {
    editor.view.panX = editor.panning.panX + (ev.offsetX - editor.panning.x);
    editor.view.panY = editor.panning.panY + (ev.offsetY - editor.panning.y);
    requestDraw();
    return;
  }

  const tile = screenToTile(editor.doc, editor.view, ev.offsetX, ev.offsetY);
  const pixel = screenToMapPixel(editor.view, ev.offsetX, ev.offsetY);
  const inside = inBounds(editor.doc, tile.x, tile.y);
  editor.hover = inside ? tile : null;
  coordsEl.textContent = inside
    ? `${tile.x}, ${tile.y}   ·   zoom ${editor.view.zoom}x`
    : `—   ·   zoom ${editor.view.zoom}x`;

  if (editor.drag) continueDrag(tile.x, tile.y, pixel.px, pixel.py, ev.altKey);
  else requestDraw();
});

function releasePointer(ev: PointerEvent): void {
  if (mapCanvas.hasPointerCapture(ev.pointerId)) mapCanvas.releasePointerCapture(ev.pointerId);
  if (editor.panning) {
    editor.panning = null;
    mapCanvas.classList.remove('panning');
    return;
  }
  endDrag();
}

mapCanvas.addEventListener('pointerup', releasePointer);
mapCanvas.addEventListener('pointercancel', releasePointer);
mapCanvas.addEventListener('pointerleave', () => {
  editor.hover = null;
  requestDraw();
});
mapCanvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

mapCanvas.addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    const before = screenToMapPixel(editor.view, ev.offsetX, ev.offsetY);
    const next = ev.deltaY < 0 ? editor.view.zoom + 1 : editor.view.zoom - 1;
    // Integer zoom only. A fractional zoom resamples 16px art into mush no
    // matter what image-rendering says — same rule as PIXEL_SCALE in the game.
    editor.view.zoom = Math.min(MAX_ZOOM, Math.max(1, next));
    // Keep the pixel under the cursor put, so zooming feels anchored.
    editor.view.panX = Math.round(ev.offsetX - before.px * editor.view.zoom);
    editor.view.panY = Math.round(ev.offsetY - before.py * editor.view.zoom);
    requestDraw();
  },
  { passive: false },
);

/* --------------------------------- palette --------------------------------- */

let paletteDragStart: { x: number; y: number } | null = null;

function paletteCellFromEvent(ev: PointerEvent): { x: number; y: number } | null {
  const wrap = paletteCanvas.parentElement;
  const zoom = paletteZoom(editor.palette, wrap ? wrap.clientWidth : 240);
  return paletteCellAt(editor.palette, zoom, ev.offsetX, ev.offsetY);
}

function commitPaletteSelection(): void {
  if (!editor.paletteSelection) return;
  editor.stamp = stampFromSelection(editor.palette, editor.paletteSelection);
  redrawPalette();
  requestDraw();
}

paletteCanvas.addEventListener('pointerdown', (ev) => {
  const cell = paletteCellFromEvent(ev);
  if (!cell) return;
  paletteCanvas.setPointerCapture(ev.pointerId);
  paletteDragStart = cell;
  editor.paletteSelection = { x: cell.x, y: cell.y, w: 1, h: 1 };
  commitPaletteSelection();
});

paletteCanvas.addEventListener('pointermove', (ev) => {
  if (!paletteDragStart) return;
  const cell = paletteCellFromEvent(ev);
  if (!cell) return;
  const rect = rectFromDrag(paletteDragStart.x, paletteDragStart.y, cell.x, cell.y);
  editor.paletteSelection = rect;
  commitPaletteSelection();
});

paletteCanvas.addEventListener('pointerup', (ev) => {
  if (paletteCanvas.hasPointerCapture(ev.pointerId)) paletteCanvas.releasePointerCapture(ev.pointerId);
  paletteDragStart = null;
});

/* --------------------------------- keyboard -------------------------------- */

const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  b: 'paint',
  t: 'terrain',
  r: 'rect',
  g: 'fill',
  i: 'pick',
  e: 'erase',
  o: 'object',
  p: 'plot',
};

window.addEventListener('keydown', (ev) => {
  const target = ev.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

  if (ev.code === 'Space') {
    editor.spaceHeld = true;
    ev.preventDefault();
    return;
  }

  const key = ev.key.toLowerCase();

  if ((ev.ctrlKey || ev.metaKey) && key === 's') {
    ev.preventDefault();
    void doSave();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && key === 'z') {
    ev.preventDefault();
    if (ev.shiftKey) editor.history.redo();
    else editor.history.undo();
    refreshPanels();
    requestDraw();
    return;
  }
  if (ev.ctrlKey || ev.metaKey) return;

  if (key === 'delete' || key === 'backspace') {
    const layer = objectLayer(editor.doc);
    if (layer && editor.selectedObjectId !== null) {
      editor.history.begin('delete object');
      deleteObject(layer, editor.history, editor.selectedObjectId);
      editor.history.commit();
      editor.selectedObjectId = null;
      refreshPanels();
      requestDraw();
    }
    return;
  }

  if (key === 'f') {
    editor.view = fitToCanvas(editor.doc, mapCanvas);
    requestDraw();
    return;
  }

  const tool = TOOL_KEYS[key];
  if (tool) setTool(tool);
});

window.addEventListener('keyup', (ev) => {
  if (ev.code === 'Space') editor.spaceHeld = false;
});

/* ------------------------------------------------------------------ *
 * Toolbar and panel wiring
 * ------------------------------------------------------------------ */

for (const btn of document.querySelectorAll<HTMLButtonElement>('button.tool')) {
  btn.addEventListener('click', () => {
    const tool = btn.dataset['tool'];
    if (tool && (TOOLS as readonly string[]).includes(tool)) setTool(tool as Tool);
  });
}

el('undo').addEventListener('click', () => {
  editor.history.undo();
  refreshPanels();
  requestDraw();
});
el('redo').addEventListener('click', () => {
  editor.history.redo();
  refreshPanels();
  requestDraw();
});
el('fit').addEventListener('click', () => {
  editor.view = fitToCanvas(editor.doc, mapCanvas);
  requestDraw();
});

el<HTMLInputElement>('grid').addEventListener('change', (ev) => {
  editor.showGrid = (ev.target as HTMLInputElement).checked;
  requestDraw();
});
el<HTMLInputElement>('dim').addEventListener('change', (ev) => {
  editor.dimInactive = (ev.target as HTMLInputElement).checked;
  requestDraw();
});

el('add-layer').addEventListener('click', () => {
  const name = window.prompt('Layer name', `layer-${tileLayers(editor.doc).length + 1}`);
  if (!name) return;
  if (editor.doc.layers.some((l) => l.id === name)) {
    status(`A layer named "${name}" already exists.`, 'err');
    return;
  }
  // Insert below the object layer so new tile layers stay under sprites, which
  // is what "add a layer" almost always means on a farm map.
  const objectIndex = editor.doc.layers.findIndex((l) => l.kind === 'object');
  const layer = createTileLayer(name, name, editor.doc.width, editor.doc.height);
  editor.doc.layers.splice(objectIndex < 0 ? editor.doc.layers.length : objectIndex, 0, layer);
  editor.activeLayerId = name;
  editor.history.clear();
  refreshPanels();
  requestDraw();
});

el('remove-layer').addEventListener('click', () => {
  const layer = editor.doc.layers.find((l) => l.id === editor.activeLayerId);
  if (!layer || layer.kind !== 'tile') {
    status('Only tile layers can be removed.', 'err');
    return;
  }
  if (tileLayers(editor.doc).length <= 1) {
    status('A map needs at least one tile layer.', 'err');
    return;
  }
  if (!window.confirm(`Remove layer "${layer.name}" and everything on it?`)) return;
  editor.doc.layers = editor.doc.layers.filter((l) => l.id !== layer.id);
  // Removing a layer cannot be undone through the tile-diff stack, so the stack
  // is dropped rather than left pointing at a layer that no longer exists.
  editor.history.clear();
  const first = tileLayers(editor.doc)[0];
  editor.activeLayerId = first?.id ?? editor.doc.layers[0]?.id ?? 'ground';
  refreshPanels();
  requestDraw();
});

el('resize').addEventListener('click', () => {
  const w = Number(el<HTMLInputElement>('map-w').value);
  const h = Number(el<HTMLInputElement>('map-h').value);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    status('Width and height must be positive whole numbers.', 'err');
    return;
  }
  if (
    (w < editor.doc.width || h < editor.doc.height) &&
    !window.confirm('Shrinking discards tiles, objects and plots outside the new bounds. Continue?')
  ) {
    return;
  }
  resizeDoc(editor.doc, w, h);
  editor.history.clear();
  editor.view = fitToCanvas(editor.doc, mapCanvas);
  refreshPanels();
  requestDraw();
  scheduleAutosave(editor.doc);
});

el('clear-plots').addEventListener('click', () => {
  const layer = plotLayer(editor.doc);
  if (!layer || layer.cells.length === 0) return;
  if (!window.confirm(`Remove all ${layer.cells.length} plot markers?`)) return;
  editor.history.begin('clear plots');
  clearPlots(layer, editor.history);
  editor.history.commit();
  refreshPanels();
  requestDraw();
});

el('delete-object').addEventListener('click', () => {
  const layer = objectLayer(editor.doc);
  if (!layer || editor.selectedObjectId === null) return;
  editor.history.begin('delete object');
  deleteObject(layer, editor.history, editor.selectedObjectId);
  editor.history.commit();
  editor.selectedObjectId = null;
  refreshPanels();
  requestDraw();
});

async function doSave(): Promise<void> {
  const name = el<HTMLInputElement>('map-name').value.trim() || DEFAULT_MAP_NAME;
  status('Saving…');
  const result = await saveToProject(editor.doc, name);
  status(result.message, result.ok ? 'ok' : 'err');
}

el('save').addEventListener('click', () => void doSave());
el('download').addEventListener('click', () => {
  const name = el<HTMLInputElement>('map-name').value.trim() || DEFAULT_MAP_NAME;
  downloadMap(editor.doc, name);
});

/* --------------------------------- palettes -------------------------------- */

const paletteSelect = el<HTMLSelectElement>('palette-select');
for (const palette of PALETTES) {
  const option = document.createElement('option');
  option.value = palette.run.key;
  option.textContent = palette.paintable
    ? palette.run.key
    : `${palette.run.key} (objects only — ${palette.run.tileWidth}x${palette.run.tileHeight})`;
  paletteSelect.append(option);
}

/**
 * Give the Paint tool something to paint on first load.
 *
 * With no selection the stamp is empty and the first click does nothing, which
 * is a terrible first impression. The terrain fill tile is the most useful
 * single tile on the sheet, and it is derived from the terrain set rather than
 * hardcoded so it survives recalibration.
 */
function selectDefaultPaletteTile(): void {
  const set = currentTerrainSet();
  if (!set || editor.palette.run.key !== set.tilesetKey) return;
  const frame = frameForRole(set, 'c');
  if (frame === undefined) return;

  const cols = editor.palette.run.columns;
  editor.paletteSelection = { x: frame % cols, y: Math.floor(frame / cols), w: 1, h: 1 };
  editor.stamp = stampFromSelection(editor.palette, editor.paletteSelection);
}

function updatePaletteHint(): void {
  el('palette-hint').textContent = editor.palette.paintable
    ? 'Click a tile, or drag to select a block as a multi-tile stamp.'
    : 'Frames are not one grid cell, so this sheet can only be placed with the Object tool.';
}

paletteSelect.addEventListener('change', () => {
  const next = paletteByKey(paletteSelect.value);
  if (!next) return;
  editor.palette = next;
  editor.paletteSelection = null;
  updatePaletteHint();
  redrawPalette();
});

/* --------------------------------- terrain --------------------------------- */

const terrainSelect = el<HTMLSelectElement>('terrain-select');

function refreshTerrainPanel(): void {
  const set = currentTerrainSet();
  if (!set) return;
  renderPreview(el('terrain-preview'), set);
  renderCalibrator(el('terrain-calibrate'), set, {
    onAssign: (role: Role, localIndex: number) => {
      set.roles[role] = localIndex;
      renderPreview(el('terrain-preview'), set);
    },
  });
}

for (const set of editor.terrainSets) {
  const option = document.createElement('option');
  option.value = set.id;
  option.textContent = set.name;
  terrainSelect.append(option);
}
terrainSelect.value = editor.terrainSetId;
terrainSelect.addEventListener('change', () => {
  editor.terrainSetId = terrainSelect.value;
  refreshTerrainPanel();
  // Choosing a terrain is only meaningful for the terrain brush. Without this,
  // picking "Tilled soil" while Paint is active does nothing on click and looks
  // like the editor ignoring you.
  setTool('terrain');
  const set = currentTerrainSet();
  if (set) status(`Terrain brush: ${set.name}. Drag on the map to paint it.`, 'ok');
});

el('save-terrain').addEventListener('click', () => {
  void saveTerrainSets(editor.terrainSets).then((result) =>
    status(result.message, result.ok ? 'ok' : 'err'),
  );
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

// A ResizeObserver, not just window.resize: the canvas also changes size when a
// side panel gains a scrollbar or the layout reflows, and those fire no window
// event at all.
new ResizeObserver(() => resizeCanvas()).observe(mapCanvas);

/** Prefer an existing farm.json so editing sessions are continuous; fall back to
 *  the autosave scratch buffer; otherwise start blank. */
async function loadInitialDoc(): Promise<string> {
  const name = el<HTMLInputElement>('map-name').value.trim() || DEFAULT_MAP_NAME;
  try {
    const res = await fetch(`/tilemaps/${name}.json`, { cache: 'no-store' });
    if (res.ok) {
      const { doc, warnings } = deserialize((await res.json()) as TiledMap);
      setDoc(doc);
      return warnings.length > 0
        ? `Loaded ${name}.json with warnings: ${warnings.join(' ')}`
        : `Loaded existing ${name}.json`;
    }
  } catch {
    // No map on disk yet — expected on a first run.
  }

  const restored = loadAutosave();
  if (restored) {
    setDoc(restored);
    return 'Restored unsaved work from this browser.';
  }

  setDoc(createDoc());
  return `New ${editor.doc.width}x${editor.doc.height} map. Tiles are ${TILE_SIZE}px.`;
}

async function boot(): Promise<void> {
  const report = await loadAllImages();
  const message = await loadInitialDoc();

  resizeCanvas();
  editor.view = fitToCanvas(editor.doc, mapCanvas);

  // Sync the toolbar to whatever tool is current rather than forcing 'paint':
  // asset loading is async and the user may already have clicked a tool.
  setTool(editor.tool);
  updatePaletteHint();
  selectDefaultPaletteTile();
  redrawPalette();
  refreshTerrainPanel();
  refreshPanels();
  requestDraw();

  if (report.failed.length > 0) {
    status(
      `Missing art: ${report.failed.join(', ')}. Run \`pnpm assets\` at the repo root.`,
      'err',
    );
  } else {
    status(message, 'ok');
  }
}

void boot();
