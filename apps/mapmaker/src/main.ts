/**
 * Editor boot and input handling.
 *
 * This file owns the mutable editor state and translates pointer/keyboard
 * events into tool calls. Everything it calls into (model, tools, io, render)
 * is pure or takes its state explicitly, so the messy part is confined here.
 */

import {
  AUTHORED_GROUND_ANIMATIONS,
  BUILTIN_GROUND_ANIMATIONS,
  SUBTILE_RESOLUTION,
  TILE_SIZE,
  GROUND_SCATTER,
  WATER_ANIM_FPS,
  animatedSheet,
  isBuiltinAnimationId,
  libraryProblems,
  type GroundAnimation,
} from '@tillhaven/shared/config';

import {
  createDoc,
  createTileLayer,
  indexOf,
  inBounds,
  objectLayer,
  animLayer,
  collisionLayer,
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
import { clearAnims, renameAnimId, setAnim } from './tools/anim.js';
import {
  addFrame,
  createAnimation,
  deleteAnimation,
  duplicateAnimation,
  moveFrame,
  overrideAnimation,
  removeFrameAt,
  renameAnimation,
  setAnimationFps,
  setAnimationId,
  takenIds,
  type AnimLibrary,
} from './tools/animLibrary.js';
import { clearCollision, paintCells, tileCells } from './tools/collision.js';

import { loadAllImages } from './render/images.js';
import {
  drawMap,
  fitToCanvas,
  hasAnimatedTiles,
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

import { deserialize, serialize, type TiledMap } from './io/tiled.js';
import {
  DEFAULT_MAP_NAME,
  downloadMap,
  saveGroundAnimations,
  saveTerrainSets,
  saveToProject,
} from './io/save.js';
import { loadAutosave, scheduleAutosave } from './io/autosave.js';

import {
  AnimPreview,
  renderAnimPanel,
  renderCollisionCount,
  renderLayers,
  renderObjectInfo,
  renderPlots,
  type AnimPanelDom,
} from './ui/panels.js';
import { renderCalibrator, renderPreview } from './ui/terrainPanel.js';

const TOOLS = [
  'paint',
  'terrain',
  'rect',
  'fill',
  'pick',
  'erase',
  'object',
  'plot',
  'anim',
  'collide',
] as const;
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
  /** Modifiers as the stroke STARTED. See `beginDrag`. */
  shift: boolean;
  alt: boolean;
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
  /** Hatch the house/coop/barn ground, which lives in no layer of the doc. */
  showReserved: boolean;
  dimInactive: boolean;
  hover: { x: number; y: number } | null;
  marquee: Rect | null;
  selectedObjectId: number | null;
  /** Which ground animation the anim brush stamps. */
  animId: string;
  /** The AUTHORED animations, i.e. the ones this editor may change. */
  animLibrary: AnimLibrary;
  /** Set by any library edit, cleared by a successful save. */
  animDirty: boolean;
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
  animId: BUILTIN_GROUND_ANIMATIONS[0]?.id ?? AUTHORED_GROUND_ANIMATIONS[0]?.id ?? '',
  // Seeded from the generated file, which is what the game is reading right
  // now. Editing here diverges from it until "Save animations" writes it back —
  // hence `animDirty`, and hence the unload guard further down.
  animLibrary: AUTHORED_GROUND_ANIMATIONS.map((a) => ({ ...a, frames: a.frames.map((f) => ({ ...f })) })),
  animDirty: false,
  showGrid: true,
  // On by default: this is the only thing on the farm that occupies ground
  // without being in the map, so it is the one overlay whose absence is a trap
  // rather than a preference (M6).
  showReserved: true,
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
 * The animation library
 * ------------------------------------------------------------------ */

/**
 * What the panel shows: built-ins first, then the authored ones.
 *
 * Recomputed on every render rather than cached, because the alternative is a
 * cache invalidated by nine different edits and the failure — a dropdown one
 * edit behind — is the kind you stare at for a while.
 *
 * This mirrors `mergeAnimations` in shared config on purpose: the editor must
 * resolve an id exactly the way the game will, or the frames you aim with are
 * not the frames that play.
 */
function mergedAnimations(): readonly GroundAnimation[] {
  const merged = new Map<string, GroundAnimation>();
  for (const animation of BUILTIN_GROUND_ANIMATIONS) merged.set(animation.id, animation);
  for (const animation of editor.animLibrary) merged.set(animation.id, animation);
  return [...merged.values()];
}

/** Every id in play, so a new one cannot collide with a built-in either. */
function allAnimIds(): string[] {
  return takenIds(editor.animLibrary, BUILTIN_GROUND_ANIMATIONS);
}

const animPreview = new AnimPreview(el('anim-play'));

function animPanelDom(): AnimPanelDom {
  return {
    select: el<HTMLSelectElement>('anim-select'),
    count: el('anim-count'),
    name: el<HTMLInputElement>('anim-name'),
    id: el<HTMLInputElement>('anim-id'),
    fps: el<HTMLInputElement>('anim-fps'),
    strip: el('anim-strip'),
    notes: el('anim-notes'),
    deleteButton: el<HTMLButtonElement>('anim-delete'),
    addFrameButton: el<HTMLButtonElement>('anim-add-frame'),
  };
}

/**
 * Applies a library edit and repaints.
 *
 * Every mutation funnels through here so "mark dirty, re-render" cannot be
 * forgotten at one of a dozen call sites — which would show up as an editor
 * that looks like it accepted an edit and then saves without it.
 *
 * **Library edits are NOT on the map's undo stack.** `History` records layer
 * snapshots for the document being authored; the library is a different file
 * with a different lifetime, and putting the two on one stack would make Ctrl+Z
 * after a save undo something the game has already loaded.
 */
function updateLibrary(next: AnimLibrary): void {
  editor.animLibrary = next;
  editor.animDirty = true;
  refreshPanels();
}

/**
 * The library the selected animation can actually be edited in.
 *
 * **A built-in is forked into an authored override on its first edit**, under
 * the SAME id, so the change reaches every cell already stamped with it. That is
 * what the merge in shared config resolves authored-over-built-in for, and for a
 * while the panel refused to let anyone reach it: built-ins were read-only and
 * Duplicate was offered instead. Duplicate gives a NEW id, so the map went on
 * showing the animation you were trying to change.
 *
 * Called by every mutating handler rather than by a "make editable" button:
 * having to arm the panel before typing in it is a step whose only purpose is to
 * ask whether you meant the thing you just did.
 */
function editableLibrary(): AnimLibrary {
  const source = mergedAnimations().find((a) => a.id === editor.animId);
  if (!source || !isBuiltinAnimationId(source.id)) return editor.animLibrary;
  return overrideAnimation(editor.animLibrary, source);
}

const animPanelHandlers = {
  onSelect(id: string): void {
    editor.animId = id;
    refreshPanels();
  },

  onRename(name: string): void {
    updateLibrary(renameAnimation(editableLibrary(), editor.animId, name));
  },

  onFps(fps: number): void {
    updateLibrary(setAnimationFps(editableLibrary(), editor.animId, fps));
  },

  /**
   * Renaming an id, and repointing the open map with it.
   *
   * The map stores the id and nothing else, so this is the one library edit
   * that can break a map. Cells in the map on screen are re-pointed
   * automatically — that is a strict improvement on orphaning them — but any
   * OTHER saved map that stamped the old id is beyond reach here, which is what
   * the confirmation is for.
   */
  onChangeId(nextId: string): void {
    const from = editor.animId;
    if (nextId === from) return;

    const next = setAnimationId(editor.animLibrary, from, nextId, allAnimIds());
    if (!next) {
      status(`"${nextId}" is not a valid free id — lower-case, digits and dashes.`, 'err');
      refreshPanels();
      return;
    }

    const layer = animLayer(editor.doc);
    const stamped = layer?.cells.filter((c) => c.animId === from).length ?? 0;
    if (
      stamped > 0 &&
      !window.confirm(
        `${stamped} cell(s) on this map stamp "${from}". They will be repointed at ` +
          `"${nextId}". Any OTHER saved map using "${from}" will be orphaned. Continue?`,
      )
    ) {
      refreshPanels();
      return;
    }

    if (layer && stamped > 0) {
      editor.history.begin('rename animation');
      renameAnimId(layer, editor.history, from, nextId);
      editor.history.commit();
      requestDraw();
    }

    editor.animId = nextId;
    updateLibrary(next);
    status(
      stamped > 0 ? `Renamed to "${nextId}" and repointed ${stamped} cell(s).` : `Renamed to "${nextId}".`,
      'ok',
    );
  },

  onRemoveFrame(index: number): void {
    updateLibrary(removeFrameAt(editableLibrary(), editor.animId, index));
  },

  onMoveFrame(from: number, to: number): void {
    updateLibrary(moveFrame(editableLibrary(), editor.animId, from, to));
  },
};

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function overlay(): Overlay {
  return {
    showGrid: editor.showGrid,
    showPlots: true,
    showReserved: editor.showReserved,
    hover: editor.hover,
    marquee: editor.marquee,
    brushW: editor.tool === 'paint' || editor.tool === 'erase' ? editor.stamp.w : 1,
    brushH: editor.tool === 'paint' || editor.tool === 'erase' ? editor.stamp.h : 1,
    selectedObjectId: editor.selectedObjectId,
    activeLayerId: editor.activeLayerId,
    dimInactive: editor.dimInactive,
    // Only while the collision brush is in hand: a 90x66 lattice over the whole
    // map is unreadable the rest of the time.
    showCells: editor.tool === 'collide',
    animStep: animStep,
  };
}

/**
 * The clock for animated SHEETS (`ANIMATED_SHEETS`) — water, mainly.
 *
 * **The editor shows what the game will show.** Water painted here animates
 * there, so it animates here: a shoreline you can only judge after saving,
 * alt-tabbing and reloading is one you are placing blind.
 *
 * Held still when the map has nothing animated in it, because a tool that
 * repaints four times a second forever, for nothing, is a tool that never idles.
 */
let animStep = 0;
window.setInterval(() => {
  if (!hasAnimatedTiles(editor.doc)) return;
  animStep += 1;
  requestDraw();
}, 1000 / WATER_ANIM_FPS);

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

  const animations = mergedAnimations();
  renderAnimPanel(
    animPanelDom(),
    editor.doc,
    animations,
    new Set(editor.animLibrary.map((a) => a.id)),
    editor.animId,
    animPanelHandlers,
  );
  animPreview.show(animations.find((a) => a.id === editor.animId));

  renderCollisionCount(el('collide-count'), editor.doc);

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

function beginDrag(
  tool: Tool,
  x: number,
  y: number,
  px: number,
  py: number,
  alt: boolean,
  shift: boolean,
): void {
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
    shift,
    alt,
  };
  // Refuse before opening a history batch, so a rejected click leaves no trace.
  const needsStamp = tool === 'paint' || tool === 'rect' || tool === 'fill';
  if ((needsStamp || tool === 'erase' || tool === 'terrain') && !canEditTiles(needsStamp)) {
    return;
  }
  // Remembered on the drag so the whole stroke keeps the modifier it started
  // with — releasing Shift mid-drag should not switch a tile-wide stroke to a
  // cell-wide one halfway across.
  drag.shift = shift;
  drag.alt = alt;

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
    case 'anim': {
      const layer = animLayer(editor.doc);
      if (layer) {
        // Alt erases, matching the terrain brush. Stamping what is already
        // there is a no-op and consumes no undo slot (see `setAnim`).
        setAnim(editor.doc, layer, editor.history, x, y, alt ? null : editor.animId);
        requestDraw();
      }
      break;
    }
    case 'collide': {
      paintCollisionAt(px, py, alt, shift);
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

/**
 * Paints one collision cell — or one whole tile, with Shift.
 *
 * **Takes map PIXELS, not tiles**, because a cell is a third of a tile and the
 * tile coordinate has already thrown away which third the pointer was in. Every
 * other tool here works in tiles, which is exactly why this one has to say
 * loudly that it does not.
 */
function paintCollisionAt(px: number, py: number, erase: boolean, wholeTile: boolean): void {
  const layer = collisionLayer(editor.doc);
  if (!layer) return;

  const size = editor.doc.tileWidth / SUBTILE_RESOLUTION;
  const cx = Math.floor(px / size);
  const cy = Math.floor(py / size);

  const cells = wholeTile
    ? tileCells(Math.floor(px / editor.doc.tileWidth), Math.floor(py / editor.doc.tileHeight))
    : [{ cx, cy }];

  if (paintCells(editor.doc, layer, editor.history, cells, !erase)) requestDraw();
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
    case 'anim': {
      const layer = animLayer(editor.doc);
      if (!layer) break;
      for (const [cx, cy] of path) {
        setAnim(editor.doc, layer, editor.history, cx, cy, drag.alt ? null : editor.animId);
      }
      requestDraw();
      break;
    }
    case 'collide':
      /*
       * From PIXELS, not from the tile path above. `lineCells` interpolates
       * tiles, and a cell brush driven from it would paint the top-left cell of
       * each tile the pointer crossed — a dotted diagonal instead of a stroke.
       * Sampling the pointer directly is coarser between events and correct.
       */
      paintCollisionAt(px, py, drag.alt, drag.shift);
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
  // Only the tile tools need a tile layer to be active. The plot, object,
  // animation and collision tools each own their own layer, so snapping the
  // active layer for them would silently move the user off whatever they were
  // painting on.
  if (tool !== 'plot' && tool !== 'object' && tool !== 'anim' && tool !== 'collide') {
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
  beginDrag(editor.tool, tile.x, tile.y, pixel.px, pixel.py, ev.altKey, ev.shiftKey);
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
  a: 'anim',
  c: 'collide',
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
el<HTMLInputElement>('reserved').addEventListener('change', (ev) => {
  editor.showReserved = (ev.target as HTMLInputElement).checked;
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

el<HTMLSelectElement>('anim-select').addEventListener('change', (ev) => {
  // Switching what the brush stamps is not itself an edit, so no history batch
  // — but the panel has to repaint to show the new frame strip.
  animPanelHandlers.onSelect((ev.target as HTMLSelectElement).value);
});

/**
 * A new animation, named up front.
 *
 * Asked for rather than defaulted because the id is DERIVED from the name and
 * the id is the string every map file stores. Creating "New animation" and then
 * typing the real name into the field leaves `new-animation` in the map forever
 * — the name is cosmetic, the id is not, and only the first one you give gets
 * to be free.
 */
el('anim-new').addEventListener('click', () => {
  const name = window.prompt('Name the animation', 'Fountain');
  if (name === null) return;
  if (name.trim() === '') {
    status('An animation needs a name — the id is derived from it.', 'err');
    return;
  }

  const { library, id } = createAnimation(editor.animLibrary, allAnimIds(), name.trim());
  editor.animId = id;
  updateLibrary(library);
  status(`New animation "${id}". Pick a tile in the palette and press Add frame.`, 'ok');
});

/**
 * Duplicate, which is also how a built-in gets "edited".
 *
 * Built-ins live in TypeScript because they are derived from measured constants,
 * so the editor must not write them. Copying one gives you the same frames in an
 * entry you own — which is what somebody means when they say they want to change
 * the water.
 */
el('anim-duplicate').addEventListener('click', () => {
  const source = mergedAnimations().find((a) => a.id === editor.animId);
  if (!source) return;
  const { library, id } = duplicateAnimation(editor.animLibrary, source, allAnimIds());
  editor.animId = id;
  updateLibrary(library);
  status(`Copied "${source.id}" to "${id}" — this one is editable.`, 'ok');
});

/**
 * Delete, or reset — the same operation under two honest names.
 *
 * Removing an AUTHORED animation deletes it, and any cell stamped with its id is
 * orphaned. Removing an **override** restores the built-in, because the merge
 * falls back the moment the authored entry is gone: nothing is orphaned, nothing
 * needs warning about, and the selection stays where it is because the id still
 * resolves to something.
 */
el('anim-delete').addEventListener('click', () => {
  const id = editor.animId;
  if (!editor.animLibrary.some((a) => a.id === id)) return;

  if (isBuiltinAnimationId(id)) {
    if (!window.confirm(`Reset "${id}" to the built-in? Your changes to it are discarded.`)) return;
    updateLibrary(deleteAnimation(editor.animLibrary, id));
    status(`"${id}" is back to the built-in.`, 'ok');
    return;
  }

  const layer = animLayer(editor.doc);
  const stamped = layer?.cells.filter((c) => c.animId === id).length ?? 0;
  const warning =
    stamped > 0
      ? `Delete "${id}"? ${stamped} cell(s) on this map stamp it and will draw nothing.`
      : `Delete "${id}"?`;
  if (!window.confirm(warning)) return;

  const library = deleteAnimation(editor.animLibrary, id);
  editor.animId = BUILTIN_GROUND_ANIMATIONS[0]?.id ?? library[0]?.id ?? '';
  updateLibrary(library);
  status(`Deleted "${id}".`, 'ok');
});

/**
 * Appends whatever the palette has selected.
 *
 * **The palette IS the frame picker**, rather than this panel growing its own
 * sheet browser. It already lists every sheet in the manifest and draws each one
 * at a readable size, and a second picker would be a second thing to keep in
 * step with `assets.ts`. It is also the reason frames can come from different
 * sheets at all: switching the tileset dropdown between two "Add frame" clicks
 * is the entire gesture.
 *
 * The TOP-LEFT of a marquee is taken, not the rectangle: a frame list is one
 * frame per entry, and quietly appending twelve because somebody still had a
 * fence stamp selected is worse than taking the corner they can see is
 * highlighted.
 */
el('anim-add-frame').addEventListener('click', () => {
  const selection = editor.paletteSelection;
  if (!selection) {
    status('Select a tile in the palette first — that is the frame to add.', 'err');
    return;
  }

  const run = editor.palette.run;
  const frame = selection.y * run.columns + selection.x;
  if (frame >= run.tileCount) {
    status('That palette cell is past the end of the sheet.', 'err');
    return;
  }

  updateLibrary(addFrame(editableLibrary(), editor.animId, { sheet: run.key, frame }));
  status(`Added ${run.key} frame ${frame}.`, 'ok');
});

el('anim-save').addEventListener('click', () => {
  // Checked here as well as in the endpoint, because the two failures read
  // differently: the endpoint refusing is "the tool is broken", the panel
  // refusing names the animation and what is wrong with it.
  const problems = libraryProblems(editor.animLibrary);
  if (problems.length > 0) {
    status(`Cannot save: ${problems.join('; ')}`, 'err');
    return;
  }

  void saveGroundAnimations(editor.animLibrary).then((result) => {
    status(result.message, result.ok ? 'ok' : 'err');
    if (result.ok) editor.animDirty = false;
  });
});

/**
 * The library is not autosaved, so leaving with it dirty has to be announced.
 *
 * The map has `scheduleAutosave`; this deliberately does not, because a save
 * here rewrites a file the GAME imports and Vite reloads on. Autosaving it
 * would mean a half-built animation with no frames hot-reloading into the game
 * every few seconds.
 */
window.addEventListener('beforeunload', (ev) => {
  if (!editor.animDirty) return;
  ev.preventDefault();
  // Chrome ignores the string and shows its own text; assigning is still what
  // triggers the prompt at all.
  ev.returnValue = '';
});

el('clear-anims').addEventListener('click', () => {
  const layer = animLayer(editor.doc);
  if (!layer || layer.cells.length === 0) return;
  if (!window.confirm(`Remove all ${layer.cells.length} animated cells?`)) return;
  editor.history.begin('clear animations');
  clearAnims(layer, editor.history);
  editor.history.commit();
  refreshPanels();
  requestDraw();
});

el('clear-collision').addEventListener('click', () => {
  const layer = collisionLayer(editor.doc);
  if (!layer || layer.cells.length === 0) return;
  if (!window.confirm(`Remove all ${layer.cells.length} painted collision cells?`)) return;
  editor.history.begin('clear collision');
  clearCollision(layer, editor.history);
  editor.history.commit();
  refreshPanels();
  requestDraw();
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
  const base = editor.palette.paintable
    ? 'Click a tile, or drag to select a block as a multi-tile stamp.'
    : 'Frames are not one grid cell, so this sheet can only be placed with the Object tool.';

  /*
   * Say it in words as well as in dots. The sheet being four frames of the same
   * art is not something you can see by looking at it — the blocks are subtly
   * different, and the natural reading is "lots of similar tiles" rather than
   * "one tile, four times".
   */
  const spec = animatedSheet(editor.palette.run.key);
  if (spec) {
    el('palette-hint').textContent =
      `${base} This sheet animates: ${spec.frames} frames, ${spec.fps}fps. ` +
      `Tiles with a dot move once painted — the rest are static art.`;
    return;
  }

  /*
   * The props sheet carries a constraint its art does not advertise.
   *
   * `decor` draws BELOW every world sprite, so a prop with height is drawn
   * behind the player from every angle, permanently — which is why
   * `GROUND_SCATTER` picked only flat tufts and pebbles. Someone adding flowers
   * by hand has no way to know that, and the symptom (a flower the character
   * walks in front of when they should be behind it) is subtle enough to live
   * on a map for a long time.
   */
  if (editor.palette.run.key === GROUND_SCATTER.sheet) {
    el('palette-hint').textContent =
      `${base} Ticked props are the ones the farm already scatters — flat, safe on ` +
      `the decor layer. Decor draws under every sprite, so anything with height ` +
      `will sit behind the player forever.`;
    return;
  }

  el('palette-hint').textContent = base;
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

/**
 * Load the map on disk, the autosave, or a blank document.
 *
 * **The autosave is offered when it DIFFERS from the file, rather than silently
 * losing to it.** The old order was file-first, autosave only as a fallback,
 * which is right whenever the file is the newer thing — and catastrophic in the
 * one case where it is not. A script regenerated `farm.json` from config while
 * an editor tab held hours of unsaved authoring; the tab still had the good map
 * in memory, but any reload would have loaded the regenerated file *and then*
 * overwritten the scratch buffer with it, taking the last copy with it. The work
 * survived only because nobody pressed F5.
 *
 * So a differing scratch buffer now asks. It is one prompt, only when the two
 * genuinely disagree, and the wrong answer is recoverable in a way that silently
 * discarding somebody's afternoon is not.
 */
async function loadInitialDoc(): Promise<string> {
  const name = el<HTMLInputElement>('map-name').value.trim() || DEFAULT_MAP_NAME;
  try {
    const res = await fetch(`/tilemaps/${name}.json`, { cache: 'no-store' });
    if (res.ok) {
      const raw = (await res.json()) as TiledMap;
      const { doc, warnings } = deserialize(raw);

      /*
       * Compared as serialised documents rather than by a timestamp: the two
       * come from different clocks (a file mtime and a browser), and "which is
       * newer" is exactly the question that was answered wrongly. "Do they
       * differ at all" needs no clock.
       */
      const restored = loadAutosave();
      if (restored && JSON.stringify(serialize(restored)) !== JSON.stringify(raw)) {
        const keep = window.confirm(
          `This browser has unsaved work that differs from ${name}.json on disk.\n\n` +
            `OK — keep the unsaved work (then press Save to project to write it).\n` +
            `Cancel — discard it and load ${name}.json.`,
        );
        if (keep) {
          setDoc(restored);
          return 'Restored unsaved work. Press Save to project to write it to disk.';
        }
      }

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
